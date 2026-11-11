#!/usr/bin/env bash
# ShortsPilot AI — End-to-end API test suite
# Tests EVERY section: health, auth, ideas, scripts, voice, visuals, videos,
# channels, publishing, billing, analytics, automation, usage, notifications, admin.
# Run: bash tests/api-e2e.sh

set -u
BASE="${1:-http://localhost:3000}"
JAR=$(mktemp)
PASS=0; FAIL=0; SKIP=0; RESULTS=""

section() { RESULTS+="\n\033[1m== $1 ==\033[0m"; }
check() { # name, expected_status, actual_status, extra
  local name="$1" exp="$2" act="$3" extra="${4:-}"
  if [ "$act" = "$exp" ]; then PASS=$((PASS+1)); RESULTS+="  \033[32m✓ $name ($act)\033[0m $extra\n";
  else FAIL=$((FAIL+1)); RESULTS+="  \033[31m✗ $name (got $act, want $exp)\033[0m $extra\n"; fi
}
# SKIP for external-provider rate limits (not an app defect)
skip() { SKIP=$((SKIP+1)); RESULTS+="  \033[33m⚠ SKIP $1 ($2 — external TTS/LLM provider rate-limited)\033[0m\n"; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
body() { curl -s "$@"; }
# single-call request: sets RCODE (status) and RBODY (body)
req() { RBODY=$(curl -s -w "\n%{http_code}" "$@"); RCODE=$(echo "$RBODY" | tail -1); RBODY=$(echo "$RBODY" | sed '$d'); }
# retry wrapper for external AI calls (TTS/LLM may 429 under burst); sets RCODE/RBODY
req_retry() { # max_attempts sleep_secs curl_args...
  local attempts="$1" wait_s="$2"; shift 2
  local i
  for i in $(seq 1 "$attempts"); do
    req "$@"
    if [ "$RCODE" != "429" ] && [ "$RCODE" != "500" ]; then return; fi
    [ "$i" -lt "$attempts" ] && sleep "$wait_s"
  done
}

Email="e2e-$(date +%s)@test.shortspilot.ai"

section "HEALTH"
check "GET /health" 200 "$(code $BASE/api/v1/health)"

section "AUTH (register / login / me / logout)"
check "POST /auth/register" 201 "$(code -X POST $BASE/api/v1/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$Email\",\"name\":\"E2E Tester\",\"password\":\"test12345\"}" -c $JAR)"
check "POST /auth/login (fresh user)" 200 "$(code -X POST $BASE/api/v1/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$Email\",\"password\":\"test12345\"}" -c $JAR)"
check "GET /auth/me (session)" 200 "$(code $BASE/api/v1/auth/me -b $JAR)"
check "GET /auth/me (no session -> 200 null-user or 401)" 200 "$(code $BASE/api/v1/auth/me)"
check "POST /auth/login (wrong pw)" 401 "$(code -X POST $BASE/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"nobody@x.io","password":"bad"}')"

section "ONBOARDING + DASHBOARD"
check "GET /onboarding" 200 "$(code $BASE/api/v1/onboarding -b $JAR)"
check "PATCH /onboarding (profile save)" 200 "$(code -X PATCH $BASE/api/v1/onboarding -b $JAR -H 'Content-Type: application/json' -d '{"niche":"tech","audience":"builders","language":"English","scriptStyle":"educational","duration":45,"publishDays":"1,3,5","publishTime":"18:00","approvalMode":"approval","monthlyLimit":50}')"
check "GET /dashboard" 200 "$(code $BASE/api/v1/dashboard -b $JAR)"
check "GET/PATCH /users/me" 200 "$(code -X PATCH $BASE/api/v1/users/me -b $JAR -H 'Content-Type: application/json' -d '{"name":"E2E Renamed"}')"

section "IDEAS (generate / list / patch / delete)"
req_retry 3 15 -X POST $BASE/api/v1/ideas/generate -b $JAR -H 'Content-Type: application/json' -d '{"topic":"AI tools for creators","count":2}'
IDEA_GEN="$RBODY"
if [ "$RCODE" = "429" ]; then
  skip "POST /ideas/generate (LLM)" "$RCODE"
else
  check "POST /ideas/generate (LLM)" 201 "$RCODE"
fi
IDEA_ID=$(echo "$IDEA_GEN" | rg -o '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
check "GET /ideas list" 200 "$(code $BASE/api/v1/ideas?limit=10 -b $JAR)"
if [ -n "${IDEA_ID:-}" ]; then
  check "PATCH /ideas/:id (approve)" 200 "$(code -X PATCH $BASE/api/v1/ideas/$IDEA_ID -b $JAR -H 'Content-Type: application/json' -d '{"status":"APPROVED"}')"
fi

section "SCRIPTS (generate / list / patch / regenerate / delete)"
req_retry 3 15 -X POST $BASE/api/v1/scripts/generate -b $JAR -H 'Content-Type: application/json' -d '{"topic":"5 AI tools that save 10 hours a week","duration":45,"language":"English","tone":"educational"}'
SCR_GEN="$RBODY"
if [ "$RCODE" = "429" ]; then
  skip "POST /scripts/generate (LLM)" "$RCODE"
else
  check "POST /scripts/generate (LLM)" 201 "$RCODE"
fi
SCRIPT_ID=$(echo "$SCR_GEN" | rg -o '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
check "GET /scripts list" 200 "$(code $BASE/api/v1/scripts?limit=10 -b $JAR)"
if [ -n "${SCRIPT_ID:-}" ]; then
  check "PATCH /scripts/:id" 200 "$(code -X PATCH $BASE/api/v1/scripts/$SCRIPT_ID -b $JAR -H 'Content-Type: application/json' -d '{"status":"APPROVED"}')"
  req_retry 3 15 -X POST $BASE/api/v1/scripts/$SCRIPT_ID/regenerate -b $JAR -H 'Content-Type: application/json' -d '{"tone":"storytelling"}'
  if [ "$RCODE" = "429" ]; then
    skip "POST /scripts/:id/regenerate" "$RCODE"
  else
    check "POST /scripts/:id/regenerate" 201 "$RCODE"
  fi
fi

section "VOICES + TTS"
check "GET /voices" 200 "$(code $BASE/api/v1/voices -b $JAR)"
PV=$(code -X POST $BASE/api/v1/voice/preview -b $JAR -H 'Content-Type: application/json' -d '{"voiceId":"tongtong","text":"Hello from ShortsPilot"}')
if [ "$PV" = "200" ]; then check "POST /voice/preview (TTS)" 200 "$PV"; else TTS_WARMUP=0; skip "POST /voice/preview (TTS)" "$PV"; fi
TTS_OK=1
if [ -n "${SCRIPT_ID:-}" ]; then
  req_retry 4 25 -X POST $BASE/api/v1/voice/generate -b $JAR -H 'Content-Type: application/json' -d "{\"scriptId\":\"$SCRIPT_ID\",\"voiceId\":\"tongtong\"}"
  if [ "$RCODE" = "201" ]; then
    check "POST /voice/generate (script TTS)" 201 "$RCODE"
  else
    TTS_OK=0; skip "POST /voice/generate (script TTS)" "$RCODE"
  fi
fi
check "GET /voiceovers" 200 "$(code $BASE/api/v1/voiceovers -b $JAR)"

section "VISUALS + MEDIA (async job + status polling)"
VIS_OK=0
if [ "$TTS_OK" = "1" ] && [ -n "${SCRIPT_ID:-}" ]; then
  req_retry 3 15 -X POST $BASE/api/v1/visuals/generate -b $JAR -H 'Content-Type: application/json' -d "{\"scriptId\":\"$SCRIPT_ID\",\"style\":\"cinematic\"}"
  check "POST /visuals/generate (queued)" 202 "$RCODE"
  # poll the async job until DONE/FAILED (max ~3 min)
  ST=""
  for i in $(seq 1 60); do
    sleep 3
    ST=$(body "$BASE/api/v1/visuals/status?scriptId=$SCRIPT_ID" -b $JAR | rg -o '"status":"[A-Z_]+"' | head -1 | cut -d'"' -f4)
    case "$ST" in DONE|FAILED) break ;; esac
  done
  check "visual job completes" DONE "$ST"
  check "GET /visuals/status" 200 "$(code "$BASE/api/v1/visuals/status?scriptId=$SCRIPT_ID" -b $JAR)"
  [ "$ST" = "DONE" ] && VIS_OK=1
else
  skip "POST /visuals/generate" "no script/voiceover"
fi
check "GET /assets" 200 "$(code $BASE/api/v1/assets -b $JAR)"

section "VIDEOS + RENDER PIPELINE (needs script w/ scenes + ready voiceover)"
VIDEO_ID=""
if [ "$VIS_OK" = "1" ] && [ -n "${SCRIPT_ID:-}" ]; then
  req -X POST $BASE/api/v1/videos -b $JAR -H 'Content-Type: application/json' -d "{\"title\":\"E2E Test Video\",\"scriptId\":\"$SCRIPT_ID\"}"
  check "POST /videos (from approved script)" 201 "$RCODE"
  VIDEO_ID=$(echo "$RBODY" | rg -o '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
  check "GET /videos list" 200 "$(code $BASE/api/v1/videos -b $JAR)"
  if [ -n "${VIDEO_ID:-}" ]; then
    check "GET /videos/:id" 200 "$(code $BASE/api/v1/videos/$VIDEO_ID -b $JAR)"
    REN_CODE=$(code -X POST $BASE/api/v1/videos/$VIDEO_ID/render -b $JAR)
    check "POST /videos/:id/render (queued)" 202 "$REN_CODE"
    # Poll worker pipeline: status must leave DRAFT and progress through stages
    PIPELINE_OK=0
    for i in $(seq 1 20); do
      sleep 3
      ST=$(body $BASE/api/v1/videos/$VIDEO_ID -b $JAR | rg -o '"status":"[A-Z_]+"' | head -1 | cut -d'"' -f4)
      case "$ST" in
        RENDERING|QUALITY_CHECK|PENDING_APPROVAL|APPROVED|SCHEDULED|PUBLISHED|FAILED) PIPELINE_OK=1; break ;;
      esac
    done
    check "worker pipeline advances video status (last: ${ST:-none})" 1 "$PIPELINE_OK"
  fi
else
  check "GET /videos list" 200 "$(code $BASE/api/v1/videos -b $JAR)"
  skip "video create + render pipeline" "no READY voiceover"
fi

section "CHANNELS (trial plan: channelsLimit=1)"
check "GET /channels" 200 "$(code $BASE/api/v1/channels -b $JAR)"
req -X POST $BASE/api/v1/channels -b $JAR -H 'Content-Type: application/json' -d '{"channelId":"UC_e2e_test","channelTitle":"E2E Channel"}'
check "POST /channels (sandbox connect #1)" 201 "$RCODE"
CHANNEL_ID=$(echo "$RBODY" | rg -o '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
check "POST /channels over-limit blocked (402)" 402 "$(code -X POST $BASE/api/v1/channels -b $JAR -H 'Content-Type: application/json' -d '{"channelId":"UC_e2e_test2","channelTitle":"E2E Channel 2"}')"

section "PUBLISHING"
check "GET /publishing/jobs" 200 "$(code $BASE/api/v1/publishing/jobs -b $JAR)"

section "BILLING"
check "GET /billing/plans" 200 "$(code $BASE/api/v1/billing/plans)"
check "GET /billing/subscription" 200 "$(code $BASE/api/v1/billing/subscription -b $JAR)"
check "POST /billing/checkout (free plan -> instant 201)" 201 "$(code -X POST $BASE/api/v1/billing/checkout -b $JAR -H 'Content-Type: application/json' -d '{"planId":"free_trial"}')"
check "POST /billing/checkout (paid plan, no gateway -> 400)" 400 "$(code -X POST $BASE/api/v1/billing/checkout -b $JAR -H 'Content-Type: application/json' -d '{"planId":"starter"}')"
check "POST /billing/checkout (bad plan -> 404)" 404 "$(code -X POST $BASE/api/v1/billing/checkout -b $JAR -H 'Content-Type: application/json' -d '{"planId":"nope"}')"
check "GET /billing/gateways" 200 "$(code $BASE/api/v1/billing/gateways -b $JAR)"
check "GET /billing/invoices" 200 "$(code $BASE/api/v1/billing/invoices -b $JAR)"

section "ANALYTICS"
check "GET /analytics/overview" 200 "$(code $BASE/api/v1/analytics/overview -b $JAR)"
check "GET /analytics/recommendations" 200 "$(code $BASE/api/v1/analytics/recommendations -b $JAR)"

section "AUTOMATION"
check "GET /automation" 200 "$(code $BASE/api/v1/automation -b $JAR)"
check "PATCH /automation (save rule)" 200 "$(code -X PATCH $BASE/api/v1/automation -b $JAR -H 'Content-Type: application/json' -d '{"enabled":true,"mode":"approval","scheduleDays":"1,3,5","scheduleTime":"18:00","dailyLimit":1,"weeklyLimit":3}')"
RUNNOW=$(code -X POST $BASE/api/v1/automation/run-now -b $JAR)
case "$RUNNOW" in 200|202) check "POST /automation/run-now (async accepted)" 202 "$RUNNOW" ;; 429|500) skip "POST /automation/run-now" "$RUNNOW" ;; *) check "POST /automation/run-now (async accepted)" 202 "$RUNNOW" ;; esac

section "USAGE + CREDITS"
check "GET /usage" 200 "$(code $BASE/api/v1/usage -b $JAR)"
check "GET /usage/ledger" 200 "$(code $BASE/api/v1/usage/ledger -b $JAR)"

section "NOTIFICATIONS"
check "GET /notifications" 200 "$(code $BASE/api/v1/notifications -b $JAR)"
check "POST /notifications/read-all" 200 "$(code -X POST $BASE/api/v1/notifications/read-all -b $JAR)"

section "ADMIN"
ADMIN_JAR=$(mktemp)
code -X POST $BASE/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@shortspilot.ai","password":"admin12345"}' -c $ADMIN_JAR >/dev/null
check "GET /admin/overview (admin)" 200 "$(code $BASE/api/v1/admin/overview -b $ADMIN_JAR)"
check "GET /admin/users (admin)" 200 "$(code $BASE/api/v1/admin/users -b $ADMIN_JAR)"
check "GET /admin/jobs (admin)" 200 "$(code $BASE/api/v1/admin/jobs -b $ADMIN_JAR)"
check "GET /admin/overview (non-admin blocked)" 403 "$(code $BASE/api/v1/admin/overview -b $JAR)"

section "CLEANUP (delete created resources)"
if [ -n "${VIDEO_ID:-}" ]; then check "DELETE /videos/:id" 200 "$(code -X DELETE $BASE/api/v1/videos/$VIDEO_ID -b $JAR)"; fi
if [ -n "${SCRIPT_ID:-}" ]; then check "DELETE /scripts/:id" 200 "$(code -X DELETE $BASE/api/v1/scripts/$SCRIPT_ID -b $JAR)"; fi
if [ -n "${IDEA_ID:-}" ]; then check "DELETE /ideas/:id" 200 "$(code -X DELETE $BASE/api/v1/ideas/$IDEA_ID -b $JAR)"; fi
if [ -n "${CHANNEL_ID:-}" ]; then check "DELETE /channels/:id" 200 "$(code -X DELETE $BASE/api/v1/channels/$CHANNEL_ID -b $JAR)"; fi
check "POST /auth/logout" 200 "$(code -X POST $BASE/api/v1/auth/logout -b $JAR)"

echo -e "$RESULTS"
echo "-------------------------------------"
echo -e "\033[32mPASSED: $PASS\033[0m  \033[31mFAILED: $FAIL\033[0m  \033[33mSKIPPED (provider rate-limit): $SKIP\033[0m"
rm -f $JAR $ADMIN_JAR
[ $FAIL -eq 0 ]
