import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from "react-native";
import { colors, spacing, borderRadius } from "../../theme";

interface ButtonProps {
  title?: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export default function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
  textStyle,
  icon,
  children,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const variantStyle =
    variant === "primary"
      ? styles.primary
      : variant === "secondary"
      ? styles.secondary
      : styles.danger;
  const text =
    variant === "primary"
      ? styles.primaryText
      : variant === "secondary"
      ? styles.secondaryText
      : styles.dangerText;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      style={[styles.base, variantStyle, isDisabled && styles.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : children ? (
        children
      ) : (
        <>
          {icon}
          {title ? <Text style={[text, textStyle]}>{title}</Text> : null}
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  primary: {
    backgroundColor: colors.accentPrimary,
  },
  secondary: {
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: "transparent",
  },
  danger: {
    backgroundColor: colors.danger,
  },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  secondaryText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  dangerText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.4 },
});
