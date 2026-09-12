import { appendFileSync, existsSync, readFileSync, statSync, truncateSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isTransientBrowserFailure } from "./browser.ts";
import {
  MAX_DOWNLOAD_LIMIT,
  ensureDirectory,
  normalizeProviderResult,
  nowIso,
  readJsonFile,
  requestFingerprint,
  resolveOutputPath,
  resolveSessionFile,
  slugify,
  writeJsonAtomic,
  writeTextAtomic,
  type DiscoveryProviderId,
  type NormalizedCase,
  type SearchFilters,
} from "./core.ts";
import { providerSearchParameters, searchProvider } from "./providers.ts";

type ProviderRunStatus = "running" | "paused" | "exhausted" | "capped" | "failed" | "blocked";

interface CourtListenerState {
  kind: "courtlistener";
  status: ProviderRunStatus;
  citedById?: string;
  nextPage: number;
  pagesCompleted: number;
  rawResults: number;
  error?: string;
}

interface ScholarPartition {
  id: string;
  court?: string;
  yearLo?: number;
  yearHi?: number;
  nextOffset: number;
  pagesCompleted: number;
}

interface ScholarState {
  kind: "scholar";
  status: ProviderRunStatus;
  citedById?: string;
  partitions: ScholarPartition[];
  completedPartitions: number;
  pagesCompleted: number;
  rawResults: number;
  partitioned: boolean;
  expandedPartitions: string[];
  error?: string;
}

type CitedProviderState = CourtListenerState | ScholarState;

interface CitedByManifest {
  schemaVersion: 2;
  mode: "cited_by";
  requestFingerprint: string;
  createdAt: string;
  updatedAt: string;
  lastRetrievedAt?: string;
  status: "running" | "paused" | "complete" | "incomplete";
  seed: NormalizedCase;
  requestedProviders: DiscoveryProviderId[];
  filters: SearchFilters;
  providers: Partial<Record<DiscoveryProviderId, CitedProviderState>>;
  rawResults: number;
  recordCount: number;
  resultsFile: string;
  journalFile: string;
  reportFiles: string[];
  nextAction?: string;
  maxPagesPerProvider?: number;
  downloadLimit: number;
}

export interface CitedByOptions extends SearchFilters {
  /** The saved seed case; required when starting a new collection. */
  seed?: NormalizedCase;
  providers?: DiscoveryProviderId[];
  /** Directory for the manifest, journal, and results; required when starting a new collection. */
  save_path?: string;
  time_slice_minutes?: number;
  max_pages_per_provider?: number;
  /** Workflow-level cap persisted here so download resumptions remain stable. */
  download_limit?: number;
  resume_from?: string;
}

export interface CitedByOutcome {
  lastRetrievedAt?: string;
  sessionDirectory: string;
  manifestPath: string;
  status: CitedByManifest["status"];
  recordCount: number;
  rawResults: number;
  providerCorpusComplete: boolean;
  maxPagesPerProvider?: number;
  downloadLimit: number;
  requestedProviders: DiscoveryProviderId[];
}

const SCHOLAR_COURT_PARTITIONS = [
  "us supreme court",
  "1st circuit", "2nd circuit", "3rd circuit", "4th circuit", "5th circuit", "6th circuit",
  "7th circuit", "8th circuit", "9th circuit", "10th circuit", "11th circuit", "dc circuit",
  "federal circuit", "tax court", "court of claims",
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "district of columbia", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
  "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
  "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah",
  "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
] as const;

function emit(onUpdate: AgentToolUpdateCallback<any> | undefined, text: string, details: Record<string, unknown>): void {
  onUpdate?.({ content: [{ type: "text", text }], details });
}

function requestedProviders(values: DiscoveryProviderId[] | undefined): DiscoveryProviderId[] {
  const requested = new Set(values?.length ? values : ["scholar", "courtlistener"]);
  return (["scholar", "courtlistener"] as DiscoveryProviderId[]).filter((provider) => requested.has(provider));
}

function sourceCitedById(seed: NormalizedCase, provider: DiscoveryProviderId): string | undefined {
  const source = seed.sources.find((item) => item.provider === provider);
  if (!source) return undefined;
  if (source.citedById) return source.citedById;
  // Scholar documents its case_id as the value for a cites search. CourtListener
  // explicitly distinguishes cluster_id from cites_id, so no fallback is safe there.
  return provider === "scholar" ? source.providerId : undefined;
}

function newProviderState(
  provider: DiscoveryProviderId,
  seed: NormalizedCase,
  filters: SearchFilters,
): CitedProviderState {
  const citedById = sourceCitedById(seed, provider);
  if (provider === "courtlistener") {
    return {
      kind: provider,
      status: citedById ? "running" : "failed",
      citedById,
      nextPage: 1,
      pagesCompleted: 0,
      rawResults: 0,
      error: citedById ? undefined : "The seed has no CourtListener cites_id; cluster_id cannot safely substitute for it.",
    };
  }
  return {
    kind: provider,
    status: citedById ? "running" : "failed",
    citedById,
    partitions: citedById ? [{
      id: "root",
      court: filters.court,
      yearLo: filters.year_from,
      yearHi: filters.year_to,
      nextOffset: 0,
      pagesCompleted: 0,
    }] : [],
    completedPartitions: 0,
    pagesCompleted: 0,
    rawResults: 0,
    partitioned: false,
    expandedPartitions: [],
    error: citedById ? undefined : "The seed has no Google Scholar case_id/cites_id.",
  };
}

function resolveResumeManifest(cwd: string, resumeFrom: string): string {
  const candidate = resolveOutputPath(cwd, resumeFrom, resumeFrom);
  if (!existsSync(candidate)) throw new Error(`resume_from does not exist: ${candidate}`);
  const manifest = statSync(candidate).isDirectory() ? join(candidate, "cited-by-manifest.json") : candidate;
  if (!existsSync(manifest)) throw new Error(`No cited-by manifest exists at ${manifest}`);
  return manifest;
}

function publicProviderState(state: CitedProviderState): Record<string, unknown> {
  if (state.kind === "courtlistener") {
    return {
      status: state.status,
      pagesCompleted: state.pagesCompleted,
      rawResults: state.rawResults,
      nextPage: state.status === "exhausted" || state.status === "capped" ? undefined : state.nextPage,
      error: state.error,
    };
  }
  return {
    status: state.status,
    pagesCompleted: state.pagesCompleted,
    rawResults: state.rawResults,
    completedPartitions: state.completedPartitions,
    pendingPartitions: state.partitions.length,
    nextPartition: state.partitions[0],
    partitioned: state.partitioned,
    expandedPartitions: state.expandedPartitions.length,
    coverageProven: !state.partitioned && state.status === "exhausted",
    error: state.error,
  };
}

function updateTotals(manifest: CitedByManifest, cases: NormalizedCase[]): void {
  manifest.rawResults = Object.values(manifest.providers).reduce((total, state) => total + (state?.rawResults ?? 0), 0);
  manifest.recordCount = cases.length;
  manifest.updatedAt = nowIso();
}

function writeCheckpoint(
  sessionDirectory: string,
  manifestPath: string,
  manifest: CitedByManifest,
  cases: NormalizedCase[],
  compactResults = false,
): void {
  updateTotals(manifest, cases);
  if (compactResults) writeJsonAtomic(resolveSessionFile(sessionDirectory, manifest.resultsFile, "resultsFile"), cases);
  writeJsonAtomic(manifestPath, manifest);
}

interface JournalEvent {
  eventId: string;
  provider: DiscoveryProviderId;
  records: NormalizedCase[];
  retrievedAt?: string;
  rawResults?: import("./core.ts").ProviderRawResult[];
}

function journalPath(sessionDirectory: string, manifest: CitedByManifest): string {
  return resolveSessionFile(sessionDirectory, manifest.journalFile, "journalFile");
}

function loadJournal(sessionDirectory: string, manifest: CitedByManifest): { records: NormalizedCase[]; eventIds: Set<string>; lastRetrievedAt?: string } {
  const path = journalPath(sessionDirectory, manifest);
  if (!existsSync(path)) return { records: [], eventIds: new Set() };
  const raw = readFileSync(path, "utf8");
  // Every committed event ends with a newline. A process crash can leave only
  // the final append torn; trim that suffix so it cannot poison every resume.
  const lastNewline = raw.lastIndexOf("\n");
  const complete = raw && lastNewline !== raw.length - 1 ? raw.slice(0, lastNewline + 1) : raw;
  if (complete.length !== raw.length) truncateSync(path, Buffer.byteLength(complete, "utf8"));
  const records: NormalizedCase[] = [];
  const eventIds = new Set<string>();
  let lastRetrievedAt: string | undefined;
  for (const [index, line] of complete.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event: JournalEvent;
    try {
      event = JSON.parse(line) as JournalEvent;
    } catch {
      throw new Error(`The cited-by journal contains invalid JSON on line ${index + 1}.`);
    }
    if (!event.eventId || eventIds.has(event.eventId) || !Array.isArray(event.records)) continue;
    eventIds.add(event.eventId);
    records.push(...event.records);
    if (event.retrievedAt) lastRetrievedAt = event.retrievedAt;
  }
  return { records, eventIds, lastRetrievedAt };
}

function appendJournalEvent(
  sessionDirectory: string,
  manifest: CitedByManifest,
  eventIds: Set<string>,
  event: JournalEvent,
): boolean {
  if (eventIds.has(event.eventId)) return false;
  appendFileSync(journalPath(sessionDirectory, manifest), `${JSON.stringify(event)}\n`, "utf8");
  eventIds.add(event.eventId);
  return true;
}

export function effectiveScholarYears(partition: ScholarPartition, filters: SearchFilters): { low: number; high: number } {
  const filedAfterYear = filters.filed_after ? Number(filters.filed_after.slice(0, 4)) : undefined;
  const filedBeforeYear = filters.filed_before ? Number(filters.filed_before.slice(0, 4)) : undefined;
  const low = Math.max(partition.yearLo ?? 1600, filters.year_from ?? 1600, filedAfterYear ?? 1600);
  const high = Math.min(
    partition.yearHi ?? new Date().getFullYear(),
    filters.year_to ?? new Date().getFullYear(),
    filedBeforeYear ?? new Date().getFullYear(),
  );
  return { low, high };
}

export function scholarChildren(partition: ScholarPartition, filters: SearchFilters): ScholarPartition[] | undefined {
  const years = effectiveScholarYears(partition, filters);
  if (!partition.court) {
    return SCHOLAR_COURT_PARTITIONS.map((court, index) => ({
      id: `${partition.id}/court-${index + 1}-${slugify(court)}`,
      court,
      yearLo: years.low,
      yearHi: years.high,
      nextOffset: 0,
      pagesCompleted: 0,
    }));
  }
  const { low, high } = years;
  if (low >= high) return undefined;
  const middle = Math.floor((low + high) / 2);
  return [
    { id: `${partition.id}/${low}-${middle}`, court: partition.court, yearLo: low, yearHi: middle, nextOffset: 0, pagesCompleted: 0 },
    { id: `${partition.id}/${middle + 1}-${high}`, court: partition.court, yearLo: middle + 1, yearHi: high, nextOffset: 0, pagesCompleted: 0 },
  ];
}

function finishScholarState(state: ScholarState): void {
  if (state.partitions.length) return;
  if (state.partitioned) {
    state.status = "blocked";
    state.error = "Scholar partition retrieval finished, but the public court/year partition union cannot prove complete coverage of the unpartitioned corpus. All exposed partition records are preserved without claiming corpus completeness.";
  } else {
    state.status = "exhausted";
    state.error = undefined;
  }
}

async function fetchCourtListenerPage(
  state: CourtListenerState,
  filters: SearchFilters,
  seed: NormalizedCase,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
  search: typeof searchProvider,
  navigationId: string,
): Promise<NormalizedCase[]> {
  if (!state.citedById) throw new Error("CourtListener cites_id is missing.");
  const page = state.nextPage;
  // This workflow owns the page cursor and checkpoint; each call loads one page.
  const response = await search(
    "courtlistener",
    providerSearchParameters("courtlistener", {
      cites: state.citedById,
      courts: filters.court,
      year_from: filters.year_from,
      year_to: filters.year_to,
      filed_after: filters.filed_after,
      filed_before: filters.filed_before,
      page,
    }),
    `cited-by:${navigationId}:courtlistener`,
    signal,
    onUpdate,
  );
  state.rawResults += response.results.length;
  state.pagesCompleted += 1;
  state.nextPage = page + 1;
  if (response.reachedEnd === true || response.results.length < 20) state.status = "exhausted";
  return response.results.map((item, index) => normalizeProviderResult(
    "courtlistener", item, (page - 1) * 20 + index + 1, "cited_by", seed.canonicalKey,
  ));
}

async function fetchScholarPage(
  state: ScholarState,
  filters: SearchFilters,
  seed: NormalizedCase,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
  search: typeof searchProvider,
  navigationId: string,
): Promise<NormalizedCase[]> {
  if (!state.citedById) throw new Error("Google Scholar cites_id is missing.");
  const partition = state.partitions[0];
  if (!partition) {
    finishScholarState(state);
    return [];
  }
  const years = effectiveScholarYears(partition, filters);
  if (years.low > years.high) {
    state.partitions.shift();
    state.completedPartitions += 1;
    finishScholarState(state);
    return [];
  }
  // This workflow owns the page cursor and checkpoint; each call loads one page.
  const response = await search(
    "scholar",
    providerSearchParameters("scholar", {
      cites: state.citedById,
      courts: partition.court,
      year_from: years.low,
      year_to: years.high,
      filed_after: filters.filed_after,
      filed_before: filters.filed_before,
      page: partition.nextOffset / 20 + 1,
    }),
    `cited-by:${navigationId}:scholar:${partition.id}`,
    signal,
    onUpdate,
  );
  const offset = partition.nextOffset;
  state.rawResults += response.results.length;
  state.pagesCompleted += 1;
  partition.pagesCompleted += 1;
  if (response.results.length < 20) {
    state.partitions.shift();
    state.completedPartitions += 1;
    finishScholarState(state);
  } else if (offset < 980) {
    partition.nextOffset = offset + 20;
  } else {
    const children = scholarChildren(partition, filters);
    if (!children) {
      state.status = "blocked";
      state.error = `Google Scholar exposed at least 1,000 results in the indivisible partition ${partition.id}. Its public interface cannot prove completeness for this partition.`;
    } else {
      state.partitions.shift();
      state.partitioned = true;
      state.expandedPartitions.push(partition.id);
      state.partitions.unshift(...children);
    }
  }
  return response.results.map((item, index) => normalizeProviderResult(
    "scholar", item, offset + index + 1, "cited_by", seed.canonicalKey, partition.id,
  ));
}

export function classifyCitedByProviderStatuses(
  states: readonly (CitedProviderState["status"] | undefined)[],
  deadlineReached: boolean,
  aborted: boolean,
): CitedByManifest["status"] {
  if (states.every((status) => status === "exhausted")) return "complete";
  if (deadlineReached || aborted || states.some((status) => status === "paused" || status === "running")) return "paused";
  return "incomplete";
}

function classifyRunStatus(manifest: CitedByManifest, deadlineReached: boolean, aborted: boolean): CitedByManifest["status"] {
  return classifyCitedByProviderStatuses(
    manifest.requestedProviders.map((provider) => manifest.providers[provider]?.status),
    deadlineReached,
    aborted,
  );
}

export function nextRunnableCitedByProvider(
  providers: readonly DiscoveryProviderId[],
  states: Partial<Record<DiscoveryProviderId, { status?: string }>>,
): DiscoveryProviderId | undefined {
  return providers.find((provider) => states[provider]?.status === "running");
}

function limitIsLower(requested: number, saved: number): boolean {
  if (saved === -1) return requested !== -1;
  return requested !== -1 && requested < saved;
}

function limitIsHigher(requested: number, saved: number): boolean {
  if (requested === -1) return saved !== -1;
  return saved !== -1 && requested > saved;
}

function validateResumeOverrides(options: CitedByOptions, manifest: CitedByManifest): void {
  if (options.save_path !== undefined) {
    throw new Error("save_path cannot be changed when resume_from is used.");
  }
  if (options.providers) {
    const requested = requestedProviders(options.providers);
    if (requestFingerprint(requested) !== requestFingerprint(manifest.requestedProviders)) {
      throw new Error("resume_from providers do not match the saved providers.");
    }
  }
  if (options.max_pages_per_provider !== undefined
    && limitIsLower(options.max_pages_per_provider, manifest.maxPagesPerProvider ?? -1)) {
    throw new Error("resume_from max_pages_per_provider cannot lower the saved page limit.");
  }
  if (options.download_limit !== undefined
    && limitIsLower(options.download_limit, manifest.downloadLimit)) {
    throw new Error("resume_from download_limit cannot lower the saved download limit.");
  }
  const overrides: Array<keyof SearchFilters> = ["court", "year_from", "year_to", "filed_after", "filed_before"];
  for (const key of overrides) {
    if (options[key] !== undefined && options[key] !== manifest.filters[key]) {
      throw new Error(`resume_from ${key} does not match the saved request.`);
    }
  }
}

function preflightCitedByFilters(providers: DiscoveryProviderId[], filters: SearchFilters): void {
  if (filters.year_from !== undefined && filters.year_to !== undefined && filters.year_from > filters.year_to) {
    throw new Error("year_from cannot be later than year_to.");
  }
  for (const provider of providers) {
    providerSearchParameters(provider, {
      cites: "1",
      courts: filters.court,
      year_from: filters.year_from,
      year_to: filters.year_to,
      filed_after: filters.filed_after,
      filed_before: filters.filed_before,
      page: 1,
    });
  }
}

export async function runCitedByReport(
  options: CitedByOptions,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
  ctx: ExtensionContext,
  runtime: { search: typeof searchProvider } = { search: searchProvider },
): Promise<CitedByOutcome> {
  if (options.max_pages_per_provider !== undefined
    && (!Number.isInteger(options.max_pages_per_provider)
      || (options.max_pages_per_provider !== -1
        && (options.max_pages_per_provider < 1 || options.max_pages_per_provider > 50)))) {
    throw new Error("max_pages_per_provider must be -1 or an integer from 1 through 50.");
  }
  if (options.download_limit !== undefined
    && (!Number.isInteger(options.download_limit)
      || (options.download_limit !== -1
        && (options.download_limit < 0 || options.download_limit > MAX_DOWNLOAD_LIMIT)))) {
    throw new Error(`download_limit must be -1 or an integer from 0 through ${MAX_DOWNLOAD_LIMIT}.`);
  }
  let providers = requestedProviders(options.providers);
  let filters: SearchFilters = {
    court: options.court,
    year_from: options.year_from,
    year_to: options.year_to,
    filed_after: options.filed_after,
    filed_before: options.filed_before,
  };
  const fingerprintSeed = options.seed ? { canonicalKey: options.seed.canonicalKey } : undefined;
  let fingerprint = fingerprintSeed
    ? requestFingerprint({ seed: fingerprintSeed, providers, filters })
    : undefined;
  let sessionDirectory: string;
  let manifestPath: string;
  let manifest: CitedByManifest;
  let cases: NormalizedCase[];
  let eventIds: Set<string>;

  if (options.resume_from) {
    manifestPath = resolveResumeManifest(ctx.cwd, options.resume_from);
    sessionDirectory = dirname(manifestPath);
    manifest = readJsonFile<CitedByManifest>(manifestPath);
    if (manifest.schemaVersion !== 2 || manifest.mode !== "cited_by") {
      throw new Error("resume_from is not a record-preserving cited-by manifest (schemaVersion 2). Start a new run; legacy merged manifests cannot be resumed without losing provider records.");
    }
    const scholarState = manifest.providers.scholar;
    if (scholarState?.kind === "scholar" && !Array.isArray(scholarState.expandedPartitions)) {
      const legacy = scholarState as ScholarState & { discardedPartitions?: string[] };
      scholarState.expandedPartitions = Array.isArray(legacy.discardedPartitions) ? legacy.discardedPartitions : [];
    }
    // Before this field existed the library wrapper downloaded the entire
    // discovered set. Keep that promise for existing collections with the
    // explicit unlimited sentinel rather than today's finite safety ceiling.
    if (!Number.isInteger(manifest.downloadLimit)) manifest.downloadLimit = -1;
    validateResumeOverrides(options, manifest);
    if (fingerprint && manifest.requestFingerprint !== fingerprint) {
      throw new Error("resume_from belongs to different seed/provider/filter parameters.");
    }
    providers = manifest.requestedProviders;
    filters = manifest.filters;
    fingerprint = manifest.requestFingerprint;
    if (options.max_pages_per_provider !== undefined
      && limitIsHigher(options.max_pages_per_provider, manifest.maxPagesPerProvider ?? -1)) {
      manifest.maxPagesPerProvider = options.max_pages_per_provider === -1
        ? undefined
        : options.max_pages_per_provider;
      for (const provider of providers) {
        const state = manifest.providers[provider];
        if (state?.status === "capped") {
          state.status = "running";
          state.error = undefined;
        }
      }
    }
    if (options.download_limit !== undefined && limitIsHigher(options.download_limit, manifest.downloadLimit)) {
      manifest.downloadLimit = options.download_limit;
    }
    preflightCitedByFilters(providers, filters);
    // Validate every manifest-controlled path before reading or writing it.
    resolveSessionFile(sessionDirectory, manifest.resultsFile, "resultsFile");
    resolveSessionFile(sessionDirectory, manifest.journalFile, "journalFile");
    const journal = loadJournal(sessionDirectory, manifest);
    eventIds = journal.eventIds;
    cases = journal.records;
    manifest.lastRetrievedAt = journal.lastRetrievedAt ?? manifest.lastRetrievedAt;
    for (const provider of providers) {
      const state = manifest.providers[provider];
      if (state && (state.status === "paused" || state.status === "blocked")) {
        state.status = "running";
        state.error = undefined;
      }
    }
  } else {
    const seed = options.seed;
    if (!seed) throw new Error("seed is required when starting a new cited-by report.");
    if (!options.save_path) throw new Error("save_path is required when starting a new cited-by report.");
    // Validate filter syntax and provider capabilities before any browser work.
    preflightCitedByFilters(providers, filters);
    sessionDirectory = ensureDirectory(resolveOutputPath(ctx.cwd, options.save_path, options.save_path));
    manifestPath = join(sessionDirectory, "cited-by-manifest.json");
    if (existsSync(manifestPath)) {
      throw new Error(`A cited-by session already exists at ${manifestPath}. Use resume_from or choose a new save_path.`);
    }
    const createdAt = nowIso();
    manifest = {
      schemaVersion: 2,
      mode: "cited_by",
      requestFingerprint: fingerprint!,
      createdAt,
      updatedAt: createdAt,
      status: "running",
      seed,
      requestedProviders: providers,
      filters,
      providers: {},
      rawResults: 0,
      recordCount: 0,
      resultsFile: "cited-by-results.json",
      journalFile: "cited-by-events.jsonl",
      reportFiles: [],
      maxPagesPerProvider: options.max_pages_per_provider === -1 ? undefined : options.max_pages_per_provider,
      downloadLimit: options.download_limit ?? -1,
    };
    for (const provider of providers) manifest.providers[provider] = newProviderState(provider, seed, filters);
    writeTextAtomic(journalPath(sessionDirectory, manifest), "");
    writeJsonAtomic(resolveSessionFile(sessionDirectory, manifest.resultsFile, "resultsFile"), []);
    cases = [];
    eventIds = new Set();
  }

  // This is the initial checkpoint: every cursor points to the first page/offset
  // not known complete before any provider navigation begins.
  writeCheckpoint(sessionDirectory, manifestPath, manifest, cases);
  const deadline = options.time_slice_minutes
    ? Date.now() + options.time_slice_minutes * 60_000
    : Number.POSITIVE_INFINITY;
  let deadlineReached = false;

  while (!signal?.aborted) {
    if (Date.now() >= deadline) {
      deadlineReached = true;
      break;
    }
    const provider = nextRunnableCitedByProvider(providers, manifest.providers);
    if (!provider) break;
    emit(onUpdate, `Enumerating cited-by pages from ${provider}.`, {
      phase: "cited_by",
      recordCount: cases.length,
      rawResults: manifest.rawResults,
      providers: { [provider]: publicProviderState(manifest.providers[provider]!) },
    });
    try {
      const state = manifest.providers[provider]!;
      const eventId = state.kind === "courtlistener"
        ? `courtlistener:page:${state.nextPage}`
        : `scholar:${state.partitions[0]?.id ?? "done"}:offset:${state.partitions[0]?.nextOffset ?? 0}`;
      let rawResults: import("./core.ts").ProviderRawResult[] | undefined;
      let retrievedAt: string | undefined;
      const timedSearch: typeof searchProvider = async (...args) => {
        const response = await runtime.search(...args);
        retrievedAt = nowIso();
        manifest.lastRetrievedAt = retrievedAt;
        rawResults = response.results;
        return response;
      };
      const found = state.kind === "courtlistener"
        ? await fetchCourtListenerPage(state, filters, manifest.seed, signal, onUpdate, timedSearch, sessionDirectory)
        : await fetchScholarPage(state, filters, manifest.seed, signal, onUpdate, timedSearch, sessionDirectory);
      const appended = appendJournalEvent(sessionDirectory, manifest, eventIds, {
        eventId,
        provider,
        records: found,
        rawResults,
        retrievedAt,
      });
      if (appended) cases.push(...found);
      if (manifest.maxPagesPerProvider !== undefined
        && state.status === "running"
        && state.pagesCompleted >= manifest.maxPagesPerProvider) {
        state.status = "capped";
        state.error = `Stopped at the requested ${manifest.maxPagesPerProvider}-page provider limit.`;
      }
    } catch (error) {
      const state = manifest.providers[provider]!;
      const message = error instanceof Error ? error.message : String(error);
      state.status = signal?.aborted || isTransientBrowserFailure(error) ? "paused" : "blocked";
      state.error = message;
    }
    // The updated next cursor is persisted before the next navigation.
    writeCheckpoint(sessionDirectory, manifestPath, manifest, cases);
    // Scholar is attempted first, but a transient provider pause must not
    // starve another selected provider that can still make progress.
  }

  if (deadlineReached || signal?.aborted) {
    for (const provider of providers) {
      const state = manifest.providers[provider];
      if (state?.status === "running") state.status = "paused";
    }
  }
  manifest.status = classifyRunStatus(manifest, deadlineReached, Boolean(signal?.aborted));
  if (manifest.status === "complete") {
    manifest.nextAction = undefined;
  } else if (manifest.status === "paused") {
    manifest.nextAction = `Resume with resume_from=${manifestPath}`;
  } else if (manifest.requestedProviders.some((provider) => manifest.providers[provider]?.status === "capped")) {
    const savedLimit = manifest.maxPagesPerProvider ?? 0;
    manifest.nextAction = savedLimit < 50
      ? `Discovery is incomplete at the saved page cap. Resume with resume_from=${manifestPath} and max_pages_per_provider=${savedLimit + 1} or another higher total.`
      : "Discovery remains incomplete at the maximum supported page cap; review the provider state and narrow the query if possible.";
  } else {
    manifest.nextAction = "Review blocked/failed provider state; the report does not claim provider-corpus completeness.";
  }
  writeCheckpoint(sessionDirectory, manifestPath, manifest, cases, true);
  return {
    sessionDirectory,
    manifestPath,
    status: manifest.status,
    recordCount: manifest.recordCount,
    rawResults: manifest.rawResults,
    providerCorpusComplete: manifest.requestedProviders.every((provider) => manifest.providers[provider]?.status === "exhausted"),
    maxPagesPerProvider: manifest.maxPagesPerProvider,
    downloadLimit: manifest.downloadLimit ?? -1,
    requestedProviders: [...manifest.requestedProviders],
    lastRetrievedAt: manifest.lastRetrievedAt,
  };
}
