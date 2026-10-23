package com.lazyportal.juet.officialportal;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.webkit.WebViewFeature;
import com.lazyportal.juet.MainActivity;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real disk-backed WebView storage at separate origins; no network/account. */
@RunWith(AndroidJUnit4.class)
public class PortalStorageDeviceTest {
    private static final String PORTAL = "https://official.lazyportal.invalid";
    private static final String MAIN = "https://lazyportal-tan.vercel.app";

    @Test public void startupCleanupRemovesLegacyTokenWithoutClearingHostedCredentials() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> activity.getBridge().getWebView().stopLoading());
            assertEquals("true", inOrigin(scenario, PORTAL, "", "localStorage.setItem('Token','legacy'); localStorage.getItem('Token') === 'legacy'"));
            assertEquals("true", inOrigin(scenario, MAIN, "", "localStorage.setItem('cleanup-sentinel','keep'); true"));
            CountDownLatch finished = new CountDownLatch(1);
            AtomicReference<Boolean> success = new AtomicReference<>();
            scenario.onActivity(activity -> PortalStorage.clear(activity, PORTAL, result -> { success.set(result); finished.countDown(); }));
            assertTrue(finished.await(10, TimeUnit.SECONDS));
            assertEquals(Boolean.TRUE, success.get());
            assertEquals("true", inOrigin(scenario, PORTAL, "", "localStorage.getItem('Token') === null"));
            assertEquals("true", inOrigin(scenario, MAIN, "", "localStorage.getItem('cleanup-sentinel') === 'keep'"));
            inOrigin(scenario, MAIN, "", "localStorage.removeItem('cleanup-sentinel'); true");
        }
    }

    @Test public void destroyingDocumentWithoutDismissalCannotPersistNewOrRefreshedTokens() throws Exception {
        // Same WebView capability required by the production portal entry point.
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<String> isolation = new AtomicReference<>();
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().stopLoading();
                try { isolation.set(PortalStorage.bootstrap(activity)); }
                catch (Exception error) { throw new AssertionError(error); }
            });
            assertEquals("true", inOrigin(scenario, PORTAL, isolation.get(),
                "localStorage.setItem('Token','fresh'); localStorage.Token='refreshed'; sessionStorage.setItem('Token','session'); localStorage.getItem('Token') === 'refreshed'"));
            // inOrigin destroys the WebView directly, with no application close
            // or storage cleanup. A separate document sees the real disk store.
            assertEquals("true", inOrigin(scenario, PORTAL, "", "localStorage.getItem('Token') === null && sessionStorage.getItem('Token') === null"));
        }
    }

    private static String inOrigin(ActivityScenario<MainActivity> scenario, String origin, String prelude, String expression) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> {
            WebView probe = new WebView(activity);
            probe.getSettings().setJavaScriptEnabled(true);
            probe.getSettings().setDomStorageEnabled(true);
            probe.getSettings().setBlockNetworkLoads(true);
            probe.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    view.evaluateJavascript(expression, value -> {
                        result.set(value); view.destroy(); evaluated.countDown();
                    });
                }
            });
            probe.loadDataWithBaseURL(origin + "/", "<!doctype html><script>" + prelude + "</script>", "text/html", "UTF-8", null);
        });
        assertTrue("Storage probe timed out", evaluated.await(10, TimeUnit.SECONDS));
        return result.get();
    }
}
