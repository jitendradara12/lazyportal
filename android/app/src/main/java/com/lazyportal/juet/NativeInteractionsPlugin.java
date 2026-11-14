package com.lazyportal.juet;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.Window;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Small platform bridge; protocol and portal data remain in the web/core layers. */
@CapacitorPlugin(name = "NativeInteractions")
public class NativeInteractionsPlugin extends Plugin {
    private OnBackPressedCallback backCallback;
    private WebViewListener pageListener;
    private volatile boolean destroyed;

    @Override
    public void load() {
        backCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                Bridge bridge = getBridge();
                WebView webView = bridge != null ? bridge.getWebView() : null;
                WindowInsetsCompat insets = webView != null ? ViewCompat.getRootWindowInsets(webView) : null;
                if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
                    dismissKeyboard();
                } else {
                    notifyListeners("back", new JSObject());
                }
            }
        };
        AppCompatActivity activity = getActivity();
        if (activity != null) {
            activity.getOnBackPressedDispatcher().addCallback(activity, backCallback);
        }
        pageListener = new WebViewListener() {
            @Override
            public void onPageStarted(WebView webView) {
                // Never trap Back while reloading or displaying the offline page.
                if (backCallback != null) backCallback.setEnabled(false);
            }
        };
        Bridge bridge = getBridge();
        if (bridge != null) bridge.addWebViewListener(pageListener);
    }

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        Activity activity = getActivity();
        if (destroyed || activity == null) {
            call.reject("Could not read the installed app version");
            return;
        }
        try {
            String version = activity.getPackageManager()
                .getPackageInfo(activity.getPackageName(), 0).versionName;
            call.resolve(new JSObject().put("version", version));
        } catch (PackageManager.NameNotFoundException e) {
            call.reject("Could not read the installed app version", e);
        }
    }

    @PluginMethod
    public void setBackEnabled(PluginCall call) {
        Activity activity = getActivity();
        if (destroyed || activity == null) {
            call.resolve();
            return;
        }
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        activity.runOnUiThread(() -> {
            if (!destroyed && backCallback != null) backCallback.setEnabled(enabled);
            call.resolve();
        });
    }

    @PluginMethod
    public void defaultBack(PluginCall call) {
        Activity activity = getActivity();
        if (destroyed || activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            if (backCallback != null) backCallback.setEnabled(false);
            AppCompatActivity current = getActivity();
            if (!destroyed && current != null) {
                current.getOnBackPressedDispatcher().onBackPressed();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void haptic(PluginCall call) {
        Activity activity = getActivity();
        if (destroyed || activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            Bridge bridge = getBridge();
            WebView webView = bridge != null ? bridge.getWebView() : null;
            if (!destroyed && webView != null) {
                // View feedback respects the device's touch-feedback preference; no permission.
                webView.performHapticFeedback(
                    Build.VERSION.SDK_INT >= 27 ? HapticFeedbackConstants.CLOCK_TICK : HapticFeedbackConstants.VIRTUAL_KEY
                );
            }
            call.resolve();
        });
    }

    private void dismissKeyboard() {
        Activity activity = getActivity();
        Bridge bridge = getBridge();
        WebView webView = bridge != null ? bridge.getWebView() : null;
        Window window = activity != null ? activity.getWindow() : null;
        if (window == null || webView == null) return;
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, webView);
        if (controller != null) controller.hide(WindowInsetsCompat.Type.ime());
    }

    @PluginMethod
    public void hideKeyboard(PluginCall call) {
        Activity activity = getActivity();
        if (destroyed || activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            if (!destroyed) dismissKeyboard();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        if (backCallback != null) backCallback.remove();
        Bridge bridge = getBridge();
        if (pageListener != null && bridge != null) bridge.removeWebViewListener(pageListener);
    }
}
