import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, truncateSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { ensureDirectory, nowIso, requestFingerprint, slugify, writeJsonAtomic, type JustiaRawResult, type NormalizedCase, type ProviderRawResult } from "./core.ts";
import type { ValidatedLegalSearchRequest } from "./session-search.ts";
import type { SavedOpinion } from "./providers.ts";

export interface SearchManifest {
  schemaVersion: 1;
  runId: string;
  kind: "search";
  createdAt: string;
  updatedAt: string;
  lastRetrievedAt?: string;
  refreshedFrom?: string;
  baselineCaseKeys?: string[];
  fingerprint: string;
  request: Omit<ValidatedLegalSearchRequest, "endPage">;
  status: "running" | "stopped" | "completed" | "partial_failure";
  completedPages: number[];
  resumePage?: number;
  pagesRemaining?: number;
  providerExhausted?: boolean;
  providerPageCapReached?: boolean;
  stopReason?: string;
  resultCount: number;
  uniqueCaseCount: number;
  downloads: Record<string, { status: "downloaded" | "failed"; saved?: SavedOpinion; error?: string }>;
  invocations: Array<{ startedAt: string; request: Omit<ValidatedLegalSearchRequest, "endPage"> }>;
  comparison?: { baselineRunId: string; newCaseKeys: string[]; noLongerObservedCaseKeys: string[]; note: string };
}
export interface SearchPage {
  type: "page";
  retrievedAt: string;
  page: number;
  reachedEnd?: boolean;
  records: Array<{ position: number; raw: ProviderRawResult; case: NormalizedCase }>;
}
interface DownloadEvent { type: "download"; recordedAt: string; caseKey: string; download: SearchManifest["downloads"][string] }
type SearchEvent = SearchPage | DownloadEvent;
export interface SearchRun { directory: string; manifestPath: string; manifest: SearchManifest; events: SearchEvent[]; journalPrepared?: boolean }

function historyRoot(cwd: string): string {
  const root = ensureDirectory(join(cwd, "Research", "Searches"));
  const fromWorkspace = relative(realpathSync(cwd), realpathSync(root));
  if (fromWorkspace === ".." || fromWorkspace.startsWith(`..${sep}`) || isAbsolute(fromWorkspace)) throw new Error("Research/Searches resolves outside the workspace.");
  return root;
}
export function searchRunDirectory(cwd: string, id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,119}$/.test(id)) throw new Error("Invalid search run_id.");
  const root = historyRoot(cwd);
  const path = join(root, id);
  if (existsSync(path)) {
    const fromRoot = relative(realpathSync(root), realpathSync(path));
    if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) throw new Error("Search run resolves outside Research/Searches.");
  }
  return path;
}
function fingerprint(request: Omit<ValidatedLegalSearchRequest, "endPage">): string {
  return requestFingerprint({ query: request.searchTerm, provider: request.provider, jurisdiction: request.jurisdiction, yearFrom: request.yearFrom, yearTo: request.yearTo });
}
function journalEvents(path: string): SearchEvent[] {
  const bytes = readFileSync(path);
  const committed = bytes.subarray(0, bytes.lastIndexOf(10) + 1).toString("utf8");
  return committed.split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) as SearchEvent; }
    catch { throw new Error(`Search history contains invalid committed JSON on line ${index + 1}.`); }
  });
}
export function readSearchRun(cwd: string, id: string): SearchRun {
  const directory = searchRunDirectory(cwd, id);
  const manifestPath = join(directory, "search.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SearchManifest;
  if (manifest.schemaVersion !== 1 || manifest.kind !== "search" || manifest.runId !== id) throw new Error("Unsupported or mismatched search manifest.");
  const events = journalEvents(join(directory, "results.jsonl"));
  // The append journal is authoritative if a crash preceded a manifest update.
  for (const event of events) {
    if (event.type === "page") manifest.lastRetrievedAt = event.retrievedAt;
    else if (event.type === "download") manifest.downloads[event.caseKey] = event.download;
  }
  manifest.completedPages = [...new Set(events.filter((e): e is SearchPage => e.type === "page").map(e => e.page))].sort((a, b) => a - b);
  return { directory, manifestPath, manifest, events };
}
export function latestSearchPages(run: SearchRun): SearchPage[] {
  const pages = new Map<number, SearchPage>();
  for (const event of run.events) if (event.type === "page") pages.set(event.page, event);
  return [...pages.values()].sort((a, b) => a.page - b.page);
}
export function startSearchRun(cwd: string, request: ValidatedLegalSearchRequest, runId?: string, refreshOf?: string): SearchRun {
  const { endPage: _endPage, ...savedRequest } = request;
  if (runId && refreshOf) throw new Error("Use run_id to resume or refresh_of to start a new dated run, not both.");
  if (runId) {
    const run = readSearchRun(cwd, runId);
    if (run.manifest.fingerprint !== fingerprint(request)) throw new Error("A resumed search must keep the same query, provider, courts, and date filters. Start a new run for changed filters.");
    run.manifest.invocations.push({ startedAt: nowIso(), request: savedRequest });
    run.manifest.status = "running";
    checkpointSearch(run);
    return run;
  }
  const baseline = refreshOf ? readSearchRun(cwd, refreshOf) : undefined;
  const id = `${new Date().toISOString().slice(0, 10)}-${slugify(request.jurisdiction.canonical).slice(0, 15)}-${slugify(request.searchTerm).slice(0, 25)}-${randomUUID().slice(0, 8)}`;
  const directory = ensureDirectory(searchRunDirectory(cwd, id));
  const manifest: SearchManifest = { schemaVersion: 1, kind: "search", runId: id, createdAt: nowIso(), updatedAt: nowIso(),
    fingerprint: fingerprint(request), request: savedRequest, refreshedFrom: refreshOf,
    baselineCaseKeys: baseline ? [...new Set(latestSearchPages(baseline).flatMap(page => page.records.map(r => r.case.canonicalKey)))] : undefined,
    status: "running", completedPages: [], resultCount: 0, uniqueCaseCount: 0,
    downloads: {}, invocations: [{ startedAt: nowIso(), request: savedRequest }] };
  writeFileSync(join(directory, "results.jsonl"), "", { flag: "wx" });
  writeFileSync(join(directory, "review.md"), [
    `# Research review: ${request.searchTerm.replace(/[\r\n]/g, " ")}`, "",
    `Run: ${id}`, `Provider: ${request.provider}`, `Court scope: ${request.jurisdiction.canonical}`, "",
    "## Purpose", "", "## Useful authorities and source versions", "",
    "## Rejected authorities and reasons", "", "## Unresolved questions", "", "## Next steps", "",
    "Search results are unread until reviewed. Notes in this file are preserved on resume.", "",
  ].join("\n"), { flag: "wx" });
  const run = { directory, manifestPath: join(directory, "search.json"), manifest, events: [], journalPrepared: true };
  checkpointSearch(run);
  return run;
}
export function checkpointSearch(run: SearchRun): void {
  run.manifest.updatedAt = nowIso();
  writeJsonAtomic(run.manifestPath, run.manifest);
}
function appendEvent(run: SearchRun, event: SearchEvent): void {
  const path = join(run.directory, "results.jsonl");
  if (!run.journalPrepared) {
    const bytes = readFileSync(path);
    const end = bytes.lastIndexOf(10) + 1;
    if (end < bytes.length) {
      // Preserve the torn suffix for diagnosis before recovering the append log.
      writeFileSync(join(run.directory, `torn-append-${randomUUID()}.txt`), bytes.subarray(end), { flag: "wx" });
      truncateSync(path, end);
    }
    run.journalPrepared = true;
  }
  appendFileSync(path, JSON.stringify(event) + "\n", "utf8");
  run.events.push(event);
}
export function recordSearchPage(run: SearchRun, page: number, raw: ProviderRawResult[], cases: NormalizedCase[], reachedEnd?: boolean): SearchPage {
  const retrievedAt = nowIso();
  const event: SearchPage = { type: "page", page, retrievedAt, reachedEnd,
    records: cases.map((item, index) => ({
      position: (raw[index] as JustiaRawResult | undefined)?.resultPosition ?? index + 1,
      raw: raw[index],
      case: item,
    })) };
  appendEvent(run, event);
  run.manifest.lastRetrievedAt = retrievedAt;
  run.manifest.completedPages = [...new Set([...run.manifest.completedPages, page])].sort((a, b) => a - b);
  checkpointSearch(run);
  return event;
}
export function recordSearchDownload(run: SearchRun, caseKey: string, download: SearchManifest["downloads"][string]): void {
  appendEvent(run, { type: "download", recordedAt: nowIso(), caseKey, download });
  run.manifest.downloads[caseKey] = download;
  checkpointSearch(run);
}
export function compareSearchRuns(_cwd: string, run: SearchRun): void {
  if (!run.manifest.refreshedFrom) return;
  const before = new Set(run.manifest.baselineCaseKeys ?? []);
  const after = new Set(latestSearchPages(run).flatMap(p => p.records.map(r => r.case.canonicalKey)));
  run.manifest.comparison = { baselineRunId: run.manifest.refreshedFrom, newCaseKeys: [...after].filter(k => !before.has(k)),
    noLongerObservedCaseKeys: [...before].filter(k => !after.has(k)),
    note: "Compares observed result sets only; differences can reflect filters, page limits, ranking, or provider indexing, not changes in law." };
}
export function listSearchHistory(cwd: string, options: { query?: string; case_key?: string; limit?: number; offset?: number } = {}) {
  const root = historyRoot(cwd);
  const warnings: string[] = [];
  const rows: SearchManifest[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !existsSync(join(root, entry.name, "search.json"))) continue;
    try {
      const run = readSearchRun(cwd, entry.name);
      if (options.query && !run.manifest.request.searchTerm.toLowerCase().includes(options.query.toLowerCase())) continue;
      if (options.case_key && !run.manifest.downloads[options.case_key] && !latestSearchPages(run).some(page => page.records.some(r => r.case.canonicalKey === options.case_key))) continue;
      rows.push(run.manifest);
    } catch (error) { warnings.push(`${entry.name}: ${String(error)}`); }
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const limit = options.limit ?? 20, offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error("Invalid history limit or offset.");
  return { directory: root, totalRuns: rows.length, runs: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null, warnings };
}
