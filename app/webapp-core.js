/* mía · ядро веб-приложения: перенос правил iOS (ios/Mia/Core/Program.swift, ProgramContent.swift,
   ChatScript.swift, AppState.swift). Чистые функции без DOM — проверяются в scripts/check-webapp.cjs.
   Программа и тексты берутся из app/data/program.json (копия ios/Mia/Resources/program.json). */
(function (root) {
'use strict';
const TOTAL_DAYS = 30, INPUT_LIMIT = 160, STORAGE_KEY = 'mia-ru-webapp-v1', SCHEMA = 1, SYNC_KEY = 'mia-webapp-sync-v1', DOC_SCHEMA = 1;
const AUDIO_BASE = 'https://t2tfa8zgkhgdoebq.public.blob.vercel-storage.com/audio/es';

/* ---------- Хранилище: один JSON в localStorage под версионным ключом ---------- */
function blankState() { return { schema: SCHEMA, records: {}, profile: { name: '', reduceMotion: false }, program: null, testAccess: false, offers: {} }; }
function normalize(x) {
  if (!x || typeof x !== 'object' || !x.records || typeof x.records !== 'object' || Array.isArray(x.records)) return null;
  const s = blankState();
  s.records = x.records;
  s.profile = { ...s.profile, ...(x.profile && typeof x.profile === 'object' ? x.profile : {}) };
  s.program = x.program && typeof x.program === 'object' && Number.isInteger(x.program.currentDay) ? x.program : null;
  s.testAccess = x.testAccess === true;
  /* offers — какие всплывающие предложения первого месяца уже показаны ({mid, end}). */
  s.offers = x.offers && typeof x.offers === 'object' && !Array.isArray(x.offers) ? x.offers : {};
  return s;
}
function load(storage) {
  try { const raw = storage && storage.getItem(STORAGE_KEY); return (raw && normalize(JSON.parse(raw))) || blankState(); } catch { return blankState(); }
}
function save(storage, state) { try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; } }
function wipe(storage) { try { storage.removeItem(STORAGE_KEY); storage.removeItem(SYNC_KEY); return true; } catch { return false; } }
function exportData(state) { return JSON.stringify({ app: 'mia', exportedAt: new Date().toISOString(), ...state }, null, 2); }

/* ---------- Синхронизация с сервером: общий с iOS документ (StateSync.swift), правила — docs/decisions/state-sync.md ----------
   {schema, records: {день: {...запись, updatedAt}}, saved: {id: {..., updatedAt}}, fields: {имя: {value, updatedAt}}}.
   Слияние по ключу: новее updatedAt — выигрывает, равные и неизвестные — у сервера; program только растёт. */
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
/* null и отсутствующий ключ — одно и то же: iOS не пишет пустые поля, веб пишет null. */
function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (!x || typeof x !== 'object') return x;
  const o = {}; Object.keys(x).sort().forEach(k => { if (x[k] !== null && x[k] !== undefined) o[k] = canon(x[k]); }); return o;
}
function same(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }
function bare(e) { const { updatedAt, ...rest } = obj(e); return rest; }
function stampTime(e) { const t = e && typeof e.updatedAt === 'string' ? Date.parse(e.updatedAt) : NaN; return isNaN(t) ? 0 : t; }
function docShape(d) {
  d = obj(d);
  return { schema: Number.isInteger(d.schema) && d.schema > 0 ? d.schema : DOC_SCHEMA, records: obj(d.records), saved: obj(d.saved), fields: obj(d.fields) };
}
function mergeEntries(local, remote) {
  const out = { ...remote };
  for (const [k, v] of Object.entries(local)) if (!(k in out) || stampTime(v) > stampTime(out[k])) out[k] = v;
  return out;
}
function mergeProgram(a, b) {
  a = obj(a); b = obj(b);
  if (!Number.isInteger(a.currentDay)) return Number.isInteger(b.currentDay) ? b : a;
  if (!Number.isInteger(b.currentDay)) return a;
  const opened = { ...obj(a.opened) };
  for (const [k, v] of Object.entries(obj(b.opened))) if (!opened[k] || v < opened[k]) opened[k] = v;
  const ta = Date.parse(a.startedAt), tb = Date.parse(b.startedAt);
  return { ...a, ...b, startedAt: isNaN(tb) || (!isNaN(ta) && ta < tb) ? a.startedAt : b.startedAt, currentDay: Math.max(a.currentDay, b.currentDay), opened, supportDone: !!a.supportDone || !!b.supportDone };
}
function mergeDocuments(local, remote) {
  const l = docShape(local), r = docShape(remote), fields = mergeEntries(l.fields, r.fields);
  const lp = l.fields.program, rp = r.fields.program;
  if (lp && rp) fields.program = { value: mergeProgram(lp.value, rp.value), updatedAt: stampTime(lp) > stampTime(rp) ? lp.updatedAt : rp.updatedAt };
  return { schema: Math.max(l.schema, r.schema), records: mergeEntries(l.records, r.records), saved: mergeEntries(l.saved, r.saved), fields };
}
/* Поля веба в документе. urgeDraft («Guardarlo hasta mañana»), welcomed, reduceMotion и testShiftDays остаются в браузере. */
function syncFields(state) {
  const p = obj(state.profile), f = { profile: { name: typeof p.name === 'string' ? p.name : '' }, offers: obj(state.offers) };
  if (p.format === 'audio' || p.format === 'text') f.profile.format = p.format;
  const g = state.program;
  if (g && Number.isInteger(g.currentDay)) f.program = { startedAt: g.startedAt, currentDay: g.currentDay, opened: obj(g.opened), supportDone: !!g.supportDone };
  return f;
}
/* Документ из состояния. Изменившиеся с прошлого документа записи и поля получают время `iso`; без прошлого документа
   (новый браузер, переустановка) время неизвестно — при слиянии такие записи уступают серверу. */
function buildDocument(state, prev, iso) {
  const p = prev ? docShape(prev) : null, base = p || docShape(null), records = { ...base.records }, fields = { ...base.fields };
  const stamp = (old, value, current) => !p ? null : old && same(current, value) ? (old.updatedAt || null) : iso;
  for (const [k, r] of Object.entries(obj(state.records))) {
    const n = Number(k); if (!Number.isInteger(n) || n < 1 || n > TOTAL_DAYS || !r || typeof r !== 'object') continue;
    const value = { ...blankRecord(), ...bare(r) }, old = base.records[n];
    records[n] = { ...value, updatedAt: stamp(old, value, old && bare(old)) };
  }
  for (const [k, value] of Object.entries(syncFields(state))) { const old = base.fields[k]; fields[k] = { value, updatedAt: stamp(old, value, old && old.value) }; }
  return { schema: Math.max(base.schema, DOC_SCHEMA), records, saved: base.saved, fields };
}
function applyDocument(state, doc) {
  const d = docShape(doc), s = { ...state, records: { ...obj(state.records) }, profile: { ...obj(state.profile) }, offers: { ...obj(state.offers) } };
  for (const [k, e] of Object.entries(d.records)) {
    const n = Number(k); if (!Number.isInteger(n) || n < 1 || n > TOTAL_DAYS || !e || typeof e !== 'object' || Array.isArray(e)) continue;
    s.records[n] = { ...blankRecord(), ...bare(e) };
  }
  const val = k => obj(d.fields[k]).value, profile = obj(val('profile')), offers = val('offers'), program = obj(val('program'));
  if (typeof profile.name === 'string') s.profile.name = profile.name;
  if (profile.format === 'audio' || profile.format === 'text') s.profile.format = profile.format;
  if (offers && typeof offers === 'object' && !Array.isArray(offers)) s.offers = { ...offers };
  if (Number.isInteger(program.currentDay) && program.currentDay >= 1 && program.currentDay <= TOTAL_DAYS) {
    s.program = { ...obj(state.program), startedAt: program.startedAt, currentDay: program.currentDay, opened: { ...obj(program.opened) }, supportDone: !!program.supportDone, testShiftDays: (state.program && state.program.testShiftDays) || 0 };
  }
  return s;
}
/* Последний документ и ревизия сервера; dirty — есть изменения, которые сервер ещё не принял. */
function loadSync(storage) {
  try {
    const x = JSON.parse((storage && storage.getItem(SYNC_KEY)) || 'null');
    if (x && Number.isInteger(x.revision) && x.revision >= 0) return { revision: x.revision, doc: x.doc && typeof x.doc === 'object' ? x.doc : null, dirty: x.dirty === true };
  } catch {}
  return { revision: 0, doc: null, dirty: false };
}
function saveSync(storage, meta) { try { storage.setItem(SYNC_KEY, JSON.stringify(meta)); return true; } catch { return false; } }
function wipeSync(storage) { try { storage.removeItem(SYNC_KEY); return true; } catch { return false; } }

/* ---------- Ход программы (Program.swift) ----------
   Новый день открывается, когда наступила новая календарная дата И в текущем дне было любое действие.
   За один вызов — не больше одного дня; пропущенные дни не копятся. */
function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(date) { const d = new Date(date); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function now(state, base) { return new Date((base == null ? Date.now() : +base) + ((state.program && state.program.testShiftDays) || 0) * 86400000); }
function blankRecord() { return { energy: null, skip: false, practice: false, lesson: false, outcome: null, steps: {}, chat: [], checks: null }; }
function rec(state, day) { return { ...blankRecord(), ...(state.records[day] || {}) }; }
/* Любое действие закрывает день; выбор уровня сил и отметки чата сами по себе — нет. */
function touched(r) { return !!r && (!!r.practice || !!r.skip || !!r.lesson || !!r.evening || (r.checks !== null && r.checks !== undefined) || Object.keys(r.steps || {}).length > 0); }
function ensure(state, date) {
  const p = state.program;
  if (p && p.currentDay >= 1 && p.currentDay <= TOTAL_DAYS) return;
  const used = Object.keys(state.records).map(Number).filter(n => n >= 1 && n <= TOTAL_DAYS && touched(state.records[n]));
  const current = used.length ? Math.max(...used) : 1;
  state.program = { startedAt: new Date(date).toISOString(), currentDay: current, opened: { [current]: dateKey(date) }, supportDone: false, testShiftDays: (p && p.testShiftDays) || 0 };
}
function advance(state, date) {
  const p = state.program; if (!p) return false;
  const today = dateKey(date), cur = p.currentDay;
  if (!p.opened) p.opened = {};
  const openedOn = p.opened[cur] || today;
  if (!p.opened[cur]) p.opened[cur] = today;
  if (!touched(state.records[cur]) || !(today > openedOn)) return false;
  if (cur >= TOTAL_DAYS) { if (p.supportDone) return false; p.supportDone = true; }
  else { p.currentDay = cur + 1; p.opened[cur + 1] = today; }
  return true;
}
function currentDay(state) { const n = state.program && state.program.currentDay; return n >= 1 && n <= TOTAL_DAYS ? n : 1; }
function canOpen(state, day) { return day >= 1 && day <= currentDay(state); }
function isSunday(date) { return new Date(date).getDay() === 0; }
function isEvening(date) { return new Date(date).getHours() >= 18; }

/* ---------- Шаги практики (StepProgress) ---------- */
function choices(step) { return (step.options || []).concat(step.shared ? [step.shared] : []); }
function stepDone(step, values) {
  if (!Array.isArray(values) || !values.length) return false;
  const filled = values.map(v => String(v == null ? '' : v).trim());
  switch (step.kind) {
    case 'options': {
      const first = filled[0];
      if (!choices(step).includes(first)) return false;
      return first === step.custom ? (filled.length > 1 && filled[1] !== '' && [...filled[1]].length <= INPUT_LIMIT) : true;
    }
    case 'multi': return filled.every(v => (step.options || []).includes(v));
    case 'number': return /^\d+$/.test(filled[0]) && +filled[0] >= 0 && +filled[0] <= 999;
    case 'lines': return filled.some(v => v !== '');
    case 'check': return filled[0] === 'done';
    default: return filled[0] !== '' && [...filled[0]].length <= INPUT_LIMIT;
  }
}
function doneCount(day, r) { return day.steps.filter((s, i) => stepDone(s, r && r.steps && r.steps[String(i)])).length; }
function isComplete(day, r) { return doneCount(day, r) === day.steps.length; }
function nextUndone(day, r, after) {
  const undone = day.steps.map((s, i) => i).filter(i => !stepDone(day.steps[i], r && r.steps && r.steps[String(i)]));
  const n = undone.find(i => i > after); return n !== undefined ? n : (undone.length ? undone[0] : -1);
}
/* Сохраняет ответ на шаг: неполный ответ стирается, день выполнен, когда сделаны все шаги. */
function setStep(day, r, index, values) {
  const next = { ...blankRecord(), ...r, steps: { ...(r.steps || {}) } };
  if (stepDone(day.steps[index], values)) next.steps[String(index)] = values; else delete next.steps[String(index)];
  next.practice = isComplete(day, next);
  return next;
}
function summary(step, values) {
  values = values || [];
  switch (step.kind) {
    case 'options': return values[0] === step.custom ? (values[1] || '') : (values[0] || '');
    case 'multi': return values.join(' · ');
    case 'check': return 'Сделано';
    case 'lines': return (step.prompts || []).map((p, i) => [p, values[i]]).filter(x => x[1] && x[1].trim()).map(x => x[0].replace(/…/g, '') + ' — ' + x[1]).join('\n');
    default: return values[0] || '';
  }
}
/* Сообщение, которое готовит практика (дни 6, 9, 11, 20). Приложение его только собирает — копирует и отправляет она сама. */
function message(day, r) {
  if (![6, 9, 11, 20].includes(day.day) || !r || !isComplete(day, r)) return null;
  const v = i => (r.steps && r.steps[String(i)]) || [];
  const first = String(v(0)[0] || '').trim();
  if (day.day === 9) { const t = summary(day.steps[1], v(1)).replace(/^[«»]+|[«»]+$/g, ''); return t || null; }
  if (day.day === 11) { const t = summary(day.steps[2], v(2)).trim(); return t || null; }
  if (day.day === 20) {
    if (day.steps[2].options.indexOf(v(2)[0] || '') !== 1 || !first) return null;
    return 'Привет. Хочу вернуться к одному делу и сделать это вместе с тобой: ' + first.charAt(0).toLowerCase() + first.slice(1) + '. Пойдёшь со мной?';
  }
  const needs = ['Можешь просто побыть со мной рядом? Разговаривать не обязательно.', 'Послушаешь меня немного? Мне не нужны советы, просто побудь рядом.', 'Напиши мне, пожалуйста, сегодня вечером. Мне этого хватит.'];
  const tones = ['мне нужна твоя помощь.', 'можно тебя кое о чём попросить?', 'выручишь?'];
  const ni = day.steps[1].options.indexOf(v(1)[0] || ''), ti = day.steps[2].options.indexOf(v(2)[0] || '');
  return (first || 'Привет') + ', ' + (tones[ti] || tones[0]) + ' ' + (needs[ni] || needs[0]);
}
/* Число проверок его страницы: вечерняя отметка или шаг-число (день 12 — шаг 3, день 14 — шаг 1). */
function checks(program, records, day) {
  const r = records[day];
  if (r && r.checks !== null && r.checks !== undefined) return r.checks;
  const d = program.days.find(x => x.day === day); if (!d) return null;
  const i = d.steps.findIndex(s => s.kind === 'number'); if (i < 0) return null;
  const v = r && r.steps && r.steps[String(i)] && r.steps[String(i)][0];
  return v !== undefined && /^\d+$/.test(String(v)) ? +v : null;
}
function curve(program, records) { return program.days.filter(d => d.evening).map(d => ({ day: d.day, value: checks(program, records, d.day) })).filter(p => p.value !== null); }
function activeDays(records) { return Object.values(records).filter(r => touched(r) || (r.chat && r.chat.length)).length; }

/* ---------- Чат с mía (ChatScript.swift) ---------- */
const heroLines = {
  digital: ['Меньше шума.', 'Больше', 'тебя.'], sleep: ['Этот вечер.', 'Только', 'для тебя.'], identity: ['Вернись', 'к себе,', 'poco a poco.'],
  connect: ['Есть те,', 'кто рядом.'], ground: ['Этот вдох.', 'Здесь', 'и сейчас.'], rest: ['Сегодня', 'basta', 'просто быть.'],
  movement: ['Маленький', 'шаг.', 'Для себя.'], reflect: ['Замечать', 'себя —', 'тоже шаг.'], boundary: ['Твоё «нет».', 'Твоё', 'право.'],
  values: ['Твой ритм.', 'Твои', 'правила.'], support: ['Ты можешь', 'быть не', 'одна.']
};
const moods = [['Держусь', 'mid'], ['Тяжело', 'low'], ['Не знаю', 'mid']];
const evenings = ['Спокойно', 'Накрывало', 'Не помню'];
const planFeedback = ['Подходит', 'Слишком много', 'Хочу другое'];
const articleFeedback = ['Да, отозвалось', 'Не очень'];
const voiceFeedback = ['Помогло', 'Не зашло'];
const outcomes = [['Легче', 'better'], ['Так же', 'same'], ['Тяжелее', 'harder']];
const softChoices = ['Мягкая пауза', 'Практика дня'];

function mark(r, key) { const m = (r.chat || []).find(x => x.indexOf(key + ':') === 0); return m === undefined ? null : m.slice(key.length + 1); }
function chipsFor(key, titles) { return { id: key, chips: titles.map((t, i) => ({ id: 'chip-' + key + '-' + i, title: t })) }; }

/* Собирает переписку дня из состояния. o: {day, record, yesterday:{day,record}|null, name, profileShort, triggers, gentle,
   hasVoice, weekTitles, chapters, goal, isSunday, isEvening}. Возвращает {lines:[{id,kind,text?}], prompt:{id,chips}|null}. */
function chatScript(o) {
  const d = o.day, r = { ...blankRecord(), ...o.record }, lines = [];
  const name = o.name || '', hi = name ? ', ' + name : '', hasVoice = o.hasVoice !== false, audio = o.audio !== false;
  const mia = (id, text) => lines.push({ id, kind: 'mia', text });
  const user = (id, text) => lines.push({ id, kind: 'user', text });
  const stop = (key, titles) => ({ lines, prompt: chipsFor(key, titles) });

  if (d.day === 1) {
    mia('hi', 'Привет' + hi + '. Я mía. Я буду рядом каждый день — не только когда накрывает.');
    const week = (o.weekTitles || []).slice(0, 3).map(t => '«' + t + '»').join(', ');
    mia('plan-intro', (name ? name + ', по твоим ответам я собрала план для тебя. ' : 'По твоим ответам я собрала план. ') + 'Он состоит из трёх частей: первые 30 дней — опоры' + (week ? ': ' + week + ' и дальше' : '') + '; потом год развития — ' + (o.chapters || 15) + ' глав про интересы, границы, тело, решения и новые отношения; и раздел «Помощь», который открыт всегда — на случай, когда накрывает.');
    mia('goal', 'Наша конечная цель — чтобы ты снова была счастлива: нашла себя, свою внутреннюю опору и жизнь, в которой он — не центр. Я не обещаю сроков. Но каждый день будет шаг в эту сторону, и я буду спрашивать, как тебе, — план подстраивается под тебя.');
    if (o.profileShort && !o.gentle) {
      let told = 'По твоим ответам, сейчас тебе важнее всего «' + o.profileShort.toLowerCase() + '»';
      if (o.triggers && o.triggers.length) told += ', а сильнее всего задевает: ' + o.triggers.slice(0, 2).join(' y ').toLowerCase();
      mia('told', told + '. С этого и начнём.');
    } else mia('told', 'Можно начать совсем с малого. Темп — твой.');
    if (o.goal) mia('goal-told', 'Первым знаком, что стало легче, ты назвала: «' + o.goal.toLowerCase() + '». К этому и идём — шаг за шагом.');
  } else {
    mia('hi', 'Доброе утро' + hi + '. День ' + d.day + '.');
    const y = o.yesterday;
    if (y && isComplete(y.day, y.record) && y.day.steps[0] && y.record.steps && y.record.steps['0']) {
      const first = y.day.steps[0], v = y.record.steps['0'];
      const what = first.kind === 'check' ? '«' + y.day.practiceTitle + '», сделано' : first.kind === 'lines' ? 'твой портрет' : summary(first, v);
      mia('yday', 'Вчера: ' + what + '. Этого у тебя уже никто не отнимет.');
    }
    mia('ask-evening', 'Как прошёл вчерашний вечер?');
    const evening = mark(r, 'evening');
    if (evening === null) return stop('evening', evenings);
    user('evening', evening);
    if (evening === 'Накрывало') mia('evening-reply', 'Спасибо, что сказала. Это не откат — так бывает волнами. Сегодня дам шаг помягче, а раздел «Помощь» рядом.');
    else if (evening === 'Спокойно') mia('evening-reply', 'Запомни это: спокойный вечер — не случайность, это ты сделала.');
    else mia('evening-reply', 'Нормально. Не всё нужно помнить.');
  }
  /* Слоган дня отдельным пузырём владелец убрал 07.10.2026: в переписке он без смысла. */
  if (o.isSunday && !d.rest) mia('sunday', 'Сегодня воскресенье — свободный день, без заданий. Если хочется, вот тема дня; если нет — отдохни, завтра продолжим.');

  mia('ask-mood', 'Как ты сейчас?');
  const mood = mark(r, 'mood');
  if (mood === null) return stop('mood', moods.map(m => m[0]));
  user('mood', mood);
  mia('mood-reply', r.energy === 'low' ? 'Тогда сегодня — самый маленький шаг. Больше не нужно, я подстрою.' : 'Хорошо. Вот твоя программа на сегодня — она короткая.');
  /* audio:false (русская версия без записей) — в плане и чате нет голосового. */
  /* Время (минуты чтения и практики) владелец попросил нигде не называть (07.10.2026). */
  mia('plan', '1 · Почитать «' + d.title + '»\n' + (audio ? '2 · Послушать меня — голосовое ниже\n' + (d.rest ? '3 · Без заданий — только, если захочешь, отметить, что ты себе сегодня разрешаешь' : '3 · Одна практика')
    : (d.rest ? '2 · Без заданий — только, если захочешь, отметить, что ты себе сегодня разрешаешь' : '2 · Одна практика')));
  mia('ask-plan', 'Подходит такой план на сегодня?');
  const planFb = mark(r, 'plan');
  if (planFb === null) return stop('plan', planFeedback);
  user('plan-fb', planFb);
  if (planFb === 'Слишком много') mia('plan-reply', 'Тогда уберём лишнее: сегодня только почитать и первый шаг практики. Остальное — когда захочешь, оно никуда не денется.');
  else if (planFb === 'Хочу другое') mia('plan-reply', 'Хорошо. Во вкладке «Прогресс» видна вся программа — можно открыть другую тему, а я подстроюсь. А пока вот сегодняшняя — на случай, если всё-таки подойдёт.');
  else mia('plan-reply', 'Отлично. Начнём с чтения.');
  lines.push({ id: 'article', kind: 'article' });
  if (!(r.lesson || (r.chat || []).includes('read'))) {
    return { lines, prompt: { id: 'read', chips: [{ id: 'chip-read', title: r.lesson ? 'Дальше' : 'Прочитала' }, { id: 'chip-read-later', title: 'Прочитаю потом' }] } };
  }
  mia('ask-article', 'Было понятно? Что-то отозвалось?');
  const articleFb = mark(r, 'article');
  if (articleFb === null) return stop('article', articleFeedback);
  user('article-fb', articleFb);
  if (!audio) mia('article-reply', articleFb === 'Не очень' ? 'Спасибо за честность. Следующую тему постараюсь рассказать проще.' : 'Хорошо. Тогда — к делу.');
  else {
  mia('article-reply', articleFb === 'Не очень' ? 'Спасибо, что честно. Следующую тему дам проще. А это — то же самое, но живым голосом: иногда так доходит лучше.' : 'Хорошо. Теперь то же самое — голосом.');
  mia('voice-intro', hasVoice ? 'Послушай: так будет легче и понятнее. Я записала это для сегодняшнего дня.' : 'Здесь будет моё голосовое на сегодня — чтобы было легче и понятнее. Появится, когда я его запишу.');
  lines.push({ id: 'voice', kind: 'voice' });
  if (!(r.chat || []).includes('voice')) {
    return { lines, prompt: { id: 'voice', chips: hasVoice ? [{ id: 'chip-voice', title: 'Послушала' }, { id: 'chip-voice-later', title: 'Дальше' }] : [{ id: 'chip-voice-later', title: 'Дальше' }] } };
  }
  if (hasVoice) {
    mia('ask-voicefb', 'Как тебе голосовое?');
    const voiceFb = mark(r, 'voicefb');
    if (voiceFb === null) return stop('voicefb', voiceFeedback);
    user('voicefb', voiceFb);
    mia('voicefb-reply', voiceFb === 'Не зашло' ? 'Поняла. Буду давать больше текстом — а голосовые оставлю для вечеров, когда читать нет сил.' : 'Рада. Тогда — к делу.');
  }
  }
  const complete = isComplete(d, r), stepsWord = d.steps.length === 1 ? 'один шаг' : d.steps.length + ' шага';
  if (d.rest) {
    mia('practice-intro', complete ? 'Готово. Вот что ты отметила:' : 'Сегодня день без заданий. Если хочешь, отметь, что ты себе сегодня разрешаешь; если нет — это тоже нормально.');
  } else if (r.energy === 'low' && !complete) {
    mia('soft-offer', 'Если сил сегодня мало, практика может подождать. Вместо неё — мягкая пауза: три вещи, которые видишь, два звука и одна точка опоры.');
    const soft = mark(r, 'soft');
    if (soft === null) return stop('soft', softChoices);
    user('soft', soft);
    mia('practice-intro', soft === softChoices[0] ? 'Хорошо. Пауза засчитана как сегодняшний шаг. Практика дня ждёт здесь — на случай, если потом захочется.' : 'Хорошо, тогда к практике: ' + stepsWord + '. Всегда есть вариант полегче.');
  } else {
    mia('practice-intro', complete ? 'Практика сделана. Вот твои ответы:' : 'Теперь — к практике: ' + stepsWord + '. Всегда есть вариант полегче.');
  }
  lines.push({ id: 'practice', kind: 'practice' });
  const numberStep = d.steps.findIndex(s => s.kind === 'number');
  const hasChecks = (r.checks !== null && r.checks !== undefined) || (numberStep >= 0 && stepDone(d.steps[numberStep], r.steps[String(numberStep)]));
  const eveningCheck = () => {
    if (!d.evening || hasChecks) return null;
    mia('ask-checks', 'Прежде чем закрыть день: сколько раз ты сегодня заходила на его страницу? Только число, без оценок.');
    lines.push({ id: 'checks', kind: 'checks' });
    return { lines, prompt: null };
  };
  const done = complete || (r.skip && !d.rest);
  if (!(done || (d.rest && r.lesson))) return (o.isEvening ? eveningCheck() : null) || { lines, prompt: null };
  /* Итог дня («Te llevas: …» и «guardado en Cuenta → Guardado») владелец убрал 07.10.2026; остаётся только своя фраза дня (outro), если она есть. */
  if (complete && d.outro && d.outro[0]) mia('keeps', d.outro[0]);
  mia('ask-outcome', 'Как ты сейчас, после?');
  const outcome = mark(r, 'outcome');
  if (outcome === null) return stop('outcome', outcomes.map(x => x[0]));
  user('outcome', outcome);
  if (r.outcome === 'better') mia('bye', 'Запомни это ощущение: к нему можно вернуться. Завтра тебя ждёт новый день, и я спрошу, как прошёл вечер. Я рядом.');
  else if (r.outcome === 'harder') { mia('bye', 'Так бывает: шаг сделан, а легче не стало сразу. Это не откат. Если накрывает — вкладка «Помощь» открыта всегда. Завтра спрошу, как ты.'); lines.push({ id: 'help-link', kind: 'help' }); }
  else mia('bye', '«Так же» — тоже честный ответ. Сегодня ты сделала больше, чем кажется. Завтра открою следующий день и спрошу, как прошёл вечер. Я рядом.');
  const check = eveningCheck(); if (check) return check;
  if (d.evening && r.checks !== null && r.checks !== undefined) mia('checks-done', 'Записала: ' + r.checks + '. Без оценок и выводов — просто ещё одна точка на твоей кривой.');
  return { lines, prompt: null };
}

/* Ответ чипом (ChatTab.answer): меняет запись дня. Возвращает {record, pause} — pause: открыть мягкую паузу. */
function applyChip(record, promptId, chip) {
  const r = { ...blankRecord(), ...record, chat: [...((record && record.chat) || [])] };
  const i = Number(String(chip.id).split('-').pop()) || 0;
  const add = m => { if (!r.chat.includes(m)) r.chat.push(m); };
  let pause = false;
  switch (promptId) {
    case 'mood': { const m = moods[Math.min(i, moods.length - 1)]; r.energy = m[1]; r.chat.push('mood:' + m[0]); break; }
    case 'plan': if (chip.title === 'Слишком много') r.energy = 'low'; r.chat.push('plan:' + chip.title); break;
    case 'read': add('read'); break;
    case 'voice': add('voice'); break;
    case 'soft': if (chip.title === softChoices[0]) { r.skip = true; pause = true; } r.chat.push('soft:' + chip.title); break;
    case 'outcome': { const o = outcomes[Math.min(i, outcomes.length - 1)]; r.outcome = o[1]; r.chat.push('outcome:' + o[0]); break; }
    default: add(promptId + ':' + chip.title);
  }
  return { record: r, pause };
}

/* ---------- Ответы воронки (Funnel.swift): имя, профиль, триггеры, цель, общие дети ---------- */
function funnelInfo(quiz, content) {
  const answers = (quiz && quiz.answers) || {};
  const one = id => { const a = answers[id]; return typeof a === 'string' && a !== 'skip' ? a : null; };
  const labels = id => {
    const q = content.questions.find(x => x.id === id), a = answers[id];
    if (!q || !a || a === 'skip') return [];
    return (Array.isArray(a) ? a : [a]).map(v => (q.options.find(o => o.value === v) || {}).label).filter(Boolean);
  };
  const focus = one('focus'), key = focus && focus !== 'gentle' && content.profiles[focus] ? focus : 'gentle';
  return {
    name: (quiz && quiz.contact && typeof quiz.contact.name === 'string') ? quiz.contact.name.trim() : '',
    gentle: key === 'gentle', profileShort: key === 'gentle' ? null : content.profiles[key].short,
    triggers: labels('triggers'), goal: labels('goal')[0] || null,
    sharesKids: ['shared', 'often'].includes(one('contact'))
  };
}

/* ---------- Доступ: приложение открыто только с активной подпиской ----------
   account — window.MiaAccount (или null: тогда как без входа). В тестовом режиме оплаты открывает и тестовый доступ. */
function accessGate(o) {
  const acc = o.account && typeof o.account.access === 'function' ? safe(() => o.account.access()) : null;
  if (acc && acc.active === true) return { open: true, source: 'account' };
  /* Пауза (08.10.2026): программа закрыта, «Ayuda» и «Cuenta» открыты — веб-приложение пускает внутрь с paused. */
  if (acc && acc.status === 'paused') return { open: true, source: 'account', paused: true };
  if (o.config && o.config.paymentMode === 'test') {
    if (o.state && o.state.testAccess) return { open: true, source: 'test' };
    const legacy = o.funnelAccess;
    if (legacy && legacy.active === true && ['prototype', 'test-payment', 'stripe'].includes(legacy.source)) return { open: true, source: 'test' };
  }
  const session = o.account && typeof o.account.session === 'function' ? safe(() => o.account.session()) : null;
  return { open: false, screen: session ? 'inactive' : 'login' };
}
function safe(fn) { try { return fn(); } catch { return null; } }

/* «Leer o escuchar» (FormatSheet iOS): выбор в «Cuenta» → profile.format; иначе — ответ «format» из теста воронки. */
function lessonFormat(profile, quiz) {
  const f = profile && profile.format; if (f === 'text' || f === 'audio') return f;
  const q = quiz || {}, plan = q.plan && q.plan.format, a = q.answers && q.answers.format;
  return plan === 'audio' || a === 'audio' ? 'audio' : 'text';
}
/* Приветствие после первого входа (AppWelcomeView iOS) — один раз на устройство.
   o: {welcomed, fresh (в этом браузере ещё нет программы и записей), source ('account'|'test'), asked (?welcome=1)}.
   Возвращает 'show' | 'skip' (отметить как показанное: давняя пользовательница) | 'none' (ничего не менять). */
function welcomeDue(o) {
  if (o.asked) return 'show';
  if (o.welcomed) return 'none';
  if (o.source !== 'account') return 'none';
  return o.fresh ? 'show' : 'skip';
}

/* Запись лекции дня: day-NN.m4a в облаке, NN — audioTopic (совпадает с номером дня). */
function audioURL(day, base) { return String(base || AUDIO_BASE).replace(/\/+$/, '') + '/day-' + pad(day.audioTopic || day.day) + '.m4a'; }
function clock(sec) { const s = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0; return Math.floor(s / 60) + ':' + pad(s % 60); }

/* Цвета экранов практики (PracticeTone): лаванда → персик → лайм → ночь, ночные дни начинаются с тёмного. */
const tones = ['lilac', 'peach', 'lime', 'night'];
function tone(index, type) { const shift = { sleep: 3, ground: 3, rest: 1, movement: 2, connect: 1 }[type] || 0; return tones[(index + shift) % tones.length]; }

/* ---------- Подписка в «Cuenta» (07.10.2026) ----------
   a — доступ: из воронки {tariff, price, renewPrice, openedAt, renews, canceledAt, upsell} или с сервера {tariff, price, periodEnd, willRenew}.
   Возвращает текущий период и следующее списание: {tariff, price, renewPrice, intro (период по цене входа), start, end, renews, next {at, amount, tariff} | null, ended, paid}.
   paid — сколько уже списано с первой оплаты (первый период по цене входа, дальше по обычной). В демо период считается от даты первой оплаты:
   неделя — 7 дней, месяц и 3 месяца (тариф months4, решение владельца 08.10.2026) — календарные месяцы;
   тарифы второго квиза /q/ (weeks4, weeks12, weeks24) — 4, 12 и 24 недели. */
const DAY_MS = 86400000;
function addPeriod(date, tariff, n) {
  const d = new Date(+date), k = n == null ? 1 : n;
  const weeks = tariff === 'week' ? 1 : /^weeks(4|12|24)$/.test(tariff) ? Number(tariff.slice(5)) : 0;
  if (weeks) d.setDate(d.getDate() + 7 * weeks * k); else d.setMonth(d.getMonth() + (tariff === 'months4' ? 3 : 1) * k);
  return d;
}
function subscriptionPlan(a, nowDate) {
  if (!a || !a.active) return null;
  const now = +nowDate, num = v => Number(v) > 0 ? Number(v) : null, round = v => Math.round(v * 100) / 100;
  const tariff = a.tariff || 'month', first = num(a.price), renew = num(a.renewPrice) || first;
  const renews = a.renews !== false && a.willRenew !== false && !a.canceledAt;
  if (a.periodEnd && !a.openedAt) {
    const end = new Date(a.periodEnd); if (isNaN(end)) return null;
    return { tariff, price: first, renewPrice: renew, intro: false, start: null, end, renews: a.willRenew === true, ended: false, paid: null, next: a.willRenew === true ? { at: end, amount: renew || first, tariff } : null };
  }
  const opened = new Date(a.openedAt || nowDate); if (isNaN(opened)) return null;
  /* После доплаты за 3 месяца (воронка или приложение) price = цена 3 месяцев: оплачено ровно столько. */
  let start = opened, end = addPeriod(start, tariff), price = first, paid = first || 0;
  const cancelAt = a.canceledAt ? +new Date(a.canceledAt) : null;
  for (let i = 0; end <= now && i < 1000; i++) {
    if (cancelAt != null && cancelAt <= +end) return { tariff, price, renewPrice: renew, intro: false, start, end, renews: false, ended: true, next: null, paid: round(paid) };
    price = renew; paid += renew || 0; start = end; end = addPeriod(start, tariff);
  }
  return { tariff, price, renewPrice: renew, intro: !!(price && renew && renew > price), start, end, renews, ended: false, paid: round(paid), next: renews ? { at: end, amount: renew, tariff } : null };
}
/* Разница по местным часам: при переводе часов между датами сутки длятся 23 или 25 ч, и счётчик прыгал на день. */
function daysUntil(date, nowDate) {
  const a = new Date(date), b = new Date(nowDate);
  return Math.max(0, Math.ceil((+a - +b - (a.getTimezoneOffset() - b.getTimezoneOffset()) * 60000) / DAY_MS));
}

/* Предложение первого месяца (решение владельца 07.10.2026): купившим неделю или месяц в первые 30 дней после первой оплаты —
   перейти на 3 месяца по цене входа (priceMonths4), доплатив остаток: priceMonths4 минус уже оплаченное. 3 месяца считаются от первой оплаты,
   дальше — обычная цена (priceMonths4Full). После 30 дней скидки нет. Только если обычная цена задана в конфиге и выше цены входа.
   Не показывается после отмены и в момент отмены. Это расчёт демо и тестового режима; в live сумму считает Stripe (liveUpgradeOffer). */
const OFFER_DAYS = 30;
function upgradeOffer(a, nowDate, prices) {
  const p = prices || {}, price = Number(p.priceMonths4), full = Number(p.priceMonths4Full);
  if (!a || !a.active || !a.openedAt || !(full > price) || !(price > 0)) return null;
  if (a.tariff === 'months4' || /^weeks/.test(a.tariff || '') || a.upsell || a.canceledAt || a.renews === false || a.willRenew === false) return null;
  const opened = new Date(a.openedAt); if (isNaN(opened)) return null;
  const until = new Date(+opened + OFFER_DAYS * DAY_MS), day = Math.floor((+nowDate - +opened) / DAY_MS);
  if (+nowDate >= +until || day < 0) return null;
  const plan = subscriptionPlan(a, nowDate), paid = plan && plan.paid || 0, extra = Math.round((price - paid) * 100) / 100;
  if (!(extra > 0)) return null;
  return { price, full, until, day, daysLeft: daysUntil(until, nowDate), perDay: Math.round(price / MONTHS4_DAYS * 100) / 100, paid, extra, end: addPeriod(opened, 'months4') };
}
const MONTHS4_DAYS = 91;
/* Live (оплата Stripe): переход на 3 месяца — только подписке с сайта (source stripe) на неделе или месяце, с продлением.
   App Store здесь не предлагаем: её тариф меняют только в App Store. Сумма, конец нового периода и срок (30 дней от первой оплаты)
   берутся из ответа сервера GET /app/subscription/upgrade-preview — это счёт-предпросмотр Stripe, поэтому списывается ровно показанное. */
function liveOfferEligible(a) {
  return !!a && a.active === true && a.source === 'stripe' && (a.tariff === 'week' || a.tariff === 'month') && a.willRenew !== false;
}
function liveUpgradeOffer(a, preview, nowDate) {
  if (!liveOfferEligible(a) || !preview || typeof preview !== 'object') return null;
  const extra = Number(preview.amountDue), price = Number(preview.price), end = new Date(preview.newPeriodEnd || NaN);
  const until = preview.offerEndsAt ? new Date(preview.offerEndsAt) : null;
  if (!Number.isFinite(extra) || extra < 0 || !(price > 0) || isNaN(end)) return null;
  if (until && (isNaN(until) || +nowDate >= +until)) return null;
  const daysLeft = until ? daysUntil(until, nowDate) : null;
  return { live: true, price, extra, end, until, daysLeft, day: daysLeft == null ? null : Math.max(0, OFFER_DAYS - daysLeft),
    currency: String(preview.currency || 'EUR'), prorationDate: Number(preview.prorationDate) || null, perDay: Math.round(price / MONTHS4_DAYS * 100) / 100, full: 0, paid: null };
}
/* Когда показать всплывающее предложение: в середине месяца (дни 13–19) и в конце (дни 25–29), каждое один раз. */
function offerMoment(offer, seen) {
  /* В live всплывающих нет: без цены входа это обычная смена тарифа, и «срок предложения» был бы ложной срочностью. */
  if (!offer || offer.live) return null;
  const s = seen || {};
  if (offer.day >= 13 && offer.day < 20 && !s.mid) return 'mid';
  if (offer.day >= 25 && offer.day < OFFER_DAYS && !s.end) return 'end';
  return null;
}

/* «Quiero escribirle» (07.10.2026): разбор сообщения перед отправкой — правила без модели и без сервера.
   text — её сообщение, o: {why, hour}. Возвращает список находок по порядку важности:
   night (22:00–7:00), question (ждёшь ответа), blame (упрёк «siempre/nunca»), plead (просьба вернуться, «te echo de menos»),
   long (больше 280 знаков), practical (повод — практический: оставить только факты), calm (ничего из этого). */
const BLAME = ['всегда', 'никогда', 'из-за тебя', 'ты сделал', 'ты мне сделал', 'как ты мог', 'тебе всё равно', 'тебе на меня плевать', 'тебе всё равно', 'тебе было всё равно', 'как ты мог', 'me mentiste', 'ты мне изменил', 'me utilizaste', 'ты просто', 'эгоист', 'egoista', 'ни разу', 'это твоя вина', 'ты виноват'];
const PLEAD = ['вернись', 'вернуться', 'ты мне нужен', 'скучаю', 'пожалуйста', 'люблю', 'ещё один шанс', 'ещё шанс', 'скучаю по тебе', 'очень скучаю', 'vuelvas', 'volvamos', 'я всё ещё люблю тебя', 'я тебя люблю', 'без тебя', 'мне нужно тебя увидеть', 'прости меня', 'perdoname', 'porfa', 'porfavor', 'давай попробуем'];
function messageReview(text, o) {
  const t = String(text || '').toLowerCase(), opt = o || {}, out = [];
  const words = ' ' + t.replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ', has = list => list.some(w => words.includes(' ' + w + ' '));
  const hour = Number.isFinite(opt.hour) ? opt.hour : 12;
  if (hour >= 22 || hour < 7) out.push('night');
  if (t.includes('?')) out.push('question');
  if (has(BLAME)) out.push('blame');
  if (has(PLEAD)) out.push('plead');
  if ([...t.trim()].length > 280) out.push('long');
  if (opt.why === 'practical') out.push('practical');
  if (!out.filter(x => x !== 'night').length) out.push('calm');
  return out;
}

/* «Escríbenos» (08.10.2026): чат поддержки. supportMode — live (настоящий помощник на backend/) или mock (тест без
   сервера и демо /ru/: прежний макет). supportMessages — тело запроса: последние 20 сообщений без служебных заметок,
   каждое до 2000 знаков. supportResult — ответ authorizedFetch → запись истории: ответ помощника или спокойная
   заметка с почтой (503, 429, сеть, закрытая сессия, сбой). */
const SUPPORT_TEXT = {
  unavailable: 'Чат сейчас недоступен. Напиши нам на support@miadays.app — ответим по почте.',
  limited: 'Мы много успели обсудить за короткое время. Передохни и возвращайся позже или напиши нам на support@miadays.app.',
  failed: 'Сейчас не получается ответить. Попробуй через минуту или напиши нам на support@miadays.app.',
  offline: 'Нет связи. Проверь интернет и отправь сообщение ещё раз, когда захочешь.',
  expired: 'Сессия закрылась. Войди снова по почте и паролю или напиши нам на support@miadays.app.'
};
function supportMode(o) {
  const x = o || {};
  return x.paymentMode === 'live' && !x.demo && x.session && x.fetch ? 'live' : 'mock';
}
function supportMessages(items) {
  return (Array.isArray(items) ? items : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-20).map(m => ({ role: m.role, content: m.text.trim().slice(0, 2000) }));
}
function supportResult(r) {
  const x = r || {}, body = x.body && typeof x.body === 'object' ? x.body : {};
  if (x.ok && typeof body.reply === 'string' && body.reply.trim()) return { role: 'assistant', text: body.reply.trim(), handoff: body.handoff === true };
  if (x.error === 'offline') return { role: 'note', text: SUPPORT_TEXT.offline };
  if (x.error === 'expired' || x.error === 'nosession') return { role: 'note', text: SUPPORT_TEXT.expired };
  if (x.status === 503) return { role: 'note', text: SUPPORT_TEXT.unavailable };
  if (x.status === 429) return { role: 'note', text: SUPPORT_TEXT.limited };
  return { role: 'note', text: SUPPORT_TEXT.failed };
}

/* ---------- Отмена и «Escríbenos» (документ владельца «Отмена подписки и поддержка», 08.10.2026) ---------- */
/* Какой лист отмены: 'refund' — первые 14 дней после первой оплаты (окно и сумму даёт сервер: refundableUntil, refundAmount;
   в демо — openedAt + 14 дней и цена), иначе 'normal'. */
function cancelVariant(a, nowDate) {
  if (!a) return 'normal';
  const until = a.refundableUntil ? +new Date(a.refundableUntil) : a.openedAt && !a.canceledAt && !a.refundedAt ? +new Date(a.openedAt) + 14 * DAY_MS : NaN;
  return Number.isFinite(until) && +nowDate <= until ? 'refund' : 'normal';
}
const api = { cancelVariant, TOTAL_DAYS, messageReview, SUPPORT_TEXT, supportMode, supportMessages, supportResult, INPUT_LIMIT, STORAGE_KEY, AUDIO_BASE, addPeriod, subscriptionPlan, daysUntil, upgradeOffer, liveOfferEligible, liveUpgradeOffer, offerMoment, blankState, blankRecord, load, save, wipe, exportData,
  SYNC_KEY, DOC_SCHEMA, same, mergeDocuments, buildDocument, applyDocument, loadSync, saveSync, wipeSync, dateKey, now, rec, touched, ensure, advance, currentDay, canOpen, isSunday, isEvening,
  choices, stepDone, doneCount, isComplete, nextUndone, setStep, summary, message, checks, curve, activeDays,
  heroLines, moods, evenings, planFeedback, articleFeedback, voiceFeedback, outcomes, softChoices, chatScript, applyChip, funnelInfo, accessGate, audioURL, clock, tone, lessonFormat, welcomeDue };
root.MiaWebCore = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
