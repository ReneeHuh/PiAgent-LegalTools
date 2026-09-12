import assert from "node:assert/strict";
import test from "node:test";
import {
  isScholarUrl,
  parseScholarOpinionTitle,
  parseScholarResults,
  resolveScholarCourts,
} from "./provider-google-scholar.ts";
import { SCHOLAR_FEDERAL_APPELLATE_CODES } from "./jurisdiction-codes.ts";

const RESULTS_PAGE = `<!doctype html><html><body><div id="gs_res_ccl_mid">
<div class="gs_r gs_or gs_scl" data-cid="abc"><div class="gs_ri">
  <h3 class="gs_rt"><a href="/scholar_case?case=123&amp;q=miranda&amp;hl=en">Miranda v. <b>Arizona</b></a></h3>
  <div class="gs_a">384 US 436, 86 S. Ct. 1602 - Supreme Court 1966</div>
  <div class="gs_rs">Snippet <b>text</b> &amp; more</div>
  <div class="gs_fl"><a href="/scholar?cites=456&amp;as_sdt=2006">Cited by 100</a></div>
</div></div>
<div class="gs_r gs_or gs_scl"><div class="gs_ri">
  <h3 class="gs_rt"><a href="/scholar_case?case=789&amp;hl=en">Unpublished v. Order</a></h3>
  <div class="gs_a">Dist. Court, ED Pennsylvania 2011</div>
  <div class="gs_rs">No reporter citation.</div>
</div></div>
<div class="gs_r gs_or gs_scl"><div class="gs_ri">
  <h3 class="gs_rt">Unlinked v. Result</h3>
  <div class="gs_a">Court of Appeals, 3rd Circuit 2019 - Google Scholar</div>
</div></div>
</div></body></html>`;

test("Scholar result cards parse titles, links, metadata, snippets, and cited-by identifiers", () => {
  const results = parseScholarResults(RESULTS_PAGE);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], {
    title: "Miranda v. Arizona",
    url: "https://scholar.google.com/scholar_case?case=123&q=miranda&hl=en",
    caseId: "123",
    meta: "384 US 436, 86 S. Ct. 1602 - Supreme Court 1966",
    snippet: "Snippet text & more",
    citedBy: 100,
    citesId: "456",
  });
  assert.equal(results[1].caseId, "789");
  assert.equal(results[1].meta, "Dist. Court, ED Pennsylvania 2011");
  assert.equal(results[1].citedBy, undefined);
  assert.deepEqual(results[2], {
    title: "Unlinked v. Result",
    url: "",
    caseId: undefined,
    meta: "Court of Appeals, 3rd Circuit 2019",
    snippet: "",
    citedBy: undefined,
    citesId: undefined,
  });
});

test("Scholar opinion titles split into name, citation, court, and year", () => {
  assert.deepEqual(parseScholarOpinionTitle("Pulka v. Edelman, 40 NY 2d 781 - NY: Court of Appeals 1976"), {
    name: "Pulka v. Edelman",
    citation: "40 NY 2d 781",
    court: "NY: Court of Appeals",
    year: "1976",
  });
  assert.deepEqual(parseScholarOpinionTitle("Smith v. Jones - Dist. Court, ED Pennsylvania 2011"), {
    name: "Smith v. Jones",
    citation: "",
    court: "Dist. Court, ED Pennsylvania",
    year: "2011",
  });
  assert.deepEqual(parseScholarOpinionTitle("Untitled"), { name: "Untitled", citation: "", court: "", year: "" });
});

test("Scholar court names resolve to picker codes", () => {
  assert.equal(resolveScholarCourts("9th circuit court of appeals"), SCHOLAR_FEDERAL_APPELLATE_CODES["9th circuit court of appeals"]);
  assert.equal(resolveScholarCourts("sd new york"), "351");
  const codes = resolveScholarCourts("New York, Ninth Circuit, SCOTUS").split(",");
  assert.equal(codes[0], "33");
  assert.equal(codes.at(-1), "60");
  assert.ok(codes.includes("129"));
  assert.equal(resolveScholarCourts("ca"), "5");
  assert.throws(() => resolveScholarCourts("mars"), /Unknown court/);
  assert.throws(() => resolveScholarCourts(" , "), /courts was empty/);
});

test("Scholar URL recognition covers the block page family", () => {
  assert.equal(isScholarUrl("https://scholar.google.com/scholar?q=x"), true);
  assert.equal(isScholarUrl("https://www.google.com/sorry/index?continue=https://scholar.google.com/scholar"), true);
  assert.equal(isScholarUrl("https://www.google.com/search?q=x"), false);
});
