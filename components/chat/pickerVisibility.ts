// pickerVisibility
//
// The composer has two bottom surfaces — the meme strip and the GIF drawer —
// that share one conceptual slot with each other and with the system keyboard.
// At most one may be open at a time. These pure transitions are the single
// source of truth for that mutual exclusion; the chat screen wires its toggle /
// dismiss handlers to them (and layers the side effects — keyboard dismiss,
// composer focus — on top based on the result).
//
// Kept framework-free so the open/close logic is unit-tested without rendering
// React Native (see the repo's jest setup, which exercises pure modules only).

export type PickerVisibility = {
  memesOpen: boolean;
  gifsOpen: boolean;
};

// Both surfaces shut — the resting state and the target of every dismiss.
export const PICKERS_CLOSED: PickerVisibility = {
  memesOpen: false,
  gifsOpen: false,
};

// Toggle the meme strip. Opening it always closes the GIF drawer (mutual
// exclusion); tapping it again while open closes everything.
export function toggleMemes(state: PickerVisibility): PickerVisibility {
  return state.memesOpen
    ? PICKERS_CLOSED
    : { memesOpen: true, gifsOpen: false };
}

// Toggle the GIF drawer — the mirror of toggleMemes.
export function toggleGifs(state: PickerVisibility): PickerVisibility {
  return state.gifsOpen
    ? PICKERS_CLOSED
    : { memesOpen: false, gifsOpen: true };
}

// Dismiss any open surface. Used by the tap-away overlay over the thread, by
// send, by opening the rot-level sheet, and by the composer regaining focus —
// all of which should leave both surfaces shut regardless of prior state.
export function dismissPickers(): PickerVisibility {
  return PICKERS_CLOSED;
}

// Whether any surface is open. Drives the tap-away overlay's presence and
// "should a tap on the thread be intercepted to dismiss" decision.
export function anyPickerOpen(state: PickerVisibility): boolean {
  return state.memesOpen || state.gifsOpen;
}
