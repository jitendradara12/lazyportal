package com.lazyportal.juet;

import java.net.URI;
import java.util.Locale;

/**
 * Pure state machine and URL/readiness helpers for detecting and recovering
 * blank, stalled, SSL-blocked, or unmounted WebView states across cold boot,
 * warm resume, and renderer process termination.
 */
final class WebViewHealthMonitor {
    static final long STALL_TIMEOUT_MS = 8_000L;
    static final long POST_LOAD_GRACE_MS = 2_500L;
    static final long EVAL_TIMEOUT_MS = 1_500L;
    static final long RENDER_RECOVERY_COOLDOWN_MS = 5_000L;
    static final String READINESS_CHECK_JS =
        "(() => { const r = document.getElementById('root'); return Boolean(r && r.childElementCount > 0); })()";

    enum LoadState {
        IDLE,
        LOADING,
        AWAITING_MOUNT,
        MOUNTED,
        OFFLINE
    }

    enum PageStartAction {
        CANCEL_FOR_OFFLINE,
        ARM_STALL_WATCHDOG
    }

    enum PageLoadAction {
        CLEAR_FOR_OFFLINE,
        SCHEDULE_POST_LOAD_CHECK
    }

    enum RecoveryAction {
        NONE,
        RETRY_WITH_CLEAN_CACHE,
        LOAD_OFFLINE_FALLBACK
    }

    enum WarmStartAction {
        NONE,
        LOAD_APP_URL,
        RELOAD_STALLED_WITH_CLEAN_CACHE,
        REARM_STALL_WATCHDOG,
        CHECK_READINESS
    }

    static final class WarmStartDecision {
        final WarmStartAction action;
        final long remainingWatchdogMs;

        private WarmStartDecision(WarmStartAction action, long remainingWatchdogMs) {
            this.action = action;
            this.remainingWatchdogMs = remainingWatchdogMs;
        }

        static WarmStartDecision of(WarmStartAction action) {
            return new WarmStartDecision(action, 0L);
        }

        static WarmStartDecision rearm(long remainingMs) {
            return new WarmStartDecision(WarmStartAction.REARM_STALL_WATCHDOG, remainingMs);
        }
    }

    private boolean hasStartedOnce;
    private LoadState state = LoadState.IDLE;
    private long loadStartedAtMs;
    private boolean retriedWithCleanCache;

    static boolean isOfflineUrl(String url, String errorUrl) {
        if (url == null || url.isEmpty() || errorUrl == null || errorUrl.isEmpty()) {
            return false;
        }
        if (url.equals(errorUrl)) {
            return true;
        }
        if (url.startsWith(errorUrl)) {
            char boundary = url.charAt(errorUrl.length());
            return boundary == '?' || boundary == '#' || boundary == '/';
        }
        return false;
    }

    static boolean isBlankUrl(String url) {
        return url == null || url.isEmpty() || "about:blank".equals(url);
    }

    static boolean isMountedResult(String result) {
        return "true".equals(result);
    }

    static boolean sameOrigin(String firstUrl, String secondUrl) {
        if (firstUrl == null || secondUrl == null || firstUrl.isEmpty() || secondUrl.isEmpty()) {
            return false;
        }
        try {
            URI a = URI.create(firstUrl);
            URI b = URI.create(secondUrl);
            if (a.getScheme() == null || b.getScheme() == null || a.getHost() == null || b.getHost() == null) {
                return false;
            }
            String schemeA = a.getScheme().toLowerCase(Locale.ROOT);
            String schemeB = b.getScheme().toLowerCase(Locale.ROOT);
            String hostA = a.getHost().toLowerCase(Locale.ROOT);
            String hostB = b.getHost().toLowerCase(Locale.ROOT);
            int portA = effectivePort(schemeA, a.getPort());
            int portB = effectivePort(schemeB, b.getPort());
            return schemeA.equals(schemeB) && hostA.equals(hostB) && portA == portB;
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private static int effectivePort(String scheme, int port) {
        if (port != -1) return port;
        if ("https".equals(scheme)) return 443;
        if ("http".equals(scheme)) return 80;
        return -1;
    }

    static boolean shouldRecreateOnRenderProcessGone(long nowMs, long lastRecoveryMs) {
        return lastRecoveryMs <= 0L || nowMs < lastRecoveryMs || (nowMs - lastRecoveryMs) >= RENDER_RECOVERY_COOLDOWN_MS;
    }

    /** Arms boot tracking immediately after Bridge initiates loadUrl(appUrl). */
    PageStartAction onBootStarted(long nowMs) {
        state = LoadState.LOADING;
        loadStartedAtMs = nowMs;
        return PageStartAction.ARM_STALL_WATCHDOG;
    }

    /** Resets retry budget and starts a fresh tracked load for an explicit user retry. */
    PageStartAction onManualRetry(long nowMs) {
        retriedWithCleanCache = false;
        state = LoadState.LOADING;
        loadStartedAtMs = nowMs;
        return PageStartAction.ARM_STALL_WATCHDOG;
    }

    PageStartAction onPageStarted(String url, String errorUrl, long nowMs) {
        if (isOfflineUrl(url, errorUrl)) {
            state = LoadState.OFFLINE;
            return PageStartAction.CANCEL_FOR_OFFLINE;
        }
        state = LoadState.LOADING;
        loadStartedAtMs = nowMs;
        return PageStartAction.ARM_STALL_WATCHDOG;
    }

    PageLoadAction onPageLoaded(String url, String errorUrl) {
        if (isOfflineUrl(url, errorUrl)) {
            state = LoadState.OFFLINE;
            retriedWithCleanCache = false;
            return PageLoadAction.CLEAR_FOR_OFFLINE;
        }
        if (state != LoadState.MOUNTED) {
            state = LoadState.AWAITING_MOUNT;
        }
        return PageLoadAction.SCHEDULE_POST_LOAD_CHECK;
    }

    void onEarlyMountConfirmed(String url, String errorUrl) {
        if (isOfflineUrl(url, errorUrl)) {
            state = LoadState.OFFLINE;
        } else {
            state = LoadState.MOUNTED;
        }
        retriedWithCleanCache = false;
    }

    boolean shouldFallbackOnSslError(String failingUrl, String appUrl) {
        if (state == LoadState.MOUNTED || state == LoadState.OFFLINE) {
            return false;
        }
        return sameOrigin(failingUrl, appUrl);
    }

    RecoveryAction onReadinessEvaluated(String url, String errorUrl, String evalResult) {
        if (isOfflineUrl(url, errorUrl)) {
            state = LoadState.OFFLINE;
            retriedWithCleanCache = false;
            return RecoveryAction.NONE;
        }
        if (isMountedResult(evalResult)) {
            state = LoadState.MOUNTED;
            retriedWithCleanCache = false;
            return RecoveryAction.NONE;
        }
        if (!retriedWithCleanCache) {
            retriedWithCleanCache = true;
            return RecoveryAction.RETRY_WITH_CLEAN_CACHE;
        }
        boolean hasErrorUrl = errorUrl != null && !errorUrl.isEmpty();
        state = hasErrorUrl ? LoadState.OFFLINE : LoadState.IDLE;
        retriedWithCleanCache = false;
        return hasErrorUrl ? RecoveryAction.LOAD_OFFLINE_FALLBACK : RecoveryAction.NONE;
    }

    WarmStartDecision onStart(String url, String errorUrl, long nowMs) {
        if (!hasStartedOnce) {
            hasStartedOnce = true;
            return WarmStartDecision.of(WarmStartAction.NONE);
        }
        if (isOfflineUrl(url, errorUrl)) {
            state = LoadState.OFFLINE;
            return WarmStartDecision.of(WarmStartAction.NONE);
        }
        if (isBlankUrl(url)) {
            retriedWithCleanCache = false;
            state = LoadState.LOADING;
            loadStartedAtMs = nowMs;
            return WarmStartDecision.of(WarmStartAction.LOAD_APP_URL);
        }
        if (state == LoadState.LOADING) {
            long elapsedMs = Math.max(0L, nowMs - loadStartedAtMs);
            if (elapsedMs >= STALL_TIMEOUT_MS) {
                retriedWithCleanCache = true;
                loadStartedAtMs = nowMs;
                return WarmStartDecision.of(WarmStartAction.RELOAD_STALLED_WITH_CLEAN_CACHE);
            }
            return WarmStartDecision.rearm(Math.max(1L, STALL_TIMEOUT_MS - elapsedMs));
        }
        return WarmStartDecision.of(WarmStartAction.CHECK_READINESS);
    }

    boolean onWarmReadinessEvaluated(String url, String errorUrl, String evalResult) {
        if (isOfflineUrl(url, errorUrl)) {
            state = LoadState.OFFLINE;
            retriedWithCleanCache = false;
            return false;
        }
        if (isMountedResult(evalResult)) {
            state = LoadState.MOUNTED;
            retriedWithCleanCache = false;
            return false;
        }
        retriedWithCleanCache = false;
        return true;
    }

    LoadState getState() {
        return state;
    }

    boolean isLoadInProgress() {
        return state == LoadState.LOADING;
    }

    boolean isMounted() {
        return state == LoadState.MOUNTED;
    }

    boolean hasRetriedWithCleanCache() {
        return retriedWithCleanCache;
    }
}
