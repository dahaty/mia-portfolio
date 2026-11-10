/* mía · аналитика воронки (08.10.2026, просьба владельца: «по всем этапам, на каждом экране и каждом вопросе»).
   Один модуль для лендинга, воронки и веб-приложения: window.MiaAnalytics.track(событие, свойства).
   Своя система, без сторонних сервисов: события пачками уходят на наш сервер (server.cjs /api/events в тесте,
   backend /analytics/events в live), отчёт — вкладка «Квиз» в админке (admin/quiz-core.js).
   Что пишем: id браузера (aid), id сессии (sid, 30 минут тишины — новая), язык (es/ru), страница (landing/funnel/app),
   метки рекламы UTM (первое и последнее касание; сам fbclid в события не идёт), событие и его свойства, p.consent —
   было ли согласие на аналитику в момент события. Первое событие каждой загрузки страницы — visit {ad: пришла из рекламы
   Meta по fbclid, utm_source или referrer}. Чего НЕ пишем: имя, почту, пароль, свободный текст, IP (сервер его не хранит).
   Время на экране считаем здесь же (ms в step_view). MiaConfig.analytics === false — ничего не отправляем.
   Согласие (20.10.2026, режим без cookies: владелец просил считать всех; GDPR ст. 6.1.f, LSSI ст. 22.2 не применяется,
   потому что на устройстве ничего не хранится и не читается):
   - без согласия события всё равно уходят, но aid/sid/UTM живут только в памяти страницы — случайные на каждую загрузку,
     в localStorage/sessionStorage ничего не пишется и не читается (кроме самой записи о выборе mia-consent);
   - «Aceptar» с аналитикой — те же aid/sid/UTM сохраняются (mia-aid, mia-utm, mia-utm-last, mia-sid, mia-sid-t), и
     следующая загрузка продолжает того же человека; повторно ничего не отправляется — события уже ушли;
   - «Rechazar» или аналитика снята — сохранённые id стираются. Выбор хранится 12 месяцев (localStorage mia-consent).
   MiaConfig.analyticsConsent = 'exempt' — окно выбора не показываем, если нет пикселя (id тогда не сохраняются вовсе).
   Пиксель Meta (MiaConfig.metaPixelId) загружается у всех сразу, без согласия (26.10.2026, решение владельца, предупреждён
   о риске CNIL/GDPR): PageView, Lead, InitiateCheckout, Purchase
   (у Purchase event_id = id сессии Stripe, у Lead — id заявки из onboarding.js, его же сервер получает с email_captured;
   оба сервер шлёт и через Conversions API, Meta склеивает дубли).
   MiaAnalytics.meta() — метки клика _fbc/_fbp для оплаты и Lead (сервер добавит IP и браузер), null только без пикселя. */
(function (root) {
  'use strict';
  if (root.MiaAnalytics || typeof root.location === 'undefined') return;
  const store = (() => { try { return root.localStorage; } catch (e) { return null; } })();
  const sess = (() => { try { return root.sessionStorage; } catch (e) { return null; } })();
  const get = (st, k) => { try { return st ? st.getItem(k) : null; } catch (e) { return null; } };
  const set = (st, k, v) => { try { if (st) st.setItem(k, v); } catch (e) { /* приватный режим */ } };
  const del = (st, k) => { try { if (st) st.removeItem(k); } catch (e) { /* приватный режим */ } };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const cfg = () => root.MiaConfig || {};
  const path = root.location.pathname || '/';
  const loc = /^\/ru(\/|$)/.test(path) ? 'ru' : 'es';
  const page = /\/landing\//.test(path) ? 'landing' : (/^\/q\//.test(path) || (root.document && root.document.documentElement && root.document.documentElement.getAttribute('data-page') === 'quiz2')) ? 'quiz2' : /[?&]view=app\b/.test(root.location.search) ? 'app' : 'funnel';

  /* Согласие. */
  const CONSENT_DAYS = 365;
  function consent() {
    const c = (() => { try { return JSON.parse(get(store, 'mia-consent') || 'null'); } catch (e) { return null; } })();
    if (!c || !c.at || Date.now() - Date.parse(c.at) > CONSENT_DAYS * 86400000) return null;
    return c;
  }
  const exempt = () => cfg().analyticsConsent === 'exempt';
  const analyticsOn = () => cfg().analytics !== false;
  const kept = () => !!(consent() && consent().analytics);
  const adsOn = () => /^\d{6,20}$/.test(String(cfg().metaPixelId || ''));

  /* Без согласия на аналитику хранилище не читаем: id и метки — новые на каждую загрузку страницы. */
  const keep = kept();
  const read = k => { try { return JSON.parse(get(store, k) || 'null'); } catch (e) { return null; } };
  const aid = (keep && get(store, 'mia-aid')) || rid();
  let sid = keep ? get(sess, 'mia-sid') : null, seen = keep ? Number(get(sess, 'mia-sid-t')) || 0 : 0;
  if (!sid || Date.now() - seen > 30 * 60000) sid = rid();

  /* Метки рекламы: первое касание хранится (с согласием) навсегда, последнее — перезаписывается. */
  const q = new URLSearchParams(root.location.search), utm = {};
  [['utm_source', 'source'], ['utm_medium', 'medium'], ['utm_campaign', 'campaign'], ['utm_content', 'content'], ['utm_term', 'term'], ['fbclid', 'fbclid']]
    .forEach(([k, n]) => { const v = q.get(k); if (v) utm[n] = String(v).slice(0, n === 'fbclid' ? 400 : 160); });
  let first = keep ? read('mia-utm') : null, last = keep ? read('mia-utm-last') : null;
  if (Object.keys(utm).length) { utm.at = new Date().toISOString(); if (!first) first = utm; last = utm; }
  const ref = (() => { try { const r = root.document && root.document.referrer ? new URL(root.document.referrer) : null; return r && r.host !== root.location.host ? r.host : ''; } catch (e) { return ''; } })();
  const fromAd = !!utm.fbclid || /facebook|instagram|^(fb|ig|meta)$/i.test(utm.source || '') || /(^|\.)(facebook|instagram|fb)\.com$/i.test(ref);

  function persist() {
    set(store, 'mia-aid', aid); set(sess, 'mia-sid', sid); if (seen) set(sess, 'mia-sid-t', String(seen));
    if (first) set(store, 'mia-utm', JSON.stringify(first));
    if (last) set(store, 'mia-utm-last', JSON.stringify(last));
  }
  function forget() { ['mia-aid', 'mia-utm', 'mia-utm-last'].forEach(k => del(store, k)); ['mia-sid', 'mia-sid-t'].forEach(k => del(sess, k)); }
  /* Без согласия стираем то, что прежняя версия успевала записать до выбора. */
  if (keep) persist(); else forget();

  function endpoint() {
    const c = cfg();
    if (typeof c.analyticsUrl === 'string' && /^(https:\/\/|\/)/.test(c.analyticsUrl)) return c.analyticsUrl;
    const base = c.paymentMode === 'live' && typeof c.apiBase === 'string' ? c.apiBase.trim().replace(/\/+$/, '') : '';
    return base ? base + '/analytics/events' : '/api/events';
  }

  /* Для Meta Conversions API при оплате (backend кладёт в metadata Stripe, вебхук шлёт с Purchase). _fbc и _fbp ставит пиксель; если _fbc нет, собираем его из последнего fbclid: fb.1.<время клика в мс>.<fbclid>. */
  function metaIds() {
    if (!adsOn()) return null;
    const ck = n => { try { const m = String((root.document && root.document.cookie) || '').match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } };
    const out = {}, fbp = ck('_fbp'); let fbc = ck('_fbc');
    if (!fbc && last && last.fbclid) fbc = 'fb.1.' + (Date.parse(last.at) || Date.now()) + '.' + last.fbclid;
    if (fbc) out.fbc = fbc.slice(0, 450);
    if (fbp) out.fbp = fbp.slice(0, 64);
    return out;
  }

  let queue = [], timer = null, view = null, seq = 0;
  function send(beacon) {
    clearTimeout(timer); timer = null;
    if (!queue.length || !analyticsOn()) { queue = []; return; }
    const body = JSON.stringify({ events: queue.splice(0, 50) }), url = endpoint();
    try {
      if (beacon && root.navigator && typeof root.navigator.sendBeacon === 'function' && root.navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) { if (queue.length) send(true); return; }
      if (typeof root.fetch === 'function') root.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'omit' }).catch(() => {});
    } catch (e) { /* аналитика не должна мешать */ }
    if (queue.length) send(beacon);
  }
  function track(name, props) {
    if (typeof name !== 'string' || !name) return;
    const now = Date.now(), p = Object.assign({}, props || {});
    if (name === 'step_view') {
      if (view) { p.prev = view.step; p.ms = now - view.t; }
      if (view && view.step === p.step && now - view.t < 1500) return; /* повторный рендер того же экрана */
      view = { step: p.step, t: now };
    }
    seen = now; if (kept()) set(sess, 'mia-sid-t', String(now));
    p.consent = kept();
    const ev = { e: name.slice(0, 40), t: new Date(now).toISOString(), n: ++seq, aid, sid, loc, page, test: cfg().paymentMode !== 'live', p,
      utm: first ? { source: first.source || '', campaign: first.campaign || '', content: first.content || '', medium: first.medium || '' } : null,
      last: last && last !== first ? { campaign: last.campaign || '', content: last.content || '' } : null, ref: seq === 1 ? ref : undefined };
    pixel(name, p); goal(name, p); clarityEvent(name);
    if (!analyticsOn()) return;
    queue.push(ev);
    if (queue.length >= 20) send(false); else if (!timer) timer = setTimeout(() => send(false), 2000);
  }

  /* Пиксель Meta: стандартный код загрузки. */
  let fbqReady = false;
  function loadPixel() {
    if (fbqReady || !adsOn() || !root.document) return;
    fbqReady = true;
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(root, root.document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    /* Без autoConfig пиксель сам шлёт SubscribedButtonClick на каждую кнопку квиза вместе с её текстом. */
    const id = String(cfg().metaPixelId);
    root.fbq('set', 'autoConfig', false, id); root.fbq('init', id); root.fbq('track', 'PageView');
  }
  /* Яндекс Метрика: код счётчика владельца; наши события дублируются целями (reachGoal) для отчётов и вебвизора. */
  const metrikaOn = () => /^\d{6,12}$/.test(String(cfg().metrikaId || ''));
  const GOALS = ['lead', 'checkout_start', 'checkout_view', 'checkout_close', 'checkout_error', 'pay_attempt', 'pay_error', 'purchase'];
  let ymReady = false;
  function loadMetrika() {
    if (ymReady || !metrikaOn() || !root.document) return;
    ymReady = true;
    const id = Number(cfg().metrikaId), src = 'https://mc.yandex.ru/metrika/tag.js?id=' + id;
    /* eslint-disable */
    (function (m, e, t, r, i, k, a) { m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); }; m[i].l = 1 * new Date(); for (var j = 0; j < e.scripts.length; j++) { if (e.scripts[j].src === r) { return; } } k = e.createElement(t), a = e.getElementsByTagName(t)[0], k.async = 1, k.src = r, a.parentNode.insertBefore(k, a); })(root, root.document, 'script', src, 'ym');
    /* eslint-enable */
    root.ym(id, 'init', { ssr: true, webvisor: true, clickmap: true, ecommerce: 'dataLayer', referrer: root.document.referrer, url: root.location.href, accurateTrackBounce: true, trackLinks: true });
  }
  function goal(name, p) {
    if (!metrikaOn() || GOALS.indexOf(name) < 0 || (name === 'purchase' && p.test)) return;
    loadMetrika(); if (typeof root.ym !== 'function') return;
    root.ym(Number(cfg().metrikaId), 'reachGoal', name, p.value ? { order_price: Number(p.value) || 0, currency: 'EUR' } : undefined);
  }
  /* Microsoft Clarity: код проекта владельца; креатив — тегом, события оплаты — событиями (фильтры записей). */
  const clarityOn = () => /^[a-z0-9]{6,20}$/.test(String(cfg().clarityId || ''));
  let clReady = false;
  function loadClarity() {
    if (clReady || !clarityOn() || !root.document) return;
    clReady = true;
    /* eslint-disable */
    (function (c, l, a, r, i, t, y) { c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); }; t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i; y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y); })(root, root.document, 'clarity', 'script', String(cfg().clarityId));
    /* eslint-enable */
    if (first) ['source', 'campaign', 'content'].forEach(k => { if (first[k]) root.clarity('set', 'utm_' + k, String(first[k]).slice(0, 60)); });
    root.clarity('set', 'page', page);
  }
  function clarityEvent(name) {
    if (!clarityOn() || GOALS.indexOf(name) < 0) return;
    loadClarity(); if (typeof root.clarity === 'function') root.clarity('event', name);
  }
  function pixel(name, p) {
    if (!adsOn()) return;
    loadPixel(); const fbq = root.fbq; if (typeof fbq !== 'function') return;
    const money = v => ({ value: Number(v) || 0, currency: 'EUR' });
    if (name === 'lead') fbq('track', 'Lead', {}, p.eid ? { eventID: String(p.eid) } : undefined);
    else if (name === 'checkout_start') fbq('track', 'InitiateCheckout', Object.assign(money(p.value), { content_name: p.kind === 'report' ? 'report' : p.tariff || 'subscription' }));
    else if (name === 'purchase' && !p.test) fbq('track', 'Purchase', Object.assign(money(p.value), { content_name: p.kind === 'report' ? 'report' : p.tariff || 'subscription' }), p.eid ? { eventID: String(p.eid) } : undefined);
    else if (name === 'account_created') fbq('track', 'CompleteRegistration');
  }
  function decide(analytics, ads) {
    set(store, 'mia-consent', JSON.stringify({ analytics: !!analytics, ads: !!ads, at: new Date().toISOString(), v: 1 }));
    if (analytics) persist(); else forget();
    if (ads) { loadPixel(); }
    hideBanner();
  }

  /* Окно выбора cookies: «Aceptar» и «Rechazar» одного веса, «Configurar» — две галочки. */
  let bannerEl = null;
  /* Тексты окна: испанский, русский (/ru/) и французский (квиз /q/, lang=fr) — файл не проходит через словари /ru/. */
  const TXT = loc === 'ru' ? { title: 'Cookies в mía', body: 'Мы анонимно считаем посещения, чтобы понимать, какие шаги сайта работают, и используем пиксель Meta (Facebook, Instagram) для оценки рекламы. Если согласишься, мы ещё запомним твоё устройство между визитами.', accept: 'Принять', reject: 'Отклонить', settings: 'Настроить', save: 'Сохранить выбор', analytics: 'Аналитика mía: помнить твоё устройство между визитами, чтобы видеть, какие экраны смотрят и где уходят. Без имён и почты.', ads: 'Реклама: пиксель Meta (Facebook, Instagram) для оценки объявлений.', more: 'Политика cookies' }
    : typeof document !== 'undefined' && document.documentElement.lang === 'fr' ? { title: 'Cookies sur mía', body: 'Nous comptons les visites de façon anonyme pour savoir quelles étapes du site fonctionnent et utilisons le pixel Meta (Facebook, Instagram) pour mesurer la publicité. Si tu acceptes, nous reconnaissons aussi ton appareil d’une visite à l’autre.', accept: 'Accepter', reject: 'Refuser', settings: 'Paramétrer', save: 'Enregistrer mon choix', analytics: 'Statistiques mía\u00a0: reconnaître ton appareil d’une visite à l’autre pour voir quels écrans sont vus et où l’on abandonne. Sans nom ni e-mail.', ads: 'Publicité\u00a0: pixel Meta (Facebook, Instagram) pour mesurer les annonces.', more: 'Politique de cookies' }
    : { title: 'Cookies en mía', body: 'Contamos las visitas de forma anónima para saber qué pasos de la web funcionan y usamos el píxel de Meta (Facebook, Instagram) para medir la publicidad. Si lo aceptas, además recordamos tu dispositivo entre visitas.', accept: 'Aceptar', reject: 'Rechazar', settings: 'Configurar', save: 'Guardar mi elección', analytics: 'Analítica de mía: recordar tu dispositivo entre visitas para ver qué pantallas se ven y dónde se abandona. Sin nombres ni correos.', ads: 'Publicidad: píxel de Meta (Facebook, Instagram) para medir los anuncios.', more: 'Política de cookies' };
  function hideBanner() { if (bannerEl) { bannerEl.remove(); bannerEl = null; } }
  function showBanner(force) {
    if (!root.document || !root.document.body || bannerEl || (!force && consent()) || cfg().analytics === false) return;
    const c = consent() || { analytics: false, ads: false }, legal = (typeof cfg().legalBase === 'string' && cfg().legalBase) || '/landing/legal/es/';
    const box = root.document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-label', TXT.title);
    /* Сверху и компактно: внизу окно закрывало кнопку «Empezar el test» на телефоне. */
    box.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(8px + env(safe-area-inset-top,0px));z-index:2147483000;max-width:460px;margin:0 auto;padding:12px 12px 10px;border-radius:16px;background:#2D213C;color:#fff;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;box-shadow:0 12px 30px #0005';
    const btn = 'flex:1;min-height:40px;border-radius:12px;border:0;font:600 14px/1 inherit;cursor:pointer;';
    box.innerHTML = '<p style="margin:0 0 10px;color:#E7DAF5"><strong style="color:#fff">' + TXT.title + '.</strong> ' + TXT.body + ' <a href="' + legal + 'cookies.html" target="_blank" rel="noopener" style="color:#DFFF70">' + TXT.more + '</a></p>' +
      '<div data-c-opts hidden style="margin:0 0 10px;display:grid;gap:8px"><label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" data-c="analytics"' + (c.analytics ? ' checked' : '') + ' style="margin-top:3px">' + TXT.analytics + '</label></div>' +
      '<div style="display:flex;gap:8px;align-items:center"><button type="button" data-c-act="settings" style="flex:0 0 auto;padding:0 4px;min-height:40px;background:none;border:0;color:#DDC9EE;font:inherit;text-decoration:underline;cursor:pointer">' + TXT.settings + '</button><button type="button" data-c-act="reject" style="' + btn + 'background:#fff;color:#2D213C">' + TXT.reject + '</button><button type="button" data-c-act="accept" style="' + btn + 'background:#DFFF70;color:#2D213C">' + TXT.accept + '</button></div>';
    box.addEventListener('click', e => {
      const a = e.target && e.target.getAttribute && e.target.getAttribute('data-c-act'); if (!a) return;
      if (a === 'accept') decide(true, true);
      else if (a === 'reject') decide(false, true);
      else if (a === 'settings') { const o = box.querySelector('[data-c-opts]'); o.hidden = false; e.target.setAttribute('data-c-act', 'save'); e.target.textContent = TXT.save; }
      else if (a === 'save') decide(box.querySelector('[data-c="analytics"]').checked, true);
    });
    root.document.body.appendChild(box); bannerEl = box;
  }
  const ua = (root.navigator && root.navigator.userAgent) || '';
  const dev = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && root.navigator.maxTouchPoints > 1) ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop';
  track('visit', { ad: fromAd, dev });
  if (root.document) {
    /* Окно выбора само не показывается (28.10.2026, решение владельца: закрывало экраны воронки, у конкурентов его нет); открывается только по ссылке «настройки cookies» (settings). */
    const boot = () => { if (adsOn()) loadPixel(); loadMetrika(); loadClarity(); };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
    /* Ссылка «Configurar cookies» в подвале: <a data-cookie-settings>. */
    root.document.addEventListener('click', e => { const el = e.target && e.target.closest && e.target.closest('[data-cookie-settings]'); if (el) { e.preventDefault(); showBanner(true); } });
  }
  if (root.addEventListener) {
    root.addEventListener('pagehide', () => send(true));
    if (root.document) root.document.addEventListener('visibilitychange', () => { if (root.document.visibilityState === 'hidden') send(true); });
  }
  root.MiaAnalytics = { track, flush: () => send(true), aid: () => aid, sid: () => sid, utm: () => first, lastUtm: () => last, meta: metaIds, loc, page, consent, settings: () => showBanner(true) };
})(typeof window !== 'undefined' ? window : globalThis);
