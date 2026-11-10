/* mía · события для писем жизненного цикла (сервер backend/ решает, какое письмо и когда отправить).
   Контракт — window.MiaEvents:
     track(name, props, lead) — событие воронки сайта → POST {apiBase}/api/events; тело — JSON, отправка через
                                navigator.sendBeacon с типом text/plain (без CORS-предзапроса), запасной путь — fetch keepalive
     app(name, props)         — событие веб-приложения (/?view=app) → POST {apiBase}/app/events с Bearer, fetch keepalive
                                lead — только у email_captured: {id, ads, fbc, fbp}; id тот же, что eventID у Lead в пикселе,
                                сервер шлёт Lead в Meta Conversions API лишь при ads: true (метки клика без согласия не уходят)
     identify({email, name})  — почта и имя для следующих пачек сайта (localStorage mia-events-v1)
     funnelId()               — случайный id воронки (localStorage mia-funnel-id)
     flush()                  — отправить очередь сейчас (сама зовётся через ~800 мс, на pagehide и при скрытии вкладки)
     log                      — последние 200 принятых событий в любом режиме (для проверок)
   Сеть — только при paymentMode=live: в test и в демо /ru/ сервера нет, ничего не отправляется. Всё в try/catch:
   интерфейс ничего не ждёт и не ломается. Имена и значения — только из списка сервера (остальное он отклоняет), поэтому
   незнакомое событие не отправляется. report_paid, report_payment_failed, subscription_started, payment_failed пишет
   сервер из вебхуков Stripe, клиент их не шлёт. */
(function (root) {
'use strict';
const FUNNEL_KEY = 'mia-funnel-id', WHO_KEY = 'mia-events-v1', ACCOUNT_KEY = 'mia-account-v1';
const FLUSH_MS = 800, MAX_BATCH = 20, LOG_CAP = 200;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Правила свойств: ключ → проверка значения. Другие ключи не отправляются. */
const int = (lo, hi) => v => Number.isInteger(v) && v >= lo && v <= hi;
const oneOf = list => v => list.includes(v);
const word = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const TARIFF = oneOf(['week', 'month', 'months4', 'weeks4', 'weeks12', 'weeks24']), DAY = { day: int(1, 400) };
const SITE = {
  quiz_started: {}, quiz_step: { step: int(1, 20) }, quiz_completed: {}, email_captured: { src: v => v === undefined || v === 'q2', mail: v => v === undefined || v === 'yes' || v === 'no' }, tripwire_viewed: {},
  report_checkout_started: {}, report_opened: {},
  report_screen: { screen: oneOf(['facts', 'result', 'map', 'tech', 'plan', 'timeline', 'ifwrites', 'method', 'companion']) },
  tech_tried: { tech: word }, paywall_viewed: {}, tariff_selected: { tariff: TARIFF }, checkout_started: { tariff: TARIFF },
  upsell_shown: {}, upsell_accepted: {}, password_created: {}
};
const APP = {
  login_succeeded: {}, app_opened: {}, day_opened: DAY, lesson_read: DAY, practice_done: DAY, day_completed: DAY, cant_today: DAY,
  mood: { value: oneOf(['hard', 'holding', 'unsure']) }, outcome: { value: oneOf(['better', 'same', 'worse']) },
  help_opened: { kind: oneOf(['urge', 'rescue', 'night']) }, saved_opened: {}
};

/* Глобальные объекты: в браузере root === window, в проверках (node:vm) часть из них лежит в самом контексте. */
const g = k => { try { if (root && root[k] !== undefined) return root[k]; return typeof globalThis !== 'undefined' ? globalThis[k] : undefined; } catch (e) { return undefined; } };
const cfg = () => g('MiaConfig') || {};
const live = () => cfg().paymentMode === 'live';
/* То же правило адреса, что в account.js: пусто или кривое значение — тот же домен. */
function apiBase() { const v = typeof cfg().apiBase === 'string' ? cfg().apiBase.trim() : ''; return /^(https?:\/\/[^\s/]+)?(\/[^\s]*)?$/.test(v) ? v.replace(/\/+$/, '') : ''; }

/* ── Хранилище: без localStorage (приватный режим) — в памяти вкладки. ── */
const memory = {};
function getItem(k) { try { const s = g('localStorage'); if (s) { const v = s.getItem(k); if (v !== null && v !== undefined) return String(v); } } catch (e) { /* нет доступа */ } return memory[k] === undefined ? null : memory[k]; }
function setItem(k, v) { memory[k] = v; try { const s = g('localStorage'); if (s) s.setItem(k, v); } catch (e) { /* нет доступа */ } }
function readJSON(k) { try { const v = JSON.parse(getItem(k) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }

function newId() {
  const c = g('crypto');
  try { if (c && typeof c.randomUUID === 'function') { const u = String(c.randomUUID()); if (ID_RE.test(u)) return u; } } catch (e) { /* старый браузер */ }
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let bytes = null; try { if (c && typeof c.getRandomValues === 'function') bytes = c.getRandomValues(new Uint8Array(24)); } catch (e) { bytes = null; }
  let s = ''; for (let i = 0; i < 24; i++) s += abc[(bytes ? bytes[i] : Math.floor(Math.random() * 256)) % abc.length];
  return s;
}
function funnelId() { const v = getItem(FUNNEL_KEY); if (v && ID_RE.test(v)) return v; const id = newId(); setItem(FUNNEL_KEY, id); return id; }

function identify(o) {
  try {
    const cur = readJSON(WHO_KEY), next = { email: typeof cur.email === 'string' ? cur.email : '', name: typeof cur.name === 'string' ? cur.name : '' };
    const email = String((o && o.email) || '').trim().toLowerCase();
    if (email && email.length <= 254 && EMAIL_RE.test(email) && email !== next.email) { next.email = email; next.name = ''; }
    const name = o && typeof o.name === 'string' ? o.name.trim().slice(0, 64) : '';
    if (name) next.name = name;
    if (next.email !== cur.email || next.name !== (cur.name || '')) setItem(WHO_KEY, JSON.stringify(next));
    return !!next.email;
  } catch (e) { return false; }
}

/* Как device() в onboarding.js: iPhone и iPad, включая iPadOS с «настольным» UA и касанием, — ios. */
function platform() { const n = g('navigator') || {}, ua = String(n.userAgent || ''); if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && Number(n.maxTouchPoints) > 1)) return 'ios'; return /Android/i.test(ua) ? 'android' : 'desktop'; }
function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }

function clean(rules, props) {
  const src = props && typeof props === 'object' && !Array.isArray(props) ? props : {}, out = {};
  for (const k of Object.keys(rules)) { if (!rules[k](src[k])) return null; out[k] = src[k]; }
  return out;
}

/* ── Очередь и отправка ── */
const log = [], queues = { site: [], app: [] };
let timer = null;
function remember(kind, ev) { log.push(Object.assign({ kind, name: ev.name, props: ev.props, at: ev.at }, ev.lead ? { lead: ev.lead } : {})); if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP); }
function leadMeta(l) {
  if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !ID_RE.test(l.id)) return null;
  const out = { id: l.id, ads: l.ads === true };
  if (out.ads) for (const [k, max] of [['fbc', 450], ['fbp', 64]]) if (typeof l[k] === 'string' && l[k] && l[k].length <= max) out[k] = l[k];
  return out;
}
function add(kind, rules, name, props, lead) {
  try {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(rules, name)) return false;
    const p = clean(rules[name], props); if (!p) return false;
    const ev = { name, props: p, at: new Date().toISOString() };
    const l = kind === 'site' && name === 'email_captured' ? leadMeta(lead) : null;
    if (l) ev.lead = l;
    remember(kind, ev);
    if (!live()) return true;
    queues[kind].push(ev); schedule(); return true;
  } catch (e) { return false; }
}
function schedule() {
  if (timer !== null) return;
  try { const st = g('setTimeout'); if (typeof st === 'function') timer = st.call(root, () => { timer = null; flush(); }, FLUSH_MS); } catch (e) { timer = null; }
}
function post(url, body, headers) {
  try {
    const f = g('fetch'); if (typeof f !== 'function') return;
    const p = f.call(root, url, { method: 'POST', keepalive: true, headers, body, credentials: 'omit' });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* сеть недоступна */ }
}
function sendSite(events) {
  const who = readJSON(WHO_KEY), body = { funnelId: funnelId() };
  if (typeof who.email === 'string' && EMAIL_RE.test(who.email)) body.email = who.email;
  if (typeof who.name === 'string' && who.name) body.name = who.name;
  body.tz = tz(); body.platform = platform(); body.events = events;
  const json = JSON.stringify(body), url = apiBase() + '/api/events';
  try {
    const nav = g('navigator');
    if (nav && typeof nav.sendBeacon === 'function') {
      const B = g('Blob'), data = typeof B === 'function' ? new B([json], { type: 'text/plain;charset=UTF-8' }) : json;
      if (nav.sendBeacon(url, data)) return;
    }
  } catch (e) { /* sendBeacon отказал — ниже fetch */ }
  post(url, json, { 'Content-Type': 'text/plain;charset=UTF-8' });
}
/* Токен — тот же, что хранит account.js. 401 и другие ответы не разбираем: событие просто теряется. */
function accessToken() { const s = readJSON(ACCOUNT_KEY); return typeof s.accessToken === 'string' && s.accessToken ? s.accessToken : ''; }
function sendApp(events, token) {
  post(apiBase() + '/app/events', JSON.stringify({ tz: tz(), platform: platform(), events }), { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token });
}
function flush() {
  try {
    if (timer !== null) { try { const ct = g('clearTimeout'); if (typeof ct === 'function') ct.call(root, timer); } catch (e) { /* таймер уже сработал */ } timer = null; }
    if (!live()) { queues.site.length = 0; queues.app.length = 0; return; }
    while (queues.site.length) sendSite(queues.site.splice(0, MAX_BATCH));
    if (queues.app.length) { const t = accessToken(); if (!t) queues.app.length = 0; while (queues.app.length) sendApp(queues.app.splice(0, MAX_BATCH), t); }
  } catch (e) { queues.site.length = 0; queues.app.length = 0; }
}

/* Уход со страницы: отправляем сразу, таймер может не успеть. */
try {
  const on = g('addEventListener'); if (typeof on === 'function') on.call(root, 'pagehide', flush);
  const doc = g('document');
  if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') flush(); });
} catch (e) { /* без подписки — останется таймер */ }

root.MiaEvents = Object.freeze({
  track: (name, props, lead) => add('site', SITE, name, props, lead),
  app: (name, props) => add('app', APP, name, props),
  identify, flush, funnelId, platform, newId, log
});
})(typeof window !== 'undefined' ? window : globalThis);
