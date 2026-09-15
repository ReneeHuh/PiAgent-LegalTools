import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentBrowser } from "./browser-choice.ts";
import { ensureDirectory, normalizeProviderResult, writeMarkdownMetadata, type DiscoveryProviderId, type NormalizedCase, type ProviderRawResult } from "./core.ts";
import { checkOpinionIntegrity, sha256 } from "./library.ts";
import { processDownloadedOpinion } from "./opinion-processing.ts";
import { registerResearchLibraryTools } from "./research-tools.ts";
import { readSearchRun, recordSearchPage, searchObservations, startSearchRun } from "./search-history.ts";
import { legalSearchOutcomeText, runLegalSearch, validateLegalSearchOptions } from "./session-search.ts";
import { runSelectedDownloads, type SelectedDownloadRuntime } from "./selected-downloads.ts";
import type { DownloadedCase } from "./workflows.ts";

async function fixture(fn: (ctx: ExtensionContext) => Promise<void>) {
  const parent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(parent, "legal-selections-")));
  try { await fn({ cwd: root } as ExtensionContext); }
  finally {
    assert.equal(dirname(root).toLowerCase(), parent.toLowerCase());
    assert.ok(basename(root).startsWith("legal-selections-"));
    rmSync(root, { recursive: true, force: true });
  }
}
function raw(provider: DiscoveryProviderId, id: number): ProviderRawResult {
  const title = `Example ${id} v. State`, snippet = `Excerpt ${id}`;
  if (provider === "scholar") return { title, snippet, caseId: String(id), url: `https://scholar.google.com/scholar_case?case=${id}`, meta: "9th Circuit, 2024" };
  if (provider === "courtlistener") return { title, snippet, clusterId: String(id), url: `https://www.courtlistener.com/opinion/${id}/example/`, court: "9th Circuit", year: "2024", status: "Published" };
  const casePath = `federal/appellate-courts/ca9/${id}/opinion.html`;
  return { title, snippet, url: `https://law.justia.com/cases/${casePath}`, casePath, breadcrumb: "Federal appellate courts", resultPosition: id };
}
function saved(ctx: ExtensionContext, item: NormalizedCase): DownloadedCase {
  const source = item.sources[0]!;
  const text = "This synthetic judicial opinion discusses the evidence and affirms the trial court. ".repeat(8);
  const html = source.provider === "scholar" ? `<div id="gs_opinion">${text}</div>`
    : source.provider === "courtlistener" ? `<div id="opinion-content">${text}</div>` : `<div id="opinion">${text}</div>`;
  const path = join(ensureDirectory(join(ctx.cwd, "Cases")), `${item.canonicalKey}.html`);
  writeFileSync(path, html);
  const downloaded: DownloadedCase = { case: item, status: "downloaded", saved: {
    provider: source.provider, providerId: source.providerId, sourceUrl: source.url, title: item.title,
    savedPath: path, htmlSha256: sha256(readFileSync(path)), returnedToResults: true,
  } };
  writeMarkdownMetadata(path.replace(/\.html$/, ".md"), item.title, { case: item, source: downloaded.saved }, true);
  return downloaded;
}
function historyTool() {
  const tools: any[] = [];
  registerResearchLibraryTools({ registerTool: (tool: unknown) => tools.push(tool) } as never);
  return tools.find(tool => tool.name === "legal_search_history");
}

for (const provider of ["scholar", "courtlistener", "justia"] as const) {
  test(`${provider}: compact preview, full inspection, older-page batch selection, and idempotent retry`, () => fixture(async ctx => {
    const pages = new Map([[1, Array.from({ length: 20 }, (_, i) => raw(provider, i + 1))], [2, [raw(provider, 21)]]]);
    const searched: number[] = [];
    const search: SelectedDownloadRuntime["search"] = async (selectedProvider, params) => {
      assert.equal(selectedProvider, provider);
      assert.equal(currentBrowser(), "edge");
      const page = params.page;
      searched.push(page);
      return { results: pages.get(page)!, reachedEnd: page === 2 };
    };
    const outcome = await runLegalSearch({ search_term: "evidence", provider, jurisdiction: "all", browser: "edge", pages_to_search: 2, max_cases_to_download: 0 },
      undefined, undefined, ctx, { search, now: Date.now, download: async () => { throw new Error("Listings must not download"); } });
    const content = legalSearchOutcomeText(outcome);
    const preview = JSON.parse(content.split("\n").find(line => line.startsWith('{"results":'))!);
    assert.equal(preview.results.length, 20);
    assert.equal(preview.totalResults, 21);
    assert.equal(preview.nextOffset, 20);
    assert.deepEqual(Object.keys(preview.results[0]), ["result_ref", "title", "court", "year", "publication_status", "case_key", "provider", "result_snippet"]);
    const tool = historyTool();
    const more = await tool.execute("read", { action: "read", run_id: outcome.runId, offset: 20 }, undefined, undefined, ctx);
    assert.equal(more.details.results[0].result_ref, outcome.results[20].result_ref);
    assert.equal(more.details.nextOffset, null);
    const inspect = await tool.execute("read", { action: "read", run_id: outcome.runId, result_ref: outcome.results[1].result_ref }, undefined, undefined, ctx);
    assert.deepEqual(inspect.details.results[0].provider_data, pages.get(1)![1]);
    const filtered = await tool.execute("read", { action: "read", run_id: outcome.runId, case_key: outcome.results[1].case_key }, undefined, undefined, ctx);
    assert.equal(filtered.details.totalResults, 1);
    assert.equal(filtered.details.results[0].case_key, outcome.results[1].case_key);
    const requested = [outcome.results[1].result_ref, outcome.results[4].result_ref, outcome.results[20].result_ref];
    const downloaded: string[] = [];
    const runtime: SelectedDownloadRuntime = { search, process: processDownloadedOpinion, download: async (item, url) => {
      assert.equal(currentBrowser(), "edge");
      assert.equal(url, item.sources[0].url);
      downloaded.push(item.title);
      return saved(ctx, item);
    } };
    const selected = { action: "download_results" as const, run_id: outcome.runId!, result_refs: requested };
    const batch = await runSelectedDownloads(selected, undefined, undefined, ctx, runtime);
    assert.equal(batch.status, "completed");
    assert.equal(batch.browser, "edge");
    assert.deepEqual(downloaded, ["Example 2 v. State", "Example 5 v. State", "Example 21 v. State"]);
    assert.deepEqual(searched, [1, 2, 1, 2], "restore the earlier page after enumeration has advanced");
    const retry = await runSelectedDownloads(selected, undefined, undefined, ctx, runtime);
    assert.equal(retry.status, "completed");
    assert.ok(retry.results.every(row => row.reused));
    assert.equal(downloaded.length, 3);
    assert.equal(searched.length, 4, "verified acquisitions need no browser on retry");
    const original = await tool.execute("read", { action: "read", run_id: outcome.runId, result_ref: requested[0] }, undefined, undefined, ctx);
    assert.equal(original.details.results[0].result_ref, requested[0]);
    assert.equal(Object.keys(original.details.downloads).length, 1);
  }));
}

test("observation references distinguish duplicates and remain stable after recapture and restart", () => fixture(async ctx => {
  const request = validateLegalSearchOptions({ search_term: "evidence", provider: "scholar", jurisdiction: "all", max_cases_to_download: 0 });
  const run = startSearchRun(ctx.cwd, request);
  const record = raw("scholar", 1), item = normalizeProviderResult("scholar", record, 1);
  recordSearchPage(run, 1, [record, record], [item, item]);
  const original = searchObservations(run);
  assert.notEqual(original[0].result_ref, original[1].result_ref);
  recordSearchPage(run, 1, [raw("scholar", 2)], [normalizeProviderResult("scholar", raw("scholar", 2), 1)]);
  const reread = readSearchRun(ctx.cwd, run.manifest.runId);
  assert.equal(searchObservations(reread).length, 1);
  assert.deepEqual(searchObservations(reread, false).slice(0, 1).map(row => row.result_ref), [original[0].result_ref]);
  const tool = historyTool();
  const inspected = await tool.execute("read", { action: "read", run_id: run.manifest.runId, result_ref: original[1].result_ref }, undefined, undefined, ctx);
  assert.equal(inspected.details.results[0].title, item.title);
  let calls = 0;
  await assert.rejects(() => runSelectedDownloads({ action: "download_results", run_id: run.manifest.runId,
    result_refs: [original[0].result_ref, "r_" + "0".repeat(32)] }, undefined, undefined, ctx,
    { search: async () => { calls++; return { results: [] }; }, download: async () => { calls++; throw new Error("unexpected"); }, process: processDownloadedOpinion }), /does not belong/);
  assert.equal(calls, 0, "validate the entire batch before acquiring the first row");
}));

test("search resume retains its browser and an explicit change persists without sharing navigation state", () => fixture(async ctx => {
  const seen: string[] = [];
  const runtime = { now: Date.now, search: async () => { seen.push(currentBrowser()); return { results: [raw("scholar", 1)] }; },
    download: async () => { throw new Error("unexpected download"); } };
  const request = { search_term: "evidence", provider: "scholar" as const, jurisdiction: "all", pages_to_search: 1, max_cases_to_download: 0 };
  const first = await runLegalSearch({ ...request, browser: "edge" }, undefined, undefined, ctx, runtime);
  await runLegalSearch({ ...request, run_id: first.runId, resume_page: 2 }, undefined, undefined, ctx, runtime);
  assert.deepEqual(seen, ["edge", "edge"]);
  await runLegalSearch({ ...request, run_id: first.runId, resume_page: 3, browser: "chrome" }, undefined, undefined, ctx, runtime);
  assert.deepEqual(seen, ["edge", "edge", "chrome"]);
  assert.equal(readSearchRun(ctx.cwd, first.runId!).manifest.request.browser, "chrome");
}));

test("a changed ranking never substitutes another opinion for a saved selection", () => fixture(async ctx => {
  const run = startSearchRun(ctx.cwd, validateLegalSearchOptions({ search_term: "evidence", provider: "scholar", jurisdiction: "all" }));
  recordSearchPage(run, 1, [raw("scholar", 1)], [normalizeProviderResult("scholar", raw("scholar", 1), 1)]);
  const ref = searchObservations(run)[0].result_ref;
  const outcome = await runSelectedDownloads({ action: "download_results", run_id: run.manifest.runId, result_refs: [ref] }, undefined, undefined, ctx, {
    search: async () => ({ results: [raw("scholar", 2)] }),
    download: async () => { assert.fail("Must not download a replacement row"); }, process: processDownloadedOpinion,
  });
  assert.equal(outcome.status, "partial_failure");
  assert.match(outcome.results[0].error!, /no longer on its saved result page/);
  assert.deepEqual(outcome.retry?.result_refs, [ref]);
}));

test("batch acquisition is checkpointed before derivative failure and restores results after a lost tab", () => fixture(async ctx => {
  const raws = [raw("scholar", 1), raw("scholar", 2)];
  const cases = raws.map((row, i) => normalizeProviderResult("scholar", row, i + 1));
  const run = startSearchRun(ctx.cwd, validateLegalSearchOptions({ search_term: "evidence", provider: "scholar", jurisdiction: "all" }));
  recordSearchPage(run, 1, raws, cases);
  const refs = searchObservations(run).map(row => row.result_ref);
  let restores = 0;
  const outcome = await runSelectedDownloads({ action: "download_results", run_id: run.manifest.runId, result_refs: refs }, undefined, undefined, ctx, {
    search: async () => { restores++; return { results: raws }; },
    download: async item => { const value = saved(ctx, item); value.saved!.returnedToResults = false; return value; },
    process: async downloaded => {
      const savedRun = readSearchRun(ctx.cwd, run.manifest.runId);
      assert.equal(checkOpinionIntegrity(savedRun.manifest.downloads[downloaded.case.canonicalKey].saved, join(ctx.cwd, "Cases")).status, "valid");
      if (downloaded.case.canonicalKey === cases[0].canonicalKey) throw new Error("conversion unavailable");
      await processDownloadedOpinion(downloaded, false, undefined, undefined, ctx);
    },
  });
  assert.equal(restores, 2);
  assert.equal(outcome.status, "partial_failure");
  assert.ok(outcome.results.every(row => row.status === "downloaded"));
  assert.deepEqual(outcome.retry?.result_refs, [refs[0]]);
}));

test("cancellation preserves acquisition and leaves only unfinished batch work for retry", () => fixture(async ctx => {
  const controller = new AbortController();
  const raws = [raw("scholar", 1), raw("scholar", 2)];
  const run = startSearchRun(ctx.cwd, validateLegalSearchOptions({ search_term: "evidence", provider: "scholar", jurisdiction: "all" }));
  recordSearchPage(run, 1, raws, raws.map((row, i) => normalizeProviderResult("scholar", row, i + 1)));
  const refs = searchObservations(run).map(row => row.result_ref);
  const outcome = await runSelectedDownloads({ action: "download_results", run_id: run.manifest.runId, result_refs: refs }, controller.signal, undefined, ctx, {
    search: async () => ({ results: raws }), download: async item => saved(ctx, item),
    process: async downloaded => { await processDownloadedOpinion(downloaded, false, undefined, undefined, ctx); controller.abort(); },
  });
  assert.equal(outcome.status, "stopped");
  assert.deepEqual(outcome.results.map(row => row.status), ["downloaded", "not_attempted"]);
  assert.deepEqual(outcome.retry?.result_refs, [refs[1]]);
}));

test("duplicate native opinions with different displayed titles inspect and reuse the same saved acquisition", () => fixture(async ctx => {
  const rows = [raw("scholar", 1), { ...raw("scholar", 1), title: "Alternative displayed case name" }];
  let downloads = 0;
  const outcome = await runLegalSearch({ search_term: "evidence", provider: "scholar", jurisdiction: "all", max_cases_to_download: 1 }, undefined, undefined, ctx, {
    search: async () => ({ results: rows, reachedEnd: true }), now: Date.now,
    download: async item => { downloads++; return saved(ctx, item); },
  });
  const ref = outcome.results[1].result_ref;
  const inspected = await historyTool().execute("read", { action: "read", run_id: outcome.runId, result_ref: ref }, undefined, undefined, ctx);
  assert.ok(inspected.details.downloads[outcome.results[0].case_key]?.saved);
  const selected = await runSelectedDownloads({ action: "download_results", run_id: outcome.runId!, result_refs: [ref] }, undefined, undefined, ctx, {
    search: async () => { assert.fail("Already saved native identity needs no browser"); },
    download: async () => { assert.fail("Duplicate observations must reuse the saved acquisition"); }, process: processDownloadedOpinion,
  });
  assert.equal(selected.status, "completed");
  assert.equal(selected.results[0].case_key, outcome.results[0].case_key);
  assert.equal(selected.results[0].reused, true);
  assert.equal(downloads, 1);
}));
