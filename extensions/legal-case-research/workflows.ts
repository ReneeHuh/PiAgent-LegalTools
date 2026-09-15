import { createHash } from "node:crypto";
import { currentBrowser } from "./browser-choice.ts";
import { readFileSync } from "node:fs";
import { checkOpinionIntegrity, findSavedOpinion } from "./library.ts";
import { checkpointSearch, recordSearchPage, startSearchRun } from "./search-history.ts";
import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import {
  caseDownloadErrorPath,
  ensureDirectory,
  extractOpinionText,
  mergeCases,
  normalizeProviderResult,
  nowIso,
  opinionMetadataMarkdownPath,
  providerIdFromUrl,
  writeMarkdownMetadata,
  type DiscoveryProviderId,
  type NormalizedCase,
  type ProviderId,
  type ProviderRawResult,
  type ProviderSource,
  type SearchFilters,
  type SearchRunResult,
} from "./core.ts";
import {
  clickProviderResultLink,
  providerSearchParameters,
  searchProvider,
  uniformJurisdiction,
  type SavedOpinion,
} from "./providers.ts";

export interface SearchOptions extends SearchFilters {
  query: string;
  providers?: DiscoveryProviderId[];
  preferred?: DiscoveryProviderId;
  max_results?: number;
}

export interface DownloadedCase {
  case: NormalizedCase;
  status: "downloaded" | "failed";
  saved?: SavedOpinion;
  duplicateOf?: string;
  attempts?: Array<{ provider: ProviderId; status: "failed" | "downloaded"; error?: string }>;
  error?: string;
}

export interface ContentDuplicate {
  caseKey: string;
  duplicateOf: string;
  textSha256: string;
}

/** Exact normalized-opinion matches are safe to label automatically. */
export function markExactContentDuplicates(downloads: Array<DownloadedCase | null>): ContentDuplicate[] {
  const firstByHash = new Map<string, string>();
  const duplicates: ContentDuplicate[] = [];
  for (const download of downloads) {
    if (!download || download.status !== "downloaded" || !download.saved?.textSha256) continue;
    const prior = firstByHash.get(download.saved.textSha256);
    if (!prior) {
      firstByHash.set(download.saved.textSha256, download.case.canonicalKey);
      continue;
    }
    if (prior === download.case.canonicalKey) continue;
    download.duplicateOf = prior;
    duplicates.push({
      caseKey: download.case.canonicalKey,
      duplicateOf: prior,
      textSha256: download.saved.textSha256,
    });
  }
  return duplicates;
}

function emit(onUpdate: AgentToolUpdateCallback<any> | undefined, text: string, details: Record<string, unknown>): void {
  onUpdate?.({ content: [{ type: "text", text }], details });
}

function uniqueProviders(providers: DiscoveryProviderId[] | undefined): DiscoveryProviderId[] {
  const requested = new Set(providers?.length ? providers : ["scholar", "courtlistener"]);
  return (["scholar", "courtlistener"] as DiscoveryProviderId[]).filter((provider) => requested.has(provider));
}

/**
 * First-page discovery across the selected providers, merged conservatively.
 * Used by direct_download to resolve a named case; it follows the same
 * Scholar-then-CourtListener order as the public search runner.
 */
export async function runUnifiedSearch(
  options: SearchOptions,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
  ctx?: { cwd: string },
): Promise<SearchRunResult> {
  const query = options.query.trim();
  if (!query) throw new Error("query must not be empty.");
  const providers = uniqueProviders(options.providers);
  const preferred = options.preferred ?? "scholar";
  if (!providers.includes(preferred)) throw new Error("preferred must appear in the selected providers list.");
  if (options.year_from !== undefined && options.year_to !== undefined && options.year_from > options.year_to) {
    throw new Error("year_from cannot be later than year_to.");
  }
  const maxResults = options.max_results ?? 40;
  const requests = providers.map((provider) => ({
    provider,
    params: providerSearchParameters(provider, {
      query,
      courts: options.court,
      year_from: options.year_from,
      year_to: options.year_to,
      filed_after: options.filed_after,
      filed_before: options.filed_before,
      page: 1,
    }),
  }));

  const rawCases: NormalizedCase[] = [];
  const providerStatus: SearchRunResult["providers"] = {};
  const researchRuns: NonNullable<SearchRunResult["researchRuns"]> = [];
  for (const { provider, params } of requests) {
    const run = ctx ? startSearchRun(ctx.cwd, { searchTerm: query, provider, jurisdiction: uniformJurisdiction(options.court ?? "all"),
      browser: currentBrowser(), pagesToSearch: 1, startPage: 1, endPage: 1, maxCasesToDownload: 0, yearFrom: options.year_from, yearTo: options.year_to }) : undefined;
    if (run) researchRuns.push({ runId: run.manifest.runId, provider, manifestPath: run.manifestPath });
    emit(onUpdate, `Resolving the exact case on ${provider}.`, { phase: "resolving", provider });
    try {
      const response = await searchProvider(provider, params, run?.manifest.runId, signal, onUpdate);
      const normalized = response.results.map((item, index) => normalizeProviderResult(provider, item, index + 1));
      rawCases.push(...normalized);
      if (run) {
        recordSearchPage(run, 1, response.results, normalized, response.reachedEnd);
        Object.assign(run.manifest, { status: "completed", resultCount: normalized.length, uniqueCaseCount: mergeCases(normalized).length, providerExhausted: response.reachedEnd === true });
        checkpointSearch(run);
      }
      providerStatus[provider] = {
        status: response.reachedEnd ? "exhausted" : "capped",
        rawResults: response.results.length,
        lastCursor: response.lastPage,
      };
    } catch (error) {
      if (run) { Object.assign(run.manifest, { status: "stopped", resumePage: 1, pagesRemaining: 1, stopReason: error instanceof Error ? error.message : String(error) }); checkpointSearch(run); }
      providerStatus[provider] = {
        status: "failed",
        rawResults: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      if (signal?.aborted) throw error;
    }
  }
  if (!rawCases.length && Object.values(providerStatus).every((status) => status?.status === "failed")) {
    const errors = Object.entries(providerStatus).map(([provider, status]) => `${provider}: ${status?.error}`).join("; ");
    throw new Error(`Every selected provider failed. ${errors}`);
  }
  return { cases: mergeCases(rawCases, preferred).slice(0, maxResults), providers: providerStatus, researchRuns };
}

export function chooseDocumentSource(item: NormalizedCase, requested: ProviderId | "auto" = "auto"): ProviderSource {
  if (requested !== "auto") {
    const source = item.sources.find((candidate) => candidate.provider === requested);
    if (!source) throw new Error(`The resolved case has no ${requested} source. Refusing to substitute a different provider.`);
    return source;
  }
  const source = item.sources.find((candidate) => candidate.provider === "scholar")
    ?? item.sources.find((candidate) => candidate.provider === "courtlistener")
    ?? item.sources[0];
  if (!source) throw new Error("The resolved case has no usable opinion source.");
  return source;
}

export function documentSourceCandidates(item: NormalizedCase, requested: ProviderId | "auto" = "auto"): ProviderSource[] {
  if (requested !== "auto") return [chooseDocumentSource(item, requested)];
  const order: ProviderId[] = ["scholar", "courtlistener", "justia"];
  const candidates = [...item.sources].sort((left, right) => order.indexOf(left.provider) - order.indexOf(right.provider));
  const seen = new Set<string>();
  return candidates.filter((source) => {
    const key = `${source.provider}:${source.providerId ?? source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const RENDERED_RESULT_LOOKUP_PAGES = 5;

function renderedLookupQuery(item: NormalizedCase): string {
  const citation = item.citations.find((value) => value.trim());
  return citation ? `"${citation}"` : `"${item.title}"`;
}

function rawResultProviderId(provider: DiscoveryProviderId, raw: ProviderRawResult): string | undefined {
  const direct = provider === "scholar"
    ? (raw as { caseId?: unknown }).caseId
    : provider === "courtlistener"
      ? (raw as { clusterId?: unknown }).clusterId
      : (raw as { casePath?: unknown }).casePath;
  if (provider === "justia" && typeof direct === "string" && direct.trim()) return direct;
  if (typeof direct === "string" && /^\d+$/.test(direct)) return direct;
  if (typeof direct === "number" && Number.isSafeInteger(direct) && direct >= 0) return String(direct);
  return typeof raw.url === "string" ? providerIdFromUrl(provider, raw.url) : undefined;
}

/**
 * Re-locate an opinion in rendered exact-match results, click its title, save
 * it, and return with Back. The saved provider URL is never opened directly.
 */
async function locateAndClickRenderedOpinion(
  item: NormalizedCase,
  source: ProviderSource,
  directory: string,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
): Promise<SavedOpinion> {
  if (!source.providerId || (source.provider !== "justia" && !/^\d+$/.test(source.providerId))) {
    throw new Error(`${source.provider} result has no valid opinion identifier.`);
  }
  const query = renderedLookupQuery(item);
  const navigationSession = `locate:${source.provider}:${item.canonicalKey}`;
  for (let page = 1; page <= RENDERED_RESULT_LOOKUP_PAGES; page += 1) {
    emit(onUpdate, `Locating ${item.title} on rendered ${source.provider} result page ${page}.`, {
      phase: "locating_download_result",
      provider: source.provider,
      page,
      query,
      caseKey: item.canonicalKey,
    });
    const response = await searchProvider(
      source.provider,
      providerSearchParameters(source.provider, { query, page }),
      navigationSession,
      signal,
      onUpdate,
    );
    const position = response.results.findIndex((raw) => rawResultProviderId(source.provider, raw) === source.providerId);
    if (position >= 0) {
      emit(onUpdate, `Clicking ${source.provider} result ${position + 1} on page ${page}: ${item.title}`, {
        phase: "clicking_download_result",
        provider: source.provider,
        page,
        position: position + 1,
        caseKey: item.canonicalKey,
        navigation: "click_result_then_back",
      });
      return clickProviderResultLink(source.provider, source.url, directory, signal, onUpdate);
    }
    if (response.reachedEnd) break;
  }
  throw new Error(
    `${source.provider} opinion ${source.providerId} was not found in the first ${RENDERED_RESULT_LOOKUP_PAGES} rendered exact-match result pages.`,
  );
}

export function hashSavedOpinion(saved: SavedOpinion): void {
  const savedHtml = readFileSync(saved.savedPath, "utf8");
  saved.htmlSha256 = createHash("sha256").update(savedHtml).digest("hex");
  const opinionText = extractOpinionText(savedHtml, saved.provider);
  if (opinionText) saved.textSha256 = createHash("sha256").update(opinionText.replace(/\s+/g, " ").trim()).digest("hex");
  const integrity = checkOpinionIntegrity(saved);
  if (integrity.status !== "valid") throw new Error(`Saved opinion failed validation: ${integrity.reason}`);
}

function finalizeDownloadedCase(item: NormalizedCase, saved: SavedOpinion): NormalizedCase {
  return item.titleIsPlaceholder && saved.title
    ? { ...item, title: saved.title, titleIsPlaceholder: false }
    : item;
}

/**
 * Download a case whose rendered result page is not currently open: re-locate
 * it in exact-match results on each candidate provider, Scholar first.
 */
export async function downloadResolvedCase(
  item: NormalizedCase,
  sessionDirectory: string,
  requestedProvider: ProviderId | "auto",
  query: string | undefined,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
): Promise<DownloadedCase> {
  const directory = ensureDirectory(sessionDirectory);
  const sources = documentSourceCandidates(item, requestedProvider);
  const existing = findSavedOpinion(directory, item, requestedProvider === "auto" ? undefined : requestedProvider);
  if (existing.saved) return { case: item, status: "downloaded", saved: existing.saved };
  const attempts: NonNullable<DownloadedCase["attempts"]> = [];
  for (const source of sources) {
    try {
      const saved = await locateAndClickRenderedOpinion(item, source, directory, signal, onUpdate);
      hashSavedOpinion(saved);
      const finalItem = finalizeDownloadedCase(item, saved);
      const attemptRecord = [...attempts, { provider: source.provider, status: "downloaded" as const }];
      writeMarkdownMetadata(opinionMetadataMarkdownPath(saved.savedPath), finalItem.title, {
        schemaVersion: 1,
        downloadedAt: nowIso(),
        case: finalItem,
        source: saved,
        attempts: attemptRecord,
        searchQuery: query,
      }, true);
      return { case: finalItem, status: "downloaded", saved, attempts: attemptRecord };
    } catch (error) {
      if (signal?.aborted) throw error;
      attempts.push({
        provider: source.provider,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const error = attempts.map((attempt) => `${attempt.provider}: ${attempt.error}`).join("; ") || "No usable opinion source.";
  writeMarkdownMetadata(caseDownloadErrorPath(directory, item), `Download failed: ${item.title}`, {
    schemaVersion: 1,
    failedAt: nowIso(),
    case: item,
    attempts,
    error,
  });
  return { case: item, status: "failed", error, attempts };
}

/**
 * Download a case by clicking its title on the result page that is currently
 * rendered in the provider tab, then restore that page with Back.
 */
export async function downloadClickedResultLink(
  item: NormalizedCase,
  selectedLink: string,
  downloadRoot: string,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
): Promise<DownloadedCase> {
  const source = item.sources.find((candidate) => candidate.url === selectedLink);
  if (!source) {
    throw new Error("The selected result link is not one of this candidate's saved provider sources.");
  }
  const directory = ensureDirectory(downloadRoot);
  try {
    const saved = await clickProviderResultLink(source.provider, selectedLink, directory, signal, onUpdate);
    hashSavedOpinion(saved);
    const finalItem = finalizeDownloadedCase(item, saved);
    writeMarkdownMetadata(opinionMetadataMarkdownPath(saved.savedPath), finalItem.title, {
      schemaVersion: 1,
      downloadedAt: nowIso(),
      acquisition: "clicked_result_link",
      selectedLink,
      case: finalItem,
      source: saved,
    }, true);
    return { case: finalItem, status: "downloaded", saved };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    writeMarkdownMetadata(caseDownloadErrorPath(directory, item), `Download failed: ${item.title}`, {
      schemaVersion: 1,
      failedAt: nowIso(),
      acquisition: "clicked_result_link",
      selectedLink,
      case: item,
      provider: source.provider,
      error: message,
    });
    return { case: item, status: "failed", error: message };
  }
}
