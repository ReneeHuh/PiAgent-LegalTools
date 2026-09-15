import { randomUUID } from "node:crypto";
import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runValidatedModelCall, type ValidatedModelCallRecord } from "./validated-model.ts";
import {
  buildAuditPrompt,
  buildCandidatePrompt,
  buildFinalPrompt,
  buildMultipartAuditPrompt,
  buildMultipartCandidatePrompt,
  buildMultipartFinalPrompt,
  CANDIDATE_ROLES,
  opinionPartContext,
  type PartialOpinionSummary,
  type SummaryRequest,
} from "./prompts.ts";
import { parseCaseSummary, parseSummaryAudit, type StructuredCaseSummary, type SummaryAudit } from "./schema.ts";
import { loadCaseSource, type LoadedCaseSource } from "./source.ts";
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
  pipeline: "three_blind_analyses_then_combined_audit_then_fresh_reconstruction" | "overlapping_parts_then_combined_audit_then_reconstruction";
  multipart?: {
    partCount: number;
    partTokenLimit: number;
    overlapTokens: number;
  };
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

export const PART_TOKEN_LIMIT = 120_000;
export const PART_OVERLAP_TOKENS = 2_000;
const MULTIPART_THRESHOLD_TOKENS = 170_000;

function blockTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function sourceWithBlocks(source: LoadedCaseSource, blocks: LoadedCaseSource["blocks"]): LoadedCaseSource {
  const normalizedText = blocks.map(block => block.text).join("\n\n");
  return { ...source, blocks, normalizedText, estimatedTokens: Math.ceil(normalizedText.length / 4) };
}

export function splitSourceIntoOverlappingParts(
  source: LoadedCaseSource,
  tokenLimit = PART_TOKEN_LIMIT,
  overlapTokens = PART_OVERLAP_TOKENS,
): LoadedCaseSource[] {
  if (!Number.isInteger(tokenLimit) || tokenLimit < 1) throw new Error("Multipart token limit must be a positive integer.");
  if (!Number.isInteger(overlapTokens) || overlapTokens < 0 || overlapTokens >= tokenLimit) {
    throw new Error("Multipart overlap must be a nonnegative integer smaller than the part token limit.");
  }
  const parts: LoadedCaseSource[] = [];
  let start = 0;
  while (start < source.blocks.length) {
    let end = start;
    let tokens = 0;
    while (end < source.blocks.length) {
      const nextTokens = blockTokens(source.blocks[end].text);
      if (end > start && tokens + nextTokens > tokenLimit) break;
      tokens += nextTokens;
      end += 1;
    }
    parts.push(sourceWithBlocks(source, source.blocks.slice(start, end)));
    if (end >= source.blocks.length) break;
    let nextStart = end;
    let overlap = 0;
    while (nextStart > start && overlap < overlapTokens) {
      nextStart -= 1;
      overlap += blockTokens(source.blocks[nextStart].text);
    }
    start = nextStart === start ? end : nextStart;
  }
  return parts;
}

function evidenceSource(source: LoadedCaseSource, partials: StructuredCaseSummary[]): LoadedCaseSource {
  const referenced = new Set<string>();
  for (const partial of partials) {
    for (const section of Object.values(partial)) {
      if (!Array.isArray(section)) continue;
      for (const item of section) {
        if (item && typeof item === "object" && "source_blocks" in item && Array.isArray(item.source_blocks)) {
          for (const id of item.source_blocks) if (typeof id === "string") referenced.add(id);
        }
      }
    }
  }
  const indexes = new Set<number>();
  source.blocks.forEach((block, index) => {
    if (!referenced.has(block.id)) return;
    indexes.add(index);
    if (index > 0) indexes.add(index - 1);
    if (index + 1 < source.blocks.length) indexes.add(index + 1);
  });
  if (!indexes.size && source.blocks.length) {
    indexes.add(0);
    if (source.blocks.length > 1) indexes.add(source.blocks.length - 1);
  }
  return sourceWithBlocks(source, [...indexes].sort((a, b) => a - b).map(index => source.blocks[index]));
}

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
  const parts = source.estimatedTokens > MULTIPART_THRESHOLD_TOKENS
    ? splitSourceIntoOverlappingParts(source)
    : undefined;
  let plannedCalls = parts ? parts.length + 2 : 5;
  const onCall = (record: ValidatedModelCallRecord) => { modelCalls.push(record); };
  const onRetry = (message: string) => {
    plannedCalls++;
    emit(onUpdate, message, { status: "retrying", completedCalls: modelCalls.length, totalCalls: plannedCalls });
  };
  const cache = { cacheRetention: "short" as const, sessionId: randomUUID() };
  const candidates: StructuredCaseSummary[] = [];
  const partials: PartialOpinionSummary[] = [];
  if (parts) {
    for (const [index, part] of parts.entries()) {
      throwIfAborted(signal);
      emit(onUpdate, `Analyzing overlapping opinion part ${index + 1} of ${parts.length}...`, {
        status: "analyzing", completedCalls: modelCalls.length, totalCalls: plannedCalls,
      });
      candidates.push(await runValidatedModelCall(ctx, {
        stage: `part:${index + 1}-of-${parts.length}`,
        prompt: buildMultipartCandidatePrompt(part, request, index + 1, parts.length, opinionPartContext(parts, index)),
        maxOutputTokens: 5_000,
        signal, cache, onCall, onRetry,
        validate: text => {
          const candidate = parseCaseSummary(text, `part ${index + 1}`);
          validateCandidateReferences(candidate, part, `part_${index + 1}`);
          return candidate;
        },
      }));
      partials.push({ ...opinionPartContext(parts, index), summary: candidates.at(-1)! });
    }
  } else {
    for (const [index, role] of CANDIDATE_ROLES.entries()) {
      throwIfAborted(signal);
      emit(onUpdate, `Running independent analysis ${index + 1} of 3: ${role.name}...`, {
        status: "analyzing", completedCalls: modelCalls.length, totalCalls: plannedCalls,
      });
      candidates.push(await runValidatedModelCall(ctx, {
        stage: `candidate:${role.name}`,
        prompt: buildCandidatePrompt(role, source, request),
        maxOutputTokens: 5_000,
        signal, cache, onCall, onRetry,
        validate: text => {
          const candidate = parseCaseSummary(text, `candidate ${index + 1}`);
          validateCandidateReferences(candidate, source, `candidate_${index + 1}`);
          return candidate;
        },
      }));
    }
  }
  throwIfAborted(signal);

  const auditSource = parts ? evidenceSource(source, candidates) : source;
  emit(onUpdate, parts
    ? "Auditing the partial summaries against their cited source blocks and adjacent context..."
    : "Auditing source accuracy, quotations, attribution, completeness, holdings, dicta, and reasoning...", {
    status: "auditing", completedCalls: modelCalls.length, totalCalls: plannedCalls,
  });
  const audit = await runValidatedModelCall(ctx, {
    stage: "combined-audit",
    prompt: parts
      ? buildMultipartAuditPrompt(auditSource, request, partials)
      : buildAuditPrompt(source, request, candidates),
    maxOutputTokens: 5_000,
    signal, cache, onCall, onRetry,
    validate: text => {
      const parsed = parseSummaryAudit(text);
      validateAuditReferences(parsed, auditSource);
      return parsed;
    },
  });
  throwIfAborted(signal);

  emit(onUpdate, parts
    ? "Combining the ordered partial summaries into one final summary..."
    : "Reconstructing a new final summary from the opinion, analyses, and audit...", {
    status: "reconstructing", completedCalls: modelCalls.length, totalCalls: plannedCalls,
  });
  const parsedFinal = await runValidatedModelCall(ctx, {
    stage: "final-reconstruction",
    prompt: parts
      ? buildMultipartFinalPrompt(auditSource, request, partials, audit)
      : buildFinalPrompt(source, request, candidates, audit),
    maxOutputTokens: 7_000,
    signal, cache, onCall, onRetry,
    validate: text => {
      const summary = parseCaseSummary(text, "final summary");
      validateCandidateReferences(summary, source, "final_summary");
      return summary;
    },
  });
  throwIfAborted(signal);
  const finalized = finalizeSummary(parsedFinal, source);
  if (parts) {
    finalized.warnings.push(
      `The ${source.estimatedTokens.toLocaleString()}-token opinion used ${parts.length} overlapping parts ` +
      `of at most ${PART_TOKEN_LIMIT.toLocaleString()} estimated tokens with ${PART_OVERLAP_TOKENS.toLocaleString()}-token overlap.`,
    );
  }
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
      pipeline: parts
        ? "overlapping_parts_then_combined_audit_then_reconstruction"
        : "three_blind_analyses_then_combined_audit_then_fresh_reconstruction",
      multipart: parts ? {
        partCount: parts.length,
        partTokenLimit: PART_TOKEN_LIMIT,
        overlapTokens: PART_OVERLAP_TOKENS,
      } : undefined,
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
