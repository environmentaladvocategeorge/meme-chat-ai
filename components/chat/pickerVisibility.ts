// pickerVisibility
//
// The composer has one bottom media surface — a tabbed drawer holding GIFs,
// memes, and stickers — that shares its slot with the system keyboard. At most
// one of {drawer, keyboard} is open at a time. These pure transitions are the
// single source of truth for the drawer's open/closed state and which tab is
// active; the chat screen wires its toggle / tab / dismiss handlers to them (and
// layers the side effects — keyboard dismiss, composer focus — on top based on
// the result).
//
// (Previously there were two mutually-exclusive surfaces, memesOpen / gifsOpen.
// Adding stickers would have made a third chip overflow the row, so the three
// were folded into one "Media" drawer with tabs — hence a single `mediaOpen`
// flag plus the active `mediaTab`.)
//
// Kept framework-free so the open/close logic is unit-tested without rendering
// React Native (see the repo's jest setup, which exercises pure modules only).

export type MediaTab = "gifs" | "memes" | "stickers";

export type PickerVisibility = {
  mediaOpen: boolean;
  // The active tab. Preserved while the drawer is closed so reopening returns to
  // the last-used tab.
  mediaTab: MediaTab;
};

// The tab the drawer opens to before the user has picked one.
export const DEFAULT_MEDIA_TAB: MediaTab = "gifs";

// Drawer shut — the resting state and the target of every dismiss.
export const PICKERS_CLOSED: PickerVisibility = {
  mediaOpen: false,
  mediaTab: DEFAULT_MEDIA_TAB,
};

// Toggle the whole media drawer open/closed via the composer's Media chip. The
// active tab is preserved so closing and reopening returns to the same tab.
export function toggleMedia(state: PickerVisibility): PickerVisibility {
  return { ...state, mediaOpen: !state.mediaOpen };
}

// Switch to a tab from the in-drawer tab bar, opening the drawer if it was shut.
// Switching is never a close — only the Media chip (toggleMedia) or a dismiss
// closes the drawer — so tapping the active tab is a no-op.
export function selectMediaTab(
  state: PickerVisibility,
  tab: MediaTab,
): PickerVisibility {
  return { mediaOpen: true, mediaTab: tab };
}

// Close the drawer, preserving the active tab. Used by the tap-away overlay, by
// send, by opening the rot-level sheet, by staging a single GIF, and by the
// composer regaining focus — all of which should leave the drawer shut.
export function dismissPickers(state: PickerVisibility): PickerVisibility {
  return { ...state, mediaOpen: false };
}

// Whether the drawer is open. Drives the tap-away overlay's presence and the
// "should a tap on the thread dismiss the drawer" decision.
export function anyPickerOpen(state: PickerVisibility): boolean {
  return state.mediaOpen;
}
