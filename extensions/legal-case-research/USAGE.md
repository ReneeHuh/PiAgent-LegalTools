# Research history and source preservation

The integrated extension provides seven tools: `legal_jurisdictions`, `legal_search`, `legal_cited_by`, `direct_download`, `legal_open_browser`, `legal_library_search`, and `legal_search_history`.

All research data is stored relative to Pi's current working directory. Launch `pilegal` from your research folder to use that folder's library and history. Existing files are not moved. The separate standalone CaseLawSearch package must not be loaded alongside the workbench.

## Storage

```text
Cases/
  example-123.html
  example-123.md
  example-123--<content-hash>.html
  example-123--<content-hash>.md
  _direct_selections/
Research/
  Searches/
    <date>-<court>-<query>-<id>/
      search.json
      results.jsonl
      review.md
      reviews.jsonl                 # created when review notes are added
  CitedBy/
    <case-title>-<key-hash>/
      <dated-run-id>/
        collection.json
        cited-by-manifest.json
        cited-by-events.jsonl
        cited-by-results.json
        unique-cases.json
        downloads.json
        comparison.json
        review.md
        index.html
```

`search.json` stores the original query/provider/court/date configuration, invocation limits, progress, and source references. `results.jsonl` is an append journal: a page event contains **every raw provider result and its normalized record**, including results not downloaded; download events retain the exact saved path and hash. Revisited pages append another observation. The current result view uses the most recent observation of each page; earlier observations remain in the journal. Torn final appends are preserved in a diagnostic file before recovery.

`review.md` is for purpose, useful/rejected authorities, reasons, unresolved questions, and next steps. Resume preserves notes. Merely finding or downloading a case never marks it read.

All new opinion acquisitions, including citing opinions, use the shared `Cases` library. Identical captures reuse the existing file; changed captures receive a new filename. Original HTML and paired metadata are not overwritten. Download references identify a source version by path and SHA-256. Library reuse requires a regular readable opinion, recognized provider opinion content, at least 200 characters, and matching recorded hashes. Unhashed legacy files remain visible as `unverified` and require a new acquisition before automatic reuse. Changed or broken files remain preserved and are reported. This integrity status describes the saved file, not the case's legal authority.

Older `Cases/Citations for ...` collections remain in place and can be resumed. New acquisitions during their resumption go to the shared `Cases` root. Their old timestamps are not treated as evidence of a more recent retrieval.

## Search, resume, and refresh

Start with explicit query, provider, and court scope:

```json
{"search_term":"reasonable care","provider":"scholar","jurisdiction":"michigan","pages_to_search":2,"max_cases_to_download":0}
```

The response includes `runId`, `manifestPath`, `reviewPath`, `lastRetrievedAt`, all observed results, download totals, and warnings. Each result exposes `publication_status` and a top-level `result_snippet` containing the provider's search excerpt, or `null` when unavailable. `passage_source` identifies the excerpt as `provider_snippet` or `unavailable`. The response also includes retrieval time and saved source hashes. An unavailable publication label is `null`; it is never inferred from a reporter citation. Snippets are discovery excerpts, not verified quotations.

Each result has normalized fields at its root, a singular `provider`, and a `provider_data` object containing provider-native identifiers and metadata plus `opinion_url`, `result_page`, `result_position`, and `retrieved_at`. One call searches one provider. For supplemental Justia discovery, use `provider: "justia"`, `jurisdiction: "all"`, and omit year filters.

To continue the same record, copy its `runId` into `run_id` and retain the same query/provider/court/date filters:

```json
{"run_id":"<returned-run-id>","search_term":"reasonable care","provider":"scholar","jurisdiction":"michigan"}
```

When omitted, the resume page and remaining page count come from the saved record. `pages_to_search` and `resume_page` can be explicit. Download selection applies to the run's accumulated unique cases. Completed pages are reused unless their selected downloads require reacquisition through the live provider page. Resuming completed work does not imply a new search. Without `run_id`, a call creates a new record even if `resume_page` is supplied.

To deliberately rerun retrieval and compare result sets:

```json
{"refresh_of":"<earlier-run-id>","search_term":"reasonable care","provider":"scholar","jurisdiction":"michigan","pages_to_search":2,"max_cases_to_download":0}
```

Refresh creates a new record and snapshots the earlier observed case keys. Changed query/provider/court/date filters also require a new record; a refresh may compare different filters, but differences then need that qualification. “Newly observed” does not mean newly decided. Search ranking, limits, and provider indexing can change the result set.

`updatedAt` records bookkeeping. `lastRetrievedAt` changes only after a provider returns a page. Reading history or adding review notes does not change it.

## Cited-by collection

Use a successfully downloaded, integrity-checked seed:

```json
{"action":"collect","case_key":"<saved-case-key>","pages_to_search":1,"max_cases_to_download":0,"jurisdiction":"michigan"}
```

```json
{"action":"resume","case_key":"<saved-case-key>","run_id":"<returned-run-id>"}
```

```json
{"action":"refresh","case_key":"<saved-case-key>","run_id":"<baseline-run-id>","pages_to_search":1,"max_cases_to_download":0}
```

Omitting `run_id` selects the newest collection for that case. Refresh preserves earlier runs, starts provider traversal anew, and reports newly observed case keys against the baseline snapshot. It inherits omitted court/year filters; `jurisdiction: "all"` removes the court restriction. To broaden inherited year bounds, supply explicit bounds. Resume preserves filters; only page/download limits may be raised. Fresh collections still default to all exposed pages and five downloads, so use explicit limits for a small exploratory run.

Cited-by collection remains discovery, not treatment classification. Completion covers only the selected providers and exposed results. Refresh does not establish good-law status.

## History and review

```json
{"action":"list","query":"reasonable care","limit":20}
```

Pass this to `legal_search_history`. Listing returns ordinary search runs and a separate cited-by collection list. `query` filters ordinary query text; `case_key` filters both lists. Use `offset` for subsequent pages. To inspect or annotate a returned run:

```json
{"action":"read","run_id":"<returned-run-id>","limit":20}
```

```json
{"action":"review","run_id":"<returned-run-id>","case_key":"<case-from-that-run>","review_status":"rejected","note":"Different procedural posture; does not address the issue being researched."}
```

Review statuses are `unread`, `useful`, `rejected`, and `needs_review`. Notes append to `reviews.jsonl` and `review.md`. They do not replace earlier notes. The tool rejects a case key absent from that run. Exact-case `direct_download` discovery also produces dated provider search records; its successful acquisition is linked back to the chosen provider's record.

## Search saved opinions

Pass these to `legal_library_search`:

```json
{"query":"reasonable care","court":"Mich","limit":20}
```

```json
{"case_key":"<saved-case-key>"}
```

All whitespace-separated query terms must occur in saved metadata or valid opinion text; this is literal local search, not provider-query syntax or semantic search. Court filtering is a literal substring of saved court metadata: `Mich` matches both `Michigan` and provider abbreviations such as `Mich.`. Results include source and metadata paths, provider URL, saved hash, integrity status, matching passage, and linked ordinary searches and cited-by runs. Multiple preserved versions remain separate results. Use `offset` to page through them. Broken or unhashed versions can still match metadata, but their opinion text is not presented as checked content.

## Save opinions with summaries

```json
{"search_term":"reasonable care","provider":"scholar","jurisdiction":"6th circuit","pages_to_search":1,"max_cases_to_download":5,"summarize":true}
```

Each selected opinion produces original HTML, opinion Markdown with YAML frontmatter, and a `.Summary.md` containing executive and detailed summary sections. With summarize omitted or false, only HTML and opinion Markdown are saved. The search invokes the summary pipeline directly and forwards its stage updates before proceeding to the next opinion. For exact downloads put `summarize: true` on action `download`; citing collections accept it on collect/refresh/resume. See the skill tool reference for output fields and resume behavior.
