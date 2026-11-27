/**
 * plan_fit.js — расстановка мебели и подгонка радиаторов в 3D без пересечений со стенами.
 *
 * Чистая геометрия без three.js и DOM: работает в браузере (window.PlanFit) и в Node (bench/furniture.js).
 * Все размеры в метрах, координаты (x, z) — как в plan_3d.js.
 *
 * Правило (CLAUDE.md, «Расстановка в 3D»): мебель и приборы не пересекают стены, перегородки и друг друга,
 * не загораживают двери и окна. Пересечение — ошибка расстановки, а не «допустимо»: если места нет,
 * предмет не ставится совсем.
 *
 * Данные: room = { pts: [[x,z]...] } — контур комнаты по внутренним граням стен;
 * fl = { walls: [{ a:[x,z], b:[x,z], t, ops:[{ o, w, h, sill, k }] }], rads: [{ x, y, w, ang }] }.
 */
(function (root) {
  'use strict';

  var EPS_WALL = 0.03;     // допустимое «касание» стены, м
  var EPS_ITEM = 0.02;     // зазор между предметами

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
  function len2(a) { return Math.hypot(a[0], a[1]); }

  /** Прямоугольник стены с толщиной: четыре угла. */
  function wallQuad(w) {
    var dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, h = (w.t || 0.15) / 2;
    return [[w.a[0] - uz * h, w.a[1] + ux * h], [w.b[0] - uz * h, w.b[1] + ux * h], [w.b[0] + uz * h, w.b[1] - ux * h], [w.a[0] + uz * h, w.a[1] - ux * h]];
  }
  /** Прямоугольник от точки E0 вдоль u на [s0, s0+w] и по нормали n на [v0, v0+d]. */
  function rectOf(E0, u, n, s0, w, d, v0) {
    v0 = v0 || 0;
    var o = [E0[0] + u[0] * s0 + n[0] * v0, E0[1] + u[1] * s0 + n[1] * v0];
    return [o, [o[0] + u[0] * w, o[1] + u[1] * w], [o[0] + u[0] * w + n[0] * d, o[1] + u[1] * w + n[1] * d], [o[0] + n[0] * d, o[1] + n[1] * d]];
  }
  function axesOf(P, out) {
    for (var i = 0; i < P.length; i++) {
      var a = P[i], b = P[(i + 1) % P.length], e = [b[0] - a[0], b[1] - a[1]], l = len2(e);
      if (l > 1e-9) out.push([-e[1] / l, e[0] / l]);
    }
  }
  function proj(P, ax) { var lo = 1e18, hi = -1e18; P.forEach(function (p) { var v = dot(p, ax); if (v < lo) lo = v; if (v > hi) hi = v; }); return [lo, hi]; }
  /** Выпуклые многоугольники пересекаются глубже, чем на eps (SAT). */
  function overlap(P, Q, eps) {
    var ax = [], i;
    axesOf(P, ax); axesOf(Q, ax);
    for (i = 0; i < ax.length; i++) {
      var a = proj(P, ax[i]), b = proj(Q, ax[i]);
      if (Math.min(a[1], b[1]) - Math.max(a[0], b[0]) <= eps) return false;
    }
    return true;
  }
  function inPoly(p, P) {
    var inn = false, a, b;
    for (a = 0, b = P.length - 1; a < P.length; b = a++)
      if ((P[a][1] > p[1]) !== (P[b][1] > p[1]) && p[0] < (P[b][0] - P[a][0]) * (p[1] - P[a][1]) / (P[b][1] - P[a][1]) + P[a][0]) inn = !inn;
    return inn;
  }
  function area(P) { var s = 0, i; for (i = 0; i < P.length; i++) { var p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; }
  function distSeg(p, a, b) {
    var dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
  }
  function distPoly(p, P) { var d = 1e18, i; for (i = 0; i < P.length; i++) d = Math.min(d, distSeg(p, P[i], P[(i + 1) % P.length])); return d; }

  /** Контур без лишних вершин: подряд идущие стороны на одной прямой сливаются. */
  function mergeCollinear(pts) {
    var P = pts.slice(), changed = true, i;
    while (changed && P.length > 3) {
      changed = false;
      for (i = 0; i < P.length; i++) {
        var a = P[(i + P.length - 1) % P.length], b = P[i], c = P[(i + 1) % P.length];
        var u1 = [b[0] - a[0], b[1] - a[1]], u2 = [c[0] - b[0], c[1] - b[1]], l1 = len2(u1), l2 = len2(u2);
        if (l1 < 1e-6 || l2 < 1e-6 || Math.abs(u1[0] * u2[1] - u1[1] * u2[0]) / (l1 * l2) < 0.002) { P.splice(i, 1); changed = true; break; }
      }
    }
    return P;
  }
  /** Стороны контура: начало, длина, направление и нормаль внутрь комнаты. */
  function edgesOf(pts) {
    var P = mergeCollinear(pts), A = area(P), out = [], i;
    for (i = 0; i < P.length; i++) {
      var a = P[i], b = P[(i + 1) % P.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 0.3) continue;
      var u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], n = A > 0 ? [-u[1], u[0]] : [u[1], -u[0]];
      var mid = [(a[0] + b[0]) / 2 + n[0] * 0.05, (a[1] + b[1]) / 2 + n[1] * 0.05];
      if (!inPoly(mid, P)) n = [-n[0], -n[1]];
      out.push({ a: a, b: b, l: l, u: u, n: n });
    }
    return { P: P, edges: out };
  }

  /** Запретные зоны: перед дверями и воротами (полотно открывается в обе стороны), перед окнами (для высоких предметов), у радиаторов. */
  function keepouts(fl) {
    var door = [], win = [], rad = [];
    (fl.walls || []).forEach(function (w) {
      var dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz) || 1, u = [dx / L, dz / L], n = [-u[1], u[0]], t = w.t || 0.15;
      (w.ops || []).forEach(function (o) {
        var c = [w.a[0] + u[0] * o.o, w.a[1] + u[1] * o.o];
        if (o.k === 'win') win.push(rectOf([c[0] - n[0] * (t / 2 + 0.45), c[1] - n[1] * (t / 2 + 0.45)], u, n, -(o.w / 2 + 0.05), o.w + 0.1, t + 0.9, 0));
        else { var dep = o.k === 'gate' ? 1.3 : 0.95; door.push(rectOf([c[0] - n[0] * dep, c[1] - n[1] * dep], u, n, -(o.w / 2 + 0.1), o.w + 0.2, dep * 2, 0)); }
      });
    });
    (fl.rads || []).forEach(function (r) {
      var a = (r.ang || 0) * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], n = [-u[1], u[0]];
      rad.push(rectOf([r.x - n[0] * 0.28, r.y - n[1] * 0.28], u, n, -(r.w / 2 + 0.08), r.w + 0.16, 0.56, 0));
    });
    return { door: door, win: win, rad: rad };
  }

  /** Допустим ли предмет-прямоугольник: внутри комнаты, не в стенах, не в проходах, не на других предметах. */
  function fits(rect, ctx, tall, margin) {
    var c = [0, 0], i, P = ctx.P;
    rect.forEach(function (p) { c[0] += p[0] / 4; c[1] += p[1] / 4; });
    var pts = [c];
    for (i = 0; i < 4; i++) {
      var p = rect[i], q = rect[(i + 1) % 4];
      pts.push([p[0] + (c[0] - p[0]) * 0.06, p[1] + (c[1] - p[1]) * 0.06], [(p[0] + q[0]) / 2 + (c[0] - (p[0] + q[0]) / 2) * 0.06, (p[1] + q[1]) / 2 + (c[1] - (p[1] + q[1]) / 2) * 0.06]);
    }
    for (i = 0; i < pts.length; i++) if (!inPoly(pts[i], P)) return false;
    if (margin) for (i = 0; i < 4; i++) if (distPoly(rect[i], P) < margin - 1e-6 && inPoly(rect[i], P)) return false;
    for (i = 0; i < ctx.quads.length; i++) if (overlap(rect, ctx.quads[i], EPS_WALL)) return false;
    for (i = 0; i < ctx.ko.door.length; i++) if (overlap(rect, ctx.ko.door[i], 0)) return false;
    for (i = 0; i < ctx.ko.rad.length; i++) if (overlap(rect, ctx.ko.rad[i], 0)) return false;
    if (tall) for (i = 0; i < ctx.ko.win.length; i++) if (overlap(rect, ctx.ko.win[i], 0)) return false;
    for (i = 0; i < ctx.taken.length; i++) if (overlap(rect, ctx.taken[i], EPS_ITEM)) return false;
    return true;
  }

  /**
   * Поставить блок у стены: перебор сторон (длинные первыми) и положений вдоль них.
   * spec: { w | ws:[ширины от большей], d, tall, pref: 'center' | 'corner', dirN: нормаль, которой должна смотреть сторона }.
   * Возвращает { sd: { c, n, len }, w, d, rect } или null.
   */
  function place(ctx, spec) {
    var ws = spec.ws || [spec.w], wi, ei, edges = ctx.edges.slice().sort(function (a, b) { return b.l - a.l; });
    for (wi = 0; wi < ws.length; wi++) {
      var w = ws[wi];
      for (ei = 0; ei < edges.length; ei++) {
        var e = edges[ei];
        if (e.l < w + 0.1) continue;
        if (spec.dirN && dot(e.n, spec.dirN) > -0.7) continue;
        var best = null, s0;
        for (s0 = 0.05; s0 <= e.l - w - 0.05 + 1e-9; s0 += 0.1) {
          var rect = rectOf(e.a, e.u, e.n, s0, w, spec.d, 0);
          if (!fits(rect, ctx, spec.tall)) continue;
          var sc = spec.pref === 'corner' ? Math.min(s0, e.l - w - s0) : Math.abs(s0 + w / 2 - e.l / 2);
          if (!best || sc < best.sc) best = { sc: sc, s0: s0, rect: rect };
        }
        if (best) {
          var upper = spec.name === 'kitchen' ? fits(best.rect, ctx, true) : false;   // верхние шкафы - только если не закрывают окно
          ctx.taken.push(best.rect);
          return { sd: { c: [e.a[0] + e.u[0] * (best.s0 + w / 2), e.a[1] + e.u[1] * (best.s0 + w / 2)], n: e.n, len: e.l }, w: w, d: spec.d, rect: best.rect, upper: upper };
        }
      }
    }
    return null;
  }

  /** Отдельно стоящий предмет (обеденный стол со стульями): точка с наибольшим запасом до стен. */
  function placeFree(ctx, spec) {
    var xs = ctx.P.map(function (p) { return p[0]; }), zs = ctx.P.map(function (p) { return p[1]; }), best = null, x, z;
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), z0 = Math.min.apply(null, zs), z1 = Math.max.apply(null, zs);
    for (x = x0; x <= x1; x += 0.2) for (z = z0; z <= z1; z += 0.2) {
      var rect = rectOf([x - spec.w / 2, z - spec.d / 2], [1, 0], [0, 1], 0, spec.w, spec.d, 0);
      if (!fits(rect, ctx, false, 0.55)) continue;
      var sc = distPoly([x, z], ctx.P);
      if (!best || sc > best.sc) best = { sc: sc, rect: rect, c: [x, z] };
    }
    if (!best) return null;
    ctx.taken.push(best.rect);
    return { sd: { c: [best.c[0], best.c[1] - spec.d / 2], n: [0, 1], len: spec.w }, w: spec.w, d: spec.d, rect: best.rect };
  }

  /** Состав по типу комнаты: порядок важен — главное ставится первым и занимает лучшее место. */
  var KINDS = {
    bed: function (area) { return [{ name: 'bed', ws: area >= 12 ? [2.5, 1.7] : [1.7], d: 2.1, tall: true, pref: 'center' }, { name: 'wardrobe', ws: [1.8, 1.2], d: 0.6, tall: true, pref: 'corner' }, { name: 'plant', ws: [0.5], d: 0.5, tall: false, pref: 'corner' }]; },
    kids: function () { return [{ name: 'kbed', ws: [0.95], d: 2.0, tall: true, pref: 'corner' }, { name: 'wardrobe', ws: [1.2, 0.9], d: 0.6, tall: true, pref: 'corner' }, { name: 'desk', ws: [1.2, 0.9], d: 0.65, tall: false, pref: 'corner' }]; },
    living: function (area) {
      return [{ name: 'sofa', ws: [2.1], d: 2.2, tall: false, pref: 'center' }, { name: 'tv', ws: [1.8, 1.2], d: 0.4, tall: false, pref: 'center', rel: 'opposite' },
        { name: 'plant', ws: [0.5], d: 0.5, tall: false, pref: 'corner' }];
    },
    kitchen: function (area) {
      var L = [{ name: 'kitchen', ws: [3.6, 3.0, 2.4, 1.8], d: 0.65, tall: false, pref: 'corner' }];
      if (area > 10) L.push({ name: 'dining', free: true, w: 2.3, d: 1.8 });
      return L;
    },
    office: function () { return [{ name: 'desk2', ws: [1.4, 1.2], d: 1.3, tall: false, pref: 'corner' }, { name: 'shelf', ws: [1.2, 0.9], d: 0.35, tall: true, pref: 'corner' }, { name: 'plant', ws: [0.5], d: 0.5, tall: false, pref: 'corner' }]; },
    hall: function (area) { return area >= 4 ? [{ name: 'hallw', ws: [1.4, 1.0], d: 0.42, tall: true, pref: 'corner' }] : []; },
    store: function () { return [{ name: 'shelves', ws: [2.4, 1.8, 1.2, 0.8], d: 0.4, tall: true, pref: 'corner' }]; },
    wc: function () { return [{ name: 'bath', ws: [1.7, 1.5], d: 0.75, tall: false, pref: 'corner' }, { name: 'toilet', ws: [0.6], d: 0.7, tall: false, pref: 'corner' }, { name: 'sink', ws: [0.55], d: 0.45, tall: false, pref: 'corner' }]; }
  };

  /**
   * Расстановка комнаты: список блоков { name, sd, w, d } без пересечений.
   * kind: ключ KINDS; hasFix - у санузла есть приборы из плана (тогда условные не ставятся).
   */
  function layout(kind, room, fl, hasFix) {
    if (!KINDS[kind] || (kind === 'wc' && hasFix)) return [];
    var E = edgesOf(room.pts), A = Math.abs(area(E.P));
    var bx = E.P.map(function (p) { return p[0]; }), bz = E.P.map(function (p) { return p[1]; });
    if (Math.min(Math.max.apply(null, bx) - Math.min.apply(null, bx), Math.max.apply(null, bz) - Math.min.apply(null, bz)) < 1.5 || A < 3) return [];
    var ctx = { P: E.P, edges: E.edges, quads: (fl.walls || []).map(wallQuad), ko: keepouts(fl), taken: [] };
    var out = [], prev = null;
    KINDS[kind](A).forEach(function (spec) {
      var r = null;
      if (spec.free) r = placeFree(ctx, spec);
      else {
        var sp = spec;
        if (spec.rel === 'opposite' && prev) sp = Object.assign({}, spec, { dirN: [-prev.sd.n[0], -prev.sd.n[1]] });
        r = place(ctx, sp);
      }
      if (r) { r.name = spec.name; r.tall = !!spec.tall; out.push(r); if (!spec.rel) prev = r; }
    });
    return out;
  }

  /** Проверка расстановки: пересечения с чужими стенами, между собой, выход за контур. Пусто — всё в порядке. */
  function checkBlocks(blocks, room, fl) {
    var issues = [], quads = (fl.walls || []).map(wallQuad), P = mergeCollinear(room.pts);
    blocks.forEach(function (b, i) {
      quads.forEach(function (q, k) { if (overlap(b.rect, q, EPS_WALL)) issues.push(b.name + ' пересекает стену №' + k); });
      b.rect.forEach(function (p) { if (!inPoly(p, P) && distPoly(p, P) > EPS_WALL) issues.push(b.name + ' выходит за контур комнаты'); });
      blocks.forEach(function (o, j) { if (j > i && overlap(b.rect, o.rect, EPS_ITEM)) issues.push(b.name + ' пересекает ' + o.name); });
    });
    return issues;
  }

  /**
   * Радиатор под окном: не должен входить в перегородки и торцы стен. Берётся самый длинный свободный участок
   * по длине прибора (не короче 0,35 м), иначе прибор не ставится. host — стена, у которой он стоит (её не считаем).
   * Возвращает { x, y, w, changed, dropped }.
   */
  function fitRad(rd, walls) {
    var a = (rd.ang || 0) * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], n = [-u[1], u[0]];
    var others = walls.filter(function (w) {
      var dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz) || 1;
      var par = Math.abs((dx / L) * u[1] - (dz / L) * u[0]) < 0.05;
      var off = Math.abs((rd.x - w.a[0]) * (-dz / L) + (rd.y - w.a[1]) * (dx / L));
      return !(par && off < (w.t || 0.15) / 2 + 0.25);     // стена, вдоль которой стоит прибор, - хозяин
    }).map(wallQuad);
    function blocked(s) {
      var v, k;
      for (v = -0.05; v <= 0.05; v += 0.05) {
        var p = [rd.x + u[0] * s + n[0] * v, rd.y + u[1] * s + n[1] * v];
        for (k = 0; k < others.length; k++) if (inPoly(p, others[k])) return true;
      }
      return false;
    }
    var run = null, best = null, s, half = rd.w / 2, step = 0.02;
    for (s = -half; s <= half + 1e-9; s += step) {
      if (blocked(s)) { if (run) { if (!best || run[1] - run[0] > best[1] - best[0]) best = run; run = null; } }
      else if (!run) run = [s, s]; else run[1] = s;
    }
    if (run && (!best || run[1] - run[0] > best[1] - best[0])) best = run;
    if (!best) return { x: rd.x, y: rd.y, w: 0, changed: true, dropped: true };
    if (best[1] - best[0] >= rd.w - step - 1e-9) return { x: rd.x, y: rd.y, w: rd.w, changed: false, dropped: false };
    var nw = Math.floor((best[1] - best[0] - 0.04) / 0.05) * 0.05, mid = (best[0] + best[1]) / 2;
    if (nw < 0.35) return { x: rd.x, y: rd.y, w: 0, changed: true, dropped: true };
    return { x: rd.x + u[0] * mid, y: rd.y + u[1] * mid, w: nw, changed: true, dropped: false };
  }

  var api = { layout: layout, checkBlocks: checkBlocks, fitRad: fitRad, wallQuad: wallQuad, overlap: overlap, inPoly: inPoly, edgesOf: edgesOf, KINDS: KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlanFit = api;
})(typeof window !== 'undefined' ? window : this);
