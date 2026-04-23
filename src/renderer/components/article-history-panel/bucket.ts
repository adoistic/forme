/**
 * Date-bucket helpers for `<ArticleHistoryPanel>` (T7 / v0.6).
 *
 * Pure functions. The panel passes a stable `now` so re-renders
 * mid-second don't reshuffle rows.
 */

export type DateBucket = "TODAY" | "YESTERDAY" | "LAST WEEK" | "OLDER";

/** Order matters — date dividers render top-to-bottom in this order. */
export const BUCKET_ORDER: readonly DateBucket[] = ["TODAY", "YESTERDAY", "LAST WEEK", "OLDER"];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Bucket an ISO timestamp into TODAY / YESTERDAY / LAST WEEK / OLDER
 * relative to `now`.
 */
export function bucketForDate(iso: string, now: Date): DateBucket {
  const created = new Date(iso);
  const startToday = startOfDay(now);
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  const startLastWeek = new Date(startToday);
  startLastWeek.setDate(startLastWeek.getDate() - 7);

  if (created >= startToday) return "TODAY";
  if (created >= startYesterday) return "YESTERDAY";
  if (created >= startLastWeek) return "LAST WEEK";
  return "OLDER";
}

/**
 * Format a snapshot's createdAt for the row's left column. Today and
 * yesterday show "2:42 PM"; last-week shows "Mon 6:30 PM"; older
 * shows "Apr 14" — matches the variant-A specimen.
 */
export function formatRowTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const bucket = bucketForDate(iso, now);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (bucket === "TODAY" || bucket === "YESTERDAY") return time;
  if (bucket === "LAST WEEK") {
    const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
    return `${weekday} ${time}`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
