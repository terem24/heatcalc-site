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
  // Тяжёлые модели лежат не на сайте (лимит GitHub Pages 1 ГБ), а в публичном репозитории моделей и отдаются через jsDelivr.
  // Новая выгрузка = новый тег репозитория: поднять MODELS_TAG здесь. Новые разделы (тёплый пол, радиаторы...) — новые ключи карты,
  // при нехватке места — другой репозиторий. Для проверки с диска: ?models=local (нужна папка models3d/room рядом с сайтом).
  var MODELS_TAG = 'v4';
  var MODEL_HOSTS = { room: 'https://cdn.jsdelivr.net/gh/terem24/heatcalc-models@' + MODELS_TAG + '/room/' };
  var GLB_DIR = (/[?&]models=local/.test(location.search) || /^(localhost|127.0.0.1)$/.test(location.hostname)) ? 'models3d/room/' : MODEL_HOSTS.room;     // на localhost — открытые файлы из папки сайта
  // Модели на CDN зашифрованы (AES-256-GCM: «HCM1» + 12 байт вектора + шифртекст с меткой). Ключ — app.modelKey('room'): его выдаёт база
  // только тарифу «Профи». Расшифровка в браузере; открытый файл (glTF, режим ?models=local) читается как есть.
  var KEYS = {};
  // Ключ берётся из базы (Supabase). На мобильном интернете база бывает недоступна или отвечает минутами — тогда вид оставался
  // без оборудования. Поэтому: ожидание ограничено 12 с, а полученный ключ помнится на этом устройстве 3 дня (без обращения к базе).
  var KEY_TTL = 3 * 24 * 3600 * 1000;
  function keyCached(name) { try { var o = JSON.parse(localStorage.getItem('hc_mk_' + name)); return o && o.k && Date.now() - o.t < KEY_TTL ? o.k : null; } catch (e) { return null; } }
  function keyStore(name, hex) { try { localStorage.setItem('hc_mk_' + name, JSON.stringify({ k: hex, t: Date.now() })); } catch (e) { } }
  function cryptoKey(name) {
    if (!KEYS[name]) {
      var hit = keyCached(name);
      var src = hit ? Promise.resolve(hit) : Promise.race([
        Promise.resolve(window.app && window.app.modelKey ? window.app.modelKey(name) : Promise.reject(new Error('нет приложения'))),
        new Promise(function (_, rej) { setTimeout(function () { rej(new Error('база не ответила за 12 с')); }, 12000); })
      ]).then(function (hex) { keyStore(name, hex); return hex; });
      KEYS[name] = src.then(function (hex) {
        var raw = new Uint8Array(hex.match(/../g).map(function (h) { return parseInt(h, 16); }));
        return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
      }).catch(function (e) { delete KEYS[name]; throw e; });
    }
    return KEYS[name];
  }
  // Байты моделей начинают качаться сразу при открытии вида, параллельно с библиотекой three (раньше — только после неё: цепочка
  // «библиотека → модели → фитинги» шла строго по очереди). Результат лежит в PRE, loadGlb забирает его оттуда.
  var PRE = {};
  function fetchBytes(url) {
    if (!PRE[url]) {
      PRE[url] = fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
      PRE[url].catch(function () { delete PRE[url]; });
    }
    return PRE[url];
  }
  function loadGlb(gl, url, ok, err) {
    fetchBytes(url).then(function (buf) {
      delete PRE[url];                                                  // повторно из памяти не отдаём: дальше работает кэш браузера
      var h = new Uint8Array(buf, 0, 4);
      if (h[0] === 0x67 && h[1] === 0x6c && h[2] === 0x54 && h[3] === 0x46) return buf;                  // «glTF» — открытый файл
      if (h[0] !== 0x48 || h[1] !== 0x43 || h[2] !== 0x4d || h[3] !== 0x31) throw new Error('неизвестный формат модели');
      return cryptoKey('room').then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(buf, 4, 12) }, k, new Uint8Array(buf, 16)); });
    }).then(function (buf) { gl.parse(buf, '', ok, err); }).catch(function (e) { if (err) err(e); });
  }
  var GLB_V = 11;                          // версия моделей: поднимать при перевыгрузке GLB, иначе у тех, у кого вид уже открывали, останутся старые
  var PXM = 1500;
  var STUB = /^(труба|лежак|транзит|подающая труба|медная труба|выпуск)/;   // заводские патрубки: трубу системы ведём от порта сами
  var ROLE_Z = { sup: 0.19, ret: 0.16, ld: 0.05, lr: 0.16 };   // глубины труб от стены; разница с глубиной патрубка узла обязана быть 0 или не меньше 28 мм (пара 45° не встаёт в меньший сдвиг, труба осталась бы изогнутой без фитинга): патрубки узлов 81 и 107 мм дают 31 и 53 мм; обратка на 160 мм — глубина портов коллектора, труба входит в порт без сдвига
  var ROLE_COL = { cw: 0x0891B2, sup: 0xE53935, ret: 0x1E88E5, ld: 0xF57C00, lr: 0x1E88E5 };
  var L = null, loading = null;      // библиотеки
  var S = null;                      // живая сцена (одна на страницу)
  var A = null;
  var DEF = null, defLoading = false;   // виды по умолчанию, заданные администратором (app_settings.room3d_views)
  var SNAP = null;                   // последний кадр прежней сцены: на время пересборки лежит поверх новой, чтобы картинка не пропадала
  var KEEP = { cov: 0 };             // состояние теплоизоляции групп между пересборками сцены: 0 — закрыта, 1 — крышки сняты, 2 — сняты и задние половины

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
    // все файлы библиотеки качаются одновременно (текст), правка адресов и подключение — после
    var P = function (p) { return fetch(THREE_URL + p).then(function (r) { if (!r.ok) throw new Error('библиотека 3D не скачалась (' + r.status + ')'); return r.text(); }); };
    var blob = function (t) { return URL.createObjectURL(new Blob([t], { type: 'text/javascript' })); };
    loading = Promise.all([
      P('build/three.module.js'), P('examples/jsm/utils/BufferGeometryUtils.js'), P('examples/jsm/controls/OrbitControls.js'),
      P('examples/jsm/loaders/GLTFLoader.js'), P('examples/jsm/loaders/DRACOLoader.js'), P('examples/jsm/environments/RoomEnvironment.js')
    ]).then(function (tx) {
      var threeUrl = blob(tx[0]);
      var fx = function (t) { return t.replace(/from\s+['"]three['"]/g, "from '" + threeUrl + "'"); };
      var bgu = blob(fx(tx[1]));
      var fg = function (t) { return fx(t).replace(/from\s+['"]\.\.\/utils\/BufferGeometryUtils\.js['"]/g, "from '" + bgu + "'"); };
      return Promise.all([
        import(threeUrl), import(blob(fx(tx[2]))), import(blob(fg(tx[3]))), import(blob(fx(tx[4]))), import(blob(fx(tx[5])))
      ]);
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
      '.r3{position:relative;width:100%;height:100%;background:#fff;overflow:hidden;border-radius:14px;touch-action:none}' +
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
      '.r3-load{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;font:500 14px system-ui,Arial,sans-serif;color:#475569;background:#fff}' +
      '.r3-load img,.r3-busy img{width:44px;height:44px;object-fit:contain;animation:r3pulse 1.6s ease-in-out infinite}' +
      '@keyframes r3pulse{0%,100%{transform:scale(.88);opacity:.55}50%{transform:scale(1);opacity:1}}' +
      /* пересборка сцены (замена оборудования, поворот бойлера): прежний кадр остаётся на экране, поверх — маленький значок загрузки, без мигания */
      '.r3 canvas.r3-snap{position:absolute;inset:0;z-index:1;transition:opacity .35s ease-out;pointer-events:none}' +
      '.r3-busy{position:absolute;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:8;display:flex;align-items:center;gap:8px;padding:6px 14px 6px 8px;border-radius:99px;background:rgba(15,23,42,.88);color:#fff;font:12.5px system-ui,Arial,sans-serif;pointer-events:none}' +
      '.r3-busy img{width:26px;height:26px}' +
      '.r3-cube{position:absolute;z-index:2;right:16px;top:16px;width:84px;height:84px;perspective:420px;cursor:pointer;user-select:none}' +
      '.r3-cube .cb{position:absolute;left:21px;top:21px;width:42px;height:42px;transform-style:preserve-3d}' +
      '.r3-cube .f{position:absolute;width:42px;height:42px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.92);border:1px solid #94A3B8;color:#334155;font:600 8.5px system-ui,Arial,sans-serif;letter-spacing:.02em;backface-visibility:hidden;transition:background .1s}' +
      '.r3-cube .f:hover{background:#BFDBFE}' +
      '.r3-lbl{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2}' +
      '.r3-hint{position:absolute;right:12px;bottom:10px;font:11px system-ui,Arial,sans-serif;color:#64748B}' +
      '.r3-pk{position:absolute;z-index:4;transform:translate(-50%,0);min-width:120px;max-width:170px;text-align:center;padding:7px 10px;border-radius:11px;background:rgba(255,255,255,.92);color:#0F172A;font:12px/1.3 system-ui,Arial,sans-serif;box-shadow:0 4px 16px rgba(15,23,42,.2);cursor:pointer;transition:background .15s,transform .15s}' +
      '.r3-pk b{display:block;font-weight:600;font-size:12px}.r3-pk span{display:block;opacity:.7;margin-top:1px}.r3-pk i{display:inline-block;margin:4px 2px 0;padding:1px 9px;border-radius:99px;background:#2563EB;color:#fff;font-style:normal;font-size:11px}' +
      '.r3-pk.cur i{background:#16A34A}.r3-pk.hv{background:#fff;transform:translate(-50%,0) scale(1.06)}' +
      '.r3-pkbar{position:absolute;top:70px;left:50%;transform:translateX(-50%);z-index:5;display:flex;align-items:center;gap:12px;padding:8px 14px;border-radius:12px;background:rgba(15,23,42,.88);color:#fff;font:13px system-ui,Arial,sans-serif}' +
      '.r3-pkbar button{border:0;border-radius:8px;padding:5px 12px;background:rgba(255,255,255,.16);color:#fff;font:12px system-ui,Arial,sans-serif;cursor:pointer}.r3-pkbar button:hover{background:rgba(255,255,255,.28)}' +
      '.r3-chk{position:absolute;z-index:5;left:12px;top:70px;max-width:340px;padding:8px 10px;border-radius:12px;background:rgba(15,23,42,.9);color:#fff;font:12px system-ui,Arial,sans-serif;box-shadow:0 4px 16px rgba(15,23,42,.3)}' +
      '.r3-chk b{display:block;margin-bottom:4px;font-size:13px}.r3-chk div{padding:2px 0 2px 14px;position:relative}.r3-chk div:before{content:"";position:absolute;left:2px;top:7px;width:8px;height:8px;border-radius:50%}.r3-chk .bad:before{background:#EF4444}.r3-chk .free:before{background:#F59E0B}' +
      '.r3-tg{position:absolute;z-index:5;transform:translate(-50%,-100%);display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:12px;background:rgba(15,23,42,.9);color:#fff;font:12px system-ui,Arial,sans-serif;box-shadow:0 4px 16px rgba(15,23,42,.3)}' +
      '.r3-tg button{width:32px;height:32px;border:0;border-radius:9px;background:#2563EB;color:#fff;font-size:18px;line-height:1;cursor:pointer}.r3-tg button:hover{background:#1D4ED8}' +
      '.r3-msg{max-width:calc(100% - 24px);white-space:normal;text-align:center}' +
      /* телефон: панель значков в окне занимает верхние ~60 px, куб ракурсов и плашки опускаются под неё, плашки выбора насоса компактнее */
      '@media (max-width:700px){' +
      '.r3-cube{top:104px;right:8px;width:68px;height:68px;perspective:340px}.r3-cube .cb{left:13px;top:13px}' +
      '.r3-pkbar{top:104px;left:8px;right:84px;transform:none;gap:8px;padding:7px 10px;font-size:12.5px}.r3-pkbar span{flex:1;min-width:0}' +
      '.r3-chk{left:8px;top:104px;right:84px;max-width:none}' +
      '.r3-pk{min-width:104px;max-width:148px;padding:6px 8px;font-size:11.5px}.r3-pk i{padding:3px 10px;margin:3px 2px 0;font-size:11px}' +
      '.r3-tg{max-width:calc(100% - 16px)}' +
      '.r3-hint{display:none}' +
      '}';
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
    var snap = SNAP; SNAP = null;
    var LOGO = '<img src="img/logo_hc_flame.png" alt="">';
    // первая загрузка — полноэкранная заставка с логотипом; пересборка поверх готового вида — прежний кадр и значок в углу, картинка не пропадает
    wrap.innerHTML = (snap ? '<div class="r3-busy">' + LOGO + '<span>Обновляю 3D…</span></div>' : '<div class="r3-load">' + LOGO + '<span>Загружаю 3D-модели…</span></div>') +
      '<svg class="r3-lbl"></svg><div class="r3-cube"><div class="cb"></div></div><div class="r3-tip"></div><div class="r3-msg"></div><div class="r3-hint">Левая кнопка — вращать, зажатое колесо или правая — сдвиг, прокрутка колеса — приблизить</div>';
    if (snap) { snap.className = 'r3-snap'; wrap.appendChild(snap); }
    try { if (window.matchMedia && matchMedia('(pointer:coarse)').matches) wrap.querySelector('.r3-hint').textContent = 'Один палец — вращать, два — сдвиг и приближение'; } catch (e) { }
    var cb = wrap.querySelector('.cb');
    FACES.forEach(function (f, i) {
      var d = document.createElement('div'); d.className = 'f'; d.textContent = f[0]; d.style.transform = f[1]; d.setAttribute('data-i', i); cb.appendChild(d);
    });
    S = { spec: spec, wrap: wrap, host: host, T: null, hid: {}, comps: {}, mode: false, ready: false, raf: 0, pins: {}, lhover: null, coversOpen: KEEP.cov > 0, backOff: KEEP.cov > 1 };
    // модели и ключ расшифровки качаются параллельно с библиотекой; ошибки здесь глотаем — их покажет сама загрузка в setup
    try {
      spec.layers.forEach(function (Ly) { fetchBytes(GLB_DIR + Ly.kind + '_' + Ly.key + '.glb?v=' + GLB_V).catch(function () { }); });
      cryptoKey('room').catch(function () { });
    } catch (e) { }
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
    var scene = new T.Scene(); scene.background = new T.Color(bgNow());
    var pm = new T.PMREMGenerator(r); scene.environment = pm.fromScene(new lib.RE(), 0.04).texture;
    var cam = new T.PerspectiveCamera(30, 1, 0.05, 60);
    var ctl = new lib.OC(cam, r.domElement); ctl.enableDamping = true; ctl.dampingFactor = 0.12; ctl.screenSpacePanning = true;
    ctl.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_PAN };      // палец — вращать, два пальца — приблизить и сдвинуть
    // как в Revit: зажатое колесо — сдвиг (листать влево-вправо, вверх-вниз), правая тоже сдвиг, колесо крутится — зум
    ctl.mouseButtons = { LEFT: 0, MIDDLE: 2, RIGHT: 2 };
    r.domElement.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });   // без значка автопрокрутки браузера
    r.domElement.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });
    ctl.minDistance = 0.25; ctl.maxDistance = 14;
    var sun = new T.DirectionalLight(0xffffff, 1.5); sun.position.set(-2.2, 3.2, 3.5); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.012; sun.shadow.radius = 4;
    scene.add(sun); scene.add(sun.target);
    S.r = r; S.scene = scene; S.cam = cam; S.ctl = ctl; S.sun = sun; S.ray = new T.Raycaster(); S.root = new T.Group(); scene.add(S.root);
    var dl = new lib.DR(); dl.setDecoderPath(THREE_URL + 'examples/jsm/libs/draco/gltf/');
    var gl = new lib.GL(); gl.setDRACOLoader(dl); S.gl = gl;
    var jobs = spec.layers.map(function (Ly, i) {
      return new Promise(function (res) {
        loadGlb(gl, GLB_DIR + Ly.kind + '_' + Ly.key + '.glb?v=' + GLB_V, function (g) { res({ L: Ly, g: g }); }, function (e) { console.warn('[3D] модель не загрузилась:', Ly.kind + '_' + Ly.key, e && e.message || e); S.why = S.why || String(e && e.message || e); res({ L: Ly, g: null }); });
      });
    });
    // нержавеющие пресс-фитинги по плану труб: угольники, тройники, муфты нужных размеров (room_fit.js); для других систем остаются шарики
    var fb = (window.app && window.app.state && window.app.state.brandMode === 'rommer') ? '_r' : '';
    S.fit = {};
    return Promise.all(jobs).then(function (rs) {
      var miss = [];
      rs.forEach(function (x) { if (!x.g) { miss.push(x.L.kind + '_' + x.L.key); return; } place(x.L, x.g.scene); });
      S.miss = miss;
      // порты узлов (устья с резьбой) известны только после загрузки моделей: по ним труба получает переходник на резьбу, а проверка — места стыка
      S.mouths = collectMouths();
      S.plan = planPipes(spec, T, S.mouths);
      S.bad = spec.rot ? violations(S.plan, T) : [];          // проверка сборки новых труб бойлера: пересечения, углы без фитинга, нехватка прямого участка
      if (S.bad.length) console.warn('[3D] поворот бойлера не собирается:', S.bad.map(function (v) { return v.t + ' ' + (v.msg || ''); }));
      var keys = {}, fj = []; S.plan.places.forEach(function (pl) { keys[pl.key] = 1; });
      Object.keys(keys).forEach(function (k) {
        fj.push(new Promise(function (res) { loadGlb(gl, GLB_DIR + 'fitting_' + k + fb + '.glb', function (g) { S.fit[k] = g.scene; res(); }, function () { res(); }); }));
      });
      return Promise.all(fj);
    }).then(function () {
      var miss = S.miss;
      split(); applyTankRot(); pipes(); wall(); fit(true); bindUi(); S.ready = true; applyPumps();
      var ld = S.wrap.querySelector('.r3-load'); if (ld) ld.remove();
      if (miss.length) { msg('Нет 3D-модели: ' + miss.join(', ')); failBanner(miss.length === S.spec.layers.length ? 'Оборудование не загрузилось' : 'Часть оборудования не загрузилась'); }
      loop();
      // прежний кадр уходит плавно, когда новый уже нарисован (первый кадр — в следующем rAF)
      var sn = S.wrap.querySelector('.r3-snap'), bz = S.wrap.querySelector('.r3-busy');
      if (sn || bz) requestAnimationFrame(function () { requestAnimationFrame(function () {
        if (sn) { sn.style.opacity = '0'; setTimeout(function () { sn.remove(); }, 420); }
        if (bz) bz.remove();
      }); });
    });
  }

  // порты узлов: устья резьбовых гнёзд «устье_<размер>[_ВР|НР]» из моделей (tools/render_*_node.py); размер без указания — G3/4
  // (сепаратор). Положение — центр устья в мире; направление трубы берётся по самой трубе
  function collectMouths() {
    var T = S.T, out = [];
    S.root.updateMatrixWorld(true);
    S.root.traverse(function (o) {
      if (!o.isMesh || !/^устье/.test(o.name)) return;
      var m = /^устье_?(\d+?)?(?:_(ВР|НР))?(\d{3})?$/.exec(o.name); if (!m) return;
      var b = new T.Box3().setFromObject(o), c = b.getCenter(new T.Vector3());
      out.push({ P: c, size: m[1] || '34', male: m[2] === 'НР', used: false, name: o.name });
    });
    return out;
  }
  var THR_TXT = { '12': '1/2"', '34': '3/4"', '1': '1"', '114': '1 1/4"', '112': '1 1/2"' };
  var ADP_OK = {};
  [[22, '1', 'M'], [22, '34', 'M'], [22, '34', 'F'], [22, '12', 'M'], [22, '12', 'F'], [28, '1', 'M'], [28, '1', 'F'], [28, '34', 'M'], [28, '34', 'F'],
   [35, '1', 'M'], [35, '1', 'F'], [35, '114', 'M'], [35, '114', 'F'], [42, '112', 'M'], [42, '112', 'F']].forEach(function (a) { ADP_OK['adp_' + a[0] + 'x' + a[1] + '_' + a[2]] = 1; });

  // деталь узла: на своё место, заводские патрубки скрыть, детали разложить по компонентам сметы
  function place(Ly, obj) {
    var T = S.T, host = obj;
    if (Ly.kind === 'dhw' && Ly.fid === 'w0' && Ly.piv) {
      // бойлер на поворотной оси: вертикаль через центр корпуса (в модели x = 0, глубина = радиус + 50 мм от стены), сдвиг по глубине dz
      var pivot = new T.Group(); pivot.position.set(0, 0, Ly.piv); obj.position.set(0, 0, -Ly.piv); pivot.add(obj);
      var hold = new T.Group(); hold.position.set(Ly.off[0], Ly.off[2] + (Ly.dy || 0), Ly.dz || 0); hold.add(pivot);
      S.tankPivot = pivot; S.tankHold = hold; host = hold;
    } else obj.position.set(Ly.off[0], Ly.off[2], 0);     // глубину не сдвигаем: на плоском виде узлы приведены в одну плоскость, а в 3D патрубки лежат на своих расстояниях от стены
    S.root.add(host); host.updateMatrixWorld(true);
    (S.lbox = S.lbox || {})[Ly.kind === 'dhw' && /^ex/.test(Ly.fid || '') ? 'dhw:' + Ly.fid : Ly.kind] = new T.Box3().setFromObject(host);
    var zs = Ly.zones || [];
    var hideStub = Ly.kind === 'boiler' || (Ly.kind === 'dhw' && !/^ex/.test(Ly.fid || ''));
    obj.traverse(function (o) {
      if (!o.isMesh) { if (/^port_/.test(o.name)) (S.ports = S.ports || []).push(o); return; }       // метки патрубков бойлера для подписей: идут вместе с корпусом при повороте
      if (hideStub && STUB.test(o.name.replace(/_\d+$/, ''))) { o.visible = false; o.userData.stub = true; return; }
      o.castShadow = true; o.receiveShadow = true;
      // передняя крышка теплоизоляции группы: закрыта по умолчанию, не часть компонентов сметы (щёлкается отдельно)
      if (/^(крышка[_ ]группы|наклейка[_ ]STOUT[_ ]на[_ ]крышке|плашка[_ ]ROMMER[_ ]на[_ ]крышке)/.test(o.name.replace(/_?\d+$/, ''))) { o.userData.cover = Ly.fid; (S.covers = S.covers || []).push(o); o.visible = !S.coversOpen; return; }
      // задняя половина теплоизоляции группы (задняя стенка, боковины, дно, верх): снимается отдельно от крышки, вторым щелчком / вторым нажатием кнопки.
      // Материал свой, со сдвигом глубины назад: на стыках с крышкой и подложкой поверхности лежат в долях миллиметра друг от друга и мерцали
      if (Ly.kind === 'hydro' && /^кожух[_ ](задняя[_ ]стенка|боковая[_ ]стенка|верх|дно)/.test(o.name.replace(/_?\d+$/, ''))) {
        o.userData.shell = Ly.fid; (S.shells = S.shells || []).push(o); o.visible = !S.backOff;
        var shm = (Array.isArray(o.material) ? o.material : [o.material]).map(function (m) { var c = m.clone(); c.polygonOffset = true; c.polygonOffsetFactor = 1; c.polygonOffsetUnits = 1; return c; });
        o.material = Array.isArray(o.material) ? shm : shm[0];
      }
      // сервопривод и его ручка стоят под крышкой группы: при закрытой крышке не видны (syncServos), открылась — появились
      if (Ly.kind === 'hydro' && /^(сервопривод|ручка|указатель|значок[_ ]|точка[_ ]|окошко)/.test(o.name.replace(/_?\d+$/, ''))) { o.userData.servo = Ly.fid; (S.servos = S.servos || []).push(o); }
      // наклейки (логотипы, экраны, шкалы) — прозрачные плоскости в доле миллиметра над корпусом: без тени и со смещением глубины, иначе мерцают
      var m0 = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m0 && m0.transparent && m0.map) { o.castShadow = false; m0.depthWrite = false; m0.polygonOffset = true; m0.polygonOffsetFactor = -2; m0.polygonOffsetUnits = -2; }
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
  function psys(m) { return (window.RoomPipe && window.RoomPipe.sys(m)) || { od: 22, k: m === 'ppr' ? 'ppr' : 'ss' }; }

  // ── план труб и фитингов. Без моделей: нужен заранее, чтобы знать, какие glb загружать.
  // Размеры деталей и правила стыка — room_fit.js (паспорт ROMMER): угольник 90° в углу трубы, пара угольников 45° при смещении по глубине,
  // переходной тройник на отводе другого размера, угольник меньшего размера и переходные муфты при стыке разных размеров.
  var GRPS = { sup: 'h', ld: 'h', ret: 'c', lr: 'c' };
  function planPipes(spec, T, mouths) {
    var PS = psys(spec.mat), steel = PS.k === 'ss' && !!window.RoomFit, built = [], places = [], seen = {}, RF = window.RoomFit, MMV = 0.001;
    var dirv = function (a, b) { return b.clone().sub(a).normalize(); };
    var perp = function (u) { var v = new T.Vector3().crossVectors(u, Math.abs(u.x) < 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0)); return v.normalize(); };
    // точки трассы: первый и последний участки лежат на глубине патрубка (d0, d1), остальное — на глубине своей роли;
    // переход по глубине — в ближайшем к патрубку углу, так что труба входит в патрубок строго по его оси
    var buildPts = function (rt) {
      if (rt.p3) return rt.p3.map(function (q) { return new T.Vector3(q[0], q[1], q[2]); });
      var zp = rt.role === 'cw' ? (rt.plane || 100) / 1000 : (ROLE_Z[rt.role] || 0.1), pp = rt.pp, n = pp.length, pts = [], V = function (i, z) { return new T.Vector3(pp[i][0] / PXM, -pp[i][1] / PXM, z); };
      var d0 = rt.d0 == null ? null : rt.d0, d1 = rt.d1 == null ? null : rt.d1;
      pts.push(V(0, d0 == null ? zp : d0));
      if (n === 2) {
        // труба из двух точек с портами на другой глубине: ступень (пара 45°) делается не на самом конце, а в 5 см от него по трубе,
        // чтобы было где встать угольникам; без этого труба промахивалась мимо порта на разницу глубин
        var L2 = Math.hypot(pp[1][0] - pp[0][0], pp[1][1] - pp[0][1]) / PXM, ux = (pp[1][0] - pp[0][0]) / PXM / (L2 || 1), uy = -(pp[1][1] - pp[0][1]) / PXM / (L2 || 1);
        var W = function (k, z) { return new T.Vector3(pp[0][0] / PXM + ux * k, -pp[0][1] / PXM + uy * k, z); };
        var s0 = Math.min(0.05, L2 / 3);
        if (d0 != null && Math.abs(d0 - zp) > 0.004) { pts[0] = W(0, d0); pts.push(W(s0, d0)); pts.push(W(s0, zp)); } else pts[0] = W(0, zp);
        if (d1 != null && Math.abs(d1 - zp) > 0.004) { pts.push(W(L2 - s0, zp)); pts.push(W(L2 - s0, d1)); pts.push(W(L2, d1)); } else pts.push(W(L2, d1 != null ? d1 : zp));
        return pts.filter(function (pt, i) { return i === 0 || pt.distanceTo(pts[i - 1]) > 1e-4; });
      }
      if (d0 != null && n > 1) { pts.push(V(1, d0)); if (Math.abs(d0 - zp) > 0.004) pts.push(V(1, zp)); } else if (n > 1) pts.push(V(1, zp));
      for (var q = 2; q < n - 1; q++) pts.push(V(q, zp));
      if (n > 2) {
        if (d1 != null) { if (Math.abs(d1 - zp) > 0.004) { pts.push(V(n - 2, zp)); } pts.push(V(n - 2, d1)); pts.push(V(n - 1, d1)); }
        else { pts.push(V(n - 2, zp)); pts.push(V(n - 1, zp)); }
      }
      return pts.filter(function (pt, i) { return i === 0 || pt.distanceTo(pts[i - 1]) > 1e-4; });
    };
    // трасса, которая доходит до конца магистрали и возвращается по ней назад к ответвлению, — на деле две трубы: магистраль и ответвление от её середины
    // (на плоском виде это одна ломаная, а в 3D возврат ложился бы трубой на трубу и давал угол без фитинга); ответвление встаёт на тройник
    (function () {
      var out = [];
      spec.routes.forEach(function (rt) {
        if (rt.p3 || !rt.pp || rt.pp.length < 4) { out.push(rt); return; }
        var cut = -1, i;
        for (i = 1; i < rt.pp.length - 1 && cut < 0; i++) {
          var a = rt.pp[i - 1], b = rt.pp[i], c = rt.pp[i + 1], x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - b[0], y2 = c[1] - b[1];
          if (Math.abs(x1 * y2 - y1 * x2) < 1e-6 * (Math.hypot(x1, y1) * Math.hypot(x2, y2) + 1) && x1 * x2 + y1 * y2 < 0) cut = i;
        }
        if (cut < 0) { out.push(rt); return; }
        var r1 = {}, r2 = {};
        Object.keys(rt).forEach(function (q) { r1[q] = rt[q]; r2[q] = rt[q]; });
        r1.pp = rt.pp.slice(0, cut + 1); r1.d1 = null;
        r2.pp = rt.pp.slice(cut + 1); r2.d0 = null;
        out.push(r1, r2);
      });
      spec.routes = out;
    })();
    spec.routes.forEach(function (rt) { var od = rt.od || PS.od; built.push({ rt: rt, pts: buildPts(rt), cut: [], rad: od / 2000, s: od, ok: steel && RF.ok(od) }); });
    var put = function (key, P, u, v, tag) {
      var k = key + '|' + P.x.toFixed(3) + '|' + P.y.toFixed(3) + '|' + P.z.toFixed(3) + (tag || '');
      if (seen[k]) return; seen[k] = 1; places.push({ key: key, P: P.clone(), u: u.clone(), v: v.clone() });
    };
    // муфты на плече: от торца раструба узла наружу по направлению dir, большой раструб — к узлу или от него
    var putArm = function (P, dir, tip, cps) {
      cps.forEach(function (c) {
        var cen = tip + c.from + c.len / 2, u = c.bigOut ? dir : dir.clone().negate();
        put(c.key, P.clone().add(dir.clone().multiplyScalar(cen * MMV)), u, perp(u), '#' + cen);
      });
    };
    var cutAt = function (r, i) { return r.cut[i] || 0; };
    if (steel) {
      // 1) смещение по глубине: пара угольников 45° вместо ножки под 90°
      built.forEach(function (r) {
        if (!r.ok || r.rt.p3) return;                      // трассы повёрнутого бойлера уже с готовыми углами: заход на патрубок по его оси, а не косой отвод
        var e45 = RF.e45(r.s), c45 = e45.cut * MMV, c90 = RF.elbow(r.s, r.s).armA.cut * MMV, pts = r.pts, i = 1, guard = 0;
        while (i < pts.length - 1 && guard++ < 20) {
          var P = pts[i], Q = pts[i + 1], dl = Q.clone().sub(P), D = Math.abs(dl.z), hasB = i + 2 < pts.length;
          if (D < (2 * c45 + 0.01) / Math.SQRT2 || Math.abs(dl.x) + Math.abs(dl.y) > 0.002) { i++; continue; }
          var ad = dirv(pts[i - 1], P), bd = hasB ? dirv(Q, pts[i + 2]) : null;
          if (Math.abs(ad.z) > 0.02 || (bd && Math.abs(bd.z) > 0.02)) { i++; continue; }
          var perpC = bd ? Math.abs(ad.dot(bd)) < 0.02 : true, s0 = perpC ? c90 + c45 + 0.01 : c45 + 0.02, tail = c45 + c90 + 0.01;
          var Lb = hasB ? Q.distanceTo(pts[i + 2]) : 0, La = P.distanceTo(pts[i - 1]), J1, J2;
          // пара 45° со своим диагональным отрезком не должна ложиться на чужую трубу или фитинг: сдвигаем её вдоль участка шагом 10 мм,
          // пока диагональ и оба угольника не освободятся (труба не пересекает фитинг и другую трубу, сборка физически возможна)
          var jogTry = function (after, off) {
            var a1, a2;
            if (after) { a1 = P.clone().add(bd.clone().multiplyScalar(s0 + off)); a2 = Q.clone().add(bd.clone().multiplyScalar(s0 + D + off)); }
            else { a1 = P.clone().sub(ad.clone().multiplyScalar(s0 + D + off)); a2 = Q.clone().sub(ad.clone().multiplyScalar(s0 + off)); }
            return [a1, a2];
          };
          // участки трубы по обе стороны пары (до первого угольника и после второго) тоже не должны ложиться на чужую трубу: стояк на другой глубине
          // проходит мимо магистрали с зазором не меньше 6 мм между стенками, иначе пару надо увести за магистраль
          var jogLegs = function (after, jj) {
            return after ? [[P, jj[0]], [jj[1], hasB ? pts[i + 2] : jj[1]]] : [[pts[i - 1], jj[0]], [jj[1], Q]];
          };
          var legFree = function (A, B) {
            if (A.distanceTo(B) < 1e-4) return true;
            return built.every(function (o) {
              if (o === r) return true;
              for (var kq = 0; kq < o.pts.length - 1; kq++) {
                var C1 = o.pts[kq], C2 = o.pts[kq + 1];
                if (ptSeg(A, C1, C2) < 0.012 || ptSeg(B, C1, C2) < 0.012 || ptSeg(C1, A, B) < 0.012 || ptSeg(C2, A, B) < 0.012) continue;      // стык
                if (segDist(A, B, C1, C2) < r.rad + o.rad + 0.006) return false;
              }
              return true;
            });
          };
          var jogFree = function (a1, a2, legs) {
            return built.every(function (o) {
              if (o === r) return true;
              for (var kq = 0; kq < o.pts.length - 1; kq++) {
                var C1 = o.pts[kq], C2 = o.pts[kq + 1];
                if (segDist(a1, a2, C1, C2) < r.rad + o.rad + 0.012) return false;
                if (ptSeg(a1, C1, C2) < o.rad + 0.019 || ptSeg(a2, C1, C2) < o.rad + 0.019) return false;      // корпус пресс-фитинга 22 — радиус около 17 мм
              }
              return true;
            }) && legs.every(function (lg) { return legFree(lg[0], lg[1]); });
          };
          var pickJog = function (after, room) {
            for (var off = 0; off <= room; off += 0.01) { var jj = jogTry(after, off); if (jogFree(jj[0], jj[1], jogLegs(after, jj))) return jj; }
            return null;
          };
          var jg = null, jAfter = false;
          if (hasB && Lb >= s0 + D + tail) { jg = pickJog(true, Lb - (s0 + D + tail)); jAfter = !!jg; }
          if (!jg && La >= s0 + D + tail) jg = pickJog(false, La - (s0 + D + tail));
          if (!jg && hasB && Lb >= s0 + D + tail) { jg = jogTry(true, 0); jAfter = true; }      // свободного места нет: ставим как раньше, проверка сборки покажет нарушение
          else if (!jg && La >= s0 + D + tail) jg = jogTry(false, 0);
          if (jg) {
            J1 = jg[0]; J2 = jg[1];
            if (jAfter) pts.splice(i + 1, 1, J1, J2); else pts.splice(i, 1, J1, J2);
            J1.jg = 1; J2.jg = 2; i += 3;
          } else i++;
        }
        pts.forEach(function (p, k) { if (p.jg) r.cut[k] = c45; });
        pts.forEach(function (p, k) {
          if (p.jg !== 1) return;
          var J1p = pts[k], J2p = pts[k + 1];
          put(e45.key, J1p, dirv(J1p, pts[k - 1]), dirv(J1p, J2p), 'a');
          put(e45.key, J2p, dirv(J2p, J1p), dirv(J2p, pts[k + 2]), 'b');
        });
      });
      // 2) углы внутри трассы: угольник 90° размера трубы
      built.forEach(function (r) {
        if (!r.ok) return;
        var el = RF.elbow(r.s, r.s), c = el.armA.cut * MMV, pts = r.pts, n = pts.length;
        for (var j = 1; j < n - 1; j++) {
          if (r.cut[j]) continue;
          var a = dirv(pts[j - 1], pts[j]), b = dirv(pts[j], pts[j + 1]);
          if (Math.abs(a.dot(b)) > 0.02) continue;
          if (pts[j].distanceTo(pts[j - 1]) < cutAt(r, j - 1) + c + 0.003 || pts[j].distanceTo(pts[j + 1]) < c + 0.003) continue;
          r.cut[j] = c; put(el.key, pts[j], a.clone().negate(), b);
        }
      });
      // 3) концы трасс: тройник на чужой трубе, угольник на стыке двух концов (при разных размерах — меньшего размера и муфты)
      built.forEach(function (r) {
        var n = r.pts.length; if (n < 2 || !r.ok) return;
        [0, n - 1].forEach(function (e) {
          if (r.cut[e]) return;
          var P = r.pts[e], nb = e === 0 ? 1 : n - 2, nd = dirv(P, r.pts[nb]);
          built.some(function (o) {
            if (o === r || !o.ok || GRPS[o.rt.role] !== GRPS[r.rt.role]) return false;
            var m = o.pts.length, oe, k;
            for (oe = 0; oe < 2; oe++) {                      // конец к концу
              var oi = oe ? m - 1 : 0, onb = oe ? m - 2 : 1;
              if (o.pts[oi].distanceTo(P) > 0.004 || o.cut[oi]) continue;
              var od = dirv(P, o.pts[onb]);
              if (Math.abs(nd.dot(od)) > 0.02) continue;
              var el = RF.elbow(r.s, o.s); if (!el) continue;
              var cr = el.armA.cut * MMV, co = el.armB.cut * MMV;
              if (P.distanceTo(r.pts[nb]) < cr + cutAt(r, nb) + 0.003 || P.distanceTo(o.pts[onb]) < co + cutAt(o, onb) + 0.003) continue;
              r.cut[e] = cr; o.cut[oi] = co; put(el.key, P, nd, od);
              putArm(P, nd, el.tip, el.armA.cps); putArm(P, od, el.tip, el.armB.cps);
              return true;
            }
            for (k = 0; k < m - 1; k++) {                      // конец в середину чужой трубы
              var A = o.pts[k], B = o.pts[k + 1], ab = B.clone().sub(A), L2 = ab.lengthSq(); if (L2 < 1e-8) continue;
              var t = P.clone().sub(A).dot(ab) / L2; if (t < 0.02 || t > 0.98) continue;
              var Q = A.clone().add(ab.clone().multiplyScalar(t)); if (Q.distanceTo(P) > 0.004) continue;
              var td = ab.clone().normalize(); if (Math.abs(nd.dot(td)) > 0.02) continue;
              var te = RF.tee(o.s, r.s); if (!te) continue;
              var ct = te.cut * MMV;
              if (P.distanceTo(r.pts[nb]) < ct + cutAt(r, nb) + 0.003) continue;
              r.cut[e] = ct; put(te.key, P, td, nd);
              putArm(P, nd, te.tip, te.cps);
              return true;
            }
            return false;
          });
        });
      });
    }
    // 4) концы труб на резьбовых портах узлов: переходник ВПр-НР (порт с гнездом ВР) или ВПр-ВР (порт с наружной резьбой) по каталогу SSS-2021/2022;
    // переходник ввинчивается в порт, торец трубы уходит в раструб на 13 мм от плоскости устья
    if (steel && mouths) {
      built.forEach(function (r) {
        if (!r.ok) return;
        var n = r.pts.length;
        [0, n - 1].forEach(function (e) {
          if (r.cut[e] || n < 2) return;
          var P = r.pts[e], mo = null, md = 0.02;
          mouths.forEach(function (q) { var d = q.P.distanceTo(P); if (d < md && !q.used) { md = d; mo = q; } });
          if (!mo) return;
          var key = 'adp_' + r.s + 'x' + mo.size + '_' + (mo.male ? 'F' : 'M');
          if (!ADP_OK[key]) return;
          var u = dirv(P, r.pts[e === 0 ? 1 : n - 2]);
          r.cut[e] = 0.013; mo.used = true; mo.adp = key;
          put(key, P, u, perp(u), '#adp');
        });
      });
    }
    return { built: built, places: places, PS: PS, steel: steel };
  }

  // ── проверка сборки: трасса, которую нельзя собрать из фитингов каталога, не показывается (сфера на углу — не деталь каталога).
  // Проверяются только трассы с p3 (новые трубы повёрнутого бойлера): угол без угольника, участок короче суммы вылетов двух фитингов
  // (труба не помещается между раструбами), пересечение с чужой трубой (зазор меньше 6 мм между стенками).
  function segDist(p1, q1, p2, q2) {
    var d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2), a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), s, t;
    if (a < 1e-12 && e < 1e-12) return r.length();
    if (a < 1e-12) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
    else {
      var c = d1.dot(r);
      if (e < 1e-12) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else {
        var b = d1.dot(d2), den = a * e - b * b;
        s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
      }
    }
    return p1.clone().add(d1.multiplyScalar(s)).distanceTo(p2.clone().add(d2.multiplyScalar(t)));
  }
  function ptSeg(p, a, b) {
    var ab = b.clone().sub(a), L2 = ab.lengthSq(), t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / L2));
    return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
  }
  // all = true: проверить и все трассы (а не только новые трубы бойлера) — для отладки и сверки раскладки по глубине
  function violations(plan, T, all) {
    var bad = [], B = plan.built, HUB = 0.020;
    B.forEach(function (b, bi) {
      if (!all && !b.rt.p3) return;
      var pts = b.pts, n = pts.length, j;
      if (plan.steel && b.ok && b.rt.p3) {
        for (j = 1; j < n - 1; j++) if (!b.cut[j]) bad.push({ t: 'corner', ri: bi, p: pts[j].clone(), msg: 'Угол трубы без фитинга (труба просто изогнута)' });
        for (j = 0; j < n - 1; j++) { var L = pts[j].distanceTo(pts[j + 1]), need = (b.cut[j] || 0) + (b.cut[j + 1] || 0); if (L < need) bad.push({ t: 'short', ri: bi, p: pts[j].clone().add(pts[j + 1]).multiplyScalar(0.5), msg: 'Участок трубы ' + Math.round(L * 1000) + ' мм короче вылетов фитингов (' + Math.round(need * 1000) + ' мм): не собрать' }); }
      }
      B.forEach(function (o, oi) {
        if (oi === bi || (all && oi < bi)) return;
        var ends = [pts[0], pts[n - 1]], oe = [o.pts[0], o.pts[o.pts.length - 1]];
        if (ends.some(function (e) { return oe.some(function (q) { return e.distanceTo(q) < 0.006; }); })) return;      // трассы сходятся в одной точке: стык, не пересечение
        for (j = 0; j < n - 1; j++) for (var k = 0; k < o.pts.length - 1; k++) {
          var A1 = pts[j], A2 = pts[j + 1], C1 = o.pts[k], C2 = o.pts[k + 1];
          if (ptSeg(A1, C1, C2) < 0.012 || ptSeg(A2, C1, C2) < 0.012 || ptSeg(C1, A1, A2) < 0.012 || ptSeg(C2, A1, A2) < 0.012) continue;      // стык: конец одной трубы лежит на другой
          var d = segDist(A1, A2, C1, C2), lim = b.rad + o.rad + 0.006;
          if (d < lim) bad.push({ t: 'cross', ri: bi, other: oi, at: [j, k], p: A1.clone().add(A2).multiplyScalar(0.5), msg: 'Трубы пересекаются или стоят вплотную: ' + Math.round(d * 1000) + ' мм между осями, нужно не меньше ' + Math.round(lim * 1000) });
        }
      });
    });
    return bad;
  }

  // ── проверка правильности сборки (кнопка «Проверка сборки»): подсветка красным мест, где собрать нельзя или нечем:
  // труба никуда не подключена, на резьбовом порту нет переходника, угол без фитинга, труба пересекает трубу, участок короче вылетов фитингов;
  // жёлтым — свободные порты оборудования (не ошибка, но не подключены)
  function assemblyIssues() {
    var T = S.T, plan = S.plan, B = plan.built, out = [], socks = [];
    S.root.traverse(function (o) {
      if (o.isMesh && o.visible && /^(раструб|кольцо_пресс|труба)/.test(o.name)) socks.push(new T.Box3().setFromObject(o));     // раструб переходника или труба-выпуск самого узла
    });
    var onPipe = function (P, skip) {
      return B.some(function (o, oi) {
        if (oi === skip) return false;
        for (var k = 0; k < o.pts.length - 1; k++) if (ptSeg(P, o.pts[k], o.pts[k + 1]) < 0.012) return true;
        return false;
      });
    };
    B.forEach(function (b, bi) {
      var n = b.pts.length;
      [0, n - 1].forEach(function (e) {
        var P = b.pts[e];
        if (b.cut[e] || onPipe(P, bi)) return;                                     // фитинг или другая труба
        if (socks.some(function (bx) { return bx.distanceToPoint(P) < 0.035; })) return;     // раструб переходника в самой модели узла
        var mo = null; (S.mouths || []).forEach(function (q) { if (q.P.distanceTo(P) < 0.02) mo = q; });
        if (mo) out.push({ lvl: 'bad', P: P.clone(), text: 'На порту ' + portThrText(mo) + ' нет переходника на трубу Ø' + b.s });
        else out.push({ lvl: 'bad', P: P.clone(), text: 'Труба Ø' + b.s + ' никуда не подключена' });
      });
    });
    (S.mouths || []).forEach(function (q) {
      if (q.used) return;
      var near = B.some(function (b) { return b.pts.some(function (p) { return p.distanceTo(q.P) < 0.03; }); });
      if (!near) out.push({ lvl: 'free', P: q.P.clone(), text: 'Свободный порт ' + portThrText(q) });
    });
    violations(plan, T, true).forEach(function (v) { out.push({ lvl: 'bad', P: v.p || null, text: v.msg }); });
    return out.filter(function (x) { return x.P; });
  }
  function portThrText(q) { return 'Rp ' + (THR_TXT[q.size] || q.size) + (q.male ? ' (НР)' : ' (ВР)'); }
  function clearChk() {
    if (S.chk) { S.root.remove(S.chk); S.chk = null; }
    var el = S.wrap.querySelector('.r3-chk'); if (el) el.remove();
  }
  function showChk() {
    var T = S.T, list = assemblyIssues(), g = new T.Group(), bad = list.filter(function (x) { return x.lvl === 'bad'; }).length;
    list.forEach(function (it) {
      var col = it.lvl === 'bad' ? 0xEF4444 : 0xF59E0B;
      var m = new T.Mesh(new T.SphereGeometry(0.03, 20, 14), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthTest: false }));
      m.position.copy(it.P); m.renderOrder = 999; m.userData.chk = true; g.add(m);
      var r = new T.Mesh(new T.TorusGeometry(0.036, 0.003, 8, 32), new T.MeshBasicMaterial({ color: col, depthTest: false }));
      r.position.copy(it.P); r.renderOrder = 1000; g.add(r);
    });
    S.root.add(g); S.chk = g;
    var el = document.createElement('div'); el.className = 'r3-chk';
    el.innerHTML = '<b>' + (bad ? 'Замечаний: ' + bad : 'Ошибок сборки нет') + (list.length > bad ? ', свободных портов: ' + (list.length - bad) : '') + '</b>' +
      list.slice(0, 12).map(function (x) { return '<div class="' + x.lvl + '">' + esc(x.text) + '</div>'; }).join('') + (list.length > 12 ? '<div>… ещё ' + (list.length - 12) + '</div>' : '');
    S.wrap.appendChild(el);
    return { msg: bad ? 'Проверка сборки: ' + bad + ' замечаний, места подсвечены красным' : 'Проверка сборки: все трубы подключены, пересечений нет' };
  }
  function checkOn() { return !!(S && S.chk); }

  // трубы системы по трассам плоского вида: горизонтали и вертикали на своей глубине от стены; концы — по плану фитингов (труба входит в раструб)
  function pipes() {
    var T = S.T, plan = S.plan, steel = plan.steel;
    var hex = (window.RoomPipe && window.RoomPipe.hex[plan.PS.k]) || 0xC9CFD5;
    var mat = new T.MeshStandardMaterial({ color: hex, metalness: steel ? 0.92 : plan.PS.k === 'mp' ? 0.3 : 0.0, roughness: steel ? 0.28 : plan.PS.k === 'mp' ? 0.4 : 0.55 });
    var g = new T.Group(); g.name = 'pipes';
    plan.built.forEach(function (bt) {
      var rt = bt.rt, pts = bt.pts;
      var band = new T.MeshStandardMaterial({ color: ROLE_COL[rt.role] || 0x888888, metalness: 0.1, roughness: 0.5 });
      for (var i = 0; i < pts.length - 1; i++) {
        var a0 = pts[i], b0 = pts[i + 1], dv = b0.clone().sub(a0).normalize(), a = a0, b = b0;
        if (a0.distanceTo(b0) < 1e-4) continue;
        (S.segs = S.segs || []).push({ role: rt.role, ri: S.spec.routes.indexOf(rt), a: a0.clone(), b: b0.clone() });
        if (bt.cut[i]) a = a0.clone().add(dv.clone().multiplyScalar(bt.cut[i]));       // труба входит в раструб фитинга, а не торчит сквозь изгиб
        if (bt.cut[i + 1]) b = b0.clone().sub(dv.clone().multiplyScalar(bt.cut[i + 1]));
        var len = a.distanceTo(b); if (len < 1e-4 || a.clone().sub(b).dot(dv) > 0) continue;
        var cy = new T.Mesh(new T.CylinderGeometry(bt.rad, bt.rad, len, 20, 1), mat);
        cy.position.copy(a).add(b).multiplyScalar(0.5);
        cy.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dv);
        cy.castShadow = true; cy.receiveShadow = true; cy.userData.pipe = rt.role; g.add(cy);
        for (var d = 0.12; d < len - 0.08; d += 0.26) {          // цветные ленты-маркеры потока: красная — подача, синяя — обратка
          var ring = new T.Mesh(new T.CylinderGeometry(bt.rad * 1.12, bt.rad * 1.12, 0.012, 20, 1), band);
          ring.position.copy(a).add(dv.clone().multiplyScalar(d)); ring.quaternion.copy(cy.quaternion); g.add(ring);
        }
      }
      for (var j = 1; j < pts.length - 1; j++) { if (bt.cut[j]) continue; var sp = new T.Mesh(new T.SphereGeometry(steel ? bt.rad : bt.rad * 1.12, 20, 14), mat); sp.position.copy(pts[j]); sp.castShadow = true; g.add(sp); }
    });
    var n = 0;
    plan.places.forEach(function (pl) {
      var src = S.fit && S.fit[pl.key]; if (!src) return;
      var o = src.clone(true), U = pl.u, V = pl.v;
      if (/^e45_/.test(pl.key)) {              // угольник 45°: плечи в модели — вдоль +X и под 135° к нему; приводим к осям мира
        var c = Math.cos(Math.PI / 4), Y = V.clone().add(U.clone().multiplyScalar(c)).multiplyScalar(1 / Math.sin(Math.PI / 4));
        if (Y.lengthSq() < 1e-6) return;
        V = Y.normalize();
      }
      var w = new T.Vector3().crossVectors(U, V);
      o.matrixAutoUpdate = true; o.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(U, V, w)); o.position.copy(pl.P);
      o.traverse(function (m) { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      g.add(o); n++;
    });
    S.fitCount = n;
    S.root.add(g); S.pipeGroup = g;
  }

  // стена и пол: светло-серый фон по размеру сцены, как на кадрах
  // фон: светлая тема - белый, ночная - тёмный; стена из материала (кирпич, блоки, брус) - выбор в RoomView (state.roomWall)
  function bgNow() { return (window.RoomView && window.RoomView.isDark && window.RoomView.isDark()) ? 0x24272C : 0xFFFFFF; }
  function applyWall() {
    if (!S || !S.wallMesh) return;
    var T = S.T, RV = window.RoomView, dk = !!(RV && RV.isDark && RV.isDark()), kind = (RV && RV.wallKind && A) ? RV.wallKind(A) : 'off';
    S.scene.background = new T.Color(bgNow());
    var wm = S.wallMesh, fl = S.floor, ww = wm.geometry.parameters.width, wh = wm.geometry.parameters.height;
    if (wm.material.map) wm.material.map.dispose(); wm.material.dispose();
    var o = { roughness: 0.95, metalness: 0, toneMapped: false };
    if (kind !== 'off' && RV && RV.wallTile) {
      var tx = new T.CanvasTexture(RV.wallTile(kind, dk)); tx.colorSpace = T.SRGBColorSpace; tx.wrapS = tx.wrapT = T.RepeatWrapping;
      tx.repeat.set(ww / 1.28, wh / 1.28); tx.anisotropy = 8; o.map = tx; o.color = 0xC8C8C8;
    } else o.color = dk ? 0x24272C : 0xFFFFFF;
    wm.material = new T.MeshStandardMaterial(o);
    fl.material.dispose(); fl.material = new T.MeshStandardMaterial({ color: dk ? 0x1B1D21 : 0xEEF0F3, roughness: 0.9, metalness: 0, toneMapped: false });
    S.wrap.style.background = '#' + ('000000' + bgNow().toString(16)).slice(-6);
  }
  function wall() {
    var T = S.T, b = new T.Box3().setFromObject(S.root), sz = b.getSize(new T.Vector3()), c = b.getCenter(new T.Vector3());
    var w = sz.x + 2.2, h = sz.y + 1.4;
    // стена выше и шире, пол глубже: на телефоне стоймя в кадр попадает много пустого места над и под сценой, край стены не должен быть виден
    var wh = h + 3, ww = Math.max(w, sz.x + 6);
    var wm = new T.Mesh(new T.PlaneGeometry(ww, wh), new T.MeshStandardMaterial({ color: 0xE9EBEE, roughness: 0.95, metalness: 0 }));
    wm.position.set(c.x, b.min.y - 0.08 + wh / 2, -0.004); wm.receiveShadow = true; S.root.add(wm);
    var fl = new T.Mesh(new T.PlaneGeometry(ww, 40), new T.MeshStandardMaterial({ color: 0xC4C8CE, roughness: 0.9, metalness: 0 }));
    fl.rotation.x = -Math.PI / 2; fl.position.set(c.x, b.min.y - 0.08, 20); fl.receiveShadow = true; S.root.add(fl);
    S.box = b; S.floor = fl; S.wallMesh = wm; applyWall();
    S.sun.position.set(c.x - 1.6, b.max.y + 2.4, 3.2); S.sun.target.position.set(c.x, c.y, 0);
    var sc = S.sun.shadow.camera; sc.left = -w / 2; sc.right = w / 2; sc.top = h / 2 + 1; sc.bottom = -h / 2 - 1; sc.near = 0.5; sc.far = 12; sc.updateProjectionMatrix();
  }

  // камера: вид спереди по размеру сцены или сохранённый
  function fit(initial) {
    var T = S.T, b = S.box, sz = b.getSize(new T.Vector3()), c = b.getCenter(new T.Vector3());
    var sv = initial ? savedView(S.spec.sig) : null;
    var asp = Math.max(0.3, S.wrap.clientWidth / Math.max(1, S.wrap.clientHeight));
    var fov = S.cam.fov * Math.PI / 180;
    // Вид спереди: ближние к камере детали (патрубки, выступающие агрегаты) выглядят крупнее, чем у центра сцены, поэтому дистанция
    // считается до плоскости самого переднего угла габарита, а не до центра. На телефоне стоймя запас по краям меньше: модель крупнее.
    var narrow = asp < 0.8, th = Math.tan(fov / 2), mg = narrow ? 1.05 : 1.12, need = Math.max(sz.x / 2 / (th * asp), sz.y / 2 / th) * mg;
    var dist = need + Math.max(0, b.max.z - c.z) + 0.04;
    S.home = { p: [c.x, c.y, c.z + dist], t: [c.x, c.y, 0.05] };
    S.ctl.maxDistance = Math.max(14, dist * 1.6);                     // широкая сцена на телефоне стоймя требует больше 14 м: прежний предел обрезал вид по краям
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

  // ── насосы групп: кадр группы с базовым насосом (STOUT SPC-0011 или ROMMER PROFI), нужный насос — отдельным GLB поверх по габариту
  // (tools/export_pump_glb.py). Так замена насоса на 3D-виде не требует отдельных кадров групп на каждый насос.
  var PUMP_DIR = 'models3d/pumps/';
  function famOf(pf) { return pf ? String(pf).replace(/^_/, '') : 'default'; }
  function loadPumpGlb(fam) {
    S.pumpGlb = S.pumpGlb || {};
    if (!S.pumpGlb[fam]) S.pumpGlb[fam] = new Promise(function (res) {
      S.gl.load(PUMP_DIR + 'pump_' + fam + '.glb?v=' + GLB_V, function (g) {
        // насос рассматривают вблизи и под углом: без анизотропной фильтрации надписи на лице мотора «плывут» и мылятся
        var an = S.r && S.r.capabilities ? S.r.capabilities.getMaxAnisotropy() : 1;
        g.scene.traverse(function (m) { if (m.isMesh && m.material && m.material.map) { m.material.map.anisotropy = an; m.material.map.needsUpdate = true; } });
        res(g.scene);
      }, null, function () { res(null); });
    });
    return S.pumpGlb[fam];
  }
  // Штатные насосы всех групп коллектора лежат в сцене одним компонентом «kit#0» (их коробки соприкасаются), а заменять надо каждый
  // отдельно: меши делятся на насосы по положению слева направо (перекрывающиеся по X отрезки — один насос), номер = номер группы.
  // детали самого насоса в кадре группы; соседние детали того же компонента (нижняя половина, полка, ребро, гайка и гнездо крана) насосу не принадлежат:
  // раньше они уходили вместе с ним, а их нижняя точка на 6,5 см ниже гайки насоса сдвигала новый насос вниз
  var PUMP_PART = /^(гайка_насоса|корпус_патрубки|улитка|мотор|лицо_мотора|клеммная_коробка|рёбра_крышки|кабельный_ввод|винт_крышки|хвостовик_под_насос)/;
  function tagPumps(fid) {
    S.pumpN = S.pumpN || {};
    if (S.pumpN[fid] !== undefined) return S.pumpN[fid];
    var ms = [];
    Object.keys(S.comps).forEach(function (k) { if (k.indexOf('hydro|' + fid + '|kit#') === 0) S.comps[k].forEach(function (o) { if (!o.userData.overlay && PUMP_PART.test(o.name)) ms.push(o); }); });
    var iv = ms.map(function (o) { var b = new S.T.Box3().setFromObject(o); return { o: o, a: b.min.x, z: b.max.x }; }).sort(function (p, q) { return p.a - q.a; });
    var n = -1, end = -1e9;
    iv.forEach(function (it) {
      if (it.a > end + 0.004) { n++; end = it.z; } else end = Math.max(end, it.z);
      it.o.userData.pump = n;
    });
    S.pumpN[fid] = n + 1;
    return n + 1;
  }
  function bakedOf(fid, i) {
    var out = [];
    Object.keys(S.comps).forEach(function (k) { if (k.indexOf('hydro|' + fid + '|kit#') === 0) S.comps[k].forEach(function (o) { if (!o.userData.overlay && o.userData.pump === i) out.push(o); }); });
    return out;
  }
  function overlayOf(fid, i) {
    var out = [];
    Object.keys(S.comps).forEach(function (k) { if (k.indexOf('hydro|' + fid + '|kit#') === 0) S.comps[k].forEach(function (o) { if (o.userData.overlay && o.userData.pump === i) out.push(o); }); });
    return out;
  }
  function boxOf(arr) { var T = S.T, b = new T.Box3(); arr.forEach(function (o) { b.union(new T.Box3().setFromObject(o)); }); return b; }
  // ось подключения насоса: центр нижнего среза (накидная гайка и литой корпус осесимметричны и у всех насосов одинаковые) и нижняя точка.
  // Раньше насос вставал по центру габарита: у моторов с клеммной коробкой сбоку, у P10 и EVO габарит несимметричен, и насос садился
  // мимо патрубков на 3–15 мм (замер по моделям: ось у всех на x = 0, центры габаритов −0,015…0).
  function axisOf(arr) {
    var T = S.T, b = boxOf(arr), lim = b.min.y + 0.012, sl = new T.Box3(), v = new T.Vector3(), any = false;
    arr.forEach(function (o) {
      var p = o.geometry && o.geometry.attributes && o.geometry.attributes.position; if (!p) return;
      o.updateWorldMatrix(true, false);
      for (var i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.y < lim) { sl.expandByPoint(v); any = true; } }
    });
    var c = (any ? sl : b).getCenter(new T.Vector3());
    return { x: c.x, z: c.z, y: b.min.y };
  }
  // встать на место штатного насоса: ось на ось, низ на низ
  function seatPump(root, baked) {
    var T = S.T, ms = [];
    root.traverse(function (m) { if (m.isMesh) ms.push(m); });
    var a = axisOf(baked), b = axisOf(ms);
    root.position.add(new T.Vector3(a.x - b.x, a.y - b.y, a.z - b.z));
    root.updateMatrixWorld(true);
  }
  // у каждой группы свой насос: вид накладывает нужную модель на место именно этого штатного насоса (а не всех сразу)
  function applyPumps() {
    if (!S || !S.ready) return;
    S.pumpOv = S.pumpOv || {};
    S.spec.layers.forEach(function (Ly) {
      if (Ly.kind !== 'hydro') return;
      var baked = famOf(Ly.baked), fams = Ly.pfs || [], n = tagPumps(Ly.fid);
      for (var i = 0; i < n; i++) (function (i) {
        var sk = Ly.fid + '#' + i, want = fams[i] != null ? famOf(fams[i]) : famOf(Ly.pf), cur = S.pumpOv[sk];
        if (cur && cur.fam === want) return;
        var bk = bakedOf(Ly.fid, i); if (!bk.length) return;
        if (cur) {
          if (cur.root) S.root.remove(cur.root);
          Object.keys(S.comps).forEach(function (k) { S.comps[k] = S.comps[k].filter(function (o) { return !(o.userData.overlay && o.userData.pump === i && k.indexOf('hydro|' + Ly.fid + '|') === 0); }); });
          delete S.pumpOv[sk];
        }
        if (want === baked) { bk.forEach(function (o) { o.visible = true; }); return; }
        S.pumpOv[sk] = { fam: want, pending: true };
        loadPumpGlb(want).then(function (src) {
          var pend = S && S.pumpOv[sk];
          if (!src || !pend || !pend.pending || pend.fam !== want) { if (pend && pend.pending && pend.fam === want) delete S.pumpOv[sk]; return; }
          var root = src.clone(true), key = bk[0].userData.comp;
          root.position.set(0, 0, 0); root.updateMatrixWorld(true);
          seatPump(root, bk);
          bk.forEach(function (o) { o.visible = false; });
          root.traverse(function (m) {
            if (!m.isMesh) return;
            m.castShadow = true; m.receiveShadow = true; m.userData.comp = key; m.userData.overlay = 1; m.userData.pump = i;
            m.userData.box = new S.T.Box3().setFromObject(m);
            (S.comps[key] = S.comps[key] || []).push(m);
          });
          S.root.add(root); S.pumpOv[sk] = { fam: want, root: root };
        });
      })(i);
    });
  }

  // ── выбор насоса: щелчок по насосу открывает «витрину» — камера подходит к группе, остальное гаснет, перед группой в ряд стоят
  // насосы-варианты (вращаются), под каждым имя и цена; щелчок по варианту заменяет насос в смете и на виде, по пустому месту — закрывает
  function openPicker(compKey, pumpIdx) {
    var T = S.T, fid = compKey.split('|')[1], idx = pumpIdx != null ? pumpIdx : 0;
    var opts = window.RoomView.pumpOptions(idx); if (!opts || !opts.list.length) return;
    var ov = S.pumpOv && S.pumpOv[fid + '#' + idx];
    var meshes = (ov && ov.root ? overlayOf(fid, idx) : bakedOf(fid, idx));
    if (!meshes.length) return;
    var C = boxOf(meshes).getCenter(new T.Vector3());
    var P = { key: compKey, fid: fid, idx: idx, many: opts.n > 1, opts: opts, items: [], group: new T.Group(), saved: { p: S.cam.position.toArray(), t: S.ctl.target.toArray() }, faded: [], hover: -1, t0: performance.now(), C: C };
    var n = opts.list.length;
    // раскладка вариантов: в ряд на широком экране, в две колонки на телефоне стоймя (ряд из четырёх не помещался, плашки налезали друг на друга)
    var cw = S.wrap.clientWidth || 1, ch = S.wrap.clientHeight || 1, asp = cw / ch, cols = asp < 0.85 ? Math.min(2, n) : n, rows = Math.ceil(n / cols);
    var gapX = cols < n ? 0.26 : 0.2, gapY = 0.34;
    S.picker = P;
    Promise.all(opts.list.map(function (o) { return loadPumpGlb(o.fam); })).then(function (srcs) {
      if (!S || S.picker !== P) return;
      opts.list.forEach(function (o, i) {
        if (!srcs[i]) return;
        var holder = new T.Group(), root = srcs[i].clone(true);
        root.updateMatrixWorld(true);
        var cc = new T.Box3().setFromObject(root).getCenter(new T.Vector3());
        root.position.set(-cc.x, -cc.y, -cc.z);                       // вращение вокруг своего центра
        holder.add(root);
        holder.position.set(C.x + ((i % cols) - (cols - 1) / 2) * gapX, C.y + 0.02 + ((rows - 1) / 2 - Math.floor(i / cols)) * gapY, C.z + 0.36);
        root.traverse(function (m) { if (m.isMesh) { m.castShadow = true; m.userData.pickIdx = i; } });
        P.group.add(holder);
        var el = document.createElement('div'); el.className = 'r3-pk' + (o.cur ? ' cur' : '');
        // при нескольких группах у каждого варианта две кнопки: заменить насос только этой группы или во всех группах сразу
        el.innerHTML = '<b>' + esc(o.name) + '</b><span>' + (o.price ? Number(o.price).toLocaleString('ru-RU') + ' ₽' : '') + '</span>' +
          (P.many ? '<i data-s="one">' + (o.cur ? 'сейчас' : 'этой группе') + '</i><i data-s="all">всем</i>' : '<i data-s="all">' + (o.cur ? 'сейчас' : 'выбрать') + '</i>');
        // плашка — обычный элемент поверх canvas: щелчок по ней до canvas не доходит, поэтому свой обработчик
        el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        el.addEventListener('pointerup', function (e) { e.stopPropagation(); });
        el.addEventListener('click', function (e) { e.stopPropagation(); var b = e.target.closest && e.target.closest('i'); pickerChoose(i, b ? b.getAttribute('data-s') : (P.many ? 'one' : 'all')); });
        el.addEventListener('pointerenter', function () { if (S.picker === P) P.hover = i; });
        el.addEventListener('pointerleave', function () { if (S.picker === P && P.hover === i) P.hover = -1; });
        S.wrap.appendChild(el);
        P.items.push({ o: o, holder: holder, el: el, i: i });
      });
    });
    S.scene.add(P.group);
    // остальное гаснет: трубы скрыты, детали прозрачные (кроме уже прозрачных пользователем)
    if (S.pipeGroup) S.pipeGroup.visible = false;
    Object.keys(S.comps).forEach(function (k) {
      if (S.hid[k]) return;
      if (k.indexOf('hydro|' + fid + '|kit#') === 0) return;
      setFade(k, true); P.faded.push(k);
    });
    P.covers = (S.covers || []).map(function (c) { return [c, c.visible]; }); (S.covers || []).forEach(function (c) { c.visible = false; });     // крышка открывается на время выбора
    // насосы остальных групп на время выбора тоже убираются: витрина стоит перед группой, и они только загораживают варианты
    P.others = [];
    for (var j = 0, nn = tagPumps(fid); j < nn; j++) if (j !== idx) {
      var oj = S.pumpOv && S.pumpOv[fid + '#' + j];
      (oj && oj.root ? overlayOf(fid, j) : bakedOf(fid, j)).forEach(function (o) { if (o.visible) { o.visible = false; P.others.push(o); } });
    }
    meshes.forEach(function (o) { o.visible = false; });                  // штатный насос уходит со своего места: варианты рядом, текущий среди них
    var bar = document.createElement('div'); bar.className = 'r3-pkbar'; bar.innerHTML = '<span>Выберите насос группы</span><button type="button">Закрыть</button>';
    bar.querySelector('button').addEventListener('click', function (e) { e.stopPropagation(); closePicker(); });
    S.wrap.appendChild(bar); P.bar = bar;
    // дистанция камеры: все варианты и их плашки в кадре при любой пропорции окна
    var th = Math.tan(S.cam.fov * Math.PI / 360), needW = ((cols - 1) * gapX + 0.26) * 1.15, needH = ((rows - 1) * gapY + 0.5) * 1.2;
    var dd = Math.max(needW / (2 * th * asp), needH / (2 * th), 0.9);
    flyTo([C.x, C.y - 0.02, C.z + 0.36 + dd], [C.x, C.y - 0.02, C.z + 0.36]);
  }
  function pickerHit(e) {
    var T = S.T, cvs = S.r.domElement, rc = cvs.getBoundingClientRect();
    S.ray.setFromCamera(new T.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), S.cam);
    var hits = S.ray.intersectObject(S.picker.group, true);
    for (var i = 0; i < hits.length; i++) { var o = hits[i].object; if (o.userData.pickIdx !== undefined) return o.userData.pickIdx; }
    return -1;
  }
  function pickerChoose(i, scope) {
    var P = S.picker; if (!P) return;
    var it = P.items.filter(function (x) { return x.i === i; })[0]; if (!it) return;
    var all = !P.many || scope === 'all';
    if (it.o.cur && !all) { closePicker(); return; }
    var id = it.o.id, nm = it.o.name, idx = P.idx; closePicker();
    var ok = all ? window.RoomView.pumpSwap(id) : window.RoomView.pumpSwap(id, idx);
    if (ok) msg('Насос заменён' + (all ? ' во всех группах' : ' в этой группе') + ': ' + nm);
    else msg('Не удалось заменить насос: в смете не найден насос группы');
  }
  function pickerClick(e) {
    var i = pickerHit(e);
    if (i < 0) { closePicker(); return; }
    pickerChoose(i);
  }
  function pickerTick() {
    var P = S.picker, t = (performance.now() - P.t0) / 1000, cvs = S.r.domElement, w = cvs.clientWidth, h = cvs.clientHeight;
    P.items.forEach(function (it) {
      var hv = P.hover === it.i;
      it.holder.rotation.y = t * 0.8 + it.i * 0.9;
      var sc = it.holder.scale.x + ((hv ? 1.18 : 1) - it.holder.scale.x) * 0.18; it.holder.scale.setScalar(sc);
      var v = it.holder.position.clone(); v.y -= 0.14; v.project(S.cam);
      it.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px'; it.el.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px';
      it.el.classList.toggle('hv', hv);
    });
  }
  function closePicker(silent) {
    var P = S.picker; if (!P) return;
    S.picker = null;
    P.items.forEach(function (it) { it.el.remove(); });
    if (P.bar) P.bar.remove();
    S.scene.remove(P.group);
    P.faded.forEach(function (k) { if (S.comps[k]) setFade(k, false); });
    if (S.pipeGroup) S.pipeGroup.visible = true;
    (P.covers || []).forEach(function (q) { q[0].visible = q[1]; });
    var ov = S.pumpOv && S.pumpOv[P.fid + '#' + P.idx];
    if (ov && ov.root) overlayOf(P.fid, P.idx).forEach(function (o) { o.visible = true; });
    else bakedOf(P.fid, P.idx).forEach(function (o) { o.visible = true; });
    (P.others || []).forEach(function (o) { o.visible = true; });
    if (!silent) flyTo(P.saved.p, P.saved.t);
  }


  // ── поворот бойлера: щелчок по бойлеру показывает две стрелки «повернуть на 90°»; бойлер плавно поворачивается, затем сцена пересобирается
  // с новыми трубами (room_view.js: tankRoutes), камера остаётся прежней
  function openTankGizmo() {
    closeTankGizmo();
    if (!S.tankPivot) return;
    var ang = window.RoomView.tankAngle(), box = new S.T.Box3().setFromObject(S.tankHold), c = box.getCenter(new S.T.Vector3());
    var el = document.createElement('div'); el.className = 'r3-tg';
    el.innerHTML = '<span>Бойлер: ' + (ang ? 'патрубки к стене, лицевая сторона к вам' : 'как в проекте, лицевая сторона вправо') + '</span><button type="button" title="Повернуть бойлер">&#x21BB;</button>';
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.target.closest && e.target.closest('button')) rotateTank();
    });
    S.wrap.appendChild(el); S.tg = { el: el, at: new S.T.Vector3(c.x, box.max.y + 0.08, c.z) };
  }
  function closeTankGizmo() { if (S && S.tg) { S.tg.el.remove(); S.tg = null; } }
  function tankGizmoTick() {
    var g = S.tg; if (!g) return;
    var cvs = S.r.domElement, v = g.at.clone().project(S.cam);
    g.el.style.left = ((v.x * 0.5 + 0.5) * cvs.clientWidth) + 'px'; g.el.style.top = ((-v.y * 0.5 + 0.5) * cvs.clientHeight) + 'px';
  }
  function rotateTank() {
    if (!S || !S.tankPivot || S.rotating) return;
    var dir = window.RoomView.tankAngle() === 90 ? -1 : 1;      // 0 -> 90 по часовой, 90 -> 0 обратно
    S.rotating = true; closeTankGizmo();
    if (S.pipeGroup) S.pipeGroup.visible = false;
    var pv = S.tankPivot, y0 = pv.rotation.y, y1 = y0 - dir * Math.PI / 2, t0 = performance.now();
    (function st(n) {
      var k = Math.min(1, (n - t0) / 520), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      pv.rotation.y = y0 + (y1 - y0) * e;
      if (k < 1) { requestAnimationFrame(st); return; }
      S.rotating = false;
      carryNext = true;                                    // камера остаётся: сцена пересоберётся с новыми трубами под тем же видом
      window.RoomView.tankRotate();
    })(t0);
  }
  // поворот бойлера применяется после раскладки деталей по компонентам: зоны сметы заданы по неповёрнутой модели
  function applyTankRot() {
    var T = S.T, Ly = S.spec.layers.filter(function (l) { return l.kind === 'dhw' && l.fid === 'w0'; })[0];
    if (!Ly || !S.tankPivot) return;
    S.tankPivot.rotation.y = -(Ly.rot || 0) * Math.PI / 180; S.tankHold.updateMatrixWorld(true);
    Object.keys(S.comps).forEach(function (k) { if (k.indexOf('dhw|w0|') === 0) S.comps[k].forEach(function (o) { o.userData.box = new T.Box3().setFromObject(o); }); });
    (S.lbox = S.lbox || {}).dhw = new T.Box3().setFromObject(S.tankHold);
  }
  var carryNext = false;

  // ── интерфейс
  // постоянная плашка с причиной (короткое сообщение в углу гасло за 2,6 с и на телефоне его не успевали прочесть)
  function failBanner(head) {
    var d = document.createElement('div'); d.className = 'r3-load'; d.style.cssText = 'background:rgba(255,255,255,.94);text-align:center;padding:16px;cursor:pointer';
    d.innerHTML = '<span><b>' + head + '</b><br>' + esc(S.why || 'нет ответа') + '<br>Проверьте вход в аккаунт «Профи» и связь, затем откройте вид снова. Нажмите, чтобы закрыть.</span>';
    d.onclick = function () { d.remove(); }; S.wrap.appendChild(d);
  }
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
    if (a === 'check') {
      if (S.chk) { clearChk(); return { msg: 'Проверка сборки выключена' }; }
      return showChk();
    }
    if (a === 'covers') {
      // теплоизоляция группы из двух половин: лицевая крышка и задняя часть. Нажатия по кругу: закрыта → крышки сняты → сняты обе → закрыта
      if (!S.covers || !S.covers.length) return { msg: 'В этой сборке нет насосных групп' };
      syncCovState();
      var hasBack = !!(S.shells && S.shells.length);
      if (!S.coversOpen) { S.covers.forEach(function (o) { o.visible = false; }); syncCovState(); return { msg: 'Лицевые крышки сняты: видны насосы и арматура' + (hasBack ? '. Ещё раз — снять и заднюю часть' : '') }; }
      if (hasBack && !S.backOff) { S.shells.forEach(function (o) { o.visible = false; }); syncCovState(); return { msg: 'Задняя часть теплоизоляции снята' }; }
      S.covers.forEach(function (o) { o.visible = true; }); (S.shells || []).forEach(function (o) { o.visible = true; }); syncCovState();
      return { msg: 'Теплоизоляция групп закрыта' };
    }
    if (a === 'save') { lsSet('rv3d:' + S.spec.sig, curView()); return { msg: 'Вид сохранён у вас: вернётся при следующем открытии' }; }
    if (a === 'saveall') { saveAll().then(function (r) { if (S && S.onMsg) S.onMsg(r.msg); }); return { msg: 'Сохраняю вид для всех…' }; }
    if (a === 'home') { flyTo(S.home.p, S.home.t); Object.keys(S.hid).forEach(function (k) { setFade(k, false); }); try { localStorage.removeItem('rv3d:' + S.spec.sig); } catch (e) { } delete MEM[S.spec.sig]; return { msg: 'Вид сброшен' }; }
    return null;
  }
  // состояние теплоизоляции по факту: крышки сняты у всех групп / сняты и задние половины
  function syncCovState() {
    S.coversOpen = !!(S.covers && S.covers.length) && S.covers.every(function (c) { return !c.visible; });
    S.backOff = !!(S.shells && S.shells.length) && S.shells.every(function (c) { return !c.visible; });
  }
  function isFade() { return !!(S && S.mode); }
  function coversOpen() { return !!(S && S.coversOpen); }

  // первая видимая деталь под курсором (насквозь через прозрачные не идём): нужна, чтобы щелчок по крышке не попадал в насос за ней
  // номер насоса (группы слева направо) под курсором: насосы разных групп лежат в одном компоненте, различаются меткой userData.pump
  function pumpHit(e) {
    var T = S.T, cvs = S.r.domElement, rc = cvs.getBoundingClientRect();
    S.ray.setFromCamera(new T.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), S.cam);
    var hits = S.ray.intersectObject(S.root, true);
    for (var i = 0; i < hits.length; i++) { var o = hits[i].object; if (o.visible && o.userData.pump !== undefined && /^hydro\|[^|]+\|kit#/.test(o.userData.comp || '')) return o.userData.pump; }
    return 0;
  }
  function firstHit(e) {
    var T = S.T, cvs = S.r.domElement, rc = cvs.getBoundingClientRect();
    S.ray.setFromCamera(new T.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), S.cam);
    var hits = S.ray.intersectObject(S.root, true);
    for (var i = 0; i < hits.length; i++) { var o = hits[i].object; if (o.visible && !(o.material && o.material.transparent && o.material.opacity < 0.5)) return o; }
    return null;
  }

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
      if (S.picker) { pickerClick(e); return; }
      if (!S.mode) {
        var fh = firstHit(e);
        if (fh && fh.userData.cover) { openCoverAt(fh); syncCovState(); msg('Крышка снята: щёлкните по насосу, чтобы заменить, или по задней части, чтобы снять и её; кнопка на панели закрывает всё'); return; }
        if (fh && fh.userData.shell && S.covers && S.covers.length) { removeShellAt(fh); syncCovState(); msg('Задняя часть теплоизоляции снята; кнопка на панели возвращает всё на место'); return; }
        var kp = pick(e);
        if (kp && /^dhw\|w0\|/.test(kp) && S.tankPivot && window.RoomView && window.RoomView.tankRotate) { if (S.tg) closeTankGizmo(); else openTankGizmo(); return; }
        if (S.tg) closeTankGizmo();
        if (kp && /^hydro\|[^|]+\|kit#/.test(kp) && window.RoomView && window.RoomView.pumpOptions && window.RoomView.pumpOptions()) { openPicker(kp, pumpHit(e)); return; }
        if (A.state.roomViewLabels) { var k2 = pick(e), c2 = compOf(k2); if (c2) { var ck2 = String(k2).split('#')[0]; S.pins[ck2] = !S.pins[ck2]; } }
        return;
      }
      var k = pick(e); if (!k) return;
      setFade(k, !S.hid[k]);
    });
    cvs.addEventListener('pointermove', function (e) {
      if (S.picker) { S.picker.hover = pickerHit(e); cvs.style.cursor = S.picker.hover >= 0 ? 'pointer' : ''; return; }
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
  // крышки по группам: плита «крышка группы» задаёт полосу по X, всё, что в ней (логотип, нижняя часть, сервопривод), — та же группа
  function coverPlates() {
    if (S.plates) return S.plates;
    S.plates = (S.covers || []).filter(function (c) { return /^крышка[_ ]группы$/.test(c.name.replace(/_?\d+$/, '')); }).map(function (c) {
      var b = new S.T.Box3().setFromObject(c); return { c: c, a: b.min.x - 0.004, z: b.max.x + 0.004 };
    });
    return S.plates;
  }
  function cx(o) { var b = new S.T.Box3().setFromObject(o); return (b.min.x + b.max.x) / 2; }
  function plateOf(o) { var x = cx(o), r = null; coverPlates().forEach(function (p) { if (x >= p.a && x <= p.z) r = p; }); return r; }
  function syncServos() {
    if (!S.servos) return;
    S.servos.forEach(function (o) { var p = plateOf(o); o.visible = p ? !p.c.visible : true; });
  }
  // щелчок по крышке открывает группу целиком: плита, логотип и нижняя часть этой группы, соседние не трогаем
  function openCoverAt(hit) {
    var p = plateOf(hit);
    if (!p) { hit.visible = false; return; }
    (S.covers || []).forEach(function (c) { var x = cx(c); if (x >= p.a && x <= p.z) c.visible = false; });
  }
  // Ближняя и дальняя плоскости камеры по расстоянию до сцены. С постоянными 0,05–60 м буфер глубины на телефонах (часто 16 бит) не
  // различает поверхности ближе миллиметра: тонкие наклейки и стыки теплоизоляции на расстоянии 1,5–2 м мерцают («зависшие» полосы
  // текстур). Диапазон сжат до самой сцены — точность вырастает на порядок.
  function depthRange() {
    var T = S.T, cam = S.cam;
    if (!S.bc) { S.bc = S.box.getCenter(new T.Vector3()); S.br = S.box.getSize(new T.Vector3()).length() / 2 + 0.6; }
    var dc = cam.position.distanceTo(S.bc), near = Math.max(0.03, dc - S.br * 1.1), far = dc + S.br * 1.3 + 1;
    if (Math.abs(near - cam.near) > cam.near * 0.04 || Math.abs(far - cam.far) > cam.far * 0.04) { cam.near = near; cam.far = far; cam.updateProjectionMatrix(); }
  }
  // щелчок по задней половине снимает её у этой группы целиком (все детали задней части в полосе плиты), соседние группы не трогаем
  function removeShellAt(hit) {
    var p = plateOf(hit);
    if (!p) { hit.visible = false; return; }
    (S.shells || []).forEach(function (o) { var x = cx(o); if (x >= p.a && x <= p.z) o.visible = false; });
  }
  function loop() {
    if (!S) return;
    S.raf = requestAnimationFrame(loop);
    if (!S.wrap.isConnected) return;               // вид пересобирается при каждом render(): пока блока нет в документе, не рисуем
    S.ctl.update();
    var e = S.cam.matrixWorldInverse.elements, cb = S.wrap.querySelector('.cb');
    S.cam.updateMatrixWorld();
    cb.style.transform = 'matrix3d(' + [e[0], -e[1], e[2], 0, -e[4], e[5], -e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1].join(',') + ')';
    syncServos();
    depthRange();
    if (S.picker) pickerTick();
    if (S.tg) tankGizmoTick();
    if (S.chk) { var kp = 1 + 0.18 * Math.sin(Date.now() / 220); S.chk.children.forEach(function (m, i) { if (i % 2 === 0) m.scale.setScalar(kp); }); }
    S.r.render(S.scene, S.cam);
    labels();
  }
  // подпись патрубка бойлера по имени метки «port_<код>_<размер>_<M|F>» (tools/render_dhw_node.py): назначение, резьба по паспорту серии
  var PORT_NAME = { cold: 'Вход ХВС', hot: 'Выход ГВС', rec: 'Рециркуляция', safe: 'Патрубок предохранительного клапана', sens: 'Гильза датчика', cin: 'Змеевик: подача', cout: 'Змеевик: обратка' };
  var PORT_SIZE = { G1: 'G1"', G34: 'G3/4"', G12: 'G1/2"', D6: 'Ø6 мм' };
  function portText(name) {
    var m = /^port_([a-z]+)_([A-Z0-9]+)_([MF])/.exec(name); if (!m || !PORT_NAME[m[1]]) return null;
    return PORT_NAME[m[1]] + ', ' + (PORT_SIZE[m[2]] || m[2]) + (m[2] === 'D6' ? '' : (m[3] === 'M' ? ' НР' : ' ВР'));
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
    (S.ports || []).forEach(function (o) {
      var t = portText(o.name); if (!t) return;
      var wp = new T.Vector3(); o.getWorldPosition(wp);
      var v = wp.project(S.cam);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return;
      items.push({ x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, text: t });
    });
    (S.mouths || []).forEach(function (q) {
      var v = q.P.clone().project(S.cam);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return;
      items.push({ x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, text: 'Порт ' + portThrText(q) });
    });
    G.RoomLabels.draw(svg, items, W, H); S.lblOn = true;
  }

  // ── вход: сцена в окне «На весь экран»; при смене состава сметы собирается заново, при возврате в тот же вид камера та же
  function show(host, spec, app) {
    A = app; loadDefaults();
    if (S && S.spec.sig === spec.sig && S.ready) { S.spec = spec; host.appendChild(S.wrap); resize(); applyPumps(); return; }
    if (S && S.building === spec.sig) { host.appendChild(S.wrap); return; }
    // сцену надо собрать заново (другой состав, поворот бойлера): камера и прозрачные детали переходят в новую, а прежний кадр остаётся
    // на экране, пока она грузится — иначе вид мигал пустым полем с надписью «Загрузка»
    SNAP = null;
    if (S && S.ready) { try { MEM[spec.sig] = curView(); } catch (e) { } try { SNAP = snapshot(); } catch (e) { SNAP = null; } }
    carryNext = false;
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
  function snapshot() {
    var src = S.r.domElement; S.r.render(S.scene, S.cam);                 // drawImage сразу после render: буфер ещё не сброшен
    var c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }
  function dispose() {
    if (!S) return;
    if (S.picker) closePicker(true);
    closeTankGizmo();
    try { if (S.ready) { MEM[S.spec.sig] = curView(); syncCovState(); KEEP.cov = S.backOff ? 2 : S.coversOpen ? 1 : 0; } } catch (e) { }
    cancelAnimationFrame(S.raf); if (S.ro) S.ro.disconnect();
    try { S.r.dispose(); } catch (e) { }
    if (S.wrap.parentNode) S.wrap.remove();
    S = null;
  }
  function hide() { KEEP.cov = 0; SNAP = null; dispose(); }

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
  G.Room3D = { wallRefresh: applyWall, checkOn: checkOn, _bad: function () { return S && S.bad; }, _seg: function (a, b, c, d) { return segDist(a, b, c, d); }, _all: function () { return S && violations(S.plan, S.T, true); }, show: show, hide: hide, cmd: cmd, isFade: isFade, coversOpen: coversOpen, _scene: function () { return S; } };   // _scene — для проверок стыковки
})(window);
