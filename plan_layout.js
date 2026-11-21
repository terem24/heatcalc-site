/**
 * plan_layout.js - «Вид»: управление окном редактора плана.
 *
 * Меню «Вид» в панели над планом:
 *  - размер интерфейса (панелей и кнопок), холст не масштабируется;
 *  - показать / скрыть левую (шаги) и правую (комнаты) колонки: холст занимает освободившееся место;
 *  - ширина колонок;
 *  - «Открепить»: панель становится плавающей, её можно перетащить за верхнюю полосу по плану, двойной клик по полосе
 *    возвращает на место; ширина плавающей панели тянется за нижний правый угол;
 *  - скрыть подсказки клавиш, «Сбросить вид».
 * Настройки запоминаются в браузере. Пока ничего не менялось, вид редактора прежний.
 * Открепление и левая колонка работают в полноэкранном режиме - именно там колонки стоят по бокам плана.
 */
(function () {
  'use strict';

  var KEY = 'plan_editor_layout_v1';
  var DEF = { ui: 1, stepsW: 280, sideW: 320, sideOff: false, keysOff: false, stepsFloat: null, sideFloat: null };
  var S = load();
  var root = document.documentElement;
  var pop = null, btn = null, tab = null, drag = null;

  function load() {
    var o = {}, k;
    for (k in DEF) o[k] = DEF[k];
    try { var j = JSON.parse(localStorage.getItem(KEY)); if (j) for (k in j) if (k in DEF) o[k] = j[k]; } catch (e) { }
    return o;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }
  function isFs() { return root.classList.contains('fs'); }
  /** Плавающая ли панель: состояние хранится на корневом элементе, а не на самой панели - мастер сбрасывает её className при перерисовке. */
  function isFloat(el) {
    return (el.id === 'steps' && root.classList.contains('pl-left-float')) || (el.classList.contains('side') && root.classList.contains('pl-right-float'));
  }
  function floatOf(t) {
    var el = t && t.closest ? t.closest('#steps,.side') : null;
    return el && isFloat(el) ? el : null;
  }
  function steps() { return document.getElementById('steps'); }
  function side() { return document.querySelector('.side'); }

  function css() {
    var st = document.createElement('style');
    st.id = 'pl_css';
    st.textContent =
      // размер интерфейса: панель шагов, правая колонка и подсказки; холст не трогаем
      '.topbar,.side,.fs-keys{zoom:var(--ui,1)}' +
      'html.fs #steps{top:calc(var(--fs-top,52px) / var(--ui,1));width:var(--steps-w,280px)}' +
      'html.fs:not(.fs-dock-off):not(.pl-left-float) .wrap{padding-left:calc((var(--steps-w,280px) + 18px) * var(--ui,1))}' +
      'html.fs.pl-left-float .wrap{padding-left:6px}' +
      '.side{flex:0 0 var(--side-w,320px)}' +
      'html.pl-side-off .side{display:none}' +
      'html.pl-keys-off .fs-keys{display:none}' +
      // плавающие панели
      'html.fs.pl-left-float #steps,html.fs.pl-right-float .side{position:fixed!important;z-index:45;bottom:auto!important;height:auto;' +
      'max-height:calc((100vh - 24px) / var(--ui,1));overflow:auto;resize:horizontal;box-shadow:0 12px 40px rgba(0,0,0,.45);' +
      'background:#161926!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' +
      'html.fs.light.pl-left-float #steps,html.fs.light.pl-right-float .side{background:#fff!important}' +
      'html.fs.pl-left-float #steps::before,html.fs.pl-right-float .side::before{content:"\\22EE\\22EE  тяните за эту полосу \\00B7 двойной клик - закрепить";' +
      'display:block;position:sticky;top:0;z-index:3;height:22px;line-height:22px;white-space:nowrap;overflow:hidden;margin:-6px -8px 6px;padding:0 10px;' +
      'font:600 11px system-ui,sans-serif;letter-spacing:.02em;color:#cbd5e1;background:#2c3550;cursor:move;border-radius:10px 10px 0 0;user-select:none}' +
      'html.fs.light.pl-left-float #steps::before,html.fs.light.pl-right-float .side::before{color:#334155;background:#dbe4f5}' +
      // кнопка и меню
      '#b_view.on{background:var(--primary,#4f6bed);color:#fff}' +
      '.pl-pop{position:fixed;z-index:10070;width:300px;max-width:calc(100vw - 16px);padding:12px 14px;border-radius:14px;' +
      'background:#1b2030;color:#e2e8f0;border:1px solid rgba(255,255,255,.14);box-shadow:0 16px 48px rgba(0,0,0,.5);font:13px system-ui,sans-serif}' +
      'html.light .pl-pop,html.ufh.light .pl-pop{background:#fff;color:#1e293b;border-color:rgba(20,30,60,.16)}' +
      '.pl-pop h4{margin:10px 0 6px;font:700 11px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;opacity:.65}' +
      '.pl-pop h4:first-child{margin-top:0}' +
      '.pl-row{display:flex;align-items:center;gap:6px;margin:5px 0;flex-wrap:wrap}' +
      '.pl-row .grow{flex:1}' +
      '.pl-pop button{font:inherit;padding:5px 10px;border-radius:8px;border:1px solid rgba(128,140,170,.4);background:rgba(128,140,170,.14);color:inherit;cursor:pointer}' +
      '.pl-pop button:hover{border-color:#4f6bed}' +
      '.pl-pop button.go{background:#4f6bed;border-color:#4f6bed;color:#fff}' +
      '.pl-pop input[type=range]{flex:1;min-width:120px}' +
      '.pl-pop .val{min-width:44px;text-align:center;font-weight:700}' +
      '.pl-pop .muted{opacity:.6;font-size:12px}' +
      '#pl_tab{position:fixed;right:0;top:50%;z-index:46;display:none;transform:translateY(-50%);padding:14px 7px;border-radius:10px 0 0 10px;' +
      'border:1px solid rgba(255,255,255,.18);border-right:0;background:#2c3550;color:#e2e8f0;cursor:pointer;font:700 12px system-ui,sans-serif;writing-mode:vertical-rl}' +
      'html.pl-side-off #pl_tab{display:block}';
    document.head.appendChild(st);
  }

  /** Вынести настройки в стили: переменные, классы, положение плавающих панелей. */
  function apply() {
    root.style.setProperty('--ui', String(S.ui));
    root.style.setProperty('--steps-w', S.stepsW + 'px');
    root.style.setProperty('--side-w', S.sideW + 'px');
    root.classList.toggle('pl-side-off', !!S.sideOff);
    root.classList.toggle('pl-keys-off', !!S.keysOff);
    floatApply(steps(), S.stepsFloat, 'pl-left-float', S.stepsW);
    floatApply(side(), S.sideFloat, 'pl-right-float', S.sideW);
    if (btn) btn.classList.toggle('on', !!pop && pop.style.display !== 'none');
    refit();
  }
  function floatApply(el, pos, cls, w) {
    if (!el) return;
    var ui = S.ui || 1;
    if (pos) {
      root.classList.add(cls);
      el.style.left = (pos.x / ui) + 'px'; el.style.top = (pos.y / ui) + 'px'; el.style.right = 'auto';
      el.style.width = w + 'px';
    } else {
      root.classList.remove(cls);
      el.style.left = el.style.top = el.style.right = el.style.width = '';
    }
  }
  /** Холст подгоняется под новую ширину: от неё зависят масштаб и кружки номеров комнат. */
  function refit() {
    setTimeout(function () { try { if (window.applyZoom) applyZoom(); if (window.fsFit) fsFit(); if (window.draw) draw(); } catch (e) { } }, 70);
  }

  // ── меню ────────────────────────────────────────────────────────────
  function render() {
    if (!pop) return;
    var fs = isFs(), pct = Math.round(S.ui * 100);
    var h = '<h4>Размер интерфейса</h4><div class="pl-row"><button data-a="ui-">A−</button><span class="val">' + pct + '%</span><button data-a="ui+">A+</button>' +
      '<span class="muted grow">панели и кнопки, не сам план</span></div>';
    h += '<h4>Колонки</h4>';
    if (fs) {
      var leftOn = !root.classList.contains('fs-dock-off');
      h += '<div class="pl-row"><span class="grow">Слева: шаги</span><button data-a="left">' + (leftOn ? 'Скрыть' : 'Показать') + '</button>' +
        '<button data-a="left-float">' + (S.stepsFloat ? 'Закрепить' : 'Открепить') + '</button></div>' +
        '<div class="pl-row"><input type="range" min="220" max="460" step="10" value="' + S.stepsW + '" data-r="stepsW"><span class="val">' + S.stepsW + '</span></div>';
    }
    h += '<div class="pl-row"><span class="grow">Справа: комнаты</span><button data-a="side">' + (S.sideOff ? 'Показать' : 'Скрыть') + '</button>' +
      (fs ? '<button data-a="side-float">' + (S.sideFloat ? 'Закрепить' : 'Открепить') + '</button>' : '') + '</div>' +
      '<div class="pl-row"><input type="range" min="240" max="520" step="10" value="' + S.sideW + '" data-r="sideW"><span class="val">' + S.sideW + '</span></div>';
    if (fs) h += '<h4>Подсказки клавиш</h4><div class="pl-row"><button data-a="keys">' + (S.keysOff ? 'Показать' : 'Скрыть') + '</button></div>';
    else h += '<div class="pl-row muted">Левую колонку и открепление панелей можно настроить в полноэкранном режиме.</div>';
    h += '<div class="pl-row" style="margin-top:12px"><button data-a="reset">Сбросить вид</button><button class="go grow" data-a="close">Готово</button></div>';
    pop.innerHTML = h;
  }
  function place() {
    if (!pop || !btn) return;
    var r = btn.getBoundingClientRect();
    pop.style.top = Math.min(window.innerHeight - 40, r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 308, r.left)) + 'px';
  }
  function toggle(on) {
    if (!pop) return;
    var show = on === undefined ? pop.style.display === 'none' : on;
    if (show) { render(); pop.style.display = ''; place(); } else pop.style.display = 'none';
    if (btn) btn.classList.toggle('on', show);
  }
  function floatPos(el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.max(8, Math.round(r.top)) }; }

  function act(a) {
    var st = steps(), sd = side();
    if (a === 'ui-') S.ui = Math.max(0.8, Math.round((S.ui - 0.1) * 100) / 100);
    else if (a === 'ui+') S.ui = Math.min(1.5, Math.round((S.ui + 0.1) * 100) / 100);
    else if (a === 'left') { if (window.toggleFsDock) toggleFsDock(); }
    else if (a === 'left-float') S.stepsFloat = S.stepsFloat ? null : (st ? floatPos(st) : null);
    else if (a === 'side') S.sideOff = !S.sideOff;
    else if (a === 'side-float') { S.sideOff = false; S.sideFloat = S.sideFloat ? null : (sd ? floatPos(sd) : null); }
    else if (a === 'keys') S.keysOff = !S.keysOff;
    else if (a === 'reset') {
      for (var k in DEF) S[k] = DEF[k];
      root.classList.remove('fs-dock-off');
    } else if (a === 'close') { toggle(false); return; }
    save(); apply(); render(); place();
  }

  function mount() {
    css();
    var more = document.getElementById('b_more');
    var host = more ? more.parentNode : null;
    btn = document.createElement('button');
    btn.id = 'b_view'; btn.type = 'button'; btn.className = 'ghost ufh-keep'; btn.textContent = 'Вид ▾';
    btn.title = 'Размер интерфейса, колонки слева и справа, перетаскивание панелей';
    btn.onclick = function (e) { e.stopPropagation(); toggle(); };
    if (host) host.insertBefore(btn, more);
    else { var fsd = document.getElementById('b_fsdock'); if (fsd && fsd.parentNode) fsd.parentNode.insertBefore(btn, fsd.nextSibling); }
    pop = document.createElement('div'); pop.className = 'pl-pop'; pop.style.display = 'none';
    pop.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('button[data-a]'); if (b) act(b.getAttribute('data-a')); });
    pop.addEventListener('input', function (e) {
      var r = e.target.getAttribute && e.target.getAttribute('data-r');
      if (!r) return;
      S[r] = parseInt(e.target.value, 10) || DEF[r];
      var v = e.target.parentNode.querySelector('.val'); if (v) v.textContent = S[r];
      save(); apply();
    });
    document.body.appendChild(pop);
    tab = document.createElement('button'); tab.id = 'pl_tab'; tab.type = 'button'; tab.textContent = 'Комнаты';
    tab.title = 'Показать правую колонку'; tab.onclick = function () { S.sideOff = false; save(); apply(); };
    document.body.appendChild(tab);
    document.addEventListener('click', function (e) { if (!e.target.isConnected) return; if (pop.style.display !== 'none' && !pop.contains(e.target) && e.target !== btn) toggle(false); });
    window.addEventListener('resize', function () { if (pop.style.display !== 'none') place(); });

    // перетаскивание плавающих панелей за верхнюю полосу; двойной клик по ней - закрепить
    document.addEventListener('pointerdown', function (e) {
      var el = floatOf(e.target);
      if (!el || !isFs() || e.button !== 0) return;
      var r = el.getBoundingClientRect();
      if (e.clientY - r.top > 24 * (S.ui || 1) || e.target !== el) return;   // только сама полоса (она - часть самой панели)
      drag = { el: el, dx: e.clientX - r.left, dy: e.clientY - r.top, key: el.id === 'steps' ? 'stepsFloat' : 'sideFloat' };
      try { el.setPointerCapture(e.pointerId); } catch (er) { }
      e.preventDefault();
    });
    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var ui = S.ui || 1, x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx)), y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
      drag.el.style.left = (x / ui) + 'px'; drag.el.style.top = (y / ui) + 'px';
      drag.pos = { x: Math.round(x), y: Math.round(y) };
    });
    document.addEventListener('pointerup', function () {
      if (!drag) return;
      if (drag.pos) { S[drag.key] = drag.pos; save(); }
      drag = null;
    });
    document.addEventListener('dblclick', function (e) {
      var el = floatOf(e.target);
      if (!el || e.target !== el || !isFs()) return;
      var r = el.getBoundingClientRect();
      if (e.clientY - r.top > 24 * (S.ui || 1)) return;
      S[el.id === 'steps' ? 'stepsFloat' : 'sideFloat'] = null; save(); apply();
    });
    // ширина плавающей панели тянется за угол - запоминаем
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function (en) {
        en.forEach(function (x) {
          var el = x.target, key = el.id === 'steps' ? 'stepsW' : 'sideW', w = Math.round(x.contentRect.width * (S.ui || 1) / (S.ui || 1));
          if (isFloat(el) && w > 120 && Math.abs(w - S[key]) > 6) { S[key] = Math.max(key === 'stepsW' ? 220 : 240, Math.min(key === 'stepsW' ? 460 : 520, w)); save(); root.style.setProperty('--' + (key === 'stepsW' ? 'steps' : 'side') + '-w', S[key] + 'px'); }
        });
      });
      if (steps()) ro.observe(steps());
      if (side()) ro.observe(side());
    }
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.planLayout = { open: function () { toggle(true); }, reset: function () { act('reset'); } };
})();
