import { join } from "node:path";
import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentBrowser, validateBrowser, withBrowser, type BrowserChoice } from "./browser-choice.ts";
import { normalizeProviderResult, providerFromOpinionUrl, providerIdFromUrl, mergeCases } from "./core.ts";
import { checkOpinionIntegrity, libraryEntries } from "./library.ts";
import { processDownloadedOpinion } from "./opinion-processing.ts";
import { searchProvider } from "./providers.ts";
import { checkpointSearch, readSearchRun, recordSearchDownload, recordSearchPage, searchObservations } from "./search-history.ts";
import { legalSearchPageParameters } from "./session-search.ts";
import { downloadClickedResultLink, type DownloadedCase } from "./workflows.ts";

export interface SelectedDownloadOptions {
  action: "download_results";
  run_id: string;
  result_refs: string[];
  browser?: BrowserChoice;
  summarize?: boolean;
}
export interface SelectedDownloadResult {
  result_ref: string;
  case_key: string;
  title: string;
  status: "downloaded" | "failed" | "not_attempted";
  reused?: boolean;
  saved_html_path?: string;
  saved_md_path?: string;
  summary_path?: string;
  error?: string;
  warnings?: string[];
}
export interface SelectedDownloadOutcome {
  status: "completed" | "partial_failure" | "stopped";
  runId: string;
  browser: BrowserChoice;
  results: SelectedDownloadResult[];
  retry: SelectedDownloadOptions | null;
}
export interface SelectedDownloadRuntime {
  search: typeof searchProvider;
  download: typeof downloadClickedResultLink;
  process: typeof processDownloadedOpinion;
}
const defaultRuntime: SelectedDownloadRuntime = { search: searchProvider, download: downloadClickedResultLink, process: processDownloadedOpinion };

export async function runSelectedDownloads(
  options: SelectedDownloadOptions, signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined, ctx: ExtensionContext,
  runtime: SelectedDownloadRuntime = defaultRuntime,
): Promise<SelectedDownloadOutcome> {
  const unexpected = Object.keys(options).filter(key => !["action", "run_id", "result_refs", "browser", "summarize"].includes(key));
  if (unexpected.length) throw new Error(`action=download_results does not accept: ${unexpected.join(", ")}.`);
  if (options.summarize !== undefined && typeof options.summarize !== "boolean") throw new Error("summarize must be a boolean.");
  if (!Array.isArray(options.result_refs) || !options.result_refs.length || options.result_refs.length > 100
    || options.result_refs.some(ref => typeof ref !== "string" || !/^r_[a-f0-9]{32}$/.test(ref))) {
    throw new Error("result_refs must contain 1 through 100 saved result_ref values.");
  }
  const run = readSearchRun(ctx.cwd, options.run_id);
  const observations = new Map(searchObservations(run, false).map(row => [row.result_ref, row]));
  // Validate the entire selection before opening a browser or saving anything.
  const selected = [...new Set(options.result_refs)].map(ref => {
    const row = observations.get(ref);
    if (!row) throw new Error(`result_ref ${ref} does not belong to run_id ${options.run_id}.`);
    const source = row.case.sources.find(source => source.provider === run.manifest.request.provider);
    if (!source || providerFromOpinionUrl(source.url) !== source.provider
      || !source.providerId || providerIdFromUrl(source.provider, source.url) !== source.providerId) {
      throw new Error(`The saved provider identity for ${ref} is invalid.`);
    }
    return { ...row, source };
  });
  const browser = validateBrowser(options.browser ?? run.manifest.request.browser);
  return withBrowser(browser, async () => {
    run.manifest.request.browser = browser;
    checkpointSearch(run);
    const results: SelectedDownloadResult[] = [];
    const root = join(ctx.cwd, "Cases");
    const acquired = new Map<string, DownloadedCase>();
    let activePage: number | undefined;
    let renderedIdentities = new Set<string>();
    const progress = (message: string, details: Record<string, unknown>) => {
      try { onUpdate?.({ content: [{ type: "text", text: message }], details: { ...details, browser: currentBrowser(), runId: run.manifest.runId } }); } catch { /* Advisory only. */ }
    };
    for (const [index, row] of selected.entries()) {
      const result: SelectedDownloadResult = { result_ref: row.result_ref, case_key: row.case.canonicalKey, title: row.case.title, status: "not_attempted" };
      results.push(result);
      if (signal?.aborted) continue;
      const identity = `${row.source.provider}:${row.source.providerId}`;
      let downloaded: DownloadedCase | undefined;
      try {
        const library = libraryEntries(root);
        result.warnings = [...library.warnings];
        downloaded = acquired.get(identity);
        if (!downloaded) {
          for (const { record } of library.entries) {
            if (record.source.provider !== row.source.provider
              || providerIdFromUrl(row.source.provider, record.source.sourceUrl) !== row.source.providerId) continue;
            const integrity = checkOpinionIntegrity(record.source, root);
            if (integrity.status !== "valid") { result.warnings.push(`${record.source.savedPath}: ${integrity.reason}`); continue; }
            // Provider titles can change; retain the actual saved library case key.
            downloaded = { case: record.case, status: "downloaded", saved: record.source };
            break;
          }
        }
        result.reused = Boolean(downloaded);
        progress(`${downloaded ? "Reusing saved" : "Downloading selected"} opinion ${index + 1} of ${selected.length}: ${row.case.title}`, {
          phase: downloaded ? "reusing_opinion" : "selected_download", index: index + 1, total: selected.length, result_ref: row.result_ref,
        });
        if (!downloaded) {
          if (activePage !== row.page) {
            progress(`Restoring ${row.source.provider} result page ${row.page} and checking the saved selection.`, { phase: "restoring_results", page: row.page });
            const request = { ...run.manifest.request, endPage: row.page };
            const response = await runtime.search(row.source.provider, legalSearchPageParameters(request, row.page),
              `selection:${run.manifest.runId}`, signal, onUpdate);
            const normalized = response.results.map((raw, position) => normalizeProviderResult(row.source.provider, raw, position + 1));
            recordSearchPage(run, row.page, response.results, normalized, response.reachedEnd);
            renderedIdentities = new Set(normalized.flatMap(item => item.sources.map(source => `${source.provider}:${source.providerId}`)));
            activePage = row.page;
          }
          if (!renderedIdentities.has(identity)) throw new Error("The selected opinion is no longer on its saved result page. Inspect the saved result and run a fresh exact-case search; no substitute was downloaded.");
          downloaded = await runtime.download(row.case, row.source.url, root, signal, onUpdate);
          // Save acquisition before conversion/summary, which may fail or be cancelled.
          recordSearchDownload(run, row.case.canonicalKey, downloaded);
          if (downloaded.status === "downloaded") acquired.set(identity, downloaded);
          if (downloaded.status === "failed" || downloaded.saved?.returnedToResults === false) activePage = undefined;
        }
        await runtime.process(downloaded, options.summarize ?? false, signal, onUpdate, ctx);
        recordSearchDownload(run, row.case.canonicalKey, downloaded);
        result.status = downloaded.status;
        result.error = downloaded.error;
      } catch (error) {
        activePage = undefined;
        result.error = error instanceof Error ? error.message : String(error);
        // Never replace a successfully preserved source with a derivative failure.
        result.status = downloaded?.status === "downloaded" ? "downloaded" : signal?.aborted ? "not_attempted" : "failed";
        if (!downloaded && !signal?.aborted) recordSearchDownload(run, row.case.canonicalKey, { status: "failed", error: result.error });
      }
      if (downloaded?.saved) {
        result.case_key = downloaded.case.canonicalKey;
        result.saved_html_path = downloaded.saved.savedPath;
        result.saved_md_path = downloaded.saved.markdownPath;
        result.summary_path = downloaded.saved.summary?.path;
        if (downloaded.saved.markdownError) (result.warnings ??= []).push(`Markdown conversion failed: ${downloaded.saved.markdownError}`);
        if (options.summarize && downloaded.saved.summary?.status === "failed") (result.warnings ??= []).push(`Summary failed: ${downloaded.saved.summary.error}`);
        if (downloaded.saved.returnedToResults === false) (result.warnings ??= []).push(`Opinion saved; results will be restored before the next download: ${downloaded.saved.restorationError ?? "navigation failed"}`);
      }
      progress(`Selected opinion ${index + 1} of ${selected.length}: ${result.status}.`, { phase: "selected_result", ...result });
    }
    const latest = searchObservations(run);
    run.manifest.resultCount = latest.length;
    run.manifest.uniqueCaseCount = mergeCases(latest.map(row => row.case), run.manifest.request.provider).length;
    checkpointSearch(run);
    const retryRefs = results.filter(row => row.status !== "downloaded" || row.error
      || (options.summarize && !row.summary_path) || !row.saved_md_path).map(row => row.result_ref);
    return { status: signal?.aborted ? "stopped" : retryRefs.length ? "partial_failure" : "completed", runId: run.manifest.runId, browser, results,
      retry: retryRefs.length ? { action: "download_results", run_id: run.manifest.runId, result_refs: retryRefs, browser, summarize: options.summarize ?? false } : null };
  });
}
