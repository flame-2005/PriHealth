import { parseBodyComposition } from '../../../ble/gatt/bodyComposition';
import { parseHeartRate } from '../../../ble/gatt/heartRate';
import { parsePedometer } from '../../../ble/gatt/pedometer';
import { parseWeight } from '../../../ble/gatt/weightScale';
import { UUID } from '../../../ble/uuids';
import type { GattLink } from '../../link';
import type { Capability, DeviceDriver, DeviceInfo, DriverContext } from '../../types';

/**
 * The standard Bluetooth SIG profiles, one handler each. They need no vendor knowledge: anything
 * that exposes the service works. A vendor driver can suppress one when it owns the same data.
 */
const has = (info: DeviceInfo, service: string) => info.services.includes(service);

async function readBattery(link: GattLink, ctx: DriverContext): Promise<void> {
  try {
    const b = await link.read(UUID.BATTERY_SERVICE, UUID.BATTERY_LEVEL);
    if (b.length) ctx.emit({ type: 'battery', percent: b[0] });
  } catch {
    // A refused read is not worth a disconnect.
  }
}

export const gattHeartRate: DeviceDriver = {
  id: 'gatt-hr',
  platform: 'gatt',
  vendor: false,
  detect: info => (has(info, UUID.HEART_RATE_SERVICE) ? { form: 'strap', capabilities: ['live_hr'] } : null),
  async open(link, ctx) {
    const stop = link.monitor(UUID.HEART_RATE_SERVICE, UUID.HEART_RATE_MEASUREMENT, bytes => {
      const m = parseHeartRate(bytes);
      if (m) ctx.emit({ type: 'hr', bpm: m.bpm, atMs: Date.now() });
    });
    return { capabilities: ['live_hr'], close: async () => stop() };
  },
};

export const gattPedometer: DeviceDriver = {
  id: 'gatt-pedometer',
  platform: 'gatt',
  vendor: false,
  detect: info => (has(info, UUID.PEDOMETER_SERVICE) ? { form: 'watch', capabilities: ['live_steps'] } : null),
  async open(link, ctx) {
    const push = (bytes: Uint8Array) => {
      const m = parsePedometer(bytes);
      if (m) ctx.emit({ type: 'steps', steps: m.steps, distanceM: m.distanceM, kcal: m.kcal, atMs: Date.now() });
    };
    const stop = link.monitor(UUID.PEDOMETER_SERVICE, UUID.PEDOMETER_MEASUREMENT, push);
    // The watch only notifies on change; the first total has to be asked for.
    link.read(UUID.PEDOMETER_SERVICE, UUID.PEDOMETER_MEASUREMENT).then(push).catch(() => {});
    return { capabilities: ['live_steps'], close: async () => stop() };
  },
};

export const gattScale: DeviceDriver = {
  id: 'gatt-scale',
  platform: 'gatt',
  vendor: false,
  detect: info => {
    const caps: Capability[] = [];
    if (has(info, UUID.WEIGHT_SCALE_SERVICE)) caps.push('weight');
    if (has(info, UUID.BODY_COMPOSITION_SERVICE)) caps.push('body_composition');
    return caps.length ? { form: 'scale', capabilities: caps } : null;
  },
  async open(link, ctx) {
    const stops: Array<() => void> = [];
    const caps: Capability[] = [];
    if (link.has(UUID.WEIGHT_SCALE_SERVICE, UUID.WEIGHT_MEASUREMENT)) {
      caps.push('weight');
      stops.push(
        link.monitor(UUID.WEIGHT_SCALE_SERVICE, UUID.WEIGHT_MEASUREMENT, bytes => {
          const m = parseWeight(bytes);
          if (m) ctx.emit({ type: 'scale', weight: m });
        }),
      );
    }
    if (link.has(UUID.BODY_COMPOSITION_SERVICE, UUID.BODY_COMPOSITION_MEASUREMENT)) {
      caps.push('body_composition');
      stops.push(
        link.monitor(UUID.BODY_COMPOSITION_SERVICE, UUID.BODY_COMPOSITION_MEASUREMENT, bytes => {
          const m = parseBodyComposition(bytes);
          if (m) ctx.emit({ type: 'scale', body: m });
        }),
      );
    }
    return { capabilities: caps, close: async () => stops.forEach(s => s()) };
  },
};

export const gattBattery: DeviceDriver = {
  id: 'gatt-battery',
  platform: 'gatt',
  vendor: false,
  detect: info => (has(info, UUID.BATTERY_SERVICE) ? { form: null, capabilities: ['battery'] } : null),
  async open(link, ctx) {
    await readBattery(link, ctx);
    return { capabilities: ['battery'], poll: () => readBattery(link, ctx), close: async () => {} };
  },
};

export const GATT_DRIVERS: DeviceDriver[] = [gattHeartRate, gattPedometer, gattScale, gattBattery];
