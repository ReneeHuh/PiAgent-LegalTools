import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { runCaseChat } from "./chat.ts";
import type { CaseChatToolDetails } from "./types.ts";

const SelectedCaseSchema = Type.Object({
  source_path: Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Path to one exact saved .html, .htm, .md, or .txt judicial opinion inside Pi's current workspace.",
  }),
  metadata_path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Optional downloader Markdown metadata sidecar. A same-name sidecar is detected automatically for HTML.",
  })),
  case_key: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 300,
    description: "Optional Central Case Library identifier retained as provenance.",
  })),
}, {
  additionalProperties: false,
  description: "One selected case and its optional provenance metadata.",
});

const CaseChatSchema = Type.Object({
  cases: Type.Array(SelectedCaseSchema, {
    minItems: 1,
    maxItems: 20,
    description: "The exact saved case files that should each receive the same question.",
  }),
  question: Type.String({
    minLength: 1,
    maxLength: 10_000,
    description: "Question to ask independently of every selected case.",
  }),
  focus: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 2_000,
    description: "Optional instruction about the issue, posture, holding/dicta distinction, or answer format to emphasize.",
  })),
  output_path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Optional new .md or .json path for the ordered results. Existing files are never overwritten.",
  })),
}, {
  additionalProperties: false,
  description: "Ask one question independently of each selected saved judicial opinion.",
});

type CaseChatParams = Static<typeof CaseChatSchema>;

export default function caseChatExtension(pi: ExtensionAPI): void {
  pi.registerTool<typeof CaseChatSchema, CaseChatToolDetails>({
    name: "case_chat",
    executionMode: "sequential",
    label: "Case Chat",
    description:
      "Ask one question independently of each selected local case file and return one source-grounded answer per case in input order. " +
      "Each case receives an isolated model context; the tool performs no cross-case synthesis. Source and model failures remain local to the affected case.",
    promptSnippet: "Ask the same source-grounded question independently of selected cases",
    promptGuidelines: [
      "Use case_chat only after the user or Central Case Library skill identifies the exact opinion files to select.",
      "Pass case_chat.cases as opinion files, not metadata sidecars, search results, snippets, directories, or URLs.",
      "case_chat makes one model call per readable selected case, with at most three calls running concurrently.",
      "Use the Case Analysis skill after case_chat only when the user separately asks to compare or synthesize the per-case answers.",
      "Treat every case_chat answer as treatment_status=not_checked unless a separate treatment workflow was completed.",
    ],
    parameters: CaseChatSchema,
    async execute(_toolCallId, params: CaseChatParams, signal, onUpdate, ctx) {
      const result = await runCaseChat(params, signal, onUpdate, ctx);
      return {
        content: [{ type: "text", text: result.markdown }],
        details: result.details,
      };
    },
  });
}
