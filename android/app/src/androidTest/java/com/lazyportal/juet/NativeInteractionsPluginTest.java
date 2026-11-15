package com.lazyportal.juet;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.appcompat.app.AppCompatActivity;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises the actual Android dispatcher, plugin lifecycle, and UI-thread methods. */
@RunWith(AndroidJUnit4.class)
public class NativeInteractionsPluginTest {
    private static class Call extends PluginCall {
        final CountDownLatch settled = new CountDownLatch(1);
        volatile boolean resolved;
        volatile JSObject result;
        volatile String errorCode;

        Call(JSObject data) { super(null, "NativeInteractions", "1", "test", data); }
        @Override public void resolve() { resolved = true; settled.countDown(); }
        @Override public void resolve(JSObject data) { resolved = true; result = data; settled.countDown(); }
        @Override public void reject(String msg, String code, Exception ex, JSObject data) {
            errorCode = code;
            settled.countDown();
        }

        boolean awaitSettled(long timeout, TimeUnit unit) throws InterruptedException {
            return settled.await(timeout, unit);
        }
    }

    private static class TestPlugin extends NativeInteractionsPlugin {
        final MainActivity activity;
        int backs;
        boolean canInstall = true;
        final CountDownLatch permissionRequested = new CountDownLatch(1);
        Intent permissionIntent;
        String permissionCallback;
        Intent installerIntent;

        TestPlugin(MainActivity activity) { this.activity = activity; }
        @Override public AppCompatActivity getActivity() { return activity; }
        @Override public Bridge getBridge() { return activity.getBridge(); }
        @Override protected void notifyListeners(String event, JSObject data) {
            assertEquals("back", event);
            backs++;
        }
        @Override protected boolean canRequestPackageInstalls(Activity ignored) { return canInstall; }
        @Override public void startActivityForResult(PluginCall call, Intent intent, String callbackName) {
            permissionIntent = intent;
            permissionCallback = callbackName;
            permissionRequested.countDown();
        }
        @Override protected void startPackageInstaller(Activity ignored, Intent intent) {
            installerIntent = intent;
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

    @Test
    public void getAppVersionClearsStaleUpdateCacheFiles() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().stopLoading();
                File apk = new File(activity.getCacheDir(), NativeInteractionsPlugin.UPDATE_APK_NAME);
                File tmp = new File(activity.getCacheDir(), NativeInteractionsPlugin.UPDATE_TMP_NAME);
                try {
                    writeBytes(apk, "old-apk".getBytes(StandardCharsets.UTF_8));
                    writeBytes(tmp, "partial".getBytes(StandardCharsets.UTF_8));
                    Call call = new Call(new JSObject());
                    new TestPlugin(activity).getAppVersion(call);
                    assertTrue(call.resolved);
                    assertFalse(apk.exists());
                    assertFalse(tmp.exists());
                } catch (Exception e) {
                    throw new AssertionError(e);
                } finally {
                    apk.delete();
                    tmp.delete();
                }
            });
        }
    }

    @Test
    public void installUpdateLaunchesFileProviderInstallerWhenPermitted() throws Exception {
        byte[] payload = "cached-apk-bytes".getBytes(StandardCharsets.UTF_8);
        String sha = sha256Hex(payload);
        AtomicReference<TestPlugin> pluginRef = new AtomicReference<>();
        AtomicReference<File> apkRef = new AtomicReference<>();
        AtomicReference<String> packageNameRef = new AtomicReference<>();
        Call call = new Call(new JSObject().put("tag", "v1.0.4").put("sha256", sha));

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().stopLoading();
                File apk = new File(activity.getCacheDir(), NativeInteractionsPlugin.UPDATE_APK_NAME);
                apkRef.set(apk);
                packageNameRef.set(activity.getPackageName());
                try {
                    writeBytes(apk, payload);
                } catch (Exception e) {
                    throw new AssertionError(e);
                }
                TestPlugin plugin = new TestPlugin(activity);
                pluginRef.set(plugin);
                plugin.installUpdate(call);
            });

            assertTrue(call.awaitSettled(5, TimeUnit.SECONDS));
            assertTrue(call.resolved);
            assertTrue(call.result.getBoolean("started", false));

            Intent intent = pluginRef.get().installerIntent;
            assertNotNull(intent);
            assertEquals(Intent.ACTION_VIEW, intent.getAction());
            assertEquals("application/vnd.android.package-archive", intent.getType());
            int expectedFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK;
            assertEquals(expectedFlags, intent.getFlags() & expectedFlags);

            Uri uri = intent.getData();
            assertNotNull(uri);
            assertEquals("content", uri.getScheme());
            assertEquals(packageNameRef.get() + ".fileprovider", uri.getAuthority());

            try (InputStream in = InstrumentationRegistry.getInstrumentation().getTargetContext()
                .getContentResolver().openInputStream(uri);
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[1024];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                assertArrayEquals(payload, out.toByteArray());
            }
        } finally {
            if (pluginRef.get() != null) pluginRef.get().handleOnDestroy();
            if (apkRef.get() != null) apkRef.get().delete();
        }
    }

    @Test
    public void installUpdatePromptsForPermissionAndRechecksOnResultCanceled() throws Exception {
        byte[] payload = "cached-apk-perm".getBytes(StandardCharsets.UTF_8);
        String sha = sha256Hex(payload);
        AtomicReference<TestPlugin> pluginRef = new AtomicReference<>();
        AtomicReference<File> apkRef = new AtomicReference<>();
        AtomicReference<String> packageNameRef = new AtomicReference<>();
        Call call = new Call(new JSObject().put("tag", "v1.0.4").put("sha256", sha));

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().stopLoading();
                File apk = new File(activity.getCacheDir(), NativeInteractionsPlugin.UPDATE_APK_NAME);
                apkRef.set(apk);
                packageNameRef.set(activity.getPackageName());
                try {
                    writeBytes(apk, payload);
                } catch (Exception e) {
                    throw new AssertionError(e);
                }
                TestPlugin plugin = new TestPlugin(activity);
                plugin.canInstall = false;
                pluginRef.set(plugin);
                plugin.installUpdate(call);
            });

            TestPlugin plugin = pluginRef.get();
            assertTrue(plugin.permissionRequested.await(5, TimeUnit.SECONDS));
            assertEquals(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, plugin.permissionIntent.getAction());
            assertEquals("package:" + packageNameRef.get(), plugin.permissionIntent.getData().toString());
            assertEquals("onInstallPermissionResult", plugin.permissionCallback);
            assertEquals(1, call.settled.getCount());

            scenario.onActivity(activity -> {
                plugin.onInstallPermissionResult(call, new ActivityResult(Activity.RESULT_CANCELED, null));
                assertFalse(call.resolved);
                assertEquals(NativeInteractionsPlugin.CODE_PERMISSION_DENIED, call.errorCode);
                assertNull(plugin.installerIntent);

                // Even when Settings returns RESULT_CANCELED, granting permission launches the installer.
                plugin.canInstall = true;
                Call grantedCall = new Call(new JSObject().put("tag", "v1.0.4"));
                plugin.onInstallPermissionResult(grantedCall, new ActivityResult(Activity.RESULT_CANCELED, null));
                assertTrue(grantedCall.resolved);
                assertTrue(grantedCall.result.getBoolean("started", false));
                assertNotNull(plugin.installerIntent);
            });
        } finally {
            if (pluginRef.get() != null) pluginRef.get().handleOnDestroy();
            if (apkRef.get() != null) apkRef.get().delete();
        }
    }

    private static void writeBytes(File file, byte[] bytes) throws Exception {
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
    }

    private static String sha256Hex(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder sb = new StringBuilder(digest.length * 2);
        for (byte b : digest) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
