---
name: authority-treatment-analysis
description: Analyze citation and quote verification findings, collect cited-by evidence, prepare treatment reports, and audit an opponent's authorities. Use for authority integrity, quotation support, proposition support, treatment preparation, or opponent citation analysis.
---

# Authority and treatment analysis

Use the Document Citation and Quote Verification extension for deterministic extraction and matching. Use this skill to interpret the resulting evidence and to organize treatment or opponent-citation review.

## Verification states

Preserve the raw citation and use explicit outcomes such as `verified`, `verified_with_qualification`, `metadata_mismatch`, `quote_mismatch`, `wrong_speaker`, `wrong_pincite`, `proposition_unsupported`, `ambiguous_authority`, `not_found`, `source_unavailable`, and `manual_review_required`.

Never silently fix, replace, or remove a questionable citation.

## Quote protection

- Preserve the draft quote and exact source text.
- Capture enough surrounding context to evaluate meaning.
- Detect changed or omitted negation and material omissions.
- Identify the speaker and opinion role.
- Treat fuzzy or OCR-dependent matches as manual-review items.
- Do not verify a quotation merely because similar words appear elsewhere in the case.

## Treatment preparation

1. Resolve the target decision to one saved `case_key` and define the exact proposition being tested.
2. Check direct procedural history separately from later citing treatment.
3. Use `legal_cited_by` for provider-scoped collection and preserve pagination, cursors, failures, and timestamps.
4. Save complete citing opinions before assigning treatment.
5. Capture the exact treatment passage, context, speaker, source location, affected proposition, and authority weight.
6. Classify only evidence-supported treatment, including followed, applied, explained, distinguished, limited, criticized, questioned, declined to follow, overruled, or cited only.
7. Queue ambiguous identities, unavailable opinions, uncertain treatment, and severe negative treatment for human review.

This is citator preparation, not Shepard's, KeyCite, full Shepardizing, or a definitive good-law determination.

## Opponent citation analysis

Organize findings by the opponent's proposition. Compare case identity, quotation, speaker, holding, posture, authority weight, factual fit, treatment, and omitted qualifications. Describe discrepancies precisely without making unsupported accusations.

## Argument support

Evaluate controlling support, persuasive support, record support, contrary authority, treatment, posture fit, jurisdiction fit, freshness, citation integrity, and missing elements. Show the evidence for each conclusion instead of producing an unexplained numeric score.
