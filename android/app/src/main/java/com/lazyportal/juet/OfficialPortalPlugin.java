package com.lazyportal.juet;

import android.app.Activity;
import android.content.Context;
import android.webkit.WebView;
import android.webkit.WebStorage;
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

/** Thin platform entry point. The live web app supplies the versioned bootstrap;
 * the packaged policy independently confines every network operation. */
@CapacitorPlugin(name = "OfficialPortal")
public class OfficialPortalPlugin extends Plugin {
    private OfficialPortalView portal;
    private PortalPolicy policy;
    private WebViewListener pageListener;
    private volatile boolean destroyed;

    @Override public void load() {
        try {
            Context context = getContext();
            if (context != null) policy = PortalPolicy.load(context);
        } catch (Exception ignored) { /* open() reports a missing/broken policy. */ }
        // Also remove storage left by a process kill, which may skip dismiss.
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                Activity current = getActivity();
                if (!destroyed && policy != null && current != null) PortalStorage.clear(current, policy.origin, success -> {});
            });
        }
        pageListener = new WebViewListener() {
            @Override public void onPageStarted(WebView view) { closeView(); }
        };
        Bridge bridge = getBridge();
        if (bridge != null) bridge.addWebViewListener(pageListener);
    }

    @PluginMethod public void open(PluginCall call) {
        Activity activity = getActivity();
        if (destroyed || activity == null) {
            call.reject("Could not open the official portal. Please retry.");
            return;
        }
        activity.runOnUiThread(() -> {
            Activity current = getActivity();
            if (destroyed || current == null) { call.reject("Could not open the official portal. Please retry."); return; }
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
                portal = new OfficialPortalView(current, policy, bootstrap, expired -> {
                    portal = null; call.resolve(new JSObject().put("expired", expired));
                });
                portal.show();
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
            closeView();
            Activity current = getActivity();
            if (policy == null) call.resolve();
            else if (destroyed || current == null) call.reject("Could not clear the old portal session. Please restart the app.");
            else PortalStorage.clear(current, policy.origin, success -> {
                if (success) call.resolve();
                else call.reject("Could not clear the old portal session. Please restart the app.");
            });
        });
    }

    private void closeView() {
        if (portal != null) { portal.close(); portal = null; }
        if (policy != null) WebStorage.getInstance().deleteOrigin(policy.origin);
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        Bridge bridge = getBridge();
        if (pageListener != null && bridge != null) bridge.removeWebViewListener(pageListener);
        Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(this::closeView);
        else closeView();
    }
}
