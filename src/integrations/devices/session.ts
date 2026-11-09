import { bodyRepo } from '../../db/repositories/bodyRepo';
import { devicesRepo } from '../../db/repositories/devicesRepo';
import { samplesRepo } from '../../db/repositories/samplesRepo';
import { isLiveHr } from '../../domain/heartRate';
import { rankOf } from '../../domain/sources';
import { dayKey } from '../../domain/time';
import type { DeviceForm } from '../../domain/devices';
import { useAppStore, type LiveHr, type LiveSteps } from '../../store/useAppStore';
import { heartRateLogger } from '../../tracking/heartRateLog';
import { currentRanking } from '../../tracking/sourcePolicy';
import { recordWatchSteps } from '../../tracking/watchSteps';
import { DeviceLink } from '../../bridge/deviceLink';
import { connect as bleConnect, disconnect as bleDisconnect, hasBlePermissions, isBluetoothOn } from '../ble/manager';
import './drivers';
import { createBleLink, readDeviceInfo, type GattLink, type TranscriptEntry } from './link';
import { detect } from './registry';
import { scheduleBump, writeRecords } from './sync';
import type { DeviceEvent, DeviceInfo, DriverContext, DriverSession, UserProfile } from './types';

/**
 * Owns every Bluetooth connection so they outlive screens. Each connected device runs the
 * handlers the registry picked for it; their events land here, where the headline live values
 * (store.liveHr, store.liveSteps) follow the device the source policy ranks first, readings are
 * logged, and history goes through `sync.ts`.
 */
export const MAX_LINKS = 4;
const BATTERY_POLL_MS = 10 * 60_000;
const SYNC_EVERY_MS = 30 * 60_000;
/** Writes at most every few seconds: a watch repeats its total every second or so, and most are no change. */
const STEP_WRITE_INTERVAL_MS = 5000;
const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 60_000;

export type LinkFactory = (id: string) => Promise<{ link: GattLink; info?: Partial<DeviceInfo> }>;

async function bleFactory(id: string) {
  const device = await bleConnect(id);
  const link = await createBleLink(device);
  return { link, info: await readDeviceInfo(link) };
}

let linkFactory: LinkFactory = bleFactory;

/** Tests swap the radio for a `FakeLink`. */
export function setLinkFactory(f: LinkFactory | null): void {
  linkFactory = f ?? bleFactory;
}

interface Active {
  id: string;
  name: string | null;
  form: DeviceForm;
  link: GattLink;
  drivers: DriverSession[];
  /** Shared with the handlers; its settings are refreshed from the saved row before every sync. */
  ctx: DriverContext;
  cleanup: Array<() => void>;
  timers: Array<ReturnType<typeof setInterval>>;
  logHr: ReturnType<typeof heartRateLogger>;
  steps: ReturnType<typeof stepRecorder>;
  hasSync: boolean;
  syncing: boolean;
  userClosed: boolean;
}

const active = new Map<string, Active>();
const listeners = new Set<(id: string, e: DeviceEvent) => void>();
const reconnects = new Map<string, { timer: ReturnType<typeof setTimeout>; attempt: number; name: string | null }>();

function stepRecorder(deviceId: string, deviceName: string | null) {
  let last: number | null = null;
  let pending: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const steps = pending;
    pending = null;
    if (steps == null) return;
    recordWatchSteps(deviceId, deviceName, steps, Date.now())
      .then(() => scheduleBump())
      .catch(() => {});
  };
  return {
    push(steps: number) {
      if (steps === last) return;
      last = steps;
      pending = steps;
      if (timer) return;
      // The first change goes straight through; later ones wait for the interval.
      flush();
      timer = setTimeout(flush, STEP_WRITE_INTERVAL_MS);
    },
    stop() {
      if (!timer) return;
      clearTimeout(timer);
      flush();
    },
  };
}

/** Everything a device says, for the few listeners outside this module (scale prompt, phone operations). */
export function onEvent(cb: (id: string, e: DeviceEvent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function isConnected(id: string): boolean {
  return active.has(id);
}

export function connectedIds(): string[] {
  return [...active.keys()];
}

/** True while any device is linked or trying to reconnect; the background task ends when this is false. */
export function hasPendingLinks(): boolean {
  return active.size > 0 || reconnects.size > 0;
}

/**
 * The foreground service runs while an auto-connect device is linked or coming back, so the link
 * survives the app being closed. Started from the foreground only (Android 12+ refuses otherwise)
 * and with a Bluetooth permission granted (Android 14+ refuses otherwise).
 */
async function updateForegroundService(): Promise<void> {
  const keep: string[] = [];
  for (const a of active.values()) {
    const saved = await devicesRepo.get(a.id).catch(() => null);
    if (saved?.autoConnect) keep.push(a.name ?? a.id);
  }
  const pending = reconnects.size > 0;
  if (!keep.length && !pending) {
    DeviceLink.stop();
    return;
  }
  const text = keep.length ? `Connected to ${keep.join(', ')}` : 'Reconnecting to your device';
  if (await DeviceLink.isRunning()) DeviceLink.update('PrivateFit', text);
  else if (await hasBlePermissions()) await DeviceLink.start('PrivateFit', text);
}

/** The handler sessions of a connected device, for settings screens. */
export function driverSessions(id: string): readonly DriverSession[] {
  return active.get(id)?.drivers ?? [];
}

/** What went over the air on a connected device's link, for turning a real session into a fixture. */
export function deviceTranscript(id: string): TranscriptEntry[] | null {
  return active.get(id)?.link.transcript() ?? null;
}

/** The connected device the source policy ranks first for a metric, by form factor. */
function leader(metric: 'hr' | 'steps'): string | null {
  const list = currentRanking()[metric];
  const forms = new Map<string, DeviceForm>();
  for (const a of active.values()) forms.set(a.id, a.form);
  let best: string | null = null;
  let bestRank = Infinity;
  for (const id of active.keys()) {
    const r = rankOf(`ble:${id}`, list, forms);
    if (r < bestRank) {
      bestRank = r;
      best = id;
    }
  }
  return best;
}

function shouldLead(id: string, metric: 'hr' | 'steps'): boolean {
  if (leader(metric) === id) return true;
  const st = useAppStore.getState();
  if (metric === 'hr') {
    // A ring takes over the headline while the watch is not streaming.
    const cur = st.liveHr;
    return !cur || cur.deviceId === id || !isLiveHr(cur);
  }
  const cur = st.liveSteps;
  return !cur || cur.deviceId === id;
}

/** After a device leaves, the headline values move to the best remaining device or clear. */
function relead(): void {
  const st = useAppStore.getState();
  if (st.liveHr && !active.has(st.liveHr.deviceId)) {
    const next = leader('hr');
    const hr = next ? st.liveByDevice[next]?.hr ?? null : null;
    st.setLiveHr(hr && isLiveHr(hr) ? hr : null);
  }
  if (st.liveSteps && !active.has(st.liveSteps.deviceId)) {
    const next = leader('steps');
    st.setLiveSteps(next ? st.liveByDevice[next]?.steps ?? null : null);
  }
}

function handleEvent(act: Active, e: DeviceEvent): void {
  const st = useAppStore.getState();
  const id = act.id;
  switch (e.type) {
    case 'hr': {
      // Straps report 0 bpm while they have no skin contact; that is not a heart rate.
      if (e.bpm <= 0) return;
      const hr: LiveHr = { bpm: e.bpm, atMs: e.atMs, deviceId: id };
      st.setDeviceLive(id, { hr });
      if (shouldLead(id, 'hr')) st.setLiveHr(hr);
      act
        .logHr(e.bpm, e.atMs, st.session.status === 'running')
        .then(saved => saved && scheduleBump())
        .catch(() => {});
      break;
    }
    case 'steps': {
      const steps: LiveSteps = { steps: e.steps, atMs: e.atMs, deviceId: id };
      st.setDeviceLive(id, { steps });
      if (shouldLead(id, 'steps')) st.setLiveSteps(steps);
      act.steps.push(e.steps);
      break;
    }
    case 'spo2': {
      st.setDeviceLive(id, { spo2: { percent: e.percent, atMs: e.atMs, deviceId: id } });
      samplesRepo
        .insert({
          metric: 'spo2',
          value: e.percent,
          unit: '%',
          startMs: e.atMs,
          endMs: e.atMs,
          day: dayKey(e.atMs),
          sourceId: `ble:${id}`,
          externalId: `spo2:${Math.floor(e.atMs / 60_000)}`,
          device: act.name,
        })
        .then(() => scheduleBump())
        .catch(() => {});
      break;
    }
    case 'battery':
      st.updateConnected(id, { battery: e.percent });
      break;
    case 'records':
      writeRecords(id, act.name, e.records)
        .then(n => n && scheduleBump())
        .catch(() => {});
      break;
    case 'sync':
      if (e.status === 'started') st.updateConnected(id, { syncing: true });
      else st.updateConnected(id, { syncing: false, ...(e.status === 'done' ? { lastSyncMs: Date.now() } : {}) });
      break;
    default:
      break;
  }
  for (const l of listeners) l(id, e);
}

async function loadProfile(): Promise<UserProfile> {
  const p = useAppStore.getState().profile;
  const weight = await bodyRepo.latest('weight').catch(() => null);
  return { heightCm: p.heightCm, weightKg: weight?.value ?? null, age: null, male: null };
}

function cancelReconnect(id: string): void {
  const r = reconnects.get(id);
  if (!r) return;
  clearTimeout(r.timer);
  reconnects.delete(id);
}

function scheduleReconnect(id: string, name: string | null, attempt: number): void {
  cancelReconnect(id);
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1));
  const timer = setTimeout(async () => {
    reconnects.delete(id);
    if (active.has(id)) return;
    const saved = await devicesRepo.get(id).catch(() => null);
    if (!saved?.autoConnect) return;
    // Without a radio there is nothing to retry; look again later without burning attempts.
    if (!(await isBluetoothOn().catch(() => false))) {
      scheduleReconnect(id, name, attempt);
      return;
    }
    try {
      await connectDevice(id, name);
    } catch {
      scheduleReconnect(id, name, attempt + 1);
    }
  }, delay);
  reconnects.set(id, { timer, attempt, name });
}

async function teardown(act: Active, dropped: boolean): Promise<void> {
  if (active.get(act.id) === act) active.delete(act.id);
  for (const t of act.timers) clearInterval(t);
  act.timers = [];
  for (const c of act.cleanup) c();
  act.cleanup = [];
  act.steps.stop();
  for (const d of act.drivers) await d.close().catch(() => {});
  act.drivers = [];
  await act.link.close().catch(() => {});
  if (!dropped) await bleDisconnect(act.id);
  const st = useAppStore.getState();
  st.setConnected(act.id, null);
  relead();
  if (dropped && !act.userClosed) {
    const saved = await devicesRepo.get(act.id).catch(() => null);
    if (saved?.autoConnect) scheduleReconnect(act.id, act.name, 1);
  }
  updateForegroundService().catch(() => {});
}

/**
 * Connects, works out what the device is from the services it really exposes, runs the matching
 * handlers and saves the device. A device nothing here can read is released with an explanation.
 */
export async function connectDevice(id: string, name: string | null): Promise<void> {
  if (active.has(id)) return;
  if (active.size >= MAX_LINKS) throw new Error(`Up to ${MAX_LINKS} devices can be connected at once. Disconnect one first.`);
  cancelReconnect(id);
  const { link, info: partial } = await linkFactory(id);
  const info: DeviceInfo = {
    id,
    name,
    services: [...link.services],
    manufacturer: partial?.manufacturer ?? null,
    model: partial?.model ?? null,
    firmware: partial?.firmware ?? null,
  };
  const det = detect(info);
  if (!det) {
    await link.close().catch(() => {});
    await bleDisconnect(id);
    throw new Error(`${name ?? 'This device'} does not share heart rate, steps, sleep or weight over Bluetooth in a form PrivateFit can read.`);
  }
  const saved = await devicesRepo.get(id).catch(() => null);
  const act: Active = {
    id,
    name,
    form: det.form,
    link,
    drivers: [],
    cleanup: [],
    timers: [],
    ctx: null as unknown as DriverContext,
    logHr: heartRateLogger(id, name),
    steps: stepRecorder(id, name),
    hasSync: false,
    syncing: false,
    userClosed: false,
  };
  const ctx: DriverContext = { info, emit: (e: DeviceEvent) => handleEvent(act, e), settings: saved?.settings ?? {}, profile: await loadProfile() };
  act.ctx = ctx;
  // The store entry exists before the handlers open: the first thing a battery handler does is report.
  useAppStore.getState().setConnected(id, {
    id,
    name,
    kind: det.form,
    platform: det.platform,
    capabilities: det.capabilities,
    battery: null,
    syncing: false,
    lastSyncMs: saved?.lastSyncMs ?? null,
  });
  active.set(id, act);
  try {
    for (const h of det.handlers) act.drivers.push(await h.driver.open(link, ctx));
  } catch (e) {
    await teardown(act, false);
    throw e;
  }
  act.hasSync = act.drivers.some(d => d.sync);
  act.cleanup.push(
    link.onDisconnected(() => {
      if (active.get(id) === act) teardown(act, true).catch(() => {});
    }),
  );
  await devicesRepo.upsert({
    id,
    name,
    kind: det.form,
    lastSeenMs: Date.now(),
    platform: det.platform,
    capabilities: det.capabilities,
    manufacturer: info.manufacturer,
    model: info.model,
    firmware: info.firmware,
  });
  act.timers.push(setInterval(() => act.drivers.forEach(d => d.poll?.().catch(() => {})), BATTERY_POLL_MS));
  if (act.hasSync) {
    act.timers.push(setInterval(() => syncNow(id).catch(() => {}), SYNC_EVERY_MS));
    syncNow(id).catch(() => {});
  }
  updateForegroundService().catch(() => {});
}

export async function disconnectDevice(id: string): Promise<void> {
  cancelReconnect(id);
  const act = active.get(id);
  if (!act) return;
  act.userClosed = true;
  await teardown(act, false);
}

export async function disconnectAll(): Promise<void> {
  for (const id of [...active.keys()]) await disconnectDevice(id);
  for (const id of [...reconnects.keys()]) cancelReconnect(id);
}

/** Drops the connection, any reconnect, and the saved row. */
export async function forgetDevice(id: string): Promise<void> {
  await disconnectDevice(id);
  await devicesRepo.remove(id);
}

export async function setAutoConnect(id: string, on: boolean): Promise<void> {
  await devicesRepo.setAutoConnect(id, on);
  if (!on) cancelReconnect(id);
  await updateForegroundService().catch(() => {});
}

/** On launch: bring back the devices the user asked to keep connected. */
export async function restoreAutoConnect(): Promise<void> {
  const saved = await devicesRepo.list().catch(() => []);
  for (const d of saved) {
    if (!d.autoConnect || active.has(d.id)) continue;
    try {
      await connectDevice(d.id, d.name);
    } catch {
      scheduleReconnect(d.id, d.name, 1);
    }
  }
}

/** Pulls history from a connected device through every handler that keeps some. */
export async function syncNow(id: string): Promise<void> {
  const act = active.get(id);
  if (!act || !act.hasSync || act.syncing) return;
  act.syncing = true;
  handleEvent(act, { type: 'sync', status: 'started' });
  try {
    const saved = await devicesRepo.get(id).catch(() => null);
    // Switches flipped in the settings screen apply from the next sync, not the next connect.
    act.ctx.settings = saved?.settings ?? {};
    let total = 0;
    for (const d of act.drivers) {
      if (!d.sync) continue;
      total += await writeRecords(id, act.name, await d.sync(saved?.lastSyncMs ?? null));
    }
    await devicesRepo.markSynced(id, Date.now());
    handleEvent(act, { type: 'sync', status: 'done' });
    if (total) scheduleBump();
  } catch (e) {
    handleEvent(act, { type: 'sync', status: 'failed', message: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    act.syncing = false;
  }
}

export async function syncAll(): Promise<void> {
  for (const id of [...active.keys()]) await syncNow(id).catch(() => {});
}
