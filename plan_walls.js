/**
 * plan_walls.js — ручная геометрия стен на плане этажа (этап 1).
 *
 * Зачем: пока распознавание плана через модель отключено, монтажник должен уметь
 * задать геометрию дома сам — обвести стены по подложке или нарисовать их на пустом
 * листе с сеткой. Стены лежат в f.walls = [{ id, a:[x,y], b:[x,y], k:'ext'|'int' }]
 * в тех же пикселях плана, что и зоны (метры = пиксели / f.pxPerM).
 *
 * Толщины в стене нет: наружная берётся из пирога стены калькулятора, внутренняя
 * из своего поля (WALL_T, пока значения по умолчанию — связку добавит этап 4).
 *
 * Подключается к plan_editor.html после основного скрипта: оборачивает draw() и
 * ставит свои обработчики, действующие только в режиме 'wall'.
 */
(function (G) {
  'use strict';

  // Доступ: только у тех, у кого включена отрисовка ТП («Раскладка ТП» в тарифах или проектирование). Метку ставит
  // калькулятор (app.canUseUfhPlan -> heatcalc_ufhplan_access). Без неё стены, окна, 3D и обводка не подключаются.
  var access = false;
  try { access = localStorage.getItem('heatcalc_ufhplan_access') === '1'; } catch (e) { }
  if (!access) return;
  G.wallsEnabled = true;
  setTimeout(function () { try { if (G.renderZones) G.renderZones(); } catch (e) { } }, 0);   // боковая панель рисовалась до загрузки этого файла
  (function showBtn() { var b = document.getElementById('b_wall'); if (b) b.style.display = ''; })();

  // Толщины, м. Наружная - сумма слоёв пирога стены из «Параметров объекта» калькулятора (его состояние лежит
  // в localStorage, как и комнаты расчёта); нет пирога - 0,40. Внутренняя перегородка - 0,15, правится в плане.
  var thickCache = null, thickAt = 0;
  function extT() {
    var fl0 = G.DATA && G.DATA.floors && G.DATA.floors[0], ov = fl0 && fl0.extT;   // толщина, снятая с подложки при обводке
    if (ov > 0.1 && ov < 1) return ov;
    var now = Date.now();
    if (thickCache === null || now - thickAt > 2000) {
      thickAt = now; thickCache = 0.40;
      try {
        var st = JSON.parse(localStorage.getItem('stout_save'));
        if (st && st.wallLayersEnabled && Array.isArray(st.wallLayers)) {
          var t = 0;
          st.wallLayers.forEach(function (l) { t += parseInt(l && l.thick, 10) || 0; });
          if (t >= 100 && t <= 1000) thickCache = t / 1000;
        }
      } catch (e) { }
    }
    return thickCache;
  }
  // толщина перегородок хранится в первом этаже (там, где сохраняется разметка), старое поле DATA.intT — запасное
  function intT() {
    var v = G.DATA && ((G.DATA.floors && G.DATA.floors[0] && G.DATA.floors[0].intT) || G.DATA.intT);
    return v > 0.05 && v < 0.6 ? v : 0.15;
  }
  /** Толщина внутренних стен: вопрос в сантиметрах, комнаты пересчитываются по новой толщине. */
  G.wallsInnerThickness = function () {
    G.askText({
      title: 'Толщина перегородок', sub: 'В сантиметрах: 10, 12, 15 — внутренние стены этого дома. Наружные берутся из слоёв стены в расчёте.',
      chips: [{ v: '10' }, { v: '12' }, { v: '15' }, { v: '20' }], def: String(Math.round(intT() * 100)),
      live: function (v) { var n = parseFloat(String(v).replace(',', '.')); return n >= 6 && n <= 60 ? 'Перегородки ' + n + ' см' : (v ? 'От 6 до 60 см' : ''); }
    }, function (v) {
      var n = parseFloat(String(v).replace(',', '.'));
      if (!(n >= 6 && n <= 60)) return;
      G.pushUndo('walls');
      G.DATA.floors[0].intT = Math.round(n) / 100;
      afterWallEdit(); G.refreshWallsUi(); G.draw();
    });
  };
  var GRID_M = 0.05;                       // шаг привязки к сетке, м
  var SNAP_PX = 10;                        // радиус привязки, экранные пиксели
  var MIN_LEN_M = 0.05;                    // короче — не стена

  var kind = 'ext';       // чем рисуем сейчас
  var start = null;       // начало текущего отрезка (цепочка стен)
  var chainStart = null;  // где началась цепочка: вернулись в эту точку - контур замкнут
  var chainN = 0;         // сколько стен в цепочке
  var hover = null;       // курсор после привязки: { p:[x,y], t:'end'|'body'|'grid' }
  var sel = -1;           // выбранная стена
  var typed = '';         // длина, набранная с клавиатуры
  var typedA = '';        // угол, набранный с клавиатуры (поле «Угол» у курсора, Tab переключает поля)
  var fieldA = false;     // активно поле угла
  var orthoOn = false;    // F8: ортогональность закреплена (Shift при этом её снимает)
  var objOn = true;       // F3: привязка к концам, серединам, перпендикуляру
  var drag = null;        // перетаскивание узла
  var swallow = 0;        // время конца перетаскивания: гасит клик после него
  var tool = 'wall';      // 'wall' | 'win' | 'door' - что ставит клик
  var selO = -1;          // выбранный проём
  var hoverO = null;      // проём-образец под курсором: { wid, o }
  var odrag = null;       // перетаскивание проёма вдоль стены
  var mdrag = null;       // перетаскивание всей стены поперёк себя: { i, raw0, base, moved }
  var hoverW = -1;        // стена под курсором у инструментов «Двигать» и «Размер»
  var chainOn = true;     // «Цепочка» как в Revit: следующий клик продолжает от конца прошлой стены
  var locMode = 'c';      // линия привязки: 'c' ось, 'o' наружная грань, 'i' внутренняя грань (клик идёт по грани, ось сдвигается на полтолщины)
  var locOffM = 0;        // «Смещение» из панели параметров, м: вправо по ходу рисования
  var locFlip = false;    // Пробел во время рисования меняет сторону
  var guides = [];        // пунктирные линии продолжения от узлов, которые показывает привязка
  var chainAxEnd = null;  // ось-конец последней стены цепочки (для пересчёта угла при линии привязки не по оси)
  var chainFirst = null;  // ось-начало первой стены цепочки
  var ohandle = null;     // растягивание выбранного проёма за конец: { end: 'a' | 'b', moved }
  // последние размеры, м: [ширина, высота, подоконник] - следующий проём такой же
  var SIZE = { win: [1.5, 1.4, 0.8], door: [0.9, 2.1, 0], gate: [2.5, 2.2, 0] };
  var gateMode = false;   // инструмент «Дверь» ставит гаражные ворота
  function curKind() { return tool === 'door' && gateMode ? 'gate' : tool; }

  function F() { return G.F(); }
  function ppm() { return F().pxPerM || 100; }
  function k() { return G.cs(); }
  function walls() { var f = F(); if (!f.walls) f.walls = []; return f.walls; }
  function ops() { var f = F(); if (!f.openings) f.openings = []; return f.openings; }
  function wallById(id) { var w = walls(); for (var i = 0; i < w.length; i++) if (w[i].id === id) return w[i]; return null; }
  function wlen(s) { return dist(s.a, s.b) / ppm(); }
  function nextOid() { var f = F(); f.openSeq = (f.openSeq || 0) + 1; return 'o' + f.openSeq; }
  /** Геометрия проёма: центр, единичный вдоль стены, нормаль, ширина и толщина стены в пикселях. */
  function opGeom(o) {
    var s = wallById(o.wid);
    if (!s) return null;
    var l = dist(s.a, s.b) || 1, ux = (s.b[0] - s.a[0]) / l, uy = (s.b[1] - s.a[1]) / l;
    var c = [s.a[0] + ux * o.o * ppm(), s.a[1] + uy * o.o * ppm()];
    return { s: s, c: c, ux: ux, uy: uy, nx: -uy, ny: ux, wpx: o.w * ppm(), t: thickPx(s) };
  }
  /** Убрать проёмы, чьей стены больше нет. */
  function pruneOps() {
    var ids = {};
    walls().forEach(function (s) { ids[s.id] = 1; });
    F().openings = ops().filter(function (o) { return ids[o.wid]; });
  }
  function nextId() { var f = F(); f.wallSeq = (f.wallSeq || 0) + 1; return 'w' + f.wallSeq; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function same(a, b) { return dist(a, b) < 0.5; }
  // Материалы стен: слово в диалоге -> название и цвет в 3D. Толщина у стены своя (w.t, м), иначе общая по типу.
  var WALL_MATS = [['газобетон', 'Газобетон', 0xe6e0d0], ['кирпич', 'Кирпич', 0xc98a6e], ['керамблок', 'Керамблок', 0xd8b898], ['брус', 'Брус', 0xd0a367],
    ['каркас', 'Каркас', 0xe4d5ba], ['бетон', 'Бетон', 0xbcc2c9], ['гипсокартон', 'Гипсокартон', 0xf2f2ee], ['пеноблок', 'Пеноблок', 0xe9e6dc]];
  // Утеплитель стены: слово в диалоге -> название. Толщина у стены своя (w.ins.t, м). Теплопроводность - в калькуляторе.
  var INS_MATS = [['пенополистирол', 'Пенополистирол'], ['пенопласт', 'Пенополистирол'], ['пеноплекс', 'XPS'], ['xps', 'XPS'], ['минват', 'Минвата'], ['мин.ват', 'Минвата'], ['вата', 'Минвата']];
  function wallT(w) { return w.t > 0.04 && w.t < 1.2 ? w.t : (w.k === 'int' ? intT() : extT()); }
  function thickPx(w) { return wallT(w) * ppm(); }

  /** Расстояние от точки до отрезка и ближайшая точка на нём. */
  function projOn(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    var t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    var q = [a[0] + dx * t, a[1] + dy * t];
    return { q: q, d: dist(p, q), t: t };
  }

  /** Стена под точкой (индекс) или -1. */
  function wallAt(p) {
    var best = -1, bd = 1e9, w = walls();
    for (var i = 0; i < w.length; i++) {
      var pr = projOn(p, w[i].a, w[i].b);
      var lim = Math.max(SNAP_PX / k() * 0.7, thickPx(w[i]) / 2);
      if (pr.d <= lim && pr.d < bd) { bd = pr.d; best = i; }
    }
    return best;
  }

  // ── привязка к подложке ─────────────────────────────────────────────
  // refMode: 'outer' - клики по наружной стене считаются внешней гранью, контур после замыкания сдвигается
  // внутрь на половину толщины (так комнаты сходятся с площадями плана); 'axis' - клики идут по оси стены.
  var refMode = 'outer';
  var imgSnapOn = true;   // прилипание к граням и углам стен на подложке (клавиша S)
  var chainPts = [], chainT = [], lastRaw = null;      // углы текущей цепочки (для сдвига контура)

  /**
   * Грани стен на подложке рядом с точкой p (пиксели плана). Грань - ровная линия перехода «тёмное/светлое»
   * длиной не меньше 0,4 м. Возвращает { x: [...], y: [...] } - координаты вертикальных и горизонтальных граней
   * (пиксели плана) в пределах радиуса r, и dark(axis, c, a0, a1) - доля тёмного между гранями.
   */
  function imageEdges(p, r) {
    var f = F(), mask = G.getMask ? G.getMask(G.cur) : null;
    if (!f.img || f.blank || !mask || !f.pxPerM) return null;
    var W = mask.w, H = mask.h, bar = mask.bar, mk = mask.k;
    var cx0 = Math.round(p[0] * mk), cy0 = Math.round(p[1] * mk);
    var R = Math.max(2, Math.round(r * mk)), L = Math.max(6, Math.round(0.8 * f.pxPerM * mk)), minRun = Math.max(4, Math.round(0.4 * f.pxPerM * mk));
    function scan(horiz) {
      var out = [], c0 = horiz ? cy0 : cx0, a0 = horiz ? cx0 : cy0, lim = horiz ? H : W, alim = horiz ? W : H;
      for (var c = Math.max(1, c0 - R); c <= Math.min(lim - 1, c0 + R); c++) {
        var run = 0, best = 0, gap = 0;
        for (var a = Math.max(0, a0 - L); a <= Math.min(alim - 1, a0 + L); a++) {
          var v1 = horiz ? bar[c * W + a] : bar[a * W + c], v0 = horiz ? bar[(c - 1) * W + a] : bar[a * W + c - 1];
          if (v1 !== v0) { run += 1 + gap; gap = 0; if (run > best) best = run; }
          else if (run && gap < 2) gap++;
          else { run = 0; gap = 0; }
        }
        if (best >= minRun) out.push(c);
      }
      // соседние строки одной грани (размытая граница) - в одну
      var res = [];
      out.forEach(function (c) { if (res.length && c - res[res.length - 1].hi <= 1) { res[res.length - 1].hi = c; } else res.push({ lo: c, hi: c }); });
      return res.map(function (g) { return (g.lo + g.hi) / 2 / mk; });
    }
    return { x: scan(false), y: scan(true), mk: mk, darkAt: function (x, y) { var ix = Math.round(x * mk), iy = Math.round(y * mk); return ix >= 0 && iy >= 0 && ix < W && iy < H ? bar[iy * W + ix] : 0; } };
  }

  /**
   * Привязка по одной оси: наружная грань (ближайшая) или, для оси стены, середина между двумя гранями
   * толщиной 7-65 см. v - координата курсора, list - грани, horiz - ось Y (горизонтальные грани).
   */
  function pickEdge(v, list, e, horiz, p, mid, r) {
    var best = null, bd = r;
    if (!mid) {
      list.forEach(function (c) { var d = Math.abs(c - v); if (d < bd) { bd = d; best = c; } });
      return best;
    }
    var pm = ppm();
    for (var i = 0; i + 1 < list.length; i++) {
      var g = (list[i + 1] - list[i]) / pm;
      if (g < 0.07 || g > 0.65) continue;
      var m = (list[i] + list[i + 1]) / 2;
      var dark = horiz ? e.darkAt(p[0], m) : e.darkAt(m, p[1]);
      if (!dark) continue;                       // между гранями пусто - это проём или комната, не тело стены
      var d2 = Math.abs(m - v);
      if (d2 < bd + (list[i + 1] - list[i]) / 2 && d2 < bd * 2) { bd = d2; best = m; }
    }
    return best;
  }

  /** Толщина стены на подложке у точки p, м: расстояние между двумя гранями с тёмным между ними (7-65 см). 0 - не нашли. */
  function measureT(p) {
    var e = imageEdges(p, 0.7 * ppm());
    if (!e) return 0;
    var pm = ppm(), best = 0, bd = 1e9;
    [[e.x, false], [e.y, true]].forEach(function (pr) {
      var list = pr[0], hz = pr[1], v = hz ? p[1] : p[0];
      for (var i = 0; i + 1 < list.length; i++) {
        var g = (list[i + 1] - list[i]) / pm;
        if (g < 0.07 || g > 0.65) continue;
        var m = (list[i] + list[i + 1]) / 2;
        if (!(hz ? e.darkAt(p[0], m) : e.darkAt(m, p[1]))) continue;
        var d = Math.min(Math.abs(list[i] - v), Math.abs(list[i + 1] - v));
        if (d < bd) { bd = d; best = g; }
      }
    });
    return best;
  }

  /** Привязка к подложке: { x, y } (одна или обе координаты) либо null. */
  function snapImage(p, kd) {
    if (!imgSnapOn) return null;
    var r = SNAP_PX * 1.6 / k(), e = imageEdges(p, r + 0.4 * ppm());
    if (!e) return null;
    var mid = !(kd === 'ext' && refMode === 'outer');
    var x = pickEdge(p[0], e.x, e, false, p, mid, r), y = pickEdge(p[1], e.y, e, true, p, mid, r);
    if (x === null && y === null) return null;
    return { x: x, y: y };
  }

  /**
   * Привязка точки: к узлу стены, к телу стены, к осям уже поставленных узлов,
   * к ортогонали от начала отрезка, затем к сетке 50 мм.
   */
  function snap(p, from, free, ortho) {
    var r = SNAP_PX / k(), w = walls(), i, best = null, bd = r;
    guides = [];
    if (!ortho && objOn) {
      for (i = 0; i < w.length; i++) {
        [w[i].a, w[i].b].forEach(function (e) {
          var d = dist(p, e);
          if (d < bd) { bd = d; best = e; }
        });
      }
      if (best) return { p: [best[0], best[1]], t: 'end' };
      if (!free) {
        // середина стены
        var bm = null; bd = r;
        for (i = 0; i < w.length; i++) {
          var mp = [(w[i].a[0] + w[i].b[0]) / 2, (w[i].a[1] + w[i].b[1]) / 2], dm = dist(p, mp);
          if (dm < bd && dist(w[i].a, w[i].b) > 4 * r) { bd = dm; bm = mp; }
        }
        if (bm) return { p: bm, t: 'mid' };
        // перпендикуляр из начала отрезка к стене
        if (from) {
          var bpp = null; bd = r * 1.3;
          for (i = 0; i < w.length; i++) {
            var pr0 = projOn(from, w[i].a, w[i].b);
            if (pr0.t <= 0.001 || pr0.t >= 0.999 || pr0.d < 2) continue;
            var dp = dist(p, pr0.q);
            if (dp < bd) { bd = dp; bpp = pr0.q; }
          }
          if (bpp) return { p: [bpp[0], bpp[1]], t: 'perp' };
        }
      }
    }
    var x = p[0], y = p[1], locked = null, imgX = false, imgY = false;
    var is = (free || ortho) ? null : snapImage(p, kind);
    // ортогональ от начала отрезка: по оси, к которой направление ближе чем на 6° (с Shift - всегда, как в Revit)
    if (from && !free) {
      var ang = Math.atan2(y - from[1], x - from[0]) * 180 / Math.PI;
      var m = ((ang % 90) + 90) % 90;
      if (ortho || m < 6 || m > 84) {
        if (Math.abs(x - from[0]) > Math.abs(y - from[1])) { y = from[1]; locked = 'h'; } else { x = from[0]; locked = 'v'; }
      }
    }
    if (ortho) { var gg = GRID_M * ppm(); return { p: locked === 'h' ? [Math.round(x / gg) * gg, y] : [x, Math.round(y / gg) * gg], t: 'ortho' }; }
    if (is) {
      if (is.x !== null && locked !== 'v') { x = is.x; imgX = true; }
      if (is.y !== null && locked !== 'h') { y = is.y; imgY = true; }
      if (imgX && imgY) return { p: [x, y], t: 'img' };
    }
    // тело стены: при ортогонали — пересечение с линией, иначе проекция; вдоль осевой стены — на сетку
    if (!free && !imgX && !imgY) {
      var bb = null, g0 = GRID_M * ppm();
      bd = r;
      for (i = 0; i < w.length; i++) {
        var s0 = w[i], q = null, dx0 = s0.b[0] - s0.a[0], dy0 = s0.b[1] - s0.a[1];
        if (locked === 'v' && Math.abs(dx0) > 1e-6) { var tv = (x - s0.a[0]) / dx0; if (tv > 0 && tv < 1) q = [x, s0.a[1] + dy0 * tv]; }
        else if (locked === 'h' && Math.abs(dy0) > 1e-6) { var th = (y - s0.a[1]) / dy0; if (th > 0 && th < 1) q = [s0.a[0] + dx0 * th, y]; }
        else if (!locked) { var pr = projOn([x, y], s0.a, s0.b); if (pr.t > 0 && pr.t < 1) q = pr.q; }
        if (!q) continue;
        var dd = dist([x, y], q);
        if (dd < bd) {
          bd = dd; bb = q;
          if (!locked) {
            if (Math.abs(dy0) < 1e-6) bb = [Math.round(q[0] / g0) * g0, q[1]];
            else if (Math.abs(dx0) < 1e-6) bb = [q[0], Math.round(q[1] / g0) * g0];
          }
        }
      }
      if (bb) return { p: [bb[0], bb[1]], t: 'body' };
    }
    // оси узлов: ровно напротив уже стоящего угла
    if (!free) {
      var ax = null, ay = null, dxm = r, dym = r, axN = null, ayN = null;
      for (i = 0; i < w.length; i++) {
        [w[i].a, w[i].b].forEach(function (e) {
          if (Math.abs(e[0] - x) < dxm) { dxm = Math.abs(e[0] - x); ax = e[0]; axN = e; }
          if (Math.abs(e[1] - y) < dym) { dym = Math.abs(e[1] - y); ay = e[1]; ayN = e; }
        });
      }
      if (ax !== null && locked !== 'v' && !imgX) { x = ax; guides.push([axN, [ax, y]]); }
      if (ay !== null && locked !== 'h' && !imgY) { y = ay; guides.push([ayN, [x, ay]]); }
    }
    var g = GRID_M * ppm();
    if (!imgX && !(from && !free && (x === from[0]))) x = Math.round(x / g) * g;
    if (!imgY && !(from && !free && (y === from[1]))) y = Math.round(y / g) * g;
    return { p: [x, y], t: (imgX || imgY) ? 'edge' : 'grid' };
  }

  /** Разрезать стены, у которых точка лежит внутри (Т-узел), чтобы в узле сходились концы. */
  function splitAt(pt) {
    var w = walls(), out = [], tol = 1.5;
    w.forEach(function (s) {
      var pr = projOn(pt, s.a, s.b);
      if (pr.d < tol && dist(pt, s.a) > tol && dist(pt, s.b) > tol) {
        var nid2 = nextId(), l1 = dist(s.a, pt) / ppm();
        out.push({ id: s.id, a: s.a, b: [pt[0], pt[1]], k: s.k });
        out.push({ id: nid2, a: [pt[0], pt[1]], b: s.b, k: s.k });
        // проёмы за точкой разреза переезжают на вторую половину
        ops().forEach(function (o) { if (o.wid === s.id && o.o > l1) { o.wid = nid2; o.o = Math.round((o.o - l1) * 1000) / 1000; } });
      } else out.push(s);
    });
    F().walls = out;
  }

  function addWall(a, b, kd) {
    if (dist(a, b) / ppm() < MIN_LEN_M) return false;
    G.pushUndo('walls');
    var w = walls();
    w.push({ id: nextId(), a: [a[0], a[1]], b: [b[0], b[1]], k: kd });
    splitAt(a); splitAt(b);
    // концы новой стены, лежащие на чужих стенах, режут и её саму
    var cur = walls();
    cur.slice().forEach(function (s) {
      cur.slice().forEach(function (o) {
        if (o === s) return;
        [o.a, o.b].forEach(function (e) {
          var pr = projOn(e, s.a, s.b);
          if (pr.d < 1.5 && dist(e, s.a) > 1.5 && dist(e, s.b) > 1.5) splitAt(e);
        });
      });
    });
    return true;
  }

  function fmtM(px) { return (Math.round(px / ppm() * 100) / 100).toFixed(2).replace('.', ','); }

  /** Длина, набранная с клавиатуры, в метрах: 760 — сантиметры, 2600 — мм, 2,6м — метры (как на шаге «Масштаб»). */
  function parseLen(s) { return G.parseScaleLen ? G.parseScaleLen(s) : 0; }

  function endpointAt(p) {
    var r = SNAP_PX / k() * 1.2, w = walls();
    for (var i = 0; i < w.length; i++) {
      if (dist(p, w[i].a) < r) return w[i].a;
      if (dist(p, w[i].b) < r) return w[i].b;
    }
    return null;
  }


  /**
   * Контур нарисован по внешнему краю стены: ось стены лежит на половину толщины внутрь. Каждую сторону сдвигаем
   * внутрь, углы пересчитываем; концы других стен, стоявшие на старых сторонах, переезжают вместе с ними.
   */
  function shiftContourInward(P, sgn, tm) {
    if (tm > 0) { var fl = G.DATA && G.DATA.floors && G.DATA.floors[0]; if (fl) fl.extT = tm; }
    var n = P.length, i, h = (sgn || 1) * extT() * ppm() / 2;
    if (n < 3 || !h) return false;
    var area = polyArea(P), sg = area > 0 ? 1 : -1;
    if (h < 0) { /* наружу: нормаль внутрь та же, сдвиг отрицательный */ }
    if (Math.abs(area) < 1) return false;
    var D = [], N = [];
    for (i = 0; i < n; i++) {
      var a = P[i], b = P[(i + 1) % n], l = dist(a, b) || 1, dx = (b[0] - a[0]) / l, dy = (b[1] - a[1]) / l;
      D.push([dx, dy]);
      N.push([-dy * sg * -1, dx * sg * -1]);   // внутрь: для площади > 0 (по часовой в экранных осях) нормаль (dy, -dx) смотрит внутрь
    }
    // нормаль внутрь проверяем на точке: середина стороны + нормаль должна лежать внутри контура
    var m0 = [(P[0][0] + P[1][0]) / 2 + N[0][0] * 2, (P[0][1] + P[1][1]) / 2 + N[0][1] * 2];
    if (!inside(m0, P)) for (i = 0; i < n; i++) N[i] = [-N[i][0], -N[i][1]];
    var V = [];
    for (i = 0; i < n; i++) {
      var q = (i - 1 + n) % n, o1 = [P[i][0] + N[q][0] * h, P[i][1] + N[q][1] * h], o2 = [P[i][0] + N[i][0] * h, P[i][1] + N[i][1] * h];
      var den = D[q][0] * D[i][1] - D[q][1] * D[i][0];
      if (Math.abs(den) < 1e-6) { V.push(o2); continue; }
      var t = ((o2[0] - o1[0]) * D[i][1] - (o2[1] - o1[1]) * D[i][0]) / den;
      V.push([o1[0] + D[q][0] * t, o1[1] + D[q][1] * t]);
    }
    G.pushUndo('walls');
    function mapPt(e) {
      for (var j = 0; j < n; j++) if (dist(e, P[j]) < 1.5) return V[j].slice();
      for (j = 0; j < n; j++) {
        var pr = projOn(e, P[j], P[(j + 1) % n]);
        if (pr.d < 1.5) return [e[0] + N[j][0] * h, e[1] + N[j][1] * h];
      }
      return null;
    }
    walls().forEach(function (w) {
      var oa = w.a, na = mapPt(w.a), nb = mapPt(w.b), l = dist(w.a, w.b) || 1;
      var ux = (w.b[0] - w.a[0]) / l, uy = (w.b[1] - w.a[1]) / l;
      if (na) { var sh = ((na[0] - oa[0]) * ux + (na[1] - oa[1]) * uy) / ppm(); ops().forEach(function (o) { if (o.wid === w.id) o.o = Math.round((o.o - sh) * 1000) / 1000; }); }
      if (na) w.a = [r1(na[0]), r1(na[1])];
      if (nb) w.b = [r1(nb[0]), r1(nb[1])];
    });
    afterWallEdit();
    return true;
  }

  function sampleT(a, b) { if (locMode === 'c' && kind === 'ext' && refMode === 'outer' && imgSnapOn && dist(a, b) > 0.8 * ppm()) { var t = measureT([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); if (t) chainT.push(t); } }
  function median(a) { if (!a.length) return 0; a = a.slice().sort(function (p, q) { return p - q; }); return a[Math.floor(a.length / 2)]; }
  function hasImg() { var f = F(); return !!(f.img && !f.blank); }
  function hintWall(s) { if (G.hint) G.hint(s); }

  function updateHint() {
    if (G.mode !== 'wall') return;
    var kn = kind === 'ext' ? 'наружная' : 'внутренняя';
    if (tool === 'move') { hintWall('Двигать: потяните стену мышью поперёк - примыкающие стены растянутся, площади пересчитаются.'); return; }
    if (tool === 'size') { hintWall('Размер: клик по стене - длина, клик по комнате - ширина и глубина (с пересчётом площади).'); return; }
    if (tool !== 'wall') {
      var nm = tool === 'win' ? 'окно' : (gateMode ? 'ворота' : 'дверь'), z = SIZE[curKind()];
      hintWall('Клик по стене - поставить ' + nm + ' (' + fm2(z[0]) + ' x ' + fm2(z[1]) + ' м). Проём можно тянуть вдоль стены; ' +
        'Shift+клик - выбрать, Enter - размеры, Delete - убрать.');
      return;
    }
    if (start) {
      hintWall('Стена (' + kn + '). Клик — следующий угол. Закончить: двойной клик, правая кнопка мыши или Enter. ' +
        'Длину можно набрать цифрами и нажать Enter' + (typed ? ': <b>' + typed + '</b>' : '') + '.');
    } else {
      hintWall('Клик — начать стену (' + kn + '). ' + (hasImg() ? (kind === 'ext' && refMode === 'outer' ? 'Кликайте по ВНЕШНЕМУ краю стены на плане: углы прилипают сами (голубой кружок), после замыкания контур сдвинется внутрь на половину толщины. ' : 'Кликайте по оси стены: грани на плане прилипают к середине. ') + 'S - прилипание ' + (imgSnapOn ? 'вкл' : 'выкл') + ', Alt - без прилипания. ' : '') + 'Shift+клик по стене — выбрать: T сменит тип, Delete уберёт. ' +
        'Узел можно тянуть мышью.');
    }
  }

  // ── линия привязки и цепочка (как в Revit) ─────────────────────────
  var lastShift = false;
  /** Сдвиг оси от кликнутой линии, пкс: вправо по ходу рисования - для наружной грани (по часовой наружная сторона слева), влево - для внутренней. */
  function locD() { return (locMode === 'c' ? 0 : (locMode === 'o' ? 1 : -1) * (locFlip ? -1 : 1) * thickPx({ k: kind }) / 2) + locOffM * ppm(); }
  function offSeg(P, Q, d) {
    var l = dist(P, Q) || 1, ux = (Q[0] - P[0]) / l, uy = (Q[1] - P[1]) / l;
    return [[P[0] - uy * d, P[1] + ux * d], [Q[0] - uy * d, Q[1] + ux * d]];
  }
  function lineInter(a1, a2, b1, b2) {
    var rx = a2[0] - a1[0], ry = a2[1] - a1[1], sx = b2[0] - b1[0], sy = b2[1] - b1[1], den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-6) return null;
    var t = ((b1[0] - a1[0]) * sy - (b1[1] - a1[1]) * sx) / den;
    return [a1[0] + rx * t, a1[1] + ry * t];
  }
  /** Поставить стену из клика P в клик Q с учётом линии привязки; в узле цепочки оси сходятся углом. */
  function commitSeg(P, Q) {
    var d = locD();
    if (!d) { chainAxEnd = null; return addWall(P, Q, kind); }
    var cs2 = offSeg(P, Q, d), A = cs2[0], B = cs2[1];
    if (chainAxEnd && chainPts.length >= 2) {
      var P0 = chainPts[chainPts.length - 2], pv = offSeg(P0, P, d), V = lineInter(pv[0], pv[1], A, B);
      if (V && dist(V, P) < 6 * Math.abs(d) + 1) { moveNode(chainAxEnd, V); A = V; }
    }
    var ok = addWall(A, B, kind);
    if (ok) { if (!chainFirst) chainFirst = A.slice(); chainAxEnd = B.slice(); }
    return ok;
  }
  /** Контур замкнулся: первый и последний углы сходятся по пересечению осей. */
  function fixLoopCorner() {
    var n = chainPts.length, d = locD();
    if (n < 4 || !chainAxEnd || !chainFirst || !d) return;
    var pl = offSeg(chainPts[n - 2], chainPts[n - 1], d), pf = offSeg(chainPts[0], chainPts[1], d), V = lineInter(pl[0], pl[1], pf[0], pf[1]);
    if (!V || dist(V, chainPts[0]) > 6 * Math.abs(d) + 1) return;
    var e0 = chainAxEnd.slice(), f0 = chainFirst.slice();
    moveNode(e0, V); moveNode(f0, V);
  }
  /** Без «Цепочки» каждая стена отдельная: после клика рисование заканчивается. */
  function endChain() { start = null; chainStart = null; hover = null; typed = ''; typedA = ''; fieldA = false; chainPts = []; chainAxEnd = null; chainFirst = null; }

  function fm2(x) { return String(Math.round(x * 100) / 100).replace('.', ','); }
  /** Вернулись в начало цепочки - контур замкнут: линия-предпросмотр гаснет, стену дальше не тянем. */
  function closeIfLoop() {
    if (start && chainStart && chainN >= 3 && dist(start, chainStart) < 3) {
      var tMed = median(chainT), tm = chainT.length >= 2 && Math.abs(tMed - extT()) > 0.02 ? Math.round(tMed * 100) / 100 : 0;
      var shifted = locMode === 'c' && kind === 'ext' && refMode === 'outer' && shiftContourInward(chainPts.slice(0, -1), 1, tm);
      if (locMode !== 'c') fixLoopCorner();
      start = null; chainStart = null; hover = null; typed = ''; typedA = ''; fieldA = false; chainPts = []; chainAxEnd = null; chainFirst = null;
      hintWall('<span class=ok>Контур замкнут.</span> ' + (shifted ? 'Линия шла по внешнему краю стены - контур сдвинут внутрь на ' + fm2(extT() * 500) + ' см (половина толщины ' + fm2(extT() * 100) + ' см' + (tm ? ', снята с плана' : '') + '), комнаты сойдутся с планом. ' : '') +
        'Можно ставить окна и двери или нажать «Комнаты из стен».');
    }
  }
  /** Закончить стену (кнопка, правая кнопка мыши, Enter, двойной клик). В полноэкранном режиме Esc это не делает: его забирает браузер. */
  G.wallsFinish = function () { start = null; chainStart = null; chainAxEnd = null; chainFirst = null; typed = ''; typedA = ''; fieldA = false; hover = null; updateHint(); G.refreshWallsUi(); G.draw(); };
  G.wallsDrawing = function () { return !!start; };
  G.__wallsDbg = function () { return { start: start, chainStart: chainStart, chainN: chainN }; };
  // браузер выходит из полного экрана по Esc сам и не даёт этого перехватить - тянущуюся стену при этом снимаем
  document.addEventListener('fullscreenchange', function () { if (start) G.wallsFinish(); });
  function reset() { start = null; hover = null; typed = ''; typedA = ''; fieldA = false; drag = null; updateHint(); }

  // ── проверка разметки: что на подложке ещё не обведено, где контур разорван ──────────
  var uShow = 'both';      // что видно на шаге «Стены»: 'both' | 'marks' (только разметка) | 'under' (только план)
  var uDim = 0.5;          // насколько подложка приглушена, 0..0.9
  var showUncov = true;    // штриховка необведённых стен
  var focusPt = null;      // место, к которому послали кнопкой «К проблеме»: кольцо мигает пару секунд
  var issueI = -1;
  try { var sv0 = parseFloat(localStorage.getItem('heatcalc_wall_underdim')); if (sv0 >= 0 && sv0 <= 0.9) uDim = sv0; } catch (e) { }

  var cov = { key: '', mask: null, res: null };
  function covKey() {
    return G.cur + '|' + ppm() + '|' + extT() + '|' + intT() + '|' + (F().walls || []).map(function (s) {
      return [s.k, Math.round(s.a[0]), Math.round(s.a[1]), Math.round(s.b[0]), Math.round(s.b[1]), s.t || 0].join(',');
    }).join(';');
  }
  /**
   * Что на подложке похоже на стену, но не покрыто разметкой. Берём тёмную маску плана, убираем тонкое
   * (размерные линии, мебель, цифры), вычитаем нарисованные стены с запасом ±10 см и оставляем куски
   * не меньше 0,04 м². Результат кэшируется по набору стен; пока тянут узел - отдаём прошлый.
   * { n, pct, spots:[[x,y]...], keep, W, H, hd } - hd: холст штриховки по размеру экрана.
   */
  function coverage(stale) {
    var f = F();
    if (!(f.img && !f.blank) || !f.pxPerM) return null;
    if (stale && cov.res) return cov.res;
    var mask = G.getMask ? G.getMask(G.cur) : null;
    if (!mask) return null;
    var key = covKey();
    if (cov.res && cov.key === key && cov.mask === mask) return cov.res;
    var W = mask.w, H = mask.h, mk = mask.k, N = W * H, i;
    var bar = new Uint8Array(mask.bar);
    if (window.openThin) { try { window.openThin(bar, W, H, ppm() * mk); } catch (e) { } }
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    g.strokeStyle = '#000'; g.lineCap = 'square';
    (f.walls || []).forEach(function (s) {
      g.lineWidth = (thickPx(s) + 0.2 * ppm()) * mk;
      g.beginPath(); g.moveTo(s.a[0] * mk, s.a[1] * mk); g.lineTo(s.b[0] * mk, s.b[1] * mk); g.stroke();
    });
    var d = g.getImageData(0, 0, W, H).data;
    var unc = new Uint8Array(N), covered = 0;
    for (i = 0; i < N; i++) {
      if (!bar[i]) continue;
      if (d[i * 4 + 3] > 40) covered++; else unc[i] = 1;
    }
    // связные куски (4 соседа), мелочь отбрасываем
    var pm = ppm() * mk, minA = Math.max(12, Math.round(0.04 * pm * pm));
    var keep = new Uint8Array(N), seen = new Uint8Array(N), stack = new Int32Array(N), spots = [], kept = 0, nComp = 0;
    for (i = 0; i < N; i++) {
      if (!unc[i] || seen[i]) continue;
      var sp = 0, cnt = 0, sx = 0, sy = 0, members = [];
      stack[sp++] = i; seen[i] = 1;
      while (sp) {
        var q = stack[--sp], qx = q % W, qy = (q - qx) / W;
        members.push(q); cnt++; sx += qx; sy += qy;
        if (qx > 0 && unc[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[sp++] = q - 1; }
        if (qx < W - 1 && unc[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[sp++] = q + 1; }
        if (qy > 0 && unc[q - W] && !seen[q - W]) { seen[q - W] = 1; stack[sp++] = q - W; }
        if (qy < H - 1 && unc[q + W] && !seen[q + W]) { seen[q + W] = 1; stack[sp++] = q + W; }
      }
      if (cnt < minA) continue;
      for (var m = 0; m < members.length; m++) keep[members[m]] = 1;
      kept += cnt; nComp++; spots.push([sx / cnt / mk, sy / cnt / mk, cnt]);
    }
    spots.sort(function (a, b) { return b[2] - a[2]; });
    var res = { n: nComp, pct: covered + kept > 0 ? Math.round(100 * covered / (covered + kept)) : 100, spots: spots.map(function (s) { return [s[0], s[1]]; }), keep: keep, W: W, H: H, hd: null };
    cov.key = key; cov.mask = mask; cov.res = res;
    return res;
  }
  /** Холст штриховки по размеру экрана: красные полосы только там, где стена на плане не обведена. */
  function hatchCanvas(res) {
    var cw = G.cv.width, ch = G.cv.height;
    if (res.hd && res.hd.width === cw && res.hd.height === ch) return res.hd;
    var sm = document.createElement('canvas'); sm.width = res.W; sm.height = res.H;
    var sg = sm.getContext('2d'), im = sg.createImageData(res.W, res.H);
    for (var i = 0; i < res.keep.length; i++) if (res.keep[i]) { im.data[i * 4] = 239; im.data[i * 4 + 1] = 68; im.data[i * 4 + 2] = 68; im.data[i * 4 + 3] = 255; }
    sg.putImageData(im, 0, 0);
    var pt = document.createElement('canvas'); pt.width = 10; pt.height = 10;
    var pg = pt.getContext('2d');
    pg.fillStyle = 'rgba(239,68,68,.30)'; pg.fillRect(0, 0, 10, 10);
    pg.strokeStyle = 'rgba(220,38,38,.95)'; pg.lineWidth = 2.5; pg.beginPath();
    pg.moveTo(0, 10); pg.lineTo(10, 0); pg.moveTo(-1, 1); pg.lineTo(1, -1); pg.moveTo(9, 11); pg.lineTo(11, 9); pg.stroke();
    var hd = document.createElement('canvas'); hd.width = cw; hd.height = ch;
    var hg = hd.getContext('2d');
    hg.imageSmoothingEnabled = true; hg.drawImage(sm, 0, 0, cw, ch);
    hg.globalCompositeOperation = 'source-in';
    hg.fillStyle = hg.createPattern(pt, 'repeat'); hg.fillRect(0, 0, cw, ch);
    res.hd = hd;
    return hd;
  }
  /** Свободные концы стен: к ним не подходит ни одна другая стена. Там контур не замкнут и комната из стен не получится. */
  function looseEnds() {
    var w = walls(), out = [], tol = 0.12 * ppm();
    w.forEach(function (s, i) {
      [s.a, s.b].forEach(function (e) {
        for (var j = 0; j < w.length; j++) {
          if (j === i) continue;
          var o = w[j];
          if (dist(e, o.a) < tol || dist(e, o.b) < tol || projOn(e, o.a, o.b).d < Math.max(tol, thickPx(o) / 2)) return;
        }
        out.push(e);
      });
    });
    return out;
  }
  /** Итог проверки: { gaps, unc, pct (null без подложки), list:[{p,t:'gap'|'unc'}] } */
  G.wallsIssues = function () {
    var gaps = looseEnds(), c = coverage(false), list = gaps.map(function (p) { return { p: p, t: 'gap' }; });
    if (c) c.spots.forEach(function (s) { list.push({ p: s, t: 'unc' }); });
    return { gaps: gaps.length, unc: c ? c.n : 0, pct: c ? c.pct : null, list: list };
  };
  function focusAt(p) {
    focusPt = { p: p, t: Date.now() };
    try {
      var cv = G.cv, box = cv.parentNode, cr = cv.getBoundingClientRect(), br = box.getBoundingClientRect();
      var rk = cr.width / cv.width, x = cr.left + p[0] * k() * rk, y = cr.top + p[1] * k() * rk;
      box.scrollLeft += x - (br.left + box.clientWidth / 2); box.scrollTop += y - (br.top + box.clientHeight / 2);
    } catch (e) { }
    G.draw();
    var n = 0, iv = setInterval(function () { n++; G.draw(); if (n > 10) { clearInterval(iv); focusPt = null; G.draw(); } }, 200);
  }
  G.wallsNextIssue = function () {
    var it = G.wallsIssues().list;
    if (!it.length) { hintWall('Разрывов и необведённых стен не найдено.'); return; }
    issueI = (issueI + 1) % it.length;
    var q = it[issueI];
    hintWall(q.t === 'gap' ? 'Здесь стена никуда не приходит: контур разорван, комната из стен не соберётся. Дотяните стену до соседней.' : 'Здесь на плане стена, а разметки нет: обведите её или оставьте, если это не стена.');
    focusAt(q.p);
  };
  G.wallsViewCycle = function () {
    uShow = uShow === 'both' ? 'marks' : uShow === 'marks' ? 'under' : 'both';
    hintWall(uShow === 'both' ? 'Видно всё: приглушённый план и разметка.' : uShow === 'marks' ? 'Видна только разметка. Клавиша U - дальше.' : 'Виден только план, без разметки. Клавиша U - вернуть.');
    G.refreshWallsUi(); G.draw();
  };
  G.wallsViewGet = function () { return uShow; };
  G.wallsUnder = function (v) {
    uDim = Math.max(0, Math.min(0.9, (parseFloat(v) || 0) / 100));
    try { localStorage.setItem('heatcalc_wall_underdim', String(uDim)); } catch (e) { }
    if (uShow !== 'both') uShow = 'both';
    var l = document.getElementById('wl_dimv'); if (l) l.textContent = Math.round(uDim * 100) + ' %';
    G.draw();
  };
  G.wallsUncovToggle = function () { showUncov = !showUncov; G.refreshWallsUi(); G.draw(); };
  /** Легенда и итоги проверки для панели шага «Стены». */
  G.wallsLegendHtml = function () {
    var f = F(), over = !!(f.img && !f.blank), is = G.wallsIssues();
    var sw = function (bg, extra) { return '<i style="display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:5px;vertical-align:-2px;background:' + bg + ';' + (extra || '') + '"></i>'; };
    var bs = 'display:inline-block;width:auto;padding:3px 9px;margin:3px 4px 0 0;font-size:12px;';
    var h = '<div style="margin-top:8px;font-size:12px;line-height:1.7">' +
      '<span style="margin-right:10px;white-space:nowrap">' + sw('#fbbf24') + 'Наружная</span>' +
      '<span style="margin-right:10px;white-space:nowrap">' + sw('#34d399') + 'Внутренняя</span>' +
      (over ? '<span style="margin-right:10px;white-space:nowrap">' + sw('repeating-linear-gradient(135deg,#ef4444 0 2px,rgba(239,68,68,.25) 2px 4px)') + 'Не обведено</span>' : '') +
      '<span style="white-space:nowrap">' + sw('transparent', 'border:2px solid #ef4444;border-radius:50%;box-sizing:border-box') + 'Разрыв</span>';
    var ok = !is.gaps && !is.unc;
    h += '<div style="margin-top:4px"><b style="color:' + (ok ? '#22c55e' : '#f87171') + '">' +
      (is.pct !== null ? 'Обведено ' + is.pct + ' %' : (walls().length ? 'Стен: ' + walls().length : '')) + '</b>' +
      (is.pct !== null ? ' · необведённых участков: ' + is.unc : '') + ' · разрывов: ' + is.gaps + '</div>';
    h += '<div>' + (is.list.length ? '<button type="button" style="' + bs + '" onclick="wallsNextIssue()">К проблеме →</button>' : '') +
      '<button type="button" style="' + bs + '" onclick="wallsViewCycle()">' + (uShow === 'both' ? 'Только разметка' : uShow === 'marks' ? 'Только план' : 'Всё вместе') + ' (U)</button>' +
      (over ? '<button type="button" style="' + bs + '" onclick="wallsUncovToggle()">Штриховка: ' + (showUncov ? 'да' : 'нет') + '</button>' : '') + '</div>';
    if (over) h += '<div style="margin-top:3px">План бледнее <input type="range" min="0" max="90" step="5" value="' + Math.round(uDim * 100) + '" oninput="wallsUnder(this.value)" style="vertical-align:middle;width:110px"> <span id="wl_dimv">' + Math.round(uDim * 100) + ' %</span></div>';
    return h + '</div>';
  };

  // ── рисование ───────────────────────────────────────────────────────
  var COL = {
    ext: ['#c9d3e6', '#2f3b52'], int: ['#8f9bb3', '#516078']   // [тёмный лист, светлый лист]
  };
  function wallsDraw() {
    var f = F(), cx = G.cx, kk = k(), w = f.walls;
    if (!f || (f.img && !G.imgCache[G.cur])) return;
    if (!(w && w.length) && !(G.mode === 'wall' && (start || hover))) return;
    var dark = G.darkPlan ? 0 : 1;
    cx.save();
    var inWall = G.mode === 'wall', overImg0 = !!(f.img && !f.blank);
    var stale = !!(drag || mdrag || odrag || ohandle);
    if (inWall && overImg0) {
      // план приглушаем, чтобы разметка читалась поверх него; «только разметка» глушит план полностью
      var da = uShow === 'marks' ? 1 : (uShow === 'under' ? 0 : uDim);
      if (da > 0) { cx.fillStyle = G.darkPlan ? 'rgba(30,30,30,' + da + ')' : 'rgba(255,255,255,' + da + ')'; cx.fillRect(0, 0, G.cv.width, G.cv.height); }
      if (uShow !== 'both') {
        cx.font = 'bold 13px system-ui'; cx.textAlign = 'left'; cx.textBaseline = 'middle';
        var bt = uShow === 'marks' ? 'Только разметка (U)' : 'Только план (U)', bw = cx.measureText(bt).width + 16;
        cx.fillStyle = 'rgba(15,23,42,.85)'; cx.fillRect(10, 10, bw, 26); cx.fillStyle = '#fbbf24'; cx.fillText(bt, 18, 23);
      }
      if (uShow === 'under') { cx.restore(); return; }
      // необведённые стены подложки - красная штриховка
      var cv0 = showUncov ? coverage(stale) : null;
      if (cv0 && cv0.n) cx.drawImage(hatchCanvas(cv0), 0, 0);
    }
    // узлы, к которым подходит больше одной стены: углы дорисовываем квадратом, чтобы не было зазубрин
    var cnt = {};
    (w || []).forEach(function (s) {
      [s.a, s.b].forEach(function (e) { var key = Math.round(e[0]) + ',' + Math.round(e[1]); cnt[key] = (cnt[key] || 0) + 1; });
    });
    // Поверх подложки стена - полупрозрачная заливка с яркой кромкой: план под ней виден. На пустом листе - плотная.
    var overImg = !!(f.img && !f.blank);
    // Цвета не сливаются с планом (серый) и с окнами (синий): наружные жёлтые, внутренние зелёные, красный - «не обведено» и разрыв.
    // Вне шага «Стены» стены лишь намечены тонкой линией.
    var quiet = G.mode !== 'wall';
    var FILL_IMG = quiet ? { ext: 'rgba(251,191,36,0.10)', int: 'rgba(52,211,153,0.08)' } : { ext: 'rgba(251,191,36,0.50)', int: 'rgba(52,211,153,0.48)' },
      EDGE_IMG = quiet ? { ext: 'rgba(251,191,36,0.55)', int: 'rgba(52,211,153,0.55)' } : { ext: '#fbbf24', int: '#34d399' };
    (w || []).forEach(function (s, i) {
      var t = thickPx(s), dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l = Math.hypot(dx, dy) || 1;
      var ux = dx / l, uy = dy / l, nx = -uy, ny = ux, h = t / 2;
      var ea = cnt[Math.round(s.a[0]) + ',' + Math.round(s.a[1])] > 1 ? h : 0;
      var eb = cnt[Math.round(s.b[0]) + ',' + Math.round(s.b[1])] > 1 ? h : 0;
      // стена кусками между проёмами: в самом проёме стены нет, видна подложка
      var L0 = -ea, L1 = l + eb, cuts = ops().filter(function (o) { return o.wid === s.id; }).map(function (o) {
        return [o.o * ppm() - o.w * ppm() / 2, o.o * ppm() + o.w * ppm() / 2];
      }).sort(function (p, q) { return p[0] - q[0]; });
      var pieces = [], at = L0;
      cuts.forEach(function (c) { if (c[0] > at) pieces.push([at, Math.min(c[0], L1)]); at = Math.max(at, c[1]); });
      if (at < L1) pieces.push([at, L1]);
      var kk2 = s.k === 'int' ? 'int' : 'ext';
      pieces.forEach(function (pc) {
        var A = [s.a[0] + ux * pc[0], s.a[1] + uy * pc[0]], B = [s.a[0] + ux * pc[1], s.a[1] + uy * pc[1]];
        cx.beginPath();
        cx.moveTo((A[0] + nx * h) * kk, (A[1] + ny * h) * kk);
        cx.lineTo((B[0] + nx * h) * kk, (B[1] + ny * h) * kk);
        cx.lineTo((B[0] - nx * h) * kk, (B[1] - ny * h) * kk);
        cx.lineTo((A[0] - nx * h) * kk, (A[1] - ny * h) * kk);
        cx.closePath();
        if (overImg && !quiet) { cx.lineWidth = 4; cx.strokeStyle = 'rgba(0,0,0,.55)'; cx.stroke(); }   // тёмная обводка: разметка видна на любом фоне
        cx.fillStyle = overImg ? FILL_IMG[kk2] : ((G.rvWallFill && G.rvWallFill(cx, kk2, dark)) || COL[kk2][dark]);
        cx.globalAlpha = overImg ? 1 : 0.92; cx.fill(); cx.globalAlpha = 1;
        cx.lineWidth = i === sel ? 3 : (overImg ? (quiet ? 1 : 2) : 1);
        cx.strokeStyle = i === sel ? '#ffffff' : (overImg ? EDGE_IMG[kk2] : (dark ? '#1f2937' : '#0b1220'));
        cx.stroke();
      });
    });
    // стена под курсором у «Двигать» и «Размер»
    if (G.mode === 'wall' && (tool === 'move' || tool === 'size' || (tool === 'wall' && !start)) && hoverW >= 0 && w && w[hoverW]) {
      var hs = w[hoverW], ht = thickPx(hs) / 2 + 2, hl = Math.hypot(hs.b[0] - hs.a[0], hs.b[1] - hs.a[1]) || 1;
      var hnx = -(hs.b[1] - hs.a[1]) / hl, hny = (hs.b[0] - hs.a[0]) / hl;
      cx.beginPath();
      cx.moveTo((hs.a[0] + hnx * ht) * kk, (hs.a[1] + hny * ht) * kk); cx.lineTo((hs.b[0] + hnx * ht) * kk, (hs.b[1] + hny * ht) * kk);
      cx.lineTo((hs.b[0] - hnx * ht) * kk, (hs.b[1] - hny * ht) * kk); cx.lineTo((hs.a[0] - hnx * ht) * kk, (hs.a[1] - hny * ht) * kk);
      cx.closePath(); cx.lineWidth = 2; cx.strokeStyle = '#f5f5f5'; cx.setLineDash([5, 4]); cx.stroke(); cx.setLineDash([]);
    }
    // узлы: углы, где стены сошлись, - белые точки; свободные концы - красные кольца (контур разорван)
    if (inWall && w && w.length) {
      var seenN = {};
      w.forEach(function (s) {
        [s.a, s.b].forEach(function (e) {
          var key = Math.round(e[0]) + ',' + Math.round(e[1]);
          if (seenN[key] || cnt[key] < 2) return;
          seenN[key] = 1;
          cx.beginPath(); cx.arc(e[0] * kk, e[1] * kk, 3.5, 0, 7); cx.fillStyle = '#fff'; cx.fill();
          cx.lineWidth = 1.5; cx.strokeStyle = 'rgba(0,0,0,.7)'; cx.stroke();
        });
      });
      if (uShow !== 'under') looseEnds().forEach(function (e) {
        cx.beginPath(); cx.arc(e[0] * kk, e[1] * kk, Math.max(9, 0.22 * ppm() * kk), 0, 7);
        cx.setLineDash([4, 3]); cx.lineWidth = 2.5; cx.strokeStyle = '#ef4444'; cx.stroke(); cx.setLineDash([]);
        cx.beginPath(); cx.arc(e[0] * kk, e[1] * kk, 3, 0, 7); cx.fillStyle = '#ef4444'; cx.fill();
      });
    }
    // место, куда послала кнопка «К проблеме»: кольцо расходится пару секунд
    if (focusPt && Date.now() - focusPt.t < 2200) {
      var ph = ((Date.now() - focusPt.t) % 700) / 700;
      cx.beginPath(); cx.arc(focusPt.p[0] * kk, focusPt.p[1] * kk, (0.3 + ph * 0.7) * ppm() * kk, 0, 7);
      cx.lineWidth = 3; cx.strokeStyle = 'rgba(248,113,113,' + (1 - ph) + ')'; cx.stroke();
    }
    // подписи длин
    cx.font = '11px system-ui'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    (w || []).forEach(function (s, i) {
      var len = dist(s.a, s.b);
      if (len / ppm() < 0.3) return;
      var mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2;
      var dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l = Math.hypot(dx, dy) || 1;
      var off = thickPx(s) / 2 + 9 / kk;
      // подпись выносим наружу от линии, всегда в «верхнюю» сторону
      var nx = -dy / l, ny = dx / l;
      if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
      var txt = fmtM(len);
      var px = (mx + nx * off) * kk, py = (my + ny * off) * kk;
      var tw = cx.measureText(txt).width + 6;
      cx.fillStyle = dark ? 'rgba(255,255,255,.85)' : 'rgba(20,28,45,.82)';
      cx.fillRect(px - tw / 2, py - 7, tw, 14);
      cx.fillStyle = i === sel ? '#1d4ed8' : (dark ? '#1e293b' : '#e5edff');
      cx.fillText(txt, px, py);
    });
    // окна и двери: поверх стен
    ops().forEach(function (o, i) { drawOpening(cx, kk, o, i === selO, dark, false); });
    if (G.mode === 'wall' && tool !== 'wall' && hoverO && !odrag) drawOpening(cx, kk, { wid: hoverO.wid, o: hoverO.o, k: curKind(), w: SIZE[curKind()][0], h: SIZE[curKind()][1], sill: SIZE[curKind()][2] }, false, dark, true);
    // нарисованный, но ещё не зафиксированный отрезок: стена в толщину, размер и угол на лету, как в Revit
    if (G.mode === 'wall' && tool === 'wall' && start && hover) drawPreview(cx, kk);
    drawGuides(cx, kk);
    if (G.mode === 'wall' && hover && lastRaw && imgSnapOn && tool === 'wall' && !drag) {
      // грани стен на подложке рядом с курсором: показывают, куда прилипнет клик
      var ed = imageEdges(lastRaw, 14 / kk), ln = 0.5 * ppm();
      if (ed) {
        cx.save(); cx.strokeStyle = 'rgba(56,189,248,.75)'; cx.lineWidth = 1; cx.setLineDash([4, 3]); cx.beginPath();
        ed.x.forEach(function (xx) { cx.moveTo(xx * kk, (lastRaw[1] - ln) * kk); cx.lineTo(xx * kk, (lastRaw[1] + ln) * kk); });
        ed.y.forEach(function (yy) { cx.moveTo((lastRaw[0] - ln) * kk, yy * kk); cx.lineTo((lastRaw[0] + ln) * kk, yy * kk); });
        cx.stroke(); cx.restore();
      }
    }
    if (G.mode === 'wall' && hover && (tool === 'wall' || tool === 'win' || tool === 'door') && !(G.rvSnapOwner && G.rvSnapOwner())) drawGlyph(cx, kk, hover);
    cx.restore();
  }

  // ── размер на лету, привязки и подсказки (оформление Revit) ───────────
  var TIPS = { end: 'Конечная точка', mid: 'Середина', perp: 'Перпендикуляр', body: 'Ближайшая', int: 'Пересечение', img: 'Грань на плане', edge: 'Грань на плане', ortho: 'Ортогонально', grid: '' };
  var DIMC = '#1d4ed8';
  /** Временный размер: выносные линии, размерная со стрелками и белая табличка с числом. editing - табличка в режиме ввода. */
  function drawTempDim(cx, kk, P, Q, text, editing, offPx, flip) {
    var a = [P[0] * kk, P[1] * kk], b = [Q[0] * kk, Q[1] * kk], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 8) return null;
    var ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l, nx = -uy, ny = ux;
    if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
    if (flip) { nx = -nx; ny = -ny; }
    var off = offPx == null ? 30 : offPx;
    var a2 = [a[0] + nx * off, a[1] + ny * off], b2 = [b[0] + nx * off, b[1] + ny * off];
    cx.save();
    cx.lineWidth = 1; cx.strokeStyle = DIMC; cx.fillStyle = DIMC; cx.setLineDash([]);
    cx.beginPath();
    cx.moveTo(a[0] + nx * 4, a[1] + ny * 4); cx.lineTo(a2[0] + nx * 6, a2[1] + ny * 6);
    cx.moveTo(b[0] + nx * 4, b[1] + ny * 4); cx.lineTo(b2[0] + nx * 6, b2[1] + ny * 6);
    cx.moveTo(a2[0], a2[1]); cx.lineTo(b2[0], b2[1]); cx.stroke();
    [[a2, 1], [b2, -1]].forEach(function (q) {
      var p = q[0], d = q[1], hx = p[0] + ux * 9 * d, hy = p[1] + uy * 9 * d;
      cx.beginPath(); cx.moveTo(p[0], p[1]); cx.lineTo(hx + nx * 3, hy + ny * 3); cx.lineTo(hx - nx * 3, hy - ny * 3); cx.closePath(); cx.fill();
    });
    cx.font = 'bold 12px "Segoe UI",system-ui,sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    var mx = (a2[0] + b2[0]) / 2, my = (a2[1] + b2[1]) / 2, tw = Math.max(34, cx.measureText(text).width + 14), th = 19;
    cx.fillStyle = editing ? '#fffbe6' : '#ffffff'; cx.strokeStyle = DIMC; cx.lineWidth = editing ? 2 : 1;
    cx.beginPath(); cx.rect(mx - tw / 2, my - th / 2, tw, th); cx.fill(); cx.stroke();
    cx.fillStyle = DIMC; cx.fillText(text, mx, my + 0.5);
    cx.restore();
    return { x: mx, y: my, w: tw, h: th };
  }
  /** Глиф привязки по типу (квадрат, треугольник, крест, угол, песочные часы) и жёлтая подсказка рядом. */
  function drawGlyph(cx, kk, h, noTip) {
    var x = h.p[0] * kk, y = h.p[1] * kk, t = h.t, S = 7;
    cx.save(); cx.lineJoin = 'miter'; cx.setLineDash([]);
    function path() {
      cx.beginPath();
      if (t === 'end') cx.rect(x - S, y - S, 2 * S, 2 * S);
      else if (t === 'mid') { cx.moveTo(x, y - S); cx.lineTo(x + S, y + S * 0.8); cx.lineTo(x - S, y + S * 0.8); cx.closePath(); }
      else if (t === 'int') { cx.moveTo(x - S, y - S); cx.lineTo(x + S, y + S); cx.moveTo(x + S, y - S); cx.lineTo(x - S, y + S); }
      else if (t === 'perp') { cx.moveTo(x - S, y - S); cx.lineTo(x - S, y + S); cx.lineTo(x + S, y + S); cx.moveTo(x - S, y + S - 7); cx.lineTo(x - S + 7, y + S - 7); cx.lineTo(x - S + 7, y + S); }
      else if (t === 'body') { cx.moveTo(x - S, y - S); cx.lineTo(x + S, y - S); cx.lineTo(x - S, y + S); cx.lineTo(x + S, y + S); cx.closePath(); }
      else if (t === 'img' || t === 'edge') { cx.rect(x - 5, y - 5, 10, 10); cx.moveTo(x - 9, y); cx.lineTo(x + 9, y); cx.moveTo(x, y - 9); cx.lineTo(x, y + 9); }
      else if (t === 'ortho') { cx.moveTo(x - 6, y); cx.lineTo(x + 6, y); cx.moveTo(x, y - 6); cx.lineTo(x, y + 6); }
      else { cx.moveTo(x - 4, y); cx.lineTo(x + 4, y); cx.moveTo(x, y - 4); cx.lineTo(x, y + 4); }
    }
    path(); cx.lineWidth = 4; cx.strokeStyle = 'rgba(255,255,255,.9)'; cx.stroke();
    path(); cx.lineWidth = 1.8; cx.strokeStyle = t === 'end' ? '#e11d48' : '#7c3aed'; cx.stroke();
    var tip = h.tip || TIPS[t];
    if (tip && !noTip) {
      cx.font = '12px "Segoe UI",system-ui,sans-serif'; cx.textAlign = 'left'; cx.textBaseline = 'middle';
      var tw = cx.measureText(tip).width + 12, tx = x + 16, ty = y + 18;
      if (tx + tw > G.cv.width - 4) tx = x - 16 - tw;
      cx.fillStyle = '#ffffe1'; cx.strokeStyle = '#8a8a8a'; cx.lineWidth = 1;
      cx.beginPath(); cx.rect(tx, ty - 10, tw, 20); cx.fill(); cx.stroke();
      cx.fillStyle = '#111'; cx.fillText(tip, tx + 6, ty + 0.5);
    }
    cx.restore();
  }
  /** Пунктир продолжения от узлов, с которыми совпала привязка по оси. */
  function drawGuides(cx, kk) {
    if (!guides.length || G.mode !== 'wall' || !hover) return;
    cx.save(); cx.setLineDash([5, 4]); cx.lineWidth = 1; cx.strokeStyle = '#0d9488';
    guides.forEach(function (g) {
      cx.beginPath(); cx.moveTo(g[0][0] * kk, g[0][1] * kk); cx.lineTo(hover.p[0] * kk, hover.p[1] * kk); cx.stroke();
    });
    cx.restore();
  }
  /** Конечная точка предпросмотра: набранная длина или привязанный курсор. */
  function previewEnd() { return (typed || typedA !== '') ? typedEnd() : hover.p; }
  /** Ввод у курсора как в AutoCAD: поля «Длина» и «Угол», Tab переключает, цифры вписываются в активное, Enter ставит. */
  function drawDynInput(cx, kk, end, len) {
    var an = Math.atan2(end[1] - start[1], end[0] - start[0]), deg = ((-an * 180 / Math.PI) % 360 + 360) % 360;
    var rows = [['Длина', typed ? typed : fmtM(len), !fieldA, !!typed], ['Угол', typedA !== '' ? typedA : (Math.round(deg * 10) / 10).toString().replace('.', ','), fieldA, typedA !== '']];
    cx.save(); cx.font = '12px "Segoe UI",system-ui,sans-serif'; cx.textBaseline = 'middle'; cx.setLineDash([]);
    var x = end[0] * kk + 18, y = end[1] * kk + 16, w = 138, h = 22;
    if (x + w > G.cv.width - 4) x = end[0] * kk - 18 - w;
    if (y + 2 * h > G.cv.height - 4) y = end[1] * kk - 16 - 2 * h;
    rows.forEach(function (r, i) {
      var yy = y + i * (h + 2);
      cx.fillStyle = 'rgba(20,24,34,.92)'; cx.fillRect(x, yy, w, h);
      cx.strokeStyle = r[2] ? '#fbbf24' : '#64748b'; cx.lineWidth = r[2] ? 2 : 1; cx.strokeRect(x, yy, w, h);
      cx.textAlign = 'left'; cx.fillStyle = '#9ca3af'; cx.fillText(r[0], x + 6, yy + h / 2 + 0.5);
      cx.textAlign = 'right'; cx.fillStyle = r[3] ? '#fbbf24' : '#e5e7eb'; cx.font = (r[3] ? 'bold ' : '') + '12px "Segoe UI",system-ui,sans-serif';
      cx.fillText(r[1] + (r[2] && r[3] ? '|' : '') + (i ? '\u00b0' : ' м'), x + w - 6, yy + h / 2 + 0.5);
      cx.font = '12px "Segoe UI",system-ui,sans-serif';
    });
    cx.restore();
  }
  /** Стена-образец: полоса толщины со светло-синей заливкой, линия клика, размер и угол. */
  function drawPreview(cx, kk) {
    var end = previewEnd(), d = locD(), seg = d ? offSeg(start, end, d) : [start, end];
    var l = dist(seg[0], seg[1]);
    cx.save();
    if (l > 0.5) {
      var ux = (seg[1][0] - seg[0][0]) / l, uy = (seg[1][1] - seg[0][1]) / l, h = thickPx({ k: kind }) / 2;
      cx.beginPath();
      cx.moveTo((seg[0][0] - uy * h) * kk, (seg[0][1] + ux * h) * kk); cx.lineTo((seg[1][0] - uy * h) * kk, (seg[1][1] + ux * h) * kk);
      cx.lineTo((seg[1][0] + uy * h) * kk, (seg[1][1] - ux * h) * kk); cx.lineTo((seg[0][0] + uy * h) * kk, (seg[0][1] - ux * h) * kk); cx.closePath();
      cx.fillStyle = 'rgba(56,132,255,.22)'; cx.fill(); cx.lineWidth = 1.5; cx.strokeStyle = '#2563eb'; cx.stroke();
    }
    cx.setLineDash(d ? [7, 4] : [2, 3]); cx.lineWidth = 1; cx.strokeStyle = '#2563eb';
    cx.beginPath(); cx.moveTo(start[0] * kk, start[1] * kk); cx.lineTo(end[0] * kk, end[1] * kk); cx.stroke(); cx.setLineDash([]);
    var len = dist(start, end);
    drawTempDim(cx, kk, start, end, fmtM(len) + ' м', false);
    drawDynInput(cx, kk, end, len);
    // угол к горизонтали (против часовой, как в Revit)
    if (len / ppm() > 0.15) {
      var an = Math.atan2(end[1] - start[1], end[0] - start[0]), deg = ((-an * 180 / Math.PI) % 360 + 360) % 360;
      if (deg > 0.5 && deg < 359.5) {
        var sx = start[0] * kk, sy = start[1] * kk, R = 34;
        cx.setLineDash([]); cx.lineWidth = 1; cx.strokeStyle = DIMC;
        cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(sx + R + 10, sy); cx.stroke();
        cx.beginPath(); cx.arc(sx, sy, R, 0, an, an < 0); cx.stroke();
        var am = an / 2;
        cx.font = '11px "Segoe UI",system-ui,sans-serif'; cx.textAlign = 'left'; cx.textBaseline = 'middle';
        var at = (Math.round(deg * 10) / 10).toString().replace('.', ',') + '°', aw = cx.measureText(at).width + 8, ax2 = sx + Math.cos(am) * (R + 8), ay2 = sy + Math.sin(am) * (R + 8);
        cx.fillStyle = '#fff'; cx.fillRect(ax2, ay2 - 8, aw, 16); cx.fillStyle = DIMC; cx.fillText(at, ax2 + 4, ay2 + 0.5);
      }
    }
    cx.restore();
  }

  function drawOpening(cx, kk, o, isSel, dark, ghost) {
    var g = opGeom(o);
    if (!g) return;
    var hw = g.wpx / 2, ht = g.t / 2 + 1;
    function P(a, b) { return [(g.c[0] + g.ux * a + g.nx * b) * kk, (g.c[1] + g.uy * a + g.ny * b) * kk]; }
    cx.save();
    if (ghost) cx.globalAlpha = 0.55; else if (G.mode !== 'wall') cx.globalAlpha = 0.7;
    var q = [P(-hw, -ht), P(hw, -ht), P(hw, ht), P(-hw, ht)], i;
    cx.beginPath(); cx.moveTo(q[0][0], q[0][1]); for (i = 1; i < 4; i++) cx.lineTo(q[i][0], q[i][1]); cx.closePath();
    if (o.k === 'win') {
      cx.fillStyle = 'rgba(14,165,233,0.30)'; cx.fill();
      cx.lineWidth = 2.5; cx.strokeStyle = isSel ? '#ffffff' : '#0284c7'; cx.stroke();
      var m1 = P(-hw, 0), m2 = P(hw, 0);
      cx.beginPath(); cx.moveTo(m1[0], m1[1]); cx.lineTo(m2[0], m2[1]); cx.lineWidth = 2.5; cx.stroke();
    } else if (o.k === 'gate') {
      cx.fillStyle = 'rgba(148,163,184,0.38)'; cx.fill();
      cx.lineWidth = 2.5; cx.strokeStyle = isSel ? '#ffffff' : '#64748b'; cx.stroke();
      cx.setLineDash([6, 4]); cx.lineWidth = 1.5; cx.beginPath();
      [-0.5, 0, 0.5].forEach(function (f2) { var a2 = P(-hw, ht * f2 * 1.2), b2 = P(hw, ht * f2 * 1.2); cx.moveTo(a2[0], a2[1]); cx.lineTo(b2[0], b2[1]); });
      cx.stroke(); cx.setLineDash([]);
    } else {
      cx.fillStyle = 'rgba(245,158,11,0.24)'; cx.fill();
      cx.lineWidth = 2.5; cx.strokeStyle = isSel ? '#ffffff' : '#d97706'; cx.stroke();
      // полотно и дуга открывания: петля у начала проёма, открывается в сторону нормали
      var hinge = [(g.c[0] - g.ux * hw) * kk, (g.c[1] - g.uy * hw) * kk];
      var tip = [(g.c[0] - g.ux * hw + g.nx * g.wpx) * kk, (g.c[1] - g.uy * hw + g.ny * g.wpx) * kk];
      cx.beginPath(); cx.moveTo(hinge[0], hinge[1]); cx.lineTo(tip[0], tip[1]);
      var a0 = Math.atan2(g.ny, g.nx), a1 = Math.atan2(g.uy, g.ux);
      var d = ((a1 - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      cx.arc(hinge[0], hinge[1], g.wpx * kk, a0, a0 + d, d < 0);
      cx.lineWidth = 1.5; cx.strokeStyle = isSel ? '#ffffff' : '#d97706'; cx.stroke();
    }
    if (isSel && !ghost) {
      // ручки на концах: тяните, чтобы растянуть окно по подложке; над проёмом - ширина
      [P(-hw, 0), P(hw, 0)].forEach(function (pt) {
        cx.beginPath(); cx.rect(pt[0] - 5, pt[1] - 5, 10, 10);
        cx.fillStyle = '#fff'; cx.fill(); cx.lineWidth = 2; cx.strokeStyle = '#000'; cx.stroke();
      });
      var lab = P(0, -(ht + 12 / kk)), txt = fm2(o.w) + ' м';
      cx.font = 'bold 12px system-ui'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      var tw = cx.measureText(txt).width + 8;
      cx.fillStyle = 'rgba(255,255,255,.92)'; cx.fillRect(lab[0] - tw / 2, lab[1] - 8, tw, 16);
      cx.fillStyle = '#1d4ed8'; cx.fillText(txt, lab[0], lab[1]);
    }
    cx.restore();
  }

  /** Окно/дверь под точкой (индекс) или -1. */
  function opAt(p) {
    var list = ops();
    for (var i = list.length - 1; i >= 0; i--) {
      var g = opGeom(list[i]);
      if (!g) continue;
      var dx = p[0] - g.c[0], dy = p[1] - g.c[1];
      var a = dx * g.ux + dy * g.uy, b = dx * g.nx + dy * g.ny;
      if (Math.abs(a) <= g.wpx / 2 + 3 && Math.abs(b) <= g.t / 2 + 4) return i;
    }
    return -1;
  }

  /** Ручка выбранного проёма под точкой: 'a' (начало) или 'b' (конец) либо null. */
  function handleAt(p) {
    var o = ops()[selO];
    if (!o) return null;
    var g = opGeom(o);
    if (!g) return null;
    var r = 10 / k(), hw = g.wpx / 2;
    if (dist(p, [g.c[0] - g.ux * hw, g.c[1] - g.uy * hw]) <= r) return 'a';
    if (dist(p, [g.c[0] + g.ux * hw, g.c[1] + g.uy * hw]) <= r) return 'b';
    return null;
  }

  // ── размеры и перемещение стен (ручной режим) ───────────────────────
  function ptEq(a, b) { return dist(a, b) < 0.75; }
  function r1(x) { return Math.round(x * 10) / 10; }
  /** Все концы стен, совпадающие с точкой, переезжают в новую. */
  function moveNode(oldP, newP) {
    walls().forEach(function (sw) {
      if (ptEq(sw.a, oldP)) sw.a = [r1(newP[0]), r1(newP[1])];
      if (ptEq(sw.b, oldP)) sw.b = [r1(newP[0]), r1(newP[1])];
    });
  }
  function clampOps() {
    ops().forEach(function (o) {
      var sw = wallById(o.wid);
      if (sw) o.o = Math.max(o.w / 2 + 0.05, Math.min(wlen(sw) - o.w / 2 - 0.05, o.o));
    });
  }
  /** Куски одной прямой стены (разрезанной Т-узлами): все стены на той же линии, что и стена si. */
  function lineOf(si) {
    var w = walls(), s0 = w[si], out = [];
    if (!s0) return out;
    var l = dist(s0.a, s0.b) || 1, ux = (s0.b[0] - s0.a[0]) / l, uy = (s0.b[1] - s0.a[1]) / l;
    w.forEach(function (o, i) {
      var ol = dist(o.a, o.b) || 1;
      var par = Math.abs((o.b[0] - o.a[0]) * uy - (o.b[1] - o.a[1]) * ux) / ol < 0.02;
      var d1 = Math.abs((o.a[0] - s0.a[0]) * -uy + (o.a[1] - s0.a[1]) * ux), d2 = Math.abs((o.b[0] - s0.a[0]) * -uy + (o.b[1] - s0.a[1]) * ux);
      if (par && d1 < 1.5 && d2 < 1.5) out.push(i);
    });
    return out;
  }
  /**
   * Сдвинуть стену (всю прямую целиком) поперёк себя на d пикселей. Примыкающие стены в углах и Т-узлах растягиваются,
   * проёмы остаются на своих местах. Каждый узел переносится один раз.
   */
  function moveWallBy(si, d) {
    var w = walls(), s0 = w[si];
    if (!s0 || !d) return;
    var list = lineOf(si), l = dist(s0.a, s0.b) || 1, nx = -(s0.b[1] - s0.a[1]) / l, ny = (s0.b[0] - s0.a[0]) / l;
    var nodes = [], riders = [], seen = {};
    list.forEach(function (i) {
      [w[i].a, w[i].b].forEach(function (p) { if (!nodes.some(function (q) { return ptEq(q, p); })) nodes.push(p.slice()); });
    });
    list.forEach(function (i) {
      w.forEach(function (o, j) {
        if (list.indexOf(j) >= 0) return;
        ['a', 'b'].forEach(function (e) {
          var pr = projOn(o[e], w[i].a, w[i].b), key = j + e;
          if (pr.d < 1.5 && pr.t > 0.001 && pr.t < 0.999 && !seen[key]) { seen[key] = 1; riders.push([j, e]); }   // конец упирается в тело стены
        });
      });
    });
    nodes.forEach(function (p) { moveNode(p, [p[0] + nx * d, p[1] + ny * d]); });
    riders.forEach(function (r) { var o = w[r[0]]; o[r[1]] = [r1(o[r[1]][0] + nx * d), r1(o[r[1]][1] + ny * d)]; });
    clampOps();
  }
  /** Сдвинуть стену так, чтобы она сместилась на вектор (dx, dy) пикселей (проекция на её нормаль). */
  function moveWallAlong(si, dx, dy) {
    var sw = walls()[si];
    if (!sw) return;
    var l = dist(sw.a, sw.b) || 1;
    moveWallBy(si, dx * (-(sw.b[1] - sw.a[1]) / l) + dy * ((sw.b[0] - sw.a[0]) / l));
  }
  function wallIndexById(id) { var w = walls(); for (var i = 0; i < w.length; i++) if (w[i].id === id) return i; return -1; }

  /** Новая длина стены: конец b уходит по направлению стены, всё, что в нём сходится, едет следом. */
  function askWallLen(si) {
    var sw = walls()[si];
    if (!sw) return;
    G.askText({ title: 'Длина стены', sub: 'В метрах (4,5) или сантиметрах (450).', def: fm2(wlen(sw)),
      live: function (v) { var m = parseLen(v); return m > 0 ? 'Будет ' + fm2(m) + ' м' : (v ? 'Не понял число' : ''); } }, function (v) {
      var m = parseLen(v);
      if (!(m > 0.2 && m < 60)) return;
      G.pushUndo('walls');
      var l = dist(sw.a, sw.b) || 1, ux = (sw.b[0] - sw.a[0]) / l, uy = (sw.b[1] - sw.a[1]) / l, oldB = sw.b.slice();
      moveNode(oldB, [sw.a[0] + ux * m * ppm(), sw.a[1] + uy * m * ppm()]);
      clampOps(); afterWallEdit(); reportSel(); G.refreshWallsUi(); G.draw();
    });
  }

  function bboxOf(pts) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    return [x0, y0, x1, y1];
  }
  /** Стена, на которой лежит крайняя (восточная или южная) сторона контура комнаты. */
  function extremeHost(pts, east) {
    var bb = bboxOf(pts), best = -1, n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      if (l < 1) continue;
      var onSide = east ? (Math.abs(dx) < 1 && Math.abs(a[0] - bb[2]) < 2) : (Math.abs(dy) < 1 && Math.abs(a[1] - bb[3]) < 2);
      if (!onSide) continue;
      var h = wallHost([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [dx / l, dy / l]);
      if (h) { var ix = wallIndexById(h.id); if (ix >= 0) best = ix; }
    }
    return best;
  }
  /** Размеры комнаты (внутри стен): ширина и глубина. Левый верхний угол стоит, восточная и южная стены едут. */
  function askRoomSize(zi) {
    var f = F(), z = f.zones[zi];
    if (!z || !z.pts) return;
    var bb = bboxOf(z.pts), cw = (bb[2] - bb[0]) / ppm(), cd = (bb[3] - bb[1]) / ppm();
    G.askText({ title: 'Размеры комнаты' + (z.name ? ' «' + z.name + '»' : ''), sub: 'Ширина x глубина внутри стен, м: 4,5x3,8. Двигаются правая и нижняя стены, соседние комнаты подстраиваются.',
      def: fm2(cw) + 'x' + fm2(cd),
      live: function (v) { var d = parseDims(v); return d ? 'Будет ' + fm2(d[0]) + ' x ' + fm2(d[1]) + ' м, ' + fm2(d[0] * d[1]) + ' м²' : (v ? 'Пример: 4,5x3,8' : ''); } }, function (v) {
      var d = parseDims(v);
      if (!d) return;
      var ew = extremeHost(z.pts, true), sw2 = extremeHost(z.pts, false);
      if (ew < 0 && sw2 < 0) { hintWall('У этой комнаты нет прямых крайних стен: размеры правятся тягой стен (инструмент «Двигать»).'); return; }
      G.pushUndo('walls');
      if (ew >= 0) moveWallAlong(ew, (d[0] - cw) * ppm(), 0);
      if (sw2 >= 0) moveWallAlong(sw2, 0, (d[1] - cd) * ppm());
      afterWallEdit(); G.refreshWallsUi(); G.draw();
    });
  }
  /** Размеры всего дома по осям наружных стен: восточная и южная наружные стены едут, перегородки тянутся следом. */
  G.wallsHouseSize = function () {
    var ext = walls().map(function (w, i) { return { w: w, i: i }; }).filter(function (q) { return q.w.k === 'ext'; });
    if (!ext.length) { G.wallsRectPrompt(); return; }
    var pts = []; ext.forEach(function (q) { pts.push(q.w.a, q.w.b); });
    var bb = bboxOf(pts), cw = (bb[2] - bb[0]) / ppm(), cd = (bb[3] - bb[1]) / ppm();
    G.askText({ title: 'Размеры дома', sub: 'По осям наружных стен, м: 11x8. Двигаются правая и нижняя стены, перегородки тянутся следом - комнаты потом уточняются.',
      def: fm2(cw) + 'x' + fm2(cd),
      live: function (v) { var d = parseDims(v); return d ? 'Будет ' + fm2(d[0]) + ' x ' + fm2(d[1]) + ' м' : (v ? 'Пример: 11x8' : ''); } }, function (v) {
      var d = parseDims(v);
      if (!d) return;
      var east = -1, south = -1;
      ext.forEach(function (q) {
        var w = q.w;
        if (Math.abs(w.a[0] - w.b[0]) < 1 && Math.abs(w.a[0] - bb[2]) < 2) east = q.i;
        if (Math.abs(w.a[1] - w.b[1]) < 1 && Math.abs(w.a[1] - bb[3]) < 2) south = q.i;
      });
      G.pushUndo('walls');
      if (east >= 0) moveWallAlong(east, (d[0] - cw) * ppm(), 0);
      if (south >= 0) moveWallAlong(south, 0, (d[1] - cd) * ppm());
      afterWallEdit(); G.refreshWallsUi(); G.draw();
    });
  };

  /** Клик инструментом «Размер»: по стене - её длина, по комнате - ширина и глубина. */
  function sizeClick(raw) {
    var wi = wallAt(raw);
    if (wi >= 0) { sel = wi; askWallLen(wi); return; }
    var f = F(), zi = -1;
    (f.zones || []).forEach(function (z, i) { if (z.type !== 'cold' && z.pts && inside(raw, z.pts)) zi = i; });
    if (zi >= 0) askRoomSize(zi); else hintWall('Кликните по стене - длина, по комнате - её размеры.');
  }

  /** Куда лёг бы проём: стена под курсором и смещение центра в метрах (сетка 50 мм, не ближе 5 см к краю). */
  function opPlace(p, wpx) {
    var wi = wallAt(p), w = walls();
    if (wi < 0) return null;
    var s = w[wi], pr = projOn(p, s.a, s.b), len = wlen(s), wm = (wpx || SIZE[curKind()][0] * ppm()) / ppm();
    if (len < wm + 0.1) return null;
    var o = Math.round(pr.t * len / GRID_M) * GRID_M;
    o = Math.max(wm / 2 + 0.05, Math.min(len - wm / 2 - 0.05, o));
    return { wid: s.id, o: Math.round(o * 1000) / 1000 };
  }

  // ── мышь ────────────────────────────────────────────────────────────
  function ev(e) { return G.evPt(e); }

  G.cv.addEventListener('mousemove', function (e) {
    if (G.mode !== 'wall') return;
    var raw = ev(e);
    if (ohandle) {
      var oo = ops()[selO], sw = oo && wallById(oo.wid);
      if (sw) {
        var wl = wlen(sw), sl = dist(sw.a, sw.b) || 1;
        var tt = ((raw[0] - sw.a[0]) * (sw.b[0] - sw.a[0]) / sl + (raw[1] - sw.a[1]) * (sw.b[1] - sw.a[1]) / sl) / ppm();
        tt = Math.round(tt / GRID_M) * GRID_M;
        var Lm = oo.o - oo.w / 2, Rm = oo.o + oo.w / 2;
        if (ohandle.end === 'a') Lm = Math.max(0.05, Math.min(tt, Rm - 0.3)); else Rm = Math.min(wl - 0.05, Math.max(tt, Lm + 0.3));
        oo.o = Math.round((Lm + Rm) / 2 * 1000) / 1000; oo.w = Math.round((Rm - Lm) * 100) / 100; ohandle.moved = true;
      }
      G.cv.style.cursor = 'ew-resize'; G.draw(); return;
    }
    if (!start && selO >= 0 && handleAt(raw)) { hover = null; G.cv.style.cursor = 'ew-resize'; G.draw(); return; }
    if (drag) {
      var sn = snap(raw, null, e.altKey);
      drag.moved = true;
      F().walls.forEach(function (s, i) {
        if (drag.ends[i] & 1) s.a = [sn.p[0], sn.p[1]];
        if (drag.ends[i] & 2) s.b = [sn.p[0], sn.p[1]];
      });
      hover = sn; G.cv.style.cursor = 'grabbing'; G.draw(); return;
    }
    if (odrag) {
      var op = opPlace(raw, ops()[odrag.i].w * ppm());
      if (op && op.wid === ops()[odrag.i].wid) { ops()[odrag.i].o = op.o; odrag.moved = true; }
      G.cv.style.cursor = 'grabbing'; G.draw(); return;
    }
    if (mdrag) {
      var base = JSON.parse(mdrag.base); F().walls = base;
      var s0 = base[mdrag.i], l0 = dist(s0.a, s0.b) || 1, nx0 = -(s0.b[1] - s0.a[1]) / l0, ny0 = (s0.b[0] - s0.a[0]) / l0;
      var d0 = (raw[0] - mdrag.raw0[0]) * nx0 + (raw[1] - mdrag.raw0[1]) * ny0, g0 = GRID_M * ppm();
      d0 = Math.round(d0 / g0) * g0; mdrag.moved = d0 !== 0;
      moveWallBy(mdrag.i, d0); G.cv.style.cursor = 'move'; G.draw(); return;
    }
    if ((tool === 'move' || tool === 'size') && !start) {
      hoverW = wallAt(raw); hover = null;
      G.cv.style.cursor = tool === 'move' ? (hoverW >= 0 ? 'move' : 'default') : 'pointer';
      G.draw(); return;
    }
    if ((tool === 'win' || tool === 'door') && !start) {
      hoverO = opAt(raw) >= 0 ? null : opPlace(raw);
      hover = null;
      G.cv.style.cursor = opAt(raw) >= 0 ? 'grab' : hoverO ? 'copy' : 'default';
      G.draw(); return;
    }
    hover = snap(raw, start, e.altKey, !!(start && (orthoOn !== e.shiftKey))); lastRaw = e.altKey ? null : raw; lastShift = !!(start && e.shiftKey);
    hoverW = (tool === 'wall' && !start) ? wallAt(raw) : -1;
    G.cv.style.cursor = start ? 'crosshair' : (endpointAt(raw) ? 'grab' : wallAt(raw) >= 0 ? 'pointer' : 'crosshair');
    G.draw();
  });

  G.cv.addEventListener('mousedown', function (e) {
    if (G.mode !== 'wall' || start || e.button !== 0) return;
    var raw = ev(e), he = handleAt(raw);
    if (he) { G.pushUndo('walls'); ohandle = { end: he, moved: false }; e.preventDefault(); return; }
    if (tool === 'move') {
      var wm0 = wallAt(raw);
      if (wm0 >= 0) { G.pushUndo('walls'); mdrag = { i: wm0, raw0: raw, base: JSON.stringify(walls()), moved: false }; sel = wm0; e.preventDefault(); }
      return;
    }
    var oi0 = opAt(raw);
    if (oi0 >= 0 && !e.shiftKey) { G.pushUndo('walls'); odrag = { i: oi0, moved: false }; selO = oi0; e.preventDefault(); return; }
    var ep = tool === 'wall' ? endpointAt(raw) : null;
    if (!ep) return;
    G.pushUndo('walls');
    var ends = {};
    walls().forEach(function (s, i) {
      var m = (same(s.a, ep) ? 1 : 0) | (same(s.b, ep) ? 2 : 0);
      if (m) ends[i] = m;
    });
    drag = { ends: ends, moved: false };
    e.preventDefault();
  });

  G.cv.addEventListener('mouseup', function () {
    if (mdrag) {
      var mvd = mdrag.moved; mdrag = null; swallow = Date.now();
      if (!mvd) { if (G.undoStack.length) G.undoStack.pop(); } else afterWallEdit();
      G.refreshWallsUi(); G.draw(); return;
    }
    if (ohandle) {
      var mv2 = ohandle.moved; ohandle = null; swallow = Date.now();
      var o2 = ops()[selO];
      if (!mv2) { if (G.undoStack.length) G.undoStack.pop(); }
      else { if (o2) SIZE[o2.k][0] = o2.w; afterWallEdit(); }
      reportOp(); G.refreshWallsUi(); G.draw(); return;
    }
    if (odrag) {
      var mv = odrag.moved; odrag = null; swallow = Date.now();
      if (!mv && G.undoStack.length) G.undoStack.pop();
      if (mv) afterWallEdit();
      reportOp(); G.draw(); return;
    }
    if (!drag) return;
    var moved = drag.moved;
    drag = null; swallow = Date.now();
    if (moved) {
      // узел мог лечь на чужую стену — режем её, выкидываем вырожденные
      F().walls = F().walls.filter(function (s) { return dist(s.a, s.b) / ppm() >= MIN_LEN_M; });
      pruneOps();
      ops().forEach(function (o) { var s = wallById(o.wid); if (s) o.o = Math.max(o.w / 2, Math.min(wlen(s) - o.w / 2, o.o)); });
      F().walls.slice().forEach(function (s) { splitAt(s.a); splitAt(s.b); });
      afterWallEdit();
    } else if (G.undoStack.length) G.undoStack.pop();   // клик без сдвига — не действие
    G.cv.style.cursor = 'crosshair'; G.draw();
  });

  G.cv.addEventListener('click', function (e) {
    if (G.mode !== 'wall' || Date.now() - swallow < 250) return;
    var raw = ev(e);
    if (!start && tool === 'size' && !e.shiftKey) { sizeClick(raw); return; }
    if (!start && tool === 'move' && !e.shiftKey) return;
    if (!start && (tool !== 'wall' || e.shiftKey)) {
      var oi = opAt(raw);
      if (e.shiftKey || oi >= 0) {
        if (oi >= 0) { selO = oi; sel = -1; reportOp(); }
        else { selO = -1; sel = wallAt(raw); if (sel >= 0) reportSel(); else updateHint(); }
        G.draw(); return;
      }
      var pl = opPlace(raw);
      if (pl) {
        G.pushUndo('walls');
        var z = SIZE[curKind()];
        ops().push({ id: nextOid(), wid: pl.wid, o: pl.o, k: curKind(), w: z[0], h: z[1], sill: z[2] });
        selO = ops().length - 1; afterWallEdit(); reportOp(); G.refreshWallsUi();
      }
      G.draw(); return;
    }
    if (!start) {
      // Shift+клик по стене — выбрать; обычный клик начинает новую стену (в том числе от тела готовой: Т-узел)
      var wi = wallAt(raw);
      sel = -1; selO = -1;
      var sn0 = snap(raw, null, e.altKey);
      start = sn0.p; chainStart = sn0.p.slice(); chainPts = [sn0.p.slice()]; chainT = []; chainN = 0; chainAxEnd = null; chainFirst = null; hover = sn0; typed = ''; typedA = ''; fieldA = false; updateHint(); G.draw(); return;
    }
    var sn = snap(raw, start, e.altKey, !!(orthoOn !== e.shiftKey)), end = sn.p;
    if (typed || typedA !== '') end = typedEnd();
    if (commitSeg(start, end)) { sampleT(start, end); chainPts.push(end.slice()); start = end; typed = ''; typedA = ''; fieldA = false; sel = -1; chainN++; afterWallEdit(); closeIfLoop(); if (!chainOn) endChain(); }
    updateHint(); G.refreshWallsUi(); G.draw();
  });

  G.cv.addEventListener('dblclick', function (e) {
    if (G.mode !== 'wall') return;
    start = null; typed = ''; typedA = ''; fieldA = false; updateHint(); G.draw();
  });

  G.cv.addEventListener('contextmenu', function (e) {
    if (G.mode !== 'wall') return;
    e.preventDefault();
    if (start) { start = null; typed = ''; typedA = ''; fieldA = false; updateHint(); G.draw(); return; }
    var wi = wallAt(ev(e));
    if (wi >= 0) { sel = wi; toggleSel(); }
  }, true);

  /** Конец отрезка с учётом набранных длины и угла (угол против часовой от горизонтали, как в AutoCAD). */
  function typedEnd() {
    var vx = hover.p[0] - start[0], vy = hover.p[1] - start[1], vl = Math.hypot(vx, vy) || 1, ux = vx / vl, uy = vy / vl;
    var an = parseFloat(String(typedA).replace(',', '.'));
    if (typedA !== '' && isFinite(an)) { ux = Math.cos(an * Math.PI / 180); uy = -Math.sin(an * Math.PI / 180); }
    var tl = typed ? parseLen(typed) : 0;
    if (!(tl > 0)) tl = vl / ppm();
    if (!typed && typedA === '') return hover.p;
    return [Math.round((start[0] + ux * tl * ppm()) * 10) / 10, Math.round((start[1] + uy * tl * ppm()) * 10) / 10];
  }

  function reportSel() {
    var s = walls()[sel];
    if (!s) return;
    hintWall('Выбрана стена: ' + (s.k === 'int' ? 'внутренняя' : 'наружная') + ', ' + fmtM(dist(s.a, s.b)) +
      ' м, ' + Math.round(wallT(s) * 100) + ' см' + (s.mat ? ', ' + s.mat : '') + (s.ins ? ' + ' + Math.round(s.ins.t * 100) + ' см ' + s.ins.mat.toLowerCase() : '') + '. Enter — толщина и материал, T — сменить тип, Delete — убрать.');
  }

  function toggleSel() {
    var s = walls()[sel];
    if (!s) return;
    G.pushUndo('walls');
    s.k = s.k === 'int' ? 'ext' : 'int'; afterWallEdit();
    reportSel(); G.refreshWallsUi(); G.draw();
  }

  /**
   * Предупреждение, если наружная стена из этого материала хуже нормы СП 50.13330 для города.
   * R и норму считает калькулятор (окно-родитель); нет города или калькулятора - молчим.
   */
  function wallNormNote(mat, t, k, ins) {
    if (k === 'int' || !mat) return '';
    try {
      var A = window.parent && window.parent !== window && window.parent.app;
      if (!A || !A.planWallR || !A.wallSp50Req) return '';
      var R = A.planWallR({ mat: mat, t: t, ins: ins }), q = A.wallSp50Req();
      if (!R || !q || R >= q.rreq) return '';
      return 'R ' + R.toFixed(2).replace('.', ',') + ' - ниже нормы СП 50 для г. ' + q.city + ' (' + String(q.rreq).replace('.', ',') + '), добавьте утеплитель: «+ 10 пенополистирол»';
    } catch (e) { return ''; }
  }
  /** Толщина и материал выбранной стены: «40 газобетон», «51 кирпич», «10» (материал не меняется). */
  function wallProps() {
    var s = walls()[sel];
    if (!s) { hintWall('Выберите стену: Shift + клик по ней, затем Enter или кнопка «Толщина и материал».'); return; }
    var chips = (s.k === 'int' ? ['10 гипсокартон', '12 кирпич', '15 пеноблок', '20 газобетон'] : ['40 газобетон', '51 кирпич + 10 пенополистирол', '38 керамблок', '20 брус', '30 бетон', '20 каркас']).map(function (v) { return { v: v }; });
    // «51 кирпич + 10 пенополистирол»: после «+» - утеплитель (толщина в см и слово); «+ 0» или «без утеплителя» - убрать
    function parseIns(v) {
      var t = String(v || '').toLowerCase(), i = t.indexOf('+');
      if (/без\s+утепл/.test(t)) return { clear: true };
      if (i < 0) return null;
      var part = t.slice(i + 1), m = part.match(/(\d+[.,]?\d*)\s*(мм|см|м|mm|cm|m)?(?![а-яёa-z])/), mat = null;
      INS_MATS.forEach(function (x) { if (part.indexOf(x[0]) >= 0 && !mat) mat = x[1]; });
      if (!m) return null;
      var n = parseFloat(m[1].replace(',', '.')), u = m[2] || '', len = /^(мм|mm)$/.test(u) ? n / 1000 : /^(м|m)$/.test(u) ? n : n / 100;
      if (!(len > 0)) return { clear: true };
      return len >= 0.02 && len <= 0.5 ? { mat: mat || 'Пенополистирол', t: Math.round(len * 1000) / 1000 } : null;
    }
    function parse(v) {
      var t = String(v || '').toLowerCase().split('+')[0].replace(/без\s+утепл\S*/, ''), m = t.match(/(\d+[.,]?\d*)\s*(мм|см|м|mm|cm|m)?(?![а-яёa-z])/), mat = null;
      var bl = 0; WALL_MATS.forEach(function (x) { if (t.indexOf(x[0]) >= 0 && x[0].length > bl) { mat = x[1]; bl = x[0].length; } });   // самое длинное слово: «газобетон» содержит «бетон»
      var len = 0;
      if (m) { var n = parseFloat(m[1].replace(',', '.')), u = m[2] || ''; len = /^(мм|mm)$/.test(u) ? n / 1000 : /^(м|m)$/.test(u) ? n : n / 100; }
      return len >= 0.05 && len <= 1.2 ? { t: Math.round(len * 1000) / 1000, mat: mat, ins: parseIns(v) } : null;
    }
    G.askText({
      title: 'Толщина и материал стены',
      sub: 'Толщина в сантиметрах и материал словом: 40 газобетон, 51 кирпич. Утеплитель - после плюса: 51 кирпич + 10 пенополистирол (минвата, xps). Только число - материал не меняется.',
      chips: chips, def: Math.round(wallT(s) * 100) + (s.mat ? ' ' + s.mat.toLowerCase() : '') + (s.ins ? ' + ' + Math.round(s.ins.t * 100) + ' ' + s.ins.mat.toLowerCase() : ''),
      live: function (v) {
        var z = parse(v);
        if (!z) return v ? 'Не понял' : '';
        var m = z.mat || s.mat, ins = z.ins ? (z.ins.clear ? null : z.ins) : s.ins, w = wallNormNote(m, z.t, s.k, ins);
        return Math.round(z.t * 100) + ' см' + (z.mat ? ', ' + z.mat : '') + (ins ? ' + ' + Math.round(ins.t * 100) + ' см ' + ins.mat.toLowerCase() : '') + (w ? '. ' + w : '');
      }
    }, function (v) {
      var z = parse(v);
      if (!z) return;
      G.pushUndo('walls');
      s.t = z.t; if (z.mat) s.mat = z.mat;
      if (z.ins) { if (z.ins.clear) delete s.ins; else s.ins = z.ins; }
      afterWallEdit(); reportSel(); G.refreshWallsUi(); G.draw();
    });
  }
  G.wallsProps = wallProps;
  function deleteSel() {
    if (sel < 0 || !walls()[sel]) return;
    G.pushUndo('walls');
    walls().splice(sel, 1); sel = -1; pruneOps(); afterWallEdit();
    hintWall('Стена убрана.'); G.refreshWallsUi(); G.draw();
  }

  function reportOp() {
    var o = ops()[selO];
    if (!o) return;
    var sw = wallById(o.wid);
    hintWall((o.k === 'win' ? 'Окно ' : o.k === 'gate' ? 'Ворота ' : (sw && sw.k === 'ext' ? 'Наружная дверь ' : 'Дверь ')) +
      fm2(o.w) + ' x ' + fm2(o.h) + ' м' + (o.k === 'win' ? ', подоконник ' + fm2(o.sill) + ' м' : '') + '. Тяните за белые квадраты на концах - растянуть, за середину - сдвинуть. Enter - размеры, Delete - убрать.');
  }
  function deleteOp() {
    if (selO < 0 || !ops()[selO]) return false;
    G.pushUndo('walls'); ops().splice(selO, 1); selO = -1; afterWallEdit();
    hintWall('Проём убран.'); G.refreshWallsUi(); G.draw(); return true;
  }
  /** Размеры проёма одной строкой: 150x140/80 - ширина x высота / подоконник (см или м, как на шаге «Масштаб»). */
  function parseOpSize(v) {
    var m = String(v || '').split('/'), d = m[0].split(/[x×х*]/i);
    if (d.length !== 2) return null;
    var w = parseLen(d[0]), h = parseLen(d[1]), sl = m[1] != null && m[1].trim() ? parseLen(m[1]) : null;
    return w >= 0.3 && w <= 6 && h >= 0.3 && h <= 4 ? [w, h, sl] : null;
  }
  function editOp() {
    var o = ops()[selO];
    if (!o) return;
    var def = Math.round(o.w * 100) + 'x' + Math.round(o.h * 100) + (o.k === 'win' ? '/' + Math.round(o.sill * 100) : '');
    var chips = (o.k === 'win' ? ['90x120/90', '120x140/80', '150x140/80', '180x140/80', '210x220/0', '300x220/0', '400x240/0'] : o.k === 'gate' ? ['250x220', '300x220', '350x230', '400x240', '500x250'] : ['80x200', '90x210', '100x210', '120x210', '150x210']).map(function (v) { return { v: v }; });
    G.askText({
      title: o.k === 'win' ? 'Размеры окна' : o.k === 'gate' ? 'Размеры ворот' : 'Размеры двери',
      sub: 'Ширина x высота' + (o.k === 'win' ? ' / подоконник' : '') + ', в сантиметрах: ' + (o.k === 'win' ? '150x140/80' : o.k === 'gate' ? '300x220' : '90x210') + '. Метры тоже можно: 1,5м x 1,4м.',
      chips: chips, def: def,
      live: function (v) { var z = parseOpSize(v); return z ? fm2(z[0]) + ' x ' + fm2(z[1]) + ' м' : (v ? 'Не понял размер' : ''); }
    }, function (v) {
      var z = parseOpSize(v);
      if (!z) return;
      G.pushUndo('walls');
      o.w = z[0]; o.h = z[1]; if (o.k === 'win' && z[2] != null) o.sill = z[2];
      SIZE[o.k] = [o.w, o.h, o.k === 'win' ? o.sill : 0];
      var s = wallById(o.wid); if (s) o.o = Math.max(o.w / 2 + 0.05, Math.min(wlen(s) - o.w / 2 - 0.05, o.o));
      afterWallEdit(); reportOp(); G.refreshWallsUi(); G.draw();
    });
  }

  // клавиатура: в «захвате», чтобы горячие клавиши редактора не перехватили цифры и T
  document.addEventListener('keydown', function (e) {
    if (G.mode !== 'wall') return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var used = true;
    if (start && fieldA && /^[0-9.,-]$/.test(e.key)) typedA += e.key;
    else if (start && !fieldA && /^[0-9.,]$/.test(e.key)) typed += e.key;
    else if (start && !fieldA && typed && /^(м|см|мм|m|cm|mm)$/i.test(e.key)) typed += e.key;
    else if (start && fieldA && typedA && e.key === 'Backspace') typedA = typedA.slice(0, -1);
    else if (start && !fieldA && typed && e.key === 'Backspace') typed = typed.slice(0, -1);
    else if (start && e.key === 'Tab') fieldA = !fieldA;
    else if (e.key === 'F8') { orthoOn = !orthoOn; G.refreshWallsUi(); }
    else if (e.key === 'F3') { objOn = !objOn; G.refreshWallsUi(); }
    else if (e.key === 'Enter' && !start && selO >= 0) editOp();
    else if (e.key === 'Enter' && !start && sel >= 0 && !typed) wallProps();
    else if (e.key === 'Enter') {
      if (start && (typed || typedA !== '') && hover) {
        var end = typedEnd();
        if (commitSeg(start, end)) { sampleT(start, end); chainPts.push(end.slice()); start = end; typed = ''; typedA = ''; fieldA = false; sel = -1; chainN++; afterWallEdit(); closeIfLoop(); if (!chainOn) endChain(); G.refreshWallsUi(); }
      } else { start = null; typed = ''; typedA = ''; fieldA = false; }
    } else if (e.key === 'Escape') {
      if (typed || typedA !== '') { typed = ''; typedA = ''; fieldA = false; } else if (start) start = null; else { G.setMode('select'); e.stopImmediatePropagation(); return; }
    } else if (!start && e.code === 'KeyW') G.wallsTool('wall');
    else if (!start && e.code === 'KeyO') G.wallsTool('win');
    else if (!start && e.code === 'KeyD') G.wallsTool('door');
    else if ((e.key === 'Delete' || e.key === 'Del') && selO >= 0 && deleteOp()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    else if ((e.code === 'KeyT') && !start) {
      if (sel >= 0) toggleSel(); else { kind = kind === 'ext' ? 'int' : 'ext'; G.refreshWallsUi(); }
    } else if (e.key === 'Delete' || e.key === 'Del') deleteSel();
    else if (e.code === 'KeyU' || e.key === 'г' || e.key === 'Г') G.wallsViewCycle();
    else if (e.code === 'Space' && start) locFlip = !locFlip;   // Пробел: сторона линии привязки, как в Revit
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); updateHint(); G.draw(); }
  }, true);


  // ── комнаты из стен ─────────────────────────────────────────────────
  /** Пересечение отрезков строго внутри обоих (Х-узел без общего конца) или null. */
  function segInter(a, b, c, d) {
    var rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
    var den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) return null;
    var t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    var eps = 1e-3;
    if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) return [Math.round((a[0] + rx * t) * 100) / 100, Math.round((a[1] + ry * t) * 100) / 100];
    return null;
  }
  /** Стены, пересекающиеся крестом, режем в точке пересечения: комнаты строятся только по узлам. */
  function splitCrossings() {
    for (var guard = 0; guard < 60; guard++) {
      var w = walls(), hit = null;
      for (var i = 0; i < w.length && !hit; i++)
        for (var j = i + 1; j < w.length && !hit; j++) hit = segInter(w[i].a, w[i].b, w[j].a, w[j].b);
      if (!hit) return;
      splitAt(hit);
    }
  }

  var lastBridges = 0;
  /**
   * Стены для построения комнат: настоящие плюс виртуальные перемычки. Стены с подложки рвутся в дверных
   * проёмах (перегородка не доходит до соседней стены или до своего продолжения), и тогда комнаты не
   * замыкаются - весь этаж превращается в одну. Свободный конец стены продлевается по своему направлению
   * до ближайшей стены или до начала продолжения (не дальше 1,6 м); Т-узлы режутся в точке примыкания.
   * В сам план (f.walls) ничего не пишется - перемычки живут только в расчёте комнат.
   */
  function bridgedWalls() {
    var base = walls().map(function (w) { return { id: w.id, a: w.a, b: w.b, k: w.k, t: w.t }; });
    var snap = base.slice(), px = ppm(), maxG = 1.6 * px, near = 0.25 * px, virt = [], pend = [];
    function joined(e, s) {
      for (var j = 0; j < snap.length; j++) {
        var o = snap[j];
        if (o === s) continue;
        if (dist(e, o.a) < 0.6 || dist(e, o.b) < 0.6) return true;
      }
      return false;
    }
    snap.forEach(function (s) {
      [[s.a, s.b], [s.b, s.a]].forEach(function (pair) {
        var e = pair[0], f = pair[1];
        if (joined(e, s)) return;
        var l = dist(e, f);
        if (l < 1e-6) return;
        var d = [(e[0] - f[0]) / l, (e[1] - f[1]) / l], best = null;
        function take(t, p) { if (!best || t < best.t) best = { t: t, p: p }; }
        snap.forEach(function (o) {
          if (o === s) return;
          var pr = projOn(e, o.a, o.b);
          if (pr.d <= near) take(pr.d, pr.q);             // конец лёг на тело другой стены или почти дошёл до неё
          var sx = o.b[0] - o.a[0], sy = o.b[1] - o.a[1], den = d[0] * sy - d[1] * sx;
          if (Math.abs(den) > 1e-9) {                      // луч вдоль стены упирается в чужую
            var t = ((o.a[0] - e[0]) * sy - (o.a[1] - e[1]) * sx) / den, u = ((o.a[0] - e[0]) * d[1] - (o.a[1] - e[1]) * d[0]) / den;
            if (t > 0 && t <= maxG && u >= -0.02 && u <= 1.02) take(t, [e[0] + d[0] * t, e[1] + d[1] * t]);
          }
          [o.a, o.b].forEach(function (q) {                // продолжение той же линии за дверным проёмом
            var vx = q[0] - e[0], vy = q[1] - e[1], fw = vx * d[0] + vy * d[1], lat = Math.abs(vx * d[1] - vy * d[0]);
            if (fw > 0 && fw <= maxG && lat <= near) take(fw, q);
          });
        });
        if (best) pend.push({ e: e, p: best.p, k: s.k === 'ext' ? 'ext' : 'int' });
      });
    });
    function splitList(pt) {
      var out = [];
      base.forEach(function (s) {
        var pr = projOn(pt, s.a, s.b);
        if (pr.d < 1.5 && dist(pt, s.a) > 0.6 && dist(pt, s.b) > 0.6) {
          out.push({ id: s.id, a: s.a, b: [pt[0], pt[1]], k: s.k }, { id: s.id, a: [pt[0], pt[1]], b: s.b, k: s.k });
        } else out.push(s);
      });
      base = out;
    }
    pend.forEach(function (b) {
      var p = b.p;
      // цель у конца чужой стены - берём сам конец, чтобы узлы совпали
      base.forEach(function (s) { [s.a, s.b].forEach(function (q) { if (dist(p, q) < 1.5) p = q; }); });
      splitList(p);
      if (dist(b.e, p) < 0.6) return;
      var dup = virt.some(function (v) { return (dist(v.a, b.e) < 0.6 && dist(v.b, p) < 0.6) || (dist(v.a, p) < 0.6 && dist(v.b, b.e) < 0.6); });
      if (!dup) virt.push({ id: 'v' + virt.length, a: b.e, b: [p[0], p[1]], k: b.k, virt: true });
    });
    lastBridges = virt.length;
    return base.concat(virt);
  }

  /**
   * Грани графа стен: замкнутые контуры комнат по осям стен. Обход «поворот направо» даёт
   * внутренние грани с положительной площадью (формула шнурка в координатах экрана), внешняя
   * грань здания отрицательна и отбрасывается. Каждая грань несёт толщины своих сторон.
   */
  function buildFaces() {
    var ws = bridgedWalls(), nodes = [], map = {}, out = [], half = [], i;
    function nodeId(p) {
      var key = Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
      if (!(key in map)) { map[key] = nodes.length; nodes.push([p[0], p[1]]); out.push([]); }
      return map[key];
    }
    ws.forEach(function (sw) {
      var u = nodeId(sw.a), v = nodeId(sw.b);
      if (u === v) return;
      var h1 = { u: u, v: v, w: sw, ang: Math.atan2(nodes[v][1] - nodes[u][1], nodes[v][0] - nodes[u][0]) };
      var h2 = { u: v, v: u, w: sw, ang: Math.atan2(nodes[u][1] - nodes[v][1], nodes[u][0] - nodes[v][0]) };
      h1.tw = h2; h2.tw = h1; out[u].push(h1); out[v].push(h2); half.push(h1, h2);
    });
    out.forEach(function (l) { l.sort(function (a, b) { return a.ang - b.ang; }); });
    function nextOf(h) {
      var l = out[h.v], k = l.indexOf(h.tw);
      return l[(k - 1 + l.length) % l.length];
    }
    var faces = [], outerIds = {}, outerCyc = [];
    half.forEach(function (h0) {
      if (h0.seen) return;
      var cyc = [], h = h0, guard = 0;
      while (!h.seen && guard++ < 10000) { h.seen = true; cyc.push(h); h = nextOf(h); }
      if (h !== h0 || cyc.length < 3) return;
      var sa = 0;
      cyc.forEach(function (e) { var a = nodes[e.u], b = nodes[e.v]; sa += a[0] * b[1] - b[0] * a[1]; });
      if (sa > 0) faces.push(cyc);
      else if (sa < 0) { cyc.forEach(function (e) { outerIds[e.w.id] = 1; }); outerCyc.push(cyc.map(function (e) { return nodes[e.u]; })); }
    });
    // шипы: стена-тупик внутри комнаты обходится туда и обратно
    var res = faces.map(function (cyc) {
      var c = cyc.slice(), changed = true;
      while (changed && c.length > 2) {
        changed = false;
        for (var k = 0; k < c.length; k++) {
          var n2 = c[(k + 1) % c.length];
          if (c[k].tw === n2) { var rm = [k, (k + 1) % c.length].sort(function (a, b) { return b - a; }); c.splice(rm[0], 1); c.splice(rm[1], 1); changed = true; break; }
        }
      }
      return c.length >= 3 ? { edges: c, nodes: nodes } : null;
    }).filter(Boolean);
    res.outerIds = outerIds; res.outerCyc = outerCyc;
    return res;
  }

  /** Тип стен по внешней грани графа: прилегает к улице - наружная, иначе внутренняя. */
  function markExterior() {
    var o = buildFaces().outerIds;
    walls().forEach(function (w) { w.k = o[w.id] ? 'ext' : 'int'; });
  }

  /**
   * Импорт стен, найденных по подложке (plan_trace.js): отрезки в пикселях плана с толщиной t (м) и проёмами
   * ({ o, w, k }: смещение центра от начала, ширина, 'door' | 'win'). Тип стен выводится по внешнему контуру.
   * Одним шагом отмены. Возвращает сводку для подсказки.
   */
  G.wallsImport = function (segs, opts) {
    var f = F();
    G.pushUndo('walls');
    if (opts && opts.replace) { f.walls = []; f.openings = []; }
    var tmap = {};
    segs.forEach(function (sg) {
      var id = nextId();
      walls().push({ id: id, a: [Math.round(sg.a[0] * 10) / 10, Math.round(sg.a[1] * 10) / 10], b: [Math.round(sg.b[0] * 10) / 10, Math.round(sg.b[1] * 10) / 10], k: 'int' });
      tmap[id] = sg.t;
      (sg.opens || []).forEach(function (op) {
        var win = op.k === 'win';
        ops().push({ id: nextOid(), wid: id, o: op.o, k: win ? 'win' : 'door', w: op.w, h: win ? 1.4 : 2.1, sill: win ? 0.8 : 0, guess: true });
      });
    });
    // Т-узлы: конец стены лежит на теле другой - режем её; затем кресты
    walls().slice().forEach(function (sw) { splitAt(sw.a); splitAt(sw.b); });
    splitCrossings();
    markExterior();
    var st = G.wallsStats(), thickExt = [], thickInt = [];
    walls().forEach(function (w) { var t = tmap[w.id]; if (t) (w.k === 'ext' ? thickExt : thickInt).push(t); });
    afterWallEdit();
    G.refreshWallsUi(); G.draw();
    return { n: st.n, ext: st.ext, int: st.int, opens: (F().openings || []).length, thickExt: thickExt, thickInt: thickInt };
  };



  /** Контур по внутренним граням: каждая сторона сдвигается внутрь на половину толщины своей стены. */
  function netPolygon(face) {
    var nodes = face.nodes, E = face.edges, n = E.length, i;
    var P = E.map(function (e) { return nodes[e.u]; });
    var T = E.map(function (e) { return thickPx(e.w) / 2; });
    // вершины на одной прямой при равной толщине — лишние (следы Т-узлов других стен)
    var keep = [];
    for (i = 0; i < n; i++) {
      var pr = (i - 1 + n) % n, a = P[pr], b = P[i], c = P[(i + 1) % n];
      var cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      var dt = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (Math.abs(cr) < 1e-6 && dt > 0 && Math.abs(T[pr] - T[i]) < 1e-6) continue;
      keep.push(i);
    }
    if (keep.length < 3) return null;
    var Q = keep.map(function (k) { return P[k]; }), H = keep.map(function (k) { return T[k]; }), m = Q.length;
    var N = [], D = [];
    for (i = 0; i < m; i++) {
      var p1 = Q[i], p2 = Q[(i + 1) % m], dx = p2[0] - p1[0], dy = p2[1] - p1[1], l = Math.hypot(dx, dy) || 1;
      D.push([dx / l, dy / l]); N.push([-dy / l, dx / l]);
    }
    var res = [];
    for (i = 0; i < m; i++) {
      var q = (i - 1 + m) % m, d1 = D[q], d2 = D[i];
      var o1 = [Q[i][0] + N[q][0] * H[q], Q[i][1] + N[q][1] * H[q]];
      var o2 = [Q[i][0] + N[i][0] * H[i], Q[i][1] + N[i][1] * H[i]];
      var den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-6) { res.push(o1, o2); continue; }   // стороны параллельны, толщины разные: ступенька
      var t = ((o2[0] - o1[0]) * d2[1] - (o2[1] - o1[1]) * d2[0]) / den;
      res.push([o1[0] + d1[0] * t, o1[1] + d1[1] * t]);
    }
    return res.map(function (r) { return [Math.round(r[0] * 10) / 10, Math.round(r[1] * 10) / 10]; });
  }

  function polyArea(P) {
    var a = 0;
    for (var i = 0; i < P.length; i++) { var p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return a / 2;
  }
  function inside(pt, P) {
    var inn = false;
    for (var a = 0, b = P.length - 1; a < P.length; b = a++)
      if ((P[a][1] > pt[1]) !== (P[b][1] > pt[1]) && pt[0] < (P[b][0] - P[a][0]) * (pt[1] - P[a][1]) / (P[b][1] - P[a][1]) + P[a][0]) inn = !inn;
    return inn;
  }
  /** Точка, заведомо лежащая внутри контура: середина самого длинного отрезка по горизонтали через центр. */
  function interiorPoint(P) {
    var cx0 = 0, cy0 = 0, A = 0, i;
    for (i = 0; i < P.length; i++) {
      var p = P[i], q = P[(i + 1) % P.length], c = p[0] * q[1] - q[0] * p[1];
      A += c; cx0 += (p[0] + q[0]) * c; cy0 += (p[1] + q[1]) * c;
    }
    var g = A ? [cx0 / (3 * A), cy0 / (3 * A)] : P[0];
    if (inside(g, P)) return [Math.round(g[0]), Math.round(g[1])];
    var xs = [];
    for (i = 0; i < P.length; i++) {
      var a = P[i], b = P[(i + 1) % P.length];
      if ((a[1] > g[1]) !== (b[1] > g[1])) xs.push(a[0] + (g[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    }
    xs.sort(function (x, y) { return x - y; });
    var best = null, bl = -1;
    for (i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > bl) { bl = xs[i + 1] - xs[i]; best = (xs[i] + xs[i + 1]) / 2; }
    return [Math.round(best == null ? P[0][0] : best), Math.round(g[1])];
  }

  function r2(x) { return Math.round(x * 100) / 100; }
  /** Стена, на которой лежит сторона контура комнаты: ось в пределах половины толщины и параллельна. */
  function wallHost(mid, u) {
    var best = null, bd = 1e9;
    walls().forEach(function (sw) {
      var pr = projOn(mid, sw.a, sw.b), lim = thickPx(sw) / 2 + 3;
      if (pr.d > lim || pr.d >= bd) return;
      var dx = sw.b[0] - sw.a[0], dy = sw.b[1] - sw.a[1], l = Math.hypot(dx, dy) || 1;
      if (Math.abs(dx * u[1] - dy * u[0]) / l < 0.2) { bd = pr.d; best = sw; }
    });
    return best;
  }
  /**
   * Геометрия комнаты для расчёта (по внутреннему контуру): периметр, длина наружных стен и направления
   * наружу, окна и двери на этих стенах. Уходит в зону (z.geo), калькулятор читает её из планов.
   * Нормали - в координатах экрана (вправо x, вниз y): сторону света из них выводит калькулятор по компасу.
   */
  function geoOf(pts) {
    var n = pts.length, per = 0, outer = 0, ext = [], extW = [], i, segs = [];
    for (i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      if (l < 1e-6) continue;
      var u = [dx / l, dy / l], h = wallHost([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], u);
      per += l;
      segs.push({ a: a, b: b, h: h });
      if (h && h.k !== 'int') {
        outer += l; ext.push([r2(l / ppm()), r2(u[1]), r2(-u[0])]);
        // материал задан на плане явно - длина, толщина (м) и материал уходят в расчёт теплопотерь
        if (h.mat) extW.push(h.ins ? { l: r2(l / ppm()), t: r2(wallT(h)), mat: h.mat, ins: h.ins } : { l: r2(l / ppm()), t: r2(wallT(h)), mat: h.mat });
      }
    }
    var wins = [], dExt = 0, dInt = 0;
    ops().forEach(function (o) {
      var g = opGeom(o);
      if (!g) return;
      for (var j = 0; j < segs.length; j++) {
        var sg = segs[j];
        if (!sg.h) continue;
        var pr = projOn(g.c, sg.a, sg.b);
        if (pr.d > g.t / 2 + 3 || pr.t <= 0 || pr.t >= 1) continue;
        var sl = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) || 1;
        if (o.k === 'win') {
          if (sg.h.k !== 'int') wins.push({ w: r2(o.w), h: r2(o.h), sill: r2(o.sill || 0), ox: r2((sg.b[1] - sg.a[1]) / sl), oy: r2(-(sg.b[0] - sg.a[0]) / sl) });
        } else if (sg.h.k !== 'int') dExt++; else dInt++;
        break;
      }
    });
    return { v: 1, perim: r2(per / ppm()), outer: r2(outer / ppm()), ext: ext, wins: wins, doorsExt: dExt, doorsInt: dInt, extW: extW,
      t: [r2(extT()), r2(intT())] };
  }

  /** Все комнаты этажа по стенам: [{ pts, seed, m2 }], крошечные грани (< 0,5 м2) отброшены. */
  function roomsFromWalls() {
    var out = [];
    buildFaces().forEach(function (f) {
      var pts = netPolygon(f);
      if (!pts || pts.length < 3) return;
      var m2 = Math.abs(polyArea(pts)) / (ppm() * ppm());
      if (m2 < 0.5) return;
      out.push({ pts: pts, seed: interiorPoint(pts), m2: m2, geo: geoOf(pts) });
    });
    // Перегородки между комнатами: с какой комнатой и сколько метров общей стены. По ним калькулятор считает теплообмен
    // между соседями, если у них разная расчётная температура (geo.int = [{ l: м, p: точка внутри соседней комнаты }]).
    out.forEach(function (rm, i) {
      var agg = {}, n = rm.pts.length, k;
      for (k = 0; k < n; k++) {
        var a = rm.pts[k], b = rm.pts[(k + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
        if (l < 1e-6) continue;
        var u = [dx / l, dy / l], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], h = wallHost(mid, u);
        if (!h || h.k !== 'int') continue;
        var off = thickPx(h) / 2 + 0.12 * ppm(), nx = -u[1], ny = u[0], j;
        for (j = 0; j < out.length; j++) {
          if (j === i) continue;
          var q1 = [mid[0] + nx * off, mid[1] + ny * off], q2 = [mid[0] - nx * off, mid[1] - ny * off];
          if (inside(q1, out[j].pts) || inside(q2, out[j].pts)) { agg[j] = (agg[j] || 0) + l; break; }
        }
      }
      rm.geo.int = Object.keys(agg).map(function (j) { return { l: r2(agg[j] / ppm()), p: out[j].seed }; });
    });
    return out;
  }

  /**
   * Зоны «Помещение» по стенам. create=true — завести недостающие; иначе только подтянуть контуры уже
   * созданных из стен (после правки стен). Зона связана с гранью точкой внутри (seed): имя и тип остаются.
   * Возвращает { made, kept, gone }.
   */
  function syncRooms(create) {
    var f = F(), faces = roomsFromWalls(), used = {}, made = 0, kept = 0, gone = 0;
    var mine = (f.zones || []).filter(function (z) { return z.src === 'walls'; });
    if (!create && !mine.length) return { made: 0, kept: 0, gone: 0 };
    mine.forEach(function (z) {
      var hit = -1;
      faces.forEach(function (fc, i) {
        if (hit >= 0 || used[i]) return;
        if ((z.seed && inside(z.seed, fc.pts)) || inside(fc.seed, z.pts)) hit = i;
      });
      if (hit < 0) { f.zones.splice(f.zones.indexOf(z), 1); gone++; return; }
      used[hit] = 1; z.pts = faces[hit].pts; z.seed = faces[hit].seed; z.geo = faces[hit].geo; kept++;
    });
    if (create) faces.forEach(function (fc, i) {
      if (used[i]) return;
      // комната, уже найденная по картинке или обведённая рукой: не дублируем, а привязываем к стенам
      // (имя, тип и отметки остаются, контур и геометрия для расчёта берутся из стен)
      var old = f.zones.filter(function (z) { return z.type !== 'cold' && z.src !== 'walls' && inside(fc.seed, z.pts); })[0];
      if (old) { old.pts = fc.pts; old.seed = fc.seed; old.geo = fc.geo; old.src = 'walls'; kept++; return; }
      if (f.zones.some(function (z) { return z.type !== 'cold' && inside(fc.seed, z.pts); })) return;
      f.zones.push({ type: 'room', name: '', pts: fc.pts, src: 'walls', seed: fc.seed, geo: fc.geo }); made++;
    });
    return { made: made, kept: kept, gone: gone };
  }
  function afterWallEdit() {
    try { delete G.maskCache[G.cur]; delete G.winCache[G.cur]; if (G.loopCache) G.loopCache.key = null; } catch (e) { }
    try { splitCrossings(); syncRooms(false); } catch (e) { console.error('[plan_walls] комнаты:', e); }
    if (G.renderZones) G.renderZones();
  }

  G.wallsMakeRooms = function () {
    var f = F();
    if (!walls().length) { hintWall('Сначала нарисуйте стены: комнаты берутся из замкнутых контуров.'); return; }
    var n0 = (f.zones || []).length;
    G.pushUndo('zones');
    var r = syncRooms(true);
    if (G.renderZones) G.renderZones();
    G.draw(); G.refreshWallsUi();
    var total = roomsFromWalls();
    if (!total.length) { hintWall('Замкнутых контуров нет: стены нигде не замыкаются в комнату. Проверьте, что углы сошлись (зелёный кружок при наведении).'); if (G.undoStack.length && (f.zones || []).length === n0) G.undoStack.pop(); return; }
    hintWall('<span class=ok>Комнаты по стенам:</span> новых ' + r.made + ', обновлено ' + r.kept + (r.gone ? ', убрано ' + r.gone : '') +
      (lastBridges ? '. Проёмы в перегородках (' + lastBridges + ') замкнуты автоматически' : '') +
      '. Впишите названия справа - по ним комнаты уйдут в расчёт.');
  };
  G.wallsRoomsCount = function () { try { return roomsFromWalls().length; } catch (e) { return 0; } };
  G.wallsFaces = roomsFromWalls;

  // ── команды шага «Стены» ────────────────────────────────────────────
  G.wallsKind = function (kd) { kind = kd === 'int' ? 'int' : 'ext'; tool = 'wall'; if (G.mode !== 'wall') G.setMode('wall'); updateHint(); G.refreshWallsUi(); };
  G.wallsTool = function (t) {
    tool = t === 'win' || t === 'door' || t === 'move' || t === 'size' ? t : 'wall';
    gateMode = false;
    start = null; typed = ''; typedA = ''; fieldA = false; hoverO = null; sel = -1; selO = -1;
    if (G.mode !== 'wall') G.setMode('wall');
    updateHint(); G.refreshWallsUi(); G.draw();
  };

  /** Сдвинуть готовый наружный контур внутрь (dir 1) или наружу (-1) на половину толщины наружной стены. */
  G.wallsShiftOuter = function (dir) {
    var oc = buildFaces().outerCyc;
    if (!oc || oc.length !== 1) { hintWall('Сдвигать нечего: нет одного замкнутого наружного контура.'); return; }
    var P = oc[0], seen = {}, dup = false;
    P.forEach(function (q) { var kk = Math.round(q[0]) + ',' + Math.round(q[1]); if (seen[kk]) dup = true; seen[kk] = 1; });
    if (dup) { hintWall('Контур с «хвостами» (стена-тупик снаружи): сначала уберите лишние стены.'); return; }
    if (!shiftContourInward(P.map(function (q) { return q.slice(); }), dir < 0 ? -1 : 1, 0)) { hintWall('Не удалось сдвинуть контур.'); return; }
    G.refreshWallsUi(); G.draw();
    hintWall('<span class=ok>Контур сдвинут ' + (dir < 0 ? 'наружу' : 'внутрь') + ' на ' + fm2(extT() * 50) + ' см.</span> Ctrl+Z вернёт.');
  };
  G.wallsRefGet = function () { return refMode; };
  G.wallsRefToggle = function () { refMode = refMode === 'outer' ? 'axis' : 'outer'; updateHint(); G.refreshWallsUi(); G.draw(); };
  G.wallsSnapGet = function () { return imgSnapOn; };
  G.wallsSnapToggle = function () { imgSnapOn = !imgSnapOn; updateHint(); G.refreshWallsUi(); G.draw(); };
  G.wallsToolGet = function () { return tool; };
  G.wallsKindGet = function () { return kind; };
  G.wallsStart = function () { if (G.mode !== 'wall') G.setMode('wall'); updateHint(); };

  G.wallsClear = function () {
    if (!walls().length) return;
    if (!confirm('Убрать все стены на этом этаже?')) return;
    G.pushUndo('walls');
    F().walls = []; F().openings = []; sel = -1; selO = -1; reset(); afterWallEdit(); G.refreshWallsUi(); G.draw();
  };

  /** Контур дома по размерам: ширина × глубина, четыре наружные стены по центру листа. */
  G.wallsRectPrompt = function () {
    var f = F();
    if (!f.pxPerM) { alert('Сначала задайте масштаб.'); return; }
    G.askText({
      title: 'Контур дома', sub: 'Ширина × глубина: 10x8 — в метрах, 1000x800 — в сантиметрах.',
      chips: [{ v: '8x10' }, { v: '10x10' }, { v: '12x9' }], def: '10x8',
      live: function (v) { var d = parseDims(v); return d ? 'Контур ' + fmtDim(d[0]) + ' × ' + fmtDim(d[1]) + ' м' : (v ? 'Пример: 10x8' : ''); }
    }, function (v) {
      var d = parseDims(v);
      if (!d) return;
      var W = d[0] * ppm(), H = d[1] * ppm(), g = GRID_M * ppm();
      var x0 = Math.round((f.w / 2 - W / 2) / g) * g, y0 = Math.round((f.h / 2 - H / 2) / g) * g;
      var P = [[x0, y0], [x0 + W, y0], [x0 + W, y0 + H], [x0, y0 + H]];
      G.pushUndo('walls');
      for (var i = 0; i < 4; i++) walls().push({ id: nextId(), a: P[i].slice(), b: P[(i + 1) % 4].slice(), k: 'ext' });
      reset(); G.setMode('select'); G.refreshWallsUi(); G.draw();
    });
  };
  function fmtDim(x) { return String(Math.round(x * 100) / 100).replace('.', ','); }
  function parseDims(v) {
    var m = String(v || '').split(/[x×х*]/i);
    if (m.length !== 2) return null;
    var a = parseLen(m[0]), b = parseLen(m[1]);
    return a > 0 && b > 0 && a < 100 && b < 100 ? [a, b] : null;
  }

  /** Лист: белый фон и сетка (в тёмном виде плана белое инвертируется, и без сетки поле было сплошь чёрным). 100 px = 1 м. */
  function blankCanvas(w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (var x = 0, i = 0; x <= w; x += 50, i++) { g.fillStyle = i % 10 === 0 ? '#9aa0a6' : i % 2 === 0 ? '#d3d6da' : '#eceef0'; g.fillRect(x, 0, i % 10 === 0 ? 2 : 1, h); }
    for (var y = 0, j = 0; y <= h; y += 50, j++) { g.fillStyle = j % 10 === 0 ? '#9aa0a6' : j % 2 === 0 ? '#d3d6da' : '#eceef0'; g.fillRect(0, y, w, j % 10 === 0 ? 2 : 1); }
    return c;
  }
  /** force: на этаже уже есть подложка - после подтверждения она и разметка по ней убираются (шаг назад вернёт). */
  G.wallsBlankSheet = function (force) {
    var f = F();
    if (f.img) {
      if (!force) return;
      if (!window.confirm('Подложка этого этажа будет убрана, комнаты и стены по ней тоже. Рисовать с нуля по размерам? Вернуть можно кнопкой «Шаг назад».')) return;
      G.pushUndo('plan');
      f.zones = []; f.rads = []; f.walls = []; f.openings = []; delete f.roomMask; delete f.scaleSrc;
    }
    var c = blankCanvas(2000, 1400);
    if (!force) G.pushUndo('plan');
    f.img = c.toDataURL('image/png'); f.imgFile = null;
    f.w = c.width; f.h = c.height; f.pxPerM = 100; f.scaleSrc = 'manual'; f.blank = true;
    delete G.imgCache[G.cur]; delete G.imgFailed[G.cur];
    if (G.maskCache) delete G.maskCache[G.cur];
    if (G.PJ && G.pjGo) { G.draw(); G.renderZones(); G.pjGo('walls'); }   // режим «Выпуск проекта» - свой мастер
    else { G.setWzStep('walls'); G.draw(); G.renderZones(); G.wzGo('walls'); }
    // сначала общие размеры дома, потом комнаты уточняются
    setTimeout(function () { try { G.wallsRectPrompt(); } catch (e) { } }, 120);
  };

  G.wallsOnMode = function (m) { if (m !== 'wall') { start = null; hover = null; typed = ''; typedA = ''; fieldA = false; drag = null; sel = -1; selO = -1; hoverO = null; odrag = null; ohandle = null; mdrag = null; hoverW = -1; tool = 'wall'; } else updateHint(); };
  G.wallsDraw = wallsDraw;
  G.wallsCount = function () { return (F().walls || []).length; };
  G.wallsStats = function () {
    var e = 0, i = 0;
    (F().walls || []).forEach(function (s) { if (s.k === 'int') i += dist(s.a, s.b); else e += dist(s.a, s.b); });
    var nw = 0, nd = 0, nde = 0, ng = 0;
    (F().openings || []).forEach(function (o) {
      var s = wallById(o.wid);
      if (o.k === 'gate') ng++;
      if (o.k === 'win') nw++; else { nd++; if (s && s.k === 'ext') nde++; }
    });
    return { ext: e / ppm(), int: i / ppm(), n: (F().walls || []).length, wins: nw, doors: nd, doorsExt: nde, gates: ng };
  };

  // Пустой лист хранится без картинки, если она не влезла в хранилище: после загрузки рисуем его заново
  (function restoreBlank() {
    var fixed = false;
    (G.DATA && G.DATA.floors || []).forEach(function (f, i) {
      if (!f.blank || f.img) return;
      var c = blankCanvas(f.w || 2000, f.h || 1400);
      f.img = c.toDataURL('image/png'); f.w = c.width; f.h = c.height;
      delete G.imgCache[i]; fixed = true;
    });
    if (fixed) setTimeout(function () { G.draw(); }, 0);
  })();

  /**
   * Данные для 3D-вида (plan_3d.js): по каждому этажу - стены в метрах с толщиной и проёмами, зоны, радиаторы.
   * Высоты этажей из калькулятора (h1, h2), по умолчанию 2,7 м.
   */
  G.walls3d = function () {
    var heights = [2.7, 2.7];
    try {
      var st = JSON.parse(localStorage.getItem('stout_save'));
      if (st && +st.h1 > 1.5) heights[0] = +st.h1;
      if (st && +st.h2 > 1.5) heights[1] = +st.h2;
    } catch (e) { }
    var was = G.cur, out = [];
    (G.DATA.floors || []).forEach(function (f, i) {
      G.cur = i;
      try {
        var pm = ppm(), cnt = {};
        function key(e) { return Math.round(e[0]) + ',' + Math.round(e[1]); }
        walls().forEach(function (sw) { [sw.a, sw.b].forEach(function (e) { cnt[key(e)] = (cnt[key(e)] || 0) + 1; }); });
        var ws = walls().map(function (sw) {
          var t = thickPx(sw) / pm;
          return {
            a: [sw.a[0] / pm, sw.a[1] / pm], b: [sw.b[0] / pm, sw.b[1] / pm], k: sw.k, t: t, mat: sw.mat || '', matC: (WALL_MATS.filter(function (x) { return x[1] === sw.mat; })[0] || [0, 0, 0])[2],
            ea: cnt[key(sw.a)] > 1 ? t / 2 : 0, eb: cnt[key(sw.b)] > 1 ? t / 2 : 0,
            ops: ops().filter(function (o) { return o.wid === sw.id; }).map(function (o) { return { o: o.o, w: o.w, h: o.h, sill: o.sill || 0, k: o.k }; })
          };
        });
        out.push({
          i: i, h: heights[Math.min(i, 1)], ppm: pm, walls: ws, north: f.north,
          zones: (f.zones || []).filter(function (z) { return z.pts && z.pts.length > 2; }).map(function (z) {
            return { type: z.type, name: z.name || '', pts: z.pts.map(function (q) { return [q[0] / pm, q[1] / pm]; }),
              seed: z.seed ? [z.seed[0] / pm, z.seed[1] / pm] : null };
          }),
          rads: (f.rads || []).map(function (r) { return { x: r.x / pm, y: r.y / pm, w: (r.w || 0) / pm || 0.8, ang: r.ang || 0 }; })
        });
      } finally { G.cur = was; }
    });
    return out;
  };

  /**
   * Тело стен этажа четырёхугольниками в пикселях плана, проёмы вырезаны. Тот же разбор на куски, что и при рисовании.
   */
  function quadsOf(f) {
    var pm = f.pxPerM || 100, out = [], cnt = {};
    function key(e) { return Math.round(e[0]) + ',' + Math.round(e[1]); }
    (f.walls || []).forEach(function (sw) { [sw.a, sw.b].forEach(function (e) { cnt[key(e)] = (cnt[key(e)] || 0) + 1; }); });
    (f.walls || []).forEach(function (sw) {
      var t = wallT(sw) * pm, dx = sw.b[0] - sw.a[0], dy = sw.b[1] - sw.a[1], l = Math.hypot(dx, dy) || 1;
      var ux = dx / l, uy = dy / l, nx = -uy, ny = ux, h = t / 2;
      var ea = cnt[key(sw.a)] > 1 ? h : 0, eb = cnt[key(sw.b)] > 1 ? h : 0;
      var cuts = (f.openings || []).filter(function (o) { return o.wid === sw.id; }).map(function (o) { return [o.o * pm - o.w * pm / 2, o.o * pm + o.w * pm / 2]; })
        .sort(function (p, q) { return p[0] - q[0]; });
      var at = -ea, end = l + eb, pcs = [];
      cuts.forEach(function (c) { if (c[0] > at) pcs.push([at, Math.min(c[0], end)]); at = Math.max(at, c[1]); });
      if (at < end) pcs.push([at, end]);
      pcs.forEach(function (pc) {
        var A = [sw.a[0] + ux * pc[0], sw.a[1] + uy * pc[0]], B = [sw.a[0] + ux * pc[1], sw.a[1] + uy * pc[1]];
        out.push([[A[0] + nx * h, A[1] + ny * h], [B[0] + nx * h, B[1] + ny * h], [B[0] - nx * h, B[1] - ny * h], [A[0] - nx * h, A[1] - ny * h]]);
      });
    });
    return out;
  }

  /**
   * Нарисованные стены - в маску стен редактора (getMask). На пустом листе подложки нет, и без этого «комната по клику»,
   * прилипание, трассы воды и канализации не видели бы стен. Проёмы остаются проходами.
   */
  G.wallsRasterize = function (f, bar, W, H, kk) {
    if (!(f.walls && f.walls.length)) return;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = '#000';
    quadsOf(f).forEach(function (q) {
      g.beginPath(); g.moveTo(q[0][0] * kk, q[0][1] * kk);
      for (var i = 1; i < 4; i++) g.lineTo(q[i][0] * kk, q[i][1] * kk);
      g.closePath(); g.fill();
    });
    var d = g.getImageData(0, 0, W, H).data;
    for (var i = 0, p = 3; i < bar.length; i++, p += 4) if (d[p] > 90) bar[i] = 1;
  };

  /**
   * Окна для расстановки радиаторов: по нарисованным окнам, а не по растру. Центр радиатора смещён к комнате
   * (половина толщины стены + запас), ширина 75 % окна, ang - направление стены в градусах.
   */
  G.wallsWindowList = function () {
    var f = F(), out = [], pm = ppm();
    (f.openings || []).forEach(function (o) {
      if (o.k !== 'win') return;
      var g = opGeom(o);
      if (!g) return;
      var side = 0, pip = G.pip;
      [1, -1].forEach(function (sd) {
        if (side) return;
        var pt = [g.c[0] + g.nx * sd * 0.5 * pm, g.c[1] + g.ny * sd * 0.5 * pm];
        if ((f.zones || []).some(function (z) { return z.type !== 'cold' && z.pts && pip && pip(pt, z.pts); })) side = sd;
      });
      var sh = side ? side * (g.t / 2 + 0.05 * pm) : 0;
      out.push({ x: g.c[0] + g.nx * sh, y: g.c[1] + g.ny * sh, w: Math.round(0.75 * g.wpx), ang: Math.round(Math.atan2(g.uy, g.ux) * 1800 / Math.PI) / 10,
        ow: g.wpx, sill: o.sill || 0, h: o.h, vec: true });
    });
    return out;
  };

  // Пирог стены поменяли в калькуляторе - контуры комнат из стен пересчитываются при открытии редактора
  (function resyncAll() {
    var was = G.cur, any = false;
    (G.DATA && G.DATA.floors || []).forEach(function (f, i) {
      if (!(f.walls && f.walls.length) || !(f.zones || []).some(function (z) { return z.src === 'walls'; })) return;
      var t = [r2(extT()), r2(intT())];
      var old = (f.zones.filter(function (z) { return z.src === 'walls' && z.geo; })[0] || {}).geo;
      if (old && old.t && old.t[0] === t[0] && old.t[1] === t[1]) return;
      G.cur = i;
      try { syncRooms(false); any = true; } catch (e) { console.error('[plan_walls] пересчёт:', e); }
    });
    G.cur = was;
    if (any) setTimeout(function () { if (G.renderZones) G.renderZones(); G.draw(); }, 0);
  })();

  // ── интерфейс для ленты и инструментов правки (plan_revit.js) ───────
  G.wallsLoc = function (v) { locMode = v === 'o' || v === 'i' ? v : 'c'; locFlip = false; updateHint(); G.draw(); };
  /** Готовый размер проёма из панели параметров: окно, панорамное окно, дверь, гаражные ворота. */
  G.wallsOpenPreset = function (k, w, h, sill) {
    if (k === 'gate') { tool = 'door'; gateMode = true; SIZE.gate = [w, h, sill || 0]; }
    else { gateMode = false; SIZE[k] = [w, h, sill || 0]; }
    hoverO = null; updateHint(); G.draw();
  };
  G.wallsLocGet = function () { return locMode; };
  G.wallsOff = function (m) { locOffM = isFinite(m) ? m : 0; G.draw(); };
  G.wallsOffGet = function () { return locOffM; };
  G.wallsChain = function (v) { chainOn = !!v; if (!chainOn && start) endChain(); G.draw(); };
  G.wallsChainGet = function () { return chainOn; };
  G.wallsOrthoGet = function () { return orthoOn; };
  G.wallsOrthoToggle = function () { orthoOn = !orthoOn; G.draw(); };
  G.wallsObjGet = function () { return objOn; };
  G.wallsObjToggle = function () { objOn = !objOn; G.draw(); };
  G.wallsKindSet = function (kd) { kind = kd === 'int' ? 'int' : 'ext'; updateHint(); };
  G.wallsDrawingState = function () { return { start: start, hover: hover, typed: typed, kind: kind, tool: tool }; };
  G.wallsClearHover = function () { hover = null; hoverW = -1; hoverO = null; guides = []; };
  G.WI = {
    walls: walls, ops: ops, ppm: ppm, k: k, dist: dist, projOn: projOn, snap: snap, addWall: addWall, splitAt: splitAt,
    nextId: nextId, nextOid: nextOid, afterWallEdit: afterWallEdit, thickPx: thickPx, wallAt: wallAt, opAt: opAt, opGeom: opGeom, opPlace: opPlace,
    wallById: wallById, wlen: wlen, moveNode: moveNode, moveWallBy: moveWallBy, lineOf: lineOf, clampOps: clampOps, pruneOps: pruneOps, ptEq: ptEq, r1: r1,
    fmtM: fmtM, fm2: fm2, parseLen: parseLen, hintWall: hintWall, intT: intT, extT: extT, endpointAt: endpointAt,
    drawTempDim: drawTempDim, drawGlyph: drawGlyph, locD: locD, offSeg: offSeg, lineInter: lineInter, DIMC: DIMC,
    editOp: function (i) { var ob = ops()[i]; if (ob) { selO = i; editOp(); } },
    askWallLen: askWallLen, wallIndexById: wallIndexById, GRID_M: GRID_M, SIZE: SIZE,
    setLegacySel: function (si, oi) { sel = si; selO = oi; },
    toggleKind: function (id) { var sw = wallById(id); if (sw) sw.k = sw.k === 'int' ? 'ext' : 'int'; },
    getKind: function () { return kind; }, getTool: function () { return tool; }, setTool: function (t) { tool = t; gateMode = false; start = null; typed = ''; typedA = ''; fieldA = false; hoverO = null; sel = -1; selO = -1; hover = null; },
    isDrawing: function () { return !!start; }, updateHint: updateHint, looseEnds: looseEnds, bboxOf: bboxOf
  };

  // draw() рисует всё остальное — стены поверх
  var baseDraw = G.draw;
  G.draw = function () { baseDraw.apply(this, arguments); try { wallsDraw(); } catch (e) { console.error('[plan_walls]', e); } };
})(window);
