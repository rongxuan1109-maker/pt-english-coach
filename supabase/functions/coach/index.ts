// 英文教練 — Supabase Edge Function「coach」
// 所有出題 / 糾錯 / 回饋都走這裡。教學規則寫死在 RULES，Claude 不能改成一般教學。
// 金鑰 ANTHROPIC_API_KEY 只存在 Supabase 密鑰（環境變數），網頁絕不碰。

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const DEFAULT_MODEL = "claude-opus-5-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });

const sbHeaders = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

async function getUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
  if (!r.ok) return null;
  return await r.json();
}
async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders });
  if (!r.ok) return [];
  return await r.json();
}
async function sbInsert(table: string, row: unknown) {
  await fetch(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: { ...sbHeaders, Prefer: "return=minimal" }, body: JSON.stringify(row) }).catch(() => {});
}

// ===== 教學規則（固定區，會被快取） =====
const RULES = `你是一位專門教「台灣成人初學者」的英文教練。學生是物理治療師、母語繁體中文、英文初階。你只服務這一位學生。

【絕對遵守的教學方法，不得改成一般教學】
1. 熟練度導向：用「能完成哪些生活/工作任務」衡量，不是考試。
2. 可理解輸入 95%：學生在 A1–A2 時，每句英文不超過 8 個字，只用最常用 1000 字加上「當週主題」必要的字。B1 才可放寬到 12 字。不用成語、不用俚語、不用難字。
3. FSI 操練：四類句型操練。substitution＝代換（換一個字）、transformation＝變化（肯定↔否定↔問句、單數↔複數、時態）、response＝應答（聽到問句要回答）、expansion＝擴展（加時間/地點/原因）。材料只能來自當週主題與核心句型。
4. 間隔重複：單字卡與句子卡，只收學生練習中遇到或答錯的句子。每日新字上限由狀態區給定，不得超過。
5. 衝刺：目前位於狀態區所列的階段與週主題，不要跳到其他主題。
6. 用英文做事：產出任務由學生自己寫，你只修正、不代寫整段；可以給「更自然的說法」示範一句。
7. 說明用繁體中文（台灣用語），練習用英文。學生 B1 以後再逐步增加英文說明。
8. 糾錯要具體：哪個詞、為什麼錯、該怎麼說。不要只說「很好」。語氣溫暖、鼓勵、像並肩作戰的夥伴，但誠實。
9. 每個英文句子都要附簡短中文意思（學生聽讀用）。
10. 你輸出的內容一律符合指定的 JSON 結構，不要多加解釋文字。`;

type Profile = {
  cefr: string; vocab_est: number; level_adjust: number; stage: number; week: number;
  daily_new_words: number; model: string; error_summary: string; settings: Record<string, unknown>;
};

function stateBlock(p: Profile, cur: any, topErrors: string[]) {
  const level = p.level_adjust < 0 ? `${p.cefr}（已降難度 ${p.level_adjust}，句子要更短更簡單）` : p.cefr;
  const maxWords = (p.cefr === "A1" || p.level_adjust < 0) ? 6 : p.cefr === "A2" ? 8 : 12;
  return `【學生目前狀態】
- CEFR：${level}；估計字彙量：${p.vocab_est} 字
- 每句英文最多 ${maxWords} 個字
- 目前階段 ${p.stage}，第 ${p.week} 週，主題：${cur?.topic_zh ?? "未定"}（${cur?.topic_en ?? ""}）
- 本週核心句型：${cur?.patterns || "依主題自選最基本的 3 個句型"}
- 每日新字上限：${p.daily_new_words} 個
- 常錯句型（優先在操練中加強）：${topErrors.length ? topErrors.join("；") : "尚無紀錄"}
- 其他備註：${p.error_summary || "無"}`;
}

// ===== 各動作的 JSON 結構 =====
const S = {
  reading_test: {
    type: "object", additionalProperties: false,
    required: ["sentences", "reference_zh"],
    properties: {
      sentences: { type: "array", minItems: 3, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["en"], properties: { en: { type: "string" } } } },
      reference_zh: { type: "string", description: "整段的中文意思，用來比對學生的理解" },
    },
  },
  assess_grade: {
    type: "object", additionalProperties: false,
    required: ["cefr", "reading_score", "reading_feedback_zh", "writing_feedback_zh", "weaknesses", "start_stage", "start_week", "summary_zh", "cards"],
    properties: {
      cefr: { type: "string", enum: ["A1", "A2", "B1"] },
      reading_score: { type: "integer", minimum: 0, maximum: 100 },
      reading_feedback_zh: { type: "string" },
      writing_feedback_zh: { type: "string" },
      weaknesses: { type: "object", additionalProperties: false, required: ["listening", "speaking", "reading", "writing"],
        properties: { listening: { type: "string" }, speaking: { type: "string" }, reading: { type: "string" }, writing: { type: "string" } } },
      start_stage: { type: "integer" }, start_week: { type: "integer" },
      summary_zh: { type: "string" },
      cards: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false, required: ["kind", "en", "zh"], properties: { kind: { type: "string", enum: ["word", "sentence"] }, en: { type: "string" }, zh: { type: "string" } } } },
    },
  },
  lesson_generate: {
    type: "object", additionalProperties: false,
    required: ["title_zh", "grammar_point", "dialogue", "vocab", "questions", "drills", "output_task"],
    properties: {
      title_zh: { type: "string" },
      grammar_point: { type: "object", additionalProperties: false, required: ["title_zh", "explain_zh", "examples"],
        properties: { title_zh: { type: "string" }, explain_zh: { type: "string", description: "不用術語，用生活化比喻，3 句內" }, examples: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["en", "zh"], properties: { en: { type: "string" }, zh: { type: "string" } } } } } },
      dialogue: { type: "array", minItems: 6, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["speaker", "en", "zh"], properties: { speaker: { type: "string" }, en: { type: "string" }, zh: { type: "string" } } } },
      vocab: { type: "array", items: { type: "object", additionalProperties: false, required: ["en", "zh", "example_en"], properties: { en: { type: "string" }, zh: { type: "string" }, example_en: { type: "string" } } } },
      questions: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["q_en", "q_zh", "options", "answer_index"], properties: { q_en: { type: "string" }, q_zh: { type: "string" }, options: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } }, answer_index: { type: "integer", minimum: 0, maximum: 2 } } } },
      drills: { type: "array", minItems: 5, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["type", "instruction_zh", "prompt_en", "answer_en", "pattern"], properties: { type: { type: "string", enum: ["substitution", "transformation", "response", "expansion"] }, instruction_zh: { type: "string" }, prompt_en: { type: "string" }, answer_en: { type: "string" }, pattern: { type: "string", description: "句型標籤，例如 I am + 國家" } } } },
      output_task: { type: "object", additionalProperties: false, required: ["scene_zh", "scene_en", "starter_en"], properties: { scene_zh: { type: "string" }, scene_en: { type: "string" }, starter_en: { type: "string", description: "對方先講的一句英文" } } },
    },
  },
  grade_drill: {
    type: "object", additionalProperties: false, required: ["correct", "feedback_zh", "correct_en", "correct_zh", "pattern"],
    properties: { correct: { type: "boolean" }, feedback_zh: { type: "string" }, correct_en: { type: "string" }, correct_zh: { type: "string" }, pattern: { type: "string" } },
  },
  grade_output: {
    type: "object", additionalProperties: false, required: ["understandable", "understandable_zh", "errors", "natural_en", "natural_zh", "praise_zh", "cards"],
    properties: {
      understandable: { type: "string", enum: ["yes", "mostly", "no"] },
      understandable_zh: { type: "string" },
      errors: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["said", "correct", "why_zh", "pattern"], properties: { said: { type: "string" }, correct: { type: "string" }, why_zh: { type: "string" }, pattern: { type: "string" } } } },
      natural_en: { type: "string" }, natural_zh: { type: "string" }, praise_zh: { type: "string" },
      cards: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["kind", "en", "zh"], properties: { kind: { type: "string", enum: ["word", "sentence"] }, en: { type: "string" }, zh: { type: "string" } } } },
    },
  },
  grade_review: {
    type: "object", additionalProperties: false, required: ["correct", "note_zh"],
    properties: { correct: { type: "boolean" }, note_zh: { type: "string" } },
  },
  pii_check: {
    type: "object", additionalProperties: false, required: ["has_name", "names", "note_zh"],
    properties: { has_name: { type: "boolean" }, names: { type: "array", items: { type: "string" } }, note_zh: { type: "string" } },
  },
  weekly_task: {
    type: "object", additionalProperties: false, required: ["tasks"],
    properties: { tasks: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["task_zh", "prompt_en"], properties: { task_zh: { type: "string" }, prompt_en: { type: "string" } } } } },
  },
  grade_task: {
    type: "object", additionalProperties: false, required: ["passed", "score", "feedback_zh"],
    properties: { passed: { type: "boolean" }, score: { type: "integer", minimum: 0, maximum: 100 }, feedback_zh: { type: "string" } },
  },
};

function buildPrompt(action: string, p: any, profile: Profile): { user: string; schema: any; max_tokens: number; effort: string } {
  switch (action) {
    case "reading_test":
      return { schema: S.reading_test, max_tokens: 1500, effort: "low",
        user: `請出一段「聽讀測試」短文：3 到 4 句、生活情境（例如在咖啡店、在機場），每句不超過 7 個字、只用最常用 500 字。另外給整段的中文意思（reference_zh）供比對。` };
    case "assess_grade":
      return { schema: S.assess_grade, max_tokens: 3000, effort: "medium",
        user: `請評估學生的程度並決定起點。
【字彙測驗】估計字彙量：${p.vocab_est} 字。各級認識情況：${JSON.stringify(p.vocab_detail ?? {})}
【聽讀測驗】短文：${JSON.stringify(p.reading?.sentences ?? [])}
參考中文：${p.reading?.reference_zh ?? ""}
學生寫的中文理解：「${p.reading?.user_zh ?? ""}」
【情境寫作】題目：${p.writing?.task_zh ?? ""}
學生寫的英文：「${p.writing?.user_en ?? ""}」
請給：CEFR（只能 A1/A2/B1）、閱讀分數、閱讀與寫作的具體回饋、聽說讀寫各一句弱點判斷、建議起點（start_stage 一律 1，start_week 一律 1，除非字彙量 ≥ 1500 且寫作流暢才可 start_week 2）、一段 3 句內的總結（鼓勵但誠實）、以及最多 6 張值得先收的卡片（從學生寫錯或該學的句子來）。` };
    case "lesson_generate":
      return { schema: S.lesson_generate, max_tokens: 8000, effort: "medium",
        user: `請生成今天的課程（第 ${p.day_in_week ?? 1} 天，本週已學過的字：${JSON.stringify(p.learned_words ?? [])}，請不要重複教這些字）。
1. grammar_point：今天的小文法點，從本週核心句型挑一個，不用術語，用生活化比喻說明，3 個例句。
2. dialogue：一段當週主題的生活對話 6 到 10 句，兩個人（用 A 和 B），每句不超過字數上限，附中文。
3. vocab：今天的新單字，最多 ${Math.min(profile.daily_new_words, 12)} 個，從對話裡挑，附中文與一個例句。寧少而熟。
4. questions：3 題理解題（用簡單英文問、附中文提示、3 選 1）。
5. drills：5 到 8 題四類操練，四類都要出現至少一次，材料只用對話裡的句子與核心句型；${p.day_in_week && p.day_in_week > 1 ? "優先針對學生常錯句型。" : ""}
6. output_task：一個真實情境讓學生用英文回應，給對方先講的一句英文。
${p.is_buffer ? "【注意】本週是緩衝週：對話與操練只能用前幾週學過的內容複習，vocab 給空陣列。" : ""}` };
    case "grade_drill":
      return { schema: S.grade_drill, max_tokens: 800, effort: "low",
        user: `操練題：${JSON.stringify(p.drill)}
學生的回答：「${p.user_answer}」
判斷是否正確（大小寫、句尾標點、縮寫 I'm/I am 不算錯；意思對、文法對就算對）。錯的話具體說哪個詞、為什麼、該怎麼說。` };
    case "grade_output":
      return { schema: S.grade_output, max_tokens: 2500, effort: "medium",
        user: `產出任務：${JSON.stringify(p.task)}
學生用英文的回應：「${p.user_text}」
請回饋固定三項：對方聽得懂嗎（yes/mostly/no 加一句中文說明）、哪裡講錯（每個錯誤：學生說的、正確說法、為什麼、句型標籤）、更自然的說法（一段、不超過學生程度、附中文）。另外給一句真誠的鼓勵，以及最多 4 張值得收的卡片（從錯誤或自然說法來）。不要代寫超出學生程度的句子。` };
    case "grade_review":
      return { schema: S.grade_review, max_tokens: 500, effort: "low",
        user: `句子卡：英文「${p.card?.en}」、中文「${p.card?.zh}」。學生看中文後說出的英文：「${p.user_answer}」。意思與文法都對就算對（同義說法也算），錯就一句話說哪裡錯。` };
    case "pii_check":
      return { schema: S.pii_check, max_tokens: 500, effort: "low",
        user: `請檢查下面這段文字是否含有「真實人名」（中文或英文姓名，包含病人、同事、家人的名字；不含 A/B、病人、治療師這種代稱）。只回報是否有人名與名單。
文字：「${p.text}」` };
    case "weekly_task":
      return { schema: S.weekly_task, max_tokens: 1200, effort: "low",
        user: `請出本週的「任務測驗」3 題：每題給一個生活情境（中文）與對方先說的一句英文，學生要用英文完成任務。難度符合學生程度與本週主題。` };
    case "grade_task":
      return { schema: S.grade_task, max_tokens: 1200, effort: "low",
        user: `本週任務測驗。題目：${JSON.stringify(p.tasks)}
學生的回答：${JSON.stringify(p.answers)}
請給一個 0 到 100 的「任務達成度」分數（能否完成任務為主，小錯不扣太多）、是否通過（≥70）、一段中文回饋。` };
    default:
      throw new Error("unknown action");
  }
}

async function callClaude(model: string, system: string, user: string, schema: any, max_tokens: number, effort: string) {
  const t0 = Date.now();
  const body = {
    model,
    max_tokens,
    fallbacks: "default",
    system: [
      { type: "text", text: RULES, cache_control: { type: "ephemeral" } },
      { type: "text", text: system },
    ],
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: user }],
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  const ms = Date.now() - t0;
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${data?.error?.message ?? JSON.stringify(data).slice(0, 300)}`);
  if (data.stop_reason === "refusal") throw new Error("Claude 拒絕了這次請求：" + (data.stop_details?.explanation ?? ""));
  const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("回傳不是合法 JSON：" + text.slice(0, 200)); }
  return { parsed, usage: data.usage ?? {}, ms, model: data.model ?? model };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const user = await getUser(req);
    if (!user?.id) return json({ ok: false, error: "請先登入" }, 401);
    if (!ANTHROPIC_KEY) return json({ ok: false, error: "後台尚未設定 ANTHROPIC_API_KEY 密鑰，請到 Supabase → Edge Functions → Secrets 新增。" }, 500);
    const { action, payload = {} } = await req.json();

    const [profRows, errRows] = await Promise.all([
      sbGet(`profile?user_id=eq.${user.id}&select=*`),
      sbGet(`errors?user_id=eq.${user.id}&select=pattern&order=created_at.desc&limit=60`),
    ]);
    const profile: Profile = profRows[0] ?? { cefr: "A1", vocab_est: 0, level_adjust: 0, stage: 1, week: 1, daily_new_words: 12, model: DEFAULT_MODEL, error_summary: "", settings: {} };
    const curRows = await sbGet(`curriculum?stage=eq.${profile.stage}&week=eq.${profile.week}&select=*`);
    const cur = curRows[0];
    const counts: Record<string, number> = {};
    for (const e of errRows) counts[e.pattern] = (counts[e.pattern] ?? 0) + 1;
    const topErrors = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}（錯 ${v} 次）`);

    const { user: userPrompt, schema, max_tokens, effort } = buildPrompt(action, { ...payload, is_buffer: cur?.is_buffer }, profile);
    const model = (payload.model as string) || profile.model || DEFAULT_MODEL;
    const res = await callClaude(model, stateBlock(profile, cur, topErrors), userPrompt, schema, max_tokens, effort);

    sbInsert("api_log", {
      user_id: user.id, action, model: res.model,
      input_tokens: res.usage.input_tokens ?? 0, output_tokens: res.usage.output_tokens ?? 0,
      cache_read: res.usage.cache_read_input_tokens ?? 0, cache_write: res.usage.cache_creation_input_tokens ?? 0,
      ms: res.ms, ok: true,
    });
    return json({ ok: true, data: res.parsed, usage: res.usage });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
