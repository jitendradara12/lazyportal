package com.lazyportal.juet;

import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.lazyportal.juet.officialportal.PortalPolicy;
import com.lazyportal.juet.officialportal.PortalTls;
import com.lazyportal.juet.officialportal.PortalTransport;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Main-app API bridge. Only exact packaged endpoints, no caller-supplied host,
 * response cache, credentials store, or automatic proxy retry. */
@CapacitorPlugin(name = "PortalHttp")
public class PortalHttpPlugin extends Plugin {
    private PortalPolicy policy;
    private PortalTransport transport;
    private WebViewListener pageListener;
    private boolean destroyed;
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32));
    // Accessed on the UI thread; workers post completions back to that thread.
    private final Map<String, Pending> pending = new HashMap<>();
    private static class Pending {
        final PluginCall call;
        FutureTask<Void> task;
        Pending(PluginCall call) { this.call = call; }
    }

    @Override public void load() {
        try {
            policy = PortalPolicy.load(getContext(), "portal-api-policy.json");
            transport = createTransport(policy);
        } catch (Exception ignored) { /* Methods report unavailable without leaking request details. */ }
        pageListener = new WebViewListener() {
            @Override public void onPageStarted(WebView view) { cancelRequests(); }
        };
        getBridge().addWebViewListener(pageListener);
    }

    protected PortalTransport createTransport(PortalPolicy policy) throws Exception {
        return new PortalTransport(policy, new PortalTls(getContext(), policy));
    }

    @PluginMethod public void capabilities(PluginCall call) {
        try {
            if (policy == null || transport == null) throw new IllegalStateException();
            call.resolve(new JSObject(policy.apiCapabilities().toString()));
        } catch (Exception ignored) { call.reject("Portal networking is unavailable. Restart the app.", "UNAVAILABLE"); }
    }

    @PluginMethod public void request(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (destroyed || transport == null) { call.reject("Portal networking is unavailable.", "UNAVAILABLE"); return; }
            String id = call.getString("id", "");
            if (!id.matches("[A-Za-z0-9:-]{1,100}") || pending.containsKey(id)) {
                call.reject("Invalid request identifier.", "INVALID_REQUEST"); return;
            }
            if (!policy.allowsApi(call.getString("method", ""), call.getString("path", ""))) {
                call.reject("Unsupported portal request.", "UNSUPPORTED_ENDPOINT"); return;
            }
            if (call.getString("body", "").length() > 512 * 1024) {
                call.reject("Request too large.", "INVALID_REQUEST"); return;
            }
            Pending entry = new Pending(call);
            entry.task = new FutureTask<>(() -> {
                JSObject response = null;
                try { response = new JSObject(transport.api(call.getData()).toString()); }
                catch (Exception ignored) { /* No URLs, tokens or bodies in logs/errors. */ }
                final JSObject result = response;
                getActivity().runOnUiThread(() -> {
                    if (pending.get(id) != entry) return;
                    pending.remove(id);
                    if (result != null) call.resolve(result);
                    else call.reject("Could not reach JUET's portal. Please retry.", "NETWORK_ERROR");
                });
                return null;
            });
            pending.put(id, entry);
            try { executor.execute(entry.task); }
            catch (RejectedExecutionException ignored) {
                pending.remove(id);
                call.reject("The portal is busy. Please retry.", "NETWORK_ERROR");
            }
        });
    }

    @PluginMethod public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> { cancelRequest(call.getString("id", "")); call.resolve(); });
    }

    private void cancelRequest(String id) {
        Pending entry = pending.remove(id);
        if (entry == null) return;
        entry.task.cancel(true);
        executor.remove(entry.task);
        transport.cancel(id);
        entry.call.reject("Request cancelled.", "ABORT_ERR");
    }

    private void cancelRequests() {
        for (String id : pending.keySet().toArray(new String[0])) cancelRequest(id);
    }

    @Override protected void handleOnDestroy() {
        if (pageListener != null) getBridge().removeWebViewListener(pageListener);
        getActivity().runOnUiThread(() -> {
            destroyed = true;
            cancelRequests();
            executor.shutdownNow();
            if (transport != null) transport.close();
        });
    }
}
