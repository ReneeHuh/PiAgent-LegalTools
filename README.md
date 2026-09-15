# Pi Legal Workbench

A provenance-first Pi package for legal research, authority verification, adversarial review, hearing preparation, and controlled document production.

This repository is the `pi-legal-workbench` package. Its manifest and resources live at the repository root. It implements parts of the architecture proposed in [Implementing the Legal Tool Suite in Pi Agent](docs/design/PI_AGENT_IMPLEMENTATION_OPTIONS.md).

## Quick start

From the repository root:

```bash
npm ci
pi
```

The repository's `.pi/settings.json` loads this package after the project is trusted. See [INSTALL.md](INSTALL.md) to install it in other projects or transfer a packaged archive to another computer. Run `/reload` after changing extensions, skills, or prompts.

## Current implementation

Version 0.1.1 includes:

- A valid Pi package manifest.
- The implemented `summarize_case`, `case_chat`, and `verify_document_authorities` extensions.
- The Legal Case Research extension, imported from CaseLawSearch 0.18.0, with seven search, acquisition, library, and history tools.
- Six focused legal workflow skills.
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

It saves opinions as `Cases/<slug>-<provider-id>.html` with a same-name Markdown opinion containing YAML metadata frontmatter and returns a `case_key` for each successful download. Setting `summarize: true` directly invokes the summarizer after each opinion to save `<case>.Summary.md`; both extensions emit progress updates. The analysis tools consume those files and keys. Install only this workbench package for the combined search and analysis tools; this repository's `.pi/settings.json` already does so. Loading the standalone CaseLawSearch package alongside it would register duplicate research tools.

## Develop

```bash
npm ci
npm run check
```

With Python installed, also run `npm run python:check`. For the optional DOCX helpers, see [Python setup](python/README.md). The GitHub Actions workflow at `.github/workflows/check.yml` runs the checks and builds a package archive on pushes and pull requests.

## Repository layout

| Path | Purpose |
| --- | --- |
| `extensions/` | Four Pi extensions, shared implementation, and adjacent tests. |
| `skills/` | Six legal workflow skills and their references. |
| `prompts/` | Four slash-command prompt templates. |
| `python/` | DOCX helpers and Python dependency requirements. |
| `assets/` | Schemas, templates, and review rubrics. |
| [`docs/`](docs/README.md) | Design documents, research reports, and implementation plans. |
| `dist/` | Generated `.tgz` packages; ignored by Git. |

Make research changes in `extensions/legal-case-research`. Keep actual case and matter files in separate working directories. Dependencies, Python virtual environments, caches, and generated archives are ignored by Git.

## Try without installing

From this package directory:

```bash
pi -e .
```

Or use this repository's existing `.pi/settings.json`:

```bash
pi
```

## Install in Pi

See [the installation and packaging guide](INSTALL.md) for Windows commands, installation in other projects, and transferring an archive to another computer.

From the repository root, install in the active Pi profile:

```bash
pi install .
```

For one project only, run `pi install -l /absolute/path/to/PiAgent-LegalTools` from that project's directory. Local installs reference the folder in place.

Project-local packages load only after the project is trusted. Restart Pi or run `/reload` after resource changes.

To create a portable package from this package directory:

```bash
npm run pack:release
```

The archive is written to `dist/pi-legal-workbench-0.1.1.tgz`. Extract it, install its npm dependencies, and point `pi install` at the extracted directory as described in the guide.

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

`summarize_case` reads the exact local opinion supplied in `source_path` and automatically saves `<source-name>.Summary.md` beside it (numbered if already present, or overridden by `output_path`). Opinions through 170,000 estimated tokens run three blind independent analyses sequentially, one combined accuracy and completeness audit, and one fresh final reconstruction. Larger opinions are divided into parts of at most 120,000 estimated tokens with approximately 2,000 tokens of complete-block overlap, then audited and reconstructed. It verifies source-block references and exact quotations and always reports subsequent treatment as `not_checked`.

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

- [Documentation index](docs/README.md)
- [Selected tool report](docs/reports/SELECTED_AI_LEGAL_TOOLS_REPORT.md)
- [Pi implementation options](docs/design/PI_AGENT_IMPLEMENTATION_OPTIONS.md)
- [Master idea catalog](docs/design/MASTER_AI_LEGAL_TOOL_IDEAS.md)
- [Deep research: legal tools for Pi](docs/reports/deep-research-report-legal-tools-for-pi-agent.md)
- [Deep research: multi-call summarization](docs/reports/deep-research-report%20for%20summarizer.md)
