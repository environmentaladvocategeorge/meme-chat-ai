import type { PersonaFormValues } from "../personaForm";
import { PERSONA_TEMPLATES } from "../personaTemplates";
import { savePersonaEdit, type SavePersonaEditDeps } from "../savePersonaEdit";

const PERSONA_ID = "user_uid_a1";

function values(): PersonaFormValues {
  return { ...PERSONA_TEMPLATES[0].values };
}

function deps(overrides: Partial<SavePersonaEditDeps> = {}): SavePersonaEditDeps {
  return {
    uploadAvatar: jest.fn(async () => ({ url: "https://x/new.jpg", path: "personaAvatars/uid/new.jpg" })),
    savePersona: jest.fn(async () => ({ personaId: PERSONA_ID })),
    ...overrides,
  };
}

describe("savePersonaEdit", () => {
  it("keep: saves with the personaId, no avatar arg, no removeAvatar, no upload", async () => {
    const d = deps();
    const result = await savePersonaEdit(PERSONA_ID, values(), { kind: "keep" }, d);

    expect(d.uploadAvatar).not.toHaveBeenCalled();
    expect(d.savePersona).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: PERSONA_ID }),
    );
    const arg = (d.savePersona as jest.Mock).mock.calls[0][0];
    expect(arg).not.toHaveProperty("avatar");
    expect(arg).not.toHaveProperty("removeAvatar");
    expect(result).toEqual({ ok: true, personaId: PERSONA_ID });
  });

  it("replace: uploads the new local image and sends it as the avatar arg", async () => {
    const d = deps();
    await savePersonaEdit(PERSONA_ID, values(), { kind: "replace", localUri: "file://new.jpg" }, d);

    expect(d.uploadAvatar).toHaveBeenCalledWith("file://new.jpg");
    const arg = (d.savePersona as jest.Mock).mock.calls[0][0];
    expect(arg.avatar).toEqual({ url: "https://x/new.jpg", path: "personaAvatars/uid/new.jpg" });
    expect(arg).not.toHaveProperty("removeAvatar");
  });

  it("remove: sends removeAvatar without uploading anything", async () => {
    const d = deps();
    await savePersonaEdit(PERSONA_ID, values(), { kind: "remove" }, d);

    expect(d.uploadAvatar).not.toHaveBeenCalled();
    const arg = (d.savePersona as jest.Mock).mock.calls[0][0];
    expect(arg.removeAvatar).toBe(true);
    expect(arg).not.toHaveProperty("avatar");
  });

  it("classifies save failures the same way the publish flow does", async () => {
    const cases: Array<[string, string]> = [
      ["persona_rejected", "rejected"],
      ["moderation_unavailable", "unavailable"],
      ["persona_limit_reached", "limit"],
      ["network down", "error"],
    ];
    for (const [message, reason] of cases) {
      const d = deps({
        savePersona: jest.fn(async () => {
          throw new Error(message);
        }),
      });
      expect(await savePersonaEdit(PERSONA_ID, values(), { kind: "keep" }, d)).toEqual({
        ok: false,
        reason,
      });
    }
  });

  it("treats an avatar upload failure as a generic error (save not attempted)", async () => {
    const save = jest.fn();
    const result = await savePersonaEdit(
      PERSONA_ID,
      values(),
      { kind: "replace", localUri: "file://new.jpg" },
      {
        uploadAvatar: jest.fn(async () => {
          throw new Error("upload-failed");
        }),
        savePersona: save as never,
      },
    );
    expect(result).toEqual({ ok: false, reason: "error" });
    expect(save).not.toHaveBeenCalled();
  });
});
