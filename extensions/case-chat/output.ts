import { realpath, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { LoadedCaseSource } from "../case-summarizer/source.ts";
import type { CaseAnswerStatement, StructuredCaseAnswer } from "./schema.ts";
import type { CaseChatAnsweredResult, CaseChatDetails, CaseChatFailedResult, CaseChatResult } from "./types.ts";

function normalizeQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function assertBlockReferences(
  ids: string[],
  knownIds: Set<string>,
  label: string,
): void {
  const unknown = ids.filter((id) => !knownIds.has(id));
  if (unknown.length) throw new Error(`${label} uses unknown source blocks: ${unknown.join(", ")}.`);
}

export function validateCaseAnswer(
  answer: StructuredCaseAnswer,
  source: LoadedCaseSource,
): { answer: StructuredCaseAnswer; warnings: string[] } {
  const knownIds = new Set(source.blocks.map((block) => block.id));
  const blockText = new Map(source.blocks.map((block) => [block.id, block.text]));
  answer.answer.forEach((statement, index) => {
    assertBlockReferences(statement.source_blocks, knownIds, `answer[${index}]`);
  });
  answer.limitations.forEach((statement, index) => {
    assertBlockReferences(statement.source_blocks, knownIds, `limitations[${index}]`);
  });

  const warnings: string[] = [];
  const verifiedPassages = answer.relevant_passages.filter((passage, index) => {
    assertBlockReferences(passage.source_blocks, knownIds, `relevant_passages[${index}]`);
    const citedText = passage.source_blocks.map((id) => blockText.get(id) ?? "").join(" ");
    if (normalizeQuote(citedText).includes(normalizeQuote(passage.quote))) return true;
    warnings.push(
      `Removed relevant_passages[${index}] because its exact normalized text was not found in its cited source blocks.`,
    );
    return false;
  });

  return {
    answer: { ...answer, relevant_passages: verifiedPassages },
    warnings,
  };
}

function renderStatements(statements: CaseAnswerStatement[]): string {
  if (!statements.length) return "_None._";
  return statements.map((statement) => {
    const references = statement.source_blocks.map((id) => `\`${id}\``).join(", ");
    const confidence = statement.confidence === "high" ? "" : ` _(${statement.confidence})_`;
    return `- ${statement.text} [${references}]${confidence}`;
  }).join("\n");
}

function renderAnsweredResult(result: CaseChatAnsweredResult): string {
  const answer = result.answer;
  const identity = answer.case_identity;
  const title = identity.name ?? result.source.caseKey ?? `Case ${result.index + 1}`;
  const metadata = [
    `- **Status:** ${result.status}`,
    identity.court ? `- **Court:** ${identity.court}` : undefined,
    identity.date ? `- **Date:** ${identity.date}` : undefined,
    identity.docket ? `- **Docket:** ${identity.docket}` : undefined,
    identity.citations.length ? `- **Citations:** ${identity.citations.join(", ")}` : undefined,
    result.source.caseKey ? `- **Case key:** \`${result.source.caseKey}\`` : undefined,
  ].filter((value): value is string => Boolean(value)).join("\n");
  const passages = answer.relevant_passages.length
    ? answer.relevant_passages.map((passage) => [
      `> ${passage.quote}`,
      `> - ${passage.speaker}; ${passage.opinion_part}; ${passage.source_blocks.map((id) => `\`${id}\``).join(", ")}`,
    ].join("\n")).join("\n\n")
    : "_No deterministically verified quotation included._";

  return [
    `## ${result.index + 1}. ${title}`,
    metadata,
    "### Answer",
    answer.status === "not_addressed"
      ? "The supplied opinion does not address the question."
      : renderStatements(answer.answer),
    "### Relevant passages",
    passages,
    "### Limitations",
    renderStatements(answer.limitations),
    "### Source",
    `- Path: \`${result.source.path}\`\n- SHA-256: \`${result.source.rawSha256}\``,
    result.validationWarnings.length
      ? "### Validation warnings\n\n" + result.validationWarnings.map((warning) => `- ${warning}`).join("\n")
      : "",
    "Subsequent treatment: **not checked**.",
  ].filter(Boolean).join("\n\n");
}

function renderFailedResult(result: CaseChatFailedResult): string {
  return [
    `## ${result.index + 1}. ${result.caseKey ?? result.requestedSourcePath}`,
    `- **Status:** ${result.status}`,
    `- **Error:** ${result.error}`,
  ].join("\n");
}

function isFailedResult(result: CaseChatResult): result is CaseChatFailedResult {
  return "error" in result;
}

export function renderCaseChatMarkdown(details: CaseChatDetails): string {
  const results = details.results.map((result) => {
    return isFailedResult(result) ? renderFailedResult(result) : renderAnsweredResult(result);
  });
  return [
    "# Case-by-case answers",
    `**Question:** ${details.question}`,
    details.focus ? `**Focus:** ${details.focus}` : "",
    `Selected cases: ${details.selectedCases}; completed: ${details.completedCases}; failed: ${details.failedCases}.`,
    "Each answer was generated from that case alone. No cross-case synthesis was performed.",
    details.outputError ? `**Output warning:** ${details.outputError}` : "",
    ...results,
    "## Authority status",
    "Subsequent treatment was not checked. These answers are not a Shepard's, KeyCite, or good-law determination.",
  ].filter(Boolean).join("\n\n") + "\n";
}

async function resolveOutputPath(cwd: string, requestedPath: string): Promise<string> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requestedPath)) {
    throw new Error("output_path must be a local file path, not a URL.");
  }
  const workspaceRoot = await realpath(resolve(cwd));
  const candidate = resolve(workspaceRoot, requestedPath);
  const parent = await realpath(dirname(candidate));
  const relativeParent = relative(workspaceRoot, parent);
  if (relativeParent.startsWith("..") || isAbsolute(relativeParent)) {
    throw new Error("output_path must resolve inside Pi's current working directory.");
  }
  const extension = extname(candidate).toLowerCase();
  if (extension !== ".md" && extension !== ".json") {
    throw new Error("output_path must end in .md or .json.");
  }
  return candidate;
}

export async function saveCaseChatOutput(
  cwd: string,
  requestedPath: string,
  details: CaseChatDetails,
  markdown: string,
): Promise<string> {
  const outputPath = await resolveOutputPath(cwd, requestedPath);
  const content = extname(outputPath).toLowerCase() === ".json"
    ? `${JSON.stringify(details, null, 2)}\n`
    : markdown;
  await writeFile(outputPath, content, { encoding: "utf8", flag: "wx" });
  return outputPath;
}
