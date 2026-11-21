/* room_fit.js — нержавеющие пресс-фитинги общего вида котельной: размеры из паспорта и выбор детали на стыке труб разных диаметров.
 *
 * Источник — паспорт ROMMER «Трубы и пресс-фитинги ROMMER из нержавеющей стали» (раздел RSS; линейка STOUT SSS — та же по артикулам и размерам):
 * 1003 угольник 90° ВПр-ВПр, 1005 угольник 45° ВПр-ВПр, 1013 тройник равнопроходной, 1014 тройник переходной, 1018 муфта переходная.
 * Допущение, не расшифрованное в паспорте: L и H угольников и половина L тройника, H отвода — расстояние от точки пересечения осей до торца раструба.
 * Все размеры в мм. Ряд типоразмеров общего вида — 22, 28, 35, 42 (как в подборе магистрали котельной: от 22 до 42).
 *
 * Правила стыка (повторяют смету: app.ssTee, переходные муфты 1018):
 *   • угол внутри одной трубы — угольник 90° её размера;
 *   • отвод на трубу другого размера — переходной тройник проход×отвод×проход, если такой артикул есть (28х22, 35х22, 35х28, 42х35);
 *     иначе равнопроходной тройник проходного размера и переходные муфты на отводе («сужается муфтой-переходом по месту», как сказано в подсказке сметы);
 *   • угол между трубами разных размеров — угольник меньшего размера и переходные муфты со стороны большей трубы;
 *   • муфты есть только между соседними размерами ряда (28х22, 35х28, 42х35), через несколько размеров они идут цепочкой.
 * Раструб одного фитинга упирается торцом в торец раструба другого: между ними труба целиком внутри раструбов.
 */
(function () {
  'use strict';
  var SIZES = [22, 28, 35, 42];
  var SZ = {
    22: { n: 25, e90: 57, e45: 40, Lt: 84, Ht: 45.5 },
    28: { n: 25, e90: 67, e45: 44, Lt: 92, Ht: 49 },
    35: { n: 29, e90: 75, e45: 49.5, Lt: 104, Ht: 55.5 },
    42: { n: 36, e90: 94, e45: 62, Lt: 129, Ht: 68 }
  };
  var TEE_RED = { '28x22': { L: 92, H: 48.5 }, '35x22': { L: 104, H: 52.5 }, '35x28': { L: 104, H: 52.5 }, '42x35': { L: 129, H: 59 } };
  var CP = { '28x22': 69, '35x28': 74, '42x35': 84 };

  function ok(s) { return !!SZ[s]; }
  function prevSize(s) { var i = SIZES.indexOf(s); return i > 0 ? SIZES[i - 1] : null; }
  function nextSize(s) { var i = SIZES.indexOf(s); return i >= 0 && i < SIZES.length - 1 ? SIZES[i + 1] : null; }

  // переходные муфты на отводе от раструба размера x к трубе размера y; считаем от торца раструба узла наружу.
  // Возвращает { cps: [{ big, small, bigOut, from, len, key }], len: сумма длин, cut: расстояние от торца раструба до торца трубы y (отрицательно — труба внутри раструбов) }
  function armChain(x, y) {
    var cps = [], at = 0, c = x;
    if (x > y) {
      while (c > y) { var p = prevSize(c); if (!p || !CP[c + 'x' + p]) return null; cps.push({ big: c, small: p, bigOut: false, from: at, len: CP[c + 'x' + p], key: 'cp_' + c + 'x' + p }); at += CP[c + 'x' + p]; c = p; }
    } else if (x < y) {
      while (c < y) { var q = nextSize(c); if (!q || !CP[q + 'x' + c]) return null; cps.push({ big: q, small: c, bigOut: true, from: at, len: CP[q + 'x' + c], key: 'cp_' + q + 'x' + c }); at += CP[q + 'x' + c]; c = q; }
    }
    return { cps: cps, len: at, end: at - SZ[y].n };
  }

  // угол между трубами размеров a и b: угольник меньшего размера; arms[i] = { tip, cps, cut } — для трубы своего размера
  function elbow(a, b) {
    if (!ok(a) || !ok(b)) return null;
    var s = Math.min(a, b), tip = SZ[s].e90, A = armChain(s, a), B = armChain(s, b);
    if (!A || !B) return null;
    return { key: 'e90_' + s, size: s, tip: tip, armA: { cps: A.cps, cut: tip + A.end }, armB: { cps: B.cps, cut: tip + B.end } };
  }

  // отвод размера b от прохода размера a: тройник + (если нужно) муфты на отводе
  function tee(a, b) {
    if (!ok(a) || !ok(b) || b > a) return null;
    if (a === b) return { key: 'tee_' + a, tip: SZ[a].Ht, cps: [], cut: SZ[a].Ht - SZ[b].n, kind: 'eq' };
    var t = TEE_RED[a + 'x' + b];
    if (t) return { key: 'tee_' + a + 'x' + b, tip: t.H, cps: [], cut: t.H - SZ[b].n, kind: 'red' };
    var ch = armChain(a, b);
    if (!ch) return null;
    return { key: 'tee_' + a, tip: SZ[a].Ht, cps: ch.cps, cut: SZ[a].Ht + ch.end, kind: 'eq+cp' };
  }

  // угольник 45° ВПр-ВПр для смещения трубы по глубине
  function e45(s) { return ok(s) ? { key: 'e45_' + s, tip: SZ[s].e45, cut: SZ[s].e45 - SZ[s].n } : null; }

  window.RoomFit = { SIZES: SIZES, SZ: SZ, TEE_RED: TEE_RED, CP: CP, ok: ok, armChain: armChain, elbow: elbow, tee: tee, e45: e45 };
})();
