# Case Summarizer

`summarize_case` analyzes one saved opinion using the active Pi model. Supply `source_path` and optionally `metadata_path`, `case_key`, `audience`, `focus`, and a new `.md` or `.json` `output_path` to override automatic saving. Sources must be `.html`, `.htm`, `.md`, or `.txt` files inside Pi's working directory. For HTML, metadata is read from the same-name Markdown frontmatter or a legacy fenced-JSON sidecar. For Markdown opinions, frontmatter is parsed separately and excluded from opinion evidence. PDF input is not supported directly.

The normal pipeline makes five calls: three independent candidate analyses run one at a time, followed by one combined audit and one final reconstruction. Each initial candidate uses an isolated prompt. The audit and final writer receive the source and earlier work. Source references are internal block IDs, not reporter page citations. Treatment is always `not_checked`.

Opinions over 170,000 estimated tokens automatically use multipart mode. Parts contain at most 120,000 estimated tokens and repeat approximately 2,000 tokens of complete source blocks from the preceding part. Each part retains the original block IDs. The partial summaries are audited against their cited source blocks and adjacent context, then reconstructed into one final summary. The saved report identifies multipart mode and its part count; the opinion is never silently truncated.

The stages and their retries share a per-run session ID and request short cache retention. Each prompt starts with the same opinion/request prefix and common system instructions, followed by stage-specific instructions. Candidate prompts never contain earlier candidate answers. Cache reuse and savings depend on the provider, model, and schema; the tool does not guarantee a cache hit. Other analysis tools retain their existing cache settings.

## Schema-enforced output with LM Studio

For the `lmstudio` provider, the summarizer automatically sends all five stages through `/v1/chat/completions` with `response_format.type: "json_schema"` and `strict: true`. The three candidate analyses and final reconstruction use the case-summary schema; the audit uses its own schema. Required fields, object-valued statement entries, source-reference arrays, confidence labels, and treatment status are constrained by these schemas.

The request uses the selected model, provider credentials, and server address. The endpoint choice applies only to summarizer calls; the active Pi model configuration is preserved. Both `openai-responses` and `openai-completions` LM Studio configurations are supported. A live probe found that the tested server ignored JSON-schema constraints on `/v1/responses`, while `/v1/chat/completions` honored them.

This request setting is documented in [LM Studio's structured-output guide](https://lmstudio.ai/docs/developer/openai-compat/structured-output). It is enabled automatically for the summarizer after reloading the extension or restarting Pi; no extra tool argument or global model-setting change is required. Other providers keep their configured API and prompted-JSON behavior. Calls without a summarizer response schema, including the other analysis tools, retain their existing request behavior.

Each returned model-call record reports `api`, `responseFormat` (`json_schema` or `text`), and `responseSchemaName` when a schema was requested. The tool does not silently fall back to ordinary text if LM Studio rejects the schema. It still validates the received JSON and source references locally: correct formatting alone does not establish that a cited passage supports a legal statement.

## Model-response recovery

All summary sections contain objects with `text`, `source_blocks`, and `confidence`. The model receives concrete, valid JSON examples rather than type-notation placeholders. A plain string in a summary section cannot be accepted because it lacks source support.

Each stage validates its JSON, required fields, and source-block references before the next dependent stage starts. If a response fails validation, the tool gives that stage the original source/prompt and specific validation feedback, then retries it once. It retains successful candidate analyses. Empty responses and responses stopped at the output-token limit also receive one retry; a truncated response gets a larger output budget when the active model's capacity permits it. Authentication, transport, cancellation, and context-window failures are not treated as JSON-repair opportunities.

There are five calls on the normal path and at most ten when every stage retries. Progress displays retries, and `details.callsAttempted`, `details.callsCompleted`, and `details.modelCalls` include actual response attempts. Each model-call record includes its stage and attempt, plus any validation error. A response that cannot be validated after its retry is reported as an internal model-output failure with the stage and model name. It does not produce an accepted summary file.

For errors such as `executive_summary[0] must be an object` or `candidate 1 returned invalid JSON`, changing `source_path` or removing `focus` does not address the cause. These errors describe generated output, not the caller's arguments. Report exhausted recovery rather than repeatedly calling the same failing pipeline or silently substituting `case_chat` for the requested audited summary.

## Search integration and progress

Research tools can call this pipeline directly with `summarize: true`, awaiting all stages before the next opinion. Search forwards the model-stage updates alongside acquisition/conversion updates. Standalone `summarize_case` emits lifecycle start/completion/failure/cancellation updates and detailed reading, analysis 1/2/3, retry, audit, reconstruction, and saving updates through Pi's callback. The existing executive summary and detailed sections are saved together.

## Output

The tool reads the supplied opinion, saves `<source-name>.Summary.md` beside it, and returns Markdown plus structured details including the actual `outputPath`. For example, `Cases/example.html` or `Cases/example.md` produces `Cases/example.Summary.md`. Existing summaries are preserved: another run saves `example.Summary.2.md`, then `.3.md`, and so on. An explicit `output_path` overrides the default and supports Markdown or structured summary JSON; its parent directory must exist and an existing explicit path is rejected. The tool performs the file write itself; no separate agent save step is needed. Markdown includes source hashes. The returned details also include the audit and model-call records, which the current JSON file export does not include. A file-saving error currently propagates to the caller.

The model audit evaluates legal support and attribution. Programmatic checks establish block-ID validity and compare normalized quote text; they do not establish treatment or good-law status. The current quotation matcher can join nonadjacent selected blocks and still requires correction before its matches can be treated as proof of contiguous quotations.
