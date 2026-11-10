/* mía · аккаунт веб-приложения (/?view=app) для Android и компьютера: вход по почте и паролю, сессия backend/,
   доступ с сайта, портал Stripe, удаление аккаунта. Контракт для интерфейса — window.MiaAccount:
     session()            → {email, name} | null
     access()             → {active, tariff, price, periodEnd, willRenew, source, status, pausedUntil, canPause,
                            canExtendPause, refundableUntil, refundAmount, retention} | null — последний известный доступ;
                            без сети держится до periodEnd + 3 дня (как Account.resolve в iOS), потом active:false
     refresh()            → Promise<access|null>: GET /app/access c Bearer; 401 → POST /auth/refresh и повтор
     login(email, pass)   → Promise<{ok, error?}>: POST /api/login → токены и профиль
     requestManageLink(email) → Promise<{ok, error?}>: POST /api/manage-link (письмо со ссылкой входа, ответ всегда ok)
     redeemManageLink(code)   → Promise<{ok, error?}>: POST /api/manage-link/redeem → сессия, как у login
     logout()             → void
     deleteAccount()      → Promise<{ok, error?}>: DELETE /app/account → сессия и данные mía в браузере стёрты
     openBillingPortal()  → Promise<{ok, error?}>: POST /app/billing-portal {from:'web'} → переход в портал Stripe (только https)
     authorizedFetch(path, {method, body}) → Promise<{ok, status, body, error}>: любой запрос к backend/ с Bearer
                            (обновление токена и повтор на 401); error: null | offline | expired | nosession
     apiUrl(path)         → полный адрес backend/ для запросов без входа (например, /push/public-key)
     onChange(fn)         → fn({reason, message?}); reason: login | access | logout | expired | deleted | sync; возвращает отписку
   Токены живут в localStorage (ключ mia-account-v1) и никуда не пишутся в лог. refresh token одноразовый (сервер его
   меняет при каждом /auth/refresh), поэтому обновление идёт одним запросом на все одновременные вызовы.
   В тестовом режиме (server.cjs без backend/) /api/login отдаёт только профиль: сессия без токенов, доступ — из профиля. */
(function(root){
'use strict';
const KEY='mia-ru-account-v1',GRACE_MS=3*864e5,SKEW_MS=30e3;
const MSG={
 email:'Проверь почту: кажется, адрес написан с ошибкой.',
 password:'Введи пароль от mía.',
 wrong:'Почта или пароль не подходят. Проверь, что это те же, что ты указала на сайте после оплаты.',
 server:'Сервер не ответил. Попробуй ещё раз через минуту.',
 offline:'Нет связи с сервером. Проверь интернет и попробуй ещё раз.',
 expired:'Сеанс завершён. Войди снова по почте и паролю от mía.',
 noSession:'Войди по почте и паролю от mía.',
 apple:'Твоя подписка оформлена в App Store: управлять ею можно на iPhone, в Настройках → Apple ID → Подписки.',
 noBilling:'В этом аккаунте нет оплаты картой, которой можно управлять. Если это ошибка, напиши нам на support@miadays.app.',
 portal:'Сейчас не получается открыть управление подпиской. Попробуй ещё раз через несколько минут.',
 deleteFail:'Сейчас не получилось удалить аккаунт. Попробуй ещё раз через несколько минут.',
 manageLink:'Эта ссылка больше не работает: она живёт 30 минут и срабатывает один раз. Запроси новую на свою почту.',
 testPortal:'В тестовом режиме управлять нечем: подписки нет, деньги не списывались.',
 testDelete:'В тестовом режиме аккаунт не хранится на сервере mía: удалять здесь нечего.'
};
const cfg=()=>root.MiaConfig||{};
const live=()=>cfg().paymentMode==='live';
/* То же правило адреса, что в onboarding.js: пусто или кривое значение — тот же домен. */
function apiBase(){const v=typeof cfg().apiBase==='string'?cfg().apiBase.trim():'';return /^(https?:\/\/[^\s/]+)?(\/[^\s]*)?$/.test(v)?v.replace(/\/+$/,''):'';}
const norm=e=>String(e||'').trim().toLowerCase();
const validEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const now=()=>Date.now();

/* ── Хранилище: localStorage может быть недоступен (приватный режим) — тогда сессия живёт в памяти вкладки. ── */
const store=(()=>{try{const s=root.localStorage;const k='mia-ru-account-probe';s.setItem(k,'1');s.removeItem(k);return s;}catch{return null;}})();
let memory=null;
function load(){if(!store)return memory;try{const v=JSON.parse(store.getItem(KEY)||'null');return v&&typeof v==='object'&&v.email?v:null;}catch{return null;}}
function save(s){memory=s;if(store)try{store.setItem(KEY,JSON.stringify(s));}catch{}}
function clear(){memory=null;if(store)try{store.removeItem(KEY);}catch{}}
/* Удаление аккаунта: стираем всё, что mía хранит в этом браузере (прогресс, ответы, сессию). */
function wipeLocal(){clear();for(const s of [store,(()=>{try{return root.sessionStorage;}catch{return null;}})()]){if(!s)continue;try{const keys=[];for(let i=0;i<s.length;i++){const k=s.key(i);if(/^mia[-_]/.test(k))keys.push(k);}keys.forEach(k=>s.removeItem(k));}catch{}}}

const listeners=new Set();
function notify(reason,message){const ev=message?{reason,message}:{reason};for(const fn of [...listeners])try{fn(ev);}catch{}}

/* ── Сеть ── */
async function call(method,path,body,token){
 if(typeof root.fetch!=='function')return {kind:'offline'};
 const headers={Accept:'application/json'};if(body!==undefined)headers['Content-Type']='application/json';if(token)headers.Authorization='Bearer '+token;
 let r;try{r=await root.fetch(apiBase()+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store'});}catch{return {kind:'offline'};}
 let j=null;try{j=r.status===204?null:await r.json();}catch{}
 return {kind:'http',ok:r.ok,status:r.status,body:j&&typeof j==='object'?j:{}};
}
function tokens(b){return typeof b.accessToken==='string'&&b.accessToken&&typeof b.refreshToken==='string'&&b.refreshToken?{accessToken:b.accessToken,refreshToken:b.refreshToken,ttl:Number(b.accessExpiresIn??b.expiresIn)||0}:null;}
function withTokens(s,t){return {...s,accessToken:t.accessToken,refreshToken:t.refreshToken,accessExpiresAt:t.ttl>0?now()+t.ttl*1000:null};}
function expire(){if(!load())return;clear();notify('expired',MSG.expired);}

let renewing=null;
/* Новый access token по refresh token. Итог: ok | offline | error | expired (сессия закрыта — просим войти снова). */
function renew(){if(renewing)return renewing;renewing=(async()=>{const s=load();if(!s?.refreshToken)return 'expired';
  const r=await call('POST','/auth/refresh',{refreshToken:s.refreshToken});
  if(r.kind==='offline')return 'offline';
  if(r.status===401||r.status===400){expire();return 'expired';}
  const t=r.ok&&tokens(r.body);if(!t)return 'error';
  const cur=load();if(!cur||cur.refreshToken!==s.refreshToken)return cur?'ok':'expired';/* пока ждали, вышла или вошла заново */
  save(withTokens(cur,t));return 'ok';})().finally(()=>{renewing=null;});return renewing;}

/* Запрос с Bearer: просроченный токен обновляем заранее, на 401 — обновляем и повторяем один раз. */
async function authed(method,path,body){
 let s=load();if(!s?.accessToken)return {kind:'nosession'};
 if(s.accessExpiresAt&&now()>=s.accessExpiresAt-SKEW_MS){const t=await renew();if(t!=='ok')return {kind:t};}
 let r=await call(method,path,body,load()?.accessToken);
 if(r.kind==='http'&&r.status===401){const t=await renew();if(t!=='ok')return {kind:t};r=await call(method,path,body,load()?.accessToken);if(r.kind==='http'&&r.status===401){expire();return {kind:'expired'};}}
 return r;
}

/* ── Доступ ── */
/* Сверх доступа (08.10.2026): status active|canceled|past_due|paused|none, пауза и окно возврата первого платежа (14 дней). */
function fromServer(b){const str=v=>typeof v==='string'?v:null;return {active:b.paid===true,tariff:str(b.tariff),price:typeof b.price==='number'?b.price:null,periodEnd:str(b.periodEnd),willRenew:b.willRenew===true,source:str(b.source),
 status:str(b.status)||(b.paid===true?(b.willRenew===true?'active':'canceled'):'none'),pausedUntil:str(b.pausedUntil),canPause:b.canPause===true,canExtendPause:b.canExtendPause===true,refundableUntil:str(b.refundableUntil),refundAmount:typeof b.refundAmount==='number'?b.refundAmount:null,retention:retentionInfo(b.retention)};}
/* Предложения при отмене (тариф «4 недели»): только числа от сервера, иначе null. */
function retentionInfo(r){if(!r||typeof r!=='object')return null;const n=k=>typeof r[k]==='number'&&r[k]>0?r[k]:null,o={renewal:n('renewal'),halfPrice:n('halfPrice'),discountedPrice:n('discountedPrice'),discountedPayments:n('discountedPayments'),freeWeeks:n('freeWeeks')};return Object.values(o).every(v=>v!==null)?o:null;}
function effective(a){if(!a)return null;const out={...a};const end=a.periodEnd?Date.parse(a.periodEnd):NaN;if(out.active&&Number.isFinite(end)&&now()>end+GRACE_MS)out.active=false;return out;}
function session(){const s=load();return s?{email:s.email,name:s.name||''}:null;}
function access(){return effective(load()?.access||null);}

let refreshing=null;
function refresh(){if(refreshing)return refreshing;refreshing=(async()=>{const s=load();if(!s)return null;
  if(!s.accessToken)return access();/* тестовая сессия без сервера: доступ из профиля */
  const r=await authed('GET','/app/access');
  if(r.kind==='expired'||r.kind==='nosession')return null;
  if(r.kind!=='http'||!r.ok)return access();/* нет сети или сервер не ответил — ничего не меняем */
  const cur=load();if(!cur)return null;
  const next=fromServer(r.body),changed=JSON.stringify(next)!==JSON.stringify(cur.access||null);
  save({...cur,access:next,checkedAt:new Date(now()).toISOString()});if(changed)notify('access');return access();})().finally(()=>{refreshing=null;});return refreshing;}

async function login(email,password){
 email=norm(email);if(!validEmail(email))return {ok:false,error:MSG.email};if(!password)return {ok:false,error:MSG.password};
 const r=await call('POST','/api/login',{email,password});
 if(r.kind==='offline')return {ok:false,error:MSG.offline};
 if(r.status===401)return {ok:false,error:MSG.wrong};
 return start(r,email);
}
/* Ответ входа (пароль или ссылка «Gestionar suscripción») → сессия. */
async function start(r,email){
 const p=r.body.profile;if(!r.ok||r.body.ok===false||!p||typeof p!=='object')return {ok:false,error:typeof r.body.error==='string'&&r.body.error?r.body.error:MSG.server};
 const t=tokens(r.body);if(!t&&live())return {ok:false,error:MSG.server};
 const prev=load();if(prev?.accessToken&&prev.email!==norm(p.email||email))call('POST','/auth/logout',undefined,prev.accessToken).catch(()=>{});
 const base={v:1,email:norm(p.email||email),name:typeof p.name==='string'?p.name:'',access:{active:p.paid===true,tariff:p.tariff??null,price:typeof p.price==='number'?p.price:null,periodEnd:null,willRenew:false,source:t?null:'test'},checkedAt:new Date(now()).toISOString()};
 save(t?withTokens(base,t):base);
 if(t)await refresh();
 notify('login');return {ok:true};
}

/* «Gestionar suscripción» из письма: почта → одноразовая ссылка (30 минут) → вход без пароля.
   requestManageLink всегда отвечает одинаково (по ответу не узнать, есть ли аккаунт). */
async function requestManageLink(email){
 email=norm(email);if(!validEmail(email))return {ok:false,error:MSG.email};
 const r=await call('POST','/api/manage-link',{email});
 if(r.kind==='offline')return {ok:false,error:MSG.offline};
 return {ok:true};
}
async function redeemManageLink(code){
 if(typeof code!=='string'||code.length<20)return {ok:false,error:MSG.manageLink};
 const r=await call('POST','/api/manage-link/redeem',{code});
 if(r.kind==='offline')return {ok:false,error:MSG.offline};
 if(!r.ok)return {ok:false,error:typeof r.body.error==='string'&&r.body.error?r.body.error:MSG.manageLink};
 return start(r,'');
}

function logout(){const s=load();if(!s)return;clear();if(s.accessToken)call('POST','/auth/logout',undefined,s.accessToken).catch(()=>{});notify('logout');}

async function deleteAccount(){
 const s=load();if(!s)return {ok:false,error:MSG.noSession};
 if(!s.accessToken)return {ok:false,error:live()?MSG.noSession:MSG.testDelete};
 const r=await authed('DELETE','/app/account');
 if(r.kind==='offline')return {ok:false,error:MSG.offline};
 if(r.kind==='expired'||r.kind==='nosession')return {ok:false,error:MSG.expired};
 if(r.kind!=='http'||!r.ok)return {ok:false,error:MSG.deleteFail};
 wipeLocal();notify('deleted');return {ok:true};
}

async function openBillingPortal(){
 const s=load();if(!s)return {ok:false,error:MSG.noSession};
 if(!s.accessToken)return {ok:false,error:live()?MSG.noSession:MSG.testPortal};
 const r=await authed('POST','/app/billing-portal',{from:'web'});
 if(r.kind==='offline')return {ok:false,error:MSG.offline};
 if(r.kind==='expired'||r.kind==='nosession')return {ok:false,error:MSG.expired};
 if(r.kind!=='http')return {ok:false,error:MSG.portal};
 if(r.ok&&typeof r.body.url==='string'&&/^https:\/\/\S+$/.test(r.body.url)){root.location.assign(r.body.url);return {ok:true};}
 if(r.body.error==='apple_subscription')return {ok:false,error:MSG.apple};
 if(r.body.error==='no_billing_account')return {ok:false,error:MSG.noBilling};
 return {ok:false,error:MSG.portal};
}

/* Запрос к backend/ от имени вошедшей: Bearer, обновление токена и повтор на 401 — как у refresh().
   Итог: {ok, status, body, error} — error: null | offline | expired | nosession. */
async function authorizedFetch(path,init){
 const o=init||{},method=String(o.method||'GET').toUpperCase();
 if(typeof path!=='string'||!path.startsWith('/'))return {ok:false,status:0,body:{},error:'nosession'};
 const s=load();if(!s?.accessToken)return {ok:false,status:0,body:{},error:'nosession'};
 const r=await authed(method,path,o.body);
 if(r.kind!=='http')return {ok:false,status:0,body:{},error:r.kind==='offline'?'offline':r.kind==='nosession'?'nosession':'expired'};
 return {ok:r.ok,status:r.status,body:r.body,error:null};
}
const apiUrl=path=>apiBase()+path;

function onChange(fn){if(typeof fn!=='function')return ()=>{};listeners.add(fn);return ()=>listeners.delete(fn);}

/* Вход или выход в другой вкладке. */
try{root.addEventListener?.('storage',e=>{if(e.key===KEY)notify('sync');});}catch{}

root.MiaAccount=Object.freeze({session,access,refresh,login,requestManageLink,redeemManageLink,logout,deleteAccount,openBillingPortal,authorizedFetch,apiUrl,onChange});
})(typeof window!=='undefined'?window:globalThis);
