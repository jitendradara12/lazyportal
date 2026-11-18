package com.lazyportal.juet;

import static org.junit.Assert.*;

import org.junit.Test;

/** JVM unit tests for {@link WebViewHealthMonitor} recovery state machine and warm-resume logic. */
public class WebViewHealthMonitorTest {
    private static final String APP_URL = "https://lazyportal-tan.vercel.app/";
    private static final String ERROR_URL = "https://localhost/offline.html";

    @Test
    public void recognizesOfflineAndBlankUrlsSafely() {
        assertTrue(WebViewHealthMonitor.isOfflineUrl(ERROR_URL, ERROR_URL));
        assertTrue(WebViewHealthMonitor.isOfflineUrl(ERROR_URL + "?retry=1", ERROR_URL));
        assertTrue(WebViewHealthMonitor.isOfflineUrl(ERROR_URL + "#top", ERROR_URL));

        assertFalse(WebViewHealthMonitor.isOfflineUrl(APP_URL, ERROR_URL));
        assertFalse(WebViewHealthMonitor.isOfflineUrl(ERROR_URL + ".bak", ERROR_URL));
        assertFalse(WebViewHealthMonitor.isOfflineUrl(null, ERROR_URL));
        assertFalse(WebViewHealthMonitor.isOfflineUrl("", ERROR_URL));
        assertFalse(WebViewHealthMonitor.isOfflineUrl(ERROR_URL, null));
        assertFalse(WebViewHealthMonitor.isOfflineUrl(ERROR_URL, ""));

        assertTrue(WebViewHealthMonitor.isBlankUrl(null));
        assertTrue(WebViewHealthMonitor.isBlankUrl(""));
        assertTrue(WebViewHealthMonitor.isBlankUrl("about:blank"));
        assertFalse(WebViewHealthMonitor.isBlankUrl(APP_URL));

        assertTrue(WebViewHealthMonitor.isMountedResult("true"));
        assertFalse(WebViewHealthMonitor.isMountedResult("false"));
        assertFalse(WebViewHealthMonitor.isMountedResult("null"));
        assertFalse(WebViewHealthMonitor.isMountedResult(null));
    }

    @Test
    public void readinessScriptMatchesExpectedDomCheck() {
        assertEquals(
            "(() => { const r = document.getElementById('root'); return Boolean(r && r.childElementCount > 0); })()",
            WebViewHealthMonitor.READINESS_CHECK_JS
        );
    }

    @Test
    public void healthyBootClearsLoadInProgressWithoutReload() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();

        assertEquals(
            WebViewHealthMonitor.WarmStartAction.NONE,
            monitor.onStart(null, ERROR_URL, 1_000L).action
        );
        assertEquals(
            WebViewHealthMonitor.PageStartAction.ARM_STALL_WATCHDOG,
            monitor.onPageStarted(APP_URL, ERROR_URL, 1_050L)
        );
        assertTrue(monitor.isLoadInProgress());

        assertEquals(
            WebViewHealthMonitor.PageLoadAction.SCHEDULE_POST_LOAD_CHECK,
            monitor.onPageLoaded(APP_URL, ERROR_URL)
        );
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.NONE,
            monitor.onReadinessEvaluated(APP_URL, ERROR_URL, "true")
        );
        assertFalse(monitor.isLoadInProgress());
        assertFalse(monitor.hasRetriedWithCleanCache());
    }

    @Test
    public void unmountedPostLoadRetriesOnceWithCleanCacheThenFallsBackToOffline() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();

        assertEquals(
            WebViewHealthMonitor.PageStartAction.ARM_STALL_WATCHDOG,
            monitor.onPageStarted(APP_URL, ERROR_URL, 1_000L)
        );
        assertEquals(
            WebViewHealthMonitor.PageLoadAction.SCHEDULE_POST_LOAD_CHECK,
            monitor.onPageLoaded(APP_URL, ERROR_URL)
        );
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.RETRY_WITH_CLEAN_CACHE,
            monitor.onReadinessEvaluated(APP_URL, ERROR_URL, "false")
        );
        assertTrue(monitor.hasRetriedWithCleanCache());

        // Second attempt fails (e.g. eval timeout returns null) -> offline fallback.
        assertEquals(
            WebViewHealthMonitor.PageStartAction.ARM_STALL_WATCHDOG,
            monitor.onPageStarted(APP_URL, ERROR_URL, 4_000L)
        );
        assertEquals(
            WebViewHealthMonitor.PageLoadAction.SCHEDULE_POST_LOAD_CHECK,
            monitor.onPageLoaded(APP_URL, ERROR_URL)
        );
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.LOAD_OFFLINE_FALLBACK,
            monitor.onReadinessEvaluated(APP_URL, ERROR_URL, null)
        );
        assertFalse(monitor.isLoadInProgress());
        assertFalse(monitor.hasRetriedWithCleanCache());
    }

    @Test
    public void successfulCleanCacheRetryResetsRetryFlagForFutureFailures() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();

        monitor.onPageStarted(APP_URL, ERROR_URL, 1_000L);
        monitor.onPageLoaded(APP_URL, ERROR_URL);
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.RETRY_WITH_CLEAN_CACHE,
            monitor.onReadinessEvaluated(APP_URL, ERROR_URL, "false")
        );
        assertTrue(monitor.hasRetriedWithCleanCache());

        monitor.onPageStarted(APP_URL, ERROR_URL, 4_000L);
        monitor.onPageLoaded(APP_URL, ERROR_URL);
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.NONE,
            monitor.onReadinessEvaluated(APP_URL, ERROR_URL, "true")
        );
        assertFalse(monitor.isLoadInProgress());
        assertFalse(monitor.hasRetriedWithCleanCache());

        // Later failure gets a fresh clean-cache retry instead of jumping straight to offline.
        monitor.onPageStarted(APP_URL, ERROR_URL, 10_000L);
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.RETRY_WITH_CLEAN_CACHE,
            monitor.onReadinessEvaluated(APP_URL, ERROR_URL, "false")
        );
    }

    @Test
    public void nullErrorUrlStopsLoadingAfterSecondFailureWithoutLooping() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();

        monitor.onPageStarted(APP_URL, null, 1_000L);
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.RETRY_WITH_CLEAN_CACHE,
            monitor.onReadinessEvaluated(APP_URL, null, "false")
        );
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.NONE,
            monitor.onReadinessEvaluated(APP_URL, null, "false")
        );
        assertFalse(monitor.isLoadInProgress());
        assertFalse(monitor.hasRetriedWithCleanCache());
    }

    @Test
    public void offlineUrlNeverTriggersWatchdogsOrReloads() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();

        // Initial cold start.
        assertEquals(
            WebViewHealthMonitor.WarmStartAction.NONE,
            monitor.onStart(APP_URL, ERROR_URL, 1_000L).action
        );

        monitor.onPageStarted(APP_URL, ERROR_URL, 1_100L);
        assertEquals(
            WebViewHealthMonitor.PageStartAction.CANCEL_FOR_OFFLINE,
            monitor.onPageStarted(ERROR_URL, ERROR_URL, 1_200L)
        );
        assertFalse(monitor.isLoadInProgress());

        assertEquals(
            WebViewHealthMonitor.PageLoadAction.CLEAR_FOR_OFFLINE,
            monitor.onPageLoaded(ERROR_URL, ERROR_URL)
        );
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.NONE,
            monitor.onReadinessEvaluated(ERROR_URL, ERROR_URL, "false")
        );
        assertEquals(
            WebViewHealthMonitor.WarmStartAction.NONE,
            monitor.onStart(ERROR_URL, ERROR_URL, 20_000L).action
        );
        assertFalse(monitor.onWarmReadinessEvaluated(ERROR_URL, ERROR_URL, "false"));
    }

    @Test
    public void warmResumeRecoversBlankStalledAndUnmountedStatesWhileKeepingHealthyMounted() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();

        // First onStart() is cold launch and must be skipped even when URL is blank.
        assertEquals(
            WebViewHealthMonitor.WarmStartAction.NONE,
            monitor.onStart(null, ERROR_URL, 1_000L).action
        );

        // Blank URL on warm resume reloads appUrl and resets retry state.
        monitor.onPageStarted(APP_URL, ERROR_URL, 1_100L);
        monitor.onReadinessEvaluated(APP_URL, ERROR_URL, "false");
        assertTrue(monitor.hasRetriedWithCleanCache());
        assertEquals(
            WebViewHealthMonitor.WarmStartAction.LOAD_APP_URL,
            monitor.onStart("about:blank", ERROR_URL, 2_000L).action
        );
        assertFalse(monitor.hasRetriedWithCleanCache());

        // In-flight load within stall window re-arms watchdog for remaining duration.
        monitor.onPageStarted(APP_URL, ERROR_URL, 5_000L);
        WebViewHealthMonitor.WarmStartDecision rearmDecision =
            monitor.onStart(APP_URL, ERROR_URL, 9_500L);
        assertEquals(WebViewHealthMonitor.WarmStartAction.REARM_STALL_WATCHDOG, rearmDecision.action);
        assertEquals(WebViewHealthMonitor.STALL_TIMEOUT_MS - 4_500L, rearmDecision.remainingWatchdogMs);

        // In-flight load past stall timeout triggers immediate stop + clean-cache reload.
        assertEquals(
            WebViewHealthMonitor.WarmStartAction.RELOAD_STALLED_WITH_CLEAN_CACHE,
            monitor.onStart(APP_URL, ERROR_URL, 5_000L + WebViewHealthMonitor.STALL_TIMEOUT_MS).action
        );

        // Settled load checks readiness: mounted stays healthy, unmounted reloads with clean cache.
        monitor.onPageStarted(APP_URL, ERROR_URL, 20_000L);
        monitor.onPageLoaded(APP_URL, ERROR_URL);
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.NONE,
            monitor.onReadinessEvaluated(APP_URL, ERROR_URL, "true")
        );
        assertEquals(
            WebViewHealthMonitor.WarmStartAction.CHECK_READINESS,
            monitor.onStart(APP_URL, ERROR_URL, 25_000L).action
        );
        assertFalse(monitor.onWarmReadinessEvaluated(APP_URL, ERROR_URL, "true"));
        assertTrue(monitor.onWarmReadinessEvaluated(APP_URL, ERROR_URL, "false"));
        assertTrue(monitor.onWarmReadinessEvaluated(APP_URL, ERROR_URL, null));
        assertFalse(monitor.hasRetriedWithCleanCache());
    }
}
