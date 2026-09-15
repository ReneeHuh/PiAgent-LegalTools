import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCourtListenerCourts,
  FEDERAL_DISTRICT_JURISDICTIONS,
  SCHOLAR_FEDERAL_APPELLATE_CODES,
} from "./jurisdiction-codes.ts";
import {
  jurisdictionCatalog,
  providerSearchParameters,
  openProviderBrowser,
  providerHomepage,
  uniformJurisdiction,
  UNIFORM_FEDERAL_JURISDICTION_KEYS,
  UNIFORM_FEDERAL_APPELLATE_JURISDICTION_KEYS,
  UNIFORM_FEDERAL_DISTRICT_JURISDICTION_KEYS,
  UNIFORM_JURISDICTION_KEYS,
  UNIFORM_STATE_JURISDICTION_KEYS,
} from "./providers.ts";

test("unified state jurisdiction expands to both providers' native selections", () => {
  const jurisdiction = uniformJurisdiction("California");
  const scholar = providerSearchParameters("scholar", {
    query: "test", courts: jurisdiction.scholarCourts,
  });
  const courtListener = providerSearchParameters("courtlistener", {
    query: "test", courts: jurisdiction.courtListenerCourts,
  });
  assert.equal(scholar.courts, "california");
  assert.equal(
    courtListener.courts,
    "cal,calctapp,calappdeptsuper,calctapp1d,calctapp2d,calctapp3d,calctapp4d,calctapp5d,calctapp6d",
  );
  assert.notEqual(courtListener.courts, "ca");
});

test("provider preflight rejects invalid and contradictory dates", () => {
  assert.throws(() => providerSearchParameters("courtlistener", {
    query: "test", filed_after: "2026-02-30",
  }), /valid calendar date/);
  assert.throws(() => providerSearchParameters("scholar", {
    query: "test", year_from: 2020, year_to: 2010,
  }), /year_from/);
  assert.throws(() => providerSearchParameters("scholar", {
    query: "test", year_from: 1900, year_to: 1950, filed_after: "2000-01-01",
  }), /do not overlap/);
});

test("filing-year bounds translate to each provider's native fields", () => {
  const scholar = providerSearchParameters("scholar", {
    query: "test", year_from: 2000, year_to: 2020,
  });
  const courtListener = providerSearchParameters("courtlistener", {
    query: "test", year_from: 2000, year_to: 2020,
  });
  assert.equal(scholar.year_lo, 2000);
  assert.equal(scholar.year_hi, 2020);
  assert.equal(courtListener.filed_after, "2000-01-01");
  assert.equal(courtListener.filed_before, "2020-12-31");
});

test("unified CourtListener discovery explicitly selects all primary opinion statuses", () => {
  const params = providerSearchParameters("courtlistener", {
    query: "test",
  });
  assert.equal(params.statuses, "published,unpublished,errata");
});

test("Scholar exact-day filters fail before browser work", () => {
  assert.throws(() => providerSearchParameters("scholar", {
    query: "test", filed_after: "2020-06-01",
  }), /January 1/);
});

test("one uniform jurisdiction translates exactly for both providers", () => {
  assert.deepEqual(uniformJurisdiction("California"), {
    canonical: "california",
    kind: "state_appellate",
    scholarCourts: ["california"],
    courtListenerCourts: [
      "cal", "calctapp", "calappdeptsuper", "calctapp1d", "calctapp2d", "calctapp3d",
      "calctapp4d", "calctapp5d", "calctapp6d",
    ],
  });
  assert.deepEqual(uniformJurisdiction("Ninth Circuit"), {
    canonical: "9th circuit",
    kind: "federal_court",
    scholarCourts: ["9th circuit court of appeals"],
    courtListenerCourts: ["ca9"],
  });
  assert.deepEqual(uniformJurisdiction("SCOTUS"), {
    canonical: "us supreme court",
    kind: "federal_court",
    scholarCourts: ["us supreme court"],
    courtListenerCourts: ["scotus"],
  });
  assert.deepEqual(uniformJurisdiction("all"), {
    canonical: "all", kind: "all", scholarCourts: [], courtListenerCourts: [],
  });
});

test("every documented state abbreviation has a nonempty provider scope", () => {
  const abbreviations = (
    "al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv " +
    "nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy"
  ).split(" ");
  for (const abbreviation of abbreviations) {
    const jurisdiction = uniformJurisdiction(abbreviation);
    assert.equal(jurisdiction.kind, "state_appellate", abbreviation);
    assert.equal(jurisdiction.scholarCourts.length, 1, abbreviation);
    assert.ok(jurisdiction.courtListenerCourts.length >= 1, abbreviation);
  }
});

test("missing and invalid jurisdictions return the complete canonical key list", () => {
  assert.equal(UNIFORM_JURISDICTION_KEYS.length, 159);
  assert.equal(new Set(UNIFORM_JURISDICTION_KEYS).size, UNIFORM_JURISDICTION_KEYS.length);
  assert.throws(
    () => uniformJurisdiction(undefined),
    /jurisdiction is required[\s\S]*Valid jurisdiction keys: all, alabama[\s\S]*federal circuit/,
  );
  assert.throws(
    () => uniformJurisdiction("nmid"),
    /cannot be represented uniformly[\s\S]*Valid jurisdiction keys: all, alabama[\s\S]*federal circuit/,
  );
});

test("jurisdiction catalog returns every accepted canonical key in useful groups", () => {
  const catalog = jurisdictionCatalog();
  assert.equal(catalog.count, 159);
  assert.deepEqual(catalog.jurisdictions, UNIFORM_JURISDICTION_KEYS);
  assert.deepEqual(catalog.groups.unrestricted, ["all"]);
  assert.deepEqual(catalog.groups.stateAppellate, UNIFORM_STATE_JURISDICTION_KEYS);
  assert.deepEqual(catalog.groups.federalCourts, UNIFORM_FEDERAL_JURISDICTION_KEYS);
  assert.deepEqual(catalog.groups.federalAppellate, UNIFORM_FEDERAL_APPELLATE_JURISDICTION_KEYS);
  assert.deepEqual(catalog.groups.federalDistrict, UNIFORM_FEDERAL_DISTRICT_JURISDICTION_KEYS);
  assert.match(catalog.limitations.federalDistrictCourts, /93 exact/);
  assert.deepEqual(
    catalog.jurisdictions,
    [
      ...catalog.groups.unrestricted,
      ...catalog.groups.stateAppellate,
      ...catalog.groups.federalCourts,
    ],
  );
});

test("circuit aliases select the appellate court rather than Scholar's broader circuit group", () => {
  const scholar = providerSearchParameters("scholar", {
    query: "test", courts: "Ninth Circuit",
  });
  const courtListener = providerSearchParameters("courtlistener", {
    query: "test", courts: "Ninth Circuit",
  });
  assert.equal(scholar.courts, "9th circuit court of appeals");
  assert.equal(SCHOLAR_FEDERAL_APPELLATE_CODES[scholar.courts as string], "129");
  assert.equal(courtListener.courts, "ca9");
});

test("CourtListener rendered URLs use its current prefixed court fields", () => {
  const params = new URLSearchParams({ q: "test", type: "o" });
  appendCourtListenerCourts(params, ["cal", "calctapp"]);
  const path = `/?${params.toString()}`;
  assert.match(path, /[?&]court_cal=on(?:&|$)/);
  assert.match(path, /[?&]court_calctapp=on(?:&|$)/);
  assert.doesNotMatch(path, /[?&]cal=on(?:&|$)/);
});

test("federal district courts translate exactly for both providers", () => {
  assert.deepEqual(uniformJurisdiction("nysd"), {
    canonical: "southern district of new york",
    kind: "federal_district",
    scholarCourts: ["sd new york"],
    courtListenerCourts: ["nysd"],
  });
  assert.deepEqual(uniformJurisdiction("Southern District of New York"), uniformJurisdiction("nysd"));
  const scholar = providerSearchParameters("scholar", {
    query: "test", courts: uniformJurisdiction("nysd").scholarCourts,
  });
  const courtListener = providerSearchParameters("courtlistener", {
    query: "test", courts: uniformJurisdiction("nysd").courtListenerCourts,
  });
  assert.equal(scholar.courts, "sd new york");
  assert.equal(courtListener.courts, "nysd");
  assert.equal(Object.keys(FEDERAL_DISTRICT_JURISDICTIONS).length, 93);
  assert.equal(new Set(Object.values(FEDERAL_DISTRICT_JURISDICTIONS).map((entry) => entry.scholarCode)).size, 93);
  assert.equal(new Set(Object.values(FEDERAL_DISTRICT_JURISDICTIONS).map((entry) => entry.courtlistener)).size, 93);
  assert.throws(() => uniformJurisdiction("nmid"), /cannot be represented uniformly/);
  assert.throws(() => uniformJurisdiction("california, texas"), /one shared jurisdiction/);
});

test("provider page parameters carry the one-based page and provider tag", () => {
  const scholar = providerSearchParameters("scholar", { query: "test", page: 3 });
  assert.equal(scholar.provider, "scholar");
  assert.equal(scholar.page, 3);
  const courtListener = providerSearchParameters("courtlistener", { cites: "1" });
  assert.equal(courtListener.provider, "courtlistener");
  assert.equal(courtListener.page, 1);
  assert.deepEqual(providerSearchParameters("justia", { query: "test", page: 2 }), {
    provider: "justia", query: "test", page: 2,
  });
  assert.throws(() => providerSearchParameters("scholar", { query: "test", page: 0 }), /page must be a positive integer/);
});

test("provider browser URLs require HTTPS on the selected host", async () => {
  await assert.rejects(() => openProviderBrowser(
    "scholar", "http://scholar.google.com/", undefined, undefined,
  ), /must use HTTPS/);
  await assert.rejects(() => openProviderBrowser(
    "courtlistener", "https://example.com/", undefined, undefined,
  ), /selected courtlistener host/);
});

test("public provider browser homepages are fixed", () => {
  assert.equal(providerHomepage("scholar"), "https://scholar.google.com/");
  assert.equal(providerHomepage("courtlistener"), "https://www.courtlistener.com/");
  assert.equal(providerHomepage("justia"), "https://www.justia.com/search/");
});
