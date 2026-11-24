// Shared captcha fetch + autosolve policy for login and reconnect.
import { auth } from "@juet/core";
import { client, MAX_AUTOSOLVE_ATTEMPTS } from "./portal";
import type { Captcha } from "../types";

export const MAX_CAPTCHA_FETCH_ATTEMPTS = 2;

function isNonRetryableFetchError(error: unknown): boolean {
  const e = error as { name?: string; code?: string; status?: number } | null | undefined;
  return Boolean(
    e && (
      e.code === "REQUEST_TIMEOUT" ||
      e.name === "AbortError" ||
      e.code === "ABORT_ERR" ||
      e.status === 429
    ),
  );
}

function waitBackoff(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isFatalSolverError(): boolean {
  // Canvas/Image missing (SSR, old webview): retrying fetch won't help.
  return (
    (typeof OffscreenCanvas === "undefined" && typeof document === "undefined") ||
    typeof Image === "undefined"
  );
}

export async function fetchAutosolvedCaptcha(
  maxAttempts = MAX_AUTOSOLVE_ATTEMPTS,
  opts?: { signal?: AbortSignal; manual?: boolean; onCaptcha?: (captcha: Captcha) => void },
): Promise<{ captcha: Captcha | null; text: string; autoSolved: boolean }> {
  if (opts?.manual || isFatalSolverError()) {
    try {
      const c = await auth.fetchCaptcha(client, { signal: opts?.signal });
      if (opts?.signal?.aborted) return { captcha: null, text: "", autoSolved: false };
      opts?.onCaptcha?.(c);
      return { captcha: c, text: "", autoSolved: false };
    } catch (error) {
      if (opts?.signal?.aborted) return { captcha: null, text: "", autoSolved: false };
      throw error;
    }
  }
  let last: Captcha | null = null;
  let fetchError: unknown = new Error("Couldn't load captcha. Try refreshing it.");
  let consecutiveFetchErrors = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts?.signal?.aborted) break;
    let c: Captcha;
    try {
      c = await auth.fetchCaptcha(client, { signal: opts?.signal });
    } catch (error) {
      if (opts?.signal?.aborted) break;
      fetchError = error;
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      if (isNonRetryableFetchError(error)) break;
      if (++consecutiveFetchErrors >= MAX_CAPTCHA_FETCH_ATTEMPTS) break;
      await waitBackoff(400 * consecutiveFetchErrors, opts?.signal);
      continue;
    }
    if (opts?.signal?.aborted) break;
    consecutiveFetchErrors = 0;
    last = c;
    opts?.onCaptcha?.(c);
    // Let the image and manual input paint before running the pixel matcher.
    if (typeof requestAnimationFrame === "function") {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (opts?.signal?.aborted) break;
    try {
      const solved = await auth.solveCaptcha(c, { signal: opts?.signal });
      if (opts?.signal?.aborted) break;
      if (solved) return { captcha: c, text: solved, autoSolved: true };
      // Empty = low-confidence guess: fetch a fresh image and try again.
    } catch {
      if (opts?.signal?.aborted) break;
      // Solver threw on this image: try a fresh one.
    }
  }
  if (opts?.signal?.aborted) return { captcha: null, text: "", autoSolved: false };
  if (!last) throw fetchError;
  return { captcha: last, text: "", autoSolved: false };
}

export { MAX_AUTOSOLVE_ATTEMPTS };
