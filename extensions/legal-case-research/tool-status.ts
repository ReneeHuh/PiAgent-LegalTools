import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { isAbortError } from "./browser.ts";

export type ToolLifecycleStatus = "running" | "completed" | "stopped" | "partial_failure" | "failed" | "cancelled";

interface ToolResultLike {
  details?: unknown;
}

interface RunWithToolStatusOptions<T extends ToolResultLike> {
  tool: string;
  toolCallId: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<any>;
  operation: (onUpdate: AgentToolUpdateCallback<any> | undefined) => Promise<T>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resultStatus(result: ToolResultLike): string | undefined {
  if (!result.details || typeof result.details !== "object") return undefined;
  const status = (result.details as Record<string, unknown>).status;
  return typeof status === "string" && status ? status : undefined;
}

/** Progress updates are advisory and must never break the underlying tool call. */
export function emitToolStatus(
  onUpdate: AgentToolUpdateCallback<any> | undefined,
  tool: string,
  toolCallId: string,
  message: string,
  phase: string,
  status: ToolLifecycleStatus,
  details: Record<string, unknown> = {},
): void {
  try {
    onUpdate?.({
      content: [{ type: "text", text: message }],
      details: { ...details, tool, toolCallId, phase, status, message },
    });
  } catch {
    // A UI/status callback must not change the research result.
  }
}

/** Add the public tool identity to detailed updates emitted by nested workflows. */
export function scopeToolUpdates(
  onUpdate: AgentToolUpdateCallback<any> | undefined,
  tool: string,
  toolCallId: string,
): AgentToolUpdateCallback<any> | undefined {
  if (!onUpdate) return undefined;
  return (update) => {
    try {
      const details = update.details && typeof update.details === "object"
        ? update.details as Record<string, unknown>
        : {};
      let textMessage: string | undefined;
      if (Array.isArray(update.content)) {
        const textContent = update.content.find((item) => item.type === "text");
        if (textContent?.type === "text") textMessage = textContent.text;
      }
      onUpdate({
        ...update,
        details: {
          status: "running",
          ...(textMessage ? { message: textMessage } : {}),
          ...details,
          tool,
          toolCallId,
        },
      });
    } catch {
      // Nested progress is also best-effort.
    }
  };
}

export async function runWithToolStatus<T extends ToolResultLike>(
  options: RunWithToolStatusOptions<T>,
): Promise<T> {
  const { tool, toolCallId, signal, onUpdate, operation } = options;
  emitToolStatus(onUpdate, tool, toolCallId, `Starting ${tool}.`, "starting", "running");
  const scopedUpdate = scopeToolUpdates(onUpdate, tool, toolCallId);

  try {
    const output = await operation(scopedUpdate);
    const outcomeStatus = resultStatus(output);
    const suffix = outcomeStatus ? ` Result status: ${outcomeStatus}.` : "";
    if (signal?.aborted) {
      emitToolStatus(
        onUpdate,
        tool,
        toolCallId,
        `Cancelled ${tool}.${suffix}`,
        "cancelled",
        "cancelled",
        outcomeStatus ? { resultStatus: outcomeStatus } : {},
      );
      return output;
    }
    const paused = outcomeStatus === "stopped" || outcomeStatus === "paused";
    const partial = outcomeStatus === "partial_failure" || outcomeStatus === "download_failed";
    const terminalStatus: ToolLifecycleStatus = paused ? "stopped" : partial ? "partial_failure" : "completed";
    const details = output.details && typeof output.details === "object" ? output.details as Record<string, unknown> : {};
    const recovery = paused ? " Saved progress is preserved; use the returned resume fields or retry selection."
      : partial ? " Successful sources are preserved; inspect the per-result errors and retry only pending work." : "";
    emitToolStatus(
      onUpdate,
      tool,
      toolCallId,
      `${paused ? "Paused" : partial ? "Partially finished" : "Finished"} ${tool}.${suffix}${recovery}`,
      terminalStatus,
      terminalStatus,
      { resultStatus: outcomeStatus, runId: details.runId, resumePage: details.resumePage, pagesRemaining: details.pagesRemaining, retry: details.retry },
    );
    return output;
  } catch (error) {
    const cancelled = isAbortError(error, signal);
    const status: ToolLifecycleStatus = cancelled ? "cancelled" : "failed";
    emitToolStatus(
      onUpdate,
      tool,
      toolCallId,
      `${cancelled ? "Cancelled" : "Failed"} ${tool}: ${errorMessage(error)}`,
      status,
      status,
      { error: errorMessage(error) },
    );
    throw error;
  }
}
