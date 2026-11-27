/**
 * plan_revit.js — ручное рисование стен «как в Revit»: лента с контекстной вкладкой «Изменить | Размещение стен»,
 * панель параметров (линия привязки, цепочка, смещение), строка состояния, палитра свойств, выбор рамкой
 * (слева направо — внутри, справа налево — с пересечением), Tab по цепочке, ручки на концах, временные размеры
 * (клик по числу — ввод), инструменты правки: переместить, копировать, повернуть, зеркало, подобие, выровнять,
 * подрезать, разделить, удалить, рулетка, прямоугольник. Масштаб колесом, панорама средней кнопкой.
 *
 * Сами стены, привязки и предпросмотр рисования живут в plan_walls.js (его внутренности — через G.WI).
 * Подключается после plan_walls.js и ничего не делает, если у пользователя нет доступа к стенам.
 *
 * Горячие клавиши — двухбуквенные, как в Revit (клавиша по физическому положению, раскладка не важна):
 * WA стена, RC прямоугольник, WN окно, DR дверь, MV переместить, CO копировать, RO повернуть, MM зеркало (ось —
 * стена), DM зеркало (рисовать ось), OF подобие, AL выровнять, TR подрезать, SL разделить, DE удалить, DI рулетка,
 * ZE показать всё. Esc — выйти из инструмента в «Изменить».
 */
(function (G) {
  'use strict';
  if (!G.WI || !G.wallsEnabled) return;
  var W = G.WI, dist = W.dist, projOn = W.projOn, cv = G.cv;
  var cvbox = (cv.closest && cv.closest('.cvbox')) || cv.parentNode;

  function F() { return G.F(); }
  function kk() { return G.cs(); }
  function ppm() { return W.ppm(); }
  function r1(x) { return Math.round(x * 10) / 10; }

  // ── состояние ───────────────────────────────────────────────────────
  var MINE = { select: 1, rect: 1, move: 1, copy: 1, rotate: 1, mirror: 1, mirrorDraw: 1, offset: 1, align: 1, trim: 1, split: 1, measure: 1 };
  var NEEDSEL = { move: 1, copy: 1, rotate: 1, mirror: 1, mirrorDraw: 1 };
  var rv = {
    tool: 'wall', phase: '', sel: [], selO: [], cur: null, base: null, typed: '', hoverHit: null, chainHover: false,
    opt: { multi: false, mcopy: true, rcopy: false, ocopy: true, onum: true, odist: 100, afaces: true },
    tmp: null, meas: null, sd: null, dimBoxes: [], ctx: null, ang: 0, seqBuf: '', seqTimer: 0
  };
  var inSet = false;
  function own() { return G.mode === 'wall' && !!MINE[rv.tool]; }
  G.rvSnapOwner = own;
  var toolName = {
    select: 'Изменить', wall: 'Стена', rect: 'Прямоугольник', win: 'Окно', door: 'Дверь', move: 'Переместить', copy: 'Копировать', rotate: 'Повернуть',
    mirror: 'Зеркало (ось - стена)', mirrorDraw: 'Зеркало (нарисовать ось)', offset: 'Подобие', align: 'Выровнять', trim: 'Подрезать/удлинить до угла',
    split: 'Разделить', measure: 'Рулетка', legacy: 'Размер'
  };

  // ── геометрия ───────────────────────────────────────────────────────
  function unit(w) { var l = dist(w.a, w.b) || 1; return [(w.b[0] - w.a[0]) / l, (w.b[1] - w.a[1]) / l]; }
  function quad(w, ex) {
    var u = unit(w), h = W.thickPx(w) / 2 + (ex || 0);
    return [[w.a[0] - u[1] * h, w.a[1] + u[0] * h], [w.b[0] - u[1] * h, w.b[1] + u[0] * h], [w.b[0] + u[1] * h, w.b[1] - u[0] * h], [w.a[0] + u[1] * h, w.a[1] - u[0] * h]];
  }
  function polyPath(cx, q, k) { cx.beginPath(); cx.moveTo(q[0][0] * k, q[0][1] * k); for (var i = 1; i < q.length; i++) cx.lineTo(q[i][0] * k, q[i][1] * k); cx.closePath(); }
  function reflectFn(P, Q) {
    var dx = Q[0] - P[0], dy = Q[1] - P[1], l2 = dx * dx + dy * dy || 1;
    return function (p) { var t = ((p[0] - P[0]) * dx + (p[1] - P[1]) * dy) / l2, fx = P[0] + dx * t, fy = P[1] + dy * t; return [2 * fx - p[0], 2 * fy - p[1]]; };
  }
  function rotFn(c, ang) {
    var co = Math.cos(ang), si = Math.sin(ang);
    return function (p) { var x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * co - y * si, c[1] + x * si + y * co]; };
  }
  function moveFn(dx, dy) { return function (p) { return [p[0] + dx, p[1] + dy]; }; }
  function segRect(a, b, r) {   // отрезок пересекает прямоугольник r = [x0,y0,x1,y1]
    function inR(p) { return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]; }
    if (inR(a) || inR(b)) return true;
    var c = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    for (var i = 0; i < 4; i++) { if (segCross(a, b, c[i], c[(i + 1) % 4])) return true; }
    return false;
  }
  function segCross(a, b, c, d) {
    var rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) return false;
    var t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  function bbox(ws) {
    var p = []; ws.forEach(function (w) { p.push(w.a, w.b); });
    return p.length ? W.bboxOf(p) : null;
  }

  // ── выбор ───────────────────────────────────────────────────────────
  function wById(id) { return W.wallById(id); }
  function selWalls() { return rv.sel.map(wById).filter(Boolean); }
  function cleanSel() {
    var ids = {}, oids = {};
    W.walls().forEach(function (w) { ids[w.id] = 1; });
    W.ops().forEach(function (o) { oids[o.id] = 1; });
    rv.sel = rv.sel.filter(function (i) { return ids[i]; });
    rv.selO = rv.selO.filter(function (i) { return oids[i]; });
  }
  function hitAt(p) {
    var oi = W.opAt(p);
    if (oi >= 0) return { t: 'o', id: W.ops()[oi].id, i: oi };
    var wi = W.wallAt(p);
    if (wi >= 0) return { t: 'w', id: W.walls()[wi].id, i: wi };
    return null;
  }
  /** Цепочка по Tab: стены, связанные через узлы, в которых сходятся ровно две стены. */
  function chainOf(id) {
    var ws = W.walls(), out = {}, stack = [id];
    function at(pt) { return ws.filter(function (w) { return W.ptEq(w.a, pt) || W.ptEq(w.b, pt); }); }
    out[id] = 1;
    while (stack.length) {
      var w = wById(stack.pop());
      if (!w) continue;
      [w.a, w.b].forEach(function (e) {
        var here = at(e);
        if (here.length === 2) here.forEach(function (o) { if (!out[o.id]) { out[o.id] = 1; stack.push(o.id); } });
      });
    }
    return Object.keys(out);
  }
  function applySel(hit, e) {
    var add = e.ctrlKey || e.metaKey, rem = e.shiftKey;
    if (!hit) { if (!add && !rem) { rv.sel = []; rv.selO = []; } return; }
    var arr = hit.t === 'o' ? rv.selO : rv.sel, ids = hit.t === 'w' && rv.chainHover ? chainOf(hit.id) : [hit.id];
    if (!add && !rem) { rv.sel = []; rv.selO = []; arr = hit.t === 'o' ? rv.selO : rv.sel; ids.forEach(function (i) { arr.push(i); }); return; }
    ids.forEach(function (id) {
      var ix = arr.indexOf(id);
      if (rem) { if (ix >= 0) arr.splice(ix, 1); } else if (ix < 0) arr.push(id);
    });
  }
  function marqueeSelect(r, cross, e) {
    var add = e.ctrlKey || e.metaKey, rem = e.shiftKey, ws = [], os = [];
    function inR(p) { return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]; }
    W.walls().forEach(function (w) { if (cross ? segRect(w.a, w.b, r) : (inR(w.a) && inR(w.b))) ws.push(w.id); });
    W.ops().forEach(function (o) { var g = W.opGeom(o); if (g && (cross ? segRect([g.c[0] - g.ux * g.wpx / 2, g.c[1] - g.uy * g.wpx / 2], [g.c[0] + g.ux * g.wpx / 2, g.c[1] + g.uy * g.wpx / 2], r) : inR(g.c))) os.push(o.id); });
    if (!add && !rem) { rv.sel = ws; rv.selO = os; return; }
    function merge(arr, list) { list.forEach(function (id) { var ix = arr.indexOf(id); if (rem) { if (ix >= 0) arr.splice(ix, 1); } else if (ix < 0) arr.push(id); }); }
    merge(rv.sel, ws); merge(rv.selO, os);
  }

  // ── правка геометрии ────────────────────────────────────────────────
  function fw() { return G.F(); }
  /**
   * Преобразовать выбранные стены функцией T (перенос, поворот, отражение). Копия — новые стены вместе с проёмами.
   * Перенос: узлы выбранных стен тянут за собой примыкающие стены (они растягиваются), концы чужих стен на теле
   * выбранной переезжают на её новую линию; проёмы выбранных стен едут вместе с ними.
   */
  function transformSel(ids, T, copy) {
    var ws = W.walls(), set = {};
    ids.forEach(function (i) { set[i] = 1; });
    var sel = ws.filter(function (w) { return set[w.id]; });
    if (!sel.length) return [];
    if (copy) {
      var map = {}, out = [];
      sel.forEach(function (w) { var nw = { id: W.nextId(), a: T(w.a).map(r1), b: T(w.b).map(r1), k: w.k }; map[w.id] = nw.id; ws.push(nw); out.push(nw); });
      W.ops().slice().forEach(function (o) {
        if (!map[o.wid]) return;
        var c = JSON.parse(JSON.stringify(o)); c.id = W.nextOid(); c.wid = map[o.wid]; W.ops().push(c);
      });
      out.forEach(function (nw) { W.splitAt(nw.a); W.splitAt(nw.b); });
      return out.map(function (nw) { return nw.id; });
    }
    var nodes = [], riders = [];
    sel.forEach(function (w) { [w.a, w.b].forEach(function (p) { if (!nodes.some(function (q) { return W.ptEq(q, p); })) nodes.push(p.slice()); }); });
    ws.forEach(function (o) {
      if (set[o.id]) return;
      ['a', 'b'].forEach(function (e) {
        var pt = o[e];
        if (nodes.some(function (q) { return W.ptEq(q, pt); })) return;
        for (var i = 0; i < sel.length; i++) {
          var pr = projOn(pt, sel[i].a, sel[i].b);
          if (pr.d < 1.5 && pr.t > 0.001 && pr.t < 0.999) {
            riders.push({ o: o, e: e, oth: o[e === 'a' ? 'b' : 'a'].slice(), pt: pt.slice(), A: sel[i].a.slice(), B: sel[i].b.slice() });
            break;
          }
        }
      });
    });
    var before = ws.map(function (w) { return { w: w, a: w.a.slice(), b: w.b.slice(), l: dist(w.a, w.b) }; });
    var np = nodes.map(T);
    ws.forEach(function (w) {
      ['a', 'b'].forEach(function (e) {
        for (var i = 0; i < nodes.length; i++) if (W.ptEq(w[e], nodes[i])) { w[e] = [r1(np[i][0]), r1(np[i][1])]; return; }
      });
    });
    riders.forEach(function (r) {
      var V = W.lineInter(r.oth, r.pt, T(r.A), T(r.B));
      if (V && dist(V, r.pt) < 1e5) r.o[r.e] = [r1(V[0]), r1(V[1])];
    });
    // проёмы растянутых стен остаются на месте от неподвижного конца
    before.forEach(function (bf) {
      var w = bf.w, nl = dist(w.a, w.b);
      if (Math.abs(nl - bf.l) < 0.5) return;
      var ux = (bf.b[0] - bf.a[0]) / (bf.l || 1), uy = (bf.b[1] - bf.a[1]) / (bf.l || 1);
      var sh = ((w.a[0] - bf.a[0]) * ux + (w.a[1] - bf.a[1]) * uy) / ppm();
      W.ops().forEach(function (o) { if (o.wid === w.id) o.o = Math.round((o.o - sh) * 1000) / 1000; });
    });
    fw().walls = fw().walls.filter(function (w) { return dist(w.a, w.b) / ppm() >= 0.05; });
    W.pruneOps(); W.clampOps();
    return ids;
  }
  function finishEdit(msg) {
    cleanSel();
    W.afterWallEdit();
    if (msg) W.hintWall(msg);
    G.draw();
  }
  function deleteSel() {
    if (!rv.sel.length && !rv.selO.length) return false;
    G.pushUndo('walls');
    var ids = {}, oids = {};
    rv.sel.forEach(function (i) { ids[i] = 1; });
    rv.selO.forEach(function (i) { oids[i] = 1; });
    fw().walls = W.walls().filter(function (w) { return !ids[w.id]; });
    fw().openings = W.ops().filter(function (o) { return !oids[o.id]; });
    W.pruneOps();
    rv.sel = []; rv.selO = [];
    finishEdit('Удалено.');
    return true;
  }
  function setWallLen(id, m) {
    var si = W.wallIndexById(id), sw = W.walls()[si];
    if (!sw || !(m > 0.2 && m < 60)) return;
    G.pushUndo('walls');
    var l = dist(sw.a, sw.b) || 1, ux = (sw.b[0] - sw.a[0]) / l, uy = (sw.b[1] - sw.a[1]) / l;
    W.moveNode(sw.b.slice(), [sw.a[0] + ux * m * ppm(), sw.a[1] + uy * m * ppm()]);
    W.clampOps(); finishEdit();
  }
  function askNum(title, sub, def, cb, unitHint) {
    G.askText({
      title: title, sub: sub, def: def,
      live: function (v) { var m = W.parseLen(v); return m > 0 ? 'Будет ' + W.fm2(m) + ' м' : (v ? 'Не понял число' : ''); }
    }, function (v) { if (v == null) return; var m = W.parseLen(v); if (m > 0) cb(m); });
  }
  function trimWall(w, click, I) {
    var u = unit(w), l = dist(w.a, w.b) || 1;
    var tc = ((click[0] - w.a[0]) * u[0] + (click[1] - w.a[1]) * u[1]) / l, ti = ((I[0] - w.a[0]) * u[0] + (I[1] - w.a[1]) * u[1]) / l;
    var oa = w.a.slice();
    if (ti > tc) w.b = [r1(I[0]), r1(I[1])]; else w.a = [r1(I[0]), r1(I[1])];
    var sh = ((w.a[0] - oa[0]) * u[0] + (w.a[1] - oa[1]) * u[1]) / ppm(), nl = dist(w.a, w.b) / ppm();
    W.ops().forEach(function (o) { if (o.wid === w.id) o.o = Math.round((o.o - sh) * 1000) / 1000; });
    fw().openings = W.ops().filter(function (o) { return o.wid !== w.id || (o.o - o.w / 2 >= 0 && o.o + o.w / 2 <= nl); });
  }

  // ── вид: масштаб колесом, панорама средней кнопкой ──────────────────
  var view = { z: 1, x: 0, y: 0 };
  function applyView() {
    if (view.z === 1 && !view.x && !view.y) { cv.style.transform = ''; cv.style.transformOrigin = ''; cvbox.style.overflow = ''; return; }
    if (!/relative|absolute/.test(getComputedStyle(cvbox).position)) cvbox.style.position = 'relative';
    cvbox.style.overflow = 'hidden';
    cv.style.transformOrigin = '0 0';
    cv.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.z + ')';
  }
  function resetView() { view = { z: 1, x: 0, y: 0 }; applyView(); }
  function viewOk() { return G.mode === 'wall' && !document.documentElement.classList.contains('fs'); }
  cvbox.addEventListener('wheel', function (e) {
    if (!viewOk() || e.target !== cv) return;
    e.preventDefault();
    var br = cvbox.getBoundingClientRect(), offL = cv.offsetLeft, offT = cv.offsetTop;
    var cx0 = e.clientX - br.left - offL, cy0 = e.clientY - br.top - offT;
    var nz = Math.max(1, Math.min(10, view.z * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
    if (Math.abs(nz - 1) < 0.04) nz = 1;
    var qx = (cx0 - view.x) / view.z, qy = (cy0 - view.y) / view.z;
    view.z = nz; view.x = cx0 - nz * qx; view.y = cy0 - nz * qy;
    if (nz === 1) { view.x = 0; view.y = 0; }
    clampView(); applyView(); G.draw();
  }, { passive: false });
  function clampView() {
    var w = cv.offsetWidth, h = cv.offsetHeight;
    view.x = Math.min(0, Math.max(w - w * view.z, view.x));
    view.y = Math.min(0, Math.max(h - h * view.z, view.y));
  }
  var pan = null;
  cvbox.addEventListener('mousedown', function (e) {
    if (e.button !== 1 || !viewOk() || e.target !== cv) return;
    e.preventDefault(); pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    cv.style.cursor = 'grabbing';
  }, true);
  window.addEventListener('mousemove', function (e) {
    if (!pan) return;
    view.x = pan.vx + e.clientX - pan.x; view.y = pan.vy + e.clientY - pan.y; clampView(); applyView();
  });
  window.addEventListener('mouseup', function (e) { if (pan && e.button === 1) { pan = null; cv.style.cursor = ''; } });

  // ── интерфейс: лента, параметры, строка состояния, свойства ─────────
  var css = document.createElement('style');
  css.textContent = [
    '.rv{font:12px "Segoe UI",system-ui,sans-serif;color:#1b1b1b;background:#f3f4f6;border:1px solid #c9ccd1;border-radius:3px;margin:0 0 6px;position:relative;z-index:6;user-select:none}',
    '.rv *{box-sizing:border-box}',
    '.rv .tabs{display:flex;align-items:flex-end;background:#e4e6ea;border-bottom:1px solid #c9ccd1;height:26px;padding-left:6px}',
    '.rv .tab{padding:4px 12px;font-size:12px;color:#444;border:1px solid transparent;border-bottom:0;border-radius:3px 3px 0 0}',
    '.rv .tab.on{background:#fff;border-color:#c9ccd1;color:#111;font-weight:600;position:relative;top:1px}',
    '.rv .tab.ctx{background:#fff3c4;border-color:#d9b94a;color:#4a3b00;font-weight:600;margin-left:6px;position:relative;top:1px}',
    '.rv .rib{display:flex;flex-wrap:wrap;align-items:stretch;background:#fff;padding:3px 4px 0;min-height:86px}',
    '.rv .pn{display:flex;flex-direction:column;border-right:1px solid #d4d7dc;padding:0 7px 0;min-width:48px}',
    '.rv .pn:last-child{border-right:0}',
    '.rv .pb{display:flex;gap:2px;flex:1;align-items:flex-start;padding-top:3px}',
    '.rv .pt{font-size:11px;color:#555;text-align:center;border-top:1px solid #e6e8ec;margin-top:2px;padding:2px 0 3px;white-space:nowrap}',
    '.rv button.lg{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:3px;width:56px;min-height:60px;padding:4px 2px;border:1px solid transparent;background:transparent;border-radius:3px;cursor:pointer;color:#1b1b1b;font:11px "Segoe UI",system-ui,sans-serif;line-height:1.1}',
    '.rv button.sm{display:flex;align-items:center;gap:5px;height:19px;padding:0 5px;border:1px solid transparent;background:transparent;border-radius:3px;cursor:pointer;color:#1b1b1b;font:11px "Segoe UI",system-ui,sans-serif;white-space:nowrap;text-align:left}',
    '.rv button:hover{background:#dcebfb;border-color:#a9cdf2}',
    '.rv button.on{background:#bcd9f7;border-color:#5b9bd5}',
    '.rv button:disabled{opacity:.4;cursor:default;background:transparent;border-color:transparent}',
    '.rv svg{width:30px;height:30px;flex:none}',
    '.rv button.sm svg{width:16px;height:16px}',
    '.rv .grid3{display:grid;grid-auto-flow:column;grid-template-rows:repeat(3,19px);gap:1px 4px;padding-top:3px}',
    '.rv .opt{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;background:#f7f8fa;border-top:1px solid #d4d7dc;padding:4px 10px;min-height:28px;font-size:12px}',
    '.rv .opt label{display:flex;align-items:center;gap:5px;white-space:nowrap}',
    '.rv .opt select,.rv .opt input[type=text]{height:22px;border:1px solid #9aa0a8;border-radius:2px;background:#fff;color:#111;font:12px "Segoe UI",system-ui,sans-serif;padding:0 4px}',
    '.rv .opt input[type=text]{width:64px;text-align:right}',
    '.rv .opt .sep{width:1px;height:18px;background:#cfd2d7}',
    '.rv .opt .st{color:#555}',
    '.rvs{display:flex;justify-content:space-between;gap:12px;font:12px "Segoe UI",system-ui,sans-serif;background:#f3f4f6;border:1px solid #c9ccd1;border-top:0;color:#222;padding:4px 10px;margin:6px 0 0;border-radius:3px;position:relative;z-index:6}',
    '.rvs .p{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.rvs .c{color:#555;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.rvp{position:absolute;right:16px;top:150px;width:236px;background:#fff;border:1px solid #9aa0a8;box-shadow:0 2px 8px rgba(0,0,0,.25);font:12px "Segoe UI",system-ui,sans-serif;color:#111;z-index:7;border-radius:2px;user-select:none}',
    '.rvp .h{background:#e4e6ea;border-bottom:1px solid #c9ccd1;padding:4px 8px;font-weight:600;display:flex;justify-content:space-between;cursor:default}',
    '.rvp .h b{font-weight:600}',
    '.rvp .r{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 8px;border-bottom:1px solid #eceef1;min-height:25px}',
    '.rvp .r span{color:#444}',
    '.rvp select,.rvp input{width:112px;height:21px;border:1px solid #b5bac1;border-radius:2px;font:12px "Segoe UI",system-ui,sans-serif;padding:0 4px;background:#fff;color:#111}',
    '.rvp .g{background:#eef0f3;padding:2px 8px;font-weight:600;font-size:11px;color:#333;border-bottom:1px solid #dde0e5}',
    '.rvm{position:fixed;z-index:99999;background:#fff;border:1px solid #8c9097;box-shadow:2px 3px 10px rgba(0,0,0,.3);font:12px "Segoe UI",system-ui,sans-serif;min-width:210px;padding:2px 0;color:#111}',
    '.rvm div{padding:5px 26px 5px 14px;cursor:default;display:flex;justify-content:space-between;gap:20px}',
    '.rvm div:hover{background:#cfe3fa}',
    '.rvm i{font-style:normal;color:#777}',
    '.rvm hr{border:0;border-top:1px solid #dcdfe3;margin:2px 0}'
  ].join('\n');
  document.head.appendChild(css);

  var S = 'fill="none" stroke="#243b5e" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"';
  var A = '#2f7fd8', FILLB = '#cfe0f7';
  var ICONS = {
    select: '<path d="M7 3.5v21l5.5-5.2 3.7 8.2 3.2-1.4-3.7-8H23z" fill="#fff" stroke="#243b5e" stroke-width="1.6" stroke-linejoin="round"/>',
    wall: '<path d="M4 22L22 6" ' + S + ' stroke-width="5" stroke="' + FILLB + '"/><path d="M4 22L22 6" ' + S + '/><rect x="2" y="20" width="4" height="4" fill="#fff" stroke="#243b5e" stroke-width="1.4"/><rect x="20" y="4" width="4" height="4" fill="#fff" stroke="#243b5e" stroke-width="1.4"/>',
    rect: '<rect x="5" y="7" width="20" height="16" ' + S + ' fill="' + FILLB + '" fill-opacity=".5"/><rect x="3.5" y="5.5" width="3" height="3" fill="#fff" stroke="#243b5e"/><rect x="23.5" y="21.5" width="3" height="3" fill="#fff" stroke="#243b5e"/>',
    win: '<path d="M3 15h5M22 15h5" ' + S + ' stroke-width="4" stroke="' + FILLB + '"/><path d="M3 12h5v6H3zM22 12h5v6h-5z" ' + S + '/><path d="M8 13.5h14M8 16.5h14" stroke="' + A + '" stroke-width="2" fill="none"/>',
    door: '<path d="M3 21h6M21 21h6" ' + S + ' stroke-width="4" stroke="' + FILLB + '"/><path d="M3 18.5h6v5H3zM21 18.5h6v5h-6z" ' + S + '/><path d="M9 21V7M9 7A14 14 0 0 1 21 21" ' + S + ' stroke="#d9822b"/>',
    move: '<path d="M15 3v24M3 15h24M15 3l-3.5 3.8M15 3l3.5 3.8M15 27l-3.5-3.8M15 27l3.5-3.8M3 15l3.8-3.5M3 15l3.8 3.5M27 15l-3.8-3.5M27 15l-3.8 3.5" ' + S + '/>',
    copy: '<rect x="4" y="4" width="14" height="14" ' + S + ' fill="#fff"/><rect x="11" y="11" width="14" height="14" ' + S + ' fill="' + FILLB + '"/>',
    rotate: '<path d="M23 11A9 9 0 1 0 24 17" ' + S + '/><path d="M24 4v7h-7" ' + S + '/>',
    mirror: '<path d="M15 3v24" stroke="#d9822b" stroke-width="1.6" stroke-dasharray="3 2.5"/><path d="M12 7L4 22h8zM18 7l8 15h-8z" ' + S + ' fill="' + FILLB + '"/>',
    mirrorDraw: '<path d="M15 3v24" stroke="#d9822b" stroke-width="1.6" stroke-dasharray="3 2.5"/><path d="M12 8L5 21h7zM18 8l7 13h-7z" ' + S + ' fill="' + FILLB + '"/><circle cx="15" cy="15" r="2.2" fill="#d9822b"/>',
    offset: '<path d="M5 9h20M5 21h20" ' + S + '/><path d="M15 12v6M12.5 15.5L15 18l2.5-2.5" ' + S + ' stroke="' + A + '"/>',
    align: '<path d="M6 4v22" stroke="#d9822b" stroke-width="2"/><path d="M10 9h14M10 20h9" ' + S + '/><path d="M14 20H9M11 17.5L8.5 20l2.5 2.5" ' + S + ' stroke="' + A + '"/>',
    trim: '<path d="M5 24V10h16" ' + S + '/><path d="M5 24h5M16 10v10" stroke="#d9822b" stroke-width="2"/><path d="M22 18l4 4m0-4l-4 4" ' + S + ' stroke="#c0392b"/>',
    split: '<path d="M3 15h24" ' + S + '/><path d="M15 7v16" stroke="#c0392b" stroke-width="2" stroke-dasharray="2.5 2"/><path d="M11 5l8 4M19 5l-8 4" ' + S + ' stroke="#c0392b" stroke-width="1.3"/>',
    del: '<path d="M7 7l16 16M23 7L7 23" ' + S + ' stroke="#c0392b" stroke-width="2.4"/>',
    measure: '<path d="M3 20L20 3l7 7L10 27z" ' + S + ' fill="' + FILLB + '"/><path d="M8.5 15l3 3M11.5 12l2 2M14.5 9l3 3" ' + S + '/>',
    fit: '<path d="M4 11V4h7M19 4h7v7M26 19v7h-7M11 26H4v-7" ' + S + '/><rect x="9" y="9" width="12" height="12" ' + S + ' fill="' + FILLB + '" fill-opacity=".6"/>',
    under: '<rect x="4" y="5" width="22" height="20" ' + S + '/><path d="M4 15h22M15 5v20" ' + S + ' stroke-dasharray="2 2"/>',
    snap: '<rect x="8" y="8" width="14" height="14" ' + S + ' fill="#fff"/><path d="M5 15h20M15 5v20" stroke="' + A + '" stroke-width="1.4"/>',
    size: '<path d="M4 20h22M4 16v8M26 16v8" ' + S + '/><path d="M8 12h14" ' + S + ' stroke="' + A + '"/>',
    house: '<path d="M4 14L15 5l11 9v11H4z" ' + S + ' fill="' + FILLB + '"/><path d="M12 25v-8h6v8" ' + S + '/>'
  };
  function ic(n) { return '<svg viewBox="0 0 30 30">' + (ICONS[n] || '') + '</svg>'; }
  function big(t, ico, label, tip) { return '<button class="lg" data-t="' + t + '" title="' + tip + '">' + ic(ico) + '<span>' + label + '</span></button>'; }
  function small(t, ico, label, tip) { return '<button class="sm" data-t="' + t + '" title="' + tip + '">' + ic(ico) + '<span>' + label + '</span></button>'; }

  var ui = document.createElement('div'); ui.className = 'rv'; ui.style.display = 'none';
  ui.innerHTML =
    '<div class="tabs"><div class="tab">Архитектура</div><div class="tab ctx" id="rv_ctx">Изменить | Размещение стен</div></div>' +
    '<div class="rib">' +
    '<div class="pn"><div class="pb">' + big('select', 'select', 'Изменить', 'Режим выбора и правки (Esc)') + '</div><div class="pt">Выбор</div></div>' +
    '<div class="pn"><div class="pb">' + big('kind-ext', 'wall', 'Наружная', 'Рисовать наружные стены (тип)') + big('kind-int', 'wall', 'Внутренняя', 'Рисовать перегородки (тип)') + '</div><div class="pt">Тип стены</div></div>' +
    '<div class="pn"><div class="pb">' + big('wall', 'wall', 'Стена', 'Стена по точкам (WA)') + big('rect', 'rect', 'Прямоугольник', 'Прямоугольник из четырёх стен (RC)') + big('win', 'win', 'Окно', 'Поставить окно (WN)') + big('door', 'door', 'Дверь', 'Поставить дверь (DR)') + '</div><div class="pt">Рисование</div></div>' +
    '<div class="pn"><div class="grid3">' +
    small('move', 'move', 'Переместить', 'Переместить (MV)') + small('copy', 'copy', 'Копировать', 'Копировать (CO)') + small('rotate', 'rotate', 'Повернуть', 'Повернуть (RO)') +
    small('mirror', 'mirror', 'Зеркало: ось', 'Отразить относительно стены (MM)') + small('mirrorDraw', 'mirrorDraw', 'Зеркало: ось по точкам', 'Отразить, нарисовав ось (DM)') + small('offset', 'offset', 'Подобие', 'Подобие: параллельная стена (OF)') +
    small('align', 'align', 'Выровнять', 'Выровнять стену по грани другой (AL)') + small('trim', 'trim', 'Подрезать до угла', 'Подрезать или удлинить до угла (TR)') + small('split', 'split', 'Разделить', 'Разделить стену в точке (SL)') +
    small('delete', 'del', 'Удалить', 'Удалить выбранное (DE, Delete)') +
    '</div><div class="pt">Изменить</div></div>' +
    '<div class="pn"><div class="pb">' + big('measure', 'measure', 'Рулетка', 'Измерить расстояние между двумя точками (DI)') + big('size', 'size', 'Размеры комнаты', 'Размеры комнаты или длина стены вводом') + big('house', 'house', 'Размеры дома', 'Ширина и глубина дома по осям наружных стен') + '</div><div class="pt">Измерить</div></div>' +
    '<div class="pn"><div class="pb">' + big('fit', 'fit', 'Показать всё', 'Вернуть масштаб (ZE). Колесо — масштаб, средняя кнопка — панорама') + big('under', 'under', 'План / разметка', 'Только план, только разметка, оба (U)') + big('snap', 'snap', 'Прилипание', 'Прилипание к граням на плане (S)') + '</div><div class="pt">Вид</div></div>' +
    '</div>' +
    '<div class="opt" id="rv_opt"></div>';
  var bar = document.createElement('div'); bar.className = 'rvs'; bar.style.display = 'none';
  bar.innerHTML = '<div class="p" id="rv_prompt"></div><div class="c" id="rv_coord"></div>';
  var props = document.createElement('div'); props.className = 'rvp'; props.style.display = 'none';
  cvbox.insertBefore(ui, cvbox.firstChild);
  cvbox.appendChild(bar);
  cvbox.appendChild(props);
  if (!/relative|absolute/.test(getComputedStyle(cvbox).position)) cvbox.style.position = 'relative';

  ui.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-t]');
    if (!b || b.disabled) return;
    var t = b.getAttribute('data-t');
    if (t === 'kind-ext' || t === 'kind-int') { W.setTool('wall'); setTool('wall'); G.wallsKindSet(t === 'kind-int' ? 'int' : 'ext'); sig = ''; G.draw(); return; }
    if (t === 'delete') { if (!deleteSel()) W.hintWall('Сначала выберите, что удалить.'); return; }
    if (t === 'fit') { resetView(); G.draw(); return; }
    if (t === 'under') { G.wallsViewCycle(); G.draw(); return; }
    if (t === 'snap') { G.wallsSnapToggle(); sig = ''; G.draw(); return; }
    if (t === 'size') { G.wallsTool('size'); return; }
    if (t === 'house') { G.wallsHouseSize(); return; }
    setTool(t);
  });
  var optBox = ui.querySelector('#rv_opt');
  optBox.addEventListener('change', onOpt); optBox.addEventListener('input', function (e) { if (e.target.type === 'text') onOpt(e); });
  optBox.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
  function onOpt(e) {
    var t = e.target, id = t.getAttribute('data-o');
    if (!id) return;
    if (id === 'loc') G.wallsLoc(t.value);
    else if (id === 'chain') G.wallsChain(t.checked);
    else if (id === 'off') { var v = W.parseLen(t.value.replace(/^-/, '')) * (/^\s*-/.test(t.value) ? -1 : 1); G.wallsOff(isFinite(v) ? v : 0); }
    else if (id === 'multi') rv.opt.multi = t.checked;
    else if (id === 'mcopy') rv.opt.mcopy = t.checked;
    else if (id === 'rcopy') rv.opt.rcopy = t.checked;
    else if (id === 'ocopy') rv.opt.ocopy = t.checked;
    else if (id === 'omode') rv.opt.onum = t.value === 'num';
    else if (id === 'odist') { var d = parseFloat(String(t.value).replace(',', '.')); if (d > 0) rv.opt.odist = d; }
    else if (id === 'aface') rv.opt.afaces = t.value === 'face';
    if (id !== 'off' && id !== 'odist') { sig = ''; G.draw(); }
  }

  var sig = '';
  function uiSync() {
    var on = G.mode === 'wall';
    if (ui.style.display !== (on ? '' : 'none')) {
      ui.style.display = on ? '' : 'none'; bar.style.display = on ? '' : 'none';
      if (!on) { props.style.display = 'none'; resetView(); }
    }
    if (!on) return;
    var t = G.WI.getTool && rv.tool;
    var key = [rv.tool, rv.phase, W.getKind(), G.wallsLocGet(), G.wallsChainGet(), G.wallsSnapGet(), rv.sel.length, rv.selO.length, rv.opt.onum, rv.opt.afaces, rv.opt.mcopy, rv.opt.rcopy, rv.opt.ocopy, rv.opt.multi, G.wallsViewGet()].join('|');
    if (key !== sig) {
      sig = key;
      var tools = ui.querySelectorAll('button[data-t]');
      for (var i = 0; i < tools.length; i++) {
        var n = tools[i].getAttribute('data-t'), act = n === rv.tool || (n === 'kind-ext' && rv.tool === 'wall' && W.getKind() === 'ext') || (n === 'kind-int' && rv.tool === 'wall' && W.getKind() === 'int') || (n === 'snap' && G.wallsSnapGet());
        if (n === 'wall' && rv.tool === 'wall') act = true;
        tools[i].classList.toggle('on', !!act);
        if (n === 'delete') tools[i].disabled = !(rv.sel.length || rv.selO.length);
        if (n === 'kind-ext' || n === 'kind-int') tools[i].classList.toggle('on', rv.tool === 'wall' && W.getKind() === (n === 'kind-int' ? 'int' : 'ext'));
      }
      var draw = rv.tool === 'wall' || rv.tool === 'rect' || rv.tool === 'win' || rv.tool === 'door';
      ui.querySelector('#rv_ctx').textContent = draw ? 'Изменить | Размещение ' + (rv.tool === 'win' ? 'окон' : rv.tool === 'door' ? 'дверей' : 'стен') : (rv.sel.length || rv.selO.length ? 'Изменить | Стены' : 'Изменить');
      optBox.innerHTML = optionsHtml();
    }
    var pr = promptText();
    var pe = bar.querySelector('#rv_prompt');
    if (pe.textContent !== pr) pe.textContent = pr;
    syncProps();
  }
  function optionsHtml() {
    var h = '<b class="st">' + toolName[rv.tool] + '</b><span class="sep"></span>', loc = G.wallsLocGet(), off = G.wallsOffGet();
    function chk(id, label, v) { return '<label><input type="checkbox" data-o="' + id + '"' + (v ? ' checked' : '') + '>' + label + '</label>'; }
    if (rv.tool === 'wall' || rv.tool === 'rect') {
      h += '<label>Линия привязки:<select data-o="loc"><option value="c"' + (loc === 'c' ? ' selected' : '') + '>Ось стены</option><option value="o"' + (loc === 'o' ? ' selected' : '') + '>Чистовая грань: наружная</option><option value="i"' + (loc === 'i' ? ' selected' : '') + '>Чистовая грань: внутренняя</option></select></label>';
      if (rv.tool === 'wall') h += chk('chain', 'Цепочка', G.wallsChainGet());
      h += '<label>Смещение:<input type="text" data-o="off" value="' + (Math.round(off * 1000) / 10 || 0).toString().replace('.', ',') + '"> см</label>';
      h += '<span class="st">Пробел — другая сторона, Shift — ортогонально</span>';
    } else if (rv.tool === 'win' || rv.tool === 'door') {
      h += '<span class="st">Щёлкните по стене. Enter или двойной щелчок по проёму — размеры</span>';
    } else if (rv.tool === 'select') {
      var n = rv.sel.length + rv.selO.length;
      h += n ? '<span>Выбрано: ' + rv.sel.length + ' ст.' + (rv.selO.length ? ', ' + rv.selO.length + ' пр.' : '') + '</span>' : '<span class="st">Ничего не выбрано</span>';
    } else if (rv.tool === 'copy') {
      h += chk('multi', 'Несколько', rv.opt.multi) + '<span class="st">Esc — закончить</span>';
    } else if (rv.tool === 'rotate') {
      h += chk('rcopy', 'Копировать', rv.opt.rcopy) + '<span class="st">Угол можно набрать цифрами и нажать Enter</span>';
    } else if (rv.tool === 'mirror' || rv.tool === 'mirrorDraw') {
      h += chk('mcopy', 'Копировать', rv.opt.mcopy);
    } else if (rv.tool === 'offset') {
      h += '<label><select data-o="omode"><option value="num"' + (rv.opt.onum ? ' selected' : '') + '>Числовой</option><option value="gr"' + (rv.opt.onum ? '' : ' selected') + '>Графический</option></select></label>' +
        (rv.opt.onum ? '<label>Смещение:<input type="text" data-o="odist" value="' + String(rv.opt.odist).replace('.', ',') + '"> см</label>' : '') + chk('ocopy', 'Копировать', rv.opt.ocopy);
    } else if (rv.tool === 'align') {
      h += '<label>Привязка:<select data-o="aface"><option value="face"' + (rv.opt.afaces ? ' selected' : '') + '>Грань стены</option><option value="axis"' + (rv.opt.afaces ? '' : ' selected') + '>Ось стены</option></select></label>';
    } else if (rv.tool === 'measure') {
      h += '<span class="st">Две точки: расстояние и разности по осям</span>';
    } else h += '<span class="st">Размеры</span>';
    return h;
  }
  function promptText() {
    var t = rv.tool, ph = rv.phase, hasSel = rv.sel.length || rv.selO.length;
    if (t === 'wall') return W.isDrawing() ? 'Щёлкните, чтобы указать следующую точку стены. Цифры — длина, Enter — поставить, Shift — ортогонально, двойной щелчок — закончить.' : 'Щёлкните, чтобы указать начальную точку стены.';
    if (t === 'rect') return ph === 'c2' ? 'Щёлкните противоположный угол. Можно набрать размеры: 6x4 и Enter.' : 'Щёлкните, чтобы указать первый угол прямоугольника.';
    if (t === 'win') return 'Щёлкните по стене, чтобы поставить окно.';
    if (t === 'door') return 'Щёлкните по стене, чтобы поставить дверь.';
    if (t === 'legacy') return G.wallsToolGet && G.wallsToolGet() === 'size' ? 'Щёлкните по стене или комнате, чтобы задать размеры.' : '';
    if (t === 'select') return hasSel ? 'Перетащите ручку на конце стены или саму стену. Delete — удалить, Tab — цепочка, правая кнопка — меню.' : 'Щёлкните, чтобы выбрать. Рамка слева направо — внутри, справа налево — с пересечением. Ctrl — добавить, Shift — убрать.';
    if (ph === 'pick') return toolName[t] + ': выберите стены и нажмите Enter или Пробел.';
    if (t === 'move' || t === 'copy') return ph === 'target' ? 'Щёлкните вторую точку или наберите расстояние и Enter.' : 'Щёлкните начальную (базовую) точку.';
    if (t === 'rotate') return ph === 'center' ? 'Щёлкните центр поворота (Enter — центр выбранного).' : ph === 'ray1' ? 'Щёлкните начало луча или наберите угол и Enter.' : 'Щёлкните конец луча. Shift — шаг 15°.';
    if (t === 'mirror') return 'Щёлкните стену, которая будет осью зеркала.';
    if (t === 'mirrorDraw') return ph === 'a2' ? 'Щёлкните вторую точку оси.' : 'Щёлкните первую точку оси зеркала.';
    if (t === 'offset') return ph === 'g2' ? 'Отодвиньте курсор на нужное расстояние и щёлкните.' : (rv.opt.onum ? 'Щёлкните стену: с той стороны, куда сместить на ' + rv.opt.odist + ' см.' : 'Щёлкните стену, затем укажите расстояние.');
    if (t === 'align') return ph === 'mov' ? 'Щёлкните стену, которую надо выровнять.' : 'Щёлкните стену, к грани которой выравниваем.';
    if (t === 'trim') return ph === 't2' ? 'Щёлкните вторую стену (часть, которую оставить).' : 'Щёлкните первую стену (часть, которую оставить).';
    if (t === 'split') return 'Щёлкните точку на стене, где разделить.';
    if (t === 'measure') return ph === 'm2' ? 'Щёлкните вторую точку.' : 'Щёлкните первую точку.';
    return '';
  }

  // палитра свойств
  var propSig = '';
  function syncProps() {
    var show = G.mode === 'wall' && (rv.tool === 'select' || rv.phase === 'pick');
    if (!show) { props.style.display = 'none'; propSig = ''; return; }
    var ws = selWalls(), os = rv.selO.map(function (id) { return W.ops().filter(function (o) { return o.id === id; })[0]; }).filter(Boolean);
    var key = ws.map(function (w) { return w.id + w.k + Math.round(dist(w.a, w.b)); }).join(',') + '|' + os.map(function (o) { return o.id + o.k + o.w + o.h + o.sill; }).join(',') + '|' + (G.wallsCount ? G.wallsCount() : 0);
    props.style.display = '';
    if (key === propSig && props.firstChild) return;
    propSig = key;
    var h = '<div class="h"><b>Свойства</b><span>' + (ws.length + os.length ? 'Выбрано: ' + (ws.length + os.length) : 'Этаж') + '</span></div>';
    function row(a, b) { return '<div class="r"><span>' + a + '</span>' + b + '</div>'; }
    if (ws.length === 1 && !os.length) {
      var w = ws[0], L = dist(w.a, w.b) / ppm();
      h += '<div class="g">Стена</div>' +
        row('Тип', '<select data-p="kind"><option value="ext"' + (w.k === 'ext' ? ' selected' : '') + '>Наружная</option><option value="int"' + (w.k === 'int' ? ' selected' : '') + '>Внутренняя</option></select>') +
        row('Длина, м', '<input data-p="len" value="' + W.fm2(L) + '">') +
        row('Толщина, см', '<input data-p="thick" disabled value="' + W.fm2(W.thickPx(w) / ppm() * 100) + '">') +
        row('Проёмов', '<input disabled value="' + W.ops().filter(function (o) { return o.wid === w.id; }).length + '">');
    } else if (ws.length > 1 && !os.length) {
      var tl = 0, ne = 0; ws.forEach(function (w) { tl += dist(w.a, w.b) / ppm(); if (w.k === 'ext') ne++; });
      h += '<div class="g">Стены</div>' + row('Количество', '<input disabled value="' + ws.length + '">') + row('Общая длина, м', '<input disabled value="' + W.fm2(tl) + '">') +
        row('Тип', '<select data-p="kind"><option value="">Разные</option><option value="ext">Наружная</option><option value="int">Внутренняя</option></select>');
    } else if (os.length === 1 && !ws.length) {
      var o = os[0];
      h += '<div class="g">' + (o.k === 'win' ? 'Окно' : 'Дверь') + '</div>' + row('Ширина, м', '<input data-p="ow" value="' + W.fm2(o.w) + '">') + row('Высота, м', '<input data-p="oh" value="' + W.fm2(o.h) + '">') +
        (o.k === 'win' ? row('Подоконник, м', '<input data-p="os" value="' + W.fm2(o.sill || 0) + '">') : '');
    } else if (ws.length + os.length > 1) {
      h += '<div class="g">Выбрано несколько</div>' + row('Стен', '<input disabled value="' + ws.length + '">') + row('Проёмов', '<input disabled value="' + os.length + '">');
    } else {
      var st = G.wallsStats ? G.wallsStats() : { n: 0, ext: 0, int: 0, wins: 0, doors: 0 };
      h += '<div class="g">Стены этажа</div>' + row('Стен', '<input disabled value="' + st.n + '">') + row('Наружных, м', '<input disabled value="' + W.fm2(st.ext) + '">') + row('Внутренних, м', '<input disabled value="' + W.fm2(st.int) + '">') +
        row('Окон / дверей', '<input disabled value="' + st.wins + ' / ' + st.doors + '">');
    }
    props.innerHTML = h;
  }
  props.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
  props.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  props.addEventListener('change', function (e) {
    var t = e.target, p = t.getAttribute('data-p');
    if (!p) return;
    if (p === 'kind') { if (!t.value) return; G.pushUndo('walls'); rv.sel.forEach(function (id) { var w = wById(id); if (w) w.k = t.value; }); finishEdit(); }
    else if (p === 'len') { var m = W.parseLen(t.value); if (m > 0 && rv.sel.length === 1) setWallLen(rv.sel[0], m); }
    else {
      var o = W.ops().filter(function (q) { return q.id === rv.selO[0]; })[0], m2 = W.parseLen(t.value);
      if (!o || !(m2 >= 0)) return;
      G.pushUndo('walls');
      if (p === 'ow' && m2 >= 0.3 && m2 <= 6) o.w = m2; else if (p === 'oh' && m2 >= 0.3 && m2 <= 4) o.h = m2; else if (p === 'os') o.sill = m2;
      W.clampOps(); finishEdit();
    }
    propSig = ''; G.draw();
  });

  // ── переключение инструментов ───────────────────────────────────────
  function cancelOp() { rv.phase = ''; rv.base = null; rv.typed = ''; rv.tmp = null; rv.sd = null; rv.cur = null; }
  function setTool(t) {
    cancelOp();
    if (t === rv.tool && t !== 'select' && !NEEDSEL[t]) { /* повторный щелчок — перезапуск */ }
    rv.tool = t;
    inSet = true;
    try {
      if (G.mode !== 'wall') G.setMode('wall');
      if (t === 'wall' || t === 'win' || t === 'door') { W.setTool(t); }
      else { W.setTool('wall'); G.wallsFinish(); }
    } finally { inSet = false; }
    G.wallsClearHover();
    if (NEEDSEL[t]) {
      cleanSel();
      rv.phase = (rv.sel.length ? firstPhase(t) : 'pick');
    } else rv.phase = firstPhase(t, true);
    sig = ''; propSig = '';
    try { W.updateHint(); } catch (e) { }
    G.draw();
  }
  function firstPhase(t, noSel) {
    if (t === 'move' || t === 'copy') return 'base';
    if (t === 'rotate') return 'center';
    if (t === 'mirror') return 'axis';
    if (t === 'mirrorDraw') return 'a1';
    if (t === 'offset') return 'g1';
    if (t === 'align') return 'ref';
    if (t === 'trim') return 't1';
    if (t === 'measure') return 'm1';
    if (t === 'rect') return 'c1';
    return '';
  }
  // старые вызовы из панели шага «Стены» (wzBody): синхронизируем свой инструмент
  var oTool = G.wallsTool, oKind = G.wallsKind, oStart = G.wallsStart, oOnMode = G.wallsOnMode;
  G.wallsTool = function (t) {
    oTool(t);
    var nt = t === 'win' || t === 'door' ? t : (t === 'move' || t === 'size' ? 'legacy' : 'wall');
    rv.tool = nt; cancelOp(); sig = ''; if (nt === 'wall') rv.phase = 'c1';
  };
  G.wallsKind = function (kd) { oKind(kd); rv.tool = 'wall'; cancelOp(); sig = ''; };
  G.wallsStart = function () { oStart(); if (!inSet) { rv.tool = 'wall'; cancelOp(); sig = ''; } };
  G.wallsOnMode = function (m) {
    oOnMode(m);
    if (m === 'wall') { if (!inSet && !MINE[rv.tool] && rv.tool !== 'legacy' && rv.tool !== 'win' && rv.tool !== 'door') rv.tool = 'wall'; }
    else { cancelOp(); rv.sel = []; rv.selO = []; rv.tool = 'wall'; sig = ''; }
  };
  var oSetTool = W.setTool;

  // ── указатель ───────────────────────────────────────────────────────
  function ev(e) { return G.evPt(e); }
  function snapP(raw, e, from) { return W.snap(raw, from || null, e.altKey, !!(from && e.shiftKey)); }
  function inBox(e) { return e.target === cv; }
  function pickPhase() { return rv.phase === 'pick'; }
  function selecting() { return rv.tool === 'select' || pickPhase(); }

  function onDown(e) {
    if (!own() || e.button !== 0 || !inBox(e)) return;
    closeMenu();
    e.stopImmediatePropagation();
    var raw = ev(e);
    // ручки и тело выбранной стены: только в «Изменить»
    if (rv.tool === 'select') {
      var kc = kk();
      // клик по числу временного размера
      var px = raw[0] * kc, py = raw[1] * kc;
      for (var i = 0; i < rv.dimBoxes.length; i++) {
        var b = rv.dimBoxes[i];
        if (px >= b.x - b.w / 2 && px <= b.x + b.w / 2 && py >= b.y - b.h / 2 && py <= b.y + b.h / 2) { rv.sd = { box: b }; return; }
      }
      if (rv.sel.length === 1 && !rv.selO.length) {
        var w = wById(rv.sel[0]);
        if (w) {
          var r = 9 / kc, ep = dist(raw, w.a) < r ? 'a' : (dist(raw, w.b) < r ? 'b' : null);
          if (ep) {
            G.pushUndo('walls');
            var o = w[ep].slice(), ends = [];
            W.walls().forEach(function (s) { if (W.ptEq(s.a, o)) ends.push([s, 'a']); if (W.ptEq(s.b, o)) ends.push([s, 'b']); });
            rv.sd = { grip: true, ends: ends, moved: false }; return;
          }
        }
      }
      var h = hitAt(raw);
      if (h && h.t === 'w' && rv.sel.indexOf(h.id) >= 0 && !e.ctrlKey && !e.shiftKey && !rv.chainHover) {
        G.pushUndo('walls');
        rv.sd = { body: true, raw0: raw, base: JSON.stringify(W.walls()), ops: JSON.stringify(W.ops()), moved: false, ids: rv.sel.slice() };
        return;
      }
    }
    rv.sd = { mq: true, p0: raw, p1: raw, moved: false, hit: hitAt(raw) };
  }
  function onMove(e) {
    if (!own() || !inBox(e) && !rv.sd) return;
    var raw = ev(e);
    if (e.target === cv) setCoord(raw);
    if (rv.sd && (e.buttons & 1)) { e.stopImmediatePropagation(); dragMove(raw, e); return; }
    if (rv.sd && !(e.buttons & 1)) rv.sd = null;
    if (!inBox(e)) return;
    e.stopImmediatePropagation();
    toolMove(raw, e);
  }
  function dragMove(raw, e) {
    var sd = rv.sd, kc = kk();
    if (sd.mq) {
      if (!sd.moved && dist(raw, sd.p0) * kc > 4) sd.moved = true;
      sd.p1 = raw; G.draw(); return;
    }
    if (sd.grip) {
      var sn = W.snap(raw, null, e.altKey, false);
      sd.moved = true;
      sd.ends.forEach(function (x) { x[0][x[1]] = [sn.p[0], sn.p[1]]; });
      rv.cur = sn; cv.style.cursor = 'grabbing'; G.draw(); return;
    }
    if (sd.body) {
      var base = JSON.parse(sd.base); fw().walls = base; fw().openings = JSON.parse(sd.ops);
      var dx = raw[0] - sd.raw0[0], dy = raw[1] - sd.raw0[1], g = W.GRID_M * ppm();
      if (sd.ids.length === 1) {   // одна стена тянется поперёк себя, углы остаются прямыми
        var s0 = wById(sd.ids[0]), u = unit(s0), d = (dx * -u[1] + dy * u[0]);
        d = Math.round(d / g) * g; sd.moved = d !== 0;
        if (d) W.moveWallBy(W.wallIndexById(sd.ids[0]), d);
      } else {
        dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        sd.moved = !!(dx || dy);
        if (sd.moved) transformSel(sd.ids, moveFn(dx, dy), false);
      }
      cv.style.cursor = 'move'; G.draw(); return;
    }
  }
  function onUp(e) {
    if (!own()) return;
    var sd = rv.sd;
    if (!sd) return;
    rv.sd = null;
    e.stopImmediatePropagation();
    var raw = ev(e);
    if (sd.box) { sd.box.act(); return; }
    if (sd.grip) {
      if (!sd.moved) { if (G.undoStack.length) G.undoStack.pop(); return; }
      fw().walls = fw().walls.filter(function (s) { return dist(s.a, s.b) / ppm() >= 0.05; });
      W.pruneOps(); W.clampOps();
      fw().walls.slice().forEach(function (s) { W.splitAt(s.a); W.splitAt(s.b); });
      finishEdit(); return;
    }
    if (sd.body) {
      if (!sd.moved) { if (G.undoStack.length) G.undoStack.pop(); fw().walls = JSON.parse(sd.base); fw().openings = JSON.parse(sd.ops); clickSelect(sd, e); return; }
      finishEdit(); return;
    }
    if (sd.mq) {
      if (sd.moved) {
        var r = [Math.min(sd.p0[0], sd.p1[0]), Math.min(sd.p0[1], sd.p1[1]), Math.max(sd.p0[0], sd.p1[0]), Math.max(sd.p0[1], sd.p1[1])];
        marqueeSelect(r, sd.p1[0] < sd.p0[0], e);
        afterSelect(); return;
      }
      clickSelect(sd, e);
    }
  }
  function clickSelect(sd, e) {
    if (selecting()) { applySel(sd.hit || hitAt(sd.p0 || ev(e)), e); afterSelect(); return; }
    toolClick(ev(e), e);
  }
  function afterSelect() { sig = ''; propSig = ''; G.draw(); }
  function onDbl(e) {
    if (!own() || !inBox(e)) return;
    e.stopImmediatePropagation();
    var raw = ev(e);
    if (rv.tool === 'select') {
      var h = hitAt(raw);
      if (h && h.t === 'o') W.editOp(h.i);
      else if (h && h.t === 'w') { W.setLegacySel(h.i, -1); W.askWallLen(h.i); }
    }
  }
  function onCtx(e) {
    if (G.mode !== 'wall' || !inBox(e)) return;
    if (!own()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (rv.tool !== 'select' && !pickPhase()) { if (rv.phase && rv.phase !== firstPhase(rv.tool)) { var t0 = rv.tool; cancelOp(); rv.phase = NEEDSEL[t0] && rv.sel.length === 0 ? 'pick' : firstPhase(t0); sig = ''; G.draw(); } else setTool('select'); return; }
    var raw = ev(e), h = hitAt(raw);
    if (h && !(h.t === 'w' ? rv.sel.indexOf(h.id) >= 0 : rv.selO.indexOf(h.id) >= 0)) { rv.sel = []; rv.selO = []; (h.t === 'w' ? rv.sel : rv.selO).push(h.id); afterSelect(); }
    openMenu(e.clientX, e.clientY, h);
  }
  cvbox.addEventListener('mousedown', onDown, true);
  cvbox.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  cvbox.addEventListener('click', function (e) { if (own() && inBox(e)) e.stopImmediatePropagation(); }, true);
  cvbox.addEventListener('dblclick', onDbl, true);
  cvbox.addEventListener('contextmenu', onCtx, true);

  // контекстное меню
  var menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openMenu(x, y, h) {
    closeMenu();
    var has = rv.sel.length || rv.selO.length, items = [];
    function it(label, key, fn) { items.push({ label: label, key: key, fn: fn }); }
    it('Отмена', '', function () { });
    if (has) {
      items.push('-');
      it('Переместить', 'MV', function () { setTool('move'); });
      it('Копировать', 'CO', function () { setTool('copy'); });
      it('Повернуть', 'RO', function () { setTool('rotate'); });
      it('Зеркало: ось — стена', 'MM', function () { setTool('mirror'); });
      it('Подобие', 'OF', function () { setTool('offset'); });
      it('Разделить', 'SL', function () { setTool('split'); });
      if (rv.sel.length) {
        items.push('-');
        it('Сделать наружной', '', function () { G.pushUndo('walls'); rv.sel.forEach(function (id) { var w = wById(id); if (w) w.k = 'ext'; }); finishEdit(); });
        it('Сделать внутренней', '', function () { G.pushUndo('walls'); rv.sel.forEach(function (id) { var w = wById(id); if (w) w.k = 'int'; }); finishEdit(); });
        if (rv.sel.length === 1) it('Длина стены…', '', function () { W.askWallLen(W.wallIndexById(rv.sel[0])); });
        it('Выбрать цепочку', 'Tab', function () { rv.sel = chainOf(rv.sel[0]); afterSelect(); });
      }
      items.push('-');
      it('Удалить', 'Del', function () { deleteSel(); });
    } else {
      items.push('-');
      it('Стена', 'WA', function () { setTool('wall'); });
      it('Прямоугольник', 'RC', function () { setTool('rect'); });
      it('Показать всё', 'ZE', function () { resetView(); G.draw(); });
    }
    menuEl = document.createElement('div'); menuEl.className = 'rvm';
    items.forEach(function (m) {
      if (m === '-') { menuEl.appendChild(document.createElement('hr')); return; }
      var d = document.createElement('div'); d.innerHTML = '<span>' + m.label + '</span><i>' + m.key + '</i>';
      d.onclick = function () { closeMenu(); m.fn(); };
      menuEl.appendChild(d);
    });
    menuEl.style.left = Math.min(x, window.innerWidth - 230) + 'px'; menuEl.style.top = Math.min(y, window.innerHeight - 20 - items.length * 24) + 'px';
    document.body.appendChild(menuEl);
  }
  document.addEventListener('mousedown', function (e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);

  function setCoord(p) {
    var el = bar.querySelector('#rv_coord');
    el.textContent = 'X: ' + W.fm2(p[0] / ppm()) + '   Y: ' + W.fm2(p[1] / ppm()) + ' м';
  }

  // ── инструменты: движение курсора ───────────────────────────────────
  function toolMove(raw, e) {
    var t = rv.tool, ph = rv.phase, from = rv.base && rv.base.length === 2 && typeof rv.base[0] === 'number' ? rv.base : null;
    cv.style.cursor = 'crosshair';
    rv.hoverHit = null;
    if (selecting() || t === 'offset' || t === 'align' || t === 'trim' || t === 'split' || t === 'mirror') {
      var h = hitAt(raw);
      rv.hoverHit = h; rv.chainHover = rv.chainHover && !!h;
      cv.style.cursor = h ? 'pointer' : (selecting() ? 'default' : 'crosshair');
      if (rv.tool === 'select' && rv.sel.length === 1) {
        var w = wById(rv.sel[0]), r = 9 / kk();
        if (w && (dist(raw, w.a) < r || dist(raw, w.b) < r)) cv.style.cursor = 'grab';
      }
    }
    if (t === 'split') {
      var wi = W.wallAt(raw);
      rv.cur = wi >= 0 ? splitPoint(raw, wi) : null;
    } else if (t === 'offset' || t === 'align' || t === 'trim' || t === 'mirror') {
      rv.cur = { p: raw, t: 'grid' };
    } else if (!selecting()) {
      var sn = W.snap(raw, from, e.altKey, !!(from && e.shiftKey));
      if (t === 'rotate' && ph === 'ray2' && e.shiftKey && rv.tmp && rv.tmp.c) {
        var c = rv.tmp.c, a0 = Math.atan2(rv.base[1] - c[1], rv.base[0] - c[0]), a1 = Math.atan2(raw[1] - c[1], raw[0] - c[0]), st = Math.PI / 12;
        var da = Math.round((a1 - a0) / st) * st, rr = dist(raw, c);
        sn = { p: [c[0] + Math.cos(a0 + da) * rr, c[1] + Math.sin(a0 + da) * rr], t: 'ortho' };
      }
      rv.cur = sn;
    } else rv.cur = null;
    G.draw();
  }
  function splitPoint(raw, wi) {
    var w = W.walls()[wi], pr = projOn(raw, w.a, w.b), m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    if (dist(pr.q, m) < 9 / kk()) return { p: m, t: 'mid', wi: wi };
    var l = dist(w.a, w.b), g = W.GRID_M * ppm(), tt = Math.round(pr.t * l / g) * g / l;
    return { p: [w.a[0] + (w.b[0] - w.a[0]) * tt, w.a[1] + (w.b[1] - w.a[1]) * tt], t: 'body', wi: wi };
  }

  // ── инструменты: щелчок ─────────────────────────────────────────────
  function toolClick(raw, e) {
    var t = rv.tool, ph = rv.phase, cur = rv.cur ? rv.cur.p : raw;
    if (rv.chainHover) rv.chainHover = false;
    if (t === 'rect') {
      if (ph === 'c1' || !ph) { rv.base = cur.slice(); rv.phase = 'c2'; }
      else rectCommit(cur);
    } else if (t === 'move' || t === 'copy') {
      if (ph === 'base') { rv.base = cur.slice(); rv.phase = 'target'; }
      else if (ph === 'target') moveCommit(cur[0] - rv.base[0], cur[1] - rv.base[1]);
    } else if (t === 'rotate') {
      if (ph === 'center') { rv.tmp = { c: cur.slice() }; rv.phase = 'ray1'; }
      else if (ph === 'ray1') { rv.base = cur.slice(); rv.phase = 'ray2'; }
      else if (ph === 'ray2') {
        var c = rv.tmp.c, ang = Math.atan2(cur[1] - c[1], cur[0] - c[0]) - Math.atan2(rv.base[1] - c[1], rv.base[0] - c[0]);
        rotateCommit(ang);
      }
    } else if (t === 'mirror') {
      var wi = W.wallAt(raw);
      if (wi >= 0) { var mw = W.walls()[wi]; mirrorCommit(mw.a.slice(), mw.b.slice()); }
    } else if (t === 'mirrorDraw') {
      if (ph === 'a1') { rv.base = cur.slice(); rv.phase = 'a2'; }
      else if (ph === 'a2' && dist(rv.base, cur) > 2) mirrorCommit(rv.base.slice(), cur.slice());
    } else if (t === 'offset') offsetClick(raw);
    else if (t === 'align') alignClick(raw);
    else if (t === 'trim') trimClick(raw);
    else if (t === 'split') {
      var wi2 = W.wallAt(raw);
      if (wi2 >= 0) {
        var sp = splitPoint(raw, wi2), w2 = W.walls()[wi2], tt = projOn(sp.p, w2.a, w2.b).t;
        if (tt > 0.01 && tt < 0.99) { G.pushUndo('walls'); W.splitAt(sp.p); finishEdit('Стена разделена.'); }
      }
    } else if (t === 'measure') {
      if (ph === 'm1') { rv.base = cur.slice(); rv.meas = null; rv.phase = 'm2'; }
      else if (ph === 'm2') { rv.meas = { a: rv.base.slice(), b: cur.slice() }; rv.base = null; rv.phase = 'm1'; var m = rv.meas; W.hintWall('Расстояние: ' + W.fm2(dist(m.a, m.b) / ppm()) + ' м; по горизонтали ' + W.fm2(Math.abs(m.b[0] - m.a[0]) / ppm()) + ' м, по вертикали ' + W.fm2(Math.abs(m.b[1] - m.a[1]) / ppm()) + ' м.'); }
    }
    sig = ''; G.draw();
  }
  function afterOneShot() {
    rv.base = null; rv.tmp = null; rv.typed = '';
    rv.tool = 'select'; rv.phase = ''; inSet = true; try { W.setTool('wall'); } finally { inSet = false; }
    sig = ''; propSig = ''; G.draw();
  }
  function moveCommit(dx, dy) {
    if (!dx && !dy) return;
    var g = W.GRID_M * ppm();
    G.pushUndo('walls');
    if (rv.tool === 'copy') {
      var ids = transformSel(rv.sel, moveFn(dx, dy), true);
      finishEdit('Скопировано: ' + ids.length + '.');
      if (rv.opt.multi) { rv.phase = 'target'; return; }   // база остаётся, следующая копия
      rv.sel = ids; afterOneShot();
    } else {
      transformSel(rv.sel, moveFn(dx, dy), false);
      finishEdit('Перемещено.'); afterOneShot();
    }
  }
  function rotateCommit(ang) {
    if (!ang) return;
    G.pushUndo('walls');
    var c = rv.tmp.c, T = rotFn(c, ang);
    if (rv.opt.rcopy) { var ids = transformSel(rv.sel, T, true); rv.sel = ids; } else transformSel(rv.sel, T, false);
    finishEdit('Повернуто на ' + (Math.round(-ang * 1800 / Math.PI) / 10).toString().replace('.', ',') + '°.'); afterOneShot();
  }
  function mirrorCommit(P, Q) {
    G.pushUndo('walls');
    var T = reflectFn(P, Q);
    if (rv.opt.mcopy) { var ids = transformSel(rv.sel, T, true); rv.sel = ids; } else transformSel(rv.sel, T, false);
    finishEdit('Отражено.'); afterOneShot();
  }
  function rectCommit(p2) {
    var p1 = rv.base;
    var x0 = Math.min(p1[0], p2[0]), x1 = Math.max(p1[0], p2[0]), y0 = Math.min(p1[1], p2[1]), y1 = Math.max(p1[1], p2[1]);
    var d = W.locD(), kind = W.getKind();
    if (d) { x0 += d; y0 += d; x1 -= d; y1 -= d; }
    if (x1 - x0 < 0.05 * ppm() || y1 - y0 < 0.05 * ppm()) { W.hintWall('Прямоугольник слишком мал для такой линии привязки.'); return; }
    G.pushUndo('walls');
    var P = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (var i = 0; i < 4; i++) W.addWall(P[i].map(r1), P[(i + 1) % 4].map(r1), kind);
    rv.base = null; rv.phase = 'c1'; rv.typed = '';
    W.afterWallEdit(); W.hintWall('<span class=ok>Прямоугольник построен.</span> Можно ставить окна и двери или нажать «Комнаты из стен».');
  }
  function rectFromTyped() {
    var m = String(rv.typed).split(/[x×х*]/i);
    if (m.length !== 2) return false;
    var a = W.parseLen(m[0]), b = W.parseLen(m[1]);
    if (!(a > 0 && b > 0) || !rv.base || !rv.cur) return false;
    var sx = rv.cur.p[0] >= rv.base[0] ? 1 : -1, sy = rv.cur.p[1] >= rv.base[1] ? 1 : -1;
    rectCommit([rv.base[0] + sx * a * ppm(), rv.base[1] + sy * b * ppm()]);
    return true;
  }
  function offsetClick(raw) {
    var h = hitAt(raw);
    if (!h || h.t !== 'w') return;
    var w = wById(h.id), u = unit(w), n = [-u[1], u[0]], pr = projOn(raw, w.a, w.b), side = ((raw[0] - pr.q[0]) * n[0] + (raw[1] - pr.q[1]) * n[1]) >= 0 ? 1 : -1;
    if (rv.opt.onum) { offsetCommit(w, side * rv.opt.odist / 100 * ppm()); return; }
    if (rv.phase === 'g1') { rv.tmp = { id: w.id }; rv.phase = 'g2'; return; }
    if (rv.phase === 'g2') {
      var w2 = wById(rv.tmp.id); if (!w2) return;
      var u2 = unit(w2), dd = (raw[0] - w2.a[0]) * -u2[1] + (raw[1] - w2.a[1]) * u2[0];
      if (rv.typed) { var tm = W.parseLen(rv.typed); if (tm > 0) dd = Math.sign(dd || 1) * tm * ppm(); }
      offsetCommit(w2, dd);
    }
  }
  function offsetGraphical(raw) {   // подсказка расстояния для второго щелчка
    var w = wById(rv.tmp && rv.tmp.id); if (!w) return 0;
    var u = unit(w); return (raw[0] - w.a[0]) * -u[1] + (raw[1] - w.a[1]) * u[0];
  }
  function offsetCommit(w, dpx) {
    if (Math.abs(dpx) < 1) return;
    var u = unit(w);
    G.pushUndo('walls');
    if (rv.opt.ocopy) {
      var nw = { id: W.nextId(), a: [r1(w.a[0] - u[1] * dpx), r1(w.a[1] + u[0] * dpx)], b: [r1(w.b[0] - u[1] * dpx), r1(w.b[1] + u[0] * dpx)], k: w.k };
      W.walls().push(nw); W.splitAt(nw.a); W.splitAt(nw.b);
      rv.sel = [nw.id]; rv.selO = [];
    } else W.moveWallBy(W.wallIndexById(w.id), dpx);
    rv.typed = '';
    finishEdit('Готово.');
    if (rv.opt.onum) { rv.phase = 'g1'; } else { rv.phase = 'g1'; rv.tmp = null; }
  }
  function alignClick(raw) {
    var h = hitAt(raw);
    if (!h || h.t !== 'w') return;
    var w = wById(h.id), u = unit(w);
    if (rv.phase === 'ref') {
      var n = [-u[1], u[0]], pr = projOn(raw, w.a, w.b), side = ((raw[0] - pr.q[0]) * n[0] + (raw[1] - pr.q[1]) * n[1]) >= 0 ? 1 : -1;
      rv.tmp = { id: w.id, n: n, c: w.a[0] * n[0] + w.a[1] * n[1] + (rv.opt.afaces ? side * W.thickPx(w) / 2 : 0), u: u };
      rv.phase = 'mov'; return;
    }
    if (rv.phase === 'mov') {
      var ref = rv.tmp, rw = wById(ref.id);
      if (!rw || w.id === ref.id) return;
      if (Math.abs(ref.u[0] * u[1] - ref.u[1] * u[0]) > 0.03) { W.hintWall('Выровнять можно только параллельные стены.'); return; }
      var prm = projOn(raw, w.a, w.b), sm = ((raw[0] - prm.q[0]) * ref.n[0] + (raw[1] - prm.q[1]) * ref.n[1]) >= 0 ? 1 : -1;
      var pos = w.a[0] * ref.n[0] + w.a[1] * ref.n[1] + (rv.opt.afaces ? sm * W.thickPx(w) / 2 : 0), d = ref.c - pos;
      if (Math.abs(d) < 0.5) { W.hintWall('Уже на одной линии.'); return; }
      var nm = [-u[1], u[0]], dir = nm[0] * ref.n[0] + nm[1] * ref.n[1] >= 0 ? 1 : -1;
      G.pushUndo('walls');
      W.moveWallBy(W.wallIndexById(w.id), d * dir);
      rv.phase = 'ref'; rv.tmp = null;
      finishEdit('Выровнено.');
    }
  }
  function trimClick(raw) {
    var h = hitAt(raw);
    if (!h || h.t !== 'w') return;
    if (rv.phase === 't1') { rv.tmp = { id: h.id, click: raw.slice() }; rv.phase = 't2'; return; }
    if (rv.phase === 't2') {
      var w1 = wById(rv.tmp.id), w2 = wById(h.id);
      if (!w1 || !w2 || w1 === w2) return;
      var I = W.lineInter(w1.a, w1.b, w2.a, w2.b);
      if (!I) { W.hintWall('Параллельные стены не пересекаются.'); rv.phase = 't1'; rv.tmp = null; return; }
      G.pushUndo('walls');
      trimWall(w1, rv.tmp.click, I); trimWall(w2, raw, I);
      W.splitAt(I);
      rv.phase = 't1'; rv.tmp = null;
      finishEdit('Подрезано до угла.');
    }
  }

  // ── клавиатура ──────────────────────────────────────────────────────
  var SEQ = { WA: 'wall', RC: 'rect', WN: 'win', DR: 'door', MV: 'move', CO: 'copy', RO: 'rotate', MM: 'mirror', DM: 'mirrorDraw', OF: 'offset', AL: 'align', TR: 'trim', SL: 'split', DE: 'delete', DI: 'measure', ZE: 'fit', ZF: 'fit' };
  function isPrefix(s) { return Object.keys(SEQ).some(function (k) { return k.indexOf(s) === 0; }); }
  function runSeq(name) {
    if (name === 'delete') { deleteSel(); return; }
    if (name === 'fit') { resetView(); G.draw(); return; }
    setTool(name);
  }
  function replay(code, key) {
    var ev2 = new KeyboardEvent('keydown', { code: code, key: key, bubbles: true, cancelable: true });
    ev2.__rv = true; document.dispatchEvent(ev2);
  }
  function enterPhaseCommit() {
    var t = rv.tool;
    if (!selecting() || !NEEDSEL[t]) return false;
    if (!pickPhase()) return false;
    cleanSel();
    if (!rv.sel.length) { W.hintWall('Ничего не выбрано.'); return true; }
    rv.phase = firstPhase(t); sig = ''; G.draw();
    return true;
  }
  function typedEnter() {
    var t = rv.tool, ph = rv.phase;
    if ((t === 'move' || t === 'copy') && ph === 'target' && rv.cur) {
      var m = W.parseLen(rv.typed); if (!(m > 0)) { rv.typed = ''; return; }
      var vx = rv.cur.p[0] - rv.base[0], vy = rv.cur.p[1] - rv.base[1], vl = Math.hypot(vx, vy) || 1;
      rv.typed = ''; moveCommit(vx / vl * m * ppm(), vy / vl * m * ppm()); return;
    }
    if (t === 'rotate' && ph === 'ray1') {
      var a = parseFloat(String(rv.typed).replace(',', '.')); if (!isFinite(a)) { rv.typed = ''; return; }
      rv.typed = ''; rotateCommit(-a * Math.PI / 180); return;
    }
    if (t === 'rect' && ph === 'c2') { if (!rectFromTyped()) rv.typed = ''; return; }
    if (t === 'offset' && ph === 'g2') { var h2 = rv.tmp && wById(rv.tmp.id); if (h2 && rv.cur) { var dd = offsetGraphical(rv.cur.p), tm = W.parseLen(rv.typed); if (tm > 0) offsetCommit(h2, Math.sign(dd || 1) * tm * ppm()); } rv.typed = ''; return; }
    rv.typed = '';
  }
  function typingTool() {
    var t = rv.tool, ph = rv.phase;
    return ((t === 'move' || t === 'copy') && ph === 'target') || (t === 'rotate' && ph === 'ray1') || (t === 'rect' && ph === 'c2') || (t === 'offset' && ph === 'g2');
  }
  window.addEventListener('keydown', function (e) {
    if (e.__rv || G.mode !== 'wall') return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('.namepick')) return;
    if (e.altKey) return;
    var ctrl = e.ctrlKey || e.metaKey;
    if (ctrl) {
      if (e.code === 'KeyA' && (rv.tool === 'select' || pickPhase())) { rv.sel = W.walls().map(function (w) { return w.id; }); rv.selO = W.ops().map(function (o) { return o.id; }); afterSelect(); e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    var stop = function () { e.preventDefault(); e.stopImmediatePropagation(); G.draw(); };
    // набор числа в инструментах правки
    if (own() && typingTool()) {
      if (/^[0-9.,xх×*-]$/i.test(e.key) || e.key === 'Backspace') {
        if (e.key === 'Backspace') rv.typed = rv.typed.slice(0, -1); else rv.typed += e.key;
        stop(); return;
      }
    }
    if (e.key === 'Enter' || (e.code === 'Space' && own() && (pickPhase() || rv.tool !== 'wall'))) {
      if (own()) {
        if (rv.typed && typingTool()) { typedEnter(); stop(); return; }
        if (enterPhaseCommit()) { stop(); return; }
        if (rv.tool === 'rotate' && rv.phase === 'center' && rv.sel.length) { var bb = bbox(selWalls()); rv.tmp = { c: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2] }; rv.phase = 'ray1'; sig = ''; stop(); return; }
        if (rv.tool === 'select' && rv.selO.length === 1 && !rv.sel.length) { W.editOp(W.ops().indexOf(W.ops().filter(function (o) { return o.id === rv.selO[0]; })[0])); stop(); return; }
      }
    }
    if (e.key === 'Escape') {
      closeMenu();
      if (own()) {
        if (rv.typed) { rv.typed = ''; stop(); return; }
        if (rv.sd) { rv.sd = null; stop(); return; }
        var fp = firstPhase(rv.tool);
        if (rv.tool !== 'select' && !pickPhase() && rv.phase && rv.phase !== fp && !(rv.opt.multi && rv.tool === 'copy' && false)) { rv.phase = fp; rv.base = null; rv.tmp = null; sig = ''; stop(); return; }
        if (rv.tool !== 'select') { setTool('select'); e.preventDefault(); e.stopImmediatePropagation(); return; }
        if (rv.sel.length || rv.selO.length) { rv.sel = []; rv.selO = []; afterSelect(); e.preventDefault(); e.stopImmediatePropagation(); return; }
        return;
      }
      if ((rv.tool === 'wall' || rv.tool === 'win' || rv.tool === 'rect') && !W.isDrawing()) { setTool('select'); e.preventDefault(); e.stopImmediatePropagation(); return; }
      return;
    }
    if (e.key === 'Escape') return;
    if ((e.key === 'Delete' || e.key === 'Del') && (rv.tool === 'select' || pickPhase())) { if (deleteSel()) { e.preventDefault(); e.stopImmediatePropagation(); } return; }
    if (e.key === 'Tab' && own() && rv.tool === 'select') { rv.chainHover = !rv.chainHover; stop(); return; }
    if (e.key === 'Home') { resetView(); stop(); return; }
    // двухбуквенные команды как в Revit
    if (/^Key[A-Z]$/.test(e.code) && !typingTool() && !(rv.tool === 'wall' && W.isDrawing()) && !(rv.tool === 'rect' && rv.phase === 'c2' && false)) {
      var ch = e.code.slice(3);
      clearTimeout(rv.seqTimer);
      var nb = rv.seqBuf + ch;
      if (SEQ[nb]) { rv.seqBuf = ''; stop(); runSeq(SEQ[nb]); return; }
      if (!rv.seqBuf && isPrefix(ch)) {
        rv.seqBuf = ch; var code = e.code, key = e.key;
        rv.seqTimer = setTimeout(function () { rv.seqBuf = ''; replay(code, key); }, 600);
        e.preventDefault(); e.stopImmediatePropagation(); return;
      }
      rv.seqBuf = '';
    }
  }, true);

  // ── отрисовка поверх плана ──────────────────────────────────────────
  var pat = {};
  G.rvWallFill = function (cx, kind, dark) {
    var key = (G.darkPlan ? 'd' : 'l') + kind;
    if (!pat[key]) {
      var c = document.createElement('canvas'); c.width = c.height = 8;
      var g = c.getContext('2d');
      g.fillStyle = G.darkPlan ? '#2a2f3a' : '#ffffff'; g.fillRect(0, 0, 8, 8);
      g.strokeStyle = G.darkPlan ? '#9aa3b5' : (kind === 'ext' ? '#444' : '#777'); g.lineWidth = 1;
      g.beginPath(); g.moveTo(-1, 9); g.lineTo(9, -1); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(7, 9); g.lineTo(9, 7); g.stroke();
      pat[key] = cx.createPattern(c, 'repeat');
    }
    return pat[key];
  };

  var SELF = 'rgba(30,144,255,.38)', SELS = '#1677d9';
  function drawWallHighlight(cx, k, w, fill, stroke, lw) {
    var q = quad(w, 1.5);
    polyPath(cx, q, k); cx.fillStyle = fill; cx.fill(); cx.lineWidth = lw; cx.strokeStyle = stroke; cx.stroke();
  }
  function ghostWalls(cx, k, ids, T) {
    cx.save();
    selWallsFrom(ids).forEach(function (w) {
      var g = { a: T(w.a), b: T(w.b), k: w.k };
      polyPath(cx, quad(g), k); cx.fillStyle = 'rgba(37,99,235,.20)'; cx.fill(); cx.lineWidth = 1.4; cx.strokeStyle = '#2563eb'; cx.setLineDash([5, 3]); cx.stroke();
    });
    cx.restore();
  }
  function selWallsFrom(ids) { return ids.map(wById).filter(Boolean); }

  function rvDraw() {
    uiSync();
    if (G.mode !== 'wall') return;
    cleanSel();
    var cx = G.cx, k = kk(), f = F();
    if (!f || (f.img && !G.imgCache[G.cur])) return;
    cx.save();
    rv.dimBoxes = [];
    // выбранные стены и проёмы
    selWalls().forEach(function (w) { drawWallHighlight(cx, k, w, SELF, SELS, 2); });
    rv.selO.forEach(function (id) {
      var o = W.ops().filter(function (q) { return q.id === id; })[0], g = o && W.opGeom(o);
      if (!g) return;
      var hw = g.wpx / 2, ht = g.t / 2 + 2;
      function P(a, b) { return [g.c[0] + g.ux * a + g.nx * b, g.c[1] + g.uy * a + g.ny * b]; }
      polyPath(cx, [P(-hw, -ht), P(hw, -ht), P(hw, ht), P(-hw, ht)], k); cx.fillStyle = SELF; cx.fill(); cx.lineWidth = 2; cx.strokeStyle = SELS; cx.stroke();
    });
    // наведение
    var hh = rv.hoverHit;
    if (hh && hh.t === 'w' && own() && !rv.sd) {
      var hw0 = wById(hh.id);
      if (hw0) {
        var group = rv.chainHover && rv.tool === 'select' ? selWallsFrom(chainOf(hh.id)) : [hw0];
        group.forEach(function (w) { drawWallHighlight(cx, k, w, 'rgba(90,169,255,.20)', '#5aa9ff', 1.6); });
      }
    }
    if (own()) toolDraw(cx, k);
    drawSelDims(cx, k);
    // ручки одной стены
    if (rv.tool === 'select' && rv.sel.length === 1 && !rv.selO.length) {
      var w1 = wById(rv.sel[0]);
      if (w1) [w1.a, w1.b].forEach(function (p) {
        cx.beginPath(); cx.arc(p[0] * k, p[1] * k, 5.5, 0, 7); cx.fillStyle = '#fff'; cx.fill(); cx.lineWidth = 2; cx.strokeStyle = SELS; cx.stroke();
        cx.beginPath(); cx.arc(p[0] * k, p[1] * k, 2, 0, 7); cx.fillStyle = SELS; cx.fill();
      });
    }
    // рамка выбора
    if (rv.sd && rv.sd.mq && rv.sd.moved) {
      var a = rv.sd.p0, b = rv.sd.p1, cross = b[0] < a[0];
      cx.beginPath(); cx.rect(Math.min(a[0], b[0]) * k, Math.min(a[1], b[1]) * k, Math.abs(b[0] - a[0]) * k, Math.abs(b[1] - a[1]) * k);
      cx.fillStyle = cross ? 'rgba(34,160,90,.10)' : 'rgba(30,144,255,.10)'; cx.fill();
      cx.lineWidth = 1.2; cx.strokeStyle = cross ? '#1f9d55' : '#1677d9'; cx.setLineDash(cross ? [6, 4] : []); cx.stroke(); cx.setLineDash([]);
    }
    // рулетка
    if (rv.meas) drawMeasure(cx, k, rv.meas.a, rv.meas.b, true);
    // глиф привязки для своих инструментов
    if (own() && rv.cur && !selecting() && rv.tool !== 'offset' && rv.tool !== 'align' && rv.tool !== 'trim' && rv.tool !== 'mirror') W.drawGlyph(cx, k, rv.cur);
    // набранное число
    cx.restore();
  }

  function drawSelDims(cx, k) {
    if (rv.tool !== 'select' || rv.sel.length !== 1 || rv.selO.length || (rv.sd && (rv.sd.grip || rv.sd.body))) return;
    var w = wById(rv.sel[0]); if (!w) return;
    var l = dist(w.a, w.b);
    if (l / ppm() < 0.2) return;
    var bx = W.drawTempDim(cx, k, w.a, w.b, W.fm2(l / ppm()) + ' м', false, 34);
    if (bx) rv.dimBoxes.push({ x: bx.x, y: bx.y, w: bx.w, h: bx.h, act: function () { W.askWallLen(W.wallIndexById(w.id)); } });
    // расстояния до ближайших параллельных стен (ось — ось), число можно править
    var u = unit(w), n = [-u[1], u[0]], best = { pos: null, neg: null };
    W.walls().forEach(function (o) {
      if (o === w) return;
      var uo = unit(o);
      if (Math.abs(u[0] * uo[1] - u[1] * uo[0]) > 0.02) return;
      var s0 = (o.a[0] - w.a[0]) * u[0] + (o.a[1] - w.a[1]) * u[1], s1 = (o.b[0] - w.a[0]) * u[0] + (o.b[1] - w.a[1]) * u[1];
      var lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(l, Math.max(s0, s1));
      if (hi - lo < 0.3 * ppm()) return;
      var dn = (o.a[0] - w.a[0]) * n[0] + (o.a[1] - w.a[1]) * n[1];
      if (Math.abs(dn) < 3) return;
      var side = dn > 0 ? 'pos' : 'neg';
      if (!best[side] || Math.abs(dn) < Math.abs(best[side].dn)) best[side] = { dn: dn, mid: (lo + hi) / 2, id: o.id };
    });
    ['pos', 'neg'].forEach(function (sd) {
      var bnb = best[sd]; if (!bnb) return;
      var P = [w.a[0] + u[0] * bnb.mid, w.a[1] + u[1] * bnb.mid], Q = [P[0] + n[0] * bnb.dn, P[1] + n[1] * bnb.dn];
      var bb = W.drawTempDim(cx, k, P, Q, W.fm2(Math.abs(bnb.dn) / ppm()) + ' м', false, 0, false);
      if (bb) rv.dimBoxes.push({ x: bb.x, y: bb.y, w: bb.w, h: bb.h, act: function () {
        askNum('Расстояние до стены', 'От оси выбранной стены до оси соседней, м (4,5) или см (450).', W.fm2(Math.abs(bnb.dn) / ppm()), function (m) {
          var wi = W.wallIndexById(w.id); if (wi < 0) return;
          var want = (bnb.dn > 0 ? 1 : -1) * m * ppm();
          G.pushUndo('walls'); W.moveWallBy(wi, bnb.dn - want); finishEdit();
        });
      } });
    });
  }
  function drawMeasure(cx, k, a, b, keep) {
    var d = dist(a, b) / ppm();
    cx.save(); cx.setLineDash([]);
    W.drawTempDim(cx, k, a, b, W.fm2(d) + ' м', false, 26);
    cx.strokeStyle = '#d9822b'; cx.lineWidth = 1.4; cx.beginPath(); cx.moveTo(a[0] * k, a[1] * k); cx.lineTo(b[0] * k, b[1] * k); cx.stroke();
    [a, b].forEach(function (p) { cx.beginPath(); cx.arc(p[0] * k, p[1] * k, 3.5, 0, 7); cx.fillStyle = '#d9822b'; cx.fill(); });
    cx.restore();
  }

  function toolDraw(cx, k) {
    var t = rv.tool, ph = rv.phase, cur = rv.cur ? rv.cur.p : null, typed = rv.typed;
    if (t === 'rect' && ph === 'c2' && cur) {
      var p1 = rv.base, x0 = Math.min(p1[0], cur[0]), x1 = Math.max(p1[0], cur[0]), y0 = Math.min(p1[1], cur[1]), y1 = Math.max(p1[1], cur[1]);
      var d = W.locD(), ax0 = x0 + d, ay0 = y0 + d, ax1 = x1 - d, ay1 = y1 - d, th = W.thickPx({ k: W.getKind() });
      cx.save();
      if (ax1 - ax0 > 0 && ay1 - ay0 > 0) {
        var Pq = [[ax0, ay0], [ax1, ay0], [ax1, ay1], [ax0, ay1]];
        for (var i = 0; i < 4; i++) {
          var g = { a: Pq[i], b: Pq[(i + 1) % 4], k: W.getKind() };
          polyPath(cx, quad(g), k); cx.fillStyle = 'rgba(56,132,255,.22)'; cx.fill(); cx.lineWidth = 1.5; cx.strokeStyle = '#2563eb'; cx.stroke();
        }
      }
      cx.setLineDash([7, 4]); cx.lineWidth = 1; cx.strokeStyle = '#2563eb'; cx.strokeRect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k); cx.setLineDash([]);
      W.drawTempDim(cx, k, [x0, y0], [x1, y0], typed ? typed + '|' : W.fm2((x1 - x0) / ppm()) + ' м', !!typed, 30);
      W.drawTempDim(cx, k, [x1, y0], [x1, y1], W.fm2((y1 - y0) / ppm()) + ' м', false, 30, true);
      cx.restore();
    }
    if ((t === 'move' || t === 'copy') && ph === 'target' && cur) {
      var dx = cur[0] - rv.base[0], dy = cur[1] - rv.base[1];
      ghostWalls(cx, k, rv.sel, moveFn(dx, dy));
      cx.save(); cx.setLineDash([]); cx.strokeStyle = '#d9822b'; cx.lineWidth = 1.2; cx.beginPath(); cx.moveTo(rv.base[0] * k, rv.base[1] * k); cx.lineTo(cur[0] * k, cur[1] * k); cx.stroke();
      cx.beginPath(); cx.arc(rv.base[0] * k, rv.base[1] * k, 4, 0, 7); cx.fillStyle = '#d9822b'; cx.fill(); cx.restore();
      W.drawTempDim(cx, k, rv.base, cur, typed ? typed + '|' : W.fm2(Math.hypot(dx, dy) / ppm()) + ' м', !!typed, 30);
    }
    if (t === 'rotate') {
      var bb = bbox(selWalls());
      if (ph === 'center' && bb) {
        var c0 = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
        drawCenter(cx, k, c0, true);
      } else if (rv.tmp && rv.tmp.c) {
        var c = rv.tmp.c; drawCenter(cx, k, c, false);
        if (ph === 'ray1' && cur) { drawRay(cx, k, c, cur); if (typed) W.drawTempDim(cx, k, c, cur, typed + '°|', true, 26); }
        if (ph === 'ray2' && cur) {
          drawRay(cx, k, c, rv.base); drawRay(cx, k, c, cur);
          var ang = Math.atan2(cur[1] - c[1], cur[0] - c[0]) - Math.atan2(rv.base[1] - c[1], rv.base[0] - c[0]);
          ghostWalls(cx, k, rv.sel, rotFn(c, ang));
          var ccw = ((-ang * 180 / Math.PI) % 360 + 540) % 360 - 180;
          cx.save(); cx.font = 'bold 12px "Segoe UI",system-ui'; cx.fillStyle = '#fff'; cx.strokeStyle = W.DIMC;
          var lbl = (Math.round(ccw * 10) / 10).toString().replace('.', ',') + '°', tw = cx.measureText(lbl).width + 12;
          cx.fillRect(cur[0] * k + 12, cur[1] * k - 22, tw, 19); cx.strokeRect(cur[0] * k + 12, cur[1] * k - 22, tw, 19);
          cx.fillStyle = W.DIMC; cx.textBaseline = 'middle'; cx.fillText(lbl, cur[0] * k + 18, cur[1] * k - 12); cx.restore();
        }
      }
    }
    if (t === 'mirror' && rv.hoverHit && rv.hoverHit.t === 'w' && ph === 'axis') {
      var aw = wById(rv.hoverHit.id);
      if (aw) { drawAxis(cx, k, aw.a, aw.b); ghostWalls(cx, k, rv.sel, reflectFn(aw.a, aw.b)); }
    }
    if (t === 'mirrorDraw' && ph === 'a2' && cur) { drawAxis(cx, k, rv.base, cur); ghostWalls(cx, k, rv.sel, reflectFn(rv.base, cur)); }
    if (t === 'offset') {
      var oh = rv.hoverHit && rv.hoverHit.t === 'w' ? wById(rv.hoverHit.id) : null, raw = rv.cur ? rv.cur.p : null;
      if (ph === 'g2' && rv.tmp) oh = wById(rv.tmp.id);
      if (oh && raw) {
        var u = unit(oh), n = [-u[1], u[0]], pr = projOn(raw, oh.a, oh.b), side = ((raw[0] - pr.q[0]) * n[0] + (raw[1] - pr.q[1]) * n[1]) >= 0 ? 1 : -1, dpx;
        if (rv.opt.onum) dpx = side * rv.opt.odist / 100 * ppm();
        else if (ph === 'g2') { dpx = offsetGraphical(raw); if (typed) { var tm = W.parseLen(typed); if (tm > 0) dpx = Math.sign(dpx || 1) * tm * ppm(); } }
        else dpx = 0;
        if (dpx) {
          var gw = { a: [oh.a[0] - u[1] * dpx, oh.a[1] + u[0] * dpx], b: [oh.b[0] - u[1] * dpx, oh.b[1] + u[0] * dpx], k: oh.k };
          polyPath(cx, quad(gw), k); cx.fillStyle = 'rgba(37,99,235,.18)'; cx.fill(); cx.save(); cx.setLineDash([5, 3]); cx.lineWidth = 1.4; cx.strokeStyle = '#2563eb'; cx.stroke(); cx.restore();
          var mid = [(oh.a[0] + oh.b[0]) / 2, (oh.a[1] + oh.b[1]) / 2];
          W.drawTempDim(cx, k, mid, [mid[0] - u[1] * dpx, mid[1] + u[0] * dpx], typed ? typed + '|' : W.fm2(Math.abs(dpx) / ppm()) + ' м', !!typed, 0);
        }
      }
    }
    if (t === 'align') {
      if (ph === 'mov' && rv.tmp) {
        var rw = wById(rv.tmp.id);
        if (rw) {
          var rc = rv.tmp, p0 = [rw.a[0], rw.a[1]];
          // линия опорной грани
          var off = rc.c - (rw.a[0] * rc.n[0] + rw.a[1] * rc.n[1]), q0 = [rw.a[0] + rc.n[0] * off, rw.a[1] + rc.n[1] * off], q1 = [rw.b[0] + rc.n[0] * off, rw.b[1] + rc.n[1] * off];
          cx.save(); cx.setLineDash([8, 4]); cx.lineWidth = 2; cx.strokeStyle = '#d9822b'; cx.beginPath();
          var ex = (q1[0] - q0[0]) * 3, ey = (q1[1] - q0[1]) * 3;
          cx.moveTo((q0[0] - ex) * k, (q0[1] - ey) * k); cx.lineTo((q1[0] + ex) * k, (q1[1] + ey) * k); cx.stroke(); cx.restore();
        }
      } else if (rv.hoverHit && rv.hoverHit.t === 'w') { /* подсветка уже нарисована */ }
    }
    if (t === 'trim' && ph === 't2' && rv.tmp) {
      var w1 = wById(rv.tmp.id); if (w1) drawWallHighlight(cx, k, w1, 'rgba(217,130,43,.25)', '#d9822b', 2);
    }
    if (t === 'split' && rv.cur && rv.cur.wi != null) {
      var sw = W.walls()[rv.cur.wi]; if (sw) {
        var su = unit(sw), hq = W.thickPx(sw) / 2 + 8 / k;
        cx.save(); cx.strokeStyle = '#c0392b'; cx.lineWidth = 2; cx.setLineDash([4, 3]); cx.beginPath();
        cx.moveTo((rv.cur.p[0] - su[1] * hq) * k, (rv.cur.p[1] + su[0] * hq) * k); cx.lineTo((rv.cur.p[0] + su[1] * hq) * k, (rv.cur.p[1] - su[0] * hq) * k); cx.stroke(); cx.restore();
        W.drawGlyph(cx, k, rv.cur);
      }
    }
    if (t === 'measure' && ph === 'm2' && cur) drawMeasure(cx, k, rv.base, cur, false);
  }
  function drawCenter(cx, k, c, hint) {
    cx.save(); cx.strokeStyle = '#d9822b'; cx.fillStyle = hint ? 'rgba(217,130,43,.15)' : '#d9822b'; cx.lineWidth = 2; cx.setLineDash([]);
    cx.beginPath(); cx.arc(c[0] * k, c[1] * k, 8, 0, 7); cx.stroke();
    cx.beginPath(); cx.moveTo(c[0] * k - 14, c[1] * k); cx.lineTo(c[0] * k + 14, c[1] * k); cx.moveTo(c[0] * k, c[1] * k - 14); cx.lineTo(c[0] * k, c[1] * k + 14); cx.stroke();
    if (!hint) { cx.beginPath(); cx.arc(c[0] * k, c[1] * k, 3, 0, 7); cx.fill(); }
    cx.restore();
  }
  function drawRay(cx, k, c, p) { cx.save(); cx.strokeStyle = '#d9822b'; cx.lineWidth = 1.3; cx.setLineDash([6, 3]); cx.beginPath(); cx.moveTo(c[0] * k, c[1] * k); cx.lineTo(p[0] * k, p[1] * k); cx.stroke(); cx.restore(); }
  function drawAxis(cx, k, a, b) {
    var ex = (b[0] - a[0]) * 6, ey = (b[1] - a[1]) * 6;
    cx.save(); cx.strokeStyle = '#d9822b'; cx.lineWidth = 1.6; cx.setLineDash([10, 4, 2, 4]);
    cx.beginPath(); cx.moveTo((a[0] - ex) * k, (a[1] - ey) * k); cx.lineTo((b[0] + ex) * k, (b[1] + ey) * k); cx.stroke(); cx.restore();
  }

  // рисование стены/прямоугольника: курсор тоже получает вид «Revit»
  var baseDraw = G.draw;
  G.draw = function () { baseDraw.apply(this, arguments); try { rvDraw(); } catch (e) { console.error('[plan_revit]', e); } };
  // прямоугольник: перехватываем «живой» курсор при движении, пока рисует plan_revit
  G.rvState = function () { return { tool: rv.tool, phase: rv.phase, sel: rv.sel.slice(), selO: rv.selO.slice(), view: view }; };
  G.rvSetTool = setTool;
})(window);
