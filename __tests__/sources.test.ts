import type { DeviceForm } from '../src/domain/devices';
import { classify, DEFAULT_RANKING, mergeRanking, pickDaily, pickSeries, rankOf, type SourceRow } from '../src/domain/sources';

const devices = new Map<string, DeviceForm>([
  ['W1', 'watch'],
  ['W2', 'watch'],
  ['R1', 'ring'],
  ['S1', 'strap'],
  ['SC', 'scale'],
]);
const D1 = '2026-09-27';
const D2 = '2026-09-28';
const H = 3600_000;
const row = (day: string, sourceId: string, value: number, firstH: number, lastH: number): SourceRow => ({
  day,
  sourceId,
  value,
  firstMs: firstH * H,
  lastMs: lastH * H,
});

describe('source policy', () => {
  it('classifies sources and ranks an exact id above its class', () => {
    expect(classify('phone', devices)).toBe('phone');
    expect(classify('ble:R1', devices)).toBe('ring');
    expect(classify('ble:XX', devices)).toBe('unknown');
    expect(classify('weird', devices)).toBe('unknown');
    const list = DEFAULT_RANKING.steps;
    expect(rankOf('ble:W1', list, devices)).toBe(0);
    expect(rankOf('phone', list, devices)).toBeGreaterThan(rankOf('ble:XX', list, devices));
    expect(rankOf('ble:R1', ['ble:R1', 'watch'], devices)).toBe(0);
    expect(rankOf('ble:W1', ['ble:R1', 'watch'], devices)).toBe(1);
    expect(rankOf('nothing', ['watch'], devices)).toBe(1);
  });

  it('a watch put on at lunch counts for the day, and the user can prefer the phone instead', () => {
    const rows = [row(D1, 'phone', 8000, 6, 22), row(D1, 'ble:W1', 3000, 13, 22)];
    const pick = pickDaily(rows, 'steps', DEFAULT_RANKING, devices).get(D1);
    expect(pick).toEqual({ value: 3000, sourceIds: ['ble:W1'], firstMs: 13 * H });
    const phoneFirst = mergeRanking({ steps: ['phone', 'watch'] });
    expect(pickDaily(rows, 'steps', phoneFirst, devices).get(D1)?.value).toBe(8000);
  });

  it('a ring and a watch the same night: the ring wins and nothing is added', () => {
    const rows = [row(D1, 'ble:W1', 400, 23, 31), row(D1, 'ble:R1', 450, 23, 31), row(D1, 'manual', 480, 22, 31)];
    expect(pickDaily(rows, 'sleep', DEFAULT_RANKING, devices).get(D1)).toEqual({ value: 450, sourceIds: ['ble:R1'], firstMs: 23 * H });
  });

  it('two watches worn one after the other add up; worn together, the last reporter stands alone', () => {
    const inTurn = [row(D1, 'ble:W1', 4000, 6, 12.9), row(D1, 'ble:W2', 3500, 13, 22), row(D1, 'phone', 9000, 6, 22)];
    expect(pickDaily(inTurn, 'steps', DEFAULT_RANKING, devices).get(D1)).toEqual({
      value: 7500,
      sourceIds: ['ble:W1', 'ble:W2'],
      firstMs: 6 * H,
    });
    const together = [row(D1, 'ble:W1', 4000, 6, 20), row(D1, 'ble:W2', 3500, 13, 22)];
    expect(pickDaily(together, 'steps', DEFAULT_RANKING, devices).get(D1)).toEqual({ value: 3500, sourceIds: ['ble:W2'], firstMs: 13 * H });
  });

  it('measurements never add: the latest reading of the best class wins', () => {
    const rows = [row(D1, 'manual', 71.0, 7, 7), row(D1, 'ble:SC', 72.4, 8, 8), row(D1, 'ble:XX', 70.0, 9, 9)];
    expect(pickDaily(rows, 'weight', DEFAULT_RANKING, devices).get(D1)?.value).toBe(72.4);
    const twoScales = [row(D1, 'ble:SC', 72.4, 8, 8), row(D1, 'ble:SC2', 72.9, 9, 9)];
    const both = new Map(devices).set('SC2', 'scale');
    expect(pickDaily(twoScales, 'weight', DEFAULT_RANKING, both).get(D1)).toEqual({ value: 72.9, sourceIds: ['ble:SC2'], firstMs: 9 * H });
  });

  it('a device that reported nothing for the day does not beat the phone', () => {
    const rows = [row(D1, 'phone', 2288, 6, 22), row(D1, 'ble:W1', 0, 21, 22)];
    expect(pickDaily(rows, 'steps', DEFAULT_RANKING, devices).get(D1)).toEqual({ value: 2288, sourceIds: ['phone'], firstMs: 6 * H });
    expect(pickDaily([row(D1, 'ble:W1', 0, 21, 22)], 'steps', DEFAULT_RANKING, devices).size).toBe(0);
  });

  it('a device the app has not saved still beats the phone', () => {
    const rows = [row(D1, 'phone', 8000, 6, 22), row(D1, 'ble:XX', 5000, 6, 22)];
    expect(pickDaily(rows, 'steps', DEFAULT_RANKING, devices).get(D1)?.value).toBe(5000);
  });

  it('orders the series by day and leaves days without data out', () => {
    const rows = [row(D2, 'phone', 100, 6, 7), row(D1, 'ble:W1', 300, 6, 7)];
    expect(pickSeries(rows, 'steps', DEFAULT_RANKING, devices)).toEqual([
      { day: D1, value: 300 },
      { day: D2, value: 100 },
    ]);
    expect(pickSeries([], 'steps', DEFAULT_RANKING, devices)).toEqual([]);
  });

  it('keeps the defaults for metrics the user did not reorder, and ignores empty lists', () => {
    const merged = mergeRanking({ sleep: ['watch', 'ring'], steps: [] });
    expect(merged.sleep).toEqual(['watch', 'ring']);
    expect(merged.steps).toEqual(DEFAULT_RANKING.steps);
    expect(mergeRanking(null)).toEqual(DEFAULT_RANKING);
  });
});
