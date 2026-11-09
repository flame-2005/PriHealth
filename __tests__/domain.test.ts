import { currentStreak, downsample, fillDays, hrZone, movingAverage, splitAcrossDays, stats } from '../src/domain/aggregate';
import { addDays, dayKey, describeWhen, formatDuration, formatMinutes, lastDays, parseClock, parseDay } from '../src/domain/time';
import { isLiveHr, LIVE_HR_MAX_AGE_MS } from '../src/domain/heartRate';
import { displayToKg, estimateKcal, kgToDisplay, metersToDisplay, parseDecimal } from '../src/domain/units';
import { sessionFromClock } from '../src/domain/sleep';
import { base64ToBytes, bytesToBase64 } from '../src/domain/base64';
import { bytesToHex, bytesToText, hexToBytes, u16le, u24le, u32be, u32le } from '../src/domain/bytes';

describe('heart rate', () => {
  it('calls a stream reading live for a few seconds only', () => {
    expect(isLiveHr({ atMs: 1000 }, 1000 + LIVE_HR_MAX_AGE_MS)).toBe(true);
    expect(isLiveHr({ atMs: 1000 }, 1000 + LIVE_HR_MAX_AGE_MS + 1)).toBe(false);
    expect(isLiveHr(null, 5000)).toBe(false);
  });

  it('describes when a reading was taken relative to today', () => {
    const now = new Date(2026, 9, 12, 14, 0).getTime();
    expect(describeWhen(new Date(2026, 9, 12, 13, 5).getTime(), now)).toBe('at 13:05');
    expect(describeWhen(new Date(2026, 9, 11, 9, 30).getTime(), now)).toBe('yesterday 09:30');
    expect(describeWhen(new Date(2026, 9, 2, 9, 30).getTime(), now)).toMatch(/Oct/);
  });
});

describe('time', () => {
  it('formats day keys in local time and round-trips', () => {
    const ms = new Date(2026, 8, 27, 13, 5).getTime();
    expect(dayKey(ms)).toBe('2026-09-27');
    expect(dayKey(parseDay('2026-09-27'))).toBe('2026-09-27');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('lists the last N days oldest first', () => {
    const end = new Date(2026, 8, 27).getTime();
    expect(lastDays(3, end)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27']);
  });

  it('formats durations', () => {
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatMinutes(75)).toBe('1h 15m');
    expect(formatMinutes(20)).toBe('20m');
  });

  it('parses clock strings', () => {
    expect(parseClock('07:30')).toBe(450);
    expect(parseClock('7:05')).toBe(425);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('abc')).toBeNull();
  });
});

describe('splitAcrossDays', () => {
  it('assigns everything to one day when the span does not cross midnight', () => {
    const start = new Date(2026, 8, 27, 10).getTime();
    const end = new Date(2026, 8, 27, 12).getTime();
    expect(splitAcrossDays(start, end, 1000)).toEqual([{ day: '2026-09-27', startMs: start, endMs: end, value: 1000 }]);
  });

  it('splits proportionally across midnight and preserves the total', () => {
    const start = new Date(2026, 8, 27, 22).getTime(); // 2h before midnight
    const end = new Date(2026, 8, 28, 4).getTime(); // 4h after
    const out = splitAcrossDays(start, end, 600);
    expect(out.map(s => s.day)).toEqual(['2026-09-27', '2026-09-28']);
    expect(out[0].value).toBe(200);
    expect(out[1].value).toBe(400);
    expect(out.reduce((a, s) => a + s.value, 0)).toBe(600);
  });

  it('returns nothing for zero delta and handles inverted ranges', () => {
    expect(splitAcrossDays(10, 20, 0)).toEqual([]);
    const now = new Date(2026, 8, 27, 9).getTime();
    expect(splitAcrossDays(now + 5000, now, 12)).toEqual([{ day: '2026-09-27', startMs: now, endMs: now, value: 12 }]);
  });

  it('never hands out more than the total when rounding up on several days', () => {
    // Five equal days sharing 3 steps: 0.6 each, which rounds up to 1 four times over.
    const out = splitAcrossDays(new Date(2026, 8, 21).getTime(), new Date(2026, 8, 26).getTime(), 3);
    expect(out.reduce((a, s) => a + s.value, 0)).toBe(3);
  });
});

describe('aggregate helpers', () => {
  const days = ['2026-09-25', '2026-09-26', '2026-09-27'];
  it('fills missing days with zero', () => {
    expect(fillDays(days, [{ day: '2026-09-26', value: 5 }])).toEqual([
      { day: '2026-09-25', value: 0 },
      { day: '2026-09-26', value: 5 },
      { day: '2026-09-27', value: 0 },
    ]);
  });

  it('computes a trailing moving average and skips NaN', () => {
    const ma = movingAverage(
      [
        { day: 'a', value: 2 },
        { day: 'b', value: NaN },
        { day: 'c', value: 4 },
      ],
      3,
    );
    expect(ma.map(x => x.value)).toEqual([2, 2, 3]);
  });

  it('downsamples to at most max points', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: i, y: i }));
    const out = downsample(pts, 10);
    expect(out).toHaveLength(10);
    expect(out[0].y).toBeCloseTo(4.5);
  });

  it('computes stats, streaks and zones', () => {
    expect(stats([3, 1, 2])).toEqual({ min: 1, avg: 2, max: 3 });
    expect(stats([])).toEqual({ min: 0, avg: 0, max: 0 });
    expect(
      currentStreak(
        [
          { day: 'a', value: 9000 },
          { day: 'b', value: 100 },
          { day: 'c', value: 8000 },
          { day: 'd', value: 8500 },
        ],
        8000,
      ),
    ).toBe(2);
    expect(hrZone(100, 190)).toBe(1);
    expect(hrZone(140, 190)).toBe(3);
    expect(hrZone(180, 190)).toBe(5);
  });
});

describe('units', () => {
  it('converts weight and distance', () => {
    expect(kgToDisplay(70, 'metric')).toBe(70);
    expect(kgToDisplay(70, 'imperial')).toBeCloseTo(154.32, 1);
    expect(displayToKg(154.32, 'imperial')).toBeCloseTo(70, 1);
    expect(metersToDisplay(1609.344, 'imperial')).toBeCloseTo(1, 5);
  });

  it('estimates calories with MET x kg x hours', () => {
    expect(estimateKcal('run', 3600, 70)).toBe(630);
    expect(estimateKcal('walk', 1800, null)).toBe(Math.round(3.5 * 70 * 0.5));
  });

  it('parses typed decimals with a point or a comma', () => {
    expect(parseDecimal('72.4')).toBe(72.4);
    expect(parseDecimal(' 72,4 ')).toBe(72.4);
    expect(parseDecimal('abc')).toBeNaN();
  });
});

describe('sleep', () => {
  it('builds a session that crosses midnight', () => {
    const s = sessionFromClock('2026-09-27', '23:30', '07:00');
    expect(s).not.toBeNull();
    expect(new Date(s!.startMs).getDate()).toBe(26);
    expect((s!.endMs - s!.startMs) / 60000).toBe(450);
  });

  it('rejects malformed input', () => {
    expect(sessionFromClock('2026-09-27', '25:00', '07:00')).toBeNull();
  });

  it('rejects identical bed and wake times instead of logging a 24-hour night', () => {
    expect(sessionFromClock('2026-09-27', '07:00', '07:00')).toBeNull();
  });
});

describe('base64', () => {
  it('decodes without Buffer', () => {
    expect(Array.from(base64ToBytes('AAECAw=='))).toEqual([0, 1, 2, 3]);
    expect(Array.from(base64ToBytes('EEs='))).toEqual([0x10, 0x4b]);
  });

  it('encodes, with padding, and round-trips', () => {
    expect(bytesToBase64(Uint8Array.from([0, 1, 2, 3]))).toBe('AAECAw==');
    expect(bytesToBase64(Uint8Array.from([0x10, 0x4b]))).toBe('EEs=');
    expect(bytesToBase64(Uint8Array.from([0xfe, 0xea, 0x20]))).toBe('/uog');
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    for (const n of [1, 2, 3, 20, 61]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });
});

describe('bytes', () => {
  it('converts hex in any spelling and reads little-endian fields', () => {
    expect(Array.from(hexToBytes('FE EA 20'))).toEqual([0xfe, 0xea, 0x20]);
    expect(Array.from(hexToBytes('fe:ea:20'))).toEqual([0xfe, 0xea, 0x20]);
    expect(bytesToHex(Uint8Array.from([0xfe, 0x0a, 0]))).toBe('fe0a00');
    const b = Uint8Array.from([0x2b, 0x04, 0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(u16le(b, 0)).toBe(0x042b);
    expect(u24le(b, 0)).toBe(0x00042b);
    expect(u32le(b, 3)).toBe(0x04030201);
    expect(u32be(b, 3)).toBe(0x01020304);
    expect(bytesToText(Uint8Array.from([77, 79, 89, 0, 65]))).toBe('MOY');
  });
});
