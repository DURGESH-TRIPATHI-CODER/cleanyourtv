package com.gathin.tvhome;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import java.util.Calendar;

final class YouTubeRoutine {
    private static final String ACTION = "com.gathin.tvhome.YOUTUBE_ROUTINE";

    private YouTubeRoutine() {}

    static void schedule(Context context, Config config) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        Intent intent = new Intent(context, Receiver.class).setAction(ACTION);
        PendingIntent operation = PendingIntent.getBroadcast(context, 390, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (!config.youtubeRoutineEnabled || config.youtubeRoutineUrl.isEmpty()) {
            alarms.cancel(operation);
            return;
        }
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, 6);
        next.set(Calendar.MINUTE, 30);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_YEAR, 1);
        alarms.setInexactRepeating(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(),
                AlarmManager.INTERVAL_DAY, operation);
    }

    public static final class Receiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!ACTION.equals(intent.getAction())) return;
            Config config = Config.load(context);
            if (!config.youtubeRoutineEnabled || config.youtubeRoutineUrl.isEmpty()) return;
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(config.youtubeRoutineUrl))
                    .setPackage("com.google.android.youtube.tv")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (view.resolveActivity(context.getPackageManager()) != null) context.startActivity(view);
        }
    }
}
