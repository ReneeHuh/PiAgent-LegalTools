# Michigan Shepardizing Automation Plan

**Companion to:** `MICHIGAN_CASE_SHEPARDIZING_GUIDE.md`
**Drafted:** 2026-08-26

Goal: automate ~80% of the free-source shepardizing workflow (Guide Parts 2, 3, 5, 8) for one or many Michigan cases, producing an auditable report per case. A human still reads flagged treatments, does MCR 7.215(J) conflict analysis, and does the final pre-filing recheck.

---

## 1. Architecture at a glance

```
citation(s) in
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Resolver          CourtListener REST API (no browser)   │
│  Cited-by graph    CourtListener REST API                │
│  Opinion texts     CourtListener API + PDF download      │
│  Official docket   courts.michigan.gov  ← headless browser
│  Scholar cross-chk scholar.google.com   ← headed browser, │
│                    human-in-the-loop                     │
└─────────────────────────────────────────────────────────┘
    │
    ▼
Local cache (SQLite + files)  →  passage extraction (eyecite)
    │
    ▼
Treatment classification (keyword screen → LLM pass)
    │
    ▼
Per-case report (Markdown/HTML) + research log (CSV)
```

**Stack:** Python 3.12 + Playwright (headless Chromium), `httpx` for the
CourtListener API, `eyecite` for citation extraction, SQLite for the cache,
Claude API for treatment classification, Jinja2 for report rendering.

Python over Node because `eyecite` (Free Law Project's citation parser) is
Python-only and is the single biggest piece we don't want to rewrite.

**Source-access policy — which tool for which site:**

| Source | Access method | Why |
|---|---|---|
| CourtListener | REST API v4 with free token | Sanctioned, stable, has cited-by graph. Browser would be strictly worse. |
| courts.michigan.gov case search | Headless Playwright, paced | Public records, no API, no bot wall. Single-case lookups only — never bulk crawls. |
| Google Scholar "How Cited" | **Headed** Playwright, human present | ToS prohibits automated access and it CAPTCHAs headless traffic. The tool opens the page, pre-fills the search, waits for the human, then scrapes the *rendered* page after the human confirms. If a CAPTCHA appears, we stop and let the human solve it — no evasion, no proxy rotation. |
| MiCOURT (trial courts) | Manual only — tool emits a pre-filled link | Terms expressly prohibit bulk downloads (Guide Step 8 / Part 7). |
| Justia / FindLaw | Skipped in v1 | Redundant with CourtListener for discovery; revisit only if coverage gaps show up. |

## 2. Politeness / pacing policy (applies to all browser traffic)

These rules are hard-coded in one `Pacer` class every fetcher must go through:

- **Randomized waits:** 4–10 s (uniform jitter) between page actions on the
  same domain; 2–4 s between in-page interactions (click, type, paginate).
- **Session budget:** max 60 page loads per domain per session; then a
  mandatory 15-minute cooldown. Long jobs resume from cache, so this costs
  nothing but wall-clock time.
- **Backoff:** on HTTP 429/503 or an unexpected interstitial, exponential
  backoff starting at 60 s, max 3 retries, then park the item in a
  `needs_human` queue and move on.
- **Cache-first:** every fetched page/PDF/JSON is stored with URL, timestamp,
  and content hash. A URL is never re-fetched within 30 days unless the user
  passes `--refresh`.
- **Honest client:** normal Chromium UA string; no fingerprint spoofing, no
  proxy rotation, no CAPTCHA solvers. If a site says no, the answer is no —
  the item goes to the manual queue with a pre-filled URL.
- **CourtListener API:** their documented limit is generous (5,000
  requests/hour with a token); we self-limit to 1 request/second anyway.

## 3. Data model (SQLite: `shepard.db`)

```
cases        id, cl_cluster_id, name, court, date, docket_no,
             reporter_cite, parallel_cite, precedential_status,
             resolved_at, source
opinions     id, case_id, cl_opinion_id, text_path, pdf_path, fetched_at
citing_refs  id, target_case_id, citing_case_id, discovered_via
             (courtlistener | scholar | official_search), discovered_at
passages     id, citing_ref_id, char_start, char_end, text,
             extraction_method (eyecite | fallback_regex)
treatments   id, passage_id, keyword_hits, llm_label, llm_confidence,
             llm_rationale, human_reviewed (bool), human_label
docket_events id, case_id, court, event_date, description, doc_url,
             source (official_micourts | manual)
fetch_log    id, url, domain, status, fetched_at, cache_path   ← research log
runs         id, started_at, args, git_rev, notes
```

`fetch_log` + `runs` together satisfy the Guide's Part 8 research-log
requirement (what was searched, where, when) with zero extra effort.

## 4. Pipeline stages

### Stage A — Resolve (API, no browser)
1. Input: citation string(s), docket number, or a brief (Phase 4).
2. POST to CourtListener `citation-lookup` → cluster ID, or fall back to
   search API by case name + court + date.
3. Store the identity block (Guide Step 2 fields). If resolution is ambiguous
   (companion cases, amended opinions), emit all candidates and require the
   user to pick — never guess silently (Guide "Common mistakes" #4).

### Stage B — Direct history (API + headless browser)
1. Pull the CourtListener docket for the cluster; capture related appellate
   history if present.
2. **Playwright job:** open courts.michigan.gov case search, enter the
   appellate docket number (punctuation stripped), open the case-details
   page, save full HTML + every linked opinion/order PDF, transcribe docket
   entries into `docket_events`.
3. Diff the two histories; flag entries after the target opinion date
   (reconsideration, leave application, order in lieu, remand — Guide Step 7
   watch-list) as `needs_human_read`.

### Stage C — Cited-by harvest (API)
1. CourtListener `opinions-cited` (cited-by direction) for every opinion in
   the cluster.
2. For each citing case: fetch cluster metadata (court, date, precedential
   status) and full text; download to cache.
3. Record `discovered_via = courtlistener`.

### Stage D — Official-site citation sweep (headless browser)
Covers CourtListener's Michigan coverage gaps (esp. unpublished COA and
recent orders — Guide Step 10):
1. Playwright searches courts.michigan.gov for the reporter cite, parallel
   NW cite, exact case name, and docket number (4 paced queries).
2. New hits not already in `citing_refs` get fetched and added with
   `discovered_via = official_search`.

### Stage E — Scholar cross-check (headed browser, human present)
1. Tool launches a **visible** browser, navigates to Scholar case-law search
   with the citation pre-filled, and pauses: *"Click through to the case and
   open How Cited, then press Enter here."*
2. Human does the two clicks (and any CAPTCHA). Tool then reads the rendered
   How-Cited list from the open page, diffs against known `citing_refs`, and
   reports only the *delta* — usually zero or a handful to chase manually.
3. This stage is optional per run (`--skip-scholar`) and is last because by
   then it's a verification step, not discovery.

### Stage F — Passage extraction (offline)
1. Run `eyecite` over every citing opinion's text to locate references to the
   target case (handles short-form cites, *id.*, *supra*).
2. Extract ±2 paragraphs around each hit into `passages`. Fallback: regex on
   party names + reporter cite if eyecite finds nothing but Stage C says the
   case is cited (log the discrepancy).

### Stage G — Treatment classification (offline + LLM)
1. **Keyword screen** on each passage using the Guide Step 12 verb list
   (`overrule`, `abrogate`, `vacate`, `decline to follow`, `distinguish`,
   `limit`, `question`, `criticize`, `follow`, `adopt`, ...). Pure signal
   boost — never a final label.
2. **LLM pass** (Claude API, one call per passage, batched): returns strict
   JSON `{label, confidence, affected_proposition, quoted_evidence}` where
   `label` ∈ the Guide Step 12 taxonomy. Prompt includes the target case
   identity and, if provided, the user's proposition statement (Guide Step 1)
   so treatment is judged *proposition-specifically*.
3. Any label in {overruled, abrogated, reversed, vacated, criticized,
   questioned, declined-to-follow, limited} OR confidence < 0.7 →
   `human_reviewed` required before the report calls it anything.

### Stage H — Rank + report (offline)
1. Sort citing cases by the Guide Part 6 hierarchy: US SCOTUS (federal issue)
   → Mich Supreme Court → published COA → unpublished COA → federal
   lower / trial / other. Precedential-status field from CourtListener,
   cross-checked against the official opinion header when fetched.
2. Render per-case report (Markdown + HTML via the existing
   `render-report.mjs` styling or Jinja2):
   - identity block; direct-history table; citing-cases table (court, date,
     published?, treatment, confidence, quoted passage, links);
   - statutes/rules cited by the target opinion (eyecite extracts MCL/MCR
     cites) as a **manual checklist** for Guide Step 14;
   - research log (from `fetch_log`);
   - mandated disclaimer: *"No negative treatment located in [listed
     sources] as of [timestamp]. This is not a commercial citator and does
     not conclusively establish the case as good law. Recheck before filing."*
3. Exit code / summary line flags any case with unresolved negative
   treatment so batch runs are scannable.

## 5. CLI surface

```
shep resolve "500 Mich 500"           # Stage A only — verify identity
shep run "500 Mich 500" [--proposition "..."] [--skip-scholar] [--refresh]
shep run --batch cites.txt
shep brief mybrief.docx               # Phase 4: extract all cites, run all
shep review                            # step through needs_human queue
shep report <case-id> [--html]
```

## 6. Build phases

| Phase | Deliverable | Depends on |
|---|---|---|
| 1 | Stages A + C: resolve, cited-by, bulk text download to cache. Useful standalone. | CourtListener API token |
| 2 | Stage B + D: Playwright module for courts.michigan.gov + Pacer class | Phase 1 |
| 3 | Stages F + G: eyecite passages + LLM classification | Phase 1 |
| 4 | Stage H: reports + research log; Stage E Scholar assist; `shep review` | 2, 3 |
| 5 | Batch/brief mode; pre-filing `--refresh` recheck command | 4 |

Phase 1 needs no browser at all — worth building first to validate coverage
before investing in the Playwright layer.

## 7. Risks and mitigations

- **CourtListener MI coverage gaps** (unpublished COA, fresh orders): Stage D
  official sweep + Stage E Scholar delta exist precisely for this; report
  always states which sources were checked and their limits.
- **Official site DOM changes:** Playwright selectors isolated in one module
  with a smoke test (`shep selftest`) that resolves a known case end-to-end.
- **LLM misclassification:** never auto-clear a negative signal; quoted
  evidence always shown; confidence gate routes to human review.
- **Scope creep into a "citator":** the report language and disclaimer are
  fixed and non-negotiable — this is a research aid per Guide Part 5.
- **ToS drift:** the Pacer policy and per-source access table live in this
  file; re-review before adding any new source.

## 8. Explicitly out of scope (stays human)

- MCR 7.215(J) conflict-panel analysis (Guide Step 4).
- Reading and legally interpreting flagged negative treatments (Step 12/15).
- Statute/rule amendment analysis (Step 14) — tool only lists what to check.
- MiCOURT / trial-court records — tool emits pre-filled links only.
- Any conclusion that a case is "good law" — the tool reports absence of
  located negative treatment in named sources, nothing stronger.
