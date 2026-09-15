import { isSummaryArtifact, readOpinionMetadata, splitOpinionMarkdown } from "../shared/opinion-markdown.ts";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

const SUPPORTED_EXTENSIONS = new Set([".html", ".htm", ".md", ".txt"]);
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const TARGET_BLOCK_LENGTH = 1_600;

export interface SourceBlock {
  id: string;
  text: string;
}

export interface LoadedCaseSource {
  sourcePath: string;
  metadataPath?: string;
  caseKey?: string;
  metadata?: Record<string, unknown>;
  provider?: string;
  rawSha256: string;
  textSha256: string;
  rawBytes: number;
  normalizedText: string;
  blocks: SourceBlock[];
  estimatedTokens: number;
}

export interface LoadCaseSourceOptions {
  cwd: string;
  sourcePath: string;
  metadataPath?: string;
  caseKey?: string;
}

function isInside(basePath: string, candidatePath: string): boolean {
  const value = relative(basePath, candidatePath);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

export async function resolveReadableFile(cwd: string, requestedPath: string, label: string): Promise<string> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requestedPath)) {
    throw new Error(`${label} must be a local file path, not a URL.`);
  }
  const workspaceRoot = await realpath(resolve(cwd));
  const candidate = await realpath(resolve(workspaceRoot, requestedPath));
  if (!isInside(workspaceRoot, candidate)) {
    throw new Error(`${label} must resolve inside Pi's current working directory.`);
  }
  const item = await stat(candidate);
  if (!item.isFile()) throw new Error(`${label} must identify a regular file.`);
  return candidate;
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    ndash: "-",
    mdash: "-",
    hellip: "...",
  };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (entity, decimal, hexadecimal, name) => {
    if (name) return named[String(name).toLowerCase()] ?? entity;
    const codePoint = decimal ? Number(decimal) : Number.parseInt(hexadecimal, 16);
    try {
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    } catch {
      return entity;
    }
  });
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h\d|blockquote|li|section|article|header|footer|tr|opinion|author|judges|footnote)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripOpinionHtml(value: string): string {
  return stripHtml(
    value
      .replace(/<a\b(?=[^>]*\bclass=["'][^"']*\bpage-label\b[^"']*["'])[^>]*>[\s\S]*?<\/a>/gi, "")
      .replace(/<sup\b[^>]*>\s*<a\b(?=[^>]*(?:\bhref=["']#fn|\bid=["']fnref))[^>]*>[\s\S]*?<\/a>\s*<\/sup>/gi, "")
      .replace(/<a\b(?=[^>]*\bclass=["'][^"']*\bjumpback\b[^"']*["'])[^>]*>[\s\S]*?<\/a>/gi, ""),
  );
}

function elementById(html: string, ids: string[]): string | undefined {
  for (const id of ids) {
    const start = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bid=["']${id}["'][^>]*>`, "i").exec(html);
    if (!start || start.index === undefined) continue;
    const tag = start[1];
    const from = start.index + start[0].length;
    const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, "ig");
    token.lastIndex = from;
    let depth = 1;
    for (let match = token.exec(html); match; match = token.exec(html)) {
      const closing = /^<\//.test(match[0]);
      const selfClosing = /\/\s*>$/.test(match[0]);
      if (closing) depth -= 1;
      else if (!selfClosing) depth += 1;
      if (depth === 0) return html.slice(from, match.index);
    }
  }
  return undefined;
}

function extractOpinionText(html: string, provider?: string): string {
  if (!provider || provider === "scholar") {
    const opening = html.match(/<[^>]*\bid=["']gs_opinion["'][^>]*>/i);
    if (opening?.index !== undefined) {
      let opinion = html.slice(opening.index + opening[0].length);
      const boundary = opinion.search(/<[^>]*\bid=["'](?:gs_dont_print|gs_ftr)["'][^>]*>/i);
      if (boundary !== -1) opinion = opinion.slice(0, boundary);
      const text = stripOpinionHtml(opinion);
      if (text) return text;
    }
  }
  if (!provider || provider === "courtlistener") {
    const article = html.match(/<div\b[^>]*class=["'][^"']*\bmain-document\b[^"']*["'][^>]*>[\s\S]*?<article\b[^>]*>([\s\S]*?)<\/article>/i)
      ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
    if (article?.[1]) {
      const text = stripOpinionHtml(article[1]);
      if (text) return text;
    }
  }

  const providerIds: Record<string, string[]> = {
    courtlistener: ["opinion-content", "opinion"],
    scholar: ["gs_opinion"],
    findlaw: ["caselaw-content"],
    justia: ["opinion", "opinions", "tab-opinion", "tab-opinion-0"],
  };
  const candidates = provider && providerIds[provider]
    ? providerIds[provider]
    : Object.values(providerIds).flat();
  const scoped = elementById(html, candidates);
  if (scoped !== undefined) return stripOpinionHtml(scoped);
  if (provider && providerIds[provider]) return "";
  return stripHtml(html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html);
}

function parseMetadata(markdown: string): Record<string, unknown> {
  return readOpinionMetadata(markdown);
}

function metadataProvider(metadata: Record<string, unknown> | undefined): string | undefined {
  const source = metadata?.source;
  if (typeof source !== "object" || source === null || Array.isArray(source)) return undefined;
  const provider = (source as Record<string, unknown>).provider;
  return typeof provider === "string" ? provider.toLowerCase() : undefined;
}

function metadataCaseKey(metadata: Record<string, unknown> | undefined): string | undefined {
  const caseValue = metadata?.case;
  if (typeof caseValue !== "object" || caseValue === null || Array.isArray(caseValue)) return undefined;
  const key = (caseValue as Record<string, unknown>).canonicalKey;
  return typeof key === "string" && key.trim() ? key.trim() : undefined;
}

async function loadOptionalMetadata(
  cwd: string,
  sourcePath: string,
  requestedPath?: string,
): Promise<{ path?: string; data?: Record<string, unknown> }> {
  const extension = extname(sourcePath).toLowerCase();
  const automatic = extension === ".html" || extension === ".htm"
    ? sourcePath.slice(0, -extension.length) + ".md"
    : undefined;
  const candidate = requestedPath ?? automatic;
  if (!candidate) return {};
  try {
    const path = await resolveReadableFile(cwd, candidate, "metadata_path");
    return { path, data: parseMetadata(await readFile(path, "utf8")) };
  } catch (error) {
    if (requestedPath) throw error;
    return {};
  }
}

function splitLongText(value: string): string[] {
  const output: string[] = [];
  let remaining = value.trim();
  while (remaining.length > TARGET_BLOCK_LENGTH) {
    const window = remaining.slice(0, TARGET_BLOCK_LENGTH + 250);
    const breakAt = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "), window.lastIndexOf(" "));
    const size = breakAt >= TARGET_BLOCK_LENGTH / 2 ? breakAt + 1 : TARGET_BLOCK_LENGTH;
    output.push(remaining.slice(0, size).trim());
    remaining = remaining.slice(size).trim();
  }
  if (remaining) output.push(remaining);
  return output;
}

function createBlocks(text: string): SourceBlock[] {
  const paragraphs = text
    .split(/\n+/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap(splitLongText);
  return paragraphs.map((value, index) => ({
    id: `P${String(index + 1).padStart(5, "0")}`,
    text: value,
  }));
}

export async function loadCaseSource(options: LoadCaseSourceOptions): Promise<LoadedCaseSource> {
  const sourcePath = await resolveReadableFile(options.cwd, options.sourcePath, "source_path");
  const extension = extname(sourcePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error("source_path must end in .html, .htm, .md, or .txt.");
  }
  const sourceStats = await stat(sourcePath);
  if (sourceStats.size > MAX_SOURCE_BYTES) {
    throw new Error(`The source exceeds the ${MAX_SOURCE_BYTES.toLocaleString()} byte input limit.`);
  }

  const raw = await readFile(sourcePath, "utf8");
  const embedded = extension === ".md" ? splitOpinionMarkdown(raw) : undefined;
  if (isSummaryArtifact(sourcePath, embedded?.metadata)) throw new Error("Generated summaries are not opinion sources; supply the original HTML or opinion Markdown.");
  const metadata = embedded?.metadata && !options.metadataPath
    ? { path: sourcePath, data: embedded.metadata }
    : await loadOptionalMetadata(options.cwd, sourcePath, options.metadataPath);
  const provider = metadataProvider(metadata.data);
  if (extension === ".md" && !embedded?.metadata && /## Machine-readable metadata/i.test(raw) && /```json/i.test(raw)) {
    throw new Error("source_path appears to be a metadata sidecar; pass the corresponding opinion file instead.");
  }
  const extracted = extension === ".html" || extension === ".htm"
    ? extractOpinionText(raw, provider)
    : (embedded?.body ?? raw).replace(/\r/g, "").trim();
  const blocks = createBlocks(extracted);
  if (blocks.length === 0 || extracted.length < 200) {
    throw new Error("No usable full-opinion text could be extracted from source_path.");
  }
  const normalizedText = blocks.map((block) => block.text).join("\n\n");

  return {
    sourcePath,
    metadataPath: metadata.path,
    caseKey: options.caseKey ?? metadataCaseKey(metadata.data),
    metadata: metadata.data,
    provider,
    rawSha256: createHash("sha256").update(raw).digest("hex"),
    textSha256: createHash("sha256").update(normalizedText).digest("hex"),
    rawBytes: Buffer.byteLength(raw, "utf8"),
    normalizedText,
    blocks,
    estimatedTokens: Math.ceil(normalizedText.length / 4),
  };
}
