import { AsyncLocalStorage } from "node:async_hooks";

export type BrowserChoice = "chrome" | "edge";
const browserContext = new AsyncLocalStorage<BrowserChoice>();

export function validateBrowser(value: unknown): BrowserChoice {
  if (value === undefined) return "chrome";
  if (value === "chrome" || value === "edge") return value;
  throw new Error('browser must be "chrome" or "edge".');
}

export function currentBrowser(): BrowserChoice {
  return browserContext.getStore() ?? "chrome";
}

/** Keep provider operations and nested recovery in the invocation's browser. */
export function withBrowser<T>(browser: BrowserChoice, operation: () => T): T {
  return browserContext.run(validateBrowser(browser), operation);
}
