import { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./src/firebase";
import Login from "./src/components/Login";
import Dashboard from "./src/components/Dashboard";
import Workouts from "./src/components/workouts";
import PhysicalActivity from "./src/components/PhysicalActivity";
import Nutrition from "./src/components/Nutrition";
import Wellness from "./src/components/wellness";
import { View, Text, ActivityIndicator, TouchableOpacity } from "react-native";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs({ onLogout }: { onLogout: () => void }) {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#6b7280",
        headerStyle: { backgroundColor: "#1f2937" },
        headerTintColor: "#fff",
        headerRight: () => (
          <TouchableOpacity
            onPress={onLogout}
            style={{ marginRight: 16, padding: 8 }}
          >
            <Text style={{ color: "#ef4444", fontWeight: "600" }}>Logout</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tab.Screen name="Dashboard" component={Dashboard} />
      <Tab.Screen name="Workouts" component={Workouts} />
      <Tab.Screen name="Activity" component={PhysicalActivity} />
      <Tab.Screen name="Nutrition" component={Nutrition} />
      <Tab.Screen name="Wellness" component={Wellness} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <NavigationContainer>
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
  );
}
