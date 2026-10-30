package com.lazyportal.juet.officialportal;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.webkit.WebViewFeature;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.platform.app.InstrumentationRegistry;
import com.lazyportal.juet.MainActivity;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import android.view.View;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises the actual origin-scoped WebView bridge, response delivery and
 * dismissal. All JUET responses are fake; no password or portal access needed. */
@RunWith(AndroidJUnit4.class)
public class OfficialPortalViewDeviceTest {
    @Test public void isolatedViewDeliversReadsRejectsWritesAndClosesCleanly() throws Exception {
        requireBridge();
        AtomicInteger connections = new AtomicInteger();
        AtomicReference<OfficialPortalView> portal = new AtomicReference<>();
        CountDownLatch closed = new CountDownLatch(1);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().stopLoading();
                try {
                    PortalPolicy policy = PortalPolicy.load(activity);
                    PortalTransport transport = new PortalTransport(policy, url -> { connections.incrementAndGet(); return new FakeConnection(url); });
                    String bootstrap = "window.replies=[];OfficialPortalNative.onmessage=e=>window.replies.push(JSON.parse(e.data));"
                        + "OfficialPortalNative.postMessage(JSON.stringify({id:'1:1',method:'POST',path:'/clxuser/getmenulist',headers:{authorization:'Bearer test'},body:'encrypted'}));";
                    portal.set(new OfficialPortalView(activity, policy, bootstrap, expired -> closed.countDown(), transport));
                    portal.get().show();
                } catch (Exception error) { throw new AssertionError(error); }
            });
            waitFor(scenario, portal.get(), "window.replies?.[0]?.status === 200");
            // Check actual rendering scale, independent of device pixel density.
            waitFor(scenario, portal.get(), "Math.abs(window.visualViewport.scale - 0.6) < 0.05");
            scenario.onActivity(activity -> portal.get().webView.zoomBy(1.5f));
            waitFor(scenario, portal.get(), "window.visualViewport.scale > 0.7");
            int before = connections.get();
            scenario.onActivity(activity -> portal.get().webView.evaluateJavascript(
                "OfficialPortalNative.postMessage(JSON.stringify({id:'1:2',method:'POST',path:'/onlinefeepayment/paynow',body:'blocked'}));", null));
            waitFor(scenario, portal.get(), "window.replies?.[1]?.error?.includes('Read-only') === true");
            assertEquals(before, connections.get());
            scenario.onActivity(activity -> portal.get().close());
            assertTrue(closed.await(3, TimeUnit.SECONDS));
        }
    }

    @Test public void packagedRuntimeWorksAndDismissalCannotOrphanAReopenedView() throws Exception {
        requireBridge();
        String bootstrap;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("official-portal-bootstrap.js");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            bootstrap = output.toString("UTF-8") + "\nwindow.runtimeLoaded=false;fetch('/StudentPortalAPI/clxuser/getmenulist',{method:'POST',body:'encrypted'}).then(r=>r.json()).then(()=>window.runtimeLoaded=true);";
        }
        AtomicReference<OfficialPortalView> active = new AtomicReference<>();
        AtomicInteger closed = new AtomicInteger();
        CountDownLatch expiredClose = new CountDownLatch(1);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().stopLoading();
                try {
                    PortalPolicy policy = PortalPolicy.load(activity);
                    active.set(new OfficialPortalView(activity, policy, bootstrap, expired -> {
                        active.set(null); closed.incrementAndGet();
                        if (expired) expiredClose.countDown();
                    }, new PortalTransport(policy, FakeConnection::new)));
                    active.get().show();
                } catch (Exception error) { throw new AssertionError(error); }
            });
            waitFor(scenario, active.get(), "window.runtimeLoaded === true && localStorage.getItem('Token') === 'instrumentation-token'");
            scenario.onActivity(activity -> {
                // Artificial side cutout: verify the same inset callback used
                // by landscape phones, independent of emulator hardware.
                View root = (View) active.get().webView.getParent();
                WindowInsetsCompat cutout = new WindowInsetsCompat.Builder()
                    .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.of(0, 24, 0, 24))
                    .setInsets(WindowInsetsCompat.Type.displayCutout(), Insets.of(70, 0, 0, 0)).build();
                ViewCompat.dispatchApplyWindowInsets(root, cutout);
                assertEquals(70, root.getPaddingLeft());
                assertEquals(24, root.getPaddingTop());
                OfficialPortalView previous = active.get();
                previous.close();
                assertNull(active.get());
                assertEquals(1, closed.get());
                try {
                    PortalPolicy policy = PortalPolicy.load(activity);
                    active.set(new OfficialPortalView(activity, policy, bootstrap, expired -> {
                        active.set(null); closed.incrementAndGet();
                        if (expired) expiredClose.countDown();
                    }, new PortalTransport(policy, FakeConnection::new)));
                    active.get().show();
                } catch (Exception error) { throw new AssertionError(error); }
                // Redundant close/delayed dismiss must not deliver A's callback
                // twice and erase the reference to B.
                previous.close();
            });
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            assertNotNull(active.get());
            assertEquals(1, closed.get());
            waitFor(scenario, active.get(), "window.runtimeLoaded === true");
            // A failed refresh in the real runtime must dismiss the native
            // view and deliver expiry without another tap on Close.
            scenario.onActivity(activity -> active.get().webView.evaluateJavascript(
                "fetch('/StudentPortalAPI/token/refreshTokenRequest',{method:'POST',body:'{}'});", null));
            assertTrue(expiredClose.await(3, TimeUnit.SECONDS));
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            assertNull(active.get());
            assertEquals(2, closed.get());
        }
    }

    private static void requireBridge() {
        boolean supported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
        if (android.os.Build.VERSION.SDK_INT >= 36) assertTrue("Current Android must exercise the native bridge, not skip it", supported);
        else assumeTrue(supported); // Older devices show the production WebView-update prompt.
    }
    private static void waitFor(ActivityScenario<MainActivity> scenario, OfficialPortalView portal, String expression) throws Exception {
        for (int attempt = 0; attempt < 50; attempt++) {
            CountDownLatch evaluated = new CountDownLatch(1);
            AtomicReference<String> result = new AtomicReference<>();
            scenario.onActivity(activity -> portal.webView.evaluateJavascript(expression, value -> { result.set(value); evaluated.countDown(); }));
            assertTrue(evaluated.await(2, TimeUnit.SECONDS));
            if ("true".equals(result.get())) return;
            Thread.sleep(100);
        }
        fail("WebView did not complete: " + expression);
    }
    private static class FakeConnection extends HttpURLConnection {
        FakeConnection(URL url) { super(url); }
        @Override public void connect() {}
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public int getResponseCode() { return 200; }
        @Override public String getContentType() { return url.getPath().contains("StudentPortalAPI") ? "application/json" : "text/html"; }
        @Override public String getHeaderField(String key) { return "Content-Type".equals(key) ? getContentType() : null; }
        @Override public OutputStream getOutputStream() { return new ByteArrayOutputStream(); }
        @Override public InputStream getInputStream() {
            String text = url.getPath().contains("StudentPortalAPI") ? "{\"response\":[]}" : "<!doctype html><html><head></head><body>Portal test</body></html>";
            return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
        }
    }
}
