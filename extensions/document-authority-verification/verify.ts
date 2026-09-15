import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelCallRecord } from "../case-summarizer/model-runner.ts";
import type { LoadedCaseSource } from "../case-summarizer/source.ts";
import { runModelCall } from "../case-summarizer/model-runner.ts";
import { extractCitationOccurrences, normalizeCaseName } from "./citations.ts";
import { loadVerificationDocument } from "./document.ts";
import { renderVerificationMarkdown, saveVerificationOutput } from "./output.ts";
import { buildAuthorityAnalysisPrompt } from "./prompt.ts";
import { parseModelAuthorityFindings, type ModelAuthorityFinding } from "./schema.ts";
import {
  buildCaseSourceIndex,
  caseSourceRecord,
  loadIndexedSource,
  type CaseSourceIndex,
  type IndexedCaseSource,
} from "./sources.ts";
import {
  VERIFICATION_CHECKS,
  type DocumentAuthorityVerificationOptions,
  type ExtractedCitationOccurrence,
  type IdentityCheckResult,
  type PinciteCheckResult,
  type PropositionCheckResult,
  type QuoteCheckResult,
  type SpeakerCheckResult,
  type VerificationCheck,
  type VerificationCounts,
  type VerificationDetails,
  type VerificationToolDetails,
  type VerifiedCitationOccurrence,
} from "./types.ts";

const MODEL_CONCURRENCY_LIMIT = 3;
const MAX_DOCUMENT_OCCURRENCES = 500;

interface Resolution {
  descriptor?: IndexedCaseSource;
  loaded?: LoadedCaseSource;
  identity: IdentityCheckResult;
}

interface ExactQuoteMatch {
  sourceBlocks: string[];
  sourceQuote: string;
}

interface NormalizedTextMap {
  text: string;
  originalIndexes: number[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Document authority verification was cancelled.");
}

function emit(
  onUpdate: AgentToolUpdateCallback<VerificationToolDetails> | undefined,
  text: string,
  status: "reading_document" | "indexing_sources" | "checking" | "analyzing" | "saving",
  completed: number,
  total: number,
): void {
  onUpdate?.({ content: [{ type: "text", text }], details: { status, completed, total } });
}

function notCheckedIdentity(): IdentityCheckResult {
  return { status: "not_checked", explanation: "Citation identity was not requested.", candidatePaths: [], mismatches: [] };
}

function notCheckedQuote(): QuoteCheckResult {
  return { status: "not_checked", explanation: "Quotation verification was not requested.", sourceBlocks: [] };
}

function notCheckedPincite(): PinciteCheckResult {
  return { status: "not_checked", explanation: "Pincite verification was not requested.", sourceBlocks: [] };
}

function notCheckedSpeaker(): SpeakerCheckResult {
  return { status: "not_checked", explanation: "Speaker verification was not requested.", sourceBlocks: [] };
}

function notCheckedProposition(): PropositionCheckResult {
  return { status: "not_checked", explanation: "Proposition-support analysis was not requested.", sourceBlocks: [] };
}

function normalizedNameTokens(value: string): Set<string> {
  return new Set(normalizeCaseName(value).split(" ").filter((token) => token !== "v" && token.length > 1));
}

function namesCompatible(left: string, right: string): boolean {
  const first = normalizeCaseName(left);
  const second = normalizeCaseName(right);
  if (first === second || first.includes(second) || second.includes(first)) return true;
  const leftTokens = normalizedNameTokens(left);
  const rightTokens = normalizedNameTokens(right);
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap >= 2 && overlap / Math.max(leftTokens.size, rightTokens.size) >= 0.5;
}

function distinctIdentities(candidates: IndexedCaseSource[]): number {
  const groups: IndexedCaseSource[] = [];
  for (const candidate of candidates) {
    const same = groups.some((representative) => {
      const yearsMatch = !candidate.year || !representative.year || candidate.year === representative.year;
      const namesMatch = !candidate.title || !representative.title || namesCompatible(candidate.title, representative.title);
      return yearsMatch && namesMatch;
    });
    if (!same) groups.push(candidate);
  }
  return groups.length;
}

function chooseCandidate(candidates: IndexedCaseSource[]): IndexedCaseSource {
  return [...candidates].sort((left, right) => {
    if (left.explicit !== right.explicit) return left.explicit ? -1 : 1;
    if (Boolean(left.metadataPath) !== Boolean(right.metadataPath)) return left.metadataPath ? -1 : 1;
    return left.sourcePath.localeCompare(right.sourcePath);
  })[0];
}

async function resolveDirect(
  cwd: string,
  occurrence: ExtractedCitationOccurrence,
  index: CaseSourceIndex,
  identityRequested: boolean,
): Promise<Resolution> {
  const citationCandidates = occurrence.normalizedCitation
    ? index.byCitation.get(occurrence.normalizedCitation) ?? []
    : [];
  const nameCandidates = occurrence.caseName
    ? index.byName.get(normalizeCaseName(occurrence.caseName)) ?? []
    : [];
  const candidates = citationCandidates.length ? citationCandidates : nameCandidates;
  const candidatePaths = candidates.map((candidate) => candidate.sourcePath);
  if (!candidates.length) {
    return {
      identity: identityRequested
        ? {
          status: "not_found",
          explanation: "No unique matching case was found in the indexed local sources. No provider lookup was performed.",
          candidatePaths: [],
          mismatches: [],
        }
        : notCheckedIdentity(),
    };
  }
  if (candidates.length > 1 && distinctIdentities(candidates) > 1) {
    return {
      identity: identityRequested
        ? {
          status: "ambiguous_authority",
          explanation: "Multiple materially different local candidates matched; the tool refused to choose one.",
          candidatePaths,
          mismatches: [],
        }
        : notCheckedIdentity(),
    };
  }

  const descriptor = chooseCandidate(candidates);
  let loaded: LoadedCaseSource;
  try {
    loaded = await loadIndexedSource(cwd, descriptor);
  } catch (error) {
    return {
      descriptor,
      identity: identityRequested
        ? {
          status: "source_unavailable",
          explanation: `The matched source could not be loaded: ${errorMessage(error)}`,
          candidatePaths,
          mismatches: [],
        }
        : notCheckedIdentity(),
    };
  }

  const mismatches: string[] = [];
  if (occurrence.citedYear && descriptor.year && occurrence.citedYear !== descriptor.year) {
    mismatches.push(`The document gives year ${occurrence.citedYear}; local metadata gives ${descriptor.year}.`);
  }
  if (occurrence.caseName && descriptor.title && !namesCompatible(occurrence.caseName, descriptor.title)) {
    mismatches.push(`The document names “${occurrence.caseName}”; local metadata names “${descriptor.title}”.`);
  }
  return {
    descriptor,
    loaded,
    identity: identityRequested
      ? {
        status: mismatches.length ? "metadata_mismatch" : "verified",
        explanation: mismatches.length
          ? "The reporter identity resolved, but document and source metadata differ."
          : "The citation resolved uniquely to a local full-opinion source.",
        candidatePaths,
        mismatches,
      }
      : notCheckedIdentity(),
  };
}

async function resolveOccurrences(
  cwd: string,
  occurrences: ExtractedCitationOccurrence[],
  index: CaseSourceIndex,
  checks: Set<VerificationCheck>,
): Promise<Map<string, Resolution>> {
  const resolutions = new Map<string, Resolution>();
  for (const occurrence of occurrences) {
    if (occurrence.authorityType !== "case") {
      resolutions.set(occurrence.id, {
        identity: checks.has("citation_identity")
          ? {
            status: "unsupported_authority_type",
            explanation: `The first release inventories ${occurrence.authorityType} citations but verifies case law only.`,
            candidatePaths: [],
            mismatches: [],
          }
          : notCheckedIdentity(),
      });
      continue;
    }
    if (occurrence.linkedOccurrenceId) {
      const linked = resolutions.get(occurrence.linkedOccurrenceId);
      if (linked?.loaded && linked.descriptor) {
        resolutions.set(occurrence.id, {
          descriptor: linked.descriptor,
          loaded: linked.loaded,
          identity: checks.has("citation_identity")
            ? {
              status: linked.identity.status === "metadata_mismatch" ? "metadata_mismatch" : "verified",
              explanation: `The short form was linked to ${occurrence.linkedOccurrenceId}, which resolved to the local opinion.`,
              candidatePaths: [linked.loaded.sourcePath],
              mismatches: [...linked.identity.mismatches],
            }
            : notCheckedIdentity(),
        });
        continue;
      }
      resolutions.set(occurrence.id, {
        identity: checks.has("citation_identity")
          ? {
            status: "unresolved_short_form",
            explanation: `The short form points to ${occurrence.linkedOccurrenceId}, but that authority did not resolve to usable source text.`,
            candidatePaths: linked?.identity.candidatePaths ?? [],
            mismatches: [],
          }
          : notCheckedIdentity(),
      });
      continue;
    }
    if (occurrence.kind === "short_form" || occurrence.kind === "id") {
      resolutions.set(occurrence.id, {
        identity: checks.has("citation_identity")
          ? {
            status: "unresolved_short_form",
            explanation: "The short form could not be linked unambiguously to an earlier full citation.",
            candidatePaths: [],
            mismatches: [],
          }
          : notCheckedIdentity(),
      });
      continue;
    }
    resolutions.set(occurrence.id, await resolveDirect(cwd, occurrence, index, checks.has("citation_identity")));
  }
  return resolutions;
}

function replacementForCharacter(character: string): string {
  if (/\s/u.test(character) || character === "\u00a0") return " ";
  if (character === "“" || character === "”") return '"';
  if (character === "‘" || character === "’") return "'";
  if (character === "–" || character === "—" || character === "−") return "-";
  if (character === "…") return "...";
  if (character === "\u00ad") return "";
  return character;
}

function normalizeWithMap(value: string): NormalizedTextMap {
  let text = "";
  const originalIndexes: number[] = [];
  let previousWasSpace = false;
  for (let index = 0; index < value.length; index += 1) {
    const replacement = replacementForCharacter(value[index]);
    if (!replacement) continue;
    if (replacement === " ") {
      if (!previousWasSpace && text.length) {
        text += " ";
        originalIndexes.push(index);
      }
      previousWasSpace = true;
      continue;
    }
    previousWasSpace = false;
    text += replacement;
    for (let offset = 0; offset < replacement.length; offset += 1) originalIndexes.push(index);
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    originalIndexes.pop();
  }
  return { text, originalIndexes };
}

function sourceBlockRanges(source: LoadedCaseSource): Array<{ id: string; start: number; end: number }> {
  const ranges: Array<{ id: string; start: number; end: number }> = [];
  let position = 0;
  for (const block of source.blocks) {
    ranges.push({ id: block.id, start: position, end: position + block.text.length });
    position += block.text.length + 2;
  }
  return ranges;
}

function blocksForRange(source: LoadedCaseSource, start: number, end: number): string[] {
  return sourceBlockRanges(source)
    .filter((range) => start < range.end && end > range.start)
    .map((range) => range.id);
}

function exactQuoteMatch(source: LoadedCaseSource, quotation: string): ExactQuoteMatch | undefined {
  const haystack = normalizeWithMap(source.normalizedText);
  const needle = normalizeWithMap(quotation).text;
  if (!needle) return undefined;
  const normalizedStart = haystack.text.indexOf(needle);
  if (normalizedStart < 0) return undefined;
  const originalStart = haystack.originalIndexes[normalizedStart];
  const lastMapped = haystack.originalIndexes[normalizedStart + needle.length - 1];
  if (originalStart === undefined || lastMapped === undefined) return undefined;
  const originalEnd = lastMapped + 1;
  return {
    sourceBlocks: blocksForRange(source, originalStart, originalEnd),
    sourceQuote: source.normalizedText.slice(originalStart, originalEnd),
  };
}

function omissionQuoteMatch(source: LoadedCaseSource, quotation: string): ExactQuoteMatch | undefined {
  const pieces = quotation
    .split(/(?:\.\s*\.\s*\.|…|\[\s*(?:\.\s*){3}\])/)
    .map((piece) => normalizeWithMap(piece).text.trim())
    .filter((piece) => piece.length >= 15);
  if (pieces.length < 2) return undefined;
  const haystack = normalizeWithMap(source.normalizedText);
  let cursor = 0;
  let first = -1;
  let lastEnd = -1;
  for (const piece of pieces) {
    const found = haystack.text.indexOf(piece, cursor);
    if (found < 0 || (first >= 0 && found - cursor > 5_000)) return undefined;
    if (first < 0) first = found;
    lastEnd = found + piece.length;
    cursor = lastEnd;
  }
  const originalStart = haystack.originalIndexes[first];
  const originalEndIndex = haystack.originalIndexes[lastEnd - 1];
  if (originalStart === undefined || originalEndIndex === undefined) return undefined;
  const originalEnd = originalEndIndex + 1;
  return {
    sourceBlocks: blocksForRange(source, originalStart, originalEnd),
    sourceQuote: source.normalizedText.slice(originalStart, originalEnd),
  };
}

function verifyQuotation(
  occurrence: ExtractedCitationOccurrence,
  resolution: Resolution,
  requested: boolean,
): QuoteCheckResult {
  if (!requested) return notCheckedQuote();
  if (!occurrence.quotation) {
    return { status: "not_applicable", explanation: "No nearby direct quotation was associated with this citation.", sourceBlocks: [] };
  }
  if (!resolution.loaded) {
    return { status: "source_unavailable", explanation: "The quotation could not be checked without resolved opinion text.", sourceBlocks: [] };
  }
  const exact = exactQuoteMatch(resolution.loaded, occurrence.quotation);
  if (exact) {
    return {
      status: "verified",
      explanation: "The quoted words match the local opinion after controlled typography and whitespace normalization.",
      sourceBlocks: exact.sourceBlocks,
      sourceQuote: exact.sourceQuote,
    };
  }
  const omission = omissionQuoteMatch(resolution.loaded, occurrence.quotation);
  if (omission) {
    return {
      status: "manual_review_required",
      explanation: "Separated quotation segments occur in order, but omissions or editorial changes prevent exact verification.",
      sourceBlocks: omission.sourceBlocks,
      sourceQuote: omission.sourceQuote,
    };
  }
  return {
    status: "quote_mismatch",
    explanation: "The quotation was not found exactly in the resolved local opinion under the permitted normalization rules.",
    sourceBlocks: [],
  };
}

function pageMarkers(value: string): Array<{ page: string; start: number; end: number }> {
  const output: Array<{ page: string; start: number; end: number }> = [];
  const patterns = [
    /\[(?:\d+\s+)?[A-Za-z.\d ]+\s+(\d{1,7})\]/g,
    /\bpage\s+(\d{1,7})\b/gi,
    /(?:^|\s)\*(\d{1,7})(?=\s|$)/g,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      if (match[1]) output.push({ page: String(Number(match[1])), start: match.index, end: match.index + match[0].length });
    }
  }
  return output.sort((left, right) => left.start - right.start);
}

function verifyPincite(
  occurrence: ExtractedCitationOccurrence,
  resolution: Resolution,
  quote: QuoteCheckResult,
  requested: boolean,
): PinciteCheckResult {
  if (!requested) return notCheckedPincite();
  if (!occurrence.pincite) return { status: "not_applicable", explanation: "The citation contains no pinpoint page.", sourceBlocks: [] };
  if (!resolution.loaded) {
    return { status: "source_unavailable", explanation: "The pinpoint could not be checked without resolved opinion text.", sourceBlocks: [] };
  }
  const requestedPage = occurrence.pincite.match(/\d{1,7}/)?.[0];
  if (!requestedPage || !quote.sourceBlocks.length) {
    return {
      status: "pincite_unverifiable",
      explanation: "A source location for the cited proposition was not established, so the pinpoint was not verified.",
      sourceBlocks: quote.sourceBlocks,
    };
  }
  const text = resolution.loaded.normalizedText;
  const sourceQuote = quote.status === "verified" ? quote.sourceQuote : undefined;
  const start = sourceQuote ? text.indexOf(sourceQuote) : -1;
  // A page marker applies forward until the next marker. Nearby markers from
  // earlier pages or later in the same block do not locate the quotation.
  // Repeated quotations and editorial omissions do not establish one location.
  const uniqueLocation = sourceQuote && start >= 0 && text.indexOf(sourceQuote, start + 1) < 0;
  const markers = pageMarkers(text);
  const preceding = uniqueLocation ? markers.filter(marker => marker.end <= start).at(-1) : undefined;
  const crossesMarker = sourceQuote && markers.some(marker => marker.start >= start && marker.start < start + sourceQuote.length);
  const observedPage = preceding && !crossesMarker ? preceding.page : undefined;
  if (observedPage === String(Number(requestedPage)) && /^\d+$/.test(occurrence.pincite)) {
    return {
      status: "verified",
      explanation: `The matched quotation follows page marker ${observedPage} with no intervening page boundary.`,
      sourceBlocks: quote.sourceBlocks,
      observedPage: String(Number(requestedPage)),
    };
  }
  return {
    status: "pincite_unverifiable",
    explanation: observedPage
      ? `The matched quotation is located after page marker ${observedPage}; this does not establish pinpoint ${occurrence.pincite}.`
      : "The saved opinion does not establish a unique, exact quotation location within a marked page.",
    sourceBlocks: quote.sourceBlocks,
    observedPage,
  };
}

function initialSpeaker(
  occurrence: ExtractedCitationOccurrence,
  resolution: Resolution,
  requested: boolean,
): SpeakerCheckResult {
  if (!requested) return notCheckedSpeaker();
  if (!occurrence.quotation) {
    return { status: "not_applicable", explanation: "No direct quotation was associated with this occurrence.", sourceBlocks: [] };
  }
  if (!resolution.loaded) {
    return { status: "source_unavailable", explanation: "Speaker attribution could not be analyzed without opinion text.", sourceBlocks: [] };
  }
  return { status: "manual_review_required", explanation: "Speaker analysis has not completed.", sourceBlocks: [] };
}

function initialProposition(resolution: Resolution, requested: boolean, authorityType: string): PropositionCheckResult {
  if (!requested) return notCheckedProposition();
  if (authorityType !== "case") {
    return {
      status: "manual_review_required",
      explanation: "This first release does not evaluate proposition support for non-case authorities.",
      sourceBlocks: [],
    };
  }
  if (!resolution.loaded) {
    return { status: "source_unavailable", explanation: "Proposition support could not be analyzed without opinion text.", sourceBlocks: [] };
  }
  return { status: "manual_review_required", explanation: "Proposition-support analysis has not completed.", sourceBlocks: [] };
}

function normalizedIncludes(haystack: string, needle: string): boolean {
  return normalizeWithMap(haystack).text.includes(normalizeWithMap(needle).text);
}

function validateModelFinding(
  finding: ModelAuthorityFinding,
  occurrence: ExtractedCitationOccurrence,
  source: LoadedCaseSource,
  checks: Set<VerificationCheck>,
): { speaker?: SpeakerCheckResult; proposition?: PropositionCheckResult; warnings: string[] } {
  const warnings: string[] = [];
  const known = new Set(source.blocks.map((block) => block.id));
  const blockText = new Map(source.blocks.map((block) => [block.id, block.text]));
  const validEvidence = (ids: string[], quote: string | undefined, label: string): boolean => {
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) {
      warnings.push(`${label} cited unknown opinion blocks: ${unknown.join(", ")}.`);
      return false;
    }
    if (!quote) return false;
    const citedText = ids.map((id) => blockText.get(id) ?? "").join(" ");
    if (!normalizedIncludes(citedText, quote)) {
      warnings.push(`${label}'s evidence quotation was not found in its cited opinion blocks.`);
      return false;
    }
    return true;
  };

  let speaker: SpeakerCheckResult | undefined;
  if (checks.has("speaker") && occurrence.quotation) {
    const proposed = finding.speaker;
    const invalidNotApplicable = proposed?.status === "not_applicable";
    const conclusive = proposed && proposed.status !== "manual_review_required" && !invalidNotApplicable;
    if (!proposed || invalidNotApplicable || (conclusive && !validEvidence(proposed.sourceBlocks, proposed.evidenceQuote, `${occurrence.id} speaker`))) {
      speaker = {
        status: "manual_review_required",
        explanation: proposed
          ? "The model's speaker conclusion did not pass deterministic evidence validation."
          : "The model omitted the requested speaker analysis.",
        sourceBlocks: [],
      };
    } else {
      speaker = proposed;
    }
  }

  let proposition: PropositionCheckResult | undefined;
  if (checks.has("proposition_support")) {
    const proposed = finding.propositionSupport;
    const conclusive = proposed
      && proposed.status !== "manual_review_required"
      && proposed.status !== "insufficient_context";
    if (!proposed || (conclusive && !validEvidence(proposed.sourceBlocks, proposed.evidenceQuote, `${occurrence.id} proposition`))) {
      proposition = {
        status: "manual_review_required",
        explanation: proposed
          ? "The model's proposition conclusion did not pass deterministic evidence validation."
          : "The model omitted the requested proposition-support analysis.",
        sourceBlocks: [],
      };
    } else {
      proposition = proposed;
    }
  }
  return { speaker, proposition, warnings };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

export function calculateOverall(result: VerifiedCitationOccurrence, checks: Set<VerificationCheck>): VerifiedCitationOccurrence["overallStatus"] {
  if (!checks.size) return "not_checked";
  const values: string[] = [];
  if (checks.has("citation_identity")) values.push(result.identity.status);
  if (checks.has("quotation")) values.push(result.quotation.status);
  if (checks.has("pincite")) values.push(result.pincite.status);
  if (checks.has("speaker")) values.push(result.speaker.status);
  if (checks.has("proposition_support")) values.push(result.propositionSupport.status);
  if (values.every((status) => status === "not_checked" || status === "not_applicable")) return "not_checked";
  if (values.some((status) => [
    "metadata_mismatch", "quote_mismatch", "wrong_pincite", "wrong_speaker", "does_not_support", "not_addressed",
  ].includes(status))) return "issue_found";
  if (values.some((status) => [
    "ambiguous_authority", "not_found", "source_unavailable", "unresolved_short_form",
    "unsupported_authority_type", "manual_review_required", "pincite_unverifiable", "insufficient_context",
  ].includes(status))) return "manual_review_required";
  if (values.some((status) => ["supports_with_qualification", "holding_dicta_concern"].includes(status))) {
    return "verified_with_qualification";
  }
  return "verified";
}

function counts(results: VerifiedCitationOccurrence[]): VerificationCounts {
  return {
    occurrences: results.length,
    caseOccurrences: results.filter((result) => result.occurrence.authorityType === "case").length,
    unsupportedOccurrences: results.filter((result) => result.occurrence.authorityType !== "case").length,
    verified: results.filter((result) => result.overallStatus === "verified").length,
    qualified: results.filter((result) => result.overallStatus === "verified_with_qualification").length,
    issues: results.filter((result) => result.overallStatus === "issue_found").length,
    manualReview: results.filter((result) => result.overallStatus === "manual_review_required").length,
    notChecked: results.filter((result) => result.overallStatus === "not_checked").length,
  };
}

export async function runDocumentAuthorityVerification(
  options: DocumentAuthorityVerificationOptions,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<VerificationToolDetails> | undefined,
  ctx: ExtensionContext,
): Promise<{ markdown: string; details: VerificationDetails }> {
  throwIfAborted(signal);
  const checks = new Set<VerificationCheck>(options.checks ?? VERIFICATION_CHECKS);
  emit(onUpdate, "Reading and hashing the draft document...", "reading_document", 0, 1);
  const document = await loadVerificationDocument(ctx.cwd, options.document_path);
  const occurrences = extractCitationOccurrences(document);
  if (occurrences.length > MAX_DOCUMENT_OCCURRENCES) {
    throw new Error(
      `The document contains ${occurrences.length.toLocaleString()} extracted authority occurrences; ` +
      `the per-run limit is ${MAX_DOCUMENT_OCCURRENCES.toLocaleString()}. Split the document so no authorities are silently omitted.`,
    );
  }
  throwIfAborted(signal);

  emit(onUpdate, "Indexing local full-opinion sources...", "indexing_sources", 0, occurrences.length);
  const sourceIndex = await buildCaseSourceIndex({
    cwd: ctx.cwd,
    matterId: options.matter_id,
    caseSources: options.case_sources,
    sourceRoots: options.source_roots,
  });
  if (!sourceIndex.sources.length) {
    sourceIndex.coverage.warnings.push(
      "No usable local case sources were indexed. Citation occurrences remain unresolved until exact case files or source roots are supplied.",
    );
  }
  const resolutions = await resolveOccurrences(ctx.cwd, occurrences, sourceIndex, checks);
  throwIfAborted(signal);

  const authorityIds = new Map<string, string>();
  const results = occurrences.map((occurrence): VerifiedCitationOccurrence => {
    const resolution = resolutions.get(occurrence.id) ?? { identity: notCheckedIdentity() };
    let authorityId: string | undefined;
    let source;
    if (resolution.descriptor && resolution.loaded) {
      const key = resolution.loaded.sourcePath;
      authorityId = authorityIds.get(key);
      if (!authorityId) {
        authorityId = `A${String(authorityIds.size + 1).padStart(4, "0")}`;
        authorityIds.set(key, authorityId);
      }
      source = caseSourceRecord(resolution.descriptor, resolution.loaded);
    }
    const quotation = verifyQuotation(occurrence, resolution, checks.has("quotation"));
    const result: VerifiedCitationOccurrence = {
      occurrence,
      authorityId,
      source,
      overallStatus: "not_checked",
      identity: resolution.identity,
      quotation,
      pincite: verifyPincite(occurrence, resolution, quotation, checks.has("pincite")),
      speaker: initialSpeaker(occurrence, resolution, checks.has("speaker")),
      propositionSupport: initialProposition(resolution, checks.has("proposition_support"), occurrence.authorityType),
      warnings: [],
    };
    result.overallStatus = calculateOverall(result, checks);
    return result;
  });

  const modelCalls: ModelCallRecord[] = [];
  const modelErrors: string[] = [];
  if (checks.has("speaker") || checks.has("proposition_support")) {
    const grouped = new Map<string, { source: LoadedCaseSource; occurrences: ExtractedCitationOccurrence[] }>();
    for (const occurrence of occurrences) {
      const resolution = resolutions.get(occurrence.id);
      if (!resolution?.loaded) continue;
      const needsSpeaker = checks.has("speaker") && Boolean(occurrence.quotation);
      const needsProposition = checks.has("proposition_support");
      if (!needsSpeaker && !needsProposition) continue;
      const item = grouped.get(resolution.loaded.sourcePath) ?? { source: resolution.loaded, occurrences: [] };
      item.occurrences.push(occurrence);
      grouped.set(resolution.loaded.sourcePath, item);
    }
    const groups = [...grouped.values()].map((group, groupIndex) => ({ ...group, groupIndex }));
    let completed = 0;
    await mapWithConcurrency(groups, MODEL_CONCURRENCY_LIMIT, async (group) => {
      throwIfAborted(signal);
      try {
        const output = await runModelCall(
          ctx,
          `authority-analysis:${group.groupIndex + 1}`,
          buildAuthorityAnalysisPrompt(group.source, group.occurrences, checks),
          Math.min(6_000, 1_000 + group.occurrences.length * 700),
          signal,
        );
        modelCalls.push(output.record);
        const findings = parseModelAuthorityFindings(output.text);
        const expectedIds = new Set(group.occurrences.map((occurrence) => occurrence.id));
        const unexpected = findings.filter((finding) => !expectedIds.has(finding.occurrenceId));
        if (unexpected.length) {
          throw new Error(`Authority analysis returned unknown occurrence IDs: ${unexpected.map((finding) => finding.occurrenceId).join(", ")}.`);
        }
        const byId = new Map(findings.map((finding) => [finding.occurrenceId, finding]));
        for (const occurrence of group.occurrences) {
          const result = results.find((candidate) => candidate.occurrence.id === occurrence.id);
          if (!result) continue;
          const finding = byId.get(occurrence.id);
          if (!finding) {
            result.warnings.push("The model omitted this occurrence from its authority analysis.");
            continue;
          }
          const validated = validateModelFinding(finding, occurrence, group.source, checks);
          if (validated.speaker) result.speaker = validated.speaker;
          if (validated.proposition) result.propositionSupport = validated.proposition;
          result.warnings.push(...validated.warnings);
          result.overallStatus = calculateOverall(result, checks);
        }
      } catch (error) {
        throwIfAborted(signal);
        const message = errorMessage(error);
        modelErrors.push(`${group.source.sourcePath}: ${message}`);
        for (const occurrence of group.occurrences) {
          const result = results.find((candidate) => candidate.occurrence.id === occurrence.id);
          if (!result) continue;
          if (checks.has("speaker") && occurrence.quotation) {
            result.speaker = { status: "manual_review_required", explanation: `Speaker analysis failed: ${message}`, sourceBlocks: [] };
          }
          if (checks.has("proposition_support")) {
            result.propositionSupport = { status: "manual_review_required", explanation: `Proposition analysis failed: ${message}`, sourceBlocks: [] };
          }
          result.warnings.push("Model-assisted analysis did not complete for this authority.");
          result.overallStatus = calculateOverall(result, checks);
        }
      } finally {
        completed += 1;
        emit(onUpdate, `Analyzed ${completed} of ${groups.length} resolved authorities...`, "analyzing", completed, groups.length);
      }
    });
    modelCalls.sort((left, right) => left.stage.localeCompare(right.stage));
  }

  const warnings = [
    "Citation extraction is conservative. Unusual slip, neutral, malformed, or uncommon reporter formats may require manual inventory.",
    ...sourceIndex.coverage.warnings,
    ...modelErrors.map((error) => `Model analysis failed for ${error}`),
  ];
  const details: VerificationDetails = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: modelErrors.length ? "partial_failure" : "completed",
    document: {
      path: document.path,
      rawBytes: document.rawBytes,
      rawSha256: document.rawSha256,
      textSha256: document.textSha256,
      blockCount: document.blocks.length,
    },
    requestedChecks: [...checks],
    treatmentStatus: "not_checked",
    documentModified: false,
    coverage: sourceIndex.coverage,
    counts: counts(results),
    results,
    modelCalls,
    warnings,
  };
  let markdown = renderVerificationMarkdown(details);
  if (options.output_path) {
    emit(onUpdate, "Saving the verification report without overwriting existing work...", "saving", results.length, results.length);
    try {
      details.outputPath = await saveVerificationOutput(ctx.cwd, options.output_path, details, markdown);
    } catch (error) {
      details.status = "partial_failure";
      details.outputError = errorMessage(error);
      markdown = renderVerificationMarkdown(details);
    }
  }
  return { markdown, details };
}
