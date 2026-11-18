package com.lazyportal.juet;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Topic-only campus alert opt-in and notification tap routing. */
@CapacitorPlugin(
    name = "Alerts",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class AlertsPlugin extends Plugin {
    static final String TOPIC_ALERTS = "alerts";
    static final String CHANNEL_ID = "alerts";
    static final String PREFS_NAME = "juet_alerts_prefs";
    static final String KEY_MUTED = "muted";
    static final String KEY_PERMANENTLY_DENIED = "permanently_denied";

    static final String EXTRA_TAB = "tab";
    static final String EXTRA_MODE = "mode";
    static final String EXTRA_REFRESH = "refresh";

    private static final Set<String> VALID_TABS = new HashSet<>(
        Arrays.asList("attendance", "marks", "exams", "calendar", "more")
    );
    private static final Set<String> VALID_MODES = new HashSet<>(
        Arrays.asList("marks", "cgpa")
    );

    private JSObject pendingAction;

    @Override
    public void load() {
        Context context = getContext();
        ensureNotificationChannel(context);
        if (isFirebaseConfigured(context) && !isMuted(context) && hasPostNotificationsPermission(context)) {
            FirebaseMessaging.getInstance().subscribeToTopic(TOPIC_ALERTS);
        }
        Activity activity = getActivity();
        if (activity != null) {
            captureNotificationIntent(activity.getIntent(), false);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        captureNotificationIntent(intent, true);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context context = getContext();
        boolean configured = isFirebaseConfigured(context);
        String permission = resolvePermissionStatus();
        boolean muted = isMuted(context);
        if (configured && !muted && "granted".equals(permission)) {
            FirebaseMessaging.getInstance().subscribeToTopic(TOPIC_ALERTS);
        }
        call.resolve(buildStatus(configured, muted, permission));
    }

    @PluginMethod
    public void setMuted(PluginCall call) {
        Context context = getContext();
        if (!isFirebaseConfigured(context)) {
            call.reject("Notifications are not configured in this build", "UNAVAILABLE");
            return;
        }
        boolean wantMuted = Boolean.TRUE.equals(call.getBoolean("muted", false));
        if (wantMuted) {
            FirebaseMessaging.getInstance().unsubscribeFromTopic(TOPIC_ALERTS).addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    call.reject("Could not mute alerts. Please try again.");
                    return;
                }
                setMutedPref(context, true);
                call.resolve(buildStatus(true, true, resolvePermissionStatus()));
            });
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (!hasPostNotificationsPermission(context)) {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    requestPermissionForAlias("notifications", call, "onNotificationPermissionResult");
                } else {
                    setMutedPref(context, false);
                    call.resolve(buildStatus(true, false, "denied"));
                }
                return;
            }
        } else if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            setMutedPref(context, false);
            call.resolve(buildStatus(true, false, "denied"));
            return;
        }

        subscribeToAlerts(call);
    }

    @PermissionCallback
    private void onNotificationPermissionResult(PluginCall call) {
        if (call == null) return;
        Context context = getContext();
        if (hasPostNotificationsPermission(context)) {
            setPermanentlyDenied(context, false);
            subscribeToAlerts(call);
            return;
        }
        Activity activity = getActivity();
        boolean permanentlyDenied = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && activity != null
            && !ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.POST_NOTIFICATIONS);
        setPermanentlyDenied(context, permanentlyDenied);
        call.resolve(buildStatus(true, isMuted(context), resolvePermissionStatus()));
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Settings unavailable");
            return;
        }
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", activity.getPackageName(), null));
        }
        try {
            activity.startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (ActivityNotFoundException e) {
            call.reject("Could not open notification settings", e);
        }
    }

    @PluginMethod
    public void consumePendingAction(PluginCall call) {
        JSObject action = pendingAction;
        pendingAction = null;
        if (action == null) {
            call.resolve(new JSObject());
            return;
        }
        call.resolve(new JSObject().put("action", action));
    }

    private void subscribeToAlerts(PluginCall call) {
        Context context = getContext();
        ensureNotificationChannel(context);
        FirebaseMessaging.getInstance().subscribeToTopic(TOPIC_ALERTS).addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                call.reject("Could not resume alerts. Check your connection and try again.");
                return;
            }
            setMutedPref(context, false);
            call.resolve(buildStatus(true, false, "granted"));
        });
    }

    private void captureNotificationIntent(Intent intent, boolean notify) {
        JSObject action = parseNotificationIntent(intent);
        if (action == null) return;
        clearNotificationExtras(intent);
        if (notify && hasListeners("notificationAction")) {
            pendingAction = null;
            notifyListeners("notificationAction", action);
        } else {
            pendingAction = action;
        }
    }

    private String resolvePermissionStatus() {
        Context context = getContext();
        if (context == null) return "denied";
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return NotificationManagerCompat.from(context).areNotificationsEnabled() ? "granted" : "denied";
        }
        if (hasPostNotificationsPermission(context)) {
            setPermanentlyDenied(context, false);
            return "granted";
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            // Granted runtime permission, but app-level notifications are turned off in OS Settings.
            return "denied";
        }
        Activity activity = getActivity();
        if (isPermanentlyDenied(context)
                && activity != null
                && !ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.POST_NOTIFICATIONS)) {
            return "denied";
        }
        return "prompt";
    }

    private static boolean hasPostNotificationsPermission(Context context) {
        if (context == null) return false;
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
    }

    private static JSObject buildStatus(boolean supported, boolean muted, String permission) {
        boolean enabled = supported && !muted && "granted".equals(permission);
        return new JSObject()
            .put("supported", supported)
            .put("muted", muted)
            .put("enabled", enabled)
            .put("permission", permission);
    }

    static boolean isFirebaseConfigured(Context context) {
        if (context == null) return false;
        try {
            if (!FirebaseApp.getApps(context).isEmpty()) return true;
            return FirebaseApp.initializeApp(context) != null;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    static void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context == null) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        String name = context.getString(R.string.default_notification_channel_name);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Marks, SGPA, exam schedules, and important updates");
        manager.createNotificationChannel(channel);
    }

    static boolean isMuted(Context context) {
        if (context == null) return false;
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(KEY_MUTED, false);
    }

    static void setMutedPref(Context context, boolean muted) {
        if (context == null) return;
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_MUTED, muted)
            .apply();
    }

    private static boolean isPermanentlyDenied(Context context) {
        if (context == null) return false;
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(KEY_PERMANENTLY_DENIED, false);
    }

    private static void setPermanentlyDenied(Context context, boolean denied) {
        if (context == null) return;
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_PERMANENTLY_DENIED, denied)
            .apply();
    }

    static JSObject parseNotificationIntent(Intent intent) {
        if (intent == null) return null;
        return parseNotificationPayload(
            intent.getStringExtra(EXTRA_TAB),
            intent.getStringExtra(EXTRA_MODE),
            intent.getStringExtra(EXTRA_REFRESH)
        );
    }

    static JSObject parseNotificationPayload(String rawTab, String rawMode, String rawRefresh) {
        String cleanTab = trimOrNull(rawTab);
        String cleanMode = trimOrNull(rawMode);
        String cleanRefresh = trimOrNull(rawRefresh);

        String tab = cleanTab != null && VALID_TABS.contains(cleanTab) ? cleanTab : null;
        String mode = cleanMode != null && VALID_MODES.contains(cleanMode) ? cleanMode : null;
        if (tab == null && mode != null) {
            tab = "marks";
        }
        boolean refresh = "1".equals(cleanRefresh) || "true".equalsIgnoreCase(cleanRefresh);
        if (tab == null && !refresh) {
            return null;
        }
        JSObject action = new JSObject();
        if (tab != null) action.put("tab", tab);
        if (mode != null) action.put("mode", mode);
        if (refresh) action.put("refresh", true);
        return action;
    }

    static void clearNotificationExtras(Intent intent) {
        if (intent == null) return;
        intent.removeExtra(EXTRA_TAB);
        intent.removeExtra(EXTRA_MODE);
        intent.removeExtra(EXTRA_REFRESH);
    }

    private static String trimOrNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
