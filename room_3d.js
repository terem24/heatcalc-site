/* room_3d.js — общий вид котельной в 3D: те же узлы, что на кадрах (котлы, коллектор, бойлер), но настоящие модели (glb),
 * трубы строятся по тем же трассам, что и на плоском виде. Вращение, приближение, куб ракурсов (как в Revit),
 * прозрачность деталей по щелчку, «Зафиксировать вид» (для себя — в браузере; администратор — для всех, app_settings.room3d_views).
 *
 * Вход: Room3D.show(host, spec, app), где spec собирает room_view.js:
 *   { sig, layers: [{ kind, key, fid, off:[x,y,z] м, zones:[{ root, x0, x1, z0, z1 }] }], routes: [{ role, pp:[[px,py]..], plane }],
 *     mat, comps: { 'kind|fid|root': { kind, pk, t1, t2, ok } } }
 * Координаты как в сборщиках узлов: метры, X вправо, Y в стену, Z вверх; в three: X, Y=Z, Z=-Y (к зрителю — плюс Z).
 * Трубы: точка плоского вида px -> X = px/1500, Y = -py/1500; глубина от стены — plane (мм).
 */
(function (G) {
  'use strict';

  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
  var GLB_DIR = 'models3d/room/';
  var PXM = 1500;
  var STUB = /^(труба|лежак|транзит|подающая труба|медная труба|выпуск)/;   // заводские патрубки: трубу системы ведём от порта сами
  var ROLE_Z = { sup: 0.19, ret: 0.13, ld: 0.055, lr: 0.13 };
  var ROLE_COL = { cw: 0x0891B2, sup: 0xE53935, ret: 0x1E88E5, ld: 0xF57C00, lr: 0x1E88E5 };
  var L = null, loading = null;      // библиотеки
  var S = null;                      // живая сцена (одна на страницу)
  var A = null;
  var DEF = null, defLoading = false;   // виды по умолчанию, заданные администратором (app_settings.room3d_views)

  // ── библиотеки с CDN: three и расширения подключаются blob-адресами, import map не нужен (как в plan_3d.js)
  function blobModule(path, fix) {
    return fetch(THREE_URL + path).then(function (r) {
      if (!r.ok) throw new Error('библиотека 3D не скачалась (' + r.status + ')');
      return r.text();
    }).then(function (t) { return URL.createObjectURL(new Blob([fix ? fix(t) : t], { type: 'text/javascript' })); });
  }
  function loadLibs() {
    if (L) return Promise.resolve(L);
    if (loading) return loading;
    loading = blobModule('build/three.module.js').then(function (threeUrl) {
      var fx = function (t) { return t.replace(/from\s+['"]three['"]/g, "from '" + threeUrl + "'"); };
      return blobModule('examples/jsm/utils/BufferGeometryUtils.js', fx).then(function (bgu) {
        var fg = function (t) { return fx(t).replace(/from\s+['"]\.\.\/utils\/BufferGeometryUtils\.js['"]/g, "from '" + bgu + "'"); };
        return Promise.all([
          import(threeUrl),
          blobModule('examples/jsm/controls/OrbitControls.js', fx).then(function (u) { return import(u); }),
          blobModule('examples/jsm/loaders/GLTFLoader.js', fg).then(function (u) { return import(u); }),
          blobModule('examples/jsm/loaders/DRACOLoader.js', fx).then(function (u) { return import(u); }),
          blobModule('examples/jsm/environments/RoomEnvironment.js', fx).then(function (u) { return import(u); })
        ]);
      });
    }).then(function (m) {
      L = { T: m[0], OC: m[1].OrbitControls, GL: m[2].GLTFLoader, DR: m[3].DRACOLoader, RE: m[4].RoomEnvironment };
      return L;
    });
    loading.catch(function () { loading = null; });
    return loading;
  }

  // ── виды: свой (браузер) и по умолчанию от администратора
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function loadDefaults() {
    if (DEF || defLoading || typeof supabaseClient === 'undefined') return;
    defLoading = true;
    supabaseClient.from('app_settings').select('value').eq('key', 'room3d_views').maybeSingle()
      .then(function (r) { DEF = (r && r.data && r.data.value) || {}; defLoading = false; })
      .catch(function () { DEF = {}; defLoading = false; });
  }
  function isAdmin() { return !!(A && A.wmPreviewOn && A.wmPreviewOn()); }
  var MEM = {};                       // камера и прозрачные детали на время сеанса: переключили вид и вернулись — всё на месте
  function savedView(sig) { return MEM[sig] || lsGet('rv3d:' + sig) || (DEF && DEF[sig]) || null; }

  // ── сборка
  function css() {
    if (document.getElementById('rv3d_css')) return;
    var st = document.createElement('style'); st.id = 'rv3d_css';
    st.textContent =
      '.r3{position:relative;width:100%;height:100%;background:#E3E6EA;overflow:hidden;border-radius:14px;touch-action:none}' +
      '.r3 canvas{display:block;width:100%;height:100%;outline:none}' +
      '.r3.full{position:fixed;inset:0;z-index:99999;border-radius:0;height:100vh}' +
      '.r3-bar{position:absolute;left:10px;top:10px;display:flex;flex-wrap:wrap;gap:6px;max-width:calc(100% - 120px)}' +
      '.r3-bar button{border:1px solid rgba(15,23,42,.14);background:rgba(255,255,255,.88);backdrop-filter:blur(6px);color:#0f172a;font:500 12.5px system-ui,Arial,sans-serif;padding:7px 12px;border-radius:9px;cursor:pointer;transition:background .12s,box-shadow .12s}' +
      '.r3-bar button:hover{background:#fff;box-shadow:0 2px 8px rgba(15,23,42,.15)}.r3-bar button.on{background:#2563EB;border-color:#2563EB;color:#fff}' +
      '.r3-bar button.adm{border-style:dashed}' +
      '.r3-msg{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:8px 14px;border-radius:9px;background:rgba(17,24,39,.9);color:#fff;font:12.5px system-ui,Arial,sans-serif;opacity:0;pointer-events:none;transition:opacity .2s;white-space:nowrap}' +
      '.r3-msg.on{opacity:1}' +
      '.r3-tip{position:absolute;pointer-events:none;z-index:3;max-width:280px;padding:8px 11px;border-radius:10px;background:rgba(17,24,39,.94);color:#fff;font:12px/1.35 system-ui,Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);opacity:0;transition:opacity .1s}' +
      '.r3-tip.on{opacity:1}.r3-tip b{display:block;font-weight:600;font-size:13px;margin-bottom:2px}.r3-tip span{opacity:.72}' +
      '.r3-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 14px system-ui,Arial,sans-serif;color:#475569;background:#E3E6EA}' +
      '.r3-cube{position:absolute;right:16px;top:16px;width:84px;height:84px;perspective:420px;cursor:pointer;user-select:none}' +
      '.r3-cube .cb{position:absolute;left:21px;top:21px;width:42px;height:42px;transform-style:preserve-3d}' +
      '.r3-cube .f{position:absolute;width:42px;height:42px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.92);border:1px solid #94A3B8;color:#334155;font:600 8.5px system-ui,Arial,sans-serif;letter-spacing:.02em;backface-visibility:hidden;transition:background .1s}' +
      '.r3-cube .f:hover{background:#BFDBFE}' +
      '.r3-lbl{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2}' +
      '.r3-hint{position:absolute;right:12px;bottom:10px;font:11px system-ui,Arial,sans-serif;color:#64748B}';
    document.head.appendChild(st);
  }

  var FACES = [
    ['Спереди', 'translateZ(21px)', [0, 0, 1]], ['Сзади', 'rotateY(180deg) translateZ(21px)', [0, 0, -1]],
    ['Справа', 'rotateY(90deg) translateZ(21px)', [1, 0, 0]], ['Слева', 'rotateY(-90deg) translateZ(21px)', [-1, 0, 0]],
    ['Сверху', 'rotateX(90deg) translateZ(21px)', [0, 1, 0]], ['Снизу', 'rotateX(-90deg) translateZ(21px)', [0, -1, 0]]
  ];

  function build(host, spec) {
    css();
    var wrap = document.createElement('div'); wrap.className = 'r3';
    wrap.innerHTML = '<div class="r3-load">Загружаю 3D-модели…</div><svg class="r3-lbl"></svg><div class="r3-cube"><div class="cb"></div></div><div class="r3-tip"></div><div class="r3-msg"></div><div class="r3-hint">Левая кнопка — вращать, правая — сдвиг, колесо — приблизить</div>';
    var cb = wrap.querySelector('.cb');
    FACES.forEach(function (f, i) {
      var d = document.createElement('div'); d.className = 'f'; d.textContent = f[0]; d.style.transform = f[1]; d.setAttribute('data-i', i); cb.appendChild(d);
    });
    S = { spec: spec, wrap: wrap, host: host, T: null, hid: {}, comps: {}, mode: false, ready: false, raf: 0, pins: {}, lhover: null };
    return loadLibs().then(function (lib) { return setup(lib); });
  }

  function setup(lib) {
    var T = lib.T, wrap = S.wrap, spec = S.spec;
    S.T = T;
    var r = new T.WebGLRenderer({ antialias: true, alpha: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    wrap.insertBefore(r.domElement, wrap.firstChild);
    var scene = new T.Scene(); scene.background = new T.Color(0xE3E6EA);
    var pm = new T.PMREMGenerator(r); scene.environment = pm.fromScene(new lib.RE(), 0.04).texture;
    var cam = new T.PerspectiveCamera(30, 1, 0.05, 60);
    var ctl = new lib.OC(cam, r.domElement); ctl.enableDamping = true; ctl.dampingFactor = 0.12; ctl.screenSpacePanning = true;
    ctl.minDistance = 0.25; ctl.maxDistance = 14;
    var sun = new T.DirectionalLight(0xffffff, 1.5); sun.position.set(-2.2, 3.2, 3.5); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.radius = 4;
    scene.add(sun); scene.add(sun.target);
    S.r = r; S.scene = scene; S.cam = cam; S.ctl = ctl; S.sun = sun; S.ray = new T.Raycaster(); S.root = new T.Group(); scene.add(S.root);
    var dl = new lib.DR(); dl.setDecoderPath(THREE_URL + 'examples/jsm/libs/draco/gltf/');
    var gl = new lib.GL(); gl.setDRACOLoader(dl);
    var jobs = spec.layers.map(function (Ly, i) {
      return new Promise(function (res) {
        gl.load(GLB_DIR + Ly.kind + '_' + Ly.key + '.glb', function (g) { res({ L: Ly, g: g }); }, null, function () { res({ L: Ly, g: null }); });
      });
    });
    // нержавеющие пресс-фитинги (угольник 90°, тройник): общие для всех стыков труб; для полипропилена остаются прежние шарики
    var fb = (window.app && window.app.state && window.app.state.brandMode === 'rommer') ? '_r' : '';
    S.fit = {};
    if (spec.mat !== 'ppr') {
      [['e', 'fitting_e90_RU'], ['t', 'fitting_tee_U']].forEach(function (f) {
        jobs.push(new Promise(function (res) { gl.load(GLB_DIR + f[1] + fb + '.glb', function (g) { S.fit[f[0]] = g.scene; res({ L: null, g: null, fit: true }); }, null, function () { res({ L: null, g: null, fit: true }); }); }));
      });
    }
    return Promise.all(jobs).then(function (rs) {
      rs = rs.filter(function (x) { return !x.fit; });
      var miss = [];
      rs.forEach(function (x) { if (!x.g) { miss.push(x.L.kind + '_' + x.L.key); return; } place(x.L, x.g.scene); });
      S.miss = miss;
      split(); pipes(); wall(); fit(true); bindUi(); S.ready = true;
      var ld = S.wrap.querySelector('.r3-load'); if (ld) ld.remove();
      if (miss.length) msg('Нет 3D-модели: ' + miss.join(', '));
      loop();
    });
  }

  // деталь узла: на своё место, заводские патрубки скрыть, детали разложить по компонентам сметы
  function place(Ly, obj) {
    var T = S.T;
    obj.position.set(Ly.off[0], Ly.off[2], 0);     // глубину не сдвигаем: на плоском виде узлы приведены в одну плоскость, а в 3D патрубки лежат на своих расстояниях от стены
    S.root.add(obj); obj.updateMatrixWorld(true);
    (S.lbox = S.lbox || {})[Ly.kind === 'dhw' && /^ex/.test(Ly.fid || '') ? 'dhw:' + Ly.fid : Ly.kind] = new T.Box3().setFromObject(obj);
    var zs = Ly.zones || [];
    var hideStub = Ly.kind === 'boiler' || (Ly.kind === 'dhw' && !/^ex/.test(Ly.fid || ''));
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      if (hideStub && STUB.test(o.name.replace(/_\d+$/, ''))) { o.visible = false; o.userData.stub = true; return; }
      o.castShadow = true; o.receiveShadow = true;
      var b = new T.Box3().setFromObject(o), c = b.getCenter(new T.Vector3());
      var lx = c.x - Ly.off[0], lz = c.y - Ly.off[2], best = null, ba = 1e9;
      zs.forEach(function (z) {
        if (lx >= z.x0 && lx <= z.x1 && lz >= z.z0 && lz <= z.z1) { var a = (z.x1 - z.x0) * (z.z1 - z.z0); if (a < ba) { ba = a; best = z; } }
      });
      var key = Ly.kind + '|' + Ly.fid + '|' + (best ? best.root : 'rest');
      o.userData.comp = key; o.userData.box = b;
      (S.comps[key] = S.comps[key] || []).push(o);
    });
  }

  // детали одного класса, лежащие рядом, — одна деталь сметы (насос, группа, кран); разнесённые — разные: прозрачность и подсветка у каждой своя
  function split() {
    var out = {};
    Object.keys(S.comps).forEach(function (key) {
      var arr = S.comps[key], par = arr.map(function (_, i) { return i; }), i, j;
      var f = function (x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (i = 0; i < arr.length; i++) for (j = i + 1; j < arr.length; j++) {
        var a = arr[i].userData.box, b = arr[j].userData.box, e = 0.03;
        if (a.min.x - e <= b.max.x && b.min.x - e <= a.max.x && a.min.y - e <= b.max.y && b.min.y - e <= a.max.y && a.min.z - e <= b.max.z && b.min.z - e <= a.max.z) par[f(i)] = f(j);
      }
      var ids = {}, n = 0;
      arr.forEach(function (o, k) {
        var r = f(k); if (ids[r] === undefined) ids[r] = n++;
        var ik = key + '#' + ids[r]; o.userData.comp = ik; (out[ik] = out[ik] || []).push(o);
      });
    });
    S.comps = out;
  }
  function compOf(k) { return k && S.spec.comps[String(k).split('#')[0]]; }
  function tint(k, on) {
    var T = S.T, arr = k && S.comps[k]; if (!arr || S.hid[k]) return;
    arr.forEach(function (o) {
      if (on) {
        if (o.userData.hm) return;
        o.userData.hm = o.material;
        var ms = (Array.isArray(o.material) ? o.material : [o.material]).map(function (m) { var c = m.clone(); c.emissive = new T.Color(0x2563EB); c.emissiveIntensity = 0.55; return c; });
        o.material = Array.isArray(o.material) ? ms : ms[0];
      } else if (o.userData.hm) { o.material = o.userData.hm; o.userData.hm = null; }
    });
  }

  // трубы системы по трассам плоского вида: горизонтали и вертикали на своей глубине от стены
  function pipes() {
    var T = S.T, spec = S.spec, ppr = spec.mat === 'ppr';
    var rad = (ppr ? 0.0125 : 0.011);
    var mat = new T.MeshStandardMaterial({ color: ppr ? 0x8CC57E : 0xC9CFD5, metalness: ppr ? 0.0 : 0.92, roughness: ppr ? 0.55 : 0.28 });
    var g = new T.Group(); g.name = 'pipes';
    var FS = 0.058, GRPS = { sup: 'h', ld: 'h', ret: 'c', lr: 'c' }, built = [], places = [], seen = {};
    var dirv = function (a, b) { return b.clone().sub(a).normalize(); };
    // первый проход: точки всех трасс; второй — где ставить фитинги (угол 90°, тройник, стык двух концов); третий — рисование труб с отступом от фитинга
    var buildPts = function (rt) {
      var zp = rt.role === 'cw' ? (rt.plane || 100) / 1000 : (ROLE_Z[rt.role] || 0.1), pp = rt.pp, n = pp.length, pts = [], V = function (i, z) { return new T.Vector3(pp[i][0] / PXM, -pp[i][1] / PXM, z); };
      var d0 = rt.d0 == null ? null : rt.d0, d1 = rt.d1 == null ? null : rt.d1;
      pts.push(V(0, d0 == null ? zp : d0));
      if (d0 != null && n > 1) { pts.push(V(1, d0)); if (Math.abs(d0 - zp) > 0.004) pts.push(V(1, zp)); } else if (n > 1) pts.push(V(1, zp));
      for (var q = 2; q < n - 1; q++) pts.push(V(q, zp));
      if (n > 2) {
        if (d1 != null) { if (Math.abs(d1 - zp) > 0.004) { pts.push(V(n - 2, zp)); } pts.push(V(n - 2, d1)); pts.push(V(n - 1, d1)); }
        else { pts.push(V(n - 2, zp)); pts.push(V(n - 1, zp)); }
      }
      return pts.filter(function (pt, i) { return i === 0 || pt.distanceTo(pts[i - 1]) > 1e-4; });
    };
    spec.routes.forEach(function (rt) { built.push({ rt: rt, pts: buildPts(rt) }); built[built.length - 1].fit = []; });
    if (S.fit && S.fit.e && S.fit.t) {
      var addPlace = function (type, P, u, v) {
        var key = type + P.x.toFixed(3) + '|' + P.y.toFixed(3) + '|' + P.z.toFixed(3);
        if (seen[key]) return; seen[key] = 1; places.push({ type: type, P: P.clone(), u: u.clone(), v: v.clone() });
      };
      var legOk = function (r, i, j) { return r.pts[i].distanceTo(r.pts[j]) >= FS * (1 + (r.fit[j] ? 1 : 0)) + 0.01; };
      built.forEach(function (r) {
        var pts = r.pts, n = pts.length;
        for (var j = 1; j < n - 1; j++) {
          var a = dirv(pts[j - 1], pts[j]), b = dirv(pts[j], pts[j + 1]);
          if (Math.abs(a.dot(b)) > 0.02) continue;
          if (pts[j].distanceTo(pts[j - 1]) < FS * (1 + (r.fit[j - 1] ? 1 : 0)) + 0.01 || pts[j].distanceTo(pts[j + 1]) < FS + 0.01) continue;
          r.fit[j] = true; addPlace('e', pts[j], a.clone().negate(), b);
        }
      });
      built.forEach(function (r) {
        var n = r.pts.length; if (n < 2) return;
        [0, n - 1].forEach(function (e) {
          if (r.fit[e]) return;
          var P = r.pts[e], nb = e === 0 ? 1 : n - 2, nd = dirv(P, r.pts[nb]);
          if (P.distanceTo(r.pts[nb]) < FS * (1 + (r.fit[nb] ? 1 : 0)) + 0.01) return;
          built.some(function (o) {
            if (o === r || GRPS[o.rt.role] !== GRPS[r.rt.role]) return false;
            var m = o.pts.length;
            // конец к концу: угольник
            for (var oe = 0; oe < 2; oe++) {
              var oi = oe ? m - 1 : 0, onb = oe ? m - 2 : 1;
              if (o.pts[oi].distanceTo(P) > 0.004 || o.fit[oi]) continue;
              var od = dirv(P, o.pts[onb]);
              if (Math.abs(nd.dot(od)) > 0.02 || P.distanceTo(o.pts[onb]) < FS * (1 + (o.fit[onb] ? 1 : 0)) + 0.01) continue;
              r.fit[e] = true; o.fit[oi] = true; addPlace('e', P, nd, od); return true;
            }
            // конец в середину чужой трубы: тройник
            for (var k = 0; k < m - 1; k++) {
              var A = o.pts[k], B = o.pts[k + 1], ab = B.clone().sub(A), L2 = ab.lengthSq(); if (L2 < 1e-8) continue;
              var t = P.clone().sub(A).dot(ab) / L2; if (t < 0.02 || t > 0.98) continue;
              var Q = A.clone().add(ab.clone().multiplyScalar(t)); if (Q.distanceTo(P) > 0.004) continue;
              var td = ab.clone().normalize(); if (Math.abs(nd.dot(td)) > 0.02) continue;
              r.fit[e] = true; addPlace('t', P, td, nd); return true;
            }
            return false;
          });
        });
      });
    }
    built.forEach(function (bt) {
      var rt = bt.rt, pts = bt.pts;
      var band = new T.MeshStandardMaterial({ color: ROLE_COL[rt.role] || 0x888888, metalness: 0.1, roughness: 0.5 });
      for (var i = 0; i < pts.length - 1; i++) {
        var a0 = pts[i], b0 = pts[i + 1], dv = dirv(a0, b0), a = a0, b = b0;
        if (a0.distanceTo(b0) < 1e-4) continue;
        (S.segs = S.segs || []).push({ role: rt.role, ri: S.spec.routes.indexOf(rt), a: a0.clone(), b: b0.clone() });
        if (bt.fit[i]) a = a0.clone().add(dv.clone().multiplyScalar(FS));      // труба входит в раструб фитинга, а не торчит сквозь изгиб
        if (bt.fit[i + 1]) b = b0.clone().sub(dv.clone().multiplyScalar(FS));
        var len = a.distanceTo(b); if (len < 1e-4 || a.clone().sub(b).dot(dv) > 0) continue;
        var cy = new T.Mesh(new T.CylinderGeometry(rad, rad, len, 20, 1), mat);
        cy.position.copy(a).add(b).multiplyScalar(0.5);
        cy.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dv);
        cy.castShadow = true; cy.receiveShadow = true; cy.userData.pipe = rt.role; g.add(cy);
        for (var d = 0.12; d < len - 0.08; d += 0.26) {          // цветные ленты-маркеры потока: красная — подача, синяя — обратка
          var ring = new T.Mesh(new T.CylinderGeometry(rad * 1.12, rad * 1.12, 0.012, 20, 1), band);
          ring.position.copy(a).add(dv.clone().multiplyScalar(d)); ring.quaternion.copy(cy.quaternion); g.add(ring);
        }
      }
      for (var j = 1; j < pts.length - 1; j++) { if (bt.fit[j]) continue; var sp = new T.Mesh(new T.SphereGeometry(rad, 20, 14), mat); sp.position.copy(pts[j]); sp.castShadow = true; g.add(sp); }
    });
    places.forEach(function (pl) {
      var o = (pl.type === 'e' ? S.fit.e : S.fit.t).clone(true), w = new T.Vector3().crossVectors(pl.u, pl.v);
      o.matrixAutoUpdate = true; o.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(pl.u, pl.v, w)); o.position.copy(pl.P);
      o.traverse(function (m) { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      g.add(o);
    });
    S.fitCount = places.length;
    S.root.add(g); S.pipeGroup = g;
  }

  // стена и пол: светло-серый фон по размеру сцены, как на кадрах
  function wall() {
    var T = S.T, b = new T.Box3().setFromObject(S.root), sz = b.getSize(new T.Vector3()), c = b.getCenter(new T.Vector3());
    var w = sz.x + 2.2, h = sz.y + 1.4;
    var wm = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshStandardMaterial({ color: 0xE9EBEE, roughness: 0.95, metalness: 0 }));
    wm.position.set(c.x, b.min.y - 0.08 + h / 2, -0.004); wm.receiveShadow = true; S.root.add(wm);
    var fl = new T.Mesh(new T.PlaneGeometry(w, 2.6), new T.MeshStandardMaterial({ color: 0xC4C8CE, roughness: 0.9, metalness: 0 }));
    fl.rotation.x = -Math.PI / 2; fl.position.set(c.x, b.min.y - 0.08, 1.3); fl.receiveShadow = true; S.root.add(fl);
    S.box = b; S.floor = fl; S.wallMesh = wm;
    S.sun.position.set(c.x - 1.6, b.max.y + 2.4, 3.2); S.sun.target.position.set(c.x, c.y, 0);
    var sc = S.sun.shadow.camera; sc.left = -w / 2; sc.right = w / 2; sc.top = h / 2 + 1; sc.bottom = -h / 2 - 1; sc.near = 0.5; sc.far = 12; sc.updateProjectionMatrix();
  }

  // камера: вид спереди по размеру сцены или сохранённый
  function fit(initial) {
    var T = S.T, b = S.box, sz = b.getSize(new T.Vector3()), c = b.getCenter(new T.Vector3());
    var sv = initial ? savedView(S.spec.sig) : null;
    var asp = Math.max(0.3, S.wrap.clientWidth / Math.max(1, S.wrap.clientHeight));
    var fov = S.cam.fov * Math.PI / 180;
    var dist = Math.max(sz.y / 2 / Math.tan(fov / 2), sz.x / 2 / (Math.tan(fov / 2) * asp)) * 1.12 + 0.3;
    S.home = { p: [c.x, c.y, dist + 0.2], t: [c.x, c.y, 0.05] };
    var v = sv || S.home;
    S.cam.position.set(v.p[0], v.p[1], v.p[2]); S.ctl.target.set(v.t[0], v.t[1], v.t[2]); S.ctl.update();
    if (sv && sv.hid) { sv.hid.forEach(function (k) { setFade(k, true); }); }
  }

  function setFade(key, on) {
    var T = S.T, arr = S.comps[key]; if (!arr) return;
    if (on) S.hid[key] = 1; else delete S.hid[key];
    arr.forEach(function (o) {
      if (on) {
        if (!o.userData.om) o.userData.om = o.material;
        var ms = (Array.isArray(o.material) ? o.material : [o.material]).map(function (m) { var c = m.clone(); c.transparent = true; c.opacity = 0.1; c.depthWrite = false; return c; });
        o.material = Array.isArray(o.material) ? ms : ms[0]; o.castShadow = false;
      } else if (o.userData.om) { o.material = o.userData.om; o.userData.om = null; o.castShadow = true; }
    });
  }

  // ── интерфейс
  function msg(t) { var m = S.wrap.querySelector('.r3-msg'); m.textContent = t; m.classList.add('on'); clearTimeout(S.mt); S.mt = setTimeout(function () { m.classList.remove('on'); }, 2600); }
  function bar() { }                       // панель значков — в окне «На весь экран» (room_view.js), здесь только сцена
  function curView() {
    var c = S.cam.position, t = S.ctl.target, rd = function (v) { return Math.round(v * 1000) / 1000; };
    return { p: [rd(c.x), rd(c.y), rd(c.z)], t: [rd(t.x), rd(t.y), rd(t.z)], hid: Object.keys(S.hid) };
  }
  function flyTo(p, t) {
    var T = S.T, p0 = S.cam.position.clone(), t0 = S.ctl.target.clone(), p1 = new T.Vector3(p[0], p[1], p[2]), t1 = new T.Vector3(t[0], t[1], t[2]), t00 = performance.now();
    (function st(n) {
      var k = Math.min(1, (n - t00) / 380), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      S.cam.position.lerpVectors(p0, p1, e); S.ctl.target.lerpVectors(t0, t1, e); S.ctl.update();
      if (k < 1) requestAnimationFrame(st);
    })(t00);
  }
  function faceView(dir) {
    var T = S.T, c = S.box.getCenter(new T.Vector3()), d = S.cam.position.distanceTo(S.ctl.target);
    flyTo([c.x + dir[0] * d, c.y + dir[1] * d + (dir[1] ? 0 : 0), c.z + dir[2] * d + (dir[2] ? 0 : 0)], [c.x, c.y, 0.05]);
  }
  function saveAll() {
    if (typeof supabaseClient === 'undefined') return Promise.resolve({ msg: 'Нет связи с базой' });
    var all = Object.assign({}, DEF || {}); all[S.spec.sig] = curView();
    var me = (A._currentUserRow && A._currentUserRow.email) || null;
    return supabaseClient.from('app_settings').upsert({ key: 'room3d_views', value: all, updated_at: new Date().toISOString(), updated_by: me }, { onConflict: 'key' })
      .then(function (r) { if (r && r.error) return { msg: 'Не сохранилось: ' + r.error.message }; DEF = all; return { msg: 'Вид сохранён для всех пользователей' }; });
  }
  // команды панели окна: прозрачность, фиксация вида (себе / всем), сброс
  function cmd(a) {
    if (!S || !S.ready) return null;
    if (a === 'fade') {
      S.mode = !S.mode;
      if (!S.mode) { Object.keys(S.hid).forEach(function (k) { setFade(k, false); }); return { msg: 'Прозрачность выключена, детали возвращены' }; }
      return { msg: 'Щёлкните по детали, чтобы сделать её прозрачной; ещё раз — вернуть' };
    }
    if (a === 'save') { lsSet('rv3d:' + S.spec.sig, curView()); return { msg: 'Вид сохранён у вас: вернётся при следующем открытии' }; }
    if (a === 'saveall') { saveAll().then(function (r) { if (S && S.onMsg) S.onMsg(r.msg); }); return { msg: 'Сохраняю вид для всех…' }; }
    if (a === 'home') { flyTo(S.home.p, S.home.t); Object.keys(S.hid).forEach(function (k) { setFade(k, false); }); try { localStorage.removeItem('rv3d:' + S.spec.sig); } catch (e) { } delete MEM[S.spec.sig]; return { msg: 'Вид сброшен' }; }
    return null;
  }
  function isFade() { return !!(S && S.mode); }

  function bindUi() {
    var wrap = S.wrap, T = S.T;
    bar();
    wrap.querySelector('.r3-cube').addEventListener('click', function (e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-i'); if (f === null || f === undefined) return;
      faceView(FACES[+f][2]);
    });
    var cvs = S.r.domElement, down = null, tip = wrap.querySelector('.r3-tip');
    cvs.addEventListener('pointerdown', function (e) { down = [e.clientX, e.clientY]; });
    var pick = function (e) {
      var rc = cvs.getBoundingClientRect();
      S.ray.setFromCamera(new T.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), S.cam);
      var hits = S.ray.intersectObject(S.root, true);
      for (var i = 0; i < hits.length; i++) { var o = hits[i].object; if (o.visible && o.userData.comp && !S.hid[o.userData.comp]) return o.userData.comp; if (o.userData.comp && S.mode) return o.userData.comp; }
      return null;
    };
    cvs.addEventListener('pointerup', function (e) {
      if (!down || Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 5) { down = null; return; }
      down = null;
      if (!S.mode) {
        if (A.state.roomViewLabels) { var k2 = pick(e), c2 = compOf(k2); if (c2) { var ck2 = String(k2).split('#')[0]; S.pins[ck2] = !S.pins[ck2]; } }
        return;
      }
      var k = pick(e); if (!k) return;
      setFade(k, !S.hid[k]);
    });
    cvs.addEventListener('pointermove', function (e) {
      var hl = !!A.state.roomViewHl, lb = !!A.state.roomViewLabels;
      if (e.buttons || (!hl && !lb)) { tip.classList.remove('on'); return; }
      var k = pick(e), c = compOf(k);
      if (lb) S.lhover = c ? String(k).split('#')[0] : null;
      if (!hl) { tip.classList.remove('on'); return; }
      if (S.hover !== k) { tint(S.hover, false); S.hover = k; if (c) tint(k, true); hlRows(c); }
      if (!c) { tip.classList.remove('on'); return; }
      var rc = wrap.getBoundingClientRect();
      tip.innerHTML = '<b>' + esc(c.t1) + '</b><span>' + esc(c.t2) + '</span>';
      tip.style.left = Math.min(e.clientX - rc.left + 14, rc.width - 290) + 'px'; tip.style.top = Math.min(e.clientY - rc.top + 14, rc.height - 70) + 'px'; tip.classList.add('on');
    });
    cvs.addEventListener('pointerleave', function () { tip.classList.remove('on'); hlRows(null); tint(S.hover, false); S.hover = null; S.lhover = null; });
    cvs.addEventListener('dblclick', function (e) { var k = pick(e), c = compOf(k); if (c && A.wmKindRows) { var rs = A.wmKindRows(c.kind, c.pk, '') || []; if (rs[0]) { if (S.wrap.classList.contains('full')) toggleFull(); rs[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); } } });
    if (typeof ResizeObserver !== 'undefined') { S.ro = new ResizeObserver(resize); S.ro.observe(wrap); }
    resize();
  }
  function hlRows(c) {
    document.querySelectorAll('tr.sg-row-hl').forEach(function (e) { e.classList.remove('sg-row-hl'); });
    if (!c || !A || !A.wmKindRows) return;
    (A.wmKindRows(c.kind, c.pk, '') || []).forEach(function (tr) { tr.classList.add('sg-row-hl'); });
  }
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function resize() {
    if (!S || !S.r) return;
    var w = S.wrap.clientWidth, h = S.wrap.clientHeight; if (!w || !h) return;
    S.r.setSize(w, h, false); S.cam.aspect = w / h; S.cam.updateProjectionMatrix();
  }
  function loop() {
    if (!S) return;
    S.raf = requestAnimationFrame(loop);
    if (!S.wrap.isConnected) return;               // вид пересобирается при каждом render(): пока блока нет в документе, не рисуем
    S.ctl.update();
    var e = S.cam.matrixWorldInverse.elements, cb = S.wrap.querySelector('.cb');
    S.cam.updateMatrixWorld();
    cb.style.transform = 'matrix3d(' + [e[0], -e[1], e[2], 0, -e[4], e[5], -e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1].join(',') + ')';
    S.r.render(S.scene, S.cam);
    labels();
  }
  // подписи позиций с линиями-выносками: якорь — центр самой крупной детали класса, проекция на экран каждый кадр
  function labels() {
    var svg = S.wrap.querySelector('.r3-lbl'); if (!svg) return;
    if (!A.state.roomViewLabels || !G.RoomLabels) { if (S.lblOn) { svg.innerHTML = ''; S.lblOn = false; } return; }
    var T = S.T, W = S.wrap.clientWidth, H = S.wrap.clientHeight, items = [];
    if (!S.anch) {
      S.anch = {};
      Object.keys(S.comps).forEach(function (ik) {
        var ck = ik.split('#')[0], c = S.spec.comps[ck]; if (!c || /\|rest$/.test(ck)) return;
        var b = new T.Box3(); S.comps[ik].forEach(function (o) { if (o.userData.box) b.union(o.userData.box); });
        var sz = b.getSize(new T.Vector3()), vol = sz.x * sz.y * sz.z;
        if (!S.anch[ck] || vol > S.anch[ck].vol) S.anch[ck] = { vol: vol, p: b.getCenter(new T.Vector3()), text: c.t1 };
      });
    }
    if (S.spec.tank && S.lbox && S.lbox.dhw && !S.anch['dhw|tank']) S.anch['dhw|tank'] = { vol: 1, p: S.lbox.dhw.getCenter(new T.Vector3()), text: S.spec.tank };
    (S.spec.exp || []).forEach(function (e) { var b = S.lbox && S.lbox['dhw:' + e.fid]; if (b && !S.anch['exp|' + e.fid]) { var cc = b.getCenter(new T.Vector3()); cc.y += (b.max.y - b.min.y) * 0.18; S.anch['exp|' + e.fid] = { vol: 1, p: cc, text: e.text }; } });
    Object.keys(S.anch).forEach(function (ck) {
      var a = S.anch[ck];
      if (!G.RoomLabels.isMajor(a.text) && ck !== S.lhover && !S.pins[ck]) return;
      var v = a.p.clone().project(S.cam);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return;
      items.push({ x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, text: a.text });
    });
    G.RoomLabels.draw(svg, items, W, H); S.lblOn = true;
  }

  // ── вход: сцена в окне «На весь экран»; при смене состава сметы собирается заново, при возврате в тот же вид камера та же
  function show(host, spec, app) {
    A = app; loadDefaults();
    if (S && S.spec.sig === spec.sig && S.ready) { S.spec = spec; host.appendChild(S.wrap); resize(); return; }
    if (S && S.building === spec.sig) { host.appendChild(S.wrap); return; }
    if (S) dispose();
    S = null;
    host.innerHTML = '';
    var p = build(host, spec);
    if (S) { S.building = spec.sig; host.appendChild(S.wrap); S.onMsg = function (t) { var m = S.wrap.querySelector('.r3-msg'); m.textContent = t; m.classList.add('on'); clearTimeout(S.mt); S.mt = setTimeout(function () { m.classList.remove('on'); }, 2600); }; }
    p.then(function () { if (S) { S.building = null; } }).catch(function (e) {
      console.warn('[3D] не собралось:', e);
      if (S && S.wrap) S.wrap.innerHTML = '<div class="r3-load">3D недоступно: ' + esc(e.message || e) + '. Откройте «Схему» или «Реалистично».</div>';
    });
  }
  function dispose() {
    if (!S) return;
    try { if (S.ready) MEM[S.spec.sig] = curView(); } catch (e) { }
    cancelAnimationFrame(S.raf); if (S.ro) S.ro.disconnect();
    try { S.r.dispose(); } catch (e) { }
    if (S.wrap.parentNode) S.wrap.remove();
    S = null;
  }
  function hide() { dispose(); }

  var LBLCTX = null;
  function textW(t) { LBLCTX = LBLCTX || document.createElement('canvas').getContext('2d'); LBLCTX.font = '500 12px system-ui, Arial, sans-serif'; return LBLCTX.measureText(t).width; }
  G.RoomLabels = {
    isMajor: function (t) { return /^(Котёл|Котел|Бойлер|Водонагревател|Накопител|Группы? насосн|Насос|Фильтр|Коллектор|Расширительн)/i.test(t) || /бойлер|водонагревател/i.test(t); },
    // items: [{x, y, text}] в пикселях области; подписи — в колонках слева и справа, линия идёт от подписи к детали
    draw: function (svg, items, W, H) {
      var GAP = 22, MG = 18, cols = [[], []], out = '';
      items.forEach(function (it) { cols[it.x < W / 2 ? 0 : 1].push(it); });
      cols.forEach(function (arr, si) {
        arr.sort(function (a, b) { return a.y - b.y; });
        var y = -1e9, i;
        arr.forEach(function (it) { it.ly = Math.max(it.y, y + GAP, 28); y = it.ly; });
        for (i = arr.length - 1; i >= 0; i--) { var lim = (i === arr.length - 1) ? H - 14 : arr[i + 1].ly - GAP; if (arr[i].ly > lim) arr[i].ly = lim; }
        arr.forEach(function (it) {
          var w = textW(it.text), tx = si === 0 ? MG : W - MG, ex = si === 0 ? tx + w + 8 : tx - w - 8, mx = si === 0 ? ex + 16 : ex - 16;
          out += '<polyline points="' + ex.toFixed(1) + ',' + it.ly.toFixed(1) + ' ' + mx.toFixed(1) + ',' + it.ly.toFixed(1) + ' ' + it.x.toFixed(1) + ',' + it.y.toFixed(1) + '" fill="none" stroke="#334155" stroke-width="1"/>' +
            '<circle cx="' + it.x.toFixed(1) + '" cy="' + it.y.toFixed(1) + '" r="2.6" fill="#fff" stroke="#334155" stroke-width="1.2"/>' +
            '<text x="' + tx.toFixed(1) + '" y="' + (it.ly + 4).toFixed(1) + '" text-anchor="' + (si === 0 ? 'start' : 'end') + '" font-size="12" font-weight="500" font-family="system-ui,Arial,sans-serif" fill="#0F172A" stroke="#E3E6EA" stroke-width="3" paint-order="stroke" stroke-linejoin="round">' + esc(it.text) + '</text>';
        });
      });
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.innerHTML = out;
    }
  };
  G.Room3D = { show: show, hide: hide, cmd: cmd, isFade: isFade, _scene: function () { return S; } };   // _scene — для проверок стыковки
})(window);
