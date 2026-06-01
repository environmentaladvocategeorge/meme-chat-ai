// A terminal authentication failure: the user's session can no longer be
// silently refreshed (the ID token was rejected by the backend even after a
// forced refresh, or the refresh token itself is expired/revoked/disabled).
//
// This is deliberately distinct from a generic stream/network error: the UI
// must NOT offer a "Retry" for it (replaying the same dead session is useless
// and misleading) and should instead route the user to sign in again.
//
// It lives in its own dependency-free module so consumers (the chat store) and
// tests can import the class without pulling in the Firebase SDK that
// streamAgent.ts depends on.
export class SessionExpiredError extends Error {
  constructor(message = "session-expired") {
    super(message);
    this.name = "SessionExpiredError";
  }
}
