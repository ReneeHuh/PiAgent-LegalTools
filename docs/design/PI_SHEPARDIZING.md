# Pi Michigan Case-Treatment Workflow

This project adds a lightweight, evidence-first Michigan Shepardizing workflow to Pi. The methodology skill lives at `./michigan-shepardize/`; the limited flow extension lives at `./michigan-shepardize-extension/`; and `.pi/settings.json` makes Pi discover both automatically. The extension structures intake, ordered stages, saved state, and completion checks. The installed `pi-unified-legal-research` package still performs public case collection. This system is not Shepard's, KeyCite, legal advice, or an autonomous good-law determination.

## Start Pi

Open a terminal in this directory and run:

```powershell
pi
```

Pi will ask whether to trust project-local `.pi` resources the first time. Review and trust this project, restart Pi if requested, and use `/reload` after editing the skill or prompt during an existing session.

Confirm that the existing legal-research package remains installed with:

```powershell
pi list
```

The installed package should include tools named `legal_jurisdictions`, `legal_search`, `legal_cited_by`, `direct_download`, and `legal_open_browser`.

## Run a case check

Run the extension command with no arguments for guided intake:

```text
/shepardize
```

Or provide fields separated by `||`:

```text
/shepardize 468 Mich 763; 664 NW2d 185 || The exact legal proposition being checked || Michigan state courts || 2026-08-28
```

Use `/shepardize-status` to inspect the active run and `/shepardize-resume` to continue its next pending stage. Both commands accept an optional run ID.

## Expected output

Downloaded provider opinions and acquisition metadata remain under `Cases/`. Each completed research run creates:

```text
Reports/<case-key>/
├── REPORT.md
├── REVIEW.md
├── RESEARCH_LOG.md
└── RUN.json
```

`RUN.json` records the enforced stage state and must be changed only by `shepardize_flow`. `REPORT.md` contains the proposition-specific preliminary result and evidence table. `REVIEW.md` contains official-source, negative-treatment, ambiguity, coverage, and positive-law tasks that still require a person. `RESEARCH_LOG.md` records sources, queries, filters, timestamps, saved files, failures, and provider limits.

## Default scope

The first cited-by pass is intentionally finite: Michigan jurisdiction, up to five exposed result pages, up to twenty downloaded citing opinions, and a maximum thirty-minute tool budget. The report must disclose remaining pages, unattempted cases, failed downloads, and coverage gaps. Expand the run only after reviewing the first-pass size and relevance.

Google Scholar and CourtListener may open visible browser windows. Complete a provider verification challenge yourself when appropriate; the workflow must not bypass it. Michigan Courts remains the official verification layer, and its docket does not replace a forward citator.

## Required human work

A person must review severe or ambiguous treatment, MCR 7.215(J) conflicts, partial dispositions, amended opinions, statutory or rule changes, and any conclusion intended for a filing or other consequential use. The final report must state whether Shepard's or KeyCite was consulted and must be refreshed immediately before filing.

## When to build the larger system

Keep this skill-based workflow while researching cases individually. Consider a dedicated extension and database only when actual use demonstrates a need for batch processing, persistent treatment records, automatic change alerts, multi-reviewer queues, or large citation graphs.
