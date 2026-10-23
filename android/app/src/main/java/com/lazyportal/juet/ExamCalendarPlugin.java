package com.lazyportal.juet;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.provider.CalendarContract;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** User confirms the prefilled event in their calendar app. No calendar permission needed. */
@CapacitorPlugin(name = "ExamCalendar")
public class ExamCalendarPlugin extends Plugin {
    @PluginMethod
    public void insert(PluginCall call) {
        Double start = call.getDouble("start");
        Double end = call.getDouble("end");
        if (start == null || end == null || end <= start) {
            call.reject("Invalid exam times");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, call.getString("title", "Exam"))
            .putExtra(CalendarContract.Events.EVENT_LOCATION, call.getString("location", ""))
            .putExtra(CalendarContract.Events.DESCRIPTION, call.getString("description", ""))
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start.longValue())
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end.longValue());
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException exception) {
            call.reject("No calendar app available", exception);
        }
    }
}
