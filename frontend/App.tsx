import { useState, useEffect } from "react";
import {
  NavigationContainer,
  DarkTheme,
  createNavigationContainerRef,
  CommonActions,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./src/firebase";
import { syncTimezone } from "./src/api/timezone";
import {
  configureNotifications,
  clearSleepReminders,
  clearMealReminders,
  loadSleepReminderSettings,
  syncSleepReminders,
  loadMealReminderSettings,
  syncMealReminders,
  setupMealReminderResponseHandler,
  setupWorkoutLiveResponseHandler,
  subscribeWorkoutLiveActions,
  endWorkoutLive,
} from "./src/notifications";
import { getActiveNutritionPlan } from "./src/api/nutritionPlan";
import apiClient from "./src/api/client";
import { toDateKey } from "./src/components/nutrition/types";
import type { FoodItem, MacroEntry } from "./src/components/nutrition/types";
import Login from "./src/components/Login";
import Dashboard from "./src/components/Dashboard";
import Home from "./src/components/home/Home";
import AIHub from "./src/components/aihub";
import Workouts from "./src/components/workouts";
import PhysicalActivity from "./src/components/PhysicalActivity";
import Nutrition from "./src/components/Nutrition";
import Wellness from "./src/components/wellness";
import MoreHome from "./src/components/MoreHome";
import Settings from "./src/components/Settings";
import BodyScanScreen from "./src/components/bodyScan/BodyScanScreen";
import AIChat from "./src/components/AIChat";
import AIAnalysis from "./src/components/AIAnalysis";
import UserProfile from "./src/components/UserProfile";
import Calendar from "./src/components/Calendar";
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as SplashScreen from "expo-splash-screen";
import LinearGradient from "./src/components/shared/LinearGradient";
import { colors, spacing } from "./src/theme";

const navigationRef = createNavigationContainerRef();

function navigateToWorkouts() {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.navigate({
      name: "Main",
      params: { screen: "Workouts" },
    })
  );
}

SplashScreen.preventAutoHideAsync();

// React Navigation 7 themes carry a `fonts` block as well as colors, so start
// from their DarkTheme and override only the palette.
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accentPrimary,
    background: colors.background,
    card: colors.cardBackground,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.danger,
  },
};

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const MoreStack = createNativeStackNavigator();

function MoreStackScreen() {
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 20,
        },
      }}
    >
      <MoreStack.Screen
        name="MoreHome"
        component={MoreHome}
        options={{ title: "More" }}
      />
      <MoreStack.Screen
        name="Dashboard"
        component={Dashboard}
        options={{ title: "Dashboard" }}
      />
      <MoreStack.Screen
        name="AIChat"
        component={AIChat}
        options={{ title: "AI Coach" }}
      />
      <MoreStack.Screen
        name="AIAnalysis"
        component={AIAnalysis}
        options={{ title: "AI Analysis" }}
      />
      <MoreStack.Screen
        name="UserProfile"
        component={UserProfile}
        options={{ title: "My Profile" }}
      />
      <MoreStack.Screen
        name="Calendar"
        component={Calendar}
        options={{ title: "Calendar" }}
      />
      <MoreStack.Screen
        name="Settings"
        component={Settings}
        options={{ title: "Settings" }}
      />
      <MoreStack.Screen
        name="BodyScan"
        component={BodyScanScreen}
        options={{ title: "Body Scan" }}
      />
      <MoreStack.Screen
        name="Activity"
        component={PhysicalActivity}
        options={{ headerShown: false, title: "Activity" }}
      />
      <MoreStack.Screen
        name="Wellness"
        component={Wellness}
        options={{ headerShown: false, title: "Wellness" }}
      />
    </MoreStack.Navigator>
  );
}

function MainTabs({ onLogout }: { onLogout: () => void }) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof MaterialCommunityIcons.glyphMap;
          if (route.name === "Home") {
            iconName = focused ? "home" : "home-outline";
          } else if (route.name === "AIHub") {
            iconName = focused ? "robot" : "robot-outline";
          } else if (route.name === "Workouts") {
            iconName = focused ? "dumbbell" : "dumbbell";
          } else if (route.name === "Nutrition") {
            iconName = focused ? "food-apple" : "food-apple-outline";
          } else {
            iconName = focused ? "dots-horizontal" : "dots-horizontal";
          }
          return (
            <MaterialCommunityIcons name={iconName} size={22} color={color} />
          );
        },
        tabBarActiveTintColor: colors.accentPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopWidth: 0,
          elevation: 0,
          height: Platform.OS === "ios" ? 82 : 60,
          paddingBottom: Platform.OS === "ios" ? 20 : 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        headerStyle: {
          backgroundColor: colors.background,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 20,
        },
        headerRight: () => (
          <TouchableOpacity onPress={onLogout} style={styles.logoutButton}>
            <MaterialCommunityIcons
              name="logout"
              size={20}
              color={colors.danger}
            />
          </TouchableOpacity>
        ),
      })}
    >
      <Tab.Screen
        name="Home"
        component={Home}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="Workouts"
        component={Workouts}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="Nutrition"
        component={Nutrition}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="AIHub"
        component={AIHub}
        options={{ headerShown: false, tabBarLabel: "AI" }}
      />
      <Tab.Screen
        name="More"
        component={MoreStackScreen}
        options={{ headerShown: false }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // MaterialCommunityIcons are already bundled with @expo/vector-icons
    // No need to load them via expo-font, so we can hide splash screen immediately
    SplashScreen.hideAsync();
    // Only sets how an arriving notification behaves. Nothing is scheduled and
    // no permission is requested until the user turns a reminder on.
    configureNotifications();
    const cleanupMeal = setupMealReminderResponseHandler();
    const cleanupWorkout = setupWorkoutLiveResponseHandler();
    const unsubLive = subscribeWorkoutLiveActions((action) => {
      if (action.type === "open-session" || action.type === "log-set") {
        navigateToWorkouts();
      }
    });
    return () => {
      cleanupMeal();
      cleanupWorkout();
      unsubLive();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
      // Report the device's timezone once per change, so server-side date
      // defaults use this user's calendar day rather than the server's.
      if (user) {
        syncTimezone();
        // Keep the 14-day local queue fresh without waiting for Wellness to open.
        void (async () => {
          try {
            const settings = await loadSleepReminderSettings();
            if (!settings.enabled) return;
            const res = await apiClient.get("/api/sleep");
            const logged = Array.isArray(res.data)
              ? res.data.map((entry: { date?: string }) => entry.date).filter(Boolean)
              : [];
            await syncSleepReminders(settings, logged as string[]);
          } catch {
            // Offline / cold start — Wellness will re-arm when opened.
          }
        })();
        void (async () => {
          try {
            const settings = await loadMealReminderSettings();
            if (!settings.enabled) return;
            const [plan, macrosRes] = await Promise.all([
              getActiveNutritionPlan().catch(() => null),
              apiClient.get("/api/macros").catch(() => ({ data: [] })),
            ]);
            const rows: MacroEntry[] = Array.isArray(macrosRes.data) ? macrosRes.data : [];
            const today = toDateKey(new Date());
            const entry = rows.find((e) => String(e.date || "").slice(0, 10) === today);
            const loggedByDate: Record<string, FoodItem[]> = {
              [today]: entry?.food_items || [],
            };
            await syncMealReminders(settings, plan, loggedByDate);
          } catch {
            // Nutrition tab can re-arm when opened.
          }
        })();
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    // Queued reminders are this user's, and they would otherwise keep firing on
    // a shared device after they had signed out.
    await clearSleepReminders();
    await clearMealReminders();
    await endWorkoutLive();
    await signOut(auth);
  };

  if (loading) {
    return (
      <LinearGradient
        colors={[colors.background, colors.cardBackground]}
        style={styles.loadingContainer}
      >
        <ActivityIndicator size="large" color={colors.accentPrimary} />
      </LinearGradient>
    );
  }

  return (
    <>
    <StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="Login" component={Login} />
        ) : (
          <Stack.Screen name="Main">
            {(props) => <MainTabs {...props} onLogout={handleLogout} />}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  logoutButton: {
    marginRight: spacing.lg,
    padding: spacing.sm,
  },
});
