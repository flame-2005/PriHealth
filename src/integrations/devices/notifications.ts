import { NotificationRelay, type PhoneNotification } from '../../bridge/notificationRelay';
import { devicesRepo } from '../../db/repositories/devicesRepo';
import { connectedIds, driverSessions } from './session';

/**
 * Forwards a phone notification to every connected device whose settings ask for it. Per device:
 * the `notifications` switch, and an optional package allowlist. Nothing is stored; a notification
 * that reaches no device is simply dropped.
 */
export async function forwardNotification(n: PhoneNotification): Promise<number> {
  let sent = 0;
  for (const id of connectedIds()) {
    const session = driverSessions(id).find(s => s.sendNotification);
    if (!session) continue;
    const saved = await devicesRepo.get(id).catch(() => null);
    const settings = saved?.settings ?? {};
    if (!settings.notifications) continue;
    if (settings.notifyApps?.length && !settings.notifyApps.includes(n.package)) continue;
    try {
      await session.sendNotification!({ app: n.package, title: n.title, text: n.text, category: n.category });
      sent++;
    } catch {
      // The device will get the next one; a dropped link is handled by the session.
    }
  }
  return sent;
}

/** Subscribes to the native relay for the life of the app. Returns the unsubscribe. */
export function startNotificationRelay(): () => void {
  const sub = NotificationRelay.addListener(n => {
    forwardNotification(n).catch(() => {});
  });
  return () => sub?.remove();
}
