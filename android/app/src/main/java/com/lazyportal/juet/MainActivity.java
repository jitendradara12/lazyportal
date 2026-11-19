package com.lazyportal.juet;

import android.content.Context;
import android.content.res.Configuration;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.CapConfig;
import com.getcapacitor.WebViewListener;
import java.net.InetAddress;
import java.util.concurrent.atomic.AtomicLong;

public class MainActivity extends BridgeActivity {
    private static final long MAX_SYSTEM_SPLASH_MS = 1_100L;
    private static final long SPLASH_EXIT_FADE_MS = 180L;
    private static final long[] EARLY_MOUNT_POLL_DELAYS_MS = { 0L, 120L, 300L, 600L, 1_000L };
    private static final AtomicLong lastRendererRecoveryMs = new AtomicLong(0L);

    private final WebViewHealthMonitor healthMonitor = new WebViewHealthMonitor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WebViewListener webViewListener;
    private BootOverlay bootOverlay;
    private Runnable activeStallWatchdog;
    private Runnable activePostLoadCheck;
    private Runnable activeEvalTimeout;
    private Runnable activeEarlyPoll;
    private Runnable activeSplashRelease;
    private int evalGeneration;
    private int earlyPollGeneration;
    private long bootStartedAtMs;
    private boolean appReadyForReveal;
    private boolean systemSplashReleased;
    private boolean bypassCacheForCurrentLoad;
    private boolean destroyed;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        bootStartedAtMs = SystemClock.uptimeMillis();
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(this::shouldKeepSystemSplash);
        splashScreen.setOnExitAnimationListener(splashViewProvider -> {
            systemSplashReleased = true;
            View splashView = splashViewProvider.getView();
            if (isInactive() || splashView == null) {
                removeSplashQuietly(splashViewProvider);
                return;
            }
            splashView.animate()
                .alpha(0f)
                .setDuration(SPLASH_EXIT_FADE_MS)
                .withEndAction(() -> removeSplashQuietly(splashViewProvider))
                .start();
        });

        preResolveServerDns(getApplicationContext());

        registerPlugin(AlertsPlugin.class);
        registerPlugin(ExamCalendarPlugin.class);
        registerPlugin(NativeInteractionsPlugin.class);
        registerPlugin(OfficialPortalPlugin.class);
        registerPlugin(PortalHttpPlugin.class);
        super.onCreate(savedInstanceState);

        applyWebViewTheme();

        View content = findViewById(android.R.id.content);
        if (content instanceof ViewGroup) {
            bootOverlay = new BootOverlay(this, this::handleManualRetry);
            bootOverlay.attachTo((ViewGroup) content);
        }

        webViewListener = new WebViewListener() {
            @Override
            public void onPageStarted(WebView view) {
                handlePageStarted(view);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                handlePageCommitVisible(view, url);
            }

            @Override
            public void onPageLoaded(WebView view) {
                handlePageLoaded(view);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                return handleRenderProcessGone();
            }
        };

        Bridge bridge = getBridge();
        if (bridge != null) {
            bridge.setWebViewClient(new PortalBridgeWebViewClient(bridge));
            bridge.addWebViewListener(webViewListener);
        }

        // Bridge.loadWebView() already triggered loadUrl(appUrl) inside super.onCreate().
        // Arm the cold-boot watchdog immediately so hangs before onPageStarted never strand
        // the user on an empty screen.
        WebView initialWebView = getActiveWebView();
        String initialUrl = initialWebView != null ? initialWebView.getUrl() : null;
        if (WebViewHealthMonitor.isOfflineUrl(initialUrl, getErrorUrl())) {
            healthMonitor.onPageLoaded(initialUrl, getErrorUrl());
            markAppReadyForReveal();
        } else {
            WebViewHealthMonitor.PageStartAction bootAction = healthMonitor.onBootStarted(bootStartedAtMs);
            if (bootAction == WebViewHealthMonitor.PageStartAction.ARM_STALL_WATCHDOG) {
                armStallWatchdog(WebViewHealthMonitor.STALL_TIMEOUT_MS);
            }
            scheduleSlowBootHandoff();
            if (initialWebView != null
                && initialWebView.getProgress() == 100
                && !WebViewHealthMonitor.isBlankUrl(initialUrl)) {
                startEarlyMountPolls(0);
            }
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        applyWebViewTheme();
        handleWarmStart();
    }

    @Override
    public void onStop() {
        super.onStop();
        appReadyForReveal = true;
        cancelSplashRelease();
        cancelPendingChecks();
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        appReadyForReveal = true;
        cancelSplashRelease();
        cancelPendingChecks();
        mainHandler.removeCallbacksAndMessages(null);
        if (bootOverlay != null) {
            bootOverlay.destroy();
            bootOverlay = null;
        }
        Bridge bridge = getBridge();
        if (bridge != null && webViewListener != null) {
            bridge.removeWebViewListener(webViewListener);
        }
        webViewListener = null;
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyWebViewTheme();
        if (bootOverlay != null) {
            bootOverlay.applyTheme();
        }
    }

    private boolean shouldKeepSystemSplash() {
        if (appReadyForReveal || systemSplashReleased || isInactive()) {
            return false;
        }
        long elapsedMs = SystemClock.uptimeMillis() - bootStartedAtMs;
        if (elapsedMs >= MAX_SYSTEM_SPLASH_MS) {
            if (bootOverlay != null && !bootOverlay.isVisible()) {
                bootOverlay.show("Connecting…");
            }
            systemSplashReleased = true;
            return false;
        }
        return true;
    }

    private void scheduleSlowBootHandoff() {
        cancelSplashRelease();
        activeSplashRelease = () -> {
            activeSplashRelease = null;
            if (isInactive() || appReadyForReveal) {
                return;
            }
            if (bootOverlay != null && !bootOverlay.isVisible()) {
                bootOverlay.show("Connecting…");
            }
            systemSplashReleased = true;
            invalidateContent();
        };
        mainHandler.postDelayed(activeSplashRelease, MAX_SYSTEM_SPLASH_MS);
    }

    private void invalidateContent() {
        View content = findViewById(android.R.id.content);
        if (content != null) {
            content.invalidate();
        }
    }

    private void cancelSplashRelease() {
        if (activeSplashRelease != null) {
            mainHandler.removeCallbacks(activeSplashRelease);
            activeSplashRelease = null;
        }
    }

    private static void removeSplashQuietly(androidx.core.splashscreen.SplashScreenViewProvider provider) {
        try {
            provider.remove();
        } catch (RuntimeException ignored) {
            // Activity or window may already be tearing down.
        }
    }

    private final class PortalBridgeWebViewClient extends BridgeWebViewClient {
        PortalBridgeWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            // Never bypass TLS validation. If the main app origin itself fails TLS before
            // mount (e.g. campus Wi-Fi captive portal), surface offline.html instead of a blank screen.
            handler.cancel();
            if (destroyed || view == null || error == null) {
                return;
            }
            if (healthMonitor.shouldFallbackOnSslError(error.getUrl(), getAppUrl())) {
                restoreDefaultCacheMode(view);
                loadOfflineFallback(view);
            }
        }
    }

    private void handleManualRetry() {
        WebView webView = getActiveWebView();
        if (webView == null) {
            return;
        }
        cancelPendingChecks();
        WebViewHealthMonitor.PageStartAction action = healthMonitor.onManualRetry(SystemClock.uptimeMillis());
        if (action == WebViewHealthMonitor.PageStartAction.ARM_STALL_WATCHDOG) {
            armStallWatchdog(WebViewHealthMonitor.STALL_TIMEOUT_MS);
        }
        reloadWithCleanCache(webView, getAppUrl());
    }

    private void handlePageStarted(WebView view) {
        if (destroyed || view == null) {
            return;
        }
        cancelPendingChecks();
        String url = view.getUrl();
        String errorUrl = getErrorUrl();
        WebViewHealthMonitor.PageStartAction action = healthMonitor.onPageStarted(
            url,
            errorUrl,
            SystemClock.uptimeMillis()
        );
        if (action == WebViewHealthMonitor.PageStartAction.CANCEL_FOR_OFFLINE) {
            restoreDefaultCacheMode(view);
            markAppReadyForReveal();
            return;
        }
        if (action == WebViewHealthMonitor.PageStartAction.ARM_STALL_WATCHDOG) {
            armStallWatchdog(WebViewHealthMonitor.STALL_TIMEOUT_MS);
        }
    }

    private void handlePageCommitVisible(WebView view, String url) {
        if (destroyed || view == null) {
            return;
        }
        String effectiveUrl = url != null && !url.isEmpty() ? url : view.getUrl();
        if (WebViewHealthMonitor.isOfflineUrl(effectiveUrl, getErrorUrl())) {
            restoreDefaultCacheMode(view);
            markAppReadyForReveal();
            return;
        }
        if (isWaitingForReveal()) {
            startEarlyMountPolls(0);
        }
    }

    private void handlePageLoaded(WebView view) {
        if (destroyed || view == null) {
            return;
        }
        restoreDefaultCacheMode(view);
        cancelPendingChecks();
        String url = view.getUrl();
        String errorUrl = getErrorUrl();
        WebViewHealthMonitor.PageLoadAction action = healthMonitor.onPageLoaded(url, errorUrl);
        if (action == WebViewHealthMonitor.PageLoadAction.CLEAR_FOR_OFFLINE) {
            markAppReadyForReveal();
            return;
        }
        if (action == WebViewHealthMonitor.PageLoadAction.SCHEDULE_POST_LOAD_CHECK) {
            if (isWaitingForReveal()) {
                startEarlyMountPolls(0);
            }
            schedulePostLoadCheck();
        }
    }

    private boolean handleRenderProcessGone() {
        if (isInactive()) {
            return true;
        }
        cancelPendingChecks();
        long now = SystemClock.uptimeMillis();
        long last = lastRendererRecoveryMs.get();
        if (WebViewHealthMonitor.shouldRecreateOnRenderProcessGone(now, last)
            && lastRendererRecoveryMs.compareAndSet(last, now)) {
            mainHandler.post(() -> {
                if (!isInactive()) {
                    recreate();
                }
            });
            return true;
        }
        WebView webView = getActiveWebView();
        if (webView != null) {
            loadOfflineFallback(webView);
        }
        return true;
    }

    private void handleWarmStart() {
        WebView webView = getActiveWebView();
        String url = webView != null ? webView.getUrl() : null;
        WebViewHealthMonitor.WarmStartDecision decision = healthMonitor.onStart(
            url,
            getErrorUrl(),
            SystemClock.uptimeMillis()
        );
        if (webView == null) {
            return;
        }
        switch (decision.action) {
            case NONE:
                break;
            case LOAD_APP_URL:
                if (bootOverlay != null) {
                    bootOverlay.show("Connecting…");
                }
                armStallWatchdog(WebViewHealthMonitor.STALL_TIMEOUT_MS);
                loadAppUrl(webView, false);
                break;
            case RELOAD_STALLED_WITH_CLEAN_CACHE:
                if (bootOverlay != null) {
                    bootOverlay.show("Retrying…");
                }
                armStallWatchdog(WebViewHealthMonitor.STALL_TIMEOUT_MS);
                reloadWithCleanCache(webView, getAppUrl());
                break;
            case REARM_STALL_WATCHDOG:
                armStallWatchdog(decision.remainingWatchdogMs);
                break;
            case CHECK_READINESS:
                evaluateReadiness(webView, result -> {
                    WebView current = getActiveWebView();
                    if (current == null) {
                        return;
                    }
                    if (healthMonitor.onWarmReadinessEvaluated(current.getUrl(), getErrorUrl(), result)) {
                        if (bootOverlay != null) {
                            bootOverlay.show("Reconnecting…");
                        }
                        healthMonitor.onManualRetry(SystemClock.uptimeMillis());
                        armStallWatchdog(WebViewHealthMonitor.STALL_TIMEOUT_MS);
                        reloadWithCleanCache(current, getAppUrl());
                    } else {
                        markAppReadyForReveal();
                    }
                });
                break;
        }
    }

    private boolean isWaitingForReveal() {
        return !appReadyForReveal || (bootOverlay != null && bootOverlay.isVisible());
    }

    private void startEarlyMountPolls(int index) {
        cancelEarlyPolls();
        if (destroyed || !isWaitingForReveal() || index >= EARLY_MOUNT_POLL_DELAYS_MS.length) {
            return;
        }
        final int pollGen = earlyPollGeneration;
        activeEarlyPoll = () -> {
            activeEarlyPoll = null;
            if (isInactive() || pollGen != earlyPollGeneration || !isWaitingForReveal()) {
                return;
            }
            WebView webView = getActiveWebView();
            if (webView == null) {
                return;
            }
            String url = webView.getUrl();
            String errorUrl = getErrorUrl();
            if (WebViewHealthMonitor.isOfflineUrl(url, errorUrl)) {
                healthMonitor.onEarlyMountConfirmed(url, errorUrl);
                markAppReadyForReveal();
                return;
            }
            webView.evaluateJavascript(WebViewHealthMonitor.READINESS_CHECK_JS, value -> {
                if (isInactive() || pollGen != earlyPollGeneration) {
                    return;
                }
                if (WebViewHealthMonitor.isMountedResult(value)) {
                    WebView current = getActiveWebView();
                    String currentUrl = current != null ? current.getUrl() : url;
                    healthMonitor.onEarlyMountConfirmed(currentUrl, getErrorUrl());
                    cancelPendingChecks();
                    markAppReadyForReveal();
                } else {
                    startEarlyMountPolls(index + 1);
                }
            });
        };
        mainHandler.postDelayed(activeEarlyPoll, EARLY_MOUNT_POLL_DELAYS_MS[index]);
    }

    private void armStallWatchdog(long delayMs) {
        cancelStallWatchdog();
        activeStallWatchdog = () -> {
            activeStallWatchdog = null;
            runReadinessCheckAndRecover();
        };
        mainHandler.postDelayed(activeStallWatchdog, delayMs);
    }

    private void schedulePostLoadCheck() {
        cancelPostLoadCheck();
        activePostLoadCheck = () -> {
            activePostLoadCheck = null;
            runReadinessCheckAndRecover();
        };
        mainHandler.postDelayed(activePostLoadCheck, WebViewHealthMonitor.POST_LOAD_GRACE_MS);
    }

    private void runReadinessCheckAndRecover() {
        WebView webView = getActiveWebView();
        if (webView == null) {
            return;
        }
        String url = webView.getUrl();
        String errorUrl = getErrorUrl();
        if (WebViewHealthMonitor.isOfflineUrl(url, errorUrl)) {
            healthMonitor.onPageLoaded(url, errorUrl);
            markAppReadyForReveal();
            return;
        }
        evaluateReadiness(webView, result -> {
            WebView current = getActiveWebView();
            if (current == null) {
                return;
            }
            WebViewHealthMonitor.RecoveryAction action =
                healthMonitor.onReadinessEvaluated(current.getUrl(), getErrorUrl(), result);
            applyRecoveryAction(current, action);
        });
    }

    private void applyRecoveryAction(WebView view, WebViewHealthMonitor.RecoveryAction action) {
        switch (action) {
            case NONE:
                markAppReadyForReveal();
                break;
            case RETRY_WITH_CLEAN_CACHE:
                if (bootOverlay != null) {
                    if (bootOverlay.isVisible()) {
                        bootOverlay.setStatus("Retrying…");
                    } else {
                        bootOverlay.show("Retrying…");
                    }
                }
                armStallWatchdog(WebViewHealthMonitor.STALL_TIMEOUT_MS);
                reloadWithCleanCache(view, getAppUrl());
                break;
            case LOAD_OFFLINE_FALLBACK:
                restoreDefaultCacheMode(view);
                loadOfflineFallback(view);
                break;
        }
    }

    private void loadOfflineFallback(WebView view) {
        String errorUrl = getErrorUrl();
        if (errorUrl != null && !errorUrl.isEmpty()) {
            view.stopLoading();
            view.loadUrl(errorUrl);
        }
        markAppReadyForReveal();
    }

    private void evaluateReadiness(WebView view, ValueCallback<String> onResult) {
        cancelEvalTimeout();
        final int generation = evalGeneration;
        final boolean[] settled = { false };
        final Runnable timeoutTask = () -> {
            if (isInactive() || settled[0] || generation != evalGeneration) {
                return;
            }
            activeEvalTimeout = null;
            settled[0] = true;
            onResult.onReceiveValue(null);
        };
        activeEvalTimeout = timeoutTask;
        mainHandler.postDelayed(timeoutTask, WebViewHealthMonitor.EVAL_TIMEOUT_MS);
        view.evaluateJavascript(WebViewHealthMonitor.READINESS_CHECK_JS, value -> {
            if (activeEvalTimeout == timeoutTask) {
                mainHandler.removeCallbacks(timeoutTask);
                activeEvalTimeout = null;
            }
            if (isInactive() || settled[0] || generation != evalGeneration) {
                return;
            }
            settled[0] = true;
            onResult.onReceiveValue(value);
        });
    }

    private void loadAppUrl(WebView view, boolean clearCache) {
        String appUrl = getAppUrl();
        if (appUrl == null || appUrl.isEmpty()) {
            return;
        }
        if (clearCache) {
            view.clearCache(true);
            enableCacheBypassForRetry(view);
        }
        view.loadUrl(appUrl);
    }

    private void reloadWithCleanCache(WebView view, String appUrl) {
        if (appUrl == null || appUrl.isEmpty()) {
            return;
        }
        view.stopLoading();
        // Clear disk HTTP cache (preserves localStorage, IndexedDB, and cookies)
        // and bypass stale entries for this retry navigation.
        view.clearCache(true);
        enableCacheBypassForRetry(view);
        view.loadUrl(appUrl);
    }

    private void enableCacheBypassForRetry(WebView view) {
        bypassCacheForCurrentLoad = true;
        view.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
    }

    private void restoreDefaultCacheMode(WebView view) {
        if (bypassCacheForCurrentLoad && view != null) {
            bypassCacheForCurrentLoad = false;
            view.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
        }
    }

    private void markAppReadyForReveal() {
        appReadyForReveal = true;
        cancelSplashRelease();
        cancelEarlyPolls();
        if (bootOverlay != null) {
            bootOverlay.dismiss();
        }
        invalidateContent();
    }

    private void cancelPendingChecks() {
        evalGeneration++;
        cancelEarlyPolls();
        cancelStallWatchdog();
        cancelPostLoadCheck();
        cancelEvalTimeout();
    }

    private void cancelEarlyPolls() {
        earlyPollGeneration++;
        if (activeEarlyPoll != null) {
            mainHandler.removeCallbacks(activeEarlyPoll);
            activeEarlyPoll = null;
        }
    }

    private void cancelStallWatchdog() {
        if (activeStallWatchdog != null) {
            mainHandler.removeCallbacks(activeStallWatchdog);
            activeStallWatchdog = null;
        }
    }

    private void cancelPostLoadCheck() {
        if (activePostLoadCheck != null) {
            mainHandler.removeCallbacks(activePostLoadCheck);
            activePostLoadCheck = null;
        }
    }

    private void cancelEvalTimeout() {
        if (activeEvalTimeout != null) {
            mainHandler.removeCallbacks(activeEvalTimeout);
            activeEvalTimeout = null;
        }
    }

    private boolean isInactive() {
        return destroyed || isFinishing() || isDestroyed();
    }

    private WebView getActiveWebView() {
        if (isInactive()) {
            return null;
        }
        Bridge bridge = getBridge();
        return bridge != null ? bridge.getWebView() : null;
    }

    private String getAppUrl() {
        Bridge bridge = getBridge();
        return bridge != null ? bridge.getAppUrl() : null;
    }

    private String getErrorUrl() {
        Bridge bridge = getBridge();
        return bridge != null ? bridge.getErrorUrl() : null;
    }

    private static void preResolveServerDns(Context appContext) {
        if (appContext == null) return;
        Thread dnsThread = new Thread(() -> {
            try {
                String serverUrl = CapConfig.loadDefault(appContext).getServerUrl();
                if (serverUrl == null || serverUrl.isEmpty()) return;
                String host = Uri.parse(serverUrl).getHost();
                if (host != null && !host.isEmpty()) {
                    InetAddress.getByName(host);
                }
            } catch (Exception ignored) {
                // Best-effort DNS cache warmup only.
            }
        }, "juet-dns-warmup");
        dnsThread.setDaemon(true);
        dnsThread.start();
    }

    @SuppressWarnings("deprecation")
    private void applyWebViewTheme() {
        int surfaceColor = ContextCompat.getColor(this, R.color.app_surface);
        if (getWindow() != null) {
            getWindow().getDecorView().setBackgroundColor(surfaceColor);
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            int nightModeFlags = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            boolean isNight = nightModeFlags == Configuration.UI_MODE_NIGHT_YES;
            webView.setBackgroundColor(surfaceColor);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && Build.VERSION.SDK_INT < 33) {
                if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK_STRATEGY)) {
                    WebSettingsCompat.setForceDarkStrategy(
                        settings,
                        WebSettingsCompat.DARK_STRATEGY_WEB_THEME_DARKENING_ONLY
                    );
                }
                settings.setForceDark(isNight ? WebSettings.FORCE_DARK_ON : WebSettings.FORCE_DARK_OFF);
            }
        }
    }
}
