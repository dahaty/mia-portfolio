/* mía · ядро приложения: конфигурация, долговременное хранилище и ход программы.
   Чистые функции без DOM — проверяются в scripts/check-app.cjs. */
(() => {
'use strict';
const defaults={paymentMode:'test',priceWeek:9.99,priceMonth:29.99,priceMonths4:59.99,priceReport:0.99,priceReportFull:6.99,currency:'EUR',testTools:true,appVersion:'0.1.0'};
function config(){
 const raw=(typeof window!=='undefined'&&window.MiaConfig)||{},c={...defaults};
 if(raw.paymentMode==='test'||raw.paymentMode==='live')c.paymentMode=raw.paymentMode;
 for(const k of ['priceWeek','priceMonth','priceMonths4','priceReport','priceReportFull']){const n=Number(raw[k]);if(Number.isFinite(n)&&n>0)c[k]=n;}
 if(typeof raw.testTools==='boolean')c.testTools=raw.testTools;
 if(typeof raw.appVersion==='string'&&raw.appVersion)c.appVersion=raw.appVersion;
 return c;
}
function money(n){return Number(n).toFixed(2).replace('.',',')+' €';}

/* ---------- Хранилище ---------- */
const storageKey='mia-ru-app-v1',legacyKey='mia-ru-journey-v2',schema=1;
function blank(){return {schema,records:{},items:[]};}
function validState(x){return !!x&&typeof x==='object'&&!!x.records&&typeof x.records==='object'&&!Array.isArray(x.records)&&Array.isArray(x.items);}
function parse(text){try{const x=JSON.parse(text);return validState(x)?x:null;}catch{return null;}}
function read(storage,key){try{return storage?storage.getItem(key):null;}catch{return null;}}
/* Загружает состояние. Если на устройстве ещё ничего нет, один раз переносит данные вкладки прототипа. */
function load(local,session){
 const own=parse(read(local,storageKey));
 if(own){own.schema=schema;return {state:own,migrated:false};}
 const old=parse(read(session,legacyKey));
 if(old){old.schema=schema;return {state:old,migrated:true};}
 return {state:blank(),migrated:false};
}
function save(local,state){try{local.setItem(storageKey,JSON.stringify(state));return true;}catch{return false;}}
function wipe(local,session){try{local?.removeItem(storageKey);}catch{}try{session?.removeItem(legacyKey);}catch{}}

/* ---------- Ход программы ----------
   Новый день открывается, когда наступила новая календарная дата И в текущем дне было хоть какое-то
   действие (практика, отдых, чтение или вечерняя отметка). Пропущенные дни не копятся и не теряются. */
const totalDays=30,dayMs=86400000;
function dateKey(date){const n=new Date(date);return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;}
function now(state,base=Date.now()){const shift=Number(state?.program?.testShiftDays)||0;return base+shift*dayMs;}
function touched(r){return !!(r&&(r.practice||r.skip||r.lesson||r.evening));}
function ensureProgram(state,at=Date.now()){
 const p=state.program;
 if(p&&p.version===1&&Number.isInteger(p.currentDay)&&p.currentDay>=1&&p.currentDay<=totalDays&&p.opened&&typeof p.opened==='object')return p;
 /* Если записи уже есть (перенос из прототипа), продолжаем с последнего затронутого дня. */
 const used=Object.keys(state.records||{}).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=totalDays&&touched(state.records[n]));
 const current=used.length?Math.max(...used):1;
 state.program={version:1,startedAt:new Date(at).toISOString(),currentDay:current,opened:{[current]:dateKey(at)},testShiftDays:Number(p?.testShiftDays)||0};
 return state.program;
}
/* Возвращает true, если открылся следующий день. За один вызов — не больше одного дня. */
function advance(state,at=Date.now()){
 const p=state.program;if(!p)return false;
 const today=dateKey(at),cur=p.currentDay,openedOn=p.opened[cur]||today;
 if(!p.opened[cur])p.opened[cur]=today;
 if(!touched(state.records?.[cur])||today<=openedOn)return false;
 if(cur>=totalDays){if(p.supportDone)return false;p.supportDone=true;return true;}
 p.currentDay=cur+1;p.opened[cur+1]=today;return true;
}
function currentDay(state){const n=state?.program?.currentDay;return Number.isInteger(n)&&n>=1&&n<=totalDays?n:1;}
function canOpen(state,n){return Number.isInteger(n)&&n>=1&&n<=currentDay(state);}

/* ---------- Аудио ---------- */
function audioName(sourceDay){return 'day-'+String(sourceDay).padStart(2,'0');}
function audioFile(manifest,sourceDay){
 const files=Array.isArray(manifest?.files)?manifest.files:[],name=audioName(sourceDay);
 const hit=files.find(f=>typeof f==='string'&&/^[\w.-]+$/.test(f)&&f.replace(/\.[^.]+$/,'')===name&&/\.(mp3|m4a|aac|ogg|wav)$/i.test(f));
 return hit?'audio/'+hit:null;
}
function clock(seconds){const s=Math.max(0,Math.floor(Number(seconds)||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}

const api={config,money,storageKey,legacyKey,blank,load,save,wipe,dateKey,now,touched,ensureProgram,advance,currentDay,canOpen,totalDays,audioName,audioFile,clock};
if(typeof window!=='undefined')window.MiaCore=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
