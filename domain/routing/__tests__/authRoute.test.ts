import { decideAuthRoute, type AuthRouteFacts } from "../authRoute";

function facts(overrides: Partial<AuthRouteFacts> = {}): AuthRouteFacts {
  return {
    appReady: true,
    ageGatePassed: true,
    atAgeGate: false,
    isAuthenticated: false,
    onboardingCompleted: false,
    needsEmailVerification: false,
    atLanding: false,
    inAuth: false,
    inOnboarding: false,
    atVerifyEmail: false,
    ...overrides,
  };
}

describe("decideAuthRoute", () => {
  it("never redirects before the app is ready", () => {
    expect(decideAuthRoute(facts({ appReady: false, isAuthenticated: true }))).toBeNull();
  });

  describe("age gate outranks everything", () => {
    it("routes to /age-gate when not passed and not already there", () => {
      expect(decideAuthRoute(facts({ ageGatePassed: false }))).toEqual({
        kind: "path",
        href: "/age-gate",
      });
    });
    it("stays put when already at the age gate", () => {
      expect(decideAuthRoute(facts({ ageGatePassed: false, atAgeGate: true }))).toBeNull();
    });
  });

  describe("signed out", () => {
    it("sends a signed-out user off a protected screen back to /", () => {
      expect(decideAuthRoute(facts({ inOnboarding: true }))).toEqual({
        kind: "path",
        href: "/",
      });
    });
    it("lets them stay on landing or an auth route", () => {
      expect(decideAuthRoute(facts({ atLanding: true }))).toBeNull();
      expect(decideAuthRoute(facts({ inAuth: true }))).toBeNull();
    });
  });

  describe("email verification gate", () => {
    it("routes an unverified user to verify-email", () => {
      expect(
        decideAuthRoute(facts({ isAuthenticated: true, needsEmailVerification: true })),
      ).toEqual({ kind: "path", href: "/auth/verify-email" });
    });
    it("stays put once already on verify-email", () => {
      expect(
        decideAuthRoute(
          facts({ isAuthenticated: true, needsEmailVerification: true, atVerifyEmail: true }),
        ),
      ).toBeNull();
    });
  });

  describe("authenticated routing", () => {
    it("moves an onboarded user off landing/auth to /chat", () => {
      expect(
        decideAuthRoute(facts({ isAuthenticated: true, onboardingCompleted: true, atLanding: true })),
      ).toEqual({ kind: "path", href: "/chat" });
    });
    it("moves a not-yet-onboarded user off landing to /onboarding", () => {
      expect(
        decideAuthRoute(facts({ isAuthenticated: true, atLanding: true })),
      ).toEqual({ kind: "path", href: "/onboarding" });
    });
    it("pushes an onboarded user out of /onboarding to /chat", () => {
      expect(
        decideAuthRoute(facts({ isAuthenticated: true, onboardingCompleted: true, inOnboarding: true })),
      ).toEqual({ kind: "path", href: "/chat" });
    });
    it("pushes a not-onboarded user into /onboarding from a stray screen", () => {
      expect(decideAuthRoute(facts({ isAuthenticated: true }))).toEqual({
        kind: "path",
        href: "/onboarding",
      });
    });
    it("leaves an onboarded user already in /chat alone (idempotent)", () => {
      expect(
        decideAuthRoute(facts({ isAuthenticated: true, onboardingCompleted: true })),
      ).toBeNull();
    });
  });
});
