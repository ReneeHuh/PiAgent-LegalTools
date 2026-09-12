// Shared visible-Chrome automation for the legal-research providers.
//
// Transport: a real, visible Chrome window driven over the Chrome DevTools
// Protocol using Node's built-in WebSocket (Node 22+, no npm dependencies).
// Plain fetch and headless Chrome are served anti-bot blocks by the providers;
// a headful Chrome with a persistent profile is not. The window is shared with
// the user: it stays open between tool calls and across pi restarts, the user
// can browse in it, and CAPTCHAs or verification pages are solved right in the
// window while the tool waits. Chrome runs on a dedicated profile under
// <active Pi profile>/legal-research-chrome-profile, never the user's daily one.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";

/** One persistent Chrome user-data directory shared by providers in the active Pi profile. */
export const LEGAL_RESEARCH_CHROME_PROFILE_DIR = join(getAgentDir(), "legal-research-chrome-profile");
const DEVTOOLS_ACTIVE_PORT_FILE = join(LEGAL_RESEARCH_CHROME_PROFILE_DIR, "DevToolsActivePort");

/** Override the browser executable. Provider-specific legacy names remain accepted. */
export const CHROME_PATH_ENV = "LEGAL_RESEARCH_CHROME_PATH";
const LEGACY_CHROME_PATH_ENV = ["SCHOLAR_CHROME_PATH", "COURTLISTENER_CHROME_PATH"];
/** Set to off/0/false/no to silence the CAPTCHA and verification alert sound. */
export const ALERT_SOUND_ENV = "LEGAL_RESEARCH_ALERT_SOUND";
const LEGACY_ALERT_SOUND_ENV = ["SCHOLAR_CAPTCHA_SOUND", "COURTLISTENER_VERIFICATION_SOUND"];

export const PAGE_WAIT_MS = 30_000;
export const HUMAN_CHALLENGE_WAIT_MS = 120_000;
export const ALERT_SOUND_REPEAT_MS = 30_000;
export const MAX_AGENT_TABS = 10;
const CHROME_LAUNCH_WAIT_MS = 20_000;
const CDP_CONNECT_TIMEOUT_MS = 10_000;
const CDP_COMMAND_TIMEOUT_MS = 30_000;
const CDP_RECOVERY_ATTEMPTS = 2;
const CDP_RECOVERY_DELAY_MS = 750;
const MAX_NAVIGATION_SESSIONS = 64;

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * A browser-side failure that is not a statement about the provider's content:
 * an unsolved CAPTCHA or verification page, an anti-bot block, a CDP timeout
 * or disconnect, or a page that never finished loading. Callers may pause and
 * resume after such an error; a plain Error means the page layout or request
 * itself was rejected and retrying will not help.
 */
export class TransientBrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientBrowserError";
  }
}

export class CdpCommandTimeoutError extends TransientBrowserError {
  constructor(message: string) {
    super(message);
    this.name = "CdpCommandTimeoutError";
  }
}

/** The rendered result page no longer exposes the link the workflow needs. */
export class ResultLinkUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultLinkUnavailableError";
  }
}

export function isTransientBrowserFailure(error: unknown): boolean {
  return error instanceof TransientBrowserError;
}

export function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" && reason ? reason : "Operation aborted.");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolveDelay, rejectDelay) => {
    let settled = false;
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectDelay(abortError(signal));
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    function finish() {
      if (settled) return;
      settled = true;
      cleanup();
      resolveDelay();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function randomPause(minimumMs: number, jitterMs: number, signal?: AbortSignal): Promise<void> {
  await abortableDelay(minimumMs + Math.random() * jitterMs, signal);
}

// ---------------------------------------------------------------------------
// Timing profiles
// ---------------------------------------------------------------------------

export type TimingMode = "fast" | "slow";
export interface TimingProfile {
  requestGapMinimumMs: number;
  requestGapJitterMs: number;
  resultClickMinimumMs: number;
  resultClickJitterMs: number;
  opinionDwellMinimumMs: number;
  opinionDwellJitterMs: number;
  backMinimumMs: number;
  backJitterMs: number;
}

const POLITE_DELAY_MINIMUM_MS = 500;
const POLITE_DELAY_MAXIMUM_MS = 1_000;
const CAUTIOUS_DELAY_MINIMUM_MS = 1_500;
const CAUTIOUS_DELAY_MAXIMUM_MS = 3_000;

function uniformProfile(minimumMs: number, maximumMs: number): TimingProfile {
  const jitter = maximumMs - minimumMs;
  return {
    requestGapMinimumMs: minimumMs,
    requestGapJitterMs: jitter,
    resultClickMinimumMs: minimumMs,
    resultClickJitterMs: jitter,
    opinionDwellMinimumMs: minimumMs,
    opinionDwellJitterMs: jitter,
    backMinimumMs: minimumMs,
    backJitterMs: jitter,
  };
}

export const TIMING_PROFILES: Readonly<Record<TimingMode, TimingProfile>> = {
  fast: uniformProfile(POLITE_DELAY_MINIMUM_MS, POLITE_DELAY_MAXIMUM_MS),
  slow: uniformProfile(CAUTIOUS_DELAY_MINIMUM_MS, CAUTIOUS_DELAY_MAXIMUM_MS),
};

// ---------------------------------------------------------------------------
// Chrome lifecycle: find the installed browser, keep one debuggable instance
// ---------------------------------------------------------------------------

function configuredEnv(primary: string, legacy: readonly string[]): string | undefined {
  for (const name of [primary, ...legacy]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function findChrome(): string {
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    configuredEnv(CHROME_PATH_ENV, LEGACY_CHROME_PATH_ENV),
    join(pf, "Google\\Chrome\\Application\\chrome.exe"),
    join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
    local && join(local, "Google\\Chrome\\Application\\chrome.exe"),
    join(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
    join(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean) as string[];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(`Chrome not found. Install Google Chrome or set ${CHROME_PATH_ENV} to the browser executable.`);
}

export type CdpEndpoint = { httpUrl: string; webSocketUrl: string };

function profileCdpCandidate(): { httpUrl: string; expectedWebSocketPath: string } | undefined {
  try {
    const [portLine, pathLine] = readFileSync(DEVTOOLS_ACTIVE_PORT_FILE, "utf8").trim().split(/\r?\n/);
    const port = Number(portLine);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !pathLine?.startsWith("/devtools/browser/")) {
      return undefined;
    }
    return { httpUrl: `http://127.0.0.1:${port}`, expectedWebSocketPath: pathLine };
  } catch {
    return undefined;
  }
}

async function probeCdpEndpoint(
  httpUrl: string,
  expectedWebSocketPath: string | undefined,
  signal?: AbortSignal,
): Promise<CdpEndpoint | undefined> {
  try {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(1500)])
      : AbortSignal.timeout(1500);
    const response = await fetch(`${httpUrl}/json/version`, { signal: requestSignal });
    if (!response.ok) return undefined;
    const value = (await response.json()) as { webSocketDebuggerUrl?: unknown };
    if (typeof value.webSocketDebuggerUrl !== "string") return undefined;
    const wsUrl = new URL(value.webSocketDebuggerUrl);
    const expectedHttpUrl = new URL(httpUrl);
    if (!/^wss?:$/.test(wsUrl.protocol)) return undefined;
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])$/i.test(wsUrl.hostname) || wsUrl.port !== expectedHttpUrl.port) {
      return undefined;
    }
    if (expectedWebSocketPath && wsUrl.pathname !== expectedWebSocketPath) return undefined;
    return { httpUrl, webSocketUrl: value.webSocketDebuggerUrl };
  } catch {
    throwIfAborted(signal);
    return undefined;
  }
}

async function profileCdpEndpoint(signal?: AbortSignal): Promise<CdpEndpoint | undefined> {
  const candidate = profileCdpCandidate();
  if (!candidate) return undefined;
  return probeCdpEndpoint(candidate.httpUrl, candidate.expectedWebSocketPath, signal);
}

let chromeLaunch: Promise<CdpEndpoint> | undefined;

/** Connect to the shared profile's Chrome, launching it at `launchUrl` if needed. */
export async function ensureChrome(launchUrl: string, signal?: AbortSignal): Promise<CdpEndpoint> {
  throwIfAborted(signal);
  const existing = await profileCdpEndpoint(signal);
  if (existing) return existing;
  // Both providers share one Chrome; a concurrent launch must reuse the same attempt.
  if (!chromeLaunch) {
    chromeLaunch = launchChrome(launchUrl, signal).finally(() => {
      chromeLaunch = undefined;
    });
  }
  return chromeLaunch;
}

async function launchChrome(launchUrl: string, signal?: AbortSignal): Promise<CdpEndpoint> {
  let launchError: Error | undefined;
  const child = spawn(
    findChrome(),
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${LEGAL_RESEARCH_CHROME_PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,950",
      launchUrl,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.once("error", (error) => {
    launchError = error;
  });
  child.unref();
  const deadline = Date.now() + CHROME_LAUNCH_WAIT_MS;
  while (Date.now() < deadline) {
    await abortableDelay(300, signal);
    if (launchError) throw new Error(`Could not start Chrome: ${launchError.message}`);
    const endpoint = await profileCdpEndpoint(signal);
    if (endpoint) return endpoint;
  }
  throw new TransientBrowserError(
    "Chrome started but its profile-specific debugging endpoint never came up. " +
      "Close any Chrome window using the legal-research profile and retry.",
  );
}

// Best-effort audible alert for a CAPTCHA or verification page that needs the
// user's attention.
export function playAlertSound(): void {
  if (/^(?:0|false|no|off)$/i.test(configuredEnv(ALERT_SOUND_ENV, LEGACY_ALERT_SOUND_ENV) ?? "")) return;
  try {
    if (process.platform === "win32") {
      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$wav = Join-Path $env:WINDIR 'Media\\Windows Notify System Generic.wav'; " +
            "if (Test-Path -LiteralPath $wav) { " +
            "  (New-Object System.Media.SoundPlayer $wav).PlaySync() " +
            "} else { " +
            "  [System.Media.SystemSounds]::Exclamation.Play(); Start-Sleep -Milliseconds 800 " +
            "}",
        ],
        { detached: true, stdio: "ignore", windowsHide: true },
      );
      child.on("error", () => {});
      child.unref();
      return;
    }
    if (process.platform === "darwin") {
      const child = spawn("afplay", ["/System/Library/Sounds/Glass.aiff"], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      return;
    }
    process.stderr.write("\x07");
  } catch {
    // Audio is a convenience only; never fail a research request because of it.
  }
}

// ---------------------------------------------------------------------------
// Minimal CDP client over Node's built-in WebSocket
// ---------------------------------------------------------------------------

function cdpProtocolError(message: string): Error {
  const text = `CDP ${message}`;
  return /execution context was destroyed|cannot find context|inspected target navigated or closed|target closed|session with given id not found/i.test(message)
    ? new TransientBrowserError(text)
    : new Error(text);
}

export class Cdp {
  private readonly ws: WebSocket;
  private readonly signal?: AbortSignal;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  private constructor(ws: WebSocket, signal?: AbortSignal) {
    this.ws = ws;
    this.signal = signal;
    ws.addEventListener("message", (event) => {
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const request = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) request.reject(cdpProtocolError(String(message.error.message)));
        else request.resolve(message.result);
      }
    });
    const failAll = (why: string) => {
      for (const request of this.pending.values()) request.reject(new TransientBrowserError(why));
      this.pending.clear();
    };
    ws.addEventListener("close", () => failAll("CDP connection closed"));
    ws.addEventListener("error", () => failAll("CDP connection error"));
  }

  static async connectEndpoint(endpoint: CdpEndpoint, signal?: AbortSignal): Promise<Cdp> {
    throwIfAborted(signal);
    const ws = new WebSocket(endpoint.webSocketUrl);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        try { ws.close(); } catch {}
        reject(abortError(signal));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        try { ws.close(); } catch {}
        reject(new TransientBrowserError("Timed out connecting to Chrome's debugging endpoint"));
      }, CDP_CONNECT_TIMEOUT_MS);
      ws.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }, { once: true });
      ws.addEventListener("error", () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new TransientBrowserError("Could not connect to Chrome's debugging endpoint"));
      }, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    return new Cdp(ws, signal);
  }

  send(method: string, params: object = {}, sessionId?: string, timeoutMs = CDP_COMMAND_TIMEOUT_MS): Promise<any> {
    throwIfAborted(this.signal);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const request = this.pending.get(id);
        if (request) {
          this.pending.delete(id);
          request.reject(abortError(this.signal));
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.signal?.removeEventListener("abort", onAbort);
      };
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          cleanup();
          reject(new CdpCommandTimeoutError(`CDP ${method} timed out after ${timeoutMs}ms; is the Chrome window responsive?`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { cleanup(); resolve(value); },
        reject: (error) => { cleanup(); reject(error); },
      });
      this.signal?.addEventListener("abort", onAbort, { once: true });
      if (this.signal?.aborted) {
        onAbort();
        return;
      }
      try {
        this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (error) {
        const request = this.pending.get(id);
        this.pending.delete(id);
        request?.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async eval<T>(sessionId: string, expression: string): Promise<T> {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(`page eval failed: ${result.exceptionDetails.text}`);
    return result.result?.value as T;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Per-provider browser state: tabs, leases, navigation sessions, timing
// ---------------------------------------------------------------------------

export type TabRef = { targetId: string; marker: string };
export type StatusCallback = (message: string) => void;
export type ProgressStatus = "running" | "waiting" | "completed" | "stopped" | "cancelled" | "failed";
export interface NavigationSession {
  tab: TabRef;
  /** One-based result page currently rendered in the tab. */
  page: number;
}

export interface ProviderBrowserConfig {
  /** Human-readable provider name used in status messages. */
  name: string;
  /** HTTPS origin, without a trailing slash. */
  base: string;
  /** URL Chrome opens when it must be launched for this provider. */
  launchUrl: string;
  /** Agent-created tabs are marked with window.name = prefix + marker. */
  tabNamePrefix: string;
  isProviderUrl: (url: string) => boolean;
}

export interface ChallengeMessages {
  detected: string;
  detectedAgain: string;
  unsolved: string;
  cleared: string;
}

/**
 * Browser state for one provider. Parallel calls use separate tabs, but every
 * navigation is serialized through one queue so the request gap is respected.
 */
export class ProviderBrowser {
  readonly config: ProviderBrowserConfig;
  timingMode: TimingMode = "fast";
  private lastRequestAt: number | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly tabLeases = new Map<string, number>();
  private readonly navigationSessions = new Map<string, NavigationSession>();
  private readonly tabClosedListeners: Array<(targetId: string) => void> = [];

  constructor(config: ProviderBrowserConfig) {
    this.config = config;
  }

  // -- timing --------------------------------------------------------------

  currentTiming(): TimingProfile {
    return TIMING_PROFILES[this.timingMode];
  }

  /** Switch to cautious delays after a human challenge. Returns true on the first switch. */
  enableCautiousTiming(): boolean {
    const switched = this.timingMode !== "slow";
    this.timingMode = "slow";
    return switched;
  }

  private async pauseForRequestGap(minimumMs: number, jitterMs: number, signal?: AbortSignal): Promise<void> {
    // Processing (including a case summary) already provides spacing between
    // provider actions. Cautious mode deliberately retains its full pause.
    const elapsed = this.timingMode === "fast" && this.lastRequestAt !== undefined
      ? Math.max(0, performance.now() - this.lastRequestAt)
      : 0;
    const remaining = Math.max(0, minimumMs + Math.random() * jitterMs - elapsed);
    throwIfAborted(signal);
    if (remaining > 0) await abortableDelay(remaining, signal);
    throwIfAborted(signal);
    this.lastRequestAt = performance.now();
  }

  async pauseBeforeNavigation(signal?: AbortSignal): Promise<void> {
    if (this.lastRequestAt !== undefined) {
      const timing = this.currentTiming();
      await this.pauseForRequestGap(timing.requestGapMinimumMs, timing.requestGapJitterMs, signal);
    } else {
      throwIfAborted(signal);
      this.lastRequestAt = performance.now();
    }
  }

  async pauseBeforeClick(signal?: AbortSignal): Promise<void> {
    const timing = this.currentTiming();
    await this.pauseForRequestGap(timing.resultClickMinimumMs, timing.resultClickJitterMs, signal);
  }

  async pauseBeforeBack(signal?: AbortSignal): Promise<void> {
    const timing = this.currentTiming();
    await randomPause(timing.backMinimumMs, timing.backJitterMs, signal);
    throwIfAborted(signal);
    this.lastRequestAt = performance.now();
  }

  async pauseForOpinionDwell(signal?: AbortSignal): Promise<void> {
    const timing = this.currentTiming();
    await randomPause(timing.opinionDwellMinimumMs, timing.opinionDwellJitterMs, signal);
  }

  // -- progress ------------------------------------------------------------

  emitProgress(
    onUpdate: AgentToolUpdateCallback<any> | undefined,
    message: string,
    details: Record<string, unknown> = {},
    status: ProgressStatus = "running",
  ): void {
    try {
      onUpdate?.({
        content: [{ type: "text", text: message }],
        details: { timingMode: this.timingMode, ...details, status, message },
      });
    } catch {
      // Progress reporting is best-effort and must not fail the underlying tool.
    }
  }

  // -- serialization and connection ---------------------------------------

  withLock<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    const guarded = () => {
      throwIfAborted(signal);
      return fn();
    };
    const run = this.queue.then(guarded, guarded);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async connect(signal?: AbortSignal): Promise<Cdp> {
    return Cdp.connectEndpoint(await ensureChrome(this.config.launchUrl, signal), signal);
  }

  /**
   * Run a CDP-backed action, reconnecting once when the command channel times
   * out or drops. The action receives the attempt number so it can verify the
   * page state after a reconnect instead of blindly repeating a navigation.
   */
  async withRecovery<T>(
    operation: string,
    action: (cdp: Cdp, attempt: number) => Promise<T>,
    signal?: AbortSignal,
    onStatus?: StatusCallback,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= CDP_RECOVERY_ATTEMPTS; attempt += 1) {
      let cdp: Cdp | undefined;
      try {
        cdp = await this.connect(signal);
        return await action(cdp, attempt);
      } catch (error) {
        throwIfAborted(signal);
        if (!isTransientBrowserFailure(error)) throw error;
        lastError = error;
        if (attempt === CDP_RECOVERY_ATTEMPTS) break;
        onStatus?.(
          `${this.config.name}'s browser command timed out or disconnected; reconnecting to the same tab and checking whether the navigation completed.`,
        );
        await abortableDelay(CDP_RECOVERY_DELAY_MS, signal);
      } finally {
        cdp?.close();
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new TransientBrowserError(
      `${operation} could not continue because the ${this.config.name} browser remained unresponsive after automatic recovery. ` +
        "This is a browser-automation failure; it does not mean the opinion is unavailable. Retry the call. " +
        `Last error: ${message}`,
    );
  }

  // -- tab leases ----------------------------------------------------------

  acquireTabLease(tab: TabRef): void {
    this.tabLeases.set(tab.targetId, (this.tabLeases.get(tab.targetId) ?? 0) + 1);
  }

  releaseTabLease(tab: TabRef | undefined): void {
    if (!tab) return;
    const count = this.tabLeases.get(tab.targetId);
    if (!count || count <= 1) this.tabLeases.delete(tab.targetId);
    else this.tabLeases.set(tab.targetId, count - 1);
  }

  isLeased(targetId: string): boolean {
    return this.tabLeases.has(targetId);
  }

  // -- navigation sessions -------------------------------------------------

  getNavigationSession(key: string): NavigationSession | undefined {
    const value = this.navigationSessions.get(key);
    if (value) {
      this.navigationSessions.delete(key);
      this.navigationSessions.set(key, value);
    }
    return value;
  }

  rememberNavigationSession(key: string, value: NavigationSession): void {
    this.navigationSessions.delete(key);
    this.navigationSessions.set(key, value);
    while (this.navigationSessions.size > MAX_NAVIGATION_SESSIONS) {
      const oldest = this.navigationSessions.keys().next().value as string | undefined;
      if (!oldest) break;
      this.navigationSessions.delete(oldest);
    }
  }

  forgetNavigationSession(key: string): void {
    this.navigationSessions.delete(key);
  }

  navigationSessionCount(): number {
    return this.navigationSessions.size;
  }

  /** Register cleanup for provider-specific per-tab state when a tab is closed. */
  onTabClosed(listener: (targetId: string) => void): void {
    this.tabClosedListeners.push(listener);
  }

  private forgetTab(targetId: string): void {
    for (const [key, value] of this.navigationSessions) {
      if (value.tab.targetId === targetId) this.navigationSessions.delete(key);
    }
    for (const listener of this.tabClosedListeners) listener(targetId);
  }

  // -- tabs ----------------------------------------------------------------

  private tabMarkerFromName(name: string): string | undefined {
    return name.startsWith(this.config.tabNamePrefix) ? name.slice(this.config.tabNamePrefix.length) : undefined;
  }

  async attachTab(cdp: Cdp, tab: TabRef, signal?: AbortSignal): Promise<{ targetId: string; sessionId: string }> {
    try {
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: tab.targetId, flatten: true });
      return { targetId: tab.targetId, sessionId: String(sessionId) };
    } catch {
      throwIfAborted(signal);
      throw new Error(`The ${this.config.name} tab for this request was closed. Retry the tool to open a new tab.`);
    }
  }

  async discoverAgentTabs(cdp: Cdp, signal?: AbortSignal): Promise<TabRef[]> {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const tabs: TabRef[] = [];
    for (const target of targetInfos) {
      throwIfAborted(signal);
      if (target.type !== "page" || !this.config.isProviderUrl(String(target.url))) continue;
      let sessionId: string | undefined;
      try {
        const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
        sessionId = String(attached.sessionId);
        const marker = this.tabMarkerFromName(await cdp.eval<string>(sessionId, "window.name"));
        if (marker) tabs.push({ targetId: String(target.targetId), marker });
      } catch {
        throwIfAborted(signal);
        // A tab can disappear while targets are being enumerated; skip it.
      } finally {
        if (sessionId) {
          try {
            await cdp.send("Target.detachFromTarget", { sessionId });
          } catch {}
        }
      }
    }
    return tabs;
  }

  async markAgentTab(cdp: Cdp, sessionId: string, marker: string): Promise<void> {
    await cdp.eval(sessionId, `window.name = ${JSON.stringify(this.config.tabNamePrefix + marker)}`);
  }

  /** Newest idle agent tabs first. */
  idleTabsNewestFirst(tabs: TabRef[]): TabRef[] {
    return tabs
      .filter((tab) => !this.isLeased(tab.targetId))
      .sort((a, b) => Number(b.marker.split("-")[0]) - Number(a.marker.split("-")[0]));
  }

  /**
   * Create a new agent tab, closing only the oldest idle agent tabs when the
   * soft cap is reached. Active workflows may temporarily exceed the cap.
   */
  async createTab(cdp: Cdp, signal?: AbortSignal): Promise<TabRef> {
    const agentTabs = (await this.discoverAgentTabs(cdp, signal))
      .sort((a, b) => Number(a.marker.split("-")[0]) - Number(b.marker.split("-")[0]));
    const closeCount = Math.max(0, agentTabs.length - MAX_AGENT_TABS + 1);
    const idleTabs = agentTabs.filter((tab) => !this.isLeased(tab.targetId));
    for (const old of idleTabs.slice(0, closeCount)) {
      throwIfAborted(signal);
      await cdp.send("Target.closeTarget", { targetId: old.targetId });
      this.forgetTab(old.targetId);
    }
    const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    return { targetId: String(targetId), marker };
  }

  async newestIdleTab(cdp: Cdp, signal?: AbortSignal): Promise<TabRef | undefined> {
    return this.idleTabsNewestFirst(await this.discoverAgentTabs(cdp, signal))[0];
  }

  /** Attach to a new or reused tab and mark it; a fresh tab is closed if marking fails. */
  async openTab(
    cdp: Cdp,
    existing: TabRef | undefined,
    signal?: AbortSignal,
  ): Promise<{ tab: TabRef; targetId: string; sessionId: string; isNewTab: boolean }> {
    const isNewTab = !existing;
    const tab = existing ?? (await this.createTab(cdp, signal));
    const { targetId, sessionId } = await this.attachTab(cdp, tab, signal);
    if (isNewTab) {
      try {
        await this.markAgentTab(cdp, sessionId, tab.marker);
      } catch (error) {
        try {
          await cdp.send("Target.closeTarget", { targetId });
        } catch {}
        throw error;
      }
    }
    return { tab, targetId, sessionId, isNewTab };
  }

  // -- human challenges ----------------------------------------------------

  /**
   * Wait for the user to clear a CAPTCHA or verification page in the visible
   * window, alerting periodically. Throws a TransientBrowserError when the
   * challenge is still present after the wait.
   */
  async waitForHumanChallenge<S>(
    cdp: Cdp,
    targetId: string,
    initial: S,
    readState: () => Promise<S>,
    isChallenge: (state: S) => boolean,
    messages: ChallengeMessages,
    signal?: AbortSignal,
    onStatus?: StatusCallback,
  ): Promise<S> {
    let state = initial;
    if (!isChallenge(state)) return state;
    const switched = this.enableCautiousTiming();
    onStatus?.(switched ? messages.detected : messages.detectedAgain);
    await cdp.send("Target.activateTarget", { targetId });
    playAlertSound();
    let nextSoundAt = Date.now() + ALERT_SOUND_REPEAT_MS;
    const deadline = Date.now() + HUMAN_CHALLENGE_WAIT_MS;
    while (Date.now() < deadline && isChallenge(state)) {
      await abortableDelay(2_000, signal);
      state = await readState();
      if (isChallenge(state) && Date.now() >= nextSoundAt) {
        playAlertSound();
        nextSoundAt = Date.now() + ALERT_SOUND_REPEAT_MS;
      }
    }
    if (isChallenge(state)) throw new TransientBrowserError(messages.unsolved);
    onStatus?.(messages.cleared);
    return state;
  }
}

/** Metadata returned by a provider after clicking and saving one rendered opinion. */
export interface SavedOpinionCapture {
  title: string;
  savedPath: string;
  sourceUrl: string;
  textLength: number;
  returnedToResults: boolean;
  restorationError?: string;
}
