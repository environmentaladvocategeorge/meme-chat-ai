import { stripMemeArtifacts } from "@/domain/agentText";

describe("stripMemeArtifacts", () => {
  it("leaves clean prose untouched (aside from trimming)", () => {
    expect(stripMemeArtifacts("just a normal reply")).toBe("just a normal reply");
  });

  it("removes markdown image embeds", () => {
    expect(
      stripMemeArtifacts("here you go ![a meme](https://cdn.example/x.webp)"),
    ).toBe("here you go");
  });

  it("removes markdown links pointing at attachment:// urls", () => {
    expect(
      stripMemeArtifacts("look [this one](attachment://abc123) lol"),
    ).toBe("look  lol");
  });

  it("is case-insensitive for attachment links", () => {
    expect(
      stripMemeArtifacts("x [y](ATTACHMENT://Z) w"),
    ).toBe("x  w");
  });

  it("removes bare attachment:// placeholders", () => {
    expect(stripMemeArtifacts("vibes attachment://meme-42 ok")).toBe(
      "vibes  ok",
    );
  });

  it("collapses 3+ blank lines down to a single blank line", () => {
    expect(stripMemeArtifacts("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("strips trailing whitespace on each line", () => {
    expect(stripMemeArtifacts("a   \nb\t")).toBe("a\nb");
  });

  it("trims leading/trailing whitespace overall", () => {
    expect(stripMemeArtifacts("   hello   ")).toBe("hello");
  });

  it("handles a message that is nothing but an artifact", () => {
    expect(stripMemeArtifacts("![](attachment://x)")).toBe("");
  });

  it("returns an empty string for empty input", () => {
    expect(stripMemeArtifacts("")).toBe("");
  });
});
