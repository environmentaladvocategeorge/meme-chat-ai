import { create } from "zustand";
import type { OnboardingAnswers } from "@/domain/onboarding/script";
import { OnboardingStorage } from "./storage";

interface OnboardingState {
  completed: boolean;
  // Persisted resume point: the script cursor (turn index) the user last
  // reached, plus the personalization captured so far. Written on every advance
  // so leaving the app mid-flow rebuilds the conversation transcript exactly via
  // buildTranscript. Ignored once `completed` is true.
  cursor: number;
  answers: OnboardingAnswers;
  // Transient (not persisted) one-shot: set the moment onboarding finishes so
  // the first chat can open with Brainrot Bot's seeded welcome + prompt chips, then
  // cleared once consumed. A relaunch never re-seeds — it's purely in-memory.
  justCompleted: boolean;
  hydrate: () => Promise<void>;
  // Persist the resume point after an advance. Both pieces move together so a
  // resumed transcript always matches the cursor it was saved with.
  setProgress: (cursor: number, answers: OnboardingAnswers) => void;
  setCompleted: (v: boolean) => void;
  // Restore from the server-side profiles/{uid} marker at sign-in: marks
  // onboarding complete WITHOUT the justCompleted one-shot, so an established
  // account re-signing-in never re-seeds the welcome chat.
  markCompletedFromServer: () => void;
  consumeJustCompleted: () => void;
  reset: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  completed: false,
  cursor: 0,
  answers: {},
  justCompleted: false,

  hydrate: async () => {
    const stored = await OnboardingStorage.read();
    set({
      completed: stored.completed,
      cursor: stored.cursor,
      answers: stored.answers,
    });
  },

  setProgress: (cursor, answers) => {
    if (get().cursor === cursor && get().answers === answers) return;
    set({ cursor, answers });
    OnboardingStorage.write({ cursor, answers });
  },

  setCompleted: (completed) => {
    if (get().completed === completed) return;
    // Mark just-completed only on the false→true transition so the seeded
    // first chat fires exactly once, never on a redundant set.
    set({ completed, justCompleted: completed });
    OnboardingStorage.write({ completed });
  },

  markCompletedFromServer: () => {
    if (get().completed) return;
    set({ completed: true });
    OnboardingStorage.write({ completed: true });
  },

  consumeJustCompleted: () => {
    if (!get().justCompleted) return;
    set({ justCompleted: false });
  },

  reset: async () => {
    await OnboardingStorage.reset();
    set({ completed: false, cursor: 0, answers: {}, justCompleted: false });
  },
}));
