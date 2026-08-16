import { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./src/firebase";
import Login from "./src/components/Login";
import Dashboard from "./src/components/Dashboard";
import Home from "./src/components/home/Home";
import AIHub from "./src/components/aihub";
import Workouts from "./src/components/workouts";
import PhysicalActivity from "./src/components/PhysicalActivity";
import Nutrition from "./src/components/Nutrition";
import Wellness from "./src/components/wellness";
import MoreHome from "./src/components/MoreHome";
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

SplashScreen.preventAutoHideAsync();

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
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
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
    <NavigationContainer
      theme={{
        dark: true,
        colors: {
          primary: colors.accentPrimary,
          background: colors.background,
          card: colors.cardBackground,
          text: colors.textPrimary,
          border: colors.border,
          notification: colors.danger,
        },
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="Login" component={Login} />
        ) : (
          <Stack.Screen name="Main">
            {() => <MainTabs onLogout={handleLogout} />}
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
