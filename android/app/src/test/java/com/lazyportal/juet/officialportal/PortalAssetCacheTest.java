package com.lazyportal.juet.officialportal;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class PortalAssetCacheTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private URL url(String file) throws Exception { return new URL("https://portal.example/studentportal/" + file); }
    private void cache(PortalAssetCache cache, URL url, byte[] bytes) throws Exception {
        try (InputStream stream = cache.store(url, "application/javascript", new ByteArrayInputStream(bytes))) {
            while (stream.read() != -1) {}
        }
    }
    @Test public void completeHashedAssetsSurviveReopeningButStudentDataNeverCaches() throws Exception {
        PortalAssetCache cache = new PortalAssetCache(temporary.getRoot());
        cache(cache, url("main.abcdef0123456789.js"), new byte[] { 1, 2, 3 });
        PortalAssetCache reopened = new PortalAssetCache(temporary.getRoot());
        try (InputStream result = reopened.get(url("main.abcdef0123456789.js"))) {
            assertNotNull(result); assertArrayEquals(new byte[] { 1, 2, 3 }, result.readAllBytes());
        }
        for (String path : new String[] { "index.html", "main.js", "response.abcdef0123456789.json", "main.abcdef0123456789.js?token=secret" }) {
            cache(cache, url(path), new byte[] { 9 }); assertNull(cache.get(url(path)));
        }
        // A login/error page under a JS filename is not a static asset.
        try (InputStream stream = cache.store(url("error.abcdef0123456789.js"), "text/html", new ByteArrayInputStream(new byte[] { 9 }))) {
            stream.readAllBytes();
        }
        assertNull(cache.get(url("error.abcdef0123456789.js")));
    }
    @Test public void cancelledFailedAndOversizedDownloadsNeverPublishPartialFiles() throws Exception {
        PortalAssetCache cache = new PortalAssetCache(temporary.getRoot(), 4);
        URL partial = url("partial.abcdef0123456789.js");
        try (InputStream stream = cache.store(partial, "application/javascript", new ByteArrayInputStream(new byte[] { 1, 2, 3 }))) { stream.read(); }
        assertNull(cache.get(partial));
        URL broken = url("broken.abcdef0123456789.js");
        try (InputStream stream = cache.store(broken, "application/javascript", new InputStream() {
            @Override public int read() throws IOException { throw new IOException("Disconnected"); }
        })) { assertThrows(IOException.class, stream::read); }
        assertNull(cache.get(broken));
        URL oversized = url("large.abcdef0123456789.js");
        cache(cache, oversized, new byte[5]); assertNull(cache.get(oversized));
    }
    @Test public void cacheEvictsOldPublicAssetsToStayWithinItsLimit() throws Exception {
        PortalAssetCache cache = new PortalAssetCache(temporary.getRoot(), 5);
        URL first = url("first.abcdef0123456789.js"), second = url("second.abcdef0123456789.js");
        cache(cache, first, new byte[3]); cache(cache, second, new byte[3]);
        int available = 0;
        for (URL url : new URL[] { first, second }) {
            try (InputStream stream = cache.get(url)) { if (stream != null) available++; }
        }
        assertEquals(1, available);
    }
}
