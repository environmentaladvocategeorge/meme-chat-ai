const mockVerifyIdToken = jest.fn();

jest.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

jest.mock("firebase-functions", () => ({
  logger: { warn: jest.fn(), error: jest.fn() },
}));

import { authenticateStreamRequest, getBearerToken } from "../streamAuth";

type FakeRes = {
  status: jest.Mock;
  json: jest.Mock;
  statusCode: number | null;
  body: unknown;
};

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: null,
    body: null,
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

function makeReq(authorization?: string) {
  return {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? authorization : undefined,
  };
}

// The helpers only touch req.header / res.status().json(), so the structural
// fakes above stand in for the express types.
type Req = Parameters<typeof authenticateStreamRequest>[0];
type Res = Parameters<typeof authenticateStreamRequest>[1];

async function run(authorization: string | undefined) {
  const res = makeRes();
  const uid = await authenticateStreamRequest(
    makeReq(authorization) as unknown as Req,
    res as unknown as Res,
    "test",
  );
  return { uid, res };
}

beforeEach(() => {
  mockVerifyIdToken.mockReset();
});

describe("getBearerToken", () => {
  it("extracts the token from a Bearer header", () => {
    expect(getBearerToken("Bearer abc")).toBe("abc");
  });

  it("rejects missing, non-Bearer, and empty headers", () => {
    expect(getBearerToken(undefined)).toBeNull();
    expect(getBearerToken("Basic abc")).toBeNull();
    expect(getBearerToken("Bearer ")).toBeNull();
  });
});

describe("authenticateStreamRequest", () => {
  it("returns the uid for a valid token (revocation-checked)", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "user-1" });

    const { uid, res } = await run("Bearer good-token");

    expect(uid).toBe("user-1");
    expect(mockVerifyIdToken).toHaveBeenCalledWith("good-token", true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("401s with a non-auth marker when the bearer token is missing", async () => {
    const { uid, res } = await run(undefined);

    expect(uid).toBeNull();
    expect(res.statusCode).toBe(401);
    // "missing-token" deliberately does NOT start with "auth/" — the client
    // only ends the local session on auth/-marked 401s.
    expect(res.body).toEqual({ code: "missing-token" });
  });

  it("401s with the auth/ code when the token itself is rejected", async () => {
    mockVerifyIdToken.mockRejectedValue({ code: "auth/id-token-revoked" });

    const { uid, res } = await run("Bearer revoked-token");

    expect(uid).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ code: "auth/id-token-revoked" });
  });

  it("503s when verification fails for a non-token reason (e.g. Auth backend outage)", async () => {
    mockVerifyIdToken.mockRejectedValue({ code: "auth/internal-error" });

    const { uid, res } = await run("Bearer fine-token");

    expect(uid).toBeNull();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ code: "auth-unavailable" });
  });

  it("503s on errors that carry no code at all", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("socket hang up"));

    const { uid, res } = await run("Bearer fine-token");

    expect(uid).toBeNull();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ code: "auth-unavailable" });
  });
});
