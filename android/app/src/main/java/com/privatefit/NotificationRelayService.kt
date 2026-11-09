package com.privatefit

import android.app.Notification
import android.os.Bundle
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Hands the phone's notifications to JS so they can be forwarded to a watch. Only runs once the
 * user grants notification access in Android settings. Nothing is stored: each notification is
 * passed on once, in memory, and dropped. Ongoing, group-summary and our own notifications are
 * ignored, as is anything with no title or text.
 */
class NotificationRelayService : NotificationListenerService() {

  override fun onListenerConnected() {
    NotificationRelayBus.connected = true
  }

  override fun onListenerDisconnected() {
    NotificationRelayBus.connected = false
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.packageName == packageName) return
    val n = sbn.notification ?: return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    if (sbn.isOngoing) return
    val extras: Bundle = n.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
    val text = (extras.getCharSequence(Notification.EXTRA_TEXT) ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT))
      ?.toString()?.trim() ?: ""
    if (title.isEmpty() && text.isEmpty()) return
    val pkg = sbn.packageName
    val category = when {
      n.category == Notification.CATEGORY_CALL -> "call"
      pkg == Telephony.Sms.getDefaultSmsPackage(this) -> "sms"
      pkg.contains("whatsapp") -> "whatsapp"
      else -> "other"
    }
    NotificationRelayBus.post(NotificationRelayBus.Event(pkg, title, text, category, sbn.postTime))
  }
}

/** The one place the listener service and the React module meet; the module subscribes, the service posts. */
object NotificationRelayBus {
  data class Event(val pkg: String, val title: String, val text: String, val category: String, val whenMs: Long)

  @Volatile var connected = false
  @Volatile var listener: ((Event) -> Unit)? = null

  fun post(e: Event) {
    listener?.invoke(e)
  }
}
