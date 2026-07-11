# Company Metadata via /profile

**Date:** 2026-06-20
**Status:** ✅ DONE & VERIFIED LIVE (2026-06-20). Step 1 deployed; Step 2 node wired into the
writer; plus a 409 upsert bug found & fixed (see "Bug found" below). Verified end-to-end with PEP.

## Why
The stock detail info-box (sector / industry / country / logo / description) was blank
because the writer's `Upsert Stock` only sends `{ ticker, name: ticker }`, and the
Railway `quantum-price-prompt` service was **price-only**. Keyless profile APIs (Yahoo
quoteSummary, FMP) require auth, so metadata must come from a yfinance-based `/profile`
endpoint (`yfinance` handles Yahoo's crumb internally).

## Step 1 — DONE: /profile added to the live price service
The deployed `quantum-price-prompt` source turned out to be
`QuantumPartners/PythonParserBogdan/` (git `ant-om/QuantumPaartners`, branch `main`,
Railway auto-deploys on push). Added a `/profile` route there (commit `0868413`) and
pushed — Railway redeployed in ~60s. So `/profile` lives at the **same URL** the writer
already calls for metrics. (The separate `Analysis/` folder is NOT used — it was an older
redundant copy.)

Verified live:
```bash
curl "https://quantum-price-prompt.up.railway.app/profile?ticker=TSLA"
# → { ticker, name, exchange:"NasdaqGS", sector:"Consumer Cyclical",
#     industry:"Auto Manufacturers", country:"United States",
#     website, logo_url (clearbit fallback), description }
```
yfinance `logo_url` is usually null, so the route falls back to
`https://logo.clearbit.com/<domain-from-website>`.

## ✅ Step 2 — DONE (2026-06-20): "Get Profile" node wired into the writer
Applied the exact ops below to `CR Structurer & Supabase Writer` (`PJkASA0XLIV5TCka`).
New chain: `… Get Metrics → Format for Supabase → Get Profile → Upsert Stock → Get Stock ID → …`.
The `Get Profile` HTTP node (GET, onError=continueRegularOutput, alwaysOutputData, 60s timeout)
returns full yfinance metadata; `Upsert Stock` jsonBody now builds the full metadata row (falls
back to `{ticker, name:ticker}` if profile errored). Cycled deactivate/activate to re-register
the webhook.

### ⚠️ Bug found & fixed during verification — 409 on re-runs (`on_conflict=ticker`)
First PEP test run: `Get Profile` returned perfect data, but `Upsert Stock` failed
**HTTP 409 duplicate key** — `Key (ticker)=(PEP) already exists`, violating
`stocks_ticker_key`. Cause: `stocks` PK is `id UUID` and `ticker` is a *separate* `UNIQUE`
column (`schema_v3.sql:16-17`). `Prefer: resolution=merge-duplicates` alone resolves the
conflict on the **primary key** (`id`, always a fresh gen_random_uuid()), so it never matched
and PostgREST attempted a plain INSERT → the ticker UNIQUE constraint threw 409.
This was a **latent bug for every re-run of an existing stock** — it 409'd silently
(`onError=continueRegularOutput`), so `stocks` metadata/name never refreshed for tickers that
already existed; it only ever "worked" on the very first insert of a new ticker.
**Fix:** add `?on_conflict=ticker` to the Upsert Stock URL so PostgREST does
`INSERT … ON CONFLICT (ticker) DO UPDATE`:
`https://jhxwvtgztwgczegpnark.supabase.co/rest/v1/stocks?on_conflict=ticker`
(keep `Prefer: resolution=merge-duplicates`). Re-fired PEP → row updated in place. ✅

### Verified end-to-end (PEP, 2026-06-20 19:32 UTC)
```
ticker=PEP name="PepsiCo, Inc." exchange=NasdaqGS sector="Consumer Defensive"
industry="Beverages - Non-Alcoholic" country="United States"
logo_url=https://logo.clearbit.com/pepsico.com  updated_at=2026-06-20T19:32:49Z
```
Replayed the real PEP webhook body captured from execution 4787 (the writer needs the full
`refined` Q&A; don't fabricate it). Webhook: `POST https://n8nfinalboss.app.n8n.cloud/webhook/cr-supabase-writer`.

### Original plan (as applied) — insert before `Upsert Stock`:

1. **Get Profile** — HTTP Request, GET, `onError: continueRegularOutput`, `alwaysOutputData: true`:
   `=https://quantum-price-prompt.up.railway.app/profile?ticker={{ $('Webhook').first().json.body.ticker }}`

### ▶ EXACT n8n_update_partial_workflow ops (validateOnly first, then apply, then deactivate/activate)
Current chain is `… → Format for Supabase → Upsert Stock → Get Stock ID → …`.
```json
[
  {"type":"addNode","node":{"name":"Get Profile","type":"n8n-nodes-base.httpRequest","typeVersion":4.2,"position":[540,360],"onError":"continueRegularOutput","alwaysOutputData":true,"parameters":{"method":"GET","url":"=https://quantum-price-prompt.up.railway.app/profile?ticker={{ $('Webhook').first().json.body.ticker }}","options":{"timeout":60000}}}},
  {"type":"rewireConnection","source":"Format for Supabase","from":"Upsert Stock","to":"Get Profile"},
  {"type":"addConnection","source":"Get Profile","target":"Upsert Stock"},
  {"type":"updateNode","nodeName":"Upsert Stock","updates":{"parameters.jsonBody":"={{ (() => { const p = $('Get Profile').first().json || {}; const t = $('Format for Supabase').first().json.ticker; const ok = p && p.ticker && !p.error; return JSON.stringify(ok ? { ticker: t, name: p.name || t, exchange: p.exchange, sector: p.sector, industry: p.industry, country: p.country, description: p.description, website: p.website, logo_url: p.logo_url } : { ticker: t, name: t }); })() }}"}}
]
```
Then a second call: `[{"type":"deactivateWorkflow"},{"type":"activateWorkflow"}]` to re-register the webhook.
Validate after (the pre-existing `Webhook onError`/typeVersion warnings are expected — only new errors matter).
Then test: re-run the writer curl (see `pipeline-structurer.md`), wait ~25s (writer is async), and run the verify SQL below.
2. Rewire: `Format for Supabase → Get Profile → Upsert Stock`.
3. Update **Upsert Stock** `jsonBody` to include the profile (fall back to ticker for name):
   ```js
   ={{ (() => {
     const p = $('Get Profile').first().json || {};
     const t = $('Format for Supabase').first().json.ticker;
     const valid = p && p.ticker && !p.error;
     return JSON.stringify(valid
       ? { ticker: t, name: p.name || t, exchange: p.exchange, sector: p.sector,
           industry: p.industry, country: p.country, description: p.description,
           website: p.website, logo_url: p.logo_url }
       : { ticker: t, name: t });
   })() }}
   ```
   Keep `Prefer: resolution=merge-duplicates` so existing rows update in place.

## Step 3 — Frontend
No change needed. `Stock` interface + `stock-detail` already render exchange/sector/
industry/country/website/logo_url/description.

## Verify end-to-end
Re-run the writer test curl (see `pipeline-structurer.md`), wait ~25s, then:
```sql
select ticker, sector, industry, exchange, country, logo_url is not null as has_logo
from stocks where ticker = 'TSLA';
```
Then open `/stock/TSLA` — the info box should be populated.
