import { useAgeGateStore } from "@/store/ageGate";
import { AgeGateStorage } from "@/store/storage";

describe("useAgeGateStore", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    useAgeGateStore.setState({
      status: "unset",
      birthDate: null,
      hydrated: false,
    });
  });

  it("persists the decision before marking the age gate as passed", async () => {
    let finishWrite: (() => void) | undefined;
    jest.spyOn(AgeGateStorage, "write").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );

    const submit = useAgeGateStore
      .getState()
      .submitBirthDate(new Date(1990, 0, 1));

    expect(useAgeGateStore.getState().status).toBe("unset");

    finishWrite?.();
    await expect(submit).resolves.toBe(true);
    expect(useAgeGateStore.getState()).toMatchObject({
      status: "passed",
      birthDate: "1990-01-01",
    });
  });

  it("leaves the gate unset when persistence fails", async () => {
    jest
      .spyOn(AgeGateStorage, "write")
      .mockRejectedValue(new Error("storage unavailable"));

    await expect(
      useAgeGateStore.getState().submitBirthDate(new Date(1990, 0, 1)),
    ).rejects.toThrow("storage unavailable");

    expect(useAgeGateStore.getState()).toMatchObject({
      status: "unset",
      birthDate: null,
    });
  });
});
