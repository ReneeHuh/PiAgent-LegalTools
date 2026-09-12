# Legal Case Research upgrade — 2026-09-11

Implemented six research improvements in the integrated workbench extension, reflecting the revised scope. The package now registers ten tools across four extensions; seven tools belong to Legal Case Research.

| Improvement | Implemented behavior |
| --- | --- |
| Preserve original sources | Exclusive opinion writes, reuse of identical captures, content-hash filenames for changed captures, and preserved Markdown sidecars. Source references retain exact paths and SHA-256 hashes. |
| Reliable downloads and reuse | Check regular files, usable opinion content, library containment, and recorded hashes before reuse. Missing, empty, changed, or unhashed files cannot silently count as verified acquisitions. Browser Back failure preserves the saved capture and reports the navigation problem. |
| Real cited-by refresh | `legal_cited_by` supports `collect`, `resume`, and `refresh`. Refresh starts a separate dated run, snapshots baseline case keys, inherits omitted filters, and reports newly observed cases without overwriting earlier collections. |
| Persistent research history | Every ordinary search and exact-case discovery saves its request, raw and normalized results, page observations, downloads, retrieval timestamps, and review notes. Resume keeps the same run; refresh creates another. `legal_search_history` lists, reads, and annotates runs. |
| Local case-library search | `legal_library_search` searches saved names, citations, court metadata, case keys, and valid opinion text, returning passages, provenance, integrity status, and linked ordinary/cited-by research. |
| Clearer results | Ordinary search results include court, date, provider publication label, discovery snippet, acquisition status, retrieval timestamp, and source hash. Missing information stays explicit. |

## Storage and use

Data is relative to Pi's current working directory. Launch `pilegal` from the intended research folder. The shared `Cases` directory holds opinion versions; `Research/Searches/<run-id>` holds ordinary search records; `Research/CitedBy/<case>/<run-id>` holds citation collections. Existing collections remain in place and are discoverable/resumable.

See [usage and examples](../extensions/legal-case-research/USAGE.md) for exact tool arguments, resume/refresh behavior, limits, and the directory layout. Restart an already-running Pi session to load the new tool registrations.

## Validation

- `npm run check`: TypeScript checking passed; **127 tests passed**, zero failures or skips.
- `pilegal --mode rpc --no-session`, launched from the user's home directory: successful `get_state` response, zero model messages, and no extension conflicts.
- `npm pack --dry-run --json`: package includes the new implementation modules and usage guide.
- Live ordinary search and acquisition: Google Scholar and CourtListener each returned 20 results and saved one opinion. Both saved versions passed integrity checks.
- Live Michigan pagination: Scholar completed two pages and 40 results with a filing-year filter. CourtListener initially stopped on page two. Its Next handler closed CDP before asynchronous capture finished; the fix awaits capture, and a regression test verifies that connection lifetime. Resuming the same saved CourtListener run then completed both pages and returned 40 results.
- Live local tools: history listed four ordinary searches and two cited-by runs. Library search found both checked opinions and their linked research; history read returned the requested five-item slice from the 40-result run.
- Live Scholar cited-by collection and refresh reached Google's verification page and paused before returning citation results. Earlier manifests remained intact. Automated tests validate refresh, baseline comparison, filter inheritance, timestamp preservation/recovery, and missing-source reacquisition; live cited-by refresh remains unverified until the provider allows retrieval. No verification challenge was bypassed.

Live fixtures were isolated under the temporary directory recorded in the evidence files. Evidence: [ordinary retrieval](live-smoke-results.json), [initial workflow checks](live-workflow-results.json), [successful pagination recovery](live-recovery-results.json), and [local tool integration](live-local-tools-results.json).

## Practical limits

Local search is literal text matching with pagination, not semantic search. Court metadata uses provider spelling and abbreviations. Unhashed legacy opinions remain visible as unverified until reacquired; original files are retained. A matching hash establishes capture integrity, not completeness or legal authority. Provider publication labels and snippets are not independent legal verification. Refresh compares observed result sets within the selected filters and limits; it does not establish treatment or good-law status.
