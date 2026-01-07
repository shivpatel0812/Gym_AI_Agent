import { Platform } from "react-native";

const getConfig = () => {
  // Get values from environment variables first (required for production)
  const getEnvVar = (key: string, fallback?: string) => {
    const value = process.env[key];
    if (!value && !fallback) {
      console.warn(`Warning: ${key} not set in environment variables`);
    }
    return value || fallback;
  };

  if (Platform.OS === "web") {
    return {
      expoConfig: {
        extra: {
          apiBaseUrl: getEnvVar(
            "EXPO_PUBLIC_API_BASE_URL",
            "https://gymaiagent-production.up.railway.app"
          ),
          firebaseApiKey: getEnvVar("EXPO_PUBLIC_FIREBASE_API_KEY"),
          firebaseAuthDomain: getEnvVar("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN"),
          firebaseProjectId: getEnvVar("EXPO_PUBLIC_FIREBASE_PROJECT_ID"),
          firebaseStorageBucket: getEnvVar(
            "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET"
          ),
          firebaseMessagingSenderId: getEnvVar(
            "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
          ),
          firebaseAppId: getEnvVar("EXPO_PUBLIC_FIREBASE_APP_ID"),
        },
      },
    };
  }

  try {
    const Constants = require("expo-constants");
    const config = Constants.default || Constants;

    // Ensure API URL is not localhost - force Railway URL if localhost detected
    if (config?.expoConfig?.extra?.apiBaseUrl?.includes("localhost")) {
      console.warn(
        "Detected localhost in API URL, overriding with Railway URL"
      );
      config.expoConfig.extra.apiBaseUrl =
        process.env.EXPO_PUBLIC_API_BASE_URL ||
        "https://gymaiagent-production.up.railway.app";
    }

    return config;
  } catch (e) {
    // Fallback if expo-constants fails
    return {
      expoConfig: {
        extra: {
          apiBaseUrl: getEnvVar(
            "EXPO_PUBLIC_API_BASE_URL",
            "https://gymaiagent-production.up.railway.app"
          ),
          firebaseApiKey: getEnvVar("EXPO_PUBLIC_FIREBASE_API_KEY"),
          firebaseAuthDomain: getEnvVar("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN"),
          firebaseProjectId: getEnvVar("EXPO_PUBLIC_FIREBASE_PROJECT_ID"),
          firebaseStorageBucket: getEnvVar(
            "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET"
          ),
          firebaseMessagingSenderId: getEnvVar(
            "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
          ),
          firebaseAppId: getEnvVar("EXPO_PUBLIC_FIREBASE_APP_ID"),
        },
      },
    };
  }
};

const config = getConfig();
export default config;
export const expoConfig = config.expoConfig;
