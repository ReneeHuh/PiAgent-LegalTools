import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
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
