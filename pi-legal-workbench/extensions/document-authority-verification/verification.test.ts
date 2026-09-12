import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractCitationOccurrences } from "./citations.ts";
import { runDocumentAuthorityVerification } from "./verify.ts";

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
