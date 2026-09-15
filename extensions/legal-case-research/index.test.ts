import assert from "node:assert/strict";
import test from "node:test";
import registerLegalResearch from "./index.ts";
import { Check } from "typebox/value";

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
  const browsers = result.details.browsers;
  assert.equal(browsers.default, "chrome");
  assert.deepEqual(Object.keys(browsers), ["default", "installed"]);
  assert.deepEqual(Object.keys(browsers.installed), ["chrome", "edge", "opera"]);
  assert.ok(Object.values(browsers.installed).every(value => typeof value === "boolean"));
  const modelText = result.content.map((block: any) => block.text ?? "").join("\n");
  assert.deepEqual(JSON.parse(modelText.match(/^BROWSERS_JSON=(.+)$/m)![1]), browsers, "the model must receive the same availability data as tool details");
});

test("all browser tools accept Opera and reject unsupported browser names", () => {
  for (const tool of registeredTools().filter(tool => ["legal_search", "legal_cited_by", "direct_download", "legal_open_browser"].includes(tool.name))) {
    assert.equal(Check(tool.parameters.properties.browser, "opera"), true, tool.name);
    assert.equal(Check(tool.parameters.properties.browser, "firefox"), false, tool.name);
  }
});

test("tool schemas stay compact and point to legal_jurisdictions for the key list", () => {
  const search = registeredTools().find((candidate) => candidate.name === "legal_search");
  const schema = JSON.stringify(search.parameters);
  assert.doesNotMatch(schema, /alabama, alaska/);
  assert.match(schema, /legal_jurisdictions/);
  assert.ok(schema.length < 4_000, `legal_search schema is ${schema.length} characters`);
});
