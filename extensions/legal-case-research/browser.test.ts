import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { currentBrowser, validateBrowser, withBrowser } from "./browser-choice.ts";
import {
  CdpCommandTimeoutError,
  ProviderBrowser,
  ResultLinkUnavailableError,
  TIMING_PROFILES,
  TransientBrowserError,
  abortError,
  isAbortError,
  isTransientBrowserFailure,
} from "./browser.ts";

function exampleBrowser(): ProviderBrowser {
  return new ProviderBrowser({
    name: "Example",
    base: "https://example.com",
    launchUrl: "https://example.com/",
    tabNamePrefix: "pi-example:",
    isProviderUrl: (url) => url.startsWith("https://example.com"),
  });
}

test("browser selection defaults to Chrome and isolates async work, navigation, leases, and timing", async () => {
  const browser = exampleBrowser();
  const tab = { targetId: "same-target-id", marker: "1-test" };
  assert.equal(validateBrowser(undefined), "chrome");
  assert.throws(() => validateBrowser("firefox"), /chrome.*edge/);
  browser.rememberNavigationSession("run", { tab, page: 4 });
  browser.acquireTabLease(tab);
  browser.enableCautiousTiming();
  await Promise.all([withBrowser("edge", async () => {
    await Promise.resolve();
    assert.equal(currentBrowser(), "edge");
    assert.equal(browser.getNavigationSession("run"), undefined);
    assert.equal(browser.isLeased(tab.targetId), false);
    assert.equal(browser.timingMode, "fast");
    browser.rememberNavigationSession("run", { tab: { ...tab, marker: "edge" }, page: 1 });
  }), withBrowser("chrome", async () => {
    await Promise.resolve();
    assert.equal(currentBrowser(), "chrome");
    assert.equal(browser.getNavigationSession("run")?.page, 4);
    assert.equal(browser.isLeased(tab.targetId), true);
    assert.equal(browser.timingMode, "slow");
  })]);
  assert.equal(currentBrowser(), "chrome");
  assert.equal(browser.getNavigationSession("run")?.page, 4);
});

test("transient browser failures are recognized by type, not by message text", () => {
  assert.equal(isTransientBrowserFailure(new TransientBrowserError("CAPTCHA still showing")), true);
  assert.equal(isTransientBrowserFailure(new CdpCommandTimeoutError("CDP Runtime.evaluate timed out after 30000ms")), true);
  assert.equal(isTransientBrowserFailure(new ResultLinkUnavailableError("Could not find the rendered title link.")), false);
  assert.equal(isTransientBrowserFailure(new Error("The page was closed and cancelled by verification.")), false);
  assert.equal(isTransientBrowserFailure("CDP connection closed"), false);
});

test("abort errors carry the AbortError name and are detected without message matching", () => {
  const controller = new AbortController();
  assert.equal(abortError().name, "AbortError");
  assert.equal(isAbortError(abortError()), true);
  assert.equal(isAbortError(new Error("Operation aborted.")), false);
  controller.abort();
  assert.equal(isAbortError(new Error("anything"), controller.signal), true);
  const reason = new Error("custom reason");
  const withReason = new AbortController();
  withReason.abort(reason);
  assert.equal(abortError(withReason.signal), reason);
});

test("navigation sessions are bounded and refreshed on access", () => {
  const browser = exampleBrowser();
  for (let index = 0; index < 70; index += 1) {
    browser.rememberNavigationSession(`key-${index}`, { tab: { targetId: `t${index}`, marker: `${index}-m` }, page: 1 });
  }
  assert.equal(browser.navigationSessionCount(), 64);
  assert.equal(browser.getNavigationSession("key-0"), undefined);
  assert.equal(browser.getNavigationSession("key-6")?.tab.targetId, "t6");
  browser.rememberNavigationSession("key-70", { tab: { targetId: "t70", marker: "70-m" }, page: 1 });
  assert.equal(browser.getNavigationSession("key-6")?.tab.targetId, "t6", "recently read sessions survive eviction");
  assert.equal(browser.getNavigationSession("key-7"), undefined, "the least recently used session is evicted");
  browser.forgetNavigationSession("key-6");
  assert.equal(browser.getNavigationSession("key-6"), undefined);
});

test("tab leases are counted and idle tabs sort newest first", () => {
  const browser = exampleBrowser();
  const older = { targetId: "a", marker: "1000-x" };
  const newer = { targetId: "b", marker: "2000-y" };
  browser.acquireTabLease(older);
  browser.acquireTabLease(older);
  browser.releaseTabLease(older);
  assert.equal(browser.isLeased("a"), true);
  assert.deepEqual(browser.idleTabsNewestFirst([older, newer]), [newer]);
  browser.releaseTabLease(older);
  assert.deepEqual(browser.idleTabsNewestFirst([older, newer]), [newer, older]);
  browser.releaseTabLease(undefined);
});

test("cautious timing switches once and stays on", () => {
  const browser = exampleBrowser();
  assert.deepEqual(browser.currentTiming(), TIMING_PROFILES.fast);
  assert.equal(browser.enableCautiousTiming(), true);
  assert.equal(browser.enableCautiousTiming(), false);
  assert.deepEqual(browser.currentTiming(), TIMING_PROFILES.slow);
  assert.equal(browser.timingMode, "slow");
});

test("progress updates never throw and carry the timing mode", () => {
  const browser = exampleBrowser();
  const updates: any[] = [];
  browser.emitProgress((update) => updates.push(update), "Working.", { phase: "x" }, "waiting");
  assert.equal(updates[0].details.timingMode, "fast");
  assert.equal(updates[0].details.status, "waiting");
  assert.equal(updates[0].details.message, "Working.");
  browser.emitProgress(() => { throw new Error("UI unavailable"); }, "Still working.");
});

test("a page without a human challenge returns immediately", async () => {
  const browser = exampleBrowser();
  const state = await browser.waitForHumanChallenge(
    null as never,
    "target",
    { captcha: false },
    async () => { throw new Error("should not poll"); },
    (current) => current.captcha,
    { detected: "", detectedAgain: "", unsolved: "", cleared: "" },
  );
  assert.deepEqual(state, { captcha: false });
});

function timingHarness(t: TestContext) {
  let now = 0;
  const waits: number[] = [];
  t.mock.method(performance, "now", () => now);
  t.mock.method(Math, "random", () => 0.5);
  t.mock.method(globalThis, "setTimeout", (callback: () => void, ms: number) => {
    waits.push(ms);
    queueMicrotask(() => { now += ms; callback(); });
    return 1;
  });
  t.mock.method(globalThis, "clearTimeout", () => {});
  return { waits, advance: (ms: number) => { now += ms; } };
}

test("normal browser gaps credit partial processing time and long summaries", async t => {
  const clock = timingHarness(t);
  const browser = exampleBrowser();
  await browser.pauseBeforeNavigation();
  clock.advance(250);
  await browser.pauseBeforeClick();
  assert.deepEqual(clock.waits, [500]);
  clock.advance(30000);
  await browser.pauseBeforeClick();
  assert.deepEqual(clock.waits, [500], "a long summary satisfies the next click gap");
  await browser.pauseBeforeNavigation();
  assert.deepEqual(clock.waits, [500, 750], "credit is not carried over to another action");
  clock.advance(30000);
  await browser.pauseBeforeNavigation();
  assert.deepEqual(clock.waits, [500, 750], "navigation also credits elapsed processing time");
});

test("Back and cautious timing retain full delays after processing", async t => {
  const clock = timingHarness(t);
  const browser = exampleBrowser();
  await browser.pauseBeforeNavigation();
  clock.advance(30000);
  await browser.pauseBeforeBack();
  await browser.pauseBeforeClick();
  assert.deepEqual(clock.waits, [750, 750], "Back resets the most recent action timestamp");
  browser.enableCautiousTiming();
  clock.advance(30000);
  await browser.pauseBeforeClick();
  clock.advance(30000);
  await browser.pauseBeforeNavigation();
  assert.deepEqual(clock.waits, [750, 750, 2250, 2250]);
});

test("credited browser gaps still honor cancellation", async t => {
  const clock = timingHarness(t);
  const browser = exampleBrowser();
  await browser.pauseBeforeNavigation();
  clock.advance(30000);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(browser.pauseBeforeClick(controller.signal), { name: "AbortError" });
  await assert.rejects(browser.pauseBeforeNavigation(controller.signal), { name: "AbortError" });
  assert.deepEqual(clock.waits, []);
});
