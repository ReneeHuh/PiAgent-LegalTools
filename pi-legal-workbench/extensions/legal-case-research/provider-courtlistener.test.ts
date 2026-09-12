import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCourtListenerSearchPath,
  extractCourtListenerOpinion,
  isCourtListenerUrl,
  normalizeCourtListenerCourtIds,
  parseCourtListenerResults,
} from "./provider-courtlistener.ts";

const RESULTS_PAGE = `<!doctype html><html><body>
<div id="result-count">2 Opinions</div>
<div id="search-results">
  <article>
    <h3><a href="/opinion/123/miranda-v-arizona/" class="visitable">Miranda v. <em>Arizona</em> (Supreme Court 1966)</a></h3>
    <div class="meta"><time datetime="1966-06-13">June 13, 1966</time></div>
    <span class="meta-data-header">Citations:</span> <span class="meta-data-value">384 U.S. 436, 86 S. Ct. 1602</span>
    <span class="meta-data-header">Docket Number:</span> <span class="meta-data-value">759</span>
    <span class="meta-data-header">Status:</span> <span class="meta-data-value">Published</span>
    <a href="/?q=cites%3A(456)&amp;type=o">Cited by 12,345</a>
    <p class="representation">Snippet &amp; <b>text</b></p>
  </article>
  <article>
    <h3><a class="visitable" href="https://www.courtlistener.com/opinion/789/unpublished-v-order/">Unpublished v. Order (D. Mass.)</a></h3>
    <p class="representation">No citation yet.</p>
  </article>
  <a rel="next" href="/?q=test&amp;page=2">Next</a>
</div></body></html>`;

test("CourtListener result cards parse identity, metadata, cited-by, and snippets", () => {
  const results = parseCourtListenerResults(RESULTS_PAGE);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    title: "Miranda v. Arizona",
    url: "https://www.courtlistener.com/opinion/123/miranda-v-arizona/",
    clusterId: "123",
    court: "Supreme Court",
    year: "1966",
    dateFiled: "1966-06-13",
    status: "Published",
    citations: ["384 U.S. 436", "86 S. Ct. 1602"],
    docketNumber: "759",
    citedBy: 12345,
    citesId: "456",
    snippet: "Snippet & text",
  });
  assert.equal(results[1].title, "Unpublished v. Order");
  assert.equal(results[1].court, "D. Mass.");
  assert.equal(results[1].year, undefined);
  assert.equal(results[1].clusterId, "789");
  assert.deepEqual(results[1].citations, []);
  assert.equal(results[1].citesId, undefined);
});

test("CourtListener result parsing ignores markup outside the results root", () => {
  const html = `<article><a class="visitable" href="/opinion/1/decoy/">Decoy</a></article><div id="search-results"></div>`;
  assert.deepEqual(parseCourtListenerResults(html), []);
});

const OPINION_PAGE = `<!doctype html><html><head><title>Miranda v. Arizona</title></head><body>
<h1 id="caption" class="case-caption">Miranda v. <i>Arizona</i></h1>
<h4 class="case-court">Supreme Court of the United States</h4>
<span class="case-date-new">June 13, 1966</span>
<ul>
  <li><strong>Citations:</strong> 384 U.S. 436, 86 S. Ct. 1602</li>
  <li><strong>Docket Number:</strong> 759</li>
  <li><strong>Judges:</strong> Warren</li>
</ul>
<div class="main-document"><article><p>The prosecution may not use statements.</p><p>Second paragraph.</p></article></div>
</body></html>`;

test("CourtListener opinion pages yield caption metadata and body text", () => {
  const opinion = extractCourtListenerOpinion(OPINION_PAGE);
  assert.ok(opinion);
  assert.equal(opinion.title, "Miranda v. Arizona");
  assert.equal(opinion.court, "Supreme Court of the United States");
  assert.equal(opinion.dateFiled, "June 13, 1966");
  assert.deepEqual(opinion.citations, ["384 U.S. 436", "86 S. Ct. 1602"]);
  assert.equal(opinion.docketNumber, "759");
  assert.equal(opinion.judges, "Warren");
  assert.match(opinion.text, /The prosecution may not use statements\.\nSecond paragraph\./);
  assert.equal(extractCourtListenerOpinion("<html><body><p>No article here.</p></body></html>"), undefined);
});

test("CourtListener search paths use rendered form fields", () => {
  const path = buildCourtListenerSearchPath({
    query: "state-created danger",
    courts: "9th circuit, nysd",
    statuses: "published,unpublished",
    filedAfter: "2000-01-01",
    filedBefore: "12/31/2020",
    page: 2,
  });
  const params = new URL(path, "https://www.courtlistener.com").searchParams;
  assert.equal(params.get("q"), "state-created danger");
  assert.equal(params.get("type"), "o");
  assert.equal(params.get("court_ca9"), "on");
  assert.equal(params.get("court_nysd"), "on");
  assert.equal(params.get("stat_Published"), "on");
  assert.equal(params.get("stat_Unpublished"), "on");
  assert.equal(params.get("filed_after"), "01/01/2000");
  assert.equal(params.get("filed_before"), "12/31/2020");
  assert.equal(params.get("page"), "2");

  const cites = new URL(buildCourtListenerSearchPath({ cites: "456", page: 1 }), "https://www.courtlistener.com").searchParams;
  assert.equal(cites.get("q"), "cites:(456)");
  assert.equal(cites.get("page"), null);
  assert.throws(() => buildCourtListenerSearchPath({ cites: "abc", page: 1 }), /numeric cites_id/);
  assert.throws(() => buildCourtListenerSearchPath({ query: "x", statuses: "draft", page: 1 }), /Unknown status/);
  assert.throws(() => buildCourtListenerSearchPath({ query: "x", filedAfter: "yesterday", page: 1 }), /YYYY-MM-DD/);
});

test("CourtListener court IDs accept aliases and reject unsafe values", () => {
  assert.deepEqual(normalizeCourtListenerCourtIds("SCOTUS, 9th circuit, nysd, nysd"), ["scotus", "ca9", "nysd"]);
  assert.throws(() => normalizeCourtListenerCourtIds("ca9; drop"), /Unknown court value/);
  assert.equal(isCourtListenerUrl("https://www.courtlistener.com/opinion/1/x/"), true);
  assert.equal(isCourtListenerUrl("https://example.com/opinion/1/x/"), false);
});
