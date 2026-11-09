export interface StepReading {
  /** Cumulative steps since the last boot, as reported by the hardware counter. */
  count: number;
  /** Wall-clock time of the last boot (ms). Changes after a reboot, and when the clock is adjusted. */
  bootTimeMs: number;
  /** Wall-clock time of the reading (ms). */
  atMs: number;
  /** Android's boot counter, which goes up by one on every boot. Missing where the OS does not expose it. */
  bootCount?: number;
}
