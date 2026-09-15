import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { runDocumentAuthorityVerification } from "./verify.ts";
import type { VerificationToolDetails } from "./types.ts";

const VerificationCheckSchema = Type.Union([
  Type.Literal("citation_identity"),
  Type.Literal("quotation"),
  Type.Literal("pincite"),
  Type.Literal("speaker"),
  Type.Literal("proposition_support"),
]);

const VerificationCaseSourceSchema = Type.Object({
  source_path: Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Exact local .html, .htm, .md, or .txt full-opinion file to include in authority resolution.",
  }),
  metadata_path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Optional downloader metadata sidecar for the opinion. A same-name sidecar is detected automatically for HTML.",
  })),
  case_key: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 300,
    description: "Optional Central Case Library identifier retained as provenance.",
  })),
}, { additionalProperties: false });

const DocumentAuthorityVerificationSchema = Type.Object({
  document_path: Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Path to the document whose citations and quotations should be verified.",
  }),
  checks: Type.Optional(Type.Array(VerificationCheckSchema, {
    minItems: 1,
    uniqueItems: true,
    description: "Verification checks to run; omit to request the complete verification set.",
  })),
  matter_id: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 80,
    pattern: "^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$",
    description: "Optional matter whose Legal Matters/<matter_id>/sources/cases directory should be included in local resolution.",
  })),
  case_sources: Type.Optional(Type.Array(VerificationCaseSourceSchema, {
    minItems: 1,
    maxItems: 250,
    description: "Optional exact local full-opinion sources. These are preferred over duplicate files discovered by directory scanning.",
  })),
  source_roots: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), {
    minItems: 1,
    maxItems: 20,
    uniqueItems: true,
    description: "Optional local case-library directories to scan recursively. When omitted, ./Cases is checked.",
  })),
  output_path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Optional new .md or .json verification report path. Existing files are never overwritten.",
  })),
}, {
  additionalProperties: false,
  description: "Verify case citations, quotations, pincites, speakers, and proposition support against local full-opinion sources.",
});

type DocumentAuthorityVerificationParams = Static<typeof DocumentAuthorityVerificationSchema>;

export default function documentAuthorityVerificationExtension(pi: ExtensionAPI): void {
  pi.registerTool<typeof DocumentAuthorityVerificationSchema, VerificationToolDetails>({
    name: "verify_document_authorities",
    executionMode: "sequential",
    label: "Document Authority Verification",
    description:
      "Inventory a local draft's legal authorities and verify case identity, quotations, pincites, speaker attribution, and proposition support against exact local full-opinion sources. " +
      "Resolution is local and provider-scoped coverage is never implied; statutes and rules are inventoried but not substantively verified.",
    promptSnippet: "Verify case citations and quotations against local full opinions",
    promptGuidelines: [
      "Supply the exact draft document path. Use case_sources for known opinions or source_roots for local case-library directories; when source_roots is omitted the tool checks ./Cases.",
      "Treat not_found as a local-source result, not proof that a citation is fabricated or absent from all providers.",
      "The tool does not check subsequent treatment or good-law status; use the Authority and Treatment Analysis skill separately.",
      "Treat fuzzy, OCR-dependent, ambiguous, unsupported-authority, and incomplete model findings as manual-review items.",
      "Never silently correct or remove a questionable authority.",
    ],
    parameters: DocumentAuthorityVerificationSchema,
    async execute(_toolCallId, params: DocumentAuthorityVerificationParams, signal, onUpdate, ctx) {
      const result = await runDocumentAuthorityVerification(params, signal, onUpdate, ctx);
      return {
        content: [{ type: "text", text: result.markdown }],
        details: result.details,
      };
    },
  });
}
