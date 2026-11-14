package com.lazyportal.juet.officialportal;

import static org.junit.Assert.*;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

/** Negative cases run without Android's WebView/Base64 implementation and prove
 * that denied operations cannot open an upstream connection in the first place. */
public class PortalTransportTest {
    private PortalPolicy policy;
    private int connections;
    private FakeConnection last;
    private PortalTransport transport;

    @Before public void setup() throws Exception {
        policy = new PortalPolicy(new JSONObject(new String(Files.readAllBytes(new File("src/main/assets/official-portal-policy.json").toPath()), StandardCharsets.UTF_8)));
        transport = new PortalTransport(policy, url -> { connections++; last = new FakeConnection(url); return last; });
    }
    private JSONObject request(String path, String method) throws Exception {
        return new JSONObject().put("id", "1-2-3:1").put("path", path).put("method", method).put("body", "opaque-body");
    }
    @Test public void deniedAndOversizedRequestsMakeZeroConnections() throws Exception {
        assertThrows(SecurityException.class, () -> transport.api(request("/onlinefeepayment/paynow", "POST")));
        assertThrows(SecurityException.class, () -> transport.api(request("/clxuser/getmenulist", "GET")));
        assertThrows(IOException.class, () -> transport.api(request("/clxuser/getmenulist", "POST").put("body", "x".repeat(512 * 1024 + 1))));
        assertEquals(0, connections);
    }
    @Test public void redirectsNeverFollowAndUntrustedHeadersNeverReachUpstream() throws Exception {
        JSONObject headers = new JSONObject().put("authorization", "Bearer test-token").put("localname", "encrypted-header")
            .put("origin", "https://evil.test").put("cookie", "secret=bad").put("host", "evil.test");
        assertThrows(IOException.class, () -> transport.api(request("/clxuser/getmenulist", "POST").put("headers", headers)));
        assertEquals(1, connections);
        assertFalse(last.getInstanceFollowRedirects());
        assertEquals(policy.upstream, last.getRequestProperty("Origin"));
        assertEquals("Bearer test-token", last.getRequestProperty("authorization"));
        assertEquals("encrypted-header", last.getRequestProperty("localname"));
        assertNull(last.getRequestProperty("cookie")); assertNull(last.getRequestProperty("host"));
        assertTrue(last.disconnected);
    }
    @Test public void invalidHeadersCloseConnectionsAndClosedViewsCannotReconnect() throws Exception {
        JSONObject headers = new JSONObject().put("authorization", "Bearer token\r\nCookie: bad");
        assertThrows(IOException.class, () -> transport.api(request("/clxuser/getmenulist", "POST").put("headers", headers)));
        assertTrue(last.disconnected);
        transport.close();
        assertThrows(IOException.class, () -> transport.api(request("/clxuser/getmenulist", "POST")));
        assertEquals(1, connections);
    }
    @Test public void cancelAndCloseOffloadDisconnectOffMainThread() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch releaseApi = new CountDownLatch(1);
        CountDownLatch releaseDisconnect = new CountDownLatch(1);
        CountDownLatch disconnectedLatch = new CountDownLatch(1);
        ExecutorService worker = Executors.newSingleThreadExecutor();
        ExecutorService disconnectPool = Executors.newSingleThreadExecutor();
        PortalTransport mainThreadTransport = new PortalTransport(policy, url -> {
            last = new FakeConnection(url) {
                @Override public int getResponseCode() {
                    entered.countDown();
                    try { releaseApi.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
                    return 302;
                }
                @Override public void disconnect() {
                    disconnectThread = Thread.currentThread();
                    try { releaseDisconnect.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
                    disconnected = true;
                    disconnectedLatch.countDown();
                }
            };
            return last;
        }, null, () -> true, disconnectPool);
        try {
            Future<?> call = worker.submit(() -> {
                try { mainThreadTransport.api(request("/clxuser/getmenulist", "POST")); } catch (Exception ignored) {}
            });
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            Thread mainCaller = Thread.currentThread();
            // close() must return immediately without blocking on disconnect() or running it on mainCaller.
            mainThreadTransport.close();
            assertFalse(last.disconnected);
            releaseDisconnect.countDown();
            assertTrue(disconnectedLatch.await(5, TimeUnit.SECONDS));
            assertNotNull(last.disconnectThread);
            assertNotSame(mainCaller, last.disconnectThread);
            releaseApi.countDown();
            call.get(5, TimeUnit.SECONDS);
        } finally {
            worker.shutdownNow();
            disconnectPool.shutdownNow();
        }
    }
    @Test public void disconnectFailuresNeverPropagateFromCancelOrClose() throws Exception {
        CountDownLatch bothEntered = new CountDownLatch(2);
        CountDownLatch releaseApi = new CountDownLatch(1);
        AtomicInteger disconnectCalls = new AtomicInteger();
        ExecutorService workers = Executors.newFixedThreadPool(2);
        PortalTransport resilient = new PortalTransport(policy, url -> new FakeConnection(url) {
            @Override public int getResponseCode() {
                bothEntered.countDown();
                try { releaseApi.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
                return 302;
            }
            @Override public void disconnect() {
                int count = disconnectCalls.incrementAndGet();
                disconnected = true;
                if (count == 1) throw new RuntimeException("NetworkOnMainThreadException");
                throw new AssertionError("SSL socket teardown failure");
            }
        });
        try {
            Future<?> first = workers.submit(() -> {
                try { resilient.api(request("/clxuser/getmenulist", "POST").put("id", "req-1")); } catch (Exception ignored) {}
            });
            Future<?> second = workers.submit(() -> {
                try { resilient.api(request("/clxuser/getmenulist", "POST").put("id", "req-2")); } catch (Exception ignored) {}
            });
            assertTrue(bothEntered.await(5, TimeUnit.SECONDS));
            resilient.cancel("req-1");
            resilient.close();
            assertEquals(2, disconnectCalls.get());
            releaseApi.countDown();
            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);
        } finally {
            workers.shutdownNow();
        }
    }
    private static class FakeConnection extends HttpURLConnection {
        volatile boolean disconnected;
        volatile Thread disconnectThread;
        FakeConnection(URL url) { super(url); }
        @Override public void connect() {}
        @Override public void disconnect() { disconnected = true; disconnectThread = Thread.currentThread(); }
        @Override public boolean usingProxy() { return false; }
        @Override public OutputStream getOutputStream() { return new ByteArrayOutputStream(); }
        @Override public int getResponseCode() { return 302; }
        @Override public String getHeaderField(String field) { return "https://evil.test/"; }
    }
}
