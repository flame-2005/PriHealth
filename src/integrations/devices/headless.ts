import { hasPendingLinks, restoreAutoConnect } from './session';

const IDLE_POLL_MS = 30_000;

/**
 * The "DeviceLink" headless task that the foreground service runs. It brings back the auto-connect
 * devices (a no-op when the app is open and they are already linked) and then stays alive while
 * any device is linked or trying to reconnect; resolving ends the task and stops the service.
 */
export async function deviceLinkTask(): Promise<void> {
  await restoreAutoConnect().catch(() => {});
  await new Promise<void>(resolve => {
    const tick = () => {
      if (!hasPendingLinks()) resolve();
      else setTimeout(tick, IDLE_POLL_MS);
    };
    setTimeout(tick, IDLE_POLL_MS);
  });
}
