package com.lazyportal.juet;

import android.webkit.WebView;
import android.webkit.WebStorage;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.lazyportal.juet.officialportal.OfficialPortalView;
import com.lazyportal.juet.officialportal.PortalPolicy;

/** Thin platform entry point. The live web app supplies the versioned bootstrap;
 * the packaged policy independently confines every network operation. */
@CapacitorPlugin(name = "OfficialPortal")
public class OfficialPortalPlugin extends Plugin {
    private OfficialPortalView portal;
    private PortalPolicy policy;
    private WebViewListener pageListener;

    @Override public void load() {
        try { policy = PortalPolicy.load(getContext()); }
        catch (Exception ignored) { /* open() reports a missing/broken policy. */ }
        // Also remove storage left by a process kill, which may skip dismiss.
        getActivity().runOnUiThread(this::closeView);
        pageListener = new WebViewListener() {
            @Override public void onPageStarted(WebView view) { closeView(); }
        };
        getBridge().addWebViewListener(pageListener);
    }

    @PluginMethod public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (portal != null) { call.reject("The official portal is already open."); return; }
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                call.reject("Update Android System WebView to open the official portal."); return;
            }
            String bootstrap = call.getString("bootstrap", "");
            if (bootstrap.isEmpty() || bootstrap.length() > 128 * 1024 || bootstrap.toLowerCase(java.util.Locale.ROOT).contains("</script")) {
                call.reject("Invalid portal session. Reconnect and retry."); return;
            }
            try {
                if (policy == null) policy = PortalPolicy.load(getContext());
                if (call.getInt("version", 0) != policy.version) {
                    call.reject("Update Lazyportal to open this portal view."); return;
                }
                portal = new OfficialPortalView(getActivity(), policy, bootstrap, expired -> {
                    portal = null; call.resolve(new JSObject().put("expired", expired));
                });
                portal.show();
            } catch (Exception error) {
                closeView(); call.reject("Could not open the official portal. Please retry.");
            }
        });
    }

    @PluginMethod public void clear(PluginCall call) {
        getActivity().runOnUiThread(() -> { closeView(); call.resolve(); });
    }

    private void closeView() {
        if (portal != null) { portal.close(); portal = null; }
        if (policy != null) WebStorage.getInstance().deleteOrigin(policy.origin);
    }

    @Override protected void handleOnDestroy() {
        if (pageListener != null) getBridge().removeWebViewListener(pageListener);
        getActivity().runOnUiThread(this::closeView);
    }
}
