import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ScholarRawResult } from "./core.ts";
import {
  legalSearchNavigationSession,
  legalSearchPageParameters,
  legalSearchOutcomeText,
  runLegalSearch,
  validateLegalSearchOptions,
  type LegalSearchRuntime,
} from "./session-search.ts";

function scholarResult(id: number): ScholarRawResult {
  return {
    title: `Case ${id}`,
    meta: `${100 + id} F.3d ${200 + id} - 9th Circuit, 2020`,
    snippet: `Snippet ${id}`,
    caseId: String(id),
    url: `https://scholar.google.com/scholar_case?case=${id}&hl=en`,
  };
}

function fakeRuntime(
  search: LegalSearchRuntime["search"],
  download: LegalSearchRuntime["download"] = async () => {
    throw new Error("download should not be called");
  },
  now: LegalSearchRuntime["now"] = () => 1_000,
): LegalSearchRuntime {
  return { search, download, now };
}

test("legal_search accepts one provider and translates resume pages to native cursors", () => {
  const scholar = validateLegalSearchOptions({
    search_term: "example",
    provider: "scholar",
    jurisdiction: "9th circuit",
    pages_to_search: 2,
    resume_page: 4,
    max_cases_to_download: 0,
  });
  const scholarParameters = legalSearchPageParameters(scholar, 4);
  assert.equal(scholar.runtimeLimitMinutes, undefined);
  assert.equal(scholarParameters.provider, "scholar");
  assert.equal(scholarParameters.page, 4);

  const courtListener = validateLegalSearchOptions({
    search_term: "example",
    provider: "courtlistener",
    jurisdiction: "9th circuit",
    pages_to_search: 2,
    resume_page: 4,
    max_cases_to_download: 0,
  });
  assert.equal(legalSearchPageParameters(courtListener, 4).page, 4);
  assert.equal(legalSearchNavigationSession(courtListener), legalSearchNavigationSession(validateLegalSearchOptions({
    search_term: "example",
    provider: "courtlistener",
    jurisdiction: "ninth circuit",
    pages_to_search: 1,
  })), "the same search shares one navigation session across calls");
  assert.notEqual(legalSearchNavigationSession(courtListener), legalSearchNavigationSession(scholar));

  const exhaustive = validateLegalSearchOptions({
    search_term: "example",
    provider: "courtlistener",
    jurisdiction: "all",
    pages_to_search: -1,
    resume_page: 51,
    max_cases_to_download: -1,
  });
  assert.equal(exhaustive.endPage, Number.POSITIVE_INFINITY);
  assert.equal(exhaustive.maxCasesToDownload, -1);

  const bounded = validateLegalSearchOptions({
    search_term: "example",
    provider: "scholar",
    jurisdiction: "all",
    runtime_limit_minutes: 30,
  });
  assert.equal(bounded.runtimeLimitMinutes, 30);

});

test("renamed search fields are enforced before browser work", () => {
  assert.throws(() => validateLegalSearchOptions({
    action: "search",
    search_term: "example",
    provider: "scholar",
    jurisdiction: "all",
  } as never), /does not accept: action/);
  assert.throws(() => validateLegalSearchOptions({
    search_term: "example",
    provider: "scholar",
    jurisdiction: "all",
    page_limit_per_provider: 1,
  } as never), /does not accept: page_limit_per_provider/);
  assert.throws(() => validateLegalSearchOptions({
    search_term: "example",
    provider: "scholar",
    jurisdiction: "all",
    download_limit: 1,
  } as never), /does not accept: download_limit/);
  assert.throws(() => validateLegalSearchOptions({
    search_term: "example",
    provider: "scholar",
    jurisdiction: "all",
    pages_to_search: 3,
    resume_page: 49,
  }), /cannot go beyond provider page 50/);
  assert.throws(() => validateLegalSearchOptions({
    search_term: "example",
    provider: "scholar",
    jurisdiction: "all",
    max_cases_to_download: 1001,
  }), /max_cases_to_download must be -1 or an integer from 0 through 1000/);
  assert.throws(() => validateLegalSearchOptions({
    search_term: "example",
    provider: "scholar",
    jurisdiction: "all",
    runtime_limit_minutes: 0,
  }), /runtime_limit_minutes must be an integer from 1 through 240/);
  assert.throws(() => validateLegalSearchOptions({
    search_term: "example",
    provider: "scholar",
    jurisdiction: "all",
    summary_model: "lmstudio/summary-model",
  } as never), /does not accept: summary_model/);
  assert.throws(() => validateLegalSearchOptions({
    search_term: "example",
    provider: "scholar",
    jurisdiction: "all",
    summarize_after_download: true,
  } as never), /does not accept: summarize_after_download/);
  assert.throws(() => validateLegalSearchOptions({
    search_term: "example",
    provider: "other" as never,
    jurisdiction: "all",
  }), /provider must be/);
});

test("omitting runtime_limit_minutes applies no tool-imposed deadline", async t => {
  const root = mkdtempSync(join(tmpdir(), "legal-search-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let searches = 0;
  let clockReads = 0;
  const outcome = await runLegalSearch({
      search_term: "example",
      provider: "scholar",
      jurisdiction: "all",
      max_cases_to_download: 0,
    },
    undefined,
    undefined,
    { cwd: root } as never,
    fakeRuntime(
      async () => {
        searches += 1;
        return { results: [], reachedEnd: true };
      },
      undefined,
      () => clockReads++ === 0 ? 0 : 31 * 60_000,
    ),
  );
  assert.equal(searches, 1);
  assert.equal(outcome.status, "completed");
});

test("an explicit runtime_limit_minutes still bounds the call", async t => {
  const root = mkdtempSync(join(tmpdir(), "legal-search-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let searches = 0;
  let clockReads = 0;
  const outcome = await runLegalSearch({
      search_term: "example",
      provider: "scholar",
      jurisdiction: "all",
      max_cases_to_download: 0,
      runtime_limit_minutes: 1,
    },
    undefined,
    undefined,
    { cwd: root } as never,
    fakeRuntime(
      async () => {
        searches += 1;
        return { results: [], reachedEnd: true };
      },
      undefined,
      () => clockReads++ === 0 ? 0 : 60_000,
    ),
  );
  assert.equal(searches, 0);
  assert.equal(outcome.status, "stopped");
  assert.equal(outcome.resumePage, 1);
  assert.match(outcome.stopReason ?? "", /Runtime limit/);
});

test("zero downloads returns every parsed result page record", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-search-results-"));
  let calls = 0;
  try {
    const outcome = await runLegalSearch({
        search_term: "example",
        provider: "scholar",
        jurisdiction: "all",
        pages_to_search: 2,
        max_cases_to_download: 0,
      },
      undefined,
      undefined,
      { cwd: directory } as never,
      fakeRuntime(async () => {
        calls += 1;
        const start = (calls - 1) * 20 + 1;
        return {
          results: Array.from({ length: calls === 1 ? 20 : 2 }, (_, index) => scholarResult(start + index)),
          reachedEnd: calls === 2,
        };
      }),
    );
    assert.equal(outcome.status, "completed");
    assert.deepEqual(outcome.completedPages, [1, 2]);
    assert.equal(outcome.resultCount, 22);
    assert.equal(outcome.results[20].page, 2);
    assert.equal(outcome.results[20].position, 1);
    assert.equal(outcome.results[0].download_status, "not_requested");
    assert.equal(outcome.downloadSummary.downloaded, 0);
    assert.equal(existsSync(join(directory, "Cases")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a stopped search returns the first uncommitted page and remaining page count", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-search-resume-"));
  let calls = 0;
  try {
    const outcome = await runLegalSearch({
        search_term: "example",
        provider: "scholar",
        jurisdiction: "all",
        pages_to_search: 3,
        resume_page: 3,
        max_cases_to_download: 0,
      },
      undefined,
      undefined,
      { cwd: directory } as never,
      fakeRuntime(async () => {
        calls += 1;
        if (calls === 2) throw new Error("Provider verification required");
        return { results: Array.from({ length: 20 }, (_, index) => scholarResult(index + 1)) };
      }),
    );
    assert.equal(outcome.status, "stopped");
    assert.equal(outcome.phase, "search");
    assert.deepEqual(outcome.completedPages, [3]);
    assert.equal(outcome.resumePage, 4);
    assert.equal(outcome.pagesRemaining, 2);
    assert.match(outcome.stopReason ?? "", /verification/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("positive download maximum annotates downloaded and unselected parsed results", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-search-downloads-"));
  let downloads = 0;
  try {
    const outcome = await runLegalSearch({
        search_term: "example",
        provider: "scholar",
        jurisdiction: "all",
        max_cases_to_download: 1,
      },
      undefined,
      undefined,
      { cwd: directory } as never,
      fakeRuntime(
        async () => ({
          results: [
            scholarResult(1),
            { ...scholarResult(2), meta: scholarResult(1).meta },
            scholarResult(3),
          ],
          reachedEnd: true,
        }),
        async (item) => {
          downloads += 1;
          return {
            case: item,
            status: "downloaded",
            saved: {
              provider: "scholar",
              providerId: item.sources[0].providerId,
              sourceUrl: item.sources[0].url,
              title: item.title,
              savedPath: join(directory, "Cases", item.canonicalKey, "opinion.html"),
            },
          };
        },
      ),
    );
    assert.equal(downloads, 1);
    assert.equal(outcome.results[0].download_status, "downloaded");
    assert.equal(outcome.results[1].download_status, "downloaded");
    assert.equal(outcome.results[1].case_key, outcome.results[0].case_key);
    assert.equal(outcome.results[2].download_status, "not_selected");
    assert.equal(outcome.downloadSummary.maximum, 1);
    assert.equal(outcome.downloadSummary.downloaded, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legal_search downloads from the live result page before clicking through to the next page", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-search-navigation-order-"));
  const events: string[] = [];
  try {
    const outcome = await runLegalSearch({
        search_term: "example",
        provider: "scholar",
        jurisdiction: "all",
        pages_to_search: 2,
        max_cases_to_download: 1,
      },
      undefined,
      undefined,
      { cwd: directory } as never,
      fakeRuntime(
        async (_provider, params, navigationSession) => {
          events.push(params.page === 1 ? "search-page-1" : "search-page-2");
          assert.match(navigationSession ?? "", /^legal_search:scholar:/);
          return params.page === 1
            ? { results: [scholarResult(1)] }
            : { results: [scholarResult(2)], reachedEnd: true };
        },
        async (item) => {
          events.push("click-save-back-result-1");
          return {
            case: item,
            status: "downloaded",
            saved: {
              provider: "scholar",
              providerId: item.sources[0].providerId,
              sourceUrl: item.sources[0].url,
              title: item.title,
              savedPath: join(directory, "Cases", "case-1.html"),
            },
          };
        },
      ),
    );

    assert.deepEqual(events, ["search-page-1", "click-save-back-result-1", "search-page-2"]);
    assert.equal(outcome.downloadSummary.downloaded, 1);
    assert.deepEqual(outcome.completedPages, [1, 2]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("-1 downloads every unique case discovered by the call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-search-download-all-"));
  let downloads = 0;
  try {
    const outcome = await runLegalSearch({
        search_term: "example",
        provider: "scholar",
        jurisdiction: "all",
        pages_to_search: -1,
        max_cases_to_download: -1,
      },
      undefined,
      undefined,
      { cwd: directory } as never,
      fakeRuntime(
        async () => ({ results: [scholarResult(1), scholarResult(2)], reachedEnd: true }),
        async (item) => {
          downloads += 1;
          return {
            case: item,
            status: "downloaded",
            saved: {
              provider: "scholar",
              providerId: item.sources[0].providerId,
              sourceUrl: item.sources[0].url,
              title: item.title,
              savedPath: join(directory, "Cases", item.canonicalKey, "opinion.html"),
            },
          };
        },
      ),
    );
    assert.equal(downloads, 2);
    assert.equal(outcome.providerExhausted, true);
    assert.equal(outcome.providerPageCapReached, false);
    assert.equal(outcome.downloadSummary.maximum, -1);
    assert.ok(outcome.results.every((item) => item.download_status === "downloaded"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Scholar's page cap is not reported as provider exhaustion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-search-scholar-cap-"));
  try {
    const outcome = await runLegalSearch({
        search_term: "example",
        provider: "scholar",
        jurisdiction: "all",
        pages_to_search: -1,
        resume_page: 50,
        max_cases_to_download: 0,
      },
      undefined,
      undefined,
      { cwd: directory } as never,
      fakeRuntime(async () => ({
        results: Array.from({ length: 20 }, (_, index) => scholarResult(index + 1)),
        // The legacy Scholar adapter used to conflate its hard page cap with
        // provider exhaustion. The public workflow must reject that signal.
        reachedEnd: true,
      })),
    );
    assert.equal(outcome.status, "completed");
    assert.equal(outcome.providerExhausted, false);
    assert.equal(outcome.providerPageCapReached, true);
    assert.match(legalSearchOutcomeText(outcome), /50-page exposure cap reached; provider exhaustion not proven/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a short final Scholar page is still reported as provider exhaustion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-search-scholar-end-"));
  try {
    const outcome = await runLegalSearch({
        search_term: "example",
        provider: "scholar",
        jurisdiction: "all",
        pages_to_search: -1,
        resume_page: 50,
        max_cases_to_download: 0,
      },
      undefined,
      undefined,
      { cwd: directory } as never,
      fakeRuntime(async () => ({
        results: Array.from({ length: 19 }, (_, index) => scholarResult(index + 1)),
        reachedEnd: true,
      })),
    );
    assert.equal(outcome.status, "completed");
    assert.equal(outcome.providerExhausted, true);
    assert.equal(outcome.providerPageCapReached, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an already-aborted search returns its start page without provider work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-search-aborted-"));
  const controller = new AbortController();
  controller.abort();
  try {
    const outcome = await runLegalSearch({
        search_term: "example",
        provider: "courtlistener",
        jurisdiction: "all",
        pages_to_search: -1,
        resume_page: 5,
        max_cases_to_download: 0,
      },
      controller.signal,
      undefined,
      { cwd: directory } as never,
      fakeRuntime(async () => { throw new Error("provider should not be called"); }),
    );
    assert.equal(outcome.resumePage, 5);
    assert.equal(outcome.pagesRemaining, -1);
    assert.equal(outcome.resultCount, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
