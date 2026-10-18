/* 英文教練 — 前端邏輯（單人使用、手機優先） */
'use strict';
const SUPABASE_URL = 'https://wkurcpnreriqyserpsrq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kjZW8UQ-enXvZjNExMFRWw_ukWE8TzU'; // 公開鑰匙（只能做登入，資料全靠 RLS 鎖）
const FN_URL = SUPABASE_URL + '/functions/v1/coach';
const DEFAULT_EMAIL = 'rongxuan1109@gmail.com';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const S = { user: null, profile: null, curriculum: [], lesson: null, page: 'today', assess: null };

/* ---------- 小工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
function busy(on, text) { $('#busy').classList.toggle('show', !!on); if (text) $('#busyText').textContent = text; }
function todayStr(d = new Date()) { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
function addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return todayStr(d); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
const norm = s => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\bi'm\b/g, 'i am').replace(/\bdon't\b/g, 'do not').replace(/\bcan't\b/g, 'cannot').replace(/\bit's\b/g, 'it is').replace(/\bthat's\b/g, 'that is').replace(/\bi'd\b/g, 'i would').replace(/\byou're\b/g, 'you are').replace(/\bwhat's\b/g, 'what is').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
const SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const speakBtn = (text, cls = '') => `<button class="speak ${cls}" data-say="${esc(text)}" aria-label="朗讀">${SPK}</button>`;
const DRILL_ZH = { substitution: '代換', transformation: '變化', response: '應答', expansion: '擴展' };

/* ---------- 朗讀與語音輸入（瀏覽器內建，不用外部服務） ---------- */
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter(v => /^en[-_]US/i.test(v.lang));
  voice = vs.find(v => /Samantha|Google US|Ava|Allison/i.test(v.name)) || vs[0] || speechSynthesis.getVoices().find(v => /^en/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text, rate) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; if (voice) u.voice = voice;
  u.rate = rate ?? Number(S.profile?.tts_rate ?? 0.9);
  speechSynthesis.speak(u);
}
function speakList(texts) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  texts.forEach(t => { const u = new SpeechSynthesisUtterance(t); u.lang = 'en-US'; if (voice) u.voice = voice; u.rate = Number(S.profile?.tts_rate ?? 0.9); speechSynthesis.speak(u); });
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen(onResult, btn) {
  if (!SR) { toast('這個瀏覽器不支援語音輸入，請改用打字'); return; }
  const r = new SR(); r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
  btn?.classList.add('rec');
  r.onresult = e => { onResult(e.results[0][0].transcript); };
  r.onerror = e => { toast('聽不清楚，再試一次或改打字'); };
  r.onend = () => btn?.classList.remove('rec');
  try { r.start(); } catch { btn?.classList.remove('rec'); }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-say]'); if (b) speak(b.dataset.say);
});

/* ---------- 呼叫老師（後台函式） ---------- */
async function coach(action, payload = {}, text = '老師正在想…') {
  busy(true, text);
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(FN_URL, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify({ action, payload }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || '老師沒有回應');
    return d.data;
  } finally { busy(false); }
}

/* ---------- 資料 ---------- */
async function loadProfile() {
  const { data } = await sb.from('profile').select('*').eq('user_id', S.user.id).maybeSingle();
  if (!data) {
    const row = { user_id: S.user.id };
    const { data: created, error } = await sb.from('profile').insert(row).select().single();
    if (error) throw error; S.profile = created;
  } else S.profile = data;
  const { data: cur } = await sb.from('curriculum').select('*').order('week');
  S.curriculum = cur || [];
}
async function saveProfile(patch) {
  const { data, error } = await sb.from('profile').update(patch).eq('user_id', S.user.id).select().single();
  if (error) { toast('儲存失敗：' + error.message); return; }
  S.profile = data;
}
async function addCards(list, source) {
  if (!list?.length) return 0;
  const { data: existing } = await sb.from('cards').select('en').eq('user_id', S.user.id);
  const have = new Set((existing || []).map(c => norm(c.en)));
  const rows = list.filter(c => c.en && !have.has(norm(c.en))).map(c => ({ user_id: S.user.id, kind: c.kind || 'sentence', en: c.en.trim(), zh: c.zh || '', context: c.context || '', source: source || '' }));
  if (!rows.length) return 0;
  const { error } = await sb.from('cards').insert(rows);
  if (error) toast('加卡失敗：' + error.message);
  return rows.length;
}
async function logError(pattern, said, correct) {
  await sb.from('errors').insert({ user_id: S.user.id, pattern: pattern || '其他', said: said || '', correct: correct || '', lesson_id: S.lesson?.id || null });
}
/* SM-2 簡化版：答對拉長間隔，答錯今天重排 */
function schedule(card, correct) {
  const today = todayStr();
  let { interval_days: iv, ease, reps, lapses } = card;
  iv = Number(iv); ease = Number(ease);
  if (!correct) { reps = 0; lapses += 1; ease = Math.max(1.3, ease - 0.2); iv = 0; return { interval_days: 0, ease, reps, lapses, due_at: today, last_review: new Date().toISOString() }; }
  reps += 1;
  if (reps === 1) iv = 1; else if (reps === 2) iv = 3; else iv = Math.round(iv * ease);
  iv = Math.min(iv, 120);
  return { interval_days: iv, ease, reps, lapses, due_at: addDays(today, iv), last_review: new Date().toISOString() };
}
async function reviewCard(card, correct) {
  const patch = schedule(card, correct);
  await sb.from('cards').update(patch).eq('id', card.id);
  await sb.from('reviews').insert({ user_id: S.user.id, card_id: card.id, correct, grade: correct ? 4 : 1 });
}

/* ---------- 字彙測驗（五級 × 4 字，從詞庫隨機抽） ---------- */
const BANDS = [
  { size: 500, words: ['time', 'people', 'water', 'house', 'eat', 'good', 'friend', 'money', 'work', 'happy', 'food', 'day', 'help', 'big', 'small', 'come', 'see', 'want', 'like', 'new', 'old', 'morning', 'family', 'school', 'again', 'because', 'always', 'together'] },
  { size: 500, words: ['weather', 'price', 'ticket', 'cheap', 'expensive', 'street', 'hungry', 'tired', 'early', 'breakfast', 'kitchen', 'airport', 'hospital', 'teacher', 'meeting', 'summer', 'bridge', 'chicken', 'enjoy', 'finish', 'quiet', 'busy', 'coffee', 'window', 'borrow', 'arrive', 'practice', 'dangerous'] },
  { size: 500, words: ['receipt', 'delay', 'luggage', 'schedule', 'neighbor', 'discount', 'recipe', 'umbrella', 'injury', 'exercise', 'stretch', 'comfortable', 'improve', 'suggest', 'passenger', 'headache', 'towel', 'nervous', 'repair', 'reserve', 'destination', 'customer', 'opinion', 'environment', 'direction', 'journey', 'patient', 'mention'] },
  { size: 500, words: ['appointment', 'symptom', 'swelling', 'posture', 'flexible', 'recover', 'prescription', 'insurance', 'allergy', 'adjust', 'balance', 'muscle', 'ankle', 'elbow', 'strain', 'routine', 'gradually', 'annoying', 'reliable', 'vehicle', 'pedestrian', 'souvenir', 'itinerary', 'refund', 'complain', 'convenient', 'temporary', 'available'] },
  { size: 1000, words: ['inflammation', 'tendon', 'ligament', 'numbness', 'persistent', 'fatigue', 'mobility', 'consistent', 'mandatory', 'negotiate', 'evidence', 'substantial', 'reluctant', 'stiffness', 'vulnerable', 'accommodate', 'ambiguous', 'cumulative', 'tolerate', 'interpret', 'remedy', 'nuisance', 'deteriorate', 'alleviate', 'compensate', 'sedentary', 'chronic', 'acute'] },
];
function sampleVocab() {
  return BANDS.map((b, i) => [...b.words].sort(() => Math.random() - .5).slice(0, 4).map(w => ({ w, band: i })));
}
function estimateVocab(answers) { // answers: [{band, a: 1|0.5|0}]
  let est = 0; const detail = {};
  BANDS.forEach((b, i) => { const as = answers.filter(x => x.band === i); const f = as.length ? as.reduce((s, x) => s + x.a, 0) / as.length : 0; est += b.size * f; detail['level' + (i + 1)] = as.map(x => `${x.w}:${x.a === 1 ? '認識' : x.a === .5 ? '不確定' : '不認識'}`).join(', '); });
  return { est: Math.round(est / 10) * 10, detail };
}
const cefrFromVocab = v => v < 600 ? 'A1' : v < 1500 ? 'A2' : 'B1';
function runVocabTest(container, onDone) {
  const words = sampleVocab().flat(); let i = 0; const answers = [];
  const render = () => {
    if (i >= words.length) { onDone(estimateVocab(answers), answers); return; }
    const it = words[i];
    container.innerHTML = `<div class="card"><div class="meta">字彙測驗 ${i + 1} / ${words.length}</div>
      <div class="progress"><div style="width:${i / words.length * 100}%"></div></div>
      <div class="row between" style="margin:14px 0"><div class="en" style="font-size:28px">${esc(it.w)}</div>${speakBtn(it.w)}</div>
      <div class="hint">看到這個字，你知道意思嗎？誠實選就好，這只是幫你找起點。</div>
      <div class="chips" style="margin-top:12px">
        <button class="chip" data-a="1">認識</button><button class="chip" data-a="0.5">不確定</button><button class="chip" data-a="0">不認識</button>
      </div></div>`;
    $$('.chip', container).forEach(c => c.onclick = () => { answers.push({ w: it.w, band: it.band, a: Number(c.dataset.a) }); i++; render(); });
  };
  render();
}

/* ---------- 頁面切換 ---------- */
function showPage(name) {
  S.page = name;
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'page-' + name));
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.page === name));
  speechSynthesis?.cancel?.(); if (typeof stopDrillTimers === 'function') stopDrillTimers();
  ({ today: renderToday, assess: renderAssess, cards: renderCards, progress: renderProgress, settings: renderSettings })[name]?.();
}
$$('.tab').forEach(t => t.onclick = () => showPage(t.dataset.page));
$('#btnSpeakAll').onclick = () => { const texts = $$('.page.on .en').map(e => e.textContent.trim()).filter(Boolean); if (!texts.length) return toast('這頁沒有英文可以唸'); speakList(texts); };
function setTop(title, sub) { $('#topTitle').textContent = title; $('#topSub').textContent = sub || ''; }

/* ---------- 課綱位置計算 ---------- */
function weekInfo() {
  const p = S.profile, today = todayStr();
  const start = p.sprint_start || today;
  const days = Math.max(0, daysBetween(start, today));
  const maxWeek = Math.max(...S.curriculum.map(c => c.week));
  let week = Math.min(Math.floor(days / 7) + 1, maxWeek);
  let row = S.curriculum.find(c => c.week === week);
  let locked = null;
  if (row && row.unlock_vocab > p.vocab_est) { locked = row; const ok = S.curriculum.filter(c => c.unlock_vocab <= p.vocab_est && !c.is_buffer); row = ok[ok.length - 1]; week = row.week; }
  return { row, week, stage: row?.stage || 1, dayInWeek: days % 7 + 1, days, locked, isSunday: new Date().getDay() === 0 };
}

/* ---------- 今日課程 ---------- */
async function renderToday() {
  const page = $('#page-today');
  if (!S.profile.assessed) { setTop('程度評估', '第一次使用先花 15 分鐘找起點'); page.innerHTML = `<div class="card"><h3>歡迎！先做一次程度評估</h3><p class="hint" style="font-size:14px">三個小測驗：字彙 20 題、聽讀一小段、寫幾句英文。不是考試，是幫老師知道從哪裡開始陪你。</p><button class="btn full" id="goAssess">開始評估（約 15 分鐘）</button></div>`; $('#goAssess').onclick = () => { S.assess = { step: 'vocab' }; showPage('assess'); }; return; }
  const wi = weekInfo();
  if (wi.row && (S.profile.week !== wi.week || S.profile.stage !== wi.stage)) await saveProfile({ week: wi.week, stage: wi.stage });
  setTop('今日課程', `第 ${wi.stage} 階段・第 ${wi.week} 週・第 ${wi.dayInWeek} 天｜${wi.row?.topic_zh || ''}`);
  page.innerHTML = '';
  // 週日字彙重測提醒
  const thisWeekStart = addDays(todayStr(), -new Date().getDay());
  if (wi.isSunday && (!S.profile.last_vocab_test || S.profile.last_vocab_test < thisWeekStart)) {
    page.insertAdjacentHTML('beforeend', `<div class="card" style="border-color:var(--warm)"><h3>每週字彙重測</h3><p class="hint" style="font-size:14px">今天是週日，花 3 分鐘重測 20 個字，看看字彙量有沒有長。</p><button class="btn full" id="weeklyVocab">開始重測</button></div>`);
    $('#weeklyVocab').onclick = () => { const box = document.createElement('div'); page.prepend(box); runVocabTest(box, async (res) => { await sb.from('assessments').insert({ user_id: S.user.id, kind: 'weekly_vocab', vocab_est: res.est, cefr: cefrFromVocab(res.est), raw: res.detail }); await saveProfile({ vocab_est: res.est, last_vocab_test: todayStr() }); toast(`這次估計字彙量：${res.est} 字`); renderToday(); }); };
  }
  if (wi.locked) page.insertAdjacentHTML('beforeend', `<div class="card"><div class="meta">下一階段「${esc(wi.locked.topic_zh)}」需要字彙量 ${wi.locked.unlock_vocab} 字，你目前 ${S.profile.vocab_est} 字。先把現在的主題練熟，字彙到了就自動解鎖。</div></div>`);

  // 今日課程資料
  const today = todayStr();
  let { data: lesson } = await sb.from('lessons').select('*').eq('user_id', S.user.id).eq('lesson_date', today).maybeSingle();
  if (!lesson) {
    const { data: created, error } = await sb.from('lessons').insert({ user_id: S.user.id, lesson_date: today, stage: wi.stage, week: wi.week, topic: wi.row?.topic_zh || '', content: {}, progress: {} }).select().single();
    if (error) { page.insertAdjacentHTML('beforeend', `<div class="card">建立今天課程失敗：${esc(error.message)}</div>`); return; }
    lesson = created;
  }
  S.lesson = lesson;
  const box = document.createElement('div'); page.appendChild(box);
  renderLesson(box, wi);
}

function stepsHTML(pr, cur) {
  const names = [['review', '複習'], ['input', '輸入'], ['drill', '快答'], ['read', '朗讀'], ['output', '輸出']];
  return `<div class="steps">${names.map(([k, n]) => `<div class="step ${pr[k]?.done ? 'done' : cur === k ? 'on' : ''}">${n}${pr[k]?.done ? ' ✓' : ''}</div>`).join('')}</div>`;
}
async function saveProgress() { await sb.from('lessons').update({ progress: S.lesson.progress, content: S.lesson.content }).eq('id', S.lesson.id); }

async function renderLesson(box, wi) {
  const L = S.lesson; const pr = L.progress || {}; L.progress = pr;
  const cur = !pr.review?.done ? 'review' : !pr.input?.done ? 'input' : !pr.drill?.done ? 'drill' : !pr.read?.done ? 'read' : !pr.output?.done ? 'output' : 'done';
  if (cur === 'done') return renderFinish(box, wi);
  if (cur === 'review') return renderReview(box, wi);
  // 需要課程內容
  if (!L.content?.dialogue) {
    box.innerHTML = stepsHTML(pr, cur) + `<div class="card"><h3>今天的課還沒準備好</h3><p class="hint" style="font-size:14px">老師會依你的程度與本週主題「${esc(wi.row?.topic_zh || '')}」準備一段對話、新單字、句型快答、朗讀短文和一個輸出任務。</p><button class="btn full" id="genLesson">請老師準備今天的課</button></div>`;
    $('#genLesson').onclick = async () => {
      try {
        const weekStart = addDays(todayStr(), -(wi.dayInWeek - 1));
        const { data: learned } = await sb.from('cards').select('en').eq('user_id', S.user.id).eq('kind', 'word').gte('created_at', weekStart + 'T00:00:00');
        const content = await coach('lesson_generate', { day_in_week: wi.dayInWeek, learned_words: (learned || []).map(c => c.en) }, '老師正在準備今天的課（約 30 秒）…');
        L.content = content; await saveProgress(); renderLesson(box, wi);
      } catch (e) { toast(e.message, 5000); }
    };
    return;
  }
  if (cur === 'input') return renderInput(box, wi);
  if (cur === 'drill') return renderDrill(box, wi);
  if (cur === 'read') return renderReadAloud(box, wi);
  if (cur === 'output') return renderOutput(box, wi);
}

/* 複習 */
async function renderReview(box, wi) {
  const pr = S.lesson.progress;
  const { data: due } = await sb.from('cards').select('*').eq('user_id', S.user.id).lte('due_at', todayStr()).order('due_at').limit(30);
  const queue = [...(due || [])]; let doneCount = 0, wrong = 0; const total = queue.length; const retried = new Set();
  const finish = async () => { pr.review = { done: true, count: total, wrong }; await saveProgress(); toast(total ? `複習完成：${total} 張，答錯 ${wrong} 張` : '今天沒有到期的卡片'); renderLesson(box, wi); };
  if (!total) { box.innerHTML = stepsHTML(pr, 'review') + `<div class="card"><h3>複習</h3><p class="hint" style="font-size:14px">今天沒有到期的句子卡（卡片會在你練習答錯或學新字時自動加入）。</p><button class="btn full" id="skipRev">進入今天的輸入</button></div>`; $('#skipRev').onclick = finish; return; }
  const next = () => {
    const c = queue.shift();
    if (!c) return finish();
    const isWord = c.kind === 'word';
    box.innerHTML = stepsHTML(pr, 'review') + `<div class="card"><div class="meta">複習 ${Math.min(doneCount + 1, total)} / ${total}${retried.has(c.id) ? '（重排）' : ''}</div>
      <div class="progress"><div style="width:${doneCount / total * 100}%"></div></div>
      <div style="margin:12px 0"><div class="zh" style="font-size:17px;color:var(--ink)">${esc(c.zh || '（沒有中文，直接唸出英文）')}</div>${c.context ? `<div class="hint">${esc(c.context)}</div>` : ''}</div>
      ${isWord ? `<div class="hint">這個字的英文是？想好再翻開。</div><button class="btn ghost full" id="reveal">翻開答案</button><div id="ans" class="hidden" style="margin-top:12px"><div class="row between"><div class="en">${esc(c.en)}</div>${speakBtn(c.en)}</div><div class="row" style="margin-top:12px;gap:8px"><button class="btn full ghost" id="bad" style="margin:0">忘了</button><button class="btn full" id="good" style="margin:0">記得</button></div></div>`
      : `<div class="hint">用英文說出這句。可以打字或按麥克風。</div><div class="row" style="margin-top:8px"><input class="text" id="revIn" placeholder="輸入英文…" autocomplete="off"><button class="mic" id="revMic">${MIC}</button></div><button class="btn full" id="revSubmit">送出</button><div id="revFb"></div>`}
    </div>`;
    const after = async (ok) => { await reviewCard(c, ok); if (!ok) { wrong++; if (!retried.has(c.id)) { retried.add(c.id); queue.push(c); } } else doneCount++; if (!ok && retried.has(c.id) && queue[queue.length - 1] !== c) doneCount++; next(); };
    if (isWord) { $('#reveal').onclick = () => { $('#ans').classList.remove('hidden'); $('#reveal').classList.add('hidden'); speak(c.en); }; $('#good').onclick = () => after(true); $('#bad').onclick = () => after(false); }
    else {
      $('#revMic').onclick = () => listen(t => { $('#revIn').value = t; }, $('#revMic'));
      $('#revSubmit').onclick = async () => {
        const a = $('#revIn').value.trim(); if (!a) return toast('先說或打一句英文');
        let ok = norm(a) === norm(c.en), note = '';
        if (!ok) { try { const g = await coach('grade_review', { card: { en: c.en, zh: c.zh }, user_answer: a }, '老師在聽…'); ok = g.correct; note = g.note_zh; } catch (e) { toast(e.message, 4000); } }
        $('#revFb').innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}">${ok ? '對了！' : '還差一點。'}${esc(note)}<div class="row between" style="margin-top:8px"><div class="en">${esc(c.en)}</div>${speakBtn(c.en)}</div><button class="btn full sm" id="revNext">${ok ? '下一張' : '知道了，稍後再考我一次'}</button></div>`;
        speak(c.en); $('#revNext').onclick = () => after(ok); $('#revSubmit').disabled = true;
      };
    }
  };
  next();
}

/* 輸入：文法點 + 對話 + 新字 + 3 題理解題 */
function renderInput(box, wi) {
  const L = S.lesson, C = L.content, pr = L.progress; pr.input = pr.input || { qIdx: 0, wrongStreak: 0, answers: [] };
  const st = pr.input;
  if (!st.reading) {
    box.innerHTML = stepsHTML(pr, 'input') + `
      <div class="card"><h3>今天的小文法：${esc(C.grammar_point.title_zh)}</h3><div style="font-size:15px">${esc(C.grammar_point.explain_zh)}</div>
        ${C.grammar_point.examples.map(e => `<div class="line"><div class="txt"><div class="en">${esc(e.en)}</div><div class="zh">${esc(e.zh)}</div></div>${speakBtn(e.en)}</div>`).join('')}</div>
      <div class="card"><div class="row between"><h3 style="margin:0">對話：${esc(C.title_zh)}</h3><button class="btn ghost sm" id="playAll">全部播放</button></div>
        ${C.dialogue.map(d => `<div class="line"><div class="who">${esc(d.speaker)}</div><div class="txt"><div class="en">${esc(d.en)}</div><div class="zh">${esc(d.zh)}</div></div>${speakBtn(d.en)}</div>`).join('')}</div>
      ${C.vocab?.length ? `<div class="card"><h3>今天的新字（${C.vocab.length} 個）</h3><div class="vocab-grid">${C.vocab.map(v => `<div class="card"><div class="row between"><div class="en" style="font-size:16px">${esc(v.en)}</div>${speakBtn(v.en)}</div><div class="zh">${esc(v.zh)}</div><div class="hint" style="font-size:12px">${esc(v.example_en)}</div></div>`).join('')}</div></div>` : ''}
      <button class="btn full" id="toQ">我讀完了，開始理解題</button>`;
    $('#playAll').onclick = () => speakList(C.dialogue.map(d => d.en));
    $('#toQ').onclick = async () => { st.reading = true; await saveProgress(); renderInput(box, wi); };
    return;
  }
  const qs = C.questions;
  if (st.qIdx >= qs.length) {
    const n = C.vocab?.length ? addCards(C.vocab.map(v => ({ kind: 'word', en: v.en, zh: v.zh, context: v.example_en })), `第${L.week}週 ${L.topic}`) : Promise.resolve(0);
    n.then(async k => { pr.input.done = true; await saveProgress(); toast(k ? `新字 ${k} 個已加入卡庫` : '理解題完成'); renderLesson(box, wi); });
    return;
  }
  const q = qs[st.qIdx];
  box.innerHTML = stepsHTML(pr, 'input') + `<div class="card"><div class="meta">理解題 ${st.qIdx + 1} / ${qs.length}</div>
    <div class="row between" style="margin:10px 0"><div class="en">${esc(q.q_en)}</div>${speakBtn(q.q_en)}</div><div class="zh">${esc(q.q_zh)}</div>
    <div class="chips" style="margin-top:12px;flex-direction:column">${q.options.map((o, i) => `<button class="chip" data-i="${i}" style="text-align:left">${esc(o)}</button>`).join('')}</div><div id="qFb"></div></div>`;
  $$('.chip', box).forEach(c => c.onclick = async () => {
    const i = Number(c.dataset.i), ok = i === q.answer_index;
    $$('.chip', box).forEach((x, j) => { x.disabled = true; if (j === q.answer_index) x.classList.add('ok'); else if (j === i && !ok) x.classList.add('bad'); });
    st.answers.push(ok); st.wrongStreak = ok ? 0 : st.wrongStreak + 1;
    let extra = '';
    if (st.wrongStreak >= 2) {
      extra = '<div class="hint" style="color:var(--danger)">連續兩題沒答對，老師會把難度降一級，重新準備更簡單的材料。</div>';
      await saveProfile({ level_adjust: (S.profile.level_adjust || 0) - 1 });
    }
    $('#qFb').innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}">${ok ? '答對了！' : '不對，正確答案是：' + esc(q.options[q.answer_index])}${extra}<button class="btn full sm" id="qNext">${st.wrongStreak >= 2 ? '重新準備更簡單的課' : '下一題'}</button></div>`;
    $('#qNext').onclick = async () => {
      if (st.wrongStreak >= 2) {
        try { const content = await coach('lesson_generate', { day_in_week: wi.dayInWeek, learned_words: [] }, '老師在準備更簡單的版本…'); L.content = content; pr.input = { qIdx: 0, wrongStreak: 0, answers: [], reading: false }; await saveProgress(); renderInput(box, wi); } catch (e) { toast(e.message, 5000); }
        return;
      }
      st.qIdx++; await saveProgress(); renderInput(box, wi);
    };
  });
}

/* ---------- 句型快答（FSI Pattern Drill：答快，不是答對） ---------- */
function sim(a, b) { // 相似度 0..1（容忍語音辨識小誤差）
  a = norm(a); b = norm(b); if (a === b) return 1; if (!a || !b) return 0;
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}
const drillCfg = () => ({ limit: Number(S.profile.settings?.drill_limit ?? 3), reps: Number(S.profile.settings?.drill_reps ?? 20), autoMic: S.profile.settings?.auto_mic !== false && !!SR });
let drillTimer = null, drillIv = null, drillRec = null;
function stopDrillTimers() { clearTimeout(drillTimer); clearInterval(drillIv); drillTimer = drillIv = null; try { drillRec?.abort(); } catch {} drillRec = null; }

function renderDrill(box, wi) {
  const L = S.lesson, C = L.content, pr = L.progress;
  const cfg = drillCfg();
  const pats = C.patterns || [];
  // 題目佇列：每個句型 → 代換 N 題 → 轉換 10 題；最後應答/擴展
  if (!pr.drill || !pr.drill.queue) {
    const queue = [];
    pats.forEach((pt, pi) => {
      queue.push({ kind: 'intro', pi, phase: 'sub' });
      pt.substitution.slice(0, cfg.reps).forEach(c => queue.push({ kind: 'cue', pi, phase: 'sub', cue: c.cue, answer: c.answer, label: pt.label }));
      queue.push({ kind: 'intro', pi, phase: 'trans' });
      pt.transformation.forEach(c => queue.push({ kind: 'cue', pi, phase: 'trans', cue: c.cue, answer: c.answer, label: pt.label }));
    });
    (C.extra_drills || []).forEach(d => queue.push({ kind: 'cue', phase: d.type, cue: d.prompt_en, instruction: d.instruction_zh, answer: d.answer_en, label: d.pattern, limit: cfg.limit + 2 }));
    pr.drill = { queue, idx: 0, log: [], wrongs: [] };
  }
  const st = pr.drill;
  stopDrillTimers();
  if (st.idx >= st.queue.length) return finishDrill(box, wi);
  const it = st.queue[st.idx];
  const pt = it.pi != null ? pats[it.pi] : null;
  const PHASE = { sub: '代換', trans: '轉換', response: '應答', expansion: '擴展' };
  const total = st.queue.filter(q => q.kind === 'cue').length, doneN = st.log.length;
  const fast = st.log.filter(l => l.fast).length;

  if (it.kind === 'intro') {
    box.innerHTML = stepsHTML(pr, 'drill') + `<div class="card"><div class="row between"><div class="meta">句型 ${it.pi + 1} / ${pats.length}</div><span class="tag">${PHASE[it.phase]}練習</span></div>
      <h3 style="margin-top:8px">${it.phase === 'sub' ? '基礎句型，先聽一次、跟著唸一次' : '同一個句型，換成轉換練習'}</h3>
      <div class="row between" style="margin:10px 0;padding:12px;background:var(--bg);border-radius:12px"><div><div class="en" style="font-size:22px">${esc(pt.base_en)}</div><div class="zh">${esc(pt.base_zh)}</div></div>${speakBtn(pt.base_en)}</div>
      <div class="hint">${it.phase === 'sub' ? `接下來我會連續丟 ${Math.min(cfg.reps, pt.substitution.length)} 個提示詞，你把它套進句子、<b>${cfg.limit} 秒內</b>說出來。重點是答快，不是答對；錯了會閃一下正確句就往下。` : `接下來 ${pt.transformation.length} 個指令：問句、否定、換人稱…從基礎句變過去，一樣 ${cfg.limit} 秒內說出來。`}</div>
      <div class="hint">${cfg.autoMic ? '麥克風會自動開，直接開口講。' : '這個瀏覽器沒有語音辨識，用打字＋Enter。'}</div>
      <button class="btn full" id="go">開始快答</button></div>`;
    speak(pt.base_en);
    $('#go').onclick = async () => { st.idx++; await saveProgress(); renderDrill(box, wi); };
    return;
  }
  // 題目
  const limit = it.limit || cfg.limit;
  box.innerHTML = stepsHTML(pr, 'drill') + `<div class="card">
    <div class="row between"><div class="meta">${pt ? `句型 ${it.pi + 1}/${pats.length}・` : ''}${PHASE[it.phase]}　第 ${doneN + 1} / ${total} 題</div><div class="meta">快答率 ${doneN ? Math.round(fast / doneN * 100) : 0}%</div></div>
    <div class="progress"><div style="width:${doneN / total * 100}%"></div></div>
    ${pt ? `<div class="meta" style="margin-top:8px">基礎句：<span class="en" style="font-size:14px;font-weight:500">${esc(it.phase === 'sub' && st.lastAnswer?.pi === it.pi ? st.lastAnswer.en : pt.base_en)}</span></div>` : `<div style="margin-top:8px;font-size:14px">${esc(it.instruction || '')}</div>`}
    <div style="text-align:center;margin:18px 0 10px"><div class="meta">${it.phase === 'sub' ? '提示詞' : it.phase === 'trans' ? '指令' : '對方說'}</div><div class="en" style="font-size:${pt ? 36 : 22}px;line-height:1.2">${esc(it.cue)}</div></div>
    <div class="progress" style="height:6px"><div id="tbar" style="width:100%;transition:none"></div></div>
    <div class="row" style="margin-top:12px"><input class="text" id="qIn" placeholder="說出來或打字…" autocomplete="off" autocapitalize="off"><button class="mic ${cfg.autoMic ? 'rec' : ''}" id="qMic">${MIC}</button></div>
    <div id="qFb" style="min-height:64px;margin-top:8px"></div>
    <div class="row between"><button class="btn ghost sm" id="qSkip">不會，看答案</button><button class="btn ghost sm" id="qPause">暫停</button></div></div>`;
  const t0 = performance.now(); let answered = false; let speechAt = null;
  const bar = $('#tbar');
  const iv = setInterval(() => { const r = Math.max(0, 1 - (performance.now() - t0) / (limit * 1000)); bar.style.width = r * 100 + '%'; bar.style.background = r < .3 ? 'var(--danger)' : 'var(--warm)'; }, 50);
  const slowTimer = setTimeout(() => { if (!answered) { toast(`超過 ${limit} 秒了，加快速度！不用想，直接講`, 1500); } }, limit * 1000);
  drillTimer = slowTimer; drillIv = iv;
  if (!pt) speak(it.cue, 1.0); else if (it.phase === 'sub') speak(it.cue, 1.0);

  const settle = async (user, skipped = false) => {
    if (answered) return; answered = true; clearInterval(iv); clearTimeout(slowTimer); try { drillRec?.abort(); } catch {} drillRec = null;
    const ms = Math.round((speechAt ?? performance.now()) - t0);
    const ok = !skipped && sim(user, it.answer) >= 0.8;
    const fastOk = ms <= limit * 1000;
    st.log.push({ label: it.label, phase: it.phase, cue: it.cue, answer: it.answer, user, correct: ok, ms, fast: fastOk && ok });
    if (!ok) st.wrongs.push({ label: it.label, said: user, answer: it.answer, cue: it.cue, phase: PHASE[it.phase] });
    if (it.phase === 'sub') st.lastAnswer = { pi: it.pi, en: it.answer };
    $('#qFb').innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}" style="margin:0"><div class="row between"><div class="en">${esc(it.answer)}</div><span class="meta">${ok ? (fastOk ? '✓ 快又對' : '✓ 對，但慢了') : (skipped ? '看答案' : '✗ 再聽一次')}　${(ms / 1000).toFixed(1)}s</span></div>${!ok && user ? `<div class="hint">你說：${esc(user)}</div>` : ''}</div>`;
    speak(it.answer, 1.0);
    st.idx++;
    if (st.idx % 5 === 0) saveProgress();
    drillTimer = setTimeout(() => renderDrill(box, wi), ok ? 1100 : 2200);
  };
  $('#qIn').onkeydown = e => { if (e.key === 'Enter') settle($('#qIn').value.trim()); };
  $('#qIn').oninput = () => { if (!speechAt) speechAt = performance.now(); };
  $('#qSkip').onclick = () => settle('', true);
  $('#qPause').onclick = async () => { answered = true; stopDrillTimers(); await saveProgress(); box.innerHTML = stepsHTML(pr, 'drill') + `<div class="card"><h3>暫停中</h3><div class="hint">進度已存，隨時回來接著快答。</div><button class="btn full" id="resume">繼續</button></div>`; $('#resume').onclick = () => renderDrill(box, wi); };
  const startMic = () => {
    if (!SR) return;
    try { drillRec?.abort(); } catch {}
    const r = new SR(); r.lang = 'en-US'; r.interimResults = true; r.maxAlternatives = 3; drillRec = r;
    r.onspeechstart = () => { if (!speechAt) speechAt = performance.now(); };
    r.onresult = e => {
      if (!speechAt) speechAt = performance.now();
      const res = e.results[e.results.length - 1];
      if (res.isFinal) { const alts = [...res].map(a => a.transcript); const best = alts.sort((a, b) => sim(b, it.answer) - sim(a, it.answer))[0]; $('#qIn').value = best; settle(best); }
      else $('#qIn').value = res[0].transcript;
    };
    r.onerror = () => { $('#qMic').classList.remove('rec'); };
    r.onend = () => { if (!answered) $('#qMic').classList.remove('rec'); };
    try { r.start(); $('#qMic').classList.add('rec'); } catch { $('#qMic').classList.remove('rec'); }
  };
  $('#qMic').onclick = startMic;
  if (cfg.autoMic) setTimeout(startMic, pt && it.phase === 'sub' ? 350 : 600); else $('#qIn').focus();
}
async function finishDrill(box, wi) {
  const pr = S.lesson.progress, st = pr.drill;
  if (!st.saved) {
    const uniq = {}; st.wrongs.forEach(w => { uniq[norm(w.answer)] = w; });
    for (const w of Object.values(uniq)) await logError(w.label, w.said, w.answer);
    await addCards(Object.values(uniq).map(w => ({ kind: 'sentence', en: w.answer, zh: '', context: `${w.phase}快答：${w.cue}` })), '快答答錯');
    st.saved = true;
  }
  const n = st.log.length, fast = st.log.filter(l => l.fast).length, ok = st.log.filter(l => l.correct).length;
  const avg = n ? st.log.reduce((s, l) => s + l.ms, 0) / n / 1000 : 0;
  st.stats = { n, fast, ok, avg: Number(avg.toFixed(2)) }; st.done = true; delete st.queue; await saveProgress();
  box.innerHTML = stepsHTML(pr, 'drill') + `<div class="card"><h3>快答完成！</h3>
    <div class="stat" style="margin-top:8px"><div class="card"><div class="meta">快答率（${drillCfg().limit} 秒內答對）</div><div class="big">${n ? Math.round(fast / n * 100) : 0}%</div></div><div class="card"><div class="meta">平均反應</div><div class="big">${avg.toFixed(1)}<span style="font-size:16px">s</span></div></div></div>
    <div class="hint" style="margin-top:10px">共 ${n} 題，答對 ${ok} 題。答錯的 ${Object.keys(st.wrongs.length ? st.wrongs : {}).length ? st.wrongs.length + ' 句已進句子卡' : '沒有'}。快答率會一天一天往上，這就是反射在長出來。</div>
    <button class="btn full" id="toRead">下一段：大聲朗讀</button></div>`;
  $('#toRead').onclick = () => renderLesson(box, wi);
}

/* ---------- 大聲朗讀（不翻譯、不查字典，讓嘴巴習慣） ---------- */
function renderReadAloud(box, wi) {
  const L = S.lesson, C = L.content, pr = L.progress; pr.read = pr.read || { idx: 0, scores: [] };
  const st = pr.read;
  const R = C.reading_passage || { title_zh: '今天的對話', sentences: (C.dialogue || []).map(d => ({ en: d.en, zh: d.zh })) };
  const ss = R.sentences;
  if (st.idx >= ss.length) {
    const avg = st.scores.length ? Math.round(st.scores.reduce((a, b) => a + b, 0) / st.scores.length) : null;
    box.innerHTML = stepsHTML(pr, 'read') + `<div class="card"><h3>朗讀完成</h3>${avg != null ? `<div class="big">${avg}%</div><div class="meta">平均讀對比例（語音辨識估算，參考用）</div>` : ''}<div class="hint" style="margin-top:8px">最後再整段大聲讀一次，不看中文。</div>
      <div style="margin-top:8px">${ss.map(x => `<div class="line"><div class="txt"><div class="en" style="font-size:15px;font-weight:500">${esc(x.en)}</div></div>${speakBtn(x.en)}</div>`).join('')}</div>
      <button class="btn ghost full" id="playAll">聽整段範讀</button><button class="btn full" id="done">下一段：自由輸出</button></div>`;
    $('#playAll').onclick = () => speakList(ss.map(x => x.en));
    $('#done').onclick = async () => { st.done = true; st.avg = avg; await saveProgress(); renderLesson(box, wi); };
    return;
  }
  const x = ss[st.idx];
  box.innerHTML = stepsHTML(pr, 'read') + `<div class="card"><div class="row between"><div class="meta">大聲朗讀 ${st.idx + 1} / ${ss.length}・${esc(R.title_zh)}</div><button class="btn ghost sm" id="showZh">看中文</button></div>
    <div class="progress"><div style="width:${st.idx / ss.length * 100}%"></div></div>
    <div class="hint">先聽範讀，然後按麥克風、大聲讀出來。不翻譯、不查字典，讀得卡也沒關係。</div>
    <div class="row between" style="margin:14px 0;padding:14px;background:var(--bg);border-radius:12px"><div class="en" style="font-size:22px;line-height:1.35">${esc(x.en)}</div>${speakBtn(x.en)}</div>
    <div class="zh hidden" id="zh">${esc(x.zh)}</div>
    <div class="row" style="margin-top:8px;justify-content:center;gap:16px"><button class="mic" id="rMic" style="width:64px;height:64px;border-radius:20px">${MIC}</button></div>
    <div id="rFb" style="min-height:48px;margin-top:10px"></div>
    <div class="row between"><button class="btn ghost sm" id="rAgain">再讀一次</button><button class="btn sm" id="rNext">下一句</button></div></div>`;
  speak(x.en);
  $('#showZh').onclick = () => $('#zh').classList.toggle('hidden');
  let last = null;
  const doListen = () => listen(t => { const sc = Math.round(sim(t, x.en) * 100); last = sc; $('#rFb').innerHTML = `<div class="feedback ${sc >= 80 ? 'good' : ''}" style="margin:0"><div class="meta">我聽到：</div>${esc(t)}<div class="meta">讀對比例約 ${sc}%${sc < 80 ? '，再聽一次範讀、再讀一次' : '，很棒'}</div></div>`; if (sc < 80) speak(x.en); }, $('#rMic'));
  $('#rMic').onclick = doListen; $('#rAgain').onclick = doListen;
  $('#rNext').onclick = async () => { if (last != null) st.scores.push(last); st.idx++; await saveProgress(); renderReadAloud(box, wi); };
}

/* 產出：真實情境用英文回應 */
function renderOutput(box, wi, mode) {
  const L = S.lesson, C = L.content, pr = L.progress; pr.output = pr.output || {};
  mode = mode || pr.output.mode || 'scene';
  const DIARY = { scene_zh: '自由日記：用英文說或寫今天發生的事、心情、或任何想講的。說錯、文法錯都沒關係，先講出來。', scene_en: 'Free diary', starter_en: 'How was your day? Tell me anything.' };
  const t = mode === 'diary' ? DIARY : C.output_task;
  box.innerHTML = stepsHTML(pr, 'output') + `<div class="card"><div class="row between"><h3 style="margin:0">自由輸出</h3><div class="chips"><button class="chip ${mode === 'scene' ? 'on' : ''}" data-m="scene" style="padding:6px 10px;font-size:13px">情境回應</button><button class="chip ${mode === 'diary' ? 'on' : ''}" data-m="diary" style="padding:6px 10px;font-size:13px">自由日記</button></div></div><div style="font-size:15px;margin-top:8px">${esc(t.scene_zh)}</div><div class="hint">${esc(t.scene_en)}</div>
    <div class="row between" style="margin-top:12px;padding:10px 12px;background:var(--bg);border-radius:12px"><div><div class="meta">對方說：</div><div class="en">${esc(t.starter_en)}</div></div>${speakBtn(t.starter_en)}</div>
    <div class="hint" style="margin-top:12px">用英文回應，長度不限，一句也可以。打字或按麥克風都行。</div>
    <div class="row" style="margin-top:8px;align-items:flex-start"><textarea id="oIn" placeholder="Hello, …"></textarea><button class="mic" id="oMic">${MIC}</button></div>
    <button class="btn full" id="oSubmit">送給老師看</button><div id="oFb"></div></div>`;
  $$('[data-m]', box).forEach(c => c.onclick = () => renderOutput(box, wi, c.dataset.m));
  $('#oMic').onclick = () => listen(tx => { const ta = $('#oIn'); ta.value = (ta.value + ' ' + tx).trim(); }, $('#oMic'));
  $('#oSubmit').onclick = async () => {
    const txt = $('#oIn').value.trim(); if (!txt) return toast('先寫或說一句');
    $('#oSubmit').disabled = true;
    let g; try { g = await coach('grade_output', { task: t, user_text: txt }, '老師在讀你的回應…'); } catch (e) { toast(e.message, 5000); $('#oSubmit').disabled = false; return; }
    for (const er of g.errors || []) await logError(er.pattern, er.said, er.correct);
    const added = await addCards((g.cards || []).map(c => ({ ...c, context: `產出任務：${t.scene_zh}` })), '產出任務');
    const uz = { yes: '聽得懂', mostly: '大致聽得懂', no: '聽不太懂' }[g.understandable] || g.understandable;
    $('#oFb').innerHTML = `
      <div class="feedback ${g.understandable === 'no' ? 'bad' : 'good'}"><b>1. 對方聽得懂嗎？</b> ${esc(uz)}。${esc(g.understandable_zh)}</div>
      <div class="feedback ${g.errors?.length ? 'bad' : 'good'}"><b>2. 哪裡講錯</b>${g.errors?.length ? g.errors.map(e => `<div style="margin-top:8px"><span class="bad-text">${esc(e.said)}</span> → <span class="ok-text">${esc(e.correct)}</span><div class="hint">${esc(e.why_zh)}</div></div>`).join('') : '<div>沒有明顯錯誤，很棒！</div>'}</div>
      <div class="feedback"><b>3. 更自然的說法</b><div class="row between" style="margin-top:6px"><div class="en">${esc(g.natural_en)}</div>${speakBtn(g.natural_en)}</div><div class="zh">${esc(g.natural_zh)}</div></div>
      <div class="hint" style="margin-top:10px">${esc(g.praise_zh)}${added ? `　已加入 ${added} 張句子卡。` : ''}</div>
      <button class="btn full" id="oDone">完成今天的課</button>`;
    pr.output = { done: true, mode, text: txt, result: g };
    $('#oDone').onclick = async () => { await sb.from('lessons').update({ progress: pr, completed_at: new Date().toISOString() }).eq('id', L.id); renderLesson(box, wi); };
  };
}

/* 結束頁 */
async function renderFinish(box, wi) {
  const today = todayStr();
  const { data: newCards } = await sb.from('cards').select('kind,en,zh').eq('user_id', S.user.id).gte('created_at', today + 'T00:00:00');
  const weekStart = addDays(today, -(wi.dayInWeek - 1));
  const { data: done } = await sb.from('lessons').select('lesson_date').eq('user_id', S.user.id).gte('lesson_date', weekStart).not('completed_at', 'is', null);
  const { data: task } = await sb.from('assessments').select('score,created_at').eq('user_id', S.user.id).eq('kind', 'task').gte('created_at', weekStart + 'T00:00:00').order('created_at', { ascending: false }).limit(1);
  const rate = Math.round((done?.length || 0) / wi.dayInWeek * 100);
  const nextRow = wi.dayInWeek >= 7 ? S.curriculum.find(c => c.week === wi.week + 1) : wi.row;
  const words = (newCards || []).filter(c => c.kind === 'word'), sents = (newCards || []).filter(c => c.kind === 'sentence');
  box.innerHTML = stepsHTML(S.lesson.progress, 'done') + `<div class="card"><h3>今天完成了，辛苦了！</h3>
    <div class="stat" style="margin-top:8px"><div class="card"><div class="meta">今天新單字</div><div class="big">${words.length}</div></div><div class="card"><div class="meta">今天新句子卡</div><div class="big">${sents.length}</div></div></div>
    ${newCards?.length ? `<div style="margin-top:12px">${newCards.map(c => `<div class="line"><span class="tag ${c.kind}">${c.kind === 'word' ? '字' : '句'}</span><div class="txt"><div class="en" style="font-size:15px">${esc(c.en)}</div><div class="zh">${esc(c.zh)}</div></div>${speakBtn(c.en)}</div>`).join('')}</div>` : ''}
    ${S.lesson.progress.drill?.stats ? `<div class="stat" style="margin-top:12px"><div class="card"><div class="meta">今天快答率</div><div class="big">${Math.round(S.lesson.progress.drill.stats.fast / Math.max(1, S.lesson.progress.drill.stats.n) * 100)}%</div></div><div class="card"><div class="meta">平均反應</div><div class="big">${S.lesson.progress.drill.stats.avg}<span style="font-size:16px">s</span></div></div></div>` : ''}
    <div class="hint" style="margin-top:12px">明天主題：${esc(nextRow?.topic_zh || '繼續本週主題')}</div>
    <div class="feedback" style="margin-top:12px">本週任務目標達成度：完成 ${done?.length || 0} / ${wi.dayInWeek} 天（${rate}%）${task?.[0] ? `，任務測驗 ${task[0].score} 分` : ''}。</div>
    ${wi.dayInWeek >= 6 && !task?.[0] && !wi.row?.is_buffer ? `<button class="btn full" id="weeklyTask">做本週任務測驗（3 題）</button>` : ''}
  </div>`;
  $('#weeklyTask')?.addEventListener('click', () => runWeeklyTask(box, wi));
}
async function runWeeklyTask(box, wi) {
  let tasks; try { ({ tasks } = await coach('weekly_task', {}, '老師在出本週任務…')); } catch (e) { return toast(e.message, 5000); }
  const answers = []; let i = 0;
  const render = () => {
    if (i >= tasks.length) return grade();
    const t = tasks[i];
    box.innerHTML = `<div class="card"><div class="meta">本週任務測驗 ${i + 1} / ${tasks.length}</div><div style="margin:8px 0;font-size:15px">${esc(t.task_zh)}</div>
      <div class="row between"><div class="en">${esc(t.prompt_en)}</div>${speakBtn(t.prompt_en)}</div>
      <div class="row" style="margin-top:10px;align-items:flex-start"><textarea id="tIn"></textarea><button class="mic" id="tMic">${MIC}</button></div><button class="btn full" id="tNext">送出</button></div>`;
    $('#tMic').onclick = () => listen(tx => { $('#tIn').value = ($('#tIn').value + ' ' + tx).trim(); }, $('#tMic'));
    $('#tNext').onclick = () => { answers.push($('#tIn').value.trim()); i++; render(); };
  };
  const grade = async () => {
    try { const g = await coach('grade_task', { tasks, answers }, '老師在評分…'); await sb.from('assessments').insert({ user_id: S.user.id, kind: 'task', score: g.score, raw: { tasks, answers, feedback: g.feedback_zh } }); box.innerHTML = `<div class="card"><h3>本週任務達成度：${g.score} 分${g.passed ? '，通過！' : ''}</h3><div style="font-size:15px">${esc(g.feedback_zh)}</div><button class="btn full" id="back">回今日</button></div>`; $('#back').onclick = () => renderToday(); } catch (e) { toast(e.message, 5000); }
  };
  render();
}

/* ---------- 程度評估 ---------- */
async function renderAssess() {
  const page = $('#page-assess'); const A = S.assess || (S.assess = { step: 'vocab' });
  setTop('程度評估', '一次一題，慢慢來');
  if (A.step === 'vocab') { page.innerHTML = ''; const box = document.createElement('div'); page.appendChild(box); runVocabTest(box, (res, answers) => { A.vocab = res; A.vocabAnswers = answers; A.step = 'reading'; renderAssess(); }); return; }
  if (A.step === 'reading') {
    if (!A.reading) { try { A.reading = await coach('reading_test', {}, '老師在準備一段短文…'); } catch (e) { page.innerHTML = `<div class="card">${esc(e.message)}<button class="btn full" id="retry">重試</button></div>`; $('#retry').onclick = renderAssess; return; } }
    page.innerHTML = `<div class="card"><div class="meta">聽讀測試</div><h3>先聽、再讀，然後用中文寫出大概意思</h3>
      ${A.reading.sentences.map(s => `<div class="line"><div class="txt"><div class="en">${esc(s.en)}</div></div>${speakBtn(s.en)}</div>`).join('')}
      <button class="btn ghost full" id="playR">整段播放</button>
      <textarea id="rZh" placeholder="用中文寫出這段在講什麼，不用逐字翻，大概意思就好…" style="margin-top:10px"></textarea>
      <button class="btn full" id="rNext">下一步</button></div>`;
    $('#playR').onclick = () => speakList(A.reading.sentences.map(s => s.en));
    $('#rNext').onclick = () => { A.readingZh = $('#rZh').value.trim(); if (!A.readingZh) return toast('寫一點就好，不用完美'); A.step = 'writing'; renderAssess(); };
    return;
  }
  if (A.step === 'writing') {
    A.writingTask = '你剛到國外的旅館櫃台，服務人員跟你打招呼。請用英文介紹自己（名字、從哪裡來），並說你要住幾個晚上。寫得多簡單都可以。';
    page.innerHTML = `<div class="card"><div class="meta">口說／寫作測試</div><h3>用英文回應這個情境</h3><div style="font-size:15px">${esc(A.writingTask)}</div>
      <div class="row between" style="margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:12px"><div><div class="meta">櫃台說：</div><div class="en">Good evening! Welcome. Can I help you?</div></div>${speakBtn('Good evening! Welcome. Can I help you?')}</div>
      <div class="row" style="margin-top:10px;align-items:flex-start"><textarea id="wEn" placeholder="Hello, my name is …"></textarea><button class="mic" id="wMic">${MIC}</button></div>
      <button class="btn full" id="wNext">送出，看結果</button></div>`;
    $('#wMic').onclick = () => listen(tx => { $('#wEn').value = ($('#wEn').value + ' ' + tx).trim(); }, $('#wMic'));
    $('#wNext').onclick = async () => {
      A.writingEn = $('#wEn').value.trim(); if (!A.writingEn) return toast('寫一句就好，再簡單都可以');
      try {
        const g = await coach('assess_grade', { vocab_est: A.vocab.est, vocab_detail: A.vocab.detail, reading: { sentences: A.reading.sentences, reference_zh: A.reading.reference_zh, user_zh: A.readingZh }, writing: { task_zh: A.writingTask, user_en: A.writingEn } }, '老師在評估你的程度…');
        A.result = g;
        await sb.from('assessments').insert([
          { user_id: S.user.id, kind: 'vocab', vocab_est: A.vocab.est, cefr: g.cefr, raw: A.vocab.detail },
          { user_id: S.user.id, kind: 'reading', score: g.reading_score, raw: { sentences: A.reading.sentences, user_zh: A.readingZh, feedback: g.reading_feedback_zh } },
          { user_id: S.user.id, kind: 'writing', raw: { task: A.writingTask, user_en: A.writingEn, feedback: g.writing_feedback_zh } },
        ]);
        await saveProfile({ assessed: true, cefr: g.cefr, vocab_est: A.vocab.est, stage: g.start_stage || 1, week: g.start_week || 1, sprint_start: S.profile.sprint_start || todayStr(), last_vocab_test: todayStr(), error_summary: `評估弱點：聽 ${g.weaknesses.listening}；說 ${g.weaknesses.speaking}；讀 ${g.weaknesses.reading}；寫 ${g.weaknesses.writing}` });
        await addCards(g.cards, '程度評估');
        A.step = 'result'; renderAssess();
      } catch (e) { toast(e.message, 6000); }
    };
    return;
  }
  if (A.step === 'result') {
    const g = A.result;
    page.innerHTML = `<div class="card"><h3>評估結果</h3>
      <div class="stat"><div class="card"><div class="meta">估計字彙量</div><div class="big">${A.vocab.est}</div><div class="meta">字</div></div><div class="card"><div class="meta">CEFR 等級</div><div class="big">${esc(g.cefr)}</div><div class="meta">${g.cefr === 'A1' ? '入門' : g.cefr === 'A2' ? '初級' : '中級'}</div></div></div>
      <div class="feedback" style="margin-top:12px">${esc(g.summary_zh)}</div>
      <div style="margin-top:12px;font-size:14px"><div><b>聽</b>：${esc(g.weaknesses.listening)}</div><div><b>說</b>：${esc(g.weaknesses.speaking)}</div><div><b>讀</b>：${esc(g.weaknesses.reading)}</div><div><b>寫</b>：${esc(g.weaknesses.writing)}</div></div>
      <div class="hint" style="margin-top:10px">閱讀：${esc(g.reading_feedback_zh)}</div><div class="hint">寫作：${esc(g.writing_feedback_zh)}</div>
      <div class="feedback good" style="margin-top:12px">起點：第 ${g.start_stage} 階段・第 ${g.start_week} 週「${esc(S.curriculum.find(c => c.week === g.start_week)?.topic_zh || '')}」。每天 60 到 90 分鐘，3 週衝刺＋1 週緩衝，我們一起走。</div>
      <button class="btn full" id="start">開始今天的第一課</button></div>`;
    $('#start').onclick = () => { S.assess = null; showPage('today'); };
  }
}

/* ---------- 卡庫 ---------- */
async function renderCards() {
  setTop('句子卡庫', '翻閱、搜尋、手動加卡、匯出');
  const page = $('#page-cards');
  const { data: cards } = await sb.from('cards').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false });
  const all = cards || []; let filter = 'all', q = '';
  const due = all.filter(c => c.due_at <= todayStr()).length;
  page.innerHTML = `<div class="card"><div class="row"><input class="text" id="cq" placeholder="搜尋英文或中文…"><button class="btn ghost sm" id="csv">匯出 CSV</button></div>
    <div class="chips" style="margin-top:10px"><button class="chip on" data-f="all">全部 ${all.length}</button><button class="chip" data-f="word">單字</button><button class="chip" data-f="sentence">句子</button><button class="chip" data-f="due">今天到期 ${due}</button></div></div>
    <div class="card"><h3>手動加卡</h3><input class="text" id="nEn" placeholder="英文" style="margin-bottom:8px"><input class="text" id="nZh" placeholder="中文" style="margin-bottom:8px"><div class="row"><select id="nKind" style="flex:1"><option value="sentence">句子</option><option value="word">單字</option></select><button class="btn sm" id="nAdd">加入</button></div></div>
    <div class="card" id="clist"></div>`;
  const list = () => {
    const rows = all.filter(c => (filter === 'all' || (filter === 'due' ? c.due_at <= todayStr() : c.kind === filter)) && (!q || (c.en + c.zh + c.context).toLowerCase().includes(q)));
    $('#clist').innerHTML = rows.length ? rows.map(c => `<div class="list-item"><span class="tag ${c.kind}">${c.kind === 'word' ? '字' : '句'}</span><div class="grow"><div class="en" style="font-size:15px">${esc(c.en)}</div><div class="zh">${esc(c.zh)}</div><div class="meta">${c.context ? esc(c.context) + '・' : ''}下次 ${c.due_at}・對 ${c.reps} 錯 ${c.lapses}</div></div>${speakBtn(c.en)}<button class="speak" data-del="${c.id}" style="color:var(--sub)">✕</button></div>`).join('') : '<div class="empty">還沒有卡片。練習中答錯或學到新字，老師會自動幫你收。</div>';
    $$('[data-del]', page).forEach(b => b.onclick = async () => { if (!confirm('刪除這張卡？')) return; await sb.from('cards').delete().eq('id', b.dataset.del); const i = all.findIndex(c => String(c.id) === b.dataset.del); if (i > -1) all.splice(i, 1); list(); });
  };
  $$('.chip', page).forEach(c => c.onclick = () => { $$('.chip', page).forEach(x => x.classList.remove('on')); c.classList.add('on'); filter = c.dataset.f; list(); });
  $('#cq').oninput = e => { q = e.target.value.trim().toLowerCase(); list(); };
  $('#nAdd').onclick = async () => { const en = $('#nEn').value.trim(), zh = $('#nZh').value.trim(); if (!en) return toast('英文不能空白'); const n = await addCards([{ kind: $('#nKind').value, en, zh }], '手動加入'); toast(n ? '已加入' : '這張卡已經有了'); renderCards(); };
  $('#csv').onclick = () => { const head = 'kind,en,zh,context,source,due_at,reps,lapses,created_at\n'; const body = all.map(c => [c.kind, c.en, c.zh, c.context, c.source, c.due_at, c.reps, c.lapses, c.created_at].map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n'); const blob = new Blob(['﻿' + head + body], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `english-cards-${todayStr()}.csv`; a.click(); };
  list();
}

/* ---------- 進度 ---------- */
function lineChart(points, label) { // 單一序列、單一色，細線 + 圓點 + 直接標籤
  if (!points.length) return '<div class="empty">還沒有資料</div>';
  const W = 320, H = 140, px = 28, py = 16; const xs = points.map((_, i) => px + i * (W - 2 * px) / Math.max(1, points.length - 1));
  const vals = points.map(p => p.v); const min = Math.min(...vals, 0), max = Math.max(...vals, 100);
  const y = v => H - py - (v - min) / (max - min || 1) * (H - 2 * py);
  const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><line x1="${px}" y1="${H - py}" x2="${W - px}" y2="${H - py}" stroke="#e9e0d2"/><path d="${path}" fill="none" stroke="#c08a52" stroke-width="2" stroke-linejoin="round"/>${xs.map((x, i) => `<circle cx="${x}" cy="${y(vals[i])}" r="4" fill="#c08a52" stroke="#fffdf9" stroke-width="2"><title>${esc(points[i].t)}：${vals[i]}</title></circle>${(i === 0 || i === xs.length - 1) ? `<text x="${x}" y="${y(vals[i]) - 8}" text-anchor="middle">${vals[i]}</text>` : ''}<text x="${x}" y="${H - 2}" text-anchor="middle">${esc(points[i].t.slice(5))}</text>`).join('')}</svg>`;
}
function barChart(items) { // 水平長條，一色
  if (!items.length) return '<div class="empty">還沒有答錯紀錄，太棒了</div>';
  const max = Math.max(...items.map(i => i.v));
  return items.map(i => `<div style="margin:8px 0"><div class="row between" style="font-size:13px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.k)}</span><span class="meta">${i.v} 次</span></div><div class="progress" style="margin:4px 0"><div style="width:${i.v / max * 100}%"></div></div></div>`).join('');
}
async function renderProgress() {
  setTop('學習進度', '看得到的數字變化');
  const page = $('#page-progress'); page.innerHTML = '<div class="empty">載入中…</div>';
  const since14 = addDays(todayStr(), -13), monthStart = todayStr().slice(0, 8) + '01';
  const [{ data: asm }, { data: lessons }, { data: errs }, { data: api }, { data: cards }] = await Promise.all([
    sb.from('assessments').select('kind,vocab_est,score,created_at').eq('user_id', S.user.id).order('created_at'),
    sb.from('lessons').select('lesson_date,completed_at,progress').eq('user_id', S.user.id).gte('lesson_date', since14),
    sb.from('errors').select('pattern').eq('user_id', S.user.id),
    sb.from('api_log').select('input_tokens,output_tokens,cache_read,cache_write').eq('user_id', S.user.id).gte('created_at', monthStart + 'T00:00:00'),
    sb.from('cards').select('kind').eq('user_id', S.user.id),
  ]);
  const vocabPts = (asm || []).filter(a => (a.kind === 'vocab' || a.kind === 'weekly_vocab') && a.vocab_est != null).map(a => ({ t: a.created_at.slice(0, 10), v: a.vocab_est }));
  const wi = weekInfo(); const weekStart = addDays(todayStr(), -(wi.dayInWeek - 1));
  const doneWeek = (lessons || []).filter(l => l.completed_at && l.lesson_date >= weekStart).length;
  const task = (asm || []).filter(a => a.kind === 'task' && a.created_at >= weekStart).pop();
  const days = [...Array(14)].map((_, i) => { const d = addDays(since14, i); const l = (lessons || []).find(x => x.lesson_date === d); const pr = l?.progress || {}; const n = ['review', 'input', 'drill', 'read', 'output'].filter(k => pr[k]?.done).length; return { d, n }; });
  const counts = {}; (errs || []).forEach(e => counts[e.pattern] = (counts[e.pattern] || 0) + 1);
  const top5 = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ k, v }));
  const u = (api || []).reduce((s, r) => ({ i: s.i + r.input_tokens, o: s.o + r.output_tokens, cr: s.cr + r.cache_read, cw: s.cw + r.cache_write }), { i: 0, o: 0, cr: 0, cw: 0 });
  const usd = (u.i * 4 + u.cr * 0.4 + u.cw * 5 + u.o * 20) / 1e6; const twd = Math.round(usd * 32);
  let streak = 0; for (let i = 0; i < 60; i++) { const d = addDays(todayStr(), -i); if ((lessons || []).find(l => l.lesson_date === d && l.completed_at)) streak++; else if (i > 0) break; }
  page.innerHTML = `
    <div class="stat"><div class="card"><div class="meta">估計字彙量</div><div class="big">${S.profile.vocab_est}</div><div class="meta">${esc(S.profile.cefr)}</div></div><div class="card"><div class="meta">連續完成</div><div class="big">${streak}</div><div class="meta">天</div></div></div>
    <div class="card" style="margin-top:12px"><h3>本週任務目標達成度</h3><div class="big" style="font-size:28px">${Math.round(doneWeek / wi.dayInWeek * 100)}%</div><div class="meta">完成 ${doneWeek} / ${wi.dayInWeek} 天${task ? `・任務測驗 ${task.score} 分` : '・任務測驗尚未做（第 6 天後開放）'}</div></div>
    <div class="card"><h3>字彙量趨勢（每週日重測）</h3>${lineChart(vocabPts, '字彙量趨勢')}</div>
    <div class="card"><h3>最近 14 天完成率</h3><div style="display:flex;gap:4px;align-items:flex-end;height:70px">${days.map(x => `<div title="${x.d}：${x.n}/5 段" style="flex:1;height:${Math.max(6, x.n / 5 * 100)}%;background:${x.n === 5 ? '#c08a52' : x.n ? 'rgba(192,138,82,.45)' : '#e9e0d2'};border-radius:4px 4px 0 0"></div>`).join('')}</div><div class="row between meta" style="margin-top:4px"><span>${since14.slice(5)}</span><span>今天</span></div></div>
    <div class="card"><h3>錯最多的 5 個句型</h3>${barChart(top5)}</div>
    <div class="card"><h3>卡庫</h3><div class="meta">單字 ${(cards || []).filter(c => c.kind === 'word').length} 張・句子 ${(cards || []).filter(c => c.kind === 'sentence').length} 張</div></div>
    <div class="card"><h3>本月老師費用（估）</h3><div class="big" style="font-size:24px">約 NT$ ${twd}</div><div class="meta">呼叫 ${(api || []).length} 次・輸入 ${u.i + u.cr + u.cw} 字元 token・輸出 ${u.o}</div></div>`;
}

/* ---------- 設定 ---------- */
const PII_RULES = [
  { re: /\b[A-Z][12]\d{8}\b/, what: '身分證字號' },
  { re: /\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/, what: '手機號碼' },
  { re: /\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/, what: '電話號碼' },
  { re: /(19|20)\d{2}\s?[\/\-.年]\s?\d{1,2}\s?[\/\-.月]\s?\d{1,2}/, what: '生日／日期' },
  { re: /民國\s?\d{2,3}\s?年|\b\d{2,3}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日/, what: '生日／日期' },
  { re: /病歷號|身分證|出生/, what: '身分資料關鍵字' },
];
async function renderSettings() {
  setTop('場景與設定', '');
  const page = $('#page-settings'); const p = S.profile; const wi = weekInfo();
  const { data: scenes } = await sb.from('custom_scenes').select('id,title,created_at').eq('user_id', S.user.id).order('created_at', { ascending: false });
  page.innerHTML = `
    <div class="card"><h3>學習路線</h3>${S.curriculum.map(c => `<div class="list-item"><div class="grow"><div style="font-size:15px">${c.is_buffer ? '' : `第 ${c.week} 週・`}${esc(c.topic_zh)}</div><div class="meta">${esc(c.patterns || (c.is_buffer ? '只複習，不教新內容' : ''))}</div></div>${c.week === wi.week ? '<span class="tag now">現在</span>' : c.week < wi.week ? '<span class="tag">完成</span>' : c.unlock_vocab > p.vocab_est ? `<span class="tag lock">需 ${c.unlock_vocab} 字</span>` : ''}</div>`).join('')}</div>
    <div class="card"><h3>貼入自己的內容（去識別化）</h3><div class="hint">可以貼真實對話或想學的句子，系統偵測到姓名、生日、身分證字號、電話會拒收。目前先存起來，第二階段會變成自訂場景。</div>
      <input class="text" id="scTitle" placeholder="標題" style="margin:8px 0"><textarea id="scText" placeholder="貼入內容…"></textarea><button class="btn full" id="scSave">檢查並儲存</button>
      ${scenes?.length ? `<div style="margin-top:10px">${scenes.map(s => `<div class="list-item"><div class="grow">${esc(s.title)}<div class="meta">${s.created_at.slice(0, 10)}</div></div></div>`).join('')}</div>` : ''}</div>
    <div class="card"><h3>老師設定</h3>
      <div class="settings-row"><label>Claude 模型</label><select id="sModel"><option value="claude-opus-5-5" ${p.model === 'claude-opus-5-5' ? 'selected' : ''}>Opus 5.5（品質最好）</option><option value="claude-sonnet-5-5" ${p.model === 'claude-sonnet-5-5' ? 'selected' : ''}>Sonnet 5.5（省一半）</option></select></div>
      <div class="settings-row"><label>每天新單字上限</label><input type="number" id="sWords" min="3" max="20" value="${p.daily_new_words}"></div>
      <div class="settings-row"><label>朗讀速度</label><select id="sRate">${[0.7, 0.8, 0.9, 1.0].map(r => `<option value="${r}" ${Number(p.tts_rate) === r ? 'selected' : ''}>${r === 1 ? '正常' : r}</option>`).join('')}</select></div>
      <div class="settings-row"><label>快答限時</label><select id="sLimit">${[2, 3, 4, 5].map(v => `<option value="${v}" ${Number(p.settings?.drill_limit ?? 3) === v ? 'selected' : ''}>${v} 秒</option>`).join('')}</select></div>
      <div class="settings-row"><label>每個句型代換次數</label><select id="sReps">${[10, 15, 20].map(v => `<option value="${v}" ${Number(p.settings?.drill_reps ?? 20) === v ? 'selected' : ''}>${v} 次</option>`).join('')}</select></div>
      <div class="settings-row"><label>快答時自動開麥克風</label><select id="sMic"><option value="1" ${p.settings?.auto_mic !== false ? 'selected' : ''}>開</option><option value="0" ${p.settings?.auto_mic === false ? 'selected' : ''}>關（用打字）</option></select></div>
      <div class="settings-row"><label>難度微調（目前 ${p.level_adjust}）</label><button class="btn ghost sm" id="sReset">歸零</button></div>
      <button class="btn full ghost" id="sSave">儲存設定</button></div>
    <div class="card"><h3>帳號</h3>
      <div class="settings-row"><label>改密碼</label><input type="password" id="sPwd" placeholder="新密碼（8 碼以上）"></div><button class="btn full ghost" id="sPwdBtn">更新密碼</button>
      <button class="btn full ghost" id="sRedo" style="margin-top:14px">重做程度評估</button>
      <button class="btn full danger" id="sLogout">登出</button></div>
    <div class="hint" style="text-align:center">英文教練 v1・資料存在你自己的 Supabase 專案</div>`;
  $('#sSave').onclick = async () => { await saveProfile({ model: $('#sModel').value, daily_new_words: Number($('#sWords').value) || 12, tts_rate: Number($('#sRate').value), settings: { ...(p.settings || {}), drill_limit: Number($('#sLimit').value), drill_reps: Number($('#sReps').value), auto_mic: $('#sMic').value === '1' } }); toast('已儲存'); };
  $('#sReset').onclick = async () => { await saveProfile({ level_adjust: 0 }); toast('難度已歸零'); renderSettings(); };
  $('#sPwdBtn').onclick = async () => { const pw = $('#sPwd').value; if (pw.length < 8) return toast('密碼至少 8 碼'); const { error } = await sb.auth.updateUser({ password: pw }); toast(error ? '失敗：' + error.message : '密碼已更新'); };
  $('#sRedo').onclick = async () => { if (!confirm('要重做程度評估嗎？卡片與紀錄都會保留。')) return; await saveProfile({ assessed: false }); S.assess = { step: 'vocab' }; showPage('assess'); };
  $('#sLogout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $('#scSave').onclick = async () => {
    const title = $('#scTitle').value.trim() || '未命名', text = $('#scText').value.trim(); if (!text) return toast('先貼入內容');
    const hit = PII_RULES.find(r => r.re.test(text)); if (hit) return toast(`內容含有「${hit.what}」，請先移除再貼入`, 5000);
    try { const g = await coach('pii_check', { text }, '檢查有沒有個資…'); if (g.has_name) return toast(`偵測到人名（${g.names.join('、')}），請改成「病人」或「A」再貼入`, 6000); } catch (e) { return toast(e.message, 5000); }
    const { error } = await sb.from('custom_scenes').insert({ user_id: S.user.id, title, content: text, stage: S.profile.stage }); toast(error ? '儲存失敗' : '已儲存（第二階段會用到）'); renderSettings();
  };
}

/* ---------- 登入與啟動 ---------- */
async function boot() {
  $('#loginEmail').value = localStorage.getItem('en_email') || DEFAULT_EMAIL;
  const { data: { session } } = await sb.auth.getSession();
  if (session) return enter(session.user);
  $('#loginBtn').onclick = login; $('#loginPwd').onkeydown = e => { if (e.key === 'Enter') login(); };
}
async function login() {
  const email = $('#loginEmail').value.trim(), pwd = $('#loginPwd').value; $('#loginErr').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd });
  if (error) { $('#loginErr').textContent = '登入失敗，請確認 Email 與密碼'; return; }
  localStorage.setItem('en_email', email); enter(data.user);
}
async function enter(user) {
  S.user = user; $('#login').style.display = 'none'; $('#app').style.display = 'flex';
  try { await loadProfile(); } catch (e) { toast('讀取資料失敗：' + e.message, 6000); return; }
  showPage('today');
}
boot();
