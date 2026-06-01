import { create } from "zustand";
import { decideAgeGate, toIsoDate } from "@/domain/age";
import { AgeGateStorage, type AgeGateStatus } from "./storage";

interface AgeGateState {
  status: AgeGateStatus;
  birthDate: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  // Records the entered date of birth, computes the age, and persists the
  // pass/block decision. Returns true when the user is old enough.
  submitBirthDate: (date: Date) => Promise<boolean>;
}

export const useAgeGateStore = create<AgeGateState>()((set) => ({
  status: "unset",
  birthDate: null,
  hydrated: false,

  hydrate: async () => {
    const stored = await AgeGateStorage.read();
    set({ status: stored.status, birthDate: stored.birthDate, hydrated: true });
  },

  submitBirthDate: async (date) => {
    const status = decideAgeGate(date, new Date());
    const birthDate = toIsoDate(date);
    await AgeGateStorage.write({ status, birthDate });
    set({ status, birthDate });
    return status === "passed";
  },
}));
