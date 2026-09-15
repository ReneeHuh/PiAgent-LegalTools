export type CaseAnswerStatus = "answered" | "partially_answered" | "not_addressed";
export type CaseAnswerConfidence = "high" | "medium" | "manual_review_required";

export interface CaseAnswerIdentity {
  name: string | null;
  court: string | null;
  date: string | null;
  docket: string | null;
  citations: string[];
}

export interface CaseAnswerStatement {
  text: string;
  source_blocks: string[];
  confidence: CaseAnswerConfidence;
}

export interface RelevantPassage {
  quote: string;
  source_blocks: string[];
  speaker: string;
  opinion_part: string;
}

export interface StructuredCaseAnswer {
  schema_version: 1;
  case_identity: CaseAnswerIdentity;
  status: CaseAnswerStatus;
  answer: CaseAnswerStatement[];
  relevant_passages: RelevantPassage[];
  limitations: CaseAnswerStatement[];
  treatment_status: "not_checked";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, field);
}

function stringArray(value: unknown, field: string, allowEmpty = true): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  const result = value.map((item, index) => requiredString(item, `${field}[${index}]`));
  if (!allowEmpty && result.length === 0) throw new Error(`${field} must not be empty.`);
  return result;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate = fenced ?? (start >= 0 && end > start ? trimmed.slice(start, end + 1) : "");
  if (!candidate) throw new Error("The case answer did not contain a JSON object.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The case answer returned invalid JSON: ${message}`);
  }
  if (!isRecord(parsed)) throw new Error("The case answer must be a JSON object.");
  return parsed;
}

function parseIdentity(value: unknown): CaseAnswerIdentity {
  if (!isRecord(value)) throw new Error("case_identity must be an object.");
  return {
    name: nullableString(value.name, "case_identity.name"),
    court: nullableString(value.court, "case_identity.court"),
    date: nullableString(value.date, "case_identity.date"),
    docket: nullableString(value.docket, "case_identity.docket"),
    citations: stringArray(value.citations, "case_identity.citations"),
  };
}

function parseStatement(value: unknown, field: string): CaseAnswerStatement {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  const confidence = requiredString(value.confidence, `${field}.confidence`);
  if (confidence !== "high" && confidence !== "medium" && confidence !== "manual_review_required") {
    throw new Error(`${field}.confidence is invalid.`);
  }
  return {
    text: requiredString(value.text, `${field}.text`),
    source_blocks: stringArray(value.source_blocks, `${field}.source_blocks`, false),
    confidence,
  };
}

function parseStatements(value: unknown, field: string): CaseAnswerStatement[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) => parseStatement(item, `${field}[${index}]`));
}

function parsePassages(value: unknown): RelevantPassage[] {
  if (!Array.isArray(value)) throw new Error("relevant_passages must be an array.");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`relevant_passages[${index}] must be an object.`);
    return {
      quote: requiredString(item.quote, `relevant_passages[${index}].quote`),
      source_blocks: stringArray(item.source_blocks, `relevant_passages[${index}].source_blocks`, false),
      speaker: requiredString(item.speaker, `relevant_passages[${index}].speaker`),
      opinion_part: requiredString(item.opinion_part, `relevant_passages[${index}].opinion_part`),
    };
  });
}

export function parseCaseAnswer(text: string): StructuredCaseAnswer {
  const value = parseJsonObject(text);
  if (value.schema_version !== 1) throw new Error("schema_version must equal 1.");
  if (value.status !== "answered" && value.status !== "partially_answered" && value.status !== "not_addressed") {
    throw new Error("status is invalid.");
  }
  if (value.treatment_status !== "not_checked") {
    throw new Error("treatment_status must equal not_checked.");
  }
  const answer = parseStatements(value.answer, "answer");
  if (value.status === "not_addressed" && answer.length !== 0) {
    throw new Error("A not_addressed result must not contain a substantive answer.");
  }
  if (value.status !== "not_addressed" && answer.length === 0) {
    throw new Error(`${value.status} requires at least one supported answer statement.`);
  }
  return {
    schema_version: 1,
    case_identity: parseIdentity(value.case_identity),
    status: value.status,
    answer,
    relevant_passages: parsePassages(value.relevant_passages),
    limitations: parseStatements(value.limitations, "limitations"),
    treatment_status: "not_checked",
  };
}

export function caseAnswerJsonShape(): string {
  return `{
  "schema_version": 1,
  "case_identity": { "name": string|null, "court": string|null, "date": string|null, "docket": string|null, "citations": string[] },
  "status": "answered"|"partially_answered"|"not_addressed",
  "answer": { "text": string, "source_blocks": string[], "confidence": "high"|"medium"|"manual_review_required" }[],
  "relevant_passages": { "quote": string, "source_blocks": string[], "speaker": string, "opinion_part": string }[],
  "limitations": { "text": string, "source_blocks": string[], "confidence": "high"|"medium"|"manual_review_required" }[],
  "treatment_status": "not_checked"
}`;
}
