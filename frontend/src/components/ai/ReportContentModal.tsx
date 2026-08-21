import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Button from "../shared/Button";
import { REPORT_REASONS, reportAiContent } from "../../api/aiAccess";
import { friendlyApiError } from "../../lib/authErrors";
import { colors, spacing, borderRadius } from "../../theme";

interface Props {
  /** The AI message being reported; null closes the modal. */
  content: string | null;
  conversationId?: string | null;
  onClose: () => void;
}

/**
 * Reports an AI response as objectionable.
 *
 * App Store Guideline 1.2 requires a reporting mechanism for AI-generated
 * content. Reports go to the `ai_content_reports` collection for review.
 */
export default function ReportContentModal({ content, conversationId, onClose }: Props) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].id);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Fresh form each time a different message is reported
  useEffect(() => {
    if (content) {
      setReason(REPORT_REASONS[0].id);
      setDetails("");
      setError("");
      setDone(false);
    }
  }, [content]);

  const handleSubmit = async () => {
    if (!content) return;
    setSubmitting(true);
    setError("");
    try {
      await reportAiContent({
        content,
        reason,
        details: details.trim() || undefined,
        conversationId,
      });
      setDone(true);
    } catch (err: any) {
      setError(friendlyApiError(err, "Could not send your report. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={!!content}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Report this response</Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {done ? (
                <View style={styles.doneBox}>
                  <MaterialCommunityIcons
                    name="check-circle-outline"
                    size={40}
                    color={colors.success}
                  />
                  <Text style={styles.doneTitle}>Report sent</Text>
                  <Text style={styles.doneText}>
                    Thanks — this response has been flagged for review. If it described
                    anything medical or urgent, please talk to a qualified professional.
                  </Text>
                  <Button title="Done" onPress={onClose} style={styles.doneButton} />
                </View>
              ) : (
                <>
                  {!!content && (
                    <View style={styles.quote}>
                      <Text style={styles.quoteText} numberOfLines={4}>
                        {content}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.label}>What's wrong with it?</Text>
                  {REPORT_REASONS.map((option) => {
                    const selected = option.id === reason;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        style={styles.reasonRow}
                        onPress={() => setReason(option.id)}
                        activeOpacity={0.8}
                      >
                        <MaterialCommunityIcons
                          name={selected ? "radiobox-marked" : "radiobox-blank"}
                          size={20}
                          color={selected ? colors.accentPrimary : colors.textSecondary}
                        />
                        <Text
                          style={[styles.reasonText, selected && styles.reasonTextActive]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  <Text style={[styles.label, { marginTop: spacing.lg }]}>
                    Anything to add? (optional)
                  </Text>
                  <TextInput
                    style={styles.textArea}
                    value={details}
                    onChangeText={setDetails}
                    placeholder="Tell us what happened."
                    placeholderTextColor={colors.textMuted}
                    multiline
                    maxLength={2000}
                    textAlignVertical="top"
                  />

                  {!!error && <Text style={styles.error}>{error}</Text>}

                  <Button
                    title="Send report"
                    onPress={handleSubmit}
                    loading={submitting}
                    style={styles.submit}
                  />
                  <Button title="Cancel" variant="secondary" onPress={onClose} />
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheetWrap: { maxHeight: "90%" },
  sheet: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingBottom: Platform.OS === "ios" ? spacing.xl : spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  quote: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  quoteText: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  label: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  reasonText: { color: colors.textSecondary, fontSize: 15 },
  reasonTextActive: { color: colors.textPrimary, fontWeight: "600" },
  textArea: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 90,
    marginBottom: spacing.md,
  },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.md },
  submit: { marginBottom: spacing.sm },
  doneBox: { alignItems: "center", paddingVertical: spacing.xl, gap: spacing.md },
  doneTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  doneText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  doneButton: { alignSelf: "stretch", marginTop: spacing.sm },
});
