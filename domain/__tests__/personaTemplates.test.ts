import { isPersonaFormValid, toPersonaSavePayload } from "../personaForm";
import { findTemplate, PERSONA_TEMPLATES } from "../personaTemplates";

describe("PERSONA_TEMPLATES", () => {
  it("ships exactly the 6 archetypes with unique ids and a glyph", () => {
    expect(PERSONA_TEMPLATES).toHaveLength(6);
    const ids = PERSONA_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(6);
    for (const t of PERSONA_TEMPLATES) {
      expect(t.glyph.length).toBeGreaterThan(0);
    }
  });

  it("every template is a COMPLETE, valid form (publishable as-is)", () => {
    for (const t of PERSONA_TEMPLATES) {
      expect(isPersonaFormValid(t.values)).toBe(true);
    }
  });

  it("every template maps to a backend payload with all required pieces", () => {
    for (const t of PERSONA_TEMPLATES) {
      const payload = toPersonaSavePayload(t.values);
      expect(payload.displayName.length).toBeGreaterThan(0);
      expect(payload.identity.length).toBeGreaterThan(0);
      expect(payload.greetingShapes.length).toBeGreaterThan(0);
      expect(payload.humorTypes.length).toBeGreaterThan(0);
      expect(payload.humorExampleShapes.length).toBeGreaterThan(0);
      expect(payload.emojiPalette.length).toBeGreaterThan(0);
      expect(payload.publicConfig.shortDescription.length).toBeGreaterThan(0);
    }
  });

  it("findTemplate resolves by id and returns undefined otherwise", () => {
    expect(findTemplate("chaos_goblin")?.values.displayName).toBe("Chaos Goblin");
    expect(findTemplate("nope")).toBeUndefined();
  });
});
