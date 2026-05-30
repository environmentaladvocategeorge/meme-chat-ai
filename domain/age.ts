// Pure, dependency-free age-gate logic. Kept out of the store (which pulls in
// AsyncStorage/zustand) so the compliance-critical rule is unit-testable under
// the app's ts-jest + node config. The store and UI consume these helpers; this
// module is the single source of truth for the minimum age and the decision.

// Minimum age to use the app. A real date-of-birth gate enforces this; see
// app/age-gate.tsx and store/ageGate.ts.
export const MIN_AGE = 16;

export type AgeGateDecision = "passed" | "blocked";

// Whole completed years between birthDate and now (i.e. the person's age today),
// counting the birthday as the moment they turn that age. Day-and-month aware so
// someone whose 16th birthday is later this year still reads as 15.
export function ageInYears(birthDate: Date, now: Date): number {
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDelta = now.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

// The gate decision for a given date of birth: "passed" only once the user has
// actually turned MIN_AGE.
export function decideAgeGate(birthDate: Date, now: Date): AgeGateDecision {
  return ageInYears(birthDate, now) >= MIN_AGE ? "passed" : "blocked";
}

// yyyy-mm-dd in local time. Stored alongside the gate decision for auditability.
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}
