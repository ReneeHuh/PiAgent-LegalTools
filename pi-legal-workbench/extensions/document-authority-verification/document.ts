import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { DocumentBlock, LoadedDocument } from "./types.ts";

const SUPPORTED_EXTENSIONS = new Set([".html", ".htm", ".md", ".txt"]);
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const TARGET_BLOCK_LENGTH = 1_800;

function isInside(basePath: string, candidatePath: string): boolean {
  const value = relative(basePath, candidatePath);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    ndash: "–", mdash: "—", hellip: "…", sect: "§",
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

function htmlToText(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h\d|blockquote|li|section|article|header|footer|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, ""));
}

function splitLongText(value: string): string[] {
  const output: string[] = [];
  let remaining = value.trim();
  while (remaining.length > TARGET_BLOCK_LENGTH) {
    const window = remaining.slice(0, TARGET_BLOCK_LENGTH + 300);
    const breakAt = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("; "),
      window.lastIndexOf(" "),
    );
    const size = breakAt >= TARGET_BLOCK_LENGTH / 2 ? breakAt + 1 : TARGET_BLOCK_LENGTH;
    output.push(remaining.slice(0, size).trim());
    remaining = remaining.slice(size).trim();
  }
  if (remaining) output.push(remaining);
  return output;
}

function createBlocks(text: string): DocumentBlock[] {
  return text
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((value) => value.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .flatMap(splitLongText)
    .map((text, index) => ({ id: `D${String(index + 1).padStart(5, "0")}`, text }));
}

export async function loadVerificationDocument(cwd: string, requestedPath: string): Promise<LoadedDocument> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requestedPath)) {
    throw new Error("document_path must be a local file path, not a URL.");
  }
  const workspaceRoot = await realpath(resolve(cwd));
  const documentPath = await realpath(resolve(workspaceRoot, requestedPath));
  if (!isInside(workspaceRoot, documentPath)) {
    throw new Error("document_path must resolve inside Pi's current working directory.");
  }
  const extension = extname(documentPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error("document_path must end in .html, .htm, .md, or .txt. Convert DOCX or PDF first.");
  }
  const item = await stat(documentPath);
  if (!item.isFile()) throw new Error("document_path must identify a regular file.");
  if (item.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`The document exceeds the ${MAX_DOCUMENT_BYTES.toLocaleString()} byte input limit.`);
  }
  const raw = await readFile(documentPath, "utf8");
  const text = extension === ".html" || extension === ".htm" ? htmlToText(raw) : raw;
  const blocks = createBlocks(text);
  if (!blocks.length) throw new Error("No usable text could be extracted from document_path.");
  const normalizedText = blocks.map((block) => block.text).join("\n\n");
  return {
    path: documentPath,
    rawBytes: Buffer.byteLength(raw, "utf8"),
    rawSha256: createHash("sha256").update(raw).digest("hex"),
    textSha256: createHash("sha256").update(normalizedText).digest("hex"),
    normalizedText,
    blocks,
  };
}
