/* room_compose.js — ПРОТОТИП общего вида котельной из готовых кадров Blender (scratch, не продукт).
 *
 * Расстановка (как в проектах, замер по листу «Вид котельной спереди» 2025-210):
 *   слева направо — настенные котлы (низ корпуса на 1300 мм от пола), коллектор с насосными группами, напольный бойлер.
 * Трубы — по шагам, каждый шаг проверяется отдельно (параметр steps):
 *   1 — котлы до коллектора: подачи (общая линия) в левый нижний патрубок, обратки (общая линия) в правый;
 *   2 — коллектор с группами (внутри кадра узла);
 *   3 — котёл — бойлер: через трёхходовой клапан котла (патрубок «B»/«I» -> змеевик), либо от отдельной насосной группы загрузки;
 *   4 — бак ГВС над бойлером.
 * Порты — scratch/ports_all.json (трубы котлов и бойлера) и scratch/ports_hydro_all.json (устья коллектора), снимаются
 * tools/dump_ports.py со сборщиков узлов. Все кадры одной проекции (оси кадра котла, 1500 px/м).
 */
(function () {
  'use strict';
  var A = null;                           // приложение: подставляется в RoomView.html(app)
  var PXM = 1500;
  // труба обвязки по системе: наружный диаметр (как в смете: класс «22» — Ø22 нержавейка, Ø32 ППР, Ø26 металлопластик, Ø25 стабильная), вид и цвет
  var PIPE_SYS = { ss304: { od: 22, k: 'ss' }, ss316: { od: 22, k: 'ss' }, ppr: { od: 32, k: 'ppr' }, mp: { od: 26, k: 'mp' }, mp_r: { od: 26, k: 'mp' }, stable: { od: 25, k: 'stable' }, stable_r: { od: 25, k: 'stable' } };
  var PIPE_PAL = {
    ss: { edge: '#7B838B', mid: '#C7CDD3', hi: '#F7F9FA', ring: '#5E666E' },
    ppr: { edge: '#5E9453', mid: '#8CC57E', hi: '#D3EDCB', ring: '#3F6D38' },
    mp: { edge: '#B4BCC4', mid: '#EEF1F3', hi: '#FFFFFF', ring: '#8A939B' },
    stable: { edge: '#6B7279', mid: '#A5ABB1', hi: '#D8DCDF', ring: '#52585E' }
  };
  var PIPE_HEX = { ss: 0xC9CFD5, ppr: 0x8CC57E, mp: 0xEEF1F3, stable: 0xA5ABB1 };
  function pipeSys(mat) { return PIPE_SYS[mat] || PIPE_SYS.ss316; }
  // наружный диаметр трассы, мм: типоразмер по назначению (подводка котла, магистраль, греющий контур бойлера, ветка бака) из той же подборки, что и смета,
  // затем физический диаметр системы (22 → Ø26 у металлопластика, Ø32 у ППР и т. д.)
  function routeOd(sz, mat) {
    var L = A._bpSz || null, dl = A._dhwLoad && A._dhwLoad.size, lg = null;
    if (L) lg = sz === 'per' ? L.per : sz === 'tank' ? L.tank : sz === 'coil' ? (dl || L.per) : L.main;
    if (!lg) return pipeSys(mat).od;
    return (A.boilerPhysOd ? A.boilerPhysOd(mat, lg) : lg) || pipeSys(mat).od;
  }
  window.RoomPipe = { sys: pipeSys, hex: PIPE_HEX, od: routeOd };
  var BOILER_Z = 0.85;                    // низ корпуса настенного котла от пола, м: подключения котла на ~0,8 м от пола (каталог Meibes 2021, схема подключения котла, стр. 125)
  var YP = -0.16;                         // общая плоскость труб вдоль стены (ось патрубков коллектора)
  var REF = null;

  function img(src) {
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = src; });
  }
  function proj(p) {
    return [p[0] * REF.x[0] + p[1] * REF.y[0] + p[2] * REF.z[0], p[0] * REF.x[1] + p[1] * REF.y[1] + p[2] * REF.z[1]];
  }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function at(p, x, y, z) { return [x === null ? p[0] : x, y === null ? p[1] : y, z === null ? p[2] : z]; }

  function boilerFrames() {
    var cap = null, orig = A.wmSheet, origK = A.boilerFrameKey;
    A.wmSheet = function (o) { cap = o; return ''; };
    var wasOn = A.wmPreviewOn; A.wmPreviewOn = function () { return true; };
    // газовый Haier в смете может стоять под артикулом PNGB…: для кадра он тот же корпус
    A.boilerFrameKey = function (it) { var k = origK.call(A, it); if (k) return k; return /^PNGB/i.test(String(it.displaySku || it.id || '')) && /одноконтур/i.test(String(it.name || '')) ? 'haier1' : null; };
    try { A.renderBoilerNodeScheme(); } finally { A.wmSheet = orig; A.wmPreviewOn = wasOn; A.boilerFrameKey = origK; }
    var fr = cap ? cap.frames.filter(function (f) { return !f.head; }) : [], out = [];
    // каскад: одинаковые котлы кадр сметы склеивает в один, а на виде их столько, сколько в смете
    fr.forEach(function (f) { var n = Math.max(1, (f.it && (f.it.q || f.it.qty || f.it.count)) || 1); for (var i = 0; i < n; i++) out.push(f); });
    return out;
  }
  // нужного кадра спереди нет (ROMMER, редкие комплектации) — берём ближайший готовый: сначала без «_rm», затем отрезая хвосты ключа
  function pickKey(idx, key) {
    var c = [key, String(key).replace(/_rm/, '')], i, k;
    for (i = 0; i < c.length; i++) {
      k = c[i];
      while (k) { if (idx[k]) return k; var n = k.lastIndexOf('_'); if (n < 1) break; k = k.slice(0, n); }
    }
    return null;
  }
  // кадр коллектора с группами: нужного насоса нет — берём ближайшую модель ТОГО ЖЕ бренда (у ROMMER кадры только с PROFI,
  // у STOUT — с SPC-0011 без суффикса). Раньше pickKey отбрасывал суффиксы по одному и в смете ROMMER с насосом EVO показывал
  // коллектор и группы STOUT. Другой бренд, число групп и тип коллектора не подменяются: нет кадра — нет вида (и плашка).
  function pickHydro(idx, key) {
    if (idx[key]) return key;
    var m = /^(.*?)(_p[a-z0-9]+)$/.exec(String(key));
    if (!m) return null;
    var alt = /_r(_i)?$/.test(m[1]) ? '_pprofi' : '';
    return idx[m[1] + alt] ? m[1] + alt : null;
  }
  function baseKey(k) { return A.blBase(k).replace(/_c(_rm)?$/, '').replace(/_rm$/, ''); }

  function dhwKeys() {
    var eq = A.currentEquipmentList || [], sku = function (it) { return String(it.displaySku || it.id || ''); };
    // все бойлеры каталога: SWH-1110 (стандартный), SWH-2110 (OptiBase), SWH-3110 (электро), SWH-4110 (DUPLEX, нержавейка), RWH-2110 (ROMMER)
    var boiler = eq.find(function (it) { return !it.isOpt && /^(SWH|RWH)-(1110|2110|3110|4110)-0\d{5}$/i.test(sku(it)); });
    if (!boiler) return null;
    var s = sku(boiler).toUpperCase(), vol = parseInt(s.slice(-3), 10); if (vol === 190) vol = 200;
    // кадры бойлеров есть для трёх серий: b (OptiBase), gt (ROMMER), e (электро). Остальные берут кадр ближайшей модели того же объёма
    var BK = { 'SWH-2110': 'b', 'RWH-2110': 'gt', 'SWH-3110': 'e', 'SWH-1110': 'b', 'SWH-4110': 'd' };
    var di = (A.nodeIndex && DATA && DATA.DI) || {};
    var order = [BK[s.slice(0, 8)], 'b', 'gt', 'e', 'd'], tank = null, i, k;
    for (i = 0; i < order.length && !tank; i++) if (di[order[i] + vol + '_k']) tank = order[i] + vol;
    if (!tank) {                       // такого объёма нет ни в одной серии — ближайший по объёму из b
      var best = null; [150, 200, 300, 500].forEach(function (v) { if (best === null || Math.abs(v - vol) < Math.abs(best - vol)) best = v; });
      tank = 'b' + best;
    }
    var exp = eq.find(function (it) { return !it.isOpt && /^STW-0015-0000(24|18|12)$/i.test(sku(it)); });
    return { tank: tank, exp: exp ? 't' + sku(exp).slice(-2) : null };
  }

  // steps: до какого шага включительно рисовать трубы (1..4)
  async function build(steps) {
    steps = steps || 4;
    var bi = A.boilerIndex(), di = A.nodeIndex('dhw', A.DHW_DIR, 'dhw.json?v=3'), hi = A.nodeIndex('hydro', A.HYDRO_DIR, 'hydro.json?v=6');
    var PB = DATA.PB;
    var PH = DATA.PH;
    var bf = boilerFrames();
    if (!bf.length) return null;
    // кадры строго спереди (img/*_front): те же узлы, вид без перспективного наклона
    var BI = DATA.BI; hi = DATA.HI; di = DATA.DI;
    bf = bf.map(function (f) { var kk = pickKey(BI, f.key); return { id: f.id, key: kk || f.key, fr: kk ? BI[kk] : null, path: f.path.replace('/boiler_node/', '/boiler_node_front/').replace(/boiler_[^/]+$/, 'boiler_' + (kk || f.key)), stand: /^haier/.test(f.key) && !!(f.it && f.it.brand && !/Haier/i.test(String(f.it.brand))) }; }).filter(function (f) { return f.fr; });
    if (!bf.length) { return null; }
    REF = bf[0].fr.ax;
    var layers = [], routes = [], notes = [];

    // ── котлы: на стене, низ корпуса на BOILER_Z, патрубки котла приводятся в общую плоскость труб YP (стена на кадре не рисуется)
    var bx = 0.25, bports = [];
    bf.forEach(function (f) {
      var q = PB['boiler:' + baseKey(f.key)];
      if (!q) { notes.push('нет портов котла ' + f.key); return; }
      var off = [bx, YP - q[0].pos_m[1], BOILER_Z];
      layers.push({ kind: 'boiler', fid: f.id, key: f.key, fr: f.fr, off: off, src: f.path + '.webp', stand: f.stand });
      var P = q.map(function (p) { return add(p.pos_m, off); });
      bports.push({ sup: P[0], mid: P.length === 3 ? P[1] : null, ret: P[P.length - 1], key: f.key, dS: -q[0].pos_m[1], dM: P.length === 3 ? -q[1].pos_m[1] : null, dR: -q[q.length - 1].pos_m[1] });
      bx += (f.fr.w / PXM) * 0.9 + 0.25;
    });

    // ── коллектор с группами: правее котлов, низ коллектора на уровне низа котлов
    var hk = A.hydroFrameKey();
    var hkey = hk ? pickHydro(hi, hk.key) : null, hb = hkey ? hkey.replace(/_p[a-z0-9]+$/, '') : null;
    var hp = hb ? PH[hb] : null;
    var hOff = null;
    if (hkey && hi[hkey] && hp && hp.boiler.length === 2) {
      var ZC = BOILER_Z + 0.075;
      hOff = [bx + 0.35, YP - hp.boiler[0].pos_m[1], ZC];
      layers.push({ kind: 'hydro', fid: 'h0', key: hkey, pf: hk.pf || '', baked: (/_p[a-z0-9]+$/.exec(hkey) || [''])[0], pid: hk.pid, fr: hi[hkey], off: hOff, src: A.HYDRO_DIR.replace('hydro_node', 'hydro_node_front') + 'hydro_' + hkey + '.webp' });
    } else notes.push('нет кадра коллектора');

    // ── бойлер: напольный (пол z = 0), справа от коллектора; кадр «…_k» — только два подключения змеевика, высоты патрубков по паспорту объёма
    var cfgE = null; try { cfgE = A.buildSchemeConfig ? A.buildSchemeConfig() : null; } catch (e) { }
    var needExp = !!(cfgE && (cfgE.tankHeating || cfgE.tankDhw)), exps = [];
    var dk = dhwKeys(), tankOff = null, tp = null;
    var tkey = dk ? dk.tank + '_k' : null;
    if (tkey && di[tkey] && PB['dhw:' + tkey]) {
      var maxX = hp ? Math.max.apply(null, hp.outlets.map(function (o) { return o.pos_m[0]; })) : 0.3;
      tp = PB['dhw:' + tkey];
      tankOff = [(hOff ? hOff[0] + maxX + 0.40 : bx + 1.5) + (needExp ? 0.55 : 0) - tp[0].pos_m[0], YP - tp[0].pos_m[1], 0];   // с баками отопления и ГВС между потребителями и бойлером нужно место для пары
      layers.push({ kind: 'dhw', fid: 'w0', key: tkey, fr: di[tkey], off: tankOff, src: A.DHW_DIR.replace('dhw_node', 'dhw_node_front') + 'dhw_' + tkey + '.webp' });
      // расширительные баки парой на стене слева от бойлера, выше его верха, на одной высоте; слева красный (отопления), справа белый (ГВС)
      if (needExp) {
        var frT = di[tkey], xb = tankOff[0] + tp[0].pos_m[0], xe0 = xb - 260 / PXM;
        var topZ = tankOff[2] + frT.o[1] / Math.abs(frT.ax.z[1]), zOrig = topZ + 0.12 - 0.046;   // низ клапана бака на 0,12 м выше верха бойлера
        [['exh', 'h', cfgE.tankHeating, xe0 - 0.38, 'Расширительный бак отопления', 'ret'], ['exw', 't', cfgE.tankDhw, xe0 - 0.06, 'Расширительный бак ГВС', 'cw']].forEach(function (e) {
          var key = e[1] + e[2], pp = PB['dhw:' + key];
          if (!e[2] || !di[key] || !pp) { notes.push('нет кадра бака ' + key); return; }
          var off = [e[3], YP - pp[0].pos_m[1], zOrig];
          layers.push({ kind: 'dhw', fid: e[0], key: key, fr: di[key], off: off, src: A.DHW_DIR.replace('dhw_node', 'dhw_node_front') + 'dhw_' + key + '.webp' });
          exps.push({ fid: e[0], key: key, role: e[5], text: e[4] + ' ' + e[2] + ' л', port: proj(add(pp[0].pos_m, off)), depth: -pp[0].pos_m[1] });
        });
      }
    } else if (dk) notes.push('нет кадра бойлера ' + tkey);

    // ── трубы: на картинке только горизонтали и вертикали (вид спереди, как на эталоне владельца). Считаем в пикселях кадра.
    //    Три линии котлов: подача, обратка, подача на змеевик; порядок высот подбирается по числу пересечений.
    if (bports.length && (hOff || (tankOff && tp))) {
      var pL = null, pR = null, dL = null, dRr = null;
      if (hOff) {
        var L = hp.boiler[0], R = hp.boiler[1];
        if (L.pos_m[0] > R.pos_m[0]) { var t = L; L = R; R = t; }
        pL = proj(add(L.pos_m, hOff)); pR = proj(add(R.pos_m, hOff)); dL = -L.pos_m[1]; dRr = -R.pos_m[1];
      }
      var haveTank = !!(tankOff && tp);
      var cS = haveTank ? proj(add(tp[0].pos_m, tankOff)) : null, cR = haveTank ? proj(add(tp[1].pos_m, tankOff)) : null;
      // без коллектора подача отопления уходит открытым концом левее подъёма змеевика, обратка принимает возврат бойлера
      var nhCons = [], nhR = [];
      if (!hOff) {
        pL = [cS[0] - 400, 0]; pR = [cS[0] - 140, 0];
        nhCons = plainCons();
        if (nhCons.length) {
          var xr0 = Math.max.apply(null, bports.map(function (b) { return Math.max(proj(b.sup)[0], proj(b.ret)[0], b.mid ? proj(b.mid)[0] : 0); })) + 0.30 * PXM;
          var xlim = cS[0] - 260 - (exps.length ? 0.62 : 0.18) * PXM, SEP = 0.125 * PXM, PAIR = Math.min(0.42 * PXM, (xlim - xr0 - SEP) / nhCons.length);
          var yTop = proj([0, YP, BOILER_Z + 0.20])[1];
          nhCons.forEach(function (cn, k) {                  // у каждой пары: обратка слева, подача справа — как выходы групп коллектора
            var rx = xr0 + k * PAIR, sx = rx + SEP;
            nhR.push({ rx: rx, sx: sx, y: yTop });
            cn.sup = [sx / PXM, YP, -yTop / PXM]; cn.ret = [rx / PXM, YP, -yTop / PXM];
          });
          pL = [nhR[nhR.length - 1].sx, 0];
        }
      }
      var loadPump = !!(A.buildSchemeConfig && (A.buildSchemeConfig() || {}).loadPump);
      var useB = haveTank && !loadPump && bports.some(function (b) { return b.mid; });
      if (haveTank && loadPump) notes.push('загрузка бойлера от отдельной группы: нет кадра группы');
      if (haveTank && !loadPump && !useB) notes.push('у котла нет патрубка на бойлер, а загрузка не от насосной группы');
      var roles = useB ? ['sup', 'ret', 'ld'] : ['sup', 'ret'];
      // трубы от трёхходового клапана котла (подача отопления и патрубок на бойлер) стоят слишком близко: разводим их коленом под клапаном до 75 мм между осями
      var GAP = 0;   // колена под клапаном убраны: выходы A и B клапана идут параллельно вниз, как на образцах проектов
      var bs = bports.map(function (b) {
        var o = { sup: proj(b.sup), ret: proj(b.ret), mid: b.mid ? proj(b.mid) : null, jS: 0, jM: 0, dS: b.dS, dM: b.dM, dR: b.dR };
        if (o.mid && Math.abs(o.mid[0] - o.sup[0]) < GAP) { var dir = o.mid[0] >= o.sup[0] ? 1 : -1, d = (GAP - Math.abs(o.mid[0] - o.sup[0])) / 2; o.jS = -dir * d; o.jM = dir * d; }
        o.supx = o.sup[0] + o.jS; o.midx = o.mid ? o.mid[0] + o.jM : 0;
        return o;
      });
      var yEnd = proj([0, YP, BOILER_Z - 0.47])[1];   // конец заводского патрубка настенного котла (низ корпуса − 0,47 м): уровни линий считаем от него, а не от портов, у разных котлов они разные
      var STEP = 90, Y0 = Math.max(yEnd + 45, haveTank ? cR[1] - STEP + 70 : 0);   // ret ниже порта обратки бойлера минимум на шаг: спуск обратки виден, а не «ступенька» в 20 px
      function build(perm) {
        var yl = {}; roles.forEach(function (r, i) { yl[r] = Y0 + STEP * perm[i]; });
        var xe = haveTank ? cS[0] - 260 : 0, xj = haveTank ? cS[0] - 140 : 0;   // подъём подачи змеевика левее спуска его обратки: без пересечения
        var lines = [];
        var minX = function (k) { return Math.min.apply(null, bs.filter(function (b) { return b[k]; }).map(function (b) { return k === 'sup' ? b.supx : k === 'mid' ? b.midx : b[k][0]; })); };
        bs.forEach(function (b) {
          lines.push({ role: 'sup', sz: 'per', d0: b.dS, ext0: [0, -0.23 * PXM], jog: b.jS ? [b.jS, 0.06 * PXM] : null, pts: [b.sup, [b.supx, yl.sup]] });
          lines.push({ role: 'ret', sz: 'per', d0: b.dR, ext0: [0, -0.23 * PXM], pts: [b.ret, [b.ret[0], yl.ret]] });
          if (useB && b.mid) lines.push({ role: 'ld', sz: 'coil', d0: b.dM, ext0: [0, -0.23 * PXM], jog: b.jM ? [b.jM, 0.15 * PXM] : null, pts: [b.mid, [b.midx, yl.ld]] });
        });
        exps.forEach(function (e) {      // бак отопления врезается в обратку, бак ГВС заканчивается отводом к линии ХВС
          if (e.role === 'ret') lines.push({ role: 'ret', sz: 'tank', d0: e.depth, pts: [e.port, [e.port[0], yl.ret]] });
          else lines.push({ role: 'cw', sz: 'tank', planeMm: e.depth * 1000, pts: [e.port, [e.port[0], e.port[1] + 0.14 * PXM]] });
        });
        nhR.forEach(function (r) { lines.push({ role: 'sup', sz: 'main', pts: [[r.sx, yl.sup], [r.sx, r.y]] }); lines.push({ role: 'ret', sz: 'main', pts: [[r.rx, yl.ret], [r.rx, r.y]] }); });
        lines.push({ role: 'sup', sz: 'main', d1: dL, pts: hOff ? [[minX('sup'), yl.sup], [pL[0], yl.sup], pL] : [[minX('sup'), yl.sup], [pL[0], yl.sup]] });
        lines.push({ role: 'ret', sz: 'main', d1: dRr, pts: hOff ? [[minX('ret'), yl.ret], [haveTank && useB ? xj : pR[0], yl.ret]].concat(haveTank && useB ? [[pR[0], yl.ret], pR] : [[pR[0], yl.ret], pR]) : [[minX('ret'), yl.ret], [pR[0], yl.ret]] });
        if (useB) {
          lines.push({ role: 'ld', sz: 'coil', d1: -tp[0].pos_m[1], ext1: [0.075 * PXM, 0], pts: [[minX('mid'), yl.ld], [xe, yl.ld], [xe, cS[1]], cS] });
          lines.push({ role: 'lr', sz: 'coil', d0: -tp[1].pos_m[1], ext0: [0.075 * PXM, 0], pts: [cR, [xj, cR[1]], [xj, yl.ret]] });
        }
        return { lines: lines, yl: yl };
      }
      function crossings(lines) {
        var segs = [];
        lines.forEach(function (ln) { for (var i = 0; i < ln.pts.length - 1; i++) segs.push({ role: ln.role, a: ln.pts[i], b: ln.pts[i + 1] }); });
        var n = 0;
        for (var i = 0; i < segs.length; i++) for (var j = i + 1; j < segs.length; j++) {
          var p1 = segs[i], q1 = segs[j];
          if (p1.role === q1.role || (p1.role === 'ret' && q1.role === 'lr') || (p1.role === 'lr' && q1.role === 'ret')) continue;
          var ph = Math.abs(p1.a[1] - p1.b[1]) < 1e-6, qh = Math.abs(q1.a[1] - q1.b[1]) < 1e-6;
          if (ph === qh) continue;
          var h = ph ? p1 : q1, v = ph ? q1 : p1, x = v.a[0], y = h.a[1];
          if (x > Math.min(h.a[0], h.b[0]) + 1 && x < Math.max(h.a[0], h.b[0]) - 1 && y > Math.min(v.a[1], v.b[1]) + 1 && y < Math.max(v.a[1], v.b[1]) - 1) n++;
        }
        return n;
      }
      var perms = roles.length === 3 ? (bs.length > 1 ? [[2, 1, 0], [2, 0, 1], [1, 2, 0], [1, 0, 2], [0, 2, 1], [0, 1, 2]] : [[2, 1, 0]]) : [[1, 0]], best = null;   // как на эталоне: сверху подача змеевика, ниже обратка, ниже подача
      perms.forEach(function (pm) { var r = build(pm), c = crossings(r.lines); if (!best || c < best.c) best = { c: c, r: r, pm: pm }; });
      best.r.lines.forEach(function (ln) { ln.scr = true; routes.push(ln); });
      // глубина от стены, мм до оси трубы: подача — в плоскости патрубков котла (105–107), обратка и змеевик ближе к стене; в одной плоскости линии
      // разных контуров не пересекаются, пересечения на виде спереди — это проход одной трубы за другой (основа для 3D)
      var PLANE = { sup: 107, ret: 70, lr: 70, ld: 40 };
      best.r.lines.forEach(function (ln) { if (ln.role !== 'cw') ln.planeMm = PLANE[ln.role]; });
      var sameCross = 0;
      (function () { var L = best.r.lines; for (var i = 0; i < L.length; i++) for (var j = i + 1; j < L.length; j++) { if (L[i].role === L[j].role || L[i].planeMm !== L[j].planeMm) continue; if (crossings([L[i], L[j]]) > 0 && !((L[i].role === 'ret' && L[j].role === 'lr') || (L[i].role === 'lr' && L[j].role === 'ret'))) sameCross++; } })();
      notes.push('пересечений на виде спереди: ' + best.c + ', в одной плоскости: ' + sameCross + ' (глубина от стены, мм: подача 107, обратка 70, змеевик 40)');
    }

    // ── потребители над группами: радиатор или тёплый пол с подписью мощности (значки по образцу владельца), группы по буквам ключа кадра
    var cons = [];
    if (hk && hp && hOff) {
      var og = hp.outlets.slice().sort(function (a1, b1) { return a1.pos_m[0] - b1.pos_m[0]; });
      var kws = groupKw();
      for (var gi = 0; gi < hk.g.length; gi++) {
        var oR = og[2 * gi], oS = og[2 * gi + 1];
        if (!oR || !oS) break;
        cons.push({ kind: hk.g[gi] === 'd' ? 'rad' : 'floor', kw: kws[gi] || '', ret: add(oR.pos_m, hOff), sup: add(oS.pos_m, hOff) });
      }
    }
    if (!hOff && typeof nhCons !== 'undefined' && nhCons && nhCons.length && nhCons[0].sup) nhCons.forEach(function (cn) { cons.push(cn); });
    return { layers: layers, routes: routes, notes: notes, cons: cons, exps: exps };
  }

  // мощность контура из названия строки группы («… радиаторы: 15,8 из 48,8 кВт»), по порядку: тёплый пол слева, затем радиаторы, как ключ кадра
  // потребители, когда коллектора нет: узел подмеса тёплого пола (мощность в названии) и радиаторы на насосе котла (мощность из расхода: Q = 1,163·G·ΔT)
  function plainCons() {
    var eq = A.currentEquipmentList || [], out = [], h = null;
    try { h = A.buildHydroCheckData(); } catch (e) { }
    var R = {}; (h && h.rows || []).forEach(function (r) { R[r.id] = r; });
    var reg = A.radRegime ? A.radRegime() : { dt: 20 };
    eq.filter(function (it) { return !it.isOpt && /узел подмеса/i.test(it.name || ''); }).forEach(function (it) {
      var m = /\(([\d.,]+)\s*кВт\)/.exec(it.name || ''), n = Math.max(1, it.q || it.qty || 1), i;
      for (i = 0; i < n; i++) out.push({ kind: 'floor', kw: m ? m[1].replace(',', '.') : '', tag: 'узел подмеса' });
    });
    if (R.rad && R.rad.flow) out.push({ kind: 'rad', kw: (R.rad.flow * 1.163 * reg.dt).toFixed(1), tag: '' });
    return out;
  }
  function groupKw() {
    var eq = (A.currentEquipmentList || []).filter(function (e) { return !e.isOpt && /групп\S*\s+насосн|насосн\S*\s+групп/i.test(e.name) && !/(коллектор|гидрострелк|для\s+бойлера)/i.test(e.name); });
    var res = [];
    eq.forEach(function (e) { var m = String(e.name).match(/:\s*([\d,\.]+)\s+из/); res.push({ s: /смес|сервопривод|3-х\s*ход/i.test(e.name), kw: m ? m[1].replace(',', '.').replace(/\.0$/, '') : '' }); });
    var d = res.filter(function (r) { return !r.s; }), m2 = res.filter(function (r) { return r.s; });
    return d.concat(m2).map(function (r) { return r.kw; });
  }


  // ── значки потребителей (по образцу владельца): подпись мощности сверху, радиатор — светлая панель, подача красная справа, обратка слева;
  //    тёплый пол — змейка, цвет плавно от оранжевого (подача, справа) к синему (обратка, слева). Рисуются в системе значка (0,0 — верх по центру).
  var HOT = [247, 148, 29], MID = [236, 105, 70], CLD = [59, 111, 182];
  function lerpc(a, b, t) { return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }); }
  function arcPts(cx, cy, r, a0, a1, n) { var o = []; for (var i = 0; i <= n; i++) { var a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; }
  function gradPath(g, pts, c0, c1, mid, w) {
    var segs = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]), n = Math.max(1, Math.floor(L / 2));
      for (var k = 0; k < n; k++) segs.push([[pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n], [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * (k + 1) / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (k + 1) / n]]);
    }
    g.lineCap = 'round'; g.lineWidth = w;
    segs.forEach(function (sg, i) {
      var t = i / Math.max(1, segs.length - 1), c = mid ? (t < 0.5 ? lerpc(c0, mid, t * 2) : lerpc(mid, c1, (t - 0.5) * 2)) : lerpc(c0, c1, t);
      g.strokeStyle = 'rgb(' + c.join(',') + ')'; g.beginPath(); g.moveTo(sg[0][0], sg[0][1]); g.lineTo(sg[1][0], sg[1][1]); g.stroke();
    });
  }
  function iconRad(g, kw) {
    g.fillStyle = '#111827'; g.font = '16px Arial'; g.textAlign = 'center'; if (kw) g.fillText(kw + ' кВт', 0, 14);
    var w = 76, h = 54, x0 = -w / 2, y0 = 26;
    g.fillStyle = '#F3F4F6'; g.strokeStyle = '#CBD5E1'; g.lineWidth = 1.6; g.beginPath(); g.roundRect(x0, y0, w, h, 4); g.fill(); g.stroke();
    g.fillStyle = '#E5E7EB'; g.beginPath(); g.roundRect(x0 + 3, y0 + 3, w - 6, 5, 2); g.fill();
    g.strokeStyle = '#D1D5DB'; g.lineWidth = 2; g.lineCap = 'round';
    for (var i = 1; i < 12; i++) { g.beginPath(); g.moveTo(x0 + i * w / 12, y0 + 11); g.lineTo(x0 + i * w / 12, y0 + h - 5); g.stroke(); }
    var bottom = y0 + h + 40;
    g.lineWidth = 6; g.strokeStyle = '#E02424'; g.beginPath(); g.moveTo(x0 + w - 6, y0 + h - 4); g.lineTo(x0 + w - 6, bottom); g.stroke();
    g.strokeStyle = '#F2711C'; g.beginPath(); g.moveTo(x0 + 6, y0 + h - 4); g.lineTo(x0 + 6, bottom); g.stroke();
    return { sup: [x0 + w - 6, bottom], ret: [x0 + 6, bottom] };
  }
  function iconFloor(g, kw) {
    g.fillStyle = '#111827'; g.font = '16px Arial'; g.textAlign = 'center'; if (kw) g.fillText(kw + ' кВт', 0, 14);
    var gap = 12, xl = -26, xr = 26, ys = []; for (var i = 0; i < 5; i++) ys.push(30 + i * gap);
    var bottom = ys[4] + 34;
    var pts = [[xr + 6, bottom], [xr + 6, ys[0]], [xr, ys[0]], [xl, ys[0]]];
    for (var j = 1; j < 5; j++) {
      var yy = ys[j - 1] + gap / 2;
      if (j % 2 === 1) pts = pts.concat(arcPts(xl, yy, gap / 2, 270, 90, 10).slice(1), [[xl, ys[j]], [xr, ys[j]]]);
      else pts = pts.concat(arcPts(xr, yy, gap / 2, -90, 90, 10).slice(1), [[xr, ys[j]], [xl, ys[j]]]);
    }
    pts.push([xl - 6, ys[4]], [xl - 6, bottom]);
    gradPath(g, pts, HOT, CLD, MID, 5);
    return { sup: [xr + 6, bottom], ret: [xl - 6, bottom] };
  }
  function drawCons(g, cons, x0, y0) {
    cons.forEach(function (c) {
      var ps = proj(c.sup), pr = proj(c.ret); ps = [ps[0] - x0, ps[1] - y0]; pr = [pr[0] - x0, pr[1] - y0];
      // значок масштабируется так, чтобы его выходы стояли ровно над выходами группы: выноски идут прямо вверх, без поворотов
      var K = Math.abs(ps[0] - pr[0]) / 64, cx = (ps[0] + pr[0]) / 2, top = Math.min(ps[1], pr[1]) - 150 - 150 * K;
      g.save(); g.translate(cx, top); g.scale(K, K);
      var e = c.kind === 'rad' ? iconRad(g, c.kw) : iconFloor(g, c.kw);
      if (c.tag) { g.fillStyle = '#475569'; g.font = '12px Arial'; g.textAlign = 'center'; g.fillText(c.tag, 0, -6); }
      g.restore();
      var sy = top + e.sup[1] * K, ry = top + e.ret[1] * K;
      g.setLineDash([22, 14]); g.lineWidth = 6; g.lineCap = 'butt';
      g.strokeStyle = '#DC2626'; g.beginPath(); g.moveTo(ps[0], ps[1] - 10); g.lineTo(ps[0], sy); g.stroke();
      g.strokeStyle = '#2563EB'; g.beginPath(); g.moveTo(pr[0], pr[1] - 10); g.lineTo(pr[0], ry); g.stroke();
      g.setLineDash([]);
      var ym = (Math.min(ps[1], pr[1]) + Math.min(sy, ry)) / 2;
      g.fillStyle = '#fff'; g.strokeStyle = '#DC2626'; g.lineWidth = 3; g.beginPath(); g.moveTo(ps[0] - 12, ym + 8); g.lineTo(ps[0] + 12, ym + 8); g.lineTo(ps[0], ym - 14); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = '#2563EB'; g.beginPath(); g.moveTo(pr[0] - 12, ym - 8); g.lineTo(pr[0] + 12, ym - 8); g.lineTo(pr[0], ym + 14); g.closePath(); g.fill(); g.stroke();
    });
  }


  // ── трубы: три стиля. scheme — условные цветные линии от арматуры; real — материал и фитинги как в смете; flow — real + подсветка и стрелки потока
  var GRP = { sup: 'h', ld: 'h', ret: 'c', lr: 'c' };
  var FLOWCOL = { sup: '#E02424', ld: '#E02424', ret: '#2563EB', lr: '#2563EB', cw: '#0891B2' };
  function pathOf(g, pp) { g.beginPath(); pp.forEach(function (q, i) { if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); }
  function shift(pp, dx, dy) { return pp.map(function (q) { return [q[0] + dx, q[1] + dy]; }); }
  function segs(pp) { var o = []; for (var i = 0; i < pp.length - 1; i++) o.push([pp[i], pp[i + 1]]); return o; }
  function onSeg(pt, a, b) {
    var hz = Math.abs(a[1] - b[1]) < 1;
    return hz ? (Math.abs(pt[1] - a[1]) < 2 && pt[0] > Math.min(a[0], b[0]) + 2 && pt[0] < Math.max(a[0], b[0]) - 2)
              : (Math.abs(pt[0] - a[0]) < 2 && pt[1] > Math.min(a[1], b[1]) + 2 && pt[1] < Math.max(a[1], b[1]) - 2);
  }
  // спрайты нержавеющих пресс-фитингов (img/fit_node, Blender; размеры по паспорту, room_fit.js): угольник 90°, тройник, переходная муфта по размерам;
  // нет спрайта или система не нержавейка — прежний обобщённый кружок. Красное кольцо ROMMER получается перекраской синего при загрузке.
  var FITS = null;
  async function loadFits() {
    var base = 'img/fit_node/';
    var idx = await fetch(base + 'fit.json?v=2').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    if (!idx) return null;
    var names = Object.keys(idx), ims = await Promise.all(names.map(function (n) { return img(base + 'fit_' + n + '.webp').catch(function () { return null; }); }));
    var o = { idx: idx, im: {}, col: {} }; names.forEach(function (n, i) { if (ims[i]) o.im[n] = ims[i]; });
    return o;
  }
  // кольцо пресс-фитинга ROMMER красное, STOUT синее: у спрайтов синее, для ROMMER меняем местами красный и синий каналы у синих пикселей
  function spriteOf(key) {
    var im = FITS.im[key]; if (!im) return null;
    if (!(A.state && A.state.brandMode === 'rommer')) return im;
    if (FITS.col[key]) return FITS.col[key];
    var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
    var d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    for (var i = 0; i < p.length; i += 4) {
      if (p[i + 3] > 0 && p[i + 2] > p[i] * 1.5 + 25 && p[i + 2] > p[i + 1] * 1.3 + 15) { var r0 = p[i], b0 = p[i + 2]; p[i] = Math.min(255, b0 * 1.05); p[i + 1] = Math.round(p[i + 1] * 0.55); p[i + 2] = Math.round(r0 * 0.9); }
    }
    x.putImageData(d, 0, 0);
    return (FITS.col[key] = c);
  }
  function dirOf(a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dy) < 1.5 && Math.abs(dx) > 1) return dx > 0 ? 'R' : 'L';
    if (Math.abs(dx) < 1.5 && Math.abs(dy) > 1) return dy > 0 ? 'D' : 'U';
    return null;
  }
  var DVEC = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] }, DOPP = { R: 'L', L: 'R', U: 'D', D: 'U' };
  function putSprite(g, pt, key) {
    var m = FITS.idx[key], im = spriteOf(key); if (!m || !im) return false;
    g.drawImage(im, pt[0] - m.o[0], pt[1] - m.o[1], m.w, m.h);
    return true;
  }
  // план стыков плоского вида: какие спрайты где стоят и на сколько обрезать трубы (px). Возвращает { items, cuts, done } или null (не нержавейка / нет спрайтов)
  function planFlat(R, mat) {
    var RF = window.RoomFit, MM = PXM / 1000;
    if (!FITS || !RF || pipeSys(mat).k !== 'ss') return null;
    var items = [], cuts = R.map(function () { return []; }), done = {};
    R.forEach(function (r) { r.ok = RF.ok(r.od); });
    var has = function (k) { return !!(FITS.idx[k] && FITS.im[k]); };
    var elbKey = function (s, d1, d2) {
      var ab = d1 + d2, hh = /[RL]/.exec(ab), vv = /[UD]/.exec(ab);
      return (!hh || !vv || ab.length !== 2) ? null : 'e90_' + hh[0] + vv[0] + '_' + s;
    };
    var putArm = function (P, dl, tip, cps) {         // переходные муфты на плече узла
      var okAll = true, out = [];
      cps.forEach(function (c) {
        var cen = (tip + c.from + c.len / 2) * MM, o = c.bigOut ? dl : DOPP[dl], key = 'cp_' + o + '_' + c.big + 'x' + c.small;
        if (!has(key)) { okAll = false; return; }
        out.push({ key: key, pt: [P[0] + DVEC[dl][0] * cen, P[1] + DVEC[dl][1] * cen] });
      });
      return okAll ? out : null;
    };
    var armsKeys = function (el, P, nd, od) {
      var k = elbKey(el.size, nd, od); if (!k || !has(k)) return null;
      var a = putArm(P, nd, el.tip, el.armA.cps), b = putArm(P, od, el.tip, el.armB.cps);
      return (a && b) ? [{ key: k, pt: P }].concat(a, b) : null;
    };
    // 1) углы внутри трассы
    R.forEach(function (r, ri) {
      if (!r.ok) return;
      var el = RF.elbow(r.od, r.od), c = el.armA.cut * MM, n = r.pp.length;
      for (var i = 1; i < n - 1; i++) {
        var pt = r.pp[i], d1 = dirOf(pt, r.pp[i - 1]), d2 = dirOf(pt, r.pp[i + 1]), k = d1 && d2 && elbKey(el.size, d1, d2);
        if (!k || !has(k)) continue;
        if (Math.hypot(pt[0] - r.pp[i - 1][0], pt[1] - r.pp[i - 1][1]) < (cuts[ri][i - 1] || 0) + c + 3 || Math.hypot(pt[0] - r.pp[i + 1][0], pt[1] - r.pp[i + 1][1]) < c + 3) continue;
        cuts[ri][i] = c; items.push({ key: k, pt: pt }); done[ri + ':' + i] = 1;
      }
    });
    // 2) концы трасс: угольник на стыке двух концов, тройник на чужой трубе
    R.forEach(function (r, ri) {
      var n = r.pp.length; if (!r.ok || n < 2) return;
      [0, n - 1].forEach(function (e) {
        if (cuts[ri][e] || done[ri + ':' + e]) return;
        var pt = r.pp[e], nbi = e === 0 ? 1 : n - 2, nd = dirOf(pt, r.pp[nbi]); if (!nd) return;
        var legR = Math.hypot(pt[0] - r.pp[nbi][0], pt[1] - r.pp[nbi][1]);
        R.some(function (o, oi) {
          if (oi === ri || !o.ok || GRP[o.role] !== GRP[r.role]) return false;
          var m = o.pp.length, k, oe;
          for (oe = 0; oe < 2; oe++) {                                    // конец к концу
            var oidx = oe ? m - 1 : 0, onb = oe ? m - 2 : 1;
            if (Math.hypot(o.pp[oidx][0] - pt[0], o.pp[oidx][1] - pt[1]) > 3 || cuts[oi][oidx]) continue;
            var od = dirOf(pt, o.pp[onb]); if (!od || od === nd || od === DOPP[nd] || (/[RL]/.test(nd) === /[RL]/.test(od))) continue;
            var el = RF.elbow(r.od, o.od); if (!el) continue;
            var cr = el.armA.cut * MM, co = el.armB.cut * MM, legO = Math.hypot(pt[0] - o.pp[onb][0], pt[1] - o.pp[onb][1]);
            if (legR < cr + (cuts[ri][nbi] || 0) + 3 || legO < co + (cuts[oi][onb] || 0) + 3) continue;
            var arr = armsKeys(el, pt, nd, od); if (!arr) continue;
            cuts[ri][e] = cr; cuts[oi][oidx] = co; arr.forEach(function (q) { items.push(q); }); done[ri + ':' + e] = 1; done[oi + ':' + oidx] = 1;
            return true;
          }
          for (k = 0; k < m - 1; k++) {                                   // конец в середину чужой трубы
            if (!onSeg(pt, o.pp[k], o.pp[k + 1])) continue;
            var hz = Math.abs(o.pp[k][1] - o.pp[k + 1][1]) < 1;
            if ((hz && !/[UD]/.test(nd)) || (!hz && !/[RL]/.test(nd))) continue;
            var te = RF.tee(o.od, r.od); if (!te) continue;
            var key = 'tee_' + nd + '_' + (te.key.slice(4));
            var ct = te.cut * MM;
            if (!has(key) || legR < ct + (cuts[ri][nbi] || 0) + 3) continue;
            var arm = putArm(pt, nd, te.tip, te.cps); if (!arm) continue;
            cuts[ri][e] = ct; items.push({ key: key, pt: pt }); arm.forEach(function (q) { items.push(q); }); done[ri + ':' + e] = 1;
            return true;
          }
          return false;
        });
      });
    });
    return { items: items, cuts: cuts, done: done };
  }
  // трубы режутся у фитингов: края труб входят в раструбы
  function runsOf(pp, cuts) {
    var n = pp.length, runs = [], cur = [], i, u = function (a, b) { var L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    for (i = 0; i < n; i++) {
      var c = cuts[i] || 0, pt = pp[i];
      if (!c) { cur.push(pt); continue; }
      if (i === 0) { var nx = u(pt, pp[1]); cur.push([pt[0] + nx[0] * c, pt[1] + nx[1] * c]); continue; }
      if (i === n - 1) { var pv = u(pt, pp[n - 2]); cur.push([pt[0] + pv[0] * c, pt[1] + pv[1] * c]); continue; }
      var a = u(pt, pp[i - 1]), b = u(pt, pp[i + 1]);
      cur.push([pt[0] + a[0] * c, pt[1] + a[1] * c]); if (cur.length > 1) runs.push(cur);
      cur = [[pt[0] + b[0] * c, pt[1] + b[1] * c]];
    }
    if (cur.length > 1) runs.push(cur);
    return runs;
  }
  function pathRuns(g, runs, dx, dy) {
    g.beginPath();
    runs.forEach(function (run) { run.forEach(function (q, i) { if (i) g.lineTo(q[0] + dx, q[1] + dy); else g.moveTo(q[0] + dx, q[1] + dy); }); });
  }
  function fitting(g, pt, W, kind, pal) {
    var r = W * (kind === 'tee' ? 0.78 : 0.66);
    var gr = g.createRadialGradient(pt[0] - r * 0.35, pt[1] - r * 0.35, r * 0.1, pt[0], pt[1], r);
    gr.addColorStop(0, pal.hi); gr.addColorStop(0.55, pal.mid); gr.addColorStop(1, pal.edge);
    g.fillStyle = gr; g.beginPath(); g.arc(pt[0], pt[1], r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = pal.ring; g.lineWidth = 2; g.beginPath(); g.arc(pt[0], pt[1], r, 0, Math.PI * 2); g.stroke();
  }
  function collar(g, pt, W, vertical, pal) {            // пресс-кольцо на конце трубы
    g.fillStyle = pal.edge; g.strokeStyle = pal.ring; g.lineWidth = 2;
    if (vertical) { g.fillRect(pt[0] - W * 0.62, pt[1] - 7, W * 1.24, 14); g.strokeRect(pt[0] - W * 0.62, pt[1] - 7, W * 1.24, 14); }
    else { g.fillRect(pt[0] - 7, pt[1] - W * 0.62, 14, W * 1.24); g.strokeRect(pt[0] - 7, pt[1] - W * 0.62, 14, W * 1.24); }
  }
  function drawPipes(g, routes, x0, y0, style, mat) {
    var scheme = style === 'scheme', glow = style.indexOf('flow') === 0, PS = pipeSys(mat), W = PS.od * PXM / 1000;
    var PAL = PIPE_PAL[PS.k];
    var order = { ld: 0, lr: 0, cw: 1, ret: 1, sup: 2 };                     // «глубина» от стены: змеевик ближе всех к стене, подача дальше всех
    var R = routes.map(function (r) {
      var pp = r.pts.map(function (p) { var q = r.scr ? p : proj(p); return [q[0] - x0, q[1] - y0]; });
      {
        if (r.ext0) pp[0] = [pp[0][0] + r.ext0[0], pp[0][1] + r.ext0[1]];
        if (r.ext1) pp[pp.length - 1] = [pp[pp.length - 1][0] + r.ext1[0], pp[pp.length - 1][1] + r.ext1[1]];
      }
      if (r.jog && pp.length >= 2) { var t0 = pp[0], yj = t0[1] + r.jog[1], yl2 = pp[pp.length - 1][1]; pp = [t0, [t0[0], yj], [t0[0] + r.jog[0], yj], [t0[0] + r.jog[0], yl2]]; }
      return { role: r.role, pp: pp, od: r.od || PS.od, W: (r.od || PS.od) * PXM / 1000 };
    }).sort(function (a, b) { return order[a.role] - order[b.role]; });
    g.lineJoin = 'round'; g.lineCap = 'butt';
    var flow = [];
    var FP = scheme ? null : planFlat(R, mat);          // стыки по размерам труб (паспорт); null — прежние кружки
    if (FP) R.forEach(function (r, ri) { r.runs = runsOf(r.pp, FP.cuts[ri]); });
    R.forEach(function (r) {
      var W = r.W, col = FLOWCOL[r.role], c = col;
      if (scheme) {
        if (r.role !== 'ld' && r.role !== 'lr') { g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = W + 16; pathOf(g, r.pp); g.stroke(); }
        g.strokeStyle = c; g.lineWidth = W; pathOf(g, r.pp); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 6; pathOf(g, shift(r.pp, -6, -6)); g.stroke();
        return;
      }
      var RN = r.runs || [r.pp];
      if (glow) { g.strokeStyle = col; g.globalAlpha = 0.22; g.lineWidth = W * 2.3; pathRuns(g, RN, 0, 0); g.stroke(); g.globalAlpha = 1; }
      g.strokeStyle = 'rgba(15,23,42,.30)'; g.lineWidth = W + 8; pathRuns(g, RN, 8, 10); g.stroke();       // тень на стене: труба, что ближе к зрителю, ложится на дальнюю
      g.strokeStyle = PAL.edge; g.lineWidth = W; pathRuns(g, RN, 0, 0); g.stroke();
      g.strokeStyle = PAL.mid; g.lineWidth = W * 0.7; pathRuns(g, RN, 0, 0); g.stroke();
      g.strokeStyle = PAL.hi; g.lineWidth = W * 0.22; pathRuns(g, RN, -W * 0.16, -W * 0.16); g.stroke();
      RN.reduce(function (acc, run) { return acc.concat(segs(run)); }, []).forEach(function (sg) {   // цветные ленты-маркеры потока на трубе: красная — подача, синяя — обратка (только на видимых участках между фитингами)
        var a1 = sg[0], b1 = sg[1], L = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]), hz = Math.abs(a1[1] - b1[1]) < 1;
        for (var d = 50; d < L - 30; d += 260) {
          var t = d / L, x = a1[0] + (b1[0] - a1[0]) * t, y = a1[1] + (b1[1] - a1[1]) * t;
          g.fillStyle = col; g.globalAlpha = 0.92;
          if (hz) g.fillRect(x - 6, y - W / 2, 12, W); else g.fillRect(x - W / 2, y - 6, W, 12);
          g.globalAlpha = 1;
        }
      });
      var fp = r.role === 'ret' ? r.pp.slice().reverse() : r.pp;
      flow.push({ role: r.role, col: col, pp: fp, W: W });
    });
    if (scheme) {
      R.forEach(function (r) {
        var W = r.W;
        segs(r.pp).forEach(function (sg) {
          var a1 = sg[0], b1 = sg[1], L = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]); if (L < 500) return;
          var mx = (a1[0] + b1[0]) / 2, my = (a1[1] + b1[1]) / 2, hz = Math.abs(a1[1] - b1[1]) < 1;
          g.fillStyle = '#9AA0A8'; if (hz) g.fillRect(mx - 7, my - W / 2 - 6, 14, W + 12); else g.fillRect(mx - W / 2 - 6, my - 7, W + 12, 14);
        });
      });
      return flow;
    }
    if (FP) FP.items.forEach(function (q) { putSprite(g, q.pt, q.key); });
    // прочие стыки (не нержавейка, нет спрайта, не хватило длины): обобщённые кружки; отвод — поворот линии, тройник — врезка, кольцо — свободный конец
    R.forEach(function (r, ri) {
      var n = r.pp.length, W = r.W;
      r.pp.forEach(function (pt, i) {
        var end = i === 0 || i === n - 1;
        if (!end) {
          var p0 = r.pp[i - 1], p2 = r.pp[i + 1], turn = Math.abs((pt[0] - p0[0]) * (p2[1] - pt[1]) - (pt[1] - p0[1]) * (p2[0] - pt[0])) > 100;
          if (turn && !(FP && FP.done[ri + ':' + i])) fitting(g, pt, W, 'elbow', PAL);
          return;
        }
        var kind = null, od = null, kod = r.od;
        R.forEach(function (o, oi) {
          if (oi === ri || GRP[o.role] !== GRP[r.role] || kind === 'elbow') return;
          o.pp.forEach(function (q, qi) { if (Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 3 && (qi === 0 || qi === o.pp.length - 1)) { kind = 'elbow'; kod = Math.max(kod, o.od); od = dirOf(pt, o.pp[qi === 0 ? 1 : o.pp.length - 2]); } });
          if (!kind) for (var k = 0; k < o.pp.length - 1; k++) if (onSeg(pt, o.pp[k], o.pp[k + 1])) { kind = 'tee'; kod = Math.max(kod, o.od); }
          if (!kind) o.pp.forEach(function (q, qi) { if (Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 3 && qi > 0 && qi < o.pp.length - 1) kind = 'tee'; });
        });
        if (FP && FP.done[ri + ':' + i]) return;
        if (kind) fitting(g, pt, Math.max(W, kod * PXM / 1000), kind, PAL);
        else { var nb = i === 0 ? r.pp[1] : r.pp[n - 2]; collar(g, pt, W, Math.abs(nb[0] - pt[0]) < 2, PAL); }
      });
    });
    if (style === 'flow') flow.forEach(function (f) { chevrons(g, f, 0, f.W || W); });
    return flow;
  }
  // стрелки потока по ломаной, смещение off (пикселей) двигает их вдоль трубы
  function chevrons(g, f, off, W) {
    var step = 120, acc = 0, pp = f.pp, tot = 0, i;
    for (i = 0; i < pp.length - 1; i++) tot += Math.hypot(pp[i + 1][0] - pp[i][0], pp[i + 1][1] - pp[i][1]);
    for (var d = (off % step); d < tot; d += step) {
      var dd = d, k = 0;
      while (k < pp.length - 2 && dd > Math.hypot(pp[k + 1][0] - pp[k][0], pp[k + 1][1] - pp[k][1])) { dd -= Math.hypot(pp[k + 1][0] - pp[k][0], pp[k + 1][1] - pp[k][1]); k++; }
      var a1 = pp[k], b1 = pp[k + 1], L = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]); if (L < 1) continue;
      var ux = (b1[0] - a1[0]) / L, uy = (b1[1] - a1[1]) / L, x = a1[0] + ux * dd, y = a1[1] + uy * dd, h = W * 0.55;
      g.save(); g.translate(x, y); g.rotate(Math.atan2(uy, ux));
      g.fillStyle = '#fff'; g.strokeStyle = f.col; g.lineWidth = 3; g.beginPath(); g.moveTo(h, 0); g.lineTo(-h * 0.7, -h); g.lineTo(-h * 0.3, 0); g.lineTo(-h * 0.7, h); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }

  var COL = { sup: [224, 36, 36], ret: [37, 99, 235], ld: [224, 36, 36], lr: [37, 99, 235] };


  // заводские патрубки (класс «tube» карты деталей) стираем с кадра: вместо них рисуется труба выбранной системы, без «хвостов» старого материала
  async function eraseTubes(im) {
    var idim = await img(im.src.replace(/\.webp(\?.*)?$/, '_id.png'));
    var w = im.naturalWidth, h = im.naturalHeight;
    var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
    var c2 = document.createElement('canvas'); c2.width = w; c2.height = h; var x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(idim, 0, 0);
    var d = x.getImageData(0, 0, w, h), d2 = x2.getImageData(0, 0, w, h), m = new Uint8Array(w * h), m2 = new Uint8Array(w * h), i;
    for (i = 0; i < w * h; i++) if (d2.data[4 * i + 2] > 200 && d2.data[4 * i] < 60 && d2.data[4 * i + 1] < 60) m[i] = 1;
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
      if (!m[yy * w + xx]) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) { var nx = xx + dx, ny = yy + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h) m2[ny * w + nx] = 1; }
    }
    for (i = 0; i < w * h; i++) if (m2[i]) d.data[4 * i + 3] = 0;
    x.putImageData(d, 0, 0);
    return { c: c, m: m, w: w, h: h };
  }
  // где начинается заводской патрубок (у арматуры): труба системы рисуется от порта до этой точки
  function tubeExtent(l, p, horiz) {
    var s = l.w / l.mw, ix = Math.round((p[0] - l.x) / s), iy = Math.round((p[1] - l.y) / s), m = l.mask, w = l.mw, h = l.mh, miss = 0, best = null, a, b;
    if (!horiz) {
      for (a = iy + 4; a >= 0; a--) { var has = false; for (b = ix - 8; b <= ix + 8; b++) if (b >= 0 && b < w && m[a * w + b]) { has = true; break; } if (has) { best = a; miss = 0; } else if (++miss > 8) break; }
      return best === null ? null : [0, (l.y + best * s) - p[1]];
    }
    for (a = ix - 4; a < w; a++) { var hs = false; for (b = iy - 8; b <= iy + 8; b++) if (b >= 0 && b < h && a >= 0 && m[b * w + a]) { hs = true; break; } if (hs) { best = a; miss = 0; } else if (++miss > 8) break; }
    return best === null ? null : [(l.x + best * s) - p[0], 0];
  }

  async function canvasOf(steps, style) {
    var S = await build(steps);
    if (!S) return null;
    var sc = function (fr) { return PXM / Math.hypot(fr.ax.x[0], fr.ax.x[1]); };
    var ims = await Promise.all(S.layers.map(function (l) { return img(l.src); }));
    var ers = await Promise.all(S.layers.map(function (l, i) { return ((l.kind === 'boiler' || l.kind === 'dhw') && !/^ex/.test(l.fid || '')) ? eraseTubes(ims[i]) : null; }));
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    S.layers.forEach(function (l, i) {
      var s = sc(l.fr), p = proj(l.off), ox = l.fr.o[0] * s, oy = l.fr.o[1] * s;
      l.x = p[0] - ox; l.y = p[1] - oy; l.w = ims[i].naturalWidth * s; l.h = ims[i].naturalHeight * s; l.im = ers[i] ? ers[i].c : ims[i]; if (ers[i]) { l.mask = ers[i].m; l.mw = ers[i].w; l.mh = ers[i].h; }
      x0 = Math.min(x0, l.x); y0 = Math.min(y0, l.y); x1 = Math.max(x1, l.x + l.w); y1 = Math.max(y1, l.y + l.h);
    });
    S.routes.forEach(function (r) {            // начало заводских патрубков: труба системы идёт от порта до арматуры
      [['ext0', 0], ['ext1', r.pts.length - 1]].forEach(function (e) {
        if (!r[e[0]]) return;
        var horiz = r[e[0]][1] === 0, p = r.pts[e[1]], best = null, bd = 1e9;
        S.layers.forEach(function (l) { if (!l.mask || (horiz ? l.kind !== 'dhw' : l.kind !== 'boiler')) return; var d = Math.abs(p[0] - (l.x + l.w / 2)); if (d < bd) { bd = d; best = l; } });
        var v = best ? tubeExtent(best, p, horiz) : null; r[e[0]] = v || [0, 0];
      });
    });
    S.routes.forEach(function (r) { r.pts.forEach(function (p) { var q = r.scr ? p : proj(p); x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }); });
    (S.cons || []).forEach(function (c) { var a = proj(c.sup), b = proj(c.ret); y0 = Math.min(y0, Math.min(a[1], b[1]) - 150 - 150 * (Math.abs(a[0] - b[0]) / 64) - 60); x0 = Math.min(x0, Math.min(a[0], b[0]) - 200); x1 = Math.max(x1, Math.max(a[0], b[0]) + 200); });
    x0 -= 60; y0 -= 60; x1 += 60; y1 += 60;
    var cv = document.createElement('canvas'); cv.width = Math.round(x1 - x0); cv.height = Math.round(y1 - y0);
    var g = cv.getContext('2d');
    var wl = g.createLinearGradient(0, 0, 0, cv.height); wl.addColorStop(0, '#E9EBEE'); wl.addColorStop(1, '#D8DBE0');
    g.fillStyle = wl; g.fillRect(0, 0, cv.width, cv.height);
    var tl = S.layers.filter(function (l) { return l.kind === 'dhw'; })[0], fy = tl ? tl.y + tl.h - y0 - 8 : cv.height - 120;
    g.fillStyle = '#C4C8CE'; g.fillRect(0, fy, cv.width, cv.height - fy); g.fillStyle = '#B4B8BF'; g.fillRect(0, fy, cv.width, 10);
    S.layers.slice().sort(function (a, b) { return b.off[1] - a.off[1] || a.off[0] - b.off[0]; }).forEach(function (l) { g.drawImage(l.im, l.x - x0, l.y - y0, l.w, l.h); });
    var mat = (A.boilerPipeSystem && A.boilerPipeSystem()) || 'ss316';
    S.routes.forEach(function (r) { r.od = routeOd(r.sz, mat); });
    if (!FITS) { try { FITS = await loadFits(); } catch (e) { FITS = null; } }
    cv._flow = drawPipes(g, S.routes, x0, y0, style || 'scheme', mat);
    cv._mat = mat;
    drawCons(g, S.cons || [], x0, y0);
    cv._notes = S.notes;
    cv._geom = { x0: x0, y0: y0, layers: S.layers.map(function (l) { return { kind: l.kind, key: l.key, off: l.off, fid: l.fid, fr: l.fr, x: l.x, y: l.y, w: l.w, h: l.h }; }) };
    cv._s3 = { exp: (S.exps || []).map(function (e) { return { fid: e.fid, text: e.text }; }), mat: mat, layers: S.layers.map(function (l) { return { kind: l.kind, key: l.key, fid: l.fid, off: l.off, fr: l.fr, pf: l.pf, baked: l.baked, pid: l.pid }; }), routes: S.routes.map(function (r) {
      var pp = r.pts.map(function (p) { return r.scr ? p.slice() : proj(p); });
      if (r.ext0) pp[0] = [pp[0][0] + r.ext0[0], pp[0][1] + r.ext0[1]];
      if (r.ext1) pp[pp.length - 1] = [pp[pp.length - 1][0] + r.ext1[0], pp[pp.length - 1][1] + r.ext1[1]];
      if (r.jog && pp.length >= 2) { var t0 = pp[0], yj = t0[1] + r.jog[1], yl2 = pp[pp.length - 1][1]; pp = [t0, [t0[0], yj], [t0[0] + r.jog[0], yj], [t0[0] + r.jog[0], yl2]]; }
      return { role: r.role, od: r.od || null, pp: pp, plane: r.planeMm || 100, d0: r.d0 == null ? null : r.d0, d1: r.d1 == null ? null : r.d1 };
    }), cons: (S.cons || []).map(function (c) { return { kind: c.kind, kw: c.kw, sup: proj(c.sup), ret: proj(c.ret) }; }) };
    return cv;
  }


  // ── вход для калькулятора: общий вид котельной по смете (только владелец), подписи и связь со строками сметы
  var PUBLIC_ALL = true;      // решение владельца 20.11.2026: вид открыт всем; «Схема» — бесплатным, «Реалистично» и «3D» — тарифу «Профи»
  var DATA = null, loading = false, cache = {};
  function load(app) {
    if (DATA || loading) return;
    loading = true;
    var j = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }); };
    Promise.all([j('img/room_ports.json?v=3'), j('img/boiler_node_front/boiler.json?v=2'), j('img/hydro_node_front/hydro.json?v=2'), j('img/dhw_node_front/dhw.json?v=4')])
      .then(function (r) { if (r[0] && r[1] && r[2] && r[3]) { DATA = { PB: r[0].PB, PH: r[0].PH, BI: r[1], HI: r[2], DI: r[3] }; app.render(); } loading = false; })
      .catch(function () { loading = false; });
  }
  // листы котла, гидравлики и бойлера строятся штатными функциями: берём их подписи и строки сметы, а кадры подставляем свои (спереди)
  function capture(app) {
    var caps = [], orig = app.wmSheet, wp = app.wmPreviewOn, ok = app.boilerFrameKey;
    app.wmSheet = function (o) { caps.push(o); return ''; };
    app.wmPreviewOn = function () { return true; };
    app.boilerFrameKey = function (it) { var k = ok.call(app, it); if (k) return k; return /^PNGB/i.test(String(it.displaySku || it.id || '')) && /одноконтур/i.test(String(it.name || '')) ? 'haier1' : null; };
    try { app.renderBoilerNodeScheme(); app.renderHydroNodeScheme(); app.renderDhwNodeScheme(); }
    finally { app.wmSheet = orig; app.wmPreviewOn = wp; app.boilerFrameKey = ok; }
    return caps;
  }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  var BOUND = false;
  // ── подсветка по контуру детали: карты классов кадров (_id.png) режутся на отдельные детали, под курсором — деталь по пикселю
  var HL_PAL = [['mf', 255, 0, 0], ['ek', 0, 255, 0], ['tube', 0, 0, 255], ['mount', 255, 255, 0], ['feed', 0, 255, 255], ['end', 255, 0, 255], ['head', 255, 255, 255], ['kit', 255, 128, 0], ['sep', 128, 0, 255], ['cap', 0, 128, 255], ['th', 128, 255, 0]];
  var HL_S = 3, HL_R = 2;          // ячейка 3 px кадра; детали, лежащие ближе 2 ячеек, считаются одной
  var HL = null, LB = null, FC_MOVED = 0, hmCache = {};
  function labelMap(kind, key) {
    var ck = kind + '_' + key;
    if (hmCache[ck]) return hmCache[ck];
    hmCache[ck] = new Promise(function (res) {
      var im = new Image();
      im.onload = function () {
        var w = Math.ceil(im.naturalWidth / HL_S), h = Math.ceil(im.naturalHeight / HL_S);
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var g = cv.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false; g.drawImage(im, 0, 0, w, h);
        var d = g.getImageData(0, 0, w, h).data, cls = new Int8Array(w * h).fill(-1), i, k;
        for (i = 0; i < w * h; i++) {
          var r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
          if (!r && !gg && !b) continue;
          for (k = 0; k < HL_PAL.length; k++) { var p = HL_PAL[k]; if (Math.abs(r - p[1]) < 40 && Math.abs(gg - p[2]) < 40 && Math.abs(b - p[3]) < 40) { cls[i] = (kind !== 'hydro' && p[0] === 'tube') ? -1 : k; break; } }
        }
        var lab = new Int32Array(w * h), n = 0, inst = [0], st, q, x, y, dx, dy, nx, ny, j;
        for (i = 0; i < w * h; i++) {
          if (cls[i] < 0 || lab[i]) continue;
          n++; lab[i] = n; st = [i]; inst[n] = { cls: HL_PAL[cls[i]][0] };
          while (st.length) {
            q = st.pop(); x = q % w; y = (q / w) | 0;
            for (dy = -HL_R; dy <= HL_R; dy++) for (dx = -HL_R; dx <= HL_R; dx++) {
              nx = x + dx; ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              j = ny * w + nx; if (cls[j] === cls[i] && !lab[j]) { lab[j] = n; st.push(j); }
            }
          }
        }
        res({ w: w, h: h, lab: lab, inst: inst, ring: {} });
      };
      im.onerror = function () { res(null); };
      im.src = 'img/' + kind + '_node_front/' + kind + '_' + key + '_id.png';
    });
    return hmCache[ck];
  }
  function drawOrder(a, b) { return b.L.off[1] - a.L.off[1] || a.L.off[0] - b.L.off[0]; }
  function findHit(mx, my, ctx) {
    ctx = ctx || HL;
    var M = ctx.maps, i, rr, dx, dy, id, x, y;
    for (i = M.length - 1; i >= 0; i--) {
      var L = M[i].L, m = M[i].m, sc = PXM / Math.hypot(L.fr.ax.x[0], L.fr.ax.x[1]);
      var fx = (mx - (L.x - ctx.c.geom.x0)) / sc, fy = (my - (L.y - ctx.c.geom.y0)) / sc;
      if (fx < 0 || fy < 0 || fx >= L.fr.w || fy >= L.fr.h) continue;
      var cx = (fx / HL_S) | 0, cy = (fy / HL_S) | 0; id = 0;
      for (rr = 0; rr <= 2 && !id; rr++) for (dy = -rr; dy <= rr && !id; dy++) for (dx = -rr; dx <= rr && !id; dx++) {
        x = cx + dx; y = cy + dy; if (x >= 0 && y >= 0 && x < m.w && y < m.h) id = m.lab[y * m.w + x];
      }
      if (id) return { L: L, m: m, id: id, cls: m.inst[id].cls, sc: sc };
    }
    return null;
  }
  // тонкая линия вокруг одной детали: маска детали, расширенная на пару ячеек (закрывает щели), и кольцо вокруг неё
  function outline(st, h) {
    var ov = st.querySelector('.rv-ov'); if (!ov) return;
    var r = st.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), a;
    if (ov.width !== Math.round(r.width * dpr)) { ov.width = Math.round(r.width * dpr); ov.height = Math.round(r.height * dpr); }
    var g = ov.getContext('2d'); g.clearRect(0, 0, ov.width, ov.height);
    if (!h) return;
    var m = h.m, cl = m.ring[h.id];
    if (!cl) {
      var cv = document.createElement('canvas'); cv.width = m.w; cv.height = m.h;
      var cg = cv.getContext('2d'), im = cg.createImageData(m.w, m.h), i, dx, dy;
      for (i = 0; i < m.w * m.h; i++) if (m.lab[i] === h.id) { im.data[i * 4] = 37; im.data[i * 4 + 1] = 99; im.data[i * 4 + 2] = 235; im.data[i * 4 + 3] = 255; }
      cg.putImageData(im, 0, 0);
      cl = document.createElement('canvas'); cl.width = m.w + 2 * HL_R; cl.height = m.h + 2 * HL_R;
      var cc = cl.getContext('2d');
      for (dy = -HL_R; dy <= HL_R; dy++) for (dx = -HL_R; dx <= HL_R; dx++) cc.drawImage(cv, dx + HL_R, dy + HL_R);
      m.ring[h.id] = cl;
    }
    var k = r.width / HL.c.w * dpr, cell = HL_S * h.sc * k;
    var dw = cl.width * cell, dh = cl.height * cell, x0 = ((h.L.x - HL.c.geom.x0) * k) - HL_R * cell, y0 = ((h.L.y - HL.c.geom.y0) * k) - HL_R * cell;
    var tmp = document.createElement('canvas'); tmp.width = ov.width; tmp.height = ov.height;
    var tg = tmp.getContext('2d'); tg.imageSmoothingEnabled = true;
    var rr = 1.3 * dpr;
    for (a = 0; a < 8; a++) tg.drawImage(cl, x0 + Math.cos(a * Math.PI / 4) * rr, y0 + Math.sin(a * Math.PI / 4) * rr, dw, dh);
    tg.globalCompositeOperation = 'destination-out'; tg.drawImage(cl, x0, y0, dw, dh);
    g.drawImage(tmp, 0, 0);
  }
  function compItems(layers, caps) {
    var comps = {};
    caps.forEach(function (cap) {
      cap.items.forEach(function (it) {
        var root = String(it.pk).split(':')[0];
        it.zs.forEach(function (zz) {
          layers.forEach(function (Ly) {
            if (Ly.kind !== cap.kind || Ly.fid !== zz.line) return;
            comps[Ly.kind + '|' + Ly.fid + '|' + root] = { kind: cap.kind, pk: it.pk, t1: it.lines[0], t2: it.lines.slice(1).join(', ') + (it.ok ? '' : ' — нет в смете'), ok: it.ok };
          });
        });
      });
    });
    return comps;
  }
  function bind(app) {
    if (BOUND) return; BOUND = true;
    var rowsOf = function (c) { return c ? (app.wmKindRows(c.kind, c.pk, '') || []) : []; };
    var clear = function () { document.querySelectorAll('tr.sg-row-hl').forEach(function (e) { e.classList.remove('sg-row-hl'); }); };
    var tipOff = function (st) { var tp = st && st.querySelector('.rv-tip'); if (tp) tp.classList.remove('on'); };
    document.addEventListener('mousemove', function (e) {
      var st = e.target.closest && e.target.closest('.rv-stage[data-hl]');
      if (!st || !HL || !HL.maps.length) { if (HL && HL.cur) { HL.cur = null; clear(); document.querySelectorAll('.rv-stage').forEach(function (s) { outline(s, null); tipOff(s); }); } return; }
      var r = st.getBoundingClientRect(), k = r.width / HL.c.w, h = findHit((e.clientX - r.left) / k, (e.clientY - r.top) / k);
      var key = h ? h.L.kind + '|' + h.L.key + '#' + h.id : null, c = h ? HL.comps[h.L.kind + '|' + h.L.fid + '|' + h.cls] : null;
      if (key !== HL.cur) {
        HL.cur = key; clear(); outline(st, c ? h : null);
        if (c) rowsOf(c).forEach(function (tr) { tr.classList.add('sg-row-hl'); });
      }
      var tp = st.querySelector('.rv-tip');
      if (!tp) return;
      if (!c) { tp.classList.remove('on'); return; }
      tp.innerHTML = '<b>' + esc(c.t1) + '</b><span>' + esc(c.t2) + '</span>';
      tp.style.left = Math.min(e.clientX - r.left + 14, r.width - 270) + 'px'; tp.style.top = Math.min(e.clientY - r.top + 14, r.height - 60) + 'px'; tp.classList.add('on');
    });
    document.addEventListener('mouseout', function (e) {
      var st = e.target.closest && e.target.closest('.rv-stage[data-hl]');
      if (st && !(e.relatedTarget && st.contains(e.relatedTarget))) { if (HL) HL.cur = null; clear(); outline(st, null); tipOff(st); }
    });
    // выноски показаний: захватить и перенести; от выноски к точке съёма идёт пунктир
    var drag = null;
    document.addEventListener('pointerdown', function (e) {
      var b = e.target.closest && e.target.closest('.fc-b'); if (!b) return;
      var fc = b.parentNode, st = fc.closest('.rv-stage'); if (!st) return;
      drag = { fc: fc, st: st, x0: e.clientX, y0: e.clientY, moved: false };
      try { b.setPointerCapture(e.pointerId); } catch (er) { }
    });
    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 5) return;
      drag.moved = true;
      var r = drag.st.getBoundingClientRect(), l = Math.max(2, Math.min(98, (e.clientX - r.left) / r.width * 100)), t = Math.max(2, Math.min(98, (e.clientY - r.top) / r.height * 100));
      drag.fc.style.left = l.toFixed(2) + '%'; drag.fc.style.top = t.toFixed(2) + '%';
      var ln = drag.st.querySelector('.rv-fcl line[data-id="' + drag.fc.getAttribute('data-id') + '"]');
      if (ln) { ln.setAttribute('x2', l.toFixed(2) + '%'); ln.setAttribute('y2', t.toFixed(2) + '%'); }
      drag.fc.setAttribute('data-side', l > 62 ? 'l' : 'r');
    });
    document.addEventListener('pointerup', function () {
      if (!drag) return;
      var d = drag; drag = null;
      if (d.moved) {
        var pos = app.state.roomViewFc || (app.state.roomViewFc = {});
        pos[d.fc.getAttribute('data-id')] = [parseFloat(d.fc.style.left), parseFloat(d.fc.style.top)];
        app.saveState(); FC_MOVED = Date.now();
      }
    });
    // подписи: крупное оборудование подписано всегда, остальное — по наведению и щелчку на позицию
    document.addEventListener('mousemove', function (e) {
      var st = e.target.closest && e.target.closest('.rvm .rv-stage');
      if (!st || !LB || !LB.maps) return;
      var r = st.getBoundingClientRect(), k = r.width / LB.c.w, h = findHit((e.clientX - r.left) / k, (e.clientY - r.top) / k, LB);
      var key = h ? h.L.kind + '|' + h.L.fid + '|' + h.cls : null;
      if (key && !LB.comps[key]) key = null;
      if (key !== LB.hover) { LB.hover = key; drawFlatLabels(); }
    });
    document.addEventListener('click', function (e) {
      var st = e.target.closest && e.target.closest('.rvm .rv-stage');
      if (!st || !LB || !LB.maps || e.target.closest('button') || e.target.closest('.rv-fc')) return;
      var r = st.getBoundingClientRect(), k = r.width / LB.c.w, h = findHit((e.clientX - r.left) / k, (e.clientY - r.top) / k, LB);
      var key = h && (h.L.kind + '|' + h.L.fid + '|' + h.cls);
      if (key && LB.comps[key]) { LB.pins[key] = !LB.pins[key]; drawFlatLabels(); }
    });
    document.addEventListener('click', function (e) {
      var fb = e.target.closest && e.target.closest('.fc-b');
      if (fb && Date.now() - FC_MOVED < 300) { e.stopPropagation(); return; }
      if (fb) { var fc = fb.parentNode, was = fc.classList.contains('pin'); document.querySelectorAll('.rv-fc.pin').forEach(function (x) { x.classList.remove('pin'); }); if (!was) fc.classList.add('pin'); e.stopPropagation(); return; }
      var st = e.target.closest && e.target.closest('.rv-stage[data-hl]');
      if (!st || !HL || !HL.maps.length || e.target.closest('button')) return;
      var r = st.getBoundingClientRect(), k = r.width / HL.c.w, h = findHit((e.clientX - r.left) / k, (e.clientY - r.top) / k);
      var c = h && HL.comps[h.L.kind + '|' + h.L.fid + '|' + h.cls], row = rowsOf(c)[0];
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  var STYLES = [['scheme', 'Схема'], ['real', 'Реалистично'], ['3d', '3D']];
  function proOf(app) { return !!(app.wmPreviewOn() || (app.isPro && app.isPro())); }
  function styleOf(app) {
    if (!proOf(app)) return 'scheme';
    var v = app.state.roomViewStyle;
    return v === 'scheme' ? 'scheme' : v === '3d' ? '3d' : (app.state.roomViewFlow ? 'flow' : 'real');
  }
  // состав сцены 3D: узлы с зонами в метрах (привязка деталей модели к строкам сметы), трассы труб, подписи компонентов
  function spec3d(c, caps, sig) {
    var S3 = c.s3, hkNow = null, ang = tankAngle(), rotInfo = null, routes3 = S3.routes;
    try { hkNow = A && A.hydroFrameKey && A.hydroFrameKey(); } catch (e) { hkNow = null; }     // насос читается заново: сцена в кэше, а насос могли заменить
    var layers = S3.layers.map(function (l) {
      var fr = l.fr, ax = fr.ax, zs = [];
      Object.keys(fr.zones || {}).forEach(function (zn) {
        var q = fr.zones[zn];
        zs.push({ root: zn.split(':')[0], x0: (q[0] * fr.w - fr.o[0]) / ax.x[0], x1: (q[2] * fr.w - fr.o[0]) / ax.x[0], z0: (fr.o[1] - q[3] * fr.h) / Math.abs(ax.z[1]), z1: (fr.o[1] - q[1] * fr.h) / Math.abs(ax.z[1]) });
      });
      return { kind: l.kind, key: l.key, fid: l.fid, off: l.off, zones: zs, pf: l.kind === 'hydro' && hkNow ? hkNow.pf : l.pf, baked: l.baked, pid: l.kind === 'hydro' && hkNow ? hkNow.pid : l.pid };
    });
    var tk = layers.filter(function (l) { return l.kind === 'dhw' && l.fid === 'w0'; })[0], tpk = tk && DATA && DATA.PB['dhw:' + tk.key];
    if (tk && tpk && tpk.length >= 2) { var dP = -tpk[0].pos_m[1] - 0.05 + 0.05; tk.piv = dP; tk.rot = ang; if (ang) { try { rotInfo = tankRoutes(tk, tpk, S3.routes, ang); routes3 = rotInfo.routes; tk.dz = rotInfo.dz; tk.dy = rotInfo.dy; } catch (e) { console.warn('[3D] поворот бойлера не построен:', e); rotInfo = null; } } else { try { var li = tankLift(tk, tpk, S3.routes); if (li) { routes3 = li.routes; tk.dy = li.dy; } } catch (e) { console.warn('[3D] подъём бойлера не построен:', e); } } }
    return { sig: sig + (ang && rotInfo ? '|r' + ang : ''), baseSig: sig, rot: rotInfo ? ang : 0, layers: layers, routes: routes3, mat: S3.mat, comps: compItems(layers, caps), tank: tankName(), exp: S3.exp || [] };
  }
  // ── выноски показаний при включённом потоке: подача, обратка, скорость, расход по каждой системе (числа — из расчётов приложения)
  var FC_ICON = {
    boiler: '<path d="M12 3c.8 3 4 4.6 4 8.6a4 4 0 0 1-8 0c0-1.8.8-3 1.2-4.6C10.2 8 11.2 7 12 3z"/>',
    rad: '<rect x="5" y="5" width="3" height="14" rx="1.2"/><rect x="10.5" y="5" width="3" height="14" rx="1.2"/><rect x="16" y="5" width="3" height="14" rx="1.2"/>',
    floor: '<path d="M3 8c3 0 3 3 6 3s3-3 6-3 3 3 6 3M3 14c3 0 3 3 6 3s3-3 6-3 3 3 6 3"/>',
    dhw: '<path d="M7 5h10v12a5 2.2 0 0 1-10 0z"/><path d="M7 5a5 2.2 0 0 1 10 0"/>'
  };
  function fnum(v, k) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(k).replace('.', ','); }
  function flowCards(app, c) {
    var h; try { h = app.buildHydroCheckData(); } catch (e) { return ''; }
    if (!h || !h.rows) return '';
    var R = {}; h.rows.forEach(function (r) { R[r.id] = r; });
    var reg = app.radRegime(), sup = parseInt(reg.label, 10), ret = sup - reg.dt;
    var ufhDT = (app._ufhBal && app._ufhBal.dT) || parseInt(app.state.ufhDT, 10) || app.UFH_DTS[0], ufhSup = app.ufhSupply(ufhDT);
    var trunk = function (row) { var v = null; (row && row.parts || []).forEach(function (p) { if (v === null || p.v > v) v = p.v; }); return v; };
    // скорость в обвязке котла: расход / сечение трубы Ø22 (внутренний ≈ 20 мм) — оценка, помечена «≈»
    var vPipe = function (g) { return g == null ? null : g / 3600 / (Math.PI * 0.02 * 0.02 / 4); };
    var X = c.geom.x0, Y = c.geom.y0, S3 = c.s3, out = [];
    var saved = app.state.roomViewFc || {}, lines = [];
    // pt — точка съёма показаний на трубе, off — смещение выноски от неё по умолчанию (px сборки); перенесённое запоминается
    var add = function (id, kind, title, pt, a, off) {
      if (!pt) return;
      var ax = (pt[0] - X) / c.w * 100, ay = (pt[1] - Y) / c.h * 100, o = off || [0, 0];
      var left = saved[id] ? saved[id][0] : ax + o[0] / c.w * 100, top = saved[id] ? saved[id][1] : ay + o[1] / c.h * 100, side = left > 62 ? 'l' : 'r';
      var rows = '<div class="fc-r"><i class="d s"></i>Подача<b>' + a.sup + ' °C</b></div><div class="fc-r"><i class="d r"></i>Обратка<b>' + a.ret + ' °C</b></div>' +
        '<div class="fc-r"><i class="d v"></i>Скорость<b>' + (a.vApprox ? '≈ ' : '') + fnum(a.v, 2) + ' м/с</b></div><div class="fc-r"><i class="d g"></i>Расход<b>' + fnum(a.g, 2) + ' м³/ч</b></div>';
      lines.push('<line data-id="' + id + '" x1="' + ax.toFixed(2) + '%" y1="' + ay.toFixed(2) + '%" x2="' + left.toFixed(2) + '%" y2="' + top.toFixed(2) + '%"/><circle cx="' + ax.toFixed(2) + '%" cy="' + ay.toFixed(2) + '%" r="3.5"/>');
      out.push('<div class="rv-fc ' + kind + '" data-id="' + id + '" style="left:' + left.toFixed(2) + '%;top:' + top.toFixed(2) + '%" data-side="' + side + '">' +
        '<button type="button" class="fc-b" aria-label="' + esc(title) + '"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + FC_ICON[kind] + '</svg></button>' +
        '<div class="fc-card"><div class="fc-t">' + esc(title) + '</div>' + rows + '<div class="fc-s">' + esc(a.src) + '. Выноску можно перенести</div></div></div>');
    };
    var rlen = function (r) { var t = 0, i; for (i = 0; i < r.pp.length - 1; i++) t += Math.hypot(r.pp[i + 1][0] - r.pp[i][0], r.pp[i + 1][1] - r.pp[i][1]); return t; };
    var sups = S3.routes.filter(function (r) { return r.role === 'sup'; }), lds = S3.routes.filter(function (r) { return r.role === 'ld'; }).sort(function (a, b) { return rlen(b) - rlen(a); });
    if (R.boiler && sups[0]) add('boiler', 'boiler', 'Котёл: подача в обвязку', [sups[0].pp[0][0], sups[0].pp[0][1] + 150], { sup: sup, ret: ret, v: vPipe(R.boiler.flow), vApprox: true, g: R.boiler.flow, src: 'Режим ' + reg.label + ' из настроек радиаторов; расход — насос котла' }, [-170, 120]);
    if (R.dhw && lds[0]) {
      var pp = lds[0].pp, bi = 0, bl = 0, i;
      for (i = 0; i < pp.length - 1; i++) { var L = Math.hypot(pp[i + 1][0] - pp[i][0], pp[i + 1][1] - pp[i][1]); if (L > bl) { bl = L; bi = i; } }
      add('dhw', 'dhw', 'Бойлер: змеевик', [(pp[bi][0] + pp[bi + 1][0]) / 2, (pp[bi][1] + pp[bi + 1][1]) / 2], { sup: sup, ret: ret, v: vPipe(R.dhw.flow), vApprox: true, g: R.dhw.flow, src: 'Греющая вода с подачи котла, режим ' + reg.label }, [0, 230]);
    }
    var idxRad = 0, idxUfh = 0;
    (S3.cons || []).forEach(function (cn) {
      var tap = [cn.sup[0], Math.min(cn.sup[1], cn.ret[1]) - 120], off = [(cn.ret[0] - cn.sup[0]) / 2 - 0, -260];
      if (cn.kind === 'rad' && R.rad) add('rad' + (cn.kind === 'rad' ? (idxRad++) : ''), 'rad', 'Радиаторы' + (cn.kw ? ' · ' + cn.kw + ' кВт' : ''), tap, { sup: sup, ret: ret, v: trunk(R.rad), vApprox: trunk(R.rad) == null, g: R.rad.flow, src: 'Режим ' + reg.label + '; скорость — по подводке к коллектору' }, off);
      if (cn.kind === 'floor' && R.ufh) add('ufh' + (idxUfh++), 'floor', 'Тёплый пол' + (cn.kw ? ' · ' + cn.kw + ' кВт' : ''), tap, { sup: ufhSup, ret: ufhSup - ufhDT, v: trunk(R.ufh) == null ? vPipe(R.ufh.flow) : trunk(R.ufh), vApprox: trunk(R.ufh) == null, g: R.ufh.flow, src: 'Узел подмеса, перепад ' + ufhDT + ' К' }, off);
    });
    return '<svg class="rv-fcl">' + lines.join('') + '</svg>' + out.join('');
  }
  // ── стили: один раз в head (нужны и встроенному виду, и окну «На весь экран»)
  function css() {
    if (document.getElementById('rv_css')) return;
    var st = document.createElement('style'); st.id = 'rv_css';
    st.textContent =
      '.rv{max-width:1400px;margin:0 auto;padding:6px 0 2px}' +
      '.rv-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 8px}' +
      '.rv-title{font:600 15px/1.2 system-ui,Arial,sans-serif;letter-spacing:.01em;opacity:.85}' +
      '.rv-stage{position:relative;border-radius:14px;overflow:hidden;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 6px 24px rgba(0,0,0,.18)}' +
      '.rv-stage.zoomable{cursor:zoom-in}' +
      '.rv-stage img,.rv-stage canvas{display:block;width:100%}.rv-stage canvas{position:absolute;inset:0;height:100%}.rv-ov{pointer-events:none}' +
      '.rv-tip{position:absolute;pointer-events:none;z-index:3;max-width:260px;padding:8px 11px;border-radius:10px;background:rgba(17,24,39,.94);color:#fff;font:12px/1.35 system-ui,Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s}' +
      '.rv-tip.on{opacity:1;transform:none}.rv-tip b{display:block;font-weight:600;font-size:13px;margin-bottom:2px}.rv-tip span{opacity:.72}' +
      /* выноски показаний потока */
      '.rv-fc{position:absolute;z-index:4;transform:translate(-50%,-50%)}' +
      '.fc-b{position:relative;width:34px;height:34px;border-radius:50%;border:2px solid rgba(255,255,255,.95);background:#2563EB;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;box-shadow:0 3px 10px rgba(15,23,42,.35);transition:transform .15s}' +
      '.fc-b svg{width:18px;height:18px}.fc-b:hover,.rv-fc.pin .fc-b{transform:scale(1.12)}' +
      '.fc-b::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:2px solid currentColor;opacity:0;animation:fcp 2.4s ease-out infinite}' +
      '.rv-fc.boiler .fc-b{background:#E53935;color:#E53935}.rv-fc.rad .fc-b{background:#F57C00;color:#F57C00}.rv-fc.floor .fc-b{background:#7C3AED;color:#7C3AED}.rv-fc.dhw .fc-b{background:#0891B2;color:#0891B2}' +
      '@keyframes fcp{0%{transform:scale(.8);opacity:.55}100%{transform:scale(1.45);opacity:0}}' +
      '.fc-card{position:absolute;top:50%;min-width:206px;padding:10px 12px 9px;border-radius:12px;background:rgba(15,23,42,.95);color:#fff;font:12px/1.3 system-ui,Arial,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.4);opacity:0;pointer-events:none;transform:translateY(-50%) scale(.96);transition:opacity .14s,transform .14s;backdrop-filter:blur(6px)}' +
      '.rv-fc[data-side=r] .fc-card{left:calc(100% + 10px)}.rv-fc[data-side=l] .fc-card{right:calc(100% + 10px)}' +
      '.rv-fc:hover .fc-card,.rv-fc.pin .fc-card{opacity:1;pointer-events:auto;transform:translateY(-50%) scale(1)}.rv-fc:hover,.rv-fc.pin{z-index:6}' +
      '.fc-t{font-weight:600;font-size:13px;margin-bottom:6px}.fc-r{display:flex;align-items:center;gap:7px;padding:2px 0;opacity:.95}.fc-r b{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums;padding-left:12px}' +
      '.fc-r .d{width:8px;height:8px;border-radius:50%;flex:none}.d.s{background:#EF4444}.d.r{background:#3B82F6}.d.v{background:#22C55E}.d.g{background:#A3A3A3}' +
      '.rv-fcl{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}.rv-fcl line{stroke:#334155;stroke-width:1.4;stroke-dasharray:3 4;opacity:.85}.rv-fcl circle{fill:#fff;stroke:#334155;stroke-width:1.4}' +
      '.fc-b{cursor:grab;touch-action:none}.fc-b:active{cursor:grabbing}' +
      '.fc-s{margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.14);font-size:10.5px;opacity:.6}' +
      /* окно «На весь экран»: панель значков в духе Revit, одна на все виды */
      '.rv-gap{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.55);font:13px/1.45 system-ui,Arial,sans-serif}.rv-gap b{font-weight:600}' +
      '.rvm{position:fixed;inset:0;z-index:99990;background:#E3E6EA;overflow:hidden;font-family:system-ui,Arial,sans-serif}' +
      '.rvm-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:72px 236px 22px}' +
      '.rvm-stage.is3d{padding:0}.rvm-stage.is3d .r3{position:absolute;inset:0;border-radius:0;height:100%}' +
      '.rvm-stage .rv-stage{box-shadow:0 8px 30px rgba(15,23,42,.18)}' +
      '.rvm-load{font:500 14px system-ui,Arial,sans-serif;color:#475569}' +
      '.rvm-bar{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:5;display:flex;align-items:center;gap:2px;padding:5px;border-radius:14px;background:rgba(255,255,255,.93);backdrop-filter:blur(8px);box-shadow:0 4px 18px rgba(15,23,42,.18);border:1px solid rgba(15,23,42,.08)}' +
      '.rvm-bar button{position:relative;width:36px;height:36px;border:0;border-radius:9px;background:transparent;color:#334155;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:background .12s,color .12s}' +
      '.rvm-bar button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
      '.rvm-bar button:hover{background:rgba(37,99,235,.1);color:#1D4ED8}.rvm-bar button.on{background:#2563EB;color:#fff}' +
      '.rvm-bar .sep{width:1px;height:22px;margin:0 5px;background:rgba(15,23,42,.14)}' +
      '.rvm-bar button[data-a=close]:hover{background:rgba(220,38,38,.12);color:#B91C1C}' +
      '.rvm-bar [data-tip]:hover::after{content:attr(data-tip);position:absolute;top:calc(100% + 9px);left:50%;transform:translateX(-50%);white-space:nowrap;background:#0F172A;color:#fff;font:12px system-ui,Arial,sans-serif;padding:5px 9px;border-radius:7px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.3)}' +
      '.rvm-toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);padding:8px 14px;border-radius:9px;background:rgba(17,24,39,.9);color:#fff;font:12.5px system-ui,Arial,sans-serif;opacity:0;pointer-events:none;transition:opacity .2s;z-index:6;white-space:nowrap}.rvm-toast.on{opacity:1}' +
      '.rvm-list{position:absolute;right:14px;top:70px;bottom:18px;width:318px;z-index:4;overflow:auto;padding:12px 12px 10px;border-radius:14px;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);box-shadow:0 8px 28px rgba(15,23,42,.2);border:1px solid rgba(15,23,42,.08);color:#0f172a;font:12.5px/1.35 system-ui,Arial,sans-serif}' +
      '.rvm-list h4{margin:0 0 2px;font:600 14px system-ui,Arial,sans-serif}.rvm-list .sub{opacity:.6;font-size:11.5px;margin-bottom:8px}' +
      '.rvm-list .grp{margin:10px 0 4px;font:600 11px system-ui,Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase;opacity:.55}' +
      '.rvm-list .row{display:flex;align-items:flex-start;gap:8px;padding:4px 0;border-top:1px solid rgba(15,23,42,.06)}' +
      '.rvm-list .dot{flex:none;width:9px;height:9px;margin-top:4px;border-radius:50%;background:#16A34A}.rvm-list .row.no .dot{background:#F59E0B}.rvm-list .row.nos .dot{background:#DC2626}' +
      '.rvm-list .t{flex:1}.rvm-list .q{opacity:.55;white-space:nowrap}.rvm-list .n{display:block;font-size:11px;opacity:.6}' +
      '.rvm-list .sum{margin-top:10px;padding-top:8px;border-top:1px solid rgba(15,23,42,.12);font-size:11.5px;opacity:.75}' +
      '.rvm-lbl{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}' +
      '@media (max-width:900px){.rvm-stage{padding:68px 120px 16px}}';
    document.head.appendChild(st);
  }
  var IC = {
    scheme: '<rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/><path d="M10 7h4a3 3 0 0 1 3 3v4"/>',
    real: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    flow: '<path d="M3 8h14l-3-3M21 16H7l3 3"/>',
    hl: '<path d="M5 3l14 7-6 2-2 6z"/>',
    tag: '<path d="M3 12l9-9h8v8l-9 9z"/><circle cx="16" cy="8" r="1.3"/>',
    ghost: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5" opacity=".55"/>',
    pin: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    pinall: '<path d="M6 3h12v18l-6-4-6 4z"/><path d="M12 7v6M9 10h6"/>',
    undo: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    check: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
    cover: '<rect x="5" y="3" width="14" height="18" rx="3.5"/><circle cx="9.5" cy="8" r="1.7"/><circle cx="14.5" cy="8" r="1.7"/><rect x="8" y="12" width="8" height="5" rx="1"/>',
    x: '<path d="M5 5l14 14M19 5L5 19"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'
  };
  function ibtn(a, ic, tip, on) { return '<button type="button" data-a="' + a + '" data-tip="' + tip + '" aria-label="' + tip + '" class="' + (on ? 'on' : '') + '"><svg viewBox="0 0 24 24">' + IC[ic] + '</svg></button>'; }

  // ── позиции, которые есть в смете, но на виде не показаны: для них нет кадра. Раньше такой котёл, коллектор или бойлер
  // пропадали молча, а вид выглядел полным. Теперь под видом — плашка «Нет полного соответствия проекту» со списком.
  // база ключа котла без признаков состава сметы и бренда кранов: haier2_rm_ns -> haier2, status27_n -> status27, polis_r -> polis
  function bBase(k) { return String(k).replace(/_(rm|c|n|nf|sf|ns|s1|r)(?=_|$)/g, ''); }
  function hasFrame(idx, key) { var b = bBase(key); return Object.keys(idx).some(function (k) { return bBase(k) === b; }); }
  var CATB = null;
  function boilerIds() {
    if (CATB) return CATB;
    CATB = {};
    try {
      ['boilers_gas', 'boilers_baxi', 'boilers_vaillant', 'boilers_navien', 'boilers_plus', 'boilers_status', 'boilers_polis', 'boilers_el_analogs']
        .forEach(function (k) { (catalog[k] || []).forEach(function (b) { CATB[String(b.id)] = b; }); });
    } catch (e) { CATB = {}; }
    return CATB;
  }
  function gapList(app) {
    var eq = (app.currentEquipmentList || []).filter(function (it) { return !it.isOpt; }), out = [];
    var sk = function (it) { return String(it.displaySku || it.id || ''); };
    var nm = function (it) { return ((it.brand ? it.brand + ' ' : '') + String(it.name || sk(it))).replace(/\s+/g, ' ').trim(); };
    var seen = {};
    var add = function (kind, it) { var k = kind + '|' + nm(it); if (!seen[k]) { seen[k] = 1; out.push({ kind: kind, name: nm(it) }); } };
    // котлы: в списке сметы у них нет ни группы, ни типа, поэтому узнаём их по артикулам каталога (газовые Haier, Baxi, Vaillant,
    // Navien; электрические STATUS, POLIS, PLUS и аналоги). Свой кадр есть у Haier GE0Q6 (и PNGB одноконтурных, как у Haier),
    // STOUT STATUS и POLIS.
    var cb = boilerIds();
    eq.forEach(function (it) {
      if (!cb[String(it.id)] && !cb[sk(it)]) return;
      var key = null;
      try { key = app.boilerFrameKey(it); } catch (e) { key = null; }
      if (!key && /^PNGB/i.test(sk(it)) && /одноконтур/i.test(String(it.name || ''))) key = 'haier1';
      if (!key) { add('котёл', it); return; }
      if (DATA && DATA.BI && !hasFrame(DATA.BI, key)) add('котёл', it);
    });
    // коллектор и насосные группы: вид строится только для коллекторов SDG-0016/0018, RDG-0017/1017 с группами DN25 своего бренда
    var hyd = eq.filter(function (it) { return /^2\.4/.test(String(it.group || '')) && /^(SDG-00(16|18)|RDG-(0017|1017)|МУ|MU|SDG-0120|RDG-0120|SDG-0038|SVM-0025)/i.test(sk(it)); });
    var hk = null;
    try { hk = app.hydroFrameKey(); } catch (e) { hk = null; }
    var hpick = hk && DATA && DATA.HI ? pickHydro(DATA.HI, hk.key) : null;
    if (hyd.length && !hk) hyd.forEach(function (it) { add('коллектор, узел или группа', it); });
    else if (hk && DATA && DATA.HI && !hpick) hyd.forEach(function (it) { add('коллектор, узел или группа', it); });
    else if (hk && hpick && hpick !== hk.key) out.push({ kind: 'насос', name: 'насос ' + hk.pump + ' (на виде показан ближайший по бренду)' });
    // бойлер: кадры есть у SWH-1110/2110/3110/4110 и RWH-2110
    eq.forEach(function (it) {
      if (!/^2\.3/.test(String(it.group || ''))) return;
      if (/^(SWH|RWH)-(1110|2110|3110|4110)-/i.test(sk(it))) return;
      if (/^(Бойлер|Водонагреватель)/i.test(String(it.name || ''))) add('бойлер', it);
    });
    return out;
  }
  function gapHtml(app) {
    var g;
    try { g = gapList(app); } catch (e) { g = []; }
    if (!g.length) return '';
    css();
    return '<div class="rv-gap"><b>Нет полного соответствия проекту.</b> На виде не показано, потому что для этих позиций нет готовой модели: ' +
      g.map(function (x) { return x.kind === 'насос' ? esc(x.name) : esc(x.name) + ' (' + x.kind + ')'; }).join('; ') +
      '. Они есть в смете и в таблице, на схему не попали.</div>';
  }

  // ── встроенный вид: всегда плоская картинка в размер рендера, как у остальных листов; управление — в окне «На весь экран»
  function inlineView(app, c, st) {
    css();
    return '<div class="rv"><div class="rv-head"><div class="rv-title">Общий вид котельной</div></div>' +
      '<div class="rv-stage zoomable" data-style="' + st + '" onclick="RoomView.openFull()" title="Открыть на весь экран"><img src="' + c.url + '" alt="Общий вид котельной">' +
      '<button type="button" class="scheme-zoom-btn" aria-label="На весь экран">⛶ На весь экран</button></div>' + gapHtml(app) + '</div>';
  }

  // ── окно «На весь экран»
  var FULL = false, MODAL = null, CUR = null;
  function fullStyle(app) {
    if (!proOf(app)) return 'scheme';
    var v = app.state.roomViewStyle;
    return v === 'scheme' ? 'scheme' : v === '3d' ? '3d' : (app.state.roomViewFlow ? 'flow' : 'real');
  }
  function toast(t) { if (!MODAL) return; var e = MODAL.querySelector('.rvm-toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('on'); }, 2600); }
  function barFull(app, st) {
    var pro = proOf(app), h = '';
    if (pro) h += ibtn('v:scheme', 'scheme', 'Схема', st === 'scheme') + ibtn('v:real', 'real', 'Реалистично', st === 'real' || st === 'flow') + ibtn('v:3d', 'cube', '3D: вращение и приближение', st === '3d') + '<i class="sep"></i>';
    h += ibtn('hl', 'hl', 'Подсветка деталей и строк сметы', !!app.state.roomViewHl) + ibtn('lbl', 'tag', 'Подписи позиций', !!app.state.roomViewLabels) + ibtn('list', 'list', 'Состав котельной: единый список позиций', !!app.state.roomViewList);
    if (pro && (st === 'real' || st === 'flow')) h += ibtn('flow', 'flow', 'Поток теплоносителя и показания', st === 'flow');
    if (st === '3d') {
      h += '<i class="sep"></i>' + ibtn('check', 'check', 'Проверка сборки: красным подсвечиваются неподключённые трубы и порты, углы без фитинга, пересечения; жёлтым — свободные порты', !!(window.Room3D && window.Room3D.checkOn && window.Room3D.checkOn())) + ibtn('covers', 'cover', 'Крышки теплоизоляции насосных групп: открыть или закрыть все', !!(window.Room3D && window.Room3D.coversOpen && window.Room3D.coversOpen())) + ibtn('fade', 'ghost', 'Прозрачность: щёлкните по детали', !!(window.Room3D && window.Room3D.isFade())) +
        ibtn('save', 'pin', 'Зафиксировать вид для себя') + (app.wmPreviewOn() ? ibtn('saveall', 'pinall', 'Вид по умолчанию для всех') : '') + ibtn('home', 'undo', 'Сбросить вид');
    }
    h += '<i class="sep"></i>' + ibtn('close', 'x', 'Закрыть (Esc)');
    MODAL.querySelector('.rvm-bar').innerHTML = h;
  }
  function openFull() {
    if (!A) return;
    css(); FULL = true;
    if (!MODAL) {
      MODAL = document.createElement('div'); MODAL.className = 'rvm';
      MODAL.innerHTML = '<div class="rvm-bar"></div><div class="rvm-stage"></div><div class="rvm-list" style="display:none"></div><div class="rvm-toast"></div>';
      MODAL.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.rvm-bar button'); if (b) act(b.getAttribute('data-a')); });
      document.addEventListener('keydown', function (e) { if (FULL && e.key === 'Escape') closeFull(); });
      window.addEventListener('resize', function () { if (FULL) drawFlatLabels(); });
    }
    document.body.appendChild(MODAL); document.body.style.overflow = 'hidden';
    renderFull();
  }
  function closeFull() {
    FULL = false; HL = null; CUR = null;
    if (window.Room3D) window.Room3D.hide();
    if (MODAL && MODAL.parentNode) MODAL.remove();
    document.body.style.overflow = '';
    if (A) A.render();
  }
  function act(a) {
    var app = A; if (!app) return;
    var st = CUR ? CUR.st : fullStyle(app);
    if (a === 'close') { closeFull(); return; }
    if (a.indexOf('v:') === 0) { app.state.roomViewStyle = a.slice(2); app.saveState(); renderFull(); return; }
    if (a === 'flow') { app.state.roomViewFlow = !app.state.roomViewFlow; app.state.roomViewStyle = 'real'; app.saveState(); renderFull(); return; }
    if (a === 'list') { app.state.roomViewList = !app.state.roomViewList; app.saveState(); barFull(app, st); drawList(); return; }
    if (a === 'hl' || a === 'lbl') {
      var k = a === 'hl' ? 'roomViewHl' : 'roomViewLabels';
      app.state[k] = !app.state[k]; app.saveState();
      if (st === '3d') barFull(app, st); else renderFull();
      return;
    }
    if (st === '3d' && window.Room3D && (a === 'fade' || a === 'check' || a === 'covers' || a === 'save' || a === 'saveall' || a === 'home')) {
      var r = window.Room3D.cmd(a);
      if (r && r.msg) toast(r.msg);
      barFull(app, st);
    }
  }
  function renderFull() {
    if (!FULL || !MODAL) return;
    var app = A, st = fullStyle(app), stage = MODAL.querySelector('.rvm-stage');
    barFull(app, st);
    var kk = st === 'flow' ? 'flowbase' : st === '3d' ? 'real' : st;
    var e = entry(app, kk);
    if (!e) { CUR = null; if (window.Room3D) window.Room3D.hide(); stage.className = 'rvm-stage'; stage.innerHTML = '<div class="rvm-load">' + (e === false ? 'Для этой сметы общий вид не собирается: в ней нет котла с обвязкой.' : 'Собираю вид…') + '</div>'; return; }
    CUR = { st: st, c: e.c, caps: e.caps, sig: e.sig };
    drawList();
    if (st === '3d') {
      stage.className = 'rvm-stage is3d'; stage.innerHTML = '';
      if (window.Room3D) window.Room3D.show(stage, spec3d(e.c, e.caps, e.sig), app, { embedded: true });
      else stage.innerHTML = '<div class="rvm-load">3D недоступно</div>';
      return;
    }
    if (window.Room3D) window.Room3D.hide();
    var c = e.c, W = c.w, H = c.h, hl = !!app.state.roomViewHl;
    if (hl) {
      HL = { c: c, comps: compItems(c.geom.layers, e.caps), maps: [], cur: null };
      var mine = HL;
      Promise.all(c.geom.layers.map(function (L) { return labelMap(L.kind, L.key).then(function (m) { return m ? { L: L, m: m } : null; }); }))
        .then(function (r) { if (HL === mine) mine.maps = r.filter(Boolean).sort(drawOrder); });
    } else HL = null;
    bind(app);
    flowData = st === 'flow' ? c.flow : null;
    stage.className = 'rvm-stage';
    stage.innerHTML = '<div class="rv-stage" data-style="' + st + '"' + (hl ? ' data-hl="1"' : '') + ' style="aspect-ratio:' + W + '/' + H + ';width:min(100%,calc((100vh - 94px) * ' + (W / H).toFixed(4) + '))"><img src="' + c.url + '" alt="Общий вид котельной">' +
      (st === 'flow' ? '<canvas class="rv-flow" width="' + W + '" height="' + H + '"></canvas>' : '') +
      (hl ? '<canvas class="rv-ov"></canvas>' : '') + (st === 'flow' ? flowCards(app, c) : '') + '<div class="rv-tip"></div></div>' +
      '<svg class="rvm-lbl"></svg>';
    if (st === 'flow') setTimeout(animate, 0);
    var img = stage.querySelector('img'); if (img) img.onload = drawFlatLabels;
    drawFlatLabels();
  }

  // ── единый список позиций: тот же перечень, что строит главную схему (boiler_room_list.js), со статусом «есть на виде»
  var EST_RE = { gas: /котёл газовый|котел газовый/i, el: /котёл электрический|котел электрический|STATUS/i, indirect: /бойлер|водонагревател/i,
    exp_heat: /расширительный бак для отопления/i, exp_dhw: /расширительный бак для ГВС/i, hydro: /коллектор|гидрострелк/i, airsep: /сепаратор воздуха/i,
    tp: /узел подмеса|группа насосн|насосная группа/i, rad: /радиатор|группа насосн|насос/i, snow: /снеготаян/i };
  function viewHas(id, e) {
    var L = e.c.geom.layers, cons = (e.c.s3 && e.c.s3.cons) || [];
    var has = function (kind, re) { return L.some(function (l) { return l.kind === kind && (!re || re.test(l.key)); }); };
    var hk = (L.filter(function (l) { return l.kind === 'hydro'; })[0] || {}).key || '', grp = (hk.split('_')[1] || '');
    var anyB = function (re) { return L.some(function (l) { return l.kind === 'boiler' && re.test(l.key); }); };
    switch (id) {
      case 'gas': return anyB(/^(haier|navien|baxi|vaillant)/i);
      case 'el': return anyB(/^(status|polis)/i);
      case 'indirect': return L.some(function (l) { return l.kind === 'dhw' && !/^ex/.test(l.fid || ''); });
      case 'exp_heat': return L.some(function (l) { return l.fid === 'exh'; });
      case 'exp_dhw': return L.some(function (l) { return l.fid === 'exw'; });
      case 'hydro': return has('hydro');
      case 'airsep': return L.some(function (l) { return l.kind === 'boiler' && !/_ns/.test(l.key); }) || has('hydro');
      case 'rad': return cons.some(function (c) { return c.kind === 'rad'; });
      case 'tp': return cons.some(function (c) { return c.kind === 'floor'; });
      case 'fit_ball': case 'fit_check': return has('boiler');
      case 'fit_pump': return has('hydro');
      case 'fit_servo': return /s/.test(grp);
      case 'fit_therm': return /m/.test(grp);
      case 'fit_airvent': return has('hydro') || L.some(function (l) { return l.kind === 'boiler' && !/_ns/.test(l.key); });
      case 'fit_filter': return L.some(function (l) { return l.kind === 'boiler' && !/_nf/.test(l.key); });
      case 'fit_prio': return anyB(/^status/i);
      case 'line_Т1': case 'line_Т2': return cons.some(function (c) { return c.kind === 'rad'; });
      case 'line_Т11': case 'line_Т21': return cons.some(function (c) { return c.kind === 'floor'; });
      default: return false;
    }
  }
  function listData(app, e) {
    var BRL = window.BoilerRoomList, cfg = app.buildSchemeConfig && app.buildSchemeConfig();
    if (!BRL || !cfg) return null;
    var eq = (app.currentEquipmentList || []).filter(function (it) { return !it.isOpt; });
    var inEst = function (id) { var re = EST_RE[id]; return re ? eq.some(function (it) { return re.test(it.name || ''); }) : null; };
    return BRL.positions(cfg).map(function (p) {
      return { id: p.id, group: p.group, title: p.title, qty: p.qty, onView: viewHas(p.id, e), inEst: p.group === 'equip' || p.group === 'consumer' ? inEst(p.id) : null };
    });
  }
  function drawList() {
    if (!FULL || !MODAL) return;
    var box = MODAL.querySelector('.rvm-list');
    if (!A.state.roomViewList || !CUR) { box.style.display = 'none'; return; }
    var rows = listData(A, CUR);
    if (!rows) { box.style.display = 'none'; return; }
    var G = { equip: 'Оборудование', consumer: 'Потребители', fit: 'Арматура', line: 'Линии (маркировка на схеме)' }, h = '<h4>Состав котельной</h4><div class="sub">Тот же список, по которому строится главная схема. Зелёная точка: позиция есть на общем виде.</div>';
    ['equip', 'consumer', 'fit', 'line'].forEach(function (g) {
      var part = rows.filter(function (r) { return r.group === g; });
      if (!part.length) return;
      h += '<div class="grp">' + G[g] + '</div>';
      part.forEach(function (r) {
        var cls = r.onView ? '' : ((r.inEst === false) ? ' nos' : ' no'), note = r.onView ? '' : (r.inEst === false ? 'есть на схеме, в смете не найдено' : 'есть на схеме, на виде пока нет');
        h += '<div class="row' + cls + '"><i class="dot"></i><span class="t">' + esc(r.title) + (note ? '<span class="n">' + note + '</span>' : '') + '</span>' + (r.qty > 1 ? '<span class="q">× ' + r.qty + '</span>' : '') + '</div>';
      });
    });
    var main = rows.filter(function (r) { return r.group === 'equip' || r.group === 'consumer'; }), on = main.filter(function (r) { return r.onView; }).length;
    h += '<div class="sum">Оборудование и потребители на виде: ' + on + ' из ' + main.length + '.</div>';
    box.innerHTML = h; box.style.display = '';
  }

  // ── подписи позиций с линиями-выносками (плоские виды): якорь — центр самой крупной детали класса на карте кадра
  function instStats(m) {
    if (m.stats) return m.stats;
    var n = m.inst.length, cnt = new Float64Array(n), sx = new Float64Array(n), sy = new Float64Array(n), i, id;
    for (i = 0; i < m.w * m.h; i++) { id = m.lab[i]; if (id) { cnt[id]++; sx[id] += i % m.w; sy[id] += (i / m.w) | 0; } }
    return (m.stats = { cnt: cnt, sx: sx, sy: sy });
  }
  function flatAnchors(c, comps, maps) {
    var best = {};
    maps.forEach(function (o) {
      var L = o.L, m = o.m, sc = PXM / Math.hypot(L.fr.ax.x[0], L.fr.ax.x[1]), s = instStats(m), id, key;
      for (id = 1; id < m.inst.length; id++) {
        key = L.kind + '|' + L.fid + '|' + m.inst[id].cls;
        if (!comps[key] || s.cnt[id] < 6) continue;
        if (!best[key] || s.cnt[id] > best[key].n) best[key] = { key: key, n: s.cnt[id], x: (L.x - c.geom.x0) + (s.sx[id] / s.cnt[id] + 0.5) * HL_S * sc, y: (L.y - c.geom.y0) + (s.sy[id] / s.cnt[id] + 0.5) * HL_S * sc, text: comps[key].t1 };
      }
    });
    return Object.keys(best).map(function (k) { return best[k]; });
  }
  // крупное оборудование подписано всегда; мелкие позиции (американки, муфты, воздухоотводчики…) — только при наведении или щелчке по ним
  function tankName() {
    var it = (A.currentEquipmentList || []).filter(function (e) { return !e.isOpt && /бойлер|водонагревател|накопительн/i.test(e.name || ''); })[0];
    if (!it) return null;
    var n = String(it.name).replace(/\s+/g, ' ');
    return n.length > 46 ? n.slice(0, 44).replace(/\s+\S*$/, '') + '…' : n;
  }
  function isMajor(t) { return /^(Котёл|Котел|Бойлер|Водонагревател|Накопител|Группы? насосн|Насос|Фильтр|Коллектор|Расширительн)/i.test(t) || /бойлер|водонагревател/i.test(t); }
  function drawFlatLabels() {
    if (!FULL || !MODAL || !CUR || CUR.st === '3d') return;
    var svg = MODAL.querySelector('.rvm-lbl'), stg = MODAL.querySelector('.rv-stage'), cont = MODAL.querySelector('.rvm-stage');
    if (!svg || !stg) return;
    if (!A.state.roomViewLabels || !window.RoomLabels) { svg.innerHTML = ''; LB = null; return; }
    var c = CUR.c;
    if (!LB || LB.c !== c) {
      LB = { c: c, comps: compItems(c.geom.layers, CUR.caps), maps: null, hover: null, pins: {}, anchors: null };
      var mine = LB;
      Promise.all(c.geom.layers.map(function (L) { return labelMap(L.kind, L.key).then(function (m) { return m ? { L: L, m: m } : null; }); })).then(function (maps) {
        if (LB === mine) { mine.maps = maps.filter(Boolean).sort(drawOrder); drawFlatLabels(); }
      });
      return;
    }
    if (!LB.maps) return;
    if (!LB.anchors) LB.anchors = flatAnchors(c, LB.comps, LB.maps);
    var cr = cont.getBoundingClientRect(), ir = stg.getBoundingClientRect(), k = ir.width / c.w;
    var items = LB.anchors.filter(function (it) { return isMajor(it.text) || it.key === LB.hover || LB.pins[it.key]; }).map(function (it) {
      return { x: ir.left - cr.left + it.x * k, y: ir.top - cr.top + it.y * k, text: it.text };
    });
    var tl = c.geom.layers.filter(function (L) { return L.kind === 'dhw' && !/^ex/.test(L.fid || ''); })[0], tn = tl && tankName();
    ((c.s3 && c.s3.exp) || []).forEach(function (ex) {
      var le = c.geom.layers.filter(function (L) { return L.fid === ex.fid; })[0];
      if (le) items.push({ x: ir.left - cr.left + (le.x - c.geom.x0 + le.w * 0.5) * k, y: ir.top - cr.top + (le.y - c.geom.y0 + le.h * 0.28) * k, text: ex.text });
    });
    if (tn) items.push({ x: ir.left - cr.left + (tl.x - c.geom.x0 + tl.w * 0.5) * k, y: ir.top - cr.top + (tl.y - c.geom.y0 + tl.h * 0.5) * k, text: tn });
    window.RoomLabels.draw(svg, items, cr.width, cr.height);
  }
  // бегущие стрелки потока по трубам (стиль «Поток»): один цикл анимации на страницу, останавливается, когда холста нет в документе
  function chev(g, f, off, Wd) {
    var step = 120, pp = f.pp, tot = 0, i;
    for (i = 0; i < pp.length - 1; i++) tot += Math.hypot(pp[i + 1][0] - pp[i][0], pp[i + 1][1] - pp[i][1]);
    for (var d = (off % step); d < tot; d += step) {
      var dd = d, k = 0;
      while (k < pp.length - 2 && dd > Math.hypot(pp[k + 1][0] - pp[k][0], pp[k + 1][1] - pp[k][1])) { dd -= Math.hypot(pp[k + 1][0] - pp[k][0], pp[k + 1][1] - pp[k][1]); k++; }
      var a1 = pp[k], b1 = pp[k + 1], L = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]); if (L < 1) continue;
      var ux = (b1[0] - a1[0]) / L, uy = (b1[1] - a1[1]) / L, h = Wd * 0.55;
      g.save(); g.translate(a1[0] + ux * dd, a1[1] + uy * dd); g.rotate(Math.atan2(uy, ux));
      g.fillStyle = '#fff'; g.strokeStyle = f.col; g.lineWidth = 3; g.beginPath(); g.moveTo(h, 0); g.lineTo(-h * 0.7, -h); g.lineTo(-h * 0.3, 0); g.lineTo(-h * 0.7, h); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }
  var animOn = false, flowData = null;
  function animate() {
    if (animOn) return; animOn = true;
    var t0 = performance.now();
    (function loop(t) {
      var cv = document.querySelector('canvas.rv-flow');
      if (!cv || !flowData) { animOn = false; return; }
      var g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
      flowData.forEach(function (f) { chev(g, f, (t - t0) / 1000 * 70, f.W || (window.RoomPipe && A ? window.RoomPipe.sys(A.boilerPipeSystem()).od : 22) * PXM / 1000); });
      requestAnimationFrame(loop);
    })(t0);
  }
  // вид собирается по составу сметы один раз на сигнатуру (стиль + кадры + бойлер + материал труб + мощности групп)
  function entry(app, kk) {
    app.boilerIndex(); app.nodeIndex('hydro', app.HYDRO_DIR, 'hydro.json?v=6'); app.nodeIndex('dhw', app.DHW_DIR, 'dhw.json?v=3');
    var caps = capture(app);
    var bc = caps.filter(function (c) { return c.kind === 'boiler'; })[0];
    if (!bc) return false;                 // false — вид для этой сметы не собирается (нет котла с обвязкой); null — ещё собирается
    var hk = app.hydroFrameKey(), dk = dhwKeys();
    var sig = JSON.stringify([kk, bc.frames.map(function (f) { return [f.key, f.it && (f.it.q || f.it.qty || 1)]; }), hk && hk.key.replace(/_p[a-z0-9]+$/, ''), dk && dk.tank, app.boilerPipeSystem && app.boilerPipeSystem(), groupKw(), plainCons().map(function (q) { return q.kind + q.kw; }), app._bpSz && [app._bpSz.main, app._bpSz.tank, app._bpSz.per], app._dhwLoad && app._dhwLoad.size]);
    var c = cache[sig];
    if (c === 'wait') return null;
    if (!c) {
      cache[sig] = 'wait';
      canvasOf(3, kk).then(function (cv) {
        if (!cv) { cache[sig] = { none: true }; return; }
        var ready = function (u) { cache[sig] = { url: u, w: cv.width, h: cv.height, geom: cv._geom, flow: cv._flow, s3: cv._s3 }; app.render(); if (FULL) renderFull(); };
        if (cv.toBlob) cv.toBlob(function (b) { ready(b ? URL.createObjectURL(b) : cv.toDataURL('image/png')); }, 'image/png'); else ready(cv.toDataURL('image/png'));
      }).catch(function (e) { console.warn('[вид котельной] не собран:', e); cache[sig] = { none: true }; });
      return null;
    }
    if (c.none) return false;
    return { c: c, caps: caps, sig: sig };
  }
  function html(app) {
    if (!(PUBLIC_ALL || app.wmPreviewOn())) return '';
    A = app;
    if (!DATA) { load(app); return ''; }
    // встроенный вид — всегда плоский: «Схема» или «Реалистично»; 3D и поток открываются только в окне «На весь экран»
    var st = (!proOf(app) || app.state.roomViewStyle === 'scheme') ? 'scheme' : 'real';
    var e = entry(app, st);
    if (!e) {
      var gh = gapHtml(app);
      return gh ? '<div class="rv"><div class="rv-head"><div class="rv-title">Общий вид котельной</div></div>' + gh + '</div>' : '';
    }
    return inlineView(app, e.c, st);
  }

  // ── замена насоса группы прямо на 3D-виде (room_3d.js): варианты по бренду текущего насоса (STOUT: четыре, ROMMER: два), замена —
  // штатной функцией приложения, как щелчком по строке таблицы замен, поэтому пересчитываются смета, подбор и подписи
  var PUMP_FAM = { 'SPC-0011-2560180': 'default', 'SPC-0010-2560180': 'p10', 'SPC-0002-2560180': 'pmini', 'SPC-0003-2560180': 'pminipro', 'RCP-0004-2560180': 'pprofi', 'RCP-0030-2560180': 'pevo' };
  function pumpOptions() {
    var hk = null;
    try { hk = A && A.hydroFrameKey && A.hydroFrameKey(); } catch (e) { hk = null; }
    if (!hk || hk.dn === 20) return null;               // DN20: насосы 15/60 — замены на 3D-виде нет
    var cur = hk.pid, rm = /^RCP-/.test(cur), seen = {}, list = [];
    ((typeof catalog !== 'undefined' && catalog.pumps_dn25) || []).forEach(function (p) {
      var it = rm ? p.rommer : p;
      if (!it || seen[it.id]) return;
      seen[it.id] = 1;
      list.push({ id: it.id, name: String(it.name || '').replace(/^Насос\s+/i, ''), price: it.price, fam: PUMP_FAM[it.id] || 'default', cur: it.id === cur, desc: p.desc || '' });
    });
    return { cur: cur, list: list };
  }
  function pumpSwap(id) {
    var eq = (A && A.currentEquipmentList) || [];
    var it = eq.filter(function (x) { return !x.isOpt && /^(SPC|RCP)-\d{4}-2560180$/.test(String(x.displaySku || x.id)); })[0];
    if (!it) return false;
    A.selectSwapAlternative(it.originalId || it.id, id);
    return true;
  }


  // ── поворот бойлера вокруг своей оси на 3D-виде (0, 90, 180, 270°; 90 — термометром к зрителю, патрубками к стене). Бойлер сдвигается от
  // стены по глубине так, чтобы патрубки с арматурой не упёрлись в неё, а две трубы змеевика (подача и обратка) прокладываются заново:
  // от стыка с магистралью по своим плоскостям (подача 40 мм, обратка 70 мм от стены), в обход корпуса и к патрубку строго по его оси.
  // Точки трасс — в метрах [x, высота, глубина от стены], как у room_3d.js; плоский вид этим не затрагивается.
  // бойлер в исходном положении: если патрубок обратки ниже конца магистрали на пару сантиметров, бойлер приподнимается на регулируемых ножках
  // (они у серий STOUT и ROMMER рассчитаны на 25–40 мм), и обратка идёт к магистрали прямо: обрезок трубы короче вылетов двух фитингов собрать нельзя
  function tankLift(tank, tp, routes) {
    var zl = tp[1].pos_m[2] + tank.off[2], zd = tp[0].pos_m[2] + tank.off[2], dy = 0;
    routes.forEach(function (r) { if (r.role === 'lr' && r.d0 != null && r.pp.length === 3) { var dd = -r.pp[2][1] / PXM - zl; if (Math.abs(dd) < 0.04) dy = dd; } });
    if (Math.abs(dy) < 1e-4) return null;
    var out = routes.map(function (r) {
      var c = {}; Object.keys(r).forEach(function (q) { c[q] = r[q]; });
      if (r.role === 'lr' && r.d0 != null && r.pp.length === 3) { var yy = -(zl + dy) * PXM; c.pp = [[r.pp[0][0], yy], [r.pp[1][0], yy]]; }
      else if (r.role === 'ld' && r.d1 != null && r.pp.length === 4) { var yd = -(zd + dy) * PXM; c.pp = [r.pp[0], r.pp[1], [r.pp[2][0], yd], [r.pp[3][0], yd]]; }
      return c;
    });
    return { routes: out, dy: dy };
  }
  function tankRoutes(tank, tp, routes, ang) {
    // плоскости труб те же, что у room_3d.js (ROLE_Z): подача бойлера 50 мм от стены, обратка 160 мм — иначе новый участок не стыкуется с магистралью
    var ZLD = 0.05, ZLR = 0.16, RUN = 0.102;       // RUN: прямой участок перед патрубком = плечо угольника 22 (57 мм) + 45 мм, иначе угольник не встаёт
    var R = -tp[0].pos_m[1] - 0.05, ax = tank.off[0], dA = R + 0.05;
    var ends = {};                                    // расстояние от оси бойлера до конца трубы на патрубке — по самой трассе плоского вида (конец трубы = край переходника)
    routes.forEach(function (r) {
      if (r.role === 'ld' && r.d1 != null) ends.ld = Math.abs(ax - r.pp[r.pp.length - 1][0] / PXM);
      if (r.role === 'lr' && r.d0 != null) ends.lr = Math.abs(ax - r.pp[0][0] / PXM);
    });
    var xd = Math.max(ends.ld || 0, ends.lr || 0);
    var dt = ZLR + RUN, dz = dt + xd - dA;            // конец трубы на глубине dt; ось бойлера — на dA + dz
    // обратка бойлера встаёт в конец магистрали той же высоты: если патрубок ниже или выше конца магистрали на пару сантиметров, бойлер приподнимается
    // на регулируемых ножках (они у серий STOUT и ROMMER рассчитаны на 25–40 мм), иначе между двумя фитингами остаётся обрезок трубы короче вылетов
    var dy = 0;
    routes.forEach(function (r) { if (r.role === 'lr' && r.d0 != null) { var dd = -r.pp[r.pp.length - 1][1] / PXM - (tp[1].pos_m[2] + tank.off[2]); if (Math.abs(dd) < 0.04) dy = dd; } });
    var out = routes.map(function (r) {
      var ld = r.role === 'ld' && r.d1 != null, lr = r.role === 'lr' && r.d0 != null;
      if (!ld && !lr) return r;
      var k = ld ? 0 : 1, z = tp[k].pos_m[2] + tank.off[2] + dy, xt = ax, pp = r.pp, p3;
      if (ld) {
        var A0 = [pp[0][0] / PXM, -pp[0][1] / PXM, ZLD], xe = pp[1][0] / PXM;
        p3 = [A0, [xe, A0[1], ZLD], [xe, z, ZLD], [xt, z, ZLD], [xt, z, dt]];
      } else {
        var xj = pp[1][0] / PXM, yr = -pp[2][1] / PXM;
        p3 = [[xt, z, dt], [xt, z, ZLR], [xj, z, ZLR], [xj, yr, ZLR]];
      }
      var c = {};
      Object.keys(r).forEach(function (q) { c[q] = r[q]; });
      p3 = p3.filter(function (q, i) { return i === 0 || Math.abs(q[0] - p3[i - 1][0]) + Math.abs(q[1] - p3[i - 1][1]) + Math.abs(q[2] - p3[i - 1][2]) > 1e-4; });   // нулевые участки не нужны
      c.p3 = p3; c.d0 = null; c.d1 = null;
      return c;
    });
    return { routes: out, dz: dz, piv: dA, dy: dy };
  }
  // два положения: 0 — как в кадрах (патрубки влево, лицевая сторона с логотипом вправо) и 90 — патрубки к стене, лицевая сторона к зрителю
  function tankAngle() { return (A && A.state && A.state.roomViewTank === 90) ? 90 : 0; }
  function tankRotate() {
    var a = tankAngle() === 90 ? 0 : 90;
    A.state.roomViewTank = a;
    if (A.saveState) A.saveState();
    A.render();
    if (FULL && MODAL) renderFull();                                 // поворот не меняет плоский вид, поэтому окно обновляем сами
    return a;
  }

  window.RoomView = { html: html, openFull: openFull, closeFull: closeFull, pumpOptions: pumpOptions, pumpSwap: pumpSwap, tankAngle: tankAngle, tankRotate: tankRotate };
})();
