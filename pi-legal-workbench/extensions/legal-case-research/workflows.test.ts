import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedCase } from "./core.ts";
import { chooseDocumentSource, documentSourceCandidates, markExactContentDuplicates } from "./workflows.ts";

function exampleCase(): NormalizedCase {
  return {
    canonicalKey: "example--1",
    title: "Example v. State",
    citations: [],
    normalizedCitations: [],
    sources: [
      {
        provider: "courtlistener",
        providerId: "2",
        url: "https://www.courtlistener.com/opinion/2/example/",
        discoveredBy: "search",
      },
      {
        provider: "scholar",
        providerId: "1",
        url: "https://scholar.google.com/scholar_case?case=1",
        discoveredBy: "search",
      },
    ],
  };
}

test("automatic opinion download prefers the Scholar source", () => {
  assert.equal(chooseDocumentSource(exampleCase(), "auto").provider, "scholar");
});

test("an explicitly requested unavailable source is never substituted", () => {
  const scholarOnly = { ...exampleCase(), sources: exampleCase().sources.filter((source) => source.provider === "scholar") };
  assert.throws(() => chooseDocumentSource(scholarOnly, "courtlistener"), /no courtlistener source/);
});

test("automatic download candidates keep Scholar primary and CourtListener as fallback", () => {
  assert.deepEqual(documentSourceCandidates(exampleCase()).map((source) => source.provider), ["scholar", "courtlistener"]);
});

test("exact normalized opinion hashes are labeled without deleting either case", () => {
  const first = exampleCase();
  const second = { ...exampleCase(), canonicalKey: "example--2" };
  const downloads = [
    { case: first, status: "downloaded" as const, saved: { provider: "scholar" as const, sourceUrl: "x", title: "x", savedPath: "x", textSha256: "same" } },
    { case: second, status: "downloaded" as const, saved: { provider: "courtlistener" as const, sourceUrl: "y", title: "y", savedPath: "y", textSha256: "same" } },
  ];
  assert.deepEqual(markExactContentDuplicates(downloads), [{ caseKey: "example--2", duplicateOf: "example--1", textSha256: "same" }]);
  assert.equal(downloads.length, 2);
});
