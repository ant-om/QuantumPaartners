#!/usr/bin/env python3
"""
Competition Quant Layer — deterministic competition-section exhibit for any US ticker.

Usage:  python3 competition_quant.py TICKER [--max-peers 8]
Writes: TICKER_competition.md + TICKER_competition.json next to this script.

Data sources (all public, throttled, cached under ./cache/):
  - SEC EDGAR: company_tickers.json, submissions, XBRL companyfacts, XBRL frames,
    browse-edgar SIC atom listing  (free, User-Agent required, ~10 req/s allowed)
  - Polygon.io free tier: v1/related-companies, v3/reference/tickers (5 req/min)
  - Yahoo v8 chart (price-only fallback for market cap)

Design per SPEC (metric-spec-draft.md): peer resolution chain =
  polygon related-companies -> SIC major-group filter -> (if <4 peers) EDGAR exact-SIC
  listing ranked by revenue proximity via XBRL frames -> eligibility (>=4 consecutive
  quarters of revenue in companyfacts). Every aggregate carries n / coverage / caveats,
  and unavailable metrics are emitted as explicit [GAP] markers, never silently dropped.

Stdlib only. No LLM. Never touches n8n.
"""
import argparse
import hashlib
import json
import math
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, "cache")
os.makedirs(CACHE, exist_ok=True)

POLYGON_KEY = os.environ.get("POLYGON_API_KEY", "")  # from cloud-export (Sentiment L1A)
EDGAR_UA = {"User-Agent": "QuantumGPT research razvanlupu8@gmail.com"}
BROWSER_UA = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                             "AppleWebKit/537.36 (KHTML, like Gecko) "
                             "Chrome/126.0.0.0 Safari/537.36")}

THROTTLE_S = {"polygon": 13.0, "edgar": 0.20, "yahoo": 1.0}
MAX_PEERS_DEFAULT = 8
QUARTERS_WANTED = 12  # fetch a little more than the 8 we report on

REV_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues",
            "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"]
COGS_TAGS = ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"]
GP_TAGS = ["GrossProfit"]
OPINC_TAGS = ["OperatingIncomeLoss"]
RD_TAGS = ["ResearchAndDevelopmentExpense"]
NI_TAGS = ["NetIncomeLoss", "ProfitLoss"]

# ---------------------------------------------------------------- fetch layer

def _stamp_path(service):
    return os.path.join(CACHE, f"_last_call_{service}")

def _throttle(service):
    """Cross-process throttle: persists last-call time in the cache dir."""
    wait = THROTTLE_S.get(service, 0.5)
    p = _stamp_path(service)
    try:
        last = os.path.getmtime(p)
    except OSError:
        last = 0.0
    dt = time.time() - last
    if dt < wait:
        time.sleep(wait - dt)
    with open(p, "w") as f:
        f.write(str(time.time()))

def _cache_file(url):
    h = hashlib.sha1(url.encode()).hexdigest()[:20]
    tail = re.sub(r"[^A-Za-z0-9._-]", "_", url.split("://", 1)[-1])[-60:]
    return os.path.join(CACHE, f"{tail}.{h}.cache")

def fetch(url, service, headers, ttl_hours=24, is_json=True, retries=1):
    """GET with per-service throttle + disk cache. Raises on final failure."""
    cf = _cache_file(url)
    if os.path.exists(cf) and (time.time() - os.path.getmtime(cf)) < ttl_hours * 3600:
        with open(cf, "rb") as f:
            raw = f.read().decode()
        return json.loads(raw) if is_json else raw
    last_err = None
    for attempt in range(retries + 1):
        _throttle(service)
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read().decode()
            body = json.loads(raw) if is_json else raw
            with open(cf, "wb") as f:
                f.write(raw.encode())
            return body
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429 and attempt < retries:
                time.sleep(65)  # polygon rate-limit backoff
                continue
            raise
        except Exception as e:  # noqa: BLE001 - per-peer isolation happens upstream
            last_err = e
            if attempt < retries:
                time.sleep(3)
                continue
            raise
    raise last_err

# ---------------------------------------------------------------- EDGAR utils

def d(s):
    return datetime.strptime(s, "%Y-%m-%d").date()

def edgar_ticker_maps():
    j = fetch("https://www.sec.gov/files/company_tickers.json", "edgar", EDGAR_UA,
              ttl_hours=168)
    t2c, c2t, c2name = {}, {}, {}
    for v in j.values():
        tk = v["ticker"].upper()
        cik = str(v["cik_str"]).zfill(10)
        t2c[tk] = cik
        if cik not in c2t:  # file order puts the primary listing first (GOOGL before GOOG)
            c2t[cik] = tk
            c2name[cik] = v.get("title", "")
    return t2c, c2t, c2name

def edgar_submissions(cik):
    return fetch(f"https://data.sec.gov/submissions/CIK{cik}.json", "edgar", EDGAR_UA,
                 ttl_hours=168)

def edgar_companyfacts(cik):
    # 24h TTL: daily runs must pick up a freshly filed 10-Q/10-K by the next run.
    return fetch(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", "edgar",
                 EDGAR_UA, ttl_hours=24)

def edgar_sic_ciks(sic, pages=3):
    """Exact-SIC 10-K filers via browse-edgar atom. Names are broken SEC-side
    (ARRAY(0x..) bug) — only CIKs are used; names come from company_tickers.json."""
    ciks = []
    for page in range(pages):
        url = ("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"
               f"&SIC={sic}&type=10-K&dateb=&owner=include&count=100"
               f"&start={page * 100}&output=atom")
        atom = fetch(url, "edgar", EDGAR_UA, ttl_hours=168, is_json=False)
        found = re.findall(r"CIK=(\d{10})", atom)
        new = [c for c in dict.fromkeys(found) if c not in ciks]
        ciks.extend(new)
        if len(found) < 100:
            break
    return ciks

def edgar_frames_revenue():
    """cik(int str, unpadded) -> latest-quarter revenue, via XBRL frames.
    One call covers every US filer — used to size-rank SIC fallback candidates."""
    today = date.today()
    # candidate calendar quarters, newest plausible-complete first
    quarters = []
    y, q = today.year, (today.month - 1) // 3 + 1
    for _ in range(4):
        q -= 1
        if q == 0:
            y, q = y - 1, 4
        quarters.append(f"CY{y}Q{q}")
    out = {}
    for tag in ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"]:
        for frame in quarters[:2]:  # latest 2 complete quarters
            url = f"https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/USD/{frame}.json"
            try:
                j = fetch(url, "edgar", EDGAR_UA, ttl_hours=168)
            except Exception:
                continue
            for row in j.get("data", []):
                cik = str(row.get("cik"))
                if cik not in out and row.get("val"):
                    out[cik] = row["val"]
    return out

# ------------------------------------------------- XBRL quarterly series build

def _usd_facts(concept_node):
    if not concept_node:
        return []
    units = concept_node.get("units", {})
    return units.get("USD") or []

def quarters_from_tag(node):
    """-> (quarters dict end_iso -> fact, derived Q4s included), from one XBRL tag."""
    facts = [f for f in _usd_facts(node)
             if f.get("start") and f.get("end") and f.get("val") is not None]
    best = {}
    for f in facts:
        k = (f["start"], f["end"])
        if k not in best or (f.get("filed") or "") > (best[k].get("filed") or ""):
            best[k] = f
    quarters, annuals = {}, []
    for (s, e), f in best.items():
        try:
            dur = (d(e) - d(s)).days
        except ValueError:
            continue
        rec = {"end": e, "start": s, "val": f["val"], "form": f.get("form"),
               "filed": f.get("filed"), "derived": False}
        if 70 <= dur <= 125:
            cur = quarters.get(e)
            if cur is None or (rec["filed"] or "") > (cur["filed"] or ""):
                quarters[e] = rec
        elif 340 <= dur <= 385:
            annuals.append(rec)
    # derive the missing 4th quarter (usually Q4) from each annual
    for a in annuals:
        a_s, a_e = d(a["start"]), d(a["end"])
        inside = [q for q in quarters.values()
                  if d(q["start"]) >= a_s - timedelta(days=8)
                  and d(q["end"]) <= a_e + timedelta(days=8)]
        if len(inside) != 3:
            continue
        if any(abs((d(q["end"]) - a_e).days) <= 8 for q in inside):
            continue  # missing quarter is mid-year; dating would be wrong -> skip
        if a["end"] in quarters:
            continue
        val = a["val"] - sum(q["val"] for q in inside)
        start = (max(d(q["end"]) for q in inside) + timedelta(days=1)).isoformat()
        quarters[a["end"]] = {"end": a["end"], "start": start, "val": val,
                              "form": a["form"], "filed": a["filed"], "derived": True}
    return quarters

_QEND_CACHE = {}

def cal_quarter(end_iso):
    """Map a fiscal quarter end to the nearest calendar quarter (y, q)."""
    if end_iso in _QEND_CACHE:
        return _QEND_CACHE[end_iso]
    e = d(end_iso)
    cands = []
    for y in (e.year - 1, e.year, e.year + 1):
        for (m, dd, q) in ((3, 31, 1), (6, 30, 2), (9, 30, 3), (12, 31, 4)):
            cands.append((abs((e - date(y, m, dd)).days), (y, q)))
    _QEND_CACHE[end_iso] = min(cands)[1]
    return _QEND_CACHE[end_iso]

def concept_series(gaap, tag_priority):
    """Pick the tag with the best recent quarterly coverage; return
    {"tag": t, "by_cal": {(y,q): fact}, "list": [facts desc by cal idx]}."""
    cutoff = date.today() - timedelta(days=int(3.2 * 365))
    fresh_cut = date.today() - timedelta(days=400)
    scored = []
    for i, tag in enumerate(tag_priority):
        qs = quarters_from_tag(gaap.get(tag))
        recent = [q for q in qs.values() if d(q["end"]) >= cutoff]
        latest = max((d(q["end"]) for q in qs.values()), default=None)
        # FRESHNESS FIRST: a tag still being filed today beats a stale tag with more
        # history (GOOGL/XOM switched primary revenue tags mid-2025 — list-order or
        # count-based picking silently serves year-old revenue)
        is_fresh = 1 if (latest and latest >= fresh_cut) else 0
        scored.append((is_fresh, len(recent), -i, tag, qs))
    scored.sort(reverse=True)
    _fresh, n, _, tag, qs = scored[0]
    if n == 0:
        return {"tag": None, "by_cal": {}, "list": []}
    by_cal = {}
    for q in qs.values():
        cal = cal_quarter(q["end"])
        cur = by_cal.get(cal)
        if cur is None or (q["filed"] or "") > (cur["filed"] or ""):
            by_cal[cal] = q
    lst = sorted(by_cal.items(), key=lambda kv: kv[0][0] * 4 + kv[0][1], reverse=True)
    out = [{"cal": k, "idx": k[0] * 4 + k[1], **v} for k, v in lst][:QUARTERS_WANTED]
    return {"tag": tag, "by_cal": by_cal, "list": out}

def latest_instant(node, unit="USD", max_age_days=460):
    facts = (node or {}).get("units", {}).get(unit) or []
    inst = [f for f in facts if not f.get("start") and f.get("end") and
            f.get("val") is not None]
    if not inst:
        return None
    best = max(inst, key=lambda f: (f["end"], f.get("filed") or ""))
    if (date.today() - d(best["end"])).days > max_age_days:
        return None
    return best

def sum_over(by_cal, cal_keys):
    vals = []
    for k in cal_keys:
        f = by_cal.get(k)
        if f is None:
            return None
        vals.append(f["val"])
    return sum(vals)

# ---------------------------------------------------------------- company build

def build_company(ticker, cik, notes):
    """All EDGAR-derived fundamentals for one company. Raises on fatal problems."""
    cf = edgar_companyfacts(cik)
    facts = cf.get("facts", {})
    gaap = facts.get("us-gaap", {})
    if not gaap:
        # transient EDGAR degradation can return valid-but-empty JSON under load;
        # purge the cached copy and re-fetch once before concluding anything
        try:
            os.remove(_cache_file(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"))
        except OSError:
            pass
        time.sleep(2)
        cf = edgar_companyfacts(cik)
        facts = cf.get("facts", {})
        gaap = facts.get("us-gaap", {})
    dei = facts.get("dei", {})
    if not gaap:
        raise ValueError("companyfacts has no us-gaap namespace after retry "
                         "(foreign/IFRS filer, or transient EDGAR degradation)")

    rev = concept_series(gaap, REV_TAGS)
    if len(rev["list"]) < 4:
        raise ValueError(f"only {len(rev['list'])} quarters of revenue in companyfacts")
    cogs = concept_series(gaap, COGS_TAGS)
    gp = concept_series(gaap, GP_TAGS)
    opinc = concept_series(gaap, OPINC_TAGS)
    ni = concept_series(gaap, NI_TAGS)
    rd_node_present = any(t in gaap for t in RD_TAGS)
    rd = concept_series(gaap, RD_TAGS) if rd_node_present else {"tag": None, "by_cal": {}, "list": []}

    rl = rev["list"]
    # consecutive-quarter windows keyed off the revenue series
    def rev_keys(offset, k=4):
        if len(rl) < offset + k:
            return None
        seg = rl[offset:offset + k]
        if any(seg[i]["idx"] != seg[0]["idx"] - i for i in range(k)):
            return None  # gap in the series
        return [f["cal"] for f in seg]

    k_cur, k_pri = rev_keys(0), rev_keys(4)
    rev_ttm = sum_over(rev["by_cal"], k_cur) if k_cur else None
    rev_ttm_prior = sum_over(rev["by_cal"], k_pri) if k_pri else None

    def ttm(series, keys):
        return sum_over(series["by_cal"], keys) if keys else None

    cogs_ttm, cogs_pri = ttm(cogs, k_cur), ttm(cogs, k_pri)
    gp_ttm, gp_pri = ttm(gp, k_cur), ttm(gp, k_pri)
    op_ttm, op_pri = ttm(opinc, k_cur), ttm(opinc, k_pri)
    ni_ttm = ttm(ni, k_cur)
    rd_ttm = ttm(rd, k_cur) if rd_node_present else None

    def safe_div(a, b):
        return a / b if (a is not None and b not in (None, 0)) else None

    def gross_margin(rv, cg, g):
        if rv in (None, 0):
            return None
        if cg is not None:
            return (rv - cg) / rv
        if g is not None:
            return g / rv
        return None

    gm_ttm = gross_margin(rev_ttm, cogs_ttm, gp_ttm)
    gm_pri = gross_margin(rev_ttm_prior, cogs_pri, gp_pri)

    growth_ttm = (rev_ttm / rev_ttm_prior - 1) if (rev_ttm and rev_ttm_prior and rev_ttm_prior > 0) else None
    q1 = rl[0]
    q5 = next((f for f in rl if f["idx"] == q1["idx"] - 4), None)
    growth_q = (q1["val"] / q5["val"] - 1) if (q5 and q5["val"] > 0) else None

    om_ttm = safe_div(op_ttm, rev_ttm)
    om_pri = safe_div(op_pri, rev_ttm_prior)
    nm_ttm = safe_div(ni_ttm, rev_ttm)
    rd_int = safe_div(rd_ttm, rev_ttm) if rd_node_present else (0.0 if rev_ttm else None)
    rd_basis = "TTM" if rd_int is not None else None

    def annual_latest(tags, within_days=480):
        """Latest fresh full-year duration fact across tags -> fact or None."""
        for tag in tags:
            facts = [f for f in _usd_facts(gaap.get(tag))
                     if f.get("start") and f.get("end") and f.get("val") is not None]
            anns = [f for f in facts if 340 <= (d(f["end"]) - d(f["start"])).days <= 385]
            if anns:
                best = max(anns, key=lambda f: (f["end"], f.get("filed") or ""))
                if (date.today() - d(best["end"])).days <= within_days:
                    return best
        return None

    # FY-basis R&D fallback: many industrials (Ford) tag R&D annually only
    if rd_node_present and rd_int is None:
        rd_ann = annual_latest(RD_TAGS)
        if rd_ann:
            rev_ann = None
            for tag in REV_TAGS:
                for f in _usd_facts(gaap.get(tag)):
                    if f.get("end") == rd_ann["end"] and f.get("start") and \
                            340 <= (d(f["end"]) - d(f["start"])).days <= 385:
                        rev_ann = f["val"]
                        break
                if rev_ann:
                    break
            if rev_ann:
                rd_int = rd_ann["val"] / rev_ann
                rd_basis = f"FY{d(rd_ann['end']).year}"
                notes.append(f"{ticker}: R&D tagged annually only — intensity computed on "
                             f"{rd_basis} (R&D {rd_ann['val']/1e9:.1f}B / revenue {rev_ann/1e9:.1f}B)")

    # incremental operating margin (noise-guarded)
    inc_om = None
    if None not in (op_ttm, op_pri, rev_ttm, rev_ttm_prior):
        d_rev = rev_ttm - rev_ttm_prior
        if d_rev > 0:
            v = (op_ttm - op_pri) / d_rev
            inc_om = v if abs(v) <= 5 else None

    gm_trend_bps = (gm_ttm - gm_pri) * 10000 if None not in (gm_ttm, gm_pri) else None

    # shares + net debt (instants)
    sh = latest_instant(dei.get("EntityCommonStockSharesOutstanding"), unit="shares")
    cash_f = latest_instant(gaap.get("CashAndCashEquivalentsAtCarryingValue"))
    sti_f = latest_instant(gaap.get("ShortTermInvestments"))

    def inst(tag):
        return latest_instant(gaap.get(tag))

    debt = net_debt = net_debt_asof = None
    debt_basis = None
    # ladder 1: single total-debt tags
    for tag in ("LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
                "DebtAndCapitalLeaseObligations", "DebtLongtermAndShorttermCombinedAmount"):
        f = inst(tag)
        if f is not None:
            debt, net_debt_asof, debt_basis = f["val"], f["end"], tag
            break
    # ladder 2: noncurrent + current composition
    if debt is None:
        for nc_tag, cur_tags in (("LongTermDebtNoncurrent", ("LongTermDebtCurrent", "DebtCurrent")),
                                 ("LongTermDebtAndCapitalLeaseObligations",
                                  ("LongTermDebtAndCapitalLeaseObligationsCurrent",))):
            nc = inst(nc_tag)
            if nc is not None:
                cur = next((inst(t) for t in cur_tags if inst(t) is not None), None)
                debt = nc["val"] + (cur["val"] if cur else 0)
                net_debt_asof, debt_basis = nc["end"], f"{nc_tag}+current"
                break
    if debt is None:
        f = inst("LongTermDebt")
        if f is not None:
            debt, net_debt_asof, debt_basis = f["val"], f["end"], "LongTermDebt"
    if debt is not None:
        # add fresh short-term borrowings not inside LTD tags
        for tag in ("CommercialPaper", "ShortTermBorrowings"):
            f = inst(tag)
            if f is not None:
                debt += f["val"]
    # zero-debt inference: only when NO debt-ish tag shows a material value, fresh OR
    # historical (companies that tag debt by segment dimension — Ford — have stale/absent
    # consolidated tags but must NOT be treated as unlevered)
    if debt is None:
        material = False
        # cross-check 1: material interest expense => levered even when consolidated debt
        # is only dimension-tagged (Ford Automotive/Credit style) and invisible here
        int_cut = (date.today() - timedelta(days=750)).isoformat()
        int_floor = 1e8  # $100M of interest in any recent period = levered, full stop
        for itag in ("InterestExpense", "InterestExpenseDebt", "InterestAndDebtExpense",
                     "InterestExpenseDebtExcludingAmortization",
                     "InterestExpenseNonoperating", "InterestExpenseOther"):
            for fact in _usd_facts(gaap.get(itag)):
                if fact.get("start") and fact.get("end", "") >= int_cut and \
                        abs(fact.get("val") or 0) > int_floor:
                    material = True
                    break
            if material:
                break
        # cross-check 2: any liability-side debt balance, fresh or recent-historical
        hist_cutoff = (date.today() - timedelta(days=6 * 365)).isoformat()
        for k in gaap:
            if material:
                break
            if not re.search(r"Debt|Borrow|CommercialPaper|NotesPayable", k):
                continue
            if re.search(r"FairValue|InterestRate|Maturit|Repayment|Proceeds|Extinguish|"
                         r"DebtSecurities|AvailableForSale|HeldToMaturity", k):
                continue  # schedules/flows/asset-side securities, not debt balances
            f = inst(k)
            if f is not None and abs(f["val"]) > 1e8:
                material = True
                break
            for fact in (gaap[k].get("units", {}).get("USD") or []):
                if not fact.get("start") and fact.get("end", "") >= hist_cutoff and \
                        abs(fact.get("val") or 0) > 1e9:
                    material = True
                    break
        if not material and cash_f is not None:
            debt, net_debt_asof, debt_basis = 0.0, cash_f["end"], "no_material_debt_tags(net cash)"
            notes.append(f"{ticker}: no material debt in any XBRL debt tag — treated as "
                         "zero-debt (net cash) for EV")
    if debt is not None and cash_f is not None:
        net_debt = debt - cash_f["val"] - (sti_f["val"] if sti_f else 0)
    if net_debt is None:
        notes.append(f"{ticker}: net debt unavailable (debt/cash XBRL tags missing or stale) "
                     f"-> EV/S degraded to P/S")

    return {
        "ticker": ticker, "cik": cik,
        "rev_tag": rev["tag"],
        "quarters": [{"cal": f"{f['cal'][0]}Q{f['cal'][1]}", "end": f["end"],
                      "rev": f["val"], "derived_q4": f["derived"]} for f in rl],
        "rev_by_cal": {f"{k[0]}Q{k[1]}": v["val"] for k, v in rev["by_cal"].items()},
        "data_through": q1["end"],
        "rev_ttm": rev_ttm, "rev_ttm_prior": rev_ttm_prior,
        "growth_ttm": growth_ttm, "growth_latest_q": growth_q,
        "gross_margin_ttm": gm_ttm, "gm_trend_bps": gm_trend_bps,
        "op_margin_ttm": om_ttm, "net_margin_ttm": nm_ttm,
        "rd_intensity_ttm": rd_int, "rd_reported": rd_node_present,
        "rd_basis": rd_basis if rd_node_present else ("none_reported" if rev_ttm else None),
        "rd_ttm": rd_ttm, "ni_ttm": ni_ttm, "op_ttm": op_ttm,
        "incremental_op_margin": inc_om,
        "shares_out_dei": sh["val"] if sh else None,
        "shares_asof": sh["end"] if sh else None,
        "net_debt": net_debt, "net_debt_asof": net_debt_asof, "debt_basis": debt_basis,
    }

# ---------------------------------------------------------------- market data

def polygon_ticker_details(ticker):
    url = f"https://api.polygon.io/v3/reference/tickers/{ticker}?apiKey={POLYGON_KEY}"
    j = fetch(url, "polygon", {"User-Agent": "competition-quant/1.0"}, ttl_hours=12)
    res = j.get("results", {})
    return res.get("market_cap"), res.get("weighted_shares_outstanding"), res.get("sic_code")

def polygon_market_cap(ticker):
    # kept for callers that only need (cap, sic)
    mc, _sh, sic = polygon_ticker_details(ticker)
    return mc, sic

def polygon_prev_close(ticker):
    """Official previous daily close + its date, same vendor as shares."""
    url = f"https://api.polygon.io/v2/aggs/ticker/{ticker}/prev?adjusted=true&apiKey={POLYGON_KEY}"
    j = fetch(url, "polygon", {"User-Agent": "competition-quant/1.0"}, ttl_hours=12)
    rs = (j.get("results") or [])
    if not rs:
        return None, None
    bar = rs[0]
    ts = bar.get("t")
    bar_date = datetime.utcfromtimestamp(ts / 1000).date().isoformat() if ts else None
    return bar.get("c"), bar_date

def resolve_market_cap(ticker, company, notes):
    """DURABILITY DESIGN (2026-07-26): market cap is COMPUTED from primitives —
    weighted shares x official previous close, both Polygon, both close-of-day
    (no intraday timing ambiguity, no second vendor). Polygon's own market_cap
    field is an ADVISORY cross-check (same-vendor identity, 2% tolerance) that
    can note, never block. Missing primitives => None => honest [GAP]; a missing
    number is acceptable, a wrong one is not. No Yahoo anywhere in this path."""
    try:
        vendor_cap, shares, _sic = polygon_ticker_details(ticker)
    except Exception as e:  # noqa: BLE001
        notes.append(f"{ticker}: polygon ticker-details failed ({e}); market cap [GAP]")
        return None, None
    close, bar_date = None, None
    try:
        close, bar_date = polygon_prev_close(ticker)
    except Exception as e:  # noqa: BLE001
        notes.append(f"{ticker}: polygon prev-close failed ({e})")
    if shares and close:
        # staleness sentinel: a "previous close" older than ~7 days is not current
        stale = ""
        if bar_date:
            try:
                age = (datetime.utcnow().date() - d(bar_date)).days
                if age > 7:
                    stale = f"; STALE close ({bar_date})"
                    notes.append(f"{ticker}: prev-close bar is {age}d old ({bar_date}) — cap marked stale")
            except Exception:  # noqa: BLE001
                pass
        cap = shares * close
        if vendor_cap and abs(cap - vendor_cap) / vendor_cap > 0.02:
            notes.append(f"{ticker}: advisory — computed cap {cap/1e9:.1f}B vs polygon field "
                         f"{vendor_cap/1e9:.1f}B ({abs(cap-vendor_cap)/vendor_cap:.1%}); using computed")
        return cap, f"computed: shares x prev close ({bar_date or 'date?'}){stale}"
    if vendor_cap:
        notes.append(f"{ticker}: primitives unavailable (shares={bool(shares)}, close={bool(close)}) — "
                     "using polygon market_cap field as-is")
        return vendor_cap, "polygon market_cap field (primitives unavailable)"
    notes.append(f"{ticker}: no market-cap data resolvable — [GAP]")
    return None, None

# ---------------------------------------------------------------- peer resolve


DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
# PINNED PEER DECISIONS: a ticker's peer judgment is decided ONCE (3-sample consensus)
# and then reused verbatim forever — daily runs are byte-identical by construction.
# Re-deciding is a DELIBERATE act: run with --redecide. (A/A testing showed sampled
# LLM decisions can never be perfectly reproducible; pinning is what makes the
# pipeline 100% consistent while keeping the agent's judgment.)
REDECIDE = "--redecide" in sys.argv

def _peer_cache_path(ticker):
    return os.path.join(CACHE, f"peer_judgment_{ticker}.json")

def llm_peer_judgment(subject, subj_name, subj_sic_desc, slate, notes):
    """ONE DeepSeek call: classify slate candidates as direct rival / adjacent /
    not_competitor and nominate missing real rivals by name. JUDGMENT ONLY —
    it never touches a number. Cached ~monthly; any failure returns None
    (deterministic fallback takes over). Slate-constrained: the model cannot inject tickers."""
    p = _peer_cache_path(subject)
    if not REDECIDE:
        # cache first, then the committed pins/ dir (survives ephemeral-disk redeploys)
        for path0 in (p, os.path.join(BASE, "pins", f"peer_judgment_{subject}.json")):
            if os.path.exists(path0):
                try:
                    return json.load(open(path0))
                except Exception:  # noqa: BLE001
                    pass
    cand_lines = "\n".join(f"- {c['ticker']}: {c['name']} (SIC: {c['sic_desc'] or '?'})" for c in slate)
    prompt = (
        f"You are classifying potential competitors for a competition analysis of "
        f"{subj_name} (ticker {subject}, industry: {subj_sic_desc}).\n\n"
        f"CANDIDATES (from SIC code and market-graph data):\n{cand_lines}\n\n"
        "For each candidate, judge from your knowledge of these companies:\n"
        "- DIRECT: competes for the same customers with substitutable products, AND that competing "
        "business is a core part of the candidate's own revenue — whole-company revenue comparison "
        "against the subject is meaningful.\n"
        "- CONGLOMERATE_OVERLAP: genuinely competes with the subject, but only through a division "
        "that is a small share of the candidate's own (much larger) revenue — whole-company revenue "
        "comparison would be misleading.\n"
        "- ADJACENT: same broad industry but different core market (supplier, equipment maker, "
        "distributor).\n"
        "- NOT_COMPETITOR: no real competitive overlap.\n"
        "Then list up to 5 REAL direct rivals missing from the candidate list, with their company names "
        "and, when public, their US ticker; mark private or foreign-listed rivals as such.\n\n"
        "Respond ONLY with JSON (no prose, no fences):\n"
        '{"classifications": [{"ticker": "...", "class": "DIRECT|CONGLOMERATE_OVERLAP|ADJACENT|NOT_COMPETITOR"}], '
        '"missing_rivals": [{"name": "...", "us_ticker": "... or null", "status": "public|private|foreign"}]}'
    )
    def one_sample():
        body = {"model": "deepseek-v4-pro", "temperature": 0, "max_tokens": 8000,
                "messages": [{"role": "user", "content": prompt}]}
        req = urllib.request.Request("https://api.deepseek.com/chat/completions",
                                     data=json.dumps(body).encode(),
                                     headers={"Authorization": "Bearer " + DEEPSEEK_KEY,
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=300) as r:
            resp = json.loads(r.read().decode())
        text = resp["choices"][0]["message"].get("content") or ""
        m = re.search(r"\{[\s\S]*\}", text)
        return json.loads(m.group(0))

    def norm_name(n):
        n = re.sub(r"[^a-z0-9 ]", " ", (n or "").lower())
        drop = {"inc", "corp", "corporation", "holdings", "holding", "ltd", "plc", "llc", "company", "co", "the", "group"}
        return " ".join(w for w in n.split() if w not in drop)

    # CONSENSUS: sample the judgment 3x. Classifications are majority-voted (measured
    # 100% stable, vote makes it bulletproof); open-ended nominations proved unstable
    # at the tail, so only rivals named by >=2 of 3 samples survive.
    try:
        samples = []
        for _ in range(3):
            try:
                samples.append(one_sample())
            except Exception:  # noqa: BLE001
                continue
        if not samples:
            raise ValueError("all judgment samples failed")
        slate_ts = {c["ticker"] for c in slate}
        votes = {}
        for s in samples:
            for c in s.get("classifications", []):
                t, k = c.get("ticker"), c.get("class")
                if t in slate_ts and k in ("DIRECT", "CONGLOMERATE_OVERLAP", "ADJACENT", "NOT_COMPETITOR"):
                    votes.setdefault(t, []).append(k)
        classifications = []
        for t, ks in votes.items():
            win = max(set(ks), key=ks.count)
            if ks.count(win) >= (2 if len(samples) >= 2 else 1):
                classifications.append({"ticker": t, "class": win})
        nom_votes = {}
        for s in samples:
            seen_this = set()
            for nmm in s.get("missing_rivals", []) or []:
                key = norm_name(nmm.get("name"))
                if not key or key in seen_this:
                    continue
                seen_this.add(key)
                slot = nom_votes.setdefault(key, {"count": 0, "recs": []})
                slot["count"] += 1
                slot["recs"].append(nmm)
        need = 2 if len(samples) >= 2 else 1
        missing = []
        for key, slot in nom_votes.items():
            if slot["count"] >= need:
                recs = slot["recs"]
                tick = next((r.get("us_ticker") for r in recs if r.get("us_ticker")), None)
                status = max((r.get("status") or "?" for r in recs), key=lambda s: sum(1 for r in recs if r.get("status") == s))
                missing.append({"name": recs[0].get("name"), "us_ticker": tick, "status": status,
                                "consensus": f"{slot['count']}/{len(samples)}"})
        j = {"classifications": classifications, "missing_rivals": missing,
             "samples": len(samples),
             "decided_utc": datetime.utcnow().isoformat(timespec="seconds") + "Z"}
        json.dump(j, open(p, "w"))
        return j
    except Exception as e:  # noqa: BLE001
        notes.append(f"peer-judgment LLM unavailable ({str(e)[:60]}); deterministic SIC resolution used")
        return None

def filer_cik_for(ticker, mapped_cik, notes):
    """Return the CIK whose companyfacts actually contain us-gaap financials.
    company_tickers.json can point at a successor/holding entity with empty XBRL
    (real case: XOM -> 'ExxonMobil Holdings Corp' shell, filings at the old CIK).
    Fallback = EDGAR browse-edgar ticker->10-K-filer lookup. Cached like all fetches."""
    try:
        if edgar_companyfacts(mapped_cik).get("facts", {}).get("us-gaap"):
            return mapped_cik
    except Exception:  # noqa: BLE001
        pass
    try:
        url = ("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"
               f"&ticker={ticker}&type=10-K&dateb=&owner=include&count=10&output=atom")
        atom = fetch(url, "edgar", EDGAR_UA, ttl_hours=168, is_json=False)
        ciks = sorted(set(re.findall(r"CIK=(\d{10})", atom)))
        for c2 in ciks:
            if c2 != mapped_cik and edgar_companyfacts(c2).get("facts", {}).get("us-gaap"):
                notes.append(f"{ticker}: mapped CIK {mapped_cik} has no us-gaap facts "
                             f"(successor/holding shell); using 10-K filer CIK {c2}")
                return c2
    except Exception as e:  # noqa: BLE001
        notes.append(f"{ticker}: filer-CIK fallback failed ({e})")
    return mapped_cik

def resolve_peers(subject, max_peers, notes):
    t2c, c2t, c2name = edgar_ticker_maps()
    subj_e = subject.replace(".", "-").upper()
    if subj_e not in t2c:
        raise SystemExit(f"FATAL: {subject} not found in EDGAR company_tickers.json")
    subj_cik = filer_cik_for(subj_e, t2c[subj_e], notes)
    subj_sub = edgar_submissions(subj_cik)
    subj_sic = str(subj_sub.get("sic") or "")
    subj_sic_desc = subj_sub.get("sicDescription") or ""
    subj_name = subj_sub.get("name") or c2name.get(subj_cik, subject)

    peers, provenance, known_excluded = [], [], []

    # step 1: polygon related-companies, SIC-major-group fenced
    try:
        j = fetch(f"https://api.polygon.io/v1/related-companies/{subject}?apiKey={POLYGON_KEY}",
                  "polygon", {"User-Agent": "competition-quant/1.0"}, ttl_hours=168)
        raw = [r["ticker"] for r in j.get("results") or []]
    except Exception as e:  # noqa: BLE001
        raw = []
        notes.append(f"polygon related-companies failed ({e}); using EDGAR SIC fallback only")
    seen_ciks = {subj_cik}
    for cand in raw:
        cand_e = cand.replace(".", "-").upper()
        cik = t2c.get(cand_e)
        if not cik:
            known_excluded.append({"ticker": cand, "reason": "no EDGAR listing (foreign/private)"})
            continue
        if cik in seen_ciks:
            continue
        try:
            sub = edgar_submissions(cik)
        except Exception:  # noqa: BLE001
            known_excluded.append({"ticker": cand, "reason": "EDGAR submissions fetch failed"})
            continue
        sic = str(sub.get("sic") or "")
        if subj_sic and sic[:2] == subj_sic[:2]:
            seen_ciks.add(cik)
            peers.append(cand_e)
            provenance.append({"ticker": cand_e, "cik": cik, "sic": sic,
                               "sic_desc": sub.get("sicDescription"),
                               "source": "polygon_related+sic_filter"})
        else:
            known_excluded.append({"ticker": cand, "reason":
                                   f"SIC {sic or '?'} outside subject major group {subj_sic[:2]}xx "
                                   "(related-by-news, not an industry peer)"})

    # step 2: EDGAR exact-SIC listing, revenue-proximity ranked (frames)
    if len(peers) < 4 and subj_sic:
        frames_rev = edgar_frames_revenue()
        subj_qrev = frames_rev.get(str(int(subj_cik)))
        sic_ciks = edgar_sic_ciks(subj_sic)
        cands = []
        for cik in sic_ciks:
            if cik in seen_ciks:
                continue
            tk = c2t.get(cik)
            if not tk:
                known_excluded.append({"cik": cik, "reason": "SIC-listed filer with no "
                                       "ticker mapping (private/delisted)"})
                continue
            rv = frames_rev.get(str(int(cik)))
            if not rv or rv <= 0:
                continue  # no recent quarterly revenue -> would fail eligibility anyway
            if subj_qrev and not (0.02 * subj_qrev <= rv <= 50 * subj_qrev):
                known_excluded.append({"ticker": tk, "reason":
                                       f"revenue {rv/1e6:.0f}M outside 0.02x-50x subject band"})
                continue
            cands.append((rv, tk, cik))
        cands.sort(reverse=True)  # biggest players first — what an analyst would pick
        for rv, tk, cik in cands:
            if len(peers) >= max_peers:
                break
            seen_ciks.add(cik)
            peers.append(tk)
            provenance.append({"ticker": tk, "cik": cik, "sic": subj_sic,
                               "sic_desc": subj_sic_desc, "source": "edgar_sic_frames_rank",
                               "frames_qrev": rv})

    # step 3: LLM peer judgment — the agent decides WHO belongs; code keeps guards
    # and measures. Cached ~monthly (identical daily runs); failure => set unchanged.
    resolver_tag = "deterministic"
    judgment = None
    if peers:
        slate = []
        for pv in provenance:
            nm = c2name.get(pv.get("cik"), "") or pv["ticker"]
            slate.append({"ticker": pv["ticker"], "name": nm, "sic_desc": pv.get("sic_desc") or ""})
        judgment = llm_peer_judgment(subj_e, subj_name, subj_sic_desc, slate, notes)
    if judgment:
        classes = {c["ticker"]: c["class"] for c in judgment.get("classifications", [])}
        direct = [t for t in peers if classes.get(t) == "DIRECT"]
        adjacent = [t for t in peers if classes.get(t) == "ADJACENT"]
        rejected = [t for t in peers if classes.get(t) == "NOT_COMPETITOR"]
        conglom = [t for t in peers if classes.get(t) == "CONGLOMERATE_OVERLAP"]
        for t in conglom:
            known_excluded.append({"ticker": t, "reason": "peer-judgment: real competitor but only "
                                   "via a segment of a much larger business — whole-company revenue "
                                   "not comparable; named here, excluded from share/HHI math"})
        # nominations: only names that resolve to real US filers may enter
        for nom in (judgment.get("missing_rivals") or [])[:5]:
            nm, tk_raw, status = (nom.get("name") or "").strip(), nom.get("us_ticker"), nom.get("status")
            tk = (tk_raw or "").replace(".", "-").upper().strip()
            if status == "public" and tk and tk in t2c and tk not in peers and tk != subj_e:
                cik = filer_cik_for(tk, t2c[tk], notes)
                try:
                    sub = edgar_submissions(cik)
                except Exception:  # noqa: BLE001
                    known_excluded.append({"ticker": tk, "reason": f"LLM-nominated rival ({nm}) — EDGAR fetch failed"})
                    continue
                direct.append(tk)
                provenance.append({"ticker": tk, "cik": cik, "sic": str(sub.get("sic") or ""),
                                   "sic_desc": sub.get("sicDescription"), "source": "llm_nominated"})
            elif nm:
                known_excluded.append({"ticker": tk or "-", "reason":
                                       f"real rival per peer-judgment, not usable: {nm} ({status or '?'})"})
        candidate_set = direct + [t for t in adjacent if t not in direct]
        # guard: judgment may only shrink the set if >=3 peers remain; otherwise keep deterministic set
        if len(direct) >= 3 or len(candidate_set) >= 3:
            kept = (direct + [t for t in adjacent if t not in direct])[:max_peers]
            for t in rejected:
                if t not in kept:
                    known_excluded.append({"ticker": t, "reason": "peer-judgment: not a competitor "
                                           "(same SIC but different core market)"})
            for t in adjacent:
                if t not in kept:
                    known_excluded.append({"ticker": t, "reason": "peer-judgment: adjacent, dropped "
                                           "in favor of direct rivals"})
            peers = kept
            resolver_tag = f"llm_judgment (decided {judgment.get('decided_utc','?')[:10]})"
            for pv in provenance:
                pv["llm_class"] = classes.get(pv["ticker"], "DIRECT" if pv.get("source") == "llm_nominated" else None)
        else:
            notes.append("peer-judgment left <3 usable peers; deterministic set kept")
            resolver_tag = "deterministic (judgment quorum failed)"

    peers = peers[:max_peers]
    return {"subject": subj_e, "subject_cik": subj_cik, "subject_name": subj_name,
            "subject_sic": subj_sic, "subject_sic_desc": subj_sic_desc,
            "peers": peers, "provenance": provenance, "peer_resolver": resolver_tag,
            "known_excluded": known_excluded, "t2c": t2c}

# ---------------------------------------------------------------- aggregates

def ols_slope(ys):
    n = len(ys)
    xs = list(range(n))
    mx, my = sum(xs) / n, sum(ys) / n
    varx = sum((x - mx) ** 2 for x in xs)
    if varx == 0:
        return None
    return sum((xs[i] - mx) * (ys[i] - my) for i in range(n)) / varx

def compute_share_trend(rows, n_quarters=8, min_quarters=4):
    """Common-calendar-quarter share matrix. Returns None if impossible."""
    def idx_of(k):
        y, q = k.split("Q")
        return int(y) * 4 + int(q)
    per = {r["ticker"]: {idx_of(k): v for k, v in r["rev_by_cal"].items()} for r in rows}
    end_idx = min(max(m) for m in per.values() if m)
    for span in range(n_quarters, min_quarters - 1, -1):
        window = list(range(end_idx - span + 1, end_idx + 1))
        covered = [t for t, m in per.items() if all(i in m and m[i] > 0 for i in window)]
        if len(covered) == len(per):
            break
    else:
        # full coverage impossible even at min span: drop the worst-covered rows
        window = list(range(end_idx - n_quarters + 1, end_idx + 1))
        covered = [t for t, m in per.items() if all(i in m and m[i] > 0 for i in window)]
        if len(covered) < 2:
            return None
    labels = []
    for i in window:
        y, q = divmod(i, 4)
        if q == 0:
            y, q = y - 1, 4
        labels.append(f"{y}Q{q}")
    shares = {}
    for i in window:
        tot = sum(per[t][i] for t in covered)
        for t in covered:
            shares.setdefault(t, []).append(per[t][i] / tot if tot else None)
    out = {"quarters": labels, "covered": covered,
           "excluded": sorted(set(per) - set(covered)),
           "series": {}, "hhi_series": []}
    for i_pos in range(len(window)):
        out["hhi_series"].append(round(sum((shares[t][i_pos] * 100) ** 2 for t in covered), 0))
    for t in covered:
        s = shares[t]
        out["series"][t] = {
            "shares": [round(x, 4) for x in s],
            "delta_bps": round((s[-1] - s[0]) * 10000, 1),
            "ols_slope_bps_per_q": round(ols_slope(s) * 10000, 2) if len(s) >= 3 else None,
        }
    return out

def median_or_none(vals):
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None

def rank_of(rows, subject, key, reverse=True):
    vals = [(r[key], r["ticker"]) for r in rows if r.get(key) is not None]
    if not any(t == subject for _, t in vals):
        return None
    vals.sort(reverse=reverse)
    for i, (_, t) in enumerate(vals, 1):
        if t == subject:
            return {"rank": i, "of": len(vals)}
    return None

# ---------------------------------------------------------------- formatting

def fmt_money(x):
    if x is None:
        return "[GAP]"
    a = abs(x)
    if a >= 1e12:
        return f"${x/1e12:.2f}T"
    if a >= 1e9:
        return f"${x/1e9:.1f}B"
    if a >= 1e6:
        return f"${x/1e6:.0f}M"
    return f"${x:,.0f}"

def fmt_pct(x, dp=1):
    return "[GAP]" if x is None else f"{x*100:.{dp}f}%"

def fmt_x(x, dp=1):
    return "[GAP]" if x is None else f"{x:.{dp}f}x"

def fmt_bps(x):
    return "[GAP]" if x is None else f"{x:+,.0f} bps"

def fmt_num(x, dp=1):
    return "[GAP]" if x is None else f"{x:.{dp}f}"

# ---------------------------------------------------------------- main build

def run(subject, max_peers):
    t0 = time.time()
    notes, gaps, suppressed = [], [], []
    res = resolve_peers(subject, max_peers, notes)
    subject = res["subject"]
    tickers = [subject] + [p for p in res["peers"] if p != subject]

    rows, dropped = [], []
    for tk in tickers:
        cik = res["subject_cik"] if tk == subject else res["t2c"].get(tk)
        if tk != subject and cik:
            cik = filer_cik_for(tk, cik, notes)
        try:
            c = build_company(tk, cik, notes)
            rows.append(c)
        except Exception as e:  # noqa: BLE001 - one dead peer never kills the run
            dropped.append({"ticker": tk, "reason": str(e)})
            if tk == subject:
                raise SystemExit(f"FATAL: subject {tk} failed fundamentals build: {e}")
    for dr in dropped:
        notes.append(f"peer {dr['ticker']} dropped: {dr['reason']}")

    # market caps (polygon throttled 13s/call; cached)
    for r in rows:
        mc, src = resolve_market_cap(r["ticker"], r, notes)
        r["market_cap"] = mc
        r["market_cap_source"] = src
        if mc is None:
            gaps.append({"ticker": r["ticker"], "metric": "market_cap",
                         "reason": "polygon + yahoo fallback both failed"})

    rows.sort(key=lambda r: (r["rev_ttm"] is None, -(r["rev_ttm"] or 0)))
    n_set = len(rows)
    set_tickers = [r["ticker"] for r in rows]

    # --- 2.x shares / concentration
    ttm_total = sum(r["rev_ttm"] for r in rows if r["rev_ttm"])
    for r in rows:
        r["share_ttm"] = (r["rev_ttm"] / ttm_total) if (r["rev_ttm"] and ttm_total) else None
    trend = compute_share_trend(rows) if n_set >= 2 else None

    # unequal fiscal quarters (4-4-5 / 12-16 week calendars) put a seasonal sawtooth
    # in quarter-level shares — detect and caveat
    seasonal = []
    for r in rows:
        ends = [d(q["end"]) for q in r["quarters"][:9]]
        difs = [(ends[i] - ends[i + 1]).days for i in range(len(ends) - 1)]
        if difs and (max(difs) - min(difs)) > 14:
            seasonal.append(r["ticker"])
    if trend is not None:
        trend["seasonal_calendar_tickers"] = seasonal

    hhi = cr3 = hhi_band = hhi_trend = None
    if n_set >= 4:
        shares = [r["share_ttm"] for r in rows if r["share_ttm"] is not None]
        hhi = round(sum((s * 100) ** 2 for s in shares), 0)
        hhi_band = ("unconcentrated" if hhi < 1500 else
                    "moderately concentrated" if hhi <= 2500 else "highly concentrated")
        cr3 = sum(sorted(shares, reverse=True)[:3])
        if trend and len(trend["hhi_series"]) >= 2:
            hhi_trend = trend["hhi_series"][-1] - trend["hhi_series"][0]
    else:
        suppressed.append({"metric": "HHI/CR3", "reason":
                           f"covered set n={n_set} < 4 — concentration math on a tiny covered "
                           "set is arithmetic, not economics (spec §6)"})
    if trend and n_set < 4:
        for t in trend["series"].values():
            t["ols_slope_bps_per_q"] = None
        suppressed.append({"metric": "share-trend OLS slope",
                           "reason": f"n={n_set} < 4 (spec §6: keep delta-bps only)"})

    # --- 3.x valuation
    for r in rows:
        mc, nd, rv = r["market_cap"], r["net_debt"], r["rev_ttm"]
        r["ps"] = (mc / rv) if (mc and rv) else None
        r["ev_s"] = ((mc + nd) / rv) if (mc is not None and nd is not None and rv) else None
        r["ev_basis"] = "EV/S" if r["ev_s"] is not None else ("P/S (net debt n/a)" if r["ps"] else None)
        r["pe"] = (mc / r["ni_ttm"]) if (mc and r["ni_ttm"] and r["ni_ttm"] > 0) else None
        g = r["growth_ttm"]
        mult = r["ev_s"] if r["ev_s"] is not None else r["ps"]
        r["growth_adj_evs"] = (mult / (g * 100)) if (mult is not None and g and g > 0) else None
        r["rule_of_40"] = ((g * 100) + (r["op_margin_ttm"] * 100)
                           if None not in (g, r["op_margin_ttm"]) else None)

    subj_row = next(r for r in rows if r["ticker"] == subject)
    peer_rows = [r for r in rows if r["ticker"] != subject]

    def premium(metric):
        sv = subj_row.get(metric)
        pv = [r.get(metric) for r in peer_rows if r.get(metric) is not None]
        if sv is None or not pv:
            return {"basis": metric, "premium_vs_median": None, "n_peer_values": len(pv),
                    "note": "subject or all peers missing the multiple"}
        if len(pv) >= 3:
            med = statistics.median(pv)
            return {"basis": metric, "peer_median": round(med, 2),
                    "premium_vs_median": round(sv / med - 1, 4), "n_peer_values": len(pv)}
        return {"basis": metric, "peer_range": [round(min(pv), 2), round(max(pv), 2)],
                "premium_vs_median": None, "n_peer_values": len(pv),
                "note": "n<3 peer values — median unstable, range reported (spec §6)"}

    evs_avail = sum(1 for r in peer_rows if r["ev_s"] is not None)
    val_basis = "ev_s" if (subj_row["ev_s"] is not None and evs_avail >= 3) else "ps"
    prem_evs = premium(val_basis)
    prem_pe = premium("pe")
    profitable_peers = sum(1 for r in peer_rows if r["pe"] is not None)
    if profitable_peers < 3:
        prem_pe["note"] = (f"only {profitable_peers} profitable peer"
                           f"{'s' if profitable_peers != 1 else ''} — P/E comparison "
                           "degraded, lean on EV/S (spec §6)")

    # --- 4.x ranks
    ranks = {"size": rank_of(rows, subject, "rev_ttm"),
             "growth": rank_of(rows, subject, "growth_ttm"),
             "op_margin": rank_of(rows, subject, "op_margin_ttm")}

    # --- 5.1 growth gap
    peer_growths = [r["growth_ttm"] for r in peer_rows if r["growth_ttm"] is not None]
    growth_gap = None
    if subj_row["growth_ttm"] is not None and peer_growths:
        med = statistics.median(peer_growths)
        growth_gap = {"subject": subj_row["growth_ttm"], "peer_median": med,
                      "gap_pp": (subj_row["growth_ttm"] - med) * 100,
                      "n_peers": len(peer_growths),
                      "degraded": len(peer_growths) < 3}

    # --- gaps registry
    for r in rows:
        for metric, key in [("growth_ttm_yoy", "growth_ttm"), ("growth_latest_q", "growth_latest_q"),
                            ("gross_margin", "gross_margin_ttm"), ("op_margin", "op_margin_ttm"),
                            ("net_margin", "net_margin_ttm"), ("pe", "pe")]:
            if r.get(key) is None:
                reason = {
                    "growth_ttm_yoy": "needs 8 consecutive quarters of revenue",
                    "growth_latest_q": "needs the year-ago quarter in companyfacts",
                    "gross_margin": "no CostOfRevenue/CostOfGoodsAndServicesSold/GrossProfit tag coverage for the TTM window",
                    "op_margin": "OperatingIncomeLoss missing for the TTM window",
                    "net_margin": "NetIncomeLoss missing for the TTM window",
                    "pe": ("loss-maker over the TTM window (P/E n/m)"
                           if (r.get("ni_ttm") is not None and r["ni_ttm"] <= 0)
                           else "net income or market cap unavailable for the TTM window"),
                }[metric]
                gaps.append({"ticker": r["ticker"], "metric": metric, "reason": reason})
        if r["rd_reported"] and r.get("rd_intensity_ttm") is None:
            gaps.append({"ticker": r["ticker"], "metric": "rd_intensity", "reason":
                         "R&D tag exists but has no fresh quarterly or annual values "
                         "(stopped being tagged consolidated)"})
        if r.get("net_debt") is None:
            gaps.append({"ticker": r["ticker"], "metric": "net_debt_ev", "reason":
                         "consolidated debt not resolvable from XBRL (stale/dimension-"
                         "tagged balances) — EV/S degraded to P/S"})
        if not r["rd_reported"]:
            notes.append(f"{r['ticker']}: no R&D line reported in XBRL — shown as n/r, "
                         "rd_reported:false, excluded from peer medians")

    result = {
        "subject": subject,
        "subject_name": res["subject_name"],
        "subject_sic": f"{res['subject_sic']} — {res['subject_sic_desc']}",
        "generated_utc": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "runtime_s": None,
        "sources": {
            "fundamentals": "SEC EDGAR XBRL companyfacts (10-Q/10-K as filed; Q4 derived as FY minus 3 quarters where not filed)",
            "market_cap": "Polygon v3/reference/tickers (fallback: Yahoo v8 price x EDGAR dei shares)",
            "peer_resolution": "Polygon v1/related-companies + EDGAR SIC fence; fallback EDGAR exact-SIC listing ranked by XBRL-frames revenue",
        },
        "peer_resolution": {
            "n_set": n_set, "coverage_tickers": set_tickers,
            "resolver": res.get("peer_resolver", "deterministic"),
            "provenance": res["provenance"], "known_excluded": res["known_excluded"],
            "dropped_peers": dropped,
            "denominator_caveat": "All shares are share-of-covered-peer-set revenue, NOT true market share.",
        },
        "comp_table": [{k: r.get(k) for k in
                        ("ticker", "rev_ttm", "growth_ttm", "growth_latest_q",
                         "gross_margin_ttm", "op_margin_ttm", "net_margin_ttm",
                         "rd_intensity_ttm", "rd_reported", "rd_basis", "market_cap",
                         "market_cap_source", "share_ttm", "data_through", "rev_tag",
                         "ni_ttm", "net_debt", "net_debt_asof", "debt_basis")} for r in rows],
        "share_trend": trend,
        "concentration": {"n_peers": n_set, "coverage_tickers": set_tickers,
                          "hhi": hhi, "hhi_band": hhi_band, "hhi_trend_q8_to_q1": hhi_trend,
                          "cr3": cr3, "suppressed": [s for s in suppressed],
                          "caveats": ["shares are covered-set shares; HHI is a floor-biased "
                                      "estimate when real-market players are missing"]},
        "valuation": {"rows": [{k: r.get(k) for k in ("ticker", "ps", "ev_s", "ev_basis",
                                                       "pe", "growth_adj_evs")} for r in rows],
                      "premium_multiple": prem_evs, "premium_pe": prem_pe,
                      "basis_used": val_basis, "profitable_peers": profitable_peers},
        "ranks": ranks,
        "extended": {"growth_gap_vs_peer_median": growth_gap,
                     "rows": [{k: r.get(k) for k in ("ticker", "gm_trend_bps",
                                                      "rule_of_40", "incremental_op_margin")}
                              for r in rows]},
        "quarters_detail": {r["ticker"]: r["quarters"] for r in rows},
        "gaps": gaps, "suppressed": suppressed, "notes": notes,
    }
    result["runtime_s"] = round(time.time() - t0, 1)
    return result, rows, subj_row, peer_rows

# ---------------------------------------------------------------- markdown

def render_md(res, rows, subj_row, peer_rows):
    subject = res["subject"]
    L = []
    add = L.append
    add(f"# {subject} — Competition Quant Exhibit")
    add("")
    add(f"*Generated {res['generated_utc']} · all figures deterministic (LLM used only for cached peer-set membership) · "
        f"fundamentals: SEC EDGAR XBRL as filed · market caps: computed as shares × official previous close (Polygon primitives; close date stamped per row)*")
    add("")
    add(f"**Subject:** {res['subject_name']} (SIC {res['subject_sic']})")
    n = res["peer_resolution"]["n_set"]
    add(f"**Covered set (n={n}):** " + ", ".join(
        (t + " *(subject)*" if t == subject else t)
        for t in res["peer_resolution"]["coverage_tickers"]))
    srcs = sorted({p["source"] for p in res["peer_resolution"]["provenance"]})
    add(f"**Peer resolver:** {res['peer_resolution'].get('resolver', 'deterministic')} "
        f"({' + '.join(srcs) if srcs else '[GAP] no peers resolved'})")
    add("")
    add("> **Denominator honesty:** every \"share\" below is share of *covered peer-set "
        "revenue*, not true market share. Private/foreign competitors (no US XBRL) are "
        "excluded and listed in the footnotes.")
    add("")

    # ---- 1. comp table
    add("## 1 · Peer comp table (TTM)")
    add("")
    add("| Company | Rev TTM | Rev YoY (TTM) | Rev YoY (latest Q) | Gross mgn | Op mgn | Net mgn | R&D int. | Mkt cap | Data through |")
    add("|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        nm = f"**{r['ticker']}\\*** " if r["ticker"] == subject else r["ticker"]
        if not r["rd_reported"]:
            rd = "n/r†"
        elif r.get("rd_basis") and r["rd_basis"].startswith("FY"):
            rd = fmt_pct(r["rd_intensity_ttm"]) + f"‡ ({r['rd_basis']})"
        else:
            rd = fmt_pct(r["rd_intensity_ttm"])
        add(f"| {nm} | {fmt_money(r['rev_ttm'])} | {fmt_pct(r['growth_ttm'])} | "
            f"{fmt_pct(r['growth_latest_q'])} | {fmt_pct(r['gross_margin_ttm'])} | "
            f"{fmt_pct(r['op_margin_ttm'])} | {fmt_pct(r['net_margin_ttm'])} | {rd} | "
            f"{fmt_money(r['market_cap'])} | {r['data_through']} |")
    add("")
    add("\\* subject · † no R&D line reported in XBRL (n/r = not reported; excluded from peer medians) · ‡ R&D tagged "
        "annually only, latest-FY basis · sorted by revenue")
    add("")

    # ---- 2. share + concentration
    add(f"## 2 · Market share & concentration (covered set, n={n})")
    add("")
    add("| Company | Share of covered TTM revenue |")
    add("|---|---|")
    for r in rows:
        nm = f"**{r['ticker']}\\***" if r["ticker"] == subject else r["ticker"]
        add(f"| {nm} | {fmt_pct(r['share_ttm'])} |")
    total_share = sum(r["share_ttm"] for r in rows if r["share_ttm"] is not None)
    add(f"| *Total* | *{total_share*100:.1f}%* |")
    add("")
    tr = res["share_trend"]
    if tr:
        add(f"**Share trend — last {len(tr['quarters'])} common calendar quarters "
            f"({tr['quarters'][0]} → {tr['quarters'][-1]}):**")
        add("")
        hdr = "| Company | " + " | ".join(tr["quarters"]) + " | Δ (bps) | Slope (bps/q) |"
        add(hdr)
        add("|" + "---|" * (len(tr["quarters"]) + 3))
        for t in [x["ticker"] for x in rows if x["ticker"] in tr["series"]]:
            s = tr["series"][t]
            nm = f"**{t}\\***" if t == subject else t
            cells = " | ".join(f"{v*100:.1f}" for v in s["shares"])
            slope = fmt_num(s["ols_slope_bps_per_q"]) if s["ols_slope_bps_per_q"] is not None else "[suppressed]"
            add(f"| {nm} | {cells} | {s['delta_bps']:+.0f} | {slope} |")
        add("")
        if tr["excluded"]:
            add(f"*Excluded from trend (insufficient quarterly history): {', '.join(tr['excluded'])}*")
            add("")
        if tr.get("seasonal_calendar_tickers"):
            add(f"*Seasonality caveat: {', '.join(tr['seasonal_calendar_tickers'])} use(s) "
                "unequal fiscal quarters (4-4-5 / 12-16-week calendar), which puts a seasonal "
                "sawtooth in quarter-level shares — weight the slope, not single-quarter deltas.*")
            add("")
    else:
        add("**Share trend:** [GAP] — insufficient common quarterly history across the set")
        add("")
    conc = res["concentration"]
    if conc["hhi"] is not None:
        add(f"**HHI (covered set): {conc['hhi']:.0f} — {conc['hhi_band']}** "
            "(DOJ/FTC bands: <1500 unconcentrated · 1500–2500 moderate · >2500 high). ")
        if conc["hhi_trend_q8_to_q1"] is not None:
            direction = "consolidating" if conc["hhi_trend_q8_to_q1"] > 0 else "fragmenting"
            add(f"**HHI trend** over the window: {conc['hhi_trend_q8_to_q1']:+.0f} points ({direction}).")
        add(f"**CR3:** {fmt_pct(conc['cr3'])} of covered-set revenue sits with the top 3.")
    else:
        add(f"**HHI / CR3: [suppressed]** — covered set n={n} < 4; concentration math on a "
            "tiny covered set is arithmetic, not economics.")
    add("")
    add("*Caveat: HHI/shares are floor-biased estimates — real-market players missing from "
        "the covered set (private/foreign) make true concentration different.*")
    add("")

    # ---- 3. valuation
    add("## 3 · Relative valuation")
    add("")
    add("| Company | P/S | EV/S | P/E (TTM) | Growth-adj EV/S | Basis note |")
    add("|---|---|---|---|---|---|")
    for r in rows:
        nm = f"**{r['ticker']}\\***" if r["ticker"] == subject else r["ticker"]
        pe = fmt_x(r["pe"], 1) if r["pe"] is not None else ("n/m (loss-maker)" if (r["ni_ttm"] or 0) <= 0 and r["ni_ttm"] is not None else "[GAP]")
        add(f"| {nm} | {fmt_x(r['ps'])} | {fmt_x(r['ev_s'])} | {pe} | "
            f"{fmt_num(r['growth_adj_evs'], 2)} | {r['ev_basis'] or '[GAP]'} |")
    add("")
    v = res["valuation"]
    basis_label = "EV/S" if v["basis_used"] == "ev_s" else "P/S"
    pm = v["premium_multiple"]
    def prem_phrase(p, med, mult_val):
        if p > 2.0:  # >200% premium reads better as a multiple
            return f"**{mult_val/med:.1f}× the peer median** {fmt_x(med)}"
        sign = "premium" if p > 0 else "discount"
        return f"a **{abs(p)*100:.0f}% {sign}** to the peer median {fmt_x(med)}"
    if pm.get("premium_vs_median") is not None:
        subj_mult = subj_row['ev_s'] if v['basis_used'] == 'ev_s' else subj_row['ps']
        add(f"**Valuation punchline:** {subject} trades at {fmt_x(subj_mult)} {basis_label} — "
            f"{prem_phrase(pm['premium_vs_median'], pm['peer_median'], subj_mult)} "
            f"(n={pm['n_peer_values']} peers).")
    elif pm.get("peer_range"):
        add(f"**Valuation:** peer {basis_label} range {pm['peer_range'][0]}x–{pm['peer_range'][1]}x "
            f"vs subject {fmt_x(subj_row['ev_s'] or subj_row['ps'])} — median premium suppressed "
            f"(only {pm['n_peer_values']} peer values).")
    else:
        add(f"**Valuation premium:** [GAP] — {pm.get('note', 'not computable')}")
    pp = v["premium_pe"]
    if pp.get("premium_vs_median") is not None:
        sign = "premium" if pp["premium_vs_median"] > 0 else "discount"
        add(f"**P/E:** {fmt_x(subj_row['pe'])} vs peer median {fmt_x(pp['peer_median'])} — "
            f"{abs(pp['premium_vs_median'])*100:.0f}% {sign}.")
    elif pp.get("note"):
        add(f"**P/E comparison:** {pp['note']}.")
    add("")

    # ---- 4. ranks
    add("## 4 · Positioning at a glance")
    add("")
    rk = res["ranks"]
    def rline(label, r_, better):
        if r_ is None:
            return f"- {label}: [GAP]"
        return f"- **{label}: #{r_['rank']} of {r_['of']}** ({better})"
    add(rline("Size rank (Rev TTM)", rk["size"], "1 = largest"))
    add(rline("Growth rank (Rev YoY TTM)", rk["growth"], "1 = fastest"))
    add(rline("Margin rank (Op margin TTM)", rk["op_margin"], "1 = most profitable"))
    add("")

    # ---- 5. extended
    add("## 5 · Extended metrics")
    add("")
    add("| Company | GM trend (bps, TTM vs prior TTM) | Rule of 40 (growth+op mgn) | Incremental op margin |")
    add("|---|---|---|---|")
    ext = {e["ticker"]: e for e in res["extended"]["rows"]}
    for r in rows:
        e = ext[r["ticker"]]
        nm = f"**{r['ticker']}\\***" if r["ticker"] == subject else r["ticker"]
        r40 = fmt_num(e["rule_of_40"]) if e["rule_of_40"] is not None else "[GAP]"
        iom = fmt_pct(e["incremental_op_margin"], 0) if e["incremental_op_margin"] is not None else "[GAP]"
        add(f"| {nm} | {fmt_bps(e['gm_trend_bps'])} | {r40} | {iom} |")
    add("")
    gg = res["extended"]["growth_gap_vs_peer_median"]
    if gg:
        verb = "taking" if gg["gap_pp"] > 0 else "ceding"
        deg = " *(degraded: <3 peers)*" if gg["degraded"] else ""
        add(f"**Growth gap:** {subject} TTM growth {fmt_pct(gg['subject'])} vs peer median "
            f"{fmt_pct(gg['peer_median'])} → **{gg['gap_pp']:+.1f} pp** — {verb} share of the "
            f"covered set's growth.{deg}")
    else:
        add("**Growth gap:** [GAP] — subject or peer growth unavailable.")
    add("")

    # ---- bullets
    add("## What the numbers say")
    add("")
    bullets = []
    sr = subj_row
    if sr["rev_ttm"] is not None and rk["size"]:
        s = (f"{subject} generates {fmt_money(sr['rev_ttm'])} TTM revenue — "
             f"#{rk['size']['rank']} of {rk['size']['of']} in the covered set")
        if sr["share_ttm"] is not None:
            s += f", a {sr['share_ttm']*100:.1f}% covered-set share"
        tr2 = res["share_trend"]
        if tr2 and subject in tr2["series"]:
            se = tr2["series"][subject]
            s += (f"; that share moved {se['delta_bps']:+.0f} bps over the last "
                  f"{len(tr2['quarters'])} quarters")
            if se["ols_slope_bps_per_q"] is not None:
                s += f" ({se['ols_slope_bps_per_q']:+.1f} bps/quarter trend)"
        bullets.append(s + ".")
    if gg:
        cmpword = "above" if gg["gap_pp"] > 0 else "below"
        b = (f"Growth: {fmt_pct(gg['subject'])} TTM YoY vs peer median "
             f"{fmt_pct(gg['peer_median'])} — {abs(gg['gap_pp']):.1f} pp {cmpword} the set")
        if sr["growth_latest_q"] is not None:
            b += f"; latest quarter {fmt_pct(sr['growth_latest_q'])} YoY"
        bullets.append(b + ".")
    pgm = median_or_none([r["gross_margin_ttm"] for r in peer_rows])
    pom = median_or_none([r["op_margin_ttm"] for r in peer_rows])
    if sr["gross_margin_ttm"] is not None and pgm is not None:
        dgm = (sr["gross_margin_ttm"] - pgm) * 100
        b = (f"Margins: gross {fmt_pct(sr['gross_margin_ttm'])} vs peer median {fmt_pct(pgm)} "
             f"({dgm:+.1f} pp)")
        if sr["op_margin_ttm"] is not None and pom is not None:
            b += (f"; operating {fmt_pct(sr['op_margin_ttm'])} vs {fmt_pct(pom)} "
                  f"({(sr['op_margin_ttm']-pom)*100:+.1f} pp)")
        bullets.append(b + ".")
    prd = median_or_none([r["rd_intensity_ttm"] for r in peer_rows if r["rd_reported"]])
    if sr["rd_reported"] and sr["rd_intensity_ttm"] is not None and prd is not None:
        mult = (sr["rd_intensity_ttm"] / prd) if prd > 0 else None
        b = (f"R&D intensity {fmt_pct(sr['rd_intensity_ttm'])} of revenue vs peer median "
             f"{fmt_pct(prd)}")
        if mult:
            b += f" — {mult:.1f}x the peer funding rate"
        bullets.append(b + ".")
    if pm.get("premium_vs_median") is not None:
        subj_mult = sr['ev_s'] if v['basis_used'] == 'ev_s' else sr['ps']
        if pm["premium_vs_median"] > 2.0:
            rel = f"{subj_mult/pm['peer_median']:.1f}x the peer median {fmt_x(pm['peer_median'])}"
        else:
            sign = "premium" if pm["premium_vs_median"] > 0 else "discount"
            rel = (f"a {abs(pm['premium_vs_median'])*100:.0f}% {sign} to the peer median "
                   f"{fmt_x(pm['peer_median'])}")
        b = f"Valuation: {fmt_x(subj_mult)} {basis_label}, {rel}"
        if sr["growth_adj_evs"] is not None:
            b += f"; growth-adjusted {basis_label} of {sr['growth_adj_evs']:.2f}"
            peer_ga = median_or_none([r["growth_adj_evs"] for r in peer_rows])
            if peer_ga is not None:
                b += f" vs peer median {peer_ga:.2f}"
        bullets.append(b + ".")
    if conc["hhi"] is not None:
        b = f"Structure: covered set HHI {conc['hhi']:.0f} ({conc['hhi_band']})"
        if conc["hhi_trend_q8_to_q1"] is not None:
            b += (f", {'rising' if conc['hhi_trend_q8_to_q1'] > 0 else 'falling'} "
                  f"{abs(conc['hhi_trend_q8_to_q1']):.0f} points over the trend window — "
                  f"{'consolidating' if conc['hhi_trend_q8_to_q1'] > 0 else 'fragmenting'}")
        bullets.append(b + ".")
    for b in bullets[:5]:
        add(f"- {b}")
    add("")

    # ---- footnotes
    add("---")
    add("### Footnotes, gaps & exclusions")
    add("")
    ke = res["peer_resolution"]["known_excluded"]
    if ke:
        shown = [x for x in ke if x.get("ticker")][:12]
        add("**Known excluded from the peer set:** " + "; ".join(
            f"{x['ticker']} ({x['reason']})" for x in shown))
        n_no_ticker = sum(1 for x in ke if not x.get("ticker"))
        if n_no_ticker:
            add(f"Plus {n_no_ticker} SIC-listed filers with no public ticker (private/delisted).")
        add("")
    if res["peer_resolution"]["dropped_peers"]:
        add("**Dropped during build:** " + "; ".join(
            f"{x['ticker']} — {x['reason']}" for x in res["peer_resolution"]["dropped_peers"]))
        add("")
    if res["suppressed"]:
        add("**Suppressed metrics:** " + "; ".join(
            f"{s['metric']} ({s['reason']})" for s in res["suppressed"]))
        add("")
    open_gaps = [g for g in res["gaps"] if g["metric"] != "pe"]
    if open_gaps:
        add("**[GAP] register:** " + "; ".join(
            f"{g['ticker']}.{g['metric']} — {g['reason']}" for g in open_gaps))
        add("")
    add("**Method:** TTM = last 4 consecutive fiscal quarters from XBRL (Q4 derived as FY "
        "minus 3 filed quarters where not reported). Shares/HHI computed on covered-set "
        "revenue only. EV = market cap + (LT debt incl. current portion − cash − short-term "
        "investments); degraded to P/S when balance-sheet tags are unavailable. Market caps "
        "are as of the run date; fundamentals as of each row's 'data through' date.")
    add(f"**Runtime:** {res['runtime_s']}s · cache: ./cache/")
    return "\n".join(L) + "\n"

# ---------------------------------------------------------------- entrypoint

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ticker")
    ap.add_argument("--max-peers", type=int, default=MAX_PEERS_DEFAULT)
    args = ap.parse_args()
    subject = args.ticker.upper()

    res, rows, subj_row, peer_rows = run(subject, args.max_peers)
    md = render_md(res, rows, subj_row, peer_rows)

    jpath = os.path.join(BASE, f"{subject}_competition.json")
    mpath = os.path.join(BASE, f"{subject}_competition.md")
    with open(jpath, "w") as f:
        json.dump(res, f, indent=1, default=str)
    with open(mpath, "w") as f:
        f.write(md)
    print(f"WROTE {mpath}")
    print(f"WROTE {jpath}")
    print(f"set n={res['peer_resolution']['n_set']} tickers={res['peer_resolution']['coverage_tickers']}")
    share_sum = sum(r.get("share_ttm") or 0 for r in res["comp_table"])
    print(f"share_sum={share_sum*100:.2f}% gaps={len(res['gaps'])} suppressed={len(res['suppressed'])}")

if __name__ == "__main__":
    main()
