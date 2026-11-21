/* boiler_room_list.js — единый перечень позиций котельной.
 *
 * Зачем. Главная схема (project_scheme.js) и общий вид котельной (room_view.js) раньше решали, что рисовать, каждая по-своему:
 * схема — по условиям в таблице обозначений, вид — по составу кадров и сметы. Они расходились: бойлер и баки на схеме были,
 * а на виде нет. Теперь условия лежат здесь, один раз: таблица обозначений схемы строится по fittingFlags/lineMarks,
 * а вид сверяет свой состав со списком positions().
 *
 * Вход — конфигурация схемы app.buildSchemeConfig() (то же, по чему рисуется лист). Своих расчётов здесь нет.
 * Глобал: window.BoilerRoomList = { fittingFlags, lineMarks, positions }
 */
(function (root) {
  'use strict';

  // Арматура и условия её появления: те же, что были в таблице условных обозначений главной схемы
  function fittingFlags(cfg) {
    cfg = cfg || {};
    var twoC = !!(cfg.gas && cfg.gas.circuits === 2 && !cfg.indirect && !cfg.elWh);
    var nBoilers = (cfg.gas ? Math.max(1, cfg.gas.count || 1) : 0) + (cfg.el ? Math.max(1, cfg.el.count || 1) : 0);
    var usePump = !!(cfg.tp || cfg.snow || cfg.hydro || cfg.recirc || cfg.loadPump || (cfg.el && cfg.el.polis));
    var useCheck = !!(nBoilers > 1 || cfg.indirect || cfg.elWh || (cfg.tp && (cfg.tpGroups > 0 || cfg.tpCheck !== false)) || cfg.snow || cfg.hydro || cfg.recirc || !!(cfg.feed && cfg.feed.auto));
    // При автоматике узел ТП ведёт контроллер: смеситель с сервоприводом вместо термостатического
    var mixServo = !!(cfg.mixServo || (cfg.auto && cfg.auto.mixServo));
    return {
      twoC: twoC, nBoilers: nBoilers, usePump: usePump, useCheck: useCheck, mixServo: mixServo,
      ball: true,
      check: useCheck,
      pump: usePump,
      therm: !!cfg.dhwMix || ((!!cfg.tp || !!cfg.snow) && !mixServo),
      servo: (!!cfg.tp || !!cfg.snow) && mixServo,
      feed: !!(cfg.feed && cfg.feed.auto),
      safety: ((!!cfg.indirect || !!cfg.elWh) && cfg.water !== false) || !!cfg.snow,
      airvent: !!cfg.hydro || !!cfg.airSep,
      filter: true,
      prio: !!cfg.fugas,
      ntc: !!cfg.auto
    };
  }

  // Обозначения линий (маркировка трубопроводов на схеме)
  function lineMarks(cfg) {
    cfg = cfg || {};
    var F = fittingFlags(cfg);
    return [
      ['Т1', 'Подача радиаторного отопления', cfg.rad !== false],
      ['Т2', 'Обратка радиаторного отопления', cfg.rad !== false],
      ['Т11', 'Подача напольного отопления', !!cfg.tp],
      ['Т21', 'Обратка напольного отопления', !!cfg.tp],
      ['В1', 'Холодное водоснабжение', F.twoC || !!cfg.water || !!cfg.indirect || !!cfg.elWh],
      ['Т3', 'Горячее водоснабжение', F.twoC || !!cfg.indirect || !!cfg.elWh],
      ['Т4', 'Рециркуляция горячего водоснабжения', !!cfg.recirc],
      ['Т12', 'Подача на узел снеготаяния', !!cfg.snow],
      ['Т22', 'Обратка от узла снеготаяния', !!cfg.snow]
    ];
  }

  var FIT_TITLES = [
    ['ball', 'Шаровый кран'], ['check', 'Обратный клапан'], ['pump', 'Циркуляционный насос'],
    ['therm', 'Термостатический смесительный клапан'], ['servo', 'Клапан трёхходовой с сервоприводом'],
    ['feed', 'Клапан подпиточный автоматический'], ['safety', 'Предохранительный клапан'], ['airvent', 'Автоматический воздухоотводчик'],
    ['filter', 'Фильтр'], ['prio', 'Клапан приоритета бойлера'], ['ntc', 'Датчик температуры NTC (в гильзе)']
  ];

  // Единый перечень: оборудование, потребители, арматура, линии. group: equip | consumer | fit | line
  function positions(cfg) {
    cfg = cfg || {};
    var F = fittingFlags(cfg), out = [];
    var add = function (id, group, title, qty, on) { if (on) out.push({ id: id, group: group, title: title, qty: qty || 1 }); };
    var cnt = function (o) { return Math.max(1, (o && o.count) || 1); };
    add('gas', 'equip', (cfg.gas && cfg.gas.name) || 'Котёл газовый', cnt(cfg.gas), !!cfg.gas);
    add('el', 'equip', (cfg.el && cfg.el.name) || 'Котёл электрический', cnt(cfg.el), !!cfg.el);
    add('elwh', 'equip', 'Электрический водонагреватель', 1, !!cfg.elWh);
    add('indirect', 'equip', 'Бойлер косвенного нагрева' + (cfg.indirect && cfg.indirect.vol ? ' ' + cfg.indirect.vol + ' л' : ''), 1, !!cfg.indirect);
    add('exp_heat', 'equip', 'Расширительный бак отопления' + (cfg.tankHeating ? ' ' + cfg.tankHeating + ' л' : ''), 1, !!cfg.tankHeating);
    add('exp_dhw', 'equip', 'Расширительный бак ГВС' + (cfg.tankDhw ? ' ' + cfg.tankDhw + ' л' : ''), 1, !!cfg.tankDhw);
    add('hydro', 'equip', cfg.hydro && cfg.hydro.buffer ? 'Коллектор с буферной ёмкостью' : 'Коллектор с гидроразделителем', 1, !!cfg.hydro);
    add('airsep', 'equip', 'Сепаратор воздуха', 1, !!cfg.airSep);
    add('rad', 'consumer', 'Радиаторы' + (cfg.radGroups ? ': насосных групп ' + cfg.radGroups : ': на насосе котла'), Math.max(1, cfg.radGroups || 1), cfg.rad !== false && !!cfg.rad);
    add('tp', 'consumer', cfg.tpUnit ? 'Тёплый пол: узел подмеса' : 'Тёплый пол' + (cfg.tpGroups ? ': насосных групп ' + cfg.tpGroups : ''), Math.max(1, cfg.tpGroups || 1), !!cfg.tp);
    add('snow', 'consumer', 'Снеготаяние', 1, !!cfg.snow);
    FIT_TITLES.forEach(function (f) { add('fit_' + f[0], 'fit', f[1], 1, !!F[f[0]]); });
    lineMarks(cfg).forEach(function (m) { add('line_' + m[0], 'line', m[0] + ': ' + m[1], 1, m[2]); });
    return out;
  }

  root.BoilerRoomList = { fittingFlags: fittingFlags, lineMarks: lineMarks, positions: positions };
})(window);
