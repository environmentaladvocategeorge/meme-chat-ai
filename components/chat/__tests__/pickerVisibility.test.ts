import {
  anyPickerOpen,
  dismissPickers,
  PICKERS_CLOSED,
  toggleGifs,
  toggleMemes,
  type PickerVisibility,
} from "@/components/chat/pickerVisibility";

const CLOSED: PickerVisibility = { memesOpen: false, gifsOpen: false };
const MEMES_OPEN: PickerVisibility = { memesOpen: true, gifsOpen: false };
const GIFS_OPEN: PickerVisibility = { memesOpen: false, gifsOpen: true };

describe("toggleMemes", () => {
  it("opens the meme strip from closed", () => {
    expect(toggleMemes(CLOSED)).toEqual(MEMES_OPEN);
  });

  it("closes the meme strip when it's already open", () => {
    expect(toggleMemes(MEMES_OPEN)).toEqual(CLOSED);
  });

  it("closes the GIF drawer when opening the meme strip (mutual exclusion)", () => {
    expect(toggleMemes(GIFS_OPEN)).toEqual(MEMES_OPEN);
  });
});

describe("toggleGifs", () => {
  it("opens the GIF drawer from closed", () => {
    expect(toggleGifs(CLOSED)).toEqual(GIFS_OPEN);
  });

  it("closes the GIF drawer when it's already open", () => {
    expect(toggleGifs(GIFS_OPEN)).toEqual(CLOSED);
  });

  it("closes the meme strip when opening the GIF drawer (mutual exclusion)", () => {
    expect(toggleGifs(MEMES_OPEN)).toEqual(GIFS_OPEN);
  });
});

describe("mutual exclusion invariant", () => {
  it("never leaves both surfaces open after any toggle", () => {
    const states: PickerVisibility[] = [CLOSED, MEMES_OPEN, GIFS_OPEN];
    for (const state of states) {
      for (const next of [toggleMemes(state), toggleGifs(state)]) {
        expect(next.memesOpen && next.gifsOpen).toBe(false);
      }
    }
  });
});

describe("dismissPickers", () => {
  it("closes both surfaces (tap-away / send / open-rot / focus)", () => {
    expect(dismissPickers()).toEqual(CLOSED);
  });

  it("closes whichever surface was open", () => {
    expect(dismissPickers()).toEqual(PICKERS_CLOSED);
  });
});

describe("anyPickerOpen", () => {
  it("is false when both surfaces are shut", () => {
    expect(anyPickerOpen(CLOSED)).toBe(false);
  });

  it("is true when the meme strip is open", () => {
    expect(anyPickerOpen(MEMES_OPEN)).toBe(true);
  });

  it("is true when the GIF drawer is open", () => {
    expect(anyPickerOpen(GIFS_OPEN)).toBe(true);
  });
});
