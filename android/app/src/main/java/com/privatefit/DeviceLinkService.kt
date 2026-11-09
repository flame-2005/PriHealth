package com.privatefit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Keeps the app process alive while a device is linked, so a watch keeps its connection, its
 * overnight sleep arrives on the morning sync and phone notifications reach it with the app
 * closed. A foreground service of the "connected device" type with a persistent notification; it
 * runs the JS headless task "DeviceLink", which restores the auto-connect devices after the
 * system restarts the service and ends when none are linked, which stops the service.
 */
class DeviceLinkService : HeadlessJsTaskService() {

  companion object {
    const val CHANNEL_ID = "device_link"
    const val NOTIFICATION_ID = 41
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    @Volatile var running = false
      private set

    fun start(ctx: Context, title: String, text: String) {
      val intent = Intent(ctx, DeviceLinkService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_TEXT, text)
      ContextCompat.startForegroundService(ctx, intent)
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, DeviceLinkService::class.java))
    }

    fun update(ctx: Context, title: String, text: String) {
      if (!running) return
      val manager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(NOTIFICATION_ID, buildNotification(ctx, title, text))
    }

    fun buildNotification(ctx: Context, title: String, text: String): Notification {
      val manager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(CHANNEL_ID, "Device link", NotificationManager.IMPORTANCE_LOW)
        channel.description = "Shown while a watch, band or ring stays connected."
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
      }
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      val pending = launch?.let {
        PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      }
      return NotificationCompat.Builder(ctx, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .apply { if (pending != null) setContentIntent(pending) }
        .build()
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "PrivateFit"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Keeping your device connected"
    try {
      // Android 14+ refuses this type unless a Bluetooth runtime permission is granted; JS checks first.
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(this, title, text), type)
      running = true
    } catch (e: Exception) {
      running = false
      stopSelf()
      return START_NOT_STICKY
    }
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    // No timeout: the task ends on its own once no device is linked. Allowed in the foreground so
    // the service can start from the Devices screen while the app is open.
    return HeadlessJsTaskConfig("DeviceLink", Arguments.createMap(), 0, true)
  }

  override fun onDestroy() {
    running = false
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
