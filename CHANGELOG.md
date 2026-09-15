# Changelog

## Unreleased — 0.1.0

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
