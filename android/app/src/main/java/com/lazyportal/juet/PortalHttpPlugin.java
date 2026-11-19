package com.lazyportal.juet;

import android.app.Activity;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.lazyportal.juet.officialportal.PortalPolicy;
import com.lazyportal.juet.officialportal.PortalTls;
import com.lazyportal.juet.officialportal.PortalTransport;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
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
    private volatile boolean destroyed;
    private final ThreadPoolExecutor executor = createExecutor();
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();

    private static ThreadPoolExecutor createExecutor() {
        // Attendance sync fans out up to 5 subjects x 3 L/T/P reads concurrently;
        // sizing to 16 prevents local 60s request timeouts from pool queueing.
        ThreadPoolExecutor pool = new ThreadPoolExecutor(16, 16, 30L, TimeUnit.SECONDS, new ArrayBlockingQueue<>(64));
        pool.allowCoreThreadTimeOut(true);
        return pool;
    }

    public PortalHttpPlugin() {}

    PortalHttpPlugin(PortalPolicy policy, PortalTransport transport) {
        this.policy = policy;
        this.transport = transport;
    }

    private static class Pending {
        final PluginCall call;
        FutureTask<Void> task;
        Pending(PluginCall call) { this.call = call; }
    }

    protected boolean runOnUiThread(Runnable action) {
        Activity activity = getActivity();
        if (activity == null) return false;
        activity.runOnUiThread(action);
        return true;
    }

    @Override public void load() {
        try {
            policy = PortalPolicy.load(getContext(), "portal-api-policy.json");
            transport = createTransport(policy);
        } catch (Exception ignored) { /* Methods report unavailable without leaking request details. */ }
        pageListener = new WebViewListener() {
            @Override public void onPageStarted(WebView view) { cancelRequests(); }
        };
        Bridge bridge = getBridge();
        if (bridge != null) bridge.addWebViewListener(pageListener);
    }

    protected PortalTransport createTransport(PortalPolicy policy) throws Exception {
        PortalTls tls = new PortalTls(getContext(), policy);
        try {
            executor.execute(tls::warmUp);
        } catch (RejectedExecutionException ignored) {
            // Lazy initialization in PortalTls.open() still covers the first request.
        }
        return new PortalTransport(policy, tls);
    }

    @PluginMethod public void capabilities(PluginCall call) {
        try {
            if (policy == null || transport == null) throw new IllegalStateException();
            call.resolve(new JSObject(policy.apiCapabilities().toString()));
        } catch (Exception ignored) { call.reject("Portal networking is unavailable. Restart the app.", "UNAVAILABLE"); }
    }

    @PluginMethod public void request(PluginCall call) {
        if (destroyed || !runOnUiThread(() -> {
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
                if (destroyed) return null;
                if (!runOnUiThread(() -> {
                    if (destroyed || !pending.remove(id, entry)) return;
                    settleCall(call, result);
                })) {
                    if (!destroyed && pending.remove(id, entry)) settleCall(call, result);
                }
                return null;
            });
            pending.put(id, entry);
            try { executor.execute(entry.task); }
            catch (RejectedExecutionException ignored) {
                if (pending.remove(id, entry)) call.reject("The portal is busy. Please retry.", "NETWORK_ERROR");
            }
        })) {
            call.reject("Portal networking is unavailable.", "UNAVAILABLE");
        }
    }

    private static void settleCall(PluginCall call, JSObject result) {
        if (result != null) call.resolve(result);
        else call.reject("Could not reach JUET's portal. Please retry.", "NETWORK_ERROR");
    }

    @PluginMethod public void cancel(PluginCall call) {
        Runnable action = () -> { cancelRequest(call.getString("id", "")); call.resolve(); };
        if (!runOnUiThread(action)) action.run();
    }

    private void cancelRequest(String id) {
        Pending entry = pending.remove(id);
        if (entry == null) return;
        entry.task.cancel(true);
        executor.remove(entry.task);
        if (transport != null) transport.cancel(id);
        entry.call.reject("Request cancelled.", "ABORT_ERR");
    }

    private void cancelRequests() {
        for (String id : pending.keySet().toArray(new String[0])) cancelRequest(id);
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        Bridge bridge = getBridge();
        if (pageListener != null && bridge != null) bridge.removeWebViewListener(pageListener);
        Runnable teardown = () -> {
            cancelRequests();
            executor.shutdownNow();
            if (transport != null) transport.close();
        };
        if (!runOnUiThread(teardown)) teardown.run();
    }
}
