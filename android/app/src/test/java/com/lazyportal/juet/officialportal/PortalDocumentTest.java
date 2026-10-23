package com.lazyportal.juet.officialportal;

import static org.junit.Assert.*;

import java.io.IOException;
import org.junit.Test;

public class PortalDocumentTest {
    @Test public void portalViewportCannotOverrideTheSmallerZoomOrDisablePinch() throws Exception {
        for (String viewport : new String[] {
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,user-scalable=no\">",
            "<META content='initial-scale=1,maximum-scale=1' NAME='VIEWPORT' />",
            "<meta name=viewport content='initial-scale=1'>",
        }) {
            String html = PortalTransport.prepareDocument("<head>" + viewport + "<script src='main.js'></script></head><body>Portal</body>", "window.ready=true;");
            assertEquals(1, html.split("name=\"viewport\"", -1).length - 1);
            assertTrue(html.contains("initial-scale=0.6"));
            assertTrue(html.contains("minimum-scale=0.25, maximum-scale=3, user-scalable=yes"));
            assertFalse(html.contains("initial-scale=1"));
            assertFalse(html.contains("user-scalable=no"));
            assertTrue(html.indexOf("initial-scale=0.6") < html.indexOf("window.ready=true"));
            assertTrue(html.indexOf("window.ready=true") < html.indexOf("src='main.js'"));
            assertTrue(html.endsWith("<body>Portal</body>"));
        }
    }
    @Test public void missingViewportGetsInsertedAndOtherMetadataSurvives() throws Exception {
        String original = "<html><head lang='en'><meta data-name='viewport' content='keep-me'><meta name='robots' content='noindex'></head></html>";
        String html = PortalTransport.prepareDocument(original, "");
        assertTrue(html.contains("initial-scale=0.6"));
        assertTrue(html.contains("data-name='viewport' content='keep-me'"));
        assertTrue(html.contains("name='robots' content='noindex'"));
        assertThrows(IOException.class, () -> PortalTransport.prepareDocument("<body>No head</body>", ""));
    }
}
