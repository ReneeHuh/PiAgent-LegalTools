# Pi Legal Workbench

A provenance-first Pi package for legal research, authority verification, adversarial review, hearing preparation, and controlled document production.

The package lives in this directory and implements parts of the architecture proposed in [Implementing the Legal Tool Suite in Pi Agent](../PI_AGENT_IMPLEMENTATION_OPTIONS.md).

## Current implementation

Version 0.1.0 establishes:

- A valid Pi package manifest.
- The implemented `summarize_case`, `case_chat`, and `verify_document_authorities` extensions.
- The Legal Case Research extension, imported from CaseLawSearch 0.18.0, with seven search, acquisition, library, and history tools.
- Eight focused legal workflow skills.
- Four slash-command prompt templates.
- Python DOCX helper infrastructure.
- Shared templates, schemas, and rubrics.
- TypeScript tests and type checking.

It does not yet implement the complete product described in the design reports. Provider-backed resolution inside document authority verification, treatment classification, redaction, and judge-data connectors remain future implementation phases.

## Bundled case search and acquisition

Case discovery and acquisition are provided by the bundled [Legal Case Research extension](extensions/legal-case-research/README.md). Its implementation, tests, and source-collection skill were imported from the workspace's CaseLawSearch 0.18.0 package. The skill is now named `case-law-research`. It exposes:

- `legal_jurisdictions`
- `legal_search`
- `legal_cited_by`
- `direct_download`
- `legal_open_browser`
- `legal_library_search`
- `legal_search_history`

See [research usage and storage](extensions/legal-case-research/USAGE.md) for dated history, refresh, preserved source versions, and local library search.

It saves opinions as `Cases/<slug>-<provider-id>.html` with a same-name Markdown opinion containing YAML metadata frontmatter and returns a `case_key` for each successful download. Setting `summarize: true` directly invokes the summarizer after each opinion to save `<case>.Summary.md`; both extensions emit progress updates. The analysis tools consume those files and keys. Install only this workbench package for the combined search and analysis tools; the parent workspace's `.pi/settings.json` already does so. Loading the standalone CaseLawSearch package alongside it would register the same five search tools twice.

## Develop

```bash
npm install
npm run check
npm run python:check
```

## Try without installing

From this package directory:

```bash
pi -e .
```

Or from the parent workspace, which already lists this package in `.pi/settings.json`:

```bash
pi
```

## Install for the current project

```bash
pi install -l ./pi-legal-workbench
```

Project-local packages load only after the project is trusted. Restart Pi or run `/reload` after resource changes.

## Extension surface

The package currently registers ten implemented tools across four extensions. The Legal Case Research extension exposes:

```text
legal_jurisdictions
legal_search
legal_cited_by
direct_download
legal_open_browser
legal_library_search
legal_search_history
```

Use the bundled [case-law-research skill](skills/case-law-research/SKILL.md) and its [tool-call reference](skills/case-law-research/references/tool-calls.md) for searches. It checks jurisdiction and gets quick or full search, result pages, and total opinion downloads from the request or case context. It asks only for missing, ambiguous, or conflicting choices before new research. Explicitly invoke it with `/skill:case-law-research` if needed. The three analysis tools are:

```text
summarize_case(source_path, metadata_path?, case_key?, audience?, focus?, output_path?)
case_chat(cases, question, focus?, output_path?)
verify_document_authorities(document_path, checks?, matter_id?, case_sources?, source_roots?, output_path?)
```

`summarize_case` reads the exact local opinion supplied in `source_path`, automatically saves `<source-name>.Summary.md` beside it (numbered if already present, or overridden by `output_path`), runs three blind independent analyses sequentially, one combined accuracy and completeness audit, and one fresh final reconstruction. It verifies source-block references and exact quotations and always reports subsequent treatment as `not_checked`.

With LM Studio, the summarizer automatically requests strict JSON-schema output through Chat Completions for all five stages, using the selected model. The summary you receive is still readable Markdown. Other providers retain prompted-JSON behavior. Invalid JSON, incorrect response structure, unknown source references, empty text, or a token-limited response trigger one retry of the affected stage while successful analyses are retained. At most ten calls are made. Retry progress, request format, API, and actual call records are reported; a repeated failure identifies the internal model and stage instead of suggesting that the opinion path is malformed. See the [summarizer guide](extensions/case-summarizer/README.md).

`case_chat` asks one question independently of every selected case file. It makes one isolated model call per readable case, runs at most three calls concurrently, preserves input order, validates source-block references and exact quotations, and performs no cross-case synthesis.

`verify_document_authorities` inventories case citations, short forms, nearby quotations, propositions, and unsupported authority types in a local draft. It resolves cases against explicitly supplied opinions, selected library roots, the matter case directory, or `./Cases`; runs deterministic identity, exact-quote, and available-page-marker checks; and uses isolated per-authority model analysis for speaker and proposition support. Model evidence is accepted only when its opinion blocks and exact evidence quotation validate. It never edits the draft, performs no provider lookup, and always reports treatment as `not_checked`.

Skills include:

```text
central-case-library
case-law-research
case-analysis
authority-treatment-analysis
legal-writing-adversarial-analysis
judicial-hearing-preparation
```

The Central Case Library manages saved case sources. The `case-law-research` skill handles case searches and source collection with the bundled research tools.

Prompt templates include:

```text
/research-memo <matter-or-research-session> [question, forum, relevant date]
/treatment-report <case-key-or-citation> <proposition> [jurisdiction, relevant date]
/adversarial-analysis <review|opposing-brief|defense-risk|argument-support> <document-or-matter> [focus]
/hearing-simulation <matter-id> <hearing-type> [side, time-limit, exercise]
```

## Safety boundary

- This package supports legal research and work-product preparation; it does not provide autonomous legal clearance.
- Provider-scoped cited-by collection is not complete legal coverage.
- A citation-treatment preparation report is not Shepard's, KeyCite, or a licensed citator.
- Questionable citations, quotations, treatment, facts, redactions, and privilege calls remain visible for human review.
- No extension or skill may silently alter or replace a questionable authority.

## Design sources

- [Selected tool report](../SELECTED_AI_LEGAL_TOOLS_REPORT.md)
- [Pi implementation options](../PI_AGENT_IMPLEMENTATION_OPTIONS.md)
- [Master idea catalog](../MASTER_AI_LEGAL_TOOL_IDEAS.md)
