import { formatResetMoment, isWithinCountdownWindow } from "@/domain/usage";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Live "when does this allowance reset" label. Ticks once a minute while the
// reset is inside the relative-countdown window (< 6h away) so a long-lived
// screen counts down smoothly; otherwise it's a static absolute date and we
// don't schedule any timers.
export function useResetCountdown(resetAt: Date | null): string {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isWithinCountdownWindow(resetAt, now)) return;
    const handle = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(handle);
  }, [resetAt, now]);

  return formatResetMoment(resetAt, now, t);
}
