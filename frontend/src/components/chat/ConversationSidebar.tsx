import { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Animated,
  Dimensions,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ConversationSummary } from "../../api/conversations";
import { colors, spacing, borderRadius } from "../../theme";

const SCREEN_WIDTH = Dimensions.get("window").width;
const PANEL_WIDTH = Math.min(300, SCREEN_WIDTH * 0.82);

interface Props {
  open: boolean;
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, currentTitle: string) => void;
}

function relativeDate(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ConversationSidebar({
  open,
  conversations,
  activeId,
  loading,
  onClose,
  onSelect,
  onNewChat,
  onDelete,
  onRename,
}: Props) {
  const slide = useRef(new Animated.Value(open ? 0 : -PANEL_WIDTH)).current;
  const fade = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: open ? 0 : -PANEL_WIDTH,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: open ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [open, slide, fade]);

  const confirmDelete = (item: ConversationSummary) => {
    Alert.alert("Delete chat", `Delete "${item.title}"? This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete(item.id) },
    ]);
  };

  // Fully unmount when closed so the overlay can't swallow taps
  if (!open) return null;

  const renderItem = ({ item }: { item: ConversationSummary }) => {
    const isActive = item.id === activeId;
    return (
      <TouchableOpacity
        style={[styles.row, isActive && styles.rowActive]}
        onPress={() => onSelect(item.id)}
        onLongPress={() => onRename(item.id, item.title)}
        delayLongPress={400}
      >
        <View style={styles.rowMain}>
          <Text style={[styles.rowTitle, isActive && styles.rowTitleActive]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {relativeDate(item.updated_at)}
            {item.preview ? ` · ${item.preview}` : ""}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => confirmDelete(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.rowDelete}
        >
          <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.panel, { transform: [{ translateX: slide }] }]}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>Chats</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.newChat} onPress={onNewChat}>
          <MaterialCommunityIcons name="plus" size={18} color={colors.accentPrimary} />
          <Text style={styles.newChatText}>New chat</Text>
        </TouchableOpacity>

        {loading && conversations.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator size="small" color={colors.accentPrimary} />
          </View>
        ) : conversations.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No saved chats yet</Text>
            <Text style={styles.emptyHint}>Your conversations will appear here</Text>
          </View>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: PANEL_WIDTH,
    backgroundColor: colors.cardBackground,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingTop: spacing["2xl"],
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  newChatText: {
    color: colors.accentPrimary,
    fontWeight: "600",
    fontSize: 15,
  },
  list: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: 2,
  },
  rowActive: {
    backgroundColor: colors.surface,
  },
  rowMain: { flex: 1 },
  rowTitle: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  rowTitleActive: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  rowMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  rowDelete: {
    paddingLeft: spacing.sm,
  },
  empty: {
    padding: spacing.xl,
    alignItems: "center",
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});
