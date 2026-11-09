const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** Local calendar day key, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export function parseDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export function addDays(day: string, n: number): string {
  const d = new Date(parseDay(day));
  d.setDate(d.getDate() + n);
  return dayKey(d.getTime());
}

/** Array of day keys, oldest first, ending on the day of `endMs`. */
export function lastDays(count: number, endMs: number = Date.now()): string[] {
  const end = dayKey(endMs);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addDays(end, -i));
  return out;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

export function formatMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return `${h}h ${pad(rest)}m`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDayLabel(day: string, today: string = dayKey(Date.now())): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const d = new Date(parseDay(day));
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "at 13:05" for today, "yesterday 13:05", otherwise the short date label. */
export function describeWhen(ms: number, now: number = Date.now()): string {
  const day = dayKey(ms);
  const today = dayKey(now);
  if (day === today) return `at ${formatTime(ms)}`;
  if (day === addDays(today, -1)) return `yesterday ${formatTime(ms)}`;
  return formatDayLabel(day, today);
}

export function shortDayLabel(day: string): string {
  const d = new Date(parseDay(day));
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function weekdayLetter(day: string): string {
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(parseDay(day)).getDay()];
}

/** Parse "HH:MM" into minutes since midnight, or null. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
