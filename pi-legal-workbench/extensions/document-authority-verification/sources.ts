import { isSummaryArtifact } from "../shared/opinion-markdown.ts";
import { readOpinionMetadata } from "../shared/opinion-markdown.ts";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { loadCaseSource, type LoadedCaseSource } from "../case-summarizer/source.ts";
import { normalizeCaseName, normalizeReporterCitation } from "./citations.ts";
import type {
  CaseSourceIdentity,
  CaseSourceRecord,
  SourceCoverage,
  VerificationCaseSourceInput,
} from "./types.ts";

const MAX_INDEXED_SOURCES = 1_000;
const CASE_EXTENSIONS = new Set([".html", ".htm", ".md", ".txt"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".pi", "dist", "build"]);

export interface IndexedCaseSource extends CaseSourceIdentity {
  sourcePath: string;
  metadataPath?: string;
  caseKey?: string;
  provider?: string;
  explicit: boolean;
  loaded?: LoadedCaseSource;
}

export interface CaseSourceIndex {
  sources: IndexedCaseSource[];
  byCitation: Map<string, IndexedCaseSource[]>;
  byName: Map<string, IndexedCaseSource[]>;
  coverage: SourceCoverage;
}

interface MetadataFields extends CaseSourceIdentity {
  caseKey?: string;
  provider?: string;
}

function isInside(basePath: string, candidatePath: string): boolean {
  const value = relative(basePath, candidatePath);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseMetadataText(raw: string): Record<string, unknown> | undefined {
  try { return readOpinionMetadata(raw); } catch { return undefined; }
}

function metadataFields(metadata: Record<string, unknown> | undefined): MetadataFields {
  const caseValue = isRecord(metadata?.case) ? metadata.case : {};
  const sourceValue = isRecord(metadata?.source) ? metadata.source : {};
  const citations = strings(caseValue.citations);
  const normalizedFromMetadata = strings(caseValue.normalizedCitations);
  const normalizedCitations = [...new Set([
    ...normalizedFromMetadata,
    ...citations.map(normalizeReporterCitation).filter((item): item is string => Boolean(item)),
  ])];
  return {
    title: stringValue(caseValue.title) ?? stringValue(sourceValue.title),
    citations,
    normalizedCitations,
    court: stringValue(caseValue.court),
    year: stringValue(caseValue.year) ?? stringValue(caseValue.dateFiled)?.match(/\b\d{4}\b/)?.[0],
    docket: stringValue(caseValue.docketNumber),
    caseKey: stringValue(caseValue.canonicalKey),
    provider: stringValue(sourceValue.provider) ?? stringValue(metadata?.provider),
  };
}

async function resolveWorkspaceFile(cwd: string, requestedPath: string, label: string): Promise<string> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requestedPath)) throw new Error(`${label} must be a local path.`);
  const workspaceRoot = await realpath(resolve(cwd));
  const candidate = await realpath(resolve(workspaceRoot, requestedPath));
  if (!isInside(workspaceRoot, candidate)) throw new Error(`${label} must resolve inside Pi's current working directory.`);
  const item = await stat(candidate);
  if (!item.isFile()) throw new Error(`${label} must identify a regular file.`);
  return candidate;
}

async function resolveWorkspaceDirectory(cwd: string, requestedPath: string, label: string): Promise<string> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requestedPath)) throw new Error(`${label} must be a local path.`);
  const workspaceRoot = await realpath(resolve(cwd));
  const candidate = await realpath(resolve(workspaceRoot, requestedPath));
  if (!isInside(workspaceRoot, candidate) || candidate === workspaceRoot) {
    throw new Error(`${label} must resolve to a directory below Pi's current working directory.`);
  }
  const item = await stat(candidate);
  if (!item.isDirectory()) throw new Error(`${label} must identify a directory.`);
  return candidate;
}

async function optionalMetadataPath(sourcePath: string, requestedPath?: string, cwd?: string): Promise<string | undefined> {
  if (requestedPath && cwd) return resolveWorkspaceFile(cwd, requestedPath, "metadata_path");
  const extension = extname(sourcePath).toLowerCase();
  if (extension !== ".html" && extension !== ".htm") return undefined;
  const candidate = sourcePath.slice(0, -extension.length) + ".md";
  try {
    const item = await stat(candidate);
    return item.isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

async function readMetadata(path: string | undefined): Promise<Record<string, unknown> | undefined> {
  if (!path) return undefined;
  try {
    return parseMetadataText(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function identityFromLoaded(source: LoadedCaseSource): CaseSourceIdentity {
  const fields = metadataFields(source.metadata);
  if (fields.normalizedCitations.length || fields.title) return fields;
  const header = source.blocks.slice(0, 4).map((block) => block.text).join(" ");
  const citations = [...header.matchAll(/\b\d{1,4}\s+[A-Z][A-Za-z.\s\d]{0,18}\s+\d{1,9}\b/g)]
    .map((match) => match[0].replace(/\s+/g, " ").trim())
    .filter((citation) => Boolean(normalizeReporterCitation(citation)));
  const possibleTitle = header.match(/\b([A-Z][A-Za-z0-9&'’.()\- ]{1,90}\s+v\.\s+[A-Z][A-Za-z0-9&'’.()\- ]{1,90})\b/)?.[1];
  return {
    title: possibleTitle,
    citations,
    normalizedCitations: citations.map(normalizeReporterCitation).filter((item): item is string => Boolean(item)),
  };
}

async function explicitDescriptor(cwd: string, input: VerificationCaseSourceInput): Promise<IndexedCaseSource> {
  const loaded = await loadCaseSource({
    cwd,
    sourcePath: input.source_path,
    metadataPath: input.metadata_path,
    caseKey: input.case_key,
  });
  const identity = identityFromLoaded(loaded);
  return {
    ...identity,
    sourcePath: loaded.sourcePath,
    metadataPath: loaded.metadataPath,
    caseKey: loaded.caseKey,
    provider: loaded.provider,
    explicit: true,
    loaded,
  };
}

async function scannedDescriptor(cwd: string, sourcePath: string): Promise<IndexedCaseSource | undefined> {
  const extension = extname(sourcePath).toLowerCase();
  if (extension === ".md") {
    const raw = await readFile(sourcePath, "utf8");
    const metadata = parseMetadataText(raw);
    if (isSummaryArtifact(sourcePath, metadata)) return undefined;
    if (isRecord(metadata?.source) && metadata.source.savedPath) return undefined;
    if (/## Machine-readable metadata/i.test(raw) && /```json/i.test(raw)) return undefined;
    return {
      ...identityFromLoaded(await loadCaseSource({ cwd, sourcePath })),
      sourcePath,
      explicit: false,
    };
  }
  const metadataPath = await optionalMetadataPath(sourcePath);
  const metadata = await readMetadata(metadataPath);
  const fields = metadataFields(metadata);
  if (!fields.title && !fields.normalizedCitations.length) return undefined;
  return {
    title: fields.title,
    citations: fields.citations,
    normalizedCitations: fields.normalizedCitations,
    court: fields.court,
    year: fields.year,
    docket: fields.docket,
    sourcePath,
    metadataPath,
    caseKey: fields.caseKey,
    provider: fields.provider,
    explicit: false,
  };
}

async function collectFiles(root: string, limit: number): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const queue = [root];
  let truncated = false;
  while (queue.length && files.length < limit) {
    const directory = queue.shift();
    if (!directory) break;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) queue.push(path);
      else if (entry.isFile() && CASE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        if (isSummaryArtifact(path)) continue;
        if (extname(path).toLowerCase() === ".md") {
          try { if (isSummaryArtifact(path, parseMetadataText(await readFile(path, "utf8")))) continue; } catch { /* Descriptor handles invalid files. */ }
        }
        files.push(path);
      }
      if (files.length >= limit) {
        truncated = queue.length > 0 || entries.at(-1)?.name !== entry.name;
        break;
      }
    }
  }
  return { files, truncated };
}

function addToMap(map: Map<string, IndexedCaseSource[]>, key: string | undefined, source: IndexedCaseSource): void {
  if (!key) return;
  const items = map.get(key) ?? [];
  items.push(source);
  map.set(key, items);
}

export async function buildCaseSourceIndex(options: {
  cwd: string;
  matterId?: string;
  caseSources?: VerificationCaseSourceInput[];
  sourceRoots?: string[];
}): Promise<CaseSourceIndex> {
  const warnings: string[] = [];
  const explicit: IndexedCaseSource[] = [];
  for (const [index, input] of (options.caseSources ?? []).entries()) {
    try {
      explicit.push(await explicitDescriptor(options.cwd, input));
    } catch (error) {
      warnings.push(`case_sources[${index}] was not indexed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const requestedRoots = [...(options.sourceRoots ?? [])];
  const rootRequests: Array<{ path: string; label: string }> = requestedRoots.map((path, index) => ({
    path,
    label: `source_roots[${index}]`,
  }));
  let defaultCasesDirectoryChecked = false;
  let matterCasesDirectoryChecked = false;
  if (!options.sourceRoots?.length) {
    defaultCasesDirectoryChecked = true;
    rootRequests.push({ path: "Cases", label: "default Cases directory" });
  }
  if (options.matterId) {
    matterCasesDirectoryChecked = true;
    rootRequests.push({
      path: join("Legal Matters", options.matterId, "sources", "cases"),
      label: "matter cases directory",
    });
  }

  const roots: string[] = [];
  for (const request of rootRequests) {
    try {
      const path = await resolveWorkspaceDirectory(options.cwd, request.path, request.label);
      if (!roots.includes(path)) roots.push(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (request.label.startsWith("source_roots")) warnings.push(`${request.label} was not scanned: ${message}`);
    }
  }

  const scanned: IndexedCaseSource[] = [];
  let truncated = false;
  let skippedSources = 0;
  const remaining = () => Math.max(0, MAX_INDEXED_SOURCES - explicit.length - scanned.length);
  for (const root of roots) {
    if (!remaining()) {
      truncated = true;
      break;
    }
    const collection = await collectFiles(root, remaining());
    truncated ||= collection.truncated;
    for (const path of collection.files) {
      try {
        const descriptor = await scannedDescriptor(options.cwd, path);
        if (descriptor) scanned.push(descriptor);
        else skippedSources += 1;
      } catch {
        skippedSources += 1;
      }
    }
  }
  if (truncated) warnings.push(`The local source index was truncated at ${MAX_INDEXED_SOURCES} opinion candidates.`);

  const byPath = new Map<string, IndexedCaseSource>();
  for (const source of [...scanned, ...explicit]) byPath.set(source.sourcePath, source);
  const sources = [...byPath.values()];
  const byCitation = new Map<string, IndexedCaseSource[]>();
  const byName = new Map<string, IndexedCaseSource[]>();
  for (const source of sources) {
    source.normalizedCitations.forEach((citation) => addToMap(byCitation, citation, source));
    addToMap(byName, source.title ? normalizeCaseName(source.title) : undefined, source);
  }

  return {
    sources,
    byCitation,
    byName,
    coverage: {
      defaultCasesDirectoryChecked,
      matterCasesDirectoryChecked,
      requestedRoots,
      scannedRoots: roots,
      explicitSources: options.caseSources?.length ?? 0,
      indexedSources: sources.length,
      skippedSources,
      truncated,
      providerLookupsPerformed: false,
      warnings,
    },
  };
}

export async function loadIndexedSource(cwd: string, source: IndexedCaseSource): Promise<LoadedCaseSource> {
  if (source.loaded) return source.loaded;
  source.loaded = await loadCaseSource({
    cwd,
    sourcePath: source.sourcePath,
    metadataPath: source.metadataPath,
    caseKey: source.caseKey,
  });
  return source.loaded;
}

export function caseSourceRecord(source: IndexedCaseSource, loaded: LoadedCaseSource): CaseSourceRecord {
  return {
    path: loaded.sourcePath,
    metadataPath: loaded.metadataPath,
    caseKey: loaded.caseKey ?? source.caseKey,
    provider: loaded.provider ?? source.provider,
    rawBytes: loaded.rawBytes,
    blockCount: loaded.blocks.length,
    rawSha256: loaded.rawSha256,
    textSha256: loaded.textSha256,
    title: source.title,
    citations: source.citations,
    normalizedCitations: source.normalizedCitations,
    court: source.court,
    year: source.year,
    docket: source.docket,
  };
}

export function sourceDisplayName(source: IndexedCaseSource): string {
  return source.title ?? source.caseKey ?? basename(source.sourcePath);
}
