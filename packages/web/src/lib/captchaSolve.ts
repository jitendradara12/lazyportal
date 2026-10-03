// Shared captcha fetch + autosolve helper. Single place for the "try N times
// before manual fallback" policy (portal shows no rate limit).
import { auth } from "@juet/core";
import { client } from "./portal";
import type { Captcha } from "../types";

const MAX_AUTOSOLVE_ATTEMPTS = 10;

function isFatalSolverError(): boolean {
  // Canvas/Image missing (SSR, old webview): retrying fetch won't help.
  return (
    (typeof OffscreenCanvas === "undefined" && typeof document === "undefined") ||
    typeof Image === "undefined"
  );
}

export async function fetchAutosolvedCaptcha(
  maxAttempts = MAX_AUTOSOLVE_ATTEMPTS,
  opts?: { signal?: AbortSignal },
): Promise<{ captcha: Captcha | null; text: string; autoSolved: boolean }> {
  if (isFatalSolverError()) {
    try {
      const c = await auth.fetchCaptcha(client);
      return { captcha: c, text: "", autoSolved: false };
    } catch {
      return { captcha: null, text: "", autoSolved: false };
    }
  }
  let last: Captcha | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts?.signal?.aborted) break;
    let c: Captcha;
    try {
      c = await auth.fetchCaptcha(client);
    } catch {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      // Network blip fetching the image: retry with a fresh fetch.
      continue;
    }
    last = c;
    try {
      const solved = await auth.solveCaptcha(c);
      if (solved) return { captcha: c, text: solved, autoSolved: true };
      // Empty = low-confidence guess: fetch a fresh image and try again.
    } catch {
      // Solver threw on this image: try a fresh one.
    }
  }
  return { captcha: last, text: "", autoSolved: false };
}

export { MAX_AUTOSOLVE_ATTEMPTS };
