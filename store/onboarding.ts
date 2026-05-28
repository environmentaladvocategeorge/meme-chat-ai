import { create } from "zustand";
import { OnboardingStorage } from "./storage";

interface OnboardingState {
  completed: boolean;
  hydrate: () => Promise<void>;
  setCompleted: (v: boolean) => void;
  reset: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  completed: false,

  hydrate: async () => {
    const stored = await OnboardingStorage.read();
    set({ completed: stored.completed });
  },

  setCompleted: (completed) => {
    if (get().completed === completed) return;
    set({ completed });
    OnboardingStorage.write({ completed });
  },

  reset: async () => {
    await OnboardingStorage.reset();
    set({ completed: false });
  },
}));
