import Constants from "expo-constants";

/**
 * Resolved app configuration.
 *
 * Values come from `app.config.js` -> `expo.extra`, which reads the
 * EXPO_PUBLIC_* environment variables at build time. `process.env` is checked
 * first so a `.env` change takes effect in development without a rebuild.
 *
 * A localhost fallback is only used in development. In a release build a
 * missing API URL throws at startup rather than silently pointing the app at
 * a host that cannot exist on a user's device — that failure mode ships an app
 * that looks broken to everyone including App Review.
 */

const DEV_API_BASE_URL = "http://localhost:8000";

const extra = (Constants.expoConfig?.extra ??
  (Constants as any).manifest?.extra ??
  {}) as Record<string, string | undefined>;

function resolve(envKey: string, extraKey: string): string | undefined {
  return process.env[envKey] || extra[extraKey];
}

function resolveApiBaseUrl(): string {
  const url = resolve("EXPO_PUBLIC_API_BASE_URL", "apiBaseUrl");
  if (url) return url.replace(/\/+$/, "");
  if (__DEV__) {
    console.warn(
      `EXPO_PUBLIC_API_BASE_URL is not set — falling back to ${DEV_API_BASE_URL}`
    );
    return DEV_API_BASE_URL;
  }
  throw new Error(
    "EXPO_PUBLIC_API_BASE_URL is not set. Configure it in eas.json before building for release."
  );
}

export const API_BASE_URL = resolveApiBaseUrl();

export const firebaseConfig = {
  apiKey: resolve("EXPO_PUBLIC_FIREBASE_API_KEY", "firebaseApiKey"),
  authDomain: resolve("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", "firebaseAuthDomain"),
  projectId: resolve("EXPO_PUBLIC_FIREBASE_PROJECT_ID", "firebaseProjectId"),
  storageBucket: resolve(
    "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "firebaseStorageBucket"
  ),
  messagingSenderId: resolve(
    "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "firebaseMessagingSenderId"
  ),
  appId: resolve("EXPO_PUBLIC_FIREBASE_APP_ID", "firebaseAppId"),
};

/** Links App Review and users need to be able to reach from inside the app. */
export const legal = {
  privacyPolicyUrl:
    resolve("EXPO_PUBLIC_PRIVACY_POLICY_URL", "privacyPolicyUrl") ||
    "https://gymai.app/privacy",
  termsUrl:
    resolve("EXPO_PUBLIC_TERMS_URL", "termsUrl") || "https://gymai.app/terms",
  supportEmail:
    resolve("EXPO_PUBLIC_SUPPORT_EMAIL", "supportEmail") || "support@gymai.app",
};

/** Minimum age to create an account (Guideline 1.3 / COPPA). */
export const MINIMUM_AGE = 16;

// Kept for backwards compatibility with modules that imported `expoConfig`.
export const expoConfig = { extra: { ...extra, apiBaseUrl: API_BASE_URL } };

export default { expoConfig };
