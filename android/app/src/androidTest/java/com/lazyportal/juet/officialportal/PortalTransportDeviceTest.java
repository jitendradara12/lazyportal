package com.lazyportal.juet.officialportal;

import static org.junit.Assert.*;

import android.util.Base64;
import android.webkit.WebResourceResponse;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real Android response objects/encoding, fake upstream. No credentials or
 * network. Run connectedDebugAndroidTest against the CI-built APK on a device. */
@RunWith(AndroidJUnit4.class)
public class PortalTransportDeviceTest {
    private PortalPolicy policy;
    private PortalTransport transport;
    private final List<FakeConnection> connections = new ArrayList<>();
    @Before public void setup() throws Exception {
        policy = PortalPolicy.load(ApplicationProvider.getApplicationContext());
        transport = new PortalTransport(policy, url -> {
            FakeConnection connection = new FakeConnection(url); connections.add(connection); return connection;
        });
    }
    @Test public void htmlOnlyInjectionAndByteIdenticalStaticStreaming() throws Exception {
        WebResourceResponse html = transport.asset(policy.origin + policy.entry, "window.booted=true;");
        String body = new String(read(html.getData()), StandardCharsets.UTF_8);
        assertEquals(200, html.getStatusCode());
        assertTrue(body.indexOf("window.booted=true") < body.indexOf("main.abcdef0123456789.js"));
        assertTrue(body.contains("initial-scale=0.6"));
        assertTrue(body.contains("user-scalable=yes"));
        assertTrue(html.getResponseHeaders().get("Content-Security-Policy").contains("form-action 'none'"));
        assertEquals("no-store", html.getResponseHeaders().get("Cache-Control"));
        assertFalse(html.getResponseHeaders().containsKey("Set-Cookie"));
        assertTrue(connections.get(0).disconnected);
        WebResourceResponse asset = transport.asset(policy.origin + "/studentportal/main.abcdef0123456789.js", "must-not-be-injected");
        assertArrayEquals(new byte[] { 0, 1, 2, (byte) 255 }, read(asset.getData()));
        assertTrue(connections.get(1).disconnected);
        assertEquals(policy.upstream, connections.get(1).getRequestProperty("Origin"));
    }
    @Test public void apiResponsesAndErrorsUseAndroidEncodingAndPoolConnections() throws Exception {
        JSONObject response = transport.api(new JSONObject().put("id", "1:1").put("path", "/clxuser/getmenulist")
            .put("method", "POST").put("headers", new JSONObject().put("authorization", "Bearer test")).put("body", "encrypted"));
        assertEquals(200, response.getInt("status"));
        assertEquals("{}", new String(Base64.decode(response.getString("body"), Base64.DEFAULT), StandardCharsets.UTF_8));
        assertFalse(connections.get(0).disconnected);
        assertEquals("encrypted", connections.get(0).output.toString("UTF-8"));
        assertEquals(403, transport.asset("https://lazyportal-tan.vercel.app/api/any", "").getStatusCode());
        assertEquals(1, connections.size());
        transport.close();
        assertEquals(502, transport.asset(policy.origin + policy.entry, "").getStatusCode());
        assertEquals(1, connections.size());
    }
    private static byte[] read(InputStream input) throws Exception {
        try (input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int size;
            while ((size = input.read(buffer)) != -1) output.write(buffer, 0, size);
            return output.toByteArray();
        }
    }
    private static class FakeConnection extends HttpURLConnection {
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        boolean disconnected;
        FakeConnection(URL url) { super(url); }
        @Override public void connect() {}
        @Override public void disconnect() { disconnected = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public int getResponseCode() { return 200; }
        @Override public String getContentType() { return url.getPath().endsWith(".js") ? "application/javascript" : url.getPath().contains("StudentPortalAPI") ? "application/json" : "text/html"; }
        @Override public String getHeaderField(String field) { return "Content-Type".equals(field) ? getContentType() : null; }
        @Override public OutputStream getOutputStream() { return output; }
        @Override public InputStream getInputStream() {
            if (url.getPath().endsWith(".js")) return new ByteArrayInputStream(new byte[] { 0, 1, 2, (byte) 255 });
            String html = url.getPath().contains("StudentPortalAPI") ? "{}" : "<!doctype html><head><script src='main.abcdef0123456789.js'></script></head><body></body>";
            return new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8));
        }
    }
}
