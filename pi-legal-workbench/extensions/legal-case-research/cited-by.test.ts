import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  classifyCitedByProviderStatuses,
  effectiveScholarYears,
  nextRunnableCitedByProvider,
  runCitedByReport,
  scholarChildren,
} from "./cited-by.ts";
import type { NormalizedCase } from "./core.ts";

function exampleSeed(): NormalizedCase {
  return {
    canonicalKey: "seed--1",
    title: "Seed v. Case",
    citations: [],
    normalizedCitations: [],
    sources: [{
      provider: "scholar",
      providerId: "1",
      citedById: "1",
      url: "https://scholar.google.com/scholar_case?case=1",
      discoveredBy: "search",
    }],
  };
}

test("generated Scholar partitions inherit filed-date bounds", () => {
  const root = { id: "root", nextOffset: 980, pagesCompleted: 50 };
  const filters = { filed_after: "1990-01-01", filed_before: "2000-12-31" };
  assert.deepEqual(effectiveScholarYears(root, filters), { low: 1990, high: 2000 });
  const courts = scholarChildren(root, filters)!;
  assert.ok(courts.length > 50);
  assert.ok(courts.every((partition) => partition.yearLo === 1990 && partition.yearHi === 2000));
  const years = scholarChildren(courts[0], filters)!;
  assert.deepEqual(years.map((partition) => [partition.yearLo, partition.yearHi]), [[1990, 1995], [1996, 2000]]);
});

test("an indivisible Scholar year partition cannot be split forever", () => {
  const partition = { id: "one", court: "california", yearLo: 2000, yearHi: 2000, nextOffset: 980, pagesCompleted: 50 };
  assert.equal(scholarChildren(partition, {}), undefined);
});

test("a paused Scholar does not starve a runnable CourtListener", () => {
  assert.equal(nextRunnableCitedByProvider(
    ["scholar", "courtlistener"],
    { scholar: { status: "paused" }, courtlistener: { status: "running" } },
  ), "courtlistener");
});

test("completion depends only on the providers selected for this seed", () => {
  assert.equal(classifyCitedByProviderStatuses(["exhausted"], false, false), "complete");
  assert.equal(classifyCitedByProviderStatuses(["exhausted", "blocked"], false, false), "incomplete");
});

test("fresh cited-by sessions refuse to clobber a manifest", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-research-cited-clobber-"));
  try {
    writeFileSync(join(directory, "cited-by-manifest.json"), "{}", "utf8");
    await assert.rejects(() => runCitedByReport({
      seed: exampleSeed(),
      providers: ["scholar"],
      save_path: directory,
    }, undefined, undefined, { cwd: directory } as never), /already exists/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cited-by provider page limits are validated before seed resolution", async () => {
  await assert.rejects(() => runCitedByReport({
    seed: exampleSeed(),
    max_pages_per_provider: 0,
  }, undefined, undefined, { cwd: "." } as never), /max_pages_per_provider must be/);
});

test("cited-by resume may raise but not lower its saved download limit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-research-cited-download-limit-"));
  const manifestPath = join(directory, "cited-by-manifest.json");
  try {
    writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 2,
      mode: "cited_by",
      requestFingerprint: "saved",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      status: "incomplete",
      seed: {
        canonicalKey: "seed--1",
        title: "Seed v. Case",
        citations: [],
        normalizedCitations: [],
        sources: [],
      },
      requestedProviders: [],
      filters: {},
      providers: {},
      rawResults: 0,
      recordCount: 0,
      resultsFile: "cited-by-results.json",
      journalFile: "cited-by-events.jsonl",
      reportFiles: [],
      maxPagesPerProvider: 1,
      downloadLimit: 5,
    }), "utf8");
    await assert.rejects(() => runCitedByReport({
      resume_from: manifestPath,
      download_limit: 4,
    }, undefined, undefined, { cwd: directory } as never), /download_limit cannot lower the saved download limit/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cited-by resume may raise finite page and download limits to all", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-research-cited-all-"));
  const manifestPath = join(directory, "cited-by-manifest.json");
  try {
    writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 2,
      mode: "cited_by",
      requestFingerprint: "saved",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      status: "incomplete",
      seed: {
        canonicalKey: "seed--1",
        title: "Seed v. Case",
        citations: [],
        normalizedCitations: [],
        sources: [],
      },
      requestedProviders: [],
      filters: {},
      providers: {},
      rawResults: 0,
      recordCount: 0,
      resultsFile: "cited-by-results.json",
      journalFile: "cited-by-events.jsonl",
      reportFiles: [],
      maxPagesPerProvider: 1,
      downloadLimit: 5,
    }), "utf8");
    await runCitedByReport({
      resume_from: manifestPath,
      max_pages_per_provider: -1,
      download_limit: -1,
    }, undefined, undefined, { cwd: directory } as never);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.maxPagesPerProvider, undefined);
    assert.equal(manifest.downloadLimit, -1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cited-by resume preserves legacy unlimited download behavior", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legal-research-cited-legacy-all-"));
  const manifestPath = join(directory, "cited-by-manifest.json");
  try {
    writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 2,
      mode: "cited_by",
      requestFingerprint: "saved",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      status: "incomplete",
      seed: {
        canonicalKey: "seed--1",
        title: "Seed v. Case",
        citations: [],
        normalizedCitations: [],
        sources: [],
      },
      requestedProviders: [],
      filters: {},
      providers: {},
      rawResults: 0,
      recordCount: 0,
      resultsFile: "cited-by-results.json",
      journalFile: "cited-by-events.jsonl",
      reportFiles: [],
    }), "utf8");
    const outcome = await runCitedByReport({
      resume_from: manifestPath,
    }, undefined, undefined, { cwd: directory } as never);
    assert.equal(outcome.downloadLimit, -1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a fresh cited-by run requires a seed and a save path before any browser work", async () => {
  await assert.rejects(() => runCitedByReport({
    providers: ["scholar"],
    save_path: "unused",
  }, undefined, undefined, { cwd: "." } as never), /seed is required/);
  await assert.rejects(() => runCitedByReport({
    seed: exampleSeed(),
    providers: ["scholar"],
  }, undefined, undefined, { cwd: "." } as never), /save_path is required/);
});
