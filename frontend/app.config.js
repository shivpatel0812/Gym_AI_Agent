// No dotenv require: Expo CLI loads .env itself (and any EXPO_PUBLIC_* var into
// the client bundle). Requiring dotenv here also printed a banner onto stdout,
// which corrupted the JSON that `expo-doctor` parses from `expo config`.

// Bump `version` for a user-visible release — that's the number people see on
// the App Store listing.
//
// BUILD_NUMBER only seeds the very first build. eas.json sets
// `cli.appVersionSource: "remote"`, so from then on EAS tracks and increments
// the build number server-side on every production build. Don't bump it here.
const VERSION = "1.0.0";
const BUILD_NUMBER = "1";

// Publicly reachable URLs. App Store Connect requires the privacy policy URL,
// and Guideline 5.1.1 expects it to be reachable from inside the app too.
const PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || "https://gymai.app/privacy";
const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL || "https://gymai.app/terms";
const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || "support@gymai.app";

module.exports = {
  expo: {
    name: "GymAI",
    slug: "gymai",
    owner: "usershiv17274",
    version: VERSION,
    orientation: "portrait",
    // Matches the app's actual dark theme — the light value here was why the
    // splash flashed white before the first frame.
    userInterfaceStyle: "dark",
    backgroundColor: "#070708",
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#070708",
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      bundleIdentifier: "com.shivpatel.gymapp",
      buildNumber: BUILD_NUMBER,
      // The layouts are phone-only. Leaving this on invites a 2.4.1/4.0
      // rejection because App Review tests iPad builds on an iPad.
      supportsTablet: false,
      infoPlist: {
        // Answers App Store Connect's export-compliance question up front, so
        // every TestFlight upload doesn't stall waiting on it. HTTPS-only use of
        // the system's own TLS is exempt.
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          "GymAI uses your camera for meal photos and optional guided progress photos for AI body-scan coaching. Photos used for body scan are analyzed and then deleted.",
        NSPhotoLibraryUsageDescription:
          "GymAI needs photo library access so you can choose meal photos or progress photos for optional AI coaching. Body-scan photos are analyzed and then deleted.",
      },
    },
    android: {
      package: "com.shivpatel.gymapp",
      versionCode: Number(BUILD_NUMBER),
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#070708",
      },
      permissions: ["CAMERA", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE"],
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-font",
      // SDK 57 requires these as config plugins; the splash config below is
      // consumed by the plugin rather than the top-level `splash` key.
      "expo-splash-screen",
      "@react-native-community/datetimepicker",
      [
        "expo-image-picker",
        {
          photosPermission:
            "GymAI needs photo library access so you can choose meal photos or progress photos for optional AI coaching. Body-scan photos are analyzed and then deleted.",
          cameraPermission:
            "GymAI uses your camera for meal photos and optional guided progress photos for AI body-scan coaching. Photos used for body scan are analyzed and then deleted.",
        },
      ],
      // Reminders are scheduled on the device, so no push credentials are
      // needed and nothing about them leaves the phone.
      [
        "expo-notifications",
        {
          icon: "./assets/adaptive-icon.png",
          color: "#070708",
        },
      ],
    ],
    extra: {
      apiBaseUrl:
        process.env.EXPO_PUBLIC_API_BASE_URL ||
        "https://gymaiagent-production.up.railway.app",
      privacyPolicyUrl: PRIVACY_POLICY_URL,
      termsUrl: TERMS_URL,
      supportEmail: SUPPORT_EMAIL,
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      firebaseMessagingSenderId:
        process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      eas: {
        // From `eas init`. EAS can't auto-write a dynamic config, so this is
        // pinned here deliberately — it's a public identifier, not a secret.
        projectId: "2dd1c911-ea16-40e9-ad9d-85d6aea3f605",
      },
    },
  },
};
