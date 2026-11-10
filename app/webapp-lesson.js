/* mía · урок в чате (сегмент 1 «Желанная. Оставаясь собой.»), по START-HERE.txt владельца от 02.11.2026.
   Один непрерывный чат: знакомство → вход в тему → контекст → идея → две истории → личный эпизод или учебный путь →
   шесть блоков чтения («Мне понятно» / «Объясни проще» / «Приложить скриншот») → личный вывод → три ситуации →
   практика → «Завершить урок» → поздравление → обсуждение или следующий урок.
   Тексты — только из данных: data/lesson-ui.json (подписи) и data/lessons/<id>.json (авторский урок). Сейчас данные есть
   только в /ru/ (app-ru/data); без них модуль выключен и чат приложения работает по-старому.
   Хранение (localStorage, ключ host.key): профиль урока (знакомство, пройденные, фразы), история сообщений и состояние каждого
   урока — раздельно. Кнопка действует только под актуальной репликой (messageId), повторное нажатие ничего не дублирует.
   Голосовые и скриншоты — только на этом устройстве (IndexedDB) и не распознаются: шаг урока от вложения не продвигается. */
(function (root) {
  'use strict';
  const L = {};
  let H = null, UI = null, ORDER = [], S = null, lessons = {}, busy = false, queue = [], revealTimer = null, typing = false;
  const shownIds = new Set(), media = {};
  let rec = null, pick = null, toastTimer = null, follow = false;

  const now = () => new Date().toISOString();
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const fill = (t, o) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (o && o[k] !== undefined ? o[k] : ''));
  const esc = s => H.esc(String(s == null ? '' : s));
  const pars = list => (list || []).filter(Boolean).map(t => String(t).split('\n\n').map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('')).join('');

  /* ---------- хранилище ---------- */
  function blank() { return { v: 1, introDone: false, completed: [], phrases: [], lessons: {}, messages: [], cur: { lessonId: null, messageId: null }, draft: '' }; }
  function load() {
    try { const x = JSON.parse(H.store.getItem(H.key) || 'null'); if (x && x.v === 1 && Array.isArray(x.messages)) return Object.assign(blank(), x); } catch (e) { /* испорченные данные — начинаем заново */ }
    return blank();
  }
  function save() { try { H.store.setItem(H.key, JSON.stringify(S)); } catch (e) { /* переполнение — история останется в памяти */ } }

  /* ---------- уроки ---------- */
  const info = id => ORDER.find(x => x.id === id) || null;
  const numOf = id => { const i = info(id); return i ? i.n : 1; };
  const done = id => S.completed.includes(id);
  function currentId() { const x = ORDER.find(o => !done(o.id)); return x ? x.id : null; }
  function status(id) {
    if (done(id)) return 'done';
    if (id === currentId()) return S.lessons[id] ? 'inProgress' : 'current';
    return 'locked';
  }
  function nextAfter(id) { const i = ORDER.findIndex(o => o.id === id); return i >= 0 && ORDER[i + 1] ? ORDER[i + 1].id : null; }
  const soonButtons = id => [B(UI.soonButton || UI.continue, 'repeat', id, true)];
  function fetchLesson(id) {
    if (lessons[id]) return Promise.resolve(lessons[id]);
    return fetch('data/lessons/' + id + '.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null).then(d => { if (d) normalize(d); lessons[id] = d; return d; });
  }
  /* Урок из файла: у вариантов закрепления должны быть id — иначе выбор не распознаётся. Проставляем a, b, c… если их нет. */
  function normalize(d) {
    const fix = items => (items || []).forEach(q => (q.options || []).forEach((o, k) => { if (!o.id) o.id = 'abcdefgh'.charAt(k); }));
    fix(d.quiz); (d.steps || []).forEach(st0 => { if (st0.kind === 'quiz') fix(st0.items); });
  }
  const D = () => lessons[S.cur.lessonId] || null;
  const st = () => S.lessons[S.cur.lessonId];
  const msg = id => S.messages.find(m => m.id === id);
  const active = () => msg(S.cur.messageId);

  /* ---------- сообщения ---------- */
  function stageLabel(key, extra) { return fill((UI.stage || {})[key] || '', Object.assign({ n: numOf(S.cur.lessonId) }, extra || {})); }
  function stageFor(step) {
    if (step === 'entry') return 'intro';
    if (step === 'ready' || step === 'done' || step === 'discussion') return step;
    if (step === 'g-read') return 'reading';
    if (step === 'g-card') return 'personal';
    if (step === 'g-practice') return 'practice';
    if (/^g-/.test(step)) return 'clarify';
    if (step === 'context' || step === 'difference' || step === 'stories') return 'context';
    if (/^(episode|wish|behavior|followup)/.test(step)) return 'clarify';
    if (/^read/.test(step)) return 'reading';
    if (step === 'hypotheses' || /^personal/.test(step)) return 'personal';
    if (/^quiz/.test(step)) return 'quiz';
    if (/^(practice|phrase|observe|rehearse|safety)/.test(step)) return 'practice';
    return step;
  }
  function push(step, view, opt) {
    opt = opt || {};
    const m = { id: uid(), role: 'mia', lessonId: S.cur.lessonId, step, ts: now(), view };
    if (!view.label && S.cur.lessonId && step !== 'intro') view.label = opt.aside ? stageLabel('aside') : stageLabel(stageFor(step), view.labelVars);
    S.messages.push(m);
    const s = st();
    if (opt.aside && s) { if (!s.returnId) s.returnId = S.cur.messageId; }
    else if (s) { s.step = step; s.mainId = m.id; delete s.returnId; }
    S.cur.messageId = m.id;
    queue.push(m.id);
    return m;
  }
  function user(text, extra) { S.messages.push(Object.assign({ id: uid(), role: 'user', lessonId: S.cur.lessonId, ts: now(), text: String(text || '') }, extra || {})); }
  const B = (label, act, value, primary) => ({ label, act, value: value === undefined ? '' : String(value), primary: !!primary });

  /* ---------- знакомство ---------- */
  function intro() {
    const n = H.name(), a = UI.intro || [];
    /* Пункт — строка (старый вид) или {label, paragraphs, button}; без имени «{name}» убирается вместе с запятой. */
    const nm = t => n ? fill(t, { name: n }) : String(t).replace(/\{name\},\s*/g, '').replace(/,?\s*\{name\}/g, '').replace(/^\S/, c => c.toUpperCase());
    a.forEach((it, i) => {
      const o = typeof it === 'string' ? { paragraphs: [it], button: i === a.length - 1 } : it, v = { paragraphs: (o.paragraphs || []).map(nm) };
      if (o.label) v.label = o.label;
      if (o.button) v.buttons = [B(UI.openFirst, 'open-first', '', true)];
      push('intro', v);
    });
    S.introDone = true;
  }

  /* ---------- вход в тему ---------- */
  function begin(id) {
    S.cur.lessonId = id;
    return fetchLesson(id).then(d => {
      const i = info(id);
      if (!d) { push('soon', { label: fill(UI.lessonLabel, { n: i ? i.n : '' }), title: i ? i.title : '', paragraphs: [UI.soonTitle, UI.soonText], buttons: soonButtons(id) }); return; }
      S.lessons[id] = { v: 1, version: d.version || 1, step: 'entry', personal: true, context: null, observation: '', wish: '', wishIndex: null, behavior: null, followup: null, followupText: '', readIndex: 0, readAnswers: {}, readDetails: {}, hypotheses: [], quizIndex: 0, quizAnswers: [], quizResolved: false, practiceType: null, practiceStep: '', practiceResolved: false, draft: '', startedAt: now(), completedAt: null, stepIndex: 0, answers: {} };
      H.track('lesson_start', { lesson: id });
      push('entry', { title: d.title, paragraphs: [d.entry], buttons: [B((d.entryActions || [])[0] || UI.continue, 'start', '', true)] }); /* «Сейчас неактуально» убрано (владелец, 02.11.2026) */
    });
  }
  function showContext() {
    const d = D(), known = H.knownContext && H.knownContext(), c = known && d.contexts.find(x => x.id === known);
    if (c) push('context', { paragraphs: [c.label], note: UI.contextNote, buttons: [B(UI.yesContinue, 'context', c.id, true), B(UI.fix, 'change-context')] });
    else push('context', { paragraphs: [d.contextPrompt], note: UI.contextNote, buttons: d.contexts.map(x => B(x.label, 'context', x.id)) });
  }
  function showStories() {
    const d = D(), s = st();
    push('stories', { paragraphs: [d.storiesIntro], stories: true, after: [d.storiesSummary], hint: true,
      buttons: [...(s.personal ? [B(d.storiesActions[0], 'episode', '', true)] : []), B(d.storiesActions[1], 'example-path', '', !s.personal)] });
  }
  function showEpisode() {
    const d = D();
    push('episode', { paragraphs: [d.episodePrompt], note: fill(UI.episodeNote, { example: d.episodePlaceholder }), input: true, hint: true,
      buttons: [B(UI.chooseExample, 'episode-examples'), B(UI.attach, 'attach'), B(UI.skipPersonal, 'example-path')] });
  }
  function showWish() { const d = D(); push('wish', { paragraphs: [d.wishPrompt], buttons: d.wishes.map((t, i) => B(t, 'wish', i)) }); }
  function showBehavior(reply) { const d = D(); push('behavior', { paragraphs: [reply, d.behaviorPrompt], buttons: d.behaviors.map(b => B(b.label, 'behavior', b.id)) }); }

  /* ---------- чтение по частям ---------- */
  function showReading(i, prefix) {
    const d = D(), s = st();
    if (!d.readingBlocks[i]) { if (s.personal) showHypotheses(); else showPersonal(); return; }
    s.readIndex = i;
    push('reading', { labelVars: { i: i + 1, total: d.readingBlocks.length }, paragraphs: [prefix], block: i, hint: true,
      buttons: [B(UI.understood, 'read-ok', '', true), B(UI.simpler, 'read-simpler'), B(UI.attach, 'attach')] });
  }
  function readOk() {
    const d = D(), s = st(), key = (d.readingBlocks[s.readIndex] || {}).check;
    if (key === 'hypotheses') { if (s.personal) showHypotheses(); else showPersonal(); return; }
    if (!s.personal) { showReading(s.readIndex + 1); return; }
    if (key === 'roles' && s.behavior === 'direct') { const r = d.personalReplies.direct; showReading(s.readIndex + 1, s.followup === 0 ? r.responsive : s.followup === 1 ? r.noChange : r.unclear); return; }
    const q = d.readingChecks[key];
    if (!q || s.readAnswers[key] !== undefined) { showReading(s.readIndex + 1); return; }
    push('read-check', { labelVars: { i: s.readIndex + 1, total: d.readingBlocks.length }, paragraphs: [q.prompt], buttons: [...q.options.map((t, i) => B(t, 'read-answer', i)), B(UI.continueNoAnswer, 'read-next')] });
  }
  function readAnswer(i) {
    const d = D(), s = st(), key = (d.readingBlocks[s.readIndex] || {}).check, q = d.readingChecks[key];
    if (!q || !q.options[i]) return;
    s.readAnswers[key] = i;
    if (key === 'roles' && i !== 0 && i !== 4) { s.behavior = 'direct'; s.followup = i === 1 ? 0 : i === 2 ? 1 : 2; s.refused = i === 3; }
    const detail = (UI.detail || {})[key + ':' + i];
    const lv = { i: s.readIndex + 1, total: d.readingBlocks.length };
    if (detail) push('read-detail', { labelVars: lv, paragraphs: [q.replies[i], detail], input: true, buttons: [B(UI.continueNoDetail, 'read-next')] });
    else push('read-feedback', { labelVars: lv, paragraphs: [q.replies[i]], hint: true, buttons: [B(UI.continue, 'read-next', '', true)] });
  }

  /* ---------- личный вывод ---------- */
  function showHypotheses() { push('hypotheses', { paragraphs: [UI.hypothesesPrompt], multi: true, buttons: [...D().hypotheses.map((h, i) => B(h.label, 'hyp-toggle', i)), B(UI.continue, 'hyp-done', '', true)] }); }
  function personalText() {
    const d = D(), s = st(), R = d.personalReplies;
    if (!s.personal) return R.example;
    if (s.behavior === 'write') return s.followup === 0 ? R.enjoyment : [1, 2].includes(s.followup) ? R.anxiety : R.example;
    if (s.behavior === 'direct') return s.followup === 0 ? R.direct.responsive : s.followup === 1 ? R.direct.noChange : R.direct.unclear;
    if (s.behavior === 'wait') {
      if (s.followup === 4) return '';
      const choice = (d.behaviors.find(b => b.id === 'wait') || { options: [] }).options[s.followup];
      if (s.followup === 3) return s.followupText ? UI.detailEcho + ' «' + s.followupText + '». ' + UI.detailAfter : R.example;
      return [fill(R.wait.intro.replace('{answer}', '{a}'), { a: choice || '' }), [R.wait.intrusive, R.wait.unneeded, R.wait.plans][s.followup]].filter(Boolean).join('\n\n');
    }
    return R.example;
  }
  function showPersonal(more) {
    const d = D(), s = st(), next = [B(UI.toQuiz, 'quiz-start', '', true), B(UI.skipQuiz, 'quiz-skip-all')];
    if (s.hypotheses.length && !more) {
      const hs = s.hypotheses.map(i => d.hypotheses[i]).filter(Boolean);
      const rows = [];
      if (s.observation || s.wish) rows.push([UI.told, [s.observation, s.wish].filter(Boolean).join(' · ')]);
      rows.push([UI.hypothesis, hs.map(h => h.reply).join(' ')]);
      rows.push([UI.unknown, UI.unknownText]);
      rows.push([UI.stepLabel, hs[0].step]);
      push('personal', { paragraphs: [UI.personalHead], rows, after: [d.personalReplies.summary], buttons: next });
      return;
    }
    const anxiety = s.personal && s.behavior === 'write' && [1, 2].includes(s.followup);
    push(more ? 'personal-more' : 'personal', { paragraphs: [more ? d.personalReplies.anxietyNext : personalText(), d.personalReplies.summary],
      buttons: [...(anxiety && !more ? [B(d.personalReplies.anxietyAction, 'personal-more')] : []), ...next] });
  }

  /* ---------- закрепление ---------- */
  function showQuiz(i, prefix) {
    const d = D(), s = st();
    s.quizIndex = i;
    if (i >= d.quiz.length) { s.quizResolved = true; if (d.format === 'steps') gShow(s.quizStep + 1, d.quizAfter); else showPractice(d.quizAfter); return; }
    const q = d.quiz[i];
    push('quiz', { labelVars: { i: i + 1, total: d.quiz.length }, paragraphs: [prefix, q.question], buttons: [...q.options.map(o => B(o.text, 'quiz-answer', o.id)), B(UI.skipQuestion, 'quiz-skip'), B(UI.skipQuiz, 'quiz-skip-all')] });
  }

  /* ---------- уроки формата «steps» (docs/lesson-format.md): шаги по порядку ---------- */
  function gShow(i, prefix) {
    const d = D(), s = st(), step = d.steps[i];
    s.stepIndex = i;
    if (!step) { s.quizResolved = true; if (!s.practiceType) s.practiceType = 'none'; finishPractice(prefix); return; }
    const lab = step.stage ? { label: stageLabel(step.stage === 'reading' ? 'context' : step.stage) } : {};
    if (step.kind === 'say') push('g-say', Object.assign(lab, { paragraphs: [prefix].concat(step.paragraphs || []), visual: step.visual, buttons: [B(step.button || UI.continue, 'g-next', '', true)] }));
    else if (step.kind === 'ask') push('g-ask', Object.assign(lab, { paragraphs: [prefix, step.prompt], hint: true, buttons: [...step.options.map((o, k) => B(o.label, 'g-opt', k)), ...(step.skip ? [B(step.skip, 'g-skip')] : [])] }));
    else if (step.kind === 'input') push('g-input', Object.assign(lab, { paragraphs: [prefix, step.prompt], examples: step.examples, note: step.note || UI.answerNote, input: true, buttons: [B(step.skip || UI.continueNoAnswer, 'g-skip')] }));
    else if (step.kind === 'reading') { const all = d.steps.filter(x => x.kind === 'reading'); push('g-read', { labelVars: { i: all.indexOf(step) + 1, total: all.length }, paragraphs: [prefix], gblock: i, hint: true, buttons: [B(UI.understood, 'g-next', '', true), B(UI.simpler, 'g-simpler'), B(UI.attach, 'attach')] }); }
    else if (step.kind === 'quiz') { d.quiz = step.items || []; d.quizAfter = step.after || ''; s.quizStep = i; showQuiz(0, prefix); }
    else if (step.kind === 'card') {
      const rows = (step.fields || []).map(f => [f.label, (f.from && s.answers[f.from]) || f.fallback || '']).filter(r => r[1]);
      push('g-card', { title: step.title, paragraphs: [prefix, step.prompt], rows, after: step.example ? [step.example] : [], buttons: [B(UI.cardSave, 'g-card-save', '', true), B(UI.cardSkip, 'g-skip')] });
    }
    else if (step.kind === 'practice' && s.safetyMode) { s.practiceType = 'safety'; s.practiceStep = 'safety'; s.quizResolved = true; finishPractice(prefix); }
    else if (step.kind === 'practice') push('g-practice', Object.assign(lab, { paragraphs: [prefix, step.intro], note: step.note, buttons: step.choices.map((c, k) => B(c.label, 'g-prac', k)) }));
    else gShow(i + 1, prefix);
  }

  /* ---------- практика ---------- */
  function showPractice(prefix) { const d = D(); push('practice', { paragraphs: [prefix, d.practice.intro], buttons: d.practice.choices.map(c => B(c.label, 'practice', c.id)) }); }
  function showPhrase() {
    const d = D(), s = st(), P = d.practice.phrase;
    if (!s.draft && [3, 4].includes(s.wishIndex)) { push('phrase-input', { paragraphs: [UI.yourWish + s.wish, UI.phraseOwnPrompt], input: true, buttons: [B(UI.practiceLater, 'practice', 'later')] }); return; }
    if (!s.draft) { const t = P.templates[s.wishIndex === 2 ? 'attention' : s.context] || P.templates.dating; s.draft = t.text; s.templateNote = t.note || ''; }
    push('phrase', { paragraphs: [P.intro], phrase: { text: s.draft, title: UI.phraseDefaultTitle, context: s.wish || UI.phraseDefaultContext }, after: [s.templateNote, P.check], note: UI.draftNote,
      buttons: [B(UI.savePhrase, 'phrase-save', '', true), B(UI.rewrite, 'phrase-edit'), B(UI.notSending, 'phrase-later')] });
  }
  function showObserve() { const d = D(); push('observe', { paragraphs: [st().personal ? d.practice.observe.prompt : d.exampleReply], input: true, note: UI.observeNote, buttons: [B(UI.fewData, 'observe-later')] }); }
  function showRehearse() { const d = D(); push('rehearse', { paragraphs: [d.practice.rehearse.prompt], input: true, note: UI.rehearseNote, buttons: [B(UI.practiceLater, 'practice', 'later')] }); }
  function finishPractice(prefix) { st().practiceResolved = true; push('ready', { title: UI.readyTitle, paragraphs: [prefix, UI.readyText], buttons: [B(UI.complete, 'complete', '', true), B(UI.stillQuestion, 'questions')] }); }
  function canComplete() { const s = st(); return !!s && !done(S.cur.lessonId) && s.quizResolved === true && !!s.practiceType && s.practiceResolved === true; }
  function endButtons() {
    const id = S.cur.lessonId;
    if (done(id)) return nextAfter(id) ? [B(UI.nextLesson, 'next', '', true)] : [];
    return canComplete() ? [B(UI.complete, 'complete', '', true)] : [];
  }

  /* ---------- вопросы, возврат, безопасность ---------- */
  const faqButtons = () => (D() ? D().faq.map((f, i) => B(f.question, 'faq', i)) : []);
  function showFAQ() { push('faq', { paragraphs: [D().questionPrompt], input: true, buttons: [B(UI.returnLesson, 'return', '', true), ...faqButtons(), ...endButtons()] }, { aside: true }); }
  function asideAnswer(text, extra) {
    const inLesson = st() && !['done', 'discussion'].includes(st().step);
    push('answer', { paragraphs: [text], buttons: [...(inLesson ? [B(UI.returnLesson, 'return', '', true)] : []), ...(extra || [B(UI.moreQuestion, 'questions')]), ...(inLesson ? [] : endButtons())] }, { aside: inLesson });
  }
  function returnToLesson() {
    const s = st(), target = s && msg(s.mainId);
    if (!target) return;
    const view = JSON.parse(JSON.stringify(target.view));
    view.paragraphs = [UI.backAgain].concat((view.paragraphs || []).filter(p => p !== UI.backAgain));
    delete s.returnId;
    push(target.step, view);
  }
  function showSafety() { st().safetyMode = true; push('safety', { paragraphs: [D().safetyReply], input: true, buttons: [B(UI.safetyContinue, 'safety-continue', '', true), B(UI.toProgram, 'to-program')] }); }

  /* ---------- завершение ---------- */
  function complete() {
    const id = S.cur.lessonId;
    if (!canComplete()) return;
    if (!S.completed.includes(id)) S.completed.push(id);
    st().completedAt = now();
    S.unlock = { done: id, next: nextAfter(id), at: now() };
    H.track('lesson_complete', { lesson: id, practice: st().practiceType, quiz: st().quizAnswers.filter(a => a && !a.skipped).length });
    const nx = nextAfter(id), i = info(nx);
    push('done', { celebration: true, title: numOf(id) === 1 ? UI.doneTitle : fill(UI.doneTitleN, { n: numOf(id) }), paragraphs: [UI.doneText, D() && D().format === 'steps' ? D().closing : ''], nextTitle: i ? i.title : '',
      buttons: [B(UI.discuss, 'discuss'), ...(nx ? [B(UI.nextLesson, 'next', '', true)] : [])] });
  }
  function showDiscussion() { push('discussion', { paragraphs: [UI.discussionText], input: true, buttons: [...faqButtons(), ...endButtons()] }); }

  /* ---------- действия ---------- */
  function act(name, value) {
    const s = st(), d = D();
    const chosen = (active().view.buttons || []).find(b => b.act === name && b.value === String(value));
    if (!chosen) return;
    if (name !== 'hyp-toggle' && name !== 'attach') user(chosen.label);
    switch (name) {
      case 'open-first': { const id = currentId(); if (id) begin(id).then(after); return; }
      case 'to-program': H.goProgress(); return;
      case 'next': { const id = nextAfter(S.cur.lessonId) || currentId(); if (id && (status(id) !== 'locked' || H.openAny)) { begin(id).then(after); return; } break; }
      case 'repeat': { const id = value; begin(id).then(after); return; }
      case 'discuss': showDiscussion(); break;
      case 'questions': showFAQ(); break;
      case 'faq': { const f = d.faq[Number(value)]; if (f) asideAnswer(f.answer); break; }
      case 'return': returnToLesson(); break;
      case 'complete': complete(); break;
      case 'attach': choose('image'); return;
      case 'start': if (d.format === 'steps') gShow(0); else showContext(); break;
      case 'entry-later': push('later', { paragraphs: [UI.laterReply], buttons: [B(UI.startNow, 'start', '', true), B(UI.toProgram, 'to-program')] }); break;
      case 'g-next': case 'g-skip': gShow(s.stepIndex + 1); break;
      case 'g-rewrite': gShow(s.stepIndex); break;
      case 'g-next-aside': delete s.returnId; gShow(s.stepIndex + 1); break;
      case 'g-opt': { const stp = d.steps[s.stepIndex], o = stp && stp.options[Number(value)]; if (!o) return; s.answers[stp.id || s.stepIndex] = o.label; if (o.safety) { s.safetyMode = true; push('safety', { paragraphs: [o.reply, d.safetyReply || UI.safetyFollow], input: true, buttons: [B(UI.safetyGo, 'g-next', '', true), B(UI.toProgram, 'to-program')] }); } else gShow(s.stepIndex + 1, o.reply); break; }
      case 'g-simpler': { const stp = d.steps[s.stepIndex]; push('simpler', { label: stageLabel('simpler'), paragraphs: [stp.simple || stp.title], input: true, buttons: [B(UI.nowClear, 'g-next-aside', '', true), B(UI.backToTopic, 'return')] }, { aside: true }); break; }
      case 'g-card-save': { const stp = d.steps[s.stepIndex], m0 = active(); savePhrase((m0.view.rows || []).map(r => r[0] + ': ' + r[1]).join('\n'), stp.title, UI.cardContext, true); gShow(s.stepIndex + 1, UI.cardSaved); break; }
      case 'g-prac': { const stp = d.steps[s.stepIndex], c = stp && stp.choices[Number(value)]; if (!c) return; s.practiceType = c.label; s.practiceStep = c.label; s.quizResolved = true; finishPractice(c.reply); break; }
      case 'change-context': push('context', { paragraphs: [d.contextPrompt], note: UI.contextNote, buttons: d.contexts.map(x => B(x.label, 'context', x.id)) }); break;
      case 'context': { const c = d.contexts.find(x => x.id === value); if (!c) return; s.context = c.id; s.personal = !['no_partner', 'private'].includes(c.id); push('difference', { paragraphs: [c.reply, d.difference], buttons: [B(d.differenceAction, 'stories', '', true)] }); break; }
      case 'stories': showStories(); break;
      case 'episode': showEpisode(); break;
      case 'example-path': s.personal = false; s.observation = ''; showReading(0, d.exampleReply); break;
      case 'episode-examples': push('episode-examples', { paragraphs: [UI.chooseExamplePrompt], buttons: [...d.episodeExamples.map((t, i) => B(t, 'episode-example', i)), B(UI.continueExample, 'example-path')] }); break;
      case 'episode-example': s.observation = d.episodeExamples[Number(value)] || ''; showWish(); break;
      case 'episode-confirm': showWish(); break;
      case 'episode-edit': showEpisode(); break;
      case 'wish': { const i = Number(value); s.wishIndex = i; if (i === 4) push('wish-input', { paragraphs: [d.wishPrompt], note: UI.answerNote, input: true, buttons: [B(UI.thinkMore, 'wish', 5)] }); else { s.wish = i === 5 ? '' : d.wishes[i]; showBehavior(i === 5 ? d.wishThinkReply : d.wishReply); } break; }
      case 'behavior': { const b = d.behaviors.find(x => x.id === value); if (!b) return; s.behavior = b.id; if (b.id === 'private') s.personal = false; if (b.options.length) push('followup', { paragraphs: [b.prompt], buttons: b.options.map((t, i) => B(t, 'followup', i)) }); else showReading(0, b.reply); break; }
      case 'followup': s.followup = Number(value); if (s.behavior === 'wait' && s.followup === 3) push('followup-input', { paragraphs: [(d.behaviors.find(b => b.id === 'wait') || {}).prompt], note: UI.answerNote, input: true, buttons: [B(UI.continueNoAnswer, 'followup', 4)] }); else showReading(0); break;
      case 'read-ok': readOk(); break;
      case 'read-ok-aside': delete s.returnId; readOk(); break;
      case 'read-simpler': { const blk = d.readingBlocks[s.readIndex]; push('simpler', { label: stageLabel('simpler'), paragraphs: [blk.simple || blk.title], input: true, buttons: [B(UI.nowClear, 'read-ok-aside', '', true), B(UI.backToTopic, 'return')] }, { aside: true }); break; }
      case 'read-answer': readAnswer(Number(value)); break;
      case 'read-next': showReading(s.readIndex + 1); break;
      case 'hyp-toggle': { const i = Number(value); s.hypotheses = s.hypotheses.includes(i) ? s.hypotheses.filter(n => n !== i) : s.hypotheses.concat(i); save(); paint(); return; }
      case 'hyp-done': if (s.hypotheses.includes(3)) { s.behavior = 'direct'; s.followup = 1; } if (s.hypotheses.length) user(s.hypotheses.map(i => d.hypotheses[i].label).join(', ')); showPersonal(); break;
      case 'personal-more': showPersonal(true); break;
      case 'quiz-start': showQuiz(0); break;
      case 'quiz-skip-all': s.quizResolved = true; s.quizSkipped = true; if (d.format === 'steps') gShow(s.quizStep + 1, UI.quizSkippedNote); else showPractice(UI.quizSkippedNote); break;
      case 'quiz-answer': { const q = d.quiz[s.quizIndex], o = q && q.options.find(x => x.id === value); if (!o) return; s.quizAnswers[s.quizIndex] = { option: o.id, correct: !!o.correct };
        push('quiz-feedback', { labelVars: { i: s.quizIndex + 1, total: d.quiz.length }, feedback: o.feedback, correct: !!o.correct, buttons: [B(s.quizIndex === d.quiz.length - 1 ? UI.toPractice : UI.nextSituation, 'quiz-next', '', true)] }); break; }
      case 'quiz-skip': s.quizAnswers[s.quizIndex] = { skipped: true }; showQuiz(s.quizIndex + 1); break;
      case 'quiz-next': showQuiz(s.quizIndex + 1); break;
      case 'practice':
        s.practiceType = value;
        if (s.safetyMode) { s.practiceStep = 'safety'; finishPractice(); }
        else if (value === 'later') { s.practiceStep = 'later'; finishPractice(d.practice.later.reply); }
        else if (value === 'phrase' && !s.personal) { s.practiceType = 'rehearse'; showRehearse(); }
        else if (value === 'phrase' && ((s.behavior === 'direct' && s.followup === 1) || s.refused)) { s.practiceType = 'observe'; showObserve(); }
        else if (value === 'phrase') showPhrase();
        else if (value === 'observe') showObserve();
        else if (value === 'rehearse') showRehearse();
        break;
      case 'phrase-edit': push('phrase-input', { paragraphs: [UI.phraseInputPrompt], input: true, buttons: [B(UI.keepCurrent, 'phrase-back')] }); S.draft = s.draft || ''; break;
      case 'phrase-back': showPhrase(); break;
      case 'phrase-save': savePhrase(s.draft, UI.phraseDefaultTitle, s.wish || UI.phraseDefaultContext, true); s.practiceStep = 'phrase'; finishPractice(); break;
      case 'phrase-later': s.practiceStep = 'draft'; finishPractice(); break;
      case 'observe-save': s.practiceStep = 'observe'; finishPractice(); break;
      case 'observe-later': s.practiceStep = 'few-data'; finishPractice(); break;
      case 'rehearse-save': s.practiceStep = 'rehearse'; finishPractice(); break;
      case 'rehearse-edit': showRehearse(); S.draft = s.draft || ''; break;
      case 'safety-continue': if (d.format === 'steps') { s.safetyMode = true; gShow(s.stepIndex + 1); break; } s.quizResolved = true; s.practiceType = 'safety'; s.practiceStep = 'safety'; finishPractice(); break;
      default: return;
    }
    after();
  }
  /* После её действия чат «ведёт» к ответу: эхо и «печатает…» внизу, новая реплика — с начала (длинная) или целиком (короткая). */
  function after() { follow = true; save(); paint(false, 'bottom'); reveal(); }

  /* Свой текст. Где урок ждёт ответа — он идёт в урок; иначе — подготовленный ответ из FAQ или честное «пока не анализирую». */
  function send(text, attachment) {
    text = String(text || '').trim();
    if (busy || (!text && !attachment)) return;
    user(text, attachment ? { attachment } : null);
    S.draft = '';
    const s = st(), m = active(), d = D();
    if (attachment) { asideAnswer(UI.attachReply, s && !['done', 'discussion'].includes(s.step) ? [] : null); after(); return; }
    if (s && d && safetyRe().test(text)) {
      if (s.step === 'safety') push('safety', { paragraphs: [UI.safetyFollow], input: true, buttons: [B(UI.safetyContinue, 'safety-continue', '', true), B(UI.toProgram, 'to-program')] });
      else showSafety();
      after(); return;
    }
    const step = m && m.view.input ? m.step : '';
    if (!s || !d) asideAnswer(UI.demoReply, []);
    else if (step === 'episode') { s.observation = text; push('episode-confirm', { paragraphs: [UI.episodeEcho], quote: text, after: [UI.episodeAsk], buttons: [B(UI.yesContinue, 'episode-confirm', '', true), B(UI.fix, 'episode-edit'), B(UI.continueExample, 'example-path')] }); }
    else if (step === 'g-input') {
      const stp = d.steps[s.stepIndex]; s.answers[stp.id || s.stepIndex] = text;
      push('g-echo', { paragraphs: [stp.reply || (stp.phrase ? UI.phraseEcho : UI.detailEcho)], quote: stp.phrase ? '' : text, phrase: stp.phrase ? { text, title: stp.phrase.title, context: stp.phrase.context } : null, buttons: [B(UI.continue, 'g-next', '', true), B(UI.rewrite, 'g-rewrite')] });
    }
    else if (step === 'wish-input') { s.wish = text; showBehavior(d.wishReply); }
    else if (step === 'followup-input') { s.followupText = text; showReading(0); }
    else if (step === 'read-detail') { const key = (d.readingBlocks[s.readIndex] || {}).check; s.readDetails[key] = text; push('read-feedback', { labelVars: { i: s.readIndex + 1, total: d.readingBlocks.length }, paragraphs: [UI.detailEcho], quote: text, after: [UI.detailAfter], hint: true, buttons: [B(UI.continue, 'read-next', '', true)] }); }
    else if (step === 'phrase-input') { s.draft = text; showPhrase(); }
    else if (step === 'observe') { s.draft = text; push('observe-confirm', { paragraphs: [UI.observeEcho], quote: text, buttons: [B(UI.saveObservation, 'observe-save', '', true), B(UI.fewData, 'observe-later')] }); }
    else if (step === 'rehearse') { s.draft = text; push('rehearse-confirm', { paragraphs: [UI.rehearseEcho], quote: text, after: d.practice.rehearse.checklist, note: UI.rehearseCheckNote, buttons: [B(UI.saveDraft, 'rehearse-save', '', true), B(UI.rewrite, 'rehearse-edit'), B(UI.practiceLater, 'practice', 'later')] }); }
    else if (step === 'safety') push('safety', { paragraphs: [UI.safetyFollow], input: true, buttons: [B(UI.safetyContinue, 'safety-continue', '', true), B(UI.toProgram, 'to-program')] });
    else {
      const norm = t => String(t).toLocaleLowerCase().replace(/[?!.,«»“”"]/g, '').trim();
      const f = d.faq.find(x => norm(x.question) === norm(text));
      asideAnswer(f ? f.answer : UI.demoReply, f ? null : [B(UI.moreQuestion, 'questions')]);
    }
    after();
  }

  /* Слова об угрозе и насилии — из данных (UI.safetyPattern). Это простая проверка по словам, а не оценка безопасности (START-HERE, п. 20). */
  let safetyCache = null;
  function safetyRe() { if (!safetyCache) { try { safetyCache = new RegExp(UI.safetyPattern || '$^', 'i'); } catch (e) { safetyCache = /$^/; } } return safetyCache; }

  /* ---------- фразы ---------- */
  const phraseKey = (text, lessonId) => lessonId + '|' + String(text).trim();
  function isSaved(text, lessonId) { return S.phrases.some(p => phraseKey(p.text, p.lessonId) === phraseKey(text, lessonId)); }
  function savePhrase(text, title, context, keep) {
    const id = S.cur.lessonId, k = phraseKey(text, id);
    if (!String(text || '').trim()) return;
    if (S.phrases.some(p => phraseKey(p.text, p.lessonId) === k)) { if (!keep) { S.phrases = S.phrases.filter(p => phraseKey(p.text, p.lessonId) !== k); toast(UI.removedToast); } return; }
    const i = info(id);
    S.phrases.unshift({ id: uid(), text: String(text).trim(), title: title || UI.phraseDefaultTitle, context: context || '', lessonId: id, lessonTitle: i ? i.title : '', savedAt: now() });
    H.track('phrase_save', { lesson: id });
    toast(UI.savedToast);
  }
  function phraseCard(p, lessonId) {
    const on = isSaved(p.text, lessonId);
    return '<div class="wa-lc-phrase"><div class="t"><small>' + esc(p.title || '') + '</small><strong>' + esc(p.text) + '</strong>' + (p.context ? '<em>' + esc(UI.whenUseful) + ': ' + esc(p.context) + '</em>' : '') + '</div>' +
      '<button class="wa-lc-heart' + (on ? ' on' : '') + '" data-lc="heart" data-text="' + esc(p.text) + '" data-title="' + esc(p.title || '') + '" data-ctx="' + esc(p.context || '') + '" data-lesson="' + esc(lessonId) + '" aria-pressed="' + on + '" aria-label="' + esc(on ? UI.unsaveHeart : UI.saveHeart) + '">' + H.ic('heart') + '</button></div>';
  }

  /* ---------- отрисовка ---------- */
  function articleHTML(d, i, blk) {
    const b = blk || d.readingBlocks[i], src = id => { const r = (d.researchSources || {})[id]; return r ? '<details class="wa-lc-src"><summary>' + esc(UI.sourcesTitle) + '</summary><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + '</a><p>' + esc(r.note) + '</p></details>' : ''; };
    const para = t => { const ls = String(t).split('\n'); return ls.length > 1 && !ls.some(l => /^\s*[•*-]/.test(l)) ? '<div class="wa-lc-case"><h5>' + esc(ls[0]) + '</h5>' + pars([ls.slice(1).join('\n')]) + '</div>' : pars([t]); };
    return '<div class="wa-lc-article"><h3>' + esc(b.title) + '</h3>' + (!blk && i === 0 && d.article && d.article.lead ? pars([d.article.lead]) : '') +
      b.sections.map(s => '<section>' + (s.title ? '<h4>' + esc(s.title) + '</h4>' : '') + (s.paragraphs || []).map(para).join('') +
        (s.callout ? (s.phraseContext ? phraseCard({ text: s.callout, title: s.phraseTitle, context: s.phraseContext }, d.lessonId) : '<div class="wa-lc-callout">' + esc(s.callout) + '</div>') : '') +
        (s.quotes ? (s.quotesLabel ? '<small class="wa-lc-qlabel">' + esc(s.quotesLabel) + '</small>' : '') + lines(s.quotes) : '') + visualHTML(s.visual) + (s.caption ? '<p class="wa-lc-note">' + esc(s.caption) + '</p>' : '') + (s.sourceId ? src(s.sourceId) : '') + '</section>').join('') + '</div>';
  }
  /* Наглядные карточки и последовательность шагов из авторского урока. */
  function visualHTML(v) {
    if (!v) return '';
    return (v.cards ? '<div class="wa-lc-vcards">' + v.cards.map(c => '<div class="vc"><strong>' + esc(c.title || '') + '</strong>' + (c.lines || []).map(l => '<span>' + esc(l) + '</span>').join('') + '</div>').join('') + '</div>' : '') +
      (v.sequence ? '<ol class="wa-lc-seq">' + v.sequence.map(x => '<li>' + esc(String(x).replace(/^\d+\.\s*/, '')) + '</li>').join('') + '</ol>' : '') +
      (v.caption ? '<p class="wa-lc-note">' + esc(v.caption) + '</p>' : '');
  }
  /* Реплика — {speaker, text} или просто строка (варианты фраз без говорящего, уроки «Желанная женщина»). */
  function lines(items) { return '<div class="wa-lc-dialog">' + (items || []).map(x => { const l = typeof x === 'string' ? { text: x } : (x || {}); return '<div class="ln' + ((UI.meSpeakers || []).includes(l.speaker) ? ' me' : '') + '">' + (l.speaker ? '<small>' + esc(l.speaker) + '</small>' : '') + '<span>' + esc(l.text || '') + '</span></div>'; }).join('') + '</div>'; }
  /* Второстепенные действия (пропуски, возврат, программа) — текстом, без рамки, как в сценарии владельца. */
  const SUBTLE = ['quiz-skip', 'quiz-skip-all', 'read-next', 'return', 'to-program', 'questions', 'g-skip', 'entry-later', 'g-rewrite'];
  function timeOf(ts) { try { return new Date(ts).toLocaleTimeString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function miaHTML(m, isActive, first) {
    const v = m.view || {}, d = lessons[m.lessonId];
    let body = '';
    if (v.celebration) {
      body = '<div class="wa-lc-medal" aria-hidden="true"><span class="sp a">✦</span><span class="sp b">✦</span><span class="sp c">✧</span><div class="seal">' + H.ic('check') + '</div></div>' +
        '<span class="wa-lc-eyebrow">' + esc(fill(UI.doneEyebrow, { n: numOf(m.lessonId) })) + '</span><h3>' + esc(v.title) + '</h3>' + pars(v.paragraphs) +
        (v.nextTitle ? '<div class="unl">' + H.ic('check') + '<span>' + esc(UI.unlocked) + '</span></div><div class="nx">' + esc(v.nextTitle) + '</div>' : '');
    } else {
      body = (v.label ? '<small class="wa-lc-label">' + esc(v.label) + '</small>' : '') + (v.title ? '<h3 class="wa-lc-title">' + esc(v.title) + '</h3>' : '') + pars(v.paragraphs) +
        (v.quote ? '<blockquote class="wa-lc-quote">' + esc(v.quote) + '</blockquote>' : '') +
        (v.stories && d ? d.stories.map(s => '<div class="wa-lc-story"><h5>' + esc(s.title) + '</h5>' + lines(s.lines) + pars([s.after]) + '</div>').join('') : '') +
        (Number.isInteger(v.block) && d ? articleHTML(d, v.block) : '') +
        (Number.isInteger(v.gblock) && d && d.steps ? articleHTML(d, v.gblock, d.steps[v.gblock]) : '') +
        visualHTML(v.visual) +
        (v.examples && v.examples.length ? '<div class="wa-lc-examples">' + v.examples.map(x => '<button class="wa-lc-example" data-lc="fill" data-text="' + esc(String(x).replace(/^[—–-]\s*/, '')) + '">' + esc(String(x).replace(/^[—–-]\s*/, '')) + '</button>').join('') + '</div>' : '') +
        (v.rows ? '<dl class="wa-lc-rows">' + v.rows.map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>' : '') +
        (v.phrase ? phraseCard(v.phrase, m.lessonId) : '') +
        (v.feedback ? '<div class="wa-lc-feedback' + (v.correct ? ' ok' : '') + '" role="status">' + esc(v.feedback) + '</div>' : '') +
        pars(v.after) + (v.note ? '<p class="wa-lc-note">' + esc(v.note) + '</p>' : '');
    }
    /* Кнопки — внутри реплики, как в сценарии владельца; главная — лаймовая во всю ширину. Только у актуальной реплики. */
    let acts = '';
    if (isActive && v.buttons && v.buttons.length) {
      const s = S.lessons[m.lessonId];
      const list = v.celebration ? v.buttons.slice().sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0)) : v.buttons;
      acts = '<div class="wa-lc-acts">' + list.map(b => {
        const i = v.buttons.indexOf(b), multi = b.act === 'hyp-toggle', on = multi && s && s.hypotheses.includes(Number(b.value));
        const subtle = !b.primary && SUBTLE.includes(b.act);
        return '<button class="wa-lc-choice' + (b.primary ? ' primary' : '') + (subtle ? ' subtle' : '') + (on ? ' on' : '') + '" data-lc="act" data-mid="' + m.id + '" data-i="' + i + '"' + (multi ? ' aria-pressed="' + on + '"' : '') + (busy ? ' disabled' : '') + '>' +
          (multi ? '<span class="tick" aria-hidden="true">' + (on ? '✓' : '+') + '</span>' : '') + '<span>' + esc(b.label) + '</span>' + (b.primary && !v.celebration ? H.ic('arrow-right') : '') + '</button>';
      }).join('') + '</div>' + (v.hint ? '<p class="wa-lc-hint">' + esc(UI.questionHint) + '</p>' : '');
    }
    return '<div class="wa-msg' + (first ? ' first' : '') + (v.celebration ? ' wa-lc-cele' : '') + (shownIds.has(m.id) ? ' settled' : '') + '" data-mid="' + m.id + '"><span class="wa-ava' + (first && !v.celebration ? '' : ' ghost') + '" aria-hidden="true">m</span><div class="wa-bubble wa-lc-b' + (v.celebration ? ' cele' : '') + '">' + body + acts + '<time class="wa-lc-time">' + esc(timeOf(m.ts)) + '</time></div></div>';
  }

  function userHTML(m) {
    const a = m.attachment;
    let inner = m.text ? esc(m.text) : '';
    if (a && a.type === 'image') inner = '<img class="wa-lc-img" data-media="' + esc(a.key) + '" alt="' + esc(UI.imageLabel) + '">' + inner;
    if (a && a.type === 'voice') inner = '<span class="wa-lc-voice">' + H.ic('mic') + '<audio controls preload="none" data-media="' + esc(a.key) + '"></audio></span>' + inner;
    return '<div class="wa-msg user' + (shownIds.has(m.id) ? ' settled' : '') + '" data-mid="' + m.id + '"><div class="wa-bubble">' + inner + '<time class="wa-lc-time">' + esc(timeOf(m.ts)) + '</time></div></div>';
  }

  function dayLabel(ts) {
    const d = new Date(ts), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, n)) return UI.today;
    if (same(d, y)) return UI.yesterday;
    try { return d.toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'long' }); } catch (e) { return ''; }
  }
  function logHTML() {
    let html = '', prevMia = false, prevDay = '';
    const hidden = new Set(queue);
    for (const m of S.messages) {
      if (hidden.has(m.id)) break;
      const day = dayLabel(m.ts);
      if (day !== prevDay) { html += '<div class="wa-lc-day">' + esc(day) + '</div>'; prevDay = day; prevMia = false; }
      if (m.role === 'mia') { html += miaHTML(m, m.id === S.cur.messageId && !queue.length, !prevMia); prevMia = true; }
      else { html += userHTML(m); prevMia = false; }
    }
    if (typing) html += '<div class="wa-msg first"><span class="wa-ava" aria-hidden="true">m</span><span class="wa-typing" aria-label="' + esc(UI.typing) + '"><i></i><i></i><i></i></span></div>';
    return html;
  }

  function barHTML() {
    const id = S.cur.lessonId || currentId(), i = info(id);
    return i ? '<div class="wa-daybar wa-lc-bar"><span>' + esc(fill(UI.bar, { stage: i.month, stageTitle: String(i.stage || i.monthShort || '').toUpperCase() })) + '</span><b>' + esc(fill(UI.barTopic, { n: String(i.n).padStart(2, '0') })) + '</b></div>' : '';
  }

  function composerHTML() {
    return '<form class="wa-lc-compose" data-lc-form>' +
      '<button type="button" class="wa-lc-new" data-lc="to-bottom" hidden>' + esc(UI.newMessage) + ' ↓</button>' +
      '<div class="wa-lc-panel" data-lc-panel hidden></div>' +
      '<div class="row"><button type="button" class="wa-lc-ico" data-lc="image" aria-label="' + esc(UI.image) + '">' + H.ic('image-plus') + '</button>' +
      '<textarea data-lc-field rows="1" maxlength="1500" placeholder="' + esc(UI.placeholder) + '" aria-label="' + esc(UI.placeholder) + '"></textarea>' +
      '<button type="button" class="wa-lc-send mic" data-lc="mic" aria-label="' + esc(UI.mic) + '">' + H.ic('mic') + '</button>' +
      '<button type="submit" class="wa-lc-send go" data-lc-submit aria-label="' + esc(UI.send) + '" hidden>' + H.ic('send-horizontal') + '</button></div>' +
      '<input type="file" accept="image/*" data-lc-file hidden></form>';
  }

  /* ---------- Онбординг перед первым уроком (mia-onboarding.html владельца): 5 экранов, один раз ----------
     0 «начнём с тебя» → 1 запрос (+ сборка маршрута ~12 с) → 2 программа на 6 этапов → 3 «один шаг открывает следующий»
     (анимация «Пройдена / Теперь доступна») → 4 «Ты и Миа». «Посмотреть позже» тоже закрывает его — чат начинается. */
  let ob = null;
  function obStart() { ob = { step: 0, prep: false, t0: 0, timer: null }; obRender(); }
  function obClose() {
    if (ob && ob.timer) clearInterval(ob.timer);
    ob = null; const el = document.querySelector('.wa-lc-onb'); if (el) el.remove();
    S.onboarded = true; if (!S.messages.length) intro(); save(); paint(true); reveal();
  }
  function obName(t, alt) { const n = H.name(); return n ? fill(t, { name: esc(n) }) : alt; }
  function obPrepState() {
    const total = H.still() ? 2000 : 12000, el = Date.now() - ob.t0, k = Math.min(1, el / total);
    return { k, stage: Math.min(3, Math.floor(k * 4)), done: k >= 1 };
  }
  function obContent() {
    const O = UI.onboarding, first = ORDER[0] || {}, stages = (H.stages && H.stages()) || [];
    const lead = t => '<p class="lob-lead">' + esc(t).replace(/\n/g, '<br>') + '</p>';
    if (ob.prep) {
      const P = O.prep, st0 = obPrepState(), d = P.steps[st0.stage];
      return '<section class="lob-screen lob-loading" data-stage="' + st0.stage + '"><p class="lob-eyebrow">' + esc(P.eyebrow) + '</p><h1>' + obName(P.title, P.titleNoName) + '</h1>' + lead(P.lead) +
        '<div class="lob-loading-visual" aria-hidden="true"><div class="lob-loading-orbit orbit-one"></div><div class="lob-loading-orbit orbit-two"></div><img class="lob-loading-flower" src="assets/mia-flower.webp" alt=""></div>' +
        '<div class="lob-loading-meter"><span style="width:' + Math.round(st0.k * 100) + '%"></span></div><span class="lob-loading-percent">' + Math.round(st0.k * 100) + '%</span>' +
        '<div class="lob-loading-status"><span class="lob-loading-kicker">' + esc(fill(P.stepOf, { i: st0.stage + 1 })) + '</span><h2 class="lob-loading-title">' + esc(st0.done ? P.ready : d.title) + '</h2></div>' +
        '<div class="lob-loading-insight"><small>' + esc(d.label) + '</small><p>' + esc(fill(d.text, { stage: stages[0] || '' })) + '</p></div>' +
        '<div class="lob-loading-stages" aria-hidden="true">' + P.dots.map((t, i) => '<span class="' + (st0.done || i < st0.stage ? 'is-done' : i === st0.stage ? 'is-current' : '') + '"><i></i>' + esc(t) + '</span>').join('') + '</div></section>';
    }
    if (ob.step === 0) { const A = O.s0; return '<section class="lob-screen lob-welcome"><p class="lob-eyebrow">' + esc(A.eyebrow) + '</p><h1>' + obName(A.title, A.titleNoName) + '</h1>' + lead(A.lead) +
      '<div class="lob-visual" aria-hidden="true"><div class="lob-aura-rings"></div><img class="lob-flower" src="assets/mia-flower.webp" alt=""><span class="lob-floating-tag tag-a">' + H.ic('heart') + esc(A.tagA) + '</span><span class="lob-floating-tag tag-b">' + H.ic('route') + esc(A.tagB) + '</span></div>' +
      '<p class="lob-caption">' + esc(A.caption) + '</p></section>'; }
    if (ob.step === 1) { const A = O.s1; return '<section class="lob-screen"><p class="lob-eyebrow">' + esc(A.eyebrow) + '</p><h1>' + A.title + '</h1>' + lead(A.lead) +
      '<ul class="lob-insights">' + A.insights.map((x, i) => '<li class="lob-insight" style="--i:' + i + '"><span class="lob-insight-icon">' + H.ic(x.icon) + '</span><div><small>' + esc(x.label) + '</small><p>' + esc(x.text) + '</p></div></li>').join('') + '</ul>' +
      '<div class="lob-focus"><span>' + esc(A.focusKicker) + '</span><h2>' + esc(A.focusTitle) + '</h2><p>' + esc(A.focusText) + '</p></div></section>'; }
    if (ob.step === 2) { const A = O.s2; return '<section class="lob-screen"><p class="lob-eyebrow">' + esc(A.eyebrow) + '</p><h1>' + A.title + '</h1>' + lead(A.lead) +
      '<div class="lob-route-summary">' + A.chips.map(c => '<span>' + esc(c) + '</span>').join('') + '</div>' +
      '<ol class="lob-route">' + stages.map((t, i) => '<li class="lob-route-step' + (i === 0 ? ' is-current' : '') + '" style="--i:' + i + '"><span class="lob-route-node">' + (i === 0 ? '01' : H.ic('lock')) + '</span><div><small>' + esc(fill(A.stageN, { n: i + 1 }) + (i === 0 ? A.base : '')) + '</small><h2>' + esc(t) + '</h2></div></li>').join('') + '</ol>' +
      '<p class="lob-caption">' + A.caption + '</p></section>'; }
    if (ob.step === 3) { const A = O.s3, cls = ['step-one', 'step-two', 'step-three'];
      return '<section class="lob-screen"><p class="lob-eyebrow">' + esc(A.eyebrow) + '</p><h1>' + A.title + '</h1>' + lead(A.lead) +
        '<div class="lob-unlock-demo" data-ob-unlock><span class="lob-unlock-line"></span>' + A.topics.map((t, i) => '<div class="lob-unlock-item ' + cls[i] + '"><span class="lob-unlock-node">' + (i === 0 ? '01' : H.ic('lock')) + '</span><div class="lob-unlock-card"><small>' + esc(t.label) + '</small><h2>' + esc(t.title) + '</h2><span data-st="' + i + '">' + esc(t.before) + '</span></div></div>').join('') + '</div></section>'; }
    const A = O.s4;
    return '<section class="lob-screen lob-ready"><p class="lob-eyebrow">' + esc(A.eyebrow) + '</p><h1>' + A.title + '</h1>' + lead(A.lead) +
      '<div class="lob-chat-preview"><header><img src="assets/mia-avatar.webp" alt=""><span>' + esc(A.who) + '<small>' + esc(A.role) + '</small></span></header>' +
      '<div class="lob-chat-bubble"><p>' + obName(esc(A.bubble), esc(A.bubbleNoName)) + '</p></div>' +
      '<div class="lob-lesson-preview"><small>' + esc(A.nextKicker) + '</small><h2>' + esc(first.title || '') + '</h2><span>' + esc(A.nextHint) + H.ic('arrow-right') + '</span></div></div>' +
      '<p class="lob-caption">' + esc(A.caption) + '</p></section>';
  }
  function obRender() {
    if (!ob) return;
    const O = UI.onboarding, keys = ['s0', 's1', 's2', 's3', 's4'], A = O[keys[ob.step]];
    let box = document.querySelector('.wa-lc-onb');
    if (!box) { box = document.createElement('div'); box.className = 'wa-lc-onb'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); (document.getElementById('wa') || document.body).appendChild(box); }
    box.classList.toggle('is-welcome', ob.step === 0 && !ob.prep); box.classList.toggle('is-preparing', ob.prep); box.classList.toggle('is-ready', ob.step === 4);
    const foot = ob.prep ? '<div class="lob-loading-footer"><span class="lob-loading-pulse" aria-hidden="true"></span><p>' + esc(O.prep.footer) + '</p></div>'
      : '<button class="lob-primary" data-lc="lob-next">' + esc(A.button) + H.ic('arrow-right') + '</button><p class="lob-footer-note">' + esc(A.note) + '</p>';
    box.innerHTML = '<div class="lob-shell"><header class="lob-top"><button class="lob-back" data-lc="lob-back" aria-label="' + esc(O.back) + '"' + (ob.step === 0 || ob.prep ? ' disabled' : '') + '>' + H.ic('arrow-left') + '</button>' +
      '<span class="lob-brand">mía<small>' + esc(O.brand) + '</small></span><button class="lob-close" data-lc="lob-close" aria-label="' + esc(O.later) + '">' + H.ic('x') + '</button></header>' +
      '<div class="lob-progress" aria-label="' + esc(fill(O.stepOf, { i: ob.step + 1 })) + '">' + [0, 1, 2, 3, 4].map(i => '<i class="' + (i < ob.step ? 'is-complete' : i === ob.step ? 'is-active' : '') + '"></i>').join('') + '</div>' +
      '<main class="lob-main">' + obContent() + '</main><footer class="lob-footer">' + foot + '</footer></div>';
    if (H.icons) H.icons();
    if (ob.step === 3 && !ob.prep) setTimeout(() => {
      const demo = box.querySelector('[data-ob-unlock]'); if (!demo || !ob || ob.step !== 3) return;
      demo.classList.add('is-unlocked'); const T3 = O.s3.topics;
      demo.querySelector('.step-one .lob-unlock-node').innerHTML = H.ic('check'); demo.querySelector('.step-two .lob-unlock-node').textContent = '02';
      demo.querySelectorAll('[data-st]').forEach(el => { el.textContent = T3[Number(el.dataset.st)].after; }); if (H.icons) H.icons();
    }, H.still() ? 0 : 1350);
  }
  function obNext() {
    if (!ob || ob.prep) return;
    if (ob.step === 1) {
      ob.prep = true; ob.t0 = Date.now(); obRender();
      ob.timer = setInterval(() => { if (!ob) return; const st0 = obPrepState(); if (st0.done && Date.now() - ob.t0 > (H.still() ? 2000 : 12000) + 700) { clearInterval(ob.timer); ob.timer = null; ob.prep = false; ob.step = 2; obRender(); return; } const main = document.querySelector('.wa-lc-onb .lob-main'); if (main) { main.innerHTML = obContent(); if (H.icons) H.icons(); } }, 250);
      return;
    }
    if (ob.step === 4) { H.track('lesson_onboarding_done', {}); obClose(); return; }
    ob.step++; obRender();
    const m = document.querySelector('.wa-lc-onb .lob-main'); if (m) m.scrollTop = 0;
  }

  /* Лента — внутри #wa-main (её перерисовывает приложение), поле ввода — в нижнем блоке над навигацией (#wa-bottom):
     так перерисовка ленты не сбрасывает набранный текст и фокус. */
  L.shell = function () { return '<div class="wa-lc" data-lc-root>' + barHTML() + '<div class="wa-chat wa-lc-log" role="log" aria-live="polite" data-lc-log></div></div>'; };
  L.mount = function (main) {
    if (!S.onboarded && S.messages.length) S.onboarded = true;
    /* ?onb=1 — показать онбординг ещё раз (для проверки), история и прогресс не трогаются. */
    const again = /[?&]onb=1(&|$)/.test(location.search) && !L.onbShown;
    if (again) { L.onbShown = true; if (!ob) obStart(); }
    else if (!S.onboarded) { if (!ob) obStart(); }
    else if (!S.messages.length) { intro(); save(); }
    const bottom = document.getElementById('wa-bottom');
    if (bottom && !bottom.querySelector('[data-lc-form]')) {
      bottom.insertAdjacentHTML('afterbegin', composerHTML());
      const f = bottom.querySelector('[data-lc-field]'); if (f) f.value = S.draft || '';
    }
    main.classList.add('with-compose');
    presence(!!queue.length);
    paint(true); syncCompose();
    main.scrollTop = main.scrollHeight;
    reveal();
  };
  L.unmount = function () {
    const form = document.querySelector('[data-lc-form]');
    if (form) { const f = form.querySelector('[data-lc-field]'); if (f) { S.draft = f.value; save(); } micCancel(); pick = null; form.remove(); }
    const mn = main(); if (mn) mn.classList.remove('with-compose');
  };
  function main() { return document.getElementById('wa-main'); }
  function paint(initial, focus) {
    const box = document.querySelector('[data-lc-log]'); if (!box) return;
    const mn = main(), near = initial || (mn && mn.scrollHeight - mn.scrollTop - mn.clientHeight < 160);
    box.innerHTML = logHTML();
    const bar = document.querySelector('.wa-lc-bar'), nb = barHTML(); if (bar && nb) bar.outerHTML = nb;
    box.querySelectorAll('.wa-msg[data-mid]').forEach(el => { const id = el.dataset.mid; if (initial) el.classList.add('settled'); shownIds.add(id); });
    box.querySelectorAll('.settled').forEach(el => { el.style.animation = 'none'; });
    loadMedia(box);
    if (H.icons) H.icons();
    const pill = document.querySelector('[data-lc="to-bottom"]');
    if (mn && focus) { scrollToNew(mn, focus === 'bottom' ? null : box.querySelector('[data-mid="' + focus + '"]')); if (pill) pill.hidden = true; }
    else if (mn && near) { mn.scrollTop = mn.scrollHeight; if (pill) pill.hidden = true; }
    else if (pill) pill.hidden = false;
  }
  /* Видимая высота ленты — без нижнего блока (поле ввода и меню) поверх неё. */
  function scrollToNew(mn, el) {
    const bottom = document.getElementById('wa-bottom'), cover = bottom ? bottom.getBoundingClientRect().height - 24 : 180;
    const view = mn.clientHeight - cover, end = mn.scrollHeight - mn.clientHeight;
    if (!el) { glide(mn, end); return; }
    const top = el.getBoundingClientRect().top - mn.getBoundingClientRect().top + mn.scrollTop - 12;
    const tall = el.getBoundingClientRect().height + 120 > view;
    glide(mn, tall ? Math.min(top, end) : end);
  }
  /* Своя короткая прокрутка (≈0,35 с): встроенная smooth в части браузеров тянется секундами. */
  let glideId = 0;
  function glide(mn, to) {
    const from = mn.scrollTop, dist = to - from, id = ++glideId;
    if (Math.abs(dist) < 2 || H.still() || !root.requestAnimationFrame) { mn.scrollTop = to; return; }
    const t0 = performance.now(), dur = 350;
    const step = t => { if (id !== glideId) return; const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); mn.scrollTop = from + dist * e; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  /* Плашка в шапке («Позвонить», раньше «Я рядом»): зелёная точка «в сети»; пока mía отвечает — «печатает…». */
  function presence(on) {
    const pill = document.querySelector('.wa-help-pill'); if (!pill || pill.classList.contains('wa-in-call')) return; /* во время звонка в плашке — его время */
    pill.classList.add('wa-online');
    const label = pill.querySelector('[data-lc-status]');
    if (on && !label) { pill.dataset.lcHtml = pill.innerHTML; pill.innerHTML = '<i class="dot"></i><span data-lc-status>' + esc(UI.typingShort || UI.typing) + '</span><span class="wa-lc-dots" aria-hidden="true"><i></i><i></i><i></i></span>'; pill.classList.add('wa-typing-now'); }
    else if (!on && label) { pill.innerHTML = pill.dataset.lcHtml || pill.innerHTML; pill.classList.remove('wa-typing-now'); if (H.icons) H.icons(); }
  }
  /* Новые реплики mía — по одной, перед каждой «печатает…» (1–1,4 с; при «меньше движения» — короче). */
  function typingTime(id) {
    if (H.still()) return 450;
    const m = msg(id), v = (m && m.view) || {}, d = m && lessons[m.lessonId];
    let n = (v.paragraphs || []).concat(v.after || [], v.title || '', v.feedback || '').join(' ').length;
    if ((Number.isInteger(v.block) || Number.isInteger(v.gblock)) && d) n += 400;
    return Math.round(700 + Math.min(1800, n * 9));
  }
  function reveal() {
    if (revealTimer || !queue.length) { busy = !!queue.length; if (!queue.length) presence(false); return; }
    busy = true; typing = true; presence(true); paint(false, follow ? 'bottom' : null);
    revealTimer = setTimeout(() => {
      revealTimer = null; typing = false;
      const id = queue.shift(), last = !queue.length;
      if (last) busy = false;
      paint(false, follow ? id : null);
      if (!last) { setTimeout(reveal, 160); return; }
      follow = false; presence(false);
      const f = document.querySelector('[data-lc-field]'); if (f && active() && active().view.input && !matchMedia('(pointer: coarse)').matches) f.focus({ preventScroll: true });
    }, typingTime(queue[0]));
  }


  /* ---------- медиа: IndexedDB ---------- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => { try { const r = indexedDB.open(H.key + '-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('m'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
    return dbp;
  }
  function putMedia(key, blob) { return db().then(d => new Promise((res, rej) => { const t = d.transaction('m', 'readwrite'); t.objectStore('m').put(blob, key); t.oncomplete = res; t.onerror = () => rej(t.error); })); }
  function getMedia(key) { if (media[key]) return Promise.resolve(media[key]); return db().then(d => new Promise(res => { const r = d.transaction('m').objectStore('m').get(key); r.onsuccess = () => { if (r.result) media[key] = URL.createObjectURL(r.result); res(media[key] || null); }; r.onerror = () => res(null); })).catch(() => null); }
  function loadMedia(box) { box.querySelectorAll('[data-media]').forEach(el => { getMedia(el.dataset.media).then(u => { if (u) el.src = u; }); }); }

  /* ---------- скриншот: выбор → просмотр → отправить/отменить ---------- */
  function choose() { const f = document.querySelector('[data-lc-file]'); if (f) { f.value = ''; f.click(); } }
  function onFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(blob => { if (!blob) return; pick = { blob, url: URL.createObjectURL(blob) }; panel('<img class="prev" src="' + pick.url + '" alt=""><p>' + esc(UI.imagePreviewHint) + '</p><div class="btns"><button type="button" class="wa-chip" data-lc="pick-cancel">' + esc(UI.cancel) + '</button><button type="button" class="wa-chip wa-lc-primary" data-lc="pick-send">' + esc(UI.sendImage) + '</button></div>'); }, 'image/jpeg', 0.82);
    };
    img.src = url;
  }
  function panel(html) { const p = document.querySelector('[data-lc-panel]'); if (!p) return; p.hidden = !html; p.innerHTML = html || ''; }
  function sendPick() { if (!pick) return; const key = uid(), b = pick.blob; media[key] = pick.url; pick = null; panel(''); putMedia(key, b).catch(() => {}); send('', { type: 'image', key }); }

  /* ---------- голосовое: разрешение по нажатию → запись (до 2 мин) → прослушать → перезаписать / отправить ---------- */
  function micStart() {
    if (!navigator.mediaDevices || !root.MediaRecorder) { toast(UI.micDenied); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const chunks = [], r = new MediaRecorder(stream);
      rec = { r, stream, chunks, t0: Date.now(), timer: null, blob: null, url: null };
      r.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      r.onstop = () => { stream.getTracks().forEach(t => t.stop()); clearInterval(rec.timer); if (rec.cancel) { rec = null; panel(''); return; } rec.blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' }); rec.url = URL.createObjectURL(rec.blob); rec.dur = Math.round((Date.now() - rec.t0) / 1000);
        panel('<audio controls src="' + rec.url + '"></audio><div class="btns"><button type="button" class="wa-chip" data-lc="rec-cancel">' + esc(UI.cancel) + '</button><button type="button" class="wa-chip" data-lc="rec-again">' + esc(UI.rerecord) + '</button><button type="button" class="wa-chip wa-lc-primary" data-lc="rec-send">' + esc(UI.sendVoice) + '</button></div>'); };
      r.start();
      const tick = () => { const s = Math.floor((Date.now() - rec.t0) / 1000); panel('<div class="rec"><i class="dot"></i><span>' + esc(UI.recording) + ' · ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' / 2:00</span></div><div class="btns"><button type="button" class="wa-chip" data-lc="rec-cancel">' + esc(UI.cancel) + '</button><button type="button" class="wa-chip wa-lc-primary" data-lc="rec-stop">' + esc(UI.stop) + '</button></div>'); if (s >= 120) micStop(); };
      tick(); rec.timer = setInterval(tick, 1000);
    }).catch(() => toast(UI.micDenied));
  }
  function micStop() { if (rec && rec.r.state === 'recording') rec.r.stop(); }
  function micCancel() { if (!rec) { panel(''); return; } if (rec.r.state === 'recording') { rec.cancel = true; rec.r.stop(); } else { rec.stream.getTracks().forEach(t => t.stop()); rec = null; panel(''); } }
  function micSend() { if (!rec || !rec.blob) return; const key = uid(), b = rec.blob; media[key] = rec.url; const dur = rec.dur; rec = null; panel(''); putMedia(key, b).catch(() => {}); send('', { type: 'voice', key, dur }); }

  /* ---------- поле ввода ---------- */
  function syncCompose() {
    const f = document.querySelector('[data-lc-field]'), has = !!(f && f.value.trim());
    const mic = document.querySelector('[data-lc="mic"]'), go = document.querySelector('[data-lc-submit]');
    if (mic) mic.hidden = has; if (go) { go.hidden = !has; go.disabled = busy; }
    if (f) { f.style.height = 'auto'; f.style.height = Math.min(140, f.scrollHeight) + 'px'; }
  }
  let draftTimer = null;
  function onInput(f) { syncCompose(); clearTimeout(draftTimer); draftTimer = setTimeout(() => { S.draft = f.value; save(); }, 300); }
  function submit() { const f = document.querySelector('[data-lc-field]'); if (!f || busy) return; const t = f.value; if (!t.trim()) return; f.value = ''; syncCompose(); send(t); }

  function toast(text) {
    if (H.toast) { H.toast(text); return; }
    let t = document.querySelector('.wa-lc-toast'); if (!t) { t = document.createElement('div'); t.className = 'wa-lc-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }

  /* ---------- события ---------- */
  function onClick(e) {
    const el = e.target.closest && e.target.closest('[data-lc]'); if (!el || !S) return;
    const a = el.dataset.lc;
    if (a === 'act') {
      if (busy) return;
      const m = msg(el.dataset.mid);
      if (!m || m.id !== S.cur.messageId) return;
      const b = (m.view.buttons || [])[Number(el.dataset.i)]; if (!b) return;
      act(b.act, b.value);
      return;
    }
    if (a === 'heart') { const id = S.cur.lessonId; S.cur.lessonId = el.dataset.lesson || id; savePhrase(el.dataset.text, el.dataset.title, el.dataset.ctx, false); S.cur.lessonId = id; save(); paint(); if (H.onPhrases) H.onPhrases(); return; }
    if (a === 'to-bottom') { const mn = main(); if (mn) glide(mn, mn.scrollHeight - mn.clientHeight); el.hidden = true; return; }
    if (a === 'image') { choose(); return; }
    if (a === 'mic') { if (!rec) micStart(); return; }
    if (a === 'rec-stop') { micStop(); return; }
    if (a === 'rec-cancel') { micCancel(); return; }
    if (a === 'rec-again') { micCancel(); micStart(); return; }
    if (a === 'rec-send') { micSend(); return; }
    if (a === 'pick-cancel') { pick = null; panel(''); return; }
    if (a === 'pick-send') { sendPick(); return; }
    if (a === 'open-lesson') { L.open(el.dataset.id); return; }
    if (a === 'fill') { const f = document.querySelector('[data-lc-field]'); if (f) { f.value = el.dataset.text || ''; onInput(f); f.focus(); } return; }
    if (a === 'lob-next') { obNext(); return; }
    if (a === 'lob-back') { if (ob && ob.step > 0 && !ob.prep) { ob.step--; obRender(); } return; }
    if (a === 'lob-close') { H.track('lesson_onboarding_later', { step: ob ? ob.step : null }); obClose(); return; }
    if (a === 'phrase-copy') { const p = S.phrases.find(x => x.id === el.dataset.id); if (p) { try { navigator.clipboard.writeText(p.text); toast(UI.copied); } catch (err) { /* без буфера обмена */ } } return; }
    if (a === 'phrase-del') { S.phrases = S.phrases.filter(x => x.id !== el.dataset.id); save(); toast(UI.removedToast); if (H.onPhrases) H.onPhrases(); return; }
  }
  function onSubmit(e) { if (e.target.matches && e.target.matches('[data-lc-form]')) { e.preventDefault(); submit(); } }
  function onKey(e) { if (e.target.matches && e.target.matches('[data-lc-field]') && e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); submit(); } }
  function onInputEv(e) { if (e.target.matches && e.target.matches('[data-lc-field]')) onInput(e.target); }
  function onChange(e) { if (e.target.matches && e.target.matches('[data-lc-file]')) onFile(e.target.files && e.target.files[0]); }
  function onScroll(e) { if (e.target.id !== 'wa-main') return; const mn = e.target, pill = document.querySelector('[data-lc="to-bottom"]'); if (pill && mn.scrollHeight - mn.scrollTop - mn.clientHeight < 80) pill.hidden = true; }
  function onHide() { if (document.visibilityState === 'hidden') { micCancel(); save(); } }

  /* ---------- снаружи ---------- */
  L.init = function (host) {
    H = host;
    return fetch('data/lesson-ui.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null).then(ui => {
      if (!ui || !Array.isArray(host.order) || !host.order.length) return false;
      UI = ui; ORDER = host.order; S = load();
      document.addEventListener('click', onClick);
      document.addEventListener('submit', onSubmit, true);
      document.addEventListener('keydown', onKey);
      document.addEventListener('input', onInputEv);
      document.addEventListener('change', onChange);
      document.addEventListener('scroll', onScroll, true);
      document.addEventListener('visibilitychange', onHide);
      S.messages.forEach(m => { if (m.step === 'soon' && m.lessonId) m.view.buttons = soonButtons(m.lessonId); });
      S.messages.forEach(m => { if (m.view && Array.isArray(m.view.buttons)) m.view.buttons = m.view.buttons.filter(b => b.act !== 'entry-later'); });
      const need = [...new Set(S.messages.map(m => m.lessonId).filter(Boolean))];
      return Promise.all(need.map(fetchLesson)).then(() => true);
    });
  };
  L.ready = () => !!(UI && S);
  /* Для «Программы»: какой урок только что пройден — анимация «Пройдена → Теперь доступна» показывается один раз. */
  L.takeUnlock = () => { const u = S.unlock; if (u) { delete S.unlock; save(); } return u || null; };
  L.info = id => info(id);
  L.ui = () => UI;
  L.status = id => status(id);
  L.currentId = () => currentId();
  L.completedCount = () => S.completed.length;
  L.phrasesCount = () => S.phrases.length;
  /* Из «Прогресса»: текущий — продолжить или начать; пройденный — предложить пройти ещё раз; закрытый — не открывается. */
  L.open = function (id) {
    const s = status(id);
    if (s === 'locked' && !H.openAny) { toast(UI.lessonLocked); return; } /* openAny — инструменты проверки (?test=1): любой урок, например месяца 2 */
    H.goChat();
    if (busy) return;
    if (s === 'inProgress' && S.cur.lessonId === id) return;
    if (s === 'inProgress') { S.cur.lessonId = id; const st0 = S.lessons[id]; if (st0 && st0.mainId) S.cur.messageId = st0.mainId; save(); paint(); return; }
    if (s === 'done') { push('repeat-ask', { label: fill(UI.lessonLabel, { n: numOf(id) }), title: (info(id) || {}).title, paragraphs: [UI.repeatAsk], buttons: [B(UI.repeat, 'repeat', id, true), B(UI.toProgram, 'to-program')] }); after(); return; }
    if (!S.introDone) { intro(); }
    begin(id).then(after);
  };
  L.phrasesPage = function () {
    const list = S.phrases;
    return '<div class="wa-page"><div class="wa-backbar"><button class="wa-circle" data-wa="phrases-back" aria-label="' + esc(UI.back) + '">' + H.ic('arrow-left') + '</button><span>' + esc(UI.phrasesTitle.toUpperCase()) + '</span></div>' +
      '<h1 class="wa-display" style="margin-top:16px;font-size:36px">' + esc(UI.phrasesTitle) + '</h1>' +
      (list.length ? list.map(p => '<div class="wa-lc-saved"><small>' + esc(p.title) + '</small><strong>' + esc(p.text) + '</strong>' + (p.context ? '<p><b>' + esc(UI.whenUseful) + ':</b> ' + esc(p.context) + '</p>' : '') +
        '<p class="from">' + esc(UI.fromLesson) + ': ' + esc(p.lessonTitle) + ' · ' + esc(new Date(p.savedAt).toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'long' })) + '</p>' +
        '<div class="btns"><button class="wa-chip" data-lc="phrase-copy" data-id="' + esc(p.id) + '">' + H.ic('copy') + esc(UI.copy) + '</button><button class="wa-chip" data-lc="phrase-del" data-id="' + esc(p.id) + '">' + H.ic('trash-2') + esc(UI.remove) + '</button></div></div>').join('')
        : '<p class="wa-muted" style="font-size:16px;line-height:1.55;margin-top:12px">' + esc(UI.phrasesEmpty) + '</p>') + '</div>';
  };
  root.MiaLessonChat = L;
}(typeof window !== 'undefined' ? window : globalThis));
