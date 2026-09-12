import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelPrompt } from "./prompts.ts";

export interface ModelCallRecord {
  stage: string;
  model: string;
  api: string;
  responseFormat: "json_schema" | "text";
  responseSchemaName?: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  stopReason: string;
  usage: unknown;
}

export interface ModelCallOptions {
  allowEmptyText?: boolean;
  cacheRetention?: "none" | "short" | "long";
  sessionId?: string;
}

export interface ModelCallOutput {
  text: string;
  record: ModelCallRecord;
}

function responseText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export function estimateModelInputTokens(prompt: ModelPrompt, structuredOutput: boolean): number {
  const schemaCharacters = structuredOutput && prompt.responseSchema ? JSON.stringify(prompt.responseSchema).length : 0;
  return Math.ceil((prompt.systemPrompt.length + prompt.userPrompt.length + schemaCharacters) / 4);
}

export async function runModelCall(
  ctx: ExtensionContext,
  stage: string,
  prompt: ModelPrompt,
  requestedMaxTokens: number,
  signal?: AbortSignal,
  options: ModelCallOptions = {},
): Promise<ModelCallOutput> {
  const activeModel = ctx.model;
  if (!activeModel) throw new Error(`${stage} requires an active Pi model.`);
  if (!ctx.modelRegistry.hasConfiguredAuth(activeModel)) {
    throw new Error(`No configured authentication is available for ${activeModel.provider}/${activeModel.id}.`);
  }

  const structuredOutput = Boolean(prompt.responseSchema && activeModel.provider === "lmstudio");
  if (structuredOutput && activeModel.api !== "openai-responses" && activeModel.api !== "openai-completions") {
    throw new Error(`${stage}: LM Studio schema output requires an OpenAI-compatible model configuration.`);
  }
  // LM Studio's Responses endpoint ignored text.format in a live constraint probe.
  // Use its documented schema-capable endpoint for this request, preserving the active session model.
  const model = structuredOutput ? { ...activeModel, api: "openai-completions" as const,
    compat: { ...(activeModel.api === "openai-completions" ? activeModel.compat : {}),
      supportsDeveloperRole: false, maxTokensField: "max_tokens" as const },
  } : activeModel;
  const onPayload = structuredOutput ? (payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`${stage}: unexpected LM Studio request payload.`);
    return { ...payload, response_format: { type: "json_schema", json_schema: {
      name: prompt.responseSchema!.name, strict: true, schema: prompt.responseSchema!.schema,
    } } };
  } : undefined;

  const maxOutputTokens = Math.min(requestedMaxTokens, model.maxTokens);
  const estimatedInputTokens = estimateModelInputTokens(prompt, structuredOutput);
  const safetyMargin = 2_048;
  if (estimatedInputTokens + maxOutputTokens + safetyMargin > model.contextWindow) {
    throw new Error(
      `${stage} would exceed the active model context window: approximately ${estimatedInputTokens.toLocaleString()} ` +
      `input tokens plus ${maxOutputTokens.toLocaleString()} output tokens and a ${safetyMargin.toLocaleString()} token margin ` +
      `for a ${model.contextWindow.toLocaleString()} token model.`,
    );
  }

  const response = await ctx.modelRegistry.complete(
    model,
    {
      systemPrompt: prompt.systemPrompt,
      messages: [{
        role: "user",
        content: [{ type: "text", text: prompt.userPrompt }],
        timestamp: Date.now(),
      }],
    },
    {
      maxTokens: maxOutputTokens,
      signal,
      cacheRetention: options.cacheRetention ?? "none",
      sessionId: options.sessionId ?? randomUUID(),
      onPayload,
    },
  );

  const text = responseText(response.content);
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(`${stage} failed: ${response.errorMessage ?? response.stopReason}.`);
  }
  if (!text && !options.allowEmptyText) throw new Error(`${stage} returned no text.`);

  return {
    text,
    record: {
      stage,
      model: `${model.provider}/${model.id}`,
      api: model.api,
      responseFormat: structuredOutput ? "json_schema" : "text",
      responseSchemaName: structuredOutput ? prompt.responseSchema!.name : undefined,
      estimatedInputTokens,
      maxOutputTokens,
      stopReason: response.stopReason,
      usage: response.usage,
    },
  };
}
