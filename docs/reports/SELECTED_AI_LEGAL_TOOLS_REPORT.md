# Selected AI Legal Tools: Expanded Product Report

## Purpose

This report expands the legal-tool ideas selected from the repository's master catalog, identifies what should be combined, and proposes a practical architecture and build sequence.

For the Pi-specific choice between extensions, skills, prompts, packages, subagents, scripts, and SDK/RPC integration, see [Implementing the Legal Tool Suite in Pi Agent](../design/PI_AGENT_IMPLEMENTATION_OPTIONS.md).

The selected ideas are:

1. Legal research and case acquisition.
2. Case briefer.
3. Case chat.
4. Research memo.
5. Case and citation verification.
6. Cited-by collection and a citation-treatment preparation report.
7. Case summarizer.
8. Adversarial document review.
9. Opponent citation analyzer.
10. Argument support scorer.
11. Quote verifier.
12. Opposing-brief generator and defense-risk analyzer.
13. Hearing/oral-argument simulator.
14. Judge and court profiler.
15. DOCX generation.
16. Redaction and privilege-log preparation.

The two hearing-simulation entries in the original selection are treated as one tool.

## Executive recommendation

Build these ideas as **five cooperating modules**, not sixteen unrelated plugins:

| Module | Ideas combined | Why they belong together |
|---|---|---|
| **A. Research Workspace** | Legal research, case briefer, case summarizer, case chat, research memo | All operate on the same downloaded cases, metadata, issue tree, and research session. |
| **B. Authority Integrity** | Case/citation verification, quote verification, cited-by collection, citation-treatment preparation, opponent citation analysis, argument support scoring | They share citation extraction, authority resolution, source text, treatment evidence, and verification statuses. |
| **C. Adversarial Litigation** | Adversarial document review, opposing-brief generator, defense-risk analyzer | Each attacks a position using the same matter record and verified authority set. |
| **D. Judge and Hearing Intelligence** | Judge/court profiler and hearing/oral-argument simulator | The profiler supplies procedural and judicial context to the simulator. |
| **E. Document Production and Privacy** | DOCX generation, redaction, PII detection, privilege-log preparation | These transform reviewed content into controlled work product and safe derivatives. |

They should share one case/matter workspace and common services, but they should not all be exposed through one giant tool call. Separate public commands keep tasks understandable, testable, and reviewable.

## Existing foundation to reuse

The original `pi-unified-legal-research` package is the foundation for Modules A and B; its [research extension](../../extensions/legal-case-research/README.md) is now bundled into the workbench. At the time of this report, its documented version was 0.17.1 and it provided:

- `legal_jurisdictions` — canonical jurisdiction selection.
- `legal_search` — Scholar or CourtListener search with filtering and optional downloads.
- `legal_cited_by` — resumable, provider-scoped cited-by discovery and downloads.
- `direct_download` — exact-case resolution followed by a guarded download.
- `legal_open_browser` — visible provider handoff for inspection or verification.
- Saved opinion HTML, paired metadata, acquisition provenance, content hashes, cited-by manifests, raw provider records, unique-case views, and download records.

The existing package deliberately makes no holding, treatment, validity, or good-law conclusion. That boundary is valuable. Keep acquisition deterministic and put AI interpretation in downstream analysis workflows.

## Recommended overall workflow

```text
Research question
      ↓
Issue/jurisdiction framing
      ↓
Search, resolve, and download cases
      ↓
Brief / summarize / chat with individual cases
      ↓
Collect citing cases and direct history
      ↓
Verify identity, citations, quotations, and proposition support
      ↓
Build research memo and authority map
      ↓
Draft or import litigation document
      ↓
Opponent-citation audit + argument scoring + adversarial review
      ↓
Opposing-position analysis and hearing simulation
      ↓
Final verification, redaction review, and DOCX rendering
      ↓
Human approval
```

## Module A — Research Workspace

### A1. Legal research tool

#### Goal

Find relevant cases, retrieve the complete opinions, preserve provenance, and maintain a reproducible research session.

#### Reuse from the existing plugin

Use the existing `legal_jurisdictions`, `legal_search`, and `direct_download` tools instead of implementing another search/downloader. Add a research-session layer around them.

#### Inputs

- Research question.
- Jurisdiction and intended forum.
- Relevant date range.
- Optional known citation, case name, court, or docket.
- Issue and element checklist.
- Supporting and adverse search concepts.
- Provider choice, page limits, download limits, and runtime limit.

#### Outputs

- Downloaded opinion and acquisition metadata.
- Search log containing query, provider, jurisdiction, dates, filters, pages, and timestamp.
- Candidate table with selected/rejected status and reason.
- Issue tags and authority classification.
- Unread, unresolved, and follow-up queues.
- Explicit coverage statement; never “all relevant cases were found.”

#### Important behavior

- Search multiple query families rather than one natural-language prompt.
- Keep supporting and contrary-authority searches separate and visible.
- Distinguish discovery source from authoritative acquisition source.
- Never merge uncertain case identities.
- Rank relevance and legal authority separately.
- Record whether each case is found, downloaded, read, briefed, treatment-checked, or externally validated.

### A2. Case briefer and case summarizer

These should share one engine but remain two modes.

#### Why combine them

Both read one opinion, identify its structure, extract evidence, and create a source-grounded derivative. Separate implementations would duplicate parsing, provenance, quote handling, and auditing.

#### Recommended public interface

```text
case_analyze(case_key, mode="brief" | "summary", focus?, model?)
```

#### Brief mode

Designed for legal research and later synthesis. Suggested structure:

- Canonical case identity and source.
- Court, date, docket, citations, and publication status.
- Procedural posture and disposition.
- Material facts.
- Issues presented.
- Governing rules.
- Holding for each issue.
- Court's reasoning.
- Separate opinions and speaker attribution.
- Limitations, exceptions, dicta, and unresolved questions.
- Quotable passages with exact locations.
- Relevance to the research issue.
- Treatment status: `not_checked`, `preliminary`, or externally validated.

#### Summary mode

Designed for rapid understanding or a chosen audience. It may provide:

- Short executive summary.
- Detailed narrative summary.
- Issue-specific summary.
- Plain-language summary.
- Procedural-history-only summary.

Summary mode should never silently replace the structured brief. The brief is the durable legal research record; the summary is an audience- or task-specific view.

#### Quality pipeline

1. Extract opinion structure and evidence spans.
2. Generate a draft from those spans.
3. Audit every material proposition against the opinion.
4. Verify every direct quotation exactly.
5. Correct unsupported or overstated propositions.
6. Save the draft, audit table, and corrected output.

### A3. Case chat

#### Goal

Ask questions of one case or compare multiple cases without allowing facts or holdings to leak between case contexts.

#### Recommended behavior

- One isolated analysis context per case.
- Each case agent sees only its opinion, metadata, the question, and the response rules.
- Every substantive answer includes a source passage and location.
- If the opinion does not answer the question, return `not addressed in this opinion`.
- Clearly label inferences.
- Multi-case mode presents individual answers before any cross-case synthesis.
- Persist the question, cases, model/version, answers, and sources as a transcript.

#### Useful modes

- `single_case` — deep questions about one opinion.
- `compare_cases` — the same question answered independently by several cases.
- `corpus_route` — find the most likely relevant cases, then ask only those cases.
- `follow_up` — continue against the same isolated case context or start fresh from the source.

### A4. Research memo

#### Goal

Convert a research session into a concise, source-grounded legal research product.

#### Recommended contents

- Question presented and short answer.
- Governing jurisdiction, forum, date, and assumptions.
- Issue/element tree.
- Controlling authority by issue.
- Persuasive authority by issue.
- Contrary and distinguishing authority.
- Rule synthesis with proposition-level citations.
- Application possibilities and unresolved factual dependencies.
- Treatment and verification status for every relied-upon authority.
- Unread leads, unavailable sources, coverage limitations, and open questions.
- Search methods, providers, dates, and stopping rationale.
- Human-review checklist.

#### Relationship to other outputs

The memo should consume structured case briefs and verification records. It should not regenerate case holdings from memory or rely only on summaries.

## Module B — Authority Integrity

### B1. Shared verification engine

Case/citation verification and quote verification should use a common engine with separate operations.

```text
authority_verify(document_or_citation, depth="identity" | "quote" | "proposition" | "full")
```

#### Verification stages

1. Extract the citation and surrounding proposition.
2. Normalize citation form without discarding the original text.
3. Resolve a unique authority identity.
4. Compare case name, court, date, reporter, page, and docket.
5. Retrieve authoritative or best-available opinion text.
6. Align any quotation to the text.
7. Verify speaker and opinion section.
8. Check the pinpoint location.
9. Evaluate whether the cited material supports the adjacent proposition.
10. Attach current treatment data when available.

#### Status model

- `verified`
- `verified_with_qualification`
- `metadata_mismatch`
- `quote_mismatch`
- `wrong_speaker`
- `wrong_pincite`
- `proposition_unsupported`
- `ambiguous_authority`
- `not_found`
- `source_unavailable`
- `manual_review_required`

The verifier flags; it does not silently alter the document or substitute a similar real case for a fabricated citation.

### B2. Quote verifier and “quote protection”

#### Goal

Prevent invented, mutated, decontextualized, or misattributed quotations from appearing as verified legal support.

#### Required protections

- Compare the quoted words to the saved opinion text character-for-character after only explainable typography normalization.
- Preserve both the draft quote and exact source quote.
- Detect omitted negation and material omissions.
- Confirm whether the words belong to the majority, concurrence, dissent, a party, a witness, or a quotation from another authority.
- Save surrounding context, not only the matching sentence.
- Check the pincite or provide a source location when official pagination is unavailable.
- Link to the local opinion and source span.
- Treat OCR/fuzzy matches as review items, not exact verification.

#### Output

```text
quote | authority | exact-match status | speaker | location | context | issue | action
```

### B3. Cited-by collection and citation-treatment preparation report

#### Product boundary

This is **Shepardizing preparation**, not Shepardizing itself. It may be called a `citation-treatment report`, `citator-prep report`, or `authority-status research packet`. Do not label an open-source result a Shepard's report or claim that it proves a case is “good law.”

#### What stays deterministic

Keep the existing `legal_cited_by` workflow responsible for:

- Provider-scoped discovery.
- Pagination and resume state.
- Raw provider records.
- Conservative deduplication.
- Downloading selected or all exposed citing opinions.
- Acquisition metadata, hashes, failures, and completeness limits.

#### What the AI analysis adds

A separate operation should:

1. Resolve and verify the target identity.
2. Record direct procedural history separately from citing treatment.
3. Search every downloaded citing opinion for all citation variants.
4. Extract the exact passage and surrounding context.
5. Identify the speaker and opinion role.
6. Classify treatment at the proposition level.
7. Weight authority by court, publication status, date, and forum.
8. Compare the underlying statute/rule version when material.
9. Produce an unresolved and human-review queue.
10. Generate a checklist/export for Shepard's, KeyCite, vLex Cert, or another authorized citator.

#### Treatment taxonomy

- Direct history: affirmed, reversed, vacated, remanded, rehearing, superseded, or amended.
- Citing treatment: followed, applied, explained, distinguished, limited, criticized, questioned, declined to follow, overruled, or cited only.
- Evidence state: exact passage located, ambiguous passage, citation present but passage unresolved, or opinion unavailable.

#### Quote-protected reporting rule

No treatment label should appear as verified unless the report contains:

- the citing case identity;
- the exact treatment passage;
- enough surrounding context to understand the statement;
- the speaker/opinion role;
- the source location;
- the affected proposition, when determinable; and
- the analyst/model and review status.

If these elements are missing, label the item `unresolved` or `candidate treatment`; never guess from a search snippet or cited-by count.

#### Report language

Use restrained conclusions such as:

> No negative treatment was located in the listed sources as of [timestamp]. This provider-scoped research does not conclusively establish that the case remains valid for every proposition. A current licensed-citator and attorney review remains required before reliance in a filing.

### B4. Opponent citation analyzer

#### Goal

Audit how an opposing filing uses authority.

#### Workflow

1. Extract each citation, quotation, and the adjacent proposition.
2. Resolve and download missing authorities.
3. Verify identity, quote, pincite, and speaker.
4. Compare the opponent's characterization with the actual holding and posture.
5. Check later treatment and current underlying law.
6. Identify omitted limiting language or contrary authority.
7. Produce a response-oriented table without drafting unsupported accusations.

#### Output

```text
opponent proposition | citation | verification | actual source text |
characterization issue | treatment risk | possible response | confidence
```

### B5. Argument support scorer

#### Goal

Measure how well each argument in a draft is supported by the verified record and authority set.

#### Do not use one opaque numerical score

A single “82/100” hides important legal differences. Use a dimension matrix:

- Controlling authority support.
- Persuasive authority support.
- Factual record support.
- Contrary authority.
- Adverse treatment.
- Procedural/posture fit.
- Jurisdiction fit.
- Recency/current-law status.
- Quote/citation integrity.
- Missing element or inference.

#### Suggested result states

- `strongly_supported`
- `supported_with_qualification`
- `fact_dependent`
- `contradicted`
- `authority_at_risk`
- `unsupported`
- `manual_judgment_required`

Each result must show the evidence behind it. The score assists prioritization; it is not a prediction of outcome.

## Module C — Adversarial Litigation

### C1. Adversarial document review

#### Goal

Review a brief, motion, memo, demand, discovery response, or other document from skeptical perspectives and identify weaknesses before external use.

#### Recommended review dimensions

- Missing claims, elements, defenses, or requested relief.
- Faulty legal reasoning or unsupported inference.
- Factual gaps and contradictions.
- Omitted adverse authority.
- Procedural defects and remedy mismatch.
- Causation and damages vulnerabilities.
- Organization, clarity, tone, and credibility.
- Citation and quote issues, imported from Module B rather than reimplemented.

#### Multi-reviewer design

Use blind independent reviewers with the same rubric, followed by a separate synthesis step:

- **Consensus** — multiple reviewers independently identify the same issue.
- **Single-reviewer finding** — worth inspection but lower confidence.
- **Disagreement** — reviewers materially conflict; prioritize human judgment.

Possible reviewer roles include neutral appellate lawyer, trial judge, opposing counsel, evidence specialist, and procedural-rule checker. Roles should supplement—not replace—the common rubric.

### C2. Opposing-brief generator and defense-risk analyzer

These ideas should be two modes of one adversarial engine.

```text
adversarial_case_analysis(matter_id, mode="risk_report" | "opposing_brief")
```

#### Risk-report mode

Produces:

- Strongest adverse facts.
- Strongest defense doctrines and authorities.
- Missing or weak evidence.
- Alternative causal explanations.
- Credibility and impeachment risks.
- Jurisdictional or procedural barriers.
- Likely motions and responses.
- Actions needed to investigate or mitigate each risk.

#### Opposing-brief mode

Produces the strongest supportable opposing argument from verified matter facts and authorities. It should:

- Avoid inventing facts unavailable in the matter.
- Cite only resolved authorities.
- Mark assumptions and record gaps.
- Include the best response or mitigation beside each major opposing point.
- Remain internal work product, not masquerade as the opponent's actual position.

#### Why combine them

Risk analysis is the structured substrate; the opposing brief is one narrative rendering of those risks. Building the risk matrix first makes the prose more reviewable and reusable.

## Module D — Judge and Hearing Intelligence

### D1. Judge and court profiler

#### Goal

Provide current, sourced information about the forum and decision-maker for research and preparation—not unsupported outcome prediction.

#### Court profile

- Jurisdiction and subject-matter limits.
- Local rules and standing procedures.
- Filing formats, page limits, scheduling, service, and hearing practices.
- Available e-filing, self-help, and remote-appearance options.
- Controlling appellate hierarchy.
- Court-specific forms and authoritative links.

#### Judge profile

- Biographical and appointment information from authoritative sources.
- Standing orders and published courtroom procedures.
- Relevant written decisions grouped by issue and posture.
- Appellate treatment of the judge's decisions.
- Hearing/oral-argument recordings or transcripts when lawfully available.
- Recusal/financial-disclosure information when relevant and publicly available.
- Data coverage, sample size, and current-through date.

#### Guardrails

- Separate sourced facts from statistical inference.
- Do not infer protected traits, temperament, or personal motives.
- Do not claim a judge will rule a certain way.
- Do not treat raw win rates as dispositive without controlling for case type and posture.
- Link every characterization to decisions, orders, rules, or transcripts.

### D2. Hearing/oral-argument simulator

#### Goal

Prepare a user to answer difficult questions about the record, law, remedy, and weaknesses in a position.

#### Inputs

- Filing or argument outline.
- Verified authority set and research memo.
- Matter facts and exhibit map.
- Adversarial risk report.
- Selected court/judge profile.
- Hearing type and allotted time.

#### Simulation roles

- Judge/panel questioning.
- Opposing counsel.
- Optional evidence or procedure specialist.
- Post-session coach.

#### Session modes

- Rapid-fire questions.
- Full timed oral argument.
- Bench interruption mode.
- Weakest-issue drill.
- Record-citation drill.
- Remedy and jurisdiction drill.
- Multi-judge appellate panel.

#### Outputs

- Transcript.
- Questions the user could not answer or answered without support.
- Authorities and record cites that should have been used.
- Concessions and framing risks.
- Follow-up research/tasks.
- Separate performance feedback and substantive legal gaps.

The simulator may adopt a style informed by sourced court practices, but it must not imitate a real judge's personality or present speculative behavior as fact.

## Module E — Document Production and Privacy

### E1. DOCX generation tool

Python is a good implementation choice. Use two layers:

- `docxtpl` for filling approved Word templates with structured data.
- `python-docx` for paragraph styles, tables, headers/footers, pagination fields where feasible, and post-generation validation.

#### Recommended architecture

```text
verified structured content + approved template + formatting profile
                         ↓
                    DOCX renderer
                         ↓
             generated DOCX + render manifest
                         ↓
             formatting/placeholder validation
                         ↓
                    human inspection
```

#### Inputs

- Document type and jurisdiction/court template.
- Matter/caption data.
- Approved content sections.
- Citations, footnotes, exhibits, signature block, and service information.
- Formatting profile.

#### Outputs

- Editable `.docx`.
- Machine-readable render manifest.
- List of missing placeholders and unresolved data.
- Optional PDF derivative created through a controlled office renderer.

#### Design rules

- The LLM supplies structured content; deterministic code applies formatting.
- Never let the model improvise court margins, caption geometry, or page limits.
- Preserve template version and input artifact IDs.
- Fail on unresolved required placeholders.
- Validate output by reopening the DOCX and checking expected text/styles.
- Treat final page layout and filing compliance as requiring visual/human review.

### E2. Redaction and privilege-log preparation

#### Keep these related but distinct

PII redaction is primarily data detection and document transformation. Privilege determination is a legal judgment. They may share document parsing and review UI, but the product must not imply that automated privilege classification is final.

#### Redaction workflow

1. Preserve the immutable original.
2. Detect candidate PII, PHI, account data, minors, addresses, identifiers, and configured matter terms.
3. Show each candidate in context.
4. Require approval or rejection.
5. Apply true content-removing redactions, not visual black boxes over live text.
6. Create a new derivative with its own hash and parent relationship.
7. Verify removed text is not recoverable through extraction, annotations, metadata, or hidden layers.
8. Produce a redaction log when appropriate.

#### Privilege-log workflow

- Group document families and duplicates.
- Extract date, author, recipients, copied parties, subject, type, and source.
- Flag potentially privileged or work-product material using explainable indicators.
- Detect possible waiver risks, outsiders, mixed-purpose communications, and missing family members.
- Draft neutral privilege descriptions without revealing the protected substance.
- Require lawyer review for designation, withholding, waiver, and description.

#### Outputs

- Candidate-review queue.
- Approved redacted derivative.
- Redaction verification report.
- Draft privilege log.
- Human decisions and audit trail.

## What should and should not be combined

| Decision | Recommendation | Reason |
|---|---|---|
| Case briefer + summarizer | **Combine engine; separate modes** | Shared source analysis, different durable outputs and audiences. |
| Research memo + case analysis | **Same module; separate command** | Memo synthesizes multiple verified cases and should not be generated during every case read. |
| Case/citation verifier + quote verifier | **Combine engine; separate depths/commands** | Same resolution and alignment infrastructure; quick quote checks should remain easy to invoke. |
| Cited-by collection + treatment analysis | **Same package; hard stage boundary** | Collection is deterministic/provider-scoped; treatment is AI-assisted legal analysis. |
| Citation-treatment report + full Shepardizing | **Do not combine or equate** | Full Shepardizing requires authorized Shepard's access and professional review. |
| Opponent citation analyzer + general verifier | **Reuse verification engine; separate report** | Same checks, but organized around an opponent's propositions and response strategy. |
| Argument scorer + adversarial review | **Share evidence matrix; separate view** | Scoring supports prioritization while review covers broader reasoning and drafting issues. |
| Defense-risk analyzer + opposing-brief generator | **Combine as two modes** | Structured risks should be produced before adversarial prose. |
| Judge profiler + hearing simulator | **Combine module; separate artifacts** | Profile feeds simulation, but the sourced profile must remain distinct from role-play. |
| Hearing simulator duplicates | **Merge into one tool** | They describe the same product. |
| DOCX generator + legal drafter | **Do not combine** | Drafting is probabilistic; rendering and formatting should be deterministic. |
| Redaction + privilege review | **Share pipeline; separate approvals/statuses** | Privilege is contextual legal judgment, not merely sensitive-data detection. |

## Recommended public tool surface

A concise tool surface could be:

```text
# Existing acquisition tools
legal_jurisdictions()
legal_search(...)
legal_cited_by(...)
direct_download(...)
legal_open_browser(...)

# Research Workspace
research_session(action, ...)
case_analyze(case_key, mode, focus?)
case_chat(case_keys, question, comparison?)
research_memo(session_id, audience?, format?)

# Authority Integrity
authority_verify(input, depth, corpus?)
citation_treatment_report(case_key, proposition, run_id?)
opponent_citation_audit(document, corpus?)
argument_support_matrix(document, matter_id?)

# Adversarial Litigation
adversarial_review(document, rubric?, reviewers?)
adversarial_case_analysis(matter_id, mode)

# Judge and Hearing Intelligence
court_profile(court_id, topic?)
judge_profile(judge_id, issue?, date_range?)
hearing_simulate(matter_id, hearing_type, profile_id?, duration?)

# Document Production and Privacy
render_docx(template_id, content_artifact, output_path)
redaction_review(document, policy_profile)
privilege_log_prepare(document_set, matter_id)
```

The interface can be implemented as several Pi extensions within one package, plus skills that orchestrate multi-step workflows. The tools performing filesystem, retrieval, parsing, hashing, redaction, and rendering should be deterministic code. Skills/agents should handle synthesis, classification, adversarial analysis, and simulation.

## Shared workspace and artifacts

```text
Matters/<matter-id>/
  matter.yaml
  manifest.json

  sources/
    cases/
    court-rules/
    filings/
    evidence/

  research/
    session.json
    query-log.jsonl
    candidates.jsonl
    briefs/
    summaries/
    chats/
    memo.md

  authorities/
    citations.jsonl
    quotes.jsonl
    cited-by/
    treatment-reports/
    verification/

  analysis/
    opponent-citations.md
    argument-support.md
    adversarial-review.md
    defense-risk.md
    opposing-brief.md

  hearing/
    court-profile.md
    judge-profile.md
    simulations/

  drafts/
  templates/
  production/
    docx/
    pdf/
    redacted/
    privilege-logs/

  audit/
    events.jsonl
    approvals.jsonl
```

Use stable artifact IDs rather than relying only on filenames. Every derivative should record its parent artifact, source hash, tool/model version, timestamp, and review status.

## Build sequence

### Phase 0 — Stabilize the shared foundation

- Preserve the existing research extension and its tests.
- Add research-session and artifact schemas without rewriting acquisition.
- Define canonical case, citation, quote, proposition, and evidence-span objects.
- Add common provenance, status, and human-review records.

### Phase 1 — Research Workspace

1. Research-session wrapper around the existing case tools.
2. `case_analyze` with brief and summary modes.
3. Source audit and exact-quote gate.
4. Single- and multi-case chat.
5. Research memo synthesis.

This produces immediate value and creates the structured inputs required downstream.

### Phase 2 — Authority Integrity

1. Citation inventory and unique case resolution.
2. Quote, speaker, and pincite verification.
3. Proposition-support review.
4. Citation-treatment preparation report over existing cited-by artifacts.
5. Licensed-citator handoff/checklist and result recording.
6. Opponent citation audit.
7. Argument support matrix.

This is the highest-risk and highest-trust portion of the system. It should have a gold test corpus before being treated as reliable.

### Phase 3 — Adversarial Litigation

1. Structured adversarial risk schema.
2. Blind multi-reviewer document analysis.
3. Defense-risk report.
4. Opposing-brief rendering from approved risk findings.

### Phase 4 — Judge and Hearing Intelligence

1. Court procedures/local-rules profile.
2. Judge source collection and decision grouping.
3. Profile quality/coverage report.
4. Hearing simulator using the verified research and risk artifacts.

### Phase 5 — Production and Privacy

1. Approved DOCX template registry.
2. Python renderer and output validator.
3. PII/sensitive-data candidate detection.
4. Secure redaction derivative and verification.
5. Privilege metadata extraction and draft log.

## Minimum viable release

The smallest coherent release is:

1. Existing case search/download tools.
2. Combined case brief/summary engine.
3. Case chat.
4. Citation and quote verifier.
5. Citation-treatment preparation report over `legal_cited_by` output.
6. Research memo.
7. Basic adversarial document review.
8. DOCX rendering from approved templates.

Judge profiling, simulation, opposing-brief generation, argument scoring, and privilege review become much safer after the matter and verification layers are working.

## Non-negotiable guardrails

- Never describe public cited-by collection as complete legal coverage.
- Never infer positive treatment from the fact that one case cites another.
- Never call the open citation-treatment report “Shepard's” or “full Shepardizing.”
- Never emit a verified treatment label without the cited passage and its source context.
- Never label a quote verified when only a fuzzy/OCR match exists.
- Never silently correct, replace, or delete a questionable citation or claim.
- Keep source facts, model inferences, advocacy, and simulations visibly separate.
- Calculate dates and amounts with deterministic code.
- Preserve immutable originals; transformations create new artifacts.
- Require human review for consequential legal conclusions, filings, privilege calls, and completed redactions.
- Refresh authority treatment immediately before a filing is approved.
- Record provider, source coverage, timestamp, tool/model version, and unresolved items on every substantive report.

## Suggested success criteria

Before the suite calls a draft “ready for human approval”:

- Every legal citation is inventoried.
- Every relied-upon authority resolves uniquely or is manually cleared.
- Every direct quotation is source-aligned with verified speaker and location.
- Every cited proposition is supported, qualified, or visibly flagged.
- Every authority has a current treatment-check state.
- Every material fact links to evidence or is labeled inference/argument.
- Every critical date and amount is deterministically reconciled.
- Every adverse-review finding is resolved, accepted, or expressly deferred.
- Every redaction candidate is reviewed and the output tested for hidden recoverable content.
- The final DOCX has no unresolved placeholders and receives visual review.

## Source documents used

- [Master AI Legal Tool Ideas](../design/MASTER_AI_LEGAL_TOOL_IDEAS.md)
- [Pi legal-research extension README](../../extensions/legal-case-research/README.md)
- Legal AI Tool Suite — Ideas & Build Plan (historical source, not included: `Old Docs/LegalTools/legal-ai-tools-report.md`)
- Legal Tool Ideas — Beyond the Core Five (historical source, not included: `Old Docs/LegalTools/tool-ideas.html`)
- [Pro Se Legal Tooling — Design Report](../design/legal-tooling-design-report.html)
- [How Lawyers Actually Search for Case Law](lawyer-case-law-research-workflow-report.html)
- Legal-AI Tools and Agent Architecture for a Personal-Injury Practice (historical source, not included: `Old Docs/LegalTools/deep-research-report.md`)
- [Deep Research Report: Legal Tools for a Pro Se Person to Add to Pi Agent](deep-research-report-legal-tools-for-pi-agent.md)
- Michigan Case Shepardizing Guide (historical source, not included: `Old Docs/CaseSheparding/MICHIGAN_CASE_SHEPARDIZING_GUIDE.md`)
- [Michigan Shepardizing Automation Plan](../plans/AUTOMATION_PLAN.md)
- Dedicated plans for case chat (historical source, not included: `Old Docs/LegalTools/case-chat-plan.html`), cited-by treatment reporting (historical source, not included: `Old Docs/LegalTools/shepard-plan.html`), citation/fact verification (historical source, not included: `Old Docs/LegalTools/verify-plan.html`), and multi-model document review (historical source, not included: `Old Docs/LegalTools/review-plan.html`)
