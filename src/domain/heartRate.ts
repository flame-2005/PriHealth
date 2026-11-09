/** A stream reading older than this is no longer "live": a watch stops sending once it stops measuring. */
export const LIVE_HR_MAX_AGE_MS = 15_000;

export function isLiveHr(hr: { atMs: number } | null | undefined, now: number = Date.now()): boolean {
  return hr != null && now - hr.atMs <= LIVE_HR_MAX_AGE_MS;
}
