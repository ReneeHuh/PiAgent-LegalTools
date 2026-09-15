# Changelog

## 0.1.1 — 2026-09-14

### Added

- Browser selection for Chrome, Edge, and Opera, with separate browser profiles and session state.
- Installed-browser flags in `legal_jurisdictions`, with Chrome as the default and no executable paths in the response.
- Selected-result batch downloads from saved Scholar, CourtListener, and Justia searches.

### Changed

- Return compact search previews with saved-result references and history inspection.
- Preserve browser selection when resuming research and pass multipart source context through every summarization stage.
- Clarify research skill instructions, tool progress, and retry guidance.

## 0.1.0

### Added

- A combined Pi package with ten tools across four extensions, six skills, and four prompt templates.
- Python DOCX helpers, shared schemas, templates, and review rubrics.
- A portable `.tgz` package built with `npm run pack:release` and documented installation steps.
- Automated TypeScript checks, tests, Python syntax validation, and archive creation in GitHub Actions.

### Changed

- Moved the installable package to the repository root.
- Organized project documentation under `docs/design`, `docs/reports`, and `docs/plans`.
- Updated the project-local Pi package path and documentation links for the new layout.

Existing installations that reference the former nested directory should follow the migration note in [INSTALL.md](INSTALL.md).
