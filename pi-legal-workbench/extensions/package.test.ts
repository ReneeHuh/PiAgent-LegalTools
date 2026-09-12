import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

test("the package loads research and analysis tools without duplicate registrations", async () => {
  const packageRoot = new URL("../", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8")) as {
    pi: { extensions: string[] };
  };
  const names: string[] = [];
  const pi = {
    registerTool(tool: { name: string }) {
      assert.ok(!names.includes(tool.name), `Duplicate tool registration: ${tool.name}`);
      names.push(tool.name);
    },
  } as unknown as ExtensionAPI;

  for (const entry of manifest.pi.extensions) {
    const extension = await import(new URL(entry, packageRoot).href);
    extension.default(pi);
  }

  assert.deepEqual(names.sort(), [
    "case_chat",
    "direct_download",
    "legal_cited_by",
    "legal_jurisdictions",
    "legal_library_search",
    "legal_open_browser",
    "legal_search",
    "legal_search_history",
    "summarize_case",
    "verify_document_authorities",
  ]);
});
