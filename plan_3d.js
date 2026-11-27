/**
 * plan_3d.js - 3D-вид плана дома: стены с окнами и дверями, полы комнат, тёплый пол, радиаторы, вода, канализация, приборы.
 *
 * Переключатель «2D | 3D» в углу поля плана, как в Revit/AutoCAD. Данные - из plan_walls.js (G.walls3d), ничего своего
 * не хранит: вид пересобирается при каждом открытии. three.js грузится только при первом нажатии «3D»
 * (динамический import, версия закреплена - так же, как в house3d.js).
 *
 * Управление: левая кнопка - вращать, правая - панорама, колесо - зум. «Сверху», «Изометрия», срез по высоте,
 * галочки этажей. Esc или «2D» - назад к плану.
 */
(function (G) {
  'use strict';

  if (!G.wallsEnabled) return;   // только при включённой отрисовке ТП (см. plan_walls.js)

  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
  var M = null;            // загруженные модули { T, OC }
  var loading = null;
  var S = null;            // сцена: { r, scene, cam, ctl, group, box, raf, ro, floors }
  var on = false;
  var box, corner, seg2, seg3, segT, panel, tabOn = false;

  var LAYERS = [['walls', 'Стены'], ['floor', 'Полы'], ['furn', 'Мебель'], ['tp', 'Тёплый пол'], ['rad', 'Радиаторы'], ['water', 'Вода'], ['sewer', 'Канализация'], ['fix', 'Приборы']];
  var FIX_H = { toilet: 0.4, basin: 0.85, bath: 0.55, shower: 0.1, wash: 0.85, dish: 0.85, pump: 0.4 };   // высоты приборов, м
  var mcache = {};
  var PIPE_K = 2;          // трубы на экране в 2 раза толще натуры, иначе их не видно

  var COLORS = {           // цвет пола по типу зоны (светлые, как на иллюстрации)
    room: 0xeef2f8, tp: 0xfbe9e2, wc: 0xdbeafe, boiler: 0xfde0e0, cold: 0xe5e7eb
  };
  var BLUE = 0x2f6fed;     // акцент: контур ключевых помещений, рамки
  var LINE = 0x8fa3bf;     // контур тел

  function css() {
    if (document.getElementById('p3d_css')) return;
    var st = document.createElement('style');
    st.id = 'p3d_css';
    st.textContent =
      '.p3d-corner{position:sticky;top:0;height:0;z-index:7;text-align:left;overflow:visible}' +
      '.p3d-seg{position:relative;top:6px;left:6px;display:inline-flex;border:1px solid rgba(255,255,255,.18);border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.35)}' +
      '.p3d-seg button{border:0;margin:0;padding:6px 14px;font:600 13px system-ui,sans-serif;background:rgba(30,32,38,.92);color:#cbd5e1;cursor:pointer;border-radius:0}' +
      '.p3d-seg button.on{background:#4f6bed;color:#fff}' +
      '.p3d-tb{display:inline-flex;align-items:center;margin:0 4px}.p3d-tb .p3d-seg{top:0;left:0;box-shadow:none}' +
      '.p3d-view{position:relative;width:100%;border-radius:2px;overflow:hidden;background:linear-gradient(#fafcff,#e9eff8)}' +
      '.p3d-view canvas{display:block;width:100%;height:100%;cursor:grab;background:transparent!important}' +
      '.p3d-panel{position:absolute;right:14px;top:14px;display:flex;flex-direction:column;gap:8px;align-items:stretch;min-width:190px;' +
      'padding:10px;border-radius:16px;background:rgba(255,255,255,.82);backdrop-filter:blur(8px);color:#334155;border:1px solid rgba(160,185,225,.45);box-shadow:0 10px 30px rgba(40,70,130,.14);font:12px system-ui,sans-serif}' +
      '.p3d-segrow{display:flex;gap:2px;padding:3px;border-radius:999px;background:#e8eef9}' +
      '.p3d-panel .p3d-segrow button{flex:1;border:0;background:transparent;color:#51607a;padding:6px 10px;border-radius:999px;font:600 12px system-ui,sans-serif}' +
      '.p3d-panel .p3d-segrow button.on{background:#fff;color:#2f6fed;box-shadow:0 1px 5px rgba(40,70,130,.2)}' +
      '.p3d-panel .p3d-link{border:0;background:transparent;color:#51607a;text-align:left;padding:2px 6px;font:600 12px system-ui,sans-serif}' +
      '.p3d-panel .p3d-more{padding:4px 6px 2px;border-top:1px solid #e1e8f4}' +
      '.p3d-panel button{border:0;background:transparent;color:#1e293b;border-radius:8px;padding:5px 8px;cursor:pointer;font:600 12px system-ui,sans-serif}' +
      '.p3d-panel label{display:flex;align-items:center;gap:6px}' +
      '.p3d-panel input[type=range]{width:100%}' +
      '.p3d-tbl{padding:14px 16px 40px;color:#d8d8d8;font:13px system-ui,sans-serif;overflow:auto;height:100%;box-sizing:border-box}' +
      '.p3d-tbl h3{margin:0 0 10px;font:700 15px system-ui,sans-serif;display:flex;align-items:center;gap:12px}' +
      '.p3d-tbl h4{margin:18px 0 6px;font:700 11px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8d8d8d}' +
      '.p3d-tbl table{border-collapse:collapse;width:100%;max-width:980px}' +
      '.p3d-tbl th,.p3d-tbl td{padding:5px 10px;border-bottom:1px solid #262626;text-align:right;white-space:nowrap}' +
      '.p3d-tbl th{color:#8d8d8d;font-weight:600;font-size:12px}' +
      '.p3d-tbl th:first-child,.p3d-tbl td:first-child{text-align:left}' +
      '.p3d-tbl tr.tot td{font-weight:700;border-top:1px solid #555}' +
      '.p3d-tbl .note{color:#8d8d8d;font-size:12px;margin:10px 0}' +
      '.p3d-tbl button{padding:6px 14px;cursor:pointer;font:600 12px system-ui,sans-serif;color:#c9f5d6;background:#173d24;border:1px solid #3fae5a}' +
      '.p3d-msg{position:absolute;left:0;right:0;top:45%;text-align:center;color:#64748b;font:14px system-ui,sans-serif;pointer-events:none}';
    document.head.appendChild(st);
  }

  function mountUi() {
    var cb = document.querySelector('.cvbox');
    if (!cb || document.getElementById('p3d_corner')) return;
    css();
    var segHtml = '<div class="p3d-seg" role="group" aria-label="Вид плана"><button type="button" class="on" id="p3d_b2">2D</button>' +
      '<button type="button" id="p3d_b3" title="Объёмный вид по нарисованным стенам">3D</button>' +
      '<button type="button" id="p3d_bt" title="Сводные таблицы по нарисованному">Таблица</button></div>';
    // Основное место - панель с кнопками мастера, рядом с «Ещё»: так переключатель не закрывает план.
    // Если панели нет или она скрыта (полный редактор) - в углу поля плана.
    var more = document.getElementById('b_more');
    if (more && more.parentNode) {
      var wrap = document.createElement('span'); wrap.id = 'p3d_corner'; wrap.className = 'p3d-tb ufh-keep';
      wrap.innerHTML = segHtml;
      more.parentNode.insertBefore(wrap, more);
      corner = wrap;
    } else {
      corner = document.createElement('div'); corner.className = 'p3d-corner'; corner.id = 'p3d_corner';
      corner.innerHTML = segHtml;
      cb.insertBefore(corner, cb.firstChild);
    }
    box = document.createElement('div'); box.className = 'p3d-view'; box.id = 'p3d_view'; box.style.display = 'none';
    cb.appendChild(box);
    seg2 = document.getElementById('p3d_b2'); seg3 = document.getElementById('p3d_b3'); segT = document.getElementById('p3d_bt');
    seg2.onclick = close3d; seg3.onclick = open3d; segT.onclick = openTable;
    document.addEventListener('keydown', function (e) { if (on && e.key === 'Escape') { e.stopImmediatePropagation(); close3d(); } }, true);
  }

  /** Исходник модуля с CDN -> blob-адрес. Так не нужна import map, а сбой сети даёт понятную ошибку. */
  function blobModule(path, fix) {
    return fetch(THREE_URL + path).then(function (r) {
      if (!r.ok) throw new Error('библиотека 3D не скачалась (' + r.status + ')');
      return r.text();
    }).then(function (t) { return URL.createObjectURL(new Blob([fix ? fix(t) : t], { type: 'text/javascript' })); });
  }

  function loadThree() {
    if (M) return Promise.resolve(M);
    if (loading) return loading;
    loading = blobModule('build/three.module.js').then(function (threeUrl) {
      return Promise.all([import(threeUrl), blobModule('examples/jsm/controls/OrbitControls.js', function (t) {
        return t.replace(/from\s+['"]three['"]/g, "from '" + threeUrl + "'");
      }).then(function (u) { return import(u); })]);
    }).then(function (m) { M = { T: m[0], OC: m[1].OrbitControls }; return M; });
    loading.catch(function () { loading = null; });
    return loading;
  }

  function fmt(x, d) { var k = Math.pow(10, d == null ? 1 : d); return String(Math.round(x * k) / k).replace('.', ','); }
  function polyLen(pts, pm) { var l = 0, i; for (i = 1; i < (pts || []).length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l / pm; }
  function polyArea2(P) { var a = 0, i; for (i = 0; i < P.length; i++) { var p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); }

  /** Сводные таблицы по нарисованному: комнаты, проёмы, инженерия. Считаются из тех же данных, что 2D и 3D. */
  function tablesHtml() {
    var D = G.DATA, e3 = G.walls3d ? G.walls3d() : [], h = '', T = G.TYPES || {};
    try { if (G.computeLeads) G.computeLeads(); if (G.computeVk) G.computeVk(); if (G.computeSewerMain) G.computeSewerMain(); if (G.computeWaterTrunks) G.computeWaterTrunks(); } catch (e) { }
    h += '<div class="p3d-tbl"><h3>Сводка по нарисованному <button type="button" id="p3d_send">Передать в расчёт</button></h3>' +
      '<div class="note">Таблицы собираются из того, что нарисовано и расставлено: стены, окна, двери, комнаты, тёплый пол, радиаторы, вода и канализация. «Передать в расчёт» сохраняет план и переносит комнаты, окна и наружные двери в калькулятор.</div>';
    var anyRoom = false;
    D.floors.forEach(function (f, i) {
      var zs = (f.zones || []).filter(function (z) { return z.type !== 'cold' && z.pts && z.pts.length > 2; });
      if (!zs.length && !(f.walls || []).length) return;
      var pm = f.pxPerM || 100, hgt = (e3[i] && e3[i].h) || 2.7, ly = layersOf(i), tA = 0, tW = 0, tPer = 0, tOut = 0;
      h += '<h4>' + (i + 1) + ' этаж · высота ' + fmt(hgt, 2) + ' м</h4>';
      if (zs.length) {
        anyRoom = true;
        h += '<table><tr><th>Помещение</th><th>Тип</th><th>Площадь, м²</th><th>Периметр, м</th><th>Наружных стен, м</th><th>Окон</th><th>Площадь окон, м²</th><th>Двери (нар./внутр.)</th></tr>';
        zs.forEach(function (z) {
          var g = z.geo || null, a = polyArea2(z.pts) / (pm * pm), wa = 0;
          if (g) (g.wins || []).forEach(function (w) { wa += w.w * w.h; });
          tA += a; tW += wa; if (g) { tPer += g.perim; tOut += g.outer; }
          h += '<tr><td>' + (z.name || 'без названия') + '</td><td>' + ((T[z.type] || [z.type])[0] || z.type) + '</td><td>' + fmt(a) + '</td><td>' + (g ? fmt(g.perim) : '-') + '</td><td>' +
            (g ? fmt(g.outer) : '-') + '</td><td>' + (g ? g.wins.length : '-') + '</td><td>' + (g ? fmt(wa) : '-') + '</td><td>' + (g ? g.doorsExt + ' / ' + g.doorsInt : '-') + '</td></tr>';
        });
        h += '<tr class="tot"><td>Итого</td><td></td><td>' + fmt(tA) + '</td><td>' + fmt(tPer) + '</td><td>' + fmt(tOut) + '</td><td></td><td>' + fmt(tW) + '</td><td></td></tr></table>';
      }
      // стены: тип, материал, толщина, длина и площадь за вычетом проёмов (по данным e3[i].walls - те же, что в 3D)
      var ew = (e3[i] && e3[i].walls) || [];
      if (ew.length) {
        var gr = {};
        ew.forEach(function (w) {
          var L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), op = 0;
          (w.ops || []).forEach(function (o) { op += o.w * o.h; });
          var key = (w.k === 'int' ? 'Внутренняя' : 'Наружная') + '|' + (w.mat || 'не задан') + '|' + Math.round(w.t * 100);
          var g = gr[key] = gr[key] || { n: 0, len: 0, area: 0 };
          g.n++; g.len += L; g.area += Math.max(0, L * hgt - op);
        });
        var tl = 0, ta = 0;
        h += '<h4>Стены</h4><table><tr><th>Тип</th><th>Материал</th><th>Толщина, см</th><th>Участков</th><th>Длина, м</th><th>Площадь без проёмов, м²</th></tr>';
        Object.keys(gr).sort().forEach(function (k) {
          var p = k.split('|'), g = gr[k]; tl += g.len; ta += g.area;
          h += '<tr><td>' + p[0] + '</td><td>' + p[1] + '</td><td>' + p[2] + '</td><td>' + g.n + '</td><td>' + fmt(g.len) + '</td><td>' + fmt(g.area) + '</td></tr>';
        });
        h += '<tr class="tot"><td>Итого</td><td></td><td></td><td></td><td>' + fmt(tl) + '</td><td>' + fmt(ta) + '</td></tr></table>';
      }
      var ops = f.openings || [];
      if (ops.length) {
        var wmap = {}; (f.walls || []).forEach(function (w) { wmap[w.id] = w; });
        h += '<h4>Окна и двери</h4><table><tr><th>Тип</th><th>Стена</th><th>Ширина, м</th><th>Высота, м</th><th>Подоконник, м</th></tr>';
        ops.forEach(function (o) {
          var w = wmap[o.wid], kind = o.k === 'win' ? 'Окно' : ((w && w.k === 'ext') ? 'Наружная дверь' : 'Дверь');
          h += '<tr><td>' + kind + '</td><td>' + (w ? (w.k === 'ext' ? 'наружная' : 'внутренняя') : '-') + '</td><td>' + fmt(o.w, 2) + '</td><td>' + fmt(o.h, 2) + '</td><td>' + (o.k === 'win' ? fmt(o.sill || 0, 2) : '-') + '</td></tr>';
        });
        h += '</table>';
      }
      // инженерия этажа
      var tpL = 0, radW = 0, wL = 0, s50 = 0, s110 = 0, fx = {};
      (ly.loops || []).forEach(function (Lp) { tpL += polyLen(Lp.sup, pm) + polyLen(Lp.ret, pm); });
      (f.rads || []).forEach(function (r) { radW += (r.w || 0) / pm; });
      (ly.wl || []).forEach(function (l) { wL += polyLen(l.pts, pm); });
      (ly.sl || []).forEach(function (l) { if ((l.d || 50) >= 110) s110 += polyLen(l.pts, pm); else s50 += polyLen(l.pts, pm); });
      (ly.sm || []).forEach(function (l) { s110 += polyLen(l.pts, pm); });
      (ly.fix || []).forEach(function (q) { fx[q.t] = (fx[q.t] || 0) + 1; });
      var eng = [];
      if ((ly.loops || []).length) eng.push(['Тёплый пол: петель ' + ly.loops.length, fmt(tpL) + ' м трубы (подача + обратка)']);
      if ((f.rads || []).length) eng.push(['Радиаторы: ' + f.rads.length + ' шт', 'общая длина ' + fmt(radW) + ' м']);
      if ((ly.wl || []).length) eng.push(['Вода: линий ' + ly.wl.length, fmt(wL) + ' м']);
      if (s50 || s110) eng.push(['Канализация: Ø50 / Ø110', fmt(s50) + ' м / ' + fmt(s110) + ' м']);
      var fxs = Object.keys(fx).map(function (k) { return ((G.FIXT && G.FIXT[k]) ? G.FIXT[k][0] : k) + ' ' + fx[k]; }).join(', ');
      if (fxs) eng.push(['Приборы', fxs]);
      if (eng.length) {
        h += '<h4>Инженерия</h4><table>';
        eng.forEach(function (r) { h += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; });
        h += '</table>';
      }
    });
    if (!anyRoom) h += '<div class="note">Комнат пока нет: на шаге «Стены» нажмите «Комнаты из стен».</div>';
    return h + '</div>';
  }

  function openTable() {
    mountUi();
    if (S) teardown();
    var hh = Math.max(420, box.clientHeight || 520);
    on = false; tabOn = true;
    G.cv.style.display = 'none';
    box.style.display = ''; box.style.height = hh + 'px'; box.style.overflow = 'auto';
    seg2.className = ''; seg3.className = ''; segT.className = 'on';
    box.innerHTML = tablesHtml();
    var send = document.getElementById('p3d_send');
    if (send) send.onclick = function () { try { if (G.ufhDone) G.ufhDone(); else if (G.saveAll) G.saveAll(); } catch (e) { console.error('[plan_3d] передача:', e); } };
  }

  function hasWalls(fl) { return fl.some(function (f) { return f.walls.length; }); }

  function open3d() {
    mountUi();
    // те же расчёты, что делает «Сохранить»: подводки, вода, канализация
    try { if (G.computeLeads) G.computeLeads(); if (G.computeVk) G.computeVk(); if (G.computeSewerMain) G.computeSewerMain(); if (G.computeWaterTrunks) G.computeWaterTrunks(); }
    catch (e) { console.error('[plan_3d] расчёт трасс:', e); }
    var data = G.walls3d ? G.walls3d() : [];
    if (!hasWalls(data)) { if (G.hint) G.hint('3D строится по стенам: сначала нарисуйте их на шаге «Стены».'); return; }
    if (G.mode && G.mode !== 'select') G.setMode(G.mode);   // выйти из режима рисования (повторный вызов гасит его)
    on = true;
    var h = Math.max(420, Math.round(G.cv.getBoundingClientRect().height) || 520);
    G.cv.style.display = 'none';
    box.style.display = ''; box.style.height = h + 'px';
    tabOn = false; seg2.className = ''; seg3.className = 'on'; segT.className = '';
    box.style.overflow = 'hidden';
    box.innerHTML = '<div class="p3d-msg">Загрузка 3D…</div>';
    loadThree().then(function (m) {
      if (!on) return;
      build(m, data);
    }).catch(function (e) {
      box.innerHTML = '<div class="p3d-msg">Не удалось запустить 3D: ' + (e && e.message ? e.message : e) + '<br>Проверьте связь и попробуйте ещё раз.</div>';
    });
  }

  function close3d() {
    if (!on && !S && !tabOn) return;
    on = false; tabOn = false;
    teardown();
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    G.cv.style.display = '';
    if (seg2) { seg2.className = 'on'; seg3.className = ''; segT.className = ''; }
    G.draw();
  }

  function teardown() {
    if (!S) return;
    cancelAnimationFrame(S.raf);
    if (S.ro) S.ro.disconnect();
    try { S.ctl.dispose(); } catch (e) { }
    S.group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (mt) { if (mt.map) mt.map.dispose(); mt.dispose(); }); }
    });
    S.r.dispose();
    mcache = {};
    S = null;
  }

  function label(T, text, sub) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 80;
    var g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.beginPath(); (g.roundRect ? g.roundRect(4, 6, 248, 68, 30) : g.rect(4, 6, 248, 68)); g.fill();
    g.strokeStyle = 'rgba(47,111,237,.35)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#2f6fed'; g.beginPath(); g.arc(26, 40, 7, 0, 6.2832); g.fill();
    g.fillStyle = '#1e293b'; g.font = '600 25px system-ui,sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(text.slice(0, 14), 44, sub ? 29 : 40);
    if (sub) { g.fillStyle = '#7b8aa3'; g.font = '19px system-ui,sans-serif'; g.fillText(sub, 44, 56); }
    var tx = new T.CanvasTexture(c);
    var sp = new T.Sprite(new T.SpriteMaterial({ map: tx, depthTest: false, transparent: true }));
    sp.scale.set(1.45, 0.45, 1); sp.renderOrder = 10;
    return sp;
  }

  function polyArea(P) {
    var a = 0;
    for (var i = 0; i < P.length; i++) { var p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(a / 2);
  }

  function matOf(T, color, extra) {
    var key = color + (extra ? JSON.stringify(extra) : '');
    if (!mcache[key]) mcache[key] = new T.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.55 }, extra || {}));
    return mcache[key];
  }

  /** Труба по ломаной (пиксели плана -> метры), на высоте y: подача, обратка, вода, канализация. */
  function tube(T, pts, pm, rad, color, y) {
    var v = [], i;
    (pts || []).forEach(function (p) {
      var q = new T.Vector3(p[0] / pm, y, p[1] / pm);
      if (!v.length || v[v.length - 1].distanceTo(q) > 1e-3) v.push(q);
    });
    if (v.length < 2) return null;
    var path = new T.CurvePath();
    for (i = 1; i < v.length; i++) path.add(new T.LineCurve3(v[i - 1], v[i]));
    return new T.Mesh(new T.TubeGeometry(path, Math.min(500, v.length * 3), rad * PIPE_K, 5, false), matOf(T, color));
  }

  /** Что редактор насчитал по этажу: петли тёплого пола, трассы радиаторов, вода, канализация, приборы, коллекторы. */
  function layersOf(fi) {
    var f = G.DATA.floors[fi], out = { loops: [], bundle: [], radRoutes: [] }, was = G.cur;
    G.cur = fi;
    try {
      var step = (G.UFH_STEP && G.UFH_STEP[fi]) || 150, loops = G.tpLoops ? G.tpLoops(f, step) : {};
      Object.keys(loops).forEach(function (k) { (loops[k] || []).forEach(function (Lp) { if (Lp.sup && Lp.ret) out.loops.push(Lp); }); });
      out.bundle = loops.bundle || [];
      out.radRoutes = G.ufhRadRoutes ? G.ufhRadRoutes(f, step) : [];
    } catch (e) { console.error('[plan_3d] слои этажа:', e); }
    G.cur = was;
    out.wl = f.wlines || []; out.sl = f.slines || []; out.sm = f.smain || []; out.sp = f.spress || [];
    out.fix = f.fixtures || []; out.coll = f.coll || null; out.radColl = f.radColl || null;
    return out;
  }

  /**
   * Пол под неразмеченными комнатами. Внутренность дома находим заливкой на сетке 20 см от границы листа: стены (вместе с
   * проёмами - они считаются закрытыми) не пускают заливку внутрь; что до неё не дошло, то внутри. Клетки, не закрытые
   * размеченными комнатами и не лежащие под стеной, закрашиваются светлым полом одной сеткой. Если контур не замкнут и заливка
   * вытекла внутрь, закрашивать нечего - пол просто не рисуется (лучше пусто, чем залитый двор).
   */
  function fillFloor(T, grp, fl, elev, mats) {
    var cs = 0.2, x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, i, j;
    fl.walls.forEach(function (w) { [w.a, w.b].forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }); });
    if (x1 <= x0 || z1 <= z0) return 0;
    x0 -= 1; z0 -= 1; x1 += 1; z1 += 1;
    var nx = Math.ceil((x1 - x0) / cs), nz = Math.ceil((z1 - z0) / cs);
    if (nx * nz > 160000) return 0;
    var big = new Uint8Array(nx * nz), tight = new Uint8Array(nx * nz);
    function stamp(arr, w, r) {
      var L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), st = Math.max(1, Math.ceil(L / (cs * 0.5))), k;
      for (k = 0; k <= st; k++) {
        var px = w.a[0] + (w.b[0] - w.a[0]) * k / st, pz = w.a[1] + (w.b[1] - w.a[1]) * k / st;
        var ia = Math.floor((px - r - x0) / cs), ib = Math.floor((px + r - x0) / cs), ja = Math.floor((pz - r - z0) / cs), jb = Math.floor((pz + r - z0) / cs);
        for (j = Math.max(0, ja); j <= Math.min(nz - 1, jb); j++) for (i = Math.max(0, ia); i <= Math.min(nx - 1, ib); i++) {
          var dx = x0 + (i + 0.5) * cs - px, dz = z0 + (j + 0.5) * cs - pz;
          if (dx * dx + dz * dz <= (r + cs * 0.5) * (r + cs * 0.5)) arr[j * nx + i] = 1;
        }
      }
    }
    fl.walls.forEach(function (w) { var t = Math.max(w.t, 0.2); stamp(big, w, t / 2 + 0.1); stamp(tight, w, t / 2); });
    // заливка снаружи
    var out = new Uint8Array(nx * nz), stack = [0];
    out[0] = 1;
    while (stack.length) {
      var q = stack.pop(), qi = q % nx, qj = (q - qi) / nx;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var ni = qi + d[0], nj = qj + d[1];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) return;
        var n = nj * nx + ni;
        if (out[n] || big[n]) return;
        out[n] = 1; stack.push(n);
      });
    }
    // размеченные комнаты: пол у них свой
    var polys = fl.zones.filter(function (z) { return z.type !== 'cold' && z.pts && z.pts.length > 2; }).map(function (z) {
      var bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
      z.pts.forEach(function (p) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); });
      return { P: z.pts, b: [bx0, bz0, bx1, bz1] };
    });
    function inPoly(x, z, P) {
      var inn = false, a, b;
      for (a = 0, b = P.length - 1; a < P.length; b = a++)
        if ((P[a][1] > z) !== (P[b][1] > z) && x < (P[b][0] - P[a][0]) * (z - P[a][1]) / (P[b][1] - P[a][1]) + P[a][0]) inn = !inn;
      return inn;
    }
    function zoned(x, z) {
      for (var k = 0; k < polys.length; k++) { var b = polys[k].b; if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && inPoly(x, z, polys[k].P)) return true; }
      return false;
    }
    var pos = [], cells = 0, inside = 0;
    for (j = 0; j < nz; j++) {
      var run = -1;
      for (i = 0; i <= nx; i++) {
        var ok = false;
        if (i < nx) {
          var n2 = j * nx + i;
          if (!out[n2]) inside++;
          ok = !out[n2] && !tight[n2] && !zoned(x0 + (i + 0.5) * cs, z0 + (j + 0.5) * cs);
        }
        if (ok && run < 0) run = i;
        else if (!ok && run >= 0) {
          var xa = x0 + run * cs, xb = x0 + i * cs, za = z0 + j * cs, zb = za + cs;
          pos.push(xa, 0, za, xa, 0, zb, xb, 0, zb, xa, 0, za, xb, 0, zb, xb, 0, za);   // обход против часовой при взгляде сверху: нормаль вверх
          cells += i - run; run = -1;
        }
      }
    }
    // заливка вытекла внутрь (контур не замкнут): внутренней части почти нет или она размером со весь лист - не рисуем
    if (!cells || inside > nx * nz * 0.92) return 0;
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    var nrm = []; for (i = 0; i < pos.length / 3; i++) nrm.push(0, 1, 0);
    g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
    var mesh = new T.Mesh(g, mats.rawfloor);
    mesh.position.y = elev + 0.012;   // тень стен на залитом полу не нужна: он выглядел темнее окружения
    grp.add(mesh);
    return cells;
  }

  /** Рамка проёма: левая и правая стойки, верх, низ (у окна) и перемычка. Всё в системе стены, поворот - по её оси. */
  function frameOf(T, grp, mats, w, ux, uy, rotY, mid, y0, width, ya, yb, th, mat, noBottom) {
    var parts = [[-width / 2 + th / 2, (ya + yb) / 2, th, yb - ya], [width / 2 - th / 2, (ya + yb) / 2, th, yb - ya], [0, yb - th / 2, width, th]];
    if (!noBottom) parts.push([0, ya + th / 2, width, th]);
    if (!noBottom && width > 1.1) parts.push([0, (ya + yb) / 2, 0.035, yb - ya]);
    parts.forEach(function (q) {
      var m = new T.Mesh(new T.BoxGeometry(q[2], q[3], w.t * 0.5), mat);
      m.position.set(w.a[0] + ux * (mid + q[0]), y0 + q[1], w.a[1] + uy * (mid + q[0]));
      m.rotation.y = rotY; m.castShadow = true; grp.add(m);
    });
  }

  /** Радиатор с секциями: верхняя и нижняя трубы и частые ребра. Возвращает группу с центром в середине прибора. */
  function radMesh(T, w, mats) {
    var g = new T.Group(), n = Math.max(4, Math.round(w / 0.08)), cw = w / n;
    for (var i = 0; i < n; i++) {
      var f = new T.Mesh(new T.BoxGeometry(cw * 0.78, 0.46, 0.07), mats.rad);
      f.position.set(-w / 2 + cw * (i + 0.5), 0, 0); f.castShadow = true; g.add(f);
    }
    [0.22, -0.22].forEach(function (yy) {
      var b = new T.Mesh(new T.BoxGeometry(w, 0.04, 0.08), mats.rad); b.position.set(0, yy, 0); g.add(b);
    });
    return g;
  }

  // ---------- мебель ----------
  // Условная, по названию комнаты: чтобы 3D показывал дом, а не голые стены. Крупное ставится к стене без проёмов.
  var FURN = [
    [/гостин|зал/i, 'living'], [/кухн/i, 'kitchen'], [/спальн/i, 'bed'], [/детск/i, 'kids'], [/кабинет|рабоч/i, 'office'],
    [/прихож|холл|тамбур|коридор|вестибюл/i, 'hall'], [/гардероб|кладов/i, 'store'], [/с\/у|санузел|ванн|туалет|душ/i, 'wc']
  ];

  /** Длина проёмов на стороне комнаты (0 - сплошная стена). side: 0 верх (z min), 1 право, 2 низ, 3 лево. */
  function sideBlocked(fl, bb, side) {
    var horiz = side === 0 || side === 2, line = side === 0 ? bb.z0 : side === 2 ? bb.z1 : side === 3 ? bb.x0 : bb.x1, tot = 0;
    fl.walls.forEach(function (w) {
      var da = horiz ? Math.abs(w.a[1] - line) : Math.abs(w.a[0] - line), db = horiz ? Math.abs(w.b[1] - line) : Math.abs(w.b[0] - line);
      if (da > 0.4 || db > 0.4) return;
      var L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1, ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      w.ops.forEach(function (o) {
        var cx = w.a[0] + ux * o.o, cz = w.a[1] + uy * o.o, c = horiz ? cx : cz;
        if (c > (horiz ? bb.x0 : bb.z0) - 0.05 && c < (horiz ? bb.x1 : bb.z1) + 0.05) tot += o.w;
      });
    });
    return tot;
  }

  function furnish(T, grp, fl, z, elev, mats, hasFix) {
    var nm = z.name || '', kind = null, i;
    for (i = 0; i < FURN.length; i++) if (FURN[i][0].test(nm)) { kind = FURN[i][1]; break; }
    if (!kind) return;
    var bb = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
    z.pts.forEach(function (p) { bb.x0 = Math.min(bb.x0, p[0]); bb.x1 = Math.max(bb.x1, p[0]); bb.z0 = Math.min(bb.z0, p[1]); bb.z1 = Math.max(bb.z1, p[1]); });
    var W = bb.x1 - bb.x0, D = bb.z1 - bb.z0, area = polyArea(z.pts);
    if (Math.min(W, D) < 1.5 || area < 3) return;
    // стороны: центр, внутренняя нормаль, длина; порядок - от самой «глухой» к самой занятой проёмами
    var sides = [
      { c: [(bb.x0 + bb.x1) / 2, bb.z0], n: [0, 1], len: W }, { c: [bb.x1, (bb.z0 + bb.z1) / 2], n: [-1, 0], len: D },
      { c: [(bb.x0 + bb.x1) / 2, bb.z1], n: [0, -1], len: W }, { c: [bb.x0, (bb.z0 + bb.z1) / 2], n: [1, 0], len: D }
    ];
    sides.forEach(function (sd, k) { sd.k = k; sd.bl = sideBlocked(fl, bb, k); });
    var order = sides.slice().sort(function (a, b) { return (a.bl - b.bl) || (b.len - a.len); });
    var g = new T.Group();
    // piece: коробка w x h x d; u - вдоль стены от середины, v - от стены вглубь комнаты (центр), y0 - от пола
    function piece(sd, w, h, d, u, v, y0, mat) {
      var tx = -sd.n[1], tz = sd.n[0];                       // касательная к стороне
      var m = new T.Mesh(new T.BoxGeometry(w, h, d), mat || mats.furn);
      m.position.set(sd.c[0] + tx * u + sd.n[0] * v, elev + y0 + h / 2, sd.c[1] + tz * u + sd.n[1] * v);
      m.rotation.y = Math.atan2(sd.n[0], sd.n[1]);
      m.castShadow = true; m.receiveShadow = true; g.add(m);
      var ed = new T.LineSegments(new T.EdgesGeometry(m.geometry), mats.fedge); ed.position.copy(m.position); ed.rotation.copy(m.rotation); g.add(ed);
      return m;
    }
    var a = order[0], b = order[1], c = order[2];
    if (kind === 'bed' || kind === 'kids') {
      var bw = kind === 'bed' ? 1.6 : 0.9, bl = kind === 'bed' ? 2.0 : 1.9;
      piece(a, bw + 0.1, 0.95, 0.08, 0, 0.06, 0, mats.wood);                       // изголовье
      piece(a, bw, 0.42, bl, 0, 0.1 + bl / 2, 0, mats.furn);                        // кровать
      piece(a, bw - 0.1, 0.1, bl - 0.45, 0, 0.1 + 0.45 + (bl - 0.45) / 2, 0.42, mats.linen); // одеяло
      if (kind === 'bed') {
        [-0.4, 0.4].forEach(function (uu) { piece(a, 0.55, 0.1, 0.34, uu, 0.35, 0.42, mats.linen); });
        if (a.len > bw + 1.4) [-1, 1].forEach(function (sg) { piece(a, 0.45, 0.45, 0.4, sg * (bw / 2 + 0.35), 0.25, 0, mats.wood); });
      }
      var wd = (b.len > 1.6 ? b : c);
      piece(wd, Math.min(1.8, wd.len - 0.6), 2.1, 0.6, 0, 0.3, 0, mats.wood);        // шкаф
      if (kind === 'kids') piece(c, 1.2, 0.74, 0.6, 0, 0.3, 0, mats.wood);
    } else if (kind === 'living') {
      piece(a, 2.1, 0.45, 0.92, 0, 0.5, 0, mats.sofa);                               // диван
      piece(a, 2.1, 0.45, 0.2, 0, 0.12, 0.45, mats.sofa);                            // спинка
      [-1.05, 1.05].forEach(function (uu) { piece(a, 0.18, 0.2, 0.9, uu, 0.5, 0.45, mats.sofa); });
      piece(a, 1.1, 0.4, 0.6, 0, 1.75, 0, mats.glassTop);                            // журнальный столик
      var tvS = sides[(a.k + 2) % 4];
      piece(tvS, Math.min(1.8, tvS.len - 0.6), 0.5, 0.4, 0, 0.22, 0, mats.wood);     // тумба
      piece(tvS, 1.15, 0.66, 0.05, 0, 0.1, 0.9, mats.dark);                           // телевизор
    } else if (kind === 'kitchen') {
      var kl = Math.min(a.len - 0.4, 3.6);
      piece(a, kl, 0.86, 0.6, 0, 0.32, 0, mats.furn);                                // нижние шкафы
      piece(a, kl, 0.04, 0.64, 0, 0.32, 0.86, mats.top);                             // столешница
      piece(a, 0.6, 0.012, 0.5, -kl / 4, 0.3, 0.9, mats.dark);                       // варочная панель
      piece(a, 0.5, 0.01, 0.4, kl / 4, 0.3, 0.9, mats.metal);                        // мойка
      if (a.bl === 0) piece(a, kl, 0.7, 0.34, 0, 0.19, 1.45, mats.furn);             // верхние шкафы
      if (area > 10) {
        piece(a, 1.3, 0.04, 0.8, 0, 2.3, 0.74, mats.wood);                           // обеденный стол
        [-0.45, 0.45].forEach(function (uu) { [1.8, 2.8].forEach(function (vv) { piece(a, 0.4, 0.46, 0.4, uu, vv, 0, mats.wood); }); });
      }
    } else if (kind === 'office') {
      piece(a, 1.4, 0.04, 0.7, 0, 0.4, 0.74, mats.wood);
      [-0.65, 0.65].forEach(function (uu) { piece(a, 0.05, 0.74, 0.65, uu, 0.4, 0, mats.furn); });
      piece(a, 0.5, 0.5, 0.5, 0, 1.0, 0, mats.dark);                                 // кресло
      piece(b, Math.min(1.2, b.len - 0.5), 1.9, 0.35, 0, 0.18, 0, mats.wood);        // стеллаж
    } else if (kind === 'hall' && area >= 4) {
      piece(a, Math.min(1.4, a.len - 0.5), 2.1, 0.42, 0, 0.22, 0, mats.wood);
      piece(a, Math.min(1.0, a.len - 0.6), 0.4, 0.3, 0, 0.8, 0, mats.furn);
    } else if (kind === 'store') {
      for (i = 0; i < 4; i++) piece(a, a.len - 0.3, 0.03, 0.4, 0, 0.22, 0.35 + i * 0.5, mats.wood);
    } else if (kind === 'wc' && !hasFix) {
      piece(a, 1.7, 0.55, 0.75, 0, 0.4, 0, mats.white);                              // ванна
      piece(c, 0.4, 0.4, 0.65, 0, 0.35, 0, mats.white);                              // унитаз
      piece(b, 0.55, 0.85, 0.45, 0, 0.25, 0, mats.white);                            // раковина
    }
    if (g.children.length) grp.add(g);
  }

  /** Стена по кускам: между проёмами - на всю высоту, под окном и над проёмом - ниже и выше него. */
  function wallBoxes(T, grp, w, H, y0, mats) {
    var dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy);
    if (L < 1e-6) return;
    var ux = dx / L, uy = dy / L, rotY = -Math.atan2(uy, ux);
    var mat = w.k === 'int' ? mats.int : mats.ext;
    if (w.matC) { mats['m' + w.matC] = mats['m' + w.matC] || new T.MeshStandardMaterial({ color: w.matC, roughness: 0.9 }); mat = mats['m' + w.matC]; }
    var lo = -w.ea, hi = L + w.eb;
    function piece(s0, s1, ya, yb, m) {
      if (s1 - s0 < 0.005 || yb - ya < 0.005) return;
      var mid = (s0 + s1) / 2, g = new T.BoxGeometry(s1 - s0, yb - ya, w.t);
      var mesh = new T.Mesh(g, m || mat);
      mesh.position.set(w.a[0] + ux * mid, y0 + (ya + yb) / 2, w.a[1] + uy * mid);
      mesh.rotation.y = rotY;
      mesh.castShadow = true;      // тень стен ложится на основание; сами стены тень не принимают, иначе у проёмов шум из серых треугольников
      grp.add(mesh);
      var ed = new T.LineSegments(new T.EdgesGeometry(g), mats.edge);
      ed.position.copy(mesh.position); ed.rotation.copy(mesh.rotation);
      grp.add(ed);
    }
    var list = w.ops.slice().sort(function (p, q) { return p.o - q.o; }), cur = lo;
    list.forEach(function (o) {
      var s0 = Math.max(lo, o.o - o.w / 2), s1 = Math.min(hi, o.o + o.w / 2);
      piece(cur, s0, 0, H);
      var top = Math.min(H, o.sill + o.h);
      if (o.k === 'win') {
        piece(s0, s1, 0, Math.min(H, o.sill));            // под окном
        piece(s0, s1, top, H);                            // над окном
        var gl = new T.Mesh(new T.BoxGeometry(s1 - s0, top - o.sill, 0.04), mats.glass);
        gl.position.set(w.a[0] + ux * (s0 + s1) / 2, y0 + (o.sill + top) / 2, w.a[1] + uy * (s0 + s1) / 2);
        gl.rotation.y = rotY; grp.add(gl);
        // рама окна: четыре бруска и, у широких окон, средняя перемычка; подоконник выступает наружу
        frameOf(T, grp, mats, w, ux, uy, rotY, (s0 + s1) / 2, y0, s1 - s0, o.sill, top, 0.05, mats.frame);
        var sl = new T.Mesh(new T.BoxGeometry(s1 - s0 + 0.1, 0.03, w.t + 0.1), mats.frame);
        sl.position.set(w.a[0] + ux * (s0 + s1) / 2, y0 + o.sill - 0.015, w.a[1] + uy * (s0 + s1) / 2); sl.rotation.y = rotY; sl.castShadow = true; grp.add(sl);
      } else {
        piece(s0, s1, top, H);                            // над дверью
        var leaf = new T.Mesh(new T.BoxGeometry(s1 - s0 - 0.08, top - 0.04, 0.05), mats.door);
        leaf.position.set(w.a[0] + ux * (s0 + s1) / 2, y0 + top / 2 - 0.02, w.a[1] + uy * (s0 + s1) / 2);
        leaf.rotation.y = rotY; leaf.castShadow = true; grp.add(leaf);
        frameOf(T, grp, mats, w, ux, uy, rotY, (s0 + s1) / 2, y0, s1 - s0, 0, top, 0.04, mats.frame, true);
        var hd = new T.Mesh(new T.BoxGeometry(0.12, 0.03, 0.09), mats.metal);
        hd.position.set(w.a[0] + ux * ((s0 + s1) / 2 + (s1 - s0) / 2 - 0.15), y0 + 1.0, w.a[1] + uy * ((s0 + s1) / 2 + (s1 - s0) / 2 - 0.15)); hd.rotation.y = rotY; grp.add(hd);
      }
      cur = Math.max(cur, s1);
    });
    piece(cur, hi, 0, H);
  }

  function build(m, data) {
    var T = m.T;
    box.innerHTML = '';
    var W = box.clientWidth || 800, Hh = box.clientHeight || 520;
    var r = new T.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(W, Hh);
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    r.localClippingEnabled = true;
    box.appendChild(r.domElement);
    var scene = new T.Scene();
    scene.background = null;                   // фон - градиент самой рамки (CSS), холст прозрачный
    r.setClearColor(0xffffff, 0);
    var cam = new T.OrthographicCamera(-10, 10, 10, -10, -200, 600);
    scene.add(new T.HemisphereLight(0xffffff, 0xeef3fb, 1.3)); scene.add(new T.AmbientLight(0xffffff, 0.45));
    var sun = new T.DirectionalLight(0xffffff, 0.6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);
    var group = new T.Group(); scene.add(group);

    var mk = function (c, o) { return new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.9 }, o || {})); };
    var mats = {
      ext: mk(0xffffff), int: mk(0xf3f6fb),
      glass: mk(0x93c5fd, { transparent: true, opacity: 0.34, roughness: 0.1, depthWrite: false }),
      door: mk(0xe9dcc8, { roughness: 0.7 }), frame: mk(0xffffff, { roughness: 0.6 }), metal: mk(0x94a3b8, { roughness: 0.35, metalness: 0.5 }),
      slab: mk(0xe3e9f3), rad: mk(0xffffff, { roughness: 0.5 }),
      edge: new T.LineBasicMaterial({ color: LINE, transparent: true, opacity: 0.85 }),
      fedge: new T.LineBasicMaterial({ color: 0xa9b8cf, transparent: true, opacity: 0.7 }),
      furn: mk(0xf4f7fc), wood: mk(0xe6d9c6), sofa: mk(0xcfdcf2), linen: mk(0xffffff), top: mk(0xdde5f1), dark: mk(0x475569, { roughness: 0.5 }),
      rawfloor: mk(0xf8faff, { side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
      glassTop: mk(0xbfdbfe, { transparent: true, opacity: 0.7 }), white: mk(0xffffff, { roughness: 0.4 }),
      hi: new T.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.13, depthWrite: false, side: T.DoubleSide })
    };

    // этаж с лежаком канализации и этаж коллекторов воды: от них вертикали уходят вверх, на этажи выше
    var elevBy = {}, sewF = -1, wCollF = -1;
    G.DATA.floors.forEach(function (f, i) { if (sewF < 0 && (f.smain || []).length) sewF = i; });
    try { var wc0 = G.DATA.floors[0].water && G.DATA.floors[0].water.coll; if (wc0) wCollF = wc0.fl | 0; } catch (e) { }
    var floors = [], elev = 0, minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9, totalH = 0, lg = {};
    LAYERS.forEach(function (l) { lg[l[0]] = []; });
    data.forEach(function (fl) {
      if (!fl.walls.length && !fl.zones.length) { elev += fl.h + 0.2; return; }
      var g = new T.Group(), gl = {}; g.name = 'floor' + fl.i;
      LAYERS.forEach(function (l) { gl[l[0]] = new T.Group(); g.add(gl[l[0]]); lg[l[0]].push(gl[l[0]]); });
      var ly = layersOf(fl.i), pm = fl.ppm; elevBy[fl.i] = elev;
      // перекрытие под этажом выше первого: плита по габариту его стен
      if (elev > 0 && fl.walls.length) {
        var bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
        fl.walls.forEach(function (w) { [w.a, w.b].forEach(function (p) { bx0 = Math.min(bx0, p[0] - w.t / 2); bx1 = Math.max(bx1, p[0] + w.t / 2); bz0 = Math.min(bz0, p[1] - w.t / 2); bz1 = Math.max(bz1, p[1] + w.t / 2); }); });
        var slab = new T.Mesh(new T.BoxGeometry(bx1 - bx0, 0.2, bz1 - bz0), mats.slab);
        slab.position.set((bx0 + bx1) / 2, elev - 0.1, (bz0 + bz1) / 2); slab.castShadow = slab.receiveShadow = true; gl.walls.add(slab);
      }
      // полы комнат
      fl.zones.forEach(function (z) {
        if (z.type === 'cold') return;
        var sh = new T.Shape();
        z.pts.forEach(function (p, i) { if (i) sh.lineTo(p[0], p[1]); else sh.moveTo(p[0], p[1]); });
        var gm = new T.ShapeGeometry(sh);
        var mesh = new T.Mesh(gm, new T.MeshStandardMaterial({ color: COLORS[z.type] || COLORS.room, side: T.DoubleSide, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
        mesh.rotation.x = Math.PI / 2; mesh.position.y = elev + 0.02; mesh.receiveShadow = true;
        gl.floor.add(mesh);
        // ключевое помещение (котельная) - голубой полупрозрачный объём с контуром, как выделение на иллюстрациях
        if (z.type === 'boiler') {
          var hs = new T.Shape(); z.pts.forEach(function (p, i) { if (i) hs.lineTo(p[0], p[1]); else hs.moveTo(p[0], p[1]); });
          var hg = new T.ExtrudeGeometry(hs, { depth: fl.h * 0.98, bevelEnabled: false });
          var hm = new T.Mesh(hg, mats.hi); hm.rotation.x = Math.PI / 2; hm.position.y = elev + fl.h * 0.98; hm.renderOrder = 2; gl.floor.add(hm);
          var he = new T.LineSegments(new T.EdgesGeometry(hg), new T.LineBasicMaterial({ color: BLUE })); he.rotation.copy(hm.rotation); he.position.copy(hm.position); gl.floor.add(he);
        }
        if (z.name) {
          var sp = label(T, z.name, (Math.round(polyArea(z.pts) * 10) / 10 + '').replace('.', ',') + ' м²');
          var c = z.seed || z.pts[0];
          sp.position.set(c[0], elev + 0.25, c[1]); gl.floor.add(sp);
        }
      });
      // мебель по названиям комнат; у санузла без приборов из плана - условные ванна, унитаз, раковина
      var seenFurn = {}, hasFixIn = function (z) {
        var bb = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
        z.pts.forEach(function (p) { bb.x0 = Math.min(bb.x0, p[0]); bb.x1 = Math.max(bb.x1, p[0]); bb.z0 = Math.min(bb.z0, p[1]); bb.z1 = Math.max(bb.z1, p[1]); });
        return (ly.fix || []).some(function (q) { return q.t !== 'riser' && q.x / pm >= bb.x0 && q.x / pm <= bb.x1 && q.y / pm >= bb.z0 && q.y / pm <= bb.z1; });
      };
      fl.zones.forEach(function (z) {
        if (z.type === 'cold' || !z.name) return;
        var kz = JSON.stringify(z.pts); if (seenFurn[kz]) return; seenFurn[kz] = 1;
        try { furnish(T, gl.furn, fl, z, elev, mats, hasFixIn(z)); } catch (e) { console.warn('[plan_3d] мебель:', e); }
      });
      try { fillFloor(T, gl.floor, fl, elev, mats); } catch (e) { console.warn('[plan_3d] пол под неразмеченными комнатами:', e); }
      fl.walls.forEach(function (w) {
        wallBoxes(T, gl.walls, w, fl.h, elev, mats);
        [w.a, w.b].forEach(function (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); });
      });
      // радиаторы: низ на 120 мм от пола, высота 500 мм; трассы - под ними
      fl.rads.forEach(function (rd) {
        var rm = radMesh(T, rd.w, mats);
        var rx = rd.x, ry = rd.y, bw = null, bd = 1e9;
        // прибор не должен уходить в стену: у толстой стены (слои калькулятора) сдвигаем его от грани на 5 см
        fl.walls.forEach(function (w) {
          var dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
          var al = (rx - w.a[0]) * ux + (ry - w.a[1]) * uy, ac = -(rx - w.a[0]) * uy + (ry - w.a[1]) * ux;
          if (al < -0.2 || al > L + 0.2) return;
          if (Math.abs(ac) < bd) { bd = Math.abs(ac); bw = { t: w.t, ac: ac, nx: -uy, ny: ux }; }
        });
        if (bw && bd < bw.t / 2 + 0.05 + 0.04) {
          var need = bw.t / 2 + 0.05 + 0.04, sg = bw.ac >= 0 ? 1 : -1, mv = need - bd;
          rx += bw.nx * sg * mv; ry += bw.ny * sg * mv;
        }
        rm.position.set(rx, elev + 0.12 + 0.25, ry); rm.rotation.y = -rd.ang * Math.PI / 180;
        gl.rad.add(rm);
      });
      (ly.radRoutes || []).forEach(function (sg) {
        var t = tube(T, [sg.a, sg.b], pm, 0.009 * Math.sqrt(sg.n || 1), 0xb91c1c, elev + 0.1); if (t) gl.rad.add(t);
      });
      if (ly.radColl) { var rc = new T.Mesh(new T.BoxGeometry(0.5, 0.35, 0.12), matOf(T, 0xdc2626)); rc.position.set(ly.radColl.x / pm, elev + 1.0, ly.radColl.y / pm); gl.rad.add(rc); }
      // тёплый пол: подача красная, обратка синяя, трубы 16 мм в стяжке
      (ly.loops || []).forEach(function (Lp) {
        var a1 = tube(T, Lp.sup, pm, 0.008, 0xff6b6b, elev + 0.03), a2 = tube(T, Lp.ret, pm, 0.008, 0x6b8cff, elev + 0.03);
        var a3 = Lp.sup.length && Lp.ret.length ? tube(T, [Lp.sup[Lp.sup.length - 1], Lp.ret[0]], pm, 0.008, 0x6b8cff, elev + 0.03) : null;
        [a1, a2, a3].forEach(function (t) { if (t) gl.tp.add(t); });
      });
      (ly.bundle || []).forEach(function (sg) { var t = tube(T, [sg.a, sg.b], pm, 0.009 * Math.sqrt(sg.n || 1), 0x7c6aa8, elev + 0.05); if (t) gl.tp.add(t); });
      if (ly.coll) { var cb = new T.Mesh(new T.BoxGeometry(0.5, 0.35, 0.12), matOf(T, 0xea580c)); cb.position.set(ly.coll.x / pm, elev + 1.0, ly.coll.y / pm); gl.tp.add(cb); }
      // вода (В1) и канализация: отводы Ø50/110, лежак Ø110, напорная Ø32
      (ly.wl || []).forEach(function (l) { var t = tube(T, l.pts, pm, 0.009, 0x38bdf8, elev + 0.2); if (t) gl.water.add(t); });
      // магистраль воды от коллекторов до санузлов без приборов
      (G.DATA.floors[fl.i].wtr || []).forEach(function (l) { var t = tube(T, l.pts, pm, 0.011, 0x0ea5e9, elev + 0.2); if (t) gl.water.add(t); });
      // подъём воды на этаж выше: вертикаль в точке стояка этажа, от уровня коллекторов
      var wsrc = G.DATA.floors[fl.i].wsrc;
      if (wsrc && wCollF >= 0 && wCollF !== fl.i && elevBy[wCollF] != null) {
        var y0 = elevBy[wCollF] + 1.0, y1 = elev + 0.2;
        // до вертикали — по плану этажа коллекторов, как в расчёте длины: к ближайшему стояку этажа
        try {
          var cf = G.DATA.floors[wCollF], wcl = G.DATA.floors[0].water.coll, sh = [wsrc.x, wsrc.y], sd = 1e18;
          (cf.fixtures || []).forEach(function (q) { if (q.t !== 'riser') return; var dd = Math.hypot(q.x - wsrc.x, q.y - wsrc.y); if (dd < sd) { sd = dd; sh = [q.x, q.y]; } });
          var rt = G.wwRoutes ? G.wwRoutes(cf, wCollF, [wcl.x, wcl.y], [sh], G.getMask(wCollF))[0] : [[wcl.x, wcl.y], sh];
          var tr = tube(T, rt, cf.pxPerM || pm, 0.011, 0x0ea5e9, elevBy[wCollF] + 0.2); if (tr) gl.water.add(tr);
          wsrc = { x: sh[0], y: sh[1] };
          y0 = elevBy[wCollF] + 0.2;
        } catch (e) { console.warn('[plan_3d] магистраль воды к стояку:', e); }
        if (y1 > y0) { var wv = new T.Mesh(new T.CylinderGeometry(0.014, 0.014, y1 - y0, 8), matOf(T, 0x0ea5e9)); wv.position.set(wsrc.x / pm, (y0 + y1) / 2, wsrc.y / pm); gl.water.add(wv); }
      }
      (ly.sl || []).forEach(function (l) { var t = tube(T, l.pts, pm, (l.d || 50) / 2000, 0x9b7f57, elev + 0.07); if (t) gl.sewer.add(t); });
      (ly.sm || []).forEach(function (l) { var t = tube(T, l.pts, pm, 0.055, 0x78593a, elev + 0.07); if (t) gl.sewer.add(t); });
      (ly.sp || []).forEach(function (l) { var t = tube(T, l.pts, pm, 0.016, 0xf59e0b, elev + 0.07); if (t) gl.sewer.add(t); });
      // приборы санузлов и стояки
      (ly.fix || []).forEach(function (q) {
        var d = G.FIXT && G.FIXT[q.t];
        if (!d) return;
        var w = d[2] / 1000, dp = d[3] / 1000, h = FIX_H[q.t] || 0.5, mesh;
        if (q.t === 'riser') {
          // стояк выше этажа с лежаком идёт вниз до лежака, сквозь нижние этажи
          var yb = (sewF >= 0 && sewF !== fl.i && elevBy[sewF] != null && elevBy[sewF] < elev) ? elevBy[sewF] + 0.07 : elev, hh = elev + fl.h - yb;
          mesh = new T.Mesh(new T.CylinderGeometry(0.055, 0.055, hh, 12), matOf(T, 0x9b7f57)); mesh.position.set(q.x / pm, yb + hh / 2, q.y / pm); gl.sewer.add(mesh); return;
        }
        mesh = new T.Mesh(new T.BoxGeometry(w, h, dp), q.t === 'pump' ? matOf(T, 0x64748b) : mats.white);
        mesh.position.set(q.x / pm, elev + h / 2, q.y / pm); mesh.rotation.y = -(q.ang || q.rot || 0) * Math.PI / 180;
        mesh.castShadow = true; gl.fix.add(mesh);
        var fe = new T.LineSegments(new T.EdgesGeometry(mesh.geometry), mats.fedge); fe.position.copy(mesh.position); fe.rotation.copy(mesh.rotation); gl.fix.add(fe);
      });
      fl.zones.forEach(function (z) {
        if (z.type !== 'boiler') return;
        var c = z.seed || z.pts[0], bo = new T.Mesh(new T.BoxGeometry(0.55, 0.8, 0.4), mats.white);
        bo.position.set(c[0], elev + 0.4, c[1]); bo.castShadow = true; gl.fix.add(bo);
        var be = new T.LineSegments(new T.EdgesGeometry(bo.geometry), mats.fedge); be.position.copy(bo.position); gl.fix.add(be);
        var dsp = new T.Mesh(new T.BoxGeometry(0.22, 0.1, 0.01), new T.MeshBasicMaterial({ color: BLUE })); dsp.position.set(c[0], elev + 0.62, c[1] + 0.205); gl.fix.add(dsp);
        var tk = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 1.35, 20), mats.white); tk.position.set(c[0] + 0.75, elev + 0.675, c[1]); tk.castShadow = true; gl.fix.add(tk);
        var tke = new T.LineSegments(new T.EdgesGeometry(tk.geometry, 20), mats.fedge); tke.position.copy(tk.position); gl.fix.add(tke);
      });
      group.add(g);
      floors.push({ i: fl.i, g: g, top: elev + fl.h, h: fl.h });
      totalH = Math.max(totalH, elev + fl.h);
      elev += fl.h + 0.2;
    });
    // основание под домом
    var cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, span = Math.max(maxX - minX, maxZ - minZ, 4);
    var base = new T.Mesh(new T.PlaneGeometry(span * 3, span * 3), new T.ShadowMaterial({ color: 0x1e3a6e, opacity: 0.16 }));
    base.rotation.x = -Math.PI / 2; base.position.set(cx, -0.012, cz); base.receiveShadow = true; group.add(base);
    var grid = new T.GridHelper(span * 2.2, Math.round(span * 2.2), 0xd7e1f0, 0xe6edf7); grid.position.set(cx, -0.01, cz);
    grid.material.transparent = true; grid.material.opacity = 0.55; group.add(grid);
    // цоколь под домом и пунктирный контур участка (синий, как размерные линии на иллюстрациях)
    var plinth = new T.Mesh(new T.BoxGeometry(maxX - minX + 0.9, 0.12, maxZ - minZ + 0.9), mats.slab);
    plinth.position.set(cx, -0.07, cz); plinth.receiveShadow = true; plinth.castShadow = true; group.add(plinth);
    var pe = new T.LineSegments(new T.EdgesGeometry(plinth.geometry), mats.edge); pe.position.copy(plinth.position); group.add(pe);
    var dl = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(maxX - minX + 2.4, 0.001, maxZ - minZ + 2.4)), new T.LineDashedMaterial({ color: BLUE, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.7 }));
    dl.computeLineDistances(); dl.position.set(cx, 0, cz); group.add(dl);
    sun.position.set(cx + span * 0.9, span * 1.7 + totalH, cz + span * 0.6); sun.target.position.set(cx, 0, cz);
    var sc2 = sun.shadow.camera, sr = span * 1.4 + totalH; sc2.left = -sr; sc2.right = sr; sc2.top = sr; sc2.bottom = -sr; sc2.near = 1; sc2.far = span * 5 + totalH * 2 + 20; sc2.updateProjectionMatrix();

    var ctl = new m.OC(cam, r.domElement);
    ctl.enableDamping = true; ctl.target.set(cx, totalH / 3, cz); ctl.zoomSpeed = 1.2;
    S = { r: r, scene: scene, cam: cam, ctl: ctl, group: group, raf: 0, ro: null, floors: floors, lg: lg, cx: cx, cz: cz, span: span, totalH: totalH,
      plane: new T.Plane(new T.Vector3(0, -1, 0), totalH + 1), T: T, fh: 10 };
    view('iso');
    uiPanel();
    cutToggle(true);   // по умолчанию - разрез: дом показан с обстановкой, а не закрытой коробкой
    S.ro = new ResizeObserver(function () {
      if (!S) return;
      var w = box.clientWidth, h = box.clientHeight;
      if (w > 10 && h > 10) { S.r.setSize(w, h); fitCam(); }
    });
    S.ro.observe(box);
    (function loop() {
      if (!S) return;
      S.raf = requestAnimationFrame(loop);
      S.ctl.update();
      S.r.render(S.scene, S.cam);
    })();
  }

  /** Рамка ортографической камеры: половина высоты кадра S.fh, ширина - по пропорциям поля. */
  function fitCam() {
    if (!S) return;
    var w = box.clientWidth || 800, h = box.clientHeight || 520, a = w / h, fh = S.fh;
    S.cam.left = -fh * a; S.cam.right = fh * a; S.cam.top = fh; S.cam.bottom = -fh; S.cam.updateProjectionMatrix();
  }

  function view(kind) {
    if (!S) return;
    var d = S.span * 2 + 20, y = S.totalH;
    S.cam.zoom = 1;
    if (kind === 'top') { S.fh = S.span * 0.45 + 0.6; S.cam.position.set(S.cx, d + y, S.cz + 0.001); }
    else { S.fh = S.span * 0.42 + y * 0.4 + 0.3; S.cam.position.set(S.cx + d * 0.57, y / 3 + d * 0.5, S.cz + d * 0.62); }   // изометрия, камера с юго-востока
    S.ctl.target.set(S.cx, y / 3, S.cz);
    fitCam(); S.cam.lookAt(S.ctl.target); S.ctl.update();
  }

  var CUT_H = 1.5;   // отметка разреза по умолчанию: стены ниже подоконников и вся обстановка на виду
  function cutToggle(force) {
    if (!S) return;
    var b = document.getElementById('p3d_cutbtn'), rg = document.getElementById('p3d_cut');
    var on2 = typeof force === 'boolean' ? force : (S.r.clippingPlanes.length === 0);
    var v = on2 ? CUT_H : S.totalH + 0.5;
    setCut(v); if (rg) rg.value = v;
    if (b) b.classList.toggle('on', on2);
  }

  function setCut(v) {
    if (!S) return;
    if (v >= S.totalH + 0.4) S.r.clippingPlanes = [];
    else { S.plane.constant = v; S.r.clippingPlanes = [S.plane]; }
  }

  function uiPanel() {
    panel = document.createElement('div'); panel.className = 'p3d-panel';
    var h = '<div class="p3d-segrow"><button type="button" data-v="iso" class="on">Изометрия</button><button type="button" data-v="top">Сверху</button><button type="button" data-v="cut" id="p3d_cutbtn">Разрез</button></div>' +
      '<button type="button" data-more="1" class="p3d-link">Слои и срез ▸</button><div class="p3d-more" style="display:none;flex-direction:column;gap:7px">' +
      '<label title="Срез по высоте: убирает всё выше выбранной отметки">Срез <input type="range" id="p3d_cut" min="0.3" max="' + (S.totalH + 0.5).toFixed(2) + '" step="0.1" value="' + (S.totalH + 0.5).toFixed(2) + '"></label>';
    h += '<div style="margin-top:4px;font-weight:700;font-size:11px;letter-spacing:.06em;opacity:.7">ЭТАЖИ</div>';
    S.floors.forEach(function (f) {
      h += '<label><input type="checkbox" data-f="' + f.i + '" checked> ' + (f.i + 1) + ' этаж <span style="opacity:.6">h ' + String(Math.round(f.h * 100) / 100).replace('.', ',') + ' м</span></label>';
    });
    h += '<div style="margin-top:4px;font-weight:700;font-size:11px;letter-spacing:.06em;opacity:.7">СЛОИ <span style="font-weight:400;opacity:.7">трубы ×2</span></div>';
    LAYERS.forEach(function (l) { h += '<label><input type="checkbox" data-l="' + l[0] + '" checked> ' + l[1] + '</label>'; });
    panel.innerHTML = h + '</div>';
    panel.onclick = function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.getAttribute('data-more')) {
        var mo = panel.querySelector('.p3d-more'), open = mo.style.display === 'none';
        mo.style.display = open ? 'flex' : 'none'; b.textContent = 'Слои и срез ' + (open ? '▾' : '▸');
      } else if (b.getAttribute('data-v') === 'cut') cutToggle();
      else {
        view(b.getAttribute('data-v'));
        [].forEach.call(panel.querySelectorAll('.p3d-segrow button[data-v]'), function (x) { if (x.id !== 'p3d_cutbtn') x.classList.toggle('on', x === b); });
      }
    };
    panel.oninput = function (e) {
      var t = e.target;
      if (t.id === 'p3d_cut') setCut(parseFloat(t.value));
      else if (t.getAttribute && t.getAttribute('data-l') != null) {
        (S.lg[t.getAttribute('data-l')] || []).forEach(function (grp) { grp.visible = t.checked; });
      } else if (t.getAttribute && t.getAttribute('data-f') != null) {
        S.floors.forEach(function (f) { if (String(f.i) === t.getAttribute('data-f')) f.g.visible = t.checked; });
      }
    };
    box.appendChild(panel);
  }

  // другой режим рисования во время 3D - сначала вернуться к плану
  function hookSetMode() {
    if (!G.setMode || G.setMode.__p3d) return;
    var base = G.setMode;
    G.setMode = function () { if (on) close3d(); return base.apply(this, arguments); };
    G.setMode.__p3d = true;
  }

  G.plan3dOpen = open3d; G.plan3dClose = close3d; G.plan3dActive = function () { return on; };
  mountUi(); hookSetMode();
})(window);
