import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureDirectory, normalizeProviderResult, writeJsonAtomic, writeMarkdownMetadata, type NormalizedCase, type ScholarRawResult } from "./core.ts";
import { checkOpinionIntegrity, findSavedOpinion, restoreSavedCapture, saveOpinionCapture, searchLibrary, sha256 } from "./library.ts";
import { runLegalSearch, type LegalSearchRuntime } from "./session-search.ts";
import { latestSearchPages, listSearchHistory, readSearchRun } from "./search-history.ts";
import { runLegalCitedBy } from "./library-cited-by.ts";
import { runCitedByReport } from "./cited-by.ts";
import { listCitedCollections } from "./cited-collections.ts";
import type { SavedOpinion } from "./providers.ts";
import register from "./index.ts";
import { browserClickNextResultsPage } from "./provider-courtlistener.ts";
import { directCandidateKey, directDownloadOutcomeText, runDirectDownload } from "./direct-download.ts";

const context = (cwd: string) => ({ cwd }) as ExtensionContext;
const raw = (id: number): ScholarRawResult => ({ title: `Example ${id} v. State`, caseId: String(id), citesId: String(id),
  url: `https://scholar.google.com/scholar_case?case=${id}`, meta: `${100 + id} F.3d ${200 + id} - 6th Circuit, 2024`, snippet: "A provider discovery excerpt." });
const opinion = (extra = "") => `<div id="gs_opinion">${extra} ${"This synthetic judicial opinion is used for software tests, including reasonable care and evidentiary standards. ".repeat(5)}</div>`;
async function fixture(fn: (root: string) => Promise<void> | void) {
  const parent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(parent, "legal-upgrade-")));
  try { await fn(root); }
  finally {
    assert.equal(dirname(root).toLowerCase(), parent.toLowerCase());
    assert.ok(basename(root).startsWith("legal-upgrade-"));
    rmSync(root, { recursive: true, force: true });
  }
}
function save(root: string, item: NormalizedCase, extra = ""): SavedOpinion {
  const path = saveOpinionCapture(join(ensureDirectory(join(root, "Cases")), `${item.canonicalKey}.html`), opinion(extra));
  const saved: SavedOpinion = { provider: "scholar", providerId: item.sources[0].providerId, title: item.title,
    sourceUrl: item.sources[0].url, savedPath: path, htmlSha256: sha256(readFileSync(path)) };
  writeMarkdownMetadata(path.replace(/\.html$/, ".md"), item.title, { case: item, source: saved, downloadedAt: "2026-01-01T00:00:00Z" }, true);
  return saved;
}
const options = { search_term: "reasonable care", provider: "scholar" as const, jurisdiction: "michigan", pages_to_search: 1, max_cases_to_download: 0 };
const runtime = (search: LegalSearchRuntime["search"], download?: LegalSearchRuntime["download"]): LegalSearchRuntime => ({
  now: Date.now, search, download: download ?? (async () => { throw new Error("Unexpected provider download"); }),
});

test("identical captures are reused and changed captures preserve original HTML and sidecar", () => fixture(root => {
  const item = normalizeProviderResult("scholar", raw(1), 1);
  const first = save(root, item);
  const metadata = first.savedPath.replace(/\.html$/, ".md");
  const priorMetadata = readFileSync(metadata, "utf8");
  assert.equal(saveOpinionCapture(first.savedPath, opinion()), first.savedPath);
  const second = saveOpinionCapture(first.savedPath, opinion("Changed version"));
  assert.notEqual(second, first.savedPath);
  assert.equal(readFileSync(first.savedPath, "utf8"), opinion());
  assert.equal(readFileSync(metadata, "utf8"), priorMetadata);
  writeMarkdownMetadata(metadata, "Changed heading", { downloadedAt: "later" }, true);
  assert.equal(readFileSync(metadata, "utf8"), priorMetadata);
  assert.equal(checkOpinionIntegrity(first, join(root, "Cases")).status, "valid");
}));

test("missing, empty, changed, and unhashed opinions are not reusable", () => fixture(root => {
  const item = normalizeProviderResult("scholar", raw(1), 1);
  const saved = save(root, item);
  assert.equal(checkOpinionIntegrity({ ...saved, savedPath: join(root, "missing.html") }).status, "missing");
  assert.equal(checkOpinionIntegrity({ ...saved, htmlSha256: undefined }).status, "unverified");
  writeFileSync(saved.savedPath, opinion("Altered"));
  assert.equal(checkOpinionIntegrity(saved).status, "changed");
  assert.equal(findSavedOpinion(join(root, "Cases"), item).saved, undefined);
  writeFileSync(saved.savedPath, "");
  assert.equal(checkOpinionIntegrity(saved).status, "empty");
}));

test("restoration failure returns the persisted capture instead of losing it", () => fixture(async root => {
  const path = saveOpinionCapture(join(root, "opinion.html"), opinion());
  const restored = await restoreSavedCapture({ savedPath: path }, async () => { throw new Error("Back failed"); });
  assert.equal(restored.savedPath, path);
  assert.equal(restored.returnedToResults, false);
  assert.match(restored.restorationError!, /Back failed/);
  assert.equal(existsSync(path), true);
}));

test("CourtListener Next keeps its connection open until the new page has been captured", async () => {
  let closed = false;
  let navigated = false;
  const cdp = {
    send: async () => ({}),
    close: () => { closed = true; },
    eval: async (_session: string, expression: string) => {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(closed, false, "CDP closed before the asynchronous capture completed");
      if (expression === "location.href") return "https://www.courtlistener.com/?q=fixture";
      if (expression.includes("link.click()")) { navigated = true; return true; }
      if (expression === "document.documentElement.outerHTML") return "<html>Captured page two</html>";
      return { href: "https://www.courtlistener.com/?q=fixture&page=2", title: "Results", ready: "complete", results: true, noResults: false, verification: false, blocked: false, hasNext: false };
    },
  };
  const bridge = { withLock: (fn: () => Promise<unknown>) => fn(), connect: async () => cdp,
    attachTab: async () => ({ targetId: "target", sessionId: "session" }), pauseBeforeClick: async () => {} };
  const captured = await browserClickNextResultsPage({ targetId: "target" } as never, undefined, undefined, bridge as never);
  assert.equal(navigated, true);
  assert.equal(closed, true);
  assert.match(captured.html, /page two/);
});

test("search saves every raw result even without downloads and marks missing publication data", () => fixture(async root => {
  const outcome = await runLegalSearch(options, undefined, undefined, context(root), runtime(async () => ({ results: [raw(1), raw(2)], reachedEnd: true })));
  const run = readSearchRun(root, outcome.runId!);
  assert.deepEqual(latestSearchPages(run)[0].records.map(r => r.raw), [raw(1), raw(2)]);
  assert.equal(run.manifest.request.jurisdiction.canonical, "michigan");
  assert.deepEqual(run.manifest.request.jurisdiction.courtListenerCourts, ["mich", "michctapp"]);
  assert.equal(outcome.results[0].download_status, "not_requested");
  assert.equal(outcome.results[0].publication_status, null);
  assert.equal(outcome.results[0].passage_source, "provider_snippet");
  assert.ok(run.manifest.lastRetrievedAt);
  assert.ok(existsSync(outcome.reviewPath!));
}));

test("resume retains earlier pages and notes and fetches only unfinished pages", () => fixture(async root => {
  const calls: number[] = [];
  const first = await runLegalSearch({ ...options, pages_to_search: 2 }, undefined, undefined, context(root), runtime(async (_provider, params) => {
    calls.push(params.page!);
    if (params.page === 2) throw new Error("Interrupted");
    return { results: [raw(1)] };
  }));
  assert.equal(first.status, "stopped");
  appendFileSync(first.reviewPath!, "\nMy review note.\n");
  const second = await runLegalSearch({ ...options, pages_to_search: undefined, run_id: first.runId }, undefined, undefined, context(root), runtime(async (_provider, params) => {
    calls.push(params.page!); return { results: [raw(2)], reachedEnd: true };
  }));
  assert.equal(second.runId, first.runId);
  assert.deepEqual(calls, [1, 2, 2]);
  assert.equal(second.resultCount, 2);
  assert.deepEqual(second.completedPages, [1, 2]);
  assert.match(readFileSync(second.reviewPath!, "utf8"), /My review note/);
}));

test("completed resume does not retrieve again; refresh preserves old run and captures a new set", () => fixture(async root => {
  let calls = 0;
  const first = await runLegalSearch(options, undefined, undefined, context(root), runtime(async () => { calls++; return { results: [raw(1)], reachedEnd: true }; }));
  const resumed = await runLegalSearch({ ...options, run_id: first.runId }, undefined, undefined, context(root), runtime(async () => { throw new Error("Must not refetch"); }));
  assert.equal(resumed.lastRetrievedAt, first.lastRetrievedAt);
  const oldManifest = readFileSync(first.manifestPath!, "utf8");
  const fresh = await runLegalSearch({ ...options, refresh_of: first.runId }, undefined, undefined, context(root), runtime(async () => { calls++; return { results: [raw(1), raw(2)], reachedEnd: true }; }));
  assert.equal(calls, 2);
  assert.notEqual(fresh.runId, first.runId);
  assert.equal(readFileSync(first.manifestPath!, "utf8"), oldManifest);
  assert.equal(readSearchRun(root, fresh.runId!).manifest.comparison!.newCaseKeys.length, 1);
}));

test("changed filters cannot silently replace a saved search", () => fixture(async root => {
  const first = await runLegalSearch(options, undefined, undefined, context(root), runtime(async () => ({ results: [raw(1)], reachedEnd: true })));
  await assert.rejects(() => runLegalSearch({ ...options, run_id: first.runId, jurisdiction: "6th circuit" }, undefined, undefined, context(root), runtime(async () => { throw new Error("Must not call provider"); })), /same query, provider, courts/);
}));

test("torn search append is preserved for diagnosis and resumed without losing committed pages", () => fixture(async root => {
  const first = await runLegalSearch(options, undefined, undefined, context(root), runtime(async () => ({ results: [raw(1)] })));
  const directory = dirname(first.manifestPath!);
  appendFileSync(join(directory, "results.jsonl"), '{"type":"pa');
  await runLegalSearch({ ...options, run_id: first.runId, resume_page: 2 }, undefined, undefined, context(root), runtime(async () => ({ results: [raw(2)], reachedEnd: true })));
  assert.equal(latestSearchPages(readSearchRun(root, first.runId!)).length, 2);
  assert.ok(readdirSync(directory).some(name => name.startsWith("torn-append-")));
}));

test("an empty cached opinion triggers reacquisition and is never counted as downloaded", () => fixture(async root => {
  const item = normalizeProviderResult("scholar", raw(1), 1);
  const saved = save(root, item);
  writeFileSync(saved.savedPath, "");
  let downloads = 0;
  const outcome = await runLegalSearch({ ...options, max_cases_to_download: 1 }, undefined, undefined, context(root), runtime(async () => ({ results: [raw(1)], reachedEnd: true }), async item => {
    downloads++; return { case: item, status: "failed", error: "Fixture provider unavailable" };
  }));
  assert.equal(downloads, 1);
  assert.equal(outcome.downloadSummary.downloaded, 0);
  assert.equal(outcome.status, "partial_failure");
  assert.ok(outcome.warnings!.some(w => w.includes("200 characters")));
}));

test("local library searches names, citations, court and full opinion text with source hashes", () => fixture(root => {
  const item = normalizeProviderResult("scholar", raw(1), 1);
  const saved = save(root, item, "unusual evidence phrase");
  for (const query of ["Example 1", "101 F.3d 201", "unusual evidence"]) {
    const found = searchLibrary(root, { query, court: "6th" });
    assert.equal(found.results.length, 1, query);
    assert.equal(found.results[0].html_sha256, saved.htmlSha256);
    assert.equal(found.results[0].integrity.status, "valid");
  }
  assert.match(searchLibrary(root, { query: "unusual evidence" }).results[0].matching_passage!, /unusual evidence/);
  assert.equal(searchLibrary(root, { case_key: "missing" }).results.length, 0);
}));

test("history review notes keep retrieval time unchanged and reject cases absent from the search", () => fixture(async root => {
  const first = await runLegalSearch(options, undefined, undefined, context(root), runtime(async () => ({ results: [raw(1)], reachedEnd: true })));
  const registered: any[] = [];
  register({ registerTool: (tool: any) => registered.push(tool) } as never);
  const tool = registered.find(tool => tool.name === "legal_search_history");
  await tool.execute("review", { action: "review", run_id: first.runId, case_key: first.results[0].case_key, review_status: "rejected", note: "Different procedural posture." }, undefined, undefined, context(root));
  assert.equal(readSearchRun(root, first.runId!).manifest.lastRetrievedAt, first.lastRetrievedAt);
  assert.match(readFileSync(first.reviewPath!, "utf8"), /Different procedural posture/);
  await assert.rejects(() => tool.execute("bad", { action: "review", run_id: first.runId, case_key: "missing", review_status: "useful", note: "test" }, undefined, undefined, context(root)), /does not occur/);
  assert.equal(listSearchHistory(root, { case_key: first.results[0].case_key }).totalRuns, 1);
}));

test("cited-by refresh fetches new results and leaves the earlier manifest and retrieval time intact", () => fixture(async root => {
  const seed = normalizeProviderResult("scholar", raw(1), 1);
  save(root, seed);
  let fetches = 0;
  const rt = { enumerate: ((opts, signal, update, ctx) => runCitedByReport(opts, signal, update, ctx, { search: async () => {
    fetches++; return { results: fetches === 1 ? [raw(2)] : [raw(2), raw(3)], reachedEnd: true };
  } })) as typeof runCitedByReport, download: runtime(async () => ({ results: [] })).download };
  const first = await runLegalCitedBy({ action: "collect", case_key: seed.canonicalKey, jurisdiction: "michigan", year_from: 2000, max_cases_to_download: 0 }, undefined, undefined, context(root), rt);
  const resumed = await runLegalCitedBy({ action: "resume", case_key: seed.canonicalKey }, undefined, undefined, context(root), rt);
  assert.equal(fetches, 1);
  assert.equal(resumed.lastRetrievedAt, first.lastRetrievedAt);
  const oldManifest = readFileSync(first.manifestPath, "utf8");
  const fresh = await runLegalCitedBy({ action: "refresh", case_key: seed.canonicalKey, max_cases_to_download: 0 }, undefined, undefined, context(root), rt);
  assert.equal(fetches, 2);
  assert.notEqual(first.runId, fresh.runId);
  assert.equal(fresh.newCaseKeys.length, 1);
  assert.equal(readFileSync(first.manifestPath, "utf8"), oldManifest);
  assert.equal(JSON.parse(readFileSync(fresh.manifestPath, "utf8")).filters.year_from, 2000);
  assert.equal(listCitedCollections(root, seed.canonicalKey).length, 2);
}));

test("cited-by resume recovers actual retrieval time from the committed journal", () => fixture(async root => {
  const seed = normalizeProviderResult("scholar", raw(1), 1);
  const first = await runCitedByReport({ seed, providers: ["scholar"], save_path: join(root, "collection") }, undefined, undefined, context(root), {
    search: async () => ({ results: [raw(2)], reachedEnd: true }),
  });
  const path = join(root, "collection", "cited-by-manifest.json");
  const stale = JSON.parse(readFileSync(path, "utf8"));
  delete stale.lastRetrievedAt;
  writeJsonAtomic(path, stale);
  const resumed = await runCitedByReport({ resume_from: path }, undefined, undefined, context(root), {
    search: async () => { throw new Error("Completed history must not navigate again"); },
  });
  assert.ok(first.lastRetrievedAt);
  assert.equal(resumed.lastRetrievedAt, first.lastRetrievedAt);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).lastRetrievedAt, first.lastRetrievedAt);
}));

test("history can inspect a cited-by run interrupted before result and download files were created", () => fixture(async root => {
  const directory = ensureDirectory(join(root, "Research", "CitedBy", "fixture", "interrupted-run"));
  writeJsonAtomic(join(directory, "cited-by-manifest.json"), {
    mode: "cited_by", seed: normalizeProviderResult("scholar", raw(1), 1), status: "running", createdAt: "2026-01-01T00:00:00Z",
  });
  const registered: any[] = [];
  register({ registerTool: (tool: any) => registered.push(tool) } as never);
  const inspected = await registered.find(tool => tool.name === "legal_search_history")
    .execute("read", { action: "read", run_id: "interrupted-run" }, undefined, undefined, context(root));
  assert.equal(inspected.details.totalResults, 0);
  assert.deepEqual(inspected.details.downloads, {});
  assert.equal(inspected.details.manifest.lastRetrievedAt, undefined);
}));

test("a failed history link does not hide a successful direct download or leave its selection claimed", () => fixture(async root => {
  const item = normalizeProviderResult("scholar", raw(1), 1);
  const saved = save(root, item);
  const handle = "k7m2q9tx";
  const candidateKey = directCandidateKey(item.sources[0])!;
  const path = join(ensureDirectory(join(root, "Cases", "_direct_selections")), `${handle}.json`);
  writeJsonAtomic(path, { schemaVersion: 1, selectionHandle: handle, createdAt: new Date().toISOString(),
    caseName: item.title, jurisdiction: "michigan", candidates: [{ candidateKey, case: item, source: item.sources[0] }],
    researchRuns: [{ runId: "missing-search", provider: "scholar", manifestPath: "missing" }],
  });
  const outcome = await runDirectDownload({ action: "download", selection_handle: handle, candidate_key: candidateKey }, undefined, undefined, context(root),
    async () => ({ case: item, status: "downloaded", saved }));
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.download?.saved?.savedPath, saved.savedPath);
  assert.match(directDownloadOutcomeText(outcome), /Warning: Could not link/);
  const selection = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(selection.usedAt);
  assert.equal(selection.claimedAt, undefined);
  assert.equal(checkOpinionIntegrity(saved).status, "valid");
}));

test("cited-by resume detects a missing saved citing opinion and reports failed reacquisition", () => fixture(async root => {
  const seed = normalizeProviderResult("scholar", raw(1), 1), citing = normalizeProviderResult("scholar", raw(2), 1, "cited_by", seed.canonicalKey);
  save(root, seed);
  let downloads = 0;
  const rt = { enumerate: ((opts, signal, update, ctx) => runCitedByReport(opts, signal, update, ctx, { search: async () => ({ results: [raw(2)], reachedEnd: true }) })) as typeof runCitedByReport,
    download: (async item => { downloads++; return { case: item, status: "failed", error: "Unavailable" }; }) as LegalSearchRuntime["download"] };
  const first = await runLegalCitedBy({ action: "collect", case_key: seed.canonicalKey, max_cases_to_download: 0 }, undefined, undefined, context(root), rt);
  writeJsonAtomic(join(first.directory, "downloads.json"), [{ case: citing, status: "downloaded", saved: { provider: "scholar", savedPath: join(root, "Cases", "missing.html") } }]);
  const resumed = await runLegalCitedBy({ action: "resume", case_key: seed.canonicalKey, max_cases_to_download: 1 }, undefined, undefined, context(root), rt);
  assert.equal(downloads, 1);
  assert.equal(resumed.downloadedCases, 0);
  assert.equal(resumed.failedDownloads, 1);
  assert.equal(resumed.status, "partial_failure");
}));

test("provider publication status survives normalization and appears in result inspection", () => fixture(async root => {
  const outcome = await runLegalSearch({ ...options, provider: "courtlistener" }, undefined, undefined, context(root), runtime(async () => ({ results: [{ title: "Example v. State", clusterId: "1", status: "Published", court: "Michigan Supreme Court", dateFiled: "2024-01-01", snippet: "Discovery excerpt" }], reachedEnd: true })));
  assert.equal(outcome.results[0].publication_status, "Published");
  assert.equal(outcome.results[0].date_filed, "2024-01-01");
}));
