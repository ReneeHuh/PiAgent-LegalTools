import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import {
  ensureDirectory,
  providerIdFromUrl,
  type DiscoveryProviderId,
  type ProviderId,
  type ProviderRawResult,
} from "./core.ts";
import {
  FEDERAL_DISTRICT_ALIASES,
  FEDERAL_DISTRICT_JURISDICTIONS,
  FEDERAL_DISTRICT_JURISDICTION_KEYS,
  SCHOLAR_FEDERAL_APPELLATE_CODES,
  SCHOLAR_FEDERAL_DISTRICT_CODES,
} from "./jurisdiction-codes.ts";
import { clickCourtListenerResult, openCourtListenerBrowser, searchCourtListenerPage } from "./provider-courtlistener.ts";
import { clickScholarResult, openScholarBrowser, searchScholarPage } from "./provider-google-scholar.ts";

export interface SavedOpinion {
  markdownPath?: string;
  markdownError?: string;
  summary?: { status: "completed" | "failed"; path?: string; sourceSha256?: string; summarySha256?: string; error?: string };
  provider: ProviderId;
  providerId?: string;
  sourceUrl: string;
  title: string;
  savedPath: string;
  textLength?: number;
  htmlSha256?: string;
  textSha256?: string;
  returnedToResults?: boolean;
  restorationError?: string;
}

/** One rendered result page from a provider. */
export interface ProviderSearchResponse {
  results: ProviderRawResult[];
  /** True only when the provider showed the end of its exposed results. */
  reachedEnd?: boolean;
  lastPage?: number;
  resultCountText?: string;
  timingMode?: string;
}

function parseIsoDate(value: string, label: string): { year: number; month: number; day: number } {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`${label} must use YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`${label} is not a valid calendar date.`);
  }
  return { year, month, day };
}

const STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", "district of columbia": "dc",
  florida: "fl", georgia: "ga", hawaii: "hi", idaho: "id", illinois: "il",
  indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky", louisiana: "la",
  maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi", minnesota: "mn",
  mississippi: "ms", missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv",
  "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
  "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok", oregon: "or",
  pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc", "south dakota": "sd",
  tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt", virginia: "va",
  washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};
const STATE_BY_ABBREVIATION = Object.fromEntries(
  Object.entries(STATE_ABBREVIATIONS).map(([name, abbreviation]) => [abbreviation, name]),
);

// CourtListener IDs classified as State Supreme or State Appellate in its
// available-jurisdictions table, limited to courts whose published date range
// overlaps Google Scholar's state-opinion coverage beginning in 1950. Snapshot:
// https://www.courtlistener.com/help/api/jurisdictions/ (2026-08-28).
const COURTLISTENER_STATE_APPELLATE_IDS: Record<string, readonly string[]> = {
  alabama: ["ala", "alactapp", "alacrimapp", "alacivapp"],
  alaska: ["alaska", "alaskactapp"],
  arizona: ["ariz", "arizctapp"],
  arkansas: ["ark", "arkctapp"],
  california: ["cal", "calctapp", "calappdeptsuper", "calctapp1d", "calctapp2d", "calctapp3d", "calctapp4d", "calctapp5d", "calctapp6d"],
  colorado: ["colo", "coloctapp"],
  connecticut: ["conn", "connappct", "connsuperct"],
  delaware: ["del", "delch", "delorphct", "delsuperct"],
  "district of columbia": ["dc"],
  florida: ["fla", "fladistctapp", "fladistctapp1", "fladistctapp2", "fladistctapp3", "fladistctapp4", "fladistctapp5", "fladistctapp6"],
  georgia: ["ga", "gactapp"],
  hawaii: ["haw", "hawapp"],
  idaho: ["idaho", "idahoctapp"],
  illinois: ["ill", "illappct"],
  indiana: ["ind", "indctapp"],
  iowa: ["iowa", "iowactapp"],
  kansas: ["kan", "kanctapp"],
  kentucky: ["ky", "kyctapp", "kyctapphigh"],
  louisiana: ["la", "lactapp"],
  maine: ["me"],
  maryland: ["md", "mdctspecapp"],
  massachusetts: ["mass", "massappct", "massdistctapp", "masssuperct", "massdistct", "masstaxbd"],
  michigan: ["mich", "michctapp"],
  minnesota: ["minn", "minnctapp"],
  mississippi: ["miss", "missctapp"],
  missouri: ["mo", "moctapp", "moctapped", "moctappsd", "moctappwd"],
  montana: ["mont"],
  nebraska: ["neb", "nebctapp"],
  nevada: ["nev", "nevapp"],
  "new hampshire": ["nh"],
  "new jersey": ["nj", "njsuperctappdiv"],
  "new mexico": ["nm", "nmctapp"],
  "new york": ["ny", "nyappdiv", "nyappterm", "nyhospcommn"],
  "north carolina": ["nc", "ncctapp", "ncsuperct"],
  "north dakota": ["nd", "ndctapp"],
  ohio: ["ohio", "ohioctapp"],
  oklahoma: ["okla", "oklacivapp", "oklacrimapp"],
  oregon: ["or", "orctapp"],
  pennsylvania: ["pa", "pasuperct", "pacommwct"],
  "rhode island": ["ri", "risuperct"],
  "south carolina": ["sc", "scctapp"],
  "south dakota": ["sd"],
  tennessee: ["tenn", "tennctapp", "tenncrimapp"],
  texas: ["tex", "texapp", "texcrimapp", "texjpml", "txctapp1", "txctapp2", "txctapp3", "txctapp4", "txctapp5", "txctapp6", "txctapp7", "txctapp8", "txctapp9", "txctapp10", "txctapp11", "txctapp12", "txctapp13", "txctapp13A", "txctapp13B", "txctapp14", "txctapp15"],
  utah: ["utah", "utahctapp"],
  vermont: ["vt", "vtsuperct"],
  virginia: ["va", "vactapp"],
  washington: ["wash", "washctapp"],
  "west virginia": ["wva", "wvactapp"],
  wisconsin: ["wis", "wisctapp"],
  wyoming: ["wyo"],
};
const FEDERAL_COURTS = new Set([
  "us supreme court", "1st circuit", "2nd circuit", "3rd circuit", "4th circuit", "5th circuit",
  "6th circuit", "7th circuit", "8th circuit", "9th circuit", "10th circuit", "11th circuit",
  "dc circuit", "federal circuit", "tax court", "court of claims",
]);
const COURTLISTENER_FEDERAL_ALIASES = new Set([...FEDERAL_COURTS].filter((value) =>
  value !== "tax court" && value !== "court of claims",
));
const UNIFORM_FEDERAL_JURISDICTIONS: Record<string, { scholar: string; courtlistener: string }> = {
  "us supreme court": { scholar: "us supreme court", courtlistener: "scotus" },
  "1st circuit": { scholar: "1st circuit court of appeals", courtlistener: "ca1" },
  "2nd circuit": { scholar: "2nd circuit court of appeals", courtlistener: "ca2" },
  "3rd circuit": { scholar: "3rd circuit court of appeals", courtlistener: "ca3" },
  "4th circuit": { scholar: "4th circuit court of appeals", courtlistener: "ca4" },
  "5th circuit": { scholar: "5th circuit court of appeals", courtlistener: "ca5" },
  "6th circuit": { scholar: "6th circuit court of appeals", courtlistener: "ca6" },
  "7th circuit": { scholar: "7th circuit court of appeals", courtlistener: "ca7" },
  "8th circuit": { scholar: "8th circuit court of appeals", courtlistener: "ca8" },
  "9th circuit": { scholar: "9th circuit court of appeals", courtlistener: "ca9" },
  "10th circuit": { scholar: "10th circuit court of appeals", courtlistener: "ca10" },
  "11th circuit": { scholar: "11th circuit court of appeals", courtlistener: "ca11" },
  "dc circuit": { scholar: "dc circuit court of appeals", courtlistener: "cadc" },
  "federal circuit": { scholar: "federal circuit court of appeals", courtlistener: "cafc" },
};
const SCHOLAR_EXACT_FEDERAL_COURTS = new Set(
  [
    "us supreme court",
    ...Object.keys(SCHOLAR_FEDERAL_APPELLATE_CODES),
    ...Object.keys(SCHOLAR_FEDERAL_DISTRICT_CODES),
  ],
);
export const UNIFORM_STATE_JURISDICTION_KEYS: readonly string[] = Object.keys(STATE_ABBREVIATIONS);
export const UNIFORM_FEDERAL_APPELLATE_JURISDICTION_KEYS: readonly string[] = Object.keys(UNIFORM_FEDERAL_JURISDICTIONS);
export const UNIFORM_FEDERAL_DISTRICT_JURISDICTION_KEYS: readonly string[] = FEDERAL_DISTRICT_JURISDICTION_KEYS;
export const UNIFORM_FEDERAL_JURISDICTION_KEYS: readonly string[] = [
  ...UNIFORM_FEDERAL_APPELLATE_JURISDICTION_KEYS,
  ...UNIFORM_FEDERAL_DISTRICT_JURISDICTION_KEYS,
];
export const UNIFORM_JURISDICTION_KEYS: readonly string[] = [
  "all",
  ...UNIFORM_STATE_JURISDICTION_KEYS,
  ...UNIFORM_FEDERAL_JURISDICTION_KEYS,
];

export interface JurisdictionCatalog {
  count: number;
  jurisdictions: string[];
  groups: {
    unrestricted: string[];
    stateAppellate: string[];
    federalCourts: string[];
    federalAppellate: string[];
    federalDistrict: string[];
  };
  limitations: {
    federalDistrictCourts: string;
  };
}

export function jurisdictionCatalog(): JurisdictionCatalog {
  return {
    count: UNIFORM_JURISDICTION_KEYS.length,
    jurisdictions: [...UNIFORM_JURISDICTION_KEYS],
    groups: {
      unrestricted: ["all"],
      stateAppellate: [...UNIFORM_STATE_JURISDICTION_KEYS],
      federalCourts: [...UNIFORM_FEDERAL_JURISDICTION_KEYS],
      federalAppellate: [...UNIFORM_FEDERAL_APPELLATE_JURISDICTION_KEYS],
      federalDistrict: [...UNIFORM_FEDERAL_DISTRICT_JURISDICTION_KEYS],
    },
    limitations: {
      federalDistrictCourts:
        "93 exact federal district or territorial district courts are supported by both providers. The Northern Mariana Islands is omitted because Google Scholar's current picker has no exact district entry.",
    },
  };
}

export function jurisdictionValidationMessage(reason: string): string {
  return `${reason}\nValid jurisdiction keys: ${UNIFORM_JURISDICTION_KEYS.join(", ")}.\n` +
    "The shared vocabulary includes 93 exact federal district or territorial district courts; the Northern Mariana Islands is not available because Scholar exposes no exact picker entry.";
}
const ORDINALS: Record<string, string> = {
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", sixth: "6th",
  seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th", eleventh: "11th",
};

function normalizeCourtName(raw: string): string {
  let value = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  value = value.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh)\b/g, (word) => ORDINALS[word]);
  value = value.replace(/\bcir\b/g, "circuit");
  if (/^(scotus|us supreme(?: court)?|united states supreme(?: court)?|supreme(?: court)?)$/.test(value)) value = "us supreme court";
  if (/^\d+(?:st|nd|rd|th)$/.test(value)) value = `${value} circuit`;
  return value;
}

export interface UniformJurisdiction {
  canonical: string;
  kind: "all" | "state_appellate" | "federal_court" | "federal_district";
  scholarCourts: readonly string[];
  courtListenerCourts: readonly string[];
}

export function uniformJurisdiction(raw: string | undefined): UniformJurisdiction {
  if (raw === undefined || !raw.trim()) {
    throw new Error(jurisdictionValidationMessage("jurisdiction is required for a fresh search."));
  }
  if (raw.trim().toLowerCase() === "all") {
    return { canonical: "all", kind: "all", scholarCourts: [], courtListenerCourts: [] };
  }
  if (raw.includes(",")) {
    throw new Error(jurisdictionValidationMessage(
      "jurisdiction accepts one shared jurisdiction, not a comma-separated list.",
    ));
  }
  const normalized = normalizeCourtName(raw);
  const stateName = STATE_BY_ABBREVIATION[normalized] ?? (STATE_ABBREVIATIONS[normalized] ? normalized : undefined);
  if (stateName) {
    const courtListenerCourts = COURTLISTENER_STATE_APPELLATE_IDS[stateName];
    if (!courtListenerCourts?.length) throw new Error(`No CourtListener appellate court set is configured for ${stateName}.`);
    return {
      canonical: stateName,
      kind: "state_appellate",
      scholarCourts: [stateName],
      courtListenerCourts: [...courtListenerCourts],
    };
  }
  const selection = UNIFORM_FEDERAL_JURISDICTIONS[normalized];
  if (selection) {
    return {
      canonical: normalized,
      kind: "federal_court",
      scholarCourts: [selection.scholar],
      courtListenerCourts: [selection.courtlistener],
    };
  }
  const districtCanonical = FEDERAL_DISTRICT_ALIASES[normalized];
  const district = districtCanonical ? FEDERAL_DISTRICT_JURISDICTIONS[districtCanonical] : undefined;
  if (district) {
    return {
      canonical: districtCanonical,
      kind: "federal_district",
      scholarCourts: [district.scholar],
      courtListenerCourts: [district.courtlistener],
    };
  }
  throw new Error(
    jurisdictionValidationMessage(
      `jurisdiction "${raw}" cannot be represented uniformly by Google Scholar and CourtListener.`,
    ),
  );
}

function providerCourtFilter(
  provider: DiscoveryProviderId,
  spec: string | readonly string[] | undefined,
): string | undefined {
  if (spec === undefined) return undefined;
  const nativeSelection = typeof spec !== "string";
  const values = (typeof spec === "string" ? spec.split(",") : [...spec])
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length) return undefined;
  const translated = values.flatMap((raw) => {
    const normalized = normalizeCourtName(raw);
    const districtCanonical = FEDERAL_DISTRICT_ALIASES[normalized];
    const district = districtCanonical ? FEDERAL_DISTRICT_JURISDICTIONS[districtCanonical] : undefined;
    if (district) return provider === "scholar" ? district.scholar : district.courtlistener;
    if (provider === "courtlistener" && nativeSelection) {
      if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(raw)) {
        throw new Error(`CourtListener does not recognize court value "${raw}".`);
      }
      return raw;
    }
    const stateName = STATE_BY_ABBREVIATION[normalized] ?? (STATE_ABBREVIATIONS[normalized] ? normalized : undefined);
    if (provider === "scholar") {
      if (stateName) return stateName;
      if (SCHOLAR_EXACT_FEDERAL_COURTS.has(normalized)) return normalized;
      const uniformFederal = UNIFORM_FEDERAL_JURISDICTIONS[normalized];
      if (uniformFederal) return uniformFederal.scholar;
      if (!nativeSelection && FEDERAL_COURTS.has(normalized)) return normalized;
      throw new Error(`Google Scholar does not recognize court value "${raw}".`);
    }
    if (stateName) return [...COURTLISTENER_STATE_APPELLATE_IDS[stateName]];
    const uniformFederal = UNIFORM_FEDERAL_JURISDICTIONS[normalized];
    if (uniformFederal) return uniformFederal.courtlistener;
    if (!nativeSelection && COURTLISTENER_FEDERAL_ALIASES.has(normalized)) return normalized;
    if (!/^[a-z][a-z0-9-]*$/.test(normalized)) {
      throw new Error(`CourtListener does not recognize court value "${raw}".`);
    }
    return normalized;
  });
  return [...new Set(translated)].join(",");
}

export interface ScholarSearchParameters {
  provider: "scholar";
  query?: string;
  cites?: string;
  courts?: string;
  year_lo?: number;
  year_hi?: number;
  page: number;
}

export interface CourtListenerSearchParameters {
  provider: "courtlistener";
  query?: string;
  cites?: string;
  courts?: string;
  statuses: string;
  filed_after?: string;
  filed_before?: string;
  page: number;
}

export type ProviderSearchParameters = ScholarSearchParameters | CourtListenerSearchParameters;

export interface ProviderSearchInput {
  query?: string;
  cites?: string;
  courts?: string | readonly string[];
  year_from?: number;
  year_to?: number;
  filed_after?: string;
  filed_before?: string;
  /** One-based result page; defaults to 1. */
  page?: number;
}

/** Translate shared search filters into one provider's native page request, validating them first. */
export function providerSearchParameters(provider: "scholar", input: ProviderSearchInput): ScholarSearchParameters;
export function providerSearchParameters(provider: "courtlistener", input: ProviderSearchInput): CourtListenerSearchParameters;
export function providerSearchParameters(provider: DiscoveryProviderId, input: ProviderSearchInput): ProviderSearchParameters;
export function providerSearchParameters(provider: DiscoveryProviderId, input: ProviderSearchInput): ProviderSearchParameters {
  if (input.year_from !== undefined && input.year_to !== undefined && input.year_from > input.year_to) {
    throw new Error("year_from cannot be later than year_to.");
  }
  const after = input.filed_after ? parseIsoDate(input.filed_after, "filed_after") : undefined;
  const before = input.filed_before ? parseIsoDate(input.filed_before, "filed_before") : undefined;
  if (input.filed_after && input.filed_before && input.filed_after > input.filed_before) {
    throw new Error("filed_after cannot be later than filed_before.");
  }
  const page = input.page ?? 1;
  if (!Number.isInteger(page) || page < 1) throw new Error("page must be a positive integer.");
  const courts = providerCourtFilter(provider, input.courts);
  if (provider === "courtlistener") {
    return {
      provider,
      query: input.query,
      cites: input.cites,
      courts,
      // CourtListener returns Published opinions only unless additional
      // precedential-status fields are explicitly enabled. Unified discovery
      // includes the three primary case-law result classes.
      statuses: "published,unpublished,errata",
      filed_after: input.filed_after ?? (input.year_from ? `${input.year_from}-01-01` : undefined),
      filed_before: input.filed_before ?? (input.year_to ? `${input.year_to}-12-31` : undefined),
      page,
    };
  }

  let yearLo = input.year_from;
  let yearHi = input.year_to;
  if (after) {
    if (after.month !== 1 || after.day !== 1) {
      throw new Error("Google Scholar cannot apply an exact filed_after date. Use January 1, a year_from filter, or CourtListener only.");
    }
    yearLo = Math.max(yearLo ?? after.year, after.year);
  }
  if (before) {
    if (before.month !== 12 || before.day !== 31) {
      throw new Error("Google Scholar cannot apply an exact filed_before date. Use December 31, a year_to filter, or CourtListener only.");
    }
    yearHi = Math.min(yearHi ?? before.year, before.year);
  }
  if (yearLo !== undefined && yearHi !== undefined && yearLo > yearHi) {
    throw new Error("The requested Scholar year/date filters do not overlap.");
  }
  return {
    provider,
    query: input.query,
    cites: input.cites,
    courts,
    year_lo: yearLo,
    year_hi: yearHi,
    page,
  };
}

/**
 * Load one rendered result page from the selected provider. When a navigation
 * session key is supplied, the provider reuses the tab it remembers under that
 * key if it already sits on the requested or preceding page.
 */
export async function searchProvider(
  provider: DiscoveryProviderId,
  params: ProviderSearchParameters,
  navigationSession: string | undefined,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
): Promise<ProviderSearchResponse> {
  if (params.provider !== provider) throw new Error(`${provider} search received ${params.provider} parameters.`);
  if (params.provider === "scholar") {
    const response = await searchScholarPage({
      query: params.query,
      cites: params.cites,
      courts: params.courts,
      yearLo: params.year_lo,
      yearHi: params.year_hi,
      page: params.page,
      navigationSession,
    }, signal, onUpdate);
    return { results: response.results, reachedEnd: response.reachedEnd, lastPage: response.lastPage, timingMode: response.timingMode };
  }
  const response = await searchCourtListenerPage({
    query: params.query,
    cites: params.cites,
    courts: params.courts,
    statuses: params.statuses,
    filedAfter: params.filed_after,
    filedBefore: params.filed_before,
    page: params.page,
    navigationSession,
  }, signal, onUpdate);
  return {
    results: response.results,
    reachedEnd: response.reachedEnd,
    lastPage: response.lastPage,
    resultCountText: response.resultCountText,
    timingMode: response.timingMode,
  };
}

/** Click a rendered result link in the provider's open results tab and save the opinion. */
export async function clickProviderResultLink(
  provider: DiscoveryProviderId,
  url: string,
  saveDirectory: string,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
): Promise<SavedOpinion> {
  const providerId = providerIdFromUrl(provider, url);
  if (!providerId || !/^\d+$/.test(providerId)) {
    throw new Error(`${provider} result link must contain a numeric opinion identifier.`);
  }
  const directory = ensureDirectory(saveDirectory);
  const capture = provider === "scholar"
    ? await clickScholarResult(url, directory, signal, onUpdate)
    : await clickCourtListenerResult(url, directory, signal, onUpdate);
  return {
    provider,
    providerId,
    sourceUrl: capture.sourceUrl,
    title: capture.title || `Opinion ${providerId}`,
    savedPath: capture.savedPath,
    textLength: capture.textLength,
    returnedToResults: capture.returnedToResults,
    restorationError: capture.restorationError,
  };
}

export async function openProviderBrowser(
  provider: DiscoveryProviderId,
  url: string | undefined,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
): Promise<AgentToolResult<any>> {
  if (url !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Provider browser URL must be a valid absolute HTTPS URL.");
    }
    const allowedHost = provider === "scholar"
      ? parsed.hostname === "scholar.google.com"
      : parsed.hostname === "courtlistener.com" || parsed.hostname === "www.courtlistener.com";
    if (parsed.protocol !== "https:" || !allowedHost || parsed.username || parsed.password) {
      throw new Error(`Provider browser URL must use HTTPS on the selected ${provider} host.`);
    }
  }
  const opened = provider === "scholar"
    ? await openScholarBrowser(url, signal, onUpdate)
    : await openCourtListenerBrowser(url, signal, onUpdate);
  return {
    content: [{ type: "text", text: `Chrome window is open at ${opened.url}. It stays open for the user between tool calls.` }],
    details: { url: opened.url, timingMode: opened.timingMode },
  };
}

export function providerHomepage(provider: DiscoveryProviderId): string {
  return provider === "scholar"
    ? "https://scholar.google.com/"
    : "https://www.courtlistener.com/";
}
