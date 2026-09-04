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

  // ---------------------------------------------------------------------
  // Added Sep 2026 after auditing 129 distinct hex literals across 54
  // component files. Everything above keeps its old value; these are the
  // colors the app was already using that had no token to import.
  //
  // The audit's main finding: the app speaks in COOL, blue-tinted greys
  // (#7C8CA0 appears 80 times) while `textSecondary` above declares a
  // NEUTRAL iOS grey (#8E8E93, 6 times). The usage is the real design; the
  // old token is the outlier. Prefer `textMutedCool` for new work.
  // ---------------------------------------------------------------------

  /** Secondary text and inactive icons. The app's most-used color. */
  textMutedCool: "#7C8CA0",
  /** Tertiary text, disabled icons, faint labels. */
  textFaintCool: "#55647A",

  /** Recessed wells and scrims — deeper than `background`. */
  surfaceSunken: "#05080F",
  /** A card lifted above `cardBackground`. */
  surfaceRaised: "#12151C",

  /** Cool-tinted hairline, for surfaces that sit on a tinted card. */
  borderCool: "#1E2A38",
  /** The same, one step stronger — active/selected outlines. */
  borderCoolStrong: "#2D3B4E",

  /** Soft warning — "worth a look", short of `danger`. */
  attention: "#E4896B",

  /** Ink on the light cards (photo results). Not for dark surfaces. */
  onLight: "#111111",
  onLightMuted: "#6B6B70",
};

/**
 * Macro and metric marks.
 *
 * Used consistently across the app but only `protein` had a token, so the
 * other three were retyped as literals everywhere. These are chart/data
 * colors, not UI accents — keep them off buttons and borders.
 */
export const macro = {
  calories: "#9CC0E8",
  protein: "#E4B896",
  carbs: "#F5C542",
  fats: "#C4B5FD",
  fiber: "#4ADE80",
  sleep: "#A78BFA",
};

/**
 * Type scale.
 *
 * The audit found 21 distinct `fontSize` values across ~800 declarations:
 * 11, 12, 13 and 14 alone accounted for 593, which are not four perceptibly
 * different sizes — they are the same decision made four ways. These seven
 * steps cover every existing use within +/-2px, so adopting one is a visual
 * no-op in almost every case.
 *
 * Adopt on new work and when already editing a block. A repo-wide rewrite
 * would be a large unreviewable diff for no user-visible gain.
 */
export const typography = {
  /** 10 — eyebrows, axis ticks, dense badge text. */
  micro: 10,
  /** 12 — captions, secondary labels. The most common size in the app. */
  caption: 12,
  /** 14 — body copy and list rows. */
  body: 14,
  /** 16 — card titles, section headers. */
  title: 16,
  /** 20 — screen headings. */
  heading: 20,
  /** 24 — a number that is the point of its card. */
  display: 24,
  /** 32 — the single hero figure on a screen. */
  hero: 32,
} as const;

/**
 * Weights. The app uses "700" (310x), "600" (177x) and "800" (138x) as its
 * real vocabulary; "500", "900" and "bold" are strays worth normalizing.
 */
export const weight = {
  regular: "500",
  medium: "600",
  bold: "700",
  heavy: "800",
} as const;

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
