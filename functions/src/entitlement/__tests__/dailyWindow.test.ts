import { nextEasternMidnightMs } from "../dailyWindow";

// Renders an instant as the wall-clock time in US Eastern so assertions read
// the value a user would actually see.
function easternParts(ms: number): { hour: string; minute: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return { hour: map.hour === "24" ? "00" : map.hour, minute: map.minute };
}

describe("nextEasternMidnightMs", () => {
  it("lands exactly on 00:00 US Eastern", () => {
    // Mid-afternoon UTC on an EDT day.
    const now = Date.UTC(2026, 5, 15, 18, 30, 0); // Jun 15 2026, 18:30 UTC
    const reset = nextEasternMidnightMs(now);
    const { hour, minute } = easternParts(reset);
    expect(hour).toBe("00");
    expect(minute).toBe("00");
  });

  it("is strictly in the future", () => {
    const now = Date.UTC(2026, 5, 15, 18, 30, 0);
    expect(nextEasternMidnightMs(now)).toBeGreaterThan(now);
  });

  it("rolls to the very next day when called just before midnight Eastern", () => {
    // 23:30 EST on Jan 10 2026 = 04:30 UTC Jan 11 (EST = UTC-5).
    const now = Date.UTC(2026, 0, 11, 4, 30, 0);
    const reset = nextEasternMidnightMs(now);
    // Should be 30 minutes later, i.e. 05:00 UTC = 00:00 EST Jan 11.
    expect(reset).toBe(Date.UTC(2026, 0, 11, 5, 0, 0));
  });

  it("resolves to local midnight on both sides of a DST boundary", () => {
    // EST (winter): midnight Eastern = 05:00 UTC.
    const winter = nextEasternMidnightMs(Date.UTC(2026, 0, 15, 18, 0, 0));
    expect(new Date(winter).getUTCHours()).toBe(5);
    // EDT (summer): midnight Eastern = 04:00 UTC.
    const summer = nextEasternMidnightMs(Date.UTC(2026, 6, 15, 18, 0, 0));
    expect(new Date(summer).getUTCHours()).toBe(4);
  });

  it("gives every caller in the same Eastern day the same reset instant", () => {
    // Two very different local clocks, same Eastern calendar day.
    const morningEt = Date.UTC(2026, 5, 15, 14, 0, 0); // 10:00 EDT
    const eveningEt = Date.UTC(2026, 5, 15, 23, 0, 0); // 19:00 EDT
    expect(nextEasternMidnightMs(morningEt)).toBe(nextEasternMidnightMs(eveningEt));
  });
});
