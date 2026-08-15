export const colors = {
  background: "#0B0C10",
  cardBackground: "#161A22",
  surface: "#0B0C10",
  accentPrimary: "#FF6B35",
  accentSecondary: "#FF6B35",
  ai: "#5EEAD4",
  success: "#10B981",
  danger: "#EF4444",
  warning: "#F59E0B",
  textPrimary: "#FFFFFF",
  text: "#FFFFFF",
  textSecondary: "#8E8E93",
  textMuted: "#636366",
  border: "#2A2D35",
  borderHover: "#3A3A3C",
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
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  medium: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  large: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  xl: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
};

export const gradients = {
  primary: [colors.accentPrimary, "#E85A2A"],
  card: [colors.cardBackground, "#1C1C1E"],
};
