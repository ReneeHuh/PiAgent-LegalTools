import { renderOpinionMarkdown } from "../shared/opinion-markdown.ts";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import {
  SUMMARY_SECTION_NAMES,
  type StructuredCaseSummary,
  type SummaryAudit,
  type SummarySectionName,
  type SupportedStatement,
} from "./schema.ts";
import type { LoadedCaseSource } from "./source.ts";

const SECTION_TITLES: Record<SummarySectionName, string> = {
  executive_summary: "Executive summary",
  procedural_posture: "Procedural posture",
  material_facts: "Material facts",
  issues: "Issues",
  rules: "Rules",
  holdings: "Holdings",
  reasoning: "Reasoning",
  disposition: "Disposition",
  separate_opinions: "Separate opinions",
  limitations: "Limitations and unresolved points",
};

function normalizedQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function knownBlockIds(source: LoadedCaseSource): Set<string> {
  return new Set(source.blocks.map((block) => block.id));
}

function assertReferences(ids: string[], known: Set<string>, label: string): void {
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`${label} uses unknown source blocks: ${unknown.join(", ")}.`);
}

export function validateCandidateReferences(
  summary: StructuredCaseSummary,
  source: LoadedCaseSource,
  label: string,
): void {
  const known = knownBlockIds(source);
  for (const sectionName of SUMMARY_SECTION_NAMES) {
    summary[sectionName].forEach((statement, index) => {
      assertReferences(statement.source_blocks, known, `${label}.${sectionName}[${index}]`);
    });
  }
  summary.key_quotes.forEach((quote, index) => {
    assertReferences(quote.source_blocks, known, `${label}.key_quotes[${index}]`);
  });
}

export function validateAuditReferences(audit: SummaryAudit, source: LoadedCaseSource): void {
  const known = knownBlockIds(source);
  audit.findings.forEach((finding, index) => {
    assertReferences(finding.source_blocks, known, `audit.findings[${index}]`);
  });
}

export function finalizeSummary(
  summary: StructuredCaseSummary,
  source: LoadedCaseSource,
): { summary: StructuredCaseSummary; warnings: string[] } {
  validateCandidateReferences(summary, source, "final_summary");
  const blockMap = new Map(source.blocks.map((block) => [block.id, block.text]));
  const warnings: string[] = [];
  const verifiedQuotes = summary.key_quotes.filter((quote, index) => {
    const citedText = quote.source_blocks.map((id) => blockMap.get(id) ?? "").join(" ");
    if (normalizedQuote(citedText).includes(normalizedQuote(quote.text))) return true;
    warnings.push(
      `Removed key_quotes[${index}] because its exact normalized text was not found in its cited source blocks.`,
    );
    return false;
  });

  for (const section of ["issues", "holdings", "disposition"] as const) {
    if (summary[section].length === 0) {
      warnings.push(`The final summary contains no ${SECTION_TITLES[section].toLowerCase()} entries.`);
    }
  }

  return {
    summary: { ...summary, key_quotes: verifiedQuotes },
    warnings,
  };
}

function identityLine(label: string, value: string | null): string | undefined {
  return value ? `- **${label}:** ${value}` : undefined;
}

function renderStatements(statements: SupportedStatement[]): string {
  if (!statements.length) return "_Not established from the supplied opinion._";
  return statements
    .map((statement) => {
      const references = statement.source_blocks.map((id) => `\`${id}\``).join(", ");
      const confidence = statement.confidence === "high" ? "" : ` _(${statement.confidence})_`;
      return `- ${statement.text} [${references}]${confidence}`;
    })
    .join("\n");
}

export function renderSummaryMarkdown(
  summary: StructuredCaseSummary,
  source: LoadedCaseSource,
  warnings: string[],
): string {
  const identity = summary.case_identity;
  const title = identity.name ?? source.caseKey ?? "Case summary";
  const identityLines = [
    identityLine("Court", identity.court),
    identityLine("Date", identity.date),
    identityLine("Docket", identity.docket),
    identity.citations.length ? `- **Citations:** ${identity.citations.join(", ")}` : undefined,
    source.caseKey ? `- **Case key:** \`${source.caseKey}\`` : undefined,
  ].filter((value): value is string => Boolean(value));

  const sections = SUMMARY_SECTION_NAMES.map((section) => [
    `## ${SECTION_TITLES[section]}`,
    renderStatements(summary[section]),
  ].join("\n\n"));
  const quotes = summary.key_quotes.length
    ? summary.key_quotes.map((quote) => [
      `> ${quote.text}`,
      `> - ${quote.speaker}; ${quote.opinion_part}; ${quote.source_blocks.map((id) => `\`${id}\``).join(", ")}`,
    ].join("\n")).join("\n\n")
    : "_No deterministically verified key quotations included._";

  return renderOpinionMarkdown({ artifact_type: "case_summary", recipe_version: 1, generated_at: new Date().toISOString(), source_path: source.sourcePath, source_sha256: source.rawSha256 }, [
    `# ${title}`,
    identityLines.join("\n"),
    ...sections,
    "## Key quotations",
    quotes,
    "## Authority status",
    "Subsequent treatment: **not checked**. This summary is not a Shepard's, KeyCite, or good-law determination.",
    "## Source provenance",
    `- Source: \`${source.sourcePath}\``,
    `- Source SHA-256: \`${source.rawSha256}\``,
    `- Normalized text SHA-256: \`${source.textSha256}\``,
    warnings.length ? "## Validation warnings\n\n" + warnings.map((warning) => `- ${warning}`).join("\n") : "",
  ].filter(Boolean).join("\n\n") + "\n");
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

export async function saveSummaryOutput(
  cwd: string,
  requestedPath: string,
  summary: StructuredCaseSummary,
  markdown: string,
): Promise<string> {
  const outputPath = await resolveOutputPath(cwd, requestedPath);
  const content = extname(outputPath).toLowerCase() === ".json"
    ? `${JSON.stringify(summary, null, 2)}\n`
    : markdown;
  await writeFile(outputPath, content, { encoding: "utf8", flag: "wx" });
  return outputPath;
}

export async function saveDefaultSummaryOutput(
  cwd: string,
  sourcePath: string,
  summary: StructuredCaseSummary,
  markdown: string,
): Promise<string> {
  const stem = sourcePath.slice(0, -extname(sourcePath).length);
  for (let version = 1; version <= 1_000; version++) {
    const path = `${stem}.Summary${version === 1 ? "" : `.${version}`}.md`;
    try {
      return await saveSummaryOutput(cwd, path, summary, markdown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a summary filename without overwriting existing work; supply a new output_path.");
}
