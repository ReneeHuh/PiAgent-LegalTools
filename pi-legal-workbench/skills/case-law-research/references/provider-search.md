# Provider search guidance

Keep the user's meaning and court/date scope intact. Use supported syntax; never paste commercial-database connectors into another provider or silently translate a supplied query. Search techniques do not establish relevance or legal treatment.

## Google Scholar

Prefer short factual or doctrinal queries, using quoted phrases selectively. Apply court/year limits through tool parameters. Do not assume Westlaw `/p`, `/s`, `/n`, or suffix `!` works here. Try separate wording variants when exact phrases are restrictive.

Scholar exposes at most 1,000 results per query. Finishing those results does not establish complete coverage. Cited-by links support discovery, not editorial treatment verification.

[Official search help](https://scholar.google.com/intl/en/scholar/help.html); [Library of Congress case-law guidance](https://guides.loc.gov/free-case-law/google-scholar).

## CourtListener

For keyword mode, documented examples include:

| Purpose | Example |
|---|---|
| Alternatives and required concepts | `(store OR supermarket) AND spill` |
| Exact phrase | `"wet floor"` |
| Word expansion | `negligen*` |
| Phrase proximity | `"spill notice"~10` |

Quotes suppress stemming/synonym matching. Expansion requires at least three base characters. Minus exclusions can change how otherwise unconnected terms combine; use explicit `AND` in complex queries. Avoid excluding a whole document merely because it mentions an unwanted concept.

The website also offers semantic/hybrid modes. In hybrid mode, quoted terms are not necessarily mandatory in every combined result. The extension exposes no search-mode parameter: do not invent one or claim semantic mode was selected. If observed behavior suggests a different mode, report the uncertainty rather than asserting Boolean completeness.

[Official query documentation](https://wiki.free.law/c/courtlistener/help/search/advanced-search-and-query-techniques); [keyword/semantic mode explanation](https://free.law/2026/05/04/semantic-search-on-courtlistener/).

Consult current provider help when unfamiliar syntax materially affects retrieval. Westlaw/Lexis headnotes, classifications, and commercial citators require capabilities outside these search tools.
