// Pure reducer for the auth/onboarding routing decision.
//
// Every root stack screen is registered unconditionally. This reducer is
// the SOLE authority for auth/onboarding routing — the dispatcher in
// app/_layout.tsx is the only place that calls router.replace for these
// transitions. Screens only mutate state; the reducer routes.
//
// Behavior:
//   1. Never redirect while !appReady.
//   2. Signed-out users may only stay on "/" or auth routes.
//   3. Authenticated email/password users with unverified email go to
//      /auth/verify-email.
//   4. Authenticated users cannot stay on "/" or /auth/*; they go to
//      /chat if onboarded, /onboarding otherwise.
//
// Returning null means "stay where you are." Naturally idempotent.

export type AuthRouteFacts = {
  appReady: boolean;
  isAuthenticated: boolean;
  onboardingCompleted: boolean;
  needsEmailVerification: boolean;
  atLanding: boolean;
  inAuth: boolean;
  inOnboarding: boolean;
  atVerifyEmail: boolean;
};

export type AuthRouteTarget = { kind: "path"; href: string };

export function decideAuthRoute(facts: AuthRouteFacts): AuthRouteTarget | null {
  const {
    appReady,
    isAuthenticated,
    onboardingCompleted,
    needsEmailVerification,
    atLanding,
    inAuth,
    inOnboarding,
    atVerifyEmail,
  } = facts;

  if (!appReady) return null;

  if (!isAuthenticated) {
    if (!atLanding && !inAuth) {
      return { kind: "path", href: "/" };
    }
    return null;
  }

  if (needsEmailVerification) {
    if (!atVerifyEmail) {
      return { kind: "path", href: "/auth/verify-email" };
    }
    return null;
  }

  if (atLanding || inAuth) {
    return {
      kind: "path",
      href: onboardingCompleted ? "/chat" : "/onboarding",
    };
  }

  if (onboardingCompleted && inOnboarding) {
    return { kind: "path", href: "/chat" };
  }

  if (!onboardingCompleted && !inOnboarding) {
    return { kind: "path", href: "/onboarding" };
  }

  return null;
}
