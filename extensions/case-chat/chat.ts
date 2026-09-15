import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runModelCall } from "../case-summarizer/model-runner.ts";
import { loadCaseSource, type LoadedCaseSource } from "../case-summarizer/source.ts";
import { validateCaseAnswer, renderCaseChatMarkdown, saveCaseChatOutput } from "./output.ts";
import { buildCaseQuestionPrompt } from "./prompt.ts";
import { parseCaseAnswer } from "./schema.ts";
import type {
  CaseChatAnsweredResult,
  CaseChatDetails,
  CaseChatFailedResult,
  CaseChatOptions,
  CaseChatResult,
  CaseChatToolDetails,
  CaseSourceRecord,
  SelectedCaseInput,
} from "./types.ts";

const CONCURRENCY_LIMIT = 3;

interface LoadedSelection {
  index: number;
  input: SelectedCaseInput;
  source: LoadedCaseSource;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Case chat was cancelled.");
}

function sourceRecord(source: LoadedCaseSource): CaseSourceRecord {
  return {
    path: source.sourcePath,
    metadataPath: source.metadataPath,
    caseKey: source.caseKey,
    provider: source.provider,
    rawBytes: source.rawBytes,
    blockCount: source.blocks.length,
    rawSha256: source.rawSha256,
    textSha256: source.textSha256,
  };
}

function emit(
  onUpdate: AgentToolUpdateCallback<CaseChatToolDetails> | undefined,
  text: string,
  status: "reading_sources" | "answering" | "saving",
  completedCases: number,
  totalCases: number,
): void {
  onUpdate?.({
    content: [{ type: "text", text }],
    details: { status, completedCases, totalCases },
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

async function loadSelection(
  input: SelectedCaseInput,
  index: number,
  cwd: string,
): Promise<LoadedSelection | CaseChatFailedResult> {
  try {
    const source = await loadCaseSource({
      cwd,
      sourcePath: input.source_path,
      metadataPath: input.metadata_path,
      caseKey: input.case_key,
    });
    return { index, input, source };
  } catch (error) {
    return {
      index,
      requestedSourcePath: input.source_path,
      caseKey: input.case_key,
      status: "source_error",
      error: errorMessage(error),
    };
  }
}

function rejectDuplicateSources(
  selections: Array<LoadedSelection | CaseChatFailedResult>,
): Array<LoadedSelection | CaseChatFailedResult> {
  const seen = new Map<string, number>();
  return selections.map((selection) => {
    if (!("input" in selection)) return selection;
    const firstIndex = seen.get(selection.source.sourcePath);
    if (firstIndex === undefined) {
      seen.set(selection.source.sourcePath, selection.index);
      return selection;
    }
    return {
      index: selection.index,
      requestedSourcePath: selection.input.source_path,
      caseKey: selection.source.caseKey ?? selection.input.case_key,
      status: "source_error",
      error: `The same resolved opinion was already selected at cases[${firstIndex}].`,
      source: sourceRecord(selection.source),
    };
  });
}

async function answerOneCase(
  selection: LoadedSelection,
  options: CaseChatOptions,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<CaseChatAnsweredResult | CaseChatFailedResult> {
  throwIfAborted(signal);
  try {
    const output = await runModelCall(
      ctx,
      `case-answer:${selection.index + 1}`,
      buildCaseQuestionPrompt(selection.source, {
        question: options.question,
        focus: options.focus,
      }),
      3_500,
      signal,
    );
    const parsed = parseCaseAnswer(output.text);
    const validated = validateCaseAnswer(parsed, selection.source);
    return {
      index: selection.index,
      requestedSourcePath: selection.input.source_path,
      status: validated.answer.status,
      source: sourceRecord(selection.source),
      answer: validated.answer,
      validationWarnings: validated.warnings,
      modelCall: output.record,
    };
  } catch (error) {
    throwIfAborted(signal);
    return {
      index: selection.index,
      requestedSourcePath: selection.input.source_path,
      caseKey: selection.source.caseKey ?? selection.input.case_key,
      status: "model_error",
      error: errorMessage(error),
      source: sourceRecord(selection.source),
    };
  }
}

export async function runCaseChat(
  options: CaseChatOptions,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<CaseChatToolDetails> | undefined,
  ctx: ExtensionContext,
): Promise<{ markdown: string; details: CaseChatDetails }> {
  throwIfAborted(signal);
  emit(onUpdate, `Reading ${options.cases.length} selected case file(s)...`, "reading_sources", 0, options.cases.length);
  const loaded = rejectDuplicateSources(await Promise.all(
    options.cases.map((input, index) => loadSelection(input, index, ctx.cwd)),
  ));
  throwIfAborted(signal);

  const validSelections = loaded.filter((item): item is LoadedSelection => "input" in item);
  const sourceFailures = loaded.filter((item): item is CaseChatFailedResult => !("input" in item));
  let completedCases = sourceFailures.length;
  const answered = await mapWithConcurrency(validSelections, CONCURRENCY_LIMIT, async (selection) => {
    const result = await answerOneCase(selection, options, signal, ctx);
    completedCases += 1;
    emit(
      onUpdate,
      `Completed ${completedCases} of ${options.cases.length} selected case(s)...`,
      "answering",
      completedCases,
      options.cases.length,
    );
    return result;
  });
  throwIfAborted(signal);

  const results: CaseChatResult[] = [...sourceFailures, ...answered].sort((left, right) => left.index - right.index);
  const failedCases = results.filter((result) => result.status === "source_error" || result.status === "model_error").length;
  const details: CaseChatDetails = {
    status: failedCases ? "partial_failure" : "completed",
    question: options.question,
    focus: options.focus,
    selectedCases: options.cases.length,
    completedCases: results.length - failedCases,
    failedCases,
    concurrencyLimit: 3,
    synthesisPerformed: false,
    results,
  };
  let markdown = renderCaseChatMarkdown(details);

  if (options.output_path) {
    emit(onUpdate, "Saving the ordered case-by-case results without overwriting existing work...", "saving", options.cases.length, options.cases.length);
    try {
      details.outputPath = await saveCaseChatOutput(ctx.cwd, options.output_path, details, markdown);
    } catch (error) {
      details.status = "partial_failure";
      details.outputError = errorMessage(error);
      markdown = renderCaseChatMarkdown(details);
    }
  }

  return { markdown, details };
}
