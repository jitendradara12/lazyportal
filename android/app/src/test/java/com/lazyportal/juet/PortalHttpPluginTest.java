package com.lazyportal.juet;

import static org.junit.Assert.*;

import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.lazyportal.juet.officialportal.PortalPolicy;
import com.lazyportal.juet.officialportal.PortalTransport;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

/** JVM unit tests for PortalHttpPlugin lifecycle, null-activity guards, and executor capacity. */
public class PortalHttpPluginTest {
    private PortalPolicy policy;

    @Before public void loadPolicy() throws Exception {
        String json = new String(
            Files.readAllBytes(new File("src/main/assets/portal-api-policy.json").toPath()),
            StandardCharsets.UTF_8
        );
        policy = new PortalPolicy(new JSONObject(json));
    }

    private static JSObject attendanceRequest(String id) throws Exception {
        return new JSObject()
            .put("id", id)
            .put("method", "POST")
            .put("path", "/StudentClassAttendance/getstudentsubjectpersentage")
            .put("body", "opaque-body");
    }

    @Test public void nullActivityGuardsRequestCancelAndDestroy() throws Exception {
        AtomicInteger openedConnections = new AtomicInteger();
        PortalTransport transport = new PortalTransport(policy, url -> {
            openedConnections.incrementAndGet();
            return new FakeRedirectConnection(url);
        });
        PortalHttpPlugin plugin = new PortalHttpPlugin(policy, transport) {
            @Override public AppCompatActivity getActivity() { return null; }
            @Override public Bridge getBridge() { return null; }
        };

        RecordingCall reqCall = new RecordingCall(attendanceRequest("req-null-1"));
        plugin.request(reqCall);
        assertTrue(reqCall.awaitSettled(5, TimeUnit.SECONDS));
        assertEquals(1, reqCall.settlements.get());
        assertEquals("UNAVAILABLE", reqCall.errorCode);

        RecordingCall cancelCall = new RecordingCall(new JSObject().put("id", "req-null-1"));
        plugin.cancel(cancelCall);
        assertTrue(cancelCall.awaitSettled(5, TimeUnit.SECONDS));
        assertTrue(cancelCall.resolved);

        plugin.handleOnDestroy();

        RecordingCall afterDestroy = new RecordingCall(attendanceRequest("req-null-2"));
        plugin.request(afterDestroy);
        assertTrue(afterDestroy.awaitSettled(5, TimeUnit.SECONDS));
        assertEquals("UNAVAILABLE", afterDestroy.errorCode);
        assertEquals(0, openedConnections.get());
    }

    @Test public void completionAfterDestroyDropsCallbackWithoutDoubleSettlementOrNpe() throws Exception {
        CountDownLatch inFlight = new CountDownLatch(1);
        CountDownLatch releaseUpstream = new CountDownLatch(1);
        PortalTransport transport = new PortalTransport(policy, url -> new FakeRedirectConnection(url) {
            @Override public int getResponseCode() {
                inFlight.countDown();
                try { releaseUpstream.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
                return 302;
            }
        });
        ExecutorService ui = Executors.newSingleThreadExecutor();
        AtomicBoolean activityDetached = new AtomicBoolean(false);
        PortalHttpPlugin plugin = new PortalHttpPlugin(policy, transport) {
            @Override public Bridge getBridge() { return null; }
            @Override protected boolean runOnUiThread(Runnable action) {
                if (activityDetached.get()) return false;
                ui.execute(action);
                return true;
            }
        };

        try {
            RecordingCall call = new RecordingCall(attendanceRequest("req-destroy-1"));
            plugin.request(call);
            assertTrue(inFlight.await(5, TimeUnit.SECONDS));

            // Detach UI and destroy while upstream request is still blocked.
            plugin.handleOnDestroy();
            activityDetached.set(true);
            releaseUpstream.countDown();

            assertTrue(call.awaitSettled(5, TimeUnit.SECONDS));
            ui.shutdown();
            assertTrue(ui.awaitTermination(5, TimeUnit.SECONDS));
            assertEquals(1, call.settlements.get());
            assertEquals("ABORT_ERR", call.errorCode);
        } finally {
            releaseUpstream.countDown();
            ui.shutdownNow();
        }
    }

    @Test public void completionWhenActivityDetachedBeforeDestroySettlesCallSafely() throws Exception {
        CountDownLatch inFlight = new CountDownLatch(1);
        CountDownLatch releaseUpstream = new CountDownLatch(1);
        PortalTransport transport = new PortalTransport(policy, url -> new FakeRedirectConnection(url) {
            @Override public int getResponseCode() {
                inFlight.countDown();
                try { releaseUpstream.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
                return 302;
            }
        });
        ExecutorService ui = Executors.newSingleThreadExecutor();
        AtomicBoolean activityDetached = new AtomicBoolean(false);
        PortalHttpPlugin plugin = new PortalHttpPlugin(policy, transport) {
            @Override public Bridge getBridge() { return null; }
            @Override protected boolean runOnUiThread(Runnable action) {
                if (activityDetached.get()) return false;
                ui.execute(action);
                return true;
            }
        };

        try {
            RecordingCall call = new RecordingCall(attendanceRequest("req-detach-1"));
            plugin.request(call);
            assertTrue(inFlight.await(5, TimeUnit.SECONDS));

            // Simulate getActivity() becoming null right before the worker finishes.
            activityDetached.set(true);
            releaseUpstream.countDown();

            assertTrue(call.awaitSettled(5, TimeUnit.SECONDS));
            assertEquals(1, call.settlements.get());
            assertEquals("NETWORK_ERROR", call.errorCode);

            plugin.handleOnDestroy();
            assertEquals(1, call.settlements.get());
        } finally {
            releaseUpstream.countDown();
            plugin.handleOnDestroy();
            ui.shutdownNow();
        }
    }

    @Test public void executorRunsFifteenAttendanceRequestsConcurrentlyWithoutQueueStarvation() throws Exception {
        int concurrentCount = 15; // 5 subject workers x 3 L/T/P components
        CountDownLatch allRunning = new CountDownLatch(concurrentCount);
        AtomicBoolean barrierReached = new AtomicBoolean(false);
        PortalTransport transport = new PortalTransport(policy, url -> new FakeRedirectConnection(url) {
            @Override public int getResponseCode() {
                allRunning.countDown();
                try {
                    if (allRunning.await(5, TimeUnit.SECONDS)) barrierReached.set(true);
                } catch (InterruptedException ignored) {}
                return 302;
            }
        });
        ExecutorService ui = Executors.newSingleThreadExecutor();
        PortalHttpPlugin plugin = new PortalHttpPlugin(policy, transport) {
            @Override public Bridge getBridge() { return null; }
            @Override protected boolean runOnUiThread(Runnable action) {
                ui.execute(action);
                return true;
            }
        };

        try {
            List<RecordingCall> calls = new ArrayList<>();
            for (int i = 0; i < concurrentCount; i++) {
                RecordingCall call = new RecordingCall(attendanceRequest("att-" + i));
                calls.add(call);
                plugin.request(call);
            }
            assertTrue("All 15 requests should enter transport concurrently", allRunning.await(5, TimeUnit.SECONDS));
            for (RecordingCall call : calls) {
                assertTrue(call.awaitSettled(5, TimeUnit.SECONDS));
                assertEquals(1, call.settlements.get());
                assertEquals("NETWORK_ERROR", call.errorCode);
            }
            assertTrue(barrierReached.get());
        } finally {
            plugin.handleOnDestroy();
            ui.shutdownNow();
        }
    }

    private static final class RecordingCall extends PluginCall {
        final CountDownLatch settled = new CountDownLatch(1);
        final AtomicInteger settlements = new AtomicInteger();
        volatile boolean resolved;
        volatile String errorCode;

        RecordingCall(JSObject data) {
            super(null, "PortalHttp", "cb", "request", data);
        }

        @Override public void resolve() {
            resolved = true;
            settlements.incrementAndGet();
            settled.countDown();
        }

        @Override public void resolve(JSObject data) {
            resolved = true;
            settlements.incrementAndGet();
            settled.countDown();
        }

        @Override public void reject(String msg, String code, Exception ex, JSObject data) {
            errorCode = code;
            settlements.incrementAndGet();
            settled.countDown();
        }

        boolean awaitSettled(long timeout, TimeUnit unit) throws InterruptedException {
            return settled.await(timeout, unit);
        }
    }

    private static class FakeRedirectConnection extends HttpURLConnection {
        FakeRedirectConnection(URL url) { super(url); }
        @Override public void connect() {}
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public OutputStream getOutputStream() { return new ByteArrayOutputStream(); }
        @Override public int getResponseCode() { return 302; }
        @Override public String getHeaderField(String field) { return "https://evil.test/"; }
    }
}
