package com.lazyportal.juet;

import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private final WebViewHealthMonitor healthMonitor = new WebViewHealthMonitor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WebViewListener webViewListener;
    private Runnable activeStallWatchdog;
    private Runnable activePostLoadCheck;
    private Runnable activeEvalTimeout;
    private int evalGeneration;
    private boolean destroyed;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlertsPlugin.class);
        registerPlugin(ExamCalendarPlugin.class);
        registerPlugin(NativeInteractionsPlugin.class);
        registerPlugin(OfficialPortalPlugin.class);
        registerPlugin(PortalHttpPlugin.class);
        super.onCreate(savedInstanceState);

        webViewListener = new WebViewListener() {
            @Override
            public void onPageStarted(WebView view) {
                handlePageStarted(view);
            }

            @Override
            public void onPageLoaded(WebView view) {
                handlePageLoaded(view);
            }
        };
        Bridge bridge = getBridge();
        if (bridge != null) {
            bridge.addWebViewListener(webViewListener);
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
        cancelPendingChecks();
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        cancelPendingChecks();
        mainHandler.removeCallbacksAndMessages(null);
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
    }

    private void handlePageStarted(WebView view) {
        if (destroyed || view == null) {
            return;
        }
        cancelPendingChecks();
        WebViewHealthMonitor.PageStartAction action = healthMonitor.onPageStarted(
            view.getUrl(),
            getErrorUrl(),
            SystemClock.uptimeMillis()
        );
        if (action == WebViewHealthMonitor.PageStartAction.ARM_STALL_WATCHDOG) {
            armStallWatchdog(WebViewHealthMonitor.STALL_TIMEOUT_MS);
        }
    }

    private void handlePageLoaded(WebView view) {
        if (destroyed || view == null) {
            return;
        }
        cancelPendingChecks();
        WebViewHealthMonitor.PageLoadAction action = healthMonitor.onPageLoaded(
            view.getUrl(),
            getErrorUrl()
        );
        if (action == WebViewHealthMonitor.PageLoadAction.SCHEDULE_POST_LOAD_CHECK) {
            schedulePostLoadCheck();
        }
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
                loadAppUrl(webView, false);
                break;
            case RELOAD_STALLED_WITH_CLEAN_CACHE:
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
                        loadAppUrl(current, true);
                    }
                });
                break;
        }
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
                break;
            case RETRY_WITH_CLEAN_CACHE:
                reloadWithCleanCache(view, getAppUrl());
                break;
            case LOAD_OFFLINE_FALLBACK:
                String errorUrl = getErrorUrl();
                if (errorUrl != null && !errorUrl.isEmpty()) {
                    view.stopLoading();
                    view.loadUrl(errorUrl);
                }
                break;
        }
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
            view.clearCache(false);
        }
        view.loadUrl(appUrl);
    }

    private void reloadWithCleanCache(WebView view, String appUrl) {
        if (appUrl == null || appUrl.isEmpty()) {
            return;
        }
        view.stopLoading();
        view.clearCache(false);
        view.loadUrl(appUrl);
    }

    private void cancelPendingChecks() {
        evalGeneration++;
        cancelStallWatchdog();
        cancelPostLoadCheck();
        cancelEvalTimeout();
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

    private void applyWebViewTheme() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            int nightModeFlags = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            boolean isNight = nightModeFlags == Configuration.UI_MODE_NIGHT_YES;
            webView.setBackgroundColor(isNight ? 0xFF141316 : 0xFFFCF8FD);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && Build.VERSION.SDK_INT < 33) {
                settings.setForceDark(isNight ? WebSettings.FORCE_DARK_ON : WebSettings.FORCE_DARK_OFF);
            }
        }
    }
}

