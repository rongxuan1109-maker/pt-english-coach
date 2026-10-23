#!/bin/bash
# 部署後台函式 coach 到 Supabase（需要個人存取權杖 sbp_...）
# 用法：./deploy_fn.sh sbp_xxx [英文教練登入密碼]
# 權杖在 https://supabase.com/dashboard/account/tokens 產生
TOKEN="${1:-$SUPABASE_ACCESS_TOKEN}"
if [ -z "$TOKEN" ]; then echo "請給 Supabase 個人存取權杖：./deploy_fn.sh sbp_xxx"; exit 1; fi
cd "$(dirname "$0")/supabase/functions/coach" || exit 1
echo "--- 部署 coach ---"
curl -s -X POST "https://api.supabase.com/v1/projects/wkurcpnreriqyserpsrq/functions/deploy?slug=coach" \
  -H "Authorization: Bearer $TOKEN" \
  -F 'metadata={"entrypoint_path":"index.ts","name":"coach","verify_jwt":false}' -F "file=@index.ts" | head -c 400; echo
echo "--- 驗證新動作（請老師給 5 個開口語塊）---"
KEY=sb_publishable_kjZW8UQ-enXvZjNExMFRWw_ukWE8TzU
PW="${2:-$COACH_PW}"
if [ -z "$PW" ]; then echo "（沒給登入密碼，略過驗證。要驗證：./deploy_fn.sh sbp_xxx 登入密碼）"; exit 0; fi
JWT=$(curl -s -X POST "https://wkurcpnreriqyserpsrq.supabase.co/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"email\":\"rongxuan1109@gmail.com\",\"password\":\"$PW\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
curl -s -m 90 -X POST "https://wkurcpnreriqyserpsrq.supabase.co/functions/v1/coach" -H "apikey: $KEY" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"action":"chunks_set","payload":{}}' | head -c 700; echo
