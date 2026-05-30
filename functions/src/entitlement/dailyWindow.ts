// The daily soft cap resets on a SINGLE global wall-clock boundary rather than a
// per-user rolling 24h window: every user's "today" begins at 00:00 US Eastern.
// This is the only place that defines that boundary; schema.ts (initial + plan
// activation) and reset.ts (lazy roll-forward) both derive dailyResetAt from it,
// so resets always land at the same instant for everyone. The client never
// computes this — it just reads the stored dailyResetAt and renders it in the
// device's local timezone.
//
// We anchor to the America/New_York zone (not a fixed UTC-5) so the reset stays
// at local Eastern midnight year-round, automatically following the EST/EDT
// daylight-saving shift. US DST transitions happen at 02:00, never at midnight,
// so the target instant is always unambiguous.
export const DAILY_RESET_TIME_ZONE = "America/New_York";

// Milliseconds to ADD to a UTC instant to get the wall-clock reading in
// `timeZone` (e.g. -4h during EDT, -5h during EST). Derived by formatting the
// instant in the zone and diffing against the same fields read as UTC.
function zoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  // Intl can render midnight as hour "24"; normalize so Date.UTC stays valid.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asUtc - date.getTime();
}

// Epoch ms of the next 00:00 in DAILY_RESET_TIME_ZONE strictly after `nowMs`.
// The offset is resolved twice — once for "now" to find the current Eastern
// day, and again at the target midnight — so a window that spans a DST change
// still lands exactly on local midnight.
export function nextEasternMidnightMs(nowMs: number): number {
  const offsetNow = zoneOffsetMs(DAILY_RESET_TIME_ZONE, new Date(nowMs));
  // Eastern wall-clock "now", expressed in a fake-UTC frame so getUTC* reads
  // the Eastern calendar fields directly.
  const easternWall = new Date(nowMs + offsetNow);
  // Start of the NEXT Eastern day in that same fake-UTC frame.
  const nextMidnightWall = Date.UTC(
    easternWall.getUTCFullYear(),
    easternWall.getUTCMonth(),
    easternWall.getUTCDate() + 1,
  );
  // Convert the wall-clock midnight back to a real instant using the offset
  // that actually applies at that midnight.
  const guessUtc = nextMidnightWall - offsetNow;
  const offsetAtMidnight = zoneOffsetMs(DAILY_RESET_TIME_ZONE, new Date(guessUtc));
  return nextMidnightWall - offsetAtMidnight;
}
