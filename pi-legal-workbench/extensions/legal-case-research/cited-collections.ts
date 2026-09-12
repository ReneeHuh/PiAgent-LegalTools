import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { ensureDirectory, readJsonFile, shortHash, slugify, type NormalizedCase } from "./core.ts";

export interface CitedCollection {
  runId: string;
  directory: string;
  manifestPath: string;
  caseKey: string;
  createdAt: string;
  lastRetrievedAt?: string;
  status: string;
}
export function listCitedCollections(cwd: string, caseKey?: string, includeCitingResults = false): CitedCollection[] {
  const candidates: string[] = [];
  const root = join(cwd, "Research", "CitedBy");
  if (existsSync(root)) for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory() || group.isSymbolicLink()) continue;
    for (const run of readdirSync(join(root, group.name), { withFileTypes: true })) {
      if (run.isDirectory() && !run.isSymbolicLink()) candidates.push(join(root, group.name, run.name));
    }
  }
  // Old collections remain in place and can still be resumed.
  for (const parent of [join(cwd, "Cases"), cwd]) {
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && /^Citations for /i.test(entry.name)) candidates.push(join(parent, entry.name));
    }
  }
  const results: CitedCollection[] = [];
  for (const directory of candidates) {
    const manifestPath = join(directory, "cited-by-manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const fromWorkspace = relative(realpathSync(cwd), realpathSync(directory));
      if (fromWorkspace === ".." || fromWorkspace.startsWith(`..${sep}`) || isAbsolute(fromWorkspace)) continue;
      const data = readJsonFile<{ mode?: string; seed?: NormalizedCase; createdAt?: string; lastRetrievedAt?: string; status?: string }>(manifestPath);
      if (data.mode !== "cited_by" || !data.seed?.canonicalKey) continue;
      if (caseKey && data.seed.canonicalKey !== caseKey) {
        const resultsPath = join(directory, "cited-by-results.json");
        if (!includeCitingResults || !existsSync(resultsPath) || !readJsonFile<NormalizedCase[]>(resultsPath).some(item => item.canonicalKey === caseKey)) continue;
      }
      results.push({ runId: directory.split(/[\\/]/).at(-1)!, directory, manifestPath, caseKey: data.seed.canonicalKey,
        createdAt: data.createdAt ?? "", lastRetrievedAt: data.lastRetrievedAt, status: data.status ?? "unknown" });
    } catch { /* An unrelated or malformed directory is not a resumable collection. */ }
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId));
}
export function newCitedCollectionDirectory(cwd: string, seed: NormalizedCase): string {
  const parent = ensureDirectory(join(cwd, "Research", "CitedBy", `${slugify(seed.title).slice(0, 35)}--${shortHash(seed.canonicalKey)}`));
  const fromWorkspace = relative(realpathSync(cwd), realpathSync(parent));
  if (fromWorkspace === ".." || fromWorkspace.startsWith(`..${sep}`) || isAbsolute(fromWorkspace)) throw new Error("Cited-by storage resolves outside the workspace.");
  return join(parent, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
}
