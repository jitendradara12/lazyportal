package com.lazyportal.juet.officialportal;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Memory-only storage for portal documents, plus migration cleanup for APKs
 * which used persistent localStorage. Never clears the hosted app's origin. */
public final class PortalStorage {
    public interface Completed { void accept(boolean success); }
    private PortalStorage() {}

    static String bootstrap(Activity activity) throws Exception {
        try (InputStream input = activity.getAssets().open("official-portal-storage.js");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString("UTF-8") + "\n";
        }
    }

    public static void clear(Activity activity, String origin, Completed completed) {
        // deleteOrigin clears IndexedDB, not localStorage. A local document at
        // this exact origin clears legacy Web Storage even without reopening UI.
        WebStorage.getInstance().deleteOrigin(origin);
        WebView cleaner = new WebView(activity);
        cleaner.getSettings().setJavaScriptEnabled(true);
        cleaner.getSettings().setDomStorageEnabled(true);
        cleaner.getSettings().setBlockNetworkLoads(true);
        cleaner.getSettings().setAllowFileAccess(false);
        cleaner.getSettings().setAllowContentAccess(false);
        Handler handler = new Handler(Looper.getMainLooper());
        boolean[] done = { false };
        Completed finish = success -> {
            if (done[0]) return;
            done[0] = true;
            cleaner.stopLoading(); cleaner.destroy(); completed.accept(success);
        };
        Runnable timeout = () -> finish.accept(false);
        cleaner.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return PortalTransport.error(403, "Storage cleanup has no network access.");
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (done[0]) return;
                view.evaluateJavascript("(() => { localStorage.clear(); sessionStorage.clear(); return localStorage.length === 0 && sessionStorage.length === 0; })()", result -> {
                    handler.removeCallbacks(timeout); finish.accept("true".equals(result));
                });
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                handler.removeCallbacks(timeout); finish.accept(false); return true;
            }
        });
        handler.postDelayed(timeout, 5_000);
        cleaner.loadDataWithBaseURL(origin + "/", "<!doctype html><title>Clear portal storage</title>",
            "text/html", StandardCharsets.UTF_8.name(), null);
    }
}
