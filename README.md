# PiAgent-LegalTools

A Pi package and design documents for a legal research and work-product workbench.

## Packages

| Directory | Package | Role |
| --- | --- | --- |
| [`pi-legal-workbench/`](pi-legal-workbench/README.md) | `pi-legal-workbench` | **The active combined package.** Bundles the integrated research extension's seven search, download, library, and history tools in `extensions/legal-case-research`, plus case summaries, case chat, authority verification, workflow skills, and DOCX production helpers. |
| [`CaseLawSearch/`](CaseLawSearch/legal-research/README.md) | `pi-unified-legal-research` | Retained source copy of the 0.18.0 search package used for the import. It is no longer loaded by this workspace. |

The workbench's Legal Case Research extension finds and saves opinions; its analysis extensions consume those saved files and metadata. Make future search changes in `pi-legal-workbench/extensions/legal-case-research`.

## Load the package in Pi

`.pi/settings.json` in this directory already lists `pi-legal-workbench` as a project-local source. Run `pi` from this directory and trust the project when prompted. Run `/reload` after changing skills, prompts, or extensions. Avoid loading the standalone CaseLawSearch package alongside the workbench because both register the same search tools.

To load elsewhere, install the workbench into that project's settings:

```bash
pi install -l /path/to/PiAgent-LegalTools/pi-legal-workbench
```

## Develop

```bash
cd pi-legal-workbench && npm install && npm run check && npm run python:check
```

## Design documents

- [Selected AI Legal Tools report](SELECTED_AI_LEGAL_TOOLS_REPORT.md)
- [Pi agent implementation options](PI_AGENT_IMPLEMENTATION_OPTIONS.md)
- [Master AI legal tool ideas](MASTER_AI_LEGAL_TOOL_IDEAS.md)
- [Deep research: legal tools for a Pi agent](deep-research-report-legal-tools-for-pi-agent.md)
- [Deep research: multi-call summarization](deep-research-report%20for%20summarizer.md)
- `Old Docs/` holds archived source material, including a frozen copy of CaseLawSearch. Edit the live package, not the archive.
