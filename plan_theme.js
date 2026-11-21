/**
 * plan_theme.js - оформление редактора плана в духе Revit / AutoCAD.
 *
 * Рабочий фон чёрный (в светлой теме - светло-серый), плоские панели без стекла и градиентов, тонкие серые линии, почти без скруглений. Акцент не цветной:
 * активный инструмент - светлая плашка с чёрным текстом, как выбранный инструмент на ленте САПР; зелёный - только «готово» и
 * главное действие шага. Линейные иконки 16 px (штрих 1,6) на кнопках инструментов, цвет берут из текста.
 * Файл только добавляет стили и иконки: логику редактора не трогает. Две темы: тёмная (как у САПР) и светлая (по теме калькулятора).
 */
(function () {
  'use strict';

  var CSS = [
    // Две темы. Цвета редактора - переменные --k-*: тёмная (графит, как Revit) и светлая (белые панели, синий акцент
    // калькулятора). Тема берётся у калькулятора: светлый калькулятор ставит html.light (applyUfhTheme в plan_editor.html),
    // отдельный редактор проектирования без класса остаётся тёмным.
    'html{--k-bg:#000;--k-panel:#0b0b0b;--k-cv:#050505;--k-row:#101010;--k-row2:#141414;--k-line:#262626;--k-line2:#3a3a3a;',
    '--k-text:#e6e6e6;--k-sec:#8d8d8d;--k-inv:#e6e6e6;--k-invt:#000;--k-go:#173d24;--k-gob:#3fae5a;--k-gof:#c9f5d6;--k-gohv:#1f5030;',
    '--k-seg:#101010;--k-segt:#cfcfcf;--k-sw:#262626;--k-canvas:#000;--k-done:#6fcf8a;--k-sel:rgba(255,255,255,.07)}',
    'html.light{--k-bg:#eef0f3;--k-panel:#fff;--k-cv:#e6e9ee;--k-row:#f6f7f9;--k-row2:#f1f3f5;--k-line:#dfe3e8;--k-line2:#c5ccd6;',
    '--k-text:#1f2937;--k-sec:#5b6573;--k-inv:#203F6F;--k-invt:#fff;--k-go:#e4f4e9;--k-gob:#2f9e50;--k-gof:#14532d;--k-gohv:#d1ecd9;',
    '--k-seg:#f3f4f6;--k-segt:#374151;--k-sw:#e5e7eb;--k-canvas:#fff;--k-done:#15803d;--k-sel:rgba(32,63,111,.08)}',
    // палитра темы редактора: только тёмная, у светлой остаются цвета калькулятора
    'html:not(.light),html.ufh:not(.light){',
    '--acc:#e6e6e6;--acc-soft:rgba(255,255,255,.08);--primary:#e6e6e6;--primary-dim:#bdbdbd;--primary-light:rgba(255,255,255,.10);',
    '--bg:#000;--surface:#0b0b0b;--surface-light:#151515;--surface-hi:#202020;',
    '--text-main:#e6e6e6;--text-sec:#8d8d8d;--border:#3a3a3a;--border-soft:#262626;',
    '--ok:#3fae5a;--ok-bg:rgba(63,174,90,.16);--rad:3px;--ai-grad:#2a2a2a;',
    '--k-panel:#0b0b0b;--k-line:#262626;--k-row:#101010;--k-field:#000;--k-canvas:#000;--k-shadow:none}',
    'html.light{--ok:#15803d;--ok-bg:rgba(21,128,61,.10);--rad:3px}',
    'html body,html:not(.light) body,html.ufh body{background:var(--k-bg)!important;color:var(--k-text)}',
    '.topbar,html:not(.light) .topbar,html.ufh .topbar,html.ufh.light .topbar{background:var(--k-panel)!important;border-bottom:1px solid var(--k-line)!important;box-shadow:none!important}',
    '.cvbox,html.ufh.light .cvbox{background:var(--k-cv)!important;border:1px solid var(--k-line)!important;border-radius:3px!important;box-shadow:none!important;backdrop-filter:none!important}',
    '.side,html.ufh.light .side{background:var(--k-panel)!important;border:1px solid var(--k-line)!important;border-radius:3px!important;box-shadow:none!important;backdrop-filter:none!important}',
    'canvas{background:var(--k-canvas)!important;border-radius:0!important}',
    '#steps,html.fs #steps{background:var(--k-panel)!important;border:1px solid var(--k-line)!important;border-radius:3px!important;box-shadow:none!important;backdrop-filter:none!important}',
    '.wz-do,html.ufh.light .wz-do{background:var(--k-row)!important;border:1px solid var(--k-line)!important;border-radius:3px!important;color:var(--k-text)}',
    // текст внутри шага: цвет не наследуется от калькулятора (в светлой теме он выходил чёрным на чёрном)
    '.wz-do .ai-h,.wz-do .ai-h b,.wz-do .tx,.wz-do .tx b,.wz-up b{color:var(--k-text)!important}',
    '.wz-todo,.zone,.croom{color:var(--k-text)}',
    // шаги: текущий - сплошная плашка, пройденные - зелёная галочка
    '.wz-st{border-radius:3px!important;border-color:var(--k-line)!important;background:transparent!important;color:var(--k-sec)}',
    '.wz-st.cur{background:var(--k-inv)!important;border-color:var(--k-inv)!important;color:var(--k-invt)!important;font-weight:600}',
    'html.light .wz-st:not(.cur):not(.done) .n{background:#6b7280!important;color:#fff!important}',
    '.wz-st.cur .n{background:var(--k-invt)!important;color:var(--k-inv)!important}',
    '.wz-st.done{color:var(--k-done)!important}.wz-st.done .n{background:transparent!important;color:var(--k-done)!important}',
    // кнопки: плоские, тонкая рамка; включённая - инверсия; главное действие - зелёная
    'button,.steps button{border-radius:3px!important;box-shadow:none!important}',
    'button.ghost,.bar b,.ufh-keep b{color:var(--k-text)}button.ghost:disabled,button.ghost.off{color:var(--k-sec)}',
    'button.on,button[aria-pressed="true"],.p3d-seg button.on,#b_fs.on{background:var(--k-inv)!important;border-color:var(--k-inv)!important;color:var(--k-invt)!important}',
    'button.go,.wz-do button.go{background:var(--k-go)!important;border:1px solid var(--k-gob)!important;color:var(--k-gof)!important}',
    'button.go:hover,.wz-do button.go:hover{background:var(--k-gohv)!important}',
    '.wz-sw{display:inline-block;width:8px;height:8px;min-width:8px;padding:0!important;margin-left:8px;border-radius:50%;border:1.5px solid currentColor;background:transparent!important;color:var(--k-sec)!important;vertical-align:0}',
    '.wz-sw.on{background:currentColor!important;color:var(--k-invt)!important;border-color:var(--k-invt)}',
    '.p3d-seg,.p3d-panel,.pl-pop{border-radius:3px!important;box-shadow:none!important}',
    '.p3d-seg button{background:var(--k-seg)!important;color:var(--k-segt)!important}',
    '.p3d-panel{background:var(--k-panel)!important;border:1px solid var(--k-line)}',
    '.pl-pop{background:var(--k-panel)!important;border:1px solid var(--k-line2)!important}.pl-pop button.go{background:var(--k-go)!important}',
    '.p3d-view{background:linear-gradient(#fbfdff,#e8eff9)!important;border-radius:6px!important}',
    '.p3d-panel{background:rgba(255,255,255,.82)!important;border:1px solid rgba(160,185,225,.45)!important;border-radius:16px!important;color:#334155!important;box-shadow:0 10px 30px rgba(40,70,130,.14)!important}',
    '.p3d-panel button{border-radius:8px!important}.p3d-panel .p3d-segrow button{border-radius:999px!important;background:transparent!important;color:#51607a!important}',
    '.p3d-panel .p3d-segrow button.on{background:#fff!important;color:#2f6fed!important}.p3d-panel .p3d-link{background:transparent!important;color:#51607a!important}',
    '.p3d-panel label{color:#334155}',
    // остальное синее: вкладки этажей, список комнат, подсказка-плашка
    '.tab.on,html.ufh .tab.on{background:var(--k-inv)!important;color:var(--k-invt)!important;box-shadow:none!important;border-color:var(--k-inv)!important}',
    '.zone.zsel{background:var(--k-sel)!important;box-shadow:inset 3px 0 0 var(--k-inv)!important}',
    '.zone .rn{background:var(--k-inv)!important;color:var(--k-invt)!important}',
    '.wz-todo{background:var(--k-row2)!important;border:1px solid var(--k-line)}',
    '.wz-ai .ai-ic,.ai-ic{background:var(--k-sw)!important;color:var(--k-text)!important}',
    '.fs-corner button,.pj-path .p.cur{background:var(--k-inv)!important;color:var(--k-invt)!important}',
    '.ai-h .ai-step{color:var(--k-sec)!important}',
    // иконки на кнопках
    '.ic{display:inline-block;width:16px;height:16px;vertical-align:-3px;margin-right:6px;flex:none}',
    '.ic svg{width:16px;height:16px;display:block;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}'
  ].join('');

  // линейные иконки 16x16 (viewBox 24): тот же словарь, что у лент САПР - просто и узнаваемо
  var P = {
    wall: '<path d="M3 8h18v8H3z"/><path d="M7 8v8M12 8v8M17 8v8"/>',
    wall2: '<path d="M3 10h18v4H3z"/>',
    win: '<path d="M4 5h16v14H4z"/><path d="M12 5v14M4 12h16"/>',
    door: '<path d="M5 20V4h9l5 4v12"/><path d="M5 20h14"/><circle cx="12" cy="13" r="1"/>',
    move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
    dim: '<path d="M3 17h18"/><path d="M3 14v6M21 14v6"/><path d="M8 11h8"/>',
    house: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    rooms: '<path d="M3 4h18v16H3z"/><path d="M12 4v9M3 13h18M8 13v7"/>',
    trace: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/>',
    rect: '<path d="M4 6h16v12H4z"/><path d="M4 6l-1-1M20 18l1 1" opacity=".0"/>',
    pencil: '<path d="M4 20l1-4 11-11 3 3L8 19z"/><path d="M14 7l3 3"/>',
    check: '<path d="M5 12l4 4 10-10"/>',
    trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    up: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/>',
    rad: '<path d="M5 6h14v10H5z"/><path d="M9 6v10M12 6v10M15 6v10M7 20h2M15 20h2"/>',
    pipe: '<path d="M3 8h12a4 4 0 0 1 4 4v8"/>',
    next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    skip: '<path d="M5 6l7 6-7 6zM13 6l7 6-7 6z"/>',
    view: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    cube: '<path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M12 12l8-5M12 12L4 7M12 12v9"/>',
    plan: '<path d="M3 3h18v18H3z"/><path d="M3 12h9v9M12 3v5"/>',
    table: '<path d="M3 4h18v16H3z"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 8"/>',
    ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    cold: '<path d="M4 4h16v16H4z"/><path d="M4 4l16 16M20 4L4 20"/>',
    coll: '<path d="M4 7h16v4H4z"/><path d="M7 11v7M12 11v7M17 11v7"/>',
    auto: '<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'
  };
  function icon(n) { return P[n] ? '<span class="ic"><svg viewBox="0 0 24 24">' + P[n] + '</svg></span>' : ''; }

  // подпись кнопки -> иконка (по началу текста)
  var MAP = [
    [/^Наружная/, 'wall'], [/^Внутренняя/, 'wall2'], [/^Окно/, 'win'], [/^Дверь/, 'door'], [/^Двигать/, 'move'], [/^Размеры дома/, 'house'],
    [/^Размер/, 'dim'], [/^Комнаты из стен/, 'rooms'], [/^Обвести по подложке/, 'trace'], [/^Контур по размерам/, 'rect'],
    [/^Рисовать вручную/, 'pencil'], [/^Закончить стену/, 'check'], [/^Убрать все/, 'trash'], [/^Загрузить план/, 'up'],
    [/^Нарисовать без плана/, 'pencil'], [/^Найти комнаты/, 'search'], [/^Найти внутренние/, 'search'], [/^Распознать/, 'search'], [/^Под окна/, 'rad'],
    [/^Пропустить/, 'skip'], [/^Задать масштаб/, 'ruler'], [/^Подобрать/, 'refresh'], [/^Без обогрева/, 'cold'], [/^Коллектор/, 'coll'],
    [/^Автотрассы/, 'pipe'], [/^Автоподбор/, 'auto'], [/^Комнаты из стен/, 'rooms'], [/^Дальше/, 'next'], [/^Обвести рамкой/, 'rect'], [/^Обвести по точкам/, 'pencil']
  ];

  function decorate(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('button').forEach(function (b) {
      if (b.getAttribute('data-ic') || b.querySelector('.ic')) return;
      var t = (b.textContent || '').trim();
      for (var i = 0; i < MAP.length; i++) {
        if (MAP[i][0].test(t)) { b.setAttribute('data-ic', MAP[i][1]); b.insertAdjacentHTML('afterbegin', icon(MAP[i][1])); break; }
      }
      if (!b.getAttribute('data-ic')) b.setAttribute('data-ic', '-');
    });
  }

  function mount() {
    var st = document.createElement('style');
    st.id = 'plan_theme_css'; st.textContent = CSS;
    document.head.appendChild(st);              // последним: переопределяет остальные
    var steps = document.getElementById('steps');
    if (steps) {
      decorate(steps);
      new MutationObserver(function () { decorate(steps); }).observe(steps, { childList: true, subtree: true });
    }
    // кнопки в верхней панели: 2D / 3D / таблица и «Вид» получают иконки по месту
    var bar = document.querySelector('.bar') || document.querySelector('.topbar');
    if (bar) new MutationObserver(function () { decorateViews(); }).observe(bar, { childList: true, subtree: true });
    decorateViews();
  }
  function decorateViews() {
    var map = { p3d_b2: 'plan', p3d_b3: 'cube', p3d_bt: 'table', b_view: 'view' };
    Object.keys(map).forEach(function (id) {
      var b = document.getElementById(id);
      if (b && !b.querySelector('.ic')) b.insertAdjacentHTML('afterbegin', icon(map[id]));
    });
  }

  window.planIcon = icon;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
