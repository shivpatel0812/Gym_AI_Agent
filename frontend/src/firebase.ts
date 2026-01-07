import { initializeApp, getApps } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { expoConfig } from "./config";

// Get Firebase config from environment variables (prefixed with EXPO_PUBLIC_)
// Falls back to expoConfig if env vars not set
// Note: Firebase web API keys are safe to expose, but using env vars is best practice
const firebaseConfig = {
  apiKey:
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
    expoConfig?.extra?.firebaseApiKey,
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    expoConfig?.extra?.firebaseAuthDomain,
  projectId:
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
    expoConfig?.extra?.firebaseProjectId,
  storageBucket:
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    expoConfig?.extra?.firebaseStorageBucket,
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
    expoConfig?.extra?.firebaseMessagingSenderId,
  appId:
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID || expoConfig?.extra?.firebaseAppId,
};

// Validate required Firebase config
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    "Error: Firebase configuration is missing. Please set EXPO_PUBLIC_FIREBASE_* environment variables."
  );
}

// Initialize app only if it doesn't exist
const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize auth only if it doesn't exist
let authInstance;
try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
  });
} catch (error: any) {
  // If auth is already initialized, get the existing instance
  if (error.code === "auth/already-initialized") {
    authInstance = getAuth(app);
  } else {
    throw error;
  }
}

export const auth = authInstance;
export const db = getFirestore(app);
export default app;
