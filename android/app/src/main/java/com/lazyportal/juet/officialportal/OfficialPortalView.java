package com.lazyportal.juet.officialportal;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.view.Gravity;
import android.view.Window;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.Toast;
import androidx.activity.ComponentDialog;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebMessageCompat;
import com.lazyportal.juet.R;
import java.util.Map;
import java.util.Collections;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** One disposable WebView, with no Capacitor bridge and no access to the main
 * app's origin. All resource requests are intercepted; POST bodies use the
 * origin-scoped message bridge. No local HTTP server or listening socket. */
public final class OfficialPortalView {
    public interface Closed { void accept(boolean expired); }
    private final Activity activity;
    private final PortalPolicy policy;
    private final PortalTransport transport;
    private final ComponentDialog dialog;
    private final Closed onClosed;
    final WebView webView;
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32));
    private final Map<String, FutureTask<Void>> pending = new ConcurrentHashMap<>();
    private boolean closed, expired, closeDelivered;
    private volatile String bootstrap;

    public OfficialPortalView(Activity activity, PortalPolicy policy, String bootstrap, Closed onClosed) throws Exception {
        this(activity, policy, bootstrap, onClosed, new PortalTransport(policy, new PortalTls(activity, policy), new PortalAssetCache(activity.getCacheDir())));
    }

    // The transport seam lets device tests exercise actual WebView messaging
    // and interception using fake upstream connections, with no student account.
    OfficialPortalView(Activity activity, PortalPolicy policy, String bootstrap, Closed onClosed, PortalTransport transport) {
        this.activity = activity; this.policy = policy; this.transport = transport; this.onClosed = onClosed;
        try { this.bootstrap = PortalStorage.bootstrap(activity) + bootstrap; }
        catch (Exception error) { throw new IllegalStateException("Portal storage isolation unavailable", error); }
        dialog = new ComponentDialog(activity, android.R.style.Theme_Material_NoActionBar);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        boolean dark = (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int foreground = dark ? 0xFFF1EDF2 : 0xFF1D1B20;
        int background = dark ? 0xFF141316 : 0xFFFCF8FD;
        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(background);
        webView = new WebView(activity); webView.setBackgroundColor(background);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        // Overlay two accessible touch targets; no header consumes page height.
        ImageButton close = iconButton(R.drawable.ic_portal_close, "Close official portal", foreground, background);
        close.setOnClickListener(view -> close());
        root.addView(close, corner(Gravity.START));
        ImageButton reload = iconButton(R.drawable.ic_portal_refresh, "Refresh official portal", foreground, background);
        reload.setOnClickListener(view -> webView.reload());
        root.addView(reload, corner(Gravity.END));
        dialog.setContentView(root);
        WindowCompat.setDecorFitsSystemWindows(dialog.getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            var bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        // The density-aware HTML viewport starts at 60%. Let WebView handle
        // pinch gestures itself; hide its obsolete on-screen +/- controls.
        settings.setUseWideViewPort(true); settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(true); settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false); settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(true); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebViewCompat.addWebMessageListener(webView, "OfficialPortalNative", Collections.singleton(policy.origin),
            (view, message, sourceOrigin, isMainFrame, reply) -> {
                if (closed || !isMainFrame || !policy.ownsOrigin(sourceOrigin.toString())) return;
                if (message.getType() != WebMessageCompat.TYPE_STRING) return;
                String data = message.getData();
                if (data == null || data.length() > 600 * 1024) return;
                try {
                    JSONObject request = new JSONObject(data);
                    String event = request.optString("event");
                    if ("close".equals(event)) { close(); return; }
                    if ("blocked".equals(event)) { message(readOnlyNotice()); return; }
                    if ("expired".equals(event)) {
                        expired = true; close(); return;
                    }
                    String cancel = request.optString("cancel");
                    if (!cancel.isEmpty()) {
                        FutureTask<Void> task = pending.remove(cancel);
                        if (task != null) { task.cancel(true); executor.remove(task); transport.cancel(cancel); }
                        return;
                    }
                    String id = request.getString("id");
                    if (!id.matches("[0-9-]{1,100}:[0-9]{1,12}") || pending.containsKey(id)) return;
                    FutureTask<Void> task = new FutureTask<>(() -> {
                        JSONObject response;
                        try { response = transport.api(request); }
                        catch (SecurityException error) { response = errorReply(id, "Read-only view. Use the actual portal for this action."); }
                        catch (Exception error) { response = errorReply(id, "Could not reach the portal. Please retry."); }
                        final String result = response.toString();
                        final String error = response.optString("error", "");
                        activity.runOnUiThread(() -> {
                            if (!closed && pending.containsKey(id)) {
                                if (!error.isEmpty()) message(error);
                                reply.postMessage(result);
                            }
                            pending.remove(id);
                        });
                        return null;
                    });
                    pending.put(id, task);
                    try { executor.execute(task); }
                    catch (java.util.concurrent.RejectedExecutionException error) {
                        pending.remove(id); reply.postMessage(errorReply(id, "The portal is busy. Please retry.").toString());
                    }
                } catch (Exception ignored) { /* Malformed/untrusted bridge message. */ }
            });
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!"GET".equals(request.getMethod())) return PortalTransport.error(403, "Read-only view.");
                // Always return a response. A miss must never reach WebView's
                // default network stack (including a Vercel URL).
                return transport.asset(request.getUrl().toString(), OfficialPortalView.this.bootstrap);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (policy.allowsNavigation(request.getUrl().toString())) return false;
                message(readOnlyNotice()); return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                cancelRequests();
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                close(); return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, android.os.Message result) {
                message(readOnlyNotice()); return false;
            }
        });
        webView.setDownloadListener((url, userAgent, disposition, type, length) -> message("Use the actual portal to download files."));
        dialog.getOnBackPressedDispatcher().addCallback(new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
                if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
                    WindowCompat.getInsetsController(dialog.getWindow(), webView).hide(WindowInsetsCompat.Type.ime());
                } else if (webView.canGoBack()) webView.goBack();
                else close();
            }
        });
        dialog.setOnDismissListener(ignored -> finishClose());
    }

    public void show() {
        // IndexedDB cleanup; the injected storage prelude clears old Web Storage
        // and keeps all subsequent localStorage/sessionStorage writes in memory.
        WebStorage.getInstance().deleteOrigin(policy.origin);
        dialog.show(); dialog.getWindow().setLayout(-1, -1);
        webView.loadUrl(policy.origin + policy.entry);
    }

    public void close() {
        if (dialog.isShowing()) dialog.dismiss();
        // Android posts OnDismissListener asynchronously. Complete now so an
        // old callback cannot clear the plugin's reference to a newer view.
        finishClose();
    }
    private void finishClose() {
        dispose();
        if (!closeDelivered) { closeDelivered = true; onClosed.accept(expired); }
    }
    private void cancelRequests() {
        for (var entry : pending.entrySet()) { entry.getValue().cancel(true); transport.cancel(entry.getKey()); }
        pending.clear(); executor.purge();
    }
    private void dispose() {
        if (closed) return;
        closed = true; bootstrap = "";
        cancelRequests(); executor.shutdownNow(); transport.close();
        webView.stopLoading(); WebViewCompat.removeWebMessageListener(webView, "OfficialPortalNative");
        webView.clearHistory(); webView.removeAllViews(); webView.destroy();
        WebStorage.getInstance().deleteOrigin(policy.origin);
    }
    private ImageButton iconButton(int drawable, String label, int foreground, int background) {
        ImageButton button = new ImageButton(activity);
        button.setImageResource(drawable); button.setImageTintList(ColorStateList.valueOf(foreground));
        button.setContentDescription(label); button.setPadding(dp(12), dp(12), dp(12), dp(12));
        GradientDrawable circle = new GradientDrawable(); circle.setShape(GradientDrawable.OVAL);
        circle.setColor((background & 0x00FFFFFF) | 0xE6000000);
        GradientDrawable mask = new GradientDrawable(); mask.setShape(GradientDrawable.OVAL); mask.setColor(0xFFFFFFFF);
        button.setBackground(new RippleDrawable(ColorStateList.valueOf((foreground & 0x00FFFFFF) | 0x33000000), circle, mask));
        button.setElevation(dp(4));
        if (Build.VERSION.SDK_INT >= 26) button.setTooltipText(label);
        return button;
    }
    private FrameLayout.LayoutParams corner(int gravity) {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | gravity);
        params.setMargins(dp(8), dp(8), dp(8), dp(8)); return params;
    }
    private void message(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private static String readOnlyNotice() { return "Read-only. Use the actual portal for submissions, changes or payments."; }
    private static JSONObject errorReply(String id, String error) {
        JSONObject reply = new JSONObject();
        try { reply.put("id", id).put("error", error); } catch (Exception ignored) {}
        return reply;
    }
}
