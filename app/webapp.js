/* mía · веб-приложение для Android и компьютера: тот же продукт, что приложение iOS (ios/Mia).
   Открывается по адресу ?view=app. Вкладки «Mía» (чат), «Progreso», «Ayuda», «Cuenta»; урок, практика во весь экран,
   мини-плеер. Правила и сценарий чата — в webapp-core.js, программа — app/data/program.json (копия iOS).
   Доступ даёт window.MiaAccount (account.js): без активной подписки — экран входа. Комментарии только блочные:
   check-webapp.cjs проверяет, что в остальном коде нет кириллицы. */
(function () {
'use strict';
const C = window.MiaWebCore;
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = name => '<i data-lucide="' + name + '" aria-hidden="true"></i>';
const icons = () => { try { if (window.lucide) window.lucide.createIcons(); } catch (e) { /* без иконок */ } };
const raw = window.MiaConfig || {};
const https = v => typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v.trim()) ? v.trim() : '';
const cfg = {
  /* В демо /ru/ инструменты проверки («Ya es mañana») скрыты; ?test=1 включает их для владельца. */
  paymentMode: raw.paymentMode === 'live' ? 'live' : 'test', testTools: raw.testTools !== false || (raw.demo === true && raw.paymentMode !== 'live' && new URLSearchParams(location.search).get('test') === '1'),
  demo: raw.demo === true && raw.paymentMode !== 'live', audio: raw.audio !== false,
  audioBase: https(raw.audioBase) || C.AUDIO_BASE, psychologistUrl: https(raw.psychologistUrl), appVersion: raw.appVersion || '0.1.0',
  legalBase: (typeof raw.legalBase === 'string' && raw.legalBase ? raw.legalBase : '/landing/legal/ru/').replace(/\/ru\/?$/, raw.demo === true ? '/ru/' : '/ru/')
};
const store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
const typeIcons = { digital: 'bell-off', ground: 'scan-eye', sleep: 'moon', identity: 'flower-2', connect: 'messages-square', rest: 'cloud-sun', movement: 'footprints', reflect: 'notebook-pen', boundary: 'hand', values: 'compass', support: 'life-buoy' };
const tariffs = { week: ['Неделя', 'в неделю'], month: ['Месяц', 'в месяц'], months4: ['3 месяца', 'каждые 3 месяца'], weeks4: ['4 semanas', 'каждые 4 недели'], weeks12: ['12 semanas', 'каждые 12 недель'], weeks24: ['24 semanas', 'каждые 24 недели'] };
/* Локаль цен и дат: в /ru/ словарь заменяет её на ru-RU. */
const LOCALE = 'ru-RU';
const money = v => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' }).format(Number(v) || 0);
const longDate = d => new Date(d).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' });
/* Формы слова через «|»: одна, несколько, много (в испанском вторая и третья совпадают). */
const plural = (n, forms) => { const f = forms.split('|'), k = new Intl.PluralRules(LOCALE).select(n); return f[k === 'one' ? 0 : k === 'few' ? 1 : 2] || f[f.length - 1]; };
const copy = {
  accountDeleted: 'Твой аккаунт и данные удалены.',
  deleteFailed: 'Сейчас не получилось удалить аккаунт. Проверь связь и попробуй ещё раз или напиши нам на support@miadays.app.',
  portalFailed: 'Сейчас не получается открыть управление подпиской. Попробуй ещё раз через несколько минут или напиши нам на support@miadays.app.',
  offline: 'Не получилось загрузить аудио. Проверь связь и попробуй ещё раз, когда захочешь.',
  loginOffline: 'Сейчас нет связи с сервером. Проверь интернет и попробуй ещё раз чуть позже.'
};

let S = null, P = null, K = null, G = null, root = null, mode = 'loading', loadError = false;
const ui = { tab: 'today', route: 'home', viewDay: 1, lessonMode: 'text', progress: 'map', account: 'main', sheet: null, flow: null, reveal: { key: null, count: 0, timer: null, typing: false }, toastTimer: null, returnFocus: null, gateError: '', gateBusy: false };
const A = { el: null, day: null, title: '', error: null };

/* ---------- Данные и доступ ---------- */
const acct = () => window.MiaAccount || null;
/* Аналитика (app/analytics.js): только коды экранов и действий — без текстов, ответов практик и почты. */
const T = (e, p) => { try { if (window.MiaAnalytics) window.MiaAnalytics.track(e, p); } catch (err) { /* не мешает */ } };
function call(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
/* События для писем (app/events.js → POST /app/events с Bearer, только live с сессией). Каждое — один раз на настоящее
   действие: экран дня — раз за загрузку (и снова после возвращения во вкладку через 30 минут), остальное — по переходу
   записи дня из «не было» в «стало». Правило «день завершён» — как в chatScript (webapp-core.js). */
const APP_AWAY_MS = 30 * 60e3;
const opened = { app: false, days: new Set(), hiddenAt: 0 };
function evApp(name, props) { call(() => { const e = window.MiaEvents; if (e && typeof e.app === 'function') e.app(name, props); }, null); }
function dayOpened(n) { if (!opened.days.has(n)) { opened.days.add(n); evApp('day_opened', { day: n }); } }
function wasRead(n) { const r = record(n); return !!r.lesson || (r.chat || []).includes('read'); }
function dayDone(n) { return call(() => { const d = day(n), r = record(n); return C.isComplete(d, r) || (!!r.skip && !d.rest) || (!!d.rest && !!r.lesson); }, false); }
function dayCheck(n, was) { if (!was && dayDone(n)) evApp('day_completed', { day: n }); }
function chipEvents(prompt, chip, n, before) {
  const i = Math.min(Number(String(chip).split('-').pop()) || 0, 2);
  if (prompt === 'mood') evApp('mood', { value: ['holding', 'hard', 'unsure'][i] });
  else if (prompt === 'outcome') evApp('outcome', { value: ['better', 'same', 'worse'][i] });
  else if (prompt === 'read' && chip === 'chip-read' && !before.read) evApp('lesson_read', { day: n });
  else if (prompt === 'soft' && !before.skip && record(n).skip) evApp('cant_today', { day: n });
  dayCheck(n, before.done);
}
function session() { const a = acct(); return a && typeof a.session === 'function' ? call(() => a.session(), null) : null; }
function access() { const a = acct(); return a && typeof a.access === 'function' ? call(() => a.access(), null) : null; }
/* Recordatorios (app/push.js): solo con cuenta del servidor (live) y navegador con Push. */
const push = () => window.MiaPush || null;
function pushReady() { return cfg.paymentMode === 'live' && !!session() && !!push(); }
function pushSupported() { const m = push(); return !!m && !!call(() => m.supported(), false); }
function programStart() { const d = new Date(); d.setDate(d.getDate() - (today() - 1)); return C.dateKey(d); }
function pushSync() { const m = push(); if (pushReady() && S.program) Promise.resolve(call(() => m.sync(programStart(), today()), null)).catch(() => {}); }
function funnel() { try { const x = JSON.parse(store.getItem('mia-ru-app-v1') || 'null') || {}; return { quiz: x.onboarding && x.onboarding.quiz, access: x.access }; } catch (e) { return {}; } }
function info() { return K ? C.funnelInfo(funnel().quiz, K) : { name: '', gentle: true, triggers: [], goal: null, sharesKids: false, profileShort: null }; }
function name() { const s = session(); return (S.profile.name || (s && s.name) || info().name || '').trim(); }
function persist() { if (!C.save(store, S)) toast('Не получается сохранить данные в этом браузере. Проверь, есть ли свободное место.'); else cloudNote(); }
let lessonOn = false; /* режим урока (webapp-lesson.js): включается в lessonInit() */
const CALL = { el: null, frame: null, open: false, state: 'ready', time: '', back: null }; /* звонок Мии — см. «Звонок Мии» ниже */
function still() { return (!!S.profile.reduceMotion && !lessonOn) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } /* в режиме урока переключателя нет — только системная настройка */
/* Языки (режим урока): версии сайта, текущая — по адресу (/ru/ или корень) */
function langList() {
  const L = (LCx() && LCx().ui().account.languages) || [], here = location.pathname.indexOf('/ru/') === 0 ? 'ru' : 'es';
  return L.map(l => ({ ...l, on: l.code === here }));
}
/* Formato preferido del tema (FormatSheet iOS) y esquemas de los días 1-14 (webapp-figures.js). */
function fmt() { return cfg.audio ? C.lessonFormat(S.profile, funnel().quiz) : 'text'; }
const figs = () => window.MiaFigures || null;

/* ---------- Записи на сервере (GET/PUT /app/state, правила — docs/decisions/state-sync.md) ----------
   С аккаунтом: при открытии сливаем документ сервера с локальным, изменения уходят через 3 с после последнего.
   Без сети и без сессии всё остаётся в браузере; неотправленное уйдёт при следующем изменении, возвращении сети или вкладки. */
const cloud = { timer: 0, busy: false, pulledAt: 0, conflicts: 0 };
function cloudFetch(method, body) {
  const a = acct(); if (!a || typeof a.authorizedFetch !== 'function' || !session()) return Promise.resolve(null);
  return Promise.resolve(call(() => a.authorizedFetch('/app/state', body === undefined ? { method } : { method, body }), null)).catch(() => null);
}
function cloudNote() {
  const m = C.loadSync(store), doc = C.buildDocument(S, m.doc, new Date().toISOString());
  if (m.doc && C.same(doc, m.doc)) return;
  C.saveSync(store, { revision: m.revision, doc, dirty: true }); cloudLater(3000);
}
function cloudLater(ms) { clearTimeout(cloud.timer); if (session()) cloud.timer = setTimeout(cloudPush, ms); }
/* Слитый документ становится состоянием; открытый лист или практику не перерисовываем под ней. */
function cloudAdopt(doc) {
  const before = JSON.stringify(S); S = C.applyDocument(S, doc); C.save(store, S);
  if (mode !== 'app' || JSON.stringify(S) === before) return;
  syncProgram(false); if (!ui.flow && !ui.sheet) { ui.viewDay = Math.min(ui.viewDay, today()); renderAll(); }
}
function cloudPush() {
  clearTimeout(cloud.timer);
  const m = C.loadSync(store); if (!m.dirty || !m.doc || cloud.busy || !session()) return;
  cloud.busy = true;
  cloudFetch('PUT', { revision: m.revision, schema: C.DOC_SCHEMA, document: m.doc }).then(r => {
    cloud.busy = false; if (!r) return;
    const cur = C.loadSync(store), doc = cur.doc || m.doc;
    if (r.ok && Number.isInteger(r.body.revision)) {
      cloud.conflicts = 0; const later = !C.same(doc, m.doc);
      C.saveSync(store, { revision: r.body.revision, doc, dirty: later }); if (later) cloudLater(0);
    } else if (r.status === 409 && cloud.conflicts < 3) {
      cloud.conflicts++;
      const merged = C.mergeDocuments(doc, r.body.document || {});
      C.saveSync(store, { revision: Number.isInteger(r.body.revision) ? r.body.revision : 0, doc: merged, dirty: true });
      cloudAdopt(merged); cloudLater(0);
    }
  });
}
function cloudPull(force) {
  if (!session() || cloud.busy || (!force && Date.now() - cloud.pulledAt < 60e3)) return;
  cloud.busy = true; cloud.pulledAt = Date.now();
  cloudFetch('GET').then(r => {
    cloud.busy = false; if (!r || !r.ok) return;
    const m = C.loadSync(store), local = C.buildDocument(S, m.doc, new Date().toISOString());
    const remote = r.body.document && typeof r.body.document === 'object' ? r.body.document : null, merged = remote ? C.mergeDocuments(local, remote) : local;
    C.saveSync(store, { revision: Number.isInteger(r.body.revision) ? r.body.revision : 0, doc: merged, dirty: !remote || !C.same(merged, remote) });
    cloudAdopt(merged); cloudPush();
  });
}

/* ---------- Ход программы (AppModel.syncProgram) ---------- */
const nowDate = () => C.now(S);
const today = () => C.currentDay(S);
/* Поддержка: письмо команде. Тот же адрес, что в письме после оплаты и в текстах ошибок. */
const SUPPORT_EMAIL = 'support@miadays.app';
const day = n => P.days.find(d => d.day === (n || ui.viewDay)) || P.days[0];
const record = n => C.rec(S, n || ui.viewDay);
const chapterOf = n => P.chapters.find(c => n >= c.from && n <= c.to);
function update(change, n) { const k = n || ui.viewDay, r = record(k); change(r); S.records[k] = r; persist(); }
function chatMark(m, n) { update(r => { if (!r.chat.includes(m)) r.chat.push(m); }, n); }
function syncProgram(announce) {
  if (mode !== 'app') return false;
  const had = !!S.program, before = today(), wasCurrent = ui.viewDay === before;
  C.ensure(S, nowDate());
  const moved = C.advance(S, nowDate());
  persist();
  if (!had) ui.viewDay = today();
  if (moved && today() !== before) {
    if (wasCurrent) { ui.viewDay = today(); ui.route = 'home'; }
    if (today() !== before) T('day_open', { day: today() });
    if (announce !== false) toast('Открылся день ' + today() + '. Вчерашнее остаётся с тобой — ничего не нужно догонять.');
    pushSync();
  }
  return moved;
}

/* ---------- Монтирование ---------- */
function mount() {
  if (root) return;
  if (!document.querySelector('link[href="webapp.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'webapp.css'; document.head.appendChild(l); }
  document.title = 'mía';
  document.body.classList.add('wa-on');
  root = document.createElement('div'); root.id = 'wa';
  root.innerHTML = '<div class="wa-frame" id="wa-frame"><div class="wa-loading" aria-label="Загрузка">mía</div></div>';
  document.body.appendChild(root);
  S = C.load(store);
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', onKey);
  /* Нажатие на пуш при уже открытой вкладке: sw.js присылает адрес экрана. */
  call(() => navigator.serviceWorker.addEventListener('message', ev => { const u = ev && ev.data && ev.data.miaGo; if (typeof u === 'string') call(() => goLink(new URL(u, location.origin).search)); }), null);
  /* data/segment.json — карта «Progreso» (сегмент 1, полгода); без него — прежняя карта из program.json. */
  /* Программа по умолчанию — «Желанная женщина», 180 дней (data/segment-zhelannaya.json, владелец 07.11.2026). ?program=main — прежняя «Желанная. Оставаясь собой.» (запоминается в браузере); нет файла — прежняя. */
  const segName = (() => { let v = null; try { v = new URLSearchParams(location.search).get('program'); if (v) localStorage.setItem('mia-program', v === 'main' ? '' : v); else v = localStorage.getItem('mia-program'); } catch {} return v === 'main' || v === '' ? '' : /^[a-z0-9-]{1,20}$/.test(v || '') ? v : 'zhelannaya'; })();
  const segGet = f => fetch(f, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const seg = (segName ? segGet('data/segment-' + segName + '.json') : Promise.resolve(null)).then(g => g || segGet('data/segment.json'));
  Promise.all(['data/program.json', 'data/content.json'].map(f => fetch(f, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(f); return r.json(); })).concat(seg))
    .then(([p, k, g]) => { P = p; K = k; G = g && Array.isArray(g.months) && g.months.length ? g : null; manageFromUrl(); refreshGate(true); lessonInit(); })
    .catch(() => { loadError = true; frame().innerHTML = '<div class="wa-gate"><h1 class="wa-display">Не получилось открыть mía.</h1><p class="wa-muted">Проверь связь и попробуй ещё раз.</p><button class="wa-dark" data-wa="reload"><span>Повторить</span><b>' + ic('rotate-cw') + '</b></button></div>'; icons(); });
  const a = acct(); if (a && typeof a.onChange === 'function') call(() => a.onChange(ev => { if (ev && ev.message && ev.reason === 'expired') { ui.gateError = ev.message; } if (P) { refreshGate(false); if (mode === 'login' && ui.gateError) renderGate(); } }));
  const inst = window.MiaInstall; if (inst && typeof inst.onChange === 'function') call(() => inst.onChange(() => { if (mode === 'app' && ui.tab === 'account' && ui.account === 'main') renderMain(true); }));
  if (inst && typeof inst.setGuideOpener === 'function') call(() => inst.setGuideOpener(g => openSheet('install', { g })));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { opened.hiddenAt = Date.now(); cloudPush(); return; }
    if (mode === 'app' && opened.hiddenAt && Date.now() - opened.hiddenAt >= APP_AWAY_MS) { opened.days.clear(); evApp('app_opened'); }
    opened.hiddenAt = 0;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !P) return;
    refreshGate(true);
    if (mode === 'app' && syncProgram() && ui.tab === 'today' && ui.route === 'home') renderMain();
    if (mode === 'app') cloudPull(false);
  });
  window.addEventListener('online', cloudPush);
}
const frame = () => document.getElementById('wa-frame');
const $ = s => root.querySelector(s);

function evaluate() { return C.accessGate({ account: acct(), config: cfg, state: S, funnelAccess: funnel().access }); }
function refreshGate(remote) {
  apply(evaluate());
  const a = acct();
  if (remote && a && typeof a.refresh === 'function') Promise.resolve(call(() => a.refresh(), null)).then(() => apply(evaluate())).catch(() => {});
}
function apply(g) {
  if (!g.open && ui.holdGate) return; /* лист «Suscripción cancelada» после возврата: вход закрывается, когда она его закроет */
  if (g.open) {
    ui.gateError = '';
    if (mode !== 'app') { const fresh = !S.program && !Object.keys(S.records).length; T('app_open', { first: fresh, source: g.source }); mode = 'app'; syncProgram(false); welcomeGate(g, fresh); ui.viewDay = today(); ui.tab = 'today'; ui.route = 'home'; if (ui.afterGate === 'subscription') { ui.tab = 'account'; ui.account = 'subscription'; } ui.afterGate = null; renderApp(); pushSync(); cloudPull(true); maybeOffer(); if (!opened.app) { opened.app = true; evApp('app_opened'); } goLink(location.search); }
    else renderBadges();
  } else if (mode !== g.screen) { if (mode === 'app') stopAudio(); mode = g.screen; ui.sheet = null; ui.flow = null; renderGate(); }
}

/* ---------- Экран входа ---------- */
function renderGate() {
  const inactive = mode === 'inactive', s = session(), funnelUrl = location.pathname + '?view=onboarding';
  if (cfg.demo) {
    /* Режим показа (demo): аккаунтов нет, доступ даёт только оплата в воронке рядом. */
    frame().innerHTML = '<div class="wa-gate wa-page"><img class="heart" src="assets/glass-heart-v6.webp" alt="" aria-hidden="true">' +
      '<p class="wa-eyebrow">mía · это время для тебя</p><h1 class="wa-display">Начни<br><em>с теста.</em></h1>' +
      '<p class="wa-muted" style="font-size:16px;line-height:1.55">mía открывается после теста и подписки. Из твоих ответов складывается твой личный маршрут.</p>' +
      '<div style="display:grid;gap:10px;margin-top:20px"><a class="wa-dark" href="' + esc(funnelUrl) + '"><span>Пройти тест</span><b>' + ic('arrow-right') + '</b></a></div>' +
      '<p class="note">mía — ежедневная поддержка, она не заменяет специалиста. Если тебе небезопасно, звони 112 или на телефон доверия +7 (495) 989-50-50.</p></div>';
    icons(); return;
  }
  if (ui.manageAsk && mode === 'login') { frame().innerHTML = manageGate(); icons(); return; }
  frame().innerHTML = '<div class="wa-gate wa-page">' +
    '<img class="heart" src="assets/glass-heart-v6.webp" alt="" aria-hidden="true">' +
    (inactive
      ? '<p class="wa-eyebrow">Твой аккаунт</p><h1 class="wa-display">Твоя подписка<br><em>не активна.</em></h1>' +
        '<p class="wa-muted" style="font-size:16px;line-height:1.55">Ты вошла как ' + esc(s && s.email || '') + ', но сейчас мы не видим активной подписки. Твои записи остаются в этом браузере.</p>' +
        '<div style="display:grid;gap:10px;margin-top:20px"><a class="wa-dark" href="' + esc(funnelUrl) + '"><span>Оформить подписку на mía</span><b>' + ic('arrow-up-right') + '</b></a>' +
        '<button class="wa-soft" data-wa="gate-refresh">Проверить ещё раз</button><button class="wa-quiet" data-wa="logout">Выйти</button></div>'
      : '<p class="wa-eyebrow">mía · это время для тебя</p><h1 class="wa-display">Войди<br><em>в аккаунт.</em></h1>' +
        '<p class="wa-muted" style="font-size:16px;line-height:1.55">Почта и пароль — те, что ты придумала на сайте после оплаты.</p>' +
        '<form novalidate><label>Почта<input class="wa-input" type="email" name="email" autocomplete="email" inputmode="email" required></label>' +
        '<label>Пароль<input class="wa-input" type="password" name="password" autocomplete="current-password" required></label>' +
        (ui.gateError ? '<p class="err" role="alert">' + esc(ui.gateError) + '</p>' : '') +
        '<button class="wa-dark" type="submit"' + (ui.gateBusy ? ' disabled' : '') + '><span>' + (ui.gateBusy ? 'Входим…' : 'Войти') + '</span><b>' + ic('arrow-right') + '</b></button></form>' +
        '<div class="links"><a href="' + esc(location.pathname + '?forgot=1') + '">Забыла пароль?</a><a href="' + esc(funnelUrl) + '">Ещё нет mía? Пройди тест</a>' +
        (cfg.paymentMode === 'test' && cfg.testTools ? '<button class="wa-soft" data-wa="test-access">Попробовать в тестовом режиме</button>' : '') + '</div>') +
    '<p class="note">mía — ежедневная поддержка, она не заменяет специалиста. Если тебе небезопасно, звони 112 или на телефон доверия +7 (495) 989-50-50.</p></div>';
  icons();
}
function onSubmit(e) {
  const form = e.target.closest('form'); if (form && form.dataset.form === 'manage') { e.preventDefault(); manageRequest(form); return; }
  if (form && form.dataset.form === 'support') { e.preventDefault(); supportSend(); return; }
  if (form && form.dataset.form === 'urge') { e.preventDefault(); urgeReview(); return; }
  if (!form || mode !== 'login') return;
  e.preventDefault();
  const email = form.email.value.trim(), password = form.password.value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) { ui.gateError = 'Введи почту и пароль.'; renderGate(); return; }
  const a = acct();
  if (!a || typeof a.login !== 'function') { ui.gateError = copy.loginOffline; renderGate(); return; }
  ui.gateBusy = true; ui.gateError = ''; renderGate();
  Promise.resolve(call(() => a.login(email, password), null)).then(res => {
    ui.gateBusy = false;
    if (!res || !res.ok) { ui.gateError = (res && res.error) || copy.loginOffline; renderGate(); $('input[name=email]').value = email; return; }
    evApp('login_succeeded'); call(() => window.MiaEvents.identify({ email, name: (session() || {}).name || '' }), null);
    if (typeof a.refresh === 'function') return Promise.resolve(call(() => a.refresh(), null)).then(() => apply(evaluate()));
    apply(evaluate());
  }).catch(() => { ui.gateBusy = false; ui.gateError = copy.loginOffline; renderGate(); });
}

/* ---------- Каркас приложения ---------- */
function renderApp() {
  frame().innerHTML =
    '<header class="wa-header" id="wa-head"><button class="wa-logo" data-wa="home" aria-label="mía, перейти к сегодняшнему дню"><b>mía</b><span>это время для тебя</span></button>' +
    (callUi() ? '<button class="wa-help-pill wa-call-pill" data-wa="call-open"></button></header>' : '<button class="wa-help-pill" data-wa="sheet" data-s="help"><i class="dot"></i>Я рядом ' + ic('sparkles') + '</button></header>') +
    '<main class="wa-main" id="wa-main"></main>' +
    '<div class="wa-bottom" id="wa-bottom"><div id="wa-callbar"></div><div id="wa-player"></div><nav class="wa-nav" aria-label="Основная навигация">' +
    [['today', 'sparkles', 'Миа AI'], ['route', 'route', 'Программа'], ['assist', 'heart-handshake', 'Помощь'], ['account', 'user-round', 'Аккаунт']].filter(t => !(lessonOn && t[0] === 'assist'))
      .map(t => '<button data-wa="tab" data-tab="' + t[0] + '">' + ic(t[1]) + '<span>' + t[2] + '</span></button>').join('') +
    '</nav></div><div id="wa-layer"></div><div id="wa-support"></div><div id="wa-sheet"></div><div id="wa-welcome"></div><div id="wa-toast" class="wa-sr" role="status" aria-live="polite"></div>';
  root.classList.toggle('wa-still', still());
  root.classList.toggle('wa-lesson-mode', lessonOn);
  renderAll(); callPaint();
}
function renderAll() { renderMain(); renderPlayer(); renderFlow(); renderSupport(); renderSheet(true); renderBadges(); renderWelcome(); }
function renderBadges() {
  if (mode !== 'app') return;
  root.querySelectorAll('.wa-nav button').forEach(b => { if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
}
function setInert() {
  const busy = !!ui.sheet || !!ui.flow || !!ui.welcome || !!ui.support;
  ['wa-head', 'wa-main', 'wa-bottom'].forEach(id => { const el = document.getElementById(id); if (el) el.inert = busy; });
  const layer = document.getElementById('wa-layer'); if (layer) layer.inert = !!ui.sheet;
  const sup = document.getElementById('wa-support'); if (sup) sup.inert = !!ui.sheet;
  const fr = frame(); if (fr) fr.inert = CALL.open;
}

/* Перерисовка ленты чата: уже показанные пузыри не проявляются заново (wa-in), анимируются только новые.
   «Печатает…» не считается — на его месте приходит новая реплика. */
function shownCount(box) { let n = 0; box.querySelectorAll('.wa-msg').forEach(m => { if (!m.querySelector('.wa-typing')) n++; }); return n; }
function settleShown(box, n) { const all = box.querySelectorAll('.wa-msg'); for (let i = 0; i < n && i < all.length; i++) all[i].style.animation = 'none'; }
function renderMain(keepScroll) {
  const main = $('#wa-main'); if (!main) return;
  const top = main.scrollTop;
  const chatKey = ui.tab === 'today' && ui.route === 'home' ? String(ui.viewDay) : '';
  const shown = chatKey && main.dataset.chat === chatKey ? shownCount(main) : 0;
  let html = '';
  if (pausedNow() && (ui.tab === 'today' || ui.tab === 'route')) html = pausedPage();
  else if (ui.tab === 'today') html = ui.route === 'lesson' ? lessonPage() : LCx() ? LCx().shell() : chatPage();
  else if (ui.tab === 'route') html = progressPage();
  else if (ui.tab === 'assist') html = assistPage();
  else html = ui.account === 'library' ? libraryPage() : ui.account === 'subscription' ? subscriptionPage() : ui.account === 'phrases' && LCx() ? LCx().phrasesPage() : ui.account === 'calls' && callUi() ? callsPage() : ui.account === 'docs' && LCx() ? docsPage() : accountPage();
  main.innerHTML = html; main.dataset.chat = chatKey; settleShown(main, shown);
  main.classList.toggle('with-player', showPlayer());
  icons(); updateAudioUI(true); figures(main);
  if (ui.tab === 'today' && ui.route === 'home' && LCx() && !pausedNow()) LCx().mount(main);
  else if (LCx()) LCx().unmount();
  else if (ui.tab === 'today' && ui.route === 'home') { main.scrollTop = main.scrollHeight; continueReveal(); dayOpened(ui.viewDay); }
  else main.scrollTop = keepScroll ? top : 0;
  renderBadges(); setInert();
}

/* ---------- Вкладка «Mía»: чат ---------- */
function script() {
  const d = day(), r = record(), f = info();
  const y = d.day > 1 ? { day: day(d.day - 1), record: record(d.day - 1) } : null;
  return C.chatScript({ day: d, record: r, yesterday: y, name: name(), profileShort: f.profileShort, triggers: f.triggers, gentle: f.gentle, hasVoice: true, audio: cfg.audio,
    weekTitles: P.days.slice(0, 7).map(x => x.title), chapters: P.chapters.length, goal: f.goal, isSunday: C.isSunday(nowDate()), isEvening: C.isEvening(nowDate()) });
}
function chatPage() {
  const d = day(), s = script(), ch = chapterOf(d.day), past = ui.viewDay !== today(), finished = !past && S.program && S.program.supportDone;
  const rv = ui.reveal;
  if (rv.key !== d.day) { const r = record(); rv.key = d.day; rv.count = still() || r.chat.length > 0 || C.touched(r) ? s.lines.length : 0; clearTimeout(rv.timer); rv.timer = null; rv.typing = false; }
  if (still()) rv.count = s.lines.length;
  rv.count = Math.min(rv.count, s.lines.length);
  let html = '';
  if (past) html += '<button class="wa-banner" data-wa="home">' + ic('arrow-left') + '<span>Ты смотришь день ' + d.day + '. Вернуться к сегодняшнему — день ' + today() + '</span></button>';
  else if (finished) html += '<button class="wa-banner" data-wa="tab" data-tab="route">' + ic('route') + '<span>' + esc(P.after[0] || '') + '</span></button>';
  html += '<div class="wa-daybar"><span>ГЛАВА ' + (ch ? ch.id : 1) + ' · ' + esc((ch ? ch.title : '').toUpperCase()) + '</span><b>ДЕНЬ ' + String(d.day).padStart(2, '0') + '</b></div>';
  html += '<div class="wa-chat" role="log" aria-live="polite" aria-label="Переписка с mía">';
  s.lines.slice(0, rv.count).forEach((line, i) => {
    const prev = s.lines[i - 1], first = i === 0 || !prev || prev.kind !== 'mia';
    html += bubble(line, d, first);
  });
  if (rv.typing) html += '<div class="wa-msg first"><span class="wa-ava" aria-hidden="true">m</span><span class="wa-typing" aria-label="mía печатает"><i></i><i></i><i></i></span></div>';
  if (rv.count >= s.lines.length && !s.prompt && !past) { const ask = reminderAsk(d); if (ask) html += reminderCard(ask); else if (reminderOffNotice(d)) html += offNoticeCard(); }
  if (rv.count >= s.lines.length && s.prompt) {
    html += '<div class="wa-chips">' + s.prompt.chips.map(c => '<button class="wa-chip" data-wa="chip" data-prompt="' + s.prompt.id + '" data-chip="' + c.id + '" data-title="' + esc(c.title) + '">' + esc(c.title) + '</button>').join('') + '</div>';
  }
  return html + '</div><div style="height:8px"></div>';
}
/* Сообщения появляются по одному, перед репликой mía — «печатает». */
function continueReveal() {
  const rv = ui.reveal; if (rv.timer || mode !== 'app') return;
  const s = script(); if (rv.count >= s.lines.length) return;
  const next = s.lines[rv.count];
  if (next.kind === 'mia' && !rv.typing) { rv.typing = true; rv.timer = setTimeout(() => { rv.timer = null; rv.typing = false; rv.count++; if (ui.tab === 'today' && ui.route === 'home') renderMain(); }, 520); renderTypingOnly(); return; }
  rv.timer = setTimeout(() => { rv.timer = null; rv.count++; if (ui.tab === 'today' && ui.route === 'home') renderMain(); }, next.kind === 'mia' ? 140 : 260);
}
function renderTypingOnly() {
  const chat = $('.wa-chat'); if (!chat || chat.querySelector('.wa-typing')) return;
  chat.insertAdjacentHTML('beforeend', '<div class="wa-msg first"><span class="wa-ava" aria-hidden="true">m</span><span class="wa-typing" aria-label="mía печатает"><i></i><i></i><i></i></span></div>');
  const main = $('#wa-main'); main.scrollTop = main.scrollHeight;
}
function bubble(line, d, first) {
  if (line.kind === 'mia') return '<div class="wa-msg' + (first ? ' first' : '') + '"><span class="wa-ava' + (first ? '' : ' ghost') + '" aria-hidden="true">m</span><div class="wa-bubble">' + esc(line.text) + '</div></div>';
  if (line.kind === 'user') return '<div class="wa-msg user"><div class="wa-bubble">' + esc(line.text) + '</div></div>';
  if (line.kind === 'article') {
    const read = record().lesson, t = C.tone(0, d.type), listen = fmt() === 'audio';
    return '<div class="wa-indent"><button class="wa-article" data-wa="article" data-format="' + (listen ? 'audio' : 'text') + '" aria-label="' + (listen ? 'Слушать: ' : 'Читать: ') + esc(d.title) + '"><span class="art tone-' + t + '" style="background:var(--bg);color:var(--ink)">' + ic(typeIcons[d.type] || 'book-open') + '</span>' +
      '<span class="copy"><small>' + (listen ? 'СЛУШАТЬ' : 'ЧИТАТЬ') + '</small><strong>' + esc(d.title) + '</strong><em class="' + (read ? 'read' : '') + '">' + esc(read ? 'Прочитано' : d.lesson[0]) + '</em></span>' + ic(read ? 'check' : 'arrow-up-right') + '</button></div>';
  }
  if (line.kind === 'voice') {
    const bars = Array.from({ length: 30 }, (_, i) => '<i style="height:' + (6 + (i * 7 + d.day * 13) % 17) + 'px"></i>').join('');
    return '<div class="wa-indent"><div class="wa-voice" data-voice="' + d.day + '"><button class="play" data-wa="voice" data-audio-btn="' + d.day + '" aria-label="Слушать голосовое">' + ic('play') + '</button>' +
      '<div class="body"><div class="wa-bars" data-audio-bars="' + d.day + '" aria-hidden="true">' + bars + '</div><strong data-audio-msg="' + d.day + '">' + esc(d.audioTitle) + '</strong>' +
      '<small><span data-audio-time="' + d.day + '">≈ ' + C.clock(d.audioSeconds) + '</span><span>mía · голосовое</span></small></div></div></div>';
  }
  if (line.kind === 'practice') return practiceCard(d, record());
  if (line.kind === 'help') return '<div class="wa-indent"><button class="wa-support-act" data-wa="tab" data-tab="assist">' + ic('heart-handshake') + 'Открыть «Помощь»</button></div>';
  if (line.kind === 'checks') {
    return '<div class="wa-indent"><div class="wa-checks"><span class="wa-eyebrow" style="font-size:10px">ЧИСЛО ДНЯ</span><div class="row">' +
      '<input data-field="checks" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="0" aria-label="Сколько раз ты сегодня заходила на его страницу">' +
      '<button class="wa-dark" data-wa="checks-save" disabled style="min-height:56px;padding:0 16px;justify-content:center"><span style="flex:none">Записать</span></button></div>' +
      '<p>Это увидишь только ты. Из этих чисел рисуется твоя кривая.</p></div></div>';
  }
  return '';
}
/* Свой экран разрешения (docs/pushes.md): после первого сделанного дня; «Ahora no» — системный запрос не показываем,
   ещё раз после третьего сделанного дня; дальше никогда. Системный запрос — только по «Sí, avísame». */
function reminderAsk(d) {
  const m = push(); if (!pushReady() || !m || d.day !== today() || !dayDone(d.day)) return 0;
  return call(() => m.askNumber(P.days.filter(x => dayDone(x.day)).length), 0) || 0;
}
function reminderCard(n) {
  const time = call(() => push().prefs().morning, '08:30');
  return '<div class="wa-indent"><div class="wa-remind" role="region" aria-label="Напоминания"><span class="ic">' + ic('bell') + '</span><div class="c"><strong>Напоминать утром?</strong>' +
    '<p>' + (n === 2 ? 'Три дня подряд — ты сама. Хочешь, буду напоминать?' : 'Один пуш в день, в ' + esc(time) + '. Что сегодня, и семь минут голосом. Выключить можно в любой момент.') + '</p>' +
    '<div class="row"><button class="wa-chip" data-wa="remind-yes" data-n="' + n + '">Да, напоминай</button><button class="wa-quiet" data-wa="remind-later" data-n="' + n + '">Не сейчас</button></div></div></div></div>';
}
/* День 21, напоминания выключены: одна строка, один раз (видна до конца этого открытия). */
let offNoticeNow = false;
function reminderOffNotice(d) {
  const m = push(); if (!pushReady() || !m || d.day !== today()) return false;
  if (!offNoticeNow && call(() => m.offNotice(d.day), false)) { offNoticeNow = true; call(() => m.markOffNotice()); }
  return offNoticeNow;
}
function offNoticeCard() {
  return '<div class="wa-indent"><button class="wa-support-act" data-wa="remind-notice">' + ic('bell') + 'Напоминания выключены. Включить?</button></div>';
}
function practiceCard(d, r) {
  const total = d.steps.length, done = C.doneCount(d, r), complete = done === total, next = Math.max(0, C.nextUndone(d, r, -1));
  const len = 2 * Math.PI * 28, off = total ? len * (1 - done / total) : len;
  return '<div class="wa-practice"><div class="top"><div><small>ПРАКТИКА</small><h3>' + (complete ? 'Сделано.<br><em>Ты молодец.</em>' : 'Теперь —<br><em>руками.</em>') + '</h3></div>' +
    '<div class="wa-ring" role="img" aria-label="Сделано шагов: ' + done + ' из ' + total + '"><svg viewBox="0 0 62 62"><circle cx="31" cy="31" r="28" fill="none" stroke="#FFFFFF24" stroke-width="6"/><circle cx="31" cy="31" r="28" fill="none" stroke="#DFFF70" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + len.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg><b>' + done + '/' + total + '</b></div></div>' +
    '<div class="wa-steps">' + d.steps.map((st, i) => {
      const v = r.steps[String(i)], ok = C.stepDone(st, v), t = C.tone(i, d.type), night = t === 'night';
      return '<button class="wa-step' + (ok ? ' done' : '') + '" data-wa="practice" data-i="' + i + '" aria-label="Шаг ' + (i + 1) + '. ' + esc(st.title) + '. ' + (ok ? 'Сделано: ' + esc(C.summary(st, v)) : 'Не сделано') + '">' +
        '<span class="n tone-' + t + '" style="background:' + (night ? '#59416F' : 'var(--bg)') + ';color:' + (night ? '#fff' : 'var(--ink)') + '">' + (ok ? ic('check') : String(i + 1).padStart(2, '0')) + '</span>' +
        '<span class="t"><strong>' + esc(st.title) + '</strong>' + (ok ? '<em>' + esc(C.summary(st, v)) + '</em>' : '') + '</span>' + ic(ok ? 'pencil' : 'arrow-up-right') + '</button>';
    }).join('') + '</div>' +
    '<button class="wa-primary" data-wa="practice" data-i="' + (complete ? total : next) + '"><span>' + (complete ? 'Посмотреть мои ответы' : done === 0 ? 'Начать практику' : 'Продолжить · шаг ' + (next + 1)) + '</span><b>' + ic('arrow-up-right') + '</b></button></div>';
}

/* ---------- Урок: короткая версия, аудио, полный текст ---------- */
function art(type, toneKey, number) {
  if (number) return '<div class="wa-art" aria-hidden="true"><span class="big"></span><span class="core"></span><span class="digit">' + number + '</span></div>';
  switch (type) {
    case 'digital': return '<div class="wa-art" aria-hidden="true"><span class="bub"></span><span class="bub"></span><span class="bub"></span></div>';
    case 'sleep': return '<div class="wa-art" aria-hidden="true"><span class="moon"></span><span class="wa-star" style="left:120px;top:14px">✦</span><span class="wa-star" style="left:156px;top:52px;font-size:12px;animation-delay:.4s">✦</span><span class="wa-star" style="left:134px;top:96px;font-size:22px;animation-delay:.8s">✦</span></div>';
    case 'identity': case 'values': case 'support': return '<div class="wa-art" aria-hidden="true"><span class="word">' + (type === 'identity' ? 'я.' : type === 'values' ? 'да.' : 'ты.') + '</span></div>';
    case 'reflect': return '<div class="wa-art" aria-hidden="true"><span class="word sm">к себе.</span></div>';
    case 'connect': case 'boundary': return '<div class="wa-art ' + type + '" aria-hidden="true"><span class="wa-orb a"></span><span class="wa-orb b"></span></div>';
    case 'movement': return '<div class="wa-art" aria-hidden="true"><svg class="path" viewBox="0 0 190 150" style="width:190px;height:150px"><path d="M8 120 C70 130 90 20 180 26" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="3 9"/><circle cx="9" cy="120" r="9" fill="var(--accent)"/></svg></div>';
    default: return '<div class="wa-art" aria-hidden="true"><span class="blob"></span><span class="blob"></span><span class="blob"></span></div>';
  }
}
function lessonPage() {
  const d = day(), t = C.tone(0, d.type), audioMode = cfg.audio && ui.lessonMode === 'audio', mine = A.day === d.day;
  return '<div class="wa-page"><div class="wa-backbar"><button class="wa-circle" data-wa="back-home" aria-label="Назад">' + ic('arrow-left') + '</button><span>ТЕОРИЯ · ДЕНЬ ' + d.day + '</span></div>' +
    '<div class="wa-cover tone-' + t + '"><span class="num" aria-hidden="true">' + String(d.day).padStart(2, '0') + '</span>' + art(d.type, t) +
    '<div class="cap"><small>ДЕНЬ ' + d.day + '</small><h1>' + esc(d.title) + '</h1></div></div>' +
    (cfg.audio ? '<div class="wa-modes" role="group" aria-label="Формат"><button data-wa="lesson-mode" data-mode="text" aria-pressed="' + !audioMode + '">' + ic('align-left') + 'Текст</button><button data-wa="lesson-mode" data-mode="audio" aria-pressed="' + audioMode + '">' + ic('headphones') + 'Аудио</button></div>' : '') +
    (audioMode ? '<div class="wa-audio"><div class="row"><button class="play" data-wa="lesson-play" data-audio-btn="' + d.day + '" aria-label="Прослушать теорию">' + ic('play') + '</button><div><strong>' + esc(d.audioTitle) + '</strong><small data-audio-msg2="' + d.day + '">' + esc(mine && A.error ? A.error : 'Запись mía · играет, пока ты переходишь по разделам') + '</small></div>' + wave(mine && A.el && !A.el.paused) + '</div>' +
      '<div class="wa-seek"><span data-audio-pos="' + d.day + '">0:00</span><input type="range" min="0" max="' + d.audioSeconds + '" step="1" value="0" data-audio-seek="' + d.day + '" aria-label="Позиция в записи"><span data-audio-dur="' + d.day + '">' + C.clock(d.audioSeconds) + '</span></div></div>' +
      '<p class="wa-eyebrow" style="font-size:10px;margin:20px 0 0">ПОЛНЫЙ ТЕКСТ — НИЖЕ</p>' : '') +
    '<div class="wa-short">' + d.lesson.map(p => '<p>' + esc(p) + '</p>').join('') + '</div>' +
    (figs() ? call(() => figs().figureFor(d.day, { still: still() }), '') : '') +
    '<section class="wa-full" aria-label="Что полезно знать"><h2>' + ic('book-open') + 'ЧТО ПОЛЕЗНО ЗНАТЬ</h2>' + d.full.map(p => '<p>' + esc(p) + '</p>').join('') + '</section>' +
    '<button class="wa-dark" data-wa="lesson-done"><span>Понятно, к практике</span><b>' + ic('arrow-right') + '</b></button></div>';
}
function wave(on) { return '<span class="wa-wave' + (on ? ' on' : '') + '" data-audio-wave aria-hidden="true">' + [10, 18, 12, 23, 15, 20, 9, 17].map(h => '<i style="height:' + h + 'px"></i>').join('') + '</span>'; }

/* ---------- Аудио: одна запись на всё приложение, играет при переходах ---------- */
function prepare(d) {
  if (A.day === d.day && A.el && !A.error) return;
  calmStop();
  stopAudio(true);
  A.day = d.day; A.title = 'День ' + d.audioTopic + ' · ' + d.audioTitle; A.error = null;
  const el = new Audio(); el.preload = 'metadata'; el.src = C.audioURL(d, cfg.audioBase);
  el.addEventListener('timeupdate', () => updateAudioUI(false));
  el.addEventListener('loadedmetadata', () => updateAudioUI(false));
  el.addEventListener('play', () => { A.error = null; updateAudioUI(true); media(); });
  el.addEventListener('pause', () => { updateAudioUI(true); media(); });
  el.addEventListener('ended', () => { el.currentTime = 0; updateAudioUI(true); });
  el.addEventListener('error', () => { if (A.el === el) { A.error = copy.offline; updateAudioUI(true); } });
  A.el = el;
  renderPlayer();
}
function toggleAudio() {
  if (!A.el) return;
  if (A.error) { const t = A.el.currentTime || 0; A.error = null; A.el.load(); try { A.el.currentTime = t; } catch (e) { /* не важно */ } }
  if (A.el.paused) { const p = A.el.play(); if (p && p.catch) p.catch(err => { if (!A.el || !A.el.paused || (err && err.name === 'NotAllowedError') || (err && err.name === 'AbortError')) { updateAudioUI(true); return; } A.error = copy.offline; updateAudioUI(true); }); }
  else A.el.pause();
}
function stopAudio(silent) {
  if (A.el) { A.el.pause(); A.el.removeAttribute('src'); try { A.el.load(); } catch (e) { /* пусто */ } }
  A.el = null; A.day = null; A.title = ''; A.error = null;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  if (!silent && mode === 'app') { renderPlayer(); updateAudioUI(true); }
}
function media() {
  if (!('mediaSession' in navigator) || !A.el) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: A.title, artist: 'mía · день ' + A.day, artwork: [{ src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png' }] });
    navigator.mediaSession.setActionHandler('play', () => A.el && A.el.play());
    navigator.mediaSession.setActionHandler('pause', () => A.el && A.el.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => { if (A.el) A.el.currentTime = Math.max(0, A.el.currentTime - 15); });
    navigator.mediaSession.setActionHandler('seekforward', () => { if (A.el) A.el.currentTime = A.el.currentTime + 15; });
    navigator.mediaSession.setActionHandler('seekto', e => { if (A.el && Number.isFinite(e.seekTime)) A.el.currentTime = e.seekTime; });
  } catch (e) { /* не все браузеры знают все действия */ }
}
function showPlayer() { return A.day !== null && !(ui.tab === 'today' && ui.route === 'lesson' && ui.lessonMode === 'audio' && A.day === ui.viewDay); }
function renderPlayer() {
  const box = $('#wa-player'); if (!box) return;
  const on = showPlayer();
  box.innerHTML = on ? '<div class="wa-player"><button class="play" data-wa="player-toggle" data-audio-btn="player" aria-label="Продолжить слушать">' + ic('play') + '</button>' +
    '<button class="meta" data-wa="player-open"><strong>' + esc(A.title) + '</strong><small data-audio-mini>0:00 · день ' + A.day + '</small></button>' + wave(A.el && !A.el.paused) +
    '<button class="close" data-wa="player-close" aria-label="Закрыть плеер">' + ic('x') + '</button></div>' : '';
  const main = $('#wa-main'); if (main) main.classList.toggle('with-player', on);
  icons(); updateAudioUI(true);
}
function updateAudioUI(full) {
  if (!root) return;
  const el = A.el, pos = el ? el.currentTime || 0 : 0, dur = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0, playing = !!el && !el.paused;
  root.querySelectorAll('[data-audio-btn]').forEach(b => {
    const k = b.dataset.audioBtn, mine = k === 'player' || Number(k) === A.day, p = mine && playing;
    if (full && b.dataset.state !== String(p)) { b.dataset.state = String(p); b.innerHTML = ic(p ? 'pause' : 'play'); b.setAttribute('aria-label', p ? 'Пауза' : k === 'player' ? 'Продолжить слушать' : 'Слушать голосовое'); }
  });
  if (full) { icons(); root.querySelectorAll('[data-audio-wave]').forEach(w => w.classList.toggle('on', playing)); }
  root.querySelectorAll('[data-audio-bars]').forEach(b => {
    const mine = Number(b.dataset.audioBars) === A.day, prog = mine && dur ? pos / dur : 0, bars = b.children;
    for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i / bars.length < prog);
  });
  root.querySelectorAll('[data-audio-time]').forEach(t => {
    if (Number(t.dataset.audioTime) !== A.day || !dur) return;
    t.textContent = (pos > 0 ? C.clock(pos) + ' / ' : '') + C.clock(dur);
  });
  root.querySelectorAll('[data-audio-msg]').forEach(m => {
    const d = P.days.find(x => x.day === Number(m.dataset.audioMsg));
    m.textContent = Number(m.dataset.audioMsg) === A.day && A.error ? A.error : d.audioTitle;
  });
  root.querySelectorAll('[data-audio-msg2]').forEach(m => { if (Number(m.dataset.audioMsg2) === A.day) m.textContent = A.error || 'Запись mía · играет, пока ты переходишь по разделам'; });
  root.querySelectorAll('[data-audio-pos]').forEach(t => { if (Number(t.dataset.audioPos) === A.day) t.textContent = C.clock(pos); });
  root.querySelectorAll('[data-audio-dur]').forEach(t => { if (Number(t.dataset.audioDur) === A.day && dur) t.textContent = C.clock(dur); });
  root.querySelectorAll('[data-audio-seek]').forEach(r => { if (Number(r.dataset.audioSeek) !== A.day || r === document.activeElement) return; if (dur) r.max = String(Math.round(dur)); r.value = String(Math.floor(pos)); });
  const mini = root.querySelector('[data-audio-mini]'); if (mini) mini.textContent = A.error ? A.error : C.clock(pos) + ' из ' + C.clock(dur) + ' · день ' + A.day;
}

/* ---------- Практика во весь экран (PracticeFlow.swift) ---------- */
function openPractice(start) {
  const d = day();
  ui.flow = { index: Math.min(Math.max(start, 0), Math.max(d.steps.length - 1, 0)), finished: start >= d.steps.length, draft: [], picked: null, showShared: false, line: 0, busy: false };
  loadDraft(); ui.route = 'practice'; renderFlow();
}
function loadDraft() {
  const f = ui.flow, d = day(), st = d.steps[f.index]; if (!st) return;
  f.draft = [...(record().steps[String(f.index)] || [])]; f.picked = f.draft[0] || null; f.line = 0;
  f.showShared = info().sharesKids || (!!st.shared && f.picked === st.shared);
  if (st.kind === 'lines') f.draft = (st.prompts || []).map((_, i) => f.draft[i] || '');
}
function closeFlow() { ui.flow = null; ui.route = 'home'; renderFlow(); renderMain(); renderPlayer(); }
function commit(values, delay) {
  const f = ui.flow, d = day(), index = f.index;
  const n = ui.viewDay, was = dayDone(n), wasComplete = C.isComplete(d, record());
  S.records[ui.viewDay] = C.setStep(d, record(), index, values); persist();
  T('practice_step', { day: d.day, step: index + 1, kind: d.steps[index] && d.steps[index].kind });
  if (!wasComplete && C.isComplete(d, record(n))) { evApp('practice_done', { day: n }); T('practice_done', { day: d.day }); }
  dayCheck(n, was);
  f.busy = true;
  if (delay) renderFlow(true);
  setTimeout(() => {
    if (ui.flow !== f) return;
    f.busy = false;
    const next = C.nextUndone(d, record(), index);
    if (next >= 0) { f.index = next; loadDraft(); } else f.finished = true;
    renderFlow();
  }, delay || 0);
}
function renderFlow(keep) {
  const layer = $('#wa-layer'); if (!layer) return;
  if (!ui.flow) { layer.innerHTML = ''; setInert(); return; }
  const f = ui.flow, d = day();
  if (f.finished) { layer.innerHTML = finishScreen(d); icons(); setInert(); focusFirst(layer); return; }
  const st = d.steps[f.index], t = C.tone(f.index, d.type), total = d.steps.length;
  const groundNumber = d.type === 'ground' && total === 3 ? ['3', '2', '1'][f.index] : null;
  const title = st.kind === 'lines' ? (st.prompts || [])[f.line] || st.title : st.title;
  const body = layer.querySelector('.wa-flow-body'), top = keep && body ? body.scrollTop : 0;
  layer.innerHTML = '<section class="wa-flow tone-' + t + '" role="dialog" aria-modal="true" aria-label="Практика: ' + esc(d.practiceTitle) + '">' +
    '<div class="wa-flow-top"><button class="wa-circle" data-wa="flow-back" aria-label="' + (f.index > 0 ? 'Предыдущий шаг' : 'Закрыть практику') + '">' + ic(f.index > 0 ? 'arrow-left' : 'x') + '</button>' +
    '<div class="wa-segs" role="img" aria-label="Шаг ' + (f.index + 1) + ' из ' + total + '">' + d.steps.map((_, i) => '<i class="' + (i <= f.index ? 'on' : '') + '"></i>').join('') + '</div>' +
    '<button class="wa-circle" data-wa="flow-close" aria-label="Закрыть практику"' + (f.index > 0 ? '' : ' style="visibility:hidden" tabindex="-1"') + '>' + ic('x') + '</button></div>' +
    '<div class="wa-flow-body"><div class="wa-hero"><span class="num" aria-hidden="true">' + String(f.index + 1).padStart(2, '0') + '</span>' + art(d.type, t, groundNumber) + '</div>' +
    '<p class="kick">ШАГ ' + (f.index + 1) + ' ИЗ ' + total + ' · ' + esc(d.practiceTitle.toUpperCase()) + '</p><h2 id="wa-step-title">' + esc(title) + '</h2>' +
    (st.body ? '<p class="lead">' + esc(st.body) + '</p>' : '') +
    (st.why && (st.kind !== 'lines' || f.line === 0) ? '<div class="wa-why"><span class="wa-why-k">' + 'Зачем' + '</span><p>' + esc(st.why) + '</p></div>' : '') +
    (f.index === 0 && d.intro.length ? '<div class="wa-note plain">' + esc(d.intro.join(' ')) + '</div>' : '') +
    '<div class="wa-flow-content">' + stepContent(d, st) + '</div>' +
    (st.note ? '<div class="wa-note">' + ic('sparkles') + '<span>' + esc(st.note) + '</span></div>' : '') + '</div></section>';
  icons(); setInert();
  const nb = layer.querySelector('.wa-flow-body'); if (nb) nb.scrollTop = top;
  if (!keep) { const h = layer.querySelector('#wa-step-title'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
}
const letters = 'ABCDEFGH';
function stepContent(d, st) {
  const f = ui.flow, i = f.index, txt = k => String(f.draft[k] || '').trim();
  const act = (title, action, disabled) => '<button class="wa-act" data-wa="' + action + '"' + (disabled ? ' disabled' : '') + '><span>' + title + '</span><b>' + ic('check') + '</b></button>';
  const field = (k, ph, max) => '<textarea class="wa-field" rows="3" data-field="draft" data-k="' + k + '" maxlength="' + max + '" placeholder="' + esc(ph) + '" aria-labelledby="wa-step-title">' + esc(f.draft[k] || '') + '</textarea>';
  const counter = k => '<div class="wa-counter" data-counter="' + k + '">' + [...txt(k)].length + ' / ' + C.INPUT_LIMIT + '</div>';
  switch (st.kind) {
    case 'options': {
      let h = st.options.map((o, n) => tile(letters[n] || '·', o, f.picked === o, 'opt', n)).join('');
      if (st.shared) h += f.showShared ? tile(letters[st.options.length] || '·', st.shared, f.picked === st.shared, 'opt', 'shared', 'Если у вас общие дети') : '<button class="wa-link" data-wa="shared-show">' + ic('plus') + 'У вас общие дети? Для тебя есть отдельный вариант</button>';
      if (st.custom && f.picked === st.custom) h += field(1, st.placeholder ? 'Например: ' + st.placeholder : 'Напиши своими словами', C.INPUT_LIMIT) + counter(1) + act('Готово', 'commit-custom', !txt(1));
      return h;
    }
    case 'multi':
      return st.options.map((o, n) => tile(letters[n] || '·', o, f.draft.includes(o), 'multi', n)).join('') + act('Готово', 'commit-multi', !f.draft.length) + '<p class="wa-hint">Можно отметить несколько.</p>';
    case 'check':
      return (st.show ? insight(st.show) : '') + act('Сделано', 'commit-check', false) + '<p class="wa-hint">Не спеши. Кнопка подождёт.</p>';
    case 'number': {
      const before = st.show === 'numbers' ? C.checks(P, S.records, 12) : null;
      return (before !== null ? '<div class="wa-tiles2"><div class="wa-numtile"><small>ДЕНЬ 12</small><b>' + before + '</b></div>' + ic('arrow-right') + '<div class="wa-numtile"><small>СЕГОДНЯ</small><b data-today-num>' + esc(f.draft[0] || '?') + '</b></div></div>' : '') +
        '<input class="wa-number" data-field="number" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="0" value="' + esc(f.draft[0] || '') + '" aria-labelledby="wa-step-title">' + act('Готово', 'commit-number', !C.stepDone(st, f.draft));
    }
    case 'lines': {
      const n = (st.prompts || []).length;
      return '<div class="wa-dots" aria-hidden="true">' + (st.prompts || []).map((_, k) => '<i class="' + (k === f.line ? 'cur' : String(f.draft[k] || '').trim() ? 'filled' : '') + '"></i>').join('') + '</div>' +
        '<textarea class="wa-field" rows="2" data-field="line" maxlength="140" placeholder="Одно-два слова" aria-labelledby="wa-step-title">' + esc(f.draft[f.line] || '') + '</textarea>' +
        '<div class="wa-pair"><button class="wa-ghost" data-wa="line-next"' + (f.line >= n - 1 ? ' disabled' : '') + '>' + (String(f.draft[f.line] || '').trim() ? 'Дальше' : 'Пропустить') + '</button>' +
        '<div style="flex:1.3">' + act(f.line < n - 1 ? 'Сохранить' : 'Сохранить портрет', 'commit-lines', !C.stepDone(st, f.draft)) + '</div></div>' +
        '<p class="wa-hint">Фраза ' + (f.line + 1) + ' из ' + n + '. Любую можно пропустить.</p>';
    }
    default:
      return field(0, st.placeholder ? 'Например: ' + st.placeholder : 'Твой ответ', C.INPUT_LIMIT) + counter(0) + act('Готово', 'commit-text', !txt(0));
  }
}
function tile(letter, title, on, action, v, note) {
  return '<button class="wa-tile" data-wa="' + action + '" data-v="' + v + '" aria-pressed="' + on + '"><span class="l">' + (on ? ic('check') : letter) + '</span><span class="c">' + (note ? '<small>' + esc(note) + '</small>' : '') + '<strong>' + esc(title) + '</strong></span></button>';
}
function insight(show) {
  if (show === 'days') return '<div class="wa-numtile" style="margin-bottom:4px"><small>ДНЕЙ, КОГДА ЧТО-ТО СДЕЛАНО</small><b>' + C.activeDays(S.records) + '</b></div>';
  if (show === 'curve') {
    const pts = C.curve(P, S.records);
    if (!pts.length) return '<p class="lead" style="margin:0 0 4px">Вечерних чисел пока нет. Кривая появится, как только ты запишешь первое.</p>';
    const top = Math.max(1, ...pts.map(p => p.value));
    return '<div class="wa-curve" role="img" aria-label="Твоя кривая с 12-го дня"><div class="bars">' + pts.map(p => '<div><span>' + p.value + '</span><span style="height:' + Math.max(4, p.value / top * 90) + 'px"></span>' + p.day + '</div>').join('').replace(/<span>(\d+)<\/span>/g, '<b style="font-weight:600">$1</b>') + '</div><p>Каждый столбик — один вечер, начиная с 12-го дня. Это не оценка, а то, что было.</p></div>';
  }
  return '';
}
function finishScreen(d) {
  const r = record(), msg = C.message(d, r);
  return '<section class="wa-flow wa-finish" role="dialog" aria-modal="true" aria-label="День сделан"><div class="wa-flow-body" style="padding-top:calc(16px + env(safe-area-inset-top))">' +
    '<img class="heart" src="assets/glass-heart-v6.webp" alt="" aria-hidden="true">' +
    '<p class="kick" style="color:#4D5C37;font-weight:700">ДЕНЬ ' + d.day + ' · ВСЕ ШАГИ СДЕЛАНЫ</p><h2 tabindex="-1">Этот день —<br><em>твой.</em></h2>' +
    '<div class="wa-keeps"><small>' + ic('bookmark-check') + 'ТВОИ ОТВЕТЫ</small>' + d.outro.map(p => '<p>' + esc(p) + '</p>').join('') +
    d.steps.map((st, i) => { const v = r.steps[String(i)]; return v && st.kind !== 'check' ? '<div class="ans"><span>' + esc(st.title) + '</span><b>' + esc(C.summary(st, v)) + '</b></div>' : ''; }).join('') + '</div>' +
    (msg ? '<div class="wa-card" style="margin-top:12px"><span class="wa-eyebrow" style="color:#4D5C37">ТВОЁ СООБЩЕНИЕ</span><div class="msg">' + esc(msg) + '</div><button class="wa-link" style="color:var(--wa-violet)!important" data-wa="copy-msg">' + ic('copy') + 'Скопировать сообщение</button><small class="wa-muted" style="font-size:12px">mía ничего не отправляет сама.</small></div>' : '') +
    (d.day === 13 ? portraitCompare() : '') +
    '<button class="wa-dark" style="margin-top:18px" data-wa="flow-close"><span>Вернуться к моему дню</span><b>' + ic('arrow-up-right') + '</b></button>' +
    '<p class="wa-hint" style="margin-top:14px;color:#4D5C37">В твоём темпе. Без «надо успеть».</p></div></section>';
}
function portraitCompare() {
  const then = record(5).steps['0'] || [], now = record(13).steps['0'] || [];
  if (!then.length) return '';
  return '<div class="wa-card" style="margin-top:12px"><div class="wa-compare"><div class="row" style="border:0;padding:0"><span class="wa-eyebrow">ДЕНЬ 5</span><span class="wa-eyebrow" style="color:var(--wa-violet)">СЕГОДНЯ</span></div>' +
    P.portrait.map((p, i) => (then[i] || now[i]) ? '<div class="row"><small>' + esc(p.replace(/…/g, '')) + '</small><span>' + esc(then[i] || '—') + '</span><b style="font-weight:600">' + esc(now[i] || '—') + '</b></div>' : '').join('') +
    '</div><small class="wa-muted" style="font-size:13px">Новый ответ — не оценка. Это ещё один способ услышать себя.</small></div>';
}

/* ---------- Урок в чате (webapp-lesson.js): включается, когда есть data/segment.json и data/lesson-ui.json (сейчас только /ru/) ---------- */
/* lessonOn объявлен выше, у still() */
const LCx = () => (lessonOn ? window.MiaLessonChat : null);
function segOrder() {
  const pad = n => String(n).padStart(2, '0');
  return G ? G.months.flatMap(m => m.blocks.flatMap(b => b.lessons.map(l => ({ id: segP() + '-m' + pad(m.n) + '-d' + pad(l.n), n: segAbs(m.n, l.n), title: l.title, month: m.n, monthShort: segSplit(m.title)[0], stage: m.stage || '' })))) : [];
}
function lessonInit() {
  const M = window.MiaLessonChat; if (!M || !G || !store) return;
  M.init({ esc, ic, name, store, key: C.STORAGE_KEY + '-lessons', track: T, still, toast, icons, order: segOrder(), openAny: !!cfg.testTools, stages: () => G.months.map(m => m.stage || segSplit(m.title)[0]),
    goChat: () => { if (ui.tab !== 'today' || ui.route !== 'home') selectTab('today'); },
    goProgress: () => selectTab('route'),
    onPhrases: () => { if (ui.tab === 'account') renderMain(true); } })
    .then(ok => { lessonOn = !!ok; if (!lessonOn) return; if (ui.tab === 'assist') ui.tab = 'today'; if (mode === 'app') renderApp(); else root.classList.add('wa-lesson-mode'); }).catch(() => {});
}

/* ---------- Звонок Мии (режим урока, 04.11.2026, владелец): «Позвонить» в шапке вместо «Я рядом» ----------
   Экран звонка — макет владельца call/ (v13) в iframe листа снизу, связь — postMessage (call/bridge.js). Подписи — lesson-ui.json → call.
   Лист сворачивается («Свернуть» в окне, потянуть вниз, Escape, нажатие мимо) — разговор идёт дальше: в шапке время звонка,
   над меню строка «Звонок с Мией» (вернуться / завершить). Лист лежит в #wa, вне #wa-frame: перерисовка приложения не перезапускает iframe.
   Микрофон и голосовой сервер не подключены — демо из макета. */
const callUi = () => { const lc = LCx(); return (lc && lc.ui().call) || null; };
const callLive = () => ['ringing', 'speaking', 'listening'].includes(CALL.state);
function callSend(cmd) { if (CALL.frame && CALL.frame.contentWindow) CALL.frame.contentWindow.postMessage({ mia: 'call', cmd }, location.origin); }
function callOpen() {
  const U = callUi(); if (!U || CALL.open) return;
  if (!CALL.el) {
    CALL.el = document.createElement('div'); CALL.el.className = 'wa-call'; CALL.el.id = 'wa-call';
    CALL.el.innerHTML = '<div class="wa-call-box"><div class="wa-call-dim" data-wa="call-min"></div><section class="wa-call-sheet" role="dialog" aria-modal="true" aria-label="' + esc(U.title) + '">' +
      '<div class="wa-call-grip" aria-hidden="true"><i></i></div><iframe src="call/index.html?start=1" title="' + esc(U.title) + '" allow="microphone"></iframe></section></div>';
    root.appendChild(CALL.el); CALL.frame = CALL.el.querySelector('iframe'); callDrag(CALL.el.querySelector('.wa-call-grip'));
  } else if (!callLive()) { CALL.el.querySelector('.wa-call-sheet').classList.remove('short'); callSend('start'); }
  if (!callLive()) T('call_start');
  CALL.back = document.activeElement; CALL.open = true;
  void CALL.el.offsetWidth; CALL.el.classList.add('open'); setInert(); callPaint();
  setTimeout(() => { if (CALL.open) CALL.frame.focus(); }, 80);
}
function callMin() {
  if (!CALL.open) return;
  CALL.open = false; CALL.el.classList.remove('open'); setInert(); callPaint();
  const b = CALL.back && CALL.back.isConnected ? CALL.back : root.querySelector('.wa-call-pill'); CALL.back = null; if (b) b.focus({ preventScroll: true });
}
function callReset() { if (CALL.el) CALL.el.remove(); Object.assign(CALL, { el: null, frame: null, open: false, state: 'ready', time: '', back: null }); setInert(); callPaint(); }
/* Время — в шапке и в строке над меню; кнопку и строку перерисовываем только при смене вида, каждую секунду меняется лишь текст. */
function callPaint() {
  const U = callUi(); if (!U || !root) return;
  const live = callLive(), bar = live && !CALL.open, t = /\d/.test(CALL.time) ? CALL.time : U.connecting, key = live + '|' + bar;
  if (CALL.el) CALL.el.classList.toggle('live', live);
  const pill = root.querySelector('.wa-call-pill');
  /* Пока mía печатает в чате, плашку ведёт webapp-lesson.js (presence) — до конца звонка не трогаем. */
  if (pill && pill.dataset.k !== key && (live || !pill.querySelector('[data-lc-status]'))) {
    pill.dataset.k = key; pill.classList.toggle('wa-in-call', live); pill.classList.remove('wa-typing-now');
    pill.innerHTML = live ? '<i class="dot"></i><span data-call-time></span>' : '<i class="dot"></i>' + esc(U.pill) + ' ' + ic('phone');
    pill.setAttribute('aria-label', live ? U.open : U.pill);
  }
  const box = $('#wa-callbar');
  if (box && box.dataset.k !== key) {
    box.dataset.k = key;
    box.innerHTML = bar ? '<div class="wa-callbar"><button class="meta" data-wa="call-open"><i class="dot"></i><span><strong>' + esc(U.bar) + '</strong><small data-call-time></small></span><span class="go">' + esc(U.open) + '</span></button>' +
      '<button class="end" data-wa="call-end" aria-label="' + esc(U.hangup) + '">' + ic('phone-off') + '</button></div>' : '';
    const main = $('#wa-main'); if (main) main.classList.toggle('with-call', bar);
  }
  root.querySelectorAll('[data-call-time]').forEach(n => { n.textContent = t; });
  icons();
}
/* «Потянуть вниз» за полоску сверху листа: больше 80 px — свернуть, иначе вернуть на место. */
function callDrag(grip) {
  let y0 = null, dy = 0;
  const sheet = grip.parentNode, end = () => { if (y0 === null) return; y0 = null; sheet.classList.remove('drag'); sheet.style.transform = ''; if (dy > 80) callMin(); };
  grip.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; sheet.classList.add('drag'); grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', e => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = 'translateY(' + dy + 'px)'; });
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
}
/* «Анализ диалога» («Аккаунт», над «Мои фразы»): итог каждого звонка — когда, сколько, тема, реплики Мии.
   Хранится в этом браузере (<STORAGE_KEY>-calls, последние 50). Разбора слов участницы пока нет — голос не подключён, страница так и говорит. */
const callKey = () => C.STORAGE_KEY + '-calls';
function callLog() { try { const v = JSON.parse((store && store.getItem(callKey())) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function callLogSave(list) { try { if (store) store.setItem(callKey(), JSON.stringify(list.slice(0, 50))); } catch (e) { /* без хранилища итог не сохраняется */ } }
function callSaved(d) {
  const time = String(d.time || ''), m = /^(\d+):(\d\d)$/.exec(time), secs = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  const lines = Array.isArray(d.lines) ? d.lines.map(String).filter(Boolean).slice(0, 12) : [];
  callLogSave([{ id: String(Date.now()), at: Date.now() - secs * 1000, time, topic: String(d.topic || ''), lines }].concat(callLog()));
  if (ui.tab === 'account' && (ui.account === 'main' || ui.account === 'calls')) renderMain(true);
}
function callsPage() {
  const U = callUi(), list = callLog(), lang = document.documentElement.lang || undefined;
  const when = at => new Date(at).toLocaleString(lang, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return '<div class="wa-page"><div class="wa-backbar"><button class="wa-circle" data-wa="phrases-back" aria-label="' + esc(LCx().ui().back) + '">' + ic('arrow-left') + '</button><span>' + esc(U.analysisTitle.toUpperCase()) + '</span></div>' +
    '<h1 class="wa-display" style="margin-top:16px;font-size:36px">' + esc(U.analysisTitle) + '</h1>' +
    (list.length ? list.map(c => '<div class="wa-lc-saved"><small>' + esc(fillUi(U.callHead, { date: when(c.at), duration: c.time })) + '</small><strong>' + esc(c.topic || U.topicDefault) + '</strong>' +
      (c.lines && c.lines.length ? '<p><b>' + esc(U.miaSaid) + ':</b> ' + c.lines.map(l => '«' + esc(l) + '»').join(' ') + '</p>' : '') +
      '<p class="from">' + esc(U.pending) + '</p><div class="btns"><button class="wa-chip" data-wa="call-del" data-id="' + esc(c.id) + '">' + ic('trash-2') + esc(U.remove) + '</button></div></div>').join('')
      : '<p class="wa-muted" style="font-size:16px;line-height:1.55;margin-top:12px">' + esc(U.analysisEmpty) + '</p>') + '</div>';
}
window.addEventListener('message', e => {
  const d = e.data;
  if (e.origin !== location.origin || !CALL.frame || e.source !== CALL.frame.contentWindow || !d || d.mia !== 'call') return;
  if (d.ev === 'minimize' || d.ev === 'close') { callMin(); return; }
  if (d.ev === 'analysis') { callMin(); selectTab('account'); ui.account = 'calls'; renderMain(); return; }
  if (d.ev === 'summary') { callSaved(d); return; }
  const sheet = CALL.el.querySelector('.wa-call-sheet');
  if (d.ev === 'size') { const h = Number(d.h); if (h > 0) { sheet.style.setProperty('--call-h', h + 'px'); sheet.classList.add('short'); } return; }
  if (d.ev === 'drag') { const dy = Math.max(0, Number(d.dy) || 0); sheet.classList.toggle('drag', !d.done); sheet.style.transform = d.done ? '' : 'translateY(' + dy + 'px)'; if (d.done && dy > 80) callMin(); return; }
  if (d.ev !== 'state') return;
  const was = callLive(); CALL.state = String(d.state || 'ready'); CALL.time = String(d.time || '');
  if (was && !callLive()) T('call_end', { state: CALL.state, time: CALL.time });
  if (was && CALL.state === 'ready') callMin(); /* сбросили, пока шёл вызов, — показывать нечего */
  if (CALL.state !== 'ended') sheet.classList.remove('short');
  callPaint();
});

/* ---------- «Progreso»: карта сегмента 1 «Чтобы он скучал» (полгода, 08.11.2026, по папке владельца «Миа») ----------
   6 месяцев × 30 уроков, в месяце 6 блоков по 5 дней. День урока — рекомендуемый порядок: блоки не закрыты,
   их можно открыть и посмотреть заранее. Текущий день — today(); тексты — data/segment.json (в /ru/ — русский оригинал). */
const SEG_TONES = ['0', 'I', 'II', 'III', 'IV', '0'];
const segAbs = (m, d) => (m - 1) * 30 + d;
const segP = () => (G && /^[a-z0-9]{1,8}$/.test(G.lessonPrefix || '') ? G.lessonPrefix : 's1'); /* номер программы в id урока: s1 — «Желанная. Оставаясь собой.», zh1 — «Желанная женщина» */
const fillUi = (tpl, o) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (o[k] !== undefined ? o[k] : ''));
function segSplit(title) { const i = String(title).indexOf(':'); if (i < 0) return [title, '']; const rest = title.slice(i + 1).trim(); return [title.slice(0, i), rest.charAt(0).toUpperCase() + rest.slice(1)]; }
function segPage() {
  if (ui.progress === 'seg-about') return segAboutPage();
  if (typeof ui.progress === 'string' && ui.progress.indexOf('b:') === 0) { const [, m, b] = ui.progress.split(':').map(Number); return segBlockPage(m, b); }
  const total = G.months.length * 30, lc = LCx(), order = lc ? segOrder() : null, curL = lc && order.find(o => o.id === lc.currentId());
  const t = lc ? (curL ? curL.n : total) : today(), doneDays = lc ? lc.completedCount() : P.days.filter(d => C.isComplete(d, S.records[d.day])).length, mon = Math.min(G.months.length, Math.max(1, Math.ceil(t / 30)));
  return '<div class="wa-page"><div class="wa-plate"><img class="heart" src="assets/glass-heart-v6.webp" alt="" aria-hidden="true"><span class="wa-eyebrow" style="color:#DDC9EE;position:relative">ПРОГРАММА</span>' +
    (lc && G.programTitle ? '<h1>' + esc(G.programTitle.split('. ')[0]) + '.<br><em>' + esc(G.programTitle.split('. ').slice(1).join('. ')) + '</em></h1>' : '<h1>Полгода,<br>чтобы он<br><em>скучал.</em></h1>') + '<div class="wa-stats"><div><b>' + t + '</b><small>' + (lc ? esc(fillUi(lc.ui().progress.lessonOf, { total })) : 'день из ' + total) + '</small></div><div><b>' + doneDays + '</b><small>' + (lc ? esc(doneDays === 1 ? lc.ui().progress.lessonDone : lc.ui().progress.lessonsDone) : doneDays === 1 ? 'день сделан' : 'сделано дней') + '</small></div><div><b>' + mon + '</b><small>месяц из ' + G.months.length + '</small></div></div>' +
    '<div class="wa-result"><small>ТВОЁ ЖЕЛАНИЕ</small><strong>«' + esc(G.segment) + '»</strong></div>' +
    '<button class="wa-plate-link" data-wa="seg-about"><span><strong>Как построена программа</strong><small>Шесть месяцев и что остаётся у тебя после каждого</small></span><b>' + ic('arrow-up-right') + '</b></button></div>' +
    (lc ? segNowCard(lc) : '') +
    '<div class="wa-h2row"><h2>Карта полугода</h2><span class="wa-eyebrow" style="font-size:10px">' + G.months.length + ' МЕСЯЦЕВ · ' + total + ' УРОКОВ</span></div>' +
    (LCx() ? '<p class="wa-muted" style="margin:6px 0 8px;font-size:14px;line-height:1.5">' + esc(LCx().ui().progress.orderNote) + '</p>' : '<p class="wa-muted" style="margin:6px 0 8px;font-size:14px;line-height:1.5">Один урок в день. Это рекомендуемый порядок: можно проходить быстрее, пропускать темы и выбирать то, что важно сейчас.</p>') +
    G.months.map((m, mi) => { const [head, sub] = segSplit(m.title);
      const stg = LCx() && m.stage, U = stg ? Object.assign({}, LCx().ui().progress, G.progressUi || {}) : null, open = !!(ui.segOpen && ui.segOpen[m.n]), here = t >= segAbs(m.n, 1) && t <= segAbs(m.n, 30);
      const nl = m.blocks.reduce((a, b) => a + b.lessons.length, 0), nd = stg ? m.blocks.reduce((a, b) => a + b.lessons.filter(l => LCx().status(segP() + '-m' + String(m.n).padStart(2, '0') + '-d' + String(l.n).padStart(2, '0')) === 'done').length, 0) : 0;
      const meta = U ? fillUi(nd ? U.stageDone : U.stageMeta, { topics: m.blocks.length, lessons: nl, done: nd }) : '';
      return '<div class="wa-block wa-fold' + (open ? ' open' : '') + '"><button class="wa-block-head blk-' + SEG_TONES[mi % SEG_TONES.length] + '" data-wa="seg-stage" data-n="' + m.n + '" aria-expanded="' + open + '"><small>' + (stg ? esc(fillUi(U.stageHead, { n: m.n, from: segAbs(m.n, 1), to: segAbs(m.n, 30) })) : 'МЕСЯЦ ' + m.n + ' · ДНИ ' + segAbs(m.n, 1) + '–' + segAbs(m.n, 30)) + (U && here ? '<b>' + esc(U.stageHere) + '</b>' : '') + '</small><strong>' + esc(stg ? m.stage : head) + '</strong>' + (stg ? '<span>' + esc(m.title) + '.</span>' : sub ? '<span>' + esc(sub) + '.</span>' : '') +
        (U ? '<span class="fold-row"><em>' + esc(G.progressUi && G.progressUi.flatDays ? '' : meta) + '</em><i data-show="' + esc(U.stageShow) + '" data-hide="' + esc(U.stageHide) + '">' + esc(open ? U.stageHide : U.stageShow) + '</i>' + ic('chevron-down') + '</span>' : '') + '</button>' +
        '<div class="wa-fold-body">' + (G.progressUi && G.progressUi.flatDays && LCx() ? segDayList(m) : '<div class="wa-chapters">' + m.blocks.map((b, bi) => segBlockRow(m, b, bi, t)).join('') + '</div>') + '</div></div>'; }).join('') +
    '<p class="wa-muted" style="text-align:center;font-size:13px;line-height:1.5;margin-top:24px">Можно возвращаться, менять темп и отдыхать.<br>Нет срока, к которому должно стать хорошо.</p></div>';
}
/* «Твой путь сейчас»: прошлая, текущая и следующая тема (как экран «Один шаг открывает следующий» онбординга).
   Сразу после «Завершить урок» — анимация: пройденная становится лаймовой с галочкой, следующая — «Теперь доступна». */
function segNowCard(lc) {
  const U = lc.ui().progress, order = segOrder(), cur = lc.currentId(), ci = Math.max(0, order.findIndex(o => o.id === cur));
  const unlock = lc.takeUnlock(), animate = !!(unlock && unlock.next === cur && !still());
  const start = Math.max(0, Math.min(ci - 1, order.length - 3)), items = order.slice(start, start + 3);
  const card = (o, i) => {
    const stt = lc.status(o.id), was = animate && o.id === unlock.done ? 'current' : animate && o.id === unlock.next ? 'locked' : stt;
    const node = was === 'done' ? ic('check') : was === 'locked' ? ic('lock') : String(o.n).padStart(2, '0');
    const note = was === 'done' ? U.statusDone : was === 'locked' ? fillUi(U.statusAfter, { n: o.n - 1 }) : o.id === (unlock && unlock.next) ? U.statusNow : U.statusCurrent;
    return '<button class="wa-now-item st-' + was + '" data-lc="open-lesson" data-id="' + o.id + '" data-final="' + stt + '"><span class="node">' + node + '</span><span class="card"><small>' + esc(fillUi(U.topicN, { n: o.n })) + '</small><strong>' + esc(o.title) + '</strong><em>' + esc(note) + '</em></span></button>';
  };
  if (animate) setTimeout(() => {
    const box = document.querySelector('[data-now]'); if (!box) return;
    box.querySelectorAll('.wa-now-item').forEach(el => {
      const fin = el.dataset.final, id = el.dataset.id;
      el.className = 'wa-now-item st-' + fin + ' just';
      el.querySelector('.node').innerHTML = fin === 'done' ? ic('check') : fin === 'locked' ? ic('lock') : String((order.find(o => o.id === id) || {}).n || '').padStart(2, '0');
      el.querySelector('em').textContent = fin === 'done' ? U.statusDone : fin === 'locked' ? el.querySelector('em').textContent : U.statusNow;
    });
    icons();
  }, 650);
  return '<div class="wa-h2row"><h2>' + esc(U.nowTitle) + '</h2></div><div class="wa-now" data-now>' + items.map(card).join('') + '</div>';
}
/* «Желанная женщина» (владелец, 07.11.2026: «все дни по порядку, без групп и без номеров»): этап раскрывается сразу списком
   всех 30 тем по дням; нажатие открывает урок. Включается G.progressUi.flatDays. */
function segDayList(m) {
  const lc = LCx();
  return '<div class="wa-days wa-days-flat">' + m.blocks.flatMap(b => b.lessons).map(l => {
    const id = segP() + '-m' + String(m.n).padStart(2, '0') + '-d' + String(l.n).padStart(2, '0'), stt = lc.status(id), open = stt !== 'locked', cur = stt === 'current' || stt === 'inProgress';
    return '<button class="wa-dayrow' + (open ? '' : ' locked') + (cur ? ' cur' : '') + '" data-lc="open-lesson" data-id="' + id + '"><span class="c"><strong>' + esc(l.title) + '</strong></span>' + ic(stt === 'done' ? 'check' : open ? 'arrow-up-right' : 'lock') + '</button>';
  }).join('') + '</div>';
}
function segBlockRow(m, b, bi, t) {
  const from = segAbs(m.n, b.from), to = segAbs(m.n, b.to), lc = LCx();
  const past = lc ? b.lessons.every(l => lc.status(segP() + '-m' + String(m.n).padStart(2, '0') + '-d' + String(l.n).padStart(2, '0')) === 'done') : t > to, current = !past && t >= from && t <= to;
  return '<button class="wa-chapter open' + (current ? ' current' : '') + (past ? ' full' : '') + '" data-wa="seg-block" data-id="' + m.n + ':' + bi + '">' +
    '<span class="c"><small>ДНИ ' + from + '–' + to + (current ? '<b>ТЫ ЗДЕСЬ</b>' : '') + '</small><strong>' + esc(b.title) + '</strong><em>' + (G.progressUi && G.progressUi.blockLessons ? b.lessons.length + ' ' + esc(plural(b.lessons.length, G.progressUi.blockLessons)) + '</em></span>' : b.lessons.length + ' уроков</em></span>') + ic('arrow-up-right') + '</button>';
}
function segBlockPage(mn, bi) {
  const m = G.months.find(x => x.n === mn), b = m && m.blocks[bi]; if (!b) { ui.progress = 'map'; return segPage(); }
  const t = today(), from = segAbs(m.n, b.from), to = segAbs(m.n, b.to);
  return '<div class="wa-page"><div class="wa-backbar"><button class="wa-circle" data-wa="map-back" aria-label="Назад">' + ic('arrow-left') + '</button><span>МЕСЯЦ ' + m.n + ' · ДНИ ' + from + '–' + to + '</span></div>' +
    '<div class="wa-block-head blk-' + SEG_TONES[(m.n - 1) % SEG_TONES.length] + '" style="margin-top:14px;padding:22px;border-radius:30px"><small>МЕСЯЦ ' + m.n + ' · ' + esc(segSplit(m.title)[0].toUpperCase()) + '</small><strong style="font-size:30px">' + esc(b.title) + '</strong><span style="line-height:1.5">«' + esc(m.desire) + '»</span></div>' +
    '<div class="wa-days">' + b.lessons.map(l => { const day = segAbs(m.n, l.n), lc = LCx();
      if (lc) {
        const id = segP() + '-m' + String(m.n).padStart(2, '0') + '-d' + String(l.n).padStart(2, '0'), stt = lc.status(id), U = lc.ui().progress, open = stt !== 'locked';
        return '<button class="wa-dayrow' + (open ? '' : ' locked') + (stt === 'current' || stt === 'inProgress' ? ' cur' : '') + '" data-lc="open-lesson" data-id="' + id + '" style="align-items:flex-start;padding:14px 0"><span class="wa-mark' + (stt === 'done' ? ' done' : '') + '">' + (stt === 'done' ? ic('check') : String(day).padStart(2, '0')) + '</span><span class="c"><strong>' + esc(l.title) + '</strong><small style="line-height:1.45">' + esc(l.about) + '</small>' +
          '<small style="font-weight:600;' + (open ? 'color:var(--wa-violet)' : '') + '">' + esc(stt === 'locked' ? U.locked + ' · ' + U.lockedNote : U[stt]) + '</small></span>' + ic(open ? 'arrow-up-right' : 'lock') + '</button>';
      }
      const cur = day === t;
      return '<div class="wa-dayrow' + (cur ? ' cur' : '') + '" style="align-items:flex-start;padding:14px 0"><span class="wa-mark">' + String(day).padStart(2, '0') + '</span><span class="c"><strong>' + esc(l.title) + '</strong><small style="line-height:1.45">' + esc(l.about) + '</small>' + (cur ? '<small style="color:var(--wa-violet);font-weight:600">Сегодня</small>' : '') + '</span></div>'; }).join('') +
    '</div><button class="wa-quiet" style="margin-top:8px" data-wa="map-back">Вернуться к карте</button></div>';
}
/* «Как построена программа» (08.11.2026, владелец: «слишком скомкано»): сначала как проходить — не спеша и вникая,
   потом устройство темы, этапы (раскрываются по нажатию), к чему придёшь и отзывы. Тексты — G.about (data/segment.json). */
function segAboutRich(A) {
  const titleParts = String(G.programTitle || '').split('. ');
  return '<div class="wa-page wa-about"><div class="wa-backbar"><button class="wa-circle" data-wa="map-back" aria-label="' + esc(A.button) + '">' + ic('arrow-left') + '</button><span>' + esc(A.eyebrow) + '</span></div>' +
    '<h1 class="wa-display wa-about-h1">' + esc(titleParts[0]) + '.<br><em>' + esc(titleParts.slice(1).join('. ')) + '</em></h1>' +
    '<p class="wa-about-lead">' + esc(A.lead) + '</p>' +
    '<section class="wa-about-pace"><small>' + esc(A.pace.kicker) + '</small><h2>' + A.pace.title + '</h2><p>' + esc(A.pace.text) + '</p>' +
      '<div class="rules">' + A.pace.rules.map(r => '<div class="rule"><span class="ico">' + ic(r.icon) + '</span><div><strong>' + esc(r.title) + '</strong><span>' + esc(r.text) + '</span></div></div>').join('') + '</div></section>' +
    '<h2 class="wa-about-h2">' + esc(A.lessonTitle) + '</h2><ol class="wa-about-steps">' + A.lessonSteps.map(x => '<li><strong>' + esc(x.title) + '</strong><span>' + esc(x.text) + '</span></li>').join('') + '</ol>' +
    '<h2 class="wa-about-h2">' + esc(A.stagesTitle) + '</h2><p class="wa-about-sub">' + esc(A.stagesLead) + '</p>' +
    G.months.map((m, mi) => '<details class="wa-about-stage blk-' + SEG_TONES[mi % SEG_TONES.length] + '"' + (mi === 0 ? ' open' : '') + '><summary><span class="n">' + String(m.n).padStart(2, '0') + '</span><span class="t"><strong>' + esc(m.stage || segSplit(m.title)[0]) + '</strong><small>' + esc(m.title) + '</small></span>' + ic('chevron-down') + '</summary>' +
      '<div class="body"><small>' + esc(A.desireLabel) + '</small><p class="desire">«' + esc(m.desire) + '»</p><small>' + esc(A.keepsLabel) + ' · «' + esc(m.collection) + '»</small><ul>' + m.keeps.map(k => '<li>' + ic('check') + '<span>' + esc(k.charAt(0).toUpperCase() + k.slice(1)) + '</span></li>').join('') + '</ul></div></details>').join('') +
    '<h2 class="wa-about-h2">' + esc(A.resultTitle) + '</h2><p class="wa-about-sub">' + esc(A.resultLead) + '</p>' +
    '<div class="wa-about-changes">' + A.changes.map(c => '<div class="ch"><span class="was">' + esc(c[0]) + '</span>' + ic('arrow-right') + '<span class="now">' + esc(c[1]) + '</span></div>').join('') + '</div>' +
    '<section class="wa-about-portrait"><img class="heart" src="assets/mia-flower.webp" alt="" aria-hidden="true"><small>' + esc(A.portraitTitle) + '</small><p>' + esc(A.portrait) + '</p></section>' +
    '<p class="wa-about-honest">' + esc(A.honest) + '</p>' +
    (A.reviews && A.reviews.length ? '<h2 class="wa-about-h2">' + esc(A.reviewsTitle) + '</h2><div class="wa-about-reviews">' + A.reviews.map(r => '<figure class="rv">' + (r.sample ? '<span class="tag">' + esc(A.sampleTag) + '</span>' : '') + '<blockquote>' + esc(r.text) + '</blockquote><figcaption><strong>' + esc(r.name) + '</strong>' + (r.stage ? '<span>' + esc(r.stage) + '</span>' : '') + '</figcaption></figure>').join('') + '</div>' : '') +
    (LCx().currentId() ? '<button class="wa-dark" style="margin-top:22px" data-lc="open-lesson" data-id="' + LCx().currentId() + '"><span>' + esc(A.startButton || A.button) + '</span><b>' + ic('arrow-right') + '</b></button>' : '') +
    '<button class="wa-quiet" style="margin-top:8px" data-wa="map-back">' + esc(A.button) + '</button></div>';
}
function segAboutPage() {
  if (G.about && LCx()) return segAboutRich(G.about);
  return '<div class="wa-page"><div class="wa-backbar"><button class="wa-circle" data-wa="map-back" aria-label="Назад">' + ic('arrow-left') + '</button><span>КАК ПОСТРОЕНА ПРОГРАММА</span></div>' +
    '<h1 class="wa-display" style="margin-top:16px;font-size:36px">Шесть месяцев,<br><em>шаг за шагом.</em></h1>' +
    '<p class="wa-muted" style="font-size:16px;line-height:1.55;margin:10px 0 0">Твоё желание: «' + esc(G.segment) + '». Каждый месяц работает с одной его частью: 30 уроков, шесть блоков по пять дней.</p>' +
    '<div class="wa-callout">Формат урока: текст → голосовое → закрепление → применение → вопросы в чате → «Завершить урок».</div>' +
    '<h2 style="margin:28px 0 4px;font-size:21px;font-weight:600;letter-spacing:-.5px">Что остаётся у тебя после каждого месяца</h2>' +
    G.months.map((m, mi) => '<div class="wa-stagecan blk-' + SEG_TONES[mi % SEG_TONES.length] + '"><small>МЕСЯЦ ' + m.n + ' · ' + esc(segSplit(m.title)[0].toUpperCase()) + '</small><span>«' + esc(m.collection) + '»: ' + esc(m.keeps.join('; ')) + '.</span></div>').join('') +
    (G.final ? '<div class="wa-callout">' + esc(G.final) + '</div>' : '') +
    '<button class="wa-quiet" style="margin-top:10px" data-wa="map-back">Вернуться к карте</button></div>';
}

/* ---------- «Progreso»: прежняя карта года (если нет data/segment.json) ---------- */
function progressPage() {
  if (G) return segPage();
  if (ui.progress === 'algorithm') return algorithmPage();
  if (typeof ui.progress === 'number') return chapterPage(ui.progress);
  const t = today(), doneDays = P.days.filter(d => C.isComplete(d, S.records[d.day])).length, ch = chapterOf(t);
  return '<div class="wa-page"><div class="wa-plate"><img class="heart" src="assets/glass-heart-v6.webp" alt="" aria-hidden="true"><span class="wa-eyebrow" style="color:#DDC9EE;position:relative">ПРОГРАММА</span>' +
    '<h1>Год,<br>чтобы вернуться<br><em>к себе.</em></h1><div class="wa-stats"><div><b>' + t + '</b><small>день из ' + P.days.length + '</small></div><div><b>' + doneDays + '</b><small>' + (doneDays === 1 ? 'день сделан' : 'сделано дней') + '</small></div><div><b>' + (ch ? ch.id : 1) + '</b><small>глава из 15</small></div></div>' +
    '<div class="wa-result"><small>ГЛАВНЫЙ РЕЗУЛЬТАТ</small><strong>Уметь узнать хорошее обращение и не согласиться на плохое.</strong></div>' +
    '<button class="wa-plate-link" data-wa="algorithm"><span><strong>Как построена программа</strong><small>Восемь шагов от цели назад — почему порядок именно такой</small></span><b>' + ic('arrow-up-right') + '</b></button></div>' +
    '<div class="wa-h2row"><h2>Карта года</h2><span class="wa-eyebrow" style="font-size:10px">5 БЛОКОВ · 15 ГЛАВ</span></div>' +
    '<p class="wa-muted" style="margin:6px 0 8px;font-size:14px;line-height:1.5">Главы открываются по одной, в своё время. Посмотреть, что внутри, можно уже сейчас.</p>' +
    P.blocks.map(b => '<div class="wa-block"><div class="wa-block-head blk-' + b.id + '"><small>БЛОК ' + esc(b.id) + ' · ДНИ ' + esc(b.days) + (b.keeps ? ' · ' + esc(b.keeps) : '') + '</small><strong>' + esc(b.title) + '</strong><span>' + esc(b.promise) + '.</span></div>' +
      '<div class="wa-chapters">' + P.chapters.filter(c => c.block === b.id).map(chapterRow).join('') + '</div></div>').join('') +
    '<p class="wa-muted" style="text-align:center;font-size:13px;line-height:1.5;margin-top:24px">Можно возвращаться, менять темп и отдыхать.<br>Нет срока, к которому должно стать хорошо.</p></div>';
}
function chapterRow(c) {
  const t = today(), current = c.open && t >= c.from && t <= c.to, total = c.to - c.from + 1;
  const done = P.days.filter(d => d.chapter === c.id && C.isComplete(d, S.records[d.day])).length;
  return '<button class="wa-chapter ' + (c.open ? 'open' : 'closed') + (current ? ' current' : '') + (c.open && done === total ? ' full' : '') + '" data-wa="' + (c.open ? 'chapter' : 'chapter-sheet') + '" data-id="' + c.id + '">' +
    '<span class="c"><small>ГЛАВА ' + c.id + ' · ДНИ ' + c.from + '–' + c.to + (current ? '<b>ТЫ ЗДЕСЬ</b>' : '') + '</small><strong>' + esc(c.title) + '</strong><em>' + (c.open ? done + ' из ' + total + ' ' + (total === 1 ? 'день сделан' : 'дней сделано') : 'Откроется в своё время') + '</em></span>' + ic(c.open ? 'arrow-up-right' : 'lock') + '</button>';
}
function chapterPage(id) {
  const c = P.chapters.find(x => x.id === id); if (!c) { ui.progress = 'map'; return progressPage(); }
  const b = P.blocks.find(x => x.id === c.block), t = today();
  return '<div class="wa-page"><div class="wa-backbar"><button class="wa-circle" data-wa="map-back" aria-label="Назад">' + ic('arrow-left') + '</button><span>ГЛАВА ' + c.id + ' · ДНИ ' + c.from + '–' + c.to + '</span></div>' +
    '<div class="wa-block-head blk-' + c.block + '" style="margin-top:14px;padding:22px;border-radius:30px"><small>БЛОК ' + esc(c.block) + ' · ' + esc((b ? b.title : '').toUpperCase()) + '</small><strong style="font-size:32px">' + esc(c.title) + '</strong><span style="line-height:1.5">' + esc(c.about) + '</span></div>' +
    (t >= c.from && t <= c.to ? '<button class="wa-dark" style="margin-top:14px" data-wa="home"><span>Открыть мой день ' + t + '</span><b>' + ic('arrow-right') + '</b></button>' : '') +
    '<div class="wa-days">' + P.days.filter(d => d.chapter === c.id).map(d => {
      const open = C.canOpen(S, d.day), r = S.records[d.day], done = C.doneCount(d, r), complete = done === d.steps.length;
      return '<button class="wa-dayrow' + (open ? '' : ' locked') + (d.day === t ? ' cur' : '') + '" data-wa="open-day" data-day="' + d.day + '" aria-label="День ' + d.day + '. ' + esc(d.title) + (open ? '' : '. Откроется позже') + '">' +
        '<span class="wa-mark' + (complete ? ' done' : '') + '">' + (complete ? ic('check') : String(d.day).padStart(2, '0')) + '</span><span class="c"><strong>' + esc(d.title) + '</strong><small>' +
        esc(complete ? 'День пройден' : open ? (done > 0 ? 'Сделано шагов: ' + done + ' из ' + d.steps.length : 'Ещё не начата') : 'Откроется позже') + '</small></span>' + ic(open ? 'arrow-up-right' : 'lock') + '</button>';
    }).join('') + '</div><button class="wa-quiet" style="margin-top:8px" data-wa="map-back">Вернуться к карте года</button></div>';
}
function algorithmPage() {
  return '<div class="wa-page"><div class="wa-backbar"><button class="wa-circle" data-wa="map-back" aria-label="Назад">' + ic('arrow-left') + '</button><span>КАК ПОСТРОЕНА ПРОГРАММА</span></div>' +
    '<h1 class="wa-display" style="margin-top:16px;font-size:36px">От цели —<br><em>назад, к началу.</em></h1>' +
    '<p class="wa-muted" style="font-size:16px;line-height:1.55;margin:10px 0 0">Конечная цель года — не «найти мужчину». Цель — уметь узнать хорошее обращение и не согласиться на плохое. Если разложить её назад, шаг за шагом, получится порядок программы.</p>' +
    '<div class="wa-algo">' + P.algorithm.map((a, i) => '<div class="it"><b>' + (i + 1) + '</b><div><strong>' + esc(a.goal) + '</strong><span>' + esc(a.need.charAt(0).toUpperCase() + a.need.slice(1)) + '</span></div></div>').join('') + '</div>' +
    '<div class="wa-callout">Поэтому блоков пять, и порядок в них обратный порядку цели: сначала выдохнуть, в конце — снова выбирать.</div>' +
    '<h2 style="margin:28px 0 4px;font-size:21px;font-weight:600;letter-spacing:-.5px">Что ты сможешь после каждого блока</h2>' +
    P.blocks.map(b => '<div class="wa-stagecan blk-' + b.id + '"><small>БЛОК ' + esc(b.id) + ' · ДНИ ' + esc(b.days) + ' · ' + esc(b.title.toUpperCase()) + '</small><span>' + esc(b.can) + '.</span></div>').join('') +
    '<div class="wa-xlist"><span class="wa-eyebrow">ЧЕГО ЗДЕСЬ НЕ БУДЕТ</span>' +
    ['Выводов и диагнозов о бывшем — работаем только с тем, что делала, чувствовала и решала ты.', 'Списков «красных флагов» из интернета — вместо них твой собственный список, твоими словами.', 'Обещаний про нового человека. Обещание года — «ты будешь знать, как с тобой можно».'].map(x => '<p>' + ic('x') + '<span>' + esc(x) + '</span></p>').join('') +
    '</div><button class="wa-quiet" style="margin-top:10px" data-wa="map-back">Вернуться к карте года</button></div>';
}

/* ---------- «Ayuda» ---------- */
function assistPage() {
  const card = (kick, title, note, tone, icon, sheet, night) => '<button class="wa-help-card tone-' + tone + (night ? ' night' : '') + '" data-wa="sheet" data-s="' + sheet + '">' + ic(icon).replace('<i ', '<i class="big" ') +
    '<small>' + kick + '</small><strong>' + title + '</strong><span class="foot"><span>' + note + '</span><b>' + ic('arrow-up-right') + '</b></span></button>';
  return '<div class="wa-page"><p class="wa-eyebrow">ЭКСТРЕННАЯ ПОМОЩЬ</p><h1 class="wa-display" style="margin-top:6px;font-size:42px">Давай<br>по одному.</h1>' +
    '<p class="wa-muted" style="font-size:16px;line-height:1.55;margin:8px 0 18px">Не нужно справляться со всем сразу.<br>Что происходит прямо сейчас?</p>' +
    '<div style="display:grid;gap:12px">' + card('ПАУЗА ПЕРЕД РЕШЕНИЕМ', 'Хочу ему\nнаписать', 'Пауза и разбор сообщения перед отправкой.', 'lilac', 'message-circle', 'urge') +
    card('ПРАКТИКИ С ГОЛОСОМ', 'Меня\nнакрывает', 'Три практики под то, что сильнее: тело, мысли или тянет написать.', 'lime', 'waves', 'overwhelm') +
    card('ДЛЯ НОЧИ', 'Тяжело\nэтой ночью', 'Подышать, замедлиться, обнять себя. Без требования уснуть.', 'night', 'moon', 'hardnight', true) + '</div>' +
    savedSupports() +
    '<p class="wa-eyebrow" style="margin:26px 0 2px">ЖИВОЙ ЧЕЛОВЕК</p>' +
    row('users', 'Попросить близкого побыть рядом', 'Готовая фраза, которую можно отправить', 'sheet', 's="human"', true) +
    (cfg.psychologistUrl ? row('life-buoy', 'Записаться к психологу', 'Консультация со специалистом', 'sheet', 's="psychologist"', true) : '') +
    '<div class="wa-box" style="margin-top:18px"><small>ЕСЛИ ТЕБЕ НЕБЕЗОПАСНО</small><span>Звони 112 (экстренные службы) или на телефон доверия экстренной психологической помощи МЧС России: +7 (495) 989-50-50 — круглосуточно, анонимно и бесплатно.</span></div>' +
    '<div style="margin-top:12px">' + row('message-circle-heart', 'Написать нам', 'Если что-то не работает или хочешь спросить', 'support', '', true) + '</div></div>';
}
function row(icon, title, note, action, attrs, round) {
  return '<button class="wa-row" data-wa="' + action + '"' + (attrs ? ' data-' + attrs : '') + '><span class="ic' + (round ? '' : ' flat') + '">' + ic(icon) + '</span><span class="c"><strong>' + esc(title) + '</strong><small>' + esc(note) + '</small></span>' + ic(round ? 'arrow-up-right' : 'chevron-right') + '</button>';
}
function docLink(icon, title, note, file) {
  return '<a class="wa-row" href="' + esc(cfg.legalBase + file) + '" target="_blank" rel="noopener"><span class="ic flat">' + ic(icon) + '</span><span class="c"><strong>' + esc(title) + '</strong><small>' + esc(note) + '</small></span>' + ic('arrow-up-right') + '</a>';
}
/* Окно cookies открывает analytics.js по клику на [data-cookie-settings]; без аналитики окна нет — и строки тоже. */
const cookieSettings = () => !!(window.MiaAnalytics && typeof window.MiaAnalytics.settings === 'function') && raw.analytics !== false;
/* Режим урока (владелец, 02.11.2026): в «Cuenta» одна строка «Документы», сами документы — на своей странице */
function docsPage() {
  const A = LCx().ui().account;
  return '<div class="wa-page"><div class="wa-backbar"><button class="wa-circle" data-wa="docs-back" aria-label="' + esc(A.docsTitle) + '">' + ic('arrow-left') + '</button><span>' + esc(A.docsTitle.toUpperCase()) + '</span></div>' +
    '<h1 class="wa-display" style="margin:16px 0 6px;font-size:34px">' + esc(A.docsTitle) + '</h1>' + documentsBlock(true) + '</div>';
}
function documentsBlock(bare) {
  return (bare ? '' : '<p class="wa-eyebrow" style="margin:24px 0 4px">ДОКУМЕНТЫ</p>') +
    docLink('file-text', 'Условия подписки', 'Цена, продление, отмена и возвраты', 'terms.html') +
    docLink('shield-check', 'Политика конфиденциальности', 'Какие данные мы храним, зачем и твои права', 'privacy.html') +
    docLink('cookie', 'Политика cookies', 'Какие cookies мы используем и зачем', 'cookies.html') +
    docLink('scale', 'Правовая информация', 'Кто стоит за mía', 'legal-notice.html') +
    (cookieSettings() ? '<button class="wa-row" data-cookie-settings><span class="ic flat">' + ic('sliders-horizontal') + '</span><span class="c"><strong>Настроить cookies</strong><small>Аналитика и реклама: включить или выключить</small></span>' + ic('chevron-right') + '</button>' : '');
}
function savedSupports() {
  const items = [11, 27].map(n => {
    const d = P.days.find(x => x.day === n), r = S.records[n]; if (!d || !r) return null;
    const lines = d.steps.map((st, i) => st.kind !== 'check' && r.steps && C.stepDone(st, r.steps[String(i)]) ? C.summary(st, r.steps[String(i)]) : null).filter(Boolean);
    return lines.length ? [d, lines] : null;
  }).filter(Boolean);
  if (!items.length) return '';
  return '<p class="wa-eyebrow" style="margin-top:26px">ЧТО ТЫ ПОДГОТОВИЛА</p><div style="display:grid;gap:10px;margin-top:10px">' + items.map(([d, lines]) =>
    '<div class="wa-saved"><strong style="font-size:16px">' + (d.day === 11 ? 'Если он напишет' : 'Что мне помогает') + '</strong>' + lines.map(l => '<span style="font-size:14px;line-height:1.5;color:#4B3D57;white-space:pre-line">· ' + esc(l) + '</span>').join('') + '</div>').join('') + '</div>';
}

/* ---------- «Cuenta» ---------- */
/* Подписка (07.10.2026): в test — доступ из воронки (там дата первой оплаты, цена входа и продления), в live — с сервера. */
function subAccess() {
  if (cfg.paymentMode === 'test') { const f = funnel().access; if (f && f.active) return f; }
  const a = access(); return a && a.active ? a : null;
}
function subPlan() { return C.subscriptionPlan(subAccess(), nowDate()); }
function offer() { return liveBilling() ? C.liveUpgradeOffer(subAccess(), liveOffer.data, nowDate()) : C.upgradeOffer(subAccess(), nowDate(), raw); }
/* Live: сумму доплаты, конец нового периода и срок даёт сервер (предпросмотр счёта Stripe) — показываем ровно то, что спишется.
   Спрашиваем один раз за показ экрана подписки и заново после перехода. Нет ответа или условия не подходят — предложения нет. */
const liveOffer = { state: 'idle', data: null, promise: null };
function loadLiveOffer() {
  if (!liveBilling() || !C.liveOfferEligible(subAccess())) { liveOffer.state = 'idle'; liveOffer.data = null; return Promise.resolve(null); }
  if (liveOffer.state !== 'idle') return liveOffer.promise || Promise.resolve(liveOffer.data);
  const a = acct(); if (!a || typeof a.authorizedFetch !== 'function') return Promise.resolve(null);
  liveOffer.state = 'loading';
  liveOffer.promise = Promise.resolve(call(() => a.authorizedFetch('/app/subscription/upgrade-preview', { method: 'GET' }), null))
    .then(r => { liveOffer.data = r && r.ok && r.body ? r.body : null; }, () => { liveOffer.data = null; })
    .then(() => { liveOffer.state = 'done'; if (mode === 'app' && ui.tab === 'account' && ui.account === 'subscription') renderMain(true); return liveOffer.data; });
  return liveOffer.promise;
}
const tariffOf = pl => tariffs[pl && pl.tariff] || tariffs.month;
/* Первые 14 дней после первой оплаты: можно вернуть первый платёж. Возвращает сумму или 0. */
function withdrawal() {
  const la = liveBilling() ? access() : null;
  if (la) return C.cancelVariant(la, nowDate()) === 'refund' && Number(la.refundAmount) > 0 ? Number(la.refundAmount) : 0;
  const a = subAccess(); if (!a || !a.openedAt || !(Number(a.price) > 0) || a.canceledAt) return 0;
  const d = (+nowDate() - +new Date(a.openedAt)) / 86400000; return d >= 0 && d < 14 ? Number(a.price) : 0;
}
function canCancel() { const pl = subPlan(); return !!pl && pl.renews && !pl.ended; }
/* Удержание при отмене (02.11.2026, владелец): «¿Seguro? 😞» → −50% на следующий платёж → 4 недели бесплатно
   и 3 платежа со скидкой около −55 % (на «4 неделях» 25 € вместо 54,99 €), на всех тарифах. Live — условия и суммы даёт
   сервер (/app/access → retention, одно предложение на человека); демо и тест — те же цены (таблица как
   RetentionRules.discountedCents на сервере). На каждом шаге можно отменить. */
const RETENTION_DEMO = { renewal: 54.99, halfPrice: 27.5, discountedPrice: 25, discountedPayments: 3, freeWeeks: 4 };
const RETENTION_PRICES = { 5499: 2500, 8499: 3799, 11499: 4999, 999: 449, 2999: 1349, 5999: 2699, 7999: 3599 };
function retentionFor(renewal) {
  const c = Math.round(renewal * 100);
  return { renewal, halfPrice: (c - Math.floor(c / 2)) / 100, discountedPrice: (RETENTION_PRICES[c] || Math.floor(c * 45 / 100)) / 100, discountedPayments: 3, freeWeeks: 4 };
}
function retentionOffer() {
  if (pausedNow() || !canCancel()) return null;
  if (liveBilling()) { const la = access(); return la && la.retention ? la.retention : null; }
  const a = subAccess(); if (!a || a.retentionTaken) return null;
  const pl = subPlan(), price = pl && pl.next ? Number(pl.next.amount) : 0;
  return price > 0 ? retentionFor(price) : null;
}
function retentionTake(offerKey) {
  const r = retentionOffer(), pl = subPlan(); if (!r || !pl) return;
  T('sub_retention', { offer: offerKey, live: liveBilling() });
  const shown = (at, amount) => openSheet('retained', { offer: offerKey, at: at ? new Date(at) : null, amount: Number(amount) || 0, r });
  if (liveBilling()) { billingCall('/app/subscription/retention', { offer: offerKey }, b => shown(b.nextPaymentAt, b.nextAmount)); return; }
  if (!saveFunnel(x => { x.retentionTaken = offerKey; })) { closeSheet(); toast(copy.portalFailed); return; }
  renderMain(true);
  shown(offerKey === 'half' || !pl.end ? pl.end : new Date(+new Date(pl.end) + r.freeWeeks * 7 * 86400000), offerKey === 'half' ? r.halfPrice : r.discountedPrice);
}
function inDays(n) { return n === 0 ? 'сегодня' : n === 1 ? 'завтра' : 'через ' + n + ' ' + plural(n, 'день|дня|дней'); }
function subscriptionText() {
  if (pausedNow()) { const u = pausedUntilDate(); return u ? 'Без списаний · на паузе до ' + longDate(u) : 'Без списаний · на паузе'; }
  const pl = subPlan();
  if (!pl) return cfg.paymentMode === 'test' && !cfg.demo ? 'Тестовый режим оплаты · автопродление' : 'Автопродление';
  if (!pl.renews || !pl.next) return 'Без списаний · доступ до ' + longDate(pl.end);
  return tariffOf(pl)[0] + ' · списание ' + inDays(C.daysUntil(pl.next.at, nowDate())) + ' · ' + money(pl.next.amount);
}
/* Изменение доступа в демо (оплата тестовая): отмена, возобновление, переход на 3 месяца хранятся в доступе воронки. */
function saveFunnel(change) {
  try { const x = JSON.parse(store.getItem('mia-ru-app-v1') || 'null'); if (!x || !x.access) return false; change(x.access); store.setItem('mia-ru-app-v1', JSON.stringify(x)); return true; } catch (e) { return false; }
}
const liveBilling = () => cfg.paymentMode === 'live' && !!session();
function subscriptionPage() {
  if (liveBilling() && liveOffer.state === 'idle') loadLiveOffer();
  const pl = subPlan(), o = pl && pl.renews ? offer() : null, now = nowDate(), w = withdrawal();
  let html = '<div class="wa-page"><div class="wa-backbar"><button class="wa-circle" data-wa="account-back" aria-label="Назад">' + ic('arrow-left') + '</button><span>ПОДПИСКА</span></div>';
  if (pausedNow()) return html + pausedSub() + '</div>';
  { const la = liveBilling() ? access() : null; if (la && la.source === 'apple') return html + appleSub() + '</div>'; }
  if (!pl) {
    return html + '<p class="wa-eyebrow" style="margin-top:16px">ТВОЙ ДОСТУП</p><h1 class="wa-display" style="font-size:34px;margin-top:6px">Пробный <em>доступ.</em></h1>' +
      '<p class="wa-muted" style="font-size:15px;line-height:1.55;margin:10px 0 16px">Это пробный доступ: списаний нет, управлять нечем.</p>' +
      row('message-circle-heart', 'Написать нам', 'Ответим сразу', 'support') + '</div>';
  }
  const t = tariffOf(pl);
  html += '<p class="wa-eyebrow" style="margin-top:16px">ТВОЯ ПОДПИСКА</p><h1 class="wa-display" style="font-size:34px;margin-top:6px">' + esc(t[0]) + ' · <em>' + (pl.renews ? 'активна.' : 'отменена.') + '</em></h1>';
  if (pl.renews && pl.next) {
    const n = C.daysUntil(pl.next.at, now), total = pl.start ? Math.max(1, +pl.end - +pl.start) : 1, passed = pl.start ? Math.min(1, Math.max(0, (+now - +pl.start) / total)) : 0;
    html += '<div class="wa-next"><small>СЛЕДУЮЩЕЕ СПИСАНИЕ ЧЕРЕЗ</small><div class="big"><b>' + n + '</b><span>' + plural(n, 'день|дня|дней') + '</span></div>' +
      '<strong>' + esc(longDate(pl.next.at)) + ' · ' + esc(money(pl.next.amount)) + '</strong>' +
      '<span class="bar" aria-hidden="true"><i style="width:' + Math.round(passed * 100) + '%"></i></span>' +
      '<em>' + (n === 0 ? 'Списание сегодня.' : plural(n, 'Остался|Осталось|Осталось') + ' ' + n + ' ' + plural(n, 'день|дня|дней') + ' до списания.') + '</em></div>';
  } else {
    const n = C.daysUntil(pl.end, now);
    html += '<div class="wa-next off"><small>СПИСАНИЙ БОЛЬШЕ НЕ БУДЕТ</small><div class="big"><b>' + n + '</b><span>' + plural(n, 'день доступа|дня доступа|дней доступа') + '</span></div><strong>Доступ до ' + esc(longDate(pl.end)) + '</strong></div>';
  }
  const line = (k, v) => '<div><span>' + k + '</span><b>' + v + '</b></div>';
  html += '<div class="wa-terms">' + line('Этот период', esc(pl.price ? money(pl.price) : '—') + (pl.intro ? ' · цена входа' : '') + ' · до ' + esc(longDate(pl.end)));
  if (!pl.renews) html += line('Дальше', 'Без списаний');
  else html += line('Дальше', esc(money(pl.renewPrice)) + ' ' + esc(t[1]));
  html += '</div>';
  if (pl.renews && pl.next) html += '<p class="wa-muted wa-subnote" style="margin-top:8px">' + (pl.tariff === 'week' ? 'Напомним за день до списания.' : 'Напомним за 15 дней до списания.') + '</p>';
  if (o && o.live) {
    /* Live: сумма и дата — из предпросмотра Stripe; без «срока предложения» и зачёркнутой цены (цены входа в Stripe нет). */
    html += '<div class="wa-offer"><small>' + ic('calendar-range') + 'ПЕРЕЙТИ НА 3 МЕСЯЦА</small>' +
      '<strong>3 месяца за ' + esc(money(o.price)) + '</strong><div class="price"><b>' + esc(money(o.extra)) + '</b><span>сегодня</span></div>' +
      '<p>' + esc('Сегодня спишется ' + money(o.extra) + ': цена 3 месяцев минус неиспользованная часть текущего тарифа. Подписка на 3 месяца — до ' + longDate(o.end) + '. Дальше — ' + money(o.price) + ' каждые 3 месяца.') + '</p>' +
      '<button class="wa-primary" data-wa="sheet" data-s="upgrade"><span>Перейти на 3 месяца</span><b>' + ic('arrow-right') + '</b></button></div>';
  } else if (o) {
    html += '<div class="wa-offer"><small>' + ic('gift') + 'ТОЛЬКО В ПЕРВЫЙ МЕСЯЦ · ' + plural(o.daysLeft, 'ОСТАЛСЯ|ОСТАЛОСЬ|ОСТАЛОСЬ') + ' ' + o.daysLeft + ' ' + plural(o.daysLeft, 'ДЕНЬ|ДНЯ|ДНЕЙ') + '</small>' +
      '<strong>3 месяца по цене входа</strong><div class="price"><b>' + esc(money(o.price)) + '</b><s>' + esc(money(o.full)) + '</s></div>' +
      '<p>' + esc('Доплачиваешь только разницу: ' + money(o.extra) + ' (уже оплачено ' + money(o.paid) + '). 3 месяца считаются с первой оплаты — до ' + longDate(o.end) + '. ' + money(o.perDay) + ' в день; экономия ' + money(o.full - o.price) + ' по сравнению с обычной ценой.') + '</p>' +
      '<p>' + esc('Предложение действует до ' + longDate(o.until) + '. Потом 3 месяца будут стоить ' + money(o.full) + '.') + '</p>' +
      '<button class="wa-primary" data-wa="sheet" data-s="upgrade"><span>Перейти на 3 месяца</span><b>' + ic('arrow-right') + '</b></button></div>';
  }
  html += '<div class="wa-subacts">' +
    (pl.renews ? '<button class="wa-soft" data-wa="sheet" data-s="cancel">' + ic('circle-x') + '&nbsp;Отменить подписку</button>' : '') +
    (!pl.renews && !pl.ended ? '<button class="wa-dark" data-wa="sub-resume"><span>Возобновить подписку</span><b>' + ic('rotate-cw') + '</b></button>' : '') +
    (!pl.renews && w ? '<button class="wa-soft" data-wa="sheet" data-s="refund">' + ic('undo-2') + '&nbsp;Вернуть первый платёж</button>' : '') +
    '<button class="wa-soft" data-wa="support-pay">' + ic('message-circle-question') + '&nbsp;Вопрос по оплате</button></div>' +
    (liveBilling() ? row('credit-card', 'Способ оплаты и чеки', 'Сменить карту или скачать чеки', 'manage') : '') +
    '<p class="wa-muted wa-subnote">Отменить можно в любой момент, в несколько касаний: списаний больше не будет, доступ останется до конца оплаченного периода. Ещё можно по ссылке «Управлять подпиской» из любого нашего письма или написать нам на ' + SUPPORT_EMAIL + '.' +
    (w ? ' Ты в первых 14 днях после первой оплаты: если хочешь, вернём этот платёж.' : '') + '</p></div>';
  return html;
}
function accountPage() {
  const n = name(), saved = P.days.filter(d => Object.keys((S.records[d.day] || {}).steps || {}).length).length, s = session();
  return '<div class="wa-page"><p class="wa-eyebrow" style="margin-bottom:10px">АККАУНТ</p>' +
    '<div class="wa-profile"><img class="heart" src="assets/glass-heart-v6.webp" alt="" aria-hidden="true"><div class="who"><span class="av" aria-hidden="true"' + (n ? '' : ' style="font-style:italic"') + '>' + esc(n ? n.charAt(0).toUpperCase() : 'я.') + '</span>' +
    '<div><strong>' + esc(n || 'Твоё пространство.') + '</strong><button data-wa="sheet" data-s="name">' + (n ? 'Изменить имя' : 'Как тебя называть?') + ic('pencil') + '</button></div></div><p>Место, где всё — про тебя.</p></div>' +
    (LCx() ? '' : '<button class="wa-tile-row" data-wa="library"><span class="ic">' + ic('bookmark') + '</span><span class="c"><strong>Сохранённое</strong><small>' + (saved ? 'Твои выборы, фразы и сообщения по дням' : 'Здесь появится то, что ты соберёшь в практиках') + '</small></span><b>' + saved + '</b>' + ic('arrow-up-right') + '</button>') +
    (callUi() ? '<button class="wa-tile-row" data-wa="calls"><span class="ic">' + ic('audio-lines') + '</span><span class="c"><strong>' + esc(callUi().analysisTitle) + '</strong><small>' + esc(callUi().analysisNote) + '</small></span><b>' + callLog().length + '</b>' + ic('arrow-up-right') + '</button>' : '') +
    (LCx() ? '<button class="wa-tile-row" data-wa="phrases"><span class="ic">' + ic('heart') + '</span><span class="c"><strong>' + esc(LCx().ui().phrasesTitle) + '</strong><small>' + esc(LCx().ui().phrasesRowNote) + '</small></span><b>' + LCx().phrasesCount() + '</b>' + ic('arrow-up-right') + '</button>' : '') +
    '<p class="wa-eyebrow" style="margin:24px 0 4px">В ТВОЁМ ТЕМПЕ</p>' +
    (cfg.audio ? row(fmt() === 'audio' ? 'headphones' : 'align-left', 'Как знакомиться с темой', fmt() === 'audio' ? 'Предпочитаю слушать' : 'Предпочитаю читать', 'sheet', 's="format"') : '') +
    (lessonOn ? '' : '<button class="wa-row" data-wa="motion" role="switch" aria-checked="' + !!S.profile.reduceMotion + '"><span class="ic flat">' + ic('accessibility') + '</span><span class="c"><strong>Меньше движения</strong><small>Более спокойные переходы</small></span><span class="wa-toggle' + (S.profile.reduceMotion ? ' on' : '') + '" aria-hidden="true"></span></button>') +
    remindersRow() +
    (lessonOn ? '<button class="wa-row" data-wa="sheet" data-s="lang"><span class="ic flat">' + ic('languages') + '</span><span class="c"><strong>' + esc(LCx().ui().account.langTitle) + '</strong><small>' + esc((langList().find(l => l.on) || {}).label || '') + '</small></span>' + ic('chevron-right') + '</button>'
      : '<div class="wa-row"><span class="ic flat">' + ic('languages') + '</span><span class="c"><strong>Язык</strong><small>Русский</small></span></div>') +
    '<button class="wa-sub' + (subPlan() && !subPlan().renews ? ' off' : '') + '" data-wa="sub-open">' + ic('badge-check') + '<span class="c"><strong>' + (pausedNow() ? 'Подписка на паузе' : subPlan() && !subPlan().renews ? 'Подписка отменена' : 'Подписка активна') + '</strong><small>' + esc(subscriptionText()) + '</small></span>' + ic('chevron-right') + '</button>' +
    (canCancel() && !lessonOn ? row('circle-x', 'Отменить подписку', 'Доступ сохранится до конца оплаченного периода', 'sheet', 's="cancel"') : '') + /* в режиме урока — на экране подписки */
    (liveBilling() ? row('credit-card', 'Управлять подпиской', 'Сменить карту или посмотреть чеки', 'manage') : '') +
    row('message-circle-heart', 'Написать нам', 'Ответим сразу', 'support') +
    /* В режиме урока (владелец, 02.11.2026) без «Qué pasa con mis datos», «Borrar mis datos» и плашки о хранении;
       «Eliminar mi cuenta» и «Salir» при входе остаются, политика конфиденциальности — в «Documentos» */
    (!lessonOn || canInstall() || s ? '<p class="wa-eyebrow" style="margin:24px 0 4px">ТВОЁ</p>' : '') +
    (canInstall() ? row('download', 'Добавить на главный экран', 'Открывай одним касанием, как приложение', 'install') : '') +
    (lessonOn ? '' : row('lock-keyhole', 'Что происходит с моими данными', 'Где хранятся ответы и как их убрать', 'sheet', 's="privacy"')) +
    (s ? row('user-x', 'Удалить аккаунт', 'Удаляет аккаунт и данные с сервера', 'sheet', 's="delete-account"') : '') +
    (lessonOn ? '' : row('trash-2', 'Удалить мои данные', s ? 'Записи и прогресс — здесь и в аккаунте' : 'Записи и прогресс в этом браузере', 'sheet', 's="reset"')) +
    (s ? row('log-out', 'Выйти', 'Потом можно войти по почте и паролю', 'logout') : '') +
    (lessonOn ? '' : s ? '<div class="wa-local"><small>' + ic('cloud') + 'В АККАУНТЕ</small>Записи, «Сохранённое» и прогресс хранятся в этом браузере и в твоём аккаунте, чтобы они были на всех твоих устройствах. Если ты уйдёшь из mía, они хранятся ещё 90 дней после окончания доступа; если удалишь аккаунт — стираются сразу.</div>' : '<div class="wa-local"><small>' + ic('smartphone') + 'В ЭТОМ БРАУЗЕРЕ</small>Имя, настройки и записи хранятся в этом браузере, на этом устройстве. Синхронизация между устройствами пока недоступна.</div>') +
    (lessonOn ? row('folder-open', LCx().ui().account.docsTitle, LCx().ui().account.docsNote, 'docs') : documentsBlock()) +
    (cfg.testTools ? testTools() : '') +
    '<p class="wa-version">mía · версия ' + esc(cfg.appVersion) + '</p></div>';
}
function remindersRow() {
  if (!pushReady()) return '';
  if (!pushSupported()) return '<div class="wa-row"><span class="ic flat">' + ic('bell-off') + '</span><span class="c"><strong>Напоминания</strong><small>Этот браузер не поддерживает уведомления. На iPhone напоминания присылает приложение mía.</small></span></div>';
  const p = call(() => push().prefs(), null) || {}, on = p.enabled && call(() => push().permission(), '') === 'granted';
  const note = on ? [p.morningOn ? 'Утром, ' + p.morning : '', p.eveningOn ? 'вечером, если нужно' : '', p.dndUntil && p.dndUntil >= C.dateKey(new Date()) ? 'без напоминаний до ' + longDate(p.dndUntil + 'T12:00:00') : ''].filter(Boolean).join(' · ') : 'Мягкое напоминание в удобное тебе время';
  return '<button class="wa-row" data-wa="sheet" data-s="reminders"><span class="ic flat">' + ic('bell') + '</span><span class="c"><strong>Напоминания</strong><small>' + esc(note) + '</small></span><span class="wa-state">' + (on ? 'Включены' : 'Выключены') + '</span>' + ic('chevron-right') + '</button>';
}
function canInstall() { const inst = window.MiaInstall; return !!inst && typeof inst.guide === 'function' && !call(() => inst.standalone(), false); }
function testTools() {
  const n = today(), ready = C.touched(S.records[n]), end = n >= C.TOTAL_DAYS && S.program && S.program.supportDone;
  return '<div class="wa-test"><small>' + ic('flask-conical') + 'ТЕСТОВЫЙ РЕЖИМ</small><p>Сейчас открыт день ' + n + ' из ' + C.TOTAL_DAYS + '. В жизни следующий день открывается на новую дату после любого действия в текущем дне. Кнопка ниже имитирует наступление завтра.</p>' +
    '<button class="wa-dark" data-wa="test-next"' + (end ? ' disabled' : '') + '><span>' + (end ? 'Все 30 дней открыты' : ready ? 'Наступило завтра → открыть день ' + Math.min(n + 1, C.TOTAL_DAYS) : 'Наступило завтра (в дне ' + n + ' пока нет действий)') + '</span><b>' + ic('fast-forward') + '</b></button></div>';
}
function libraryPage() {
  const days = P.days.filter(d => Object.keys((S.records[d.day] || {}).steps || {}).length).reverse();
  return '<div class="wa-page"><div class="wa-backbar"><button class="wa-circle" data-wa="library-back" aria-label="Назад">' + ic('arrow-left') + '</button><span>СОХРАНЁННОЕ</span></div>' +
    '<p class="wa-eyebrow" style="margin-top:16px">ЧТО ТЫ СОБРАЛА</p><h1 class="wa-display" style="font-size:32px;margin-top:6px">Твои слова<br><em>остаются с тобой.</em></h1>' +
    '<p class="wa-muted" style="font-size:15px;line-height:1.5;margin:8px 0 16px">Выборы, фразы и сообщения из практик. Любой день можно открыть и поменять.</p>' +
    '<div style="display:grid;gap:10px">' + days.map(d => {
      const r = record(d.day), msg = C.message(d, r);
      return '<div class="wa-saved"><span class="wa-eyebrow" style="display:flex;justify-content:space-between">ДЕНЬ ' + d.day + ' · ' + esc(d.title.toUpperCase()) + (C.isComplete(d, r) ? ic('check') : '') + '</span><strong style="font-size:19px;letter-spacing:-.4px">' + esc(d.keeps) + '</strong>' +
        d.steps.map((st, j) => { const v = r.steps[String(j)]; return v && st.kind !== 'check' ? '<div class="ans"><span>' + esc(st.title) + '</span><b>' + esc(C.summary(st, v)) + '</b></div>' : ''; }).join('') +
        (msg ? '<div class="msg">' + esc(msg) + '</div>' : '') + '<button class="wa-link" style="color:var(--wa-violet)!important;padding:4px 0" data-wa="open-day" data-day="' + d.day + '">Открыть день' + ic('arrow-up-right') + '</button></div>';
    }).join('') + '</div>' +
    (days.length ? '' : '<div class="wa-saved" style="justify-items:center;text-align:center;background:var(--wa-lilac-soft);border:0">' + ic('bookmark') + '<strong style="font-size:19px">Это пространство наполняешь ты.</strong><span class="wa-muted" style="font-size:14px">После первого шага практики здесь появится твой выбор.</span><button class="wa-dark" data-wa="home"><span>Открыть мой день</span><b>' + ic('arrow-right') + '</b></button></div>') +
    '<p class="wa-muted" style="font-size:12px;margin-top:18px;display:flex;gap:6px;align-items:center">' + ic('lock-keyhole') + (session() ? 'Хранится в этом браузере и в твоём аккаунте, чтобы было на всех твоих устройствах.' : 'Хранится только в этом браузере. mía никуда не отправляет твои ответы.') + '</p></div>';
}

/* ---------- «Escríbenos»: чат поддержки под логотипом mía (07.10.2026, ИИ-помощник 08.10.2026) ----------
   В live с сессией сервера — настоящий чат: POST /app/support/chat {messages, locale} → {reply, handoff}
   (backend/Sources/App/Support, правила — docs/support-rules.md). История — sessionStorage mia-support-v1 этой вкладки,
   привязана к почте. Ошибки 503/429/сеть — спокойный текст с адресом почты, в историю для сервера не идут.
   В тесте (без сервера) и в демо /ru/ — прежний макет: пример диалога и тост «чат ещё не подключён». */
const SUPPORT_KEY = 'mia-ru-support-v1';
function supportLive() { const a = acct(); return C.supportMode({ paymentMode: cfg.paymentMode, demo: cfg.demo, session: !!session(), fetch: !!a && typeof a.authorizedFetch === 'function' }) === 'live'; }
function sessionStore() { try { return window.sessionStorage; } catch (e) { return null; } }
function supportHistory() {
  const st = sessionStore(), s = session(); if (!st || !s) return [];
  try { const x = JSON.parse(st.getItem(SUPPORT_KEY) || 'null'); return x && x.email === s.email && Array.isArray(x.items) ? x.items.filter(m => m && typeof m.text === 'string' && /^(user|assistant|note)$/.test(m.role)) : []; } catch (e) { return []; }
}
function supportSave(items) {
  const st = sessionStore(), s = session(); if (!st || !s) return;
  try { st.setItem(SUPPORT_KEY, JSON.stringify({ email: s.email, items: items.slice(-40) })); } catch (e) { /* sin sessionStorage: la historia vive solo en pantalla */ }
}
/* Вид как у чата урока (02.11.2026, владелец): пузыри с хвостиком, время под текстом, плашка «на связи» в шапке */
const supportTime = ts => (ts ? '<time class="wa-sup-time">' + new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + '</time>' : '');
function supportBubble(mine, text, first, extra, ts) {
  return mine ? '<div class="wa-msg user"><div class="wa-bubble">' + esc(text) + supportTime(ts) + '</div></div>'
    : '<div class="wa-msg' + (first ? ' first' : '') + '"><span class="wa-ava' + (first ? '' : ' ghost') + '" aria-hidden="true">m</span><div class="wa-bubble">' + esc(text) + (extra || '') + supportTime(ts) + '</div></div>';
}
/* Пока ждём ответ (владелец, 02.11.2026): сначала «Estudiamos tu consulta…», через SUPPORT_STUDY_MS — «Escribiendo…»;
   ответ показывается не раньше SUPPORT_MIN_MS после отправки, чтобы обе фазы было видно. */
const SUPPORT_STUDY_MS = 1800, SUPPORT_MIN_MS = 3400;
function supportPill(sp) {
  if (!sp || !sp.busy) return '<span class="wa-sup-pill"><i class="dot"></i>На связи</span>';
  return '<span class="wa-sup-pill typing"><i class="dot"></i>' + (sp.phase === 'study' ? 'Изучаем' : 'Печатает') + '<span class="wa-lc-dots"><i></i><i></i><i></i></span></span>';
}
function supportWaiting(sp) {
  return sp.phase === 'study'
    ? '<div class="wa-msg first"><span class="wa-ava" aria-hidden="true">m</span><span class="wa-typing wa-sup-study" role="status"><span>Изучаем твой запрос</span><span class="wa-lc-dots"><i></i><i></i><i></i></span></span></div>'
    : '<div class="wa-msg first"><span class="wa-ava" aria-hidden="true">m</span><span class="wa-typing" aria-label="mía печатает"><i></i><i></i><i></i></span></div>';
}
/* Ждём ответ: фаза «изучаем», потом «пишем»; finish(apply) применяет ответ не раньше SUPPORT_MIN_MS. */
function supportWait(sp) {
  const started = Date.now();
  sp.busy = true; sp.phase = 'study'; renderSupport();
  setTimeout(() => { if (ui.support === sp && sp.busy) { sp.phase = 'typing'; renderSupport(); } }, SUPPORT_STUDY_MS);
  return apply => setTimeout(() => {
    apply();
    if (ui.support === sp) { sp.busy = false; sp.phase = ''; renderSupport(); const t = $('[data-field=support]'); if (t) t.focus({ preventScroll: true }); }
  }, Math.max(0, SUPPORT_MIN_MS - (Date.now() - started)));
}
function supportExample() {
  const pl = subPlan();
  if (!pl) return '';
  const answer = pl.renews && pl.next
    ? 'Следующее списание ' + longDate(pl.next.at) + ', ' + money(pl.next.amount) + '. Это ' + inDays(C.daysUntil(pl.next.at, nowDate())) + '. Отменить можно в разделе «Моя подписка», доступ сохранится до этой даты.'
    : 'Подписка отменена: списаний больше не будет. Доступ — до ' + longDate(pl.end) + '.';
  const ts = Date.now();
  return '<p class="wa-support-day">Сегодня</p>' + supportBubble(true, 'Когда следующее списание?', false, '', ts) +
    supportBubble(false, answer, true, '<button class="wa-support-act" data-wa="support-act" data-a="subscription">' + ic('badge-check') + 'Открыть подписку</button>', ts);
}
function renderSupport() {
  const box = document.getElementById('wa-support'); if (!box) return;
  const sp = ui.support; if (!sp) { box.innerHTML = ''; setInert(); return; }
  const n = name(), live = supportLive();
  /* Подписи внизу нет (владелец, 02.11.2026); что отвечает ИИ, сказано один раз в начале переписки (AI Act ЕС, ст. 50) */
  const logHTML = '<p class="wa-sup-ai">Отвечает ИИ mía · возвраты ведёт человек из команды</p>' + supportBubble(false, (n ? 'Привет, ' + n + '! ' : 'Привет! ') + 'Это поддержка mía. Напиши, что случилось: подписка, списание, отмена или что-то не работает.', true) +
    supportBubble(false, 'Если нужен человек из команды, напиши об этом, и я передам.', false) +
    (live ? supportLog(sp) : supportExample() + supportDemoLog(sp));
  /* Чат уже открыт: меняем только ленту и кнопку — экран не въезжает заново, прежние пузыри не проявляются ещё раз */
  const open = box.querySelector('.wa-support .log');
  if (open) {
    const shown = shownCount(open); open.innerHTML = logHTML; settleShown(open, shown);
    const send = box.querySelector('.wa-support .send'); if (send) send.disabled = !!sp.busy;
    const pill = box.querySelector('.wa-sup-pill'); if (pill) pill.outerHTML = supportPill(sp);
    icons(); setInert(); open.scrollTop = open.scrollHeight; return;
  }
  box.innerHTML = '<section class="wa-support" role="dialog" aria-modal="true" aria-labelledby="wa-support-title">' +
    '<header><button class="wa-circle" data-wa="support-close" aria-label="Закрыть">' + ic('arrow-left') + '</button>' +
    '<div class="who"><strong id="wa-support-title"><b>mía</b> поддержка</strong></div>' + supportPill(sp) + '</header>' +
    '<div class="log" role="log" aria-live="polite">' + logHTML + '</div>' +
    '<form class="compose" data-form="support"><textarea data-field="support" rows="1" maxlength="1200" placeholder="Напиши сообщение" aria-label="Твоё сообщение"></textarea>' +
    '<button type="submit" class="send" aria-label="Отправить"' + (sp.busy ? ' disabled' : '') + '>' + ic('send-horizontal') + '</button></form>' +
    '</section>';
  icons(); setInert();
  const log = box.querySelector('.log'); if (log) log.scrollTop = log.scrollHeight;
}
function supportLog(sp) {
  const items = supportHistory();
  let html = items.length ? '<p class="wa-support-day">Сегодня</p>' : '', prevMine = true;
  for (const m of items) {
    if (m.role === 'user') { html += supportBubble(true, m.text, false, '', m.ts); prevMine = true; continue; }
    html += m.role === 'note' ? '<div class="wa-msg' + (prevMine ? ' first' : '') + '"><span class="wa-ava' + (prevMine ? '' : ' ghost') + '" aria-hidden="true">m</span><div class="wa-bubble wa-support-note">' + esc(m.text) + supportTime(m.ts) + '</div></div>'
      : supportBubble(false, m.text, prevMine, '', m.ts);
    prevMine = false;
  }
  if (sp.busy) html += supportWaiting(sp); /* wa-typing: «изучаем», затем «пишем» */
  return html;
}
function openSupport() { T('support_open', {}); ui.support = {}; renderSupport(); const t = $('[data-field=support]'); if (t) t.focus({ preventScroll: true }); }
function closeSupport() { ui.support = null; renderSupport(); }
/* Демо /ru/: сервера нет — показываем, как выглядит ожидание, и честный ответ-заглушку. */
function supportDemoLog(sp) {
  let html = '';
  (sp.demo || []).forEach(m => { html += m.role === 'user' ? supportBubble(true, m.text, false, '', m.ts) : supportBubble(false, m.text, true, '', m.ts); });
  return html + (sp.busy ? supportWaiting(sp) : '');
}
function supportSend() {
  const live = supportLive();
  if (!live && !cfg.demo) { toast('Чат поддержки пока не подключён. А пока напиши нам на ' + SUPPORT_EMAIL + '.'); return; }
  const sp = ui.support; if (!sp || sp.busy) return;
  const field = $('[data-field=support]'), text = String(field ? field.value : '').trim().slice(0, 1200);
  if (!text) return;
  if (field) field.value = '';
  if (!live) {
    sp.demo = (sp.demo || []).concat({ role: 'user', text, ts: Date.now() });
    supportWait(sp)(() => { sp.demo = sp.demo.concat({ role: 'assistant', text: 'Это демонстрация: в рабочем приложении здесь появится ответ поддержки на твой вопрос.', ts: Date.now() }); });
    return;
  }
  const items = supportHistory().concat({ role: 'user', text, ts: Date.now() });
  supportSave(items);
  const finish = supportWait(sp);
  Promise.resolve(acct().authorizedFetch('/app/support/chat', { method: 'POST', body: { messages: C.supportMessages(items), locale: 'es' } }))
    .catch(() => ({ ok: false, status: 0, body: {}, error: 'offline' }))
    .then(r => finish(() => {
      const at = Date.now(), add = [].concat(C.supportResult(r)).map(m => Object.assign({ ts: at }, m));
      supportSave(supportHistory().concat(add));
    }));
}

/* Всплывающее предложение первого месяца: в середине (дни 13–19) и в конце (25–29) после первой оплаты, каждое один раз.
   ?offer=mid|end показывает его сразу — для проверки в демо и тестовом режиме. */
/* ---------- Отмена, пауза, возврат (документ владельца «Отмена подписки и поддержка», 08.10.2026) ----------
   Live: POST /app/subscription/cancel {mode: period_end|refund_now}, /resume (пауз больше нет, 15.10.2026: только возврат из прежних) (backend/Sources/App/Billing), статус и окно
   возврата — из /app/access (MiaAccount.access(): status, pausedUntil, refundableUntil, refundAmount).
   Демо и test: всё пишется в доступ воронки (renews, canceledAt, refundedAt, pausedUntil). */
function pausedNow() {
  if (liveBilling()) { const a = access(); return !!a && a.status === 'paused'; }
  if (cfg.paymentMode !== 'test') return false;
  const f = funnel().access; return !!(f && f.pausedUntil && +new Date(f.pausedUntil) > +nowDate());
}
function pausedUntilDate() { const v = liveBilling() ? (access() || {}).pausedUntil : (funnel().access || {}).pausedUntil; const d = v ? new Date(v) : null; return d && !isNaN(d) ? d : null; }
function pausedSub() {
  const until = pausedUntilDate(), n = until ? C.daysUntil(until, nowDate()) : 0, a = (liveBilling() ? access() : funnel().access) || {}, t = tariffs[a.tariff] || tariffs.month;
  return '<p class="wa-eyebrow" style="margin-top:16px">ТВОЯ ПОДПИСКА</p><h1 class="wa-display" style="font-size:34px;margin-top:6px">' + esc(t[0]) + ' · <em>на паузе.</em></h1>' +
    '<div class="wa-next off"><small>НА ПАУЗЕ</small><div class="big"><b>' + n + '</b><span>' + plural(n, 'день|дня|дней') + '</span></div><strong>' + esc(until ? 'До ' + longDate(until) : 'На паузе') + '</strong></div>' +
    '<p class="wa-muted wa-subnote">Пока идёт пауза, списаний нет. Программа закрыта, «Помощь» открыта, когда понадобится.</p>' +
    '<div class="wa-subacts"><button class="wa-dark" data-wa="sub-resume"><span>Продолжить сейчас</span><b>' + ic('play') + '</b></button>' +
    '<button class="wa-soft" data-wa="sheet" data-s="cancel">' + ic('circle-x') + '&nbsp;Отменить подписку</button>' +
    '<button class="wa-soft" data-wa="support-pay">' + ic('message-circle-question') + '&nbsp;Вопрос по оплате</button></div>' +
    (liveBilling() ? row('credit-card', 'Способ оплаты и чеки', 'Сменить карту или скачать чеки', 'manage') : '');
}
function appleSub() {
  return '<p class="wa-eyebrow" style="margin-top:16px">ТВОЯ ПОДПИСКА</p><h1 class="wa-display" style="font-size:34px;margin-top:6px">App Store.</h1>' +
    '<p class="wa-muted" style="font-size:16px;line-height:1.55;margin:10px 0 16px">Подписка оформлена через App Store, отмена — в настройках Apple. Там же меняют тариф и просят возврат.</p>' +
    '<p class="wa-muted" style="font-size:15px;line-height:1.55;margin:0 0 16px">«Сохранённое» и твои записи хранятся в аккаунте: если подписка закончится, они сохранятся ещё 90 дней.</p>' +
    '<div class="wa-subacts"><a class="wa-dark" href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener"><span>Открыть подписки Apple</span><b>' + ic('arrow-up-right') + '</b></a>' +
    '<button class="wa-soft" data-wa="support-pay">' + ic('message-circle-question') + '&nbsp;Вопрос по оплате</button></div>';
}
function pausedPage() {
  const until = pausedUntilDate();
  return '<div class="wa-page"><p class="wa-eyebrow" style="margin-top:16px">НА ПАУЗЕ</p><h1 class="wa-display" style="margin-top:6px;font-size:40px">Программа<br><em>отдыхает.</em></h1>' +
    '<p class="wa-muted" style="font-size:16px;line-height:1.55;margin:10px 0 18px">' + esc((until ? 'До ' + longDate(until) + '. ' : '') + 'Пока списаний нет. Когда вернёшься, продолжишь с того дня, где остановилась.') + '</p>' +
    '<div style="display:grid;gap:10px"><button class="wa-dark" data-wa="sub-resume"><span>Продолжить сейчас</span><b>' + ic('play') + '</b></button>' +
    '<button class="wa-soft" data-wa="tab" data-tab="assist">' + ic('heart-handshake') + '&nbsp;Открыть «Помощь»</button></div>' +
    '<div class="wa-box" style="margin-top:18px"><small>«ПОМОЩЬ» ОТКРЫТА</small><span>Практики, чтобы успокоиться, «Хочу ему написать» и телефоны — на месте, когда понадобятся.</span></div></div>';
}
const BILLING_ERRORS = {
  no_subscription: 'Не нашли подписку с сайта, которой можно управлять. Если оформляла в iPhone — она управляется в App Store.',
  apple_subscription: 'Подписка оформлена через App Store, отмена — в настройках Apple.',
  refund_not_eligible: '14 дней после первой оплаты уже прошли, поэтому вернуть платёж отсюда нельзя. Можно остановить подписку и оставить доступ до конца периода.',
  nothing_to_resume: 'Подписка уже активна.',
  offer_unavailable: 'Это предложение уже недоступно. Можно отменить подписку или оставить всё как есть.',
  offline: 'Сейчас нет связи с сервером. Проверь интернет и попробуй ещё раз чуть позже.',
  failed: 'Сейчас не получилось, деньги не списаны. Попробуй через минуту или напиши нам на ' + SUPPORT_EMAIL + '.'
};
function billingCall(path, body, done, fail) {
  const a = acct(), sh = ui.sheet;
  const failWith = msg => { if (fail) fail(); if (sh && ui.sheet === sh) { sh.busy = false; sh.error = msg; renderSheet(true); } else toast(msg); };
  if (!a || typeof a.authorizedFetch !== 'function') { failWith(BILLING_ERRORS.failed); return; }
  if (sh) { sh.busy = true; sh.error = ''; renderSheet(true); }
  Promise.resolve(call(() => a.authorizedFetch(path, { method: 'POST', body: body || {} }), null)).catch(() => null).then(r => {
    if (r && r.ok) return Promise.resolve(call(() => a.refresh(), null)).catch(() => null).then(() => { renderMain(true); done(r.body || {}); });
    const code = r && r.body && r.body.error;
    failWith(BILLING_ERRORS[code] || (r && r.error === 'offline' ? BILLING_ERRORS.offline : BILLING_ERRORS.failed));
  });
}
function subCancel(mode) {
  const refund = mode === 'refund_now';
  T('sub_cancel', { tariff: (subPlan() || {}).tariff, live: liveBilling(), mode });
  if (liveBilling()) {
    /* После возврата доступ закрывается: экран входа ждёт, пока она закроет лист «Pago devuelto». */
    if (refund) ui.holdGate = true;
    billingCall('/app/subscription/cancel', { mode }, b => openSheet('canceled', { until: b.accessUntil ? new Date(b.accessUntil) : null, refund: Number(b.refundAmount) || 0 }),
      () => { ui.holdGate = false; });
    return;
  }
  const paused = pausedNow(), w = withdrawal(), pl = subPlan(), at = nowDate().toISOString();
  if (!saveFunnel(x => { x.renews = false; x.canceledAt = at; delete x.switchTo; delete x.pausedUntil; if (refund) x.refundedAt = at; })) { closeSheet(); toast(copy.portalFailed); return; }
  renderMain(true);
  openSheet('canceled', { until: paused || refund || !pl ? null : pl.end, refund: refund ? w : 0 });
}
function subResume() {
  const wasPaused = pausedNow();
  T('sub_resume', { paused: !!wasPaused });
  const after = () => { if (ui.sheet) closeSheet(); renderMain(true); toast(wasPaused ? 'Ты вернулась. Программа снова открыта.' : 'Подписка возобновлена.'); };
  if (liveBilling()) { billingCall('/app/subscription/resume', {}, after); return; }
  saveFunnel(x => { x.renews = true; delete x.canceledAt; delete x.pausedUntil; });
  after();
}


/* «Gestionar suscripción» из письма: ?manage=1 — почта → одноразовая ссылка; ?manage=<код> — вход без пароля → экран подписки. */
function manageFromUrl() {
  let q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (!q.has('manage')) return;
  const code = q.get('manage') || ''; q.delete('manage');
  try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash); } catch (e) { /* адрес не меняется — не страшно */ }
  ui.afterGate = 'subscription';
  const a = acct();
  if (code.length >= 20 && a && typeof a.redeemManageLink === 'function') {
    Promise.resolve(call(() => a.redeemManageLink(code), null)).then(res => {
      if (res && res.ok) {
        ui.manageAsk = false; refreshGate(true);
        if (mode === 'app') { ui.tab = 'account'; ui.account = 'subscription'; ui.afterGate = null; renderMain(); renderBadges(); }
        return;
      }
      ui.manageAsk = !session(); ui.gateError = (res && res.error) || ''; if (mode === 'login') renderGate();
    }).catch(() => {});
    return;
  }
  if (!session()) ui.manageAsk = true;
}
function manageGate() {
  const sent = ui.manageSent;
  return '<div class="wa-gate wa-page"><img class="heart" src="assets/glass-heart-v6.webp" alt="" aria-hidden="true"><p class="wa-eyebrow">Управлять подпиской</p>' +
    (sent
      ? '<h1 class="wa-display">Проверь<br><em>почту.</em></h1><p class="wa-muted" style="font-size:16px;line-height:1.55">' + esc('Если есть аккаунт с почтой ' + sent + ', мы отправили ссылку для входа без пароля. Она живёт 30 минут и срабатывает один раз.') + '</p>' +
        '<div class="links"><button class="wa-soft" data-wa="manage-cancel">Войти с паролем</button></div>'
      : '<h1 class="wa-display">Вход<br><em>без пароля.</em></h1><p class="wa-muted" style="font-size:16px;line-height:1.55">Напиши почту, на которую оформлена подписка, — пришлём ссылку для входа: отменить, поставить на паузу или сменить карту.</p>' +
        '<form novalidate data-form="manage"><label>Почта<input class="wa-input" type="email" name="email" autocomplete="email" inputmode="email" required></label>' +
        (ui.gateError ? '<p class="err" role="alert">' + esc(ui.gateError) + '</p>' : '') +
        '<button class="wa-dark" type="submit"' + (ui.gateBusy ? ' disabled' : '') + '><span>' + (ui.gateBusy ? 'Отправляем…' : 'Прислать ссылку') + '</span><b>' + ic('arrow-right') + '</b></button></form>' +
        '<div class="links"><button class="wa-quiet" data-wa="manage-cancel">Войти с паролем</button></div>') +
    '<p class="note">' + esc('Вопросы? Напиши нам на ' + SUPPORT_EMAIL + '.') + '</p></div>';
}
function manageRequest(form) {
  const a = acct(), email = form.email.value.trim(); if (!a || typeof a.requestManageLink !== 'function') return;
  ui.gateBusy = true; ui.gateError = ''; renderGate();
  Promise.resolve(call(() => a.requestManageLink(email), null)).then(res => {
    ui.gateBusy = false;
    if (!res || !res.ok) { ui.gateError = (res && res.error) || copy.loginOffline; renderGate(); const f = $('input[name=email]'); if (f) f.value = email; return; }
    ui.manageSent = email; renderGate();
  }).catch(() => { ui.gateBusy = false; ui.gateError = copy.loginOffline; renderGate(); });
}

function maybeOffer() {
  if (mode !== 'app' || ui.sheet || ui.flow || ui.welcome || ui.support || ui.offerChecked) return;
  ui.offerChecked = true;
  const o = offer(); if (!o) return;
  const forced = cfg.demo || cfg.testTools ? new URLSearchParams(location.search).get('offer') : null;
  const m = forced === 'mid' || forced === 'end' ? forced : C.offerMoment(o, S.offers);
  if (!m) return;
  S.offers[m] = new Date().toISOString(); persist();
  setTimeout(() => { if (mode === 'app' && !ui.sheet && !ui.flow && !ui.welcome && !ui.support) openSheet('offer', { moment: m }); }, 900);
}

/* ---------- «Quiero escribirle» (07.10.2026, по просьбе владельца) ----------
   Шаги: зачем пишешь → что чувствуешь → практика на выбор → «как теперь?» → если всё ещё хочется — чат: она пишет сообщение,
   mía разбирает его (C.messageReview, правила без модели) и только потом она решает: скопировать и отправить самой,
   отложить до утра (черновик в этом браузере) или оставить здесь. Ничего не отправляется из приложения. */
const URGE_WHY = [['know', 'Узнать, как он'], ['back', 'Чтобы вернулся'], ['hurt', 'Сказать, что мне было больно'], ['angry', 'Злюсь на то, что случилось'], ['miss', 'Просто скучаю'], ['practical', 'Практическое: дети, вещи, деньги']];
const URGE_FEEL = [['sad', 'Грусть'], ['anx', 'Тревога'], ['anger', 'Злость'], ['alone', 'Одиночество'], ['guilt', 'Вина'], ['empty', 'Пустота']];
const URGE_FEEL_NOTE = {
  sad: 'Грусть ищет, на что опереться. Сообщение кажется такой опорой, но то, что будет дальше, от тебя не зависит.',
  anx: 'Тревога требует ясности прямо сейчас. Сообщение обещает спокойствие через минуту, а потом обычно приходит ожидание ответа.',
  anger: 'Злость хочет выйти быстро. А то, что написано в злости, потом читается уже без неё.',
  alone: 'Когда одиноко, любой контакт кажется близостью. Может, сегодня рядом может быть кто-то другой.',
  guilt: 'Вина толкает исправить всё и сразу. Сегодня ничего не нужно решать.',
  empty: 'Пустота просит заполнить её привычным. Сообщение заполнит её ненадолго.'
};
/* 15 практик быстрого успокоения — полный текст документа владельца (07.10.2026): [№, блок, название, [абзацы описания], когда подходит, когда не подходит, на чём основано].
   Время практик нигде не называем (записи — около шести минут). Для «тянет написать» первыми идут 15, 12, 11 (правило подбора из документа). */
const CALM = [
  [1, 'breath', 'Выдох длиннее вдоха', ['Самая быстрая практика в библиотеке. Вдох на четыре счёта, выдох на шесть. Ничего больше: не нужно дышать «правильно», животом или глубоко. Нужно только, чтобы выдох был длиннее вдоха.', 'Когда выдох длиннее вдоха, тормозится симпатическая активация — та самая, от которой колотится сердце и трясутся руки. Это не метафора и не расслабление «в голове»: пульс замедляется на самом выдохе, и это можно почувствовать за первые тридцать секунд.'], 'Почти всегда. Первое, что стоит попробовать, если непонятно, что делать.', 'Если дыхание уже частое и поверхностное до головокружения — сначала практика 2, она короче и не требует удерживать ритм.', 'Вагальная модуляция сердечного ритма; удлинённый выдох — самый воспроизводимый эффект в исследованиях дыхательных техник.'],
  [2, 'breath', 'Двойной вдох', ['Два вдоха носом подряд — первый обычный, второй короткий, как бы сверху, — и один долгий выдох ртом. Повторить три-пять раз. Это то, что тело делает само, когда человек всхлипывает после плача.', 'Работает быстрее всего остального: ощутимое снижение напряжения обычно наступает после трёх-пяти циклов, то есть меньше чем за минуту. Подходит там, где ни на что другое нет сил и внимания.'], 'Пик. Трясёт, не получается сосредоточиться, нет сил слушать длинное аудио.', 'Ограничений практически нет. При заложенном носе — вдох через слегка приоткрытый рот.', 'Физиологический вздох — врождённый механизм, который раскрывает спавшиеся альвеолы и быстро сбрасывает уровень возбуждения.'],
  [3, 'breath', 'Дыхание 4–7–8 перед сном', ['Вдох на четыре, задержка на семь, выдох на восемь. Восемь циклов. Это самая «тяжёлая» из дыхательных практик по ощущениям и самая сонная по эффекту — поэтому она вечерняя.', 'Если ком в горле мешает говорить и дышать, начни с практики 1, а к этой перейди через пару минут.'], 'Вечер, не получается заснуть, мысли идут по кругу в кровати.', 'Утром и днём — после неё тяжело включиться. Не подходит при беременности и повышенном давлении: задержка на семь счётов там избыточна, замени практикой 1.', 'Удлинённый выдох с задержкой; формат описан Эндрю Вейлом и широко используется как вечерний протокол.'],
  [4, 'breath', 'Ровное дыхание 5,5', ['Вдох и выдох одинаковой длины, примерно по пять с половиной секунд — около шести дыханий в минуту. Без задержек, без усилия. Задача не в том, чтобы расслабиться, а в том, чтобы просто держать ровный медленный ритм.', 'Это не экстренная практика, а восстановительная: её лучше делать, когда острый пик уже прошёл и осталось дрожащее, разобранное состояние.'], 'После волны. «Уже не трясёт, но внутри всё ещё гудит».', 'На самом пике — удерживать ровный ритм в этот момент невозможно.', 'Резонансная частота дыхания — около шести циклов в минуту, при которой вариабельность сердечного ритма максимальна.'],
  [5, 'breath', 'Дыхание по квадрату', ['Вдох на четыре, задержка на четыре, выдох на четыре, задержка на четыре. На экране по контуру квадрата движется точка — можно не считать, а просто следить глазами.', 'Отличие от первой практики в том, что здесь внимание занято ещё и счётом с фигурой. Когда мысли несутся и любая пауза заполняется ими, это помогает: голове дают простую задачу.'], 'Мысли летят, не получается сосредоточиться даже на счёте до шести.', 'При панической атаке с ощущением нехватки воздуха — задержки усиливают страх задохнуться. Там нужна практика 2.', 'Сочетание ритмического дыхания и переключения внимания на внешний объект.'],
  [6, 'body', 'Пять вещей вокруг', ['Назвать про себя пять вещей, которые видишь, четыре звука, три ощущения кожей, два запаха и один вкус. Медленно, с паузами — не спортивно, а по-настоящему находя каждую.', 'Смысл в том, что воспоминание и настоящий момент не помещаются в голове одновременно. Пока ты ищешь четвёртый звук, ты не прокручиваешь разговор. Это не отвлечение: прокрутка прервана не усилием воли, а занятостью внимания.'], 'Мысли по кругу, прокручивается разговор или сцена. Можно делать где угодно, в том числе среди людей.', 'Если состояние настолько острое, что не получается удерживать инструкцию — сначала практика 2.', 'Техника заземления из протоколов работы с острым стрессом; конкуренция за ресурс внимания.'],
  [7, 'body', 'Осмотреть комнату', ['Медленно повернуть голову и осмотреть комнату. Не выискивая ничего, просто давая глазам останавливаться на предметах: угол окна, край стола, дверная ручка. Задерживаться на каждом по две-три секунды.', 'Тело в этот момент получает сигнал, которого ему не хватает: здесь ничего не происходит, прямо сейчас мне ничего не угрожает. Потеря — не угроза телу, но тело не знает разницы и держится в готовности. Медленный осмотр её снимает.'], 'Общая взвинченность, ощущение опасности без причины, не получается сесть спокойно.', 'В транспорте и толпе — там слишком много движущихся объектов, эффекта не будет.', 'Ориентировочная реакция; медленный осмотр среды снижает готовность к угрозе.'],
  [8, 'body', 'Опора под ногами', ['Поставить стопы на пол, почувствовать вес тела. Чуть надавить пятками, потом пальцами. Заметить, что пол держит. Где именно ощущается давление: вся стопа или только пятка.', 'Самая незаметная практика в списке: её можно сделать на совещании, в метро, в гостях — никто не увидит.'], '«Уплывает», ощущение нереальности, голова отдельно от тела. На людях, когда нельзя уйти.', 'Ограничений нет.', 'Проприоцептивная стимуляция как способ вернуть ощущение собственных границ.'],
  [9, 'body', 'Отпустить плечи и челюсть', ['Не всё тело — только два места, где напряжение держится дольше всего. Поднять плечи к ушам, подержать пять секунд, уронить. Сжать челюсть, подержать, отпустить и чуть приоткрыть рот, чтобы зубы не смыкались. Повторить три раза.', 'Короткая версия нужна потому, что полное сканирование тела на остром пике часто делает хуже: внимание на симптомах усиливает их. Два участка — безопасный объём.'], 'Напряжение в верхней части тела, головная боль от сжатой челюсти, «каменные» плечи.', 'При травме шеи или плеча — только мягкое отпускание без подъёма.', 'Прогрессивная мышечная релаксация по Джекобсону, сокращённый протокол.'],
  [10, 'body', 'Бабочка', ['Скрестить руки на груди, ладони на плечах, и поочерёдно, медленно похлопывать — левая, правая, левая. Примерно раз в секунду. Глаза можно закрыть.', 'Две вещи сразу: ритмичное попеременное прикосновение и объятие самой себя. У практики есть обычный побочный эффект — на ней часто начинают плакать. Это нормально и даже хорошо: слёзы здесь не срыв, а разрядка.'], 'Когда хочется, чтобы обняли, а обнять некому. Вечер, одна дома.', 'На людях — выглядит заметно.', 'Билатеральная стимуляция, техника самопомощи из протоколов работы с травматическим стрессом.'],
  [11, 'mind', 'Рука на груди', ['Положить одну ладонь на грудь, вторую на живот. Почувствовать тепло руки и то, как ладонь поднимается от дыхания. И сказать себе — вслух или про себя — короткую фразу. Не «всё будет хорошо», а честную: «мне сейчас очень тяжело», «это правда больно».', 'Тёплое прикосновение к себе работает так же, как прикосновение другого человека: успокаивает физиологически. А честная фраза важнее утешительной, потому что утешение, в которое не веришь, отскакивает и оставляет ещё и злость на себя.'], 'Когда накрыло и рядом никого. Когда хочется, чтобы пожалели.', 'Если прикосновение к себе вызывает раздражение или отторжение — тогда практика 8.', 'Самосострадание как навык (К. Нефф); успокаивающее прикосновение активирует систему привязанности.'],
  [12, 'mind', 'Это волна', ['Самая важная практика в этой подборке и самая трудная. Вместо того чтобы отвлекаться, заметить: сейчас начинается волна. И просто быть с ней. Не разбираться, не искать причину, не решать. Замечать, как она растёт, где стоит пик и как она начинает спадать.', 'Волна почти всегда спадает раньше, чем кажется. Главный результат — не то, что стало легче, а то, что ты это пережила и увидела собственными глазами: оно заканчивается. После пяти-шести раз страх перед следующей волной заметно падает, а это и есть половина тяжести.'], 'Накатывает волнами, и каждая кажется бесконечной. Второе и дальше накрытие за день.', 'На работе и там, где нельзя заплакать. Не подходит, если волна длится часами без спада — это не волна, и здесь нужна не практика, а человек: психолог или телефон доверия.', 'Экспозиция и принятие вместо избегания; избегание эмоции удлиняет её, а не сокращает.'],
  [13, 'mind', 'Назвать мысль и вернуться', ['Сидеть с закрытыми глазами и следить за дыханием. Когда придёт мысль — а она придёт, — коротко назвать её про себя одним словом: «воспоминание», «обвинение», «план разговора», «а если». И вернуться к дыханию. Снова придёт — снова назвать.', 'Ошибка здесь одна: считать, что практика не удалась, раз мыслей много. Мысли и должны приходить. Практика — это и есть момент возвращения, и чем чаще отвлекаешься, тем больше таких моментов.'], 'Мысли по кругу, одни и те же сцены, воображаемые разговоры.', 'На остром пике — сначала практики 1 или 2, потом эта.', 'Практики внимания из программ MBSR; называние снижает слияние с мыслью.'],
  [14, 'mind', 'Отложить на потом', ['Когда мысль возвращается в десятый раз, не гнать её и не разбираться. Записать одной строкой в дневник и назначить ей время: сегодня в девять вечера, двадцать минут, я об этом подумаю.', 'Звучит как трюк, но работает: мысль возвращается, потому что боится быть забытой. Записанная и назначенная, она отступает. К девяти вечера половина записанного перестаёт быть срочным.'], 'Днём, на работе, когда думать об этом нельзя, а оно лезет.', 'Вечером перед сном — назначать время уже некуда, там подходит практика 3.', 'Техника отложенной тревоги из протоколов работы с руминацией.'],
  [15, 'mind', 'Переждать импульс', ['Для одного конкретного момента: рука тянется открыть его страницу, написать, позвонить, посмотреть, кто у него в отметках.', 'Не запрещать себе. Сказать: я сделаю это через восемь минут, если ещё захочу. Включить аудио и переждать — просто замечая, как желание растёт, стоит на пике и начинает спадать.', 'Через восемь минут выбор остаётся за тобой. Иногда ты всё равно откроешь — и это не провал. Важно другое: ты увидела, что импульс спадает сам, без того чтобы ему поддаться. Каждый пережданный раз делает следующий слабее.'], 'Тянет проверить его страницу, написать «нам надо поговорить», ответить на старое сообщение.', 'Если дело касается безопасности — угрозы, преследование, — здесь нужна не практика, а помощь.', 'Сёрфинг по импульсу (urge surfing, А. Марлатт); переживание волны влечения без действия ослабляет её со временем.']
];
const CALM_FIRST = [15, 12, 11];
const CALM_BLOCKS = [['breath', 'ДЫХАНИЕ · БЫСТРЕЕ ВСЕГО УСПОКАИВАЕТ ТЕЛО'], ['body', 'ТЕЛО И КОМНАТА · ВЕРНУТЬСЯ ИЗ ГОЛОВЫ'], ['mind', 'МЫСЛЬ И ИМПУЛЬС']];
const calmById = id => CALM.find(c => c[0] === Number(id));
/* Как он, вероятно, отреагирует — по находкам разбора (без «ночи»), не больше двух. */
const URGE_REACTION = {
  question: 'Ответит поздно, коротко или не ответит. С вопросом он решает, когда это закончится.',
  blame: 'Начнёт защищаться, оправдываться или промолчит. «Ты права», которого ждёшь, почти никогда не приходит.',
  plead: 'Молчание или короткий вежливый ответ. Вежливый ответ не значит, что он хочет вернуться.',
  long: 'Прочитает по диагонали и ответит на одну часть — и не на ту, что важнее всего тебе.',
  practical: 'Такой же практический ответ. Чем короче и конкретнее, тем меньше места для спора.',
  calm: 'Короткий нейтральный ответ или никакого. Если это будет больно — может, сейчас не время.'
};
const URGE_REVIEW = {
  night: 'Сейчас ночь. Ночные сообщения чаще пишутся из грусти или усталости — утром ты можешь прочитать его иначе.',
  question: 'Здесь есть вопрос — значит, ты будешь ждать ответа. Что будешь делать, если он не ответит сегодня или ответит не то, что ты ждёшь?',
  blame: 'Здесь есть упрёк («всегда», «никогда», «из-за тебя»). На упрёк почти всегда отвечают защитой, а не тем, что тебе нужно.',
  plead: 'Здесь есть просьба или «скучаю». После отправки обычно приходит облегчение на несколько минут, а потом — ожидание.',
  long: 'Сообщение длинное. Чем оно длиннее, тем больше частей могут остаться без ответа — и болеть.',
  practical: 'Это практический вопрос. Оставь только факты: что, когда и где. Без объяснений, что ты чувствуешь.',
  calm: 'Сообщение спокойное и по делу. И всё же момент выбираешь ты — не обязательно сейчас.'
};
const urgeLabel = (list, id) => (list.find(x => x[0] === id) || [id, ''])[1];
/* Список практик: три подходящие первыми, остальные — по кнопке, по блокам документа. */
function calmList(s, h, first, label) {
  const card = c => '<button class="wa-calm" data-wa="urge-practice" data-v="' + c[0] + '"><span class="num">' + c[0] + '</span><span class="c"><strong>' + esc(c[2]) + '</strong><small>' + esc(c[4]) + '</small></span>' + ic('play') + '</button>';
  const all = s.showAll ? CALM_BLOCKS.map(b => '<p class="wa-eyebrow wa-calm-block">' + b[1] + '</p>' + CALM.filter(c => c[1] === b[0] && !first.includes(c[0])).map(card).join('')).join('') : h.soft(ic('list') + '&nbsp;Показать все 15 практик', 'urge-all');
  return '<p class="wa-eyebrow" style="margin-top:4px">' + label + '</p><div class="wa-calm-list">' + first.map(id => card(calmById(id))).join('') + '</div><div class="wa-calm-list">' + all + '</div>';
}
/* Экран практики: «Encender», таймер, как делать / почему работает / когда не подходит. */
function calmRun(s, h, eyebrow) {
  const c = calmById(s.practice) || calmById(15), mine = PA.id === c[0], playing = mine && PA.playing, started = mine && PA.touched;
  const status = !started ? 'Нажми «Включить». Экран можно заблокировать: аудио продолжит звучать, управлять им можно оттуда.'
    : !playing ? 'На паузе.'
    : PA.missing ? 'Аудио к этой практике скоро появится. Пока следуй описанию ниже.'
    : 'Практика звучит. Экран можно заблокировать.';
  const visual = c[0] === 5 ? '<div class="wa-square' + (playing ? ' on' : '') + '" aria-hidden="true"><i></i></div>'
    : '<div class="wa-ground' + (playing ? '' : ' paused') + '" aria-hidden="true"><b>' + ic('headphones') + '</b></div>';
  return [esc(c[2]), eyebrow + visual +
    '<button class="wa-primary wa-calm-play" data-wa="calm-toggle" aria-pressed="' + playing + '"><span>' + (playing ? 'Пауза' : started ? 'Продолжить' : 'Включить') + '</span><b>' + ic(playing ? 'pause' : 'play') + '</b></button>' +
    '<p class="wa-calm-status" role="status">' + esc(status) + '</p>' +
    '<div class="wa-calm-how">' + c[3].map(t => '<p>' + esc(t) + '</p>').join('') +
    '<small>КОГДА ПОДХОДИТ</small><p>' + esc(c[4]) + '</p><small>КОГДА НЕ ПОДХОДИТ</small><p>' + esc(c[5]) + '</p><small>НА ЧЁМ ОСНОВАНО</small><p>' + esc(c[6]) + '</p></div>' +
    h.dark('Готово', 'urge-after', 'check') + h.soft('Выбрать другую практику', 'urge-back-practice')];
}

/* «Me está desbordando» и «Una noche difícil» (07.10.2026): те же 15 практик. Накрывает — сначала один вопрос
   «что сильнее: тело, мысли или тянет написать» → три практики по правилу документа (тело 2, 1, 9; мысли 6, 5, 13;
   импульс 15, 12, 11), остальные по кнопке. Ночь — сразу 3 (4-7-8), 1 и 10 («Бабочка»: вечер, одна дома). */
const CALM_ASK = [['body', 'Тело: трясёт, не хватает воздуха'], ['mind', 'Мысли: крутятся по кругу'], ['urge', 'Тянет написать ему или зайти на его страницу']];
const CALM_PICK = { body: [2, 1, 9], mind: [6, 5, 13], urge: [15, 12, 11], night: [3, 1, 10] };
const CALM_LABEL = { body: 'КОГДА СИЛЬНЕЕ ТЕЛО', mind: 'КОГДА МЫСЛИ ПО КРУГУ', urge: 'КОГДА ТЯНЕТ ЕМУ НАПИСАТЬ', night: 'ДЛЯ НОЧИ' };
const isCalmSheet = s => !!s && (s.type === 'urge' || s.type === 'overwhelm' || s.type === 'hardnight');
function calmSheet(s, h) {
  const night = s.type === 'hardnight', st = s.step || (night ? 'practice' : 'ask'), n = name();
  const eyebrow = '<span class="wa-eyebrow">' + (night ? 'ТРУДНАЯ НОЧЬ' : 'МЕНЯ НАКРЫВАЕТ') + '</span>';
  const msg = text => '<div class="wa-urge-chat"><div class="wa-msg first"><span class="wa-ava" aria-hidden="true">m</span><div class="wa-bubble">' + esc(text) + '</div></div></div>';
  if (st === 'ask') return ['Что сейчас<br><em>сильнее?</em>', eyebrow + h.p('Выбери одно. Под это я предложу три практики, а не пятнадцать.') +
    '<div class="wa-urge-opts">' + CALM_ASK.map(x => '<button class="wa-urge-opt' + (s.pick === x[0] ? ' on' : '') + '" data-wa="calm-ask" data-v="' + x[0] + '">' + esc(x[1]) + '</button>').join('') + '</div>'];
  if (st === 'practice') {
    const key = night ? 'night' : s.pick || 'body';
    return [night ? 'Трудная<br><em>ночь.</em>' : 'Давай<br><em>шаг за шагом.</em>', eyebrow +
      msg(night ? (n ? n + ', этой ночью' : 'Этой ночью') + ' ничего не нужно решать. Выбери практику, включи её и, если хочешь, погаси экран.'
        : (n ? n + ', выбери' : 'Выбери') + ' практику и включи её. Если не полегчает — попробуем другую.') +
      calmList(s, h, CALM_PICK[key], CALM_LABEL[key]) + (key === 'urge' ? h.quiet('Всё равно хочу написать', 'calm-to-urge') : '')];
  }
  if (st === 'run') return calmRun(s, h, eyebrow);
  if (st === 'help') return ['Не нужно<br><em>справляться одной.</em>', eyebrow + h.p('Если волна не спадает часами или тебе небезопасно, нужен человек, а не практика.') +
    '<div class="wa-box"><small>' + 'ЕСЛИ ТЕБЕ НЕБЕЗОПАСНО' + '</small><span>' + esc('Звони 112 (экстренные службы) или на телефон доверия экстренной психологической помощи МЧС России: +7 (495) 989-50-50 — круглосуточно, анонимно и бесплатно.') + '</span></div>' +
    h.soft('Попросить близкого побыть рядом', 'sheet', ' data-s="human"') + h.quiet('Вернуться к практикам', 'urge-back-practice')];
  return ['Как ты<br><em>теперь?</em>', eyebrow + '<div style="display:grid;gap:10px">' +
    '<button class="wa-choice" data-wa="calm-better"><span class="ic">' + ic('heart') + '</span><span class="c"><strong>Стало легче</strong><small>Сюда можно вернуться в любой момент</small></span>' + ic('check') + '</button>' +
    '<button class="wa-choice" data-wa="urge-back-practice"><span class="ic">' + ic('rotate-cw') + '</span><span class="c"><strong>Попробовать другую практику</strong><small>Их пятнадцать — какая-то может подойти лучше</small></span>' + ic('arrow-right') + '</button>' +
    '<button class="wa-choice" data-wa="calm-help"><span class="ic">' + ic('life-buoy') + '</span><span class="c"><strong>Не проходит</strong><small>Когда нужен человек и куда звонить</small></span>' + ic('arrow-right') + '</button></div>'];
}

function urgeStepName(st) { return { why: '1 · ЗАЧЕМ', feel: '2 · ЧТО ЧУВСТВУЕШЬ', practice: '3 · ПРАКТИКА', run: '3 · ПРАКТИКА', after: '4 · А ТЕПЕРЬ', chat: '5 · ТВОЁ СООБЩЕНИЕ', review: '5 · ТВОЁ СООБЩЕНИЕ' }[st] || ''; }
function urgeSheet(s, h) {
  const st = s.step || 'why', n = name(), eyebrow = '<span class="wa-eyebrow">ХОЧУ ЕМУ НАПИСАТЬ · ' + urgeStepName(st) + '</span>';
  const opts = (list, action, picked) => '<div class="wa-urge-opts">' + list.map(x => '<button class="wa-urge-opt' + (picked === x[0] ? ' on' : '') + '" data-wa="' + action + '" data-v="' + x[0] + '">' + esc(x[1]) + '</button>').join('') + '</div>';
  const msg = (text, first) => '<div class="wa-msg' + (first ? ' first' : '') + '"><span class="wa-ava' + (first ? '' : ' ghost') + '" aria-hidden="true">m</span><div class="wa-bubble">' + esc(text) + '</div></div>';
  const still = h.quiet('Всё равно хочу написать', 'urge-chat');
  if (st === 'why') return ['Зачем хочешь<br>ему написать?', eyebrow + h.p('Без оценки. Выбери то, что ближе всего к тому, что сейчас внутри.') + opts(URGE_WHY, 'urge-why', s.why)];
  if (st === 'feel') return ['Что ты сейчас<br>чувствуешь?', eyebrow + h.p('Когда называешь чувство, оно уже чуть стихает.') + opts(URGE_FEEL, 'urge-feel', s.feel)];
  if (st === 'practice') {
    return ['Сначала —<br><em>практика.</em>', eyebrow +
      '<div class="wa-urge-chat">' + msg((n ? n + ', сначала' : 'Сначала') + ' предлагаю тебе выбрать практику и пройти её. Если не полегчает — пойдём дальше.', true) + msg(URGE_FEEL_NOTE[s.feel] || '', false) + '</div>' +
      calmList(s, h, CALM_FIRST, 'КОГДА ТЯНЕТ ЕМУ НАПИСАТЬ') + still];
  }
  if (st === 'run') return calmRun(s, h, eyebrow);
  if (st === 'after') return ['Как ты<br><em>теперь?</em>', eyebrow + '<div style="display:grid;gap:10px">' +
    '<button class="wa-choice" data-wa="urge-better"><span class="ic">' + ic('heart') + '</span><span class="c"><strong>Лучше. Уже не пишу ему</strong><small>Ты сначала позаботилась о себе</small></span>' + ic('check') + '</button>' +
    '<button class="wa-choice" data-wa="urge-back-practice"><span class="ic">' + ic('rotate-cw') + '</span><span class="c"><strong>Попробовать другую практику</strong><small>Их пятнадцать — какая-то может подойти лучше</small></span>' + ic('arrow-right') + '</button>' +
    '<button class="wa-choice" data-wa="urge-chat"><span class="ic">' + ic('message-circle') + '</span><span class="c"><strong>Всё равно хочу написать</strong><small>Сначала разберём в чате</small></span>' + ic('arrow-right') + '</button></div>'];
  const intro = msg((n ? n + ', этот' : 'Этот') + ' чат создан, чтобы трезво разобрать, что ты на самом деле хочешь ему написать и как он скорее всего на это отреагирует.', true) +
    msg('Напиши сначала сюда — так, как отправила бы ему, — и я пришлю тебе разбор. После этого решишь. Из mía ничего не отправляется.', false);
  if (st === 'chat') {
    return ['Прежде чем отправить —<br><em>напиши сюда.</em>', eyebrow + '<div class="wa-urge-chat">' + intro + '</div>' +
      '<form class="wa-urge-compose" data-form="urge"><textarea rows="3" maxlength="1200" data-field="urge-msg" aria-label="Твоё сообщение ему" placeholder="Привет…">' + esc(s.draft || '') + '</textarea>' +
      '<button type="submit" class="send" data-wa="urge-review" aria-label="Отправить на разбор"' + ((s.draft || '').trim() ? '' : ' disabled') + '>' + ic('send-horizontal') + '</button></form>'];
  }
  const found = C.messageReview(s.draft, { why: s.why, hour: nowDate().getHours() }), react = found.filter(k => URGE_REACTION[k]).slice(0, 2);
  const head = ['Посмотрим на сообщение<br><em>вместе.</em>', eyebrow + '<div class="wa-urge-chat">' + intro + '<div class="wa-msg user"><div class="wa-bubble">' + esc(s.draft) + '</div></div>'];
  if (s.thinking) return [head[0], head[1] + '<div class="wa-msg first"><span class="wa-ava" aria-hidden="true">m</span><span class="wa-typing" aria-label="mía печатает"><i></i><i></i><i></i></span></div></div>'];
  return [head[0], head[1] +
    msg(s.why && s.feel ? 'Зачем: «' + urgeLabel(URGE_WHY, s.why) + '». Что чувствуешь: ' + urgeLabel(URGE_FEEL, s.feel).toLowerCase() + '. Вот что я вижу в сообщении:' : 'Вот что я вижу в сообщении:', true) +
    '<div class="wa-indent"><div class="wa-review">' + found.map(k => '<p>' + ic(k === 'calm' ? 'check' : 'eye') + '<span>' + esc(URGE_REVIEW[k]) + '</span></p>').join('') + '</div></div>' +
    msg('Как он, скорее всего, отреагирует (наверняка не знает никто):', false) +
    '<div class="wa-indent"><div class="wa-review react">' + react.map(k => '<p>' + ic('message-circle-reply') + '<span>' + esc(URGE_REACTION[k]) + '</span></p>').join('') + '</div></div>' +
    msg('Прежде чем решить: представь, что ты отправила, а он не отвечает весь день. Как ты будешь?', false) + '</div>' +
    '<div style="display:grid;gap:10px">' + h.soft(ic('moon') + '&nbsp;Отложить до утра', 'urge-keep') + h.soft(ic('pencil') + '&nbsp;Изменить сообщение', 'urge-chat') +
    h.dark('Отправлю сама: скопировать текст', 'urge-copy', 'copy') + h.quiet('Не отправляю. Удалить', 'urge-drop') + '</div>' +
    '<p style="font-size:13px;text-align:center">mía ничего не отправляет за тебя. Если скопируешь — отправишь сама, когда решишь.</p>'];
}
/* Разбор появляется после «печатает…», как ответ в чате. */
function urgeReview() {
  const s = ui.sheet; if (!s || s.type !== 'urge' || !String(s.draft || '').trim()) return;
  T('urge_review', { found: C.messageReview(s.draft, { why: s.why, hour: nowDate().getHours() }) });
  urgeStep('review', { thinking: true });
  setTimeout(() => { if (ui.sheet === s && s.step === 'review') { s.thinking = false; renderSheet(true); const sh = $('.wa-sheet'); if (sh) sh.scrollTop = sh.scrollHeight; } }, still() ? 0 : 1100);
}
function urgeStep(step, extra) {
  const s = ui.sheet; if (!isCalmSheet(s)) return;
  if (step !== 'run') calmStop();
  Object.assign(s, extra || {}, { step }); renderSheet();
}

/* Аудио практики (07.10.2026): «Encender» включает запись calm-NN.m4a; «Pausa» / «Continuar». Время на экране не показываем.
   Запись играет при заблокированном экране и управляется оттуда (Media Session), как лекции дня. Файлы — в папке
   MiaConfig.calmAudioBase (по умолчанию audio/calm, в /ru/ — audio/calm-ru); пока файла нет — только описание. По окончании записи — «¿Cómo estás ahora?». */
const PA = { el: null, id: null, missing: false, playing: false, touched: false };
function calmSrc(id) { return String(raw.calmAudioBase || 'audio/calm').replace(/\/+$/, '') + '/calm-' + String(id).padStart(2, '0') + '.m4a'; }
function calmMark(playing) {
  if (playing === PA.playing) return;
  PA.playing = playing;
  if ('mediaSession' in navigator && PA.el && !PA.missing) try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch (e) { /* старые браузеры */ }
  if (isCalmSheet(ui.sheet) && ui.sheet.step === 'run') renderSheet(true);
}
function calmToggle(id) {
  const c = calmById(id); if (!c) return;
  if (PA.id !== c[0]) { calmStop(); PA.id = c[0]; }
  PA.touched = true;
  if (PA.playing) { if (PA.el && !PA.missing) PA.el.pause(); calmMark(false); return; }
  if (A.el) stopAudio();
  if (!PA.el) {
    const el = new Audio(); el.preload = 'auto'; el.src = calmSrc(c[0]);
    el.addEventListener('play', () => { if (PA.el === el) calmMark(true); });
    el.addEventListener('pause', () => { if (PA.el === el && !el.ended && !PA.missing) calmMark(false); });
    el.addEventListener('ended', () => { if (PA.el === el) { calmStop(); if (isCalmSheet(ui.sheet)) urgeStep('after'); } });
    el.addEventListener('error', () => { if (PA.el === el) { PA.missing = true; if (isCalmSheet(ui.sheet) && ui.sheet.step === 'run') renderSheet(true); } });
    PA.el = el;
  }
  calmMark(true); T('calm_play', { id: c[0], audio: !PA.missing });
  if (!PA.missing) { const pr = PA.el.play(); if (pr && pr.catch) pr.catch(() => {}); }
  calmMedia(c);
}
function calmStop() {
  if (PA.el) { PA.el.pause(); PA.el.removeAttribute('src'); try { PA.el.load(); } catch (e) { /* пусто */ } }
  const had = PA.id !== null;
  Object.assign(PA, { el: null, id: null, missing: false, playing: false, touched: false });
  if (had && !A.el && 'mediaSession' in navigator) navigator.mediaSession.metadata = null;
}
function calmMedia(c) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: c[2], artist: 'mía', artwork: [{ src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png' }] });
    navigator.mediaSession.setActionHandler('play', () => { if (!PA.playing) calmToggle(PA.id); });
    navigator.mediaSession.setActionHandler('pause', () => { if (PA.playing) calmToggle(PA.id); });
    ['seekbackward', 'seekforward', 'seekto'].forEach(a => navigator.mediaSession.setActionHandler(a, null));
  } catch (e) { /* не все браузеры знают все действия */ }
}

/* ---------- Нижние листы ---------- */
function openSheet(type, extra) {
  if (!ui.sheet || ui.sheet.type !== type) T('sheet_open', { sheet: type, moment: extra && extra.moment });
  if (!ui.sheet) ui.returnFocus = document.activeElement;
  const base = type === 'reminders' ? reminderDraft() : type === 'urge' ? { step: 'why', draft: (S.profile.urgeDraft && S.profile.urgeDraft.text) || '' } : type === 'overwhelm' ? { step: 'ask' } : type === 'hardnight' ? { step: 'practice' } : {};
  const help = { urge: 'urge', overwhelm: 'rescue', hardnight: 'night', rescue: 'rescue', pause: 'rescue' };
  if (help[type] && !(ui.sheet && help[ui.sheet.type] === help[type])) evApp('help_opened', { kind: help[type] });
  ui.sheet = { type, ...base, ...(extra || {}) }; renderSheet();
}
function reminderDraft() { const p = call(() => push().prefs(), null) || {}; return { morningOn: p.morningOn !== false, morning: p.morning || '08:30', eveningOn: p.eveningOn !== false, dnd: p.dndUntil || '', busy: false, error: '' }; }
function closeSheet() { calmStop(); ui.sheet = null; renderSheet(); const f = ui.returnFocus; ui.returnFocus = null; if (f && f.isConnected) f.focus({ preventScroll: true }); }
function sheetHTML(s) {
  const dark = (t, a, icon, extra) => '<button class="wa-dark" data-wa="' + a + '"' + (extra || '') + '><span>' + t + '</span><b>' + ic(icon || 'check') + '</b></button>';
  const soft = (t, a, extra) => '<button class="wa-soft" data-wa="' + a + '"' + (extra || '') + '>' + t + '</button>';
  const quiet = (t, a, extra) => '<button class="wa-quiet" data-wa="' + a + '"' + (extra || '') + '>' + t + '</button>';
  const p = t => '<p>' + esc(t) + '</p>';
  const choice = (icon, t, n, s2) => '<button class="wa-choice" data-wa="sheet" data-s="' + s2 + '"><span class="ic">' + ic(icon) + '</span><span class="c"><strong>' + t + '</strong><small>' + n + '</small></span>' + ic('arrow-right') + '</button>';
  switch (s.type) {
    case 'lang': {
      const A = LCx() && LCx().ui().account; if (!A) return null;
      return [esc(A.langTitle), langList().map(l => '<button class="wa-choice' + (l.on ? ' on' : '') + '" data-wa="lang-set" data-path="' + esc(l.path) + '"' + (l.on ? ' aria-current="true"' : '') + '><span class="c"><strong>' + esc(l.label) + '</strong></span>' + ic(l.on ? 'check' : 'chevron-right') + '</button>').join('') + p(A.langNote)];
    }
    case 'help': {
      /* В режиме урока «Я рядом» рассказывает, кто такая Мия (тексты — lesson-ui.json → aboutMia; текст владельца, 02.11.2026, за правдивость отвечает он) */
      const A = LCx() && LCx().ui().aboutMia;
      if (A) return [esc(A.title), '<div class="wa-mia-about"><div class="hero"><img src="assets/mia-flower.webp" alt="" aria-hidden="true"><span class="on"><i></i>' + esc(A.status) + '</span></div>' +
        '<p class="lead">' + esc(A.lead) + '</p><ul>' + A.features.map(f => '<li><span class="ic">' + ic(f.icon) + '</span><div><strong>' + esc(f.title) + '</strong><span>' + esc(f.text) + '</span></div></li>').join('') + '</ul>' +
        '<p class="note">' + esc(A.note) + '</p></div>' + dark(esc(A.button), 'sheet-close', 'arrow-right')];
      return ['Что тебе нужно<br>прямо сейчас?', p('Не нужно решать всё сразу. Выбери, с чего начнём.') + choice('message-circle', 'Хочу ему написать', 'Пауза перед решением.', 'urge') + choice('waves', 'Меня накрывает', 'Три практики под то, что сильнее.', 'overwhelm') + choice('moon', 'Тяжело этой ночью', 'Практики для ночи, без требования уснуть.', 'hardnight') + quiet('Хочу поговорить с человеком', 'sheet', ' data-s="human"')];
    }
    case 'urge': return urgeSheet(s, { dark, soft, quiet, p });
    case 'overwhelm': case 'hardnight': return calmSheet(s, { dark, soft, quiet, p });
    case 'rescue': {
      const steps = K.ground.steps, i = Math.min(s.i || 0, steps.length - 1), st = steps[i], last = i >= steps.length - 1;
      return [esc(st.q), '<span class="wa-eyebrow">ПАУЗА · ШАГ ' + (i + 1) + ' ИЗ ' + steps.length + '</span><div class="wa-ground" aria-hidden="true"><b>' + esc(st.number || '') + '</b></div>' + p(st.body) + dark(last ? 'Закончить паузу' : 'Готова, дальше', last ? 'rescue-end' : 'rescue-next', last ? 'check' : 'arrow-right') + quiet('Мне достаточно на сейчас', 'sheet-close')];
    }
    case 'pause': case 'night': {
      const night = s.type === 'night';
      return [night ? 'Только этот момент.' : 'Давай не спеша.', p('Если тебе удобно, почувствуй опору под телом и позволь дыханию идти в своём ритме.') + '<div class="wa-ground" aria-hidden="true"><b class="sm">В твоём темпе.</b></div>' +
        '<p style="text-align:center;font-size:14px">Не нужно следовать счёту. Можно остановиться или выбрать другую практику.</p>' +
        (night ? '<button class="wa-primary" data-wa="sheet-close"><span>Закончить паузу</span><b>' + ic('check') + '</b></button>' : dark('Закончить паузу', 'sheet-close')) +
        '<button class="wa-soft" data-wa="sheet" data-s="rescue"' + (night ? ' style="background:#FFFFFF1F;color:#fff"' : '') + '>Лучше посмотрю вокруг</button>', night];
    }
    case 'human': return ['Кто-то близкий рядом.', p('Можно сказать близкому человеку простую фразу:') + '<div class="quote">«Сегодня мне непросто. Можешь немного побыть со мной? Не нужно ничего решать».</div>' + p('Если чувства захлёстывают или мешают повседневной жизни, можно обратиться за поддержкой к специалисту.') + dark('Скопировать фразу', 'copy-human', 'copy') + quiet('Возьму это с собой', 'sheet-close')];
    case 'psychologist': return ['Поговорить<br>со специалистом.', p('Иногда практик недостаточно — и это не твой провал. Психолог может быть рядом там, где приложению не хватает живого человека.') +
      (cfg.psychologistUrl ? '<a class="wa-dark" href="' + esc(cfg.psychologistUrl) + '" target="_blank" rel="noopener"><span>Записаться к психологу</span><b>' + ic('arrow-up-right') + '</b></a>' + p('Запись откроется на другой странице. mía не передаёт туда твои ответы и записи.')
        : '<div class="wa-box"><small>ЗАПИСЬ СКОРО ОТКРОЕТСЯ</small><span>Мы подбираем специалистов. Как только запись заработает, кнопка появится здесь.</span></div>') +
      p('Если тебе сейчас небезопасно или есть мысли причинить себе вред — звони 112 или на телефон доверия МЧС России +7 (495) 989-50-50 (круглосуточно).') + quiet('Вернуться', 'sheet-close')];
    case 'format': {
      const f = fmt(), opt = (v, icon, t, note) => '<button class="wa-option" data-wa="format-pick" data-v="' + v + '" role="radio" aria-checked="' + (f === v) + '"><span class="ic">' + ic(icon) + '</span><span class="c"><strong>' + t + '</strong><small>' + note + '</small></span><span class="mark" aria-hidden="true">' + (f === v ? ic('check') : '') + '</span></button>';
      return ['Читать или слушать?', p('Выбери, как открывать теорию дня по нажатию на её название. Оба формата всегда остаются доступными.') +
        '<div role="radiogroup" aria-label="Как знакомиться с темой" style="display:grid;gap:10px">' + opt('text', 'align-left', 'Предпочитаю читать', 'Полный текст на одном экране') + opt('audio', 'headphones', 'Предпочитаю слушать', 'Аудио и текст записи рядом') + '</div>'];
    }
    case 'name': return ['Как тебя называть?', p('Имя или псевдоним — как тебе удобно. Так mía будет к тебе обращаться.') + '<input class="wa-input" data-field="name" maxlength="30" autocomplete="given-name" aria-label="Твоё имя" placeholder="Например, Аня" value="' + esc(S.profile.name || name()) + '">' + dark('Сохранить', 'name-save') + '<p style="text-align:center;font-size:13px">Поле можно оставить пустым.</p>'];
    case 'privacy': return ['Твоё личное остаётся здесь.', p(session() ? 'Записи, «Сохранённое» и прогресс хранятся в этом браузере и, чтобы они были на всех твоих устройствах, на нашем сервере — рядом с аккаунтом (почта, имя и ответы теста, которые ты с согласия дала на сайте). Если ты уйдёшь из mía, они хранятся ещё 90 дней после окончания доступа, потом стираются; если удалишь аккаунт — стираются сразу. Если включишь напоминания, мы храним ещё часовой пояс, выбранное время и дату первого дня.' : 'Имя, настройки и записи хранятся только в этом браузере. mía не отправляет их на сервер и не синхронизирует между устройствами.') +
      p(session() ? 'Если очистишь данные браузера, при следующем входе в аккаунт всё вернётся на место. Кнопкой ниже они стираются и здесь, и в аккаунте.' : 'Данные остаются после закрытия страницы. Они исчезнут, если очистить данные браузера или удалить их кнопкой ниже.') + soft(ic('download') + '&nbsp;Сохранить копию моих данных', 'export') + soft('Удалить все мои данные', 'sheet', ' data-s="reset"') +
      p('Удалить аккаунт: «Аккаунт → Удалить аккаунт» или напиши на ' + SUPPORT_EMAIL + ', удалим за 30 дней.') +
      (session() ? soft('Удалить аккаунт', 'sheet', ' data-s="delete-account"') : '') +
      '<a class="wa-soft" href="' + esc(cfg.legalBase + 'privacy.html') + '" target="_blank" rel="noopener">Политика конфиденциальности&nbsp;' + ic('arrow-up-right') + '</a>' + quiet('Понятно', 'sheet-close')];
    case 'reminders': {
      const m = push(), enabled = !!(m && call(() => m.prefs().enabled, false)), denied = m && call(() => m.permission(), '') === 'denied';
      const slot = (k, title, note) => '<div class="wa-slot"><button class="wa-row" data-wa="remind-toggle" data-k="' + k + '" role="switch" aria-checked="' + !!s[k + 'On'] + '"><span class="c"><strong>' + title + '</strong><small>' + note + '</small></span><span class="wa-toggle' + (s[k + 'On'] ? ' on' : '') + '" aria-hidden="true"></span></button>' +
        (s[k + 'On'] && k === 'morning' ? '<label class="wa-time"><span>Время</span><input type="time" step="300" min="08:00" max="21:30" data-field="remind-time" data-k="' + k + '" value="' + esc(s[k]) + '" aria-label="' + title + ': время"></label>' : '') + '</div>';
      return ['Напоминания', p('Утром — одно напоминание; вечером — только если есть причина. Никогда с 22:00 до 8:00. Изменить или выключить можно в любой момент.') +
        slot('morning', 'Утром', 'Что сегодня — в твоё время.') +
        slot('evening', 'Вечерние напоминания', 'В 20:30, только если есть причина.') +
        '<div class="wa-slot"><label class="wa-time"><span>Не беспокоить до</span><input type="date" data-field="remind-dnd" min="' + C.dateKey(new Date()) + '" value="' + esc(s.dnd || '') + '" aria-label="Не беспокоить до"></label>' +
        (s.dnd ? '<button class="wa-quiet" data-wa="remind-dnd-clear">Убрать «Не беспокоить»</button>' : '') + '</div>' +
        (denied ? '<div class="wa-note plain">' + esc(m.MESSAGES.denied) + '</div>' : '') +
        (s.error ? '<div class="wa-note plain" role="alert">' + esc(s.error) + '</div>' : '') +
        dark(s.busy ? 'Секунду…' : enabled ? 'Сохранить' : 'Включить', 'remind-save', 'bell', s.busy ? ' disabled' : '') +
        (enabled ? quiet('Выключить напоминания', 'remind-off', s.busy ? ' disabled' : '') : soft('Не сейчас', 'sheet-close'))];
    }
    case 'install': {
      /* Тексты инструкции — из install.js (один источник с экраном после оплаты). */
      const g = s.g; if (!g) return null;
      const ready = g.native && call(() => window.MiaInstall.available(), false);
      return [esc(g.title), (g.lead ? p(g.lead) : '') + '<ol class="wa-howto">' + g.steps.map((t, i) => '<li><span>' + (i + 1) + '</span><p>' + esc(t) + '</p>' + (g.pics && g.pics[i] ? '<figure class="wa-pic" aria-hidden="true">' + g.pics[i] + '</figure>' : '') + '</li>').join('') + '</ol>' + (g.note ? p(g.note) : '') +
        (ready ? dark(esc(g.labels.native), 'install-native', 'download') : '') + (g.copy ? soft(esc(g.labels.copy), 'install-copy') : '') + quiet(esc(g.labels.done), 'sheet-close')];
    }
    case 'reset': return ['Удалить всё и начать заново?', p(session() ? 'Из этого браузера и из аккаунта сотрутся записи, ответы в практиках и прогресс. Отменить это будет нельзя. Если пользуешься mía на другом устройстве, сотри данные и там. Подписка не изменится.' : 'Из этого браузера удалятся записи, ответы в практиках и прогресс. Отменить это не получится. Аккаунт и подписка не изменятся.') + dark('Да, удалить мои данные', 'reset') + soft('Оставить всё как есть', 'sheet-close')];
    case 'delete-account': return ['Удалить аккаунт?', p('С нашего сервера удалятся аккаунт, почта, пароль и ответы, а также всё, что сохранено в этом браузере. Отменить это не получится.') + p('Если у тебя подписка с сайта, она будет отменена, и списаний больше не будет.') + dark(s.busy ? 'Удаляем…' : 'Да, удалить аккаунт', 'delete-account', 'check', s.busy ? ' disabled' : '') + soft('Нет, оставить', 'sheet-close')];
    case 'cancel': {
      const err = s.error ? '<div class="wa-note plain" role="alert">' + esc(s.error) + '</div>' : '', busy = s.busy ? ' disabled' : '';
      if (pausedNow()) {
        return ['Отменить подписку?', p('Сейчас подписка на паузе: если остановить её, списаний больше не будет, доступ закрыт. «Сохранённое» и твои записи сохранятся ещё 90 дней — если вернёшься, всё будет на месте.') + err +
          dark(s.busy ? 'Секунду…' : 'Остановить', 'sub-cancel', 'check', busy) + quiet('Оставить как есть', 'sheet-close')];
      }
      const pl = subPlan(), w = withdrawal(); if (!pl) return null;
      const until = longDate(pl.end), r = retentionOffer(), step = r ? s.step || 'sure' : 'final';
      if (step === 'sure') {
        return ['Ты точно уверена? 😞', p('Нам жаль тебя отпускать. Твоя программа на месте, там, где ты остановилась.') +
          dark('Остаться', 'sheet-close', 'heart') + quiet('Да, отменить', 'ret-step', ' data-step="half"')];
      }
      if (step === 'half') {
        return ['А если мы сделаем тебе скидку 50%?', p('Следующий платёж ' + until + ' составит ' + money(r.halfPrice) + ' вместо ' + money(r.renewal) + '. Дальше обычная цена. Отменить можно в любой момент.') + err +
          dark(s.busy ? 'Секунду…' : 'Хочу скидку 50%', 'ret-take', 'badge-percent', busy + ' data-offer="half"') + quiet('Нет, всё равно отменить', 'ret-step', busy + ' data-step="free"')];
      }
      if (step === 'free') {
        return ['Хорошо. Оставайся бесплатно.', p('Следующие ' + r.freeWeeks + ' недели ты ничего не платишь. Потом ' + r.discountedPayments + ' платежа по ' + money(r.discountedPrice) + ' вместо ' + money(r.renewal) + ', а дальше обычная цена. Отменить можно в любой момент.') + err +
          dark(s.busy ? 'Секунду…' : 'Остаться бесплатно', 'ret-take', 'gift', busy + ' data-offer="free_period"') + quiet('Нет, отменить подписку', 'ret-step', busy + ' data-step="final"')];
      }
      if (w) {
        return ['Отменить подписку?', p('Ты в первых 14 днях — можно вернуть первый платёж, ' + money(w) + '. Тогда доступ закроется сразу. Или остановить продление и оставить доступ до ' + until + '.') + err +
          dark(s.busy ? 'Секунду…' : 'Вернуть деньги и закрыть доступ', 'sub-refund', 'undo-2', busy) + soft('Остановить, оставить доступ до ' + until, 'sub-cancel', busy) + quiet('Оставить как есть', 'sheet-close')];
      }
      return ['Отменить подписку?', p('Списаний больше не будет. Доступ останется до ' + until + '. «Сохранённое» и твои записи сохранятся ещё 90 дней — если вернёшься, всё будет на месте.') +
        err +
        dark(s.busy ? 'Секунду…' : 'Остановить', 'sub-cancel', 'check', busy) + quiet('Оставить как есть', 'sheet-close')];
    }
    case 'retained': {
      const r = s.r || RETENTION_DEMO, when = s.at ? longDate(s.at) : '';
      if (s.offer === 'half') return ['Готово. Ты остаёшься с нами.', p((when ? 'Следующий платёж ' + when + ' составит ' : 'Следующий платёж составит ') + money(s.amount || r.halfPrice) + ' вместо ' + money(r.renewal) + '. Дальше обычная цена.') + dark('Продолжить программу', 'sheet-close', 'arrow-right')];
      return ['Готово. Ты остаёшься бесплатно.', p((when ? 'Ты ничего не платишь до ' + when + '. ' : 'Ближайшие недели ты ничего не платишь. ') + 'Потом ' + r.discountedPayments + ' платежа по ' + money(s.amount || r.discountedPrice) + ' вместо ' + money(r.renewal) + ', а дальше обычная цена. Отменить можно в любой момент.') + dark('Продолжить программу', 'sheet-close', 'arrow-right')];
    }
    case 'refund': {
      const w = withdrawal(), err = s.error ? '<div class="wa-note plain" role="alert">' + esc(s.error) + '</div>' : ''; if (!w) return null;
      return ['Вернуть первый платёж?', p('Ты в первых 14 днях: вернём ' + money(w) + ' и доступ закроется сразу.') + err +
        dark(s.busy ? 'Секунду…' : 'Вернуть деньги и закрыть доступ', 'sub-refund', 'undo-2', s.busy ? ' disabled' : '') + quiet('Оставить как есть', 'sheet-close')];
    }
    case 'canceled': {
      const mail = liveBilling() ? ' Письмо с подтверждением уже ушло на твою почту.' : '';
      const back = p('Если захочешь вернуться — вход по этой же почте, с того дня, где остановилась.');
      if (s.refund) return ['Деньги возвращены.', p('Мы вернули ' + money(s.refund) + '. Доступ закрыт, списаний больше не будет.' + mail) + back + dark('Понятно', 'canceled-ok')];
      return ['Подписка отменена.', p('Списаний больше не будет. ' + (s.until ? 'Доступ до ' + longDate(s.until) + '.' : 'Доступ закрыт.') + mail) + back + dark('Понятно', 'canceled-ok')];
    }
    case 'upgrade': {
      const pl = subPlan(), o = offer(); if (!pl || !o || !pl.next) return null;
      if (o.live) {
        return ['Перейти на 3 месяца', '<div class="wa-box"><small>ЧТО ИЗМЕНИТСЯ</small><span>' + esc('Сегодня спишется ' + money(o.extra) + ' с карты подписки: цена 3 месяцев (' + money(o.price) + ') минус неиспользованная часть текущего тарифа. Подписка на 3 месяца — до ' + longDate(o.end) + '. Дальше — ' + money(o.price) + ' каждые 3 месяца. Отменить можно в любой момент.') + '</span></div>' +
          (s.error ? '<div class="wa-note plain" role="alert">' + esc(s.error) + '</div>' : '') +
          dark(s.busy ? 'Списываем…' : 'Оплатить ' + esc(money(o.extra)), 'sub-upgrade', 'check', s.busy ? ' disabled' : '') + soft('Не сейчас', 'sheet-close')];
      }
      return ['Перейти на 3 месяца', '<div class="wa-box"><small>ЧТО ИЗМЕНИТСЯ</small><span>' + esc('Сейчас спишем только разницу: ' + money(o.extra) + ' (3 месяца стоят ' + money(o.price) + ', уже оплачено ' + money(o.paid) + '). Подписка станет на 3 месяца с первой оплаты — до ' + longDate(o.end) + '. Дальше — ' + money(o.full) + ' каждые 3 месяца. Отменить можно в любой момент.') + '</span></div>' +
        dark('Доплатить разницу · ' + esc(money(o.extra)), 'sub-upgrade', 'check') + soft('Не сейчас', 'sheet-close')];
    }
    case 'offer': {
      const o = offer(), pl = subPlan(); if (!o || !pl) return null;
      const end = s.moment === 'end', n = name(), done = P.days.filter(d => C.isComplete(d, record(d.day))).length;
      const next = P.chapters.filter(c => c.from > 30 && c.to <= 90).map(c => '«' + c.title + '»').join(', ');
      const title = end ? 'Первый месяц<br><em>почти позади.</em>' : (n ? esc(n) + ', ты уже ' : 'Ты уже ') + (o.day + 1) + ' ' + plural(o.day + 1, 'день|дня|дней') + '<br><em>заботишься о себе.</em>';
      return [title, '<div class="wa-stats"><span><b>' + today() + '</b>день программы</span><span><b>' + done + '</b>' + plural(done, 'день пройден|дня пройдено|дней пройдено') + '</span><span><b>' + o.daysLeft + '</b>' + plural(o.daysLeft, 'день до конца|дня до конца|дней до конца') + '</span></div>' +
        p(end ? 'Ты завершаешь первый месяц. Дальше впереди: ' + next + '. С подпиской на 3 месяца ты пройдёшь это в своём темпе, не думая о продлении каждый месяц.'
          : 'Самое трудное — начать — ты уже сделала. После первого месяца идут главы ' + next + '. С подпиской на 3 месяца всё это впереди — без мыслей о продлении каждый месяц.') +
        '<div class="wa-offer compact"><div class="price"><b>' + esc(money(o.price)) + '</b><s>' + esc(money(o.full)) + '</s><span>3 месяца</span></div>' +
        '<p>' + esc('Доплачиваешь только разницу: ' + money(o.extra) + '. ' + money(o.perDay) + ' в день · экономия ' + money(o.full - o.price) + '.') + '</p>' +
        '<p><strong>' + esc('Только до ' + longDate(o.until) + '.') + '</strong> ' + esc('Потом этой цены не будет: 3 месяца стоят ' + money(o.full) + '.') + '</p></div>' +
        dark('Перейти на 3 месяца', 'sheet', 'arrow-right', ' data-s="upgrade"') + quiet('Не сейчас', 'sheet-close')];
    }
    case 'chapter': {
      const c = P.chapters.find(x => x.id === s.id), b = P.blocks.find(x => x.id === c.block);
      return [esc(c.title), '<span class="wa-eyebrow">ГЛАВА ' + c.id + ' · ДНИ ' + c.from + '–' + c.to + ' · БЛОК ' + esc(c.block) + '</span><p style="color:var(--wa-ink);font-size:17px">' + esc(c.about) + '</p>' +
        '<div class="wa-topics"><span class="wa-eyebrow" style="padding-bottom:6px">ТЕМЫ ГЛАВЫ</span>' + c.topics.slice(0, 7).map((t, i) => '<div><b>' + String(i + 1).padStart(2, '0') + '</b>' + esc(t) + '</div>').join('') + '</div>' +
        (c.topics.length > 7 ? p('и ещё ' + (c.topics.length - 7) + '') : '') +
        (b && b.keeps ? '<div class="wa-stagecan blk-' + b.id + '"><small>ЧТО ОСТАЁТСЯ ПОСЛЕ БЛОКА «' + esc(b.title.toUpperCase()) + '»</small><span style="font-size:18px;font-weight:600">' + esc(b.keeps) + '</span></div>' : '') +
        '<p style="text-align:center;font-style:italic">Откроется в своё время.</p>' + dark('Понятно', 'sheet-close')];
    }
    default: return null;
  }
}
/* Лист, который сейчас на экране: повторная отрисовка того же листа (шаг, пауза, «busy») меняет только содержимое,
   иначе затемнение мигает и лист заново въезжает снизу на каждом нажатии. keep — сохранить прокрутку и не проявлять содержимое. */
let sheetShown = null;
function renderSheet(keep) {
  const box = $('#wa-sheet'); if (!box) return;
  if (!ui.sheet) { sheetShown = null; box.innerHTML = ''; setInert(); return; }
  const out = sheetHTML(ui.sheet); if (!out) { ui.sheet = null; sheetShown = null; box.innerHTML = ''; setInert(); return; }
  const [title, body, night] = out;
  const inner = '<span class="grip" aria-hidden="true"></span>' +
    '<div class="head"><h2 id="wa-sheet-title">' + title + '</h2><button class="wa-circle" data-wa="sheet-close" aria-label="Закрыть">' + ic('x') + '</button></div>' + body;
  const cur = sheetShown === ui.sheet ? box.querySelector('.wa-overlay>.wa-sheet') : null;
  if (cur) {
    const top = cur.scrollTop, shown = keep ? shownCount(cur) : 0;
    cur.className = 'wa-sheet' + (night ? ' night' : '') + (keep ? '' : ' swap');
    cur.innerHTML = inner; settleShown(cur, shown); cur.scrollTop = keep ? top : 0;
  } else {
    box.innerHTML = '<div class="wa-overlay" data-wa="overlay"><section class="wa-sheet' + (night ? ' night' : '') + '" role="dialog" aria-modal="true" aria-labelledby="wa-sheet-title">' + inner + '</section></div>';
    sheetShown = ui.sheet;
  }
  icons(); setInert(); focusFirst(box);
}
function focusFirst(box) {
  const el = box.querySelector('textarea,input,section [data-wa]:not(.wa-circle),section h2'); if (el) { if (el.tagName === 'H2') el.tabIndex = -1; el.focus({ preventScroll: true }); }
}

/* ---------- Bienvenida tras el primer acceso (AppWelcomeView iOS): una vez por dispositivo ---------- */
function welcomeGate(g, fresh) {
  const due = C.welcomeDue({ welcomed: !!S.profile.welcomed, fresh, source: g.source, asked: new URLSearchParams(location.search).get('welcome') === '1' });
  if (due === 'show') ui.welcome = { shown: 0, typing: false, timer: null, focused: false };
  else if (due === 'skip') { S.profile.welcomed = true; persist(); }
}
function welcomeLines() {
  const n = name();
  return [(n ? n + ', мы' : 'Мы') + ' прошли с тобой очень большой онбординг.', 'Ты большая молодец.', 'Дальше всё здесь, в чате. Я буду подсказывать и помогать двигаться — шаг за шагом, в твоём темпе.'];
}
function renderWelcome() {
  const box = document.getElementById('wa-welcome'); if (!box) return;
  const w = ui.welcome; if (!w) { box.innerHTML = ''; setInert(); return; }
  const n = name(), lines = welcomeLines();
  if (still()) { w.shown = lines.length; w.typing = false; }
  box.innerHTML = '<section class="wa-welcome" role="dialog" aria-modal="true" aria-labelledby="wa-welcome-title"><div class="body">' +
    '<img class="heart" src="assets/glass-heart-v6.webp" alt="" aria-hidden="true"><p class="wa-eyebrow">ТЫ УЖЕ В ПРИЛОЖЕНИИ</p>' +
    '<h1 id="wa-welcome-title" tabindex="-1">' + (n ? esc(n) + ',<br>добро пожаловать <em>в mía.</em>' : 'Добро пожаловать <em>в mía.</em>') + '</h1>' +
    '<div class="msgs" aria-live="polite">' + lines.slice(0, w.shown).map((t, i) => '<div class="msg' + (i === 0 ? ' first' : '') + (i === w.shown - 1 && !w.typing ? ' new' : '') + '"><span class="wa-ava' + (i ? ' ghost' : '') + '" aria-hidden="true">m</span><p>' + esc(t) + '</p></div>').join('') +
    (w.typing ? '<div class="msg new"><span class="wa-ava' + (w.shown ? ' ghost' : '') + '" aria-hidden="true">m</span><span class="wa-typing" aria-label="mía печатает"><i></i><i></i><i></i></span></div>' : '') + '</div></div>' +
    '<div class="actions"><button class="wa-primary" data-wa="welcome-start"><span>Давай начнём</span><b>' + ic('arrow-right') + '</b></button><small>Твои ответы и маршрут уже здесь</small></div></section>';
  icons(); setInert();
  if (!w.focused) { w.focused = true; const h = box.querySelector('h1'); if (h) h.focus({ preventScroll: true }); }
  if (w.shown < lines.length && !w.timer) welcomeStep(w);
}
function welcomeStep(w) {
  w.timer = setTimeout(() => {
    if (ui.welcome !== w) return;
    w.typing = true; w.timer = setTimeout(() => { if (ui.welcome !== w) return; w.typing = false; w.shown++; w.timer = null; renderWelcome(); }, 650);
    renderWelcome();
  }, w.shown ? 250 : 350);
}
function finishWelcome() {
  const w = ui.welcome; if (w) clearTimeout(w.timer);
  ui.welcome = null; S.profile.welcomed = true; persist(); renderWelcome(); goHome(); maybeOffer();
}
/* Esquemas: ajuste de las etiquetas al texto real y animación solo cuando el esquema entra en pantalla. */
function figures(scope) {
  const list = scope.querySelectorAll('.wa-fig'); if (!list.length) return;
  const F = figs(); if (F) call(() => F.fit(scope));
  list.forEach(el => {
    if (!el.classList.contains('anim')) return;
    if (!('IntersectionObserver' in window)) { el.classList.add('play'); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { el.classList.add('play'); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
  });
}

/* ---------- Сообщения ---------- */
function toast(text) {
  const el = $('#wa-toast'); if (!el) return;
  clearTimeout(ui.toastTimer); el.className = 'wa-toast'; el.textContent = text;
  ui.toastTimer = setTimeout(() => { el.className = 'wa-sr'; el.textContent = ''; }, 4000);
}
function copyText(text, done) {
  const ok = () => toast(done), fail = () => toast('Не получилось скопировать. Можно выделить текст и скопировать вручную.');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail); else fail();
}

/* ---------- Навигация ---------- */
function selectTab(tab) {
  syncProgram();
  if (tab === 'today') { ui.viewDay = today(); ui.route = 'home'; }
  if (tab === 'route' && ui.tab !== 'route') ui.progress = 'map';
  if (tab === 'account' && ui.tab !== 'account') ui.account = 'main';
  ui.tab = tab; renderMain(); renderPlayer();
  if (tab === 'account' || tab === 'today') refreshGate(true);
}
function goHome() { syncProgram(); ui.viewDay = today(); ui.route = 'home'; ui.tab = 'today'; ui.flow = null; renderFlow(); renderMain(); renderPlayer(); }
/* Пуш ведёт ровно на один экран (docs/pushes.md, PushLink на сервере): ?view=app&go=day|soft|practice|help|saved|progress|portrait|subscription|card|home&n=N.
   Будущий день не открываем — только до сегодняшнего. Параметры из адреса убираем, чтобы перезагрузка не повторяла переход. */
function goLink(search) {
  const q = new URLSearchParams(search || ''), go = q.get('go'); if (!go || mode !== 'app') return;
  call(() => history.replaceState(null, '', location.pathname + '?view=app'), null);
  const n = Math.min(Math.max(parseInt(q.get('n'), 10) || today(), 1), today());
  if (ui.sheet) closeSheet();
  switch (go) {
    case 'day': goHome(); openDay(n); break;
    case 'soft': goHome(); openDay(n); openSheet('pause'); break;
    case 'practice': goHome(); openDay(n); if (!dayDone(n)) openPractice(Math.max(0, C.nextUndone(day(n), record(n), -1))); break;
    case 'help': selectTab('assist'); break;
    case 'saved': selectTab('account'); ui.account = 'library'; renderMain(); break;
    case 'progress': case 'portrait': selectTab('route'); break;
    case 'subscription': selectTab('account'); ui.account = 'subscription'; renderMain(); break;
    case 'card': selectTab('account'); ui.account = 'subscription'; renderMain(); manage(); break;
    default: goHome();
  }
}
function openDay(n) {
  if (!C.canOpen(S, n)) { toast('День ' + n + ' откроется позже. Дни открываются по одному — в твоём темпе.'); return; }
  ui.viewDay = n; ui.route = 'home'; ui.tab = 'today'; renderMain(); renderPlayer();
}
function openLesson(modeName) {
  ui.lessonMode = modeName; ui.route = 'lesson'; ui.tab = 'today';
  renderMain(); renderPlayer();
}

/* ---------- События ---------- */
function onClick(e) {
  const el = e.target.closest('[data-wa]'); if (!el || !root.contains(el)) return;
  const a = el.dataset.wa, f = ui.flow;
  if (a === 'overlay') { if (e.target === el) closeSheet(); return; }
  switch (a) {
    case 'reload': location.reload(); break;
    case 'test-access': S.testAccess = true; persist(); refreshGate(false); break;
    case 'gate-refresh': refreshGate(true); break;
    case 'logout': logout(); break;
    case 'tab': T('tab', { tab: el.dataset.tab }); selectTab(el.dataset.tab); break;
    case 'home': goHome(); break;
    case 'chip': {
      T('chat_answer', { day: ui.viewDay, prompt: el.dataset.prompt, chip: el.dataset.chip });
      const before = { read: wasRead(ui.viewDay), skip: !!record().skip, done: dayDone(ui.viewDay) };
      const res = C.applyChip(record(), el.dataset.prompt, { id: el.dataset.chip, title: el.dataset.title });
      S.records[ui.viewDay] = res.record; persist();
      chipEvents(el.dataset.prompt, el.dataset.chip, ui.viewDay, before);
      if (res.pause) openSheet('pause');
      renderMain(); break;
    }
    case 'article': openLesson(fmt()); break;
    case 'voice': { const d = day(); if (A.day !== d.day) prepare(d); toggleAudio(); chatMark('voice'); renderMain(true); break; }
    case 'practice': openPractice(Number(el.dataset.i)); break;
    case 'checks-save': { const v = $('[data-field=checks]'); if (v && /^\d{1,3}$/.test(v.value)) { update(r => { r.checks = Number(v.value); }); renderMain(); } break; }
    case 'back-home': ui.route = 'home'; renderMain(); renderPlayer(); break;
    case 'lesson-mode': ui.lessonMode = el.dataset.mode === 'audio' ? 'audio' : 'text'; renderMain(true); renderPlayer(); break;
    case 'lesson-play': prepare(day()); toggleAudio(); break;
    case 'lesson-done': { T('lesson_done', { day: ui.viewDay }); const n = ui.viewDay, read = wasRead(n), was = dayDone(n); update(r => { r.lesson = true; }); if (!read) evApp('lesson_read', { day: n }); dayCheck(n, was); } ui.route = 'home'; renderMain(); renderPlayer(); break;
    case 'player-toggle': toggleAudio(); break;
    case 'player-open': if (A.day) { const n = A.day; if (C.canOpen(S, n)) { ui.viewDay = n; openLesson('audio'); } } break;
    case 'player-close': stopAudio(); renderMain(true); break;
    case 'flow-back': if (f.finished || f.index === 0) closeFlow(); else { f.index--; loadDraft(); renderFlow(); } break;
    case 'flow-close': closeFlow(); break;
    case 'opt': {
      if (f.busy) return;
      const st = day().steps[f.index], v = el.dataset.v === 'shared' ? st.shared : st.options[Number(el.dataset.v)];
      f.picked = v;
      if (v === st.custom) { f.draft = [v, f.draft[1] && f.draft[0] === v ? f.draft[1] : '']; renderFlow(true); const t = $('[data-field=draft]'); if (t) t.focus(); return; }
      commit([v], still() ? 150 : 600); break;
    }
    case 'shared-show': f.showShared = true; renderFlow(true); break;
    case 'multi': { const st = day().steps[f.index], v = st.options[Number(el.dataset.v)], k = f.draft.indexOf(v); if (k >= 0) f.draft.splice(k, 1); else f.draft.push(v); renderFlow(true); break; }
    case 'commit-custom': commit([day().steps[f.index].custom, String(f.draft[1] || '').trim()]); break;
    case 'commit-multi': { const st = day().steps[f.index]; commit(st.options.filter(o => f.draft.includes(o))); break; }
    case 'commit-check': commit(['done']); break;
    case 'commit-number': commit([String(f.draft[0] || '')]); break;
    case 'commit-text': commit([String(f.draft[0] || '').trim()]); break;
    case 'commit-lines': commit(f.draft.map(x => String(x || '').trim())); break;
    case 'line-next': { const n = (day().steps[f.index].prompts || []).length; f.line = Math.min(f.line + 1, n - 1); renderFlow(true); const t = $('[data-field=line]'); if (t) t.focus(); break; }
    case 'copy-msg': { const m = C.message(day(), record()); if (m) copyText(m, 'Сообщение скопировано. Отправлять его или нет — решаешь только ты.'); break; }
    case 'copy-human': copyText('Сегодня мне непросто. Можешь немного побыть со мной? Не нужно ничего решать.', 'Фраза скопирована. Отправлять её или нет — решаешь только ты.'); break;
    case 'algorithm': ui.progress = 'algorithm'; renderMain(); break;
    case 'chapter': ui.progress = Number(el.dataset.id); renderMain(); break;
    case 'chapter-sheet': openSheet('chapter', { id: Number(el.dataset.id) }); break;
    case 'map-back': ui.progress = 'map'; renderMain(); break;
    case 'seg-about': ui.progress = 'seg-about'; renderMain(); break;
    case 'seg-block': ui.progress = 'b:' + el.dataset.id; renderMain(); break;
    case 'seg-stage': {
      /* этап раскрывается на месте, без перерисовки страницы; состояние помнится, пока открыта вкладка */
      const box = el.closest('.wa-fold'), on = !box.classList.contains('open'), lab = el.querySelector('.fold-row i');
      ui.segOpen = Object.assign({}, ui.segOpen, { [el.dataset.n]: on });
      box.classList.toggle('open', on); el.setAttribute('aria-expanded', String(on));
      if (lab) lab.textContent = on ? lab.dataset.hide : lab.dataset.show;
      break;
    }
    case 'open-day': openDay(Number(el.dataset.day)); break;
    case 'sheet': openSheet(el.dataset.s); break;
    case 'sheet-close': closeSheet(); break;
    case 'call-open': callOpen(); break;
    case 'call-min': callMin(); break;
    case 'call-end': callSend('hangup'); break;
    case 'urge-why': T('urge_why', { why: el.dataset.v }); urgeStep('feel', { why: el.dataset.v }); break;
    case 'urge-feel': T('urge_feel', { feel: el.dataset.v }); urgeStep('practice', { feel: el.dataset.v }); break;
    case 'urge-practice': T('calm_open', { id: Number(el.dataset.v), from: ui.sheet && ui.sheet.type }); urgeStep('run', { practice: Number(el.dataset.v), left: null }); { const sh = $('.wa-sheet'); if (sh) sh.scrollTop = 0; } break;
    case 'urge-all': urgeStep('practice', { showAll: true }); break;
    case 'urge-back-practice': urgeStep('practice', { left: null }); break;
    case 'urge-after': urgeStep('after'); break;
    case 'calm-ask': T('calm_ask', { pick: el.dataset.v }); urgeStep('practice', { pick: el.dataset.v, showAll: false }); break;
    case 'calm-better': T('calm_result', { result: 'better', from: ui.sheet && ui.sheet.type }); closeSheet(); toast('Хорошо. Сюда можно вернуться в любой момент.'); break;
    case 'calm-help': T('calm_result', { result: 'still_bad', from: ui.sheet && ui.sheet.type }); urgeStep('help'); break;
    case 'calm-to-urge': calmStop(); openSheet('urge', { step: 'chat' }); break;
    case 'calm-toggle': if (ui.sheet && ui.sheet.practice) calmToggle(ui.sheet.practice); break;
    case 'urge-better': T('urge_result', { result: 'better' }); closeSheet(); toast('Ты молодец. Сначала позаботилась о себе.'); break;
    case 'urge-chat': urgeStep('chat'); { const t = $('[data-field=urge-msg]'); if (t) t.focus(); } break;
    case 'urge-review': e.preventDefault(); urgeReview(); break;
    case 'urge-keep': T('urge_result', { result: 'keep' }); S.profile.urgeDraft = { text: ui.sheet.draft, at: new Date().toISOString() }; persist(); closeSheet(); toast('Сохранено в этом браузере. Утром прочитаешь спокойно и решишь.'); break;
    case 'urge-copy': T('urge_result', { result: 'copy' }); copyText(ui.sheet.draft, 'Сообщение скопировано. Отправлять его или нет — решаешь только ты.'); break;
    case 'urge-drop': T('urge_result', { result: 'drop' }); delete S.profile.urgeDraft; persist(); closeSheet(); toast('Ты оставила эти слова здесь. Запись удалена.'); break;
    case 'rescue-next': ui.sheet.i = (ui.sheet.i || 0) + 1; renderSheet(); break;
    case 'rescue-end': closeSheet(); toast('Можно остаться здесь ещё немного. Никуда не нужно спешить.'); break;
    case 'format-pick': S.profile.format = el.dataset.v === 'audio' ? 'audio' : 'text'; persist(); closeSheet(); renderMain(true); toast('Выбор сохранён. Оба формата остаются доступны.'); break;
    case 'welcome-start': finishWelcome(); break;
    case 'name-save': { const v = $('[data-field=name]'); S.profile.name = v ? v.value.trim().slice(0, 30) : ''; persist(); closeSheet(); renderMain(true); toast('Имя сохранено.'); break; }
    case 'library': ui.account = 'library'; renderMain(); evApp('saved_opened'); break;
    case 'library-back': ui.account = 'main'; renderMain(); break;
    case 'phrases': ui.account = 'phrases'; renderMain(); break;
    case 'calls': ui.account = 'calls'; renderMain(); break;
    case 'call-del': callLogSave(callLog().filter(c => c.id !== el.dataset.id)); renderMain(true); break;
    case 'phrases-back': ui.account = 'main'; renderMain(); break;
    case 'docs': ui.account = 'docs'; renderMain(); break;
    case 'docs-back': ui.account = 'main'; renderMain(); break;
    case 'lang-set': { const to = el.dataset.path; if (!to || el.getAttribute('aria-current')) { closeSheet(); break; } T('lang_switch', { to }); location.href = to; break; }
    case 'motion': S.profile.reduceMotion = !S.profile.reduceMotion; persist(); root.classList.toggle('wa-still', still()); renderMain(true); toast(S.profile.reduceMotion ? 'Движение уменьшено.' : 'Плавные переходы включены.'); break;
    case 'manage': manage(); break;
    case 'support': openSupport(); break;
    case 'support-close': closeSupport(); break;
    case 'support-pay': openSupport(); break;
    case 'support-act': closeSupport(); ui.tab = 'account'; ui.account = 'subscription'; renderMain(); renderPlayer(); break;
    case 'sub-open': T('sub_view', {}); ui.account = 'subscription'; renderMain(); break;
    case 'account-back': ui.account = 'main'; renderMain(); break;
    case 'sub-cancel': subCancel('period_end'); break;
    case 'ret-step': if (ui.sheet && ui.sheet.type === 'cancel') { T('sub_retention_decline', { step: el.dataset.step }); ui.sheet.step = el.dataset.step; ui.sheet.error = ''; renderSheet(true); } break;
    case 'ret-take': retentionTake(el.dataset.offer); break;
    case 'sub-refund': subCancel('refund_now'); break;
    case 'sub-resume': subResume(); break;
    case 'canceled-ok': closeSheet(); ui.holdGate = false; refreshGate(false); break;
    case 'manage-cancel': ui.manageAsk = false; ui.manageSent = ''; renderGate(); break;
    case 'sub-upgrade': {
      const pl = subPlan(), o = offer(); if (!pl || !o) { closeSheet(); break; }
      T('upgrade', { from: pl.tariff, extra: o.extra, day: o.day, live: !!o.live });
      if (o.live) { upgradeLive(o); break; }
      /* Как апселл воронки: доплата разницы сразу, 3 месяца от первой оплаты, продление по обычной цене. */
      saveFunnel(x => { x.upsell = { from: x.tariff, extra: o.extra, at: nowDate().toISOString(), source: 'app' }; x.tariff = 'months4'; x.price = o.price; x.renewPrice = o.full; delete x.switchTo; });
      closeSheet(); ui.tab = 'account'; ui.account = 'subscription'; renderMain(); renderPlayer();
      toast('Готово: списано ' + money(o.extra) + '. Подписка на 3 месяца — до ' + longDate(o.end) + '.'); break;
    }
    case 'export': exportData(); break;
    case 'reset': if (session()) resetWithAccount(); else resetLocal(); break;
    case 'delete-account': deleteAccount(); break;
    case 'remind-yes': {
      const m = push(); if (!m) break; call(() => m.markAsked(Number(el.dataset.n) || 1));
      Promise.resolve(call(() => m.enable({ programStart: programStart(), currentDay: today() }), null))
        .then(res => { renderMain(true); toast(res && res.ok ? 'Готово. Завтра утром напишу.' : (res && res.error) || m.MESSAGES.server); }).catch(() => {});
      break;
    }
    case 'remind-later': { const m = push(); if (m) call(() => m.markAsked(Number(el.dataset.n) || 1)); renderMain(true); toast('Хорошо. Если когда-нибудь захочешь — они в «Аккаунте».'); break; }
    case 'remind-notice': { const m = push(); if (m) call(() => m.markOffNotice()); offNoticeNow = false; openSheet('reminders'); break; }
    case 'remind-dnd-clear': if (ui.sheet) { ui.sheet.dnd = ''; renderSheet(true); } break;
    case 'remind-toggle': { const k = el.dataset.k; if (ui.sheet && (k === 'morning' || k === 'evening')) { ui.sheet[k + 'On'] = !ui.sheet[k + 'On']; ui.sheet.error = ''; renderSheet(true); } break; }
    case 'remind-save': reminderSave(); break;
    case 'remind-off': reminderOff(); break;
    case 'test-next': testNextDay(); break;
    case 'install': { const inst = window.MiaInstall; if (!inst) break; if (call(() => inst.available(), false)) Promise.resolve(call(() => inst.prompt('account'), null)).then(() => renderMain(true)).catch(() => {}); else call(() => inst.openGuide('account')); break; }
    case 'install-native': { const inst = window.MiaInstall; closeSheet(); if (inst) Promise.resolve(call(() => inst.prompt('sheet'), null)).then(() => renderMain(true)).catch(() => {}); break; }
    case 'install-copy': { const inst = window.MiaInstall, g = ui.sheet && ui.sheet.g; if (inst && g) Promise.resolve(call(() => inst.copyLink(), false)).then(ok => toast(ok ? g.labels.copied : g.labels.copyFail)).catch(() => toast(g.labels.copyFail)); break; }
  }
}
function onInput(e) {
  const t = e.target, k = t.dataset && t.dataset.field; if (!k) return;
  const f = ui.flow;
  if (k === 'remind-time') { if (ui.sheet && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.value) && t.dataset.k === 'morning') ui.sheet.morning = t.value; return; }
  if (k === 'remind-dnd') { if (ui.sheet) ui.sheet.dnd = /^\d{4}-\d{2}-\d{2}$/.test(t.value) ? t.value : ''; return; }
  if (k === 'urge-msg') { if (ui.sheet && ui.sheet.type === 'urge') { ui.sheet.draft = t.value.slice(0, 1200); const b = $('.wa-sheet [data-wa=urge-review]'); if (b) b.disabled = !ui.sheet.draft.trim(); } return; }
  if (k === 'checks') { t.value = t.value.replace(/\D/g, '').slice(0, 3); const b = $('[data-wa=checks-save]'); if (b) b.disabled = !t.value; return; }
  if (!f) return;
  const st = day().steps[f.index];
  if (k === 'draft') {
    const i = Number(t.dataset.k); while (f.draft.length <= i) f.draft.push(''); f.draft[i] = t.value.slice(0, C.INPUT_LIMIT);
    const c = root.querySelector('[data-counter="' + i + '"]'); if (c) c.textContent = [...f.draft[i].trim()].length + ' / ' + C.INPUT_LIMIT;
    const b = root.querySelector('.wa-flow .wa-act'); if (b) b.disabled = !f.draft[i].trim();
  } else if (k === 'number') {
    t.value = t.value.replace(/\D/g, '').slice(0, 3); f.draft = [t.value];
    const b = root.querySelector('.wa-flow .wa-act'); if (b) b.disabled = !C.stepDone(st, f.draft);
    const n = root.querySelector('[data-today-num]'); if (n) n.textContent = t.value || '?';
  } else if (k === 'line') {
    f.draft[f.line] = t.value.slice(0, 140);
    const b = root.querySelector('.wa-flow .wa-act'); if (b) b.disabled = !C.stepDone(st, f.draft);
    const g = root.querySelector('[data-wa=line-next]'); if (g) g.textContent = t.value.trim() ? 'Дальше' : 'Пропустить';
    const dots = root.querySelectorAll('.wa-dots i'); if (dots[f.line]) dots[f.line].className = 'cur';
  }
}
function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.dataset && e.target.dataset.field === 'support') { e.preventDefault(); supportSend(); return; }
  if (e.key !== 'Escape' || mode !== 'app') return;
  if (CALL.open) callMin(); else if (ui.sheet) closeSheet(); else if (ui.support) closeSupport(); else if (ui.flow) closeFlow();
}
function seekFromRange(e) { const r = e.target; if (r.dataset && r.dataset.audioSeek && A.el && Number(r.dataset.audioSeek) === A.day) { A.el.currentTime = Number(r.value); updateAudioUI(false); } }
document.addEventListener('change', seekFromRange, true);

/* ---------- Подписка и данные ---------- */
function logout() {
  const done = () => { const ac = acct(); if (ac && typeof ac.logout === 'function') call(() => ac.logout()); S.testAccess = false; persist(); C.wipeSync(store); clearTimeout(cloud.timer); stopAudio(true); callReset(); mode = 'loading'; ui.sheet = null; ui.flow = null; apply(evaluate()); };
  const m = push(); if (!m || !session()) { done(); return; }
  Promise.resolve(call(() => m.signOut(), null)).catch(() => {}).then(done);
}
/* ---------- Recordatorios ---------- */
function reminderSave() {
  const s = ui.sheet, m = push(); if (!s || !m || s.busy) return;
  const enabled = call(() => m.prefs().enabled, false);
  if (!s.morningOn && !s.eveningOn && enabled) { reminderOff(); return; }
  s.busy = true; s.error = ''; renderSheet(true);
  Promise.resolve(call(() => m.enable({ morningOn: s.morningOn, morning: s.morning, eveningOn: s.eveningOn, dndUntil: s.dnd || null, programStart: programStart(), currentDay: today() }), null)).then(res => {
    if (ui.sheet !== s) return;
    if (!res || !res.ok) { s.busy = false; s.error = (res && res.error) || m.MESSAGES.server; renderSheet(true); return; }
    closeSheet(); renderMain(true); toast(enabled ? 'Напоминания сохранены.' : 'Напоминания включены. Напомним в выбранное время.');
  }).catch(() => { if (ui.sheet === s) { s.busy = false; s.error = m.MESSAGES.server; renderSheet(true); } });
}
function reminderOff() {
  const s = ui.sheet, m = push(); if (!s || !m) return;
  s.busy = true; renderSheet(true);
  Promise.resolve(call(() => m.disable(), null)).catch(() => {}).then(() => { if (ui.sheet === s) closeSheet(); renderMain(true); toast('Напоминания выключены.'); });
}
/* Live: POST /app/subscription/upgrade с той же датой пересчёта, что в предпросмотре, — Stripe списывает показанную сумму.
   Отказ банка или нужное подтверждение (SCA): ничего не списано, тариф прежний — так и говорим. */
const UPGRADE_ERRORS = {
  payment_failed: 'Банк не принял платёж. Ничего не списано, тариф прежний. Карту можно поменять в «Управлении подпиской».',
  payment_requires_action: 'Банк просит подтвердить этот платёж, а здесь это сделать нельзя. Ничего не списано, тариф прежний. Сменить тариф можно в «Управлении подпиской».',
  upgrade_expired: 'Переход с доплатой разницы был доступен в первый месяц. Сменить тариф можно в «Управлении подпиской».',
  upgrade_not_available: 'Сейчас сменить тариф здесь нельзя. Ничего не списано.',
  apple_subscription: 'Подписка оформлена в App Store: тариф меняется на iPhone — «Настройки → Apple ID → Подписки».'
};
function upgradeLive(o) {
  const a = acct(), sh = ui.sheet; if (!a || typeof a.authorizedFetch !== 'function' || !sh) { closeSheet(); return; }
  sh.busy = true; sh.error = ''; renderSheet(true);
  Promise.resolve(call(() => a.authorizedFetch('/app/subscription/upgrade', { method: 'POST', body: o.prorationDate ? { prorationDate: o.prorationDate } : {} }), null))
    .then(r => {
      if (r && r.ok) {
        liveOffer.state = 'idle'; liveOffer.data = null;
        return Promise.resolve(call(() => a.refresh(), null)).catch(() => null).then(() => {
          closeSheet(); ui.tab = 'account'; ui.account = 'subscription'; renderMain(); renderPlayer();
          toast('Готово: сегодня списано ' + money(o.extra) + '. Подписка на 3 месяца — до ' + longDate(o.end) + '.');
        });
      }
      const code = r && r.body && r.body.error;
      sh.busy = false; sh.error = UPGRADE_ERRORS[code] || 'Не получилось подтвердить переход. Открой «Подписку» через минуту: если там уже «3 месяца» — всё готово. Если нет — ничего не списано.';
      if (ui.sheet === sh) renderSheet(true);
    }, () => { sh.busy = false; sh.error = copy.portalFailed; if (ui.sheet === sh) renderSheet(true); });
}
function manage() {
  const a = acct();
  if (!session() || !a || typeof a.openBillingPortal !== 'function') { closeSheet(); ui.tab = 'account'; ui.account = 'subscription'; renderMain(); return; }
  Promise.resolve(call(() => a.openBillingPortal(), null)).then(res => { if (!res || !res.ok) toast((res && res.error) || copy.portalFailed); }).catch(() => toast(copy.portalFailed));
}
function deleteAccount() {
  const a = acct(); if (!a || typeof a.deleteAccount !== 'function') { toast(copy.deleteFailed); return; }
  ui.sheet.busy = true; renderSheet(true);
  Promise.resolve(call(() => a.deleteAccount(), null)).then(res => {
    if (!res || !res.ok) { if (ui.sheet) { ui.sheet.busy = false; renderSheet(true); } toast((res && res.error) || copy.deleteFailed); return; }
    C.wipe(store); S = C.blankState(); stopAudio(true); ui.sheet = null; ui.flow = null; mode = 'loading';
    apply(evaluate()); toast(copy.accountDeleted);
  }).catch(() => { if (ui.sheet) { ui.sheet.busy = false; renderSheet(true); } toast(copy.deleteFailed); });
}
function resetLocal() {
  const keepTest = S.testAccess; C.wipe(store); S = C.blankState(); S.testAccess = keepTest; persist();
  stopAudio(true); ui.sheet = null; ui.reveal.key = null; syncProgram(false); ui.viewDay = today(); ui.tab = 'today'; ui.route = 'home'; ui.account = 'main';
  renderAll(); toast('Данные удалены. Можно начать заново.');
}
/* С аккаунтом копия на сервере стирается первой: иначе следующая синхронизация вернула бы записи. */
function resetWithAccount() {
  const sh = ui.sheet; if (!sh || sh.busy) return;
  sh.busy = true; renderSheet(true); clearTimeout(cloud.timer);
  cloudFetch('DELETE').then(r => {
    if (r && r.ok) { resetLocal(); return; }
    sh.busy = false; if (ui.sheet === sh) renderSheet(true);
    toast('Не получилось стереть данные в аккаунте. Проверь связь и попробуй ещё раз — ничего не стёрто.');
  });
}
function exportData() {
  try {
    const blob = new Blob([C.exportData(S)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'mia-moi-dannye.json'; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Копия сохранена в загрузках.');
  } catch (e) { toast('Не получилось сохранить копию в этом браузере.'); }
}
function testNextDay() {
  if (!cfg.testTools || !S.program) return;
  const before = today(); S.program.testShiftDays = (S.program.testShiftDays || 0) + 1; persist();
  const moved = syncProgram(false);
  toast(moved ? (today() !== before ? 'Наступило завтра: открыт день ' + today() + '.' : 'Наступило завтра: 30 дней поддержки завершены.') : 'Наступило завтра, но день ' + before + ' остался: в нём ещё не было действий. Так задания не копятся.');
  renderMain(true);
}

window.MiaWebApp = { mount };
if (new URLSearchParams(location.search).get('view') === 'app') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else setTimeout(mount, 0);
}
})();
