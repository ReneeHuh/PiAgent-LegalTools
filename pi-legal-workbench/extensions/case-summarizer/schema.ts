import { Type } from "typebox";

export const SUMMARY_SECTION_NAMES = [
  "executive_summary",
  "procedural_posture",
  "material_facts",
  "issues",
  "rules",
  "holdings",
  "reasoning",
  "disposition",
  "separate_opinions",
  "limitations",
] as const;

export type SummarySectionName = (typeof SUMMARY_SECTION_NAMES)[number];
export type Confidence = "high" | "medium" | "manual_review_required";

export interface SupportedStatement {
  text: string;
  source_blocks: string[];
  confidence: Confidence;
}

export interface CaseIdentity {
  name: string | null;
  court: string | null;
  date: string | null;
  docket: string | null;
  citations: string[];
}

export interface VerifiedQuote {
  text: string;
  source_blocks: string[];
  speaker: string;
  opinion_part: string;
}

export interface StructuredCaseSummary {
  schema_version: 1;
  case_identity: CaseIdentity;
  executive_summary: SupportedStatement[];
  procedural_posture: SupportedStatement[];
  material_facts: SupportedStatement[];
  issues: SupportedStatement[];
  rules: SupportedStatement[];
  holdings: SupportedStatement[];
  reasoning: SupportedStatement[];
  disposition: SupportedStatement[];
  separate_opinions: SupportedStatement[];
  limitations: SupportedStatement[];
  key_quotes: VerifiedQuote[];
  treatment_status: "not_checked";
}

export type AuditCategory =
  | "source_accuracy"
  | "quote_or_attribution"
  | "completeness"
  | "holding_or_dicta"
  | "reasoning";

export interface AuditFinding {
  category: AuditCategory;
  severity: "critical" | "high" | "medium" | "low";
  target: string;
  finding: string;
  source_blocks: string[];
  required_correction: string;
}

export interface SummaryAudit {
  disagreements: string[];
  findings: AuditFinding[];
  required_corrections: string[];
}

const NonemptyText = Type.String({ minLength: 1 });
const SourceBlockId = Type.String({ pattern: "^P[0-9]{5,}$" });
const StatementSchema = Type.Object({
  text: NonemptyText,
  source_blocks: Type.Array(SourceBlockId, { minItems: 1 }),
  confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("manual_review_required")]),
}, { additionalProperties: false });
const StatementArray = Type.Array(StatementSchema);

/** Provider-facing schemas require every field and reject extra object properties. */
export const CaseSummaryResponseSchema = Type.Object({
  schema_version: Type.Literal(1),
  case_identity: Type.Object({
    name: Type.Union([NonemptyText, Type.Null()]),
    court: Type.Union([NonemptyText, Type.Null()]),
    date: Type.Union([NonemptyText, Type.Null()]),
    docket: Type.Union([NonemptyText, Type.Null()]),
    citations: Type.Array(NonemptyText),
  }, { additionalProperties: false }),
  ...Object.fromEntries(SUMMARY_SECTION_NAMES.map(section => [section, StatementArray])) as Record<SummarySectionName, typeof StatementArray>,
  key_quotes: Type.Array(Type.Object({
    text: NonemptyText,
    source_blocks: Type.Array(SourceBlockId, { minItems: 1 }),
    speaker: NonemptyText,
    opinion_part: NonemptyText,
  }, { additionalProperties: false })),
  treatment_status: Type.Literal("not_checked"),
}, { additionalProperties: false });

export const SummaryAuditResponseSchema = Type.Object({
  disagreements: Type.Array(NonemptyText),
  findings: Type.Array(Type.Object({
    category: Type.Union(["source_accuracy", "quote_or_attribution", "completeness", "holding_or_dicta", "reasoning"].map(value => Type.Literal(value))),
    severity: Type.Union(["critical", "high", "medium", "low"].map(value => Type.Literal(value))),
    target: NonemptyText,
    finding: NonemptyText,
    source_blocks: Type.Array(SourceBlockId),
    required_correction: NonemptyText,
  }, { additionalProperties: false })),
  required_corrections: Type.Array(NonemptyText),
}, { additionalProperties: false });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
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

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = fenced ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  if (!candidate || !candidate.startsWith("{") || !candidate.endsWith("}")) {
    throw new Error(`${label} did not return a JSON object.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} returned invalid JSON: ${message}`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object.`);
  return parsed;
}

function parseStatement(value: unknown, field: string): SupportedStatement {
  if (!isRecord(value)) throw new Error(`${field} must be an object with text, source_blocks, and confidence; bare strings are not supported.`);
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

function parseStatements(value: unknown, field: string): SupportedStatement[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) => parseStatement(item, `${field}[${index}]`));
}

function parseIdentity(value: unknown): CaseIdentity {
  if (!isRecord(value)) throw new Error("case_identity must be an object.");
  return {
    name: nullableString(value.name, "case_identity.name"),
    court: nullableString(value.court, "case_identity.court"),
    date: nullableString(value.date, "case_identity.date"),
    docket: nullableString(value.docket, "case_identity.docket"),
    citations: stringArray(value.citations, "case_identity.citations"),
  };
}

function parseQuotes(value: unknown): VerifiedQuote[] {
  if (!Array.isArray(value)) throw new Error("key_quotes must be an array.");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`key_quotes[${index}] must be an object.`);
    return {
      text: requiredString(item.text, `key_quotes[${index}].text`),
      source_blocks: stringArray(item.source_blocks, `key_quotes[${index}].source_blocks`, false),
      speaker: requiredString(item.speaker, `key_quotes[${index}].speaker`),
      opinion_part: requiredString(item.opinion_part, `key_quotes[${index}].opinion_part`),
    };
  });
}

export function parseCaseSummary(text: string, label: string): StructuredCaseSummary {
  const value = parseJsonObject(text, label);
  if (value.schema_version !== 1) throw new Error(`${label}.schema_version must equal 1.`);
  if (value.treatment_status !== "not_checked") {
    throw new Error(`${label}.treatment_status must equal not_checked.`);
  }

  const sections = Object.fromEntries(
    SUMMARY_SECTION_NAMES.map((name) => [name, parseStatements(value[name], name)]),
  ) as Record<SummarySectionName, SupportedStatement[]>;

  return {
    schema_version: 1,
    case_identity: parseIdentity(value.case_identity),
    ...sections,
    key_quotes: parseQuotes(value.key_quotes),
    treatment_status: "not_checked",
  };
}

const AUDIT_CATEGORIES = new Set<AuditCategory>([
  "source_accuracy",
  "quote_or_attribution",
  "completeness",
  "holding_or_dicta",
  "reasoning",
]);

export function parseSummaryAudit(text: string): SummaryAudit {
  const value = parseJsonObject(text, "summary audit");
  if (!Array.isArray(value.findings)) throw new Error("summary audit findings must be an array.");
  const findings = value.findings.map((item, index): AuditFinding => {
    if (!isRecord(item)) throw new Error(`findings[${index}] must be an object.`);
    const category = requiredString(item.category, `findings[${index}].category`) as AuditCategory;
    if (!AUDIT_CATEGORIES.has(category)) throw new Error(`findings[${index}].category is invalid.`);
    const severity = requiredString(item.severity, `findings[${index}].severity`);
    if (severity !== "critical" && severity !== "high" && severity !== "medium" && severity !== "low") {
      throw new Error(`findings[${index}].severity is invalid.`);
    }
    return {
      category,
      severity,
      target: requiredString(item.target, `findings[${index}].target`),
      finding: requiredString(item.finding, `findings[${index}].finding`),
      source_blocks: stringArray(item.source_blocks, `findings[${index}].source_blocks`),
      required_correction: requiredString(
        item.required_correction,
        `findings[${index}].required_correction`,
      ),
    };
  });

  return {
    disagreements: stringArray(value.disagreements, "summary audit disagreements"),
    findings,
    required_corrections: stringArray(
      value.required_corrections,
      "summary audit required_corrections",
    ),
  };
}

export function caseSummaryJsonShape(): string {
  return JSON.stringify({
    schema_version: 1,
    case_identity: { name: "<name from source>", court: null, date: null, docket: null, citations: [] },
    ...Object.fromEntries(SUMMARY_SECTION_NAMES.map(section => [section, [{
      text: `<${section} statement supported by the opinion>`,
      source_blocks: ["P00001"],
      confidence: "medium",
    }]])),
    key_quotes: [{ text: "<exact source quotation>", source_blocks: ["P00001"], speaker: "<speaker from source>", opinion_part: "<opinion part from source>" }],
    treatment_status: "not_checked",
  }, null, 2);
}

export function summaryAuditJsonShape(): string {
  return JSON.stringify({
    disagreements: ["<substantive disagreement, if any>"],
    findings: [{ category: "source_accuracy", severity: "high", target: "<candidate and field>",
      finding: "<specific problem established from the source>", source_blocks: ["P00001"],
      required_correction: "<source-supported correction>" }],
    required_corrections: ["<required correction, if any>"],
  }, null, 2);
}
