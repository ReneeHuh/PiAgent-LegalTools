import { processDownloadedOpinion } from "./opinion-processing.ts";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_DOWNLOAD_LIMIT,
  MAX_DOWNLOAD_LIMIT,
  caseFolder,
  caseMarkdownMetadataRecords,
  ensureDirectory,
  formatCaseList,
  htmlEscape,
  mergeCase,
  mergeCases,
  readJsonFile,
  selectDownloadCases,
  writeJsonAtomic,
  writeTextAtomic,
  type NormalizedCase,
  type DiscoveryProviderId,
} from "./core.ts";
import { runCitedByReport, type CitedByOutcome } from "./cited-by.ts";
import { uniformJurisdiction, type SavedOpinion } from "./providers.ts";
import { checkOpinionIntegrity, findSavedOpinion, libraryEntries } from "./library.ts";
import { listCitedCollections, newCitedCollectionDirectory } from "./cited-collections.ts";
import { casesLibraryRoot } from "./session-search.ts";
import {
  downloadResolvedCase,
  markExactContentDuplicates,
  type ContentDuplicate,
  type DownloadedCase,
} from "./workflows.ts";

export interface LegalCitedByCollectOptions {
  summarize?: boolean;
  action: "collect" | "refresh";
  run_id?: string;
  case_key: string;
  pages_to_search?: number;
  max_cases_to_download?: number;
  runtime_limit_minutes?: number;
  jurisdiction?: string;
  year_from?: number;
  year_to?: number;
}

export interface LegalCitedByResumeOptions {
  summarize?: boolean;
  action: "resume";
  run_id?: string;
  case_key: string;
  /** Optional new total pages per provider; -1 means continue until exhaustion. */
  pages_to_search?: number;
  /** Optional higher total download maximum; -1 means every discovered case. */
  max_cases_to_download?: number;
  runtime_limit_minutes?: number;
}

export type LegalCitedByOptions = LegalCitedByCollectOptions | LegalCitedByResumeOptions;

export interface LegalCitedByOutcome {
  runId: string;
  lastRetrievedAt?: string;
  refreshedFrom?: string;
  newCaseKeys: string[];
  warnings: string[];
  status: "completed" | "incomplete" | "paused" | "partial_failure";
  caseKey: string;
  seed: NormalizedCase;
  directory: string;
  manifestPath: string;
  enumerationStatus: CitedByOutcome["status"];
  providerCorpusComplete: boolean;
  rawRecords: number;
  uniqueCases: number;
  pagesToSearch: number;
  downloadLimit: number;
  selectedCases: number;
  downloadedCases: number;
  failedDownloads: number;
  contentDuplicates: ContentDuplicate[];
  resultsJsonPath: string;
  resultsHtmlPath: string;
  /** At most the first 20 unique cases; resultsJsonPath contains all normalized result records. */
  resultCases: NormalizedCase[];
  resultCasesTruncated: boolean;
  selectedProviders: DiscoveryProviderId[];
  unavailableProviders: DiscoveryProviderId[];
}

interface SavedCaseFile {
  case?: NormalizedCase;
  downloadedAt?: string;
  source?: {
    provider?: string;
    savedPath?: string;
  };
}

function emit(onUpdate: AgentToolUpdateCallback<any> | undefined, text: string, details: Record<string, unknown>): void {
  onUpdate?.({ content: [{ type: "text", text }], details });
}

function validateCaseKey(caseKey: string): string {
  const key = caseKey.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/i.test(key)) {
    throw new Error("case_key must be a canonical key returned by legal_search or direct_download.");
  }
  return key;
}

function savedOpinionPath(
  ctx: ExtensionContext,
  root: string,
  record: SavedCaseFile,
  metadataPath?: string,
): string | undefined {
  if (!record.downloadedAt || typeof record.source?.savedPath !== "string") return undefined;
  const candidate = isAbsolute(record.source.savedPath)
    ? resolve(record.source.savedPath)
    : resolve(ctx.cwd, record.source.savedPath);
  const fromRoot = relative(resolve(root), candidate);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return undefined;
  if (!/\.html?$/i.test(candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) return undefined;
  if (metadataPath && resolve(metadataPath) !== resolve(candidate.replace(/\.html?$/i, ".md"))) return undefined;
  return checkOpinionIntegrity(record.source as SavedOpinion, root).status === "valid" ? candidate : undefined;
}

export function loadSavedCitedBySeed(ctx: ExtensionContext, caseKey: string): NormalizedCase {
  const placeholder: NormalizedCase = {
    canonicalKey: validateCaseKey(caseKey),
    title: "Saved case",
    citations: [],
    normalizedCitations: [],
    sources: [],
  };
  const root = casesLibraryRoot(ctx);
  const markdownRecords = [...caseMarkdownMetadataRecords(root, placeholder.canonicalKey), ...libraryEntries(root).entries
    .filter(entry => entry.record.case.canonicalKey === placeholder.canonicalKey).map(entry => ({ path: entry.metadataPath, data: entry.record }))];
  const legacyPath = join(caseFolder(root, placeholder), "case.json");
  if (!markdownRecords.length && !existsSync(legacyPath)) {
    throw new Error(`No saved case metadata exists for case_key=${caseKey} under ${root}.`);
  }

  const seeds: NormalizedCase[] = [];
  for (const markdownRecord of markdownRecords) {
    const saved = markdownRecord.data as unknown as SavedCaseFile;
    if (saved.case?.canonicalKey !== placeholder.canonicalKey || !Array.isArray(saved.case.sources)) continue;
    if (!savedOpinionPath(ctx, root, saved, markdownRecord.path)) continue;
    seeds.push(saved.case);
  }
  if (existsSync(legacyPath)) {
    const saved = readJsonFile<SavedCaseFile>(legacyPath);
    if (saved.case?.canonicalKey === placeholder.canonicalKey
      && Array.isArray(saved.case.sources)
      && savedOpinionPath(ctx, root, saved)) seeds.push(saved.case);
  }
  if (!seeds.length) {
    throw new Error(`No successfully saved opinion exists for case_key=${caseKey} under ${root}.`);
  }
  return seeds.slice(1).reduce((combined, seed) => mergeCase(combined, seed), seeds[0]);
}

export function citedByProvidersForSeed(seed: NormalizedCase): DiscoveryProviderId[] {
  return (["scholar", "courtlistener"] as const).filter((provider) => seed.sources.some((source) => {
    if (source.provider !== provider) return false;
    return provider === "scholar"
      ? Boolean(source.citedById || source.providerId)
      : Boolean(source.citedById);
  }));
}

function citationCollectionTitle(seed: NormalizedCase): string {
  return seed.title
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80) || "Saved case";
}

export function citationCollectionFolderName(seed: NormalizedCase): string {
  return `Citations for ${citationCollectionTitle(seed)}`;
}

/** Cited opinions are flat files inside Cases/Citations for <seed case>/. */
export function citationCollectionDirectory(ctx: ExtensionContext, seed: NormalizedCase): string {
  return join(ctx.cwd, "Cases", citationCollectionFolderName(seed));
}

function renderIndex(
  seed: NormalizedCase,
  cases: NormalizedCase[],
  downloads: Array<DownloadedCase | null>,
  enumeration: CitedByOutcome,
  selectedCaseCount: number,
): string {
  const downloadMaximum = enumeration.downloadLimit === -1 ? "all" : String(enumeration.downloadLimit);
  const byKey = new Map(downloads.filter(Boolean).map((item) => [item!.case.canonicalKey, item!]));
  const rows = cases.map((item, index) => {
    const download = byKey.get(item.canonicalKey);
    const metadata = [item.citations.join(", "), item.court, item.dateFiled ?? item.year].filter(Boolean).join(" · ");
    const sources = item.sources.filter((source) => source.url)
      .map((source) => `<a href="${htmlEscape(source.url)}">${htmlEscape(source.provider)}</a>`).join(" · ");
    const saved = index >= selectedCaseCount
      ? `<p><strong>Not selected for download.</strong> Increase <code>max_cases_to_download</code> above ${enumeration.downloadLimit} on resume, or use -1, to save more discovered cases.</p>`
      : download?.saved?.savedPath
        ? `<p><strong>Saved HTML:</strong> <code>${htmlEscape(download.saved.savedPath)}</code></p>`
        : download?.error
          ? `<p><strong>Download failed:</strong> ${htmlEscape(download.error)}</p>`
          : "<p>Download pending.</p>";
    return `<article><h2>${index + 1}. ${htmlEscape(item.title)}</h2>${metadata ? `<p>${htmlEscape(metadata)}</p>` : ""}<p>${sources || "No provider link."}</p>${item.snippet ? `<p>${htmlEscape(item.snippet)}</p>` : ""}${saved}</article>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cases citing ${htmlEscape(seed.title)}</title><style>body{max-width:980px;margin:2rem auto;padding:0 1rem;font:16px/1.5 system-ui;color:#17202a}article{padding:1rem 0;border-top:1px solid #ccd3da}h1,h2{font-family:Georgia,serif}code{overflow-wrap:anywhere}a{color:#175f9b}</style></head><body><h1>Cases citing ${htmlEscape(seed.title)}</h1><p>${enumeration.rawResults} raw provider records · ${cases.length} conservatively deduplicated decisions · ${selectedCaseCount} selected for download (maximum ${downloadMaximum}) · provider corpus complete: ${enumeration.providerCorpusComplete ? "yes" : "no"}.</p>${rows || "<p>No citing cases found.</p>"}</body></html>`;
}

export function classifyLegalCitedByStatus(
  enumerationStatus: CitedByOutcome["status"],
  interruptedWithPendingDownloads: boolean,
  failedDownloads: number,
): LegalCitedByOutcome["status"] {
  if (enumerationStatus === "paused" || enumerationStatus === "running" || interruptedWithPendingDownloads) {
    return "paused";
  }
  if (enumerationStatus === "incomplete") return "incomplete";
  return failedDownloads > 0 ? "partial_failure" : "completed";
}

export function legalCitedByLimits(options: LegalCitedByOptions): {
  pagesToSearch: number | undefined;
  maxCasesToDownload: number | undefined;
  runtimeLimitMinutes: number | undefined;
} {
  const pagesToSearch = options.action !== "resume"
    ? options.pages_to_search ?? -1
    : options.pages_to_search;
  if (pagesToSearch !== undefined
    && (!Number.isInteger(pagesToSearch)
      || (pagesToSearch !== -1 && (pagesToSearch < 1 || pagesToSearch > 50)))) {
    throw new Error("pages_to_search must be -1 or an integer from 1 through 50.");
  }
  const maxCasesToDownload = options.action !== "resume"
    ? options.max_cases_to_download ?? DEFAULT_DOWNLOAD_LIMIT
    : options.max_cases_to_download;
  if (maxCasesToDownload !== undefined
    && (!Number.isInteger(maxCasesToDownload)
      || (maxCasesToDownload !== -1
        && (maxCasesToDownload < 0 || maxCasesToDownload > MAX_DOWNLOAD_LIMIT)))) {
    throw new Error(`max_cases_to_download must be -1 or an integer from 0 through ${MAX_DOWNLOAD_LIMIT}.`);
  }
  const runtimeLimitMinutes = options.runtime_limit_minutes;
  if (runtimeLimitMinutes !== undefined
    && (!Number.isInteger(runtimeLimitMinutes) || runtimeLimitMinutes < 1 || runtimeLimitMinutes > 240)) {
    throw new Error("runtime_limit_minutes must be an integer from 1 through 240.");
  }
  return { pagesToSearch, maxCasesToDownload, runtimeLimitMinutes };
}

export async function runLegalCitedBy(
  options: LegalCitedByOptions,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
  ctx: ExtensionContext,
  runtime: { enumerate: typeof runCitedByReport; download: typeof downloadResolvedCase } = { enumerate: runCitedByReport, download: downloadResolvedCase },
): Promise<LegalCitedByOutcome> {
  if (options.action !== "collect" && options.action !== "resume" && options.action !== "refresh") {
    throw new Error('action must be "collect", "resume", or "refresh".');
  }
  const unexpected = Object.keys(options).filter((key) => !(
    options.action !== "resume"
      ? [
        "action", "case_key", "run_id", "pages_to_search", "max_cases_to_download", "runtime_limit_minutes", "summarize",
        "jurisdiction", "year_from", "year_to",
      ].includes(key)
      : [
        "action", "case_key", "run_id", "pages_to_search", "max_cases_to_download", "runtime_limit_minutes", "summarize",
      ].includes(key)
  ));
  if (unexpected.length) throw new Error(`action=${options.action} does not accept: ${unexpected.join(", ")}.`);
  if (options.summarize !== undefined && typeof options.summarize !== "boolean") throw new Error("summarize must be a boolean.");
  const limits = legalCitedByLimits(options);
  const requestedPages = limits.pagesToSearch;
  const requestedDownloadLimit = limits.maxCasesToDownload;
  const runtimeLimitMinutes = limits.runtimeLimitMinutes;
  if (options.action !== "resume") {
    if (options.year_from !== undefined && (!Number.isInteger(options.year_from) || options.year_from < 1600 || options.year_from > 2100)) {
      throw new Error("year_from must be an integer from 1600 through 2100.");
    }
    if (options.year_to !== undefined && (!Number.isInteger(options.year_to) || options.year_to < 1600 || options.year_to > 2100)) {
      throw new Error("year_to must be an integer from 1600 through 2100.");
    }
    if (options.year_from !== undefined && options.year_to !== undefined && options.year_from > options.year_to) {
      throw new Error("year_from cannot be later than year_to.");
    }
  }
  const jurisdiction = options.action !== "resume" && options.jurisdiction !== undefined
    ? uniformJurisdiction(options.jurisdiction.trim())
    : undefined;
  const deadline = runtimeLimitMinutes === undefined
    ? Number.POSITIVE_INFINITY
    : Date.now() + runtimeLimitMinutes * 60_000;

  const seed = loadSavedCitedBySeed(ctx, options.case_key);
  const seedProviders = citedByProvidersForSeed(seed);
  if (!seedProviders.length) {
    throw new Error(`The saved opinion for case_key=${options.case_key} has no safe Scholar or CourtListener cited-by identifier.`);
  }
  const previousRuns = listCitedCollections(ctx.cwd, seed.canonicalKey);
  const previous = options.run_id ? previousRuns.find(run => run.runId === options.run_id) : previousRuns[0];
  if (options.run_id && !previous) throw new Error("No matching cited-by run_id exists for this case.");
  if (options.action === "collect" && previous) throw new Error("Cited-by collection already exists; use action=resume to continue or action=refresh for a new dated search.");
  if (options.action === "resume" && !previous) throw new Error("No cited-by collection exists; use action=collect first.");
  if (options.action === "refresh" && !previous) throw new Error("No earlier cited-by collection exists to refresh; use action=collect first.");
  const directory = options.action === "resume" ? previous!.directory : newCitedCollectionDirectory(ctx.cwd, seed);
  const manifestPath = join(directory, "cited-by-manifest.json");
  const previousCollection = previous && existsSync(join(previous.directory, "collection.json"))
    ? readJsonFile<{ summarize?: boolean }>(join(previous.directory, "collection.json")) : undefined;
  const summarize = options.summarize ?? previousCollection?.summarize ?? false;
  if (options.action === "resume" && previousCollection) writeJsonAtomic(join(directory, "collection.json"), { ...readJsonFile<Record<string, unknown>>(join(directory, "collection.json")), summarize });
  const runId = directory.split(/[\\/]/).at(-1)!;
  let enumeration: CitedByOutcome;
  if (options.action === "resume") {
    enumeration = await runtime.enumerate({ resume_from: manifestPath, max_pages_per_provider: requestedPages,
      download_limit: requestedDownloadLimit, time_slice_minutes: runtimeLimitMinutes }, signal, onUpdate, ctx);
  } else {
    ensureDirectory(directory);
    const priorManifest = previous ? readJsonFile<{ filters: { court?: string; year_from?: number; year_to?: number } }>(previous.manifestPath) : undefined;
    const fresh = options as LegalCitedByCollectOptions;
    const filters = { court: jurisdiction ? jurisdiction.canonical === "all" ? undefined : jurisdiction.canonical : priorManifest?.filters.court,
      year_from: fresh.year_from ?? priorManifest?.filters.year_from, year_to: fresh.year_to ?? priorManifest?.filters.year_to };
    if (filters.year_from !== undefined && filters.year_to !== undefined && filters.year_from > filters.year_to) throw new Error("Inherited and requested year filters conflict; year_from cannot exceed year_to.");
    const baselinePath = previous ? join(previous.directory, "cited-by-results.json") : undefined;
    const baselineCaseKeys = baselinePath && existsSync(baselinePath) ? readJsonFile<NormalizedCase[]>(baselinePath).map(item => item.canonicalKey) : [];
    writeJsonAtomic(join(directory, "collection.json"), { schemaVersion: 1, runId, caseKey: seed.canonicalKey, summarize,
      refreshedFrom: previous?.manifestPath, baselineCaseKeys, filters, createdAt: new Date().toISOString() });
    writeFileSync(join(directory, "review.md"), "# Cited-by research review\n\n## Purpose\n\n## Useful authorities and source versions\n\n## Rejected authorities and reasons\n\n## Unresolved treatment questions\n\n## Next steps\n", { flag: "wx" });
    enumeration = await runtime.enumerate({ seed, providers: seedProviders, save_path: directory,
      max_pages_per_provider: requestedPages, download_limit: requestedDownloadLimit,
      time_slice_minutes: runtimeLimitMinutes, ...filters }, signal, onUpdate, ctx);
  }
  const warnings: string[] = [];
  const caseLibrary = casesLibraryRoot(ctx);
  const rawPath = join(directory, "cited-by-results.json");
  const rawCases = existsSync(rawPath) ? readJsonFile<NormalizedCase[]>(rawPath) : [];
  const cases = mergeCases(rawCases, "scholar");
  writeJsonAtomic(join(directory, "unique-cases.json"), cases);

  const downloadsPath = join(directory, "downloads.json");
  const prior = existsSync(downloadsPath) ? readJsonFile<Array<DownloadedCase | null>>(downloadsPath) : [];
  const priorByKey = new Map(prior.filter(Boolean).map((item) => [item!.case.canonicalKey, item!]));
  const downloads: Array<DownloadedCase | null> = cases.map((item) => priorByKey.get(item.canonicalKey) ?? null);
  const selectedCases = selectDownloadCases(cases, enumeration.downloadLimit);
  let processingStopped = false;
  for (let index = 0; index < selectedCases.length; index += 1) {
    if (signal?.aborted || Date.now() >= deadline) { processingStopped = true; break; }
    const item = cases[index];
    const existing = downloads[index];
    if (existing?.status === "downloaded" && checkOpinionIntegrity(existing.saved, caseLibrary).status === "valid") {
      downloads[index] = existing;
      await processDownloadedOpinion(existing, summarize, signal, onUpdate, ctx);
      writeJsonAtomic(downloadsPath, downloads);
      continue;
    }
    if (existing?.status === "downloaded") {
      warnings.push(`${item.title}: ${checkOpinionIntegrity(existing.saved, caseLibrary).reason}`);
      downloads[index] = { case: item, status: "failed", error: "Saved opinion failed integrity validation; reacquisition is pending." };
    }
    const reusable = findSavedOpinion(caseLibrary, item);
    warnings.push(...reusable.warnings);
    if (reusable.saved) {
      downloads[index] = { case: item, status: "downloaded", saved: reusable.saved };
      await processDownloadedOpinion(downloads[index]!, summarize, signal, onUpdate, ctx);
      writeJsonAtomic(downloadsPath, downloads);
      continue;
    }
    if (signal?.aborted) break;
    if (Date.now() >= deadline) break;
    emit(onUpdate, `Saving citing case ${index + 1} of ${selectedCases.length}: ${item.title}`, {
      phase: "downloading_citing_cases",
      index: index + 1,
      total: selectedCases.length,
      caseKey: seed.canonicalKey,
    });
    try {
      downloads[index] = await runtime.download(
        item,
        caseLibrary,
        "auto",
        `cites:${seed.canonicalKey}`,
        signal,
        onUpdate,
      );
      writeJsonAtomic(downloadsPath, downloads);
      if (downloads[index]?.status === "downloaded") {
        const integrity = checkOpinionIntegrity(downloads[index]!.saved, caseLibrary);
        if (integrity.status !== "valid") downloads[index] = { case: item, status: "failed", error: integrity.reason };
        else await processDownloadedOpinion(downloads[index]!, summarize, signal, onUpdate, ctx);
      }
    } catch (error) {
      if (signal?.aborted) break;
      throw error;
    }
    writeJsonAtomic(downloadsPath, downloads);
  }
  for (const download of downloads) {
    if (download?.saved?.markdownError) warnings.push(`${download.case.title}: Markdown conversion failed: ${download.saved.markdownError}`);
    if (download?.saved?.summary?.status === "failed") warnings.push(`${download.case.title}: Summary failed: ${download.saved.summary.error}`);
  }
  const contentDuplicates = markExactContentDuplicates(downloads);
  writeJsonAtomic(downloadsPath, downloads);
  writeJsonAtomic(join(directory, "content-duplicates.json"), contentDuplicates);
  const resultsHtmlPath = join(directory, "index.html");
  writeTextAtomic(resultsHtmlPath, renderIndex(seed, cases, downloads, enumeration, selectedCases.length));

  const selectedDownloads = downloads.slice(0, selectedCases.length);
  const failedDownloads = selectedDownloads.filter((item) => item?.status === "failed").length;
  const downloadedCases = selectedDownloads.filter((item) => item?.status === "downloaded").length;
  const downloadsPending = selectedDownloads.some((item) => item === null);
  const status = classifyLegalCitedByStatus(
    enumeration.status,
    Boolean(processingStopped || ((signal?.aborted || Date.now() >= deadline) && downloadsPending)),
    failedDownloads + selectedDownloads.filter(d => d?.saved?.markdownError || (summarize && d?.saved?.summary?.status === "failed")).length,
  );
  const collection = existsSync(join(directory, "collection.json")) ? readJsonFile<{ refreshedFrom?: string; baselineCaseKeys?: string[] }>(join(directory, "collection.json")) : {};
  const baselineKeys = new Set(collection.baselineCaseKeys ?? []);
  const newCaseKeys = collection.refreshedFrom ? cases.filter(item => !baselineKeys.has(item.canonicalKey)).map(item => item.canonicalKey) : [];
  writeJsonAtomic(join(directory, "comparison.json"), { baseline: collection.refreshedFrom, newCaseKeys,
    note: "Newly observed results; differences can reflect coverage and filters, not newly decided cases or legal treatment." });
  return {
    runId, lastRetrievedAt: enumeration.lastRetrievedAt, refreshedFrom: collection.refreshedFrom, newCaseKeys, warnings: [...new Set(warnings)],
    status,
    caseKey: seed.canonicalKey,
    seed,
    directory,
    manifestPath,
    enumerationStatus: enumeration.status,
    providerCorpusComplete: enumeration.providerCorpusComplete,
    rawRecords: enumeration.rawResults,
    uniqueCases: cases.length,
    pagesToSearch: enumeration.maxPagesPerProvider ?? -1,
    downloadLimit: enumeration.downloadLimit,
    selectedCases: selectedCases.length,
    downloadedCases,
    failedDownloads,
    contentDuplicates,
    resultsJsonPath: rawPath,
    resultsHtmlPath,
    resultCases: cases.slice(0, 20),
    resultCasesTruncated: cases.length > 20,
    selectedProviders: enumeration.requestedProviders,
    unavailableProviders: (["scholar", "courtlistener"] as DiscoveryProviderId[])
      .filter((provider) => !enumeration.requestedProviders.includes(provider)),
  };
}

export function legalCitedByOutcomeText(outcome: LegalCitedByOutcome): string {
  const resume = `{"action":"resume","case_key":"${outcome.caseKey}","run_id":"${outcome.runId}"}`;
  const downloadMaximum = outcome.downloadLimit === -1 ? "all" : String(outcome.downloadLimit);
  const nextAction = outcome.status === "paused"
    ? `Resume with ${resume}.`
    : outcome.status === "incomplete"
      ? outcome.pagesToSearch !== -1
        ? outcome.pagesToSearch < 50
          ? `Discovery is incomplete. Resume with {"action":"resume","case_key":"${outcome.caseKey}","pages_to_search":-1} for exhaustive discovery, or use another total above ${outcome.pagesToSearch}.`
          : "Discovery remains incomplete at the maximum finite page cap; resume with pages_to_search=-1 or narrow the collection filters."
        : `Exhaustive discovery is incomplete because a provider stopped or was blocked. Inspect the manifest, then resume with ${resume}.`
      : outcome.status === "partial_failure"
        ? `Some selected downloads failed; retry with ${resume}.`
        : "";
  return [
    `Cited-by collection ${outcome.status} for ${outcome.seed.title}.`,
    `Run: ${outcome.runId}; last actual retrieval: ${outcome.lastRetrievedAt ?? "unknown / none"}.`,
    outcome.refreshedFrom ? `Newly observed cases compared with the earlier run: ${outcome.newCaseKeys.length}.` : "",
    ...outcome.warnings.map(warning => `Warning: ${warning}`),
    `Observed records: ${outcome.rawRecords}; unique decisions: ${outcome.uniqueCases}.`,
    `Providers selected from saved cited-by identifiers: ${outcome.selectedProviders.join(", ")}. ${outcome.unavailableProviders.length ? `Unavailable for this seed: ${outcome.unavailableProviders.join(", ")}.` : "Both providers were available."}`,
    `Download selection: ${outcome.selectedCases} of ${outcome.uniqueCases} unique cases (max_cases_to_download ${downloadMaximum}); saved HTML opinions: ${outcome.downloadedCases}; failed downloads: ${outcome.failedDownloads}.`,
    `Provider corpus complete: ${outcome.providerCorpusComplete ? "yes" : "no"}; enumeration status: ${outcome.enumerationStatus}. This is discovery, not citator or good-law analysis.`,
    `Structured resultCases preview: first ${outcome.resultCases.length} unique decisions${outcome.resultCasesTruncated ? " (truncated at 20)" : ""}; normalized result records are saved at ${outcome.resultsJsonPath}. Original provider records are in cited-by-events.jsonl under ${outcome.directory}.`,
    `HTML index: ${outcome.resultsHtmlPath}`,
    formatCaseList(outcome.resultCases.slice(0, 10), "First citing cases shown in text"),
    nextAction,
  ].filter(Boolean).join("\n");
}
