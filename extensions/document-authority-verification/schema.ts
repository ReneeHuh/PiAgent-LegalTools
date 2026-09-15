import type {
  PropositionCheckResult,
  PropositionStatus,
  SpeakerCheckResult,
  SpeakerStatus,
} from "./types.ts";

export interface ModelAuthorityFinding {
  occurrenceId: string;
  speaker?: SpeakerCheckResult;
  propositionSupport?: PropositionCheckResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredString(value, field);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) => requiredString(item, `${field}[${index}]`));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate = fenced ?? (start >= 0 && end > start ? trimmed.slice(start, end + 1) : "");
  if (!candidate) throw new Error("Authority analysis did not contain a JSON object.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Authority analysis returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error("Authority analysis must be a JSON object.");
  return parsed;
}

const SPEAKER_STATUSES = new Set<SpeakerStatus>([
  "verified", "wrong_speaker", "manual_review_required", "not_applicable", "source_unavailable", "not_checked",
]);

const PROPOSITION_STATUSES = new Set<PropositionStatus>([
  "supports", "supports_with_qualification", "does_not_support", "not_addressed", "holding_dicta_concern",
  "insufficient_context", "manual_review_required", "source_unavailable", "not_checked",
]);

function parseSpeaker(value: unknown, field: string): SpeakerCheckResult | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${field} must be an object or null.`);
  const status = requiredString(value.status, `${field}.status`) as SpeakerStatus;
  if (!SPEAKER_STATUSES.has(status)) throw new Error(`${field}.status is invalid.`);
  return {
    status,
    explanation: requiredString(value.explanation, `${field}.explanation`),
    sourceBlocks: stringArray(value.source_blocks, `${field}.source_blocks`),
    speaker: optionalString(value.speaker, `${field}.speaker`),
    opinionPart: optionalString(value.opinion_part, `${field}.opinion_part`),
    evidenceQuote: optionalString(value.evidence_quote, `${field}.evidence_quote`),
  };
}

function parseProposition(value: unknown, field: string): PropositionCheckResult | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${field} must be an object or null.`);
  const status = requiredString(value.status, `${field}.status`) as PropositionStatus;
  if (!PROPOSITION_STATUSES.has(status)) throw new Error(`${field}.status is invalid.`);
  return {
    status,
    explanation: requiredString(value.explanation, `${field}.explanation`),
    sourceBlocks: stringArray(value.source_blocks, `${field}.source_blocks`),
    evidenceQuote: optionalString(value.evidence_quote, `${field}.evidence_quote`),
  };
}

export function parseModelAuthorityFindings(text: string): ModelAuthorityFinding[] {
  const value = parseJsonObject(text);
  if (value.schema_version !== 1) throw new Error("Authority analysis schema_version must equal 1.");
  if (!Array.isArray(value.findings)) throw new Error("Authority analysis findings must be an array.");
  const seen = new Set<string>();
  return value.findings.map((item, index) => {
    const field = `findings[${index}]`;
    if (!isRecord(item)) throw new Error(`${field} must be an object.`);
    const occurrenceId = requiredString(item.occurrence_id, `${field}.occurrence_id`);
    if (seen.has(occurrenceId)) throw new Error(`Authority analysis repeated ${occurrenceId}.`);
    seen.add(occurrenceId);
    return {
      occurrenceId,
      speaker: parseSpeaker(item.speaker, `${field}.speaker`),
      propositionSupport: parseProposition(item.proposition_support, `${field}.proposition_support`),
    };
  });
}

export function modelAuthorityFindingShape(): string {
  return `{
  "schema_version": 1,
  "findings": [{
    "occurrence_id": string,
    "speaker": null | {
      "status": "verified" | "wrong_speaker" | "manual_review_required" | "not_applicable",
      "speaker": string | null,
      "opinion_part": string | null,
      "explanation": string,
      "source_blocks": string[],
      "evidence_quote": string | null
    },
    "proposition_support": null | {
      "status": "supports" | "supports_with_qualification" | "does_not_support" | "not_addressed" | "holding_dicta_concern" | "insufficient_context" | "manual_review_required",
      "explanation": string,
      "source_blocks": string[],
      "evidence_quote": string | null
    }
  }]
}`;
}
