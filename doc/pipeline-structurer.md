# Pipeline — Structurer & Summary (Phase 2 design spec)

**Date:** 2026-06-13
**Workflow:** **"CR Structurer & Supabase Writer"** (`PJkASA0XLIV5TCka`)
**Status:** Phase 2a APPLIED LIVE (2026-06-13). Enrichment (2b) deferred — blocked on a public Flask URL.

## As-built (2a)
Implemented as a single combined GPT call rather than 7 per-section calls:
`Webhook → Respond → Build Prompt (Code) → Structure & Summarize (HTTP→OpenAI gpt-5-mini,
response_format json_object, openAiApi cred xRxTtw9QR3OguAAa) → Parse AI (Code) →
Format for Supabase → Upsert Stock → … → Insert Analysis`.
- `Build Prompt` builds one OpenAI chat payload: system prompt defines the full
  `{summary, sections:{macro,political,fs,competition,management,sentiment,price}}` shape;
  user message = ticker + `JSON.stringify(refined)`.
- `Parse AI` parses `choices[0].message.content` → `{summary, sections}`.
- `Format for Supabase` maps `fs→financial`, `competition→competitor`, sets `metrics:null`,
  `raw_output = refined`. `Build Payload` + `Check Old Analysis` carry `summary` + `metrics`.
- Model `gpt-5-mini` is the easy knob to change in `Build Prompt` if unavailable.

This is the spec for the n8n changes that produce the v3 JSONB contract
(`doc/data-model-v3.md`). It modifies a **live, shared** n8n cloud workflow, so it
is staged separately and gated on the blockers below.

## Goal

Turn the raw `refined` Q&A maps into structured `SectionBlock[]` per section + a
`summary`, write them to the JSONB columns, and populate `stocks` metadata +
`metrics` via the Flask service.

## New node chain (after `Respond to Webhook`)

```
Webhook → Respond to Webhook
  → Structure Sections   (GPT, JSON out)   -- refined.<module> prose → SectionBlock[]
  → Generate Summary     (GPT, JSON out)   -- structured sections → summary{}
  → Enrich (Flask)       (HTTP)            -- /profile + /analyze → stocks meta + metrics
  → Format for Supabase  (Code, rewritten) -- assemble JSONB row
  → Upsert Stock         (HTTP, full meta) -- now writes exchange/sector/.../logo
  → Get Stock ID → Build Payload → Get Old Analysis → Check Old Analysis
  → IF Has Old Record → [Archive to History] → Delete Old Analysis → Insert Analysis
```

Keep concurrency = 1 and the respond-then-process pattern (fresh worker → no OOM).

## Structurer prompt (per section, JSON mode)

System: "You restructure raw equity-analysis Q&A into clean JSON blocks. Output a
JSON array; each element = `{heading, takeaway, body, bullets[], sentiment, score}`.
`sentiment` ∈ positive|neutral|negative from the investor's perspective; `score`
0-100 (0 = very bearish, 100 = very bullish). Group related Q&A into coherent
blocks; do NOT invent facts. If the input is empty, output `[]`."
User: the `refined.<module>` content for that section.

Run once per section (`macro, political, fs, competition, management, sentiment,
price`). Use the latest available model. `fs→financial`, `competition→competitor`.

## Summary prompt

Input: the 7 structured sections. Output `{headline, narrative, bullets[],
overall_sentiment, score}` — a 2-3 sentence executive overview.

## `Format for Supabase` (rewritten — replaces the `Object.values().join` code)

```js
const body = $('Webhook').first().json.body;
const sx   = $('Structure Sections').first().json;   // { macro:[...], political:[...], ... }
const sum  = $('Generate Summary').first().json;       // { headline, ... }
const met  = $('Enrich').first().json?.metrics ?? null;

return [{ json: {
  ticker: body.ticker,
  run_at: body.date,
  source: 'cr_l3_r4_v4',
  summary:    sum,
  macro:      sx.macro      ?? [],
  political:  sx.political   ?? [],
  financial:  sx.fs          ?? [],   // module key `fs`  → column `financial`
  competitor: sx.competition ?? [],   // module key `competition` → column `competitor`
  management: sx.management  ?? [],
  sentiment:  sx.sentiment   ?? [],
  price:      sx.price        ?? [],
  metrics:    met,
  raw_output: body.refined
}}];
```

`Build Payload` passes these straight through (JSONB columns). PostgREST stores
JS objects/arrays as JSONB directly — **no `JSON.stringify` on the column values**
(only on the whole request body, as today).

## Security fix
Replace the 5 hardcoded `service_role` JWT header pairs with an n8n
`httpHeaderAuth` credential. The key is currently committed in the workflow JSON
(`apikey` + `Authorization`). Rotate it after migrating.

## Blockers (must clear before applying / activating)
1. **Apply `schema_v3.sql` in Supabase first.** Section columns must be JSONB
   before the writer sends arrays — sending JSONB to the old TEXT columns
   mis-stores or fails.
2. **Tune the structurer prompt against a real `refined` sample.** Neither
   workflow had saved executions; capture one real CR-L3 `Collect`/webhook body
   first so the prompt matches the actual Q&A key/value shape.
3. This is a live shared workflow — apply changes, then deactivate/reactivate to
   re-register the webhook (CLAUDE.md Learning 6) and test once (never re-fire).
