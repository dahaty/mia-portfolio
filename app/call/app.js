/* Visual prototype only. No audio capture, microphone access or network calls.
   Wire startCall/finishCall and speaking/listening events to a voice provider in production. */
(()=>{'use strict';
const $=s=>document.querySelector(s),app=$('#app'),screens=[$('#ready'),$('#calling'),$('#finished')];
const topics=[{title:'Просто поговорить',note:'Когда хочется выговориться и быть услышанной',icon:'heart',opening:'Привет. Я рядом. Расскажи, с чем ты сегодня?'},{title:'Разобрать мою ситуацию',note:'Посмотреть на то, что происходит между вами',icon:'spark',opening:'Давай разберёмся вместе. Какая ситуация сейчас не даёт тебе покоя?'},{title:'Обсудить тему урока',note:'Про инициативу, желания и взаимность',icon:'leaf',opening:'Продолжим про взаимность. Что из урока откликнулось тебе больше всего?'}];
let topic=0,state='ready',muted=false,started=0,total=0,ringTimer=null,clock=null,replyTimer=null,lastFocus=null;
const format=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
function showScreen(id){screens.forEach(el=>el.hidden=el.id!==id)}
function setState(next){state=next;app.dataset.state=next;syncEmotion()}
function stopTimers(){clearTimeout(growTimer);clearTimeout(ringTimer);clearTimeout(replyTimer);clearInterval(clock);ringTimer=replyTimer=clock=null}
function startCall(){stopTimers();closeSheet();muted=false;app.dataset.muted='false';$('#mute').setAttribute('aria-pressed','false');$('#mute').innerHTML='<span><svg><use href="#mic"/></svg></span><small>Микрофон</small>';$('#mute').disabled=true;total=0;$('#timer').textContent='Соединяем…';$('#call-status').textContent='Звоним Мии…';$('#caption-label').textContent='СЕЙЧАС СОЕДИНИМСЯ';$('#caption').innerHTML='Устройся поудобнее.<br>Это время для тебя.';showScreen('calling');setState('ringing');$('#hangup').focus({preventScroll:true});ringTimer=setTimeout(()=>{started=Date.now();$('#timer').textContent='00:00';$('#mute').disabled=false;clock=setInterval(()=>{total=Math.floor((Date.now()-started)/1000);$('#timer').textContent=format(total)},1000);setState('speaking');$('#call-status').textContent='Миа говорит';$('#caption-label').textContent='МИА';$('#caption').textContent=topics[topic].opening;replyTimer=setTimeout(listening,5500)},1900)}
function listening(){if(state!=='speaking')return;setState('listening');updateListening()}
function updateListening(){syncEmotion();if(state!=='listening')return;$('#call-status').textContent=muted?'Микрофон выключен':'Слушаю тебя';$('#caption-label').textContent=muted?'МОЖНО СДЕЛАТЬ ПАУЗУ':'ТЕПЕРЬ ТВОЯ ОЧЕРЕДЬ';$('#caption').textContent=muted?'Можно сделать паузу.':'Я рядом.'}
function finishCall(){if(state==='ringing'){home();return}stopTimers();closeSheet();$('#duration').textContent=format(total)+' с Мией';showScreen('finished');setState('ended');$('#again').focus({preventScroll:true})}
function home(){stopTimers();closeSheet();showScreen('ready');setState('ready');$('#call').focus({preventScroll:true})}
function openSheet(content){lastFocus=document.activeElement;$('#sheet-content').innerHTML=content;$('#sheet-host').hidden=false;screens.forEach(el=>el.inert=true);$('#close-sheet').focus({preventScroll:true})}
function closeSheet(){if($('#sheet-host').hidden)return;$('#sheet-host').hidden=true;screens.forEach(el=>el.inert=false);if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true})}
$('#choose-topic').onclick=()=>openSheet('<span class="eyebrow">НАЧНЁМ С ГЛАВНОГО</span><h2 id="sheet-title">О чём поговорим?</h2><p class="sheet-intro">Выбери то, что ближе сейчас.<br>В разговоре можно поменять тему.</p><div role="radiogroup" aria-label="Тема разговора">'+topics.map((t,i)=>`<button class="topic-option" role="radio" aria-checked="${i===topic}" data-topic="${i}"><svg><use href="#${t.icon}"/></svg><span><b>${t.title}</b><small>${t.note}</small></span><i class="selected-dot"></i></button>`).join('')+'</div>');
$('#sheet-content').onclick=e=>{const b=e.target.closest('[data-topic]');if(!b)return;topic=Number(b.dataset.topic);$('#topic-name').textContent=topics[topic].title;$('#choose-topic .topic-mark use').setAttribute('href','#'+topics[topic].icon);closeSheet()};
$('#transcript').onclick=()=>openSheet('<span class="eyebrow">ПРИМЕР РАЗГОВОРА</span><h2 id="sheet-title">Слова Мии</h2><p class="sheet-intro">Можно вернуться к тексту, если что-то отвлекло.</p><div class="transcript-line"><small>МИА · ДЕМО</small>'+(state==='ringing'?'Устройся поудобнее. Это время для тебя.':topics[topic].opening)+'</div><p class="transcript-tip">В этом макете показана заранее подготовленная реплика. Голос не записывается.</p>');
$('#call').onclick=startCall;$('#again').onclick=startCall;$('#hangup').onclick=finishCall;$('#home').onclick=home;$('#close-end').onclick=home;$('#close-sheet').onclick=closeSheet;
$('#mute').onclick=()=>{muted=!muted;app.dataset.muted=String(muted);$('#mute').setAttribute('aria-pressed',String(muted));$('#mute').innerHTML=`<span><svg><use href="#${muted?'muted':'mic'}"/></svg></span><small>${muted?'Выключен':'Микрофон'}</small>`;updateListening()};
$('#sheet-host').onclick=e=>{if(e.target===$('#sheet-host'))closeSheet()};
document.addEventListener('keydown',e=>{if($('#sheet-host').hidden)return;if(e.key==='Escape'){e.preventDefault();closeSheet()}if(e.key==='Tab'){const items=[...$('#sheet-host').querySelectorAll('button:not([disabled])')],first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
// Expressions are driven by semantic voice events, not by inferred microphone emotion.
const emotions={
 happy:{label:'Радуется',eyes:['M94 105 Q102 91 110 105','M190 105 Q198 91 206 105'],brows:['M88 79 Q102 74 116 79','M184 79 Q198 74 212 79'],mouth:'M132 127 Q150 148 168 127'},
 listening:{label:'Слушает',eyes:['M102 99 Q102 104 102 109','M198 99 Q198 104 198 109'],brows:['M88 78 Q102 76 116 78','M184 78 Q198 76 212 78'],mouth:'M138 132 Q150 137 162 132'},
 thinking:{label:'Думает',eyes:['M98 101 Q102 103 106 101','M194 101 Q198 103 202 101'],brows:['M88 79 Q102 76 116 79','M184 73 Q198 70 212 73'],mouth:'M140 133 Q151 130 163 133'},
 surprised:{label:'Удивляется',eyes:['M102 97 Q102 103 102 110','M198 97 Q198 103 198 110'],brows:['M88 72 Q102 65 116 72','M184 72 Q198 65 212 72'],mouth:'M141 132 C141 118 159 118 159 132 C159 146 141 146 141 132'},
 tender:{label:'Умиляется',eyes:['M102 99 C87 85 82 106 102 117 C122 106 117 85 102 99','M198 99 C183 85 178 106 198 117 C218 106 213 85 198 99'],brows:['M88 77 Q102 69 116 77','M184 77 Q198 69 212 77'],mouth:'M137 130 Q150 146 163 130'},
 angry:{label:'Злится',eyes:['M96 106 Q102 109 108 106','M192 106 Q198 109 204 106'],brows:['M88 75 Q102 79 116 87','M184 87 Q198 79 212 75'],mouth:'M135 139 Q150 129 165 139'}
};
// Each step has its own expression, not only a stronger particle effect.
emotions.sad={label:'Грустит'};
emotions.shy={label:'Смущается'};
emotions.calm={label:'Спокойна'};
const emotionSteps={happy:['Улыбка','Радость','Восторг'],angry:['Недовольство','Злость','Кипит'],tender:['Симпатия','Нежность','Влюблена'],listening:['Слушает','Внимательна','Вся во внимании'],thinking:['Задумалась','Размышляет','Озарение'],surprised:['Интерес','Удивление','Изумление'],sad:['Взгрустнула','Грустит','Слёзы'],shy:['Смутилась','Краснеет','Засмущалась'],calm:['Выдох','Покой','Безмятежность']};
const extraEmotions={
 displeased:['Недовольна',['Не нравится','Недовольна','Протестует']],
 mischievous:['Вредничает',['Лукавит','Поддразнивает','Вредничает']],
 irritated:['Раздражена',['Досадует','Раздражена','Теряет терпение']],
 skeptical:['Скептична',['Сомневается','Не верит','Скептична']],
 offended:['Обижена',['Задело','Обижена','Дуется']],
 disappointed:['Разочарована',['Надежда гаснет','Разочарована','Опустила руки']],
 worried:['Тревожится',['Беспокоится','Тревожится','Не находит места']],
 scared:['Боится',['Насторожена','Испугалась','Очень страшно']],
 disgusted:['Неприятно',['Не по душе','Неприятно','Отвращение']],
 bored:['Скучает',['Отвлеклась','Скучает','Зевает']],
 proud:['Гордится',['Довольна собой','Гордится','Торжествует']],
 hopeful:['Надеется',['Предвкушает','Надеется','Воодушевлена']],
 grateful:['Благодарна',['Признательна','Благодарна','Тронута']],
 curious:['Любопытна',['Заинтересована','Любопытна','Заинтригована']],
 confused:['Растеряна',['Не поняла','Растеряна','В замешательстве']]
};
Object.entries(extraEmotions).forEach(([key,[label,steps]])=>{emotions[key]={label};emotionSteps[key]=steps});
emotionSteps.angry=['Сердится','Злится','Кипит'];
const emotionFamilies=[
 {id:'character',label:'Недовольство и характер',keys:['displeased','mischievous','irritated','angry','disgusted']},
 {id:'warm',label:'Тепло и подъём',keys:['happy','tender','grateful','hopeful','proud']},
 {id:'attention',label:'Внимание и понимание',keys:['listening','thinking','surprised','curious','confused','skeptical']},
 {id:'vulnerable',label:'Уязвимость',keys:['sad','worried','scared','disappointed','offended']},
 {id:'quiet',label:'Тихие состояния',keys:['calm','shy','bored']}
];
let activeFamily='character';
function emotionButtons(keys){return keys.map(key=>`<button data-emotion-choice="${key}" aria-pressed="${emotionMode===key}">${emotions[key].label}</button>`).join('')}
function renderEmotionPicker(){const family=emotionFamilies.find(f=>f.id===activeFamily);$('#emotions').innerHTML=emotionButtons(family.keys);$('#emotion-family').value=activeFamily;}
function expression(key,n){
 const eye=(kind)=>[102,198].map(x=>kind==='open'?`M${x} 99v9`:kind==='wide'?`M${x} 93v21`:kind==='smile'?`M${x-12} 106Q${x} 86 ${x+12} 106`:kind==='closed'?`M${x-12} 102Q${x} 114 ${x+12} 102`:kind==='squint'?`M${x-12} 107l12-8 12 8`:kind==='sad'?`M${x-12} 108Q${x} 100 ${x+12} 108`:kind==='heart'?`M${x} 97C${x-18} 79 ${x-27} 107 ${x} 123C${x+27} 107 ${x+18} 79 ${x} 97`:`M${x-10} 104h20`);
 const brow=(a,b,c)=>[`M87 ${a}Q102 ${b} 117 ${c}`,`M183 ${c}Q198 ${b} 213 ${a}`];
 let f={eyes:eye('open'),brows:brow(80,76,80),mouth:'M139 132Q150 139 161 132',fill:'none'};
 if(key==='happy'){f.eyes=eye(['open','smile','squint'][n-1]);f.brows=brow(79-n*3,76-n*4,79-n*3);f.mouth=['M139 132Q150 140 161 132','M130 127Q150 152 170 127','M123 124Q150 132 177 124C175 160 125 160 123 124Z'][n-1];if(n===3)f.fill='#70406b';}
 if(key==='angry'){f.eyes=eye(n===1?'flat':'squint');f.brows=brow(81-n*5,78,83+n*4);f.mouth=['M140 139Q150 135 160 139','M133 144Q150 124 167 144','M126 139Q150 120 174 139L170 153Q150 145 130 153Z'][n-1];if(n===3)f.fill='#fff3d4';}
 if(key==='tender'){f.eyes=eye(n===1?'open':n===2?'closed':'heart');f.brows=brow(81,65,77);f.mouth=['M139 132Q150 140 161 132','M135 130Q150 149 165 130','M130 127Q150 153 170 127'][n-1];}
 if(key==='surprised'){f.eyes=eye(n===1?'open':'wide');f.brows=brow(78-n*5,70-n*6,78-n*5);const r=[4,10,18][n-1];f.mouth=`M${150-r} 135a${r} ${r*1.2} 0 1 0 ${r*2} 0a${r} ${r*1.2} 0 1 0 ${-r*2} 0`;f.fill=n===3?'#715484':'none';}
 if(key==='thinking'){f.eyes=eye(n===3?'wide':'flat');f.brows=['M87 81Q102 87 117 81','M183 73Q198 62 213 73'];f.mouth=n===1?'M140 135h17':n===2?'M144 139l14-4':'M135 130Q150 146 169 127';}
 if(key==='listening'){f.eyes=eye(n===3?'wide':'open');f.brows=brow(79-n*2,73-n*2,77);f.mouth=n===3?'M139 134Q150 142 161 134':'M141 134Q150 138 159 134';}
 if(key==='sad'){f.eyes=eye(n===3?'closed':'sad');f.brows=brow(88,80,72);f.mouth=['M140 140Q150 133 160 140','M133 145Q150 127 167 145','M134 147Q150 124 166 147Q150 139 134 147Z'][n-1];if(n===3)f.fill='#68779e';}
 if(key==='shy'){f.eyes=eye(n===1?'open':n===2?'closed':'smile');f.brows=brow(82,72,79);f.mouth=['M140 135Q150 142 160 135','M136 137Q150 148 164 137','M134 136Q150 153 166 136'][n-1];}
 if(key==='calm'){f.eyes=eye(n===1?'flat':'closed');f.brows=brow(79,76,79);f.mouth=n===1?'M143 136h14':'M139 133Q150 140 161 133';}
 if(key==='displeased'){f.eyes=eye('flat');f.brows=brow(78-n,81,81+n);f.mouth=['M137 137h26','M134 140Q150 132 166 140','M133 142Q150 133 167 142Q150 150 133 142Z'][n-1];}
 if(key==='mischievous'){f.eyes=n===1?eye('flat'):[`M90 104Q102 ${99-n*2} 114 104`,'M198 99v9'];f.brows=['M87 76Q102 62 117 74','M183 81Q198 79 213 81'];f.mouth=[`M137 136Q152 ${142+n*2} 169 129`,'M131 132Q151 155 174 125','M129 129Q150 142 175 124Q165 151 145 147Q133 144 129 129Z'][n-1];if(n===3)f.fill='#80506c';}
 if(key==='irritated'){f.eyes=eye(n===3?'squint':'flat');f.brows=brow(76-n,80,84+n);f.mouth=n===1?'M138 140l23-3':n===2?'M133 140h34':'M132 138h36v12h-36Z';if(n===3)f.fill='#fff1e6';}
 if(key==='skeptical'){f.eyes=['M92 104h20',n===1?'M198 100v8':'M188 102Q198 111 208 102'];f.brows=['M86 78Q101 81 116 78',`M182 ${75-n*3}Q198 ${58-n*3} 214 ${72-n*3}`];f.mouth=`M137 138Q151 ${138-n*2} 166 ${139-n*3}`;}
 if(key==='offended'){f.eyes=eye(n===3?'closed':'flat');f.brows=brow(83,79,75);f.mouth=['M139 142Q150 135 161 142','M137 142Q150 129 163 142Q150 149 137 142Z','M132 142Q150 127 168 142Q150 157 132 142Z'][n-1];if(n>1)f.fill='#c48baa';}
 if(key==='disappointed'){f.eyes=eye(n===1?'sad':'closed');f.brows=brow(86,83,76);f.mouth=`M134 ${140+n}Q150 ${137-n*3} 166 ${140+n}`;}
 if(key==='worried'){f.eyes=eye(n===3?'wide':'open');f.brows=brow(88,82-n*2,75-n*2);f.mouth=`M132 141q6 ${-n*3} 12 0t12 0t12 0`;}
 if(key==='scared'){f.eyes=eye('wide');f.brows=brow(77-n*3,66-n*4,70-n*2);const r=6+n*3;f.mouth=`M${150-r} 137Q150 ${117-n*3} ${150+r} 137Q150 ${145+n*3} ${150-r} 137Z`;f.fill=n===1?'none':'#675576';}
 if(key==='disgusted'){f.eyes=eye(n===3?'squint':'flat');f.brows=['M87 78Q102 87 117 78',`M183 ${83-n}Q198 ${68-n*2} 213 76`];f.mouth=`M132 139Q142 ${127-n*2} 151 138Q162 ${148+n*2} 173 132`;}
 if(key==='bored'){f.eyes=eye('flat');f.brows=brow(83,82,83);f.mouth=n===1?'M139 136h22':n===2?'M136 139Q150 135 164 139':'M140 137C140 119 160 119 160 137C160 156 140 156 140 137Z';if(n===3)f.fill='#8a7898';}
 if(key==='proud'){f.eyes=eye(n===1?'flat':'closed');f.brows=brow(75-n,70-n,75-n);f.mouth=`M132 131Q150 ${145+n*3} 172 127`;}
 if(key==='hopeful'){f.eyes=eye(n===3?'wide':'open');f.brows=brow(77-n,70-n*2,75);f.mouth=`M136 132Q150 ${142+n*4} 166 130`;}
 if(key==='grateful'){f.eyes=eye(n===1?'open':'closed');f.brows=brow(79,69,75);f.mouth=`M${138-n*2} 132Q150 ${141+n*3} ${162+n*2} 132`;}
 if(key==='curious'){f.eyes=['M102 99v9',`M198 ${99-n*2}v${9+n*3}`];f.brows=['M87 79Q102 72 117 79',`M183 ${77-n*3}Q198 ${69-n*4} 213 ${77-n*3}`];f.mouth=`M141 134Q150 ${137+n*2} 159 131`;}
 if(key==='confused'){f.eyes=n===1?eye('open'):['M102 97v14','M188 106h20'];f.brows=['M87 83Q102 86 117 79',`M183 ${76-n*2}Q198 ${63-n*2} 213 ${76-n*2}`];f.mouth=`M134 138q8 ${-n*3} 16 0t16 0`;}
 return f;
}
function expressiveDetails(){return `<g class="body-tears" fill="#85b9ed"><path class="tear" d="M89 117Q72 143 89 144Q106 143 89 117Z"/><path class="tear" d="M211 117Q194 143 211 144Q228 143 211 117Z"/></g><g class="body-breath" fill="none" stroke="#a1c6bd" stroke-width="3"><ellipse cx="150" cy="110" rx="135" ry="80"/><ellipse cx="150" cy="110" rx="141" ry="87"/></g><g class="body-insight" transform="translate(232 33)"><path d="M-13 0a16 16 0 1 1 26 0L8 12H-8Z" fill="#eaff7b" stroke="#aab94f" stroke-width="2"/><path d="M-7 17H7M-5 22H5M0-29V-38M-23-21L-29-27M23-21 29-27" stroke="#aab94f" stroke-width="3" fill="none"/></g>`}
document.querySelectorAll('.bot-head').forEach(h=>h.insertAdjacentHTML('beforeend',expressiveDetails()));
document.querySelectorAll('.bot-head').forEach(h=>h.insertAdjacentHTML('beforeend',`<g class="emotion-sweat" fill="#9bc8e8"><path d="M244 75Q230 99 241 103Q258 106 244 75Z"/></g>`));
document.querySelectorAll('.bot-face').forEach(f=>f.insertAdjacentHTML('beforeend','<path class="mischief-tongue" d="M149 141Q157 143 166 139L164 148Q156 159 151 148Z" fill="#e6a0b7"/><path class="disgust-nose" d="M145 117l4-3m4 0 4 3" stroke="#9a7d87" stroke-width="2" fill="none"/>'));
// Fit the facial features to the current head instead of leaving them at fixed coordinates.
document.querySelectorAll('.bot-face').forEach(face=>{const fit=document.createElementNS('http://www.w3.org/2000/svg','g');fit.classList.add('face-fit');face.before(fit);fit.append(face)});
$('#emotions').insertAdjacentHTML('beforebegin','<select id="emotion-family" class="emotion-family" aria-label="Группа эмоций">'+emotionFamilies.map(f=>`<option value="${f.id}">${f.label}</option>`).join('')+'</select>');
$('#emotion-family').onchange=e=>{activeFamily=e.target.value;renderEmotionPicker()};
// Background emotion effects share the same semantic state as the face.
function effectMarkup(){return `<div class="emotion-fx" aria-hidden="true">
<div class="emotion-halo"></div>
<div class="fx-joy">${Array.from({length:10},(_,i)=>`<i style="--i:${i};--x:${8+(i*31)%84}%;--y:${10+(i*23)%70}%">${i%3===0?'♡':'✦'}</i>`).join('')}</div>
<div class="fx-surprise">${Array.from({length:10},(_,i)=>`<i style="--angle:${i*36}deg;--i:${i}"></i>`).join('')}</div>
<div class="fx-rain">${Array.from({length:9},(_,i)=>`<i style="--i:${i};--x:${10+i*10}%"></i>`).join('')}</div>
<div class="fx-think"><span></span><i></i><i></i><i></i></div>
<div class="fx-listen"><i></i><i></i><i></i></div></div>`}
document.querySelectorAll('.visual').forEach((visual,i)=>visual.insertAdjacentHTML('afterbegin',effectMarkup().replaceAll('FIRE-ID','emotion-fire-'+i).replaceAll('CORE-ID','emotion-core-'+i)));
function updateEmotionBackground(key,replay=false){app.dataset.emotion=key;document.querySelectorAll('.visual').forEach(visual=>{if(visual.dataset.emotion===key&&!replay)return;visual.dataset.emotion=key;visual.classList.remove('fx-enter');void visual.offsetWidth;visual.classList.add('fx-enter')})}

let emotionMode='auto',currentEmotion='happy',intensity=1,growTimer=null;
function applyEmotion(key){const base=emotions[key];if(!base)return;const e={...base,...expression(key,intensity)};currentEmotion=key;updateEmotionBackground(key);document.querySelectorAll('.mia-bot').forEach(bot=>{const changed=bot.dataset.emotion!==key||bot.dataset.intensity!==String(intensity);bot.dataset.emotion=key;bot.dataset.intensity=String(intensity);if(changed){bot.classList.remove('face-react');void bot.offsetWidth;bot.classList.add('face-react');}const shape=emotionShape(key,intensity);const sx=Math.min(1,(shape[2]-18)/246);bot.querySelector('.face-fit').style.transform=`translate(150px,107px) scale(${sx},1) translate(-150px,-107px)`;['x','y','width','height','rx'].forEach((attr,i)=>{bot.querySelector('.bot-rim').setAttribute(attr,shape[i]);bot.querySelector('.bot-surface').setAttribute(attr,i<2?shape[i]+9:i<4?shape[i]-18:shape[i]-9)});bot.setAttribute('aria-label','Миа: '+e.label.toLowerCase()+', сила '+intensity+' из 3');bot.querySelector('.eye-left').setAttribute('d',e.eyes[0]);bot.querySelector('.eye-right').setAttribute('d',e.eyes[1]);bot.querySelector('.brow-left').setAttribute('d',e.brows[0]);bot.querySelector('.brow-right').setAttribute('d',e.brows[1]);bot.querySelector('.bot-mouth').setAttribute('d',e.mouth);bot.querySelector('.bot-mouth').style.fill=e.fill;bot.querySelector('.bot-eyes').style.fill=key==='tender'&&intensity===3?'#c75596':'none';bot.querySelector('.bot-eyes').style.strokeWidth=key==='tender'&&intensity===3?'2':key==='surprised'?'10':'7'});$('#call-emotions').textContent=emotionSteps[key][intensity-1]+' · эмоции';syncIntensityControls();}
function syncEmotion(){if(emotionMode!=='auto'){applyEmotion(emotionMode);return}applyEmotion(state==='ringing'?'thinking':state==='listening'?(muted?'thinking':'listening'):'happy')}
function pickEmotion(key,level){clearTimeout(growTimer);if(level!==undefined){const n=Number(level);if(Number.isFinite(n))intensity=Math.max(1,Math.min(3,Math.round(n)));}syncIntensityControls();if(key!=='auto'&&!emotions[key])return;emotionMode=key;syncEmotion();updateEmotionBackground(currentEmotion,true);if(key!=='auto'){activeFamily=emotionFamilies.find(f=>f.keys.includes(key)).id;renderEmotionPicker()}document.querySelectorAll('[data-emotion-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.emotionChoice===key)))}
document.addEventListener('click',e=>{const b=e.target.closest('[data-emotion-choice]');if(!b)return;pickEmotion(b.dataset.emotionChoice);if(b.closest('#sheet-host'))closeSheet()});
$('#call-emotions').onclick=()=>openSheet('<span class="eyebrow">24 СОСТОЯНИЯ · ДЕМО</span><h2 id="sheet-title">Эмоции Мии</h2>'+emotionFamilies.map(f=>`<section class="emotion-family-section"><h3>${f.label}</h3><div class="emotion-options">${emotionButtons(f.keys)}</div></section>`).join('')+intensitySheet()+'<button class="emotion-auto emotion-sheet-auto" data-emotion-choice="auto" aria-pressed="'+(emotionMode==='auto')+'">Авто · по состоянию звонка</button>');


function intensitySheet(){return '<div class="intensity-options sheet-intensity" role="group" aria-label="Сила эмоции">'+[1,2,3].map(n=>`<button data-intensity="${n}" aria-pressed="${n===intensity}">${n} · ${emotionSteps[currentEmotion][n-1]}</button>`).join('')+'</div>'}
function emotionShape(key,level){const shapes={
 happy:[[18,38,264,138,69],[23,29,254,155,77],[35,12,230,180,90]],
 tender:[[28,29,244,148,74],[34,20,232,162,81],[42,13,216,176,88]],
 angry:[[18,38,264,138,65],[18,42,264,134,44],[10,48,280,128,23]],
 listening:[[20,35,260,142,71],[23,28,254,148,70],[33,20,234,164,78]],
 thinking:[[18,38,264,138,69],[15,42,270,132,65],[12,46,276,124,58]],
 surprised:[[18,38,264,138,69],[35,20,230,164,82],[51,5,198,192,96]],
 sad:[[20,40,260,136,68],[23,57,254,115,57],[30,68,240,103,50]],
 shy:[[22,39,256,137,68],[35,34,230,150,75],[46,27,208,165,82]],
 calm:[[18,38,264,138,69],[15,47,270,125,62],[10,56,280,112,56]]};const fallback={displeased:'angry',mischievous:'happy',irritated:'angry',skeptical:'thinking',offended:'shy',disappointed:'sad',worried:'listening',scared:'surprised',disgusted:'thinking',bored:'calm',proud:'happy',hopeful:'listening',grateful:'tender',curious:'listening',confused:'thinking'};return (shapes[key]||shapes[fallback[key]]||shapes.happy)[level-1]}
function syncIntensityControls(){app.dataset.intensity=String(intensity);document.querySelectorAll('[data-intensity]').forEach(b=>{if(b.tagName==='BUTTON'){b.setAttribute('aria-pressed',String(Number(b.dataset.intensity)===intensity));b.textContent=b.dataset.intensity+' · '+emotionSteps[currentEmotion][Number(b.dataset.intensity)-1]}})}
function setIntensity(value){const n=Number(value);if(!Number.isFinite(n))return;clearTimeout(growTimer);intensity=Math.max(1,Math.min(3,Math.round(n)));syncIntensityControls();syncEmotion()}
document.addEventListener('click',e=>{const b=e.target.closest('button[data-intensity]');if(b)setIntensity(b.dataset.intensity)});
$('#grow-emotion').onclick=()=>{setIntensity(1);growTimer=setTimeout(()=>{setIntensity(2);growTimer=setTimeout(()=>setIntensity(3),1700)},1700)};

window.MiaFace={setEmotion:pickEmotion,setIntensity,automatic:()=>pickEmotion('auto')};
renderEmotionPicker();syncEmotion();document.querySelector('[data-emotion-choice="auto"]').setAttribute('aria-pressed','true');

window.addEventListener('pagehide',()=>{stopTimers();clearTimeout(growTimer)});
})();
