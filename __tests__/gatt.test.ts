import { parseHeartRate } from '../src/integrations/ble/gatt/heartRate';
import { parseWeight } from '../src/integrations/ble/gatt/weightScale';
import { parseBodyComposition } from '../src/integrations/ble/gatt/bodyComposition';
import { parsePedometer } from '../src/integrations/ble/gatt/pedometer';
import { normalizeUuid, UUID } from '../src/integrations/ble/uuids';

const bytes = (...b: number[]) => Uint8Array.from(b);

describe('Heart Rate Measurement (0x2A37)', () => {
  it('parses the 8-bit format', () => {
    const m = parseHeartRate(bytes(0x00, 75));
    expect(m?.bpm).toBe(75);
    expect(m?.sensorContact).toBe('unsupported');
    expect(m?.rrIntervalsMs).toEqual([]);
  });

  it('parses the 16-bit format with contact, energy and RR intervals', () => {
    // flags: 16-bit (1) | contact detected (2) | contact supported (4) | energy (8) | RR (16) = 0x1F
    const m = parseHeartRate(bytes(0x1f, 0x2c, 0x01, 0x10, 0x00, 0x00, 0x04, 0x00, 0x03));
    expect(m?.bpm).toBe(300);
    expect(m?.sensorContact).toBe('detected');
    expect(m?.energyExpendedKj).toBe(16);
    expect(m?.rrIntervalsMs).toEqual([1000, 750]);
  });

  it('rejects short packets', () => {
    expect(parseHeartRate(bytes(0x00))).toBeNull();
  });
});

describe('Pedometer Measurement (0xFEA1, WeChat Sports)', () => {
  it('parses the step count a Noise Icon Plus sends', () => {
    // flags 0x01 (steps only), 0x00042b = 1067 steps, little-endian 24-bit
    const m = parsePedometer(bytes(0x01, 0x2b, 0x04, 0x00));
    expect(m).toEqual({ steps: 1067, distanceM: null, kcal: null });
  });

  it('parses distance and calories when their flags are set', () => {
    const m = parsePedometer(bytes(0x07, 0x2b, 0x04, 0x00, 0x6a, 0x03, 0x00, 0x2f, 0x00, 0x00));
    expect(m).toEqual({ steps: 1067, distanceM: 874, kcal: 47 });
  });

  it('rejects packets without a step count or too short for their flags', () => {
    expect(parsePedometer(bytes(0x00, 0x2b, 0x04, 0x00))).toBeNull();
    expect(parsePedometer(bytes(0x01, 0x2b, 0x04))).toBeNull();
    expect(parsePedometer(bytes(0x03, 0x2b, 0x04, 0x00, 0x6a))).toEqual({ steps: 1067, distanceM: null, kcal: null });
  });
});

describe('Weight Measurement (0x2A9D)', () => {
  it('parses SI units at 5 g resolution', () => {
    // 72.40 kg -> 14480 = 0x3890
    const m = parseWeight(bytes(0x00, 0x90, 0x38));
    expect(m?.kg).toBeCloseTo(72.4, 2);
    expect(m?.timestampMs).toBeNull();
  });

  it('parses imperial units and converts to kg', () => {
    // 160.00 lb -> 16000 = 0x3E80
    const m = parseWeight(bytes(0x01, 0x80, 0x3e));
    expect(m?.kg).toBeCloseTo(72.57, 2);
  });

  it('parses timestamp, user id and BMI/height when flagged', () => {
    // flags: time (2) | user (4) | bmi (8) = 0x0E
    const m = parseWeight(bytes(0x0e, 0x90, 0x38, 0xea, 0x07, 9, 27, 7, 30, 0, 3, 0xe6, 0x00, 0xe6, 0x06));
    expect(m?.kg).toBeCloseTo(72.4, 2);
    expect(new Date(m!.timestampMs!).getFullYear()).toBe(2026);
    expect(m?.userId).toBe(3);
    expect(m?.bmi).toBeCloseTo(23.0, 1);
    expect(m?.heightM).toBeCloseTo(1.766, 3);
  });

  it('treats 0xFFFF as no reading', () => {
    expect(parseWeight(bytes(0x00, 0xff, 0xff))).toBeNull();
  });
});

describe('Body Composition Measurement (0x2A9C)', () => {
  it('parses body fat and optional fields', () => {
    // flags (u16): muscle % (0x0010) | weight (0x0400) = 0x0410 ; fat 18.5% = 185 ; muscle 40.0% = 400 ; weight 72.4 kg = 14480
    const m = parseBodyComposition(bytes(0x10, 0x04, 0xb9, 0x00, 0x90, 0x01, 0x90, 0x38));
    expect(m?.bodyFatPercent).toBeCloseTo(18.5, 1);
    expect(m?.musclePercent).toBeCloseTo(40, 1);
    expect(m?.weightKg).toBeCloseTo(72.4, 2);
    expect(m?.impedanceOhm).toBeNull();
  });

  it('returns null body fat when unknown', () => {
    const m = parseBodyComposition(bytes(0x00, 0x00, 0xff, 0xff));
    expect(m?.bodyFatPercent).toBeNull();
  });
});

describe('uuids', () => {
  it('normalises short UUIDs', () => {
    expect(normalizeUuid('180D')).toBe(UUID.HEART_RATE_SERVICE);
    expect(normalizeUuid('0000180d')).toBe(UUID.HEART_RATE_SERVICE);
  });
});
