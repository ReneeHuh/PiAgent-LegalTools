import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DIRECT_SELECTION_RETENTION_MS,
  directCandidateKey,
  pruneDirectSelections,
  renderDirectResultsHtml,
  runDirectDownload,
} from "./direct-download.ts";
import { ensureDirectory, writeJsonAtomic, type NormalizedCase } from "./core.ts";

function candidate(): NormalizedCase {
  return {
    canonicalKey: "miranda--1",
    title: "Miranda v. Arizona",
    citations: ["384 U.S. 436"],
    normalizedCitations: ["384-us-436"],
    court: "Supreme Court of the United States",
    year: "1966",
    sources: [{
      provider: "scholar",
      providerId: "1",
      url: "https://scholar.google.com/scholar_case?case=1",
      discoveredBy: "search",
    }],
  };
}

test("direct result HTML contains the exact supported opinion link", () => {
  const html = renderDirectResultsHtml("Miranda v. Arizona", "us supreme court", [candidate()]);
  assert.match(html, /<!doctype html>/);
  assert.match(html, /href="https:\/\/scholar\.google\.com\/scholar_case\?case=1"/);
  assert.match(html, /384 U\.S\. 436/);
  assert.match(html, /"action":"download"/);
  assert.match(html, /selection_handle/);
  assert.match(html, /candidate_key/);
  assert.match(html, /untrusted external data/i);
  assert.equal(directCandidateKey(candidate().sources[0]), "scholar:1");
});

test("direct_download search requires both case name and jurisdiction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "direct-download-input-"));
  try {
    await assert.rejects(() => runDirectDownload({ action: "find", case_name: "Miranda v. Arizona" } as never,
      undefined,
      undefined,
      { cwd: directory } as never,
    ), /jurisdiction is required[\s\S]*Valid jurisdiction keys: all, alabama[\s\S]*federal circuit/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("direct_download rejects raw links and requires a saved selection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "direct-download-link-"));
  try {
    await assert.rejects(() => runDirectDownload({
        action: "download",
        link: "https://scholar.google.com/scholar_case?case=1",
        case_name: "Miranda",
      } as never,
      undefined,
      undefined,
      { cwd: directory } as never,
    ), /action=download does not accept: link, case_name/);
    await assert.rejects(() => runDirectDownload({ action: "download", selection_handle: "k7m2q9tx", candidate_key: "scholar:1" },
      undefined,
      undefined,
      { cwd: directory } as never,
    ), /No direct-download selection exists/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("direct_download refuses a candidate from a different saved selection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "direct-download-bound-"));
  try {
    const handle = "k7m2q9tx";
    const selectedCase = candidate();
    const root = ensureDirectory(join(directory, "Cases", "_direct_selections"));
    writeJsonAtomic(join(root, `${handle}.json`), {
      schemaVersion: 1,
      selectionHandle: handle,
      createdAt: new Date().toISOString(),
      caseName: selectedCase.title,
      jurisdiction: "us supreme court",
      candidates: [{ candidateKey: "scholar:1", case: selectedCase, source: selectedCase.sources[0] }],
    });
    await assert.rejects(() => runDirectDownload({ action: "download", selection_handle: handle, candidate_key: "courtlistener:2" },
      undefined,
      undefined,
      { cwd: directory } as never,
    ), /does not belong to selection/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("direct_download fails closed when another call already claimed the selection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "direct-download-claimed-"));
  try {
    const handle = "k7m2q9tx";
    const selectedCase = candidate();
    const root = ensureDirectory(join(directory, "Cases", "_direct_selections"));
    writeJsonAtomic(join(root, `${handle}.json`), {
      schemaVersion: 1,
      selectionHandle: handle,
      createdAt: new Date().toISOString(),
      claimedAt: new Date().toISOString(),
      caseName: selectedCase.title,
      jurisdiction: "us supreme court",
      candidates: [{ candidateKey: "scholar:1", case: selectedCase, source: selectedCase.sources[0] }],
    });
    await assert.rejects(() => runDirectDownload({ action: "download", selection_handle: handle, candidate_key: "scholar:1" },
      undefined,
      undefined,
      { cwd: directory } as never,
    ), /already being used/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("direct_download rejects removed summary settings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "direct-download-removed-fields-"));
  try {
    await assert.rejects(() => runDirectDownload({
        action: "find",
        case_name: "Miranda v. Arizona",
        jurisdiction: "us supreme court",
        summarize_after_download: true,
      } as never,
      undefined,
      undefined,
      { cwd: directory } as never,
    ), /action=find does not accept: summarize_after_download/);
    await assert.rejects(() => runDirectDownload({
        action: "download",
        selection_handle: "k7m2q9tx",
        candidate_key: "scholar:1",
        summary_model: "lmstudio/summary-model",
      } as never,
      undefined,
      undefined,
      { cwd: directory } as never,
    ), /action=download does not accept: summary_model/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("used and stale direct-download selections are pruned while live ones remain", () => {
  const directory = mkdtempSync(join(tmpdir(), "direct-download-prune-"));
  try {
    const root = ensureDirectory(join(directory, "Cases", "_direct_selections"));
    const now = Date.parse("2026-09-05T00:00:00Z");
    const selection = (handle: string, extra: Record<string, unknown>) => ({
      schemaVersion: 1,
      selectionHandle: handle,
      caseName: "Example",
      jurisdiction: "all",
      candidates: [],
      ...extra,
    });
    writeJsonAtomic(join(root, "aaaaaaaa.json"), selection("aaaaaaaa", { createdAt: new Date(now - 60_000).toISOString() }));
    writeJsonAtomic(join(root, "bbbbbbbb.json"), selection("bbbbbbbb", {
      createdAt: new Date(now - 60_000).toISOString(),
      usedAt: new Date(now).toISOString(),
    }));
    writeJsonAtomic(join(root, "cccccccc.json"), selection("cccccccc", {
      createdAt: new Date(now - DIRECT_SELECTION_RETENTION_MS - 1).toISOString(),
    }));
    writeFileSync(join(root, "notes.txt"), "keep me", "utf8");
    assert.equal(pruneDirectSelections(root, now), 2);
    assert.equal(existsSync(join(root, "aaaaaaaa.json")), true);
    assert.equal(existsSync(join(root, "bbbbbbbb.json")), false);
    assert.equal(existsSync(join(root, "cccccccc.json")), false);
    assert.equal(existsSync(join(root, "notes.txt")), true);
    assert.equal(pruneDirectSelections(join(directory, "missing"), now), 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
