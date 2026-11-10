/* Главная miadays.app/ — квиз (28.10.2026, решение владельца: квиз без /q/ в адресе). Vercel отдаёт на «/» страницу квиза
   (vercel-site.json, rewrites); прежняя страница корня живёт по /index.html. Это правило решает, кому какая:
   'app' — служебная ссылка (возврат из Stripe, ссылки из писем), установленное приложение, вход в аккаунт или оплаченный доступ;
   остальным — 'quiz' (испанской воронки для новых людей нет с 01.11.2026). Подключается первым и в корне, и в квизе. */
window.MiaRoute = function () {
  try {
    var p = new URLSearchParams(location.search);
    // Кнопка старого испанского лендинга (/landing/ → ?view=onboarding) и старые ссылки на воронку — тоже квиз (02.11.2026).
    if (p.get('view') === 'onboarding' && !p.has('checkout') && !p.has('session_id')) return 'quiz';
    // Служебные ссылки прежней страницы: возврат из Stripe, письма (вход в приложение, пароль, подписка), разбор.
    var svc = ['view', 'checkout', 'session_id', 'report', 'forgot', 'reset', 'manage'].some(function (k) { return p.has(k); });
    if (svc) return 'app';
    // Ссылка из письма с предложением (?promo=) — всегда квиз с ценами предложения.
    if (p.has('promo')) return 'quiz';
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) return 'app';
    var ls = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
    if (ls('mia-account-v1')) return 'app';
    var x = null;
    try { x = JSON.parse(ls('mia-app-v1') || 'null'); } catch (e) { x = null; }
    var q = x && x.onboarding && x.onboarding.quiz;
    if (x && x.access && x.access.active) return 'app';
    if (q && q.source === 'q2' && q.step === 'success') return 'app';
    // Прежней испанской воронки для новых людей больше нет: незнакомые параметры, начатая и брошенная оплата — квиз.
    return 'quiz';
  } catch (e) { return 'quiz'; }
};
/* Язык приложения (02.11.2026): покупательницы квиза /q/ (он на французском) получают французское приложение /fr/,
   остальные — испанское в корне. ?lang=fr|es выбирает вручную и запоминается. Признаки квиза — как у писем (MailLocale):
   тариф квиза weeks4/12/24 или пройденный квиз (mia-q2-v1, source q2). */
window.MiaLang = function () {
  try {
    var ls = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
    var p = new URLSearchParams(location.search).get('lang');
    if (p === 'fr' || p === 'es') { try { localStorage.setItem('mia-lang', p); } catch (e) { /* приватный режим */ } return p; }
    var s = ls('mia-lang');
    if (s === 'fr' || s === 'es') return s;
    if (ls('mia-q2-v1')) return 'fr';
    var x = JSON.parse(ls('mia-app-v1') || 'null'), q = x && x.onboarding && x.onboarding.quiz, quizPlan = /^weeks(4|12|24)$/;
    if (q && (q.source === 'q2' || quizPlan.test(q.tariff || ''))) return 'fr';
    if (x && x.access && quizPlan.test(x.access.tariff || '')) return 'fr';
  } catch (e) { /* по умолчанию испанский */ }
  return 'es';
};
