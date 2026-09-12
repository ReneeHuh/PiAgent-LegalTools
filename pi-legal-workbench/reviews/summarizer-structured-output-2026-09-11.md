# Summarizer structured output — 2026-09-11

The reported failures came from generated response structure and JSON syntax. The summarizer now uses concrete response schemas and provider-enforced JSON output for the `lmstudio` provider, in addition to local validation and one targeted retry per stage.

## Implementation

- Added strict case-summary and audit schemas, with required fields and object-valued statement entries containing text, source references, and confidence.
- All five LM Studio stages request `/v1/chat/completions` with `response_format.type = json_schema` and `json_schema.strict = true`.
- The request uses the selected model, server address, and registry-managed authentication. A request-local model copy selects the endpoint; the active Pi model configuration is preserved.
- Schema metadata survives retries, and its size is included in context-window estimates.
- Model-call records report the API, requested response format, schema name, attempt, and validation errors.
- A rejected schema request is reported without silently falling back to ordinary text. Other providers and calls without a summarizer schema retain their existing API behavior.

The endpoint choice follows [LM Studio's structured-output documentation](https://lmstudio.ai/docs/developer/openai-compat/structured-output). A live probe of the user's server found that Responses ignored the schema constraint while Chat Completions honored it.

## Validation

- `npm run check`: type checking and **144 tests passed**. Tests cover schema rejection of malformed objects, all five request schemas, request-local API selection, retry preservation, context accounting, and unchanged behavior for other callers/providers.
- The package registration checks passed again after the tool-description update.
- `pilegal --mode rpc --no-session`: successful startup with no extension conflicts and no model messages.
- Live test: `google/gemma-4-26b-a4b-qat` summarized the user's saved Hopkins opinion in **five calls, with zero retries**. All five actual HTTP requests used `/v1/chat/completions`, and all five raw responses passed their strict JSON-schema checks. Source-block validation also passed.

See [live request and validation evidence](summarizer-gemma-structured-live-results.json). The generated summary and raw model responses are retained in the new temporary directory named in that evidence. The opinion was read in place.

Schema validation establishes output structure. It does not independently establish the correctness of the legal analysis or resolve the previously identified quotation-contiguity and export-provenance limitations.

Restart Pi or reload the extension to activate the change. See the [summarizer guide](../extensions/case-summarizer/README.md) for behavior and limits.
