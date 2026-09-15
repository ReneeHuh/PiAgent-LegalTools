import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_CHOICES, BROWSER_NAMES, type BrowserChoice } from "./browser-choice.ts";

export const CHROME_PATH_ENV = "LEGAL_RESEARCH_CHROME_PATH";
export const EDGE_PATH_ENV = "LEGAL_RESEARCH_EDGE_PATH";
export const OPERA_PATH_ENV = "LEGAL_RESEARCH_OPERA_PATH";
const PATH_ENV: Record<BrowserChoice, string> = {
  chrome: CHROME_PATH_ENV, edge: EDGE_PATH_ENV, opera: OPERA_PATH_ENV,
};
const LEGACY_CHROME_PATH_ENV = ["SCHOLAR_CHROME_PATH", "COURTLISTENER_CHROME_PATH"];

interface DiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** Opera's Windows installer may keep opera.exe in a numeric version folder.
 * Inspect only immediate version directories; prefer the newest executable.
 */
function operaExecutables(root: string): string[] {
  const candidates = [join(root, "opera.exe")];
  try {
    const versions = readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^\d+(?:\.\d+)+$/.test(entry.name))
      .map(entry => entry.name).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    candidates.push(...versions.map(version => join(root, version, "opera.exe")));
  } catch { /* Missing or unreadable installation directory. */ }
  return candidates;
}

function executableCandidates(browser: BrowserChoice, { env = process.env, platform = process.platform }: DiscoveryOptions): string[] {
  const configured = [PATH_ENV[browser], ...(browser === "chrome" ? LEGACY_CHROME_PATH_ENV : [])]
    .map(name => env[name]?.trim()).find(Boolean);
  let standard: string[] = [];
  if (platform === "win32") {
    const pf = env.ProgramFiles ?? "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = env.LOCALAPPDATA;
    if (browser === "opera") {
      standard = [join(pf, "Opera"), join(pf86, "Opera"), ...(local ? [join(local, "Programs", "Opera"), join(local, "Opera")] : [])]
        .flatMap(operaExecutables);
    } else {
      const components = browser === "chrome" ? ["Google", "Chrome", "Application", "chrome.exe"] : ["Microsoft", "Edge", "Application", "msedge.exe"];
      standard = [pf, pf86, ...(local ? [local] : [])].map(root => join(root, ...components));
    }
  } else if (platform === "darwin") {
    const app = BROWSER_NAMES[browser];
    standard = [`/Applications/${app}.app/Contents/MacOS/${app}`];
  } else if (platform === "linux") {
    standard = browser === "chrome" ? ["/usr/bin/google-chrome", "/opt/google/chrome/chrome"]
      : browser === "edge" ? ["/usr/bin/microsoft-edge", "/opt/microsoft/msedge/msedge"]
        : ["/usr/bin/opera", "/usr/lib/x86_64-linux-gnu/opera/opera", "/usr/lib/opera/opera"];
  }
  return [...new Set([...(configured ? [configured] : []), ...standard])];
}

/** Shared by the read-only inventory and the launcher so availability agrees. */
export function detectBrowserExecutable(browser: BrowserChoice, options: DiscoveryOptions = {}): string | undefined {
  for (const path of executableCandidates(browser, options)) {
    try { if (statSync(path).isFile()) return path; } catch { /* Try the next known location. */ }
  }
  return undefined;
}

export function findBrowserExecutable(browser: BrowserChoice, options: DiscoveryOptions = {}): string {
  const path = detectBrowserExecutable(browser, options);
  if (path) return path;
  throw new Error(`${BROWSER_NAMES[browser]} not found. Install it or set ${PATH_ENV[browser]} to its executable.`);
}

/** Read-only preflight: no browser is started and no network connection is made. */
export function browserAvailability(options: DiscoveryOptions = {}) {
  return {
    default: "chrome" as const,
    installed: Object.fromEntries(BROWSER_CHOICES.map(browser => [browser, Boolean(detectBrowserExecutable(browser, options))])) as Record<BrowserChoice, boolean>,
  };
}
