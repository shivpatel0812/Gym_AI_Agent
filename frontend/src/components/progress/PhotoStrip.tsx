import { useEffect, useRef, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  borderRadius,
  colors,
  spacing,
  typography,
  weight,
} from "../../theme";
import { getPhotoImage } from "../../api/progress";
import type { PhotoHub, PhotoRow } from "../../api/progress";

/**
 * The meal-photo archive, which the app has been filling since Sep 2026 and
 * has never shown anyone.
 *
 * Images are fetched one at a time, on demand. They are base64 JPEGs living
 * inside their Firestore documents, so the list endpoint deliberately omits
 * them and each thumbnail asks for its own.
 *
 * Every macro figure here is the **accepted** one — what the user committed to
 * their day. A first guess they never agreed with is not evidence about what
 * they ate, so a row without an accepted label shows the photo and says the
 * number is missing rather than quietly showing the guess.
 */

const THUMB = 104;
// Enough to fill the strip twice over without fetching an archive of images
// nobody scrolled to.
const PREFETCH = 8;

function Thumb({ row }: { row: PhotoRow }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    // One-shot: the request resolving must not re-arm the effect.
    if (asked.current || !row.has_image) return;
    asked.current = true;
    let active = true;
    void getPhotoImage(row.id)
      .then((data) => active && setUri(data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [row.id, row.has_image]);

  return (
    <View style={styles.thumbWrap}>
      <View style={styles.thumb}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.placeholder}>
            <MaterialCommunityIcons
              name={failed || !row.has_image ? "image-off-outline" : "image-outline"}
              size={20}
              color={colors.textFaintCool}
            />
          </View>
        )}
        {row.was_corrected ? (
          <View style={styles.correctedPip}>
            <MaterialCommunityIcons name="pencil" size={9} color={colors.onAccent} />
          </View>
        ) : null}
      </View>
      <Text style={styles.thumbTitle} numberOfLines={1}>
        {row.title || "Meal"}
      </Text>
      <Text style={styles.thumbMeta}>
        {row.logged?.calories != null
          ? `${Math.round(row.logged.calories)} kcal`
          : "not logged"}
      </Text>
    </View>
  );
}

export default function PhotoStrip({
  hub,
  onOpenAll,
}: {
  hub: PhotoHub | null;
  onOpenAll?: () => void;
}) {
  if (!hub || hub.total === 0) return null;

  const rows = hub.photos.slice(0, PREFETCH);

  return (
    <>
      <Text style={styles.sectionLabel}>MEALS YOU PHOTOGRAPHED</Text>
      <View style={styles.card}>
        <View style={styles.statRow}>
          <Text style={styles.stat}>
            {hub.in_range} in range · {hub.labelled} logged
            {hub.unlabelled ? ` · ${hub.unlabelled} never logged` : ""}
          </Text>
          {onOpenAll ? (
            <TouchableOpacity onPress={onOpenAll} hitSlop={10} accessibilityRole="button">
              <Text style={styles.link}>All {hub.total}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {rows.map((row) => (
            <Thumb key={row.id} row={row} />
          ))}
        </ScrollView>

        {/* The archive was built to score prompt changes. It also answers a
            question the user could never otherwise ask: which way do these
            estimates lean on *my* food. */}
        <Text style={styles.bias}>
          {hub.bias.measurable ? hub.bias.summary : hub.bias.reason}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: colors.textMutedCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 1.4,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  stat: { color: colors.textMutedCool, fontSize: typography.caption, flex: 1 },
  link: {
    color: colors.accentPrimary,
    fontSize: typography.caption,
    fontWeight: weight.bold,
  },
  strip: { gap: spacing.sm, paddingRight: spacing.sm },
  thumbWrap: { width: THUMB },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: borderRadius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceSunken,
  },
  image: { width: "100%", height: "100%" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  correctedPip: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentPrimary,
  },
  thumbTitle: {
    color: colors.textPrimary,
    fontSize: typography.micro,
    fontWeight: weight.medium,
    marginTop: spacing.xs,
  },
  thumbMeta: { color: colors.textFaintCool, fontSize: typography.micro },
  bias: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    lineHeight: 15,
    marginTop: spacing.md,
  },
});
