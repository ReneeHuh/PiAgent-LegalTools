// Google Scholar case-law provider: rendered search pages, result-title clicks,
// and opinion capture in the shared visible browser window.
//
// Every operation is single-page. Page 1 is reached through Scholar's own
// search form (or the constructed cites URL for cited-by lookups); later pages
// are reached only by clicking the rendered Next link. Opinions are opened by
// clicking their rendered title and the results page is restored with Back.
import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { restoreSavedCapture, saveOpinionCapture } from "./library.ts";
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
import {
  decodeHtmlEntities,
  ensureDirectory,
  extractOpinionText,
  normalizeWhitespace,
  slugify,
  stripHtml,
} from "./core.ts";
import { SCHOLAR_FEDERAL_APPELLATE_CODES, SCHOLAR_FEDERAL_DISTRICT_CODES } from "./jurisdiction-codes.ts";

const BASE = "https://scholar.google.com";
export const SCHOLAR_PAGE_SIZE = 20;
export const SCHOLAR_MAX_PAGE = 50;

// as_sdt=2006 is US case law across all federal and state courts. A specific
// court search uses as_sdt=4,<codes>, verified live against Scholar's picker.
const ALL_CASE_LAW_CORPUS = "2006";

export function isScholarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (/^https?:$/.test(parsed.protocol) && parsed.hostname === "scholar.google.com") return true;
    return (
      /^https?:$/.test(parsed.protocol) &&
      (parsed.hostname === "google.com" || parsed.hostname.endsWith(".google.com")) &&
      parsed.pathname.startsWith("/sorry/") &&
      parsed.href.includes("scholar.google.com")
    );
  } catch {
    return false;
  }
}

const browser = new ProviderBrowser({
  name: "Google Scholar",
  base: BASE,
  launchUrl: `${BASE}/?hl=en`,
  tabNamePrefix: "pi-scholar:",
  isProviderUrl: isScholarUrl,
});

// ---------------------------------------------------------------------------
// Court codes scraped from Scholar's own picker (scholar_courts, 2026-08-15).
// ---------------------------------------------------------------------------

const STATE_CODES: Record<string, number> = {
  alabama: 1, alaska: 2, arizona: 3, arkansas: 4, california: 5, colorado: 6,
  connecticut: 7, delaware: 8, "district of columbia": 9, florida: 10,
  georgia: 11, hawaii: 12, idaho: 13, illinois: 14, indiana: 15, iowa: 16,
  kansas: 17, kentucky: 18, louisiana: 19, maine: 20, maryland: 21,
  massachusetts: 22, michigan: 23, minnesota: 24, mississippi: 25, missouri: 26,
  montana: 27, nebraska: 28, nevada: 29, "new hampshire": 30, "new jersey": 31,
  "new mexico": 32, "new york": 33, "north carolina": 34, "north dakota": 35,
  ohio: 36, oklahoma: 37, oregon: 38, pennsylvania: 39, "rhode island": 40,
  "south carolina": 41, "south dakota": 42, tennessee: 43, texas: 44, utah: 45,
  vermont: 46, virginia: 47, washington: 48, "west virginia": 49, wisconsin: 50,
  wyoming: 51,
};
const STATE_ABBR: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", dc: "district of columbia",
  fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois",
  in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
  me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan",
  mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana",
  ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey",
  nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota",
  oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee",
  tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};
// Circuit groups here are Scholar's broad group (court of appeals + district +
// bankruptcy courts). The unified extension passes an exact appellate alias
// from SCHOLAR_FEDERAL_APPELLATE_CODES instead; these remain for the "all
// courts in the circuit" vocabulary and for tax/claims courts.
const FEDERAL_CODES: Record<string, string> = {
  "us supreme court": "60",
  "1st circuit": "119,105,145,147,152,157,158,82,84,89,94,95,379",
  "2nd circuit": "122,107,138,162,349,350,351,352,75,99,286,287,288,289,380",
  "3rd circuit": "123,108,139,153,163,361,362,363,76,90,100,298,299,300",
  "4th circuit": "124,109,146,159,353,354,355,371,372,375,376,83,96,290,291,292,308,309,312,313",
  "5th circuit": "125,110,340,341,342,345,346,367,368,369,370,277,278,279,282,283,304,305,306,307",
  "6th circuit": "126,111,338,339,343,344,356,357,364,365,366,275,276,280,281,293,294,301,302,303,381",
  "7th circuit": "127,112,331,332,333,334,335,377,378,268,269,270,271,272,314,315",
  "8th circuit": "128,113,148,150,155,160,319,320,336,337,347,348,85,87,92,97,256,257,273,274,284,285,382",
  "9th circuit": "129,114,134,135,141,142,143,149,151,156,321,322,323,324,373,374,72,73,78,79,80,86,88,93,258,259,260,261,310,311,383",
  "10th circuit": "120,106,137,144,154,161,164,358,359,360,74,81,91,98,101,295,296,297,384",
  "11th circuit": "121,316,317,318,325,326,327,328,329,330,253,254,255,262,263,264,265,266,267",
  "dc circuit": "130,140,77",
  "federal circuit": "131",
  "tax court": "192",
  "court of claims": "188",
};
const ORDINALS: Record<string, string> = {
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th",
  sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
  eleventh: "11th",
};

/** "New York, 9th Circuit, SCOTUS" becomes "33,129,...,60". */
export function resolveScholarCourts(spec: string): string {
  const codes: string[] = [];
  for (const raw of spec.split(",")) {
    let n = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!n) continue;
    n = n.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh)\b/, (w) => ORDINALS[w]);
    n = n.replace(/\bcir\b/, "circuit");
    if (/^(scotus|us supreme(?: court)?|united states supreme(?: court)?|supreme(?: court)?)$/.test(n)) n = "us supreme court";
    if (/^(\d+(?:st|nd|rd|th)|dc|federal) circuit$/.test(n) === false && /^\d+(st|nd|rd|th)$/.test(n)) n = `${n} circuit`;
    if (STATE_ABBR[n]) n = STATE_ABBR[n];
    let code = SCHOLAR_FEDERAL_APPELLATE_CODES[n]
      ?? SCHOLAR_FEDERAL_DISTRICT_CODES[n]
      ?? FEDERAL_CODES[n]
      ?? STATE_CODES[n];
    if (code === undefined) {
      n = n.replace(/\s+courts?$/, "").trim();
      if (/^(scotus|us supreme|united states supreme|supreme)$/.test(n)) n = "us supreme court";
      if (STATE_ABBR[n]) n = STATE_ABBR[n];
      code = SCHOLAR_FEDERAL_APPELLATE_CODES[n]
        ?? SCHOLAR_FEDERAL_DISTRICT_CODES[n]
        ?? FEDERAL_CODES[n]
        ?? STATE_CODES[n];
    }
    if (code === undefined) {
      throw new Error(
        `Unknown court "${raw.trim()}". Use a state name (or 2-letter abbreviation), ` +
          `"1st circuit" through "11th circuit", "dc circuit", "federal circuit", "us supreme court", ` +
          `"tax court", or "court of claims".`,
      );
    }
    codes.push(String(code));
  }
  if (codes.length === 0) throw new Error("courts was empty.");
  return codes.join(",");
}

// ---------------------------------------------------------------------------
// Page state probing
// ---------------------------------------------------------------------------

type PageState = {
  ready: string;
  href: string;
  title: string;
  searchBox: boolean;
  results: boolean;
  resultCards: number;
  hasNext: boolean;
  opinion: boolean;
  alert: boolean;
  noResults: boolean;
  captcha: boolean;
  traffic: boolean;
};
type CapturedPage = { html: string; tab: TabRef; state: PageState };
type ExpectedPage = "any" | "results" | "opinion";

const PROBE = `(() => {
  const t = ((document.body && document.body.innerText) || "").slice(0, 4000);
  const searchBox = !!document.querySelector('#gs_hdr_tsi');
  const results = !!document.querySelector("#gs_res_ccl_mid");
  const opinion = !!document.querySelector("#gs_opinion");
  const captcha = !!document.querySelector('#gs_captcha, #recaptcha, iframe[src*="recaptcha"]');
  return {
    ready: document.readyState,
    href: location.href,
    title: document.title,
    searchBox,
    results,
    resultCards: document.querySelectorAll("#gs_res_ccl_mid .gs_r.gs_or.gs_scl").length,
    hasNext: !!document.querySelector('.gs_ico_nav_next')?.closest('a'),
    opinion,
    alert: !!document.querySelector(".gs_alrt"),
    noResults: /(?:did not match any (?:articles|results)|no (?:matching )?(?:articles|results)(?: were)? found)/i.test(t),
    captcha,
    traffic:
      (document.readyState === "interactive" || document.readyState === "complete") &&
      !captcha &&
      !searchBox &&
      !results &&
      !opinion &&
      /(?:our systems have detected unusual traffic|automated quer(?:y|ies))/i.test(t),
  };
})()`;

const CAPTCHA_MESSAGES = {
  detected: "CAPTCHA detected; waiting up to 120 seconds for the user to solve it. Browser steps switch to a cautious randomized 1.5–3.0 seconds after it clears.",
  detectedAgain: "CAPTCHA detected again; waiting up to 120 seconds for the user to solve it. Browser steps remain at a cautious randomized 1.5–3.0 seconds after it clears.",
  unsolved: "Google Scholar is showing a CAPTCHA in the open browser window. Ask the user to solve it there, then retry this tool.",
  cleared: "CAPTCHA cleared; continuing the Scholar request with cautious 1.5–3.0 second browser steps.",
};

function readPageState(cdp: Cdp, sessionId: string): Promise<PageState> {
  return cdp.eval<PageState>(sessionId, PROBE);
}

function matchesExpectedPage(state: PageState, expected: ExpectedPage, previousHref?: string): boolean {
  if (state.captcha || state.traffic) return true;
  if (previousHref && state.href === previousHref) return false;
  if (state.ready !== "interactive" && state.ready !== "complete") return false;
  if (state.alert || state.noResults) return true;
  if (expected === "results") return state.results;
  if (expected === "opinion") return state.opinion;
  return state.results || state.opinion;
}

async function waitForCaptcha(
  cdp: Cdp,
  targetId: string,
  sessionId: string,
  state: PageState,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<PageState> {
  return browser.waitForHumanChallenge(
    cdp,
    targetId,
    state,
    () => readPageState(cdp, sessionId),
    (current) => current.captcha,
    CAPTCHA_MESSAGES,
    signal,
    onStatus,
  );
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
      await abortableDelay(500, signal);
      current = await readPageState(cdp, sessionId);
      if (matchesExpectedPage(current, expected, previousHref)) return current;
    }
    return current;
  };

  let state = await waitMatched();
  if (!state) throw new TransientBrowserError("Page never loaded; is the browser window responsive?");
  try { await browser.markAgentTab(cdp, sessionId, tab.marker); } catch {}
  throwIfAborted(signal);

  if (state.captcha) {
    state = await waitForCaptcha(cdp, targetId, sessionId, state, signal, onStatus);
    if (!matchesExpectedPage(state, expected, previousHref)) state = (await waitMatched()) ?? state;
  }

  try { await browser.markAgentTab(cdp, sessionId, tab.marker); } catch {}
  throwIfAborted(signal);
  if (state.traffic) {
    throw new TransientBrowserError(
      "Google Scholar blocked this request (unusual-traffic page, no CAPTCHA offered). " +
        "Wait a few minutes and keep query volume low; the browser window stays open.",
    );
  }
  if (state.alert && !state.noResults && !state.results && !state.opinion) {
    throw new Error(
      "Google Scholar returned an alert page instead of the requested content. Inspect the open browser tab and retry.",
    );
  }
  if (!matchesExpectedPage(state, expected, previousHref)) {
    throw new TransientBrowserError(
      `Timed out waiting for the expected Scholar ${expected} page ` +
        `(url: ${state.href}, title: "${state.title}", readyState: ${state.ready}).`,
    );
  }
  if (!state.results && !state.opinion && !state.alert) {
    throw new Error(
      `Google Scholar returned an unrecognized page (url: ${state.href}, title: "${state.title}", ` +
        `readyState: ${state.ready}). Look at the open browser window to see what it is.`,
    );
  }

  const html = await cdp.eval<string>(sessionId, "document.documentElement.outerHTML");
  return { html, tab, state };
}

// Open Scholar's home page, visibly enter the query, preserve the requested
// filters as form fields, and submit the site's own search form.
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
  if (!query) throw new Error("A form-based Scholar search requires a query.");

  await cdp.send("Page.navigate", { url: `${BASE}/?hl=en` }, sessionId);
  await cdp.send("Target.activateTarget", { targetId });

  let state: PageState | undefined;
  let deadline = Date.now() + PAGE_WAIT_MS;
  while (Date.now() < deadline) {
    await abortableDelay(500, signal);
    state = await readPageState(cdp, sessionId);
    if (
      ((state.ready === "interactive" || state.ready === "complete") && state.searchBox) ||
      state.captcha ||
      state.traffic
    ) break;
  }
  if (!state) throw new TransientBrowserError("Google Scholar's home page did not load.");

  if (state.captcha) {
    state = await waitForCaptcha(cdp, targetId, sessionId, state, signal, onStatus);
    deadline = Date.now() + PAGE_WAIT_MS;
    while (
      Date.now() < deadline &&
      (!(state.ready === "interactive" || state.ready === "complete") || !state.searchBox)
    ) {
      await abortableDelay(500, signal);
      state = await readPageState(cdp, sessionId);
    }
  }
  if (state.traffic) {
    throw new TransientBrowserError(
      "Google Scholar blocked the home page (unusual traffic, no CAPTCHA offered). Wait a few minutes and retry.",
    );
  }
  if (!state.searchBox) throw new Error("Google Scholar's search field was not available on the home page.");

  const fields = Object.fromEntries(
    [...requested.searchParams.entries()].filter(([name]) => name !== "q" && name !== "start"),
  );
  const prepared = await cdp.eval<boolean>(sessionId, `(() => {
    const input = document.querySelector('#gs_hdr_tsi');
    const form = input && input.form;
    if (!input || !form) return false;
    input.value = '';
    const fields = ${JSON.stringify(fields)};
    for (const [name, value] of Object.entries(fields)) {
      let field = form.elements.namedItem(name);
      if (!field || !('value' in field)) {
        field = document.createElement('input');
        field.type = 'hidden';
        field.name = name;
        form.appendChild(field);
      }
      field.value = value;
    }
    input.focus();
    return true;
  })()`);
  if (!prepared) throw new Error("Could not prepare Google Scholar's search form.");

  await cdp.send("Input.insertText", { text: query }, sessionId);
  const submitted = await cdp.eval<boolean>(sessionId, `(() => {
    const input = document.querySelector('#gs_hdr_tsi');
    const form = input && input.form;
    if (!input || !form) return false;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const button = document.querySelector('#gs_hdr_tsb');
    if (button) button.click();
    else if (form.requestSubmit) form.requestSubmit();
    else form.submit();
    return true;
  })()`);
  if (!submitted) throw new Error("Could not submit Google Scholar's search form.");
}

// ---------------------------------------------------------------------------
// Browser operations (each serialized through the provider lock)
// ---------------------------------------------------------------------------

function expectedPageForPath(path: string): ExpectedPage {
  if (path.startsWith("/scholar_case?")) return "opinion";
  if (path.startsWith("/scholar?")) return "results";
  return "any";
}

/** Open a new agent tab at `path`, optionally through Scholar's search form. The returned tab is leased. */
function browserFetch(
  path: string,
  useSearchForm: boolean,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<CapturedPage> {
  return browser.withLock(async () => {
    const url = `${BASE}${path}`;
    await browser.pauseBeforeNavigation(signal);
    const cdp = await browser.connect(signal);
    try {
      const { tab, targetId, sessionId } = await browser.openTab(cdp, undefined, signal);
      if (useSearchForm) await submitSearchFromHome(cdp, targetId, sessionId, url, signal, onStatus);
      else await cdp.send("Page.navigate", { url }, sessionId);
      await cdp.send("Target.activateTarget", { targetId });
      const page = await capturePage(cdp, targetId, sessionId, tab, expectedPageForPath(path), undefined, signal, onStatus);
      browser.acquireTabLease(tab);
      return page;
    } finally {
      cdp.close(); // disconnect only; the user's browser window stays open
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
      if (!state.results || state.captcha || state.traffic) return undefined;
      const html = await cdp.eval<string>(sessionId, "document.documentElement.outerHTML");
      return { html, tab, state };
    } finally {
      cdp.close();
    }
  }, signal);
}

// Click the actual title link in Scholar's current result page. The link is
// forced into the same tab, but its href is never used for direct navigation.
function browserClickCaseResult(
  tab: TabRef,
  caseId: string,
  signal?: AbortSignal,
  onStatus?: StatusCallback,
): Promise<CapturedPage> {
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    try {
      const { targetId, sessionId } = await browser.attachTab(cdp, tab, signal);
      await cdp.send("Target.activateTarget", { targetId });
      await browser.pauseBeforeClick(signal);
      const previousHref = await cdp.eval<string>(sessionId, "location.href");
      const clicked = await cdp.eval<boolean>(sessionId, `(() => {
        const wanted = ${JSON.stringify(caseId)};
        const links = Array.from(document.querySelectorAll('#gs_res_ccl_mid .gs_rt a'));
        const link = links.find((candidate) => {
          try {
            return new URL(candidate.href, location.href).searchParams.get('case') === wanted;
          } catch {
            return false;
          }
        });
        if (!link) return false;
        link.scrollIntoView({ block: 'center', behavior: 'instant' });
        link.removeAttribute('target');
        link.click();
        return true;
      })()`);
      if (!clicked) {
        throw new ResultLinkUnavailableError(`Could not find the case ${caseId} title link on the current Scholar result page.`);
      }
      const page = await capturePage(cdp, targetId, sessionId, tab, "opinion", previousHref, signal, onStatus);
      await browser.pauseForOpinionDwell(signal);
      page.html = await cdp.eval<string>(sessionId, "document.documentElement.outerHTML");
      return page;
    } finally {
      cdp.close();
    }
  }, signal);
}

// Browser-history equivalent of pressing Back. This deliberately does not
// reconstruct or directly navigate to the result-page URL.
function browserBackToResults(tab: TabRef, signal?: AbortSignal, onStatus?: StatusCallback): Promise<CapturedPage> {
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    try {
      const { targetId, sessionId } = await browser.attachTab(cdp, tab, signal);
      await cdp.send("Target.activateTarget", { targetId });
      const previousHref = await cdp.eval<string>(sessionId, "location.href");
      const history = await cdp.send("Page.getNavigationHistory", {}, sessionId);
      const priorEntry = history.entries?.[history.currentIndex - 1];
      if (!priorEntry) throw new Error("The Scholar result page is not available in this tab's Back history.");
      await browser.pauseBeforeBack(signal);
      await cdp.send("Page.navigateToHistoryEntry", { entryId: priorEntry.id }, sessionId);
      return await capturePage(cdp, targetId, sessionId, tab, "results", previousHref, signal, onStatus);
    } finally {
      cdp.close();
    }
  }, signal);
}

// Click Scholar's rendered Next link from the current result page rather than
// constructing a URL with a start offset.
function browserClickNextResultsPage(tab: TabRef, signal?: AbortSignal, onStatus?: StatusCallback): Promise<CapturedPage> {
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    try {
      const { targetId, sessionId } = await browser.attachTab(cdp, tab, signal);
      await cdp.send("Target.activateTarget", { targetId });
      await browser.pauseBeforeClick(signal);
      const previousHref = await cdp.eval<string>(sessionId, "location.href");
      const clicked = await cdp.eval<boolean>(sessionId, `(() => {
        const icon = document.querySelector('.gs_ico_nav_next');
        const link = icon && icon.closest('a');
        if (!link) return false;
        link.scrollIntoView({ block: 'center', behavior: 'instant' });
        link.removeAttribute('target');
        link.click();
        return true;
      })()`);
      if (!clicked) throw new ResultLinkUnavailableError("Scholar's Next result-page link was not available.");
      return await capturePage(cdp, targetId, sessionId, tab, "results", previousHref, signal, onStatus);
    } finally {
      cdp.close();
    }
  }, signal);
}

/** Find the idle agent tab whose rendered results contain the case link, and lease it. */
function leaseResultTab(caseId: string, signal?: AbortSignal): Promise<TabRef> {
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    try {
      const tabs = browser.idleTabsNewestFirst(await browser.discoverAgentTabs(cdp, signal));
      for (const tab of tabs) {
        throwIfAborted(signal);
        let sessionId: string | undefined;
        try {
          ({ sessionId } = await browser.attachTab(cdp, tab, signal));
          const containsLink = await cdp.eval<boolean>(sessionId, `(() => {
            const wanted = ${JSON.stringify(caseId)};
            return Array.from(document.querySelectorAll('#gs_res_ccl_mid .gs_rt a')).some((candidate) => {
              try {
                return new URL(candidate.href, location.href).searchParams.get('case') === wanted;
              } catch {
                return false;
              }
            });
          })()`);
          if (containsLink) {
            browser.acquireTabLease(tab);
            return tab;
          }
        } catch {
          throwIfAborted(signal);
          // Tabs can be closed or changed while they are inspected; try the next one.
        } finally {
          if (sessionId) {
            try { await cdp.send("Target.detachFromTarget", { sessionId }); } catch {}
          }
        }
      }
    } finally {
      cdp.close();
    }
    throw new ResultLinkUnavailableError(
      `No open Google Scholar results tab contains case ${caseId}. Run the search or direct_download find again, then retry.`,
    );
  }, signal);
}

// ---------------------------------------------------------------------------
// HTML parsing, operating on the captured page HTML
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return normalizeWhitespace(stripHtml(html));
}

export interface ScholarSearchResult {
  title: string;
  url: string;
  caseId?: string;
  /** Reporter citations, court, and year as rendered: "410 US 113 - Supreme Court 1973". */
  meta: string;
  snippet: string;
  citedBy?: number;
  citesId?: string;
}

export function parseScholarResults(html: string): ScholarSearchResult[] {
  const results: ScholarSearchResult[] = [];
  const blocks = html.split(/<div class="gs_r gs_or gs_scl[^"]*"/).slice(1);
  for (const block of blocks) {
    const h3 = block.match(/<h3 class="gs_rt"[^>]*>([\s\S]*?)<\/h3>/);
    if (!h3) continue;
    const link = h3[1].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const title = stripTags(link ? link[2] : h3[1]);
    let url = link ? decodeHtmlEntities(link[1]) : "";
    if (url.startsWith("/")) url = BASE + url;
    const caseId = url.match(/scholar_case\?case=(\d+)/)?.[1];
    const meta = stripTags(block.match(/<div class="gs_a">([\s\S]*?)<\/div>/)?.[1] ?? "")
      .replace(/ - Google Scholar$/, "");
    const snippet = stripTags(block.match(/<div class="gs_rs">([\s\S]*?)<\/div>/)?.[1] ?? "");
    const cited = block.match(/<a[^>]*href="[^"]*\/scholar\?cites=(\d+)[^"]*"[^>]*>Cited by (\d+)<\/a>/);
    results.push({
      title,
      url,
      caseId,
      meta,
      snippet,
      citedBy: cited ? Number(cited[2]) : undefined,
      citesId: cited?.[1],
    });
  }
  return results;
}

function parseCapturedResults(page: CapturedPage): ScholarSearchResult[] {
  const results = parseScholarResults(page.html);
  if (results.length !== page.state.resultCards) {
    throw new Error(
      `Google Scholar rendered ${page.state.resultCards} result card` +
        `${page.state.resultCards === 1 ? "" : "s"}, but ${results.length} could be parsed. ` +
        "The page layout may have changed; refusing to return incomplete results.",
    );
  }
  if (results.length === 0 && !page.state.noResults) {
    throw new Error(
      "Google Scholar returned a results page with no recognizable result cards or no-results message. " +
        "The page may be incomplete or its layout may have changed.",
    );
  }
  return results;
}

/** Scholar's opinion <title> is "Name, Citation - Court Year". */
export function parseScholarOpinionTitle(title: string): { name: string; citation: string; court: string; year: string } {
  const dash = title.lastIndexOf(" - ");
  if (dash === -1) return { name: title, citation: "", court: "", year: "" };
  const left = title.slice(0, dash);
  const right = title.slice(dash + 3);
  const comma = left.lastIndexOf(", ");
  const name = comma === -1 ? left : left.slice(0, comma);
  const citation = comma === -1 ? "" : left.slice(comma + 2);
  const yearMatch = right.match(/^(.*?)\s*(\d{4})$/);
  return {
    name,
    citation,
    court: yearMatch ? yearMatch[1] : right,
    year: yearMatch ? yearMatch[2] : "",
  };
}

function saveOpinionHtml(html: string, caseId: string, saveDir: string): { savedPath: string; title: string } {
  ensureDirectory(saveDir);
  const title = decodeHtmlEntities(html.match(/<title>([^<]*?)(?: - Google Scholar)?<\/title>/)?.[1] ?? "");
  const savedPath = saveOpinionCapture(join(saveDir, `${slugify(title) || "case"}-${caseId}.html`), html);
  return { savedPath, title: parseScholarOpinionTitle(title).name || title };
}

// ---------------------------------------------------------------------------
// Public provider operations
// ---------------------------------------------------------------------------

export interface ScholarSearchRequest {
  query?: string;
  /** A Scholar case_id: list documents citing it instead of running a query. */
  cites?: string;
  /** Comma-separated court names accepted by resolveScholarCourts. */
  courts?: string;
  yearLo?: number;
  yearHi?: number;
  /** One-based result page (20 results each; Scholar exposes at most 50). */
  page: number;
  /** Reuse the tab remembered under this key when it sits on the preceding page. */
  navigationSession?: string;
}

export interface ScholarPageResponse {
  results: ScholarSearchResult[];
  /** Missing Next before page 50 ends exposed results; a full page 50 is capped. */
  reachedEnd: boolean;
  lastPage: number;
  timingMode: string;
}

export function scholarPageReachedEnd(page: number, resultCount: number, hasNext: boolean): boolean {
  if (page === SCHOLAR_MAX_PAGE && resultCount >= SCHOLAR_PAGE_SIZE) return false;
  return !hasNext;
}

function searchPath(request: ScholarSearchRequest): string {
  const q = new URLSearchParams({ hl: "en", as_sdt: request.courts ? `4,${resolveScholarCourts(request.courts)}` : ALL_CASE_LAW_CORPUS });
  if (request.query) q.set("q", request.query);
  if (request.cites) q.set("cites", request.cites);
  if (request.yearLo !== undefined) q.set("as_ylo", String(Math.floor(request.yearLo)));
  if (request.yearHi !== undefined) q.set("as_yhi", String(Math.floor(request.yearHi)));
  q.set("num", String(SCHOLAR_PAGE_SIZE));
  return `/scholar?${q.toString()}`;
}

/**
 * Load exactly one Scholar result page. A remembered navigation session whose
 * tab sits on the preceding page is advanced with one rendered Next click, and
 * one sitting on the requested page is re-read in place; otherwise page 1 is
 * opened through the search form and Next is clicked once per intervening page.
 */
export async function searchScholarPage(
  request: ScholarSearchRequest,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<any>,
): Promise<ScholarPageResponse> {
  const query = request.query?.trim();
  const cites = request.cites?.trim();
  if (!query && !cites) throw new Error("Provide either query or cites.");
  if (cites && !/^\d+$/.test(cites)) throw new Error("cites must be a numeric Scholar case_id.");
  if (request.yearLo !== undefined && request.yearHi !== undefined && request.yearLo > request.yearHi) {
    throw new Error("year_lo cannot be later than year_hi.");
  }
  if (!Number.isInteger(request.page) || request.page < 1 || request.page > SCHOLAR_MAX_PAGE) {
    throw new Error(`Google Scholar exposes result pages 1 through ${SCHOLAR_MAX_PAGE}.`);
  }
  const path = searchPath({ ...request, query, cites });
  const sessionKey = request.navigationSession?.trim() || undefined;
  const progress = (message: string, details: Record<string, unknown> = {}, status?: "running" | "waiting") =>
    browser.emitProgress(onUpdate, message, { page: request.page, ...details }, status);
  const reportBrowserStatus: StatusCallback = (message) => progress(
    message,
    { phase: message.startsWith("CAPTCHA cleared") ? "loading_results" : "captcha" },
    message.startsWith("CAPTCHA cleared") ? "running" : "waiting",
  );

  progress(`Starting Google Scholar search, result page ${request.page}.`, { phase: "starting" });
  let tab: TabRef | undefined;
  try {
    let fetched: CapturedPage | undefined;
    const prior = sessionKey ? browser.getNavigationSession(sessionKey) : undefined;
    if (prior && (prior.page === request.page || prior.page + 1 === request.page)) {
      browser.acquireTabLease(prior.tab);
      tab = prior.tab;
      try {
        if (prior.page === request.page) {
          progress(`Re-reading the open Scholar results tab already on page ${request.page}.`, { phase: "reusing_results_tab" });
          fetched = await browserReadCurrentResults(prior.tab, signal);
        } else {
          progress(`Clicking Scholar Next on the open results tab for page ${request.page}.`, { phase: "clicking_next_page" });
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
        progress("The remembered Scholar results tab could not be reused; opening the search again from page 1.", { phase: "starting" });
      }
    }
    if (!fetched) {
      fetched = await browserFetch(path, !!query && !cites, signal, reportBrowserStatus);
      tab = fetched.tab;
      for (let restored = 1; restored < request.page; restored += 1) {
        progress(`Clicking Scholar Next to restore result page ${restored + 1}.`, { phase: "clicking_next_page", restoredPage: restored + 1 });
        fetched = await browserClickNextResultsPage(tab, signal, reportBrowserStatus);
      }
    }
    const results = parseCapturedResults(fetched);
    if (sessionKey && tab) browser.rememberNavigationSession(sessionKey, { tab, page: request.page });
    progress(`Loaded ${results.length} Scholar result${results.length === 1 ? "" : "s"} from page ${request.page}.`, {
      phase: "completed",
      pageResults: results.length,
    }, "running");
    return {
      results,
      reachedEnd: scholarPageReachedEnd(request.page, results.length, fetched.state.hasNext),
      lastPage: request.page,
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
 * Click an exact case link in the open Scholar results tab that renders it,
 * save the rendered opinion HTML, and return to the results with Back.
 */
export async function clickScholarResult(
  url: string,
  saveDir: string,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<any>,
): Promise<SavedOpinionCapture> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("url must be a valid Google Scholar opinion URL.");
  }
  const caseId = parsed.searchParams.get("case") ?? "";
  if (parsed.protocol !== "https:" || parsed.hostname !== "scholar.google.com" || parsed.pathname !== "/scholar_case" || !/^\d+$/.test(caseId)) {
    throw new Error("url must be an https://scholar.google.com/scholar_case link with a numeric case parameter.");
  }
  if (!saveDir.trim()) throw new Error("save_dir must not be empty.");

  browser.emitProgress(onUpdate, `Finding Scholar result link for case ${caseId}.`, { phase: "finding_result_link", caseId, url });
  const tab = await leaseResultTab(caseId, signal);
  let visitedCasePage = false;
  let restorationAttempted = false;
  try {
    const page = await browserClickCaseResult(
      tab,
      caseId,
      signal,
      (message) => browser.emitProgress(onUpdate, message, { phase: "clicking_result_link", caseId }),
    );
    visitedCasePage = true;
    const clickedCaseId = new URL(page.state.href).searchParams.get("case");
    if (clickedCaseId !== caseId) {
      throw new Error(`The clicked Scholar link opened case ${clickedCaseId ?? "unknown"}, not case ${caseId}.`);
    }
    const text = extractOpinionText(page.html, "scholar");
    if (text.length < 200) {
      throw new Error(`No substantial rendered opinion text was found after clicking Scholar case ${caseId}.`);
    }
    const saved = saveOpinionHtml(page.html, caseId, saveDir);
    browser.emitProgress(onUpdate, `Returning to Scholar results after saving case ${caseId}.`, {
      phase: "returning_to_results",
      caseId,
      savedPath: saved.savedPath,
    });
    restorationAttempted = true;
    const restored = await restoreSavedCapture(saved, () => browserBackToResults(tab, signal,
      (message) => browser.emitProgress(onUpdate, message, { phase: "returning_to_results", caseId })));
    visitedCasePage = !restored.returnedToResults;
    const restorationError = restored.restorationError;
    if (restorationError) {
      browser.emitProgress(onUpdate, `The opinion was saved, but Scholar results could not be restored: ${restorationError}`, {
        phase: "results_restore_failed", caseId, savedPath: saved.savedPath,
      });
    }
    browser.emitProgress(onUpdate, `Clicked and saved Scholar case ${caseId}.`, {
      phase: "completed",
      caseId,
      savedPath: saved.savedPath,
      sourceUrl: page.state.href,
      returnedToResults: !restorationError,
      restorationError,
    }, "completed");
    return {
      title: saved.title,
      savedPath: saved.savedPath,
      sourceUrl: page.state.href,
      textLength: text.length,
      returnedToResults: !restorationError,
      restorationError,
    };
  } finally {
    try {
      if (visitedCasePage && !restorationAttempted) {
        browser.emitProgress(onUpdate, `Restoring Scholar results after the case ${caseId} attempt.`, {
          phase: "returning_to_results",
          caseId,
        });
        try {
          await browserBackToResults(
            tab,
            signal,
            (message) => browser.emitProgress(onUpdate, message, { phase: "returning_to_results", caseId }),
          );
        } catch (cleanupError) {
          if (signal?.aborted) throw cleanupError;
          browser.emitProgress(onUpdate, `Could not restore the Scholar results tab after the failed save attempt: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`, {
            phase: "results_restore_failed",
            caseId,
          });
        }
      }
    } finally {
      browser.releaseTabLease(tab);
    }
  }
}

/** Open or focus the shared visible browser window at a Scholar URL (default: home). */
export async function openScholarBrowser(
  url: string | undefined,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<any>,
): Promise<{ url: string; timingMode: string }> {
  if (url) {
    let host = "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") host = parsed.hostname;
    } catch {}
    if (host !== "scholar.google.com") {
      throw new Error("url must be an http(s) URL on scholar.google.com; this tool only navigates Google Scholar.");
    }
  }
  browser.emitProgress(onUpdate, "Opening the shared Google Scholar browser.", { phase: "opening_browser", requestedUrl: url });
  return browser.withLock(async () => {
    const cdp = await browser.connect(signal);
    let tab: TabRef | undefined;
    try {
      const existing = await browser.newestIdleTab(cdp, signal);
      const opened = await browser.openTab(cdp, existing, signal);
      tab = opened.tab;
      browser.acquireTabLease(tab);
      const current = await cdp.eval<string>(opened.sessionId, "location.href");
      if (url) await cdp.send("Page.navigate", { url }, opened.sessionId);
      else if (!isScholarUrl(current)) await cdp.send("Page.navigate", { url: `${BASE}/?hl=en` }, opened.sessionId);
      await abortableDelay(500, signal);
      throwIfAborted(signal);
      await cdp.send("Target.activateTarget", { targetId: opened.targetId });
      const href = url ?? (isScholarUrl(current) ? current : `${BASE}/?hl=en`);
      browser.emitProgress(onUpdate, `Google Scholar browser is ready at ${href}.`, { phase: "completed", url: href }, "completed");
      return { url: href, timingMode: browser.timingMode };
    } finally {
      browser.releaseTabLease(tab);
      cdp.close();
    }
  }, signal);
}
