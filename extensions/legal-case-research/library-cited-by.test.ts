import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ensureDirectory,
  writeJsonAtomic,
  writeMarkdownMetadata,
  writeTextAtomic,
  type NormalizedCase,
} from "./core.ts";
import {
  citedByProvidersForSeed,
  citationCollectionDirectory,
  citationCollectionFolderName,
  classifyLegalCitedByStatus,
  legalCitedByLimits,
  loadSavedCitedBySeed,
  runLegalCitedBy,
} from "./library-cited-by.ts";

import { sha256 } from "./library.ts";
const fixtureHtml = (provider: string) => `<div id="${provider === "scholar" ? "gs_opinion" : "opinion-content"}">${"Synthetic saved opinion text for a software test. ".repeat(10)}</div>`;

const seed: NormalizedCase = {
  canonicalKey: "example-v-state--1234567890",
  title: "Example v. State",
  citations: ["1 Example 2"],
  normalizedCitations: ["1:example:2"],
  sources: [{
    provider: "scholar",
    providerId: "123",
    citedById: "123",
    url: "https://scholar.google.com/scholar_case?case=123",
    discoveredBy: "search",
  }],
};

test("legal_cited_by requires a case already saved in the Cases library", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-cited-library-"));
  try {
    await assert.rejects(() => runLegalCitedBy({
      action: "collect",
      case_key: seed.canonicalKey,
    }, undefined, undefined, { cwd: directory } as never), /No saved case metadata exists/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed-download metadata cannot pass the cited-by seed gate", () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-cited-failed-seed-"));
  try {
    const casesDirectory = ensureDirectory(join(directory, "Cases"));
    writeMarkdownMetadata(
      join(casesDirectory, `.download-error-${seed.canonicalKey}.md`),
      `Failed download: ${seed.title}`,
      { schemaVersion: 1, failedAt: new Date().toISOString(), case: seed },
    );
    assert.throws(
      () => loadSavedCitedBySeed({ cwd: directory } as never, seed.canonicalKey),
      /No successfully saved opinion exists/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the seed gate requires paired HTML and merges saved provider identifiers", () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-cited-saved-seed-"));
  try {
    const casesDirectory = ensureDirectory(join(directory, "Cases"));
    const scholarPath = join(casesDirectory, "example-v-state-123.html");
    writeTextAtomic(scholarPath, fixtureHtml("scholar"));
    writeMarkdownMetadata(scholarPath.replace(/\.html$/, ".md"), seed.title, {
      schemaVersion: 1,
      downloadedAt: new Date().toISOString(),
      case: seed,
      source: { provider: "scholar", savedPath: scholarPath, htmlSha256: sha256(readFileSync(scholarPath)) },
    });

    const courtListenerSeed: NormalizedCase = {
      ...seed,
      sources: [{
        provider: "courtlistener",
        providerId: "456",
        citedById: "456",
        url: "https://www.courtlistener.com/opinion/456/example-v-state/",
        discoveredBy: "search",
      }],
    };
    const courtListenerPath = join(casesDirectory, "example-v-state-456.html");
    writeTextAtomic(courtListenerPath, fixtureHtml("courtlistener"));
    writeMarkdownMetadata(courtListenerPath.replace(/\.html$/, ".md"), seed.title, {
      schemaVersion: 1,
      downloadedAt: new Date().toISOString(),
      case: courtListenerSeed,
      source: { provider: "courtlistener", savedPath: courtListenerPath, htmlSha256: sha256(readFileSync(courtListenerPath)) },
    });

    const loaded = loadSavedCitedBySeed({ cwd: directory } as never, seed.canonicalKey);
    assert.equal(loaded.sources.length, 2);
    assert.deepEqual(citedByProvidersForSeed(loaded), ["scholar", "courtlistener"]);
    assert.deepEqual(citedByProvidersForSeed(courtListenerSeed), ["courtlistener"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cited-by collections use Cases/Citations for case-name without a hash folder", () => {
  assert.equal(citationCollectionFolderName(seed), "Citations for Example v. State");
  assert.doesNotMatch(citationCollectionFolderName({ ...seed, title: "A/B: Test?" }), /[\\/:?]/);
  const matterDirectory = join(process.cwd(), "workspace", "matter");
  assert.equal(
    citationCollectionDirectory({ cwd: matterDirectory } as never, seed),
    join(matterDirectory, "Cases", citationCollectionFolderName(seed)),
  );
  assert.match(citationCollectionDirectory({ cwd: process.cwd() } as never, seed), /[\\/]Cases[\\/]Citations for Example v\. State$/);
});

test("new dated collections preserve older same-title folders", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-cited-title-collision-"));
  try {
    const casesDirectory = ensureDirectory(join(directory, "Cases"));
    const opinionPath = join(casesDirectory, "example-v-state-123.html");
    writeTextAtomic(opinionPath, fixtureHtml("scholar"));
    writeMarkdownMetadata(opinionPath.replace(/\.html$/, ".md"), seed.title, {
      schemaVersion: 1,
      downloadedAt: new Date().toISOString(),
      case: seed,
      source: { provider: "scholar", savedPath: opinionPath, htmlSha256: sha256(readFileSync(opinionPath)) },
    });
    const preferred = ensureDirectory(citationCollectionDirectory({ cwd: directory } as never, seed));
    writeTextAtomic(join(preferred, "belongs-to-another-seed.txt"), "preserve me");
    const controller = new AbortController();
    controller.abort();

    const outcome = await runLegalCitedBy({
      action: "collect",
      case_key: seed.canonicalKey,
      pages_to_search: 1,
      max_cases_to_download: 0,
    }, controller.signal, undefined, { cwd: directory } as never);

    assert.notEqual(outcome.directory, preferred);
    assert.ok(outcome.directory.includes("CitedBy"));
    assert.ok(outcome.runId);
    assert.equal(existsSync(join(outcome.directory, "cited-by-manifest.json")), true);
    assert.equal(existsSync(join(preferred, "belongs-to-another-seed.txt")), true);
    assert.deepEqual(outcome.selectedProviders, ["scholar"]);
    assert.deepEqual(outcome.unavailableProviders, ["courtlistener"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("incomplete cited-by enumeration is never labeled completed", () => {
  assert.equal(classifyLegalCitedByStatus("incomplete", false, 0), "incomplete");
  assert.equal(classifyLegalCitedByStatus("incomplete", false, 2), "incomplete");
  assert.equal(classifyLegalCitedByStatus("complete", false, 0), "completed");
  assert.equal(classifyLegalCitedByStatus("complete", true, 0), "paused");
});

test("cited-by discovery defaults to all pages while downloads remain bounded", () => {
  assert.deepEqual(legalCitedByLimits({
    action: "collect",
    case_key: seed.canonicalKey,
  }), { pagesToSearch: -1, maxCasesToDownload: 5, runtimeLimitMinutes: undefined });
  assert.deepEqual(legalCitedByLimits({
    action: "collect",
    case_key: seed.canonicalKey,
    pages_to_search: -1,
    max_cases_to_download: -1,
    runtime_limit_minutes: 45,
  }), { pagesToSearch: -1, maxCasesToDownload: -1, runtimeLimitMinutes: 45 });
});

test("cited-by rejects the former public limit names", async () => {
  await assert.rejects(() => runLegalCitedBy({
    action: "collect",
    case_key: seed.canonicalKey,
    page_limit_per_provider: 1,
    download_limit: 5,
  } as never, undefined, undefined, { cwd: "." } as never), /does not accept: page_limit_per_provider, download_limit/);
});

test("legal_cited_by validates page depth before creating its collection folder", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-cited-pages-"));
  try {
    const casesDirectory = ensureDirectory(join(directory, "Cases"));
    writeMarkdownMetadata(join(casesDirectory, "Example v. State.md"), seed.title, { schemaVersion: 1, case: seed });
    await assert.rejects(() => runLegalCitedBy({
      action: "collect",
      case_key: seed.canonicalKey,
      pages_to_search: 0,
    }, undefined, undefined, { cwd: directory } as never), /pages_to_search must be/);
    await assert.rejects(() => runLegalCitedBy({
      action: "collect",
      case_key: seed.canonicalKey,
      max_cases_to_download: 2001,
    }, undefined, undefined, { cwd: directory } as never), /max_cases_to_download must be/);
    assert.equal(existsSync(join(directory, "Cases", citationCollectionFolderName(seed))), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legal_cited_by rejects invalid runtime and year ranges before browser work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-cited-validation-"));
  try {
    const seedDirectory = ensureDirectory(join(directory, "Cases", seed.canonicalKey));
    writeJsonAtomic(join(seedDirectory, "case.json"), { schemaVersion: 1, case: seed });
    await assert.rejects(() => runLegalCitedBy({
      action: "collect",
      case_key: seed.canonicalKey,
      runtime_limit_minutes: 0,
    }, undefined, undefined, { cwd: directory } as never), /runtime_limit_minutes must be/);
    await assert.rejects(() => runLegalCitedBy({
      action: "collect",
      case_key: seed.canonicalKey,
      year_from: 2025,
      year_to: 2020,
    }, undefined, undefined, { cwd: directory } as never), /year_from cannot be later/);
    await assert.rejects(() => runLegalCitedBy({
      action: "collect",
      case_key: seed.canonicalKey,
      summary_model: "lmstudio/summary-model",
    } as never, undefined, undefined, { cwd: directory } as never), /action=collect does not accept: summary_model/);
    assert.equal(existsSync(join(directory, "Cases", citationCollectionFolderName(seed))), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
