package com.lazyportal.juet.officialportal;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.webkit.WebViewFeature;
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
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises the actual origin-scoped WebView bridge, response delivery and
 * dismissal. All JUET responses are fake; no password or portal access needed. */
@RunWith(AndroidJUnit4.class)
public class OfficialPortalViewDeviceTest {
    @Test public void isolatedViewDeliversReadsRejectsWritesAndClosesCleanly() throws Exception {
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));
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
            int before = connections.get();
            scenario.onActivity(activity -> portal.get().webView.evaluateJavascript(
                "OfficialPortalNative.postMessage(JSON.stringify({id:'1:2',method:'POST',path:'/onlinefeepayment/paynow',body:'blocked'}));", null));
            waitFor(scenario, portal.get(), "window.replies?.[1]?.error?.includes('Read-only') === true");
            assertEquals(before, connections.get());
            scenario.onActivity(activity -> portal.get().close());
            assertTrue(closed.await(3, TimeUnit.SECONDS));
        }
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
