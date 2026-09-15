import type { ModelCallRecord } from "../case-summarizer/model-runner.ts";

export const VERIFICATION_CHECKS = [
  "citation_identity",
  "quotation",
  "pincite",
  "speaker",
  "proposition_support",
] as const;

export type VerificationCheck = (typeof VERIFICATION_CHECKS)[number];

export interface VerificationCaseSourceInput {
  source_path: string;
  metadata_path?: string;
  case_key?: string;
}

export interface DocumentAuthorityVerificationOptions {
  document_path: string;
  checks?: VerificationCheck[];
  matter_id?: string;
  case_sources?: VerificationCaseSourceInput[];
  source_roots?: string[];
  output_path?: string;
}

export interface DocumentBlock {
  id: string;
  text: string;
}

export interface LoadedDocument {
  path: string;
  rawBytes: number;
  rawSha256: string;
  textSha256: string;
  normalizedText: string;
  blocks: DocumentBlock[];
}

export type CitationKind = "full" | "short_form" | "id" | "name_only" | "unsupported";
export type AuthorityType = "case" | "statute" | "rule" | "secondary_or_other";

export interface ExtractedCitationOccurrence {
  id: string;
  kind: CitationKind;
  authorityType: AuthorityType;
  rawCitation: string;
  caseName?: string;
  reporterCitation?: string;
  normalizedCitation?: string;
  reporterRoot?: string;
  volume?: string;
  reporter?: string;
  firstPage?: string;
  pincite?: string;
  parenthetical?: string;
  citedYear?: string;
  documentBlock: string;
  proposition: string;
  quotation?: string;
  start: number;
  end: number;
  linkedOccurrenceId?: string;
}

export interface CaseSourceIdentity {
  title?: string;
  citations: string[];
  normalizedCitations: string[];
  court?: string;
  year?: string;
  docket?: string;
}

export interface CaseSourceRecord extends CaseSourceIdentity {
  path: string;
  metadataPath?: string;
  caseKey?: string;
  provider?: string;
  rawBytes: number;
  blockCount: number;
  rawSha256: string;
  textSha256: string;
}

export type IdentityStatus =
  | "verified"
  | "metadata_mismatch"
  | "ambiguous_authority"
  | "not_found"
  | "source_unavailable"
  | "unresolved_short_form"
  | "unsupported_authority_type"
  | "not_checked";

export interface IdentityCheckResult {
  status: IdentityStatus;
  explanation: string;
  candidatePaths: string[];
  mismatches: string[];
}

export type QuoteStatus =
  | "verified"
  | "quote_mismatch"
  | "manual_review_required"
  | "not_applicable"
  | "source_unavailable"
  | "not_checked";

export interface QuoteCheckResult {
  status: QuoteStatus;
  explanation: string;
  sourceBlocks: string[];
  sourceQuote?: string;
}

export type PinciteStatus =
  | "verified"
  | "wrong_pincite"
  | "pincite_unverifiable"
  | "not_applicable"
  | "source_unavailable"
  | "not_checked";

export interface PinciteCheckResult {
  status: PinciteStatus;
  explanation: string;
  sourceBlocks: string[];
  observedPage?: string;
}

export type SpeakerStatus =
  | "verified"
  | "wrong_speaker"
  | "manual_review_required"
  | "not_applicable"
  | "source_unavailable"
  | "not_checked";

export interface SpeakerCheckResult {
  status: SpeakerStatus;
  explanation: string;
  sourceBlocks: string[];
  speaker?: string;
  opinionPart?: string;
  evidenceQuote?: string;
}

export type PropositionStatus =
  | "supports"
  | "supports_with_qualification"
  | "does_not_support"
  | "not_addressed"
  | "holding_dicta_concern"
  | "insufficient_context"
  | "manual_review_required"
  | "source_unavailable"
  | "not_checked";

export interface PropositionCheckResult {
  status: PropositionStatus;
  explanation: string;
  sourceBlocks: string[];
  evidenceQuote?: string;
}

export type OccurrenceOverallStatus =
  | "verified"
  | "verified_with_qualification"
  | "issue_found"
  | "manual_review_required"
  | "not_checked";

export interface VerifiedCitationOccurrence {
  occurrence: ExtractedCitationOccurrence;
  authorityId?: string;
  source?: CaseSourceRecord;
  overallStatus: OccurrenceOverallStatus;
  identity: IdentityCheckResult;
  quotation: QuoteCheckResult;
  pincite: PinciteCheckResult;
  speaker: SpeakerCheckResult;
  propositionSupport: PropositionCheckResult;
  warnings: string[];
}

export interface SourceCoverage {
  defaultCasesDirectoryChecked: boolean;
  matterCasesDirectoryChecked: boolean;
  requestedRoots: string[];
  scannedRoots: string[];
  explicitSources: number;
  indexedSources: number;
  skippedSources: number;
  truncated: boolean;
  providerLookupsPerformed: false;
  warnings: string[];
}

export interface VerificationCounts {
  occurrences: number;
  caseOccurrences: number;
  unsupportedOccurrences: number;
  verified: number;
  qualified: number;
  issues: number;
  manualReview: number;
  notChecked: number;
}

export interface VerificationDetails {
  schemaVersion: 1;
  generatedAt: string;
  status: "completed" | "partial_failure";
  document: Omit<LoadedDocument, "normalizedText" | "blocks"> & { blockCount: number };
  requestedChecks: VerificationCheck[];
  treatmentStatus: "not_checked";
  documentModified: false;
  coverage: SourceCoverage;
  counts: VerificationCounts;
  results: VerifiedCitationOccurrence[];
  modelCalls: ModelCallRecord[];
  warnings: string[];
  outputPath?: string;
  outputError?: string;
}

export interface VerificationProgressDetails {
  status: "reading_document" | "indexing_sources" | "checking" | "analyzing" | "saving";
  completed: number;
  total: number;
}

export type VerificationToolDetails = VerificationDetails | VerificationProgressDetails;
