# 英文教練（pt-english-coach）

> 只有一個學生的英文補習班。手機網頁 + Supabase（資料庫／登入／後台函式）+ Claude 當老師。
> 規格書：`docs/2026-10-19-spec.md`

## 架構一眼看懂
```
手機瀏覽器 index.html / app.js / style.css（GitHub Pages）
   │  登入、讀寫自己的資料（supabase-js，公開鑰匙 + RLS 鎖門）
   ▼
Supabase 專案 wkurcpnreriqyserpsrq
   ├─ 資料表：profile / assessments / lessons / cards / reviews / errors / curriculum / api_log（+ 預留 conversations / custom_scenes）
   ├─ Auth：單一帳號，已關閉註冊
   └─ Edge Function「coach」：教學規則寫死 + 讀學習狀態 → 呼叫 Claude API（金鑰在密鑰保險箱）
```

## 安裝與啟動
1. **設定 Claude 金鑰（只需一次）**：Supabase 後台 → 專案「英文教練 pt-english」→ Edge Functions → Secrets → 新增
   `ANTHROPIC_API_KEY` = 你的 Anthropic API 金鑰。網頁與程式碼都不會碰到這把鑰匙。
2. **網址**：https://rongxuan1109-maker.github.io/pt-english-coach/
   手機 Safari 開啟 → 分享 → 加入主畫面，就像 App。
3. **登入**：Email `rongxuan1109@gmail.com`，初始密碼 `English@2026`（登入後請到「設定 → 改密碼」改掉）。

### 本機試跑（不一定需要）
```bash
cd ~/pt-english-coach && python3 -m http.server 8080
# 開 http://localhost:8080
```

## v2（2026-10-24）：針對「看得懂、跟得上，但講不出自己的話」
研究依據：回想練習勝過重讀（testing effect）、Nation 4/3/2 同題重講、Bygate 任務重複、Boers 語塊與流利度、Kroll 雙語模型（翻譯是學步車）。影片依據：brain 學霸《冷戰時期 CIA 語言訓練曝光》（FSI 四種操練、答快不答對、每天三塊）。
- **朗讀加「遮住說」**：每句先看著讀，再把句子模糊掉憑記憶說出來（練「拿出來」而不是「認得」）。設定可關。
- **新段落「畫面旁白」**：5 個表情圖示畫面＋英文問句，不給中文，看畫面直接說英文；加練可再來 5 個。
- **輸出改「同一題講三次」**：60→45→30 秒，前兩次只給一句更自然說法＋小建議，第三次完整回饋並指出三次之間的進步；記錄每次字數與字/分。設定可改 1–3 次。
- **開口語塊工具列**：每天 5 個句子骨架（I think… / because… / Actually… / The thing is… / Let me see…），點一下會唸；回饋會列出用到哪些。
- **加練模式（時間不設上限）**：結束頁與課程中都可「加練快答」：再跑今天句型（不叫老師）／請老師出新句型（本週＋常錯）／指定主題出題；也可再來 5 個畫面、換一題再講三次。加練不算進當天成績。
- **進度頁「兩條肌肉」**：快答率（反射）與輸出流暢度（字/分）兩條趨勢線並排。
- 後台新動作：`narrate_set`、`chunks_set`、`extra_patterns`、`output_quick`；`lesson_generate` 多出 `narrate`、`chunks`，`grade_output` 多出 `rounds_note_zh`、`chunks_used`。舊後台跑新前端會略過中途回饋、旁白可跳過。
- 部署後台函式：`./deploy_fn.sh sbp_你的個人存取權杖`（會順便驗證新動作）。

## 每日使用流程（至少一輪，之後不限時）
1. 第一次：**程度評估**（字彙 20 題 → 聽讀短文 → 情境寫作 → 結果與起點）。
2. 每天打開「今日」：**複習**到期卡片 → **輸入**（小文法 + 對話 + 新字 + 3 題理解題）→ **快答**（FSI 句型訓練：基礎句 → 連續提示詞，3 秒內開口，每句型代換 20 次再轉換 10 次，重點是答快不是答對）→ **旁白**（看畫面直接說）→ **朗讀**（看著讀 → 遮住說）→ **輸出**（同一題講三次，語塊工具列，三項回饋＋進步）→ 結束頁看快答率、流暢度、新卡與本週達成度，想練再按「加練」。
   快答的限時秒數、代換次數、自動麥克風都在「設定」可調。
3. 每段完成自動打勾，中途離開下次接續。
4. 每週日開啟會提示**字彙重測**；第 6 天後可做**本週任務測驗**。
5. 「卡庫」翻卡、搜尋、手動加卡、匯出 CSV；「進度」看趨勢；「設定」換模型、調新字上限、貼入去識別化內容。

## 重新部署
- **網頁**：改檔案後 `git add -A && git commit -m "..." && git push`，GitHub Pages 幾分鐘後更新；手機若還是舊版，網址後加 `?v=123`。
- **後台函式**（改了 `supabase/functions/coach/index.ts`）：
  ```bash
  cd ~/pt-english-coach/supabase/functions/coach
  curl -s -X POST "https://api.supabase.com/v1/projects/wkurcpnreriqyserpsrq/functions/deploy?slug=coach" \
    -H "Authorization: Bearer <Supabase 個人存取權杖 sbp_...>" \
    -F 'metadata={"entrypoint_path":"index.ts","name":"coach","verify_jwt":false}' -F "file=@index.ts"
  ```
- **資料表**：`supabase/sql/001_schema.sql`（已套用）。新 SQL 用 Management API `POST /v1/projects/<ref>/database/query` 執行。

## 費用
- Opus 5.5 每天約 6–10 次呼叫（準備課程 1 次、糾錯數次）。系統提示有做快取。「進度」頁有本月估算。
- 想省錢：設定 → Claude 模型 → Sonnet 5.5。

## 已知限制
- iPhone Safari 的語音辨識準度比 Chrome 弱，聲音由 Apple 伺服器辨識（瀏覽器內建行為）。不支援時自動退回打字。
- 人名偵測靠 Claude 判斷，不是 100%；身分證、電話、生日由規則擋。
- GitHub Pages 網址公開，但沒登入什麼都看不到；資料全部鎖在 Supabase。
