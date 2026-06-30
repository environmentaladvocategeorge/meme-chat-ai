jest.mock("firebase/firestore", () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  getDocs: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn(),
  startAfter: jest.fn(),
  where: jest.fn(),
}));

jest.mock("../app", () => ({
  getFirebaseServices: () => ({ available: false }),
}));

import { mapConversation, mapMessage } from "../conversations";

const ts = (ms: number) => ({ toDate: () => new Date(ms) });

const klipyImage = {
  id: "img-1",
  source: "klipy",
  url: "https://static.klipy.com/a.webp",
  previewUrl: "https://static.klipy.com/a-p.webp",
};

describe("mapMessage", () => {
  it("maps a complete agent reply", () => {
    const m = mapMessage("s1", {
      role: "agent",
      text: "hi there",
      status: "complete",
      createdAt: ts(1000),
      inReplyToClientMessageId: "c1",
    });
    expect(m).toMatchObject({
      id: "s1",
      role: "agent",
      text: "hi there",
      status: "complete",
      inReplyToClientMessageId: "c1",
    });
    expect(m?.createdAt).toBeInstanceOf(Date);
  });

  it("drops an empty streaming placeholder (no text, no attachments)", () => {
    expect(
      mapMessage("s1", { role: "agent", text: "", status: "streaming" }),
    ).toBeNull();
  });

  it("keeps an attachment-only complete message with empty text", () => {
    const m = mapMessage("s1", {
      role: "user",
      text: "",
      status: "complete",
      images: [klipyImage],
    });
    expect(m).not.toBeNull();
    expect(m?.images).toHaveLength(1);
  });

  it("returns null for a bad role or bad status", () => {
    expect(mapMessage("s1", { role: "system", text: "x", status: "complete" })).toBeNull();
    expect(mapMessage("s1", { role: "agent", text: "x", status: "weird" })).toBeNull();
  });

  it("filters out malformed image entries", () => {
    const m = mapMessage("s1", {
      role: "user",
      text: "look",
      status: "complete",
      images: [klipyImage, { id: 5 }, { source: "klipy" }],
    });
    expect(m?.images).toHaveLength(1);
  });

  it("maps persisted stickers and carries optional title", () => {
    const m = mapMessage("s1", {
      role: "user",
      text: "",
      status: "complete",
      stickers: [
        {
          id: "st-1",
          source: "klipy-sticker",
          url: "https://static.klipy.com/s.webp",
          previewUrl: "https://static.klipy.com/s.png",
          title: "rawr",
          stickerId: "st-1",
        },
      ],
    });
    expect(m?.stickers).toHaveLength(1);
    expect(m?.stickers?.[0]).toMatchObject({
      id: "st-1",
      source: "klipy-sticker",
      title: "rawr",
    });
  });

  it("filters out malformed sticker entries", () => {
    const m = mapMessage("s1", {
      role: "user",
      text: "look",
      status: "complete",
      stickers: [
        {
          id: "st-1",
          source: "klipy-sticker",
          url: "https://static.klipy.com/s.webp",
          previewUrl: "https://static.klipy.com/s.png",
        },
        { id: 5 },
        { source: "klipy-sticker" },
        // Wrong discriminant — a GIF must not slip into stickers.
        {
          id: "g1",
          source: "klipy-gif",
          url: "https://static.klipy.com/g.webp",
          previewUrl: "https://static.klipy.com/g.jpg",
        },
      ],
    });
    expect(m?.stickers).toHaveLength(1);
  });

  it("keeps a sticker-only complete message with empty text", () => {
    const m = mapMessage("s1", {
      role: "user",
      text: "",
      status: "complete",
      stickers: [
        {
          id: "st-1",
          source: "klipy-sticker",
          url: "https://static.klipy.com/s.webp",
          previewUrl: "https://static.klipy.com/s.png",
        },
      ],
    });
    expect(m).not.toBeNull();
    expect(m?.stickers).toHaveLength(1);
  });

  it("shapes a valid persona and ignores a partial one", () => {
    const full = {
      id: "p1",
      name: "Brainrot Bot",
      slug: "brainrot",
      displayName: "Brainrot Bot",
      avatarKey: "k",
    };
    const withPersona = mapMessage("s1", {
      role: "agent",
      text: "x",
      status: "complete",
      persona: full,
      personaId: "p1",
    });
    expect(withPersona?.persona).toEqual(full);

    const partial = mapMessage("s1", {
      role: "agent",
      text: "x",
      status: "complete",
      persona: { id: "p1", name: "B" },
    });
    expect(partial?.persona).toBeUndefined();
  });

  it("carries reaction / emojiReaction / levelOfRot when valid, drops junk", () => {
    const m = mapMessage("s1", {
      role: "agent",
      text: "x",
      status: "complete",
      reaction: "up",
      emojiReaction: "🔥",
      levelOfRot: 3,
    });
    expect(m).toMatchObject({ reaction: "up", emojiReaction: "🔥", levelOfRot: 3 });

    const junk = mapMessage("s1", {
      role: "agent",
      text: "x",
      status: "complete",
      reaction: "sideways",
      emojiReaction: "",
      levelOfRot: "high",
    });
    expect(junk?.reaction).toBeUndefined();
    expect(junk?.emojiReaction).toBeUndefined();
    expect(junk?.levelOfRot).toBeUndefined();
  });
});

describe("mapConversation", () => {
  it("maps the summary fields with safe defaults", () => {
    const c = mapConversation("c1", {
      uid: "u1",
      title: "My chat",
      lastMessagePreview: "hey",
      updatedAt: ts(2000),
      participantPersonaIds: ["p1", 7, "p2"],
    });
    expect(c).toMatchObject({
      id: "c1",
      uid: "u1",
      title: "My chat",
      lastMessagePreview: "hey",
    });
    expect(c.updatedAt).toBeInstanceOf(Date);
    // Non-string participant ids are filtered out.
    expect(c.participantPersonaIds).toEqual(["p1", "p2"]);
  });

  it("defaults missing fields", () => {
    const c = mapConversation("c1", {});
    expect(c).toMatchObject({
      id: "c1",
      uid: "",
      title: "",
      lastMessagePreview: "",
      updatedAt: null,
      participantPersonaIds: [],
    });
  });
});
