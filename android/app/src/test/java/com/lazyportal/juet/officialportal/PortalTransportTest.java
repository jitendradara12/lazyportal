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
    private static class FakeConnection extends HttpURLConnection {
        boolean disconnected;
        FakeConnection(URL url) { super(url); }
        @Override public void connect() {}
        @Override public void disconnect() { disconnected = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public OutputStream getOutputStream() { return new ByteArrayOutputStream(); }
        @Override public int getResponseCode() { return 302; }
        @Override public String getHeaderField(String field) { return "https://evil.test/"; }
    }
}
