/* boiler_room_plan.js — план общего вида котельной (вид спереди, мм), v0 (черновик ночной разведки).
 *
 * Берёт ту же конфигурацию системы, что и лист «Принципиальная схема» (app.buildSchemeConfig): состав и количества оттуда,
 * поэтому две схемы не могут разойтись. Возвращает детали с положением и точками присоединения и трассу труб; рисованием и
 * 3D этот модуль не занимается — их питает один и тот же план.
 *
 * Правила расстановки сняты с листа «Вид котельной спереди» проекта 2025-210 (стр. 33): бак отопления и бак ГВС над бойлером,
 * бойлер слева у стены, под ним и правее группы и коллектор, справа сверху котёл настенный, под ним гидрострелка и две
 * горизонтальные магистрали Т1 (подача) и Т2 (обратка) влево от неё. Все размеры тут НОМИНАЛЬНЫЕ (по образцу), до сверки
 * с паспортами каждой позиции; источник каждого размера записан в SRC.
 *
 * Координаты: x вправо от левого края стены, y вверх от пола (мм). Глобал: window.boilerRoomPlan; в Node — module.exports.
 */
(function (root) {
  'use strict';

  var SRC = 'размер по образцу проекта 2025-210, стр. 33, до сверки с паспортом';
  // номинальные габариты (ширина x высота, мм)
  var DIM = {
    boiler: { w: 426, h: 741 },
    // по паспортам (размеры корпуса без дымохода): Haier NeoSlim Ti — руководство, стр. 28 (400 x 725 x 240);
    // STOUT STATUS 5-18 кВт — паспорт stout_bf87195c29c2, рис. 9 и 10 (426 x 741 x 294)
    boilerGas: { w: 400, h: 725 },
    boilerEl: { w: 426, h: 741 },
    hydro: { w: 90, h: 345 },
    heatTank: { w: 300, h: 330 },     // расширительный бак отопления 18 л
    dhwTank: { w: 300, h: 330 },      // расширительный бак ГВС 18 л
    group: { w: 90, h: 340 },         // шаг одной насосной группы по коллектору
    manifoldH: 140
  };
  // бойлер: объём, л -> диаметр x высота, мм (напольный, по каталогам OptiBase / AQ)
  // OptiBase SWH-2110 (паспорт stout_4bce0e01b963, табл. «в упаковке»: ширина x высота 605x1090 / 605x1395 / 605x1840 /
  // 755x1740 / 755x1840): размеры В УПАКОВКЕ, то есть верхняя оценка; точные — по рис. 1 паспорта, перерисовать с него
  var TANK = { 150: [605, 1090], 200: [605, 1395], 300: [605, 1840], 400: [755, 1740], 500: [755, 1840] };
  function tankDim(vol) {
    var keys = Object.keys(TANK).map(Number).sort(function (a, b) { return a - b; });
    var k = keys.filter(function (v) { return v >= (vol || 150); })[0] || keys[keys.length - 1];
    return { w: TANK[k][0], h: TANK[k][1] };
  }
  // цвета линий — как на листе проекта (и в project_scheme.js)
  var COL = { supply: '#ff0000', ret: '#0000ff', loadS: '#800040', loadR: '#8282ff', dhw: '#ff8000', recirc: '#ff00ff', cold: '#00ffff' };

  // Что cfg схемы не различает, берём из сметы: отдельная гидрострелка или совмещённый коллектор, буферная ёмкость, группы загрузки
  // бойлера, общий сепаратор шлама. eq — currentEquipmentList.
  function ctxFromEstimate(eq) {
    eq = (eq || []).filter(function (e) { return !e.isOpt; });
    var q = function (e) { return Math.max(1, Math.round(Number(e.q)) || 1); };
    var isGr = function (n) { return /(групп\S*\s+насосн|насосн\S*\s+групп)/i.test(n) && !/(коллектор|гидрострелк|стрелк|раздел)/i.test(n); };
    var ctx = { hydro: null, buffer: null, loadGroups: 0, slime: null };
    eq.forEach(function (e) {
      var n = String(e.name || '');
      if (/гидрострелк|гидравлическ\S*\s+(стрелк|раздел)/i.test(n) && !/коллектор/i.test(n)) ctx.hydro = 'arrow';
      else if (/коллектор/i.test(n) && /(гидрострелк|разделител|стрелк)/i.test(n) && !ctx.hydro) ctx.hydro = 'collector';
      if (/^Буферн/i.test(n)) { var v = n.match(/(\d{2,4})\s*л/i); ctx.buffer = { vol: v ? +v[1] : 0 }; }
      if (isGr(n) && /для\s+бойлера/i.test(n)) ctx.loadGroups += q(e);
      if (/^Сепаратор шлама/i.test(n) && !/щётк/i.test(n)) { var m = n.match(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+)\s*"/); ctx.slime = m ? m[1] + '"' : ''; }
    });
    return ctx;
  }

  function plan(cfg, ctx) {
    if (!cfg) return null;
    ctx = ctx || {};
    var parts = [], pipes = [], notes = [];
    var WALL_H = 2100, GAP = 100;
    function add(kind, name, x, y, d, extra) {
      var p = { id: kind + ':' + parts.filter(function (q) { return q.kind === kind; }).length, kind: kind, name: name, x: Math.round(x), y: Math.round(y), w: d.w, h: d.h, src: SRC };
      for (var k in (extra || {})) p[k] = extra[k];
      parts.push(p);
      return p;
    }
    // --- слева: бойлер и баки над ним
    var x = 150;
    var left = 0;
    if (cfg.indirect) {
      var td = tankDim(cfg.indirect.vol);
      var tank = add('dhwBoiler', 'Бойлер косвенного нагрева' + (cfg.indirect.vol ? ' ' + cfg.indirect.vol + ' л' : ''), x, 60, td, { cfgKey: 'indirect' });
      var bx = x + Math.max(0, (td.w - DIM.heatTank.w) / 2);
      // баки висят над бойлером, каждый на своём отсечном вентиле (образец 2025-210)
      if (cfg.tankHeating) add('expHeat', 'Расширительный бак для отопления ' + cfg.tankHeating + ' л', bx - 180, tank.y + td.h + 150, DIM.heatTank, { cfgKey: 'tankHeating' });
      if (cfg.tankDhw) add('expDhw', 'Расширительный бак для ГВС ' + cfg.tankDhw + ' л', bx + 180, tank.y + td.h + 150, DIM.dhwTank, { cfgKey: 'tankDhw' });
      left = x + td.w + GAP;
    } else if (cfg.elWh) {
      add('elWater', 'Водонагреватель электрический', x, 60, { w: 500, h: 800 }, { cfgKey: 'elWh' });
      left = x + 500 + GAP;
    }
    if (!cfg.indirect) {      // баки без бойлера косвенного нагрева — на стене слева, на высоте 1500
      if (cfg.tankHeating) { add('expHeat', 'Расширительный бак для отопления ' + cfg.tankHeating + ' л', left, 1500, DIM.heatTank, { cfgKey: 'tankHeating' }); left += DIM.heatTank.w + GAP; }
      if (cfg.tankDhw) { add('expDhw', 'Расширительный бак для ГВС ' + cfg.tankDhw + ' л', left, 1500, DIM.dhwTank, { cfgKey: 'tankDhw' }); left += DIM.dhwTank.w + GAP; }
    }
    // --- по центру: насосные группы и коллектор
    // группы — только те, что есть в смете: система без групп (местный узел подмеса, прямая обвязка) — это отводы от трубы, не детали
    var nRad = cfg.radGroups || 0, nTp = cfg.tpGroups || 0, nLoad = ctx.loadGroups || 0;
    var nGroups = nRad + nTp + nLoad;
    var gx = left;
    var gy = 150;
    for (var i = 0; i < nGroups; i++) {
      var kind = i < nTp ? 'groupTp' : i < nTp + nRad ? 'groupRad' : 'groupLoad';
      var nm = kind === 'groupTp' ? 'Насосная группа тёплого пола' : kind === 'groupRad' ? 'Насосная группа отопления' : 'Насосная группа загрузки бойлера';
      add(kind, nm, gx + i * 2 * DIM.group.w, gy, DIM.group, { cfgKey: kind === 'groupTp' ? 'tpGroups' : kind === 'groupRad' ? 'radGroups' : 'loadPump' });
    }
    var mfW = Math.max(300, nGroups * 2 * DIM.group.w + 120);
    var mf = nGroups ? add('manifold', 'Коллектор', gx - 40, gy + DIM.group.h + 20, { w: mfW, h: DIM.manifoldH }, { cfgKey: 'hydro' }) : null;
    // --- справа: котлы (каскад — рядом) и гидрострелка под первым
    var bxr = Math.max(left + mfW + 500, 1200);
    var gasN = cfg.gas ? cfg.gas.count || 1 : 0, elN = cfg.el ? cfg.el.count || 1 : 0, bn = gasN + elN;
    var bys = WALL_H - DIM.boiler.h - 100;
    var bxc = bxr;
    for (var b = 0; b < bn; b++) {
      var isGas = b < gasN, bd = isGas ? DIM.boilerGas : DIM.boilerEl;
      add(isGas ? 'boilerGas' : 'boilerEl', isGas ? (cfg.gas && cfg.gas.name || 'Котёл газовый') : (cfg.el && cfg.el.name || 'Котёл электрический'), bxc, WALL_H - bd.h - 100, bd, { cfgKey: isGas ? 'gas' : 'el' });
      bxc += bd.w + GAP;
    }
    var boilers = parts.filter(function (p) { return /^boiler/.test(p.kind); });
    var bxEnd = boilers.length ? Math.max.apply(null, boilers.map(function (p) { return p.x + p.w; })) : bxr;
    var bBot = boilers.length ? Math.min.apply(null, boilers.map(function (p) { return p.y; })) : 1200;
    var ySup = bBot - 130, yRet = ySup - 70;
    // отдельная гидрострелка или буферная ёмкость — только если она отдельной позицией в смете; «коллектор с встроенным разделителем»
    // деталью не рисуем: он часть коллектора. Стоит справа от котлов, между магистралями (образец 2025-210)
    var hy = null;
    if (ctx.hydro === 'arrow' || ctx.buffer) hy = add('hydro', ctx.buffer ? 'Буферная ёмкость' + (ctx.buffer.vol ? ' ' + ctx.buffer.vol + ' л' : '') : 'Гидрострелка', bxEnd + 60, yRet - 140, DIM.hydro, { cfgKey: 'hydro' });
    var xr = hy ? hy.x + hy.w / 2 : bxEnd, xl = mf ? mf.x : left - 60;
    // патрубки каждого котла вниз на общие магистрали: подача (красная) и обратка (синяя)
    boilers.forEach(function (b) {
      pipes.push({ role: 'supply', col: COL.supply, from: [b.x + b.w * 0.30, b.y], to: [b.x + b.w * 0.30, ySup], dn: cfg.dia || null });
      pipes.push({ role: 'ret', col: COL.ret, from: [b.x + b.w * 0.70, b.y], to: [b.x + b.w * 0.70, yRet], dn: cfg.dia || null });
    });
    // общие магистрали T1/T2 от котлов (или гидрострелки) влево до самой дальней группы
    if (boilers.length) {
      pipes.push({ role: 'supply', col: COL.supply, from: [xr, ySup], to: [xl, ySup], dn: cfg.dia || null });
      pipes.push({ role: 'ret', col: COL.ret, from: [xr, yRet], to: [xl, yRet], dn: cfg.dia || null });
    }
    // ответвления вниз на группы
    parts.filter(function (p) { return /^group/.test(p.kind); }).forEach(function (g) {
      pipes.push({ role: 'supply', col: COL.supply, from: [g.x + 20, ySup], to: [g.x + 20, g.y + g.h] });
      pipes.push({ role: 'ret', col: COL.ret, from: [g.x + 70, yRet], to: [g.x + 70, g.y + g.h] });
    });
    // бойлер косвенного нагрева: подача и обратка змеевика от магистралей (загрузка бойлера, цвета линий загрузки)
    var tk = parts.filter(function (p) { return p.kind === 'dhwBoiler'; })[0];
    if (tk) {
      var xd = left - 30, tr = tk.x + tk.w;
      pipes.push({ role: 'loadS', col: COL.loadS, from: [xd, ySup], to: [xd, tk.y + tk.h * 0.62] }, { role: 'loadS', col: COL.loadS, from: [xd, tk.y + tk.h * 0.62], to: [tr, tk.y + tk.h * 0.62] });
      pipes.push({ role: 'loadR', col: COL.loadR, from: [xd - 40, yRet], to: [xd - 40, tk.y + tk.h * 0.20] }, { role: 'loadR', col: COL.loadR, from: [xd - 40, tk.y + tk.h * 0.20], to: [tr, tk.y + tk.h * 0.20] });
      var eh = parts.filter(function (p) { return p.kind === 'expHeat'; })[0], ed = parts.filter(function (p) { return p.kind === 'expDhw'; })[0];
      if (ed) pipes.push({ role: 'cold', col: COL.cold, from: [ed.x + ed.w / 2, ed.y], to: [ed.x + ed.w / 2, tk.y + tk.h] });
      if (eh) pipes.push({ role: 'ret', col: COL.ret, from: [eh.x + eh.w / 2, eh.y], to: [eh.x + eh.w / 2, yRet] });
    }
    // сепараторы на общей трубе — только если они есть в смете: воздуха на подаче, шлама на обратке (каскад — один на систему);
    // стоят на магистрали левее котлов, на разных x, чтобы не налезать друг на друга
    if (cfg.airSep) add('sepAir', 'Сепаратор воздуха ' + cfg.airSep, bxr - 180, ySup - 20, { w: 80, h: 175 }, { cfgKey: 'airSep', on: 'supply', size: cfg.airSep });
    if (ctx.slime) add('sepSlime', 'Сепаратор шлама ' + ctx.slime, bxr - 320, yRet - 150, { w: 80, h: 175 }, { cfgKey: 'slime', on: 'ret', size: ctx.slime });
    return { wall: { w: Math.max(2100, bxc + 150), h: WALL_H }, parts: parts, pipes: pipes, notes: notes, colors: COL };
  }

  var api = { plan: plan, ctxFromEstimate: ctxFromEstimate, DIM: DIM, COL: COL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.boilerRoomPlan = api;
})(typeof window !== 'undefined' ? window : this);
