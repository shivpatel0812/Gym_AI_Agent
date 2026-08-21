import { Platform } from "react-native";
import { initializeApp, getApps } from "firebase/app";
import { initializeAuth, getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { firebaseConfig } from "./config";

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error(
    "Firebase configuration is missing. Set the EXPO_PUBLIC_FIREBASE_* environment variables."
  );
}

const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

function createAuth() {
  if (Platform.OS === "web") {
    return getAuth(app);
  }

  try {
    // Metro resolves the package's "react-native" export condition, and that is
    // the only build shipping getReactNativePersistence. It must stay a runtime
    // require: a top-level import would resolve to the browser build on
    // react-native-web, where the export doesn't exist.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getReactNativePersistence } = require("firebase/auth");
    if (typeof getReactNativePersistence !== "function") {
      // Newer SDKs may persist via AsyncStorage on their own.
      return getAuth(app);
    }
    return initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch (error: any) {
    if (error?.code === "auth/already-initialized") {
      return getAuth(app);
    }
    console.warn("Falling back to default auth persistence:", error?.message);
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
export default app;
