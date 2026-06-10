import { compareVersions, isUpdateRequired } from "../appVersion";

describe("compareVersions", () => {
  it("orders by major, minor, patch", () => {
    expect(compareVersions("1.0.4", "1.0.3")).toBe(1);
    expect(compareVersions("1.0.3", "1.0.4")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.4", "1.0.4")).toBe(0);
  });

  it("treats missing trailing segments as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0")).toBe(1);
    expect(compareVersions("1", "1.0.0")).toBe(0);
  });

  it("does not throw on non-numeric segments (counts them as zero)", () => {
    expect(compareVersions("1.0.x", "1.0.0")).toBe(0);
    expect(compareVersions("", "")).toBe(0);
  });
});

describe("isUpdateRequired", () => {
  it("requires an update when installed is below the floor", () => {
    expect(
      isUpdateRequired({ installedVersion: "1.0.3", minRequiredVersion: "1.0.4" }),
    ).toBe(true);
  });

  it("allows entry when installed meets or exceeds the floor", () => {
    expect(
      isUpdateRequired({ installedVersion: "1.0.4", minRequiredVersion: "1.0.4" }),
    ).toBe(false);
    expect(
      isUpdateRequired({ installedVersion: "1.1.0", minRequiredVersion: "1.0.4" }),
    ).toBe(false);
  });

  it("fails open when either version is missing or empty", () => {
    expect(
      isUpdateRequired({ installedVersion: null, minRequiredVersion: "1.0.4" }),
    ).toBe(false);
    expect(
      isUpdateRequired({ installedVersion: "1.0.3", minRequiredVersion: null }),
    ).toBe(false);
    expect(
      isUpdateRequired({ installedVersion: "1.0.3", minRequiredVersion: "" }),
    ).toBe(false);
  });
});
