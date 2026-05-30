import { MIN_AGE, ageInYears, decideAgeGate, toIsoDate } from "@/domain/age";

// Date months are 0-indexed: new Date(2009, 4, 29) === 2009-05-29.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("ageInYears", () => {
  it("counts a birthday earlier in the year as a completed year", () => {
    expect(ageInYears(d(2000, 1, 10), d(2025, 6, 15))).toBe(25);
  });

  it("treats the birthday itself as the day the age ticks up", () => {
    expect(ageInYears(d(2009, 5, 29), d(2025, 5, 29))).toBe(16);
  });

  it("does not count the year until the birthday has passed (day boundary)", () => {
    // Birthday is tomorrow → still 15.
    expect(ageInYears(d(2009, 5, 30), d(2025, 5, 29))).toBe(15);
    // Birthday was yesterday → already 16.
    expect(ageInYears(d(2009, 5, 28), d(2025, 5, 29))).toBe(16);
  });

  it("does not count the year until the birthday month is reached (month boundary)", () => {
    expect(ageInYears(d(2010, 6, 1), d(2025, 5, 31))).toBe(14);
    expect(ageInYears(d(2010, 5, 1), d(2025, 6, 1))).toBe(15);
  });

  it("handles a Feb-29 birthday around the leap day", () => {
    // 2024 is a leap year. Day before the leap-day birthday → not yet ticked.
    expect(ageInYears(d(2008, 2, 29), d(2024, 2, 28))).toBe(15);
    expect(ageInYears(d(2008, 2, 29), d(2024, 2, 29))).toBe(16);
  });
});

describe("decideAgeGate", () => {
  it("passes exactly on the 16th birthday", () => {
    expect(decideAgeGate(d(2009, 5, 29), d(2025, 5, 29))).toBe("passed");
  });

  it("blocks the day before the 16th birthday", () => {
    expect(decideAgeGate(d(2009, 5, 30), d(2025, 5, 29))).toBe("blocked");
  });

  it("blocks an obviously underage DOB and passes an adult one", () => {
    expect(decideAgeGate(d(2015, 1, 1), d(2025, 1, 1))).toBe("blocked");
    expect(decideAgeGate(d(1990, 1, 1), d(2025, 1, 1))).toBe("passed");
  });

  it("uses MIN_AGE as the threshold (16)", () => {
    expect(MIN_AGE).toBe(16);
    const sixteenAgo = d(2025 - MIN_AGE, 1, 1);
    expect(decideAgeGate(sixteenAgo, d(2025, 1, 1))).toBe("passed");
  });
});

describe("toIsoDate", () => {
  it("zero-pads month and day", () => {
    expect(toIsoDate(d(2009, 5, 9))).toBe("2009-05-09");
    expect(toIsoDate(d(2009, 12, 31))).toBe("2009-12-31");
  });
});
