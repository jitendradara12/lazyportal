package com.lazyportal.juet;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** Displays foreground topic broadcasts and refreshes topic subscription on token rotation. */
public class AlertsMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        if (!AlertsPlugin.isMuted(this) && AlertsPlugin.isFirebaseConfigured(this)) {
            FirebaseMessaging.getInstance().subscribeToTopic(AlertsPlugin.TOPIC_ALERTS);
        }
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        RemoteMessage.Notification notification = remoteMessage.getNotification();

        String title = resolveMessageField(
            notification != null ? notification.getTitle() : null,
            data != null ? data.get("title") : null
        );
        String body = resolveMessageField(
            notification != null ? notification.getBody() : null,
            data != null ? data.get("body") : null
        );

        if (title == null && body == null) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        AlertsPlugin.ensureNotificationChannel(this);

        Intent launchIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        copyExtra(launchIntent, data, AlertsPlugin.EXTRA_TAB);
        copyExtra(launchIntent, data, AlertsPlugin.EXTRA_MODE);
        copyExtra(launchIntent, data, AlertsPlugin.EXTRA_REFRESH);

        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            (int) (System.currentTimeMillis() & 0x7fffffff),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, AlertsPlugin.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(this, R.color.notification_accent))
            .setContentTitle(title != null && !title.isEmpty() ? title : getString(R.string.app_name))
            .setContentText(body != null ? body : "")
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(contentIntent);

        if (body != null && body.length() > 40) {
            builder.setStyle(new NotificationCompat.BigTextStyle().bigText(body));
        }

        NotificationManagerCompat.from(this).notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
    }

    static String resolveMessageField(String primary, String fallback) {
        if (primary != null && !primary.trim().isEmpty()) return primary.trim();
        if (fallback != null && !fallback.trim().isEmpty()) return fallback.trim();
        return null;
    }

    private static void copyExtra(Intent intent, Map<String, String> data, String key) {
        if (data == null) return;
        String value = data.get(key);
        if (value != null && !value.trim().isEmpty()) {
            intent.putExtra(key, value.trim());
        }
    }
}
