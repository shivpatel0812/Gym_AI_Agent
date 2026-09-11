import { useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Button from "../shared/Button";
import { submitAccessRequest, AiAccessStatus } from "../../api/aiAccess";
import { friendlyApiError } from "../../lib/authErrors";
import { colors, spacing, borderRadius } from "../../theme";

const LIMIT_OPTIONS = [15, 30, 50, 100];
const MIN_REASON_LENGTH = 10;

interface Props {
  visible: boolean;
  onClose: () => void;
  status?: AiAccessStatus | null;
  /** Fired after a request is filed, so the caller can refresh its status. */
  onSubmitted?: () => void;
}

/**
 * Lets a user ask for a higher daily AI limit.
 *
 * The request lands in Firestore (`ai_access_requests/{uid}`) where an admin
 * approves it — either through the admin endpoints or by editing the doc in the
 * Firebase console. Approval raises `ai_access/{uid}.daily_limit` directly.
 */
export default function RequestAiAccessModal({
  visible,
  onClose,
  status,
  onSubmitted,
}: Props) {
  const [reason, setReason] = useState("");
  const [requestedLimit, setRequestedLimit] = useState(50);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const close = () => {
    setError("");
    setDone(false);
    setReason("");
    onClose();
  };

  const handleSubmit = async () => {
    setError("");
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError("Please tell us a bit more about how you'd use the AI coach.");
      return;
    }
    setSubmitting(true);
    try {
      await submitAccessRequest(reason.trim(), requestedLimit);
      setDone(true);
      onSubmitted?.();
    } catch (err: any) {
      setError(friendlyApiError(err, "Could not send your request. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const alreadyPending = status?.request_status === "pending";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={close}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Request more AI access</Text>
              <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
              {done ? (
                <View style={styles.doneBox}>
                  <MaterialCommunityIcons
                    name="check-circle-outline"
                    size={40}
                    color={colors.success}
                  />
                  <Text style={styles.doneTitle}>Request sent</Text>
                  <Text style={styles.doneText}>
                    We'll review it and raise your limit if it's a fit. You'll see the
                    new limit here once it's approved — no need to check back.
                  </Text>
                  <Button title="Done" onPress={close} style={styles.doneButton} />
                </View>
              ) : alreadyPending ? (
                <View style={styles.doneBox}>
                  <MaterialCommunityIcons
                    name="clock-outline"
                    size={40}
                    color={colors.warning}
                  />
                  <Text style={styles.doneTitle}>Request pending</Text>
                  <Text style={styles.doneText}>
                    You already have a request awaiting review. We'll raise your limit
                    here as soon as it's approved.
                  </Text>
                  <Button title="Close" onPress={close} style={styles.doneButton} />
                </View>
              ) : (
                <>
                  {!!status && (
                    <View style={styles.usageBox}>
                      <Text style={styles.usageText}>
                        You're on the{" "}
                        <Text style={styles.usageStrong}>{status.tier}</Text> tier —{" "}
                        <Text style={styles.usageStrong}>
                          {status.daily_limit} AI requests per day
                        </Text>
                        .
                      </Text>
                    </View>
                  )}

                  <Text style={styles.label}>How do you plan to use the AI coach?</Text>
                  <TextInput
                    style={styles.textArea}
                    value={reason}
                    onChangeText={(value) => {
                      setReason(value);
                      setError("");
                    }}
                    placeholder="e.g. I train 6 days a week and want to check in with the coach after each session."
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={5}
                    maxLength={1000}
                    textAlignVertical="top"
                  />
                  <Text style={styles.counter}>{reason.length}/1000</Text>

                  <Text style={styles.label}>Daily requests you'd like</Text>
                  <View style={styles.limitRow}>
                    {LIMIT_OPTIONS.map((option) => {
                      const selected = option === requestedLimit;
                      return (
                        <TouchableOpacity
                          key={option}
                          style={[styles.limitChip, selected && styles.limitChipActive]}
                          onPress={() => setRequestedLimit(option)}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[
                              styles.limitChipText,
                              selected && styles.limitChipTextActive,
                            ]}
                          >
                            {option}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {!!error && (
                    <View style={styles.errorBox}>
                      <MaterialCommunityIcons
                        name="alert-circle-outline"
                        size={16}
                        color={colors.danger}
                      />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  <Button
                    title="Send request"
                    onPress={handleSubmit}
                    loading={submitting}
                    style={styles.submit}
                  />
                  <Button title="Cancel" variant="secondary" onPress={close} />
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
  sheetWrap: {
    maxHeight: "90%",
  },
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
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  usageBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  usageText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  usageStrong: {
    color: colors.textPrimary,
    fontWeight: "700",
  },
  label: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  textArea: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 110,
  },
  counter: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: "right",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  limitRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  limitChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
  },
  limitChipActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: "rgba(255, 107, 53, 0.12)",
  },
  limitChipText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: "600",
  },
  limitChipTextActive: {
    color: colors.accentPrimary,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  submit: {
    marginBottom: spacing.sm,
  },
  doneBox: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  doneTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  doneText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  doneButton: {
    alignSelf: "stretch",
    marginTop: spacing.sm,
  },
});
