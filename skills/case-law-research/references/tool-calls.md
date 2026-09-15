# Tool calls

Apply the presets and scope rules in [SKILL.md](../SKILL.md). Use tool schemas for numeric ranges and optional fields.

## Court scope

Call `legal_jurisdictions({})` and reuse its canonical keys and reported limitations. Use separate calls for multiple scopes; `all` means intentionally unrestricted. Citing-case jurisdiction is independent of the seed's court. Check candidate court metadata before manual downloads and after automatic downloads; resolve conflicts before reliance.

The same response includes `browsers.default` (Chrome) and `browsers.installed` with true/false values for `chrome`, `edge`, and `opera`. No executable paths are returned. Choose a browser marked true, preserving explicit user preferences. Call `legal_jurisdictions` again after browser installation changes to refresh these flags. The check does not open a browser.

## Ordinary search

Results-only example:

```json
{"search_term":"state-created danger doctrine","provider":"scholar","jurisdiction":"3rd circuit","pages_to_search":-1,"max_cases_to_download":0,"summarize":false}
```

Pass the chosen limits explicitly: API defaults need not match the requested preset. The model-facing preview includes up to 20 rows with `result_ref`, `title`, `court`, `year`, `publication_status`, `case_key`, `provider`, and `result_snippet`. Run metadata and download totals appear once. Missing values stay null. Provider records may repeat the same decision; automatic download selection uses unique cases accumulated across the run.

Read more saved rows without another provider search:

```json
{"action":"read","run_id":"<returned-run-id>","offset":20,"limit":20}
```

Pass that to `legal_search_history`. For full native metadata, original page/position, URL, download paths, and integrity, use `action: "read"`, `run_id`, and an exact `result_ref`. `case_key` filters matching current observations. A result reference addresses its original observation even after the page is retrieved again.

Download user-selected rows with `direct_download`:

```json
{"action":"download_results","run_id":"<returned-run-id>","result_refs":["<first-returned-ref>","<second-returned-ref>"],"summarize":false}
```

This accepts selections from Scholar, CourtListener, and Justia. It restores the saved query page and checks the provider's native opinion identity before clicking. Changed rankings can make a selection unavailable; report that result rather than substituting another case. Successful acquisitions are checkpointed before conversion or summary. Returned `retry` arguments contain unfinished work; verified saved sources are reused. Browser closures between search and selection can be recovered by restoring the saved page.

For interrupted work, pass:

- `run_id`: returned `runId`.
- `resume_page`: returned `resumePage`.
- `pages_to_search`: returned `pagesRemaining`.
- Unchanged query/provider/court/year filters and the original total download cap: five stays five after three successes; results-only stays zero with `summarize: false`.
- Omit `browser` to retain the saved Chrome/Edge/Opera choice. An explicit change uses separate browser state and becomes the run's saved choice.

Changed queries/filters require a new run. `refresh_of` starts a new dated retrieval linked to an earlier run; do not combine with `run_id`. Preserve remaining task-wide budgets across runs. Omitted runtime limit imposes no tool deadline.

## Exact-case retrieval

```json
{"action":"find","case_name":"Miranda v. Arizona","jurisdiction":"us supreme court"}
```

Resolve candidate name/citation/court/date conflicts, then pass the actual returned identifiers:

```json
{"action":"download","selection_handle":"<returned-handle>","candidate_key":"<returned-key>"}
```

Keep the provider results tab open. Download accepts no URL. Successful acquisition consumes the find handle, even if summarization later fails. Stale/used handles need another find; an unsuccessful acquisition can retry an unused handle while its tab remains valid. Omit `browser` on download to use the find selection's browser; switching requires another find. Retry a failed summary with `summarize_case` against the saved opinion. These one-use handle rules apply to `find`/`download`; saved `result_refs` remain reusable.

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

Inspect an ordinary result through `legal_search_history` to obtain download/summary paths, derivative errors, and integrity. Full search details also retain `saved_html_path`, `saved_md_path`, `conversion_error`, and `summary`. Selected batch downloads return per-result paths and errors directly. Named-case direct/cited-by records use `saved.markdownPath`, `saved.markdownError`, and `saved.summary`. Conversion/summary failure can give `partial_failure` while acquisition remains `downloaded`; preserve and report both.

`legal_search_history` supports `list`, `read` by `run_id`, and `review` with `run_id`, `case_key`, `review_status`, and `note`. Record only actual review. `lastRetrievedAt` is retrieval time; `updatedAt` may be bookkeeping.

`legal_library_search` uses literal query terms, optional court/case-key filters, and pagination. Reuse only `integrity.status: "valid"`. `legal_open_browser` opens only the provider homepage, not a search/resume.

For file layouts, versioning, and extended examples, read [USAGE.md](../../../extensions/legal-case-research/USAGE.md).
