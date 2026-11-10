/* Мост окна звонка с приложением (03.11.2026). В приложении экран звонка открыт в iframe листа «Позвонить»
   (webapp.js → «Звонок Мии»); лист можно свернуть — разговор продолжается, приложение показывает время звонка.
   app.js — макет владельца как есть; здесь только встраивание:
   - в шапке экрана вместо логотипа кнопка «Свернуть», Escape тоже сворачивает;
   - под звонком одна кнопка «Завершить» — «Микрофон» и «Текст» скрыты в style.css (владелец, 04.11.2026);
   - «Разговор завершён» — небольшое окно (владелец, 04.11.2026): без «Позвонить ещё» и «На главный экран», высоту
     содержимого сообщаем наружу (ev:'size', h), закрыть — крестик, нажатие мимо или смахнуть вниз (ev:'drag', dy, done);
   - «На главный экран» и крестик после разговора закрывают лист;
   - итог разговора (тема, длительность, реплики Мии) уходит в приложение и хранится во вкладке «Анализ диалога»
     («Аккаунт»); на экране «Разговор завершён» вместо заметки «Можно сделать паузу» — одна карточка, которая туда ведёт (владелец, 04.11.2026);
   - наружу: {mia:'call', ev:'state', state, time} при смене состояния и каждой секунды; ev:'minimize'; ev:'close';
     ev:'summary' {time, topic, lines} — разговор завершён; ev:'analysis' — открыть «Анализ диалога»;
   - внутрь: {mia:'call', cmd:'start'|'hangup'}. ?start=1 — звонить сразу после загрузки.
   Открытый сам по себе (не в iframe) экран работает как раньше. */
(()=>{'use strict';
if(window.parent===window)return;
const $=s=>document.querySelector(s),app=$('#app'),origin=location.origin;
const send=(ev,extra)=>window.parent.postMessage(Object.assign({mia:'call',ev},extra||{}),origin);
const live=()=>['ringing','speaking','listening'].includes(app.dataset.state);
document.documentElement.classList.add('embedded');

document.querySelectorAll('#ready .top,#calling .top').forEach(top=>top.insertAdjacentHTML('afterbegin','<button class="embed-min" type="button" aria-label="Свернуть"><svg><use href="#chevron"/></svg></button>'));
document.addEventListener('click',e=>{if(e.target.closest('.embed-min'))send('minimize')});
['#home','#close-end'].forEach(s=>$(s).addEventListener('click',()=>send('close')));
$('#finished .duration').insertAdjacentHTML('afterend','<button class="saved-note" id="to-analysis" type="button"><svg><use href="#text"/></svg><span>Анализ разговора сохранён во вкладке <b>«Анализ диалога»</b></span><svg class="chev"><use href="#chevron"/></svg></button>');
$('#to-analysis').addEventListener('click',()=>send('analysis'));
const fin=$('#finished'),size=()=>{if(!fin.hidden)send('size',{h:Math.ceil($('#finished .top').offsetHeight+$('#finished .end-content').offsetHeight)})};
new ResizeObserver(size).observe($('#finished .end-content'));
/* Смахнуть окно вниз: координаты экрана — iframe едет вместе с листом, свои координаты у него сдвигаются. */
let y0=null,dy=0;
fin.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;y0=e.screenY;dy=0;fin.setPointerCapture(e.pointerId)});
fin.addEventListener('pointermove',e=>{if(y0===null)return;dy=Math.max(0,e.screenY-y0);send('drag',{dy})});
const drop=()=>{if(y0===null)return;y0=null;send('drag',{dy,done:true})};
fin.addEventListener('pointerup',drop);fin.addEventListener('pointercancel',drop);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#sheet-host').hidden){e.preventDefault();send(live()?'minimize':'close')}});

/* Реплики Мии за разговор — подписи под персонажем, пока говорит она (метка «МИА»). */
let last='',was='ready',lines=[];
function listen(){if($('#caption-label').textContent==='МИА'){const t=$('#caption').textContent.trim();if(t&&lines.at(-1)!==t)lines.push(t)}}
new MutationObserver(listen).observe($('#caption'),{childList:true,characterData:true,subtree:true});
function report(){const state=app.dataset.state,time=$('#timer').textContent,key=state+'|'+time;
 if(state==='ringing'&&was!=='ringing')lines=[];
 if(state==='ended'&&was!=='ended')send('summary',{time,topic:$('#topic-name').textContent.trim(),lines:lines.slice()});
 if(state==='ended'&&was!=='ended')requestAnimationFrame(size);
 was=state;if(key===last)return;last=key;send('state',{state,time})}
new MutationObserver(report).observe(app,{attributes:true,attributeFilter:['data-state']});
new MutationObserver(report).observe($('#timer'),{childList:true,characterData:true,subtree:true});

window.addEventListener('message',e=>{
 if(e.origin!==origin||e.source!==window.parent||!e.data||e.data.mia!=='call')return;
 if(e.data.cmd==='start'&&!live())$('#call').click();
 if(e.data.cmd==='hangup'&&live())$('#hangup').click();
});
if(new URLSearchParams(location.search).get('start')==='1')$('#call').click();
report();
})();
