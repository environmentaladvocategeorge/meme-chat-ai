import { create } from "zustand";
import { OnboardingStorage } from "./storage";

interface OnboardingState {
  completed: boolean;
  // Persisted resume point: the step index the user last reached. Written on
  // every advance so leaving the app mid-flow returns them to the same step.
  step: number;
  // Transient (not persisted) one-shot: set the moment onboarding finishes so
  // the first chat can open with Brainrot Bot's seeded welcome + prompt chips, then
  // cleared once consumed. A relaunch never re-seeds — it's purely in-memory.
  justCompleted: boolean;
  hydrate: () => Promise<void>;
  setStep: (step: number) => void;
  setCompleted: (v: boolean) => void;
  consumeJustCompleted: () => void;
  reset: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  completed: false,
  step: 0,
  justCompleted: false,

  hydrate: async () => {
    const stored = await OnboardingStorage.read();
    set({ completed: stored.completed, step: stored.step });
  },

  setStep: (step) => {
    if (get().step === step) return;
    set({ step });
    OnboardingStorage.write({ step });
  },

  setCompleted: (completed) => {
    if (get().completed === completed) return;
    // Mark just-completed only on the false→true transition so the seeded
    // first chat fires exactly once, never on a redundant set.
    set({ completed, justCompleted: completed });
    OnboardingStorage.write({ completed });
  },

  consumeJustCompleted: () => {
    if (!get().justCompleted) return;
    set({ justCompleted: false });
  },

  reset: async () => {
    await OnboardingStorage.reset();
    set({ completed: false, step: 0, justCompleted: false });
  },
}));
