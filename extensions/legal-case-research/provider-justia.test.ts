import assert from "node:assert/strict";
import test from "node:test";
import { extractOpinionMarkdown, extractOpinionText, normalizeProviderResult, providerFromOpinionUrl } from "./core.ts";
import { isJustiaOpinionUrl, parseJustiaResults } from "./provider-justia.ts";

const RESULT_HTML = `
<html><body>
  <div class="gsc-webResult gsc-result"><div class="gs-webResult gs-result">
    <div class="gs-title"><a class="gs-title" href="https://law.justia.com/cases/michigan/court-of-appeals-unpublished/2024/360994.html">David <b>Brackens</b> V Asset Acceptance Llc</a></div>
    <div class="gs-visibleUrl-breadcrumb"><span>Justia Law</span><span> › cases</span><span> › michigan</span></div>
    <div class="gs-snippet">Apr 11, 2024 ... <b>MCL 445.251</b>(1)(g) ...</div>
  </div></div>
  <div class="gsc-webResult gsc-result"><div class="gs-webResult gs-result">
    <div class="gs-title"><a class="gs-title" href="https://www.justia.com/lawyers/michigan">Michigan Lawyers</a></div>
    <div class="gs-snippet">Directory result that is not an opinion.</div>
  </div></div>
</body></html>`;

test("Justia search parsing returns case results and excludes other site-search records", () => {
  const results = parseJustiaResults(RESULT_HTML);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    title: "David Brackens V Asset Acceptance Llc",
    url: "https://law.justia.com/cases/michigan/court-of-appeals-unpublished/2024/360994.html",
    casePath: "michigan/court-of-appeals-unpublished/2024/360994.html",
    snippet: "Apr 11, 2024 ... MCL 445.251(1)(g) ...",
    displayedDate: "Apr 11, 2024",
    breadcrumb: "Justia Law › cases › michigan",
    resultPosition: 1,
  });
  const normalized = normalizeProviderResult("justia", results[0], 1);
  assert.equal(normalized.year, "2024");
  assert.equal(normalized.dateFiled, "2024-04-11");
  assert.equal(normalized.court, "Michigan Court of Appeals");
  assert.equal(normalized.publicationStatus, "unpublished");
  assert.equal(normalized.sources[0].providerData?.displayed_date, "Apr 11, 2024");
});

test("Justia opinion URLs and opinion HTML are validated and converted", () => {
  const url = "https://law.justia.com/cases/michigan/court-of-appeals-published/2022/356368.html";
  assert.equal(isJustiaOpinionUrl(url), true);
  assert.equal(providerFromOpinionUrl(url), "justia");
  assert.equal(isJustiaOpinionUrl("https://law.justia.com/lawyers/michigan"), false);
  const body = "A substantial opinion paragraph. ".repeat(12);
  const html = `<html><body><div id="opinion"><a href="https://cases.justia.com/example.pdf">Download PDF</a><noframes>${body}</noframes></div></body></html>`;
  assert.match(extractOpinionText(html, "justia"), /substantial opinion paragraph/);
  assert.match(extractOpinionMarkdown(html, "justia"), /substantial opinion paragraph/);
});
