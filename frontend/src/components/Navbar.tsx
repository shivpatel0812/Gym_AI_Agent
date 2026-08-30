import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

interface NavbarProps {
  onLogout: () => void;
  onNavigate?: (route: string) => void;
}

const links = ["Dashboard", "Workouts", "Activity", "Nutrition", "Wellness"];

export default function Navbar({ onLogout, onNavigate }: NavbarProps) {
  return (
    <View style={styles.nav}>
      <View style={styles.links}>
        {links.map((label) => (
          <TouchableOpacity key={label} onPress={() => onNavigate?.(label.toLowerCase())}>
            <Text style={styles.link}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={onLogout} style={styles.logout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { backgroundColor: "#1f2937", padding: 16, flexDirection: "row", justifyContent: "space-between" },
  links: { flexDirection: "row", gap: 20, alignItems: "center" },
  link: { color: "#fff" },
  logout: { backgroundColor: "#dc2626", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  logoutText: { color: "#fff", fontWeight: "600" },
});
