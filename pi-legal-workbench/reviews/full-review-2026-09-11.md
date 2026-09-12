# Pi Legal Workbench code and pro se workflow review

Reviewed September 11, 2026. Scope: the current integrated `pi-legal-workbench`, including its four extensions, eight workflow skills, four prompts, templates, and Python DOCX helper. Legal-process observations use general legal knowledge and Michigan examples; they do not establish current court rules, deadlines, or legal conclusions for a particular case. No further legal research was performed after the user's instruction to stop legal lookups. Coding documentation was consulted for the DOCX template dependency.

**Assessment: useful research infrastructure, with an unreliable verification layer and an incomplete end-to-end pro se workflow.** The strongest component is the integrated CaseLawSearch implementation. The most consequential defects are false verification results: existing code can approve a wrong reporter citation, attach a short citation to another case, and accept a quotation assembled by omitting intervening source text.

`npm run check` passes: TypeScript type checking and 109 tests. Of those tests, 101 cover research, three cover document authority verification, one covers package registration, and four cover prompts/skills. There are no dedicated summarizer, case-chat, or Python renderer tests in that suite. Passing tests therefore provide substantially different assurance for different extensions.

The [offline diagnostic script](reproduce-review-findings.mjs) and [captured observations](review-evidence.json) reproduce the findings identified below as reproduced. The script uses synthetic opinions, mocked search responses, and mocked model responses. It makes no live research or model calls and retains its temporary fixtures for inspection. A diagnostic observation is evidence of the specified behavior, not an evaluation of how frequently a real model will generate the triggering output. Python findings are from inspection; a working Python rendering environment was not available for validation. Real browser/provider behavior and live model accuracy remain untested in this review. Implementation files were not changed during the review.

**Grades reflect present readiness, not the quality of the underlying language model.**

| Component | Grade | Reason |
|---|---:|---|
| Legal Case Research | 7/10 | Substantial implementation and tests; conservative identity merging, resumable collection, provider-specific scopes, and useful metadata. File preservation, cache integrity, and collection freshness still need work. |
| Case Summarizer | 5/10 | Good source-grounded structure and explicit separation of holdings, facts, posture, and disposition. Quotation validation has a demonstrated hole; five calls are mandatory; save failure can discard the completed result; JSON loses provenance. |
| Case Chat | 6/10 | Focused interface, isolated contexts, ordered per-case answers, bounded concurrency, and per-case failure handling make sense. Shares the quotation-validation defect and lacks dedicated behavior tests. |
| Document Authority Verification | 2/10 | The intended checks are valuable, but demonstrated false successes defeat the tool's central purpose. This should not be used as a filing-clearance gate in its present state. |
| Workflow skills and prompts | 5/10 | Strong research and argument-analysis concepts. Procedure, factual proof, actionable review instructions, and durable handoffs need to be brought together for a self-represented user. |
| Python DOCX helper | 3/10 | Basic structured rendering and a manifest exist. Template escaping, required-field validation, output-path collisions, and meaningful document validation remain incomplete. Runtime not validated here. |

Overall: **5/10 as a research-assistance workbench; 3/10 as a standalone guide from legal problem to completed filing.** These are judgment scores, not averages or benchmark results.

## Code findings

P1 means a high-priority correctness issue that can produce misleading legal work product. P2 means a significant reliability, coverage, or preservation issue. Findings described as inspection were not reproduced through a live browser or Python runtime.

### 1. P1 — A wrong reporter citation can receive `verified`

[verify.ts:131](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/document-authority-verification/verify.ts:131) falls back from reporter lookup to case-name lookup. It then checks title and year but never requires the supplied reporter citation to agree with the selected source.

Reproduced: local `Smith v. Jones, 123 F.3d 456 (2024)` plus a draft citing `Smith v. Jones, 999 F.3d 999 (2024)` returns identity `verified`. The fabricated reporter reference survives even when quotation checking is enabled and the quoted words are authentic.

Fix: name matching may suggest a candidate, but a conflicting reporter citation must remain a mismatch or unresolved until independently reconciled. Distinguish “found this named case” from “verified this citation.”

### 2. P1 — Short forms can resolve to the wrong case

[citations.ts:222](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/document-authority-verification/citations.ts:222) links a short form to the latest preceding citation with the same reporter and volume. It does not use the short-form party name to choose among candidates.

Reproduced: after citing Smith at `123 F.3d 456` and Adams at `123 F.3d 800`, `Smith, 123 F.3d at 461` resolves to Adams and receives `verified`.

Fix: parse the short name, preserve possible antecedents, and require a unique compatible antecedent. Ambiguity must remain visible. Add tests with multiple decisions in the same reporter volume.

### 3. P1 — All three analysis tools can accept a quotation made by skipping source text

[Summarizer output.ts:67](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/case-summarizer/output.ts:67), [chat output.ts:35](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/case-chat/output.ts:35), and [verify.ts:509](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/document-authority-verification/verify.ts:509) concatenate blocks in the model's supplied order before checking quotation text.

Reproduced source blocks: `The defendant is` / `not` / `liable for the injuries.` Selecting only the first and third makes `The defendant is liable for the injuries.` pass summary and chat quotation validation. The verifier also accepts this manufactured evidence for a `supports` conclusion. Its direct quotation search and its model-evidence validation are separate paths; this reproduction targets the latter.

Fix: validate quotations against offsets in the original ordered source. Require contiguous spans for unmarked quotations. Explicit omissions need ordered spans, visible ellipses, and a separate context review. Referencing real block IDs is insufficient.

### 4. P1 — A preceding block quotation may never be checked

[citations.ts:154](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/document-authority-verification/citations.ts:154) looks for a quotation only inside the citation's document block; [document.ts:64](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/document-authority-verification/document.ts:64) splits on line breaks.

Reproduced: a fabricated quotation followed by a blank line and a valid case citation yields quotation `not_applicable` and overall `verified` when identity and quotation checks are requested. This is an ordinary document layout, not an exotic citation style.

Fix: extract quotations across document blocks, associate them with citations using document offsets, and report unmatched quotations. A document-level quotation audit must account for all quotations, including those that could not be associated.

### 5. P1 — Nearby page numbers are treated as verified pincites

[verify.ts:437](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/document-authority-verification/verify.ts:437) checks page markers in nearby block text without locating the quote within the page interval.

Reproduced: `[123 F.3d 460] authentic quotation [123 F.3d 461] later text` passes a citation to page 461. The quote precedes that marker. Related extraction code removes HTML `page-label` links in [source.ts:99](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/case-summarizer/source.ts:99), losing useful pagination when supplied in that form.

Fix: preserve page-marker offsets and reporter identity, map quote spans to pages, and validate the complete requested page range. When reliable pagination is absent, report an unverifiable pincite.

### 6. P2 — A qualification hides an incomplete required check

[verify.ts:584](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/document-authority-verification/verify.ts:584) returns `verified_with_qualification` before checking whether another requested check is unresolved.

Reproduced: `pincite_unverifiable` plus a mocked `supports_with_qualification` conclusion produces qualified count 1 and manual-review count 0. The detailed pincite warning remains, but the summary understates unfinished work.

Fix: preserve independent issue and incomplete-check counts. An unresolved requested check must prevent an overall verification success, including qualified success.

### 7. P2 — Saved opinions can be overwritten

Both providers use stable filenames and the same replacing writer: [Scholar:667](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/legal-case-research/provider-google-scholar.ts:667), [CourtListener:657](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/legal-case-research/provider-courtlistener.ts:657), and [core.ts:135](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/legal-case-research/core.ts:135). Metadata is also replaced by that writer.

Reproduced at the writer level: an existing original becomes the replacement content. Inspection confirms provider captures use that writer at the stable opinion path. A new direct-download selection can therefore replace an earlier capture; a live repeat download was not performed.

This conflicts with the [library skill's immutable-original requirement](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/skills/central-case-library/SKILL.md:13). Atomic replacement prevents partial writes; it does not preserve evidence versions.

Fix: reuse identical captures and save changed captures as new versions. Bind derivatives to a specific preserved source hash. Keep replacing writes for resumable state files where replacement is intended.

### 8. P2 — Download status does not establish usable source integrity

[session-search.ts:268](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/legal-case-research/session-search.ts:268) accepts an existing path from metadata without checking file content against the recorded hash. [library-cited-by.ts:375](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/legal-case-research/library-cited-by.ts:375) trusts a prior downloaded status on resume without checking whether the opinion still exists.

Reproduced: an empty HTML file counts as downloaded and prevents a new download. Separately, a nonexistent citing opinion still counts as one downloaded case in a completed collection.

Fix: distinguish captured, present, readable, and integrity-checked. Check regular-file existence, minimum usable content, matching metadata, and stored hashes before reuse; return a repairable failure when they disagree.

### 9. P2 — A completed cited-by collection cannot be refreshed through the public tool

[library-cited-by.ts:337](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/legal-case-research/library-cited-by.ts:337) refuses a new collection for the same saved seed. Resume in [cited-by.ts:551](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/legal-case-research/cited-by.ts:551) does not restart exhausted providers, while checkpoint writing updates `updatedAt`.

Reproduced with a completed synthetic 2020 collection: `collect` says to resume; `resume` returns completed, retains the old result set, and updates the manifest timestamp to the present without provider retrieval. `updatedAt` is a file-update timestamp, but there is no separate last-retrieval timestamp preventing it from being mistaken for research freshness.

Resume is correctly designed to continue saved work. The missing capability is a new dated search run for the same authority, including different filters. Fix: add explicit refresh/new-run behavior, preserve old runs, and separately record retrieval time and continuation time. Exhausting exposed provider results never establishes complete legal treatment.

### 10. P2 — Normal Michigan rule citations can disappear from the inventory

[citations.ts:15](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/document-authority-verification/citations.ts:15) uses a limited collection of regular expressions. Reproduced: `MCR 2.116(C)(10). MRE 401. Const 1963, art 1, section 17.` produces zero inventory entries, including zero unsupported-authority entries.

Not verifying statutes and rules is a disclosed scope limitation. Failing to inventory common forms means a reader cannot use the inventory to see what remains unchecked.

Fix: add Michigan court-rule, evidence-rule, and constitutional forms, and show coverage limitations prominently. Track unrecognized citation-like passages separately from unsupported but recognized authorities. Do not present a count of extracted occurrences as exhaustive coverage of the draft.

### 11. P2 — Scanning and explicit source loading disagree for text opinions

[sources.ts:166](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/document-authority-verification/sources.ts:166) extracts document-body identity when scanning Markdown but not ordinary text files.

Reproduced: a readable `.txt` opinion with title and reporter citation produces zero indexed sources and one skipped source. Explicitly supplied text opinions work in the other fixtures. This matters for imported and converted opinions.

Fix: share the same identity extraction path across supported formats. Report each skipped file and reason, rather than only aggregate counts.

### 12. P2 — Summary persistence loses either provenance or the completed result

[output.ts:171](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/case-summarizer/output.ts:171) saves only the structured summary to JSON. Unlike the returned details, it contains no source path/hash, audit, model-call records, or validation warnings. Markdown retains source hashes, so behavior differs by output format.

Separately, [summarize.ts:163](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/case-summarizer/summarize.ts:163) attempts saving only after all five model calls, and a saving error escapes rather than returning the result. Reproduced with mocked responses: five successful calls followed by `EEXIST`, with no completed result returned. Refusing overwrite is correct; losing the completed analysis is unnecessary.

Fix: persist a versioned result envelope, preflight the output destination, and still return completed analysis plus an output error if final saving fails. Chat and verifier already provide a more resilient save-error pattern.

### 13. P2 — Scholar navigation failure can strand a successfully saved opinion

Inspection: [provider-google-scholar.ts:841](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/extensions/legal-case-research/provider-google-scholar.ts:841) saves the opinion before awaiting browser Back. A Back failure prevents returning the saved capture, so the caller records a failed download rather than normal paired provenance. CourtListener already catches restoration errors separately.

Fix: return the saved acquisition and its metadata even when restoring the results tab fails. Expose restoration as a separate recoverable navigation problem. Cover this failure with a mocked navigation test.

### 14. P2 — The DOCX template path lacks safe default text escaping and substantive validation

Inspection: [render_docx.py:73](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/python/render_docx.py:73) calls `template.render(payload)` without enabling escaping or enforcing escaped placeholders. The dependency documents that escaping is disabled by default and that XML-significant characters need handling. Ordinary text such as a party name containing `&` is enough to require it. [Official docxtpl documentation](https://docxtpl.readthedocs.io/en/latest/#escaping).

`validate_docx` checks two ZIP entry names, not well-formed XML, expected text, unresolved fields, or rendered pages. There is no required-placeholder validation. The generic renderer accepts an absent `sections` array, so feeding it the summarizer's JSON directly can create an empty document instead of rejecting the incompatible schema.

Fix: establish a renderer input schema and explicit summary-to-document transformation; enable escaping for ordinary string insertion; require template variables; validate XML and expected content; render and visually inspect final pages. A valid ZIP container does not establish a usable document or compliance with a court's filing requirements.

### 15. P2 — Renderer output and manifest paths can collide

Inspection: [render_docx.py:103](C:/Users/bacon21/Workspace/PiAgent-LegalTools/pi-legal-workbench/python/render_docx.py:103) resolves paths but never requires them to be distinct. Setting `--manifest` to the same new path as the DOCX allows the later manifest write to replace the generated Word file with JSON. With `--overwrite`, using the template as the output also defeats preservation of the original template.

Fix: reject collisions among input, template, output, and manifest; hash original inputs before rendering; stage and validate new outputs before publishing them.

## What makes sense in the design

- Four focused extensions are a sensible division: acquire sources, summarize one opinion, ask the same question of several opinions, and inspect a draft's authorities. There is no reason to restore the workspace-manager extension the user removed.
- Downloading full opinions with metadata is substantially better than drafting from search snippets. Stable source references and hashes provide a useful basis for auditability once version preservation is enforced.
- Cited-by journals, recoverable checkpoints, provider-specific completion states, and conservative deduplication are thoughtful engineering. Keeping raw provider records and preserving suspected duplicates supports later inspection.
- Case chat's per-case isolation makes answers easier to inspect. Combining the answers later, with explicit comparison, is a reasonable division of work.
- The analysis schemas distinguish facts, procedural posture, issues, rules, holdings, reasoning, disposition, and separate opinions. Those distinctions are central to understanding what a case supports.
- The skills ask for adverse authority, limits on a proposition, and contrary explanations. They also distinguish later treatment from procedural history and refrain from treating a cited-by count as a citator conclusion.
- Hearing preparation emphasizes court procedures, sourced judicial materials, and simulated questions rather than unsupported predictions about a judge's temperament.

## What needs to change in the product and legal workflow

**Procedure needs to come before broad research.** The hearing-preparation skill already includes local rules, service, scheduling, forms, and standing procedures. That is useful content, but it should inform initial intake. A user should first identify the forum, case type, current stage, requested relief, next required action, and any known due date. The right research question depends on whether the user is preparing a complaint, responding to a motion, handling discovery, or appealing. These stages call for different materials and standards.

**The workbench is principally an opinion-research system.** Searching state and federal opinions does not provide equivalent coverage of statutes, regulations, constitutions, court rules, administrative procedures, dockets, or current local orders. Those sources can govern the answer before a case search begins. The product should keep an explicit list of the non-case sources the user must obtain and verify for the matter.

**Keep legal authority separate from proof of the user's facts.** A favorable opinion does not establish that the events in this user's case happened. Use a simple table connecting each required element or defense to the relevant fact, supporting document or witness, dispute, and missing proof. Maintain chronology and evidence separately from downloaded opinions. A summary-judgment analysis, for example, needs attention to the evidentiary record as well as the cases discussing the standard.

**Authority weight requires more than a geographic filter.** Distinguish the forum, the governing law, the court hierarchy, publication/precedential status, issue actually decided, and procedural posture. A state-law question in federal court still requires proper state-law analysis. A federal district opinion is not equivalent in weight to a controlling appellate decision. A later opinion is not necessarily stronger than an older controlling one.

**The Central Case Library is currently a skill and file convention, not a database enforcing its promises.** It asks for immutable originals, many-to-many matter/session links, and derivative hash checks, but those are not all implemented. Ordinary search also lacks the durable run record that cited-by collection has. Add a small research ledger with query, provider, scope, date, limits, selected/rejected authorities, saved paths, and unresolved tasks. This can be a transparent local file; it does not require bringing back a workspace manager.

**Five model calls should be an available depth setting, with evidence of benefit.** Three independent contexts can expose different omissions, but all calls use the selected model. Agreement is not independent legal verification, and the final reconstruction can introduce a new error. Offer a focused first pass and a deeper audit for material authorities. Evaluate both on known opinions with meaningful holding/dicta, posture, dissent, and quotation edge cases before assuming more calls improve accuracy.

**Make review instructions actionable for a pro se reader.** Replace a bare “manual review required” with the exact question and next action: obtain the missing opinion, open the cited page, identify who said the quoted words, inspect the later decision, or verify the applicable rule version. Explain that “not found in this library” does not mean a case is fictitious; “quote matches” does not mean the proposition is legally correct; and “cited-by complete” does not mean good law.

**Private matter text has a different handling boundary from public opinions.** Model-backed analysis sends its supplied source/question content to the configured model through `modelRegistry.complete`. The `cacheRetention` option alone does not establish provider retention policy. Tell users what material is being sent when they supply private documents or facts, and let them use reduced or redacted text where appropriate. This is a transparency gap, not a claim of unexpected data transmission.

**Draft according to the document's purpose.** A pro se complaint, declaration, discovery response, and motion brief are different documents. The workflow should not funnel every dispute into a research memorandum or a case-heavy brief. Templates need appropriate facts, requests, signatures, attachments, and service information as applicable. The final document must be reviewed in the form actually submitted, after conversions and edits.

## Practical use with Michigan as the primary search area

These scope mappings were checked in the code, not inferred from geographic names:

| Search scope | Configured target | Appropriate use |
|---|---|---|
| `michigan` | Michigan state appellate scope; CourtListener codes `mich`, `michctapp` | Michigan state appellate decisions. Does not mean every state trial decision or federal court located in Michigan. |
| `6th circuit` | Sixth Circuit Court of Appeals | Relevant federal appellate decisions, subject to the legal issue and forum. |
| `eastern district of michigan` | Eastern District of Michigan | Federal district opinions from that court. |
| `western district of michigan` | Western District of Michigan | Federal district opinions from that court. |
| `us supreme court` | United States Supreme Court | Relevant Supreme Court authority. |

For Michigan state-law issues, start with Michigan's appellate hierarchy and identify controlling Michigan Supreme Court authority and the applicable status of Court of Appeals decisions. For federal issues in Michigan federal district court, relevant Supreme Court and Sixth Circuit authority will generally deserve priority. Do not assume the Sixth Circuit controls Michigan state courts merely because of geography. These are research-orientation principles, not a substitute for determining the governing law of the specific issue.

1. **Write a one-page intake note.** State the court or possible forum, case type, stage, relevant events and dates, requested relief, current paperwork, and next action. Separate known deadlines from deadlines still needing confirmation. Preserve original papers.
2. **Identify the actual question and governing materials.** List possible claims/defenses, elements, burdens, and procedural standard. Obtain the statutes, rules, forms, and orders relevant to the next action. Record missing or unverified materials explicitly.
3. **Map facts to proof.** Build an element/fact/evidence/gap table. Mark allegations, disputed facts, assumptions, and established record facts distinctly. Do this before investing heavily in favorable-case searches.
4. **Search narrowly, then expand deliberately.** Use `legal_jurisdictions` to select scopes. Use `legal_search` with limited pages and `max_cases_to_download: 0` for initial discovery. Search the rule or element, procedural posture, relevant fact pattern, and opposing argument. Broad “all” searches can supplement focused research but should not determine authority weight.
5. **Acquire and read the important opinions.** Use `direct_download` or selected search downloads. Keep provider metadata and original captures. Check identity and read enough of each full opinion to understand its posture, holding, limitations, and disposition. Given the overwrite defect, retain a separate preserved copy of material captures until versioning is fixed.
6. **Use analysis tools for specific reading tasks.** Ask case chat questions such as “What evidence was missing, and what procedural standard governed?” Use summaries for important opinions. Check each quotation and the surrounding passage yourself while the demonstrated validation defects remain.
7. **Investigate adverse and later authority.** Use `legal_cited_by` to discover citing decisions, then read how they discuss the particular proposition. Citation alone is neither approval nor rejection. Record search dates, provider coverage, unavailable sources, and unresolved treatment. Until refresh exists, retain prior collection records and conduct a separately dated fresh search rather than assuming resume refreshes them.
8. **Draft the document needed for the next step.** Connect propositions to source passages, distinguish adverse cases honestly, and connect factual assertions to the user's record. Use the adversarial prompt to expose weak elements, missing evidence, overbroad rules, and procedural objections.
9. **Audit the actual draft.** Run authority verification as an additional issue-finding pass, not clearance. Independently check citations, quotations, pincites, speaker, holdings, and whether the authority supports the stated proposition. Separately verify governing non-case law, treatment, filing requirements, and factual support.
10. **Prepare the final artifact and action record.** Inspect the rendered document, required components, attachments, signatures, and service requirements. Record the actual submission/service and resulting receipt or order, then update the next-action list. Research completion and filing completion are separate events.

## Recommended implementation order

1. Repair the false-success paths in findings 1–6 and add regression tests using the supplied synthetic cases. Give quotation and citation coverage explicit statuses.
2. Preserve source versions, verify cached files, and add dated cited-by refresh runs. Ensure a resumed result never implies a newer retrieval than actually occurred.
3. Add dedicated summary/chat tests, robust result persistence, Michigan citation inventory coverage, and the Scholar restoration-failure test.
4. Add a lightweight intake note, evidence map, research ledger, and a clear next-action list. Connect existing skills through concrete files and outputs.
5. Harden and validate the DOCX pipeline, then exercise it with representative documents and visual review.

The next investment should make existing outputs trustworthy and the user's next step clear. More tools, broader downloads, or additional model passes will not fix the demonstrated verification failures.
