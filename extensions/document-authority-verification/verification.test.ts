import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractCitationOccurrences } from "./citations.ts";
import { calculateOverall, runDocumentAuthorityVerification } from "./verify.ts";
import { VERIFICATION_CHECKS, type VerifiedCitationOccurrence } from "./types.ts";

test("citation inventory preserves full, short, Id., and unsupported authority occurrences", () => {
  const text = [
    "Smith v. Jones, 123 F.3d 456, 461 (6th Cir. 2024), addresses the question.",
    "Smith, 123 F.3d at 462, adds a qualification. Id. at 463.",
    "The draft also cites 42 U.S.C. § 1983 and Fed. R. Civ. P. 12(b)(6).",
  ].join(" ");
  const occurrences = extractCitationOccurrences({
    path: "draft.md",
    rawBytes: text.length,
    rawSha256: "raw",
    textSha256: "text",
    normalizedText: text,
    blocks: [{ id: "D00001", text }],
  });

  assert.deepEqual(occurrences.map((item) => item.kind), [
    "full",
    "short_form",
    "id",
    "unsupported",
    "unsupported",
  ]);
  assert.equal(occurrences[0].normalizedCitation, "123:f3d:456");
  assert.equal(occurrences[0].pincite, "461");
  assert.equal(occurrences[1].linkedOccurrenceId, occurrences[0].id);
  assert.equal(occurrences[2].linkedOccurrenceId, occurrences[1].id);
  assert.deepEqual(occurrences.slice(3).map((item) => item.authorityType), ["statute", "rule"]);
});

test("Id. follows the immediately preceding non-case authority instead of an older case", () => {
  const text = "Smith v. Jones, 123 F.3d 456 (2024). See 42 U.S.C. § 1983. Id. § 1985.";
  const occurrences = extractCitationOccurrences({
    path: "draft.md",
    rawBytes: text.length,
    rawSha256: "raw",
    textSha256: "text",
    normalizedText: text,
    blocks: [{ id: "D00001", text }],
  });
  const id = occurrences.find((item) => item.kind === "id");
  const statute = occurrences.find((item) => item.authorityType === "statute");
  assert.ok(id);
  assert.ok(statute);
  assert.equal(id.linkedOccurrenceId, statute.id);
  assert.equal(id.authorityType, "statute");
});

test("deterministic verification resolves a supplied case and verifies an exact quote", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-authority-verification-"));
  const draftPath = join(directory, "draft.md");
  const sourcePath = join(directory, "smith-v-jones.txt");
  const metadataPath = join(directory, "smith-v-jones-metadata.md");
  const quotation = "The law requires reasonable care under these circumstances.";
  await writeFile(
    draftPath,
    `The governing standard is clear: “${quotation}” Smith v. Jones, 123 F.3d 456, 461 (6th Cir. 2024).`,
    "utf8",
  );
  await writeFile(
    sourcePath,
    [
      "Smith v. Jones",
      "United States Court of Appeals for the Sixth Circuit",
      "[123 F.3d 461]",
      quotation,
      "The remainder of this synthetic opinion text exists only to satisfy the full-opinion loader's minimum text requirement. ".repeat(3),
    ].join("\n\n"),
    "utf8",
  );
  await writeFile(metadataPath, [
    "## Machine-readable metadata",
    "",
    "```json",
    JSON.stringify({
      case: {
        canonicalKey: "smith-v-jones--test",
        title: "Smith v. Jones",
        citations: ["123 F.3d 456"],
        normalizedCitations: ["123:f3d:456"],
        court: "6th Cir.",
        year: "2024",
      },
      source: { provider: "test" },
    }),
    "```",
  ].join("\n"), "utf8");

  const result = await runDocumentAuthorityVerification(
    {
      document_path: draftPath,
      checks: ["citation_identity", "quotation", "pincite"],
      case_sources: [{ source_path: sourcePath, metadata_path: metadataPath }],
    },
    undefined,
    undefined,
    { cwd: directory } as ExtensionContext,
  );

  assert.equal(result.details.status, "completed");
  assert.equal(result.details.results.length, 1);
  assert.equal(result.details.results[0].identity.status, "verified");
  assert.equal(result.details.results[0].quotation.status, "verified");
  assert.equal(result.details.results[0].pincite.status, "verified");
  assert.equal(result.details.treatmentStatus, "not_checked");
  assert.equal(result.details.documentModified, false);
});

const PINPOINT_QUOTE = "The law requires reasonable care under these circumstances.";
const PINPOINT_FILLER = "Other material in this synthetic opinion provides enough text for the source loader. ".repeat(4);

for (const scenario of [
  {
    name: "rejects a preceding page when the quotation follows a newer marker",
    body: `[123 F.3d 461] ${PINPOINT_FILLER}\n\n[123 F.3d 462] ${PINPOINT_QUOTE}`,
    expected: "pincite_unverifiable", observed: "462",
  },
  {
    name: "rejects a later marker in the quotation's own block",
    body: `[123 F.3d 460] ${PINPOINT_FILLER} ${PINPOINT_QUOTE} [123 F.3d 461] Later text.`,
    expected: "pincite_unverifiable", observed: "460",
  },
  {
    name: "rejects a marker that only occurs after the quotation",
    body: `${PINPOINT_FILLER}\n\n${PINPOINT_QUOTE} [123 F.3d 461] Later text.`,
    expected: "pincite_unverifiable", observed: undefined,
  },
  {
    name: "keeps the current page across multiple unmarked blocks",
    body: `[123 F.3d 461]\n\n${PINPOINT_FILLER}\n\nMore intervening text.\n\n${PINPOINT_QUOTE}`,
    expected: "verified", observed: "461",
  },
  {
    name: "does not select one of repeated quotations on different pages",
    body: `[123 F.3d 461] ${PINPOINT_QUOTE}\n\n${PINPOINT_FILLER}\n\n[123 F.3d 462] ${PINPOINT_QUOTE}`,
    expected: "pincite_unverifiable", observed: undefined,
  },
]) {
  test(`pinpoint verification ${scenario.name}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-pinpoint-regression-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const draftPath = join(directory, "draft.md");
    const sourcePath = join(directory, "opinion.txt");
    const metadataPath = join(directory, "metadata.md");
    await writeFile(draftPath, `The rule is "${PINPOINT_QUOTE}" Smith v. Jones, 123 F.3d 456, 461 (6th Cir. 2024).`);
    await writeFile(sourcePath, `Smith v. Jones\n\n${scenario.body}`);
    await writeFile(metadataPath, "## Machine-readable metadata\n\n```json\n" + JSON.stringify({
      case: { title: "Smith v. Jones", citations: ["123 F.3d 456"], normalizedCitations: ["123:f3d:456"], year: "2024" },
      source: { provider: "test" },
    }) + "\n```");
    const { details } = await runDocumentAuthorityVerification({
      document_path: draftPath,
      checks: ["citation_identity", "quotation", "pincite"],
      case_sources: [{ source_path: sourcePath, metadata_path: metadataPath }],
    }, undefined, undefined, { cwd: directory } as ExtensionContext);
    assert.equal(details.results.length, 1);
    const result = details.results[0];
    assert.equal(result.quotation.status, "verified");
    assert.equal(result.pincite.status, scenario.expected);
    assert.equal(result.pincite.observedPage, scenario.observed);
    assert.equal(result.overallStatus, scenario.expected === "verified" ? "verified" : "manual_review_required");
  });
}

test("overall verification preserves unresolved checks above qualified support", () => {
  const verified: VerifiedCitationOccurrence = {
    occurrence: {
      id: "C1", kind: "full", authorityType: "case", rawCitation: "123 F.3d 456",
      documentBlock: "D1", proposition: "Test proposition", start: 0, end: 12,
    },
    overallStatus: "verified", warnings: [],
    identity: { status: "verified", explanation: "", candidatePaths: [], mismatches: [] },
    quotation: { status: "verified", explanation: "", sourceBlocks: [] },
    pincite: { status: "verified", explanation: "", sourceBlocks: [] },
    speaker: { status: "verified", explanation: "", sourceBlocks: [] },
    propositionSupport: { status: "supports", explanation: "", sourceBlocks: [] },
  };
  const checks = new Set(VERIFICATION_CHECKS);
  assert.equal(calculateOverall(verified, checks), "verified");
  for (const status of ["supports_with_qualification", "holding_dicta_concern"] as const) {
    const qualified = { ...verified, propositionSupport: { ...verified.propositionSupport, status } };
    assert.equal(calculateOverall(qualified, checks), "verified_with_qualification");
    const unresolved: VerifiedCitationOccurrence[] = [
      { ...qualified, pincite: { ...verified.pincite, status: "pincite_unverifiable" } },
      { ...qualified, speaker: { ...verified.speaker, status: "manual_review_required" } },
      { ...qualified, quotation: { ...verified.quotation, status: "source_unavailable" } },
      { ...qualified, identity: { ...verified.identity, status: "ambiguous_authority" } },
    ];
    for (const result of unresolved) {
      assert.equal(calculateOverall(result, checks), "manual_review_required");
      assert.equal(calculateOverall({ ...result, quotation: { ...verified.quotation, status: "quote_mismatch" } }, checks), "issue_found");
    }
    assert.equal(calculateOverall(unresolved[0], new Set(["proposition_support"])), "verified_with_qualification");
  }
  assert.equal(calculateOverall(verified, new Set()), "not_checked");
});
