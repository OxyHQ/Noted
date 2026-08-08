package so.oxy.noted.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Holds the microphone while Noted is in the background.
 *
 * The service does not record anything itself — expo-audio owns the recorder.
 * Its whole job is to exist, typed `microphone`, so Android lets that recorder
 * keep running once the app is no longer on screen. Since Android 14 a
 * background process without one is denied the microphone silently: the stream
 * simply goes quiet, and the recording ends up a fraction of the meeting.
 */
class NotedCaptureService : Service() {

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"

    private const val CHANNEL_ID = "noted.capture"
    private const val NOTIFICATION_ID = 1_001

    /** Set from the service's own lifecycle so JS can ask without binding. */
    @Volatile
    var isRunning: Boolean = false
      private set
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Recording"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: "Noted is recording audio"

    createChannel()

    // The type must be passed here AND declared in the manifest. Android 14+
    // throws MissingForegroundServiceTypeException when the manifest omits it,
    // which is a crash at the moment the user starts recording.
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      buildNotification(title, body),
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      } else {
        0
      },
    )
    isRunning = true

    // START_NOT_STICKY: if Android kills this service, the recorder it was
    // protecting is gone too. Restarting an empty service would leave a
    // notification claiming a recording that is not happening — the app
    // recovers the capture from its own database instead.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    super.onDestroy()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "Recording",
        // LOW: the notification must be present and visible, but a recording
        // the user started deliberately should not also make a sound.
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Shown while Noted is recording audio"
        setShowBadge(false)
      },
    )
  }

  private fun buildNotification(title: String, body: String): Notification {
    // Tapping it returns to the app, which is where the stop control lives.
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      // A recording the user cannot see is one they cannot stop.
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(contentIntent)
      .build()
  }
}
