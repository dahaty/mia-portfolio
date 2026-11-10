/* Transparent content routing from explicit answers. No clinical scores. */
window.MiaAdaptiveMap={
 build(answers,questions){
  const areas=[
   {key:'thoughts',name:'Мысли о нём',short:'Мысли',icon:'message-circle',step:1,practice:'Меньше напоминаний',action:'Уберём одно напоминание в телефоне и оставим место для паузы перед привычным действием.',rules:[['checking',['often','daily','sometimes']],['loop',['replay','wait']],['selftalk',['hope']],['triggers',['social','places','message']]],resources:[['checking',['never']],['loop',['return']]]},
   {key:'evening',name:'Твои вечера',short:'Вечера',icon:'moon',step:3,practice:'Спокойнее завершить вечер',action:'Выберем небольшой вечерний ритуал и практику для моментов, когда трудно переключиться.',rules:[['evening',['thoughts','phone','lonely']],['triggers',['night','alone']]],resources:[['evening',['quiet']]]},
   {key:'self',name:'Отношение к себе',short:'Себя',icon:'flower-2',step:5,practice:'Снова увидеть себя',action:'Вернёмся к твоим интересам, потребностям и небольшим решениям, которые принадлежат тебе.',rules:[['selftalk',['blame','identity','future']],['missing',['hobbies','confidence','plans']],['loop',['compare']]],resources:[['mood',['steady']],['tried',['movement','writing']]]},
   {key:'boundaries',name:'Твои границы',short:'Границы',icon:'shield',step:8,practice:'Выбрать границу',action:answers.contact==='shared'?'Подготовим фразу для границы, сохранив возможность общаться по общим делам.':'Выберем одну посильную границу и подготовим слова, которыми можно её обозначить.',rules:[['boundary',['reply','talk','please','choice']],['urge',['send','hold']]],resources:[['urge',['draft','rare']]]}
  ];
  const evidence=(id,values)=>{const q=questions.find(q=>q.id===id);if(!q)return null;const a=answers[id],selected=(Array.isArray(a)?a:[a]).filter(v=>values.includes(v));if(!selected.length)return null;const labels=selected.map(v=>q.options.find(o=>o[0]===v)?.[1]).filter(Boolean);return labels.length?{questionId:id,question:q.title.replaceAll('<br>',' '),answer:labels.join(' · ')}:null;};
  for(const area of areas){area.evidence=area.rules.map(([id,values])=>evidence(id,values)).filter(Boolean);area.resources=area.resources.map(([id,values])=>evidence(id,values)).filter(Boolean);area.chosen=answers.focus===area.key;if(area.chosen){const e=evidence('focus',[area.key]);if(e)area.evidence.unshift(e);}area.status=area.chosen?'focus':area.evidence.length?'attention':area.resources.length?'resource':'unknown';delete area.rules;}
  const primary=areas.find(a=>a.chosen)?.key||'gentle';
  const secondary=areas.filter(a=>!a.chosen&&a.status==='attention').sort((a,b)=>b.evidence.length-a.evidence.length).slice(0,2).map(a=>a.key);
  const strengths=[];const tried=Array.isArray(answers.tried)?answers.tried:[];for(const value of tried.filter(v=>v!=='nothing')){const e=evidence('tried',[value]);if(e)strengths.push(e.answer);}if(['close','professional'].includes(answers.support)&&!(answers.support==='close'&&tried.includes('people'))){const e=evidence('support',[answers.support]);if(e)strengths.push(e.answer);}
  return {version:9,primary,secondary,areas,strengths:[...new Set(strengths)].slice(0,3)};
 },
 week(base,map,gentle){
  const candidates=[...(gentle?[4]:[]),base[0],...map.secondary.map(key=>map.areas.find(a=>a.key===key).step),...base.filter(n=>n!==7)];
  return [...new Set(candidates)].filter(n=>n!==7).slice(0,6).concat(7);
 }
};
