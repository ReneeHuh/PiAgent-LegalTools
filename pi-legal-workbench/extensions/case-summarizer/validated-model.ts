import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { estimateModelInputTokens, runModelCall, type ModelCallRecord } from "./model-runner.ts";
import type { ModelPrompt } from "./prompts.ts";

export interface ValidatedModelCallRecord extends ModelCallRecord {
  attempt: number;
  validationError?: string;
}

/** Marks an internal model response failure, rather than bad tool arguments or a bad opinion file. */
export class SummaryResponseError extends Error {
  readonly stage: string;
  readonly model: string;
  readonly validationError: string;

  constructor(stage: string, model: string, validationError: string) {
    super(`summarize_case could not validate the internal model response for ${stage} after 2 attempts (${model}). ` +
      `The opinion was loaded successfully; this is not a source_path or tool-argument error. Last response error: ${validationError}. ` +
      "Automatic response retry is exhausted. Do not repeatedly rerun the same call or silently substitute case_chat; report this model-output failure.");
    this.name = "SummaryResponseError";
    this.stage = stage;
    this.model = model;
    this.validationError = validationError;
  }
}

export async function runValidatedModelCall<T>(ctx: ExtensionContext, options: {
  stage: string;
  prompt: ModelPrompt;
  maxOutputTokens: number;
  signal?: AbortSignal;
  validate: (text: string) => T;
  onCall: (record: ValidatedModelCallRecord) => void;
  onRetry: (message: string) => void;
}): Promise<T> {
  let prompt = options.prompt;
  let maxOutputTokens = options.maxOutputTokens;
  for (let attempt = 1; attempt <= 2; attempt++) {
    options.signal?.throwIfAborted();
    // Transport, authentication, and context errors are not JSON errors and are not retried here.
    const output = await runModelCall(ctx, options.stage, prompt, maxOutputTokens, options.signal, { allowEmptyText: true });
    options.signal?.throwIfAborted();
    const record: ValidatedModelCallRecord = { ...output.record, attempt };
    let errorMessage: string;
    try {
      if (record.stopReason === "length") throw new Error("Response reached its output token limit; the structured response may be incomplete");
      if (!output.text) throw new Error("Model returned no JSON text");
      const value = options.validate(output.text);
      options.onCall(record);
      return value;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    record.validationError = errorMessage;
    options.onCall(record);
    if (attempt === 2) throw new SummaryResponseError(options.stage, record.model, errorMessage);

    options.onRetry(`${options.stage} returned invalid or incomplete structured output; retrying this stage once. ${errorMessage}`);
    prompt = { ...options.prompt, userPrompt: [
      options.prompt.userPrompt,
      "",
      "RESPONSE VALIDATION FEEDBACK (this stage only):",
      errorMessage,
      "Regenerate the complete JSON object from the supplied opinion and the concrete format example. Return every required field; do not return a patch, an explanation, or a partial response.",
      "Every summary-section entry must be an object with text, nonempty source_blocks, and confidence. Do not invent supporting references to repair the format. Escape quotation marks inside JSON strings.",
      "Use concise entries so the entire response fits the output limit. The validation error describes formatting or source references, not a legal conclusion.",
    ].join("\n") };
    // Increase a truncated response's budget only within the active model's advertised capacity.
    const available = ctx.model!.contextWindow - estimateModelInputTokens(prompt, ctx.model!.provider === "lmstudio") - 2_048;
    maxOutputTokens = Math.max(1, Math.min(ctx.model!.maxTokens, available,
      record.stopReason === "length" ? options.maxOutputTokens * 2 : options.maxOutputTokens));
  }
  throw new Error("Unreachable summary response state.");
}
