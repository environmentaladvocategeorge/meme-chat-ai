import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Returns a localized "x ago" label for a Date. Re-renders itself on a
// schedule that matches the granularity it's showing (every minute for
// recent values; not at all for old values) so a long-lived screen
// never shows "2m ago" for an hour-old conversation.
export function useRelativeTime(date: Date | null): string {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!date) return;
    const diff = Math.abs(now - date.getTime());
    // Only schedule a tick if the label could change within an hour. Older
    // labels swap units only once per day, which is acceptable lag.
    if (diff > HOUR) return;
    const handle = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(handle);
  }, [date, now]);

  if (!date) return "";
  return formatRelativeTime(date, now, t);
}

export function formatRelativeTime(
  date: Date,
  now: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const diff = now - date.getTime();
  if (diff < 0) return t("history.timestamp.justNow");
  if (diff < MINUTE) return t("history.timestamp.justNow");
  if (diff < HOUR) {
    return t("history.timestamp.minute", { count: Math.floor(diff / MINUTE) });
  }
  if (diff < DAY) {
    return t("history.timestamp.hour", { count: Math.floor(diff / HOUR) });
  }
  if (diff < 2 * DAY) return t("history.timestamp.yesterday");
  if (diff < WEEK) {
    return t("history.timestamp.day", { count: Math.floor(diff / DAY) });
  }
  if (diff < 4 * WEEK) {
    return t("history.timestamp.week", { count: Math.floor(diff / WEEK) });
  }
  return t("history.timestamp.longAgo", { date: date.toLocaleDateString() });
}
