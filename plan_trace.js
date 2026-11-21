/**
 * plan_trace.js - «Обвести по подложке» (этап 6): стены из растра плана без распознавания моделью.
 *
 * Берёт ту же карту тёмных пикселей, что и «зона по клику» (getMask), и ищет в ней стены, идущие по горизонтали
 * и вертикали (так нарисовано почти любое жилое здание):
 *  - залитая стена - полоса тёмных пикселей толщиной 7-65 см;
 *  - стена двойной линией - две тонкие параллельные линии на расстоянии 7-60 см (так её рисуют в САПР).
 * Полосы собираются по строкам (и по столбцам) из длинных прямых отрезков, склеиваются через проёмы,
 * концы подтягиваются к осям встречных стен. Одиночные линии (размерные цепочки, мебель) отбрасываются:
 * стена должна связываться с другими стенами. Разрыв в стене до 3,2 м становится проёмом (дверь или окно по
 * ширине), чтобы контур комнаты замкнулся; тип проёма - догадка, правится рукой.
 *
 * Результат кладётся в f.walls через wallsImport (plan_walls.js), отменяется Ctrl+Z одним шагом.
 * Наклонные стены не ищутся: их дорисовывают руками.
 */
(function (G) {
  'use strict';

  if (!G.wallsEnabled) return;   // только при включённой отрисовке ТП (см. plan_walls.js)

  var MAXGAP_M = 3.2;        // разрыв, который считаем проёмом
  var MINGAP_M = 0.5;        // меньше - просто склеиваем (штриховка, обрыв линии, простенок между окнами)
  var MIN_WALL_M = 0.8;      // короче стену не заводим
  var T_MIN = 0.07, T_MAX = 0.65;   // толщина залитой полосы, м
  var PAIR_MIN = 0.09, PAIR_MAX = 0.60;   // расстояние между линиями двойной стены, м

  /**
   * Кандидаты-стены по одному направлению (горизонтальному: bar - маска W x H, индекс y * W + x).
   *  1. Оставляем только пиксели из длинных горизонтальных отрезков (>= 45 см): отсекает перпендикулярные
   *     стены, текст, мебель.
   *  2. В каждом столбце берём вертикальные отрезки оставшегося и измеряем их толщину. Толщина 7-65 см - тело стены,
   *     тоньше - линия (для двойной стены).
   *  3. Соседние столбцы с одинаковыми краями (+-2 px) склеиваем в цепочку. Окно или проём - место, где цепочка
   *     обрывается: толщина там другая.
   * Возвращает [{ c: ось (строка), a, b: начало и конец по оси, t: толщина, solid }] в пикселях маски.
   */
  function candidates(bar, W, H, m) {
    var lmin = Math.max(5, Math.round(0.45 * m)), x, y;
    var keep = new Uint8Array(W * H);
    for (y = 0; y < H; y++) {
      var xs = -1, base = y * W;
      for (x = 0; x <= W; x++) {
        var v = x < W && bar[base + x];
        if (v && xs < 0) xs = x;
        else if (!v && xs >= 0) { if (x - xs >= lmin) for (var q = xs; q < x; q++) keep[base + q] = 1; xs = -1; }
      }
    }
    var solid = [], thin = [], aSol = [], aThin = [];
    function feed(active, out, x, y0, y1) {
      for (var i = 0; i < active.length; i++) {
        var c = active[i];
        if (c.last === x - 1 && Math.abs(c.y0 - y0) <= 2 && Math.abs(c.y1 - y1) <= 2) {
          c.last = x; c.n++; c.sy0 += y0; c.sy1 += y1; c.y0 = y0; c.y1 = y1; return;
        }
      }
      active.push({ a: x, last: x, y0: y0, y1: y1, n: 1, sy0: y0, sy1: y1 });
    }
    function flush(active, out, x) {
      for (var i = active.length - 1; i >= 0; i--) if (active[i].last < x - 1) { out.push(active[i]); active.splice(i, 1); }
    }
    for (x = 0; x < W; x++) {
      y = 0;
      while (y < H) {
        if (!keep[y * W + x]) { y++; continue; }
        var y0 = y;
        while (y < H && keep[y * W + x]) y++;
        var th = (y - y0) / m;
        if (th >= T_MIN && th <= T_MAX) feed(aSol, solid, x, y0, y - 1);
        else if (th < T_MIN) feed(aThin, thin, x, y0, y - 1);
      }
      flush(aSol, solid, x); flush(aThin, thin, x);
    }
    aSol.forEach(function (c) { solid.push(c); }); aThin.forEach(function (c) { thin.push(c); });
    var res = [];
    solid.forEach(function (c) {
      if (c.n / m < 0.25) return;
      res.push({ c: (c.sy0 + c.sy1) / (2 * c.n) + 0.5, a: c.a, b: c.last, t: (c.sy1 - c.sy0) / c.n + 1, solid: true });
    });
    // двойная линия: две тонкие цепочки с общим протяжением на расстоянии 9-60 см
    var tl = thin.filter(function (c) { return c.n / m >= MIN_WALL_M; }).map(function (c) {
      return { y: (c.sy0 + c.sy1) / (2 * c.n), a: c.a, b: c.last };
    }).sort(function (p, q) { return p.y - q.y; });
    // частая решётка параллельных тонких линий (ступени лестницы, штриховка) - не стены
    var dense = tl.map(function (A, i) {
      var cnt = 0;
      tl.forEach(function (B, j) {
        if (i === j || Math.abs(A.y - B.y) > 1.2 * m) return;
        var ov = Math.min(A.b, B.b) - Math.max(A.a, B.a) + 1;
        if (ov >= 0.6 * Math.min(A.b - A.a + 1, B.b - B.a + 1)) cnt++;
      });
      return cnt >= 4;
    });
    var used = [];
    for (var i = 0; i < tl.length; i++) {
      if (dense[i]) continue;
      var A = tl[i], bestJ = -1, bg = 1e9;
      for (var j = i + 1; j < tl.length; j++) {
        if (used[j] || dense[j]) continue;
        var B = tl[j], gap = (B.y - A.y) / m;
        if (gap > PAIR_MAX) break;
        if (gap < PAIR_MIN) continue;
        var ov = Math.min(A.b, B.b) - Math.max(A.a, B.a) + 1;
        if (ov < 0.6 * Math.min(A.b - A.a + 1, B.b - B.a + 1)) continue;
        if (gap < bg) { bg = gap; bestJ = j; }
      }
      if (bestJ >= 0) {
        var B2 = tl[bestJ]; used[bestJ] = 1; used[i] = 1;
        res.push({ c: (A.y + B2.y) / 2 + 0.5, a: Math.max(A.a, B2.a), b: Math.min(A.b, B2.b), t: B2.y - A.y, solid: false });
      }
    }
    return res;
  }

  /**
   * Два параллельных кандидата ближе 0,9 м друг к другу и с общим протяжением - это одна стена и её «тень»
   * (пара размерных линий рядом со стеной, штриховка): остаётся более толстый.
   */
  function dedupe(list, m) {
    var drop = [];
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      if (drop[i] || drop[j]) continue;
      var p = list[i], q = list[j];
      if (Math.abs(p.c - q.c) > 0.9 * m) continue;
      var ov = Math.min(p.b, q.b) - Math.max(p.a, q.a) + 1;
      if (ov < 0.7 * Math.min(p.b - p.a + 1, q.b - q.a + 1)) continue;
      if (p.t >= q.t) drop[j] = 1; else drop[i] = 1;
    }
    return list.filter(function (_, k) { return !drop[k]; });
  }

  /** Склейка попавших на одну ось отрезков; разрывы становятся проёмами. */
  function merge(list, m, kindOf) {
    list.sort(function (p, q) { return p.c - q.c; });
    var groups = [];
    list.forEach(function (s) {
      var g = groups[groups.length - 1];
      if (g && Math.abs(s.c - g.c) <= 0.06 * m && Math.abs(s.t - g.t) <= 0.08 * m) {
        g.items.push(s); g.c = (g.c * (g.items.length - 1) + s.c) / g.items.length;
        g.t = (g.t * (g.items.length - 1) + s.t) / g.items.length;
      } else groups.push({ c: s.c, t: s.t, items: [s] });
    });
    var out = [];
    groups.forEach(function (g) {
      g.items.sort(function (p, q) { return p.a - q.a; });
      var cur = null;
      g.items.forEach(function (s) {
        var gap = cur ? (s.a - cur.b - 1) / m : 0;
        if (cur && gap <= MAXGAP_M) {
          if (gap > MINGAP_M) cur.gaps.push([cur.b + 1, s.a - 1, kindOf ? kindOf(g.c, g.t, cur.b + 1, s.a - 1) : 'door']);
          cur.b = Math.max(cur.b, s.b);
        } else {
          if (cur) out.push(cur);
          cur = { c: g.c, a: s.a, b: s.b, t: g.t, gaps: [] };
        }
      });
      if (cur) out.push(cur);
    });
    return out;
  }

  /** Одна стена, найденная дважды (тело и более тонкая «тень» внутри него): остаётся более толстая. */
  function dedupeSegs(list, m) {
    var drop = [];
    for (var i = 0; i < list.length; i++) for (var j = 0; j < list.length; j++) {
      if (i === j || drop[i] || drop[j]) continue;
      var p = list[i], q = list[j];
      if (p.t < q.t || (p.t === q.t && i > j)) continue;          // p - более толстая (или первая при равных)
      if (Math.abs(p.c - q.c) > Math.max(p.t, q.t) * 0.9 + 2) continue;
      var ov = Math.min(p.b, q.b) - Math.max(p.a, q.a) + 1;
      if (ov >= 0.7 * Math.min(p.b - p.a + 1, q.b - q.a + 1)) {
        // более толстая забирает протяжение тонкой, чтобы не потерять проём между кусками
        p.a = Math.min(p.a, q.a); p.b = Math.max(p.b, q.b); p.gaps = p.gaps.concat(q.gaps.filter(function (g) { return g[0] > p.a && g[1] < p.b; }));
        drop[j] = 1;
      }
    }
    return list.filter(function (_, k) { return !drop[k]; });
  }

  /**
   * Оси параллельных стен ближе 10 см - одна линия (куски одной стены с разной измеренной толщиной).
   * Ось становится средней, взвешенной по длине: узлы потом сходятся точно.
   */
  function alignAxes(list, m) {
    var sorted = list.slice().sort(function (p, q) { return p.c - q.c; }), i = 0;
    while (i < sorted.length) {
      var j = i, sum = 0, w = 0;
      while (j < sorted.length && sorted[j].c - sorted[i].c <= 0.10 * m) { var len = sorted[j].b - sorted[j].a + 1; sum += sorted[j].c * len; w += len; j++; }
      var c = sum / w;
      for (var k = i; k < j; k++) sorted[k].c = c;
      i = j;
    }
  }

  /** Конец отрезка тянем к оси ближайшей встречной стены: углы и Т-узлы сходятся в точку. */
  function snapEnds(A, B, m) {
    var tol = 0.7 * m;
    A.forEach(function (s) {
      ['a', 'b'].forEach(function (e) {
        var best = null, bd = tol;
        B.forEach(function (p) {
          if (s.c < p.a - 0.3 * m || s.c > p.b + 0.3 * m) return;     // ось s должна попадать в протяжение p
          var d = Math.abs(p.c - s[e]);
          if (d <= bd) { bd = d; best = p; }
        });
        if (best) s[e] = best.c;
      });
    });
  }

  /**
   * Свободный конец стены в пределах 1,6 м от встречной стены тянем до неё: так замыкается угол, где вместо
   * стены дверной или оконный проём. Разрыв записывается проёмом.
   */
  function bridgeEnds(A, B, m, kindOf) {
    var tol = 0.25 * m, reach = 1.6 * m;
    A.forEach(function (s) {
      ['a', 'b'].forEach(function (e) {
        var dir = e === 'a' ? -1 : 1, joined = false, best = null, bd = reach;
        B.forEach(function (p) {
          if (s.c < p.a - 0.3 * m || s.c > p.b + 0.3 * m) return;
          var d = (p.c - s[e]) * dir;
          if (Math.abs(p.c - s[e]) <= tol) joined = true;    // угол или Т-узел: дальше не тянем (иначе стена режет комнату насквозь)
          else if (d > tol && d <= bd) { bd = d; best = p; }
        });
        if (joined || !best) return;
        var g0 = Math.min(s[e], best.c), g1 = Math.max(s[e], best.c);
        s.gaps.push([g0 + 1, g1 - 1, kindOf ? kindOf(s.c, s.t, Math.round(g0) + 1, Math.round(g1) - 1) : 'door']);
        s[e] = best.c;
      });
    });
  }

  /** Стены, не связанные с остальными, и мелкие островки (размерные линии, мебель) отбрасываем. */
  function keepNetwork(H, V, m) {
    var all = H.map(function (s) { return { s: s, h: true }; }).concat(V.map(function (s) { return { s: s, h: false }; }));
    var par = all.map(function (_, i) { return i; });
    function find(i) { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; }
    var tol = 0.25 * m;
    all.forEach(function (p, i) {
      all.forEach(function (q, j) {
        if (j <= i || p.h === q.h) return;
        var h = p.h ? p : q, v = p.h ? q : p;
        if (v.s.c >= h.s.a - tol && v.s.c <= h.s.b + tol && h.s.c >= v.s.a - tol && h.s.c <= v.s.b + tol) par[find(i)] = find(j);
      });
    });
    var total = {};
    all.forEach(function (p, i) { var r = find(i); total[r] = (total[r] || 0) + (p.s.b - p.s.a) / m; });
    return all.filter(function (p, i) { return total[find(i)] >= 5; });
  }

  /**
   * Стены плана этажа. Возвращает { segs:[{a,b,t,opens}], ... } в пикселях плана и метрах, или { error }.
   */
  function detect(fi) {
    var f = G.DATA.floors[fi], mask = G.getMask(fi);
    if (!mask) return { error: 'Подложка ещё загружается - повторите через секунду.' };
    if (!f.pxPerM) return { error: 'Сначала задайте масштаб.' };
    var m = f.pxPerM * mask.k, W = mask.w, H = mask.h, bar = mask.bar, i, x, y;
    var tr = new Uint8Array(W * H);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) tr[x * H + y] = bar[y * W + x];
    var H0 = candidates(bar, W, H, m), V0 = candidates(tr, H, W, m);
    G.__traceDbg = { m: m, k: mask.k, W: W, H: H, H0: H0, V0: V0 };   // для отладки на реальных планах
    var Hc = merge(dedupe(H0, m), m, windowKind(bar, W, H, m));       // горизонтальные: c - строка (y), a..b - по x
    var Vc = merge(dedupe(V0, m), m, windowKind(tr, H, W, m));        // вертикальные: c - столбец (x), a..b - по y
    Hc = dedupeSegs(Hc, m); Vc = dedupeSegs(Vc, m);
    alignAxes(Hc, m); alignAxes(Vc, m);
    snapEnds(Hc, Vc, m); snapEnds(Vc, Hc, m);
    bridgeEnds(Hc, Vc, m, windowKind(bar, W, H, m)); bridgeEnds(Vc, Hc, m, windowKind(tr, H, W, m));
    Hc = Hc.filter(function (s) { return (s.b - s.a) / m >= MIN_WALL_M; });
    Vc = Vc.filter(function (s) { return (s.b - s.a) / m >= MIN_WALL_M; });
    var kept = keepNetwork(Hc, Vc, m);
    var segs = kept.map(function (p) {
      var s = p.s, inv = 1 / mask.k, pm = f.pxPerM;
      var a = p.h ? [s.a * inv, s.c * inv] : [s.c * inv, s.a * inv], b = p.h ? [s.b * inv, s.c * inv] : [s.c * inv, s.b * inv];
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      var opens = s.gaps.map(function (g) {
        var w = (g[1] - g[0] + 1) / m, c0 = (g[0] + g[1]) / 2 * inv;
        var along = (p.h ? c0 - a[0] : c0 - a[1]) / pm;
        return { o: Math.round(along * 100) / 100, w: Math.round(w * 20) / 20, k: g[2] === 'win' ? 'win' : 'door' };
      }).filter(function (o) { return o.o > 0 && o.o * pm < len; });
      return { a: a, b: b, t: s.t / m, opens: opens };
    });
    return { segs: segs, m: m };
  }

  /** Окно или проём: в разрыве стены у окна поперёк идут линии рамы - две и больше строк почти сплошь тёмные. */
  function windowKind(bar, W, H, m) {
    return function (c, t, g0, g1) {
      var rows = 0, half = Math.max(1, Math.round(t / 2));
      for (var y = Math.round(c) - half - 1; y <= Math.round(c) + half + 1; y++) {
        if (y < 0 || y >= H) continue;
        var dark = 0, n = 0;
        for (var x = g0; x <= g1; x++) { n++; if (bar[y * W + x]) dark++; }
        if (n && dark / n >= 0.7) rows++;
      }
      return rows >= 2 ? 'win' : 'door';
    };
  }

  function median(a) { if (!a.length) return 0; a = a.slice().sort(function (p, q) { return p - q; }); return a[Math.floor(a.length / 2)]; }

  /** «Обвести по подложке»: стены из растра в f.walls. */
  G.wallsTrace = function () {
    var f = G.F();
    if (!f.img || f.blank) { G.hint('Обводить нечего: подложка не загружена. Нарисуйте стены вручную.'); return; }
    var res;
    try { res = detect(G.cur); } catch (e) { console.error('[plan_trace]', e); G.hint('Не удалось обвести стены по подложке: ' + (e && e.message || e)); return; }
    if (res.error) { G.hint(res.error); return; }
    if (!res.segs.length) {
      G.hint('Стены по подложке не нашлись: на плане нет прямых горизонтальных и вертикальных стен толщиной 7-65 см. ' +
        'Нарисуйте их вручную.');
      return;
    }
    var had = (f.walls || []).length;
    if (had && !confirm('На этаже уже нарисовано стен: ' + had + '. Заменить их обводкой по подложке?')) return;
    var st = G.wallsImport(res.segs, { replace: !!had });
    var ti = st.thickInt.length ? Math.round(median(st.thickInt) * 100) / 100 : 0, te = st.thickExt.length ? Math.round(median(st.thickExt) * 100) / 100 : 0;
    // внутренняя толщина по плану - в данные плана (поля для неё пока нет); наружную берёт калькулятор из пирога стены
    if (ti >= 0.08 && ti <= 0.5 && !(G.DATA.intT > 0)) G.DATA.intT = ti;
    var fm = function (x) { return String(Math.round(x * 10) / 10).replace('.', ','); };
    G.hint('<span class=ok>Обведено по подложке:</span> стен ' + st.n + ' (наружных ' + fm(st.ext) + ' м, внутренних ' + fm(st.int) + ' м), проёмов ' + st.opens +
      '. Проверьте углы и тип проёмов (дверь или окно - по ширине разрыва), лишнее уберите: Shift+клик по стене, Delete.' +
      (st.int < 3 ? ' Перегородок внутри почти нет - нажмите «Найти внутренние стены».' : '') +
      (te ? ' Наружные стены на плане около ' + String(te).replace('.', ',') + ' м' + (ti ? ', внутренние около ' + String(ti).replace('.', ',') + ' м' : '') + '.' : ''));
  };
  G.wallsTraceDetect = detect;

  /**
   * «Найти внутренние стены»: наружный контур уже есть (обведён или нарисован), а перегородки и несущие стены внутри
   * не нашлись - у них нет связной двойной линии по периметру, и «Обвести по подложке» их отбрасывает как одиночные.
   * Те же кандидаты (залитая полоса 7-65 см или двойная линия), но:
   *  - то, что уже совпадает с нарисованной стеной (ось ближе 35 см и общее протяжение), пропускается;
   *  - берутся только стены, которые после подтяжки концов упираются в нарисованные (прямо или через другие новые);
   *    одиночные линии - мебель, размеры, ступени - не связаны с контуром и отпадают;
   *  - разрыв в стене - проём (дверь или окно по рамке), как и при обводке.
   * Наклонные стены не ищутся.
   */
  /**
   * Полосы заливки в маске: в каждой строке отрезки тёмного длиннее minRun, соседние строки с общим протяжением
   * склеиваются в полосу; толщина полосы - в пределах thMin..thMax. Проще, чем candidates, и не страдает от соседних
   * параллельных размерных линий (из-за них candidates считает стену «частой решёткой» и отбрасывает).
   */
  function bandCandidates(bar, W, H, m, thMin, thMax, minRun) {
    var runs = [], y, x;
    for (y = 0; y < H; y++) {
      var xs = -1, base = y * W;
      for (x = 0; x <= W; x++) {
        var v = x < W && bar[base + x];
        if (v && xs < 0) xs = x;
        else if (!v && xs >= 0) { if (x - xs >= minRun) runs.push({ y: y, s: xs, e: x - 1 }); xs = -1; }
      }
    }
    var out = [];
    runs.forEach(function (r) {
      for (var i = out.length - 1; i >= 0; i--) {
        var o = out[i];
        if (r.y - o.y1 > 1) continue;
        if (r.y - o.y1 === 1 && Math.min(r.e, o.e) - Math.max(r.s, o.s) > 0.6 * (r.e - r.s)) {
          o.y1 = r.y; o.s = Math.min(o.s, r.s); o.e = Math.max(o.e, r.e); return;
        }
      }
      out.push({ y0: r.y, y1: r.y, s: r.s, e: r.e });
    });
    var res = [];
    out.forEach(function (o) {
      var th = o.y1 - o.y0 + 1;
      if (th < thMin * m || th > thMax * m) return;
      res.push({ c: (o.y0 + o.y1) / 2 + 0.5, a: o.s, b: o.e, t: th, solid: true });
    });
    return res;
  }

  /** Часть отрезка s, не закрытая нарисованными стенами exist на той же оси (ось ближе 35 см): остаются куски длиннее 0,8 м. */
  function subtractExisting(list, exist, m) {
    var out = [];
    list.forEach(function (s) {
      var cov = [];
      exist.forEach(function (e) { if (Math.abs(e.c - s.c) <= 0.35 * m) cov.push([e.a - 0.15 * m, e.b + 0.15 * m]); });
      cov.sort(function (p, q) { return p[0] - q[0]; });
      var pos = s.a, parts = [];
      cov.forEach(function (c) {
        if (c[1] < pos || c[0] > s.b) return;
        if (c[0] > pos) parts.push([pos, c[0]]);
        pos = Math.max(pos, c[1]);
      });
      if (pos < s.b) parts.push([pos, s.b]);
      parts.forEach(function (pt) {
        if ((pt[1] - pt[0]) / m < MIN_WALL_M) return;
        out.push({ c: s.c, a: pt[0], b: pt[1], t: s.t, gaps: (s.gaps || []).filter(function (g) { return g[0] > pt[0] && g[1] < pt[1]; }) });
      });
    });
    return out;
  }

  function detectInner(fi) {
    var f = G.DATA.floors[fi], mask = G.getMask(fi);
    if (!mask) return { error: 'Подложка ещё загружается - повторите через секунду.' };
    if (!f.pxPerM) return { error: 'Сначала задайте масштаб.' };
    var m = f.pxPerM * mask.k, W = mask.w, H = mask.h, bar = mask.bar, k = mask.k, x, y;
    var tr = new Uint8Array(W * H);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) tr[x * H + y] = bar[y * W + x];
    // перегородки тоньше 20 см от линий мебели и размеров не отличить: ищем стены толщиной 20-65 см
    var THI = 0.20, MINRUN = Math.round(0.9 * m);
    var Hc = merge(dedupe(bandCandidates(bar, W, H, m, THI, T_MAX, MINRUN), m), m, windowKind(bar, W, H, m));
    var Vc = merge(dedupe(bandCandidates(tr, H, W, m, THI, T_MAX, MINRUN), m), m, windowKind(tr, H, W, m));
    Hc = dedupeSegs(Hc, m); Vc = dedupeSegs(Vc, m);
    alignAxes(Hc, m); alignAxes(Vc, m);
    // нарисованные стены в тех же осях (маска), только горизонтальные и вертикальные
    var eH = [], eV = [];
    (f.walls || []).forEach(function (w) {
      var dx = Math.abs(w.b[0] - w.a[0]), dy = Math.abs(w.b[1] - w.a[1]);
      if (dx >= dy * 4) eH.push({ c: (w.a[1] + w.b[1]) / 2 * k, a: Math.min(w.a[0], w.b[0]) * k, b: Math.max(w.a[0], w.b[0]) * k, t: 0, gaps: [], ex: true });
      else if (dy >= dx * 4) eV.push({ c: (w.a[0] + w.b[0]) / 2 * k, a: Math.min(w.a[1], w.b[1]) * k, b: Math.max(w.a[1], w.b[1]) * k, t: 0, gaps: [], ex: true });
    });
    var nH = subtractExisting(Hc, eH, m), nV = subtractExisting(Vc, eV, m);
    // концы - к осям встречных стен (нарисованных и новых), затем короткие отбрасываем
    snapEnds(nH, eV.concat(nV), m); snapEnds(nV, eH.concat(nH), m);
    nH = nH.filter(function (s) { return (s.b - s.a) / m >= MIN_WALL_M; });
    nV = nV.filter(function (s) { return (s.b - s.a) / m >= MIN_WALL_M; });
    // связность с нарисованным контуром
    var all = eH.map(function (s) { return { s: s, h: true }; }).concat(eV.map(function (s) { return { s: s, h: false }; }),
      nH.map(function (s) { return { s: s, h: true }; }), nV.map(function (s) { return { s: s, h: false }; }));
    var par = all.map(function (_, i) { return i; });
    function find(i) { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; }
    var tol = 0.3 * m;
    all.forEach(function (p, i) {
      all.forEach(function (q, j) {
        if (j <= i || p.h === q.h) return;
        var h = p.h ? p : q, v = p.h ? q : p;
        if (v.s.c >= h.s.a - tol && v.s.c <= h.s.b + tol && h.s.c >= v.s.a - tol && h.s.c <= v.s.b + tol) par[find(i)] = find(j);
      });
    });
    var anchored = {};
    all.forEach(function (p, i) { if (p.s.ex) anchored[find(i)] = 1; });
    var segs = [];
    all.forEach(function (p, i) {
      if (p.s.ex || !anchored[find(i)]) return;
      var s = p.s, inv = 1 / k, pm = f.pxPerM;
      var a = p.h ? [s.a * inv, s.c * inv] : [s.c * inv, s.a * inv], b = p.h ? [s.b * inv, s.c * inv] : [s.c * inv, s.b * inv];
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      var opens = (s.gaps || []).map(function (g) {
        var w = (g[1] - g[0] + 1) / m, c0 = (g[0] + g[1]) / 2 * inv;
        var along = (p.h ? c0 - a[0] : c0 - a[1]) / pm;
        return { o: Math.round(along * 100) / 100, w: Math.round(w * 20) / 20, k: g[2] === 'win' ? 'win' : 'door' };
      }).filter(function (o) { return o.o > 0 && o.o * pm < len; });
      segs.push({ a: a, b: b, t: s.t / m, opens: opens });
    });
    return { segs: segs, m: m };
  }

  G.wallsFindInner = function () {
    var f = G.F();
    if (!f.img || f.blank) { G.hint('Искать нечего: подложка не загружена. Нарисуйте внутренние стены вручную.'); return; }
    if (!(f.walls || []).length) { G.hint('Сначала обведите наружные стены («Обвести по подложке») или нарисуйте контур: внутренние стены ищутся от него.'); return; }
    var res;
    try { res = detectInner(G.cur); } catch (e) { console.error('[plan_trace] inner', e); G.hint('Не удалось найти внутренние стены: ' + (e && e.message || e)); return; }
    if (res.error) { G.hint(res.error); return; }
    if (!res.segs.length) {
      G.hint('Новых внутренних стен не нашлось: на плане нет прямых стен толщиной 7-65 см, которые упираются в нарисованные. ' +
        'Остальное дорисуйте инструментом «Внутренняя».');
      return;
    }
    var st = G.wallsImport(res.segs, { replace: false });
    // длину считаем по найденным отрезкам: часть из них редактор сразу относит к наружным, и разность «внутренних» вводит в заблуждение
    var added = 0, pm = f.pxPerM, fm = function (x) { return String(Math.round(x * 10) / 10).replace('.', ','); };
    res.segs.forEach(function (sg) { added += Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) / pm; });
    var ti = st.thickInt.length ? Math.round(median(st.thickInt) * 100) / 100 : 0;
    if (ti >= 0.08 && ti <= 0.5 && !(G.DATA.intT > 0)) G.DATA.intT = ti;
    G.hint('<span class=ok>Найдено стен: ' + res.segs.length + '</span> (около ' + fm(added) + ' м): перегородки, несущие стены и недостающие куски контура. Проёмов на этаже ' +
      st.opens + '. Проверьте на плане: лишнее уберите (Shift+клик по стене, Delete), недостающее дорисуйте инструментом «Внутренняя». Ctrl+Z вернёт как было. ' +
      'Перегородки тоньше 20 см не ищутся: их не отличить от мебели.');
  };

})(window);
