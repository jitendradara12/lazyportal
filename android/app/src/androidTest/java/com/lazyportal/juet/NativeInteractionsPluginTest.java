package com.lazyportal.juet;

import static org.junit.Assert.*;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises the actual Android dispatcher, plugin lifecycle, and UI-thread methods. */
@RunWith(AndroidJUnit4.class)
public class NativeInteractionsPluginTest {
    private static class Call extends PluginCall {
        boolean resolved;
        JSObject result;
        Call(JSObject data) { super(null, "NativeInteractions", "1", "test", data); }
        @Override public void resolve() { resolved = true; }
        @Override public void resolve(JSObject data) { resolved = true; result = data; }
    }

    private static class TestPlugin extends NativeInteractionsPlugin {
        final MainActivity activity;
        int backs;
        TestPlugin(MainActivity activity) { this.activity = activity; }
        @Override public AppCompatActivity getActivity() { return activity; }
        @Override public Bridge getBridge() { return activity.getBridge(); }
        @Override protected void notifyListeners(String event, JSObject data) {
            assertEquals("back", event);
            backs++;
        }
    }

    @Test
    public void reportsTheInstalledPackageVersion() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().stopLoading();
                Call call = new Call(new JSObject());
                new TestPlugin(activity).getAppVersion(call);
                assertTrue(call.resolved);
                try {
                    assertEquals(activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName,
                        call.result.getString("version"));
                } catch (android.content.pm.PackageManager.NameNotFoundException e) {
                    throw new AssertionError(e);
                }
            });
        }
    }

    @Test
    public void backIsInterceptedOnlyWhileRequestedAndCleanupRestoresSystemHandling() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                // These checks need no portal responses or signed-in account.
                activity.getBridge().getWebView().stopLoading();
                final int[] fallbackCalls = { 0 };
                OnBackPressedCallback fallback = new OnBackPressedCallback(true) {
                    @Override public void handleOnBackPressed() { fallbackCalls[0]++; }
                };
                activity.getOnBackPressedDispatcher().addCallback(activity, fallback);
                TestPlugin plugin = new TestPlugin(activity);
                plugin.load();
                try {
                    activity.getOnBackPressedDispatcher().onBackPressed();
                    assertEquals(1, fallbackCalls[0]);
                    assertEquals(0, plugin.backs);

                    Call enable = new Call(new JSObject().put("enabled", true));
                    plugin.setBackEnabled(enable);
                    assertTrue(enable.resolved);
                    activity.getOnBackPressedDispatcher().onBackPressed();
                    assertEquals(1, plugin.backs);
                    assertEquals(1, fallbackCalls[0]);

                    plugin.setBackEnabled(new Call(new JSObject().put("enabled", false)));
                    activity.getOnBackPressedDispatcher().onBackPressed();
                    assertEquals(2, fallbackCalls[0]);

                    plugin.setBackEnabled(new Call(new JSObject().put("enabled", true)));
                    Call defaultBack = new Call(new JSObject());
                    plugin.defaultBack(defaultBack);
                    assertTrue(defaultBack.resolved);
                    assertEquals(3, fallbackCalls[0]);

                    Call haptic = new Call(new JSObject());
                    plugin.haptic(haptic);
                    assertTrue(haptic.resolved);
                    Call hideKeyboard = new Call(new JSObject());
                    plugin.hideKeyboard(hideKeyboard);
                    assertTrue(hideKeyboard.resolved);
                } finally {
                    plugin.handleOnDestroy();
                }
                activity.getOnBackPressedDispatcher().onBackPressed();
                assertEquals(4, fallbackCalls[0]);
                fallback.remove();
            });
        }
    }
}
