---
name: case-analysis
description: Analyze one or more saved cases through briefing, summarization, comparison, or source-bounded case chat. Use when the user asks what a case held, how it reasoned, how cases differ, or questions that must be answered from selected opinions.
---

# Case analysis

Resolve every case through the Central Case Library and analyze the saved full opinion. Use the configured Case Summarizer or Case Chat extension when available; otherwise state that the analysis is being performed directly from the saved source.

## Shared rules

- Identify the exact case, court, date, docket, citations, source file, and opinion role.
- Separate procedural posture, material facts, issues, governing rules, holdings, reasoning, disposition, dicta, and separate opinions.
- Attribute language to the correct speaker: majority, concurrence, dissent, party, witness, or nested authority.
- Support material propositions with source locations.
- Label treatment `not_checked` unless the Authority and Treatment Analysis skill completed a separate check.
- Do not silently combine facts or reasoning from different cases.

## Modes

### Brief

Create a durable structured case record containing identity, posture, facts, issues, rules, holdings, reasoning, disposition, separate opinions, limitations, useful quotations, and relevance to the user's issue.

### Summarize

Match the requested audience and focus. Create an independent source-grounded draft, audit each material proposition against the opinion, and correct the final summary. A summary does not replace the structured case record.

`summarize_case` automatically requests strict JSON-schema output through Chat Completions when the selected provider is `lmstudio`, and returns readable Markdown. Other providers retain their configured API. It normally uses five model calls and retries an invalid internal response once per affected stage, for at most ten calls. If it reports exhausted model-output recovery, report the failed stage and model; do not interpret a summary-field JSON error as an invalid `source_path`, repeatedly rerun the same call, or silently substitute Case Chat for the requested summary pipeline.

### Chat

Pass the exact selected opinion files and one question to Case Chat. Each case must answer in an isolated context, cite supporting source blocks, and return `not_addressed` when its opinion does not answer the question. Do not attribute one case's facts or reasoning to another. Case Chat performs no cross-case synthesis; compare the returned per-case answers only when the user separately asks for comparison.

### Compare

Compare cases by court level, posture, governing rule, material facts, holding, reasoning, remedy, and factual fit. Do not treat factual similarity as equivalent authority weight.
