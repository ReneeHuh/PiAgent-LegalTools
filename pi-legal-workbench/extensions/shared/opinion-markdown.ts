import { parse, stringify } from "yaml";

export function splitOpinionMarkdown(markdown: string): { metadata?: Record<string, unknown>; body: string } {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return { body: markdown };
  const value: unknown = parse(match[1], { maxAliasCount: 50 });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Opinion frontmatter must be a metadata object.");
  return { metadata: value as Record<string, unknown>, body: markdown.slice(match[0].length).trim() };
}

export function readOpinionMetadata(markdown: string): Record<string, unknown> {
  const document = splitOpinionMarkdown(markdown);
  if (document.metadata) return document.metadata;
  const json = markdown.match(/```json\s*([\s\S]*?)\s*```/i)?.[1];
  if (!json) throw new Error("The metadata file has no YAML frontmatter or machine-readable JSON block.");
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Opinion metadata must be an object.");
  return value as Record<string, unknown>;
}

export function renderOpinionMarkdown(metadata: Record<string, unknown>, body: string): string {
  return `---\n${stringify(metadata, { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

export function isSummaryArtifact(path: string, metadata?: Record<string, unknown>): boolean {
  return /\.Summary(?:\.\d+)?\.md$/i.test(path) || metadata?.artifact_type === "case_summary";
}
