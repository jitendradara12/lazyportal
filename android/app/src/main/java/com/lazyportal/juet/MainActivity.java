package com.lazyportal.juet;

import android.content.res.Configuration;
import android.os.Build;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onStart() {
        super.onStart();
        applyWebViewTheme();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyWebViewTheme();
    }

    private void applyWebViewTheme() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            int nightModeFlags = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            boolean isNight = nightModeFlags == Configuration.UI_MODE_NIGHT_YES;
            webView.setBackgroundColor(isNight ? 0xFF141316 : 0xFFFCF8FD);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && Build.VERSION.SDK_INT < 33) {
                settings.setForceDark(isNight ? WebSettings.FORCE_DARK_ON : WebSettings.FORCE_DARK_OFF);
            }
        }
    }
}

