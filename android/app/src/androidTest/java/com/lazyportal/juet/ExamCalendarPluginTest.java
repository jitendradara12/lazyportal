package com.lazyportal.juet;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.CalendarContract;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs on Android so JSON number types, intent extras and file writes are real. */
@RunWith(AndroidJUnit4.class)
public class ExamCalendarPluginTest {
    private static final String CALENDAR = "BEGIN:VCALENDAR\r\nSUMMARY:数学\r\nEND:VCALENDAR\r\n";

    private static class Call extends PluginCall {
        boolean resolved;
        JSObject result;
        String error;

        Call(JSObject data) { super(null, "ExamCalendar", "1", "test", data); }
        @Override public void resolve() { resolved = true; }
        @Override public void resolve(JSObject value) { resolved = true; result = value; }
        @Override public void reject(String message) { error = message; }
        @Override public void reject(String message, Exception exception) { error = message; }
    }

    private static class TestPlugin extends ExamCalendarPlugin {
        Intent picker;
        String callback;
        @Override public Context getContext() {
            return InstrumentationRegistry.getInstrumentation().getTargetContext();
        }
        @Override public void startActivityForResult(PluginCall call, Intent intent, String callbackName) {
            picker = intent;
            callback = callbackName;
        }
    }

    @Test
    public void integerJsonTimestampsBecomeCalendarLongExtras() throws Exception {
        // Match JSON.stringify() output from the actual web-to-native bridge.
        JSObject data = new JSObject("{\"start\":1792728000000,\"end\":1792738800000,\"title\":\"Math\",\"location\":\"LT3-B5\"}");
        assertTrue(data.get("start") instanceof Long);
        Intent intent = ExamCalendarPlugin.createEventIntent(new Call(data));
        assertNotNull(intent);
        assertEquals(Intent.ACTION_INSERT, intent.getAction());
        assertEquals(CalendarContract.Events.CONTENT_URI, intent.getData());
        assertEquals(1792728000000L, intent.getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, -1));
        assertEquals(1792738800000L, intent.getLongExtra(CalendarContract.EXTRA_EVENT_END_TIME, -1));
        assertEquals("Math", intent.getStringExtra(CalendarContract.Events.TITLE));
        assertEquals("LT3-B5", intent.getStringExtra(CalendarContract.Events.EVENT_LOCATION));
    }

    @Test
    public void invalidTimesAreRejectedWithoutLaunchingCalendar() throws Exception {
        for (String json : new String[] {"{}", "{\"start\":1792728000000}", "{\"start\":1792728000000,\"end\":1792728000000}"}) {
            Call call = new Call(new JSObject(json));
            new TestPlugin().insert(call);
            assertEquals("Invalid exam times", call.error);
            assertFalse(call.resolved);
        }
    }

    @Test
    public void exportUsesSystemDocumentPickerAndWritesUtf8() throws Exception {
        TestPlugin plugin = new TestPlugin();
        Call call = new Call(new JSObject().put("content", CALENDAR));
        plugin.exportCalendar(call);
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, plugin.picker.getAction());
        assertTrue(plugin.picker.hasCategory(Intent.CATEGORY_OPENABLE));
        assertEquals("text/calendar", plugin.picker.getType());
        assertEquals("exams.ics", plugin.picker.getStringExtra(Intent.EXTRA_TITLE));
        assertEquals("saveCalendar", plugin.callback);
        assertFalse(call.resolved);
        File file = File.createTempFile("exam-calendar-", ".ics", plugin.getContext().getCacheDir());
        try {
            Uri uri = FileProvider.getUriForFile(plugin.getContext(), "com.lazyportal.juet.fileprovider", file);
            plugin.saveCalendar(call, new ActivityResult(Activity.RESULT_OK, new Intent().setData(uri)));
            assertNull(call.error);
            assertTrue(call.resolved);
            assertEquals(CALENDAR, new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        } finally { file.delete(); }
    }

    @Test
    public void cancelledSaveIsSuccessfulWithoutWriting() {
        Call call = new Call(new JSObject().put("content", CALENDAR));
        new TestPlugin().saveCalendar(call, new ActivityResult(Activity.RESULT_CANCELED, null));
        assertTrue(call.resolved);
        assertTrue(call.result.getBoolean("cancelled", false));
        assertNull(call.error);
    }

    @Test
    public void failedSaveRejectsAndDoesNotReportSuccess() {
        Call call = new Call(new JSObject().put("content", CALENDAR));
        new TestPlugin().saveCalendar(call, new ActivityResult(Activity.RESULT_OK, new Intent().setData(Uri.parse("content://missing-provider/exams.ics"))));
        assertEquals("Could not save calendar file", call.error);
        assertFalse(call.resolved);
    }
}
