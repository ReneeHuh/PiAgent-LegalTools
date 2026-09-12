import { randomUUID } from "node:crypto";
import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runValidatedModelCall, type ValidatedModelCallRecord } from "./validated-model.ts";
import {
  buildAuditPrompt,
  buildCandidatePrompt,
  buildFinalPrompt,
  CANDIDATE_ROLES,
  type SummaryRequest,
} from "./prompts.ts";
import { parseCaseSummary, parseSummaryAudit, type StructuredCaseSummary, type SummaryAudit } from "./schema.ts";
import { loadCaseSource } from "./source.ts";
import {
  finalizeSummary,
  renderSummaryMarkdown,
  saveSummaryOutput,
  saveDefaultSummaryOutput,
  validateAuditReferences,
  validateCandidateReferences,
} from "./output.ts";

export interface SummarizeCaseOptions extends SummaryRequest {
  source_path: string;
  metadata_path?: string;
  case_key?: string;
  output_path?: string;
}

export interface CaseSummaryDetails {
  status: "completed";
  pipeline: "three_blind_analyses_then_combined_audit_then_fresh_reconstruction";
  callsAttempted: number;
  callsCompleted: number;
  source: {
    path: string;
    metadataPath?: string;
    caseKey?: string;
    provider?: string;
    rawBytes: number;
    blockCount: number;
    rawSha256: string;
    textSha256: string;
  };
  request: SummaryRequest;
  summary: StructuredCaseSummary;
  audit: SummaryAudit;
  validationWarnings: string[];
  outputPath: string;
  modelCalls: ValidatedModelCallRecord[];
}

export interface CaseSummaryProgressDetails {
  status: "reading_source" | "analyzing" | "retrying" | "auditing" | "reconstructing" | "saving";
  completedCalls: number;
  totalCalls: number;
}

export type CaseSummarizerToolDetails = CaseSummaryDetails | CaseSummaryProgressDetails | { status: "failed" | "cancelled"; error: string };

function emit(
  onUpdate: AgentToolUpdateCallback<CaseSummarizerToolDetails> | undefined,
  text: string,
  details: CaseSummaryProgressDetails,
): void {
  onUpdate?.({ content: [{ type: "text", text }], details });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Case summarization was cancelled.");
}

export async function runCaseSummarizer(
  options: SummarizeCaseOptions,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<CaseSummarizerToolDetails> | undefined,
  ctx: ExtensionContext,
): Promise<{ markdown: string; details: CaseSummaryDetails }> {
  throwIfAborted(signal);
  emit(onUpdate, "Reading and normalizing the supplied opinion...", {
    status: "reading_source",
    completedCalls: 0,
    totalCalls: 5,
  });
  const source = await loadCaseSource({
    cwd: ctx.cwd,
    sourcePath: options.source_path,
    metadataPath: options.metadata_path,
    caseKey: options.case_key,
  });
  const request: SummaryRequest = {
    audience: options.audience,
    focus: options.focus,
  };
  const modelCalls: ValidatedModelCallRecord[] = [];
  let plannedCalls = 5;
  const onCall = (record: ValidatedModelCallRecord) => { modelCalls.push(record); };
  const onRetry = (message: string) => {
    plannedCalls++;
    emit(onUpdate, message, { status: "retrying", completedCalls: modelCalls.length, totalCalls: plannedCalls });
  };
  const cache = { cacheRetention: "short" as const, sessionId: randomUUID() };
  const candidates: StructuredCaseSummary[] = [];
  for (const [index, role] of CANDIDATE_ROLES.entries()) {
    throwIfAborted(signal);
    emit(onUpdate, `Running independent analysis ${index + 1} of 3: ${role.name}...`, {
      status: "analyzing",
      completedCalls: modelCalls.length,
      totalCalls: plannedCalls,
    });
    candidates.push(await runValidatedModelCall(ctx, {
      stage: `candidate:${role.name}`,
      prompt: buildCandidatePrompt(role, source, request),
      maxOutputTokens: 5_000,
      signal,
      cache,
      onCall,
      onRetry,
      validate: text => {
        const candidate = parseCaseSummary(text, `candidate ${index + 1}`);
        validateCandidateReferences(candidate, source, `candidate_${index + 1}`);
        return candidate;
      },
    }));
  }
  throwIfAborted(signal);

  emit(onUpdate, "Auditing source accuracy, quotations, attribution, completeness, holdings, dicta, and reasoning...", {
    status: "auditing",
    completedCalls: modelCalls.length,
    totalCalls: plannedCalls,
  });
  const audit = await runValidatedModelCall(ctx, {
    stage: "combined-audit",
    prompt: buildAuditPrompt(source, request, candidates),
    maxOutputTokens: 5_000,
    signal,
    cache,
    onCall,
    onRetry,
    validate: text => {
      const audit = parseSummaryAudit(text);
      validateAuditReferences(audit, source);
      return audit;
    },
  });
  throwIfAborted(signal);

  emit(onUpdate, "Reconstructing a new final summary from the opinion, analyses, and audit...", {
    status: "reconstructing",
    completedCalls: modelCalls.length,
    totalCalls: plannedCalls,
  });
  const parsedFinal = await runValidatedModelCall(ctx, {
    stage: "final-reconstruction",
    prompt: buildFinalPrompt(source, request, candidates, audit),
    maxOutputTokens: 7_000,
    signal,
    cache,
    onCall,
    onRetry,
    validate: text => {
      const summary = parseCaseSummary(text, "final summary");
      validateCandidateReferences(summary, source, "final_summary");
      return summary;
    },
  });
  throwIfAborted(signal);
  const finalized = finalizeSummary(parsedFinal, source);
  const markdown = renderSummaryMarkdown(finalized.summary, source, finalized.warnings);

  emit(onUpdate, "Saving the validated summary without overwriting existing work...", {
    status: "saving",
    completedCalls: modelCalls.length,
    totalCalls: plannedCalls,
  });
  throwIfAborted(signal);
  const outputPath = options.output_path
    ? await saveSummaryOutput(ctx.cwd, options.output_path, finalized.summary, markdown)
    : await saveDefaultSummaryOutput(ctx.cwd, source.sourcePath, finalized.summary, markdown);

  const result: { markdown: string; details: CaseSummaryDetails } = {
    markdown,
    details: {
      status: "completed",
      pipeline: "three_blind_analyses_then_combined_audit_then_fresh_reconstruction",
      callsAttempted: modelCalls.length,
      callsCompleted: modelCalls.length,
      source: {
        path: source.sourcePath,
        metadataPath: source.metadataPath,
        caseKey: source.caseKey,
        provider: source.provider,
        rawBytes: source.rawBytes,
        blockCount: source.blocks.length,
        rawSha256: source.rawSha256,
        textSha256: source.textSha256,
      },
      request,
      summary: finalized.summary,
      audit,
      validationWarnings: finalized.warnings,
      outputPath,
      modelCalls,
    },
  };
  onUpdate?.({ content: [{ type: "text", text: `Summary saved: ${outputPath}` }], details: result.details });
  return result;
}
