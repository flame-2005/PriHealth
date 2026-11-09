import { StepCounter, type StepReading } from '../bridge/stepCounter';
import { samplesRepo } from '../db/repositories/samplesRepo';
import { KEYS, prefs } from '../store/prefs';
import { computeDelta, samplesForDelta, type StepState } from './stepMath';

export { computeDelta, samplesForDelta } from './stepMath';
export type { StepState } from './stepMath';

let syncing: Promise<number> | null = null;

/** Read the hardware counter once and persist any new steps. Returns steps added. */
export async function syncSteps(reading?: StepReading | null): Promise<number> {
  if (syncing) return syncing;
  syncing = (async () => {
    const r = reading ?? (await StepCounter.read());
    if (!r) return 0;
    const prev = await prefs.getJson<StepState>(KEYS.stepState);
    const { delta, next } = computeDelta(prev, r);
    const samples = samplesForDelta(prev, r, delta);
    if (samples.length) await samplesRepo.insertMany(samples);
    await prefs.setJson(KEYS.stepState, next);
    return delta;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** Live updates while the app is in the foreground. Returns an unsubscribe function. */
export function startLiveSteps(onChange: (added: number) => void): () => void {
  const sub = StepCounter.addListener(r => {
    syncSteps(r)
      .then(added => {
        if (added > 0) onChange(added);
      })
      .catch(() => {});
  });
  StepCounter.startListening();
  return () => {
    StepCounter.stopListening();
    sub?.remove();
  };
}
