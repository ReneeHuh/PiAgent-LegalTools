# Tool calls

Apply the presets and scope rules in [SKILL.md](../SKILL.md). Use tool schemas for numeric ranges and optional fields.

## Court scope

Call `legal_jurisdictions({})` and reuse its canonical keys and reported limitations. Use separate calls for multiple scopes; `all` means intentionally unrestricted. Citing-case jurisdiction is independent of the seed's court. Check candidate court metadata before manual downloads and after automatic downloads; resolve conflicts before reliance.

## Ordinary search

Results-only example:

```json
{"search_term":"state-created danger doctrine","provider":"scholar","jurisdiction":"3rd circuit","pages_to_search":-1,"max_cases_to_download":0,"summarize":false}
```

Pass the chosen limits explicitly: API defaults need not match the requested preset. Results retain provider page/position, metadata, URL, `case_key`, and `download_status`. Provider records may repeat the same decision; download selection uses unique cases accumulated across the run. For user-selected opinions, collect listings first, then use exact-case retrieval.

For interrupted work, pass:

- `run_id`: returned `runId`.
- `resume_page`: returned `resumePage`.
- `pages_to_search`: returned `pagesRemaining`.
- Unchanged query/provider/court/year filters and the original total download cap: five stays five after three successes; results-only stays zero with `summarize: false`.

Changed queries/filters require a new run. `refresh_of` starts a new dated retrieval linked to an earlier run; do not combine with `run_id`. Preserve remaining task-wide budgets across runs. Omitted runtime limit imposes no tool deadline.

## Exact-case retrieval

```json
{"action":"find","case_name":"Miranda v. Arizona","jurisdiction":"us supreme court"}
```

Resolve candidate name/citation/court/date conflicts, then pass the actual returned identifiers:

```json
{"action":"download","selection_handle":"<returned-handle>","candidate_key":"<returned-key>"}
```

Keep the provider results tab open. Download accepts no URL. Successful acquisition consumes the handle, even if summarization later fails. Stale/used handles need another find; an unsuccessful acquisition can retry an unused handle while its tab remains valid. Retry a failed summary with `summarize_case` against the saved HTML.

## Citing cases

Use `legal_cited_by` with a returned `case_key` backed by integrity-valid HTML and saved metadata. Listings alone are not seeds. The tool selects providers from saved identifiers; omit `provider` and report `unavailableProviders`.

```json
{"action":"collect","case_key":"<saved-case-key>","jurisdiction":"3rd circuit","pages_to_search":1,"max_cases_to_download":5}
```

Pages are saved totals per provider; downloads are a collection-wide total. Resume retains these totals:

```json
{"action":"resume","case_key":"<saved-case-key>","run_id":"<returned-run-id>"}
```

Omit jurisdiction/year filters on resume. For `collect` and `refresh`, supply the intended citing jurisdiction explicitly; `refresh` creates a new dated collection and inherits omitted year filters. Optional `run_id` selects the baseline, otherwise the newest collection is used.

`resultCases` previews at most 20 decisions: inspect `resultCasesTruncated`, `resultsJsonPath`, and `resultsHtmlPath` for complete collected results. New observations on refresh are not necessarily newly decided cases.

## Files, summaries, and history

Acquisitions save HTML and opinion Markdown with YAML provenance/cited-by metadata under `Cases`. Preserve existing versions; reuse requires valid hashes and usable opinion text. Legacy JSON metadata remains readable.

`summarize: true` on search, cited-by, or direct download calls the summarizer sequentially and saves `.Summary.md`. Fresh runs default false; resumes inherit the saved setting and reuse matching completed summaries.

Ordinary results expose `saved_html_path`, `saved_md_path`, `conversion_error`, and `summary`. Direct/cited-by records use `saved.markdownPath`, `saved.markdownError`, and `saved.summary`. Conversion/summary failure can give `partial_failure` while acquisition remains `downloaded`; preserve and report both.

`legal_search_history` supports `list`, `read` by `run_id`, and `review` with `run_id`, `case_key`, `review_status`, and `note`. Record only actual review. `lastRetrievedAt` is retrieval time; `updatedAt` may be bookkeeping.

`legal_library_search` uses literal query terms, optional court/case-key filters, and pagination. Reuse only `integrity.status: "valid"`. `legal_open_browser` opens only the provider homepage, not a search/resume.

For file layouts, versioning, and extended examples, read [USAGE.md](../../../extensions/legal-case-research/USAGE.md).
