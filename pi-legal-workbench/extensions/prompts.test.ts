import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const extensionDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(extensionDirectory, "..");
const promptsDirectory = join(packageRoot, "prompts");
const skillsDirectory = join(packageRoot, "skills");

const expectedPrompts = [
  "adversarial-analysis.md",
  "hearing-simulation.md",
  "research-memo.md",
  "treatment-report.md",
].sort();

const expectedSkills = [
  "authority-treatment-analysis",
  "case-analysis",
  "central-case-library",
  "judicial-hearing-preparation",
  "case-law-research",
  "legal-writing-adversarial-analysis",
].sort();

test("prompt suite exposes the selected workflows", async () => {
  const actual = (await readdir(promptsDirectory))
    .filter((name) => name.endsWith(".md"))
    .sort();
  assert.deepEqual(actual, expectedPrompts);
});

test("each prompt has metadata, arguments, and an existing routed skill", async () => {
  for (const filename of expectedPrompts) {
    const text = await readFile(join(promptsDirectory, filename), "utf8");
    assert.match(text, /^---\r?\n[\s\S]+?\r?\n---\r?\n/, `${filename}: missing frontmatter`);
    assert.match(text, /^description:\s*\S.+$/m, `${filename}: missing description`);
    assert.match(text, /^argument-hint:\s*".+"$/m, `${filename}: missing argument hint`);
    assert.match(text, /\$ARGUMENTS/, `${filename}: does not pass template arguments`);

    const skillMatch = text.match(/Load and follow the `([a-z0-9-]+)` skill/);
    assert.ok(skillMatch, `${filename}: missing routed skill instruction`);
    const skillPath = join(skillsDirectory, skillMatch[1], "SKILL.md");
    assert.ok((await stat(skillPath)).isFile(), `${filename}: routed skill does not exist`);
  }
});

test("skill suite exposes the agreed responsibilities", async () => {
  const entries = await readdir(skillsDirectory, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const resolved = await Promise.all(
    candidates.map(async (name) => {
      try {
        return (await stat(join(skillsDirectory, name, "SKILL.md"))).isFile() ? name : null;
      } catch {
        return null;
      }
    }),
  );
  const actual = resolved.filter((name): name is string => name !== null).sort();
  assert.deepEqual(actual, expectedSkills);
});

test("each skill has valid identifying frontmatter", async () => {
  for (const skillName of expectedSkills) {
    const text = await readFile(join(skillsDirectory, skillName, "SKILL.md"), "utf8");
    assert.match(text, /^---\r?\n[\s\S]+?\r?\n---\r?\n/, `${skillName}: missing frontmatter`);
    assert.match(text, new RegExp(`^name:\\s*${skillName}$`, "m"), `${skillName}: wrong name`);
    assert.match(text, /^description:\s*\S.+$/m, `${skillName}: missing description`);
  }
});
