/* eslint-disable no-bitwise */
export interface HeartRateMeasurement {
  bpm: number;
  sensorContact: 'unsupported' | 'not_detected' | 'detected';
  energyExpendedKj: number | null;
  rrIntervalsMs: number[];
}

/** Heart Rate Measurement characteristic (0x2A37), Bluetooth SIG HRS 1.0. */
export function parseHeartRate(bytes: Uint8Array): HeartRateMeasurement | null {
  if (bytes.length < 2) return null;
  const flags = bytes[0];
  const is16Bit = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const energyPresent = (flags & 0x08) !== 0;
  const rrPresent = (flags & 0x10) !== 0;

  let offset = 1;
  let bpm: number;
  if (is16Bit) {
    if (bytes.length < 3) return null;
    bpm = bytes[1] | (bytes[2] << 8);
    offset = 3;
  } else {
    bpm = bytes[1];
    offset = 2;
  }

  let energyExpendedKj: number | null = null;
  if (energyPresent && bytes.length >= offset + 2) {
    energyExpendedKj = bytes[offset] | (bytes[offset + 1] << 8);
    offset += 2;
  }

  const rrIntervalsMs: number[] = [];
  if (rrPresent) {
    while (bytes.length >= offset + 2) {
      const raw = bytes[offset] | (bytes[offset + 1] << 8);
      rrIntervalsMs.push(Math.round((raw / 1024) * 1000));
      offset += 2;
    }
  }

  return {
    bpm,
    sensorContact: !contactSupported ? 'unsupported' : contactDetected ? 'detected' : 'not_detected',
    energyExpendedKj,
    rrIntervalsMs,
  };
}
