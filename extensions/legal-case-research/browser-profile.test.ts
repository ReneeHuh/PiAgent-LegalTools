import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

function profileAtStartup(agentDir?: string): string {
  const env = { ...process.env };
  delete env.PI_CODING_AGENT_DIR;
  if (agentDir !== undefined) env.PI_CODING_AGENT_DIR = agentDir;
  const moduleUrl = new URL("./browser.ts", import.meta.url).href;
  const output = execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `import { LEGAL_RESEARCH_CHROME_PROFILE_DIR } from ${JSON.stringify(moduleUrl)};
     console.log(JSON.stringify(LEGAL_RESEARCH_CHROME_PROFILE_DIR));`,
  ], { env, encoding: "utf8", timeout: 30_000 });
  return JSON.parse(output.trim()) as string;
}

test("browser profile defaults to the main Pi profile", () => {
  assert.equal(profileAtStartup(), join(homedir(), ".pi", "agent", "legal-research-chrome-profile"));
});

test("browser profile follows the pilegal profile selected before startup", () => {
  const agentDir = join(homedir(), ".pi", "pilegal");
  assert.equal(profileAtStartup(agentDir), join(agentDir, "legal-research-chrome-profile"));
});

test("browser profile expands a tilde in the selected Pi profile", () => {
  assert.equal(profileAtStartup("~/.pi/pilegal"), join(homedir(), ".pi", "pilegal", "legal-research-chrome-profile"));
});

test("Edge endpoint discovery cannot reuse the running Chrome profile endpoint", () => {
  const parent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(parent, "legal-browser-endpoints-")));
  try {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { browserProfileDirectory, ensureChrome } from ${JSON.stringify(new URL("./browser.ts", import.meta.url).href)};
      for (const [browser, port] of [["chrome", 40101], ["edge", 40102]]) {
        const directory = browserProfileDirectory(browser);
        mkdirSync(directory, {recursive: true});
        writeFileSync(join(directory, "DevToolsActivePort"), port + "\\n/devtools/browser/" + browser);
      }
      const probed = [];
      globalThis.fetch = async url => {
        probed.push(url);
        const browser = url.includes("40102") ? "edge" : "chrome";
        return {ok: true, json: async () => ({webSocketDebuggerUrl: url.replace("http:", "ws:").replace("/json/version", "/devtools/browser/" + browser)})};
      };
      const chrome = await ensureChrome("https://scholar.google.com/", undefined, "chrome");
      const edge = await ensureChrome("https://scholar.google.com/", undefined, "edge");
      console.log(JSON.stringify({chrome, edge, probed}));
    `], { env: { ...process.env, PI_CODING_AGENT_DIR: root }, encoding: "utf8", timeout: 30_000 });
    const found = JSON.parse(output.trim());
    assert.equal(found.chrome.httpUrl, "http://127.0.0.1:40101");
    assert.equal(found.edge.httpUrl, "http://127.0.0.1:40102");
    assert.deepEqual(found.probed, ["http://127.0.0.1:40101/json/version", "http://127.0.0.1:40102/json/version"]);
  } finally {
    assert.equal(dirname(root).toLowerCase(), parent.toLowerCase());
    assert.ok(basename(root).startsWith("legal-browser-endpoints-"));
    rmSync(root, {recursive: true, force: true});
  }
});
