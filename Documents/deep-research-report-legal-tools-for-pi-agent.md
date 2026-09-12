# Deep Research Report: Legal Tools for a Pro Se Person to Add to Pi Agent

*Research date: September 3, 2026. US-focused. Compiled from five parallel web-research passes: (1) legal research & case-law data APIs, (2) document drafting & court forms, (3) legal NLP / AI libraries / MCP servers, (4) practical pro se tools & regulatory guardrails, (5) legal help beyond court cases — consumer disputes, government agencies, benefits, records relief, and life documents.*

---

## Executive Summary

The single biggest development for an agent like Pi Agent is that **Free Law Project now runs an official, hosted MCP server for CourtListener** (`https://mcp.courtlistener.com/`, launched May 2026) — one connector gives the agent case-law search (keyword + semantic), federal dockets via RECAP, judge data, alerts, and **citation verification**. Free with a CourtListener account.

The recommended architecture is:

- **Research:** CourtListener (MCP or REST v4) + free government APIs (eCFR, govinfo, Congress.gov, Federal Register, OpenStates)
- **Anti-hallucination guardrail (mandatory):** eyecite (local citation parsing) + CourtListener Citation Lookup API on every generated draft
- **Document output:** docxtpl / python-docx for pleadings, PyPDFForm / pypdf for fillable court PDFs — all lightweight enough for modest hardware
- **Triage & referral:** Suffolk LIT Lab Spot API (issue spotting), LSC Find Legal Aid, LawHelp.org, ABA Free Legal Answers as the "escalate to a human" path
- **Guardrails:** frame output as legal *information*, not *advice*; check the forum's AI disclosure rules (some Florida circuits require pro se litigants to disclose AI use; New York requires certifying no fabricated citations as of June 2026); never claim lawyer-equivalence (FTC's DoNotPay order)
- **Beyond court cases:** most everyday legal problems never reach a courtroom. The best programmatic entry points are the CFPB Consumer Complaint Database API (open, keyless), MuckRock's API for actually *filing* public-records requests, USCIS's Torch APIs (case status, FOIA), VA Lighthouse APIs, and the public-domain CFPB template letters for credit disputes, debt validation, and identity theft — all detailed in Part 5

Things to **avoid**: the old Caselaw Access Project API (shut down Sept 2024 — data lives in CourtListener now), Casetext (retired April 2025, absorbed into Westlaw CoCounsel), LexNLP and Blackstone (dormant/abandoned legal NLP libs), Google Scholar scraping (blocked), and commercial AI legal platforms (Harvey, CoCounsel, Spellbook — enterprise-gated, no individual API access).

---

## Part 1 — Legal Research & Case-Law Data Sources

### 1.1 CourtListener / Free Law Project — the backbone

Nonprofit platform with ~all published US case law (federal + state, including the full Harvard Caselaw Access Project corpus), the RECAP archive of PACER dockets, judge data, and oral arguments.

**REST API v4** (`https://www.courtlistener.com/api/rest/v4/`):
- `search/` — keyword + Boolean search across opinions, dockets, judges, oral arguments; **semantic search** added Nov 2025 (`semantic=true`)
- Opinions, clusters, dockets, docket entries, parties, attorneys (~half a billion PACER-derived records)
- **Citation Lookup API** (`POST /api/rest/v4/citation-lookup/`) — bulk citation verification against ~18M records, explicitly built to catch AI-hallucinated citations; up to 250 citations per request; returns per-citation status (found / not found / invalid reporter / ambiguous). Limits: doesn't verify statutes, journals, *id.*/*supra*.
- **Alert APIs** — docket + search alerts via email or webhooks
- **RECAP Fetch API** — purchases PACER content using your PACER credentials (API free; you pay PACER's bill) and adds it to the public archive
- Bulk data dumps (CSV/Postgres) also available

**Auth/cost:** free account → API token. Free tier: 5 req/min, 50/hr, 125/day; membership tiers up to ~25/min, 300/hr, 1,400/day; free generous EDU tier. As of May 2026, full API access is bundled into memberships — cache aggressively on the free tier.

**Official MCP server:** `https://mcp.courtlistener.com/` (May 2026) — OAuth against a free CourtListener account; works in Claude, ChatGPT, Cursor, etc. Exposes search, citation verification, alerts, plus generic `get_endpoint_schema`/`call_endpoint` tools. There is also an official Python API client with an MCP mode ([freelawproject/courtlistener-api-client](https://github.com/freelawproject/courtlistener-api-client)).

Integration difficulty: **low**. URLs: https://www.courtlistener.com/ · https://free.law/ · https://wiki.free.law/c/courtlistener/help/api/rest/v4/overview

### 1.2 RECAP Archive (federal dockets)

Largest open collection of PACER data — hundreds of millions of docket entries, millions of PDFs, crowdsourced via the free RECAP browser extension (anything a user buys on PACER is auto-donated). **Always check RECAP before paying PACER.** RECAP Search Alerts ("Google Alerts for federal courts") launched June 2025. `@recap.email` auto-archives a litigant's own ECF notices. https://free.law/recap/

### 1.3 PACER (official federal records)

- $0.10/page, $3.00/document cap; **no charge if quarterly usage ≤ $30** (rising to $0.12/page and a $40 waiver threshold Jan 1, 2027). Judicial opinions free; courts can grant fee exemptions on motion.
- Only narrow official API: the **PACER Case Locator (PCL) API** (JSON nationwide case/party search; token via the PACER Authentication API). **No official API for docket sheets/documents** — practical path is RECAP archive first, then the RECAP Fetch API; Free Law Project's open-source **Juriscraper** library scrapes CM/ECF directly.
- https://pacer.uscourts.gov/pacer-pricing-how-fees-work

### 1.4 Caselaw Access Project — transitioned, don't build against it

Harvard's 6.9M-case corpus was integrated into CourtListener (March 2024); CAP's own search and API **shut down September 2024**. case.law still hosts static bulk downloads. Use CourtListener instead. https://case.law/

### 1.5 Statutes & regulations (all free, government-run)

| Source | Data | Access | Auth | Notes |
|---|---|---|---|---|
| **eCFR API** (ecfr.gov/developers) | Current + point-in-time CFR, full XML, change history | REST, **no key** | None | Easiest regulatory API; set a sane User-Agent (aggressive bot blocking) |
| **govinfo API** (api.govinfo.gov) | US Code, CFR, Federal Register, bills, USCOURTS free opinions | REST + bulk | Free api.data.gov key | ~1,000 req/hr; **GPO also released an official GovInfo MCP server (public preview)** — govinfo.gov/developers |
| **Congress.gov API** (api.congress.gov) | Bills, laws, members, Congressional Record | REST | Free key | 5,000 req/hr |
| **Federal Register API** | Daily FR documents, agencies | REST, no key | None | |
| **Regulations.gov API** | Dockets, public comments, rulemakings | REST | Free key | |
| **OpenStates / Plural** (v3.openstates.org) | State legislators, bills, votes for all 50 states + DC/PR | REST + bulk | Free key (tiered) | Covers *legislation*, not codified state statute full text |
| **Cornell LII** (law.cornell.edu) | US Code, CFR, Wex plain-language legal encyclopedia | Website only, no API | None | Great pro se reference; for machine text use govinfo/OLRC XML |

**Gap:** there is no free unified API for codified **state statutes** full text. Options: link users to Justia/LII per state, or pay for **OpenLaws** (https://openlaws.us/api/ — commercial REST + bulk JSONL, statutes/regs/constitutions across all 53 US jurisdictions, citation-addressable).

Note: the ProPublica Congress API is defunct — use Congress.gov.

### 1.6 Free portals (human-facing, little/no API)

- **Google Scholar case law** — free, but no API and strict anti-bot measures; only viable programmatically via paid SERP scrapers. Use as a user-facing link only.
- **Justia** (law.justia.com) — free case law, US Code, state codes, guides; no official API. Good fallback URLs for state statutes.
- **FindLaw** — Thomson Reuters free portal; reference only.
- **Casetext — dead.** Retired April 1, 2025 after the $650M Thomson Reuters acquisition; tech lives on as CoCounsel inside Westlaw (~$639/user/mo). Do not integrate.
- **vLex Fastcase** — now owned by Clio (~$1B acquisition closed Nov 2025); free access is a bar-membership benefit, generally **not available to pro se** users.

### 1.7 Newer commercial/data options (2024–2026)

- **Descrybe** (descrybe.com) — free-leaning AI legal research with AI-summarized case law; positions itself as a "legal data engine for AI assistants" with MCP-style connectors.
- **UniCourt Enterprise API** — 140M+ state + federal court records, webhooks; contact-sales pricing (overkill for pro se).
- **Trellis** (trellis.law) — state trial-court records + judge analytics (strong CA/TX/IL); priced for firms.

---

## Part 2 — Document Drafting, Automation & Court Forms

### 2.1 docassemble — the A2J-standard guided-interview platform

- MIT-licensed, free; guided interviews → PDF/RTF/DOCX; e-signatures; SMS/email delivery. De facto standard in the access-to-justice community.
- **Full REST API** (docassemble.org/docs/api.html): an agent can headlessly start a session, read the current question, inject answers, and retrieve generated documents — no browser needed. API-key auth.
- **Hosting caveat:** heavy stack (Postgres, Redis, RabbitMQ, NGINX, Celery, LibreOffice in one Docker container); wants 4+ GB RAM. Raspberry Pi is possible but marginal (the [docassemble-rpi](https://github.com/jhpyle/docassemble-rpi) demo required a multi-hour ARM self-build; no official multi-arch image). More realistic: run it on a small x86 VPS with Pi Agent as an API client — or skip the server entirely and use the lightweight libraries in §2.4.

### 2.2 Suffolk LIT Lab — Document Assembly Line ecosystem (MIT, actively developed through 2026)

- **docassemble-AssemblyLine** — runtime + large pre-written question library (full Spanish translations; /s/ digital signatures) for court-form interviews.
- **ALWeaver** — auto-generates a draft docassemble interview from a labeled PDF/DOCX court form.
- **FormFyxer** (`pip install formfyxer`) — Python library for analyzing court-form PDFs: field detection, field-name normalization, LLM-assisted field renaming, readability stats. **Usable directly by a Python agent without docassemble — probably the highest-value LIT Lab piece for Pi Agent.**
- **RateMyPDF** (ratemypdf.com) — scores court-form usability for self-represented litigants.
- **Court Forms Online** (courtformsonline.org) — free hosted interviews (MA + syndicated ME, MN, MI, VT, national); an agent can simply route users to the right interview.
- **Spot API** (spot.suffolklitlab.org) — REST issue-spotter: plain-language problem description → legal issue codes (LIST taxonomy). Free developer accounts for access-to-justice uses. Purpose-built for AI triage.
- **EfileProxyServer + docassemble-EFSPIntegration** — the only open-source e-filing path (Java proxy speaking OASIS LegalXML ECF 4.0 to Tyler Odyssey); high difficulty, per-jurisdiction agreements needed.
- https://assemblyline.suffolklitlab.org/

### 2.3 Other interview platforms

- **A2J Author** (a2jauthor.org) — CALI's guided-interview builder, used in 42+ states; no meaningful public API. Referral destination, not a component.
- **LawHelp Interactive** (lawhelpinteractive.org) — Pro Bono Net's free national document-assembly server (HotDocs + A2J); 5,000+ interviews, 47 states, 5.1M+ documents generated. No public API. Referral destination.
- **Gavel** (ex-Documate) — commercial no-code automation, acquired by Relativity June 2026; ~$83–$417+/mo, API only on top tier. Skip.

### 2.4 Lightweight Python document generation (the natural core for Pi Agent)

| Library | License | Use |
|---|---|---|
| **docxtpl** | LGPL | Jinja2 tags inside a Word template → filled DOCX. Ideal: keep pleading templates (e.g., 28-line California pleading paper) as .docx, render with agent-collected facts |
| **python-docx** | MIT | Build DOCX from scratch |
| **PyPDFForm** | MIT | High-level fill/inspect fillable court PDFs — often easier than pypdf |
| **pypdf** | BSD | AcroForm filling, merge, stamp |
| **pdftk-java / fillpdf** | GPL-2 | CLI FDF form filling and flattening; runs on ARM |
| **WeasyPrint** | BSD | HTML/CSS → PDF (letters, exhibit indexes); runs fine on a Pi |
| **pandoc** (+ **Supra**) | GPL-2 | Markdown → DOCX/PDF with a `reference.docx` for court formatting; Supra is a pandoc wrapper for legal writing with citation support |

All trivially integrable and comfortable on modest hardware.

### 2.5 E-filing reality check

- **Federal:** pro se filers generally must move for permission per case; over two-thirds of district courts allow pro se e-filing at least case-by-case. CM/ECF is browser-only — **no filing API**. SCOTUS pro se filings remain paper-only.
- **State:** broad pro se e-filing in TX (eFileTexas + Guide & File, free), FL (free portal), CA, IL, IN, MD, GA, NV, VA, others. Tyler Odyssey dominates; third-party integration requires becoming a certified EFSP.
- **Realistic agent role:** produce filing-ready PDFs and walk the user through the correct free portal. E-filing integration itself is the hardest, lowest-ROI item.

### 2.6 Citation formatting

- **Indigo Book** — free CC0 implementation of Bluebook-style citation (v2.0); usable as reference text for an LLM to format citations. https://law.resource.org/pub/us/code/blue/IndigoBook.html
- **citeurl** (`pip install citeurl`) — turns citations (cases, statutes, CFR) into hyperlinks to free sources (LII, CourtListener); extensible YAML templates. Handles statute cites, which eyecite does not. Solo-maintainer but alive (last push Jan 2026).

---

## Part 3 — Legal NLP, AI Libraries & MCP Servers

### 3.1 The healthy stack: Free Law Project citation tools (all BSD-2, actively maintained, verified Aug 2026)

| Tool | What it does |
|---|---|
| **eyecite** | Extracts full, short-form, *supra*, *Id.* citations from text; battle-tested on 55M+ citations; `pip install eyecite` (v2.7.8, Jul 2026; Python ≥3.10) |
| **reporters-db** | Every American case-reporter abbreviation (feeds eyecite) |
| **courts-db** | Structured DB of US court names/abbreviations — resolve court strings to canonical IDs |

### 3.2 Legal NLP libraries — mostly abandoned

- **LexNLP** — dormant (last push May 2024), AGPL-3.0 copyleft, painful installs on modern Python. **Skip**; use eyecite + spaCy/regex.
- **Blackstone** — abandoned (model pinned to spaCy 2.1, last real release 2019), UK-focused. **Skip.**
- **LegalBench** (Stanford) — 162-task legal-reasoning benchmark, maintained (Mar 2026). Useful for *choosing* the model behind Pi Agent, not a runtime library.

### 3.3 Legal LLMs & embeddings

- **nlpaueb/legal-bert-base-uncased** — classic legal BERT; dated but still the default for cheap local classification/embeddings.
- **Equall/SaulLM** — open legal-instruction-tuned LLMs (7B/54B/141B); 7B is locally runnable.
- **voyage-law-2** — commercial embedding API leading legal-retrieval benchmarks; cheap per-token, realistic for hobbyist RAG.

### 3.4 Contract analysis

- **CUAD** (Atticus Project) — 510 contracts, 13k+ expert labels, 41 clause types, CC-BY-4.0; plus newer MAUD and ACORD datasets.
- **OpenContracts** — Apache-2.0, actively developed document-intelligence platform (PDF layout parsing, pgvector, LLM extract). Heavyweight (Docker/Django) but the most serious open-source contract-review tool. Useful for lease/settlement-agreement review.

### 3.5 MCP servers (2024–2026)

- **Official CourtListener MCP** — `https://mcp.courtlistener.com/` — the headline (see §1.1).
- **Official GPO GovInfo MCP server** (public preview) — US Code, CFR, Federal Register, bills. govinfo.gov/developers
- Community servers (thin API wrappers, small/solo-maintainer — usable as reference implementations): DefendTheDisabled/courtlistener-mcp (explicitly built for a pro se use case, includes citation verification), Travis-Prall/court-listener-mcp (adds eCFR), Travis-Prall/govinfo-mcp, cyanheads/courtlistener-mcp-server, bsmi021/mcp-congress_gov_server, agentic-ops/legal-mcp (precedent retrieval + citation validation + brief scaffolding).
- **No direct PACER MCP exists** — everything correctly routes through RECAP/CourtListener.
- Curated index: https://github.com/Vaquill-AI/awesome-legaltech

### 3.6 Legal RAG

No dominant open-source project (lawglance is the largest community; LRAGE is a 2025 evaluation framework). **Practical take:** don't vectorize all of case law yourself — use CourtListener's hosted semantic search, and reserve local RAG (Chroma/pgvector + voyage-law-2 or legal-BERT) for the *user's own case documents*.

### 3.7 Hallucination risk — the critical numbers

- **Dahl et al., "Large Legal Fictions" (J. Legal Analysis 2024):** general LLMs hallucinated on **58% (GPT-4) to 88% (Llama 2)** of verifiable legal questions; worst for lower courts — exactly where pro se litigants operate; models often accept users' false legal premises.
- **Stanford RegLab "Hallucination-Free?" study:** even commercial RAG tools hallucinate — Lexis+ AI ~17%, Westlaw AI-Assisted Research ~33%. RAG reduces but does not eliminate the problem.
- **Mandatory pipeline for Pi Agent:** draft → eyecite extract → CourtListener Citation Lookup verify → fetch and quote-check the actual opinion text → only then show the user.

### 3.8 Commercial AI legal products — not realistic for individuals

Harvey (~20-seat minimum, ~$1,200/seat/mo, enterprise-gated API), CoCounsel (~$225+/seat/mo, no public API), Spellbook (no self-serve API). Feasible hobbyist stack instead: Claude/GPT APIs + CourtListener MCP + GovInfo MCP + eyecite/citation-lookup + docassemble or docxtpl.

---

## Part 4 — Practical Pro Se Tools & Guardrails

### 4.1 Deadline math

- **No open-source FRCP 6 library exists.** FRCP 6(a) counting is simple and stable — implement it directly; always show the counting steps and cite the rule.
- Python building blocks: **`holidays`** (US federal + state holidays), **workalendar**, **python-bizdays**, NumPy `busday_offset`.
- State-rule deadline *content* is the moat commercial engines sell (**CalendarRules** — owned by Clio, API, contact pricing; **DocketCalendar**; **CourtDrive**). Treat state deadlines as content requiring per-jurisdiction verification, not computation.
- Free web calculators to surface to users: courtdeadlinecalculator.org, deadlinecalculator.org, juristalegal.com/calculators/deadline-calculator.

### 4.2 Triage, self-help & referral rails

- **Suffolk Spot API** — plain-language problem → legal issue codes (LIST taxonomy). The purpose-built AI-triage entry point.
- **LSC Find Legal Aid** (lsc.gov/what-legal-aid/find-legal-aid) — ZIP lookup across 129 funded legal aid orgs nationwide.
- **LawHelp.org** (Pro Bono Net; rebranding as "Scale Justice" per March 2026 announcement) — national legal-help finder, 20 statewide portals; **LiveHelp** chat on state sites is a good human-handoff endpoint.
- **ABA Free Legal Answers** (freelegalanswers.org) — the only national pro bono advice portal; income-eligible users (<250% FPL) get civil questions answered by volunteer attorneys. Separate federal-law site.
- **Illinois Legal Aid Online (ILAO)** — gold standard for structured content; documented **JSON:API Content API** (OAuth, access by request). ILAO also runs a RAG assistant grounded *solely* in its verified content — the emerging safe architectural pattern for legal-aid AI.
- **NCSC state self-help directory** — ncsc.org/topics/access-and-fairness/self-representation/state-links.aspx
- **StatesideLegal.org** — military/veteran legal help + triage navigator.

### 4.3 State court records lookup

| Tool | Cost | Verdict for pro se |
|---|---|---|
| **judyrecords** | **Free**; 770M+ cases; API by contact (api@judyrecords.com) | Best free first stop for state records |
| **CourtListener/RECAP** | Free | Excellent for federal; state appellate opinions only |
| **Docket Alarm** | $39.99/mo + $4/doc | Reasonable for one active case |
| **UniCourt** | $59/mo personal; API enterprise-only | Marginal; free CrowdSourced Library useful |
| **Trellis** | $69.95+/mo | Priced for firms; skip |

### 4.4 Statute-of-limitations references

Nolo 50-state chart, CaseFleet lookup, Matthiesen Wickert & Lehrer 50-state surveys, FindLaw state pages. All self-describe as general guides — the agent should cite the underlying statute and flag tolling/discovery-rule/notice-of-claim exceptions rather than presenting chart numbers as answers.

### 4.5 UPL & AI regulatory guardrails (2024–2026)

- **Core line:** legal *information* (general explanations) is protected and not UPL; legal *advice* (applying law to a specific person's facts) is the regulated activity.
- **NCSC white paper (Aug 2025)** recommends UPL modernization for AI tools; **Utah's regulatory sandbox** (sunsets Aug 2027) and **Arizona ABS** (~136 providers; first AI-native firm approved July 2025) show the reform direction.
- **Court rules that directly hit pro se litigants:**
  - Florida 11th (Miami-Dade) & 17th (Broward) Circuits: attorneys *and self-represented litigants* must disclose generative-AI use on the face of filings and certify accuracy; sanctions include striking pleadings.
  - New York Part 161 (statewide, effective June 1, 2026): AI use permitted, disclosure not mandated, but filers must certify no fabricated cases/statutes — and AI cannot be used to do the verifying.
  - Hundreds of individual federal/state judges have standing orders; trackers: Law360 Pulse AI tracker, trace.law/kb/court-ai-disclosure-orders.
- **FTC / DoNotPay (Jan 2025 final order):** $193,000 relief and a ban on claiming its AI matches a human lawyer absent evidence. Lesson: capability claims are an FTC deception target independent of UPL. Never market/frame Pi Agent as lawyer-equivalent.
- Notable 2026 development: US courts have found privilege can apply to pro se litigants' use of public AI tools.
- **Ecosystem signal:** by early 2026 roughly 18% of federal complaint filings contain AI-classified text; documented pro se wins in eviction/debt cases coexist with sanctions for unverified fabricated citations — **human verification is the differentiator**.

### 4.6 Existing pro se products (lessons)

- **Courtroom5** (~$75/mo/case) — survived by positioning as education/self-help coaching, not representation.
- **Hello Divorce** ($400 DIY–$4,000) — flat-fee + licensed-professional escalation is a durable model.
- **DoNotPay** — the cautionary tale (see FTC order above).

---

## Part 5 — Beyond Court Cases: Consumer, Administrative & Everyday Legal Help

Most legal problems a pro se person faces never become a lawsuit — they're disputes with companies, government agencies, landlords, and employers, or paperwork like wills and name changes. Feasibility legend: **High** = documented public API/structured data; **Medium** = scrapable/gated/reusable open-source code; **Low** = web portal only (the agent's role is drafting the content, tracking the deadline, and walking the user through the portal).

### 5.1 Consumer protection & disputes

- **CFPB Consumer Complaint Database API** — fully public, free, **no key required**; REST/JSON, updated ~daily. Perfect for "has this company been complained about, and what outcomes occurred" context before filing. **High.** https://cfpb.github.io/api/ccdb/api.html · https://cfpb.github.io/ccdb5-api/
- **CFPB complaint *submission*** — web portal only (consumerfinance.gov/complaint), no API; companies must respond (typically 15 days). Agent drafts the narrative; user files. **Low.**
- **CFPB template letters — high value, trivial integration:**
  - **FCRA credit-report disputes** (letters to bureau and furnisher; 30-day investigation duty): https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/sample-letters-dispute-credit-report-information/
  - **FDCPA debt-collection letters** (5 scenarios: request validation, "not my debt," contact preferences, talk to my lawyer, stop contact; validation rules at Reg F § 1006.34): https://www.consumerfinance.gov/consumer-tools/debt-collection/
  - These are public-domain text an agent can populate; pair with a mailing-service API (e.g., Lob) for certified mail.
- **AnnualCreditReport.com** — free reports from all 3 bureaus, now weekly (permanently). Identity-verified web flow, no API. **Low.**
- **FTC ReportFraud + IdentityTheft.gov** — free; IdentityTheft.gov generates a personalized recovery plan and pre-fills FTC Identity Theft Reports and credit-bureau letters. No API but very high value to surface. **Low.**
- **State attorney general complaints** — all 50 states have free portals, no APIs. Maintain a URL routing map from PIRG's 50-state guide (pirg.org) / USA.gov state-consumer directory; agent drafts the complaint text. **Low.**

### 5.2 Public records (FOIA & state)

- **MuckRock API v2** — **the only true "file something programmatically" public-records integration**: authenticated POST files a FOIA/state request (~$5/request credits), plus tracking. Official Python client: `python-muckrock`. **High.** https://www.muckrock.com/api/
- **FOIA.gov developer API** — agency metadata, contacts, and processing statistics (api.data.gov key) — use it to route users to the right agency with expected wait times. **No consumer submission API** (the web wizard only). **High for metadata, Low for filing.** https://www.foia.gov/developer/
- State/local records mostly run on vendor portals (Granicus GovQA, CivicPlus NextRequest) with no consumer APIs — MuckRock is the cleaner path there too. (FOIA Machine is defunct, absorbed into MuckRock.)

### 5.3 Government benefits & agencies

- **USCIS Developer Portal ("Torch")** — real OAuth 2.0 APIs with self-service sandbox: **Case Status API** (receipt number → status/history, ~1,000 req/day) and **FOIA Request & Status API** (programmatically request A-File records). Production requires approval. **High/Medium.** https://developer.uscis.gov/
- **VA Lighthouse APIs** (developer.va.gov) — the standout federal API program: **VA Forms API** and **Facilities API** are open/low-friction; Benefits Claims/Intake and Appeals Status APIs exist but production access is aimed at accredited orgs. **High for forms/facilities, Medium for claims.**
- **SSA** — online disability applications and iAppeals (60-day appeal deadline), Login.gov-gated, no API. Agent value: prepping SSA-3441 disability-report content and deadline tracking. **Low.**
- **IRS** — **Direct File is dead** (ended before the 2026 filing season); Free File continues (AGI ≤ ~$89k). Transcript APIs are practitioner-only (Form 8821/2848). Taxpayer Advocate Service (Form 911) for stuck cases. **Low.**
- **Benefit finders** — **Benefits.gov is defunct** (retired Sept 2024 → USA.gov Benefit Finder, no API). **NYC Benefits Screening API** is a real, documented public eligibility-screening API (NYC-scoped) and an excellent model: https://screeningapidocs.cityofnewyork.us/. mRelief (SNAP screener, SMS "FOOD" to 74544) and GetCalFresh are free assisters without public APIs.
- **Unemployment** — state-by-state portals, no APIs; agent value is appeal deadlines and drafting appeal statements. **Low.**
- **Student loans** — borrower defense to repayment and the FSA Ombudsman via StudentAid.gov; no APIs; slow. **Low.**

### 5.4 Housing outside court

- **JustFix** (formerly JustFix.nyc) — free tenant tools, **all open source**: Letter of Complaint / LA Letter Builder (repairs letters sent free via certified mail; `tenants2` repo), **Who Owns What** landlord-portfolio mapping built on **nycdb** (open PostgreSQL loader for NYC housing data). Best-in-class but NYC/LA-scoped. **High (code/data), geographically limited.** https://github.com/JustFixNYC
- **HUD fair-housing complaints** — free online Form 903 filing (1-year deadline), no API. **Low.**
- **Security-deposit demand letters** — no national API; generate from templates (docassemble or docxtpl) per state statute.

### 5.5 Employment

- **EEOC Public Portal** (publicportal.eeoc.gov) — free inquiry → interview → charge filing; **180/300-day deadlines** are the agent's leverage point. No API. **Low.**
- **DOL Wage & Hour Division** — online complaint intake, plus the **Workers Owed Wages** search (is DOL holding back wages for you). **Low/Medium.**
- **NLRB** e-filing and state labor-board wage claims (e.g., California DLSE) — free portals, no APIs. **Low.**

### 5.6 Records relief (expungement / sealing)

- **Code for America Clear My Record** — pivoted to *automatic* record clearance with states (CA ~144k convictions; Utah 500k people; multiple Clean Slate states); open-source eligibility-analysis code, no longer a consumer filing tool. **Medium (code reuse).**
- **Expungement Generator / RecordLib (PA)** — open source: parses PA docket PDFs, determines eligibility, generates petitions; pairs with the free **MyCleanSlatePA** screener. **High for Pennsylvania.** https://github.com/NateV/Expungement-Generator
- **Rasa Legal** — commercial expungement (UT/AZ/PA, ~$25 eligibility check, ~$250–500 full service; raised $5M in March 2026 to expand). No API. **Low/Medium.**
- Several states (e.g., Michigan since 2023) now expunge automatically with no application — the agent's job is telling the user whether their state does.

### 5.7 Life & estate documents

- **FreeWill** (freewill.com) — genuinely free attorney-reviewed will, financial POA, advance directive, all 50 states (charity-funded). No API; surface + guide. **Low.**
- **DoYourOwnWill.com** — free static templates (wills, living wills, POA) easy to mirror into a doc-assembly pipeline. **Low/Medium.**
- **Advance directives** — PREPARE for Your Care (UCSF, free, multilingual state forms), CaringInfo and AARP state PDFs — structured enough for programmatic fill with pypdf/PyPDFForm. **Medium.**
- **Name change** — **Namesake** (namesake.fyi) — free, open-source (MIT) guided name-change workflows; content/code reusable. (NameChangr Utah is defunct.) **Medium-High.**
- Cross-cutting: **docassemble + Suffolk Assembly Line** (Part 2) is the universal engine here — letters, POAs, name-change and expungement petitions can all run as guided interviews driven headlessly via its JSON API.

### 5.8 Small claims, pre-litigation & notarization

- **Demand letters** — People Clerk and JusticeDirect offer free generators (CA-centric); templates easily replicated in docxtpl/docassemble. **Medium.**
- **Court ODR (online dispute resolution)** — Matterhorn (150+ courts in 22 states) and Tyler Modria (statewide programs in UT, MI, OH, IN, NJ, DE, NM) let users resolve small-claims/family/traffic matters without hearings. No APIs — agent value is detecting whether the user's court offers ODR and linking in. **Low.**
- **Remote online notarization (RON)** — legal in nearly all states. **Proof (formerly Notarize)** has a real commercial API (consumer ~$25/notarization; partner ~$10/seal); BlueNotary/OneNotary similar. **High (commercial).** https://dev.proof.com

### 5.9 Business & personal administrative

- **LLC formation** — every Secretary of State has an online portal ($35–$500 fees), no filing APIs. For *reading* entity data: **OpenCorporates API** (free keys for open/nonprofit projects) plus a few state entity-search APIs (e.g., Colorado). **Medium (read), Low (filing).**
- **DMV / administrative hearings** — portal/mail only; the agent's leverage is the short deadlines (often 7–15 days to request a hearing).

### 5.10 Defunct or changed (verified 2026)

Benefits.gov (retired Sept 2024 → USA.gov Benefit Finder) · IRS Direct File (ended before the 2026 filing season) · NameChangr Utah (shut down) · FOIA Machine (absorbed into MuckRock) · CFPB complaint submission has never had a public API (the database API is read-only) · IRS transcript APIs are practitioner-only.

---

## Recommended Integration Roadmap for Pi Agent

### Tier 1 — integrate now (free, low effort, high value)
1. **CourtListener official MCP server** (or REST v4 with token) — case law, semantic search, federal dockets, alerts.
2. **eyecite + reporters-db + courts-db** (pip) — local citation parsing.
3. **CourtListener Citation Lookup API** — hard-wired, mandatory verification of every citation in every draft before it reaches the user.
4. **eCFR API** (no key) + **govinfo** + **Congress.gov** + **Federal Register** APIs (free keys) — federal statutes/regulations. Consider the official GovInfo MCP server.
5. **docxtpl + PyPDFForm/pypdf** — pleading templates and fillable court-PDF completion. Runs on anything.
6. **citeurl** — hyperlink citations to free sources in generated documents.
7. **Referral rails:** LSC Find Legal Aid + LawHelp.org + ABA Free Legal Answers links by ZIP/income; NCSC self-help directory.
8. **FRCP 6(a) date math** implemented directly with the `holidays` package; show counting steps and cite the rule.
9. **CFPB Consumer Complaint Database API** (keyless JSON) — company complaint history before the user files anywhere.
10. **CFPB public-domain template letters** — credit-report disputes, debt-validation and stop-contact letters, identity-theft recovery — populated via docxtpl and mailed certified.
11. **Deadline & portal routing map for non-court matters** — EEOC 180/300 days, HUD 1 year, SSA appeals 60 days, DMV hearings 7–15 days, state AG/CFPB/FTC portal URLs by state.

### Tier 2 — worth the setup effort
12. **Suffolk Spot API** — plain-language issue triage at intake (free A2J developer account).
13. **FormFyxer** — understand/normalize arbitrary court-form PDFs.
14. **OpenStates API** — state legislation tracking.
15. **judyrecords** — free state court records search (API by contact).
16. **RECAP Fetch API + @recap.email + docket-alert webhooks** — if the user has an active federal case (keep PACER under $30/quarter → effectively free).
17. **ILAO Content API** — structured plain-language guidance (access by request); model the closed-corpus RAG pattern.
18. **Local RAG over the user's own case documents** (Chroma/pgvector + voyage-law-2 or legal-BERT embeddings).
19. **MuckRock API + python-muckrock** — file and track FOIA/state public-records requests programmatically (~$5/request); FOIA.gov agency-component API for routing/wait times.
20. **USCIS Torch APIs** (Case Status, FOIA) — if immigration matters are in scope; self-service sandbox.
21. **VA Forms + Facilities APIs** — if serving veterans; open access.

### Tier 3 — only if needed
22. **docassemble server + AssemblyLine** — full guided-interview form generation; wants a 4+ GB x86 host, drive it headlessly via its REST API. Also the engine for non-court documents (POAs, name-change and expungement petitions, demand letters).
23. **OpenLaws API** (paid) — the only unified state-statute API, if state-statute text becomes a recurring need.
24. **Docket Alarm** ($39.99/mo + per-doc) — if state-docket monitoring for an active case is needed.
25. **Proof/Notarize RON API** (commercial, ~$10–25/seal) — when a notarized document is the end product.
26. **JustFix repos + nycdb / NYC Benefits Screening API** — best-in-class open-source tenant and benefits tooling if the user is in NYC/LA.

### Don't build against
Old CAP API (dead) · Casetext (dead) · Google Scholar scraping (blocked) · ProPublica Congress API (defunct) · LexNLP/Blackstone (dormant/abandoned) · Harvey/CoCounsel/Spellbook APIs (enterprise-gated) · e-filing APIs (browser-only federally; state EFSP certification impractical — generate filing-ready PDFs and point to the free portal instead) · Benefits.gov and IRS Direct File (both retired) · CFPB complaint submission API (doesn't exist — read-only database only) · IRS transcript APIs (practitioner-only).

### Non-negotiable guardrails to build in
- Every citation in every output verified via eyecite → Citation Lookup → quote-check against the actual opinion text.
- Output framed as legal information, not advice; prominent "not a lawyer" framing; no lawyer-equivalence claims (FTC precedent).
- Before helping draft a filing, check the forum's AI standing order/disclosure rule (FL circuits, NY Part 161, individual judges' orders).
- Always offer the human escalation path (legal aid finder, ABA Free Legal Answers, court self-help center).
