import {
  anyPickerOpen,
  DEFAULT_MEDIA_TAB,
  dismissPickers,
  PICKERS_CLOSED,
  selectMediaTab,
  toggleMedia,
  type PickerVisibility,
} from "@/components/chat/pickerVisibility";

const CLOSED: PickerVisibility = { mediaOpen: false, mediaTab: "gifs" };
const GIFS_OPEN: PickerVisibility = { mediaOpen: true, mediaTab: "gifs" };
const STICKERS_OPEN: PickerVisibility = { mediaOpen: true, mediaTab: "stickers" };

describe("PICKERS_CLOSED", () => {
  it("is shut and defaults to the GIFs tab", () => {
    expect(PICKERS_CLOSED).toEqual({ mediaOpen: false, mediaTab: DEFAULT_MEDIA_TAB });
    expect(DEFAULT_MEDIA_TAB).toBe("gifs");
  });
});

describe("toggleMedia", () => {
  it("opens the drawer from closed, preserving the active tab", () => {
    expect(toggleMedia(CLOSED)).toEqual(GIFS_OPEN);
    expect(toggleMedia({ mediaOpen: false, mediaTab: "stickers" })).toEqual(
      STICKERS_OPEN,
    );
  });

  it("closes the drawer when it's already open, preserving the tab", () => {
    expect(toggleMedia(STICKERS_OPEN)).toEqual({
      mediaOpen: false,
      mediaTab: "stickers",
    });
  });
});

describe("selectMediaTab", () => {
  it("opens the drawer on the chosen tab from closed", () => {
    expect(selectMediaTab(CLOSED, "memes")).toEqual({
      mediaOpen: true,
      mediaTab: "memes",
    });
  });

  it("switches the active tab while staying open", () => {
    expect(selectMediaTab(GIFS_OPEN, "stickers")).toEqual(STICKERS_OPEN);
  });

  it("is a no-op (stays open on the same tab) for the active tab", () => {
    expect(selectMediaTab(STICKERS_OPEN, "stickers")).toEqual(STICKERS_OPEN);
  });
});

describe("dismissPickers", () => {
  it("closes the drawer but preserves the active tab so reopening returns to it", () => {
    expect(dismissPickers(STICKERS_OPEN)).toEqual({
      mediaOpen: false,
      mediaTab: "stickers",
    });
  });

  it("is idempotent on an already-closed drawer", () => {
    expect(dismissPickers(CLOSED)).toEqual(CLOSED);
  });
});

describe("anyPickerOpen", () => {
  it("reflects the drawer's open flag", () => {
    expect(anyPickerOpen(CLOSED)).toBe(false);
    expect(anyPickerOpen(GIFS_OPEN)).toBe(true);
    expect(anyPickerOpen(STICKERS_OPEN)).toBe(true);
  });
});
