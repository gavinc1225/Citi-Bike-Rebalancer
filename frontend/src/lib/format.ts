export const REPLAY_MIN = "2026-09-01";
export const REPLAY_MAX = "2026-09-30";
export const TEST_WEEK = { start: "2026-09-24", end: "2026-09-30" };

export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const display = hh % 12 === 0 ? 12 : hh % 12;
  return `${display}:00 ${hh < 12 ? "am" : "pm"}`;
}

export function shortHour(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const display = hh % 12 === 0 ? 12 : hh % 12;
  return `${display}${hh < 12 ? "a" : "p"}`;
}

export function isoAt(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:00`;
}

export function mins(m: number): string {
  return `${Math.max(1, Math.round(m))} min`;
}

export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

export function needLabel(n: number): string {
  if (n > 0) return `${signed(n)} surplus`;
  if (n < 0) return `${signed(n)} deficit`;
  return "balanced";
}

export function inTestWeek(date: string): boolean {
  return date >= TEST_WEEK.start && date <= TEST_WEEK.end;
}

export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
