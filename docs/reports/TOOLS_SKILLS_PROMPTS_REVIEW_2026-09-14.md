# Pi Legal Workbench: tools, skills, and prompts review

Date: September 14, 2026

## Verdict

**Overall: 7.5/10.** The package has a strong research and source-preservation foundation. The largest remaining weakness is the reliability of authority verification: a few deterministic decisions can produce a stronger verification status than the evidence warrants. Improving those decisions and measuring model behavior would deliver more value than adding more broad workflow instructions.

| Category | Grade | Assessment |
|---|---:|---|
| Tools | 7.5/10 | Strong acquisition, history, and recovery; important verification defects and uneven model-output handling. |
| Skills | 8/10 | Clear responsibilities and source rules; some workflows need concrete handoffs, examples, and completion criteria. |
| Prompts | 7.5/10 | Good legal-analysis instructions; summarizer prompts are more mature than chat and verification prompts. |

Grades are judgment-based assessments of current usability, correctness, evidence handling, recovery, and validation. Category scores give extra weight to consequential analysis tools; they are not arithmetic averages or measured legal-accuracy percentages. A 9 requires strong behavioral evidence, not just well-written instructions.

## Scope and validation

Reviewed the current working tree, including the existing uncommitted Justia and verification changes. The active package contains **10 registered tools, 6 skills, 4 command prompts, and 3 internal model-prompt modules**. Application code was not changed by this review.

- `npm run check`: TypeScript checking and **193/193 tests passed**.
- `npm run python:check`: failed because the `python` command resolves to the Windows installation alias.
- An existing uv-managed Python interpreter successfully compiled the helper in memory. That interpreter lacks `python-docx` and `docxtpl`, so actual DOCX generation was not exercised.
- Additional temporary synthetic probes reproduced the citation, short-form, recorded-hash, format-example, and context-window findings below. The temporary fixtures were removed.
- No live provider searches, model-quality benchmark, or real legal-work-product clearance was performed. Browser grades reflect implementation and automated-test evidence, not a fresh live-provider check.

## 1. Tool grades

| Tool | Grade | What works well | Most useful improvement |
|---|---:|---|---|
| `legal_jurisdictions` | 9/10 | Canonical vocabulary, aliases, and explicit court-scope limitations. | Add a small routing evaluation that checks state versus federal courts and missing jurisdiction. |
| `legal_search` | 8.5/10 | Preserves raw results, resumable runs, query/filter identity, provider metadata, and separate acquisition/summary failures. | Add repeatable live-provider smoke checks and a task-wide query/download budget ledger. |
| `legal_cited_by` | 8.5/10 | Integrity-checked seeds, dated collections, recovery, conservative deduplication, and explicit coverage limits. | Add a structured handoff from collected opinions to proposition-specific treatment evidence. |
| `direct_download` | 8.5/10 | State-bound candidate selection, one-time claim, no arbitrary opinion URL, and preservation of successful downloads after later errors. | Make candidate ambiguity and stale-tab recovery easier to act on in returned results. |
| `legal_library_search` | 8/10 | Local lookup with source paths, original hashes, integrity status, and linked research. | Support a configured shared library root and an index that avoids repeatedly reading and hashing the full library. |
| `legal_search_history` | 8/10 | Separates retrieval time from review notes; preserves earlier observations. | Improve combined search/cited-by filtering and distinguish reviews of different source versions. |
| `legal_open_browser` | 8/10 | Narrow, understandable purpose and controlled provider destination. | Return a concise readiness diagnosis: executable, profile, connection, and provider state. |
| `summarize_case` | 8/10 | Independent candidates, source audit, fresh reconstruction, bounded response recovery, and preserved output versions. | Use model-aware segmentation and save the audit, call records, and block-location map alongside the summary. |
| `case_chat` | 6.5/10 | Isolated per-case context, bounded concurrency, ordered results, and visible partial failures. | Add concrete JSON examples, response schemas, bounded response recovery, and direct behavioral tests. |
| `verify_document_authorities` | 5.5/10 | Separates checks, preserves the draft, validates exact evidence text, and reports uncertainty. | Fix reporter/name fallback, short-form resolution, and source-integrity enforcement before extending coverage. |

### Finding A — High: a wrong reporter citation can be marked verified

Evidence: [verify.ts](../../extensions/document-authority-verification/verify.ts), especially lines 132–137 and 182–200.

When no reporter citation matches, resolution falls back to the case name. The mismatch checks then compare year and name, but do not establish whether the supplied reporter citation belongs to that decision.

**Reproduced:** the draft cited synthetic `Smith v. Jones, 999 F.3d 999 (6th Cir. 2024)`. The supplied case metadata listed `123 F.3d 456`. The tool returned both identity and overall status as `verified` for an identity-only check.

**Improve:** distinguish “candidate located by name” from “reporter citation verified.” Compare the requested citation to the source's established citations. If an alternate reporter citation cannot be established, return an unresolved or qualified identity result; do not presume every difference is false, because legitimate parallel citations may exist. Include court, docket, date, and opinion identity when deciding whether multiple sources represent one decision.

**Acceptance criterion:** a matching name cannot, by itself, verify an unmatched reporter citation.

### Finding B — High: a named short form can resolve to the wrong case

Evidence: [citations.ts](../../extensions/document-authority-verification/citations.ts), lines 161–180 and 222–234.

Short-form matching retains the reporter volume but loses the abbreviated case name. It links to the most recent matching reporter root.

**Reproduced:** after `Smith v. Jones, 123 F.3d 456` and `Brown v. White, 123 F.3d 800`, the short form `Smith, 123 F.3d at 460` linked to Brown.

**Improve:** preserve the short-form name, compare all plausible antecedents, and refuse to choose when identity remains ambiguous. Add cases involving citation strings, parallel citations, repeated names, and intervening non-case authorities.

**Acceptance criterion:** the example resolves to Smith or remains unresolved; it must never select Brown solely because Brown appears last.

### Finding C — High: analysis does not enforce recorded source integrity

Evidence: [source.ts](../../extensions/case-summarizer/source.ts), lines 225–268; [sources.ts](../../extensions/document-authority-verification/sources.ts); compare [library.ts](../../extensions/legal-case-research/library.ts), `checkOpinionIntegrity`.

The library correctly checks saved captures against their original hashes. The common analysis loader computes a new hash but does not compare it to a recorded acquisition hash. Passing a file directly, or resolving it through verification's own index, bypasses the library's integrity decision.

**Reproduced:** a supplied source whose metadata contained a deliberately incorrect recorded hash loaded and participated in identity verification without an integrity warning.

**Improve:** share one integrity check across library reuse and analysis. Distinguish intact recorded captures, changed captures, and explicit sources without recorded provenance. Preserve the ability to analyze a user-supplied source while making its provenance state explicit. Check the correct hash for the actual file format; an HTML acquisition hash is not the hash of its Markdown derivative.

**Acceptance criterion:** a source with a conflicting recorded hash cannot silently receive ordinary verified-source treatment.

### Finding D — Medium: summary segmentation is not model-aware

Evidence: [summarize.ts](../../extensions/case-summarizer/summarize.ts), lines 68–70 and 175–179; [model-runner.ts](../../extensions/case-summarizer/model-runner.ts), context preflight.

Multipart processing begins only above 170,000 estimated source tokens, and parts target 120,000 tokens. The selected model may have a much smaller context window.

**Reproduced:** a synthetic opinion estimated at 39,021 tokens with a 32,768-token model failed before any model call instead of being segmented. The rejection is safe, but unnecessarily prevents the task from completing.

**Improve:** derive stage budgets from the selected model's context window minus source serialization, instructions, response schema, candidate/audit material, output, and margin. Plan audit and reconstruction capacity too. For multipart analysis, explicitly track source coverage: the final auditor currently sees cited blocks and adjacent context and therefore cannot detect every omission from the complete opinion.

**Acceptance criterion:** supported long inputs either complete through appropriately sized stages or fail before work begins with a precise unsupported-size explanation.

### Finding E — Medium: chat and verification lag behind summary response handling

Evidence: [chat.ts](../../extensions/case-chat/chat.ts), lines 133–144; [case-chat/schema.ts](../../extensions/case-chat/schema.ts), line 143; [verification/schema.ts](../../extensions/document-authority-verification/schema.ts), line 106.

Their requested output examples contain type notation such as `string|null` and `string[]`; these are format descriptions rather than valid JSON examples. Both fail `JSON.parse`. Neither prompt supplies the response-schema field used by the summarizer, and both call the basic runner instead of the bounded validated-response runner.

**Improve:** provide concrete parseable examples plus actual schemas, validate cross-field relationships, detect token-limited responses, and retry only the failed stage once. Keep legal uncertainty separate from malformed output. Batch repeated occurrences of the same authority to fit the output budget; verification currently caps one authority's response at 6,000 tokens regardless of how many occurrences are grouped.

## 2. Skill grades

| Skill | Grade | Most useful improvement |
|---|---:|---|
| `case-law-research` | 8.5/10 | Strongest operational skill: scope presets, tool routing, recovery, and source boundaries. Add examples for conflicting constraints and maintain a task-wide budget across multiple calls. |
| `case-analysis` | 8/10 | Good separation of briefing, summary, chat, and comparison. Add exact tool-call examples, a durable brief schema, and a comparison template. Clarify that larger multipart summaries can exceed the stated ten-call ceiling. |
| `central-case-library` | 7.5/10 | Strong provenance principles. Separate implemented lookup/reuse from proposed import, linking, and identity-merging operations. The current tools use the active workspace's `Cases` directory rather than a configurable cross-workspace library. |
| `authority-treatment-analysis` | 7.5/10 | Good proposition and quotation focus. Name `verify_document_authorities` explicitly, provide invocation examples, and define a treatment-evidence record with source, passage, proposition, role, date, and review state. |
| `legal-writing-adversarial-analysis` | 8/10 | Useful modes and concrete memo/rubric references. Add one worked evidence-backed finding and specify the handoff when verification or authority material is missing. |
| `judicial-hearing-preparation` | 7.5/10 | Clear simulation boundaries and debrief requirements. Divide essential inputs from optional enrichments, define one-question-at-a-time behavior, and specify whether timing is measured or approximate. |

### Improvements shared across skills

1. **Use a small common workflow contract:** inputs, actual tool names, outputs, completion criteria, and behavior when a dependency is unavailable. Keep each skill focused.
2. **Separate implemented capabilities from model-directed work.** For example, source collection exists as code; treatment classification is presently an instructed analysis workflow. Judge-data connectors and durable matter management are not established by having a skill describe them.
3. **Give one normal and one failure example per major workflow.** An example of an ambiguous identity or unavailable opinion is more useful than another general warning to be careful.
4. **Consolidate repeated policies.** Search modes and court-scope guidance appear in skills, references, tool guidelines, and READMEs. Maintain one authoritative definition and test the copies that must remain visible to the agent.
5. **Use consistent status vocabulary.** Distinguish completion of a process, validation of its output format, source integrity, support for a proposition, and checked treatment. These are different outcomes.

## 3. Prompt grades

### Command prompts

| Prompt | Grade | Most useful improvement |
|---|---:|---|
| `/research-memo` | 8.5/10 | Strong structure and coverage requirements. Define a predictable output artifact and resolve template paths through the loaded skill; include a completed miniature issue analysis. |
| `/adversarial-analysis` | 8.5/10 | Clear modes, evidence requirements, and prioritized next actions. Add mode-specific output tables and a policy for invalid mode names. |
| `/hearing-simulation` | 8/10 | Explicitly waits for the user's answer. Add a turn protocol, stop/resume behavior, and a debrief scoring rubric. |
| `/treatment-report` | 7.5/10 | Strong evidence and coverage boundaries. Add a treatment table/schema and explicit handling of unavailable publication, procedural-history, or statute-version evidence. |

### Internal model prompts

| Module | Grade | Most useful improvement |
|---|---:|---|
| Case summarizer | 8.5/10 | Good role diversity, direct-support instructions, concrete examples, and fallible-audit framing. Measure claim accuracy and omission rates, then persist the audit trail. |
| Case chat | 6.5/10 | Good isolated context and abstention instructions. Replace type-notation examples with valid JSON, enforce response structure, and test relevance and unsupported answers. |
| Authority verification | 6/10 | Good speaker and proposition distinctions. Add concrete JSON/schema handling and an explicit rule treating both draft excerpts and opinion text as untrusted data. |

The verification prompt currently ends with raw opinion text and lacks the explicit untrusted-input instruction present in the summarizer and chat prompts. This is a prompt-hardening gap, not a demonstrated successful injection. Use a shared trusted instruction block, serialize external material distinctly, and evaluate malicious instructions embedded in otherwise valid source text.

Do not make every prompt longer. Prefer observable obligations such as “each treatment label includes an exact passage and affected proposition” over repeated role descriptions or broad exhortations.

## 4. What the test suite does and does not establish

The existing tests provide useful evidence for recovery, cancellation, immutable captures, search filters, state-bound downloads, and schema validation.

However, [prompts.test.ts](../../extensions/prompts.test.ts) checks filenames, frontmatter, arguments, and routed skill existence. It does not test whether the agent follows the workflows. The current test-file search found `case_chat` registration coverage but no direct tests of `runCaseChat` or `validateCaseAnswer`.

Recommended evaluation set: start with 25–50 small, reviewed examples covering wrong citations, competing short-form antecedents, absent answers, dissent/majority confusion, omitted negation, misleading exact quotations, source changes, incomplete opinions, malformed model responses, and hostile instructions in sources.

Measure false verification separately from missed matches. Also measure unsupported material claims, missing qualifications, correct abstention, citation/quote linkage, recovery success, model calls, latency, and token use. Existing source-block membership and exact-text checks do not establish that a block supports a legal conclusion.

## 5. Recommended order of work

### First: fix incorrect verification outcomes

- Add regression tests and fix unmatched reporter citations and short-form antecedents.
- Enforce recorded source integrity consistently across analysis entry points.
- Make ambiguous identities remain unresolved.

### Second: make model execution consistent

- Reuse schema validation and bounded response recovery across the three analysis tools.
- Add model-aware input/output planning, including repeated-authority batches.
- Save a review bundle with source hashes, source-block maps, prompt/recipe versions, model records, warnings, and audit findings. Current summary details include more of this information than the default saved Markdown or summary-only JSON.

### Third: evaluate and polish workflows

- Add the reviewed behavioral evaluation set and workflow examples.
- Add structured treatment/comparison outputs and clarify library operation availability.
- Correct documentation drift: the README says eight skills while six are shipped, mentions five duplicate research tools while seven are registered, and contains design-document links that do not point into `Documents`.
- Make the Python check interpreter-aware. Treat DOCX ZIP-entry checking as structural validation; add content and rendered-layout checks before calling document production complete.

**Recommendation:** preserve the acquisition architecture and improve the verification and evaluation layers first. Those changes would make a future 9/10 grade defensible; wording changes alone would not.
