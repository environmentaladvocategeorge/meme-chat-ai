import { shouldBumpOnContentSizeChange } from "@/components/chat/BubbleGradientContext";

describe("shouldBumpOnContentSizeChange", () => {
  it("suppresses content-size measure ticks while a reply is streaming", () => {
    // Every delta flush resizes the list content (~10×/sec); re-measuring all
    // gradient bubbles that often is the render loop this gate removes. One
    // bump fires on the streaming → idle/error transition instead.
    expect(shouldBumpOnContentSizeChange("streaming")).toBe(false);
  });

  it("allows ticks when idle or errored", () => {
    expect(shouldBumpOnContentSizeChange("idle")).toBe(true);
    expect(shouldBumpOnContentSizeChange("error")).toBe(true);
  });
});
