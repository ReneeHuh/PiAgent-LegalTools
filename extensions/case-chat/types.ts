import type { ModelCallRecord } from "../case-summarizer/model-runner.ts";
import type { StructuredCaseAnswer } from "./schema.ts";

export interface SelectedCaseInput {
  source_path: string;
  metadata_path?: string;
  case_key?: string;
}

export interface CaseChatOptions {
  cases: SelectedCaseInput[];
  question: string;
  focus?: string;
  output_path?: string;
}

export interface CaseSourceRecord {
  path: string;
  metadataPath?: string;
  caseKey?: string;
  provider?: string;
  rawBytes: number;
  blockCount: number;
  rawSha256: string;
  textSha256: string;
}

export interface CaseChatAnsweredResult {
  index: number;
  requestedSourcePath: string;
  status: StructuredCaseAnswer["status"];
  source: CaseSourceRecord;
  answer: StructuredCaseAnswer;
  validationWarnings: string[];
  modelCall: ModelCallRecord;
}

export interface CaseChatFailedResult {
  index: number;
  requestedSourcePath: string;
  caseKey?: string;
  status: "source_error" | "model_error";
  error: string;
  source?: CaseSourceRecord;
}

export type CaseChatResult = CaseChatAnsweredResult | CaseChatFailedResult;

export interface CaseChatDetails {
  status: "completed" | "partial_failure";
  question: string;
  focus?: string;
  selectedCases: number;
  completedCases: number;
  failedCases: number;
  concurrencyLimit: 3;
  synthesisPerformed: false;
  results: CaseChatResult[];
  outputPath?: string;
  outputError?: string;
}

export interface CaseChatProgressDetails {
  status: "reading_sources" | "answering" | "saving";
  completedCases: number;
  totalCases: number;
}

export type CaseChatToolDetails = CaseChatDetails | CaseChatProgressDetails;
