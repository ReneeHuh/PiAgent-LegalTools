import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runCaseSummarizer } from "../case-summarizer/summarize.ts";
import { checkOpinionIntegrity } from "./library.ts";
import { resolveReadableFile } from "../case-summarizer/source.ts";
import { readOpinionMetadata, renderOpinionMarkdown, splitOpinionMarkdown } from "../shared/opinion-markdown.ts";
import { extractOpinionMarkdown, nowIso, opinionMetadataMarkdownPath, writeTextAtomic } from "./core.ts";
import type { DownloadedCase } from "./workflows.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Await the same implementation registered as summarize_case, without another agent turn. */
export async function processDownloadedOpinion(
  download: DownloadedCase,
  summarize: boolean,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<any> | undefined,
  ctx: ExtensionContext,
): Promise<void> {
  if (download.status !== "downloaded" || !download.saved || signal?.aborted) return;
  const saved = download.saved;
  const report = (stage: string, status: string, text: string) => onUpdate?.({
    content: [{ type: "text", text }],
    details: { phase: stage, status, caseKey: download.case.canonicalKey, sourcePath: saved.savedPath,
      markdownPath: saved.markdownPath, summary: saved.summary },
  });
  const path = opinionMetadataMarkdownPath(saved.savedPath);
  let metadata: Record<string, unknown>;
  let body: string;
  const persist = () => {
    const content = renderOpinionMarkdown({ ...metadata, source: saved }, body);
    if (!existsSync(path) || readFileSync(path, "utf8") !== content) writeTextAtomic(path, content);
  };
  report("converting", "running", `Converting saved opinion to Markdown: ${download.case.title}`);
  try {
    // Resolve inside the workspace and validate opinion extraction before processing.
    const integrity = checkOpinionIntegrity(saved, ctx.cwd);
    if (integrity.status !== "valid") throw new Error(integrity.reason);
    const raw = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    metadata = raw ? readOpinionMetadata(raw) : { schemaVersion: 2, downloadedAt: nowIso(), case: download.case, source: saved };
    const parsed = raw ? splitOpinionMarkdown(raw) : undefined;
    const prior = metadata.source as typeof saved | undefined;
    body = parsed?.body ?? "";
    const conversion = metadata.conversion as { status?: string; bodySha256?: string } | undefined;
    if (parsed?.metadata && conversion?.bodySha256 && conversion.bodySha256 !== hash(body)) {
      throw new Error("Opinion Markdown was edited; preserved it without overwriting. Restore the generated copy or move edits before retrying conversion.");
    }
    if (!parsed?.metadata || conversion?.status !== "completed" || prior?.htmlSha256 !== saved.htmlSha256 || conversion.bodySha256 !== hash(body)) {
      body = extractOpinionMarkdown(readFileSync(saved.savedPath, "utf8"), saved.provider);
      if (raw && !parsed?.metadata) {
        try { writeFileSync(`${path}.legacy`, raw, { encoding: "utf8", flag: "wx" }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      metadata.conversion = { version: 1, status: "completed", bodySha256: hash(body) };
    }
    saved.markdownPath = path;
    delete saved.markdownError;
    if (prior?.summary && prior.summary.sourceSha256 === saved.htmlSha256) saved.summary = prior.summary;
    persist();
    report("converting", "completed", `Opinion Markdown saved: ${path}`);
  } catch (error) {
    saved.markdownError = error instanceof Error ? error.message : String(error);
    report("converting", "failed", `HTML preserved; Markdown conversion failed: ${saved.markdownError}`);
    return;
  }
  if (!summarize || signal?.aborted) return;
  const existing = saved.summary;
  let reusable = false;
  try {
    if (existing?.path) await resolveReadableFile(ctx.cwd, existing.path, "Saved summary");
    reusable = Boolean(existing?.status === "completed" && existing.sourceSha256 === saved.htmlSha256 && existing.path
      && existsSync(existing.path) && existing.summarySha256 === hash(readFileSync(existing.path, "utf8")));
  } catch { /* An unreadable cache entry is regenerated without changing it. */ }
  if (reusable) {
    report("summarizing", "completed", `Reusing saved summary: ${existing!.path}`);
    return;
  }
  report("summarizing", "running", `Calling summarize_case for ${download.case.title}`);
  try {
    const result = await runCaseSummarizer({ source_path: saved.savedPath, metadata_path: path,
      case_key: download.case.canonicalKey }, signal, update => {
      onUpdate?.({ ...update, details: { ...update.details, tool: "summarize_case", subtool: "summarize_case", caseKey: download.case.canonicalKey } });
    }, ctx);
    saved.summary = { status: "completed", path: result.details.outputPath, sourceSha256: saved.htmlSha256,
      summarySha256: hash(readFileSync(result.details.outputPath, "utf8")) };
    persist();
    report("summarizing", "completed", `Summary saved: ${result.details.outputPath}`);
  } catch (error) {
    saved.summary = { status: "failed", sourceSha256: saved.htmlSha256,
      error: error instanceof Error ? error.message : String(error) };
    persist();
    report("summarizing", signal?.aborted ? "cancelled" : "failed", `Opinion preserved; summary did not complete: ${saved.summary.error}. Retry summarize_case with source_path: ${saved.savedPath}`);
  }
}
