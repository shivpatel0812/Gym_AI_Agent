export const colors = {
  // Same dark black surfaces as before — only the accent shifted orange → blue.
  background: "#070708",
  cardBackground: "#111113",
  surface: "#0C0C0E",
  accentPrimary: "#9CC0E8",
  accentSecondary: "#9CC0E8",
  // Text and icons on top of an accent fill.
  onAccent: "#070708",
  ai: "#5EEAD4",
  success: "#4ADE80",
  danger: "#EF4444",
  warning: "#F59E0B",
  protein: "#E4B896",
  water: "#8B95A1",
  textPrimary: "#FFFFFF",
  text: "#FFFFFF",
  textSecondary: "#8E8E93",
  textMuted: "#636366",
  border: "#1C1C1F",
  borderHover: "#2A2A2E",
  tabBar: "#070708",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
};

export const shadows = {
  small: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 2,
  },
  medium: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  large: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  xl: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
};

export const gradients = {
  primary: [colors.accentPrimary, "#7AA8D4"],
  card: [colors.cardBackground, "#0C0C0E"],
};
