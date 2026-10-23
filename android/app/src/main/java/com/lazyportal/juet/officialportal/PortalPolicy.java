package com.lazyportal.juet.officialportal;

import android.content.Context;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URL;
import java.util.HashSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.Collections;
import org.json.JSONArray;
import org.json.JSONObject;

/** APK-pinned transport boundary, generated from core; never trusts a URL or
 * endpoint allowlist supplied by the remotely updated UI. */
public final class PortalPolicy {
    public final int version;
    public final String origin, upstream, pagePrefix, apiPrefix, entry;
    private final Set<String> posts, gets, routes;
    public final Map<String, String> assetAliases = new HashMap<>();

    public static PortalPolicy load(Context context) throws Exception {
        try (InputStream input = context.getAssets().open("official-portal-policy.json")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            return new PortalPolicy(new JSONObject(bytes.toString("UTF-8")));
        }
    }

    public PortalPolicy(JSONObject json) throws Exception {
        version = json.getInt("version");
        origin = json.getString("origin"); upstream = json.getString("upstream");
        pagePrefix = json.getString("pagePrefix"); apiPrefix = json.getString("apiPrefix");
        entry = json.getString("entry");
        posts = strings(json.getJSONArray("post")); gets = strings(json.getJSONArray("get"));
        routes = strings(json.getJSONArray("routes"));
        JSONObject aliases = json.getJSONObject("assetAliases");
        for (var keys = aliases.keys(); keys.hasNext();) {
            String key = keys.next(); assetAliases.put(key, aliases.getString(key));
        }
    }

    private static Set<String> strings(JSONArray array) throws Exception {
        Set<String> result = new HashSet<>();
        for (int i = 0; i < array.length(); i++) result.add(array.getString(i));
        return result;
    }

    public boolean allowsApi(String method, String path) {
        return clean(path) && ("POST".equals(method) ? posts : "GET".equals(method) ? gets : Collections.emptySet()).contains(path);
    }

    public URL apiUrl(String method, String path) throws Exception {
        if (!allowsApi(method, path)) throw new SecurityException("Read-only view. Use the actual portal for this action.");
        return new URL(upstream + apiPrefix.substring(0, apiPrefix.length() - 1) + path);
    }

    public boolean ownsOrigin(String value) {
        try { return origin.equals(originOf(new URI(value))); } catch (Exception ignored) { return false; }
    }

    public boolean allowsNavigation(String value) {
        try {
            URI uri = new URI(value);
            if (!origin.equals(originOf(uri)) || !clean(uri.getRawPath()) || uri.getRawQuery() != null) return false;
            String path = uri.getRawPath();
            if (!path.startsWith(pagePrefix)) return false;
            if (!path.equals(pagePrefix) && !routes.contains(path.substring(Math.min(path.length(), pagePrefix.length())))) return false;
            String fragment = uri.getFragment();
            return fragment == null || fragment.isEmpty() || routes.contains(fragment.replaceFirst("^/", ""));
        } catch (Exception ignored) { return false; }
    }

    public boolean isHtml(String value) {
        try {
            URI uri = new URI(value);
            String path = uri.getRawPath();
            return pagePrefix.equals(path) || (path.startsWith(pagePrefix) && routes.contains(path.substring(pagePrefix.length())));
        } catch (Exception ignored) { return false; }
    }

    /** Static resources only. API requests cannot escape the POST bridge by
     * pretending to be an image, navigation, stylesheet, worker or redirect. */
    public URL assetUrl(String value) throws Exception {
        URI uri = new URI(value);
        String sourceOrigin = originOf(uri);
        String path = uri.getRawPath();
        // Exact APK-pinned font URL only; never a general external proxy.
        if (assetAliases.containsKey(value)) return new URL(value);
        if (origin.equals(sourceOrigin)) {
            for (var alias : assetAliases.entrySet()) {
                if (alias.getValue().equals(path) && uri.getRawQuery() == null) return new URL(alias.getKey());
            }
        }
        if ((!origin.equals(sourceOrigin) && !upstream.equals(sourceOrigin)) || !clean(path) || !path.startsWith(pagePrefix)) {
            throw new SecurityException("Resource outside the official portal");
        }
        if (isHtml(value)) return new URL(upstream + pagePrefix);
        if (!path.matches("(?i).+\\.(?:js|css|json|ts|ico|png|jpe?g|gif|svg|webp|woff2?|ttf|eot)$")) {
            throw new SecurityException("Unsupported resource");
        }
        return new URL(upstream + path + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()));
    }

    private static boolean clean(String path) {
        return path != null && path.matches("/[A-Za-z0-9_./~-]*") && !path.contains("//")
            && !path.contains("/./") && !path.contains("/../") && !path.endsWith("/..") && !path.endsWith("/.");
    }

    private static String originOf(URI uri) {
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
            || (uri.getPort() != -1 && uri.getPort() != 443)) return "";
        return "https://" + uri.getHost();
    }
}
