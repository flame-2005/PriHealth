import type { DevicePlatform } from '../../../domain/devices';
import { registerDriver } from '../registry';
import { colmiDriver, COLMI_COMMANDS } from './colmi';
import { moyoungDriver, MOYOUNG_COMMANDS } from './moyoung';

/** Vendor drivers, registered on load. The standard handlers are built into the registry. */
registerDriver(moyoungDriver);
registerDriver(colmiDriver);

export interface CommandSwitch {
  label: string;
  default: boolean;
}

/** The per-command switches a platform offers in device settings, with what they mean to a person. */
export const DRIVER_COMMANDS: Partial<Record<DevicePlatform, Record<string, CommandSwitch>>> = {
  moyoung: {
    set_time: { label: 'Set the clock on connect', default: MOYOUNG_COMMANDS.set_time },
    user_profile: { label: 'Send height and weight on connect', default: MOYOUNG_COMMANDS.user_profile },
    hr_interval: { label: 'Apply the heart-rate interval', default: MOYOUNG_COMMANDS.hr_interval },
    sync_sleep: { label: 'Sync last night (unconfirmed)', default: MOYOUNG_COMMANDS.sync_sleep },
    sync_past_days: { label: 'Sync the past two days (unconfirmed)', default: MOYOUNG_COMMANDS.sync_past_days },
    sync_hr: { label: 'Sync heart-rate history (unconfirmed)', default: MOYOUNG_COMMANDS.sync_hr },
  },
  colmi: {
    set_time: { label: 'Set the clock on connect', default: COLMI_COMMANDS.set_time },
    hr_interval: { label: 'Apply the heart-rate log interval', default: COLMI_COMMANDS.hr_interval },
    sync_steps: { label: 'Sync steps for today and yesterday', default: COLMI_COMMANDS.sync_steps },
    sync_hr: { label: 'Sync the heart-rate log', default: COLMI_COMMANDS.sync_hr },
  },
};
