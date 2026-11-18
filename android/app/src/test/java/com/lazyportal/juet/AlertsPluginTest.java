package com.lazyportal.juet;

import static org.junit.Assert.*;

import com.getcapacitor.JSObject;
import org.junit.Test;

public class AlertsPluginTest {
    @Test
    public void parsesValidTabModeAndRefreshExtras() throws Exception {
        JSObject action = AlertsPlugin.parseNotificationPayload("marks", "cgpa", "1");
        assertNotNull(action);
        assertEquals("marks", action.getString("tab"));
        assertEquals("cgpa", action.getString("mode"));
        assertTrue(action.getBoolean("refresh"));
    }

    @Test
    public void infersMarksTabFromValidMode() throws Exception {
        JSObject action = AlertsPlugin.parseNotificationPayload(null, "cgpa", "true");
        assertNotNull(action);
        assertEquals("marks", action.getString("tab"));
        assertEquals("cgpa", action.getString("mode"));
        assertTrue(action.getBoolean("refresh"));
    }

    @Test
    public void rejectsUnknownTabsAndModes() throws Exception {
        assertNull(AlertsPlugin.parseNotificationPayload("https://evil.example", "evil", "0"));
        JSObject refreshOnly = AlertsPlugin.parseNotificationPayload("unknown", "other", "1");
        assertNotNull(refreshOnly);
        assertFalse(refreshOnly.has("tab"));
        assertFalse(refreshOnly.has("mode"));
        assertTrue(refreshOnly.getBoolean("refresh"));
    }

    @Test
    public void returnsNullForNullIntentOrEmptyPayload() {
        assertNull(AlertsPlugin.parseNotificationIntent(null));
        assertNull(AlertsPlugin.parseNotificationPayload("  ", "", "false"));
    }

    @Test
    public void firebaseConfiguredIsFalseWithoutContext() {
        assertFalse(AlertsPlugin.isFirebaseConfigured(null));
    }

    @Test
    public void resolvesForegroundMessageFieldsWithFallback() {
        assertEquals("Marks Out", AlertsMessagingService.resolveMessageField("Marks Out", "Fallback"));
        assertEquals("Fallback", AlertsMessagingService.resolveMessageField("  ", " Fallback "));
        assertNull(AlertsMessagingService.resolveMessageField(null, "   "));
    }
}
