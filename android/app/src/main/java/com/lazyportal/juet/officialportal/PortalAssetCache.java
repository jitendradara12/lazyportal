package com.lazyportal.juet.officialportal;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;

/** Private, bounded cache for public content-hashed JS/CSS only. HTML, API
 * responses, student data, fonts and unversioned files never enter this cache.
 * A partial download is never published as a complete resource. */
public final class PortalAssetCache {
    private final File directory;
    private final long limit;
    public PortalAssetCache(File cacheDirectory) { this(cacheDirectory, 32L * 1024 * 1024); }
    PortalAssetCache(File cacheDirectory, long limit) {
        directory = new File(cacheDirectory, "official-portal-assets-v1"); this.limit = limit;
        directory.mkdirs();
        File[] abandoned = directory.listFiles((dir, name) -> name.endsWith(".tmp"));
        if (abandoned != null) for (File file : abandoned) file.delete();
    }
    private File file(URL url) {
        if (url.getQuery() != null || !url.getPath().matches(".*/[^/]+\\.[a-f0-9]{8,}\\.(?:js|css)")) return null;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(url.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder name = new StringBuilder();
            for (byte value : digest) name.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
            return new File(directory, name + (url.getPath().endsWith(".js") ? ".js" : ".css"));
        } catch (Exception ignored) { return null; }
    }
    public synchronized InputStream get(URL url) {
        File cached = file(url);
        try {
            if (cached == null || !cached.isFile()) return null;
            InputStream input = new FileInputStream(cached); cached.setLastModified(System.currentTimeMillis()); return input;
        } catch (IOException ignored) { return null; }
    }
    public InputStream store(URL url, String mime, InputStream input) {
        File destination = file(url);
        if (destination == null || !(mime.equals("application/javascript") || mime.equals("text/javascript") || mime.equals("text/css"))) return input;
        try {
            File temporary = File.createTempFile("download-", ".tmp", directory);
            return new FilterInputStream(input) {
                private FileOutputStream output = new FileOutputStream(temporary);
                private long bytes;
                private boolean complete;
                private void accept(byte[] buffer, int offset, int count) {
                    if (output == null) return;
                    try {
                        if (count == -1) {
                            output.close(); output = null; complete = true; publish(temporary, destination);
                        } else {
                            bytes += count;
                            if (bytes > limit) { discard(); return; }
                            output.write(buffer, offset, count);
                        }
                    } catch (IOException ignored) { discard(); }
                }
                @Override public int read() throws IOException {
                    byte[] single = new byte[1]; int count = read(single, 0, 1); return count == -1 ? -1 : single[0] & 255;
                }
                @Override public int read(byte[] buffer, int offset, int count) throws IOException {
                    try { int size = in.read(buffer, offset, count); accept(buffer, offset, size); return size; }
                    catch (IOException error) { discard(); throw error; }
                }
                private void discard() {
                    if (output != null) { try { output.close(); } catch (IOException ignored) {} output = null; }
                    temporary.delete();
                }
                @Override public void close() throws IOException {
                    try { super.close(); } finally { if (!complete) discard(); }
                }
            };
        } catch (IOException ignored) { return input; }
    }
    private synchronized void publish(File temporary, File destination) {
        if (destination.isFile()) temporary.delete();
        else if (!temporary.renameTo(destination)) { temporary.delete(); return; }
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".js") || name.endsWith(".css"));
        if (files == null) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        long size = 0;
        for (File file : files) size += file.length();
        for (File file : files) { if (size <= limit) break; long bytes = file.length(); if (file.delete()) size -= bytes; }
    }
}
