# Case law research skill audit

The skill now has the name `case-law-research` and a description that applies to requests to search for cases, find opinions, download cases, and collect citing cases. The search, cited-by, and direct-download tool instructions tell Pi to load it. The broader research workflow also routes to it.

## Findings and changes

| Finding | Change |
| --- | --- |
| The old skill did not establish quick or full search before running tools. | Both modes now require a defined scope and limits. Pi uses clear choices from the request or case context and asks only about missing, ambiguous, or conflicting choices. |
| Listing court keys did not resolve what courts the user intended to search. | Pi checks context for the forum and search scope, asks if unclear, and validates the scope against `legal_jurisdictions` before the first provider search. State appellate and federal selections remain distinct. |
| Result pages and opinion downloads could be confused. | The skill asks separately for result pages per query, court scope, and provider, and total opinions to download. Each download saves a whole opinion. |
| API defaults could cause unintended work, especially cited-by's default of all exposed pages. | Fresh searches, cited-by collections, and refreshes require explicit agreed page and download values. Full search does not imply unlimited pages or downloads. |
| Repeated calls could multiply a requested download limit. | The skill tracks the task's total budget across queries, providers, and seeds. The reference explains that resumed download limits apply to accumulated results. |
| Automatic downloads could be mistaken for a selection of the strongest authorities. | The skill explains that the tool takes the first unique results. It uses discovery-only calls followed by exact-case retrieval when the user wants to choose cases after review. |
| Direct-download instructions treated any failure as consuming the selection. | The instructions now match the code. Success consumes the selection; failure can retry it if the provider results tab is still valid. |
| The cited-by reference and tool response mislabeled normalized results as original provider records. | Both now identify `cited-by-results.json` as normalized results and `cited-by-events.jsonl` as the source of original provider records. |

The source-integrity checks, preserved opinion versions, research journals, treatment boundaries, and instructions for untrusted provider content remain appropriate. A known-case download has a one-opinion scope and still needs a jurisdiction check, but does not need a quick-or-full question. A completed search or a cited-by count does not determine whether a case controls or remains good law.

## Validation

- `npm run check` passed TypeScript checking and all 144 tests.
- Pi's skill loader found all eight bundled skills without diagnostics. It included `case-law-research` in the model's available skills and found no old `legal-research` entry.
- Relative links in the revised skill, tool reference, and workflow resolved. The skill's UI metadata names `$case-law-research`.
- An actual `pilegal --mode rpc --no-session` startup discovered `/skill:case-law-research` without extension-load errors.
- The same startup discovered `/skill:unslop` from the `pilegal` profile. Its profile extension adds the writing rules to the main agent's prompt without duplicating them. No unslop files were added to the workbench.

## Remaining limitation

Search questions and the task-wide budget are agent instructions. The tools still accept their existing optional arguments and API defaults; they do not enforce a conversation-level confirmation or budget. These checks establish discovery and code compatibility, not compliance by every model. No live provider search or model behavior test was run for this skill change.
