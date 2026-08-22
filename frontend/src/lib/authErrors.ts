/**
 * Firebase auth errors, in plain language.
 *
 * `err.message` from the SDK reads like "Firebase: Error (auth/invalid-credential)."
 * which looks like a crash to a user and reads as an unfinished app to an App
 * Review tester. Everything unrecognised falls back to a neutral sentence
 * rather than leaking the raw SDK string.
 */

const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "That doesn't look like a valid email address.",
  "auth/user-disabled": "This account has been disabled. Contact support if you think that's a mistake.",
  "auth/user-not-found": "No account found with that email. Double-check it, or sign up.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/invalid-login-credentials": "Incorrect email or password.",
  "auth/email-already-in-use": "An account already exists with that email. Try signing in instead.",
  "auth/weak-password": "Please choose a password with at least 6 characters.",
  "auth/missing-password": "Please enter your password.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/network-request-failed": "Couldn't reach the server. Check your connection and try again.",
  "auth/requires-recent-login": "For security, please sign in again before making this change.",
  "auth/operation-not-allowed": "Email sign-in isn't enabled for this app right now.",
};

export function friendlyAuthError(error: any): string {
  const code = error?.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (__DEV__ && error?.message) {
    console.warn("Unmapped auth error:", code, error.message);
  }
  return "Something went wrong. Please try again.";
}

/** Message for a failed API call, preferring the server's own wording. */
export function friendlyApiError(error: any, fallback = "Something went wrong. Please try again."): string {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (detail?.message) return detail.message;
  if (error?.message === "Network Error" || !error?.response) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return fallback;
}
