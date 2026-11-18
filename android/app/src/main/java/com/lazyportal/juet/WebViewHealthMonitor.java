package com.lazyportal.juet;

/**
 * Pure state machine and URL/readiness helpers for detecting and recovering
 * blank, stalled, or unmounted WebView states across initial load and warm resume.
 */
final class WebViewHealthMonitor {
    static final long STALL_TIMEOUT_MS = 12_000L;
    static final long POST_LOAD_GRACE_MS = 2_500L;
    static final long EVAL_TIMEOUT_MS = 1_500L;
    static final String READINESS_CHECK_JS =
        "(() => { const r = document.getElementById('root'); return Boolean(r && r.childElementCount > 0); })()";

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
    private boolean loadInProgress;
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

    PageStartAction onPageStarted(String url, String errorUrl, long nowMs) {
        if (isOfflineUrl(url, errorUrl)) {
            loadInProgress = false;
            return PageStartAction.CANCEL_FOR_OFFLINE;
        }
        loadInProgress = true;
        loadStartedAtMs = nowMs;
        return PageStartAction.ARM_STALL_WATCHDOG;
    }

    PageLoadAction onPageLoaded(String url, String errorUrl) {
        if (isOfflineUrl(url, errorUrl)) {
            loadInProgress = false;
            retriedWithCleanCache = false;
            return PageLoadAction.CLEAR_FOR_OFFLINE;
        }
        return PageLoadAction.SCHEDULE_POST_LOAD_CHECK;
    }

    RecoveryAction onReadinessEvaluated(String url, String errorUrl, String evalResult) {
        if (isOfflineUrl(url, errorUrl) || isMountedResult(evalResult)) {
            loadInProgress = false;
            retriedWithCleanCache = false;
            return RecoveryAction.NONE;
        }
        if (!retriedWithCleanCache) {
            retriedWithCleanCache = true;
            return RecoveryAction.RETRY_WITH_CLEAN_CACHE;
        }
        loadInProgress = false;
        retriedWithCleanCache = false;
        return errorUrl != null && !errorUrl.isEmpty()
            ? RecoveryAction.LOAD_OFFLINE_FALLBACK
            : RecoveryAction.NONE;
    }

    WarmStartDecision onStart(String url, String errorUrl, long nowMs) {
        if (!hasStartedOnce) {
            hasStartedOnce = true;
            return WarmStartDecision.of(WarmStartAction.NONE);
        }
        if (isOfflineUrl(url, errorUrl)) {
            return WarmStartDecision.of(WarmStartAction.NONE);
        }
        if (isBlankUrl(url)) {
            retriedWithCleanCache = false;
            return WarmStartDecision.of(WarmStartAction.LOAD_APP_URL);
        }
        if (loadInProgress) {
            long elapsedMs = Math.max(0L, nowMs - loadStartedAtMs);
            if (elapsedMs >= STALL_TIMEOUT_MS) {
                return WarmStartDecision.of(WarmStartAction.RELOAD_STALLED_WITH_CLEAN_CACHE);
            }
            return WarmStartDecision.rearm(Math.max(1L, STALL_TIMEOUT_MS - elapsedMs));
        }
        return WarmStartDecision.of(WarmStartAction.CHECK_READINESS);
    }

    boolean onWarmReadinessEvaluated(String url, String errorUrl, String evalResult) {
        if (isOfflineUrl(url, errorUrl) || isMountedResult(evalResult)) {
            return false;
        }
        retriedWithCleanCache = false;
        return true;
    }

    boolean isLoadInProgress() {
        return loadInProgress;
    }

    boolean hasRetriedWithCleanCache() {
        return retriedWithCleanCache;
    }
}
