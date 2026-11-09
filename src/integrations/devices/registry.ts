import { formFromName, type Capability, type DeviceForm, type DevicePlatform } from '../../domain/devices';
import { GATT_DRIVERS } from './drivers/gatt';
import type { DeviceDriver, DeviceInfo, Detection } from './types';

/**
 * Every driver the app knows. A device gets the standard handler for each SIG service it exposes
 * plus at most one vendor driver, matched on its vendor service or manufacturer string. Vendor
 * drivers register themselves when their module loads (see `drivers/index.ts`).
 */
const drivers: DeviceDriver[] = [...GATT_DRIVERS];

export function registerDriver(d: DeviceDriver): void {
  if (!drivers.some(x => x.id === d.id)) drivers.push(d);
}

export function listDrivers(): readonly DeviceDriver[] {
  return drivers;
}

export interface Handler {
  driver: DeviceDriver;
  detection: Detection;
}

export interface DetectResult {
  handlers: Handler[];
  form: DeviceForm;
  platform: DevicePlatform;
  capabilities: Capability[];
}

const FORM_RANK: Record<DeviceForm, number> = { watch: 0, band: 1, ring: 2, scale: 3, strap: 4, unknown: 5 };

/** What runs on this device and what it is; null when nothing here can read it. */
export function detect(info: DeviceInfo): DetectResult | null {
  const matches: Handler[] = [];
  for (const driver of drivers) {
    const detection = driver.detect(info);
    if (detection) matches.push({ driver, detection });
  }
  const vendor = matches.find(m => m.driver.vendor) ?? null;
  const suppressed = new Set(vendor?.detection.suppress ?? []);
  const handlers = matches.filter(m => (m === vendor || !m.driver.vendor) && !suppressed.has(m.driver.id));
  if (!handlers.length) return null;

  const capabilities: Capability[] = [];
  for (const h of handlers) for (const c of h.detection.capabilities) if (!capabilities.includes(c)) capabilities.push(c);
  // A battery level alone is not a reason to hold a connection.
  if (!capabilities.some(c => c !== 'battery')) return null;

  let form: DeviceForm | null = vendor?.detection.form ?? null;
  if (!form) form = formFromName(info.name);
  if (!form) {
    // Without a vendor driver, the most telling profile decides: a pedometer makes a watch, a
    // heart-rate service alone makes a strap.
    const forms = handlers.map(h => h.detection.form).filter((f): f is DeviceForm => f != null);
    forms.sort((a, b) => FORM_RANK[a] - FORM_RANK[b]);
    form = forms[0] ?? 'unknown';
  }
  return { handlers, form, platform: vendor?.driver.platform ?? 'gatt', capabilities };
}
