import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  decodeHtmlEntities,
  caseFolder,
  caseDownloadErrorPath,
  caseMarkdownMetadataRecords,
  extractOpinionText,
  mergeCases,
  mergeCase,
  normalizeCitation,
  normalizeProviderResult,
  opinionMetadataMarkdownPath,
  providerFromOpinionUrl,
  resolveSessionFile,
  sameCase,
  sameCaseReason,
  selectDownloadCases,
  splitScholarMetadata,
  writeMarkdownMetadata,
  type NormalizedCase,
} from "./core.ts";

test("merging repeated provider observations fills missing cited-by metadata without mutating provenance", () => {
  const first = normalizeProviderResult("courtlistener", {
    title: "Example v. Sample", clusterId: "123", url: "https://www.courtlistener.com/opinion/123/example/",
  }, 1);
  const later = structuredClone(first);
  later.sources[0].citedById = "999";
  later.sources[0].snippet = "Later exposed snippet";
  later.sources[0].sourceRank = 20;
  const combined = mergeCase(first, later);
  assert.equal(combined.sources.length, 1);
  assert.equal(combined.sources[0].citedById, "999");
  assert.equal(combined.sources[0].snippet, "Later exposed snippet");
  assert.equal(combined.sources[0].sourceRank, 1);
  assert.equal(first.sources[0].citedById, undefined);
});

test("download selection takes only the requested leading result items", () => {
  assert.deepEqual(selectDownloadCases(["first", "second", "third", "fourth", "fifth", "sixth"], 5), [
    "first", "second", "third", "fourth", "fifth",
  ]);
  assert.deepEqual(selectDownloadCases(["first"], 0), []);
  assert.deepEqual(selectDownloadCases(["first", "second"], -1), ["first", "second"]);
});

test("parallel reporter citations merge by any normalized overlap", () => {
  const scholar = normalizeProviderResult("scholar", {
    title: "Miranda v. Arizona",
    url: "https://scholar.google.com/scholar_case?case=1&hl=en",
    caseId: "1",
    meta: "384 U. S. 436, 86 S. Ct. 1602 - Supreme Court 1966",
    snippet: "Scholar blurb",
  }, 1);
  const courtListener = normalizeProviderResult("courtlistener", {
    title: "Miranda v. Arizona",
    url: "https://www.courtlistener.com/opinion/2/x/",
    clusterId: "2",
    citations: ["86 S. Ct. 1602", "16 L. Ed. 2d 694"],
    court: "Supreme Court of the United States",
    year: "1966",
    snippet: "CourtListener blurb",
  }, 1);
  assert.equal(sameCase(scholar, courtListener), true);
  const merged = mergeCases([courtListener, scholar], "scholar");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].snippet, "Scholar blurb");
  assert.equal(merged[0].sources.length, 2);
});

test("opinion extraction keeps nested Scholar content and excludes the footer", () => {
  const html = '<main id="gs_opinion"><div><p>First paragraph.</p></div><p>Second paragraph.</p></main><footer id="gs_ftr">Not opinion.</footer>';
  const text = extractOpinionText(html, "scholar");
  assert.match(text, /First paragraph/);
  assert.match(text, /Second paragraph/);
  assert.doesNotMatch(text, /Not opinion/);
});

test("CourtListener opinion extraction removes page and footnote navigation artifacts without splitting words", () => {
  const html = [
    '<main class="main-document"><article>',
    '<opinion type="majority"><author><a class="page-label" data-label="372">*372</a>ZAHRA, J.</author>',
    '<p>The direct cause of the injury or dam<a class="page-label" data-label="373">*373</a>age.<sup><a href="#fn1" id="fnref1">1</a></sup></p>',
    '</opinion></article></main>',
  ].join("");
  const text = extractOpinionText(html, "courtlistener");
  assert.match(text, /ZAHRA, J\.\nThe direct cause of the injury or damage\./);
  assert.doesNotMatch(text, /\*37[23]|damage\.1/);
});

test("reporter formatting aliases normalize consistently", () => {
  assert.equal(normalizeCitation("384 U. S. 436"), normalizeCitation("384 U.S. 436"));
  assert.equal(normalizeCitation("86 S. Ct. 1602"), "86:sct:1602");
});

test("HTML entities decode exactly one layer", () => {
  assert.equal(decodeHtmlEntities("&amp;#39; &amp;lt; &#39; &lt;"), "&#39; &lt; ' <");
});

test("provider-specific extraction rejects a non-opinion body", () => {
  const html = `<html><body>${"Search results and navigation. ".repeat(20)}</body></html>`;
  assert.equal(extractOpinionText(html, "scholar"), "");
  assert.equal(extractOpinionText(html, "courtlistener"), "");
});

test("direct opinion URLs require HTTPS and provider opinion path families", () => {
  assert.equal(providerFromOpinionUrl("https://scholar.google.com/scholar_case?case=123&hl=en"), "scholar");
  assert.equal(providerFromOpinionUrl("https://www.courtlistener.com/opinion/123/example/"), "courtlistener");
  assert.throws(() => providerFromOpinionUrl("https://scholar.google.com/"), /scholar_case/);
  assert.throws(() => providerFromOpinionUrl("http://www.courtlistener.com/opinion/123/example/"), /HTTPS/);
  assert.throws(() => providerFromOpinionUrl("https://caselaw.findlaw.com/court/us-supreme-court/384/436.html"), /Unsupported legal-opinion host/);
});

test("manifest-controlled paths cannot escape their session directory", () => {
  const session = process.platform === "win32" ? "C:\\research\\session" : "/research/session";
  assert.match(resolveSessionFile(session, "results.json"), /results\.json$/);
  assert.throws(() => resolveSessionFile(session, "../outside.json"), /escapes/);
});

test("case folders reject canonical keys that could traverse paths", () => {
  const item = {
    canonicalKey: "../outside",
    title: "Example",
    citations: [],
    normalizedCitations: [],
    sources: [],
  } satisfies NormalizedCase;
  assert.throws(() => caseFolder(process.cwd(), item), /unsafe path/);
  assert.throws(() => caseDownloadErrorPath(process.cwd(), item), /unsafe path/);
});

test("saved case metadata uses a same-name Markdown sidecar", () => {
  const item = {
    canonicalKey: "example-v-state--123",
    title: "Example v. State",
    citations: [],
    normalizedCitations: [],
    sources: [],
  } satisfies NormalizedCase;
  assert.equal(
    opinionMetadataMarkdownPath(join(process.cwd(), "Cases", "example-v-state-123.html")),
    join(process.cwd(), "Cases", "example-v-state-123.md"),
  );

  const directory = mkdtempSync(join(tmpdir(), "legal-flat-case-"));
  try {
    const htmlPath = join(directory, "example-v-state-123.html");
    const markdownPath = opinionMetadataMarkdownPath(htmlPath);
    writeFileSync(htmlPath, "<!doctype html><title>Example v. State</title>", "utf8");
    writeMarkdownMetadata(markdownPath, item.title, {
      schemaVersion: 1,
      case: item,
      source: { provider: "scholar", sourceUrl: "https://scholar.google.com/", savedPath: htmlPath },
    });
    const records = caseMarkdownMetadataRecords(directory, item.canonicalKey);
    assert.equal(records.length, 1);
    assert.equal(records[0].path, markdownPath);
    assert.equal((records[0].data.case as NormalizedCase).canonicalKey, item.canonicalKey);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("id-less results receive distinct rank-qualified fallback keys", () => {
  const raw = { title: "In re Example", meta: "Example Court, 2020", snippet: "" };
  const first = normalizeProviderResult("scholar", raw, 1);
  const second = normalizeProviderResult("scholar", raw, 2);
  assert.notEqual(first.canonicalKey, second.canonicalKey);
  assert.equal(first.court, "Example Court");
  assert.equal(first.year, "2020");
});

test("Scholar metadata without a reporter citation still yields court and year", () => {
  assert.deepEqual(splitScholarMetadata("Dist. Court, ED Pennsylvania 2011"), {
    citations: [],
    court: "Dist. Court, ED Pennsylvania",
    year: "2011",
  });
  assert.deepEqual(splitScholarMetadata("Court of Appeals, 3rd Circuit 2019"), {
    citations: [],
    court: "Court of Appeals, 3rd Circuit",
    year: "2019",
  });
  assert.deepEqual(splitScholarMetadata("410 US 113 - Supreme Court 1973"), {
    citations: ["410 US 113"],
    court: "Supreme Court",
    year: "1973",
  });
  assert.deepEqual(splitScholarMetadata("384 U. S. 436, 86 S. Ct. 1602 - Supreme Court 1966"), {
    citations: ["384 U. S. 436", "86 S. Ct. 1602"],
    court: "Supreme Court",
    year: "1966",
  });
  assert.deepEqual(splitScholarMetadata("410 US 113"), { citations: ["410 US 113"], court: undefined, year: undefined });
  assert.deepEqual(splitScholarMetadata(""), { citations: [], court: undefined, year: undefined });
  const unpublished = normalizeProviderResult("scholar", {
    title: "Doe v. Roe",
    meta: "Dist. Court, ED Pennsylvania 2011",
    caseId: "77",
    url: "https://scholar.google.com/scholar_case?case=77",
  }, 1);
  assert.equal(unpublished.court, "Dist. Court, ED Pennsylvania");
  assert.equal(unpublished.year, "2011");
  assert.deepEqual(unpublished.citations, []);
});

test("weak title/court/year and docket/court/year similarities do not collapse decisions", () => {
  const first = normalizeProviderResult("courtlistener", {
    title: "Example v. State",
    clusterId: "10",
    url: "https://www.courtlistener.com/opinion/10/example/",
    court: "Example Court",
    year: "2024",
    docketNumber: "No. 22-100",
  }, 1);
  const second = normalizeProviderResult("scholar", {
    title: "Example v. State",
    caseId: "20",
    url: "https://scholar.google.com/scholar_case?case=20",
    meta: "Example Court, 2024",
  }, 1);
  second.docketNumber = "No. 22-100";
  assert.equal(sameCase(first, second), false);
  assert.equal(mergeCases([first, second]).length, 2);
});

test("matching docket, court, full filing date, and title is strong identity evidence", () => {
  const first = normalizeProviderResult("courtlistener", {
    title: "Example v. State",
    clusterId: "10",
    url: "https://www.courtlistener.com/opinion/10/example/",
    court: "Example Court",
    dateFiled: "2024-04-12",
    docketNumber: "No. 22-100",
  }, 1);
  const second: NormalizedCase = {
    ...first,
    canonicalKey: "other",
    sources: [{ provider: "scholar", providerId: "20", url: "https://scholar.google.com/scholar_case?case=20", discoveredBy: "search" }],
  };
  assert.equal(sameCaseReason(first, second), "docket_court_date_title");
});
