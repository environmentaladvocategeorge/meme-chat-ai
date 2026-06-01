const mockGetIdToken = jest.fn();

jest.mock("../app", () => ({
  getFirebaseServices: () => ({
    available: true,
    services: {
      auth: { currentUser: { getIdToken: mockGetIdToken } },
    },
  }),
}));

// `../app` is mocked above (jest hoists it), so importing the real streamAgent
// here is safe — it won't pull in the Firebase SDK / native AsyncStorage.
import { SessionExpiredError } from "../sessionErrors";
import { streamAgentAnswer } from "../streamAgent";
import type { StreamEvent } from "../streamAgent";

// One scripted XHR response per attempt. `startStreamAttempt` builds a fresh
// XMLHttpRequest for every attempt, so the Nth request consumes the Nth script
// entry — letting a test drive "401 then 200" across a retry.
type ScriptedResponse =
  | { status: number; body?: string }
  | { networkError: true };

class FakeXHR {
  static script: ScriptedResponse[] = [];
  static instances: FakeXHR[] = [];

  status = 0;
  responseText = "";
  method = "";
  requestUrl = "";
  headers: Record<string, string> = {};
  aborted = false;

  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.requestUrl = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send() {
    const resp = FakeXHR.script.shift();
    // Mirror a real XHR: callbacks fire on a later microtask, not inline.
    void Promise.resolve().then(() => {
      if (this.aborted) return;
      if (!resp) {
        this.status = 500;
        this.onload?.();
        return;
      }
      if ("networkError" in resp) {
        this.onerror?.();
        return;
      }
      this.status = resp.status;
      this.responseText = resp.body ?? "";
      this.onload?.();
    });
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

const SSE_OK_BODY =
  'event: delta\ndata: {"text":"yo"}\n\nevent: done\ndata: {}\n\n';

async function collect(
  iterable: AsyncIterable<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

beforeEach(() => {
  mockGetIdToken.mockReset();
  FakeXHR.script = [];
  FakeXHR.instances = [];
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = "test-project";
});

describe("streamAgentAnswer auth handling", () => {
  it("streams with the cached token and never force-refreshes on success", async () => {
    mockGetIdToken.mockImplementation((force?: boolean) =>
      Promise.resolve(force ? "tok-fresh" : "tok-cached"),
    );
    FakeXHR.script = [{ status: 200, body: SSE_OK_BODY }];

    const events = await collect(streamAgentAnswer({ message: "hi" }));

    expect(events).toEqual([
      { type: "delta", text: "yo" },
      { type: "done" },
    ]);
    expect(FakeXHR.instances).toHaveLength(1);
    expect(FakeXHR.instances[0].headers.Authorization).toBe("Bearer tok-cached");
    // Called exactly once, without forcing a refresh.
    expect(mockGetIdToken).toHaveBeenCalledTimes(1);
    expect(mockGetIdToken.mock.calls[0][0]).toBeFalsy();
  });

  it("force-refreshes and replays once when the first attempt 401s", async () => {
    mockGetIdToken.mockImplementation((force?: boolean) =>
      Promise.resolve(force ? "tok-fresh" : "tok-cached"),
    );
    FakeXHR.script = [
      { status: 401, body: "" },
      { status: 200, body: SSE_OK_BODY },
    ];

    const events = await collect(streamAgentAnswer({ message: "hi" }));

    expect(events).toEqual([
      { type: "delta", text: "yo" },
      { type: "done" },
    ]);
    expect(FakeXHR.instances).toHaveLength(2);
    expect(FakeXHR.instances[0].headers.Authorization).toBe("Bearer tok-cached");
    // The replay carries the freshly forced token.
    expect(FakeXHR.instances[1].headers.Authorization).toBe("Bearer tok-fresh");
    expect(mockGetIdToken).toHaveBeenCalledTimes(2);
    expect(mockGetIdToken.mock.calls[1][0]).toBe(true);
  });

  it("surfaces SessionExpiredError after a 401 replay also 401s (no third attempt)", async () => {
    mockGetIdToken.mockImplementation((force?: boolean) =>
      Promise.resolve(force ? "tok-fresh" : "tok-cached"),
    );
    FakeXHR.script = [
      { status: 401, body: "" },
      { status: 401, body: "" },
    ];

    await expect(collect(streamAgentAnswer({ message: "hi" }))).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    // Exactly one replay — no runaway loop.
    expect(FakeXHR.instances).toHaveLength(2);
  });

  it("surfaces SessionExpiredError when the forced refresh itself fails", async () => {
    mockGetIdToken.mockImplementation((force?: boolean) =>
      force ? Promise.reject(new Error("refresh failed")) : Promise.resolve("tok-cached"),
    );
    FakeXHR.script = [{ status: 401, body: "" }];

    await expect(collect(streamAgentAnswer({ message: "hi" }))).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    // Only the first attempt ran; the refresh blew up before any replay.
    expect(FakeXHR.instances).toHaveLength(1);
  });

  it("maps a terminal auth error from the initial getIdToken to SessionExpiredError", async () => {
    mockGetIdToken.mockRejectedValue({ code: "auth/user-token-expired" });

    await expect(collect(streamAgentAnswer({ message: "hi" }))).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    // No request is ever sent — the session was already dead.
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("propagates a non-terminal getIdToken error as a generic (retryable) error", async () => {
    mockGetIdToken.mockRejectedValue({ code: "auth/network-request-failed" });

    const promise = collect(streamAgentAnswer({ message: "hi" }));
    await expect(promise).rejects.not.toBeInstanceOf(SessionExpiredError);
    await expect(promise).rejects.toMatchObject({
      code: "auth/network-request-failed",
    });
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("does not retry a non-401 HTTP error", async () => {
    mockGetIdToken.mockResolvedValue("tok-cached");
    FakeXHR.script = [{ status: 500, body: "" }];

    const promise = collect(streamAgentAnswer({ message: "hi" }));
    await expect(promise).rejects.not.toBeInstanceOf(SessionExpiredError);
    await expect(promise).rejects.toThrow("stream-failed-500");
    expect(FakeXHR.instances).toHaveLength(1);
  });
});
