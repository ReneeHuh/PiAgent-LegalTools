import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadCaseSource } from "../case-summarizer/source.ts";
import { caseSummaryJsonShape } from "../case-summarizer/schema.ts";
import { splitOpinionMarkdown } from "../shared/opinion-markdown.ts";
import { extractOpinionMarkdown, normalizeProviderResult, opinionMetadataMarkdownPath, readMarkdownMetadata, writeMarkdownMetadata, ensureDirectory } from "./core.ts";
import { runLegalSearch, type LegalSearchRuntime } from "./session-search.ts";
import { hashSavedOpinion } from "./workflows.ts";
import { runDirectDownload } from "./direct-download.ts";
import { runCitedByReport } from "./cited-by.ts";
import { runLegalCitedBy, loadSavedCitedBySeed } from "./library-cited-by.ts";
import { searchLibrary } from "./library.ts";
import { readSearchRun } from "./search-history.ts";
import type { SavedOpinion } from "./providers.ts";

const text = "The court affirmed the judgment because the evidence supported the finding. ".repeat(6);
const raw = (id: number) => ({ title: `Case ${id} v. State`, caseId: `${id}`, citesId: `${id}`, url: `https://scholar.google.com/scholar_case?case=${id}`, meta: `${123 + id} F.3d 456 - 6th Circuit, 2024` });
const options = { search_term: "reasonable care", provider: "scholar" as const, jurisdiction: "6th circuit", pages_to_search: 1, max_cases_to_download: 1 };
async function fixture(fn: (root: string) => Promise<void>) {
  const parent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(parent, "opinion-pipeline-")));
  try { await fn(root); } finally {
    assert.equal(dirname(root).toLowerCase(), parent.toLowerCase());
    assert.ok(basename(root).startsWith("opinion-pipeline-"));
    rmSync(root, { recursive: true, force: true });
  }
}
function setup(root: string, events: string[], failModel = () => false) {
  let calls = 0;
  const ctx = { cwd: root, model: { provider: "fixture", id: "model", api: "openai-completions", contextWindow: 200000, maxTokens: 9000 },
    modelRegistry: { hasConfiguredAuth: () => true, complete: async (_model: unknown, input: any) => {
      calls++;
      events.push("model");
      if (failModel()) throw new Error("Model offline");
      const prompt = input.messages[0].content[0].text;
      const summary = JSON.parse(caseSummaryJsonShape());
      summary.key_quotes = [];
      return { content: [{ type: "text", text: JSON.stringify(prompt.includes("fourth-call auditor") ? { disagreements: [], findings: [], required_corrections: [] } : summary) }], stopReason: "stop", usage: {} };
    } },
  } as unknown as ExtensionContext;
  const runtime: LegalSearchRuntime = { now: Date.now,
    search: async () => { events.push("search"); return { results: [raw(1)], reachedEnd: true }; },
    download: async item => {
      events.push("download");
      const path = join(ensureDirectory(join(root, "Cases")), `${item.canonicalKey}.html`);
      writeFileSync(path, `<nav>EXCLUDED_NAVIGATION</nav><div id="gs_opinion"><h2>Opinion</h2><p>${text}</p></div><div id="gs_ftr">EXCLUDED_FOOTER</div>`);
      const saved: SavedOpinion = { savedPath: path, provider: "scholar", providerId: item.sources[0].providerId, sourceUrl: item.sources[0].url, title: item.title };
      hashSavedOpinion(saved);
      writeMarkdownMetadata(opinionMetadataMarkdownPath(path), item.title, { case: item, source: saved, downloadedAt: "2026-09-12", private_note: "METADATA_NOT_OPINION" }, true);
      return { case: item, status: "downloaded", saved };
    },
  };
  return { ctx, runtime, calls: () => calls };
}

test("search saves HTML and opinion Markdown without a model call when summarize is omitted", () => fixture(async root => {
  const events: string[] = [];
  const { ctx, runtime, calls } = setup(root, events);
  const result = await runLegalSearch(options, undefined, undefined, ctx, runtime);
  const row = result.results[0];
  assert.equal(row.download_status, "downloaded");
  assert.equal(calls(), 0);
  assert.deepEqual(readdirSync(join(root, "Cases")).map(p => p.slice(p.lastIndexOf("."))).sort(), [".html", ".md"]);
  const markdown = readFileSync(row.saved_md_path!, "utf8");
  const parsed = splitOpinionMarkdown(markdown);
  assert.match(parsed.body, /## Opinion/);
  assert.doesNotMatch(parsed.body, /EXCLUDED_NAVIGATION|EXCLUDED_FOOTER|METADATA_NOT_OPINION/);
  const loaded = await loadCaseSource({ cwd: root, sourcePath: row.saved_md_path! });
  assert.equal(loaded.caseKey, row.case_key);
  assert.doesNotMatch(loaded.normalizedText, /METADATA_NOT_OPINION/);
  assert.equal(searchLibrary(root, {}).results[0].integrity.status, "valid");
  assert.equal(loadSavedCitedBySeed(ctx, row.case_key).canonicalKey, row.case_key);
}));

test("search directly awaits summarization, saves all three files, forwards progress, and reuses them on resume", () => fixture(async root => {
  const events: string[] = [];
  const { ctx, runtime, calls } = setup(root, events);
  const updates: any[] = [];
  const result = await runLegalSearch({ ...options, summarize: true }, undefined, update => updates.push(update.details), ctx, runtime);
  const row = result.results[0];
  assert.equal(calls(), 5);
  assert.equal(readdirSync(join(root, "Cases")).length, 3);
  assert.equal(row.summary?.status, "completed");
  assert.ok(existsSync(row.summary!.path!));
  assert.ok(updates.some(u => u.phase === "converting" && u.status === "completed"));
  assert.equal(updates.filter(u => u.tool === "summarize_case" && u.status === "analyzing").length, 3);
  for (const status of ["reading_source", "auditing", "reconstructing", "saving", "completed"]) assert.ok(updates.some(u => u.tool === "summarize_case" && u.status === status), status);
  assert.equal(readSearchRun(root, result.runId!).manifest.request.summarize, true);
  const repeated = await runLegalSearch({ ...options, run_id: result.runId }, undefined, undefined, ctx, runtime);
  assert.equal(calls(), 5);
  assert.equal(events.filter(e => e === "download").length, 1);
  assert.equal(repeated.downloadSummary.downloaded, 1);
  assert.equal(repeated.results[0].summary?.path, row.summary?.path);
}));

test("summary failure preserves acquisition and resume retries without downloading again", () => fixture(async root => {
  let offline = true;
  const events: string[] = [];
  const { ctx, runtime } = setup(root, events, () => offline);
  const first = await runLegalSearch({ ...options, summarize: true }, undefined, undefined, ctx, runtime);
  assert.equal(first.status, "partial_failure");
  assert.equal(first.results[0].download_status, "downloaded");
  assert.equal(first.results[0].summary?.status, "failed");
  assert.match(first.warnings!.join(" "), /Model offline/);
  assert.ok(existsSync(first.results[0].saved_html_path!));
  assert.ok(existsSync(first.results[0].saved_md_path!));
  offline = false;
  const second = await runLegalSearch({ ...options, run_id: first.runId }, undefined, undefined, ctx, runtime);
  assert.equal(second.results[0].summary?.status, "completed");
  assert.equal(events.filter(e => e === "download").length, 1);
}));

test("CourtListener Markdown preserves headings, page markers, footnotes, and cited-by metadata", () => fixture(async root => {
  const html = `<nav>EXCLUDED_NAVIGATION</nav><div class="main-document"><article><h2>Majority opinion</h2><p><a class="page-label">461</a>${text}<sup><a href="#fn1">1</a></sup></p><h3>Dissent</h3><p>Dissenting reasoning.</p><p id="fn1">Footnote detail.</p><a class="jumpback">EXCLUDED_BACKLINK</a></article></div>`;
  const body = extractOpinionMarkdown(html, "courtlistener");
  assert.match(body, /## Majority opinion/);
  assert.match(body, /### Dissent/);
  assert.match(body, /461/);
  assert.match(body, /Footnote detail/);
  assert.doesNotMatch(body, /EXCLUDED_/);
  const path = join(root, "case.html");
  writeFileSync(path, html);
  const source: SavedOpinion = { provider: "courtlistener", sourceUrl: "https://www.courtlistener.com/opinion/1/example/", savedPath: path, title: "Example" };
  hashSavedOpinion(source);
  const item = normalizeProviderResult("scholar", raw(1), 1);
  item.sources = [{ provider: "courtlistener", providerId: "1", url: source.sourceUrl, citedById: "1", discoveredBy: "search" }];
  writeMarkdownMetadata(join(root, "case.md"), item.title, { case: item, source }, true);
  const metadata = readMarkdownMetadata<any>(join(root, "case.md"));
  assert.equal(metadata.case.sources[0].citedById, "1");
  assert.match((await loadCaseSource({ cwd: root, sourcePath: "case.md" })).normalizedText, /Footnote detail/);
}));


test("each opinion is fully summarized before search starts the next download", () => fixture(async root => {
  const events: string[] = [];
  const { ctx, runtime } = setup(root, events);
  runtime.search = async () => ({ results: [raw(1), raw(2)], reachedEnd: true });
  const result = await runLegalSearch({ ...options, max_cases_to_download: 2, summarize: true }, undefined, undefined, ctx, runtime);
  assert.deepEqual(events, ["download", ...Array(5).fill("model"), "download", ...Array(5).fill("model")]);
  assert.equal(result.downloadSummary.downloaded, 2);
  assert.ok(result.results.every(row => row.summary?.status === "completed"));
}));

test("direct_download calls the summary implementation and emits its progress", () => fixture(async root => {
  const events: string[] = [];
  const { ctx, runtime, calls } = setup(root, events);
  const item = normalizeProviderResult("scholar", raw(1), 1);
  const selection = { schemaVersion: 1, selectionHandle: "12345678", createdAt: new Date().toISOString(), candidates: [{ candidateKey: "scholar:1", case: item, source: item.sources[0] }] };
  writeFileSync(join(ensureDirectory(join(root, "Cases", "_direct_selections")), "12345678.json"), JSON.stringify(selection));
  const updates: any[] = [];
  const result = await runDirectDownload({ action: "download", selection_handle: "12345678", candidate_key: "scholar:1", summarize: true }, undefined,
    update => updates.push(update.details), ctx,
    async item => runtime.download(item, join(root, "Cases"), "scholar", undefined, undefined, undefined));
  assert.equal(result.status, "completed");
  assert.equal(calls(), 5);
  assert.ok(existsSync(result.download!.saved!.markdownPath!));
  assert.ok(existsSync(result.download!.saved!.summary!.path!));
  assert.ok(updates.some(u => u.tool === "summarize_case" && u.status === "completed"));
}));

test("cited-by downloads invoke summarization and resume keeps the flag", () => fixture(async root => {
  const events: string[] = [];
  const { ctx, runtime, calls } = setup(root, events);
  const seed = normalizeProviderResult("scholar", raw(1), 1);
  await runtime.download(seed, join(root, "Cases"), "scholar", undefined, undefined, undefined);
  const citedRuntime = { download: runtime.download,
    enumerate: (...args: Parameters<typeof runCitedByReport>) => runCitedByReport(args[0], args[1], args[2], args[3], {
      search: async () => ({ results: [raw(2)], reachedEnd: true }),
    }),
  };
  const result = await runLegalCitedBy({ action: "collect", case_key: seed.canonicalKey, jurisdiction: "6th circuit", pages_to_search: 1, max_cases_to_download: 1, summarize: true }, undefined, undefined, ctx, citedRuntime);
  assert.equal(calls(), 5);
  const downloads = JSON.parse(readFileSync(join(result.directory, "downloads.json"), "utf8"));
  assert.equal(downloads[0].saved.summary.status, "completed");
  const again = await runLegalCitedBy({ action: "resume", case_key: seed.canonicalKey, run_id: result.runId }, undefined, undefined, ctx, citedRuntime);
  assert.equal(again.downloadedCases, 1);
  assert.equal(calls(), 5);
}));


test("legacy metadata sidecars are preserved while being upgraded to opinion Markdown", () => fixture(async root => {
  const events: string[] = [];
  const { ctx, runtime } = setup(root, events);
  const first = await runLegalSearch(options, undefined, undefined, ctx, runtime);
  const path = first.results[0].saved_md_path!;
  const metadata = readMarkdownMetadata<any>(path);
  const legacy = "## Machine-readable metadata\n\n```json\n" + JSON.stringify(metadata) + "\n```\n";
  writeFileSync(path, legacy);
  const next = await runLegalSearch({ ...options, run_id: first.runId }, undefined, undefined, ctx, runtime);
  assert.equal(next.results[0].download_status, "downloaded");
  assert.equal(readFileSync(`${path}.legacy`, "utf8"), legacy);
  assert.match(splitOpinionMarkdown(readFileSync(path, "utf8")).body, /## Opinion/);
  assert.equal(events.filter(e => e === "download").length, 1);
}));

test("resume respects zero and reduced download caps before summarizing saved opinions", () => fixture(async root => {
  const { ctx, runtime, calls } = setup(root, []);
  runtime.search = async () => ({ results: [raw(1), raw(2)], reachedEnd: true });
  const first = await runLegalSearch({ ...options, max_cases_to_download: 2 }, undefined, undefined, ctx, runtime);
  await runLegalSearch({ ...options, run_id: first.runId, max_cases_to_download: 0, summarize: true }, undefined, undefined, ctx, runtime);
  assert.equal(calls(), 0);
  await runLegalSearch({ ...options, run_id: first.runId, max_cases_to_download: 1, summarize: true }, undefined, undefined, ctx, runtime);
  assert.equal(calls(), 5);
}));

test("resume preserves manually edited opinion Markdown", () => fixture(async root => {
  const { ctx, runtime, calls } = setup(root, []);
  const first = await runLegalSearch(options, undefined, undefined, ctx, runtime);
  const path = first.results[0].saved_md_path!;
  const edited = readFileSync(path, "utf8") + "\nMy manual note.\n";
  writeFileSync(path, edited);
  const result = await runLegalSearch({ ...options, run_id: first.runId, summarize: true }, undefined, undefined, ctx, runtime);
  assert.equal(readFileSync(path, "utf8"), edited);
  assert.equal(calls(), 0);
  assert.match(result.results[0].conversion_error!, /edited/);
}));

test("generated summaries cannot be loaded or indexed as opinions", () => fixture(async root => {
  const { ctx, runtime } = setup(root, []);
  const result = await runLegalSearch({ ...options, summarize: true }, undefined, undefined, ctx, runtime);
  const summaryPath = result.results[0].summary!.path!;
  assert.equal(splitOpinionMarkdown(readFileSync(summaryPath, "utf8")).metadata?.artifact_type, "case_summary");
  await assert.rejects(loadCaseSource({ cwd: root, sourcePath: summaryPath }), /Generated summaries/);
  const customPath = join(root, "Cases", "custom-brief.md");
  writeFileSync(customPath, readFileSync(summaryPath, "utf8"));
  await assert.rejects(loadCaseSource({ cwd: root, sourcePath: customPath }), /Generated summaries/);
  const { buildCaseSourceIndex } = await import("../document-authority-verification/sources.ts");
  const index = await buildCaseSourceIndex({ cwd: root });
  assert.equal(index.sources.length, 1);
  assert.match(index.sources[0].sourcePath, /\.html$/);
}));

test("opinion conversion preserves footnote destinations", () => {
  const markdown = extractOpinionMarkdown(`<div id="gs_opinion"><p>${text}</p><p id="fn1">Footnote one</p><sup><a href="#fn1">1</a></sup></div>`, "scholar");
  assert.match(markdown, /<a id="fn1"><\/a>/);
  assert.match(markdown, /\[1\]\(#fn1\)/);
});

test("conversion accepts large preserved HTML without inheriting model input limit", () => fixture(async root => {
  const { ctx, runtime, calls } = setup(root, []);
  const item = normalizeProviderResult("scholar", raw(1), 1);
  const download = await runtime.download(item, join(root, "Cases"), "scholar", "test", undefined, undefined);
  writeFileSync(download.saved!.savedPath, readFileSync(download.saved!.savedPath, "utf8") + " ".repeat(9 * 1024 * 1024));
  hashSavedOpinion(download.saved!);
  const { processDownloadedOpinion } = await import("./opinion-processing.ts");
  await processDownloadedOpinion(download, false, undefined, undefined, ctx);
  assert.equal(download.saved!.markdownError, undefined);
  assert.equal(calls(), 0);
}));

test("saved-opinion resume observes deadline before starting the next summary", () => fixture(async root => {
  const { ctx, runtime, calls } = setup(root, []);
  runtime.search = async () => ({ results: [raw(1), raw(2)], reachedEnd: true });
  const first = await runLegalSearch({ ...options, max_cases_to_download: 2 }, undefined, undefined, ctx, runtime);
  let now = 0;
  runtime.now = () => now;
  const resumed = await runLegalSearch({ ...options, run_id: first.runId, max_cases_to_download: 2, summarize: true, runtime_limit_minutes: 1 }, undefined, update => {
    if (update.details?.phase === "summarizing" && update.details?.status === "completed") now = 120000;
  }, ctx, runtime);
  assert.equal(calls(), 5);
  assert.match(resumed.stopReason!, /Runtime limit/);
  assert.equal(resumed.downloadSummary.downloaded, 2);
  assert.ok(resumed.results.every(row => row.download_status === "downloaded"));
}));

test("new sidecar summaries supersede stale failed run manifests", () => fixture(async root => {
  let offline = true;
  const { ctx, runtime, calls } = setup(root, [], () => offline);
  const failed = await runLegalSearch({ ...options, summarize: true }, undefined, undefined, ctx, runtime);
  offline = false;
  await runLegalSearch({ ...options, summarize: true }, undefined, undefined, ctx, runtime);
  const count = calls();
  const resumed = await runLegalSearch({ ...options, summarize: true, run_id: failed.runId }, undefined, undefined, ctx, runtime);
  assert.equal(calls(), count);
  assert.equal(resumed.results[0].summary?.status, "completed");
}));
