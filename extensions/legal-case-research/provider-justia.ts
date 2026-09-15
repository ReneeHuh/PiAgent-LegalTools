// Justia site-search discovery and opinion capture through the shared visible Chrome window.
import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
  PAGE_WAIT_MS,
  ProviderBrowser,
  ResultLinkUnavailableError,
  TransientBrowserError,
  abortableDelay,
  isTransientBrowserFailure,
  throwIfAborted,
  type Cdp,
  type SavedOpinionCapture,
  type StatusCallback,
  type TabRef,
} from "./browser.ts";
import { restoreSavedCapture, saveOpinionCapture } from "./library.ts";
import {
  decodeHtmlEntities,
  ensureDirectory,
  extractOpinionText,
  normalizeWhitespace,
  providerIdFromUrl,
  slugify,
  stripHtml,
  type JustiaRawResult,
} from "./core.ts";

const SEARCH_BASE = "https://www.justia.com";
const SEARCH_ENGINE_ID = "012624009653992735869:cyxxdwappru";
export const JUSTIA_PAGE_SIZE = 8;
export const JUSTIA_MAX_PAGE = 10;

export function isJustiaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol)
      && (parsed.hostname === "www.justia.com" || parsed.hostname === "law.justia.com");
  } catch { return false; }
}

export function isJustiaOpinionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "law.justia.com" && parsed.pathname.startsWith("/cases/")
      && !parsed.username && !parsed.password && !parsed.port;
  } catch { return false; }
}

const browser = new ProviderBrowser({
  name: "Justia",
  base: SEARCH_BASE,
  launchUrl: `${SEARCH_BASE}/search/`,
  tabNamePrefix: "pi-justia:",
  isProviderUrl: isJustiaUrl,
});

interface PageState {
  ready: string;
  href: string;
  title: string;
  results: boolean;
  resultCards: number;
  currentPage: number;
  hasNext: boolean;
  noResults: boolean;
  opinion: boolean;
  blocked: boolean;
}
type CapturedPage = { html: string; tab: TabRef; state: PageState };
type ExpectedPage = "results" | "opinion" | "any";

const PROBE = `(() => {
  const text = ((document.body && document.body.innerText) || '').slice(0, 5000);
  const cards = Array.from(document.querySelectorAll('.gsc-webResult.gsc-result')).filter(card =>
    Array.from(card.querySelectorAll('a.gs-title')).some(a => {
      try { const u = new URL(a.href, location.href); return u.hostname === 'law.justia.com' && u.pathname.startsWith('/cases/'); }
      catch { return false; }
    })
  ).length;
  const currentPage = Number(document.querySelector('.gsc-cursor-current-page')?.textContent || '1');
  const nextLabel = 'Page ' + (currentPage + 1);
  const results = !!document.querySelector('.gsc-resultsbox-visible .gsc-result-info, .gsc-result-info');
  return {
    ready: document.readyState,
    href: location.href,
    title: document.title,
    results,
    resultCards: cards,
    currentPage,
    hasNext: !!Array.from(document.querySelectorAll('.gsc-cursor-page')).find(e => e.getAttribute('aria-label') === nextLabel),
    noResults: /no results/i.test(text) && !!document.querySelector('.gsc-result-info'),
    opinion: location.hostname === 'law.justia.com' && location.pathname.startsWith('/cases/') && !!document.querySelector('#opinion, #opinions, #tab-opinion, #tab-opinion-0'),
    blocked: /access denied|temporarily blocked|unusual traffic|verify you are human|performing security verification|protect against malicious bots/i.test(text) && !results,
  };
})()`;

function readPageState(cdp: Cdp, sessionId: string): Promise<PageState> {
  return cdp.eval<PageState>(sessionId, PROBE);
}

function matches(state: PageState, expected: ExpectedPage, expectedResultPage?: number): boolean {
  if (state.blocked) return true;
  if (state.ready !== "interactive" && state.ready !== "complete") return false;
  if (expected === "opinion") return state.opinion;
  if (expected === "results") {
    return state.results
      && (expectedResultPage === undefined || state.currentPage === expectedResultPage);
  }
  return state.results || state.opinion;
}

async function capturePage(
  cdp: Cdp,
  targetId: string,
  sessionId: string,
  tab: TabRef,
  expected: ExpectedPage,
  expectedResultPage: number | undefined,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<CapturedPage> {
  let state: PageState | undefined;
  const deadline = Date.now() + PAGE_WAIT_MS;
  while (Date.now() < deadline) {
    await abortableDelay(400, signal);
    state = await readPageState(cdp, sessionId);
    if (matches(state, expected, expectedResultPage)) break;
  }
  if (!state || !matches(state, expected, expectedResultPage)) {
    throw new TransientBrowserError(`Timed out waiting for the expected Justia ${expected} page.`);
  }
  try { await browser.markAgentTab(cdp, sessionId, tab.marker); } catch {}
  if (state.blocked) {
    state = await browser.waitForHumanChallenge(
      cdp, targetId, state, () => readPageState(cdp, sessionId), current => current.blocked,
      {
        detected: "Justia security verification detected; waiting up to 120 seconds for it to clear in the visible browser.",
        detectedAgain: "Justia security verification detected again; waiting up to 120 seconds for it to clear.",
        unsolved: "Justia security verification is still open. Complete it in the visible Chrome window, then retry.",
        cleared: "Justia security verification cleared; continuing the request.",
      }, signal, onStatus,
    );
    const afterChallengeDeadline = Date.now() + PAGE_WAIT_MS;
    while (Date.now() < afterChallengeDeadline && !matches(state, expected, expectedResultPage)) {
      await abortableDelay(400, signal);
      state = await readPageState(cdp, sessionId);
    }
    if (!matches(state, expected, expectedResultPage)) {
      throw new TransientBrowserError(`Justia verification cleared, but the expected ${expected} page did not load.`);
    }
  }
  const html = await cdp.eval<string>(sessionId, "document.documentElement.outerHTML");
  return { html, tab, state };
}

function searchUrl(query: string): string {
  const params = new URLSearchParams({
    cx: SEARCH_ENGINE_ID,
    cof: "FORID:11",
    safe: "active",
    title: "",
    type: "justia",
    q: query,
    sa: "",
  });
  return `${SEARCH_BASE}/search?${params.toString()}`;
}

function browserFetch(query: string, signal?: AbortSignal, onStatus?: StatusCallback): Promise<CapturedPage> {
  return browser.withLock(async () => {
    await browser.pauseBeforeNavigation(signal);
    const cdp = await browser.connect(signal);
    try {
      const opened = await browser.openTab(cdp, undefined, signal);
      await cdp.send("Page.navigate", { url: searchUrl(query) }, opened.sessionId);
      await cdp.send("Target.activateTarget", { targetId: opened.targetId });
      const page = await capturePage(cdp, opened.targetId, opened.sessionId, opened.tab, "results", 1, signal, onStatus);
      browser.acquireTabLease(opened.tab);
      return page;
    } finally { cdp.close(); }
  }, signal);
}

function browserReadCurrentResults(tab: TabRef, page: number, signal?: AbortSignal): Promise<CapturedPage | undefined> {
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    try {
      const { sessionId } = await browser.attachTab(cdp, tab, signal);
      const state = await readPageState(cdp, sessionId);
      if (!state.results || state.blocked || state.currentPage !== page) return undefined;
      return { html: await cdp.eval<string>(sessionId, "document.documentElement.outerHTML"), tab, state };
    } finally { cdp.close(); }
  }, signal);
}

function browserClickResultPage(tab: TabRef, page: number, signal?: AbortSignal, onStatus?: StatusCallback): Promise<CapturedPage> {
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    try {
      const { targetId, sessionId } = await browser.attachTab(cdp, tab, signal);
      await cdp.send("Target.activateTarget", { targetId });
      await browser.pauseBeforeClick(signal);
      const clicked = await cdp.eval<boolean>(sessionId, `(() => {
        const label = ${JSON.stringify(`Page ${page}`)};
        const control = Array.from(document.querySelectorAll('.gsc-cursor-page')).find(e => e.getAttribute('aria-label') === label);
        if (!control) return false;
        control.scrollIntoView({ block: 'center', behavior: 'instant' });
        control.click();
        return true;
      })()`);
      if (!clicked) throw new ResultLinkUnavailableError(`Justia result page ${page} is not available.`);
      return capturePage(cdp, targetId, sessionId, tab, "results", page, signal, onStatus);
    } finally { cdp.close(); }
  }, signal);
}

function blockText(html: string): string {
  return normalizeWhitespace(stripHtml(html));
}

function attr(tag: string, name: string): string | undefined {
  return decodeHtmlEntities(tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? "") || undefined;
}

export function parseJustiaResults(html: string): JustiaRawResult[] {
  const results: JustiaRawResult[] = [];
  const blocks = html.split(/<div\b[^>]*class=["'][^"']*\bgsc-webResult\b[^"']*\bgsc-result\b[^"']*["'][^>]*>/i).slice(1);
  for (const [blockIndex, block] of blocks.entries()) {
    const linkTag = block.match(/<a\b[^>]*class=["'][^"']*\bgs-title\b[^"']*["'][^>]*>/i)?.[0];
    if (!linkTag) continue;
    const url = attr(linkTag, "data-ctorig") ?? attr(linkTag, "href") ?? "";
    if (!isJustiaOpinionUrl(url)) continue;
    const afterLink = block.slice((block.indexOf(linkTag) + linkTag.length));
    const title = blockText(afterLink.slice(0, afterLink.indexOf("</a>")));
    const snippet = blockText(block.match(/<div\b[^>]*class=["'][^"']*\bgs-snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const breadcrumb = blockText(block.match(/<div\b[^>]*class=["'][^"']*\bgs-visibleUrl-breadcrumb\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const casePath = providerIdFromUrl("justia", url);
    const displayedDate = snippet.match(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/)?.[0];
    results.push({ title, url, casePath, snippet, displayedDate, breadcrumb: breadcrumb || undefined,
      resultPosition: blockIndex + 1 });
  }
  return results;
}

function parsedResults(page: CapturedPage): JustiaRawResult[] {
  const results = parseJustiaResults(page.html);
  if (results.length !== page.state.resultCards) {
    throw new Error(`Justia rendered ${page.state.resultCards} result cards, but ${results.length} valid case results could be parsed. The layout or result mix may have changed.`);
  }
  return results;
}

export interface JustiaSearchRequest {
  query: string;
  page: number;
  navigationSession?: string;
}

export interface JustiaPageResponse {
  results: JustiaRawResult[];
  reachedEnd: boolean;
  lastPage: number;
  resultCountText?: string;
  timingMode: string;
}

export async function searchJustiaPage(
  request: JustiaSearchRequest,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<any>,
): Promise<JustiaPageResponse> {
  const query = request.query?.trim();
  if (!query) throw new Error("query is required for Justia search.");
  if (!Number.isInteger(request.page) || request.page < 1 || request.page > JUSTIA_MAX_PAGE) {
    throw new Error(`Justia search supports result pages 1 through ${JUSTIA_MAX_PAGE}.`);
  }
  const sessionKey = request.navigationSession?.trim() || undefined;
  const progress = (message: string, details: Record<string, unknown> = {}) =>
    browser.emitProgress(onUpdate, message, { page: request.page, ...details });
  const browserStatus: StatusCallback = message => progress(message, { phase: "verification" });
  progress(`Starting Justia search, result page ${request.page}.`, { phase: "starting" });
  let tab: TabRef | undefined;
  try {
    let fetched: CapturedPage | undefined;
    const prior = sessionKey ? browser.getNavigationSession(sessionKey) : undefined;
    if (prior && (prior.page === request.page || prior.page + 1 === request.page)) {
      browser.acquireTabLease(prior.tab);
      tab = prior.tab;
      try {
        fetched = prior.page === request.page
          ? await browserReadCurrentResults(prior.tab, request.page, signal)
          : await browserClickResultPage(prior.tab, request.page, signal, browserStatus);
      } catch (error) {
        throwIfAborted(signal);
        if (isTransientBrowserFailure(error)) throw error;
      }
      if (!fetched) {
        browser.releaseTabLease(prior.tab);
        if (sessionKey) browser.forgetNavigationSession(sessionKey);
        tab = undefined;
      }
    }
    if (!fetched) {
      fetched = await browserFetch(query, signal, browserStatus);
      tab = fetched.tab;
      for (let page = 2; page <= request.page; page += 1) {
        if (!fetched.state.hasNext) {
          return { results: [], reachedEnd: true, lastPage: page - 1, timingMode: browser.timingMode };
        }
        progress(`Clicking Justia result page ${page}.`, { phase: "clicking_next_page", restoredPage: page });
        fetched = await browserClickResultPage(tab, page, signal, browserStatus);
      }
    }
    const results = parsedResults(fetched);
    if (sessionKey && tab) browser.rememberNavigationSession(sessionKey, { tab, page: request.page });
    return { results, reachedEnd: !fetched.state.hasNext && request.page < JUSTIA_MAX_PAGE, lastPage: request.page, timingMode: browser.timingMode };
  } catch (error) {
    if (sessionKey) browser.forgetNavigationSession(sessionKey);
    throw error;
  } finally { browser.releaseTabLease(tab); }
}

function leaseResultTab(url: string, signal?: AbortSignal): Promise<TabRef> {
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    try {
      for (const tab of browser.idleTabsNewestFirst(await browser.discoverAgentTabs(cdp, signal))) {
        let sessionId: string | undefined;
        try {
          ({ sessionId } = await browser.attachTab(cdp, tab, signal));
          const found = await cdp.eval<boolean>(sessionId, `Array.from(document.querySelectorAll('.gsc-webResult.gsc-result a.gs-title')).some(a => a.href === ${JSON.stringify(url)})`);
          if (found) { browser.acquireTabLease(tab); return tab; }
        } catch { throwIfAborted(signal); }
        finally { if (sessionId) try { await cdp.send("Target.detachFromTarget", { sessionId }); } catch {} }
      }
    } finally { cdp.close(); }
    throw new ResultLinkUnavailableError("No open Justia results tab contains the requested opinion. Run the search again, then retry.");
  }, signal);
}

function clickCase(tab: TabRef, url: string, signal?: AbortSignal): Promise<CapturedPage> {
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    try {
      const { targetId, sessionId } = await browser.attachTab(cdp, tab, signal);
      await cdp.send("Target.activateTarget", { targetId });
      await browser.pauseBeforeClick(signal);
      const clicked = await cdp.eval<boolean>(sessionId, `(() => {
        const link = Array.from(document.querySelectorAll('.gsc-webResult.gsc-result a.gs-title')).find(a => a.href === ${JSON.stringify(url)});
        if (!link) return false;
        link.removeAttribute('target'); link.scrollIntoView({ block: 'center', behavior: 'instant' }); link.click(); return true;
      })()`);
      if (!clicked) throw new ResultLinkUnavailableError("The requested Justia case link is no longer on the open results page.");
      const page = await capturePage(cdp, targetId, sessionId, tab, "opinion", undefined, signal);
      await browser.pauseForOpinionDwell(signal);
      page.html = await cdp.eval<string>(sessionId, "document.documentElement.outerHTML");
      return page;
    } finally { cdp.close(); }
  }, signal);
}

function backToResults(tab: TabRef, signal?: AbortSignal): Promise<CapturedPage> {
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    try {
      const { targetId, sessionId } = await browser.attachTab(cdp, tab, signal);
      const history = await cdp.send("Page.getNavigationHistory", {}, sessionId);
      const prior = history.entries?.[history.currentIndex - 1];
      if (!prior) throw new Error("The Justia result page is not available in this tab's history.");
      await browser.pauseBeforeBack(signal);
      await cdp.send("Page.navigateToHistoryEntry", { entryId: prior.id }, sessionId);
      return capturePage(cdp, targetId, sessionId, tab, "results", undefined, signal);
    } finally { cdp.close(); }
  }, signal);
}

export async function clickJustiaResult(
  url: string,
  saveDir: string,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<any>,
): Promise<SavedOpinionCapture> {
  if (!isJustiaOpinionUrl(url)) throw new Error("url must be an HTTPS Justia opinion below law.justia.com/cases/.");
  const providerId = providerIdFromUrl("justia", url)!;
  browser.emitProgress(onUpdate, `Finding Justia result link for ${providerId}.`, {
    phase: "finding_result_link", providerId, url,
  });
  const tab = await leaseResultTab(url, signal);
  let visited = false;
  try {
    const page = await clickCase(tab, url, signal);
    visited = true;
    if (new URL(page.state.href).pathname.replace(/\/$/, "") !== new URL(url).pathname.replace(/\/$/, "")) {
      throw new Error("The clicked Justia result opened a different opinion URL.");
    }
    const text = extractOpinionText(page.html, "justia");
    if (text.length < 200) throw new Error("No substantial opinion text was found on the Justia case page.");
    ensureDirectory(saveDir);
    const title = decodeHtmlEntities(page.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const pdfPath = [...page.html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .find(match => /Download PDF/i.test(blockText(match[2])))?.[1];
    const pdfUrl = pdfPath ? new URL(decodeHtmlEntities(pdfPath), page.state.href).href : undefined;
    const saved = { savedPath: saveOpinionCapture(join(saveDir, `${slugify(title) || "case"}-${slugify(providerId)}.html`), page.html), title };
    browser.emitProgress(onUpdate, `Returning to Justia results after saving ${providerId}.`, {
      phase: "returning_to_results", providerId, savedPath: saved.savedPath,
    });
    const restored = await restoreSavedCapture(saved, () => backToResults(tab, signal));
    visited = !restored.returnedToResults;
    return { title, savedPath: saved.savedPath, sourceUrl: page.state.href, textLength: text.length,
      returnedToResults: restored.returnedToResults, restorationError: restored.restorationError,
      providerData: { pdf_url: pdfUrl } };
  } finally {
    if (visited) try { await backToResults(tab, signal); } catch {}
    browser.releaseTabLease(tab);
  }
}

export async function openJustiaBrowser(
  url: string | undefined,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<any>,
): Promise<{ url: string; timingMode: string }> {
  if (url && !isJustiaUrl(url)) throw new Error("url must be an HTTP(S) URL on www.justia.com or law.justia.com.");
  const destination = url ?? `${SEARCH_BASE}/search/`;
  browser.emitProgress(onUpdate, "Opening the shared Justia browser.", { phase: "opening_browser", requestedUrl: url });
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    let tab: TabRef | undefined;
    try {
      const opened = await browser.openTab(cdp, await browser.newestIdleTab(cdp, signal), signal);
      tab = opened.tab; browser.acquireTabLease(tab);
      await cdp.send("Page.navigate", { url: destination }, opened.sessionId);
      await abortableDelay(500, signal);
      await cdp.send("Target.activateTarget", { targetId: opened.targetId });
      return { url: destination, timingMode: browser.timingMode };
    } finally { browser.releaseTabLease(tab); cdp.close(); }
  }, signal);
}
