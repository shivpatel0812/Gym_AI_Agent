import { Platform } from "react-native";
import { initializeApp, getApps } from "firebase/app";
import { initializeAuth, getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { expoConfig } from "./config";

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

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    "Error: Firebase configuration is missing. Please set EXPO_PUBLIC_FIREBASE_* environment variables."
  );
}

const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

function createAuth() {
  if (Platform.OS === "web") {
    return getAuth(app);
  }

  try {
    // RN-only export. Do not import this from "firebase/auth" at the top level —
    // Metro/web bundles omit it and crash with "is not a function".
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getReactNativePersistence } = require("@firebase/auth/dist/rn/index.js");
    return initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch (error: any) {
    if (error?.code === "auth/already-initialized") {
      return getAuth(app);
    }
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
export default app;
