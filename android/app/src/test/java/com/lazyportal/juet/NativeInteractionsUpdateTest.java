package com.lazyportal.juet;

import static org.junit.Assert.*;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** JVM unit tests for Rung 2 update validation, redirect allowlisting, hashing, and concurrency. */
public class NativeInteractionsUpdateTest {
    @Rule
    public final TemporaryFolder temp = new TemporaryFolder();

    @Test
    public void validatesUpdateTagsAndBuildsPinnedDownloadUrl() throws Exception {
        assertTrue(NativeInteractionsPlugin.isValidUpdateTag("v1.0"));
        assertTrue(NativeInteractionsPlugin.isValidUpdateTag("v1.0.4"));
        assertTrue(NativeInteractionsPlugin.isValidUpdateTag("v12.345.678"));

        assertEquals(
            "https://github.com/jitendradara12/lazyportal/releases/download/v1.0.4/app-release.apk",
            NativeInteractionsPlugin.buildDownloadUrl("v1.0.4").toString()
        );

        String[] invalid = {
            null, "", "1.0.4", "v1", "v1.0.4.1", "v1.0.4-beta.1",
            "v1.0.4+build", "v1.0.4\n", "v1.0.4/../../evil", "v1.0.4?foo=bar"
        };
        for (String tag : invalid) {
            assertFalse("Expected invalid tag: " + tag, NativeInteractionsPlugin.isValidUpdateTag(tag));
        }
    }

    @Test
    public void normalizesAndValidatesSha256() {
        assertNull(NativeInteractionsPlugin.normalizeSha256(null));
        assertNull(NativeInteractionsPlugin.normalizeSha256(""));

        String upper = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";
        assertEquals(upper.toLowerCase(), NativeInteractionsPlugin.normalizeSha256(upper));

        String[] invalid = { "   ", "deadbeef", upper + "0", upper.substring(0, 63), "z".repeat(64), "sha256:" + upper };
        for (String digest : invalid) {
            try {
                NativeInteractionsPlugin.normalizeSha256(digest);
                fail("Expected IllegalArgumentException for: " + digest);
            } catch (IllegalArgumentException expected) {
                // expected
            }
        }
    }

    @Test
    public void allowlistsOnlyHttpsGithubAndUserContentHosts() throws Exception {
        assertTrue(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://github.com/jitendradara12/lazyportal/releases/download/v1.0.4/app-release.apk")));
        assertTrue(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://GITHUB.COM/foo")));
        assertTrue(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://objects.githubusercontent.com/github-production-release-asset-1/app-release.apk")));
        assertTrue(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://release-assets.githubusercontent.com/app-release.apk")));

        assertFalse(NativeInteractionsPlugin.isAllowedUpdateHost(null));
        assertFalse(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("http://github.com/app-release.apk")));
        assertFalse(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://githubusercontent.com/app-release.apk")));
        assertFalse(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://.githubusercontent.com/app-release.apk")));
        assertFalse(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://a..githubusercontent.com/app-release.apk")));
        assertFalse(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://notgithub.com/app-release.apk")));
        assertFalse(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://github.com.evil.com/app-release.apk")));
        assertFalse(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://user@github.com/app-release.apk")));
        assertFalse(NativeInteractionsPlugin.isAllowedUpdateHost(new URL("https://github.com:8443/app-release.apk")));
    }

    @Test
    public void followsAllowedRedirectsVerifiesSha256AndWritesAtomically() throws Exception {
        byte[] payload = "signed-apk-payload-v1.0.4".getBytes(StandardCharsets.UTF_8);
        String expectedSha = sha256Hex(payload);
        File cacheDir = temp.newFolder("cache-ok");
        File apk = new File(cacheDir, NativeInteractionsPlugin.UPDATE_APK_NAME);
        File tmp = new File(cacheDir, NativeInteractionsPlugin.UPDATE_TMP_NAME);
        List<FakeConnection> opened = new ArrayList<>();

        NativeInteractionsPlugin.ConnectionOpener opener = url -> {
            String s = url.toString();
            FakeConnection conn;
            if (s.startsWith("https://github.com/")) {
                conn = FakeConnection.redirect(url, 302, "https://release-assets.githubusercontent.com/step1");
            } else if (s.equals("https://release-assets.githubusercontent.com/step1")) {
                conn = FakeConnection.redirect(url, 307, "/step2");
            } else if (s.equals("https://release-assets.githubusercontent.com/step2")) {
                conn = FakeConnection.ok(url, payload);
            } else {
                throw new AssertionError("Unexpected URL: " + s);
            }
            opened.add(conn);
            return conn;
        };

        File result = NativeInteractionsPlugin.prepareUpdateApk(
            NativeInteractionsPlugin.buildDownloadUrl("v1.0.4"),
            apk,
            tmp,
            expectedSha,
            opener,
            () -> false
        );

        assertEquals(apk, result);
        assertTrue(apk.isFile());
        assertFalse(tmp.exists());
        assertEquals(expectedSha, NativeInteractionsPlugin.sha256File(apk, NativeInteractionsPlugin.MAX_APK_BYTES));
        assertEquals(3, opened.size());
        for (FakeConnection conn : opened) {
            assertFalse(conn.getInstanceFollowRedirects());
            assertEquals(NativeInteractionsPlugin.CONNECT_TIMEOUT_MS, conn.getConnectTimeout());
            assertEquals(NativeInteractionsPlugin.READ_TIMEOUT_MS, conn.getReadTimeout());
            assertEquals("application/octet-stream", conn.getRequestProperty("Accept"));
            assertTrue(conn.disconnected);
        }
    }

    @Test
    public void reusesCachedApkWhenSha256MatchesAndRedownloadsWhenNullOrMismatched() throws Exception {
        byte[] oldPayload = "old-apk-bytes".getBytes(StandardCharsets.UTF_8);
        byte[] newPayload = "new-apk-bytes".getBytes(StandardCharsets.UTF_8);
        File cacheDir = temp.newFolder("cache-hit");
        File apk = new File(cacheDir, NativeInteractionsPlugin.UPDATE_APK_NAME);
        File tmp = new File(cacheDir, NativeInteractionsPlugin.UPDATE_TMP_NAME);
        writeFile(apk, oldPayload);

        AtomicInteger networkCalls = new AtomicInteger();
        NativeInteractionsPlugin.ConnectionOpener opener = url -> {
            networkCalls.incrementAndGet();
            return FakeConnection.ok(url, newPayload);
        };

        // Matching sha256 skips network completely.
        NativeInteractionsPlugin.prepareUpdateApk(
            NativeInteractionsPlugin.buildDownloadUrl("v1.0.4"),
            apk,
            tmp,
            sha256Hex(oldPayload),
            opener,
            () -> false
        );
        assertEquals(0, networkCalls.get());

        // Null sha256 always re-downloads.
        NativeInteractionsPlugin.prepareUpdateApk(
            NativeInteractionsPlugin.buildDownloadUrl("v1.0.4"),
            apk,
            tmp,
            null,
            opener,
            () -> false
        );
        assertEquals(1, networkCalls.get());
        assertEquals(sha256Hex(newPayload), NativeInteractionsPlugin.sha256File(apk, NativeInteractionsPlugin.MAX_APK_BYTES));

        // clearUpdateCache removes both APK and tmp.
        writeFile(tmp, oldPayload);
        NativeInteractionsPlugin.clearUpdateCache(cacheDir);
        assertFalse(apk.exists());
        assertFalse(tmp.exists());
    }

    @Test
    public void rejectsDisallowedRedirectsAndExcessiveRedirectHops() throws Exception {
        File cacheDir = temp.newFolder("cache-redir");
        File apk = new File(cacheDir, NativeInteractionsPlugin.UPDATE_APK_NAME);
        File tmp = new File(cacheDir, NativeInteractionsPlugin.UPDATE_TMP_NAME);

        for (String target : new String[] {
            "http://objects.githubusercontent.com/app.apk",
            "https://evil.example/app.apk",
            "//evil.example/app.apk"
        }) {
            AtomicInteger calls = new AtomicInteger();
            try {
                NativeInteractionsPlugin.prepareUpdateApk(
                    NativeInteractionsPlugin.buildDownloadUrl("v1.0.4"),
                    apk,
                    tmp,
                    null,
                    url -> {
                        calls.incrementAndGet();
                        return FakeConnection.redirect(url, 302, target);
                    },
                    () -> false
                );
                fail("Expected redirect rejection for " + target);
            } catch (NativeInteractionsPlugin.UpdateException e) {
                assertEquals(NativeInteractionsPlugin.CODE_DOWNLOAD_FAILED, e.code);
                assertEquals(1, calls.get());
            }
        }

        // Exactly 5 redirects succeeds; 6 redirects fails.
        byte[] payload = "five-hops".getBytes(StandardCharsets.UTF_8);
        NativeInteractionsPlugin.prepareUpdateApk(
            NativeInteractionsPlugin.buildDownloadUrl("v1.0.4"),
            apk,
            tmp,
            sha256Hex(payload),
            new RedirectCounterOpener(5, payload),
            () -> false
        );
        assertTrue(apk.delete());

        try {
            NativeInteractionsPlugin.prepareUpdateApk(
                NativeInteractionsPlugin.buildDownloadUrl("v1.0.4"),
                apk,
                tmp,
                null,
                new RedirectCounterOpener(6, payload),
                () -> false
            );
            fail("Expected too many redirects failure");
        } catch (NativeInteractionsPlugin.UpdateException e) {
            assertEquals(NativeInteractionsPlugin.CODE_DOWNLOAD_FAILED, e.code);
        }
        assertFalse(apk.exists());
        assertFalse(tmp.exists());
    }

    @Test
    public void rejectsChecksumMismatchOversizedAndEmptyResponsesWithoutKeepingTempFile() throws Exception {
        File cacheDir = temp.newFolder("cache-errors");
        File apk = new File(cacheDir, NativeInteractionsPlugin.UPDATE_APK_NAME);
        File tmp = new File(cacheDir, NativeInteractionsPlugin.UPDATE_TMP_NAME);
        byte[] payload = "real-bytes".getBytes(StandardCharsets.UTF_8);

        // Checksum mismatch
        try {
            NativeInteractionsPlugin.prepareUpdateApk(
                NativeInteractionsPlugin.buildDownloadUrl("v1.0.4"),
                apk,
                tmp,
                "0".repeat(64),
                url -> FakeConnection.ok(url, payload),
                () -> false
            );
            fail("Expected CHECKSUM_MISMATCH");
        } catch (NativeInteractionsPlugin.UpdateException e) {
            assertEquals(NativeInteractionsPlugin.CODE_CHECKSUM_MISMATCH, e.code);
            assertEquals("Update file verification failed", e.getMessage());
        }
        assertFalse(apk.exists());
        assertFalse(tmp.exists());

        // Oversized Content-Length aborts before reading stream.
        AtomicInteger streamReads = new AtomicInteger();
        try {
            NativeInteractionsPlugin.prepareUpdateApk(
                NativeInteractionsPlugin.buildDownloadUrl("v1.0.4"),
                apk,
                tmp,
                null,
                url -> new FakeConnection(url, 200, null, NativeInteractionsPlugin.MAX_APK_BYTES + 1L) {
                    @Override public InputStream getInputStream() {
                        streamReads.incrementAndGet();
                        return new ByteArrayInputStream(payload);
                    }
                },
                () -> false
            );
            fail("Expected oversized rejection");
        } catch (NativeInteractionsPlugin.UpdateException e) {
            assertEquals(NativeInteractionsPlugin.CODE_DOWNLOAD_FAILED, e.code);
            assertEquals(0, streamReads.get());
        }

        // Empty body
        try {
            NativeInteractionsPlugin.prepareUpdateApk(
                NativeInteractionsPlugin.buildDownloadUrl("v1.0.4"),
                apk,
                tmp,
                null,
                url -> FakeConnection.ok(url, new byte[0]),
                () -> false
            );
            fail("Expected empty body failure");
        } catch (NativeInteractionsPlugin.UpdateException e) {
            assertEquals(NativeInteractionsPlugin.CODE_DOWNLOAD_FAILED, e.code);
        }

        // Stream cap enforcement in streamAndHash
        try {
            NativeInteractionsPlugin.streamAndHash(
                new ByteArrayInputStream(new byte[11]),
                null,
                10L,
                () -> false
            );
            fail("Expected stream limit exception");
        } catch (NativeInteractionsPlugin.UpdateException e) {
            assertEquals(NativeInteractionsPlugin.CODE_DOWNLOAD_FAILED, e.code);
        }
    }

    @Test
    public void installUpdateValidatesInputsAndPreventsConcurrentDownloads() throws Exception {
        File cacheDir = temp.newFolder("cache-plugin");
        ExecutorService ui = Executors.newSingleThreadExecutor();
        CountDownLatch enteredNetwork = new CountDownLatch(1);
        CountDownLatch releaseNetwork = new CountDownLatch(1);

        NativeInteractionsPlugin plugin = new NativeInteractionsPlugin(url -> {
            enteredNetwork.countDown();
            try {
                releaseNetwork.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            return new FakeConnection(url, 404, null, -1L);
        }) {
            @Override protected File getCacheDir() { return cacheDir; }
            @Override protected boolean runOnUiThread(Runnable action) {
                ui.execute(action);
                return true;
            }
        };

        try {
            // Invalid tag & sha256 fail synchronously with INVALID_UPDATE.
            RecordingCall badTag = new RecordingCall(new JSObject().put("tag", "1.0.4"));
            plugin.installUpdate(badTag);
            assertTrue(badTag.awaitSettled(1, TimeUnit.SECONDS));
            assertEquals(NativeInteractionsPlugin.CODE_INVALID_UPDATE, badTag.errorCode);

            RecordingCall badSha = new RecordingCall(new JSObject().put("tag", "v1.0.4").put("sha256", "xyz"));
            plugin.installUpdate(badSha);
            assertTrue(badSha.awaitSettled(1, TimeUnit.SECONDS));
            assertEquals(NativeInteractionsPlugin.CODE_INVALID_UPDATE, badSha.errorCode);

            RecordingCall nonStringSha = new RecordingCall(new JSObject().put("tag", "v1.0.4").put("sha256", 123));
            plugin.installUpdate(nonStringSha);
            assertTrue(nonStringSha.awaitSettled(1, TimeUnit.SECONDS));
            assertEquals(NativeInteractionsPlugin.CODE_INVALID_UPDATE, nonStringSha.errorCode);

            // First valid call enters download; concurrent second call is rejected immediately.
            RecordingCall first = new RecordingCall(new JSObject().put("tag", "v1.0.4").put("sha256", JSONObject.NULL));
            plugin.installUpdate(first);
            assertTrue(enteredNetwork.await(5, TimeUnit.SECONDS));

            RecordingCall duplicate = new RecordingCall(new JSObject().put("tag", "v1.0.4"));
            plugin.installUpdate(duplicate);
            assertTrue(duplicate.awaitSettled(1, TimeUnit.SECONDS));
            assertEquals(NativeInteractionsPlugin.CODE_DOWNLOAD_IN_PROGRESS, duplicate.errorCode);

            releaseNetwork.countDown();
            assertTrue(first.awaitSettled(5, TimeUnit.SECONDS));
            assertEquals(NativeInteractionsPlugin.CODE_DOWNLOAD_FAILED, first.errorCode);

            // After destroy, installUpdate rejects with UNAVAILABLE.
            plugin.handleOnDestroy();
            RecordingCall afterDestroy = new RecordingCall(new JSObject().put("tag", "v1.0.4"));
            plugin.installUpdate(afterDestroy);
            assertTrue(afterDestroy.awaitSettled(1, TimeUnit.SECONDS));
            assertEquals(NativeInteractionsPlugin.CODE_UNAVAILABLE, afterDestroy.errorCode);
        } finally {
            releaseNetwork.countDown();
            plugin.handleOnDestroy();
            ui.shutdownNow();
        }
    }

    private static String sha256Hex(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder sb = new StringBuilder(digest.length * 2);
        for (byte b : digest) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static void writeFile(File file, byte[] bytes) throws IOException {
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
    }

    private static final class RedirectCounterOpener implements NativeInteractionsPlugin.ConnectionOpener {
        private final int redirectCount;
        private final byte[] payload;
        private int count;

        RedirectCounterOpener(int redirectCount, byte[] payload) {
            this.redirectCount = redirectCount;
            this.payload = payload;
        }

        @Override
        public HttpURLConnection open(URL url) {
            int hop = count++;
            if (hop < redirectCount) {
                return FakeConnection.redirect(url, 302, "https://objects.githubusercontent.com/hop/" + (hop + 1));
            }
            return FakeConnection.ok(url, payload);
        }
    }

    private static class FakeConnection extends HttpURLConnection {
        private final int status;
        private final String location;
        private final long contentLength;
        private final byte[] body;
        boolean disconnected;

        FakeConnection(URL url, int status, String location, long contentLength) {
            this(url, status, location, contentLength, new byte[0]);
        }

        FakeConnection(URL url, int status, String location, long contentLength, byte[] body) {
            super(url);
            this.status = status;
            this.location = location;
            this.contentLength = contentLength;
            this.body = body;
        }

        static FakeConnection redirect(URL url, int status, String location) {
            return new FakeConnection(url, status, location, -1L);
        }

        static FakeConnection ok(URL url, byte[] body) {
            return new FakeConnection(url, 200, null, body.length, body);
        }

        @Override public void connect() {}
        @Override public void disconnect() { disconnected = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public int getResponseCode() { return status; }
        @Override public long getContentLengthLong() { return contentLength; }
        @Override public String getHeaderField(String name) {
            return "Location".equalsIgnoreCase(name) ? location : null;
        }
        @Override public InputStream getInputStream() {
            return new ByteArrayInputStream(body);
        }
    }

    private static final class RecordingCall extends PluginCall {
        final CountDownLatch settled = new CountDownLatch(1);
        volatile String errorCode;

        RecordingCall(JSObject data) {
            super(null, "NativeInteractions", "cb", "installUpdate", data);
        }

        @Override public void resolve() { settled.countDown(); }
        @Override public void resolve(JSObject data) { settled.countDown(); }
        @Override public void reject(String msg, String code, Exception ex, JSObject data) {
            errorCode = code;
            settled.countDown();
        }

        boolean awaitSettled(long timeout, TimeUnit unit) throws InterruptedException {
            return settled.await(timeout, unit);
        }
    }
}
