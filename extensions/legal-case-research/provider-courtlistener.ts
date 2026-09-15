// CourtListener case-law provider: rendered search pages, result-title clicks,
// and opinion capture in the shared visible browser window.
//
// Every operation is single-page. Page 1 is reached through CourtListener's
// own search form (or the constructed cites URL for cited-by lookups); later
// pages are reached only by clicking the rendered Next link. Opinions are
// opened by clicking their rendered title and the results page is restored
// with Back. Command timeouts and disconnects are retried once by reconnecting
// to the same tab and checking whether the navigation already completed.
import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { currentBrowser } from "./browser-choice.ts";
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
import { decodeHtmlEntities, ensureDirectory, normalizeWhitespace, slugify, stripHtml } from "./core.ts";
import { saveOpinionCapture } from "./library.ts";
import { appendCourtListenerCourts } from "./jurisdiction-codes.ts";

const BASE = "https://www.courtlistener.com";
export const COURTLISTENER_PAGE_SIZE = 20;
const MAX_REMEMBERED_CLUSTER_TABS = 2_000;

export function isCourtListenerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) &&
      (parsed.hostname === "courtlistener.com" || parsed.hostname === "www.courtlistener.com");
  } catch {
    return false;
  }
}

const browser = new ProviderBrowser({
  name: "CourtListener",
  base: BASE,
  launchUrl: BASE,
  tabNamePrefix: "pi-courtlistener:",
  isProviderUrl: isCourtListenerUrl,
});

// The tab that most recently rendered each cluster's result link, so a click
// can go straight to it. Bounded and pruned when agent tabs are closed.
const clusterTabsByBrowser = new Map<string, Map<string, TabRef>>();
function clusterTabs(): Map<string, TabRef> {
  const choice = currentBrowser();
  if (!clusterTabsByBrowser.has(choice)) clusterTabsByBrowser.set(choice, new Map());
  return clusterTabsByBrowser.get(choice)!;
}
browser.onTabClosed((targetId) => {
  for (const [clusterId, tab] of clusterTabs()) {
    if (tab.targetId === targetId) clusterTabs().delete(clusterId);
  }
});
function rememberClusterTab(clusterId: string, tab: TabRef): void {
  clusterTabs().delete(clusterId);
  clusterTabs().set(clusterId, tab);
  while (clusterTabs().size > MAX_REMEMBERED_CLUSTER_TABS) {
    const oldest = clusterTabs().keys().next().value as string | undefined;
    if (!oldest) break;
    clusterTabs().delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Page state probing
// ---------------------------------------------------------------------------

type ExpectedPage = "results" | "opinion";
type PageState = {
  ready: string;
  href: string;
  title: string;
  home: boolean;
  results: boolean;
  resultCards: number;
  resultCountText: string;
  hasNext: boolean;
  opinion: boolean;
  noResults: boolean;
  verification: boolean;
  blocked: boolean;
};
type CapturedPage = { html: string; tab: TabRef; state: PageState };

const PAGE_PROBE = `(() => {
  const body = ((document.body && document.body.innerText) || "").slice(0, 12000);
  const resultsRoot = document.querySelector('#search-results');
  const opinion = !!document.querySelector('#caption.case-caption') &&
    !!document.querySelector('.main-document article');
  const verification =
    !!document.querySelector('iframe[src*="captcha"], iframe[src*="challenge"], [class*="captcha" i], #challenge-form') ||
    /(?:verify that you(?:'|’)re not a robot|checking your browser|complete the security check|captcha)/i.test(body);
  const resultCount = document.querySelector('#result-count');
  return {
    ready: document.readyState,
    href: location.href,
    title: document.title,
    home: !!document.querySelector('#search-form #id_q'),
    results: !!resultsRoot && !!resultCount,
    resultCards: document.querySelectorAll('#search-results > article').length,
    resultCountText: (resultCount && resultCount.textContent || '').replace(/\\s+/g, ' ').trim(),
    hasNext: !!document.querySelector('#search-results a[rel="next"]'),
    opinion,
    noResults: !!resultCount && /(?:\\b0\\s+Opinions?\\b|No (?:matching )?(?:Opinions?|Results?))/i.test(
      (resultCount.textContent || '') + ' ' + body
    ),
    verification,
    blocked:
      !verification &&
      !resultsRoot &&
      !opinion &&
      /(?:access denied|too many requests|temporarily blocked|request was blocked)/i.test(body),
  };
})()`;

const VERIFICATION_MESSAGES = {
  detected: "CourtListener verification detected; waiting up to 120 seconds for the user. Browser steps switch to a cautious randomized 1.5–3.0 seconds after it clears.",
  detectedAgain: "CourtListener verification detected again; waiting up to 120 seconds for the user. Browser steps remain at a cautious randomized 1.5–3.0 seconds after it clears.",
  unsolved: "CourtListener is showing a verification page in the open browser window. Complete it there, then retry the tool.",
  cleared: "CourtListener verification cleared; continuing with cautious 1.5–3.0 second browser steps.",
};

function readPageState(cdp: Cdp, sessionId: string): Promise<PageState> {
  return cdp.eval<PageState>(sessionId, PAGE_PROBE);
}

function handleVerification(
  cdp: Cdp,
  targetId: string,
  sessionId: string,
  initial: PageState,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<PageState> {
  return browser.waitForHumanChallenge(
    cdp,
    targetId,
    initial,
    () => readPageState(cdp, sessionId),
    (state) => state.verification,
    VERIFICATION_MESSAGES,
    signal,
    onStatus,
  );
}

function matchesExpectedPage(state: PageState, expected: ExpectedPage, previousHref?: string): boolean {
  if (state.verification || state.blocked) return true;
  if (previousHref && state.href === previousHref) return false;
  if (state.ready !== "interactive" && state.ready !== "complete") return false;
  if (expected === "results") return state.results || state.noResults;
  return state.opinion;
}

function blockedError(): TransientBrowserError {
  return new TransientBrowserError(
    "CourtListener blocked this browser request. Wait a few minutes and keep navigation volume low; the tab remains open.",
  );
}

async function waitForHome(
  cdp: Cdp,
  targetId: string,
  sessionId: string,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<PageState> {
  let state: PageState | undefined;
  const deadline = Date.now() + PAGE_WAIT_MS;
  while (Date.now() < deadline) {
    await abortableDelay(400, signal);
    state = await readPageState(cdp, sessionId);
    if (state.home || state.verification || state.blocked) break;
  }
  if (!state) throw new TransientBrowserError("CourtListener's home page did not load.");
  state = await handleVerification(cdp, targetId, sessionId, state, signal, onStatus);
  if (state.blocked) throw blockedError();
  if (!state.home) {
    const retryDeadline = Date.now() + PAGE_WAIT_MS;
    while (Date.now() < retryDeadline && !state.home) {
      await abortableDelay(400, signal);
      state = await readPageState(cdp, sessionId);
    }
  }
  if (!state.home) throw new Error("CourtListener's rendered search form was not available.");
  return state;
}

async function submitSearchFromHome(
  cdp: Cdp,
  targetId: string,
  sessionId: string,
  finalUrl: string,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<void> {
  const requested = new URL(finalUrl);
  const query = requested.searchParams.get("q");
  if (!query) throw new Error("A CourtListener browser search requires a query.");

  await cdp.send("Page.navigate", { url: BASE }, sessionId);
  await cdp.send("Target.activateTarget", { targetId });
  await waitForHome(cdp, targetId, sessionId, signal, onStatus);

  const fields = [...requested.searchParams.entries()].filter(([name]) => name !== "q" && name !== "page");
  const prepared = await cdp.eval<boolean>(sessionId, `(() => {
    const input = document.querySelector('#search-form #id_q');
    const form = input && input.form;
    if (!input || !form) return false;
    input.value = '';
    for (const old of Array.from(form.querySelectorAll('[data-pi-courtlistener-field]'))) old.remove();
    const fields = ${JSON.stringify(fields)};
    for (const [name, value] of fields) {
      const field = document.createElement('input');
      field.type = 'hidden';
      field.name = name;
      field.value = value;
      field.setAttribute('data-pi-courtlistener-field', '1');
      form.appendChild(field);
    }
    input.focus();
    return true;
  })()`);
  if (!prepared) throw new Error("Could not prepare CourtListener's rendered search form.");

  await cdp.send("Input.insertText", { text: query }, sessionId);
  const submitted = await cdp.eval<boolean>(sessionId, `(() => {
    const input = document.querySelector('#search-form #id_q');
    const form = input && input.form;
    if (!input || !form) return false;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // CourtListener's page JavaScript rebuilds ordinary click submissions
    // from its sidebar controls. Native form submission preserves the hidden
    // filters prepared above while still using the site's rendered form.
    HTMLFormElement.prototype.submit.call(form);
    return true;
  })()`);
  if (!submitted) throw new Error("Could not submit CourtListener's rendered search form.");
}

async function capturePage(
  cdp: Cdp,
  targetId: string,
  sessionId: string,
  tab: TabRef,
  expected: ExpectedPage,
  previousHref?: string,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<CapturedPage> {
  const waitMatched = async (): Promise<PageState | undefined> => {
    let current: PageState | undefined;
    const deadline = Date.now() + PAGE_WAIT_MS;
    while (Date.now() < deadline) {
      await abortableDelay(400, signal);
      current = await readPageState(cdp, sessionId);
      if (matchesExpectedPage(current, expected, previousHref)) return current;
    }
    return current;
  };

  let state = await waitMatched();
  if (!state) throw new TransientBrowserError("CourtListener page never loaded; is the browser responsive?");
  try { await browser.markAgentTab(cdp, sessionId, tab.marker); } catch {}
  const encounteredVerification = state.verification;
  state = await handleVerification(cdp, targetId, sessionId, state, signal, onStatus);
  if (encounteredVerification && !matchesExpectedPage(state, expected, previousHref)) {
    state = (await waitMatched()) ?? state;
  }
  try { await browser.markAgentTab(cdp, sessionId, tab.marker); } catch {}
  throwIfAborted(signal);

  if (state.blocked) throw blockedError();
  if (!matchesExpectedPage(state, expected, previousHref)) {
    throw new TransientBrowserError(
      `Timed out waiting for a CourtListener ${expected} page ` +
        `(url: ${state.href}, title: "${state.title}", readyState: ${state.ready}).`,
    );
  }
  if (expected === "results" && !state.results && !state.noResults) {
    throw new Error("CourtListener returned an unrecognized search page. Inspect the open browser tab and retry.");
  }
  if (expected === "opinion" && !state.opinion) {
    throw new Error("CourtListener returned a page without a recognizable rendered opinion.");
  }
  const html = await cdp.eval<string>(sessionId, "document.documentElement.outerHTML");
  return { html, tab, state };
}

// ---------------------------------------------------------------------------
// Browser operations (each serialized through the provider lock)
// ---------------------------------------------------------------------------

/** Open a new agent tab at `path`, optionally through the rendered search form. The returned tab is leased. */
function browserFetch(
  path: string,
  expected: ExpectedPage,
  useSearchForm: boolean,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<CapturedPage> {
  return browser.withLock(async () => {
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    await browser.pauseBeforeNavigation(signal);
    const cdp = await browser.connect(signal);
    try {
      const { tab, targetId, sessionId } = await browser.openTab(cdp, undefined, signal);
      if (useSearchForm) await submitSearchFromHome(cdp, targetId, sessionId, url, signal, onStatus);
      else await cdp.send("Page.navigate", { url }, sessionId);
      await cdp.send("Target.activateTarget", { targetId });
      const page = await capturePage(cdp, targetId, sessionId, tab, expected, undefined, signal, onStatus);
      browser.acquireTabLease(tab);
      return page;
    } finally {
      cdp.close();
    }
  }, signal);
}

/** Re-read the results page currently rendered in a leased tab without navigating. */
function browserReadCurrentResults(tab: TabRef, signal?: AbortSignal): Promise<CapturedPage | undefined> {
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    try {
      const { sessionId } = await browser.attachTab(cdp, tab, signal);
      const state = await readPageState(cdp, sessionId);
      if (!state.results || state.verification || state.blocked) return undefined;
      const html = await cdp.eval<string>(sessionId, "document.documentElement.outerHTML");
      return { html, tab, state };
    } finally {
      cdp.close();
    }
  }, signal);
}

async function reloadAfterReconnect(
  cdp: Cdp,
  targetId: string,
  sessionId: string,
  tab: TabRef,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<PageState> {
  const { targetInfo } = await cdp.send("Target.getTargetInfo", { targetId });
  const expected: ExpectedPage = /\/opinion\/\d+\//.test(String(targetInfo?.url)) ? "opinion" : "results";
  await cdp.send("Page.reload", {}, sessionId);
  return (await capturePage(cdp, targetId, sessionId, tab, expected, undefined, signal, onStatus)).state;
}

function browserClickCaseResult(
  tab: TabRef,
  clusterId: string,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<CapturedPage> {
  return browser.withLock(async () => {
    return browser.withRecovery("Clicking and capturing the CourtListener opinion", async (cdp, attempt) => {
      const { targetId, sessionId } = await browser.attachTab(cdp, tab, signal);
      await cdp.send("Target.activateTarget", { targetId });
      let state: PageState;
      if (attempt > 1) {
        onStatus?.("Reconnected to the CourtListener tab; reloading its current rendered page before retrying the save.");
        state = await reloadAfterReconnect(cdp, targetId, sessionId, tab, signal, onStatus);
      } else {
        state = await readPageState(cdp, sessionId);
      }
      state = await handleVerification(cdp, targetId, sessionId, state, signal, onStatus);
      if (state.blocked) throw blockedError();
      const currentClusterId = (() => {
        try { return new URL(state.href).pathname.match(/^\/opinion\/(\d+)\//)?.[1]; }
        catch { return undefined; }
      })();
      let page: CapturedPage;
      if (currentClusterId === clusterId) {
        onStatus?.("The CourtListener opinion navigation completed before the timeout; resuming capture without clicking again.");
        page = await capturePage(cdp, targetId, sessionId, tab, "opinion", undefined, signal, onStatus);
      } else {
        if (!state.results) {
          throw new ResultLinkUnavailableError(`The CourtListener tab no longer shows the result page containing cluster ${clusterId}.`);
        }
        await browser.pauseBeforeClick(signal);
        const previousHref = state.href;
        const clicked = await cdp.eval<boolean>(sessionId, `(() => {
          const wanted = ${JSON.stringify(clusterId)};
          const links = Array.from(document.querySelectorAll('#search-results > article a.visitable[href*="/opinion/"]'));
          const link = links.find((candidate) => {
            const match = candidate.getAttribute('href') && candidate.getAttribute('href').match(/\\/opinion\\/(\\d+)\\//);
            return match && match[1] === wanted;
          });
          if (!link) return false;
          link.scrollIntoView({ block: 'center', behavior: 'instant' });
          link.removeAttribute('target');
          link.click();
          return true;
        })()`);
        if (!clicked) {
          throw new ResultLinkUnavailableError(`Could not find cluster ${clusterId}'s rendered title link on the current result page.`);
        }
        page = await capturePage(cdp, targetId, sessionId, tab, "opinion", previousHref, signal, onStatus);
      }
      await browser.pauseForOpinionDwell(signal);
      page.html = await cdp.eval<string>(sessionId, "document.documentElement.outerHTML");
      return page;
    }, signal, onStatus);
  }, signal);
}

function browserBackToResults(tab: TabRef, signal?: AbortSignal, onStatus?: StatusCallback): Promise<CapturedPage> {
  return browser.withLock(async () => {
    return browser.withRecovery("Returning to the CourtListener results", async (cdp, attempt) => {
      const { targetId, sessionId } = await browser.attachTab(cdp, tab, signal);
      await cdp.send("Target.activateTarget", { targetId });
      let state: PageState;
      if (attempt > 1) {
        onStatus?.("Reconnected to the CourtListener tab; reloading it before restoring the results page.");
        state = await reloadAfterReconnect(cdp, targetId, sessionId, tab, signal, onStatus);
      } else {
        state = await readPageState(cdp, sessionId);
      }
      if (state.results) {
        const html = await cdp.eval<string>(sessionId, "document.documentElement.outerHTML");
        return { html, tab, state };
      }
      state = await handleVerification(cdp, targetId, sessionId, state, signal, onStatus);
      const previousHref = state.href;
      const history = await cdp.send("Page.getNavigationHistory", {}, sessionId);
      const priorEntry = history.entries?.[history.currentIndex - 1];
      if (!priorEntry) throw new Error("The CourtListener result page is unavailable in this tab's Back history.");
      await browser.pauseBeforeBack(signal);
      await cdp.send("Page.navigateToHistoryEntry", { entryId: priorEntry.id }, sessionId);
      return capturePage(cdp, targetId, sessionId, tab, "results", previousHref, signal, onStatus);
    }, signal, onStatus);
  }, signal);
}

export function browserClickNextResultsPage(tab: TabRef, signal?: AbortSignal, onStatus?: StatusCallback, bridge = browser): Promise<CapturedPage> {
  return bridge.withLock(async () => {
    const cdp = await bridge.connect(signal);
    try {
      const { targetId, sessionId } = await bridge.attachTab(cdp, tab, signal);
      await cdp.send("Target.activateTarget", { targetId });
      await bridge.pauseBeforeClick(signal);
      const previousHref = await cdp.eval<string>(sessionId, "location.href");
      const clicked = await cdp.eval<boolean>(sessionId, `(() => {
        const link = document.querySelector('#search-results a[rel="next"]');
        if (!link) return false;
        link.scrollIntoView({ block: 'center', behavior: 'instant' });
        link.removeAttribute('target');
        link.click();
        return true;
      })()`);
      if (!clicked) throw new ResultLinkUnavailableError("CourtListener's rendered Next result-page link was unavailable.");
      return await capturePage(cdp, targetId, sessionId, tab, "results", previousHref, signal, onStatus);
    } finally {
      cdp.close();
    }
  }, signal);
}

/** Find the idle agent tab whose rendered results contain the cluster link, and lease it. */
function leaseResultTab(clusterId: string, signal?: AbortSignal, onStatus?: StatusCallback): Promise<TabRef> {
  return browser.withLock(async () => {
    return browser.withRecovery("Finding the rendered CourtListener result link", async (cdp, attempt) => {
      const remembered = clusterTabs().get(clusterId);
      const rememberedIdle = remembered && !browser.isLeased(remembered.targetId) ? remembered : undefined;
      const discovered = rememberedIdle ? [] : await browser.discoverAgentTabs(cdp, signal);
      const tabs = [
        ...(rememberedIdle ? [rememberedIdle] : []),
        ...browser.idleTabsNewestFirst(discovered.filter((tab) => tab.targetId !== remembered?.targetId)),
      ];
      for (const tab of tabs) {
        throwIfAborted(signal);
        let sessionId: string | undefined;
        try {
          ({ sessionId } = await browser.attachTab(cdp, tab, signal));
          if (attempt > 1 && tab.targetId === remembered?.targetId) {
            onStatus?.("Reconnected to the CourtListener results tab; reloading it before retrying the rendered link.");
            await cdp.send("Page.reload", {}, sessionId);
            await capturePage(cdp, tab.targetId, sessionId, tab, "results", undefined, signal, onStatus);
          }
          const containsLink = await cdp.eval<boolean>(sessionId, `(() => {
            const wanted = ${JSON.stringify(clusterId)};
            return Array.from(document.querySelectorAll('#search-results > article a.visitable[href*="/opinion/"]'))
              .some((candidate) => {
                const match = candidate.getAttribute('href') && candidate.getAttribute('href').match(/\\/opinion\\/(\\d+)\\//);
                return match && match[1] === wanted;
              });
          })()`);
          if (containsLink) {
            rememberClusterTab(clusterId, tab);
            browser.acquireTabLease(tab);
            return tab;
          }
        } catch (error) {
          throwIfAborted(signal);
          if (isTransientBrowserFailure(error)) throw error;
          // Tabs can be closed or changed while they are inspected; try the next one.
        } finally {
          if (sessionId) {
            try { await cdp.send("Target.detachFromTarget", { sessionId }); } catch {}
          }
        }
      }
      throw new ResultLinkUnavailableError(
        `No open CourtListener results tab contains cluster ${clusterId}. Run the search or direct_download find again, then retry.`,
      );
    }, signal, onStatus);
  }, signal);
}

// ---------------------------------------------------------------------------
// HTML parsing, operating on the captured page HTML
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return normalizeWhitespace(stripHtml(html));
}

function absoluteCourtListenerUrl(url: string): string {
  try { return new URL(decodeHtmlEntities(url), BASE).href; }
  catch { return ""; }
}

export interface CourtListenerSearchResult {
  title: string;
  url: string;
  clusterId?: string;
  court?: string;
  year?: string;
  dateFiled?: string;
  status?: string;
  citations: string[];
  docketNumber?: string;
  citedBy?: number;
  /** The cites_id, which can differ from cluster_id. */
  citesId?: string;
  snippet: string;
}

function extractMetaValue(block: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<span[^>]*class=["'][^"']*meta-data-header[^"']*["'][^>]*>\\s*${escaped}\\s*<\\/span>` +
      `\\s*<(?:span|time)[^>]*class=["'][^"']*meta-data-value[^"']*["'][^>]*>([\\s\\S]*?)<\\/(?:span|time)>`,
    "i",
  );
  const match = block.match(pattern);
  return match ? stripTags(match[1]) : undefined;
}

export function parseCourtListenerResults(html: string): CourtListenerSearchResult[] {
  const results: CourtListenerSearchResult[] = [];
  const rootStart = html.search(/<div[^>]*\bid=["']search-results["'][^>]*>/i);
  const source = rootStart >= 0 ? html.slice(rootStart) : html;
  const blocks = [...source.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map((match) => match[1]);
  for (const block of blocks) {
    const link = block.match(/<a\b[^>]*href=["']([^"']*\/opinion\/(\d+)\/[^"']*)["'][^>]*class=["'][^"']*\bvisitable\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<a\b[^>]*class=["'][^"']*\bvisitable\b[^"']*["'][^>]*href=["']([^"']*\/opinion\/(\d+)\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let displayTitle = stripTags(link[3]);
    let court: string | undefined;
    let year: string | undefined;
    const parenthetical = displayTitle.match(/\s*\(([^()]*)\)\s*$/);
    if (parenthetical) {
      const inside = parenthetical[1].trim();
      const yearMatch = inside.match(/^(.*?)(\d{4})$/);
      if (yearMatch) {
        court = yearMatch[1].trim() || undefined;
        year = yearMatch[2];
      } else {
        court = inside || undefined;
      }
      displayTitle = displayTitle.slice(0, parenthetical.index).trim();
    }
    const dateMatch = block.match(/<time\b[^>]*\bdatetime=["']([^"']+)["'][^>]*>/i);
    const citedLink = block.match(/<a\b[^>]*href=["'][^"']*q=cites(?:%3A|:)(?:%28|\()?(\d+)(?:%29|\))?[^"']*["'][^>]*>([\s\S]*?Cited[\s\S]*?)<\/a>/i);
    const citedText = citedLink ? stripTags(citedLink[2]) : "";
    const citedCount = citedText.match(/Cited\s+by\s+([\d,]+)/i);
    const citations = (extractMetaValue(block, "Citations:") ?? "")
      .split(/\s*,\s*/)
      .map((citation) => citation.trim())
      .filter(Boolean);
    const snippetMatch = block.match(/<p\b[^>]*class=["'][^"']*\brepresentation\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    results.push({
      title: displayTitle,
      url: absoluteCourtListenerUrl(link[1]),
      clusterId: link[2],
      court,
      year,
      dateFiled: dateMatch?.[1],
      status: extractMetaValue(block, "Status:"),
      citations,
      docketNumber: extractMetaValue(block, "Docket Number:"),
      citedBy: citedCount ? Number(citedCount[1].replace(/,/g, "")) : undefined,
      citesId: citedLink?.[1],
      snippet: snippetMatch ? stripTags(snippetMatch[1]) : "",
    });
  }
  return results;
}

function parseCapturedResults(page: CapturedPage): CourtListenerSearchResult[] {
  const results = parseCourtListenerResults(page.html);
  if (results.length !== page.state.resultCards) {
    throw new Error(
      `CourtListener rendered ${page.state.resultCards} result card${page.state.resultCards === 1 ? "" : "s"}, ` +
        `but ${results.length} could be parsed. The page layout may have changed; refusing incomplete results.`,
    );
  }
  if (!results.length && !page.state.noResults) {
    throw new Error("CourtListener returned no recognizable results and no no-results marker.");
  }
  for (const result of results) {
    if (result.clusterId) rememberClusterTab(result.clusterId, page.tab);
  }
  return results;
}

export interface CourtListenerOpinion {
  title: string;
  court: string;
  dateFiled: string;
  citations: string[];
  docketNumber: string;
  judges: string;
  text: string;
}

export function extractCourtListenerOpinion(html: string): CourtListenerOpinion | undefined {
  const article = html.match(/<div\b[^>]*class=["'][^"']*\bmain-document\b[^"']*["'][^>]*>[\s\S]*?<article\b[^>]*>([\s\S]*?)<\/article>/i)
    ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (!article) return undefined;
  const caption = html.match(/<h1\b[^>]*\bid=["']caption["'][^>]*>([\s\S]*?)<\/h1>/i);
  const court = html.match(/<h4\b[^>]*class=["'][^"']*\bcase-court\b[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i);
  const date = html.match(/<span\b[^>]*class=["'][^"']*\bcase-date-new\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  const details = (label: string): string => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = html.match(new RegExp(`<li>\\s*<strong>\\s*${escaped}\\s*<\\/strong>([\\s\\S]*?)<\\/li>`, "i"));
    return match ? stripTags(match[1]).replace(/^\s*:\s*/, "") : "";
  };
  return {
    title: caption ? stripTags(caption[1]) : "CourtListener Opinion",
    court: court ? stripTags(court[1]) : "",
    dateFiled: date ? stripTags(date[1]) : "",
    citations: details("Citations:").split(/\s*,\s*/).filter(Boolean),
    docketNumber: details("Docket Number:"),
    judges: details("Judges:"),
    text: stripHtml(article[1]),
  };
}

function saveOpinionHtml(html: string, clusterId: string, saveDir: string): { savedPath: string; data: CourtListenerOpinion } {
  const data = extractCourtListenerOpinion(html);
  if (!data || !data.text) throw new Error(`No rendered opinion text was found for cluster ${clusterId}.`);
  ensureDirectory(saveDir);
  const savedPath = saveOpinionCapture(join(saveDir, `${slugify(data.title) || "case"}-${clusterId}.html`), html);
  return { savedPath, data };
}

// ---------------------------------------------------------------------------
// Search URL construction
// ---------------------------------------------------------------------------

const STATUS_FIELDS: Record<string, string> = {
  published: "stat_Published",
  unpublished: "stat_Unpublished",
  errata: "stat_Errata",
  separate: "stat_Separate",
  "in-chambers": "stat_In-chambers",
  "relating-to": "stat_Relating-to",
  unknown: "stat_Unknown",
};
const COURT_ALIASES: Record<string, string> = {
  scotus: "scotus",
  "us supreme court": "scotus",
  "u s supreme court": "scotus",
  "supreme court": "scotus",
  "1st circuit": "ca1",
  "2nd circuit": "ca2",
  "3rd circuit": "ca3",
  "4th circuit": "ca4",
  "5th circuit": "ca5",
  "6th circuit": "ca6",
  "7th circuit": "ca7",
  "8th circuit": "ca8",
  "9th circuit": "ca9",
  "10th circuit": "ca10",
  "11th circuit": "ca11",
  "dc circuit": "cadc",
  "federal circuit": "cafc",
};

export function normalizeCourtListenerCourtIds(spec: string | undefined): string[] {
  if (!spec) return [];
  const ids: string[] = [];
  for (const raw of spec.split(",")) {
    const cleaned = raw.trim().replace(/\./g, "").replace(/\s+/g, " ");
    if (!cleaned) continue;
    const id = COURT_ALIASES[cleaned.toLowerCase()] ?? cleaned;
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(id)) {
      throw new Error(`Unknown court value "${raw.trim()}". Use a CourtListener court ID such as scotus, ca9, nysd, or ny.`);
    }
    ids.push(id);
  }
  return [...new Set(ids)];
}

function normalizeDate(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) return trimmed;
  throw new Error(`${label} must use YYYY-MM-DD or MM/DD/YYYY.`);
}

export interface CourtListenerSearchRequest {
  query?: string;
  /** A numeric cites_id: list later opinions citing it instead of running a query. */
  cites?: string;
  /** Comma-separated CourtListener court IDs or common federal aliases. */
  courts?: string;
  /** Comma-separated statuses; CourtListener defaults to Published only when omitted. */
  statuses?: string;
  filedAfter?: string;
  filedBefore?: string;
  /** One-based result page. */
  page: number;
  /** Reuse the tab remembered under this key when it sits on the preceding page. */
  navigationSession?: string;
}

export function buildCourtListenerSearchPath(request: Omit<CourtListenerSearchRequest, "navigationSession">): string {
  const query = request.cites ? `cites:(${request.cites})` : request.query?.trim();
  if (!query) throw new Error("Provide query or cites.");
  if (request.cites && !/^\d+$/.test(request.cites)) throw new Error("cites must be a numeric cites_id.");
  const params = new URLSearchParams({ q: query, type: "o" });
  appendCourtListenerCourts(params, normalizeCourtListenerCourtIds(request.courts));
  if (request.statuses) {
    for (const status of request.statuses.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)) {
      const field = STATUS_FIELDS[status];
      if (!field) {
        throw new Error(`Unknown status "${status}". Use published, unpublished, errata, separate, in-chambers, relating-to, or unknown.`);
      }
      params.set(field, "on");
    }
  }
  const after = normalizeDate(request.filedAfter, "filed_after");
  const before = normalizeDate(request.filedBefore, "filed_before");
  if (after) params.set("filed_after", after);
  if (before) params.set("filed_before", before);
  if (request.page > 1) params.set("page", String(request.page));
  return `/?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Public provider operations
// ---------------------------------------------------------------------------

export interface CourtListenerPageResponse {
  results: CourtListenerSearchResult[];
  reachedEnd: boolean;
  lastPage: number;
  resultCountText: string;
  timingMode: string;
}

/**
 * Load exactly one CourtListener result page. A remembered navigation session
 * whose tab sits on the preceding page is advanced with one rendered Next
 * click, and one sitting on the requested page is re-read in place; otherwise
 * page 1 is opened through the search form and Next is clicked once per
 * intervening page.
 */
export async function searchCourtListenerPage(
  request: CourtListenerSearchRequest,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<any>,
): Promise<CourtListenerPageResponse> {
  const query = request.query?.trim();
  const cites = request.cites?.trim();
  if (!query && !cites) throw new Error("Provide query or cites.");
  if (query && cites) throw new Error("Provide query or cites, not both.");
  if (!Number.isInteger(request.page) || request.page < 1) throw new Error("page must be a positive integer.");
  const normalized = { ...request, query, cites };
  // Validate every option before opening a tab.
  buildCourtListenerSearchPath(normalized);
  const sessionKey = request.navigationSession?.trim() || undefined;
  const progress = (message: string, details: Record<string, unknown> = {}, status?: "running" | "waiting") =>
    browser.emitProgress(onUpdate, message, { page: request.page, ...details }, status);
  const reportBrowserStatus: StatusCallback = (message) => progress(
    message,
    { phase: /cleared/i.test(message) ? "loading_results" : "verification" },
    /cleared/i.test(message) ? "running" : "waiting",
  );

  progress(`Starting CourtListener search, result page ${request.page}.`, { phase: "starting" });
  let tab: TabRef | undefined;
  try {
    let fetched: CapturedPage | undefined;
    let reachedEndEarly = false;
    const prior = sessionKey ? browser.getNavigationSession(sessionKey) : undefined;
    if (prior && (prior.page === request.page || prior.page + 1 === request.page)) {
      browser.acquireTabLease(prior.tab);
      tab = prior.tab;
      try {
        if (prior.page === request.page) {
          progress(`Re-reading the open CourtListener results tab already on page ${request.page}.`, { phase: "reusing_results_tab" });
          fetched = await browserReadCurrentResults(prior.tab, signal);
        } else {
          progress(`Clicking CourtListener Next on the open results tab for page ${request.page}.`, { phase: "clicking_next_page" });
          fetched = await browserClickNextResultsPage(prior.tab, signal, reportBrowserStatus);
        }
      } catch (error) {
        throwIfAborted(signal);
        if (isTransientBrowserFailure(error)) throw error;
        fetched = undefined;
      }
      if (!fetched) {
        browser.releaseTabLease(prior.tab);
        if (sessionKey) browser.forgetNavigationSession(sessionKey);
        tab = undefined;
        progress("The remembered CourtListener results tab could not be reused; opening the search again from page 1.", { phase: "starting" });
      }
    }
    if (!fetched) {
      fetched = await browserFetch(buildCourtListenerSearchPath({ ...normalized, page: 1 }), "results", !!query, signal, reportBrowserStatus);
      tab = fetched.tab;
      for (let restored = 1; restored < request.page; restored += 1) {
        if (!fetched.state.hasNext) {
          reachedEndEarly = true;
          break;
        }
        progress(`Clicking CourtListener Next to restore result page ${restored + 1}.`, { phase: "clicking_next_page", restoredPage: restored + 1 });
        fetched = await browserClickNextResultsPage(tab, signal, reportBrowserStatus);
      }
    }
    if (reachedEndEarly) {
      // The requested page lies beyond the exposed result pages.
      if (sessionKey) browser.forgetNavigationSession(sessionKey);
      progress(`CourtListener exposes fewer than ${request.page} result pages for this query.`, { phase: "completed", pageResults: 0 }, "running");
      return { results: [], reachedEnd: true, lastPage: request.page, resultCountText: fetched.state.resultCountText, timingMode: browser.timingMode };
    }
    const results = parseCapturedResults(fetched);
    if (sessionKey && tab) browser.rememberNavigationSession(sessionKey, { tab, page: request.page });
    progress(`Loaded CourtListener page ${request.page}: ${results.length} result${results.length === 1 ? "" : "s"}.`, {
      phase: "completed",
      pageResults: results.length,
    }, "running");
    return {
      results,
      reachedEnd: !fetched.state.hasNext || results.length === 0,
      lastPage: request.page,
      resultCountText: fetched.state.resultCountText,
      timingMode: browser.timingMode,
    };
  } catch (error) {
    if (sessionKey) browser.forgetNavigationSession(sessionKey);
    throw error;
  } finally {
    browser.releaseTabLease(tab);
  }
}

/**
 * Click an exact opinion link in the open CourtListener results tab that
 * renders it, save the rendered opinion HTML, and return to the results with
 * Back. A saved opinion is returned even when the results tab could not be
 * restored; that condition is reported instead of failing the save.
 */
export async function clickCourtListenerResult(
  url: string,
  saveDir: string,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<any>,
): Promise<SavedOpinionCapture> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("url must be a valid CourtListener opinion URL.");
  }
  const clusterId = parsed.pathname.match(/^\/opinion\/(\d+)\//)?.[1] ?? "";
  if (parsed.protocol !== "https:" || !isCourtListenerUrl(url) || !/^\d+$/.test(clusterId)) {
    throw new Error("url must be an HTTPS CourtListener /opinion/<numeric-id>/ link.");
  }
  if (!saveDir.trim()) throw new Error("save_dir must not be empty.");

  browser.emitProgress(onUpdate, `Finding CourtListener result link for cluster ${clusterId}.`, {
    phase: "finding_result_link",
    clusterId,
    url,
  });
  const tab = await leaseResultTab(
    clusterId,
    signal,
    (message) => browser.emitProgress(onUpdate, message, { phase: "recovering_browser", clusterId }),
  );
  let visitedCasePage = false;
  let restorationAttempted = false;
  try {
    const page = await browserClickCaseResult(
      tab,
      clusterId,
      signal,
      (message) => browser.emitProgress(onUpdate, message, { phase: "clicking_result_link", clusterId }),
    );
    visitedCasePage = true;
    const clickedClusterId = new URL(page.state.href).pathname.match(/^\/opinion\/(\d+)\//)?.[1];
    if (clickedClusterId !== clusterId) {
      throw new Error(`The clicked CourtListener link opened cluster ${clickedClusterId ?? "unknown"}, not cluster ${clusterId}.`);
    }
    const saved = saveOpinionHtml(page.html, clusterId, saveDir);
    browser.emitProgress(onUpdate, `Returning to CourtListener results after saving cluster ${clusterId}.`, {
      phase: "returning_to_results",
      clusterId,
      savedPath: saved.savedPath,
    });
    restorationAttempted = true;
    let restorationError: string | undefined;
    try {
      await browserBackToResults(
        tab,
        signal,
        (message) => browser.emitProgress(onUpdate, message, { phase: "returning_to_results", clusterId }),
      );
      visitedCasePage = false;
    } catch (error) {
      restorationError = error instanceof Error ? error.message : String(error);
      browser.emitProgress(onUpdate, `The opinion was saved, but the CourtListener results tab could not be restored: ${restorationError}`, {
        phase: "results_restore_failed",
        clusterId,
        savedPath: saved.savedPath,
        error: restorationError,
      });
    }
    browser.emitProgress(onUpdate, `Clicked and saved CourtListener cluster ${clusterId}.`, {
      phase: "completed",
      clusterId,
      savedPath: saved.savedPath,
      sourceUrl: page.state.href,
      returnedToResults: !restorationError,
      restorationError,
    }, "completed");
    return {
      title: saved.data.title,
      savedPath: saved.savedPath,
      sourceUrl: page.state.href,
      textLength: saved.data.text.length,
      returnedToResults: !restorationError,
      restorationError,
    };
  } finally {
    try {
      if (visitedCasePage && !restorationAttempted) {
        browser.emitProgress(onUpdate, `Restoring CourtListener results after the cluster ${clusterId} attempt.`, {
          phase: "returning_to_results",
          clusterId,
        });
        try {
          await browserBackToResults(
            tab,
            signal,
            (message) => browser.emitProgress(onUpdate, message, { phase: "returning_to_results", clusterId }),
          );
        } catch (cleanupError) {
          if (signal?.aborted) throw cleanupError;
          browser.emitProgress(onUpdate, `Could not restore the CourtListener results tab after the failed save attempt: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`, {
            phase: "results_restore_failed",
            clusterId,
          });
        }
      }
    } finally {
      browser.releaseTabLease(tab);
    }
  }
}

/** Open or focus the shared visible browser window at a CourtListener URL (default: home). */
export async function openCourtListenerBrowser(
  url: string | undefined,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<any>,
): Promise<{ url: string; timingMode: string }> {
  if (url && !isCourtListenerUrl(url)) throw new Error("url must be an http(s) URL on courtlistener.com.");
  browser.emitProgress(onUpdate, "Opening the shared CourtListener browser.", { phase: "opening_browser", requestedUrl: url });
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    let tab: TabRef | undefined;
    try {
      const existing = await browser.newestIdleTab(cdp, signal);
      const opened = await browser.openTab(cdp, existing, signal);
      tab = opened.tab;
      browser.acquireTabLease(tab);
      const current = await cdp.eval<string>(opened.sessionId, "location.href");
      const destination = url ?? (isCourtListenerUrl(current) ? current : BASE);
      if (current !== destination) await cdp.send("Page.navigate", { url: destination }, opened.sessionId);
      await abortableDelay(500, signal);
      await cdp.send("Target.activateTarget", { targetId: opened.targetId });
      browser.emitProgress(onUpdate, `CourtListener browser is ready at ${destination}.`, { phase: "completed", url: destination }, "completed");
      return { url: destination, timingMode: browser.timingMode };
    } finally {
      browser.releaseTabLease(tab);
      cdp.close();
    }
  }, signal);
}
