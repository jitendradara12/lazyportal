package com.lazyportal.juet;

import static org.junit.Assert.*;

import android.content.Context;
import android.util.Base64;
import androidx.appcompat.app.AppCompatActivity;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.lazyportal.juet.officialportal.PortalPolicy;
import com.lazyportal.juet.officialportal.PortalTransport;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Actual plugin/worker/lifecycle, fake JUET connections. No live API traffic. */
@RunWith(AndroidJUnit4.class)
public class PortalHttpPluginTest {
    private static class Call extends PluginCall {
        final CountDownLatch completed = new CountDownLatch(1);
        volatile JSObject response;
        volatile String error;
        Call(String id, String path) {
            super(null, "PortalHttp", id, "request", new JSObject().put("id", id).put("path", path).put("method", "GET"));
        }
        @Override public void resolve(JSObject value) { response = value; completed.countDown(); }
        @Override public void resolve() { completed.countDown(); }
        @Override public void reject(String message, String code) { error = code; completed.countDown(); }
        void await() throws Exception { assertTrue(getCallbackId() + " did not settle", completed.await(5, TimeUnit.SECONDS)); }
    }

    private static class TestPlugin extends PortalHttpPlugin {
        final MainActivity activity;
        final AtomicInteger connections = new AtomicInteger();
        final LinkedBlockingQueue<FakeConnection> opened = new LinkedBlockingQueue<>();
        TestPlugin(MainActivity activity) { this.activity = activity; }
        @Override public Context getContext() { return activity; }
        @Override public AppCompatActivity getActivity() { return activity; }
        @Override public Bridge getBridge() { return activity.getBridge(); }
        @Override protected PortalTransport createTransport(PortalPolicy policy) {
            return new PortalTransport(policy, url -> {
                connections.incrementAndGet();
                FakeConnection connection = new FakeConnection(url);
                opened.add(connection);
                return connection;
            });
        }
    }

    @Test public void authUsesDirectTransportAndCancellationAndReloadReleaseRequests() throws Exception {
        AtomicReference<TestPlugin> reference = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().stopLoading();
                TestPlugin plugin = new TestPlugin(activity);
                reference.set(plugin);
                plugin.load();
                Call capabilities = new Call("caps", "");
                plugin.capabilities(capabilities);
                assertNotNull(capabilities.response);
                assertEquals(1, (int) capabilities.response.getInteger("version"));
                Call denied = new Call("denied", "/onlinefeepayment/paynow");
                plugin.request(denied);
                assertEquals("UNSUPPORTED_ENDPOINT", denied.error);
                assertEquals(0, plugin.connections.get());
            });
            TestPlugin plugin = reference.get();
            try {
                Call captcha = new Call("captcha", "/token/getcaptcha");
                scenario.onActivity(activity -> plugin.request(captcha));
                captcha.await();
                assertNull(captcha.error);
                assertEquals(200, (int) captcha.response.getInteger("status"));
                assertEquals("{\"captcha\":\"test\"}", new String(Base64.decode(captcha.response.getString("body"), Base64.DEFAULT), StandardCharsets.UTF_8));
                FakeConnection captchaConnection = plugin.opened.poll(5, TimeUnit.SECONDS);
                assertNotNull(captchaConnection);
                assertEquals("https://studentportal.juet.ac.in/StudentPortalAPI/token/getcaptcha", captchaConnection.getURL().toString());
                assertTrue(captchaConnection.disconnected);

                for (String action : new String[] { "cancel", "reload", "destroy" }) {
                    Call waiting = new Call(action, "/token/productversion");
                    scenario.onActivity(activity -> plugin.request(waiting));
                    FakeConnection connection = plugin.opened.poll(5, TimeUnit.SECONDS);
                    assertNotNull(connection);
                    assertTrue(connection.started.await(5, TimeUnit.SECONDS));
                    scenario.onActivity(activity -> {
                        if (action.equals("cancel")) plugin.cancel(new Call(action, ""));
                        else if (action.equals("reload")) activity.getBridge().getWebView().loadDataWithBaseURL(
                            "https://lazyportal-tan.vercel.app/", "<!doctype html><title>Reload test</title>", "text/html", "UTF-8", null);
                        else plugin.handleOnDestroy();
                    });
                    waiting.await();
                    assertEquals("ABORT_ERR", waiting.error);
                    assertNull(waiting.response);
                    assertTrue(connection.disconnected);
                    assertTrue(connection.finished.await(5, TimeUnit.SECONDS));
                }
            } finally {
                scenario.onActivity(activity -> plugin.handleOnDestroy());
            }
        }
    }

    private static class FakeConnection extends HttpURLConnection {
        final CountDownLatch started = new CountDownLatch(1), finished = new CountDownLatch(1);
        volatile boolean disconnected;
        FakeConnection(URL url) { super(url); }
        @Override public void connect() {}
        @Override public void disconnect() { disconnected = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public int getResponseCode() throws IOException {
            started.countDown();
            if (url.getPath().endsWith("productversion")) {
                try { new CountDownLatch(1).await(10, TimeUnit.SECONDS); }
                catch (InterruptedException error) { throw new IOException("Cancelled"); }
                finally { finished.countDown(); }
            }
            return 200;
        }
        @Override public String getHeaderField(String name) { return "Content-Type".equals(name) ? "application/json" : null; }
        @Override public InputStream getInputStream() {
            return new ByteArrayInputStream("{\"captcha\":\"test\"}".getBytes(StandardCharsets.UTF_8));
        }
    }
}
