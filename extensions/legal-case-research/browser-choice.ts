import { AsyncLocalStorage } from "node:async_hooks";

export const BROWSER_CHOICES = ["chrome", "edge", "opera"] as const;
export type BrowserChoice = typeof BROWSER_CHOICES[number];
export const BROWSER_NAMES: Record<BrowserChoice, string> = {
  chrome: "Google Chrome", edge: "Microsoft Edge", opera: "Opera",
};
const browserContext = new AsyncLocalStorage<BrowserChoice>();

export function validateBrowser(value: unknown): BrowserChoice {
  if (value === undefined) return "chrome";
  if (value === "chrome" || value === "edge" || value === "opera") return value;
  throw new Error('browser must be "chrome", "edge", or "opera".');
}

export function currentBrowser(): BrowserChoice {
  return browserContext.getStore() ?? "chrome";
}

/** Keep provider operations and nested recovery in the invocation's browser. */
export function withBrowser<T>(browser: BrowserChoice, operation: () => T): T {
  return browserContext.run(validateBrowser(browser), operation);
}
