package com.lazyportal.juet;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.view.Window;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
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
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.regex.Pattern;
import org.json.JSONObject;

/** Small platform bridge; protocol and portal data remain in the web/core layers. */
@CapacitorPlugin(name = "NativeInteractions")
public class NativeInteractionsPlugin extends Plugin {
    static final String UPDATE_DOWNLOAD_BASE = "https://github.com/jitendradara12/lazyportal/releases/download/";
    static final String UPDATE_APK_NAME = "app-release.apk";
    static final String UPDATE_TMP_NAME = "app-release.apk.tmp";
    static final long MAX_APK_BYTES = 50L * 1024L * 1024L;
    static final int MAX_REDIRECTS = 5;
    static final int CONNECT_TIMEOUT_MS = 15_000;
    static final int READ_TIMEOUT_MS = 30_000;

    static final String CODE_INVALID_UPDATE = "INVALID_UPDATE";
    static final String CODE_DOWNLOAD_IN_PROGRESS = "DOWNLOAD_IN_PROGRESS";
    static final String CODE_DOWNLOAD_FAILED = "DOWNLOAD_FAILED";
    static final String CODE_CHECKSUM_MISMATCH = "CHECKSUM_MISMATCH";
    static final String CODE_PERMISSION_DENIED = "PERMISSION_DENIED";
    static final String CODE_INSTALL_FAILED = "INSTALL_FAILED";
    static final String CODE_UNAVAILABLE = "UNAVAILABLE";

    private static final Pattern UPDATE_TAG_PATTERN = Pattern.compile("\\Av\\d+\\.\\d+(?:\\.\\d+)?\\z");
    private static final Pattern SHA256_PATTERN = Pattern.compile("\\A[0-9a-fA-F]{64}\\z");
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    interface ConnectionOpener {
        HttpURLConnection open(URL url) throws IOException;
    }

    static final class UpdateException extends IOException {
        final String code;

        UpdateException(String message, String code) {
            super(message);
            this.code = code;
        }

        UpdateException(String message, String code, Throwable cause) {
            super(message, cause);
            this.code = code;
        }
    }

    private final ConnectionOpener connectionOpener;
    private final AtomicBoolean updateInProgress = new AtomicBoolean(false);
    private final ThreadPoolExecutor updateExecutor = createUpdateExecutor();
    private OnBackPressedCallback backCallback;
    private WebViewListener pageListener;
    private volatile boolean destroyed;

    public NativeInteractionsPlugin() {
        this(url -> (HttpURLConnection) url.openConnection());
    }

    NativeInteractionsPlugin(ConnectionOpener connectionOpener) {
        this.connectionOpener = connectionOpener;
    }

    private static ThreadPoolExecutor createUpdateExecutor() {
        ThreadPoolExecutor pool = new ThreadPoolExecutor(
            1,
            1,
            30L,
            TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(),
            runnable -> {
                Thread thread = new Thread(runnable, "juet-app-update");
                thread.setDaemon(true);
                return thread;
            }
        );
        pool.allowCoreThreadTimeOut(true);
        return pool;
    }

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
        if (!updateInProgress.get()) {
            clearUpdateCache(getCacheDir());
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
    public void installUpdate(PluginCall call) {
        File cacheDir = getCacheDir();
        if (destroyed || cacheDir == null) {
            call.reject("Installer unavailable", CODE_UNAVAILABLE);
            return;
        }
        JSObject data = call.getData();
        Object rawTag = data != null ? data.opt("tag") : null;
        Object rawSha = data != null ? data.opt("sha256") : null;
        if (!(rawTag instanceof String) || !isValidUpdateTag((String) rawTag)
            || (rawSha != null && rawSha != JSONObject.NULL && !(rawSha instanceof String))) {
            call.reject("Invalid update metadata", CODE_INVALID_UPDATE);
            return;
        }
        final String tag = (String) rawTag;
        final String expectedSha256;
        try {
            expectedSha256 = normalizeSha256(rawSha instanceof String ? (String) rawSha : null);
        } catch (IllegalArgumentException ignored) {
            call.reject("Invalid update metadata", CODE_INVALID_UPDATE);
            return;
        }
        if (!updateInProgress.compareAndSet(false, true)) {
            call.reject("Update download already in progress", CODE_DOWNLOAD_IN_PROGRESS);
            return;
        }
        try {
            updateExecutor.execute(() -> runUpdateDownload(call, cacheDir, tag, expectedSha256));
        } catch (RejectedExecutionException ignored) {
            updateInProgress.set(false);
            call.reject("Installer unavailable", CODE_UNAVAILABLE);
        }
    }

    @ActivityCallback
    protected void onInstallPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Activity activity = getActivity();
        if (destroyed || activity == null) {
            call.reject("Installer unavailable", CODE_UNAVAILABLE);
            return;
        }
        // Pressing Back from Settings returns RESULT_CANCELED even after granting; always re-check.
        if (!canRequestPackageInstalls(activity)) {
            call.reject("Install permission not granted", CODE_PERMISSION_DENIED);
            return;
        }
        File cacheDir = getCacheDir();
        File apkFile = cacheDir != null ? new File(cacheDir, UPDATE_APK_NAME) : null;
        if (apkFile == null || !apkFile.isFile() || apkFile.length() == 0) {
            call.reject("Could not download update", CODE_DOWNLOAD_FAILED);
            return;
        }
        launchPackageInstaller(activity, apkFile, call);
    }

    protected boolean runOnUiThread(Runnable action) {
        Activity activity = getActivity();
        if (activity == null) return false;
        activity.runOnUiThread(action);
        return true;
    }

    protected File getCacheDir() {
        Activity activity = getActivity();
        return activity != null ? activity.getCacheDir() : null;
    }

    protected boolean canRequestPackageInstalls(Activity activity) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || activity.getPackageManager().canRequestPackageInstalls();
    }

    protected Uri getApkFileUri(Activity activity, File apkFile) {
        return FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apkFile);
    }

    protected void startPackageInstaller(Activity activity, Intent intent) {
        activity.startActivity(intent);
    }

    private void runUpdateDownload(PluginCall call, File cacheDir, String tag, String expectedSha256) {
        try {
            File apkFile = prepareUpdateApk(
                buildDownloadUrl(tag),
                new File(cacheDir, UPDATE_APK_NAME),
                new File(cacheDir, UPDATE_TMP_NAME),
                expectedSha256,
                connectionOpener,
                () -> destroyed || Thread.currentThread().isInterrupted()
            );
            if (destroyed) {
                updateInProgress.set(false);
                return;
            }
            if (!runOnUiThread(() -> {
                updateInProgress.set(false);
                if (!destroyed) proceedToInstall(call, apkFile);
            })) {
                updateInProgress.set(false);
                if (!destroyed) call.reject("Installer unavailable", CODE_UNAVAILABLE);
            }
        } catch (UpdateException e) {
            updateInProgress.set(false);
            rejectOnUiOrCurrent(call, e.getMessage(), e.code, e.getCause());
        } catch (Exception e) {
            updateInProgress.set(false);
            rejectOnUiOrCurrent(call, "Could not download update", CODE_DOWNLOAD_FAILED, e);
        }
    }

    private void rejectOnUiOrCurrent(PluginCall call, String message, String code, Throwable cause) {
        if (destroyed) return;
        Exception ex = cause instanceof Exception ? (Exception) cause : null;
        if (!runOnUiThread(() -> {
            if (!destroyed) call.reject(message, code, ex);
        })) {
            if (!destroyed) call.reject(message, code, ex);
        }
    }

    private void proceedToInstall(PluginCall call, File apkFile) {
        Activity activity = getActivity();
        if (destroyed || activity == null) {
            call.reject("Installer unavailable", CODE_UNAVAILABLE);
            return;
        }
        if (!canRequestPackageInstalls(activity)) {
            Intent intent = createUnknownAppSourcesIntent(activity.getPackageName());
            try {
                startActivityForResult(call, intent, "onInstallPermissionResult");
            } catch (ActivityNotFoundException | SecurityException e) {
                call.reject("Could not open install permission settings", CODE_INSTALL_FAILED, e);
            }
            return;
        }
        launchPackageInstaller(activity, apkFile, call);
    }

    private void launchPackageInstaller(Activity activity, File apkFile, PluginCall call) {
        try {
            Uri uri = getApkFileUri(activity, apkFile);
            startPackageInstaller(activity, createInstallIntent(uri));
            call.resolve(new JSObject().put("started", true));
        } catch (ActivityNotFoundException | IllegalArgumentException | SecurityException e) {
            call.reject("Could not open package installer", CODE_INSTALL_FAILED, e);
        }
    }

    static Intent createUnknownAppSourcesIntent(String packageName) {
        return new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + packageName));
    }

    static Intent createInstallIntent(Uri uri) {
        return new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    static boolean isValidUpdateTag(String tag) {
        return tag != null && UPDATE_TAG_PATTERN.matcher(tag).matches();
    }

    static String normalizeSha256(String sha256) {
        if (sha256 == null || sha256.isEmpty()) return null;
        if (!SHA256_PATTERN.matcher(sha256).matches()) {
            throw new IllegalArgumentException("Invalid SHA-256 digest");
        }
        return sha256.toLowerCase(Locale.ROOT);
    }

    static URL buildDownloadUrl(String tag) throws MalformedURLException {
        if (!isValidUpdateTag(tag)) throw new IllegalArgumentException("Invalid update tag");
        return new URL(UPDATE_DOWNLOAD_BASE + tag + "/" + UPDATE_APK_NAME);
    }

    static boolean isAllowedUpdateHost(URL url) {
        if (url == null || !"https".equalsIgnoreCase(url.getProtocol())) return false;
        if (url.getUserInfo() != null) return false;
        int port = url.getPort();
        if (port != -1 && port != 443) return false;
        String host = url.getHost();
        if (host == null || host.isEmpty()) return false;
        String normalized = host.toLowerCase(Locale.ROOT);
        if (normalized.equals("github.com")) return true;
        return normalized.endsWith(".githubusercontent.com")
            && normalized.length() > ".githubusercontent.com".length()
            && !normalized.startsWith(".")
            && !normalized.contains("..");
    }

    static File prepareUpdateApk(
        URL initialUrl,
        File targetApk,
        File tmpApk,
        String expectedSha256,
        ConnectionOpener opener,
        BooleanSupplier cancelled
    ) throws IOException {
        if (expectedSha256 != null && targetApk.isFile() && targetApk.length() > 0 && targetApk.length() <= MAX_APK_BYTES) {
            try {
                if (expectedSha256.equals(sha256File(targetApk, MAX_APK_BYTES))) {
                    return targetApk;
                }
            } catch (IOException ignored) {
                // Corrupt or unreadable cached file: re-download.
            }
        }
        if (!isAllowedUpdateHost(initialUrl)) {
            throw new UpdateException("Invalid update metadata", CODE_INVALID_UPDATE);
        }
        File parent = tmpApk.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        deleteQuietly(tmpApk);
        URL current = initialUrl;
        HttpURLConnection connection = null;
        try {
            for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
                if (cancelled.getAsBoolean()) {
                    throw new UpdateException("Installer unavailable", CODE_UNAVAILABLE);
                }
                connection = openUpdateConnection(opener, current);
                int status = connection.getResponseCode();
                if (isRedirect(status)) {
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    connection = null;
                    if (hop == MAX_REDIRECTS || location == null || location.trim().isEmpty()) {
                        throw new UpdateException("Could not download update", CODE_DOWNLOAD_FAILED);
                    }
                    URL next = new URL(current, location.trim());
                    if (!isAllowedUpdateHost(next)) {
                        throw new UpdateException("Could not download update", CODE_DOWNLOAD_FAILED);
                    }
                    current = next;
                    continue;
                }
                if (status != HttpURLConnection.HTTP_OK) {
                    throw new UpdateException("Could not download update", CODE_DOWNLOAD_FAILED);
                }
                if (connection.getContentLengthLong() > MAX_APK_BYTES) {
                    throw new UpdateException("Update download too large", CODE_DOWNLOAD_FAILED);
                }
                String actualSha256;
                try (InputStream in = connection.getInputStream();
                     OutputStream out = new FileOutputStream(tmpApk)) {
                    actualSha256 = streamAndHash(in, out, MAX_APK_BYTES, cancelled);
                }
                if (expectedSha256 != null && !expectedSha256.equals(actualSha256)) {
                    throw new UpdateException("Update file verification failed", CODE_CHECKSUM_MISMATCH);
                }
                if (!tmpApk.renameTo(targetApk)) {
                    deleteQuietly(targetApk);
                    if (!tmpApk.renameTo(targetApk)) {
                        throw new UpdateException("Could not download update", CODE_DOWNLOAD_FAILED);
                    }
                }
                return targetApk;
            }
            throw new UpdateException("Could not download update", CODE_DOWNLOAD_FAILED);
        } finally {
            if (connection != null) connection.disconnect();
            deleteQuietly(tmpApk);
        }
    }

    private static HttpURLConnection openUpdateConnection(ConnectionOpener opener, URL url) throws IOException {
        HttpURLConnection connection = opener.open(url);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/octet-stream");
        connection.setRequestProperty("Accept-Encoding", "identity");
        return connection;
    }

    private static boolean isRedirect(int status) {
        return status == HttpURLConnection.HTTP_MOVED_PERM
            || status == HttpURLConnection.HTTP_MOVED_TEMP
            || status == HttpURLConnection.HTTP_SEE_OTHER
            || status == 307
            || status == 308;
    }

    static String sha256File(File file, long maxBytes) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            return streamAndHash(in, null, maxBytes, () -> false);
        }
    }

    static String streamAndHash(InputStream in, OutputStream out, long maxBytes, BooleanSupplier cancelled)
        throws IOException {
        if (in == null) throw new UpdateException("Could not download update", CODE_DOWNLOAD_FAILED);
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
        byte[] buffer = new byte[8192];
        long total = 0;
        int count;
        while ((count = in.read(buffer)) != -1) {
            if (cancelled.getAsBoolean()) {
                throw new UpdateException("Installer unavailable", CODE_UNAVAILABLE);
            }
            total += count;
            if (total > maxBytes) {
                throw new UpdateException("Update download too large", CODE_DOWNLOAD_FAILED);
            }
            digest.update(buffer, 0, count);
            if (out != null) out.write(buffer, 0, count);
        }
        if (total == 0) {
            throw new UpdateException("Could not download update", CODE_DOWNLOAD_FAILED);
        }
        if (out != null) out.flush();
        byte[] bytes = digest.digest();
        char[] hexChars = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            int value = bytes[i] & 0xff;
            hexChars[i * 2] = HEX[value >>> 4];
            hexChars[i * 2 + 1] = HEX[value & 0x0f];
        }
        return new String(hexChars);
    }

    static void clearUpdateCache(File cacheDir) {
        if (cacheDir == null) return;
        deleteQuietly(new File(cacheDir, UPDATE_TMP_NAME));
        deleteQuietly(new File(cacheDir, UPDATE_APK_NAME));
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists()) {
            // Best-effort cleanup of cache artifacts.
            file.delete();
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
        updateInProgress.set(false);
        updateExecutor.shutdownNow();
        if (backCallback != null) backCallback.remove();
        Bridge bridge = getBridge();
        if (pageListener != null && bridge != null) bridge.removeWebViewListener(pageListener);
    }
}
