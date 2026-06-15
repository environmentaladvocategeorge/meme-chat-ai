import { createDraft, type PersonaDraft } from "../personaDrafts";
import { publishPersonaDraft, type PublishDeps } from "../publishPersona";

function draftWithAvatar(): PersonaDraft {
  const d = createDraft("chaos_goblin");
  return { ...d, avatar: { localUri: "file://a.jpg", width: 96, height: 96 } };
}

function deps(overrides: Partial<PublishDeps> = {}): PublishDeps {
  return {
    uploadAvatar: jest.fn(async () => ({ url: "https://x/a.jpg", path: "personaAvatars/uid/a.jpg" })),
    savePersona: jest.fn(async () => ({ personaId: "user_uid_1" })),
    ...overrides,
  };
}

describe("publishPersonaDraft", () => {
  it("uploads the avatar then saves, returning the new id", async () => {
    const d = deps();
    const result = await publishPersonaDraft(draftWithAvatar(), d);
    expect(d.uploadAvatar).toHaveBeenCalledWith("file://a.jpg");
    expect(d.savePersona).toHaveBeenCalledWith(
      expect.objectContaining({ avatar: { url: "https://x/a.jpg", path: "personaAvatars/uid/a.jpg" } }),
    );
    expect(result).toEqual({ ok: true, personaId: "user_uid_1" });
  });

  it("skips the upload when the draft has no avatar", async () => {
    const d = deps();
    await publishPersonaDraft(createDraft("deadpan_bestie"), d);
    expect(d.uploadAvatar).not.toHaveBeenCalled();
    expect(d.savePersona).toHaveBeenCalledWith(
      expect.not.objectContaining({ avatar: expect.anything() }),
    );
  });

  it("classifies a moderation rejection", async () => {
    const d = deps({
      savePersona: jest.fn(async () => {
        throw new Error("persona_rejected");
      }),
    });
    expect(await publishPersonaDraft(createDraft(null), d)).toEqual({ ok: false, reason: "rejected" });
  });

  it("classifies a retryable moderation outage", async () => {
    const d = deps({
      savePersona: jest.fn(async () => {
        throw new Error("moderation_unavailable");
      }),
    });
    expect(await publishPersonaDraft(createDraft(null), d)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("classifies the cap and generic errors", async () => {
    expect(
      await publishPersonaDraft(
        createDraft(null),
        deps({ savePersona: jest.fn(async () => { throw new Error("persona_limit_reached"); }) }),
      ),
    ).toEqual({ ok: false, reason: "limit" });

    expect(
      await publishPersonaDraft(
        createDraft(null),
        deps({ savePersona: jest.fn(async () => { throw new Error("network down"); }) }),
      ),
    ).toEqual({ ok: false, reason: "error" });
  });

  it("treats an avatar upload failure as a generic error (save not attempted)", async () => {
    const save = jest.fn();
    const result = await publishPersonaDraft(draftWithAvatar(), {
      uploadAvatar: jest.fn(async () => { throw new Error("upload-failed"); }),
      savePersona: save as never,
    });
    expect(result).toEqual({ ok: false, reason: "error" });
    expect(save).not.toHaveBeenCalled();
  });
});
