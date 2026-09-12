import { realpath, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type {
  PropositionCheckResult,
  SpeakerCheckResult,
  VerificationDetails,
  VerifiedCitationOccurrence,
} from "./types.ts";

function sourceReferences(ids: string[]): string {
  return ids.length ? ids.map((id) => `\`${id}\``).join(", ") : "none";
}

function renderSpeaker(value: SpeakerCheckResult): string {
  const identity = [value.speaker, value.opinionPart].filter(Boolean).join("; ");
  return [
    `- **Speaker:** ${value.status}${identity ? ` — ${identity}` : ""}`,
    `  - ${value.explanation}`,
    `  - Opinion blocks: ${sourceReferences(value.sourceBlocks)}`,
    value.evidenceQuote ? `  - Evidence: “${value.evidenceQuote}”` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function renderProposition(value: PropositionCheckResult): string {
  return [
    `- **Proposition support:** ${value.status}`,
    `  - ${value.explanation}`,
    `  - Opinion blocks: ${sourceReferences(value.sourceBlocks)}`,
    value.evidenceQuote ? `  - Evidence: “${value.evidenceQuote}”` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function renderResult(result: VerifiedCitationOccurrence): string {
  const item = result.occurrence;
  const source = result.source
    ? [
      `- **Resolved source:** \`${result.source.path}\``,
      result.source.title ? `- **Source title:** ${result.source.title}` : undefined,
      result.source.caseKey ? `- **Case key:** \`${result.source.caseKey}\`` : undefined,
      result.source.provider ? `- **Provider:** ${result.source.provider}` : undefined,
      `- **Source SHA-256:** \`${result.source.rawSha256}\``,
    ].filter((line): line is string => Boolean(line)).join("\n")
    : "- **Resolved source:** none";
  return [
    `## ${item.id} — ${item.rawCitation}`,
    `- **Overall status:** ${result.overallStatus}`,
    `- **Recommended action:** ${result.overallStatus === "verified"
      ? "No correction indicated by the requested checks; complete human review before reliance."
      : result.overallStatus === "verified_with_qualification"
        ? "Review and preserve the stated qualification before relying on this authority."
        : result.overallStatus === "issue_found"
          ? "Review the cited evidence and correct or explain the identified issue."
          : result.overallStatus === "manual_review_required"
            ? "Resolve the incomplete or ambiguous check manually before reliance."
            : "No requested check produced an applicable result."}`,
    `- **Authority type:** ${item.authorityType}; citation form: ${item.kind}`,
    `- **Draft location:** \`${item.documentBlock}\``,
    item.linkedOccurrenceId ? `- **Short-form antecedent:** \`${item.linkedOccurrenceId}\`` : undefined,
    `- **Proposition:** ${item.proposition}`,
    item.quotation ? `- **Draft quotation:** “${item.quotation}”` : "- **Draft quotation:** none associated",
    source,
    "### Check results",
    `- **Citation identity:** ${result.identity.status}
  - ${result.identity.explanation}`,
    result.identity.candidatePaths.length > 1
      ? `  - Candidates: ${result.identity.candidatePaths.map((path) => `\`${path}\``).join(", ")}`
      : "",
    result.identity.mismatches.length
      ? result.identity.mismatches.map((mismatch) => `  - Mismatch: ${mismatch}`).join("\n")
      : "",
    `- **Quotation:** ${result.quotation.status}
  - ${result.quotation.explanation}
  - Opinion blocks: ${sourceReferences(result.quotation.sourceBlocks)}`,
    result.quotation.sourceQuote ? `  - Source text: “${result.quotation.sourceQuote}”` : "",
    `- **Pincite:** ${result.pincite.status}
  - ${result.pincite.explanation}
  - Opinion blocks: ${sourceReferences(result.pincite.sourceBlocks)}`,
    renderSpeaker(result.speaker),
    renderProposition(result.propositionSupport),
    result.warnings.length
      ? "### Validation warnings\n\n" + result.warnings.map((warning) => `- ${warning}`).join("\n")
      : "",
  ].filter(Boolean).join("\n\n");
}

function resultPriority(result: VerifiedCitationOccurrence): number {
  if (result.overallStatus === "issue_found") return 0;
  if (result.overallStatus === "manual_review_required") return 1;
  if (result.overallStatus === "verified_with_qualification") return 2;
  if (result.overallStatus === "verified") return 3;
  return 4;
}

export function renderVerificationMarkdown(details: VerificationDetails): string {
  const counts = details.counts;
  const ordered = [...details.results].sort((left, right) => {
    const priority = resultPriority(left) - resultPriority(right);
    return priority || left.occurrence.id.localeCompare(right.occurrence.id);
  });
  return [
    "# Document authority verification",
    `- **Document:** \`${details.document.path}\``,
    `- **Run status:** ${details.status}`,
    `- **Generated:** ${details.generatedAt}`,
    `- **Checks:** ${details.requestedChecks.join(", ")}`,
    "- **Document modified:** no",
    "- **Subsequent treatment:** not checked",
    "## Summary",
    [
      `Occurrences: ${counts.occurrences}; case citations: ${counts.caseOccurrences}; other authority types: ${counts.unsupportedOccurrences}.`,
      `Verified: ${counts.verified}; qualified: ${counts.qualified}; issues: ${counts.issues}; manual review: ${counts.manualReview}; not checked: ${counts.notChecked}.`,
    ].join("\n\n"),
    "## Source coverage",
    [
      `- Indexed local opinion sources: ${details.coverage.indexedSources}`,
      `- Scanned roots: ${details.coverage.scannedRoots.length ? details.coverage.scannedRoots.map((root) => `\`${root}\``).join(", ") : "none"}`,
      `- Provider lookups performed: no`,
      `- Index truncated: ${details.coverage.truncated ? "yes" : "no"}`,
      `- Candidate files skipped as metadata sidecars or unusable sources: ${details.coverage.skippedSources}`,
      "- A local `not_found` result is not proof that an authority does not exist.",
    ].join("\n"),
    details.outputError ? `## Output warning\n\n${details.outputError}` : "",
    details.warnings.length ? "## Run warnings\n\n" + details.warnings.map((warning) => `- ${warning}`).join("\n") : "",
    ordered.length ? "# Findings" : "# Findings\n\n_No legal-authority citations were extracted from the supplied document._",
    ...ordered.map(renderResult),
    "# Review boundary",
    "This report verifies only the requested checks against the listed local sources. It is not Shepard's, KeyCite, a full citator report, or a determination that any authority remains good law. Statutes, rules, and secondary sources are inventoried but are not substantively verified in this release. Every consequential finding requires human review before filing or reliance.",
    "## Provenance",
    [
      `- Document SHA-256: \`${details.document.rawSha256}\``,
      `- Normalized document text SHA-256: \`${details.document.textSha256}\``,
      `- Model-assisted calls: ${details.modelCalls.length}`,
      ...details.modelCalls.map((call) => `- ${call.stage}: ${call.model}; stop reason ${call.stopReason}`),
    ].join("\n"),
  ].filter(Boolean).join("\n\n") + "\n";
}

async function resolveOutputPath(cwd: string, requestedPath: string): Promise<string> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requestedPath)) throw new Error("output_path must be a local file path, not a URL.");
  const workspaceRoot = await realpath(resolve(cwd));
  const candidate = resolve(workspaceRoot, requestedPath);
  const parent = await realpath(dirname(candidate));
  const relativeParent = relative(workspaceRoot, parent);
  if (relativeParent.startsWith("..") || isAbsolute(relativeParent)) {
    throw new Error("output_path must resolve inside Pi's current working directory.");
  }
  const extension = extname(candidate).toLowerCase();
  if (extension !== ".md" && extension !== ".json") throw new Error("output_path must end in .md or .json.");
  return candidate;
}

export async function saveVerificationOutput(
  cwd: string,
  requestedPath: string,
  details: VerificationDetails,
  markdown: string,
): Promise<string> {
  const outputPath = await resolveOutputPath(cwd, requestedPath);
  const content = extname(outputPath).toLowerCase() === ".json"
    ? `${JSON.stringify(details, null, 2)}\n`
    : markdown;
  await writeFile(outputPath, content, { encoding: "utf8", flag: "wx" });
  return outputPath;
}
