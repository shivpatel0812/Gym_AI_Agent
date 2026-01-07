import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme";

export default function Calendar() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Calendar - Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
  },
  text: {
    fontSize: 18,
    color: colors.textPrimary,
  },
});
