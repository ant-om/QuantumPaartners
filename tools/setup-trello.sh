#!/usr/bin/env bash
#
# setup-trello.sh — Creates the QuantumGPT weekly-sprint board on Trello.
# Reproducible: re-running with a new board name makes a fresh board.
#
# ── How to get your credentials (one-time, ~2 min) ──────────────────────────
#  1. API KEY:   open https://trello.com/power-ups/admin  → "New" power-up
#                (any name) → it gives you an "API key".  Copy it.
#  2. TOKEN:     on that same key page click "Token", or open:
#       https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&name=QuantumGPT&key=YOUR_API_KEY
#                Approve → copy the token it shows.
#
# ── Run ─────────────────────────────────────────────────────────────────────
#   export TRELLO_KEY=xxxxxxxx
#   export TRELLO_TOKEN=yyyyyyyy
#   bash tools/setup-trello.sh
#
# Requires: curl, jq
set -euo pipefail

: "${TRELLO_KEY:?Set TRELLO_KEY (see header)}"
: "${TRELLO_TOKEN:?Set TRELLO_TOKEN (see header)}"
BOARD_NAME="${1:-QuantumGPT — Sprints}"
API="https://api.trello.com/1"
AUTH="key=${TRELLO_KEY}&token=${TRELLO_TOKEN}"

command -v jq >/dev/null || { echo "Install jq first: brew install jq"; exit 1; }

say() { printf '\033[36m▸ %s\033[0m\n' "$*"; }

# ── Board (no default lists; we make our own) ───────────────────────────────
say "Creating board: ${BOARD_NAME}"
BOARD_ID=$(curl -s -X POST "${API}/boards/?${AUTH}" \
  --data-urlencode "name=${BOARD_NAME}" \
  --data "defaultLists=false" \
  --data "prefs_permissionLevel=private" | jq -r '.id')
echo "  board id: ${BOARD_ID}"

# ── Lists (created in reverse — Trello prepends with pos=top) ───────────────
# We pass explicit pos so order is guaranteed left→right.
mklist() { # name  pos
  curl -s -X POST "${API}/lists?${AUTH}" \
    --data-urlencode "name=$1" --data "idBoard=${BOARD_ID}" --data "pos=$2" \
    | jq -r '.id'
}
say "Creating lists"
L_BACKLOG=$(mklist "📥 Backlog"        1)
L_WEEK=$(mklist    "🎯 This Week"      2)
L_DOING=$(mklist   "🔨 Doing"          3)
L_REVIEW=$(mklist  "👀 Review/Blocked" 4)
L_DONE=$(mklist    "✅ Done"           5)

# ── Labels (work areas) ─────────────────────────────────────────────────────
mklabel() { # name  color
  curl -s -X POST "${API}/labels?${AUTH}" \
    --data-urlencode "name=$1" --data "color=$2" --data "idBoard=${BOARD_ID}" \
    | jq -r '.id'
}
say "Creating labels"
LB_N8N=$(mklabel      "n8n"           green)
LB_FE=$(mklabel       "Frontend"      blue)
LB_DATA=$(mklabel     "Data/Supabase" purple)
LB_QUANT=$(mklabel    "Quant/Python"  orange)
LB_BUG=$(mklabel      "Bug"           red)
LB_INFRA=$(mklabel    "Infra/Security" black)

# ── Seed cards (real current backlog) ───────────────────────────────────────
mkcard() { # list_id  name  desc  label_ids(csv)
  curl -s -X POST "${API}/cards?${AUTH}" \
    --data "idList=$1" \
    --data-urlencode "name=$2" \
    --data-urlencode "desc=$3" \
    --data "idLabels=$4" >/dev/null
}
say "Seeding backlog cards"
mkcard "$L_BACKLOG" \
  "Rotate Supabase service_role key + use n8n httpHeaderAuth credential" \
  "Writer workflow 'CR Structurer & Supabase Writer' (PJkASA0XLIV5TCka) has 5 hardcoded service_role JWT header pairs committed in workflow JSON. Replace with a single n8n httpHeaderAuth credential and rotate the key in Supabase. Needs n8n UI." \
  "${LB_INFRA},${LB_N8N}"

mkcard "$L_BACKLOG" \
  "Verify /stock/PEP info-box renders new metadata" \
  "Confirm the company-metadata (Get Profile) fields show correctly on the PEP stock detail page in the Angular frontend." \
  "${LB_FE}"

mkcard "$L_BACKLOG" \
  "Capture a real 'refined' Q&A body from a past execution for writer testing" \
  "Writer webhook POST https://n8nfinalboss.app.n8n.cloud/webhook/cr-supabase-writer needs a full real refined Q&A payload — pull from a past n8n execution, don't fabricate." \
  "${LB_N8N},${LB_DATA}"

mkcard "$L_BACKLOG" \
  "[example] New stock analysis request → pipeline" \
  "Template card: pick a ticker, run the n8n pipeline, verify it lands in Supabase + renders in frontend. Duplicate this per ticker." \
  "${LB_N8N}"

URL=$(curl -s "${API}/boards/${BOARD_ID}?fields=url&${AUTH}" | jq -r '.url')
echo
say "Done ✅  Open your board:"
echo "  ${URL}"
echo
echo "Next: 'Invite' (top-right) → add your 2 teammates by email."
