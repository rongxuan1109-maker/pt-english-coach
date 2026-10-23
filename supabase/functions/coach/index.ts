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
3. FSI 操練：重點是「答快，不是答對」，練到不假思索的反射。四類句型操練。substitution＝代換（換一個字）、transformation＝變化（肯定↔否定↔問句、單數↔複數、時態）、response＝應答（聽到問句要回答）、expansion＝擴展（加時間/地點/原因）。材料只能來自當週主題與核心句型。
4. 間隔重複：單字卡與句子卡，只收學生練習中遇到或答錯的句子。每日新字上限由狀態區給定，不得超過。
5. 衝刺：目前位於狀態區所列的階段與週主題，不要跳到其他主題。
6. 用英文做事：產出任務由學生自己寫，你只修正、不代寫整段；可以給「更自然的說法」示範一句。
7. 說明用繁體中文（台灣用語），練習用英文。學生 B1 以後再逐步增加英文說明。
8. 糾錯要具體：哪個詞、為什麼錯、該怎麼說。不要只說「很好」。語氣溫暖、鼓勵、像並肩作戰的夥伴，但誠實。
9. 每個英文句子都要附簡短中文意思（學生聽讀用）。
10. 你輸出的內容一律符合指定的 JSON 結構，不要多加解釋文字。
11. 翻譯是學步車，不是敵人：學生初期會中翻英很正常，目標是靠大量重複讓「畫面直接接英文」自己長出來。所以練習的提示盡量用英文或畫面（表情圖示、情境），中文只當第二層提示；學生到 B1 後中文提示淡出。
12. 「講自己的話」要給骨架：自由輸出前先給 5 個開口語塊（I think… / because… / Actually… / The thing is… / Let me see…這類），同一題讓學生講三次（60 秒→45 秒→30 秒），前兩次只回一句更自然的說法、不批改，第三次才完整回饋並指出三次之間的進步。
13. 訓練時間不設上限：學生想練多久就練多久。操練題可以多（應答／擴展各 4 到 5 題），學生要求「加練」時隨時生成新的句型操練。`;

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

// ===== 共用結構 =====
const PATTERN_ITEMS = { type: "array", description: "FSI 句型快答：每個句型先代換 20 次再轉換 10 次", items: { type: "object", additionalProperties: false, required: ["label", "base_en", "base_zh", "substitution", "transformation"], properties: {
  label: { type: "string", description: "句型標籤，例如 I am from + 地方" },
  base_en: { type: "string" }, base_zh: { type: "string" },
  substitution: { type: "array", items: { type: "object", additionalProperties: false, required: ["cue", "answer"], properties: { cue: { type: "string", description: "提示詞，1 到 3 個字，例如 Japan / She / not" }, answer: { type: "string", description: "套進去之後的完整句子" } } } },
  transformation: { type: "array", items: { type: "object", additionalProperties: false, required: ["cue", "answer"], properties: { cue: { type: "string", description: "轉換指令，用中文短詞，例如 問句 / 否定 / 他 / 複數 / 過去" }, answer: { type: "string" } } } },
} } };
const EXTRA_DRILL_ITEMS = { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "instruction_zh", "prompt_en", "answer_en", "pattern"], properties: { type: { type: "string", enum: ["response", "expansion"] }, instruction_zh: { type: "string" }, prompt_en: { type: "string" }, answer_en: { type: "string" }, pattern: { type: "string" } } } };
const NARRATE_ITEMS = { type: "array", description: "畫面旁白：5 個日常動作，只給表情圖示與英文問句，不給中文，學生看畫面直接說英文", items: { type: "object", additionalProperties: false, required: ["emoji", "question_en", "answer_en", "zh"], properties: { emoji: { type: "string", description: "1 到 3 個表情圖示組成的畫面，例如 🚰🥛 或 🚶‍♂️🏥" }, question_en: { type: "string", description: "老師問的英文問句，例如 What are you doing?" }, answer_en: { type: "string", description: "參考答案，一句、在字數上限內，例如 I'm pouring water." }, zh: { type: "string", description: "參考答案的中文，只在學生看答案時顯示" } } } };
const CHUNK_ITEMS = { type: "array", description: "開口語塊：5 個講自己想法時的句子骨架", items: { type: "object", additionalProperties: false, required: ["en", "zh", "when_zh"], properties: { en: { type: "string", description: "例如 I think… / because… / Actually, … / The thing is, … / Let me see…" }, zh: { type: "string" }, when_zh: { type: "string", description: "什麼時候用，8 字內，例如「要講看法時」" } } } };

// ===== 各動作的 JSON 結構 =====
const S = {
  reading_test: {
    type: "object", additionalProperties: false,
    required: ["sentences", "reference_zh"],
    properties: {
      sentences: { type: "array", items: { type: "object", additionalProperties: false, required: ["en"], properties: { en: { type: "string" } } } },
      reference_zh: { type: "string", description: "整段的中文意思，用來比對學生的理解" },
    },
  },
  assess_grade: {
    type: "object", additionalProperties: false,
    required: ["cefr", "reading_score", "reading_feedback_zh", "writing_feedback_zh", "weaknesses", "start_stage", "start_week", "summary_zh", "cards"],
    properties: {
      cefr: { type: "string", enum: ["A1", "A2", "B1"] },
      reading_score: { type: "integer" },
      reading_feedback_zh: { type: "string" },
      writing_feedback_zh: { type: "string" },
      weaknesses: { type: "object", additionalProperties: false, required: ["listening", "speaking", "reading", "writing"],
        properties: { listening: { type: "string" }, speaking: { type: "string" }, reading: { type: "string" }, writing: { type: "string" } } },
      start_stage: { type: "integer" }, start_week: { type: "integer" },
      summary_zh: { type: "string" },
      cards: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "en", "zh"], properties: { kind: { type: "string", enum: ["word", "sentence"] }, en: { type: "string" }, zh: { type: "string" } } } },
    },
  },
  lesson_generate: {
    type: "object", additionalProperties: false,
    required: ["title_zh", "grammar_point", "dialogue", "vocab", "questions", "patterns", "extra_drills", "narrate", "chunks", "reading_passage", "output_task"],
    properties: {
      title_zh: { type: "string" },
      grammar_point: { type: "object", additionalProperties: false, required: ["title_zh", "explain_zh", "examples"],
        properties: { title_zh: { type: "string" }, explain_zh: { type: "string", description: "不用術語，用生活化比喻，3 句內" }, examples: { type: "array", items: { type: "object", additionalProperties: false, required: ["en", "zh"], properties: { en: { type: "string" }, zh: { type: "string" } } } } } },
      dialogue: { type: "array", items: { type: "object", additionalProperties: false, required: ["speaker", "en", "zh"], properties: { speaker: { type: "string" }, en: { type: "string" }, zh: { type: "string" } } } },
      vocab: { type: "array", items: { type: "object", additionalProperties: false, required: ["en", "zh", "example_en"], properties: { en: { type: "string" }, zh: { type: "string" }, example_en: { type: "string" } } } },
      questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["q_en", "q_zh", "options", "answer_index"], properties: { q_en: { type: "string" }, q_zh: { type: "string" }, options: { type: "array", items: { type: "string" } }, answer_index: { type: "integer" } } } },
      patterns: PATTERN_ITEMS,
      extra_drills: EXTRA_DRILL_ITEMS,
      reading_passage: { type: "object", additionalProperties: false, required: ["title_zh", "sentences"], properties: { title_zh: { type: "string" }, sentences: { type: "array", items: { type: "object", additionalProperties: false, required: ["en", "zh"], properties: { en: { type: "string" }, zh: { type: "string" } } } } } },
      narrate: NARRATE_ITEMS,
      chunks: CHUNK_ITEMS,
      output_task: { type: "object", additionalProperties: false, required: ["scene_zh", "scene_en", "starter_en"], properties: { scene_zh: { type: "string" }, scene_en: { type: "string" }, starter_en: { type: "string", description: "對方先講的一句英文" } } },
    },
  },
  narrate_set: { type: "object", additionalProperties: false, required: ["narrate"], properties: { narrate: NARRATE_ITEMS } },
  chunks_set: { type: "object", additionalProperties: false, required: ["chunks"], properties: { chunks: CHUNK_ITEMS } },
  extra_patterns: { type: "object", additionalProperties: false, required: ["patterns", "extra_drills"], properties: { patterns: PATTERN_ITEMS, extra_drills: EXTRA_DRILL_ITEMS } },
  output_quick: {
    type: "object", additionalProperties: false, required: ["understood_zh", "natural_en", "natural_zh", "tip_zh"],
    properties: { understood_zh: { type: "string", description: "一句話說你聽懂他想講什麼" }, natural_en: { type: "string", description: "把學生講的改成一句更自然、不超過程度的英文" }, natural_zh: { type: "string" }, tip_zh: { type: "string", description: "下一次重講時的一個小建議，10 字內" } },
  },
  grade_drill: {
    type: "object", additionalProperties: false, required: ["correct", "feedback_zh", "correct_en", "correct_zh", "pattern"],
    properties: { correct: { type: "boolean" }, feedback_zh: { type: "string" }, correct_en: { type: "string" }, correct_zh: { type: "string" }, pattern: { type: "string" } },
  },
  grade_output: {
    type: "object", additionalProperties: false, required: ["understandable", "understandable_zh", "errors", "natural_en", "natural_zh", "praise_zh", "rounds_note_zh", "chunks_used", "cards"],
    properties: {
      understandable: { type: "string", enum: ["yes", "mostly", "no"] },
      rounds_note_zh: { type: "string", description: "若學生講了多次，指出幾次之間的進步（更長、更順、用了語塊）；只講一次就給空字串" },
      chunks_used: { type: "array", items: { type: "string" }, description: "學生用到的開口語塊" },
      understandable_zh: { type: "string" },
      errors: { type: "array", items: { type: "object", additionalProperties: false, required: ["said", "correct", "why_zh", "pattern"], properties: { said: { type: "string" }, correct: { type: "string" }, why_zh: { type: "string" }, pattern: { type: "string" } } } },
      natural_en: { type: "string" }, natural_zh: { type: "string" }, praise_zh: { type: "string" },
      cards: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "en", "zh"], properties: { kind: { type: "string", enum: ["word", "sentence"] }, en: { type: "string" }, zh: { type: "string" } } } },
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
    properties: { tasks: { type: "array", items: { type: "object", additionalProperties: false, required: ["task_zh", "prompt_en"], properties: { task_zh: { type: "string" }, prompt_en: { type: "string" } } } } },
  },
  grade_task: {
    type: "object", additionalProperties: false, required: ["passed", "score", "feedback_zh"],
    properties: { passed: { type: "boolean" }, score: { type: "integer" }, feedback_zh: { type: "string" } },
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
      return { schema: S.lesson_generate, max_tokens: 14000, effort: "medium",
        user: `請生成今天的課程（第 ${p.day_in_week ?? 1} 天，本週已學過的字：${JSON.stringify(p.learned_words ?? [])}，請不要重複教這些字）。
1. grammar_point：今天的小文法點，從本週核心句型挑一個，不用術語，用生活化比喻說明，3 個例句。
2. dialogue：一段當週主題的生活對話 6 到 10 句，兩個人（用 A 和 B），每句不超過字數上限，附中文。
3. vocab：今天的新單字，最多 ${Math.min(profile.daily_new_words, 12)} 個，從對話裡挑，附中文與一個例句。寧少而熟。
4. questions：3 題理解題（用簡單英文問、附中文提示、3 選 1）。
5. patterns：FSI 句型快答，2 到 3 個句型（從本週核心句型挑，${p.day_in_week && p.day_in_week > 1 ? "優先針對學生常錯句型，" : ""}每天換不同的）。每個句型給：基礎句 base_en（附中文）、substitution 代換 20 題（cue 是 1 到 3 個字的提示詞，學生要在 3 秒內把它套進句子，answer 是完整句；提示詞要連鎖變化，像 Japan → She → Korea → They → not → Taiwan…，每次只換一個位置，後一題接著前一題的句子變）、transformation 轉換 10 題（cue 用中文短指令：問句／否定／他／她／複數／過去／縮寫…，從 base_en 出發，answer 是完整句）。所有句子都要在字數上限內、只用學生懂的字。
6. extra_drills：8 到 10 題應答（response）與擴展（expansion）操練各半，材料只用對話裡的句子與核心句型。擴展題的 prompt_en 用「基礎句 + 新零件」的寫法（例如 There is a cup on the table. → spoon），answer_en 是加進去之後的完整句。
7. reading_passage：一段給學生「大聲朗讀」的短文 6 到 8 句，當週主題、第一人稱或生活小故事，每句在字數上限內，附中文（預設不顯示）。學生會先看著讀、再遮住憑記憶說，所以每句要短、有畫面。
8. narrate：5 個「畫面旁白」：日常動作（倒水、走路去上班、吃早餐、打電話、看手機…）用 1 到 3 個表情圖示當畫面，加一個英文問句（What are you doing? / What is she doing?），參考答案一句用本週句型或現在進行式，不給中文提示（zh 只在看答案時顯示）。
9. chunks：5 個「開口語塊」，給學生講自己想法時當骨架（I think… / because… / Actually, … / The thing is, … / Let me see… / I'm not sure, but…），依本週主題挑最用得上的 5 個，附中文與「什麼時候用」。
10. output_task：一個真實情境讓學生用英文回應，給對方先講的一句英文。學生會把同一題講三次，所以情境要有「可以多講一點」的空間（例如：介紹自己和今天的計畫），不要只能回一句的題目。
${p.is_buffer ? "【注意】本週是緩衝週：對話與操練只能用前幾週學過的內容複習，vocab 給空陣列。" : ""}` };
    case "grade_drill":
      return { schema: S.grade_drill, max_tokens: 800, effort: "low",
        user: `操練題：${JSON.stringify(p.drill)}
學生的回答：「${p.user_answer}」
判斷是否正確（大小寫、句尾標點、縮寫 I'm/I am 不算錯；意思對、文法對就算對）。錯的話具體說哪個詞、為什麼、該怎麼說。` };
    case "grade_output":
      return { schema: S.grade_output, max_tokens: 2500, effort: "medium",
        user: `產出任務：${JSON.stringify(p.task)}
${p.rounds?.length > 1 ? `學生把同一題講了 ${p.rounds.length} 次（限時 ${p.rounds.map((r: any) => r.limit + "秒").join("→")}）：\n${p.rounds.map((r: any, i: number) => `第 ${i + 1} 次（${r.words} 字、用了 ${r.secs} 秒）：「${r.text}」`).join("\n")}\n請以最後一次為主評分。` : `學生用英文的回應：「${p.user_text}」`}
可用的開口語塊：${JSON.stringify(p.chunks ?? [])}
請回饋固定三項：對方聽得懂嗎（yes/mostly/no 加一句中文說明）、哪裡講錯（每個錯誤：學生說的、正確說法、為什麼、句型標籤）、更自然的說法（一段、不超過學生程度、附中文）。另外：rounds_note_zh 指出幾次之間的進步（講了幾次才有，只講一次給空字串）、chunks_used 列出學生用到的語塊、一句真誠的鼓勵、最多 4 張值得收的卡片（從錯誤或自然說法來）。不要代寫超出學生程度的句子。` };
    case "output_quick":
      return { schema: S.output_quick, max_tokens: 600, effort: "low",
        user: `產出任務：${JSON.stringify(p.task)}
學生第 ${p.round} 次講（限時 ${p.limit} 秒）：「${p.user_text}」
這是中間回合，不要批改、不要列錯誤。只做三件事：一句話說你聽懂他想講什麼；把他講的內容整理成一句更自然、不超過他程度的英文（他下一次重講會試著用上）；給一個 10 字內的小建議（例如「加一句為什麼」「用 because 接下去」「講慢一點沒關係」）。` };
    case "narrate_set":
      return { schema: S.narrate_set, max_tokens: 1200, effort: "low",
        user: `請出 5 題「畫面旁白」：日常動作用 1 到 3 個表情圖示當畫面（例如 🚰🥛、🚶‍♂️🏥、☕️📱），加一個英文問句（What are you doing? / What is he doing?），參考答案一句、用現在進行式或本週句型、在字數上限內，不要和這些重複：${JSON.stringify(p.avoid ?? [])}。` };
    case "chunks_set":
      return { schema: S.chunks_set, max_tokens: 800, effort: "low",
        user: `請給 5 個「開口語塊」讓學生講自己想法時當骨架（I think… / because… / Actually, … / The thing is, … / Let me see… / I'm not sure, but… 這類），依本週主題與程度挑最用得上的 5 個，附中文與 8 字內的「什麼時候用」。` };
    case "extra_patterns":
      return { schema: S.extra_patterns, max_tokens: 9000, effort: "low",
        user: `學生要「加練」。請生成 ${p.count ?? 2} 個新的 FSI 句型快答${p.topic ? `，主題：${p.topic}` : "，從本週與之前學過的核心句型挑"}${p.focus?.length ? `，優先練這些常錯句型：${p.focus.join("；")}` : ""}。每個句型：基礎句 base_en（附中文）、substitution 代換 20 題（提示詞 1 到 3 個字、連鎖變化、每次只換一個位置）、transformation 轉換 10 題（中文短指令：問句／否定／他／她／複數／過去）。另外 6 題應答／擴展（extra_drills）。不要和這些基礎句重複：${JSON.stringify(p.avoid ?? [])}。所有句子在字數上限內、只用學生懂的字。` };
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
