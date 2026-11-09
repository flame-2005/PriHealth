package com.privatefit

import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * JS side of the notification relay: whether access is granted, the system page to grant it, and
 * the "PfNotification" events. The listener itself is [NotificationRelayService].
 */
class NotificationRelayModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "NotificationRelayModule"

  override fun initialize() {
    super.initialize()
    NotificationRelayBus.listener = { e ->
      if (ctx.hasActiveReactInstance()) {
        val map = Arguments.createMap()
        map.putString("package", e.pkg)
        map.putString("title", e.title)
        map.putString("text", e.text)
        map.putString("category", e.category)
        map.putDouble("whenMs", e.whenMs.toDouble())
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("PfNotification", map)
      }
    }
    // After an update the system can leave the listener unbound even though access is granted.
    if (isGranted() && !NotificationRelayBus.connected) requestRebind()
  }

  override fun invalidate() {
    NotificationRelayBus.listener = null
    super.invalidate()
  }

  private fun isGranted(): Boolean =
    NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

  private fun requestRebind() {
    try {
      NotificationListenerService.requestRebind(ComponentName(ctx, NotificationRelayService::class.java))
    } catch (e: Exception) {
      // Best effort; the user can toggle access off and on.
    }
  }

  @ReactMethod
  fun isEnabled(promise: Promise) {
    promise.resolve(isGranted())
  }

  /** Opens the system page for this app's notification access (the list on older versions). */
  @ReactMethod
  fun openSettings() {
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(
        Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
        ComponentName(ctx, NotificationRelayService::class.java).flattenToString(),
      )
    } else {
      Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      ctx.startActivity(intent)
    } catch (e: Exception) {
      ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  @ReactMethod
  fun rebind() {
    requestRebind()
  }

  // Required by NativeEventEmitter on the JS side.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}
