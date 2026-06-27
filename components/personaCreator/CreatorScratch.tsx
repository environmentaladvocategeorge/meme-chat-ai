// Ephemeral, screen-scoped scratch state for the persona creator wizard — state
// that must survive moving BETWEEN steps (which remount the per-step body) but
// is not part of the saved persona. It lives on the screen component (above the
// step ScrollView), so it persists across Next/Back yet is dropped when the
// creator closes.
//
// Today it carries two things the avatar step needs:
//   - scrollToEnd: lets a focused input pull itself above the keyboard (the
//     plain ScrollView doesn't auto-scroll to the focused field).
//   - generatedAvatars: the two AI-generated avatar candidates, kept so they
//     aren't lost when the user taps Next and comes back (regenerating or
//     closing the creator clears them).

import type { PersonaStep } from "@/domain/personaForm";
import type { PickedAvatar } from "@/services/firebase/uploadPersonaAvatar";
import {
  createContext,
  useContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type CreatorScratch = {
  scrollToEnd: () => void;
  // Jump the wizard to a specific step. Used by the review/overview to let the
  // user tap a section and land straight on its editor.
  goToStep: (step: PersonaStep) => void;
  generatedAvatars: PickedAvatar[];
  setGeneratedAvatars: Dispatch<SetStateAction<PickedAvatar[]>>;
  // Epoch ms until which avatar regeneration is rate-limited (0 = none). Kept on
  // the screen so the cooldown survives moving between steps.
  cooldownUntil: number;
  setCooldownUntil: Dispatch<SetStateAction<number>>;
  // In-flight flags for the two billed jobs, held above the per-step remount so
  // a request keeps running (and stays visible as "working") when the user moves
  // between steps. avatar = AI avatar generation; describe = AI description.
  avatarBusy: boolean;
  setAvatarBusy: Dispatch<SetStateAction<boolean>>;
  describeBusy: boolean;
  setDescribeBusy: Dispatch<SetStateAction<boolean>>;
  // AI-description soft rate limit, kept on the screen like cooldownUntil above.
  describeCooldownUntil: number;
  setDescribeCooldownUntil: Dispatch<SetStateAction<number>>;
};

const CreatorScratchContext = createContext<CreatorScratch>({
  scrollToEnd: () => {},
  goToStep: () => {},
  generatedAvatars: [],
  setGeneratedAvatars: () => {},
  cooldownUntil: 0,
  setCooldownUntil: () => {},
  avatarBusy: false,
  setAvatarBusy: () => {},
  describeBusy: false,
  setDescribeBusy: () => {},
  describeCooldownUntil: 0,
  setDescribeCooldownUntil: () => {},
});

export function CreatorScratchProvider({
  value,
  children,
}: {
  value: CreatorScratch;
  children: ReactNode;
}) {
  return (
    <CreatorScratchContext.Provider value={value}>{children}</CreatorScratchContext.Provider>
  );
}

export function useCreatorScratch(): CreatorScratch {
  return useContext(CreatorScratchContext);
}
