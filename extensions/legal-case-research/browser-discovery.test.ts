import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { browserAvailability, detectBrowserExecutable, findBrowserExecutable } from "./browser-discovery.ts";

function fixture(fn: (root: string, env: NodeJS.ProcessEnv) => void) {
  const parent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(parent, "browser-discovery-")));
  try { fn(root, { ProgramFiles: join(root, "pf"), "ProgramFiles(x86)": join(root, "pf86"), LOCALAPPDATA: join(root, "local") }); }
  finally {
    assert.equal(dirname(root).toLowerCase(), parent.toLowerCase());
    assert.ok(basename(root).startsWith("browser-discovery-"));
    rmSync(root, { recursive: true, force: true });
  }
}
function executable(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "Synthetic executable fixture; never launch this file.");
  return path;
}

test("browser inventory reports only installation flags and agrees with launcher discovery", () => fixture((root, env) => {
  const chrome = executable(join(env.ProgramFiles!, "Google", "Chrome", "Application", "chrome.exe"));
  const edge = executable(join(env["ProgramFiles(x86)"]!, "Microsoft", "Edge", "Application", "msedge.exe"));
  const opera = executable(join(env.LOCALAPPDATA!, "Programs", "Opera", "opera.exe"));
  const options = { env, platform: "win32" as const };
  assert.deepEqual(browserAvailability(options), {
    default: "chrome", installed: { chrome: true, edge: true, opera: true },
  });
  const paths = { chrome, edge, opera };
  for (const browser of ["chrome", "edge", "opera"] as const) {
    assert.equal(findBrowserExecutable(browser, options), paths[browser]);
    assert.equal(browserAvailability(options).installed[browser], true);
  }
  assert.equal(JSON.stringify(browserAvailability(options)).includes(root), false, "the returned inventory never contains paths");
  assert.equal(existsSync(join(root, "legal-research-opera-profile")), false, "discovery does not create a browser profile");
}));

test("Opera discovery selects the newest installed numeric version and skips missing executables", () => fixture((_root, env) => {
  const operaRoot = join(env.LOCALAPPDATA!, "Programs", "Opera");
  executable(join(operaRoot, "99.0.0.1", "opera.exe"));
  const latest = executable(join(operaRoot, "100.0.0.1", "opera.exe"));
  mkdirSync(join(operaRoot, "101.0.0.1", "opera.exe"), { recursive: true });
  executable(join(operaRoot, "unrelated", "opera.exe"));
  assert.equal(detectBrowserExecutable("opera", { env, platform: "win32" }), latest);
}));

test("custom browser paths take precedence and Opera never silently selects Chrome", () => fixture((root, env) => {
  executable(join(env.ProgramFiles!, "Google", "Chrome", "Application", "chrome.exe"));
  const custom = executable(join(root, "portable", "opera.exe"));
  const standard = executable(join(env.ProgramFiles!, "Opera", "opera.exe"));
  env.LEGAL_RESEARCH_OPERA_PATH = custom;
  assert.equal(findBrowserExecutable("opera", { env, platform: "win32" }), custom);
  env.LEGAL_RESEARCH_OPERA_PATH = join(root, "absent.exe");
  assert.equal(findBrowserExecutable("opera", { env, platform: "win32" }), standard);
  rmSync(standard);
  assert.deepEqual(browserAvailability({ env, platform: "win32" }).installed, { chrome: true, edge: false, opera: false });
  assert.throws(() => findBrowserExecutable("opera", { env, platform: "win32" }), /Opera not found.*LEGAL_RESEARCH_OPERA_PATH/);
}));

test("no browsers found returns false for every installation flag", () => fixture((_root, env) => {
  const found = browserAvailability({ env, platform: "win32" });
  assert.equal(found.default, "chrome");
  assert.deepEqual(found.installed, { chrome: false, edge: false, opera: false });
}));

test("legacy Chrome override remains scoped to Chrome", () => fixture((root, env) => {
  const chrome = executable(join(root, "chrome.exe"));
  env.SCHOLAR_CHROME_PATH = chrome;
  assert.equal(detectBrowserExecutable("chrome", { env, platform: "win32" }), chrome);
  assert.equal(detectBrowserExecutable("edge", { env, platform: "win32" }), undefined);
  assert.equal(detectBrowserExecutable("opera", { env, platform: "win32" }), undefined);
}));
