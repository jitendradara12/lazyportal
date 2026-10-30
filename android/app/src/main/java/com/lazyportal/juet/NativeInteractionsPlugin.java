package com.lazyportal.juet;

import android.content.pm.PackageManager;
import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
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

    @Override
    public void load() {
        backCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getBridge().getWebView());
                if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
                    dismissKeyboard();
                } else {
                    notifyListeners("back", new JSObject());
                }
            }
        };
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), backCallback);
        pageListener = new WebViewListener() {
            @Override
            public void onPageStarted(WebView webView) {
                // Never trap Back while reloading or displaying the offline page.
                backCallback.setEnabled(false);
            }
        };
        getBridge().addWebViewListener(pageListener);
    }

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            String version = getActivity().getPackageManager()
                .getPackageInfo(getActivity().getPackageName(), 0).versionName;
            call.resolve(new JSObject().put("version", version));
        } catch (PackageManager.NameNotFoundException e) {
            call.reject("Could not read the installed app version", e);
        }
    }

    @PluginMethod
    public void setBackEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            backCallback.setEnabled(enabled);
            call.resolve();
        });
    }

    @PluginMethod
    public void defaultBack(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            backCallback.setEnabled(false);
            getActivity().getOnBackPressedDispatcher().onBackPressed();
            call.resolve();
        });
    }

    @PluginMethod
    public void haptic(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            // View feedback respects the device's touch-feedback preference; no permission.
            getBridge().getWebView().performHapticFeedback(
                Build.VERSION.SDK_INT >= 27 ? HapticFeedbackConstants.CLOCK_TICK : HapticFeedbackConstants.VIRTUAL_KEY
            );
            call.resolve();
        });
    }

    private void dismissKeyboard() {
        WindowCompat.getInsetsController(getActivity().getWindow(), getBridge().getWebView())
            .hide(WindowInsetsCompat.Type.ime());
    }

    @PluginMethod
    public void hideKeyboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            dismissKeyboard();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (backCallback != null) backCallback.remove();
        if (pageListener != null) getBridge().removeWebViewListener(pageListener);
    }
}
