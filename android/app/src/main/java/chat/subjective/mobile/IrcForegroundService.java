package chat.subjective.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class IrcForegroundService extends Service {
    private static final String CHANNEL_ID = "subjective_connection";
    private static final int NOTIFICATION_ID = 2201;
    private static final String ACTION_START = "chat.subjective.mobile.START";
    private static final String ACTION_STOP = "chat.subjective.mobile.STOP";

    public static void start(Context context, String title, String text) {
        Intent intent = new Intent(context, IrcForegroundService.class);
        intent.setAction(ACTION_START);
        intent.putExtra("title", title);
        intent.putExtra("text", text);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, IrcForegroundService.class);
        intent.setAction(ACTION_STOP);
        context.stopService(intent);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        createChannel();
        String title = intent == null ? "Subjective IRC" : intent.getStringExtra("title");
        String text = intent == null ? "Keeping IRC connection alive" : intent.getStringExtra("text");
        if (title == null || title.trim().isEmpty()) title = "Subjective IRC";
        if (text == null || text.trim().isEmpty()) text = "Connected";
        Notification notification = buildNotification(title, text);
        startForeground(NOTIFICATION_ID, notification);
        return START_STICKY;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "IRC connection",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps the IRC connection active");
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String title, String text) {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }
}
