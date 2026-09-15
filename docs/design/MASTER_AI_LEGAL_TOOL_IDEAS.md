# Master List of AI Legal Tool Ideas

Consolidated from the project-authored research reports, plans, workflows, prompts, and design documents in this repository. The list merges duplicates while preserving meaningfully different product variants.

**Catalog size:** 121 user-facing tool ideas plus 17 shared platform/safety capabilities, for 138 tracked concepts total.

The preferred subset selected for further development is expanded in [Selected AI Legal Tools: Expanded Product Report](../reports/SELECTED_AI_LEGAL_TOOLS_REPORT.md).

## Executive view

The documents describe a product larger than a legal chatbot: a **verified matter operating system** that acquires authoritative sources, structures a case, supports research and drafting, verifies every material claim and authority, and preserves an auditable human-review trail.

The strongest recurring opportunities are:

1. Citation, quotation, and proposition verification.
2. Matter-scoped research and chat grounded in saved sources.
3. Deadline and limitations calculation using deterministic rules.
4. Medical chronology, missing-record detection, damages, liens, and deposition analysis for personal-injury work.
5. Court-form completion and filing-ready document generation for self-represented litigants.
6. Adversarial review: opposing-brief analysis, defense-risk analysis, and hearing simulation.
7. Plain-language intake, explanation, and referral to appropriate human or self-help services.
8. Reproducible research sessions with immutable sources, provenance, and final review gates.

## Status legend

- **Existing** — described as implemented in the historical workspace documentation.
- **Specified** — has a dedicated plan, workflow, prompt, or detailed architecture.
- **Proposed** — presented as a build opportunity or product concept.
- **Integration** — primarily connects or routes to an outside authoritative service.

These statuses report what the documents say; they are not a fresh code audit.

## 1. Legal research and authority discovery

| ID | Tool idea | Core outcome | Status | Sources |
|---|---|---|---|---|
| R01 | Legal issue spotter and intake triage | Convert a plain-language problem into legal issues, jurisdiction questions, and an initial research plan. | Integration / Proposed | S1, S4 |
| R02 | Multi-source case-law search | Search CourtListener, Google Scholar, official court sites, and licensed sources with court, date, status, and jurisdiction filters. | Existing | S2, S7, S8, S10 |
| R03 | Semantic precedent search | Find conceptually relevant cases even when they do not use the query's exact vocabulary. | Integration / Proposed | S1, S4, S5 |
| R04 | Query planner / deep-research orchestrator | Decompose an issue into query families, run parallel searches, deduplicate results, rank authority, and synthesize a memo. | Specified | S2, S5, S7 |
| R05 | Source-native opinion downloader | Resolve discoveries to CourtListener or official sources and save complete, attributable case artifacts. | Existing / Specified | S7, S8, S10 |
| R06 | Exact-case identity resolver | Match case name, docket, citation, court, date, cluster, and opinion IDs; route ambiguities to human review. | Existing / Specified | S7, S8, S9 |
| R07 | Cited-by collector and citation-graph explorer | Retrieve later citing opinions and traverse precedent chains in either direction. | Existing / Specified | S2, S4, S8, S9 |
| R08 | Similar-case finder | Rank neighboring cases by shared citations, embeddings, facts, or doctrinal overlap. | Proposed | S2, S3 |
| R09 | Conflict and split finder | Detect conflicting holdings, jurisdictional splits, and inconsistent lines of authority. | Proposed | S2, S3, S5 |
| R10 | Authority-map builder | Group authorities by proposition, jurisdiction, precedential weight, treatment, and date. | Proposed | S5, S7 |
| R11 | Doctrine reading-path generator | Order cases from foundational authority through later refinements and exceptions. | Proposed | S3 |
| R12 | Case briefer | Produce a structured facts–issue–holding–reasoning–rule brief for one case or an entire corpus. | Specified / Proposed | S2, S3, S6, S11 |
| R13 | Source-audited multi-model summarizer | Generate independent summaries, audit them against the opinion, and issue a corrected consensus summary. | Specified | S6, S11 |
| R14 | Case/corpus chat | Answer the same question separately against one or many cases, with quotations, locations, abstention, and optional synthesis. | Specified | S2, S10 |
| R15 | Quote bank | Extract useful rule statements and holdings by topic with exact pinpoints. | Proposed | S3 |
| R16 | Procedural-history timeline | Extract docket events, appeals, rehearing, remand, disposition, and key dates into a chronological artifact. | Specified / Proposed | S2, S7, S9 |
| R17 | Docket and PACER/RECAP retrieval | Find federal filings, retrieve available documents, and preserve docket provenance. | Integration / Proposed | S1, S4, S5 |
| R18 | Docket watch and authority alerts | Notify users about new filings, oral arguments, decisions, or new treatment of cited authority. | Proposed | S1, S2, S4 |
| R19 | Judge and court profiler | Summarize a judge's rulings, tendencies, procedures, and relevant history without overstating predictive value. | Proposed | S2, S4 |
| R20 | Statute, regulation, and court-rule lookup | Fetch and cache federal/state statutes, regulations, rules, bills, and official guidance. | Integration / Proposed | S1, S2, S4, S6 |
| R21 | Point-in-time law checker | Compare the law on the event date with current law, including amendments, effective dates, repeal, retroactivity, and superseding rules. | Specified / Proposed | S1, S2, S3, S9 |
| R22 | Local-rules and filing-requirements collector | Turn unstructured court rules into usable formatting, filing, hearing, and deadline requirements. | Proposed | S4, S6 |
| R23 | Medical/scientific literature researcher | Search PubMed/PMC and scholarly sources for causation, prognosis, epidemiology, and expert-related literature tied to case issues. | Specified / Proposed | S5 |
| R24 | Legal ontology and taxonomy service | Normalize legal concepts, areas of law, courts, document types, and issue codes for structured research. | Integration / Proposed | S1, S4 |
| R25 | Reusable authority library | Preserve resolved, verified authorities and proposition notes for reuse across research runs. | Specified | S5, S7 |
| R26 | Research memo / session digest | Turn searches, authorities, chat insights, citator results, limitations, and source coverage into a reproducible memo. | Proposed | S3, S5, S7 |
| R27 | Research-scope and issue-tree builder | Frame the assignment by forum, governing law, elements, posture, facts, dates, adverse theories, vocabulary, and answerable sub-issues. | Specified | S7 |
| R28 | Authority and precedential-status classifier | Separately classify court hierarchy, binding status, publication status, opinion role, posture, and citability instead of hiding them in one relevance score. | Specified | S7, S9 |
| R29 | Research completeness and stopping assistant | Track searched, found, unread, reviewed, rejected, unavailable, and externally validated states; record convergence, gaps, and who decided to stop. | Specified | S2, S7, S8 |
| R30 | Cross-source coverage and gap reconciler | Compare official sites, CourtListener, Scholar, mirrors, and citators; identify missing or conflicting records without claiming universal completeness. | Specified | S5, S7, S8, S9 |
| R31 | Citation-network and treatment visualizer | Present authority nodes, direct-history/treatment edges, court weight, and time-based treatment lanes with links to evidence passages. | Proposed | S4, S9 |

## 2. Citation, fact, and document verification

| ID | Tool idea | Core outcome | Status | Sources |
|---|---|---|---|---|
| V01 | Citation inventory and parser | Extract, normalize, classify, and count every case, statute, regulation, rule, and short-form citation in a document. | Specified | S1, S2, S5 |
| V02 | Citation existence verifier | Confirm that every cited authority resolves to a real, uniquely identified source; fail closed on fabricated or ambiguous citations. | Specified | S1, S2, S4, S5 |
| V03 | Parallel-citation and stable-link resolver | Resolve a case to all reporter variants, canonical IDs, and stable free-source URLs. | Proposed | S2, S3 |
| V04 | Citation-treatment / good-law analyzer | Collect direct history and later citing decisions, classify treatment, and show the evidence behind a cautious status signal. | Specified | S2, S5, S6, S9, S10 |
| V05 | Licensed-citator adapter | Provide a neutral interface to Shepard's, KeyCite, vLex Cert, BCite, or another authorized treatment provider. | Proposed | S5 |
| V06 | Proposition-level authority checker | Decide whether an authority still supports the exact sentence for which it is cited, not merely whether the case has a signal. | Specified | S2, S5, S9 |
| V07 | Quote and pincite verifier | Align every quotation word-for-word to authoritative source text and verify the stated location and speaker. | Specified | S2, S5, S6, S10 |
| V08 | Brief quote-and-cite verifier | Audit a user's filing for citation existence, quote accuracy, proposition support, and misleading characterization. | Specified | S6, S10 |
| V09 | Claim-to-evidence fact checker | Map material factual claims to record passages; label supported, contradicted, inference, or unverified. | Specified | S2, S5, S10 |
| V10 | Opponent citation analyzer | Extract the other side's citations and flag where its description diverges from the cited opinion. | Specified / Proposed | S6 |
| V11 | Argument support scorer | Score each argument against supporting, contrary, recent, and controlling authority in the corpus. | Proposed | S3 |
| V12 | Bluebook/citation-style linter | Check citation form, short forms, italics, pincites, parallel citations, and `id.` usage. | Proposed | S1, S2, S3 |
| V13 | Table of authorities generator | Build a TOA and validate that cited authorities appear at the correct pages. | Proposed | S6 |
| V14 | Filing-format and rule checker | Check caption, margins, line numbering, page limits, signatures, proof of service, exhibits, and local requirements. | Proposed | S4, S6 |
| V15 | Multi-LLM document review panel | Run blind independent reviews for reasoning, missing elements, structure, clarity, and tone, then surface consensus and disagreement. | Specified | S10, S11 |
| V16 | Adversarial final-document verifier | Seek contrary evidence, omitted adverse authority, causation gaps, inconsistent facts, and unsupported leaps before filing. | Specified | S5 |
| V17 | Consolidated authority-review dashboard | Collapse all authority checks into critical, review, and verified queues with coverage metrics and timestamps. | Specified | S2, S5 |
| V18 | Shepard/citator diff and watch | Re-run treatment research later and alert on new citing cases, changed signals, or stale verification. | Proposed | S3, S5 |
| V19 | Verification evaluation harness | Test known valid, invalid, ambiguous, misquoted, superseded, and time-sensitive authorities before model or prompt releases. | Proposed | S2, S5 |
| V20 | Licensed-citator handoff and result recorder | Export canonical authorities and a checking checklist to an authorized citator workflow, then record provider, time, proposition, result, and reviewer notes. | Specified | S5, S7, S9 |

## 3. Drafting, forms, filing, and advocacy

| ID | Tool idea | Core outcome | Status | Sources |
|---|---|---|---|---|
| D01 | Court-ready document drafter | Generate motions, pleadings, briefs, declarations, demand letters, and small-claims documents from verified matter data. | Proposed | S1, S2, S4, S5 |
| D02 | Jurisdiction-aware template engine | Select state, court, case-type, and local-rule templates before drafting. | Proposed | S1, S4, S6 |
| D03 | Guided legal interview | Ask adaptive questions and assemble a form or document using docassemble/AssemblyLine-style workflows. | Integration / Proposed | S1 |
| D04 | Arbitrary court-form analyzer | Detect PDF fields, normalize field names, assess usability, and map answers into unfamiliar official forms. | Integration / Proposed | S1 |
| D05 | Pro se form auto-fill | Complete official court PDFs from structured intake while preserving the original form and showing unanswered fields. | Proposed | S1, S4 |
| D06 | Pleading-paper formatter | Produce compliant fonts, spacing, margins, captions, line numbering, and pagination. | Proposed | S4, S6 |
| D07 | DOCX/PDF renderer and exporter | Render source-grounded drafts and completed forms into editable DOCX and filing-ready PDF. | Integration / Proposed | S1, S4 |
| D08 | E-filing navigator | Identify the correct court portal, eligibility, fees, service steps, and filing instructions, then walk the user through them. | Proposed | S1 |
| D09 | E-filing integration | Submit through a certified electronic-filing service provider where a jurisdiction and agreement permit it. | Integration / Long-term | S1 |
| D10 | Opposing-brief generator | Write the strongest opposing position from the user's own corpus to expose weaknesses before filing. | Proposed | S3 |
| D11 | Defense-risk analyzer | Identify the strongest defense facts, authority, evidentiary weaknesses, preexisting conditions, and causation challenges. | Proposed | S5 |
| D12 | Hearing / oral-argument simulator | Have judge and opposing-counsel personas question the user using the matter's authorities and facts. | Proposed | S3, S4 |
| D13 | Demand-package builder | Assemble liability, chronology, damages, exhibits, and verified supporting claims into a demand package. | Proposed | S5 |
| D14 | Discovery drafting and response manager | Draft interrogatories, requests for production/admission, organize responses, and detect deficiencies. | Proposed | S4, S5 |
| D15 | Contract review and obligation comparison | Extract clauses, flag risks, compare versions, and track duties in leases, settlements, NDAs, and other agreements. | Integration / Proposed | S1, S2, S4 |
| D16 | Redaction and privilege-log tool | Detect PII/sensitive data, propose redactions, classify potentially privileged material, and create a reviewable privilege log. | Proposed | S2, S4, S5 |
| D17 | Plain-language legal translator | Explain opinions, court orders, notices, and drafted documents at a selected reading level while linking to the source. | Proposed | S3, S4 |
| D18 | Client-status update drafter | Turn structured case events into plain-English updates requiring staff/lawyer approval before sending. | Proposed | S5 |
| D19 | Case strategy mapper | Structure matter facts into issues, elements, claims, defenses, remedies, evidence needs, and unresolved legal questions. | Proposed | S4, S5, S7 |
| D20 | Practice-area workflow packs | Provide reusable, jurisdiction-aware workflows for litigation, family, housing, employment, privacy, IP, contracts, regulatory work, and other specialties. | Integration / Proposed | S4 |

## 4. Matter, evidence, and practice operations

| ID | Tool idea | Core outcome | Status | Sources |
|---|---|---|---|---|
| M01 | Matter workspace / case organizer | Maintain one versioned home for parties, venue, evidence, work product, deadlines, offers, liens, drafts, and reports. | Specified | S4, S5 |
| M02 | Evidence ingestion and OCR | Parse native PDFs, OCR scans when needed, retain page geometry, and link extracted facts back to exact source locations. | Specified | S5 |
| M03 | Evidence/OSINT organizer | Collect, classify, deduplicate, and connect documentary and public-source evidence without mixing it with advocacy. | Proposed | S4, S5 |
| M04 | Claim-evidence ledger | Store every material claim beside its source IDs, passages, review status, and later use in drafts. | Specified | S5 |
| M05 | General case timeline | Merge events from pleadings, correspondence, dockets, records, and testimony into a source-linked chronology. | Proposed | S2, S5 |
| M06 | Medical chronology agent | Produce date-ordered treatment, complaints, diagnoses, imaging, procedures, and provider events with page links. | Proposed / Priority | S5 |
| M07 | Medical inconsistency and causation agent | Surface conflicting histories, preexisting complaints, treatment gaps, and cautious causation language. | Proposed | S5 |
| M08 | Missing-record detector | Identify expected but absent records, bills, imaging, referrals, and reports without treating absence as proof. | Proposed / Priority | S5 |
| M09 | Damages ledger | Reconcile bills, payments, write-offs, balances, lost wages, future costs, and duplicates with deterministic arithmetic. | Proposed / Priority | S5 |
| M10 | Lien and subrogation tracker | Track claimants, asserted amounts, correspondence, negotiation status, and deadlines. | Proposed | S5 |
| M11 | Deposition preparation agent | Build witness outlines, exhibit maps, contradiction matrices, and admissions sought with source links. | Proposed | S5 |
| M12 | Trial-preparation agent | Build exhibit and witness issue indexes, impeachment material, and a source-grounded trial chronology. | Proposed | S5 |
| M13 | Deadline and statute-of-limitations engine | Calculate rule-based deadlines, counting steps, weekends/holidays, service extensions, and source rules. | Specified / Priority | S1, S3, S4, S5, S6 |
| M14 | Case-audit / stagnation monitor | Flag dormant records requests, upcoming deadlines, missing evidence, and unresolved verification issues. | Proposed | S5 |
| M15 | Task and workflow queue | Turn research, drafting, discovery, and verification states into assignments and review queues. | Proposed | S2, S4, S5 |
| M16 | Matter-scoped memory and chat | Preserve structured matter state outside chat history and retrieve only authorized context for each conversation. | Specified | S5 |
| M17 | Portfolio intelligence agent | Report authorized cross-matter bottlenecks, stages, overdue work, deadline risk, and aggregate trends. | Proposed / Long-term | S5 |
| M18 | Practice-profile assistant | Interview a user once for stable preferences, jurisdictions, templates, and working style. | Integration / Proposed | S4 |
| M19 | Practice-system connectors | Connect matter tools to systems such as Clio, iManage, DocuSign, Everlaw, Slack, and Drive. | Integration | S4, S5 |
| M20 | Session exporter / portable dossier | Bundle cases, reports, chats, manifests, and hashes into a handoff-ready archive. | Proposed | S3, S5 |
| M21 | Session-to-session comparator | Compare research runs for overlap, divergence, new authority, and which conclusions survived. | Proposed | S3 |
| M22 | Bankruptcy case brief feed | Produce recurring digests of new Chapter 11 matters or another selected docket segment. | Proposed | S4 |
| M23 | Settlement, policy-limit, and interest calculator | Reconcile policy limits, offers, liens, costs, interest, and settlement arithmetic using deterministic inputs with source links. | Proposed | S5 |
| M24 | Bates, exhibit, and derivative processor | Create Bates-stamped, compressed, redacted, or OCR-enhanced derivatives while retaining hashes, parent relationships, and original exhibits. | Specified / Proposed | S5 |

## 5. Consumer, administrative, and access-to-justice tools

| ID | Tool idea | Core outcome | Status | Sources |
|---|---|---|---|---|
| A01 | Legal-aid and human-handoff router | Match ZIP, income, issue, and jurisdiction to legal aid, self-help, bar, law-library, or volunteer-lawyer resources. | Integration / Priority | S1 |
| A02 | Court/self-help/ODR navigator | Detect relevant guided interviews, self-help centers, and online dispute-resolution programs and route the user correctly. | Integration / Proposed | S1 |
| A03 | Consumer-complaint researcher | Search public complaint data for company patterns and outcomes before a user files. | Integration / Proposed | S1 |
| A04 | Consumer-complaint drafter and portal guide | Draft a CFPB, FTC, state-AG, or other complaint narrative and guide the user through the official portal. | Proposed | S1 |
| A05 | Credit-report dispute letter builder | Populate bureau and furnisher dispute letters, attach evidence, and track the investigation deadline. | Proposed | S1 |
| A06 | Debt-validation and collector-response builder | Generate the appropriate validation, wrong-debt, contact-preference, counsel, or stop-contact letter. | Proposed | S1 |
| A07 | Identity-theft recovery navigator | Route users through official reporting, recovery plans, freezes, and dispute letters. | Integration / Proposed | S1 |
| A08 | Public-records request filer/tracker | Draft, programmatically file where supported, track, and appeal FOIA/state records requests. | Integration / Proposed | S1 |
| A09 | Immigration case-status and A-file assistant | Retrieve USCIS case history, help request records, explain status, and track follow-up. | Integration / Proposed | S1 |
| A10 | Veterans benefits/forms navigator | Find VA forms and facilities, organize a claim/appeal packet, and connect authorized status APIs where available. | Integration / Proposed | S1 |
| A11 | Benefits eligibility screener | Ask structured questions, identify plausible programs, explain uncertainty, and route to official applications. | Integration / Proposed | S1 |
| A12 | Agency appeal-preparation assistant | Prepare SSA, unemployment, student-loan, DMV, and similar administrative appeal narratives and deadlines. | Proposed | S1 |
| A13 | Tenant repair/security-deposit letter builder | Generate jurisdiction-specific repair notices, complaints, and security-deposit demands with delivery tracking. | Integration / Proposed | S1 |
| A14 | Landlord/property intelligence tool | Identify owners and related property portfolios from public housing/property data. | Integration / Proposed | S1 |
| A15 | Fair-housing complaint assistant | Screen basic issue/deadline facts, draft a complaint, and route to HUD or a local agency. | Proposed | S1 |
| A16 | Employment charge/wage-claim assistant | Track EEOC/labor deadlines, organize facts, and draft inquiry, charge, wage, or NLRB submission content. | Proposed | S1 |
| A17 | Expungement/sealing eligibility and petition tool | Parse dockets, assess rule-based eligibility, and generate petitions where local law/data allow. | Integration / Proposed | S1 |
| A18 | Will, power-of-attorney, and advance-directive builder | Guide a user through jurisdiction-appropriate life-planning documents and official forms. | Integration / Proposed | S1 |
| A19 | Name-change workflow | Generate a state-specific checklist, forms, publication/service tasks, and filing packet. | Integration / Proposed | S1 |
| A20 | Small-claims and pre-litigation assistant | Organize evidence, value a procedural path cautiously, generate a demand, and assemble small-claims documents. | Proposed | S1, S4 |
| A21 | Remote-notarization connector | Route a completed document through an authorized online-notarization provider. | Integration | S1 |
| A22 | Certified-mail/service connector | Send letters through an approved provider and preserve delivery/proof records. | Integration / Proposed | S1 |
| A23 | Business-formation and entity-data assistant | Search entity data, prepare formation information, and guide users through the correct state portal. | Integration / Proposed | S1 |
| A24 | Trauma-informed legal assistant | Provide careful intake, explanations, and human handoff designed for domestic-violence survivors and other vulnerable users. | Proposed | S4 |
| A25 | Compliance navigator | Search and explain structured obligations under selected privacy, health, financial, education, and corporate statutes. | Integration / Proposed | S4 |
| A26 | International law/sanctions/customs researcher | Search treaties, sanctions, customs rules, and multi-jurisdiction materials with explicit coverage limits. | Integration / Proposed | S4 |

## 6. Shared safety, trust, and platform capabilities

These are not standalone legal products, but the documents repeatedly treat them as prerequisites for trustworthy versions of the tools above.

| ID | Capability | Purpose | Sources |
|---|---|---|---|
| P01 | Immutable source store with SHA-256 hashes | Preserve exact source bytes and detect later changes. | S4, S5 |
| P02 | Page/offset/bounding-box provenance | Let every extracted fact, quote, and amount open at its precise source location. | S5 |
| P03 | Rights and acquisition-policy gate | Enforce source terms, licensing, robots rules, entitlement, rate limits, and metadata-only fallbacks. | S5, S7, S8 |
| P04 | Canonical document/case schema | Deduplicate identities and let every tool reuse the same records. | S6, S7, S8 |
| P05 | Hybrid keyword/vector/graph retrieval | Combine exact legal searching with semantic retrieval and relationship traversal. | S1, S5 |
| P06 | Matter-level authorization and isolation | Prevent cross-client leakage below the prompt layer. | S5 |
| P07 | Untrusted-document/prompt-injection boundary | Prevent retrieved documents from changing tool policy or causing unsafe actions. | S5 |
| P08 | Human approval gates | Require approval for filing, sending, calendar changes, payments, and other consequential actions. | S5 |
| P09 | Append-only audit and provenance log | Record sources, transformations, model/tool versions, warnings, approvals, and filed versions. | S5 |
| P10 | Abstention and uncertainty states | Represent unknown, conflicting, unsupported, incomplete, and needs-review outcomes explicitly. | S5, S7, S9, S10 |
| P11 | Deterministic calculation layer | Keep dates, deadlines, balances, and other arithmetic out of free-form model reasoning. | S1, S5, S6 |
| P12 | Model-agnostic adapters | Allow models, sources, citators, storage, and practice systems to change without rewriting matter artifacts. | S5 |
| P13 | Gold evaluation corpus and release gate | Benchmark extraction, retrieval, citation, quotation, calculation, security, and model upgrades. | S2, S5 |
| P14 | Freshness/TTL and pre-filing recheck | Invalidate stale law, docket, deadline, and citator results before reliance. | S3, S5, S9 |
| P15 | Legal-information and UPL guardrails | Avoid lawyer-equivalence claims, distinguish information from advice, and support jurisdiction-specific AI disclosures. | S1, S5 |
| P16 | Privilege/privacy mode and DLP | Prefer local processing when appropriate, minimize external disclosure, detect sensitive data, and preserve privilege/confidentiality controls. | S2, S5 |
| P17 | Resumable jobs and source-health monitoring | Checkpoint long research/download runs, preserve partial results, expose provider limits, and alert on stale or broken source adapters. | S7, S8, S9, S10 |

## 7. Consolidated priority sequence

This ordering reflects the recommendations repeated across the documents, not an independent market analysis.

### Foundation

1. Matter workspace, immutable sources, provenance, and matter-level access controls.
2. Case-law/statute connectors, exact authority resolution, and compliant acquisition.
3. Citation existence, quote alignment, proposition support, and claim-evidence verification.
4. Deadline arithmetic and other deterministic calculations.
5. Gold evaluation corpus, adversarial tests, audit logging, and human review gates.

### First user-facing release

1. Multi-source case search and downloader.
2. Case briefer plus source-audited summarization.
3. Matter/case chat grounded in saved sources.
4. Citation-treatment report and consolidated final-document verifier.
5. Filing-ready DOCX/PDF and court-form filling.
6. Issue triage plus legal-aid/self-help referral.

### High-value specialty release

1. Medical chronology and missing-record detector.
2. Damages, liens, deposition contradiction, and demand-package agents.
3. Opponent citation analyzer, defense-risk analyzer, and hearing simulator.
4. Local-rules collector, filing checker, and e-filing navigator.
5. Consumer letters, public-records requests, benefits/agency appeals, housing, employment, and records-relief workflows.

### Later platform expansion

1. Docket/authority monitoring and research-session comparisons.
2. Practice-management connectors and portable matter export.
3. Portfolio intelligence after cross-matter authorization is proven.
4. Limited external actions only after approval and monitoring infrastructure is mature.

## 8. Source index

- **S1** — [Deep Research Report: Legal Tools for a Pro Se Person to Add to Pi Agent](../reports/deep-research-report-legal-tools-for-pi-agent.md)
- **S2** — Legal AI Tool Suite for the pi Agent — Ideas & Build Plan (historical source, not included: `Old Docs/LegalTools/legal-ai-tools-report.md`)
- **S3** — Legal Tool Ideas — Beyond the Core Five (historical source, not included: `Old Docs/LegalTools/tool-ideas.html`)
- **S4** — Legal Agent Tools — Research Report (historical source, not included: `Old Docs/LegalTools/legal-agent-tools-report.html`)
- **S5** — Legal-AI Tools and Agent Architecture for a Personal-Injury Practice (historical source, not included: `Old Docs/LegalTools/deep-research-report.md`)
- **S6** — [Pro Se Legal Tooling — Design Report](legal-tooling-design-report.html)
- **S7** — [How Lawyers Actually Search for Case Law](../reports/lawyer-case-law-research-workflow-report.html)
- **S8** — [Unified Legal Research Extension Plan](../plans/unified-legal-research-extension-plan.html)
- **S9** — Michigan Case-Treatment and Shepardizing Documents (historical source, not included: `Old Docs/CaseSheparding/MICHIGAN_CASE_SHEPARDIZING_GUIDE.md`), [Automation Plan](../plans/AUTOMATION_PLAN.md), full research report (historical source, not included: `Old Docs/CaseSheparding/New Text Document.txt`), and the associated skill references
- **S10** — Dedicated plans for Get Cases (historical source, not included: `Old Docs/LegalTools/get-cases-plan.html`), Case Chat (historical source, not included: `Old Docs/LegalTools/case-chat-plan.html`), Shepard Report (historical source, not included: `Old Docs/LegalTools/shepard-plan.html`), Verification (historical source, not included: `Old Docs/LegalTools/verify-plan.html`), and Multi-LLM Review (historical source, not included: `Old Docs/LegalTools/review-plan.html`)
- **S11** — [Multi-call summarization research](../reports/deep-research-report%20for%20summarizer.md), case-summary prompt (historical source, not included: `CaseLawSearch/summary prompt.txt`), and summary-audit prompt (historical source, not included: `CaseLawSearch/summary audit prompt.txt`)

## Scope notes

- Reviewed project-authored Markdown, text, and HTML planning/research documents.
- Excluded vendored `node_modules` documentation, raw downloaded judicial opinions, generated case research reports, package metadata, and duplicate HTML renderings of Markdown files.
- Commercial products, libraries, APIs, and MCP servers mentioned in the sources were treated as implementation options or market evidence, not separate product ideas unless the integration itself creates a distinct user workflow.
- “Shepardizing” is used only for the licensed Shepard's product. Open-source output is labeled citation-treatment analysis or a citator-style report.
- Every user-facing result should identify its source coverage, retrieval/check date, unresolved items, and need for qualified human review.
