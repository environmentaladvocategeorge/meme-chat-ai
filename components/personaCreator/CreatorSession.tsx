// CreatorSession
//
// The persona builder collects most fields through react-hook-form, but two
// pieces live outside it: the avatar (a device-local image until publish) and
// the picked reaction GIFs/memes (name + local thumbnail). In CREATE mode those
// belong to the active draft (autosave-on-explicit-save). In EDIT mode there is
// no draft — it's edit-or-quit — so the same two pieces are held in ephemeral
// screen state, seeded from the stored persona.
//
// This context is the seam so the step components (AvatarField, ReactionPicker,
// ReviewStep) don't care which mode they're in: they read/write avatar +
// mediaPicks through useCreatorSession(), and the screen provides the right
// backing (DraftCreatorSession for create, a screen-owned value for edit).

import type { MediaPick } from "@/domain/personaDrafts";
import { useActiveDraft, usePersonaDraftStore } from "@/store/personaDraft";
import { createContext, useContext, useMemo, type ReactNode } from "react";

// The avatar as the builder UI sees it: nothing, a freshly-picked local image
// (new or replacing), or the persona's existing uploaded image (edit only).
export type SessionAvatar =
  | { kind: "none" }
  | { kind: "local"; localUri: string; width?: number; height?: number }
  | { kind: "remote"; url: string };

export type CreatorSession = {
  avatar: SessionAvatar;
  setLocalAvatar: (a: { localUri: string; width?: number; height?: number }) => void;
  removeAvatar: () => void;
  mediaPicks: MediaPick[];
  setMediaPicks: (next: MediaPick[]) => void;
  // True in edit mode — lets a step adjust copy/affordances if it must (none do
  // today, but it keeps the seam honest).
  isEdit: boolean;
};

const CreatorSessionContext = createContext<CreatorSession | null>(null);

export function useCreatorSession(): CreatorSession {
  const ctx = useContext(CreatorSessionContext);
  if (!ctx) {
    throw new Error("useCreatorSession must be used within a CreatorSession provider");
  }
  return ctx;
}

// Value-controlled provider — the edit screen owns the avatar + mediaPicks state
// (it needs them for dirty-tracking and the save call) and passes the assembled
// session in.
export function CreatorSessionProvider({
  value,
  children,
}: {
  value: CreatorSession;
  children: ReactNode;
}) {
  return (
    <CreatorSessionContext.Provider value={value}>{children}</CreatorSessionContext.Provider>
  );
}

// Create mode: the session is the active draft. avatar + mediaPicks read off the
// draft and write back through updateActive (memory-only until an explicit
// "Save draft"), exactly as the steps did before this seam existed.
export function DraftCreatorSession({ children }: { children: ReactNode }) {
  const draft = useActiveDraft();
  const value = useMemo<CreatorSession>(() => {
    const avatar: SessionAvatar = draft?.avatar
      ? {
          kind: "local",
          localUri: draft.avatar.localUri,
          width: draft.avatar.width,
          height: draft.avatar.height,
        }
      : { kind: "none" };
    return {
      avatar,
      setLocalAvatar: (a) =>
        usePersonaDraftStore.getState().updateActive({ avatar: a }),
      removeAvatar: () =>
        usePersonaDraftStore.getState().updateActive({ avatar: null }),
      mediaPicks: draft?.mediaPicks ?? [],
      setMediaPicks: (next) =>
        usePersonaDraftStore.getState().updateActive({ mediaPicks: next }),
      isEdit: false,
    };
  }, [draft]);

  return (
    <CreatorSessionContext.Provider value={value}>{children}</CreatorSessionContext.Provider>
  );
}
