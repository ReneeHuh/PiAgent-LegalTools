import { runWithToolStatus } from "../legal-case-research/tool-status.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { runCaseSummarizer, type CaseSummarizerToolDetails } from "./summarize.ts";

const CaseSummarizerSchema = Type.Object({
  source_path: Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Path to the exact saved .html, .htm, .md, or .txt opinion inside Pi's current workspace.",
  }),
  metadata_path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Optional downloader Markdown metadata sidecar. For HTML sources, the same-name .md file is detected automatically.",
  })),
  case_key: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 300,
    description: "Optional Central Case Library identifier retained as summary provenance.",
  })),
  audience: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 200,
    description: "Intended reader, such as attorney, client, investigator, or general reader.",
  })),
  focus: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 2_000,
    description: "Issue, proposition, procedural question, or factual theme the summary should emphasize.",
  })),
  output_path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Optional new .md or .json output path. By default, saves <source-name>.Summary.md beside the opinion, adding a numbered suffix if needed. Existing files are never overwritten.",
  })),
}, {
  additionalProperties: false,
  description: "Summarize one saved judicial opinion using five analysis stages, with at most one response-validation retry per stage.",
});

type CaseSummarizerParams = Static<typeof CaseSummarizerSchema>;

export default function caseSummarizerExtension(pi: ExtensionAPI): void {
  pi.registerTool<typeof CaseSummarizerSchema, CaseSummarizerToolDetails>({
    name: "summarize_case",
    executionMode: "sequential",
    label: "Case Summarizer",
    description:
      "Read one saved judicial opinion and automatically save its summary beside the source as <source-name>.Summary.md. Normally runs three blind independent analyses sequentially, " +
      "one combined audit, and one fresh final reconstruction. Opinions over 170,000 estimated tokens instead use overlapping parts capped at 120,000 tokens with 2,000-token overlap before audit and reconstruction. " +
      "LM Studio calls automatically use strict JSON-schema output through Chat Completions; the user receives readable Markdown. " +
      "Invalid internal JSON or source references trigger one retry of that stage. The tool verifies source-block references and exact quotations but does not check subsequent treatment or good-law status.",
    promptSnippet: "Summarize a saved judicial opinion with five audited analysis stages",
    promptGuidelines: [
      "Use summarize_case only after the user or Central Case Library skill identifies the exact saved opinion file.",
      "Pass summarize_case.source_path as the opinion file, not its metadata sidecar, a search result, a snippet, or a URL.",
      "summarize_case saves the summary itself and returns details.outputPath. Omit output_path for automatic Markdown output; repeat runs preserve earlier summaries with numbered filenames. Report the returned saved path rather than writing another copy.",
      "summarize_case automatically requests schema-enforced JSON for LM Studio; its modelCalls records identify the API and responseFormat used. Do not change the user's global model settings to enable this.",
      "summarize_case runs one model call at a time with a shared source prefix and per-run cache session; it normally performs five model calls, with at most ten if every stage needs its one response-validation retry; use it for a full case brief rather than a quick passage lookup.",
      "For opinions over 170,000 estimated tokens, summarize_case automatically uses 120,000-token parts with 2,000-token overlap and reports multipart details and a validation warning.",
      "If summarize_case reports an internal model-response failure after retry, report the failed stage. Do not blame source_path, repeatedly rerun the same call, or silently replace the requested summary with case_chat.",
      "Treat summarize_case output as treatment_status=not_checked unless a separate treatment workflow was completed.",
    ],
    parameters: CaseSummarizerSchema,
    async execute(toolCallId, params: CaseSummarizerParams, signal, onUpdate, ctx) {
      return runWithToolStatus({ tool: "summarize_case", toolCallId, signal, onUpdate,
        operation: async progress => {
          const result = await runCaseSummarizer(params, signal, progress, ctx);
          return {
            content: [{ type: "text" as const, text: `Saved summary: ${result.details.outputPath}\n\n${result.markdown}` }],
            details: result.details,
          };
        },
      });
    },
  });
}
