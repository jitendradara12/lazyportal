package com.lazyportal.juet;

import android.app.Activity;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebStorage;
import android.webkit.WebView;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.lazyportal.juet.officialportal.OfficialPortalView;
import com.lazyportal.juet.officialportal.PortalPolicy;
import com.lazyportal.juet.officialportal.PortalStorage;
import java.util.concurrent.atomic.AtomicBoolean;

/** Thin platform entry point. The live web app supplies the versioned bootstrap;
 * the packaged policy independently confines every network operation. */
@CapacitorPlugin(name = "OfficialPortal")
public class OfficialPortalPlugin extends Plugin {
    private static final String PREFS_NAME = "juet_official_portal_prefs";
    private static final String KEY_STORAGE_DIRTY = "storage_dirty";
    private static final long STARTUP_CLEANUP_DELAY_MS = 2_500L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private OfficialPortalView portal;
    private PortalPolicy policy;
    private WebViewListener pageListener;
    private Runnable pendingStartupCleanup;
    private volatile boolean destroyed;

    @Override public void load() {
        pageListener = new WebViewListener() {
            @Override public void onPageStarted(WebView view) { closeView(); }
        };
        Bridge bridge = getBridge();
        if (bridge != null) bridge.addWebViewListener(pageListener);

        // Only run the legacy/crash storage cleanup WebView when storage may actually exist,
        // and defer it off cold-start so a second WebView never contends with initial app boot.
        Context context = getContext();
        if (context != null && isStorageDirty(context)) {
            scheduleDeferredStartupCleanup();
        }
    }

    private void scheduleDeferredStartupCleanup() {
        cancelStartupCleanup();
        pendingStartupCleanup = () -> {
            pendingStartupCleanup = null;
            if (destroyed || portal != null) return;
            Looper.myQueue().addIdleHandler(() -> {
                Activity current = getActivity();
                if (destroyed || portal != null || current == null || current.isFinishing() || current.isDestroyed()) {
                    return false;
                }
                if (!isStorageDirty(current)) return false;
                try {
                    if (policy == null) policy = PortalPolicy.load(current);
                } catch (Exception ignored) {
                    return false;
                }
                if (policy == null) return false;
                PortalStorage.clear(current, policy.origin, success -> {
                    if (success && !destroyed && portal == null) {
                        setStorageDirty(current, false);
                    }
                });
                return false;
            });
        };
        mainHandler.postDelayed(pendingStartupCleanup, STARTUP_CLEANUP_DELAY_MS);
    }

    private void cancelStartupCleanup() {
        if (pendingStartupCleanup != null) {
            mainHandler.removeCallbacks(pendingStartupCleanup);
            pendingStartupCleanup = null;
        }
    }

    @PluginMethod public void open(PluginCall call) {
        Activity activity = getActivity();
        if (destroyed || activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Could not open the official portal. Please retry.");
            return;
        }
        activity.runOnUiThread(() -> {
            Activity current = getActivity();
            if (destroyed || current == null || current.isFinishing() || current.isDestroyed()) {
                call.reject("Could not open the official portal. Please retry."); return;
            }
            if (portal != null) { call.reject("The official portal is already open."); return; }
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                call.reject("Update Android System WebView to open the official portal."); return;
            }
            String bootstrap = call.getString("bootstrap", "");
            if (bootstrap.isEmpty() || bootstrap.length() > 128 * 1024 || bootstrap.toLowerCase(java.util.Locale.ROOT).contains("</script")) {
                call.reject("Invalid portal session. Reconnect and retry."); return;
            }
            try {
                if (policy == null) {
                    Context context = getContext();
                    if (context == null) { call.reject("Could not open the official portal. Please retry."); return; }
                    policy = PortalPolicy.load(context);
                }
                if (call.getInt("version", 0) != policy.version) {
                    call.reject("Update Lazyportal to open this portal view."); return;
                }
                cancelStartupCleanup();
                setStorageDirty(current, true);
                final AtomicBoolean callSettled = new AtomicBoolean(false);
                portal = new OfficialPortalView(current, policy, bootstrap, expired -> {
                    portal = null;
                    setStorageDirty(current, false);
                    if (callSettled.compareAndSet(false, true)) {
                        call.resolve(new JSObject().put("expired", expired));
                    }
                });
                try {
                    portal.show();
                } catch (Exception error) {
                    boolean shouldReject = callSettled.compareAndSet(false, true);
                    closeView();
                    if (shouldReject) {
                        call.reject("Could not open the official portal. Please retry.");
                    }
                }
            } catch (Exception error) {
                closeView(); call.reject("Could not open the official portal. Please retry.");
            }
        });
    }

    @PluginMethod public void clear(PluginCall call) {
        Activity activity = getActivity();
        if (destroyed || activity == null) {
            if (policy == null) call.resolve();
            else call.reject("Could not clear the old portal session. Please restart the app.");
            return;
        }
        activity.runOnUiThread(() -> {
            cancelStartupCleanup();
            closeView();
            Activity current = getActivity();
            if (policy == null) {
                try {
                    if (current != null) policy = PortalPolicy.load(current);
                } catch (Exception ignored) { /* Proceed as nothing to clear if policy unavailable. */ }
            }
            if (policy == null) call.resolve();
            else if (destroyed || current == null) call.reject("Could not clear the old portal session. Please restart the app.");
            else PortalStorage.clear(current, policy.origin, success -> {
                if (success) {
                    setStorageDirty(current, false);
                    call.resolve();
                } else {
                    call.reject("Could not clear the old portal session. Please restart the app.");
                }
            });
        });
    }

    private void closeView() {
        if (portal != null) { portal.close(); portal = null; }
        if (policy != null) WebStorage.getInstance().deleteOrigin(policy.origin);
        Context context = getContext();
        if (context != null) setStorageDirty(context, false);
    }

    private static boolean isStorageDirty(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(KEY_STORAGE_DIRTY, true);
    }

    private static void setStorageDirty(Context context, boolean dirty) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_STORAGE_DIRTY, dirty)
            .apply();
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        cancelStartupCleanup();
        Bridge bridge = getBridge();
        if (pageListener != null && bridge != null) bridge.removeWebViewListener(pageListener);
        Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(this::closeView);
        else closeView();
    }
}
