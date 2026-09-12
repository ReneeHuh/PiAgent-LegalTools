import type { LoadedCaseSource } from "../case-summarizer/source.ts";
import type { ModelPrompt } from "../case-summarizer/prompts.ts";
import { modelAuthorityFindingShape } from "./schema.ts";
import type { ExtractedCitationOccurrence, VerificationCheck } from "./types.ts";

function sourceText(source: LoadedCaseSource): string {
  return source.blocks.map((block) => `[${block.id}] ${block.text}`).join("\n\n");
}

export function buildAuthorityAnalysisPrompt(
  source: LoadedCaseSource,
  occurrences: ExtractedCitationOccurrence[],
  checks: Set<VerificationCheck>,
): ModelPrompt {
  const requested = {
    speaker: checks.has("speaker"),
    proposition_support: checks.has("proposition_support"),
  };
  const occurrenceData = occurrences.map((item) => ({
    occurrence_id: item.id,
    citation: item.rawCitation,
    proposition: item.proposition,
    quotation: item.quotation ?? null,
    document_block: item.documentBlock,
  }));
  return {
    systemPrompt: [
      "You are an independent legal-authority verifier, not a drafter or advocate.",
      "Analyze only the supplied judicial opinion and the listed occurrences from the draft.",
      "Do not use memory, outside sources, treatment signals, or facts from any other case.",
      "Do not assume language in a party argument, quoted authority, concurrence, or dissent is the controlling court's holding.",
      "Distinguish holding, necessary reasoning, dicta, factual discussion, procedural history, and quoted material.",
      "For every substantive conclusion, cite the exact P-blocks and reproduce a short exact evidence quote from them.",
      "If the opinion does not establish a conclusion, use insufficient_context or manual_review_required.",
      "Return JSON only and exactly follow the requested schema.",
    ].join("\n"),
    userPrompt: [
      "Requested analyses:",
      JSON.stringify(requested, null, 2),
      "",
      "Draft occurrences:",
      JSON.stringify(occurrenceData, null, 2),
      "",
      "Output schema:",
      modelAuthorityFindingShape(),
      "",
      "Rules:",
      "- Return exactly one finding for every supplied occurrence_id.",
      "- When speaker analysis was not requested, set speaker to null.",
      "- When proposition analysis was not requested, set proposition_support to null.",
      "- For an occurrence without a quotation, speaker must be not_applicable.",
      "- verified speaker means the draft's apparent attribution is accurate; wrong_speaker means it materially attributes words to the wrong speaker or opinion part.",
      "- Proposition support concerns the complete adjacent draft proposition, not merely shared vocabulary.",
      "- Use supports_with_qualification when support exists but a material limitation, condition, or posture must be stated.",
      "- Use holding_dicta_concern when the draft treats dicta or noncontrolling language as a holding.",
      "- Never assess subsequent treatment or whether the authority remains good law.",
      "",
      "Supplied opinion:",
      sourceText(source),
    ].join("\n"),
  };
}
