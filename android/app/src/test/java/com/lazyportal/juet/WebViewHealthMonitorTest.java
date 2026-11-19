package com.lazyportal.juet;

import static org.junit.Assert.*;

import org.junit.Test;

/** JVM unit tests for {@link WebViewHealthMonitor} recovery state machine and warm-resume logic. */
public class WebViewHealthMonitorTest {
    private static final String APP_URL = "https://lazyportal-tan.vercel.app/";
    private static final String ERROR_URL = "https://localhost/offline.html";

    @Test
    public void recognizesOfflineBlankAndOriginUrlsSafely() {
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

        assertTrue(WebViewHealthMonitor.sameOrigin("https://lazyportal-tan.vercel.app/attendance", APP_URL));
        assertTrue(WebViewHealthMonitor.sameOrigin("HTTPS://LAZYPORTAL-TAN.VERCEL.APP:443/", APP_URL));
        assertFalse(WebViewHealthMonitor.sameOrigin("https://static.cloudflareinsights.com/beacon.min.js", APP_URL));
        assertFalse(WebViewHealthMonitor.sameOrigin("http://lazyportal-tan.vercel.app/", APP_URL));
        assertFalse(WebViewHealthMonitor.sameOrigin("not a url", APP_URL));
    }

    @Test
    public void readinessScriptMatchesExpectedDomCheck() {
        assertEquals(
            "(() => { const r = document.getElementById('root'); return Boolean(r && r.childElementCount > 0); })()",
            WebViewHealthMonitor.READINESS_CHECK_JS
        );
    }

    @Test
    public void coldBootArmsWatchdogEvenIfOnPageStartedNeverFires() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();

        assertEquals(
            WebViewHealthMonitor.PageStartAction.ARM_STALL_WATCHDOG,
            monitor.onBootStarted(1_000L)
        );
        assertTrue(monitor.isLoadInProgress());

        // First onStart() is cold start and leaves boot watchdog intact.
        assertEquals(
            WebViewHealthMonitor.WarmStartAction.NONE,
            monitor.onStart(APP_URL, ERROR_URL, 1_050L).action
        );

        // Backgrounding and returning before stall timeout re-arms remaining window.
        WebViewHealthMonitor.WarmStartDecision rearm =
            monitor.onStart(APP_URL, ERROR_URL, 3_500L);
        assertEquals(WebViewHealthMonitor.WarmStartAction.REARM_STALL_WATCHDOG, rearm.action);
        assertEquals(WebViewHealthMonitor.STALL_TIMEOUT_MS - 2_500L, rearm.remainingWatchdogMs);

        // Returning past stall timeout immediately reloads with clean cache.
        assertEquals(
            WebViewHealthMonitor.WarmStartAction.RELOAD_STALLED_WITH_CLEAN_CACHE,
            monitor.onStart(APP_URL, ERROR_URL, 1_000L + WebViewHealthMonitor.STALL_TIMEOUT_MS).action
        );
        assertTrue(monitor.hasRetriedWithCleanCache());
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
        assertFalse(monitor.isLoadInProgress());
        assertEquals(WebViewHealthMonitor.LoadState.AWAITING_MOUNT, monitor.getState());

        assertEquals(
            WebViewHealthMonitor.RecoveryAction.NONE,
            monitor.onReadinessEvaluated(APP_URL, ERROR_URL, "true")
        );
        assertTrue(monitor.isMounted());
        assertFalse(monitor.isLoadInProgress());
        assertFalse(monitor.hasRetriedWithCleanCache());
    }

    @Test
    public void warmResumeDuringPostLoadGraceChecksReadinessInsteadOfReloading() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();

        monitor.onBootStarted(1_000L);
        monitor.onStart(APP_URL, ERROR_URL, 1_010L);
        monitor.onPageStarted(APP_URL, ERROR_URL, 1_200L);
        monitor.onPageLoaded(APP_URL, ERROR_URL);

        // User switched away during POST_LOAD_GRACE_MS and returned 20s later.
        // Page already finished loading; check readiness instead of blowing it away.
        assertEquals(
            WebViewHealthMonitor.WarmStartAction.CHECK_READINESS,
            monitor.onStart(APP_URL, ERROR_URL, 25_000L).action
        );
        assertFalse(monitor.onWarmReadinessEvaluated(APP_URL, ERROR_URL, "true"));
        assertTrue(monitor.isMounted());
    }

    @Test
    public void earlyMountConfirmationMarksMountedAndResetsRetryBudget() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();

        monitor.onBootStarted(1_000L);
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.RETRY_WITH_CLEAN_CACHE,
            monitor.onReadinessEvaluated(APP_URL, ERROR_URL, "false")
        );
        assertTrue(monitor.hasRetriedWithCleanCache());

        monitor.onEarlyMountConfirmed(APP_URL, ERROR_URL);
        assertTrue(monitor.isMounted());
        assertFalse(monitor.hasRetriedWithCleanCache());
    }

    @Test
    public void manualRetryResetsBudgetAndArmsWatchdog() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();

        monitor.onBootStarted(1_000L);
        assertEquals(
            WebViewHealthMonitor.RecoveryAction.RETRY_WITH_CLEAN_CACHE,
            monitor.onReadinessEvaluated(APP_URL, ERROR_URL, "false")
        );
        assertTrue(monitor.hasRetriedWithCleanCache());

        assertEquals(
            WebViewHealthMonitor.PageStartAction.ARM_STALL_WATCHDOG,
            monitor.onManualRetry(10_000L)
        );
        assertTrue(monitor.isLoadInProgress());
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
    public void sslFallbackOnlyTriggersForMainAppOriginBeforeMount() {
        WebViewHealthMonitor monitor = new WebViewHealthMonitor();
        monitor.onBootStarted(1_000L);

        assertTrue(monitor.shouldFallbackOnSslError(APP_URL, APP_URL));
        assertTrue(monitor.shouldFallbackOnSslError(APP_URL + "assets/app.js", APP_URL));
        assertFalse(monitor.shouldFallbackOnSslError("https://static.cloudflareinsights.com/beacon.min.js", APP_URL));

        monitor.onEarlyMountConfirmed(APP_URL, ERROR_URL);
        assertFalse(monitor.shouldFallbackOnSslError(APP_URL, APP_URL));
    }

    @Test
    public void renderProcessRecoveryEnforcesCooldownAgainstCrashLoops() {
        assertTrue(WebViewHealthMonitor.shouldRecreateOnRenderProcessGone(1_000L, 0L));
        assertFalse(WebViewHealthMonitor.shouldRecreateOnRenderProcessGone(3_000L, 1_000L));
        assertTrue(
            WebViewHealthMonitor.shouldRecreateOnRenderProcessGone(
                1_000L + WebViewHealthMonitor.RENDER_RECOVERY_COOLDOWN_MS,
                1_000L
            )
        );
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
