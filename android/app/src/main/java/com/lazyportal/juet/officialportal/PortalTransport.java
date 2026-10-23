package com.lazyportal.juet.officialportal;

import android.util.Base64;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

/** Direct, bounded, cancellable networking for one portal view. Default TLS
 * validation stays enabled. No JS cookie/header relay, global TLS changes, Vercel fallback,
 * automatic redirect following, or authenticated response cache. */
public final class PortalTransport implements AutoCloseable {
    public interface Connections { HttpURLConnection open(URL url) throws IOException; }
    private final PortalPolicy policy;
    private final Connections connections;
    private final PortalAssetCache cache;
    private final Map<String, HttpURLConnection> active = new ConcurrentHashMap<>();
    private final AtomicLong assetSequence = new AtomicLong();
    private volatile boolean closed;
    private static final int BODY_LIMIT = 512 * 1024;
    private static final int RESPONSE_LIMIT = 8 * 1024 * 1024;
    private static final String CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; "
        + "connect-src 'self'; worker-src 'none'; frame-src 'none'; object-src 'none'; "
        + "base-uri 'self'; form-action 'none'";

    public PortalTransport(PortalPolicy policy, Connections connections) { this(policy, connections, null); }
    public PortalTransport(PortalPolicy policy, Connections connections, PortalAssetCache cache) {
        this.policy = policy; this.connections = connections; this.cache = cache;
    }

    private HttpURLConnection connect(String id, URL target, String method) throws IOException {
        if (closed || Thread.currentThread().isInterrupted()) throw new IOException("Portal view closed");
        HttpURLConnection connection = connections.open(target);
        connection.setConnectTimeout(10_000); connection.setReadTimeout(20_000);
        connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Origin", policy.upstream);
        connection.setRequestProperty("Referer", policy.upstream + policy.pagePrefix);
        connection.setRequestProperty("Accept-Encoding", "identity");
        active.put(id, connection);
        if (closed || Thread.currentThread().isInterrupted()) { cancel(id); throw new IOException("Portal view closed"); }
        return connection;
    }

    public JSONObject api(JSONObject request) throws Exception {
        String id = request.getString("id"), method = request.getString("method"), path = request.getString("path");
        URL target = policy.apiUrl(method, path); // Validate BEFORE creating a connection.
        byte[] body = request.optString("body", "").getBytes(StandardCharsets.UTF_8);
        if (body.length > BODY_LIMIT) throw new IOException("Request too large");
        HttpURLConnection connection = connect(id, target, method);
        try {
            JSONObject headers = request.optJSONObject("headers");
            if (headers != null) {
                for (String key : new String[] { "authorization", "localname", "content-type", "accept" }) {
                    String value = headers.optString(key, "");
                    if (value.length() > 8192 || value.contains("\r") || value.contains("\n")) throw new IOException("Invalid header");
                    if (!value.isEmpty()) connection.setRequestProperty(key, value);
                }
            }
            if ("POST".equals(method)) {
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length);
                try (var output = connection.getOutputStream()) { output.write(body); }
            }
            int status = connection.getResponseCode();
            if (status < 200 || status > 599) throw new IOException("Invalid portal response");
            if (status >= 300 && status < 400) throw new IOException("Portal redirected the request. Reconnect and retry.");
            byte[] bytes;
            try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                bytes = read(input, RESPONSE_LIMIT);
            }
            JSONObject replyHeaders = new JSONObject();
            String type = connection.getHeaderField("Content-Type");
            if (type != null) replyHeaders.put("content-type", type);
            return new JSONObject().put("id", id).put("status", status).put("headers", replyHeaders)
                .put("body", Base64.encodeToString(bytes, Base64.NO_WRAP));
        } finally { cancel(id); }
    }

    public WebResourceResponse asset(String url, String bootstrap) {
        String id = "asset:" + assetSequence.incrementAndGet();
        try {
            if (closed) throw new IOException("Portal view closed");
            URL target = policy.assetUrl(url);
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Security-Policy", CSP); headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            InputStream cached = cache == null ? null : cache.get(target);
            if (cached != null) return new WebResourceResponse(target.getPath().endsWith(".css") ? "text/css" : "application/javascript", null, 200, "OK", headers, cached);
            HttpURLConnection connection = null;
            for (int hop = 0; hop <= 3; hop++) {
                connection = connect(id, target, "GET");
                int status = connection.getResponseCode();
                if (status < 300 || status >= 400) break;
                String location = connection.getHeaderField("Location");
                cancel(id);
                if (hop == 3 || location == null) throw new IOException("Portal redirect failed");
                // Validate each hop. Never leak a redirected request elsewhere.
                target = policy.assetUrl(new URL(target, location).toString());
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) { cancel(id); return error(status, "Portal unavailable. Close or reload to retry."); }
            String type = connection.getContentType();
            String mime = type == null ? "application/octet-stream" : type.split(";", 2)[0].trim();
            InputStream input = connection.getInputStream();
            if (policy.isHtml(url)) {
                String html;
                try (InputStream htmlInput = input) { html = new String(read(htmlInput, 512 * 1024), StandardCharsets.UTF_8); }
                cancel(id);
                if (!mime.equals("text/html")) throw new IOException("Portal returned an invalid page");
                for (var alias : policy.assetAliases.entrySet()) html = html.replace(alias.getKey(), policy.origin + alias.getValue());
                html = prepareDocument(html, bootstrap);
                return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers,
                    new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
            }
            // A streamed resource holds its connection only until WebView closes
            // it; closing the view disconnects unfinished streams immediately.
            if (cache != null && connection.getHeaderField("Set-Cookie") == null) input = cache.store(target, mime, input);
            InputStream stream = new FilterInputStream(input) {
                private int count;
                @Override public int read() throws IOException {
                    int value = super.read(); if (value != -1) check(1); return value;
                }
                @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                    int size = in.read(buffer, offset, length); if (size > 0) check(size); return size;
                }
                private void check(int size) throws IOException {
                    count += size;
                    if (count > 24 * 1024 * 1024) { close(); throw new IOException("Resource too large"); }
                }
                @Override public void close() throws IOException { try { super.close(); } finally { cancel(id); } }
            };
            return new WebResourceResponse(mime, null, 200, "OK", headers, stream);
        } catch (SecurityException ignored) {
            cancel(id); return error(403, "Read-only view. Use the actual portal for this action.");
        } catch (Exception ignored) {
            cancel(id); return error(502, "Could not reach the portal. Check your connection and reload.");
        }
    }

    static String prepareDocument(String html, String bootstrap) throws IOException {
        // Replace the portal's 100% viewport, rather than fighting it with CSS
        // transforms or a native scale that varies with screen density.
        html = java.util.regex.Pattern.compile(
            "<meta\\b[^>]*\\sname\\s*=\\s*(?:\"viewport\"|'viewport'|viewport(?=\\s|/?>))[^>]*>",
            java.util.regex.Pattern.CASE_INSENSITIVE).matcher(html).replaceAll("");
        String prefix = "<meta name=\"viewport\" content=\"width=device-width, initial-scale=0.6, minimum-scale=0.25, maximum-scale=3, user-scalable=yes\">"
            + "<script>" + bootstrap + "</script>";
        java.util.regex.Matcher head = java.util.regex.Pattern.compile("<head\\b[^>]*>", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(html);
        if (!head.find()) throw new IOException("Portal page has no head");
        // HTML only; large scripts/assets remain byte-identical.
        return html.substring(0, head.end()) + prefix + html.substring(head.end());
    }

    public static WebResourceResponse error(int status, String message) {
        String html = "<!doctype html><meta name=viewport content='width=device-width'><p>" + message + "</p>";
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store"); headers.put("Content-Security-Policy", "default-src 'none'");
        return new WebResourceResponse("text/html", "UTF-8", status, "Unavailable", headers,
            new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
    }

    private static byte[] read(InputStream input, int limit) throws IOException {
        if (input == null) return new byte[0];
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192]; int size;
        while ((size = input.read(buffer)) != -1) {
            if (output.size() + size > limit) throw new IOException("Response too large");
            output.write(buffer, 0, size);
        }
        return output.toByteArray();
    }

    public void cancel(String id) {
        HttpURLConnection connection = active.remove(id);
        if (connection != null) connection.disconnect();
    }

    @Override public void close() { closed = true; for (String id : active.keySet()) cancel(id); }
}
