import assert from "node:assert/strict";
import test from "node:test";
import registerLegalResearch from "./index.ts";

function registeredTools(): any[] {
  const tools: any[] = [];
  registerLegalResearch({ registerTool: (tool: any) => tools.push(tool) } as never);
  return tools;
}

test("the extension entrypoint registers its seven public tools", () => {
  const tools = registeredTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["legal_library_search", "legal_search_history", "legal_jurisdictions", "legal_search", "legal_cited_by", "direct_download", "legal_open_browser"],
  );
  for (const tool of tools.filter((candidate) => candidate.name !== "legal_jurisdictions")) {
    assert.equal(tool.executionMode, "sequential", tool.name);
  }
});

test("every public prompt guideline names the tool whose behavior it controls", () => {
  for (const tool of registeredTools()) {
    assert.ok(tool.promptGuidelines.length > 0, tool.name);
    for (const guideline of tool.promptGuidelines) {
      assert.match(guideline, new RegExp(`\\b${tool.name}\\b`), guideline);
    }
  }
});

test("legal_jurisdictions returns nested groups and an explicit district-court limit", async () => {
  const tool = registeredTools().find((candidate) => candidate.name === "legal_jurisdictions");
  const result = await tool.execute("jurisdictions-test", {}, undefined, undefined, { cwd: "." });
  assert.ok(Array.isArray(result.details.jurisdictions));
  assert.ok(Array.isArray(result.details.groups.stateAppellate));
  assert.ok(Array.isArray(result.details.groups.federalCourts));
  assert.equal(result.details.groups.federalDistrict.length, 93);
  assert.match(result.details.limitations.federalDistrictCourts, /93 exact/);
});

test("tool schemas stay compact and point to legal_jurisdictions for the key list", () => {
  const search = registeredTools().find((candidate) => candidate.name === "legal_search");
  const schema = JSON.stringify(search.parameters);
  assert.doesNotMatch(schema, /alabama, alaska/);
  assert.match(schema, /legal_jurisdictions/);
  assert.ok(schema.length < 4_000, `legal_search schema is ${schema.length} characters`);
});
