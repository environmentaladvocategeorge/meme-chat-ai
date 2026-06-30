// useOnboardingScript
//
// The React driver for the conversational onboarding. Wraps the pure engine
// (domain/onboarding/script) with the only things React owns: the live
// transcript, the typing-indicator beat between bubbles, and persistence of the
// resume point. All branching (which answer was recorded, what bubbles a turn
// produces, how a resumed transcript is rebuilt) stays in the pure module.
//
// Lifecycle:
//   - On mount it reads the persisted { cursor, answers }. The history of turns
//     already passed is shown instantly (buildHistory); the current turn's
//     opening line(s) are then revealed with the typing animation, so a resumed
//     session lands looking at the question it's waiting on.
//   - submit() echoes the user's answer, plays the bot's reaction after a typing
//     beat, advances the cursor (persisting it), and reveals the next turn.
//   - The paywall is terminal and view-driven: its lead-in line is revealed but
//     submit() is a no-op there — the host renders PlanPaywall and calls finish.

import {
  SCRIPT,
  SCRIPT_LENGTH,
  type SubmitInput,
  type Turn,
  type TranscriptEntry,
  botLineEntries,
  buildHistory,
  entriesForAnswer,
  recordAnswer,
} from "@/domain/onboarding/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOnboardingStore } from "@/store/onboarding";

// A turn's opening bot bubbles and each reaction reveal sit behind a short
// typing beat so it reads as the bot composing, not a dump. Kept snappy — a
// slow indicator feels laggy, not human. A little jitter avoids a metronomic
// cadence across a multi-bubble turn.
const TYPING_MIN_MS = 460;
const TYPING_JITTER_MS = 260;

function typingDelay(): number {
  return TYPING_MIN_MS + Math.random() * TYPING_JITTER_MS;
}

export type OnboardingPhase = "typing" | "awaiting";

export interface UseOnboardingScript {
  // The rendered conversation so far.
  transcript: TranscriptEntry[];
  // The turn the user is currently on (or the paywall, when reached).
  currentTurn: Turn;
  // "typing" while the bot composes, "awaiting" once its input affordance is live.
  phase: OnboardingPhase;
  // 0-based index of the current turn, and the total, for a progress indicator.
  cursorIndex: number;
  total: number;
  // Submit the user's answer to the current turn (chip value or typed name).
  // No-op while the bot is typing or on the terminal paywall turn.
  submit: (input: SubmitInput) => void;
}

export function useOnboardingScript(): UseOnboardingScript {
  const setProgress = useOnboardingStore((s) => s.setProgress);

  // The cursor/answers are the source of truth for logic; mirrored into refs so
  // the async reveal sequence never reads a stale closure.
  const cursorRef = useRef(0);
  const answersRef = useRef(useOnboardingStore.getState().answers);

  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [phase, setPhase] = useState<OnboardingPhase>("typing");
  const [cursorIndex, setCursorIndex] = useState(0);

  // Cancellation guard + timer bookkeeping so an unmount mid-reveal can't append
  // to a torn-down component or leak timeouts.
  const cancelledRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const phaseRef = useRef<OnboardingPhase>("typing");

  const setPhaseBoth = useCallback((p: OnboardingPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const sleep = useCallback((ms: number) => {
    return new Promise<void>((resolve) => {
      const id = setTimeout(resolve, ms);
      timersRef.current.push(id);
    });
  }, []);

  // Reveal a turn's opening bot bubble(s) one at a time, each behind a typing
  // beat, then open the input by flipping to "awaiting".
  const revealTurn = useCallback(
    async (index: number) => {
      const turn = SCRIPT[index];
      if (!turn) {
        setPhaseBoth("awaiting");
        return;
      }
      const entries = botLineEntries(turn, `t${index}`);
      for (const entry of entries) {
        if (cancelledRef.current) return;
        setPhaseBoth("typing");
        await sleep(typingDelay());
        if (cancelledRef.current) return;
        setTranscript((prev) => [...prev, entry]);
      }
      if (cancelledRef.current) return;
      setPhaseBoth("awaiting");
    },
    [setPhaseBoth, sleep],
  );

  // Mount: seed the passed history instantly, then animate the current turn.
  useEffect(() => {
    cancelledRef.current = false;
    const { cursor, answers } = useOnboardingStore.getState();
    cursorRef.current = cursor;
    answersRef.current = answers;
    setCursorIndex(cursor);
    setTranscript(buildHistory(cursor, answers));
    void revealTurn(cursor);

    return () => {
      cancelledRef.current = true;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
    // Mount-only: the reveal reads the live store snapshot, not props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(
    (input: SubmitInput) => {
      // Guard: ignore taps while the bot is mid-typing, and never advance the
      // terminal paywall turn (it's view-driven).
      if (phaseRef.current !== "awaiting") return;
      const index = cursorRef.current;
      const turn = SCRIPT[index];
      if (!turn || turn.kind === "paywall") return;

      const [userEntry, reactionEntry] = entriesForAnswer(
        turn,
        input,
        `t${index}`,
      );
      if (!userEntry) return;

      // Echo the user's answer immediately, then advance + persist. Flip to
      // "typing" synchronously so the input zone closes at once and a fast
      // double-tap can't slip a second submit through the awaiting guard.
      setTranscript((prev) => [...prev, userEntry]);
      setPhaseBoth("typing");
      const nextAnswers = recordAnswer(answersRef.current, turn, input);
      const nextCursor = index + 1;
      answersRef.current = nextAnswers;
      cursorRef.current = nextCursor;
      setCursorIndex(nextCursor);
      setProgress(nextCursor, nextAnswers);

      void (async () => {
        if (reactionEntry) {
          setPhaseBoth("typing");
          await sleep(typingDelay());
          if (cancelledRef.current) return;
          setTranscript((prev) => [...prev, reactionEntry]);
        }
        if (cancelledRef.current) return;
        if (nextCursor < SCRIPT_LENGTH) {
          await revealTurn(nextCursor);
        } else {
          setPhaseBoth("awaiting");
        }
      })();
    },
    [revealTurn, setPhaseBoth, sleep, setProgress],
  );

  const currentTurn = SCRIPT[Math.min(cursorIndex, SCRIPT_LENGTH - 1)];

  return {
    transcript,
    currentTurn,
    phase,
    cursorIndex,
    total: SCRIPT_LENGTH,
    submit,
  };
}
