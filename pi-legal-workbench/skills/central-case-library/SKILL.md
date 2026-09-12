---
name: central-case-library
description: Maintain and use the central collection of case files downloaded across all research sessions. Use when importing, locating, deduplicating, linking, or auditing saved cases; do not use it to perform the legal research itself.
---

# Central case library

Treat the library as the canonical, cross-research source collection. A research session discovers cases; this skill determines how its downloaded files enter and remain usable in the library.

## Core rules

- Keep the library outside the installed package so package updates cannot overwrite research data.
- Preserve each downloaded source file as an immutable original.
- Assign one stable `case_key` to each unambiguously resolved decision.
- Deduplicate using provider identifiers, court and docket metadata, citations, decision date, and file hash. Do not merge ambiguous candidates.
- Retain every provider URL, provider ID, download time, source format, content hash, research-session link, and matter link.
- Link a case to many research sessions or matters instead of creating uncontrolled copies.
- Store briefs, summaries, chats, verification records, and treatment reports as derivatives associated with the source case. Never overwrite the source opinion.

## Operations

### Import

1. Confirm that the file is a complete opinion or clearly label the material as a partial source.
2. Calculate or retain a content hash.
3. Resolve the case identity without guessing through conflicts.
4. Search the library for a matching provider ID, docket, citation, or hash.
5. Create a new entry or attach the new source and provenance to an existing unambiguous entry.
6. Record the research session and matter that contributed the case.

### Locate and supply

Resolve requests to a single `case_key` before supplying a case to the Case Analysis, Authority and Treatment Analysis, or Legal Writing skill. Return the saved full-text source and relevant metadata, not a remembered or reconstructed version.

### Audit

Report duplicates, ambiguous identities, missing full text, broken source paths, conflicting metadata, and derivatives whose source hash no longer matches. Preserve unresolved entries for human review.

## Boundary

Library presence does not prove relevance, precedential status, positive treatment, or good law. This skill manages source materials and provenance; other skills perform research and legal analysis.

## Implemented library access

Use `legal_library_search` for local name/citation/court/full-text lookup and exact source paths, hashes, and integrity status. New acquisitions share `Cases`; altered captures receive new versions. Use `legal_search_history` to inspect linked runs and review notes. Only valid recorded hashes qualify a file for automatic reuse; unhashed older files remain visible as unverified. Report broken or changed sources and preserve them while reacquiring a new version.
