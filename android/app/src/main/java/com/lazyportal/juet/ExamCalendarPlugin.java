package com.lazyportal.juet;

import android.content.ActivityNotFoundException;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.CalendarContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** User confirms the prefilled event in their calendar app. No calendar permission needed. */
@CapacitorPlugin(name = "ExamCalendar")
public class ExamCalendarPlugin extends Plugin {
    @PluginMethod
    public void insert(PluginCall call) {
        Intent intent = createEventIntent(call);
        if (intent == null) {
            call.reject("Invalid exam times");
            return;
        }
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException exception) {
            call.reject("No calendar app available", exception);
        }
    }

    static Intent createEventIntent(PluginCall call) {
        // JSON integer timestamps larger than 32 bits are Long, not Double.
        Long start = call.getLong("start");
        Long end = call.getLong("end");
        if (start == null || end == null || end <= start) return null;
        return new Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, call.getString("title", "Exam"))
            .putExtra(CalendarContract.Events.EVENT_LOCATION, call.getString("location", ""))
            .putExtra(CalendarContract.Events.DESCRIPTION, call.getString("description", ""))
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start.longValue())
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end.longValue());
    }

    @PluginMethod
    public void exportCalendar(PluginCall call) {
        String content = call.getString("content");
        if (content == null || content.isEmpty()) {
            call.reject("No calendar to export");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("text/calendar")
            .putExtra(Intent.EXTRA_TITLE, "exams.ics");
        try {
            startActivityForResult(call, intent, "saveCalendar");
        } catch (ActivityNotFoundException exception) {
            call.reject("No file picker available", exception);
        }
    }

    @ActivityCallback
    protected void saveCalendar(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        String content = call.getString("content");
        if (result.getResultCode() != Activity.RESULT_OK || uri == null || content == null) {
            call.reject("No file selected");
            return;
        }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
            if (output == null) throw new IOException("Cannot open calendar file");
            output.write(content.getBytes(StandardCharsets.UTF_8));
        } catch (IOException | SecurityException exception) {
            call.reject("Could not save calendar file", exception);
            return;
        }
        call.resolve();
    }
}
