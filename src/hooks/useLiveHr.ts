import { useEffect, useState } from 'react';
import { isLiveHr } from '../domain/heartRate';
import { useAppStore, type LiveHr } from '../store/useAppStore';

/**
 * The latest stream reading and whether it is still fresh enough to call live. Re-renders every
 * few seconds while a reading exists, so "live" turns into the saved reading once the stream stops.
 */
export function useLiveHr(): { hr: LiveHr | null; live: boolean } {
  const hr = useAppStore(s => s.liveHr);
  const [, setTick] = useState(0);
  const has = hr != null;
  useEffect(() => {
    if (!has) return;
    const id = setInterval(() => setTick(n => n + 1), 5000);
    return () => clearInterval(id);
  }, [has]);
  return { hr, live: isLiveHr(hr) };
}
