import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { ensureDirectory, extractOpinionText, opinionMetadataMarkdownPath, readMarkdownMetadata, type NormalizedCase, type ProviderId } from "./core.ts";
import type { SavedOpinion } from "./providers.ts";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Navigation cleanup must never discard an already persisted acquisition. */
export async function restoreSavedCapture<T extends object>(capture: T, restore: () => Promise<unknown>): Promise<T & { returnedToResults: boolean; restorationError?: string }> {
  try { await restore(); return { ...capture, returnedToResults: true }; }
  catch (error) { return { ...capture, returnedToResults: false, restorationError: error instanceof Error ? error.message : String(error) }; }
}

/** Originals and sidecars are never replaced. Changed captures get a new path. */
export function saveOpinionCapture(path: string, html: string): string {
  ensureDirectory(dirname(path));
  const digest = sha256(html);
  const extension = extname(path);
  const stem = path.slice(0, -extension.length);
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? path : `${stem}--${digest.slice(0, 12)}${attempt === 1 ? "" : `-${randomUUID().slice(0, 8)}`}${extension}`;
    const metadata = opinionMetadataMarkdownPath(candidate);
    if (existsSync(candidate)) {
      if (!lstatSync(candidate).isFile() || sha256(readFileSync(candidate)) !== digest) continue;
      // An existing sidecar must attest to this exact capture before reuse.
      if (existsSync(metadata)) {
        try {
          const record = readMarkdownMetadata<LibraryRecord>(metadata);
          if (record.source?.htmlSha256 !== digest) continue;
        } catch { continue; }
      }
      return candidate;
    }
    if (existsSync(metadata)) continue;
    try { writeFileSync(candidate, html, { encoding: "utf8", flag: "wx" }); return candidate; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  throw new Error("Could not allocate a new opinion version without replacing existing files.");
}

export interface LibraryRecord {
  case: NormalizedCase;
  source: SavedOpinion;
  downloadedAt?: string;
}
export interface LibraryEntry { metadataPath: string; record: LibraryRecord }
export interface Integrity {
  status: "valid" | "missing" | "unreadable" | "empty" | "changed" | "unverified";
  reason?: string;
  htmlSha256?: string;
  textSha256?: string;
}

export function checkOpinionIntegrity(source: Partial<SavedOpinion> | undefined, root?: string): Integrity {
  if (!source?.savedPath || !existsSync(source.savedPath)) return { status: "missing", reason: "Saved opinion file is missing." };
  try {
    if (!lstatSync(source.savedPath).isFile()) return { status: "unreadable", reason: "Saved opinion is not a regular file." };
    if (root) {
      const fromRoot = relative(realpathSync(root), realpathSync(source.savedPath));
      if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
        return { status: "unreadable", reason: "Saved opinion resolves outside the case library." };
      }
    }
    if (statSync(source.savedPath).size > 50_000_000) return { status: "unreadable", reason: "Opinion exceeds the 50 MB inspection limit." };
    const bytes = readFileSync(source.savedPath);
    const text = extractOpinionText(bytes.toString("utf8"), source.provider).replace(/\s+/g, " ").trim();
    if (text.length < 200) return { status: "empty", reason: "Saved file contains less than 200 characters of usable opinion text." };
    const hashes = { htmlSha256: sha256(bytes), textSha256: sha256(text) };
    if (!source.htmlSha256) return { status: "unverified", reason: "No original content hash is recorded; acquire a preserved, hashed capture before reuse.", ...hashes };
    if (source.htmlSha256 !== hashes.htmlSha256 || (source.textSha256 && source.textSha256 !== hashes.textSha256)) {
      return { status: "changed", reason: "Saved content no longer matches its recorded hash; original metadata was preserved.", ...hashes };
    }
    return { status: "valid", ...hashes };
  } catch (error) { return { status: "unreadable", reason: error instanceof Error ? error.message : String(error) }; }
}

/** Includes older nested libraries. Never follows directory junctions/symlinks. */
export function libraryEntries(root: string): { entries: LibraryEntry[]; warnings: string[] } {
  const entries: LibraryEntry[] = [];
  const warnings: string[] = [];
  if (!existsSync(root)) return { entries, warnings };
  const queue = [root];
  let visited = 0;
  while (queue.length) {
    const directory = queue.shift()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 20000) return { entries, warnings: [...warnings, "Library scan stopped at 20,000 entries; results are incomplete."] };
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) { warnings.push(`Skipped linked path: ${path}`); continue; }
      if (entry.isDirectory()) { queue.push(path); continue; }
      if (!entry.isFile() || (!entry.name.endsWith(".md") && entry.name !== "case.json")) continue;
      try {
        const record = entry.name === "case.json" ? JSON.parse(readFileSync(path, "utf8")) as LibraryRecord : readMarkdownMetadata<LibraryRecord>(path);
        if (!record.case?.canonicalKey || !Array.isArray(record.case.sources) || !record.source?.savedPath) continue;
        if (entry.name !== "case.json" && resolve(path) !== resolve(opinionMetadataMarkdownPath(record.source.savedPath))) {
          warnings.push(`Metadata is not paired with its recorded opinion: ${path}`); continue;
        }
        entries.push({ metadataPath: path, record });
      } catch (error) {
        if (entry.name === "case.json" || existsSync(path.replace(/\.md$/, ".html"))) warnings.push(`Unreadable metadata: ${path}: ${String(error)}`);
      }
    }
  }
  entries.sort((a, b) => (b.record.downloadedAt ?? "").localeCompare(a.record.downloadedAt ?? ""));
  return { entries, warnings };
}

export function findSavedOpinion(root: string, item: NormalizedCase, provider?: ProviderId): { saved?: SavedOpinion; warnings: string[] } {
  const scan = libraryEntries(root);
  const warnings = [...scan.warnings];
  for (const { record } of scan.entries) {
    if (record.case.canonicalKey !== item.canonicalKey || (provider && record.source.provider !== provider)) continue;
    const integrity = checkOpinionIntegrity(record.source, root);
    if (integrity.status === "valid") return { saved: record.source, warnings };
    warnings.push(`${record.source.savedPath}: ${integrity.reason}`);
  }
  return { warnings };
}

export function matchingPassage(text: string, query: string, radius = 180): string | undefined {
  const compact = text.replace(/\s+/g, " ").trim();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const position = terms.map(term => compact.toLowerCase().indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0];
  if (position === undefined) return undefined;
  const start = Math.max(0, position - radius);
  const end = Math.min(compact.length, position + radius);
  return `${start ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

export function searchLibrary(cwd: string, options: { query?: string; case_key?: string; court?: string; limit?: number; offset?: number }) {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error("limit must be 1–100 and offset a nonnegative integer.");
  const root = join(cwd, "Cases");
  const scan = libraryEntries(root);
  const terms = (options.query ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const results = scan.entries.flatMap(({ metadataPath, record }) => {
    const item = record.case;
    if (options.case_key && item.canonicalKey !== options.case_key) return [];
    if (options.court && !(item.court ?? "").toLowerCase().includes(options.court.toLowerCase())) return [];
    const integrity = checkOpinionIntegrity(record.source, root);
    const text = integrity.status === "valid" ? extractOpinionText(readFileSync(record.source.savedPath, "utf8"), record.source.provider) : "";
    const searchable = [item.title, ...item.citations, item.court, item.dateFiled, item.year, text].join(" ").toLowerCase();
    if (!terms.every(term => searchable.includes(term))) return [];
    return [{ case_key: item.canonicalKey, title: item.title, citations: item.citations, court: item.court ?? null, date: item.dateFiled ?? item.year ?? null,
      publication_status: item.publicationStatus ?? null, source_path: record.source.savedPath, metadata_path: metadataPath,
      provider: record.source.provider, source_url: record.source.sourceUrl, downloaded_at: record.downloadedAt ?? null,
      html_sha256: record.source.htmlSha256 ?? null, integrity, matching_passage: matchingPassage(text, options.query ?? "") ?? null }];
  });
  return { libraryRoot: root, totalVersions: results.length, offset, nextOffset: offset + limit < results.length ? offset + limit : null,
    results: results.slice(offset, offset + limit), warnings: scan.warnings };
}
