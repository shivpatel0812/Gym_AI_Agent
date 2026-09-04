/**
 * Focused chat for correcting a photo nutrition estimate.
 *
 * This intentionally lives in a full-screen modal. The food logger already
 * scrolls, and nesting another chat scroll view and keyboard offset inside it
 * made the composer jump too high when the keyboard opened.
 */

import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import type { AiModelId } from "../../lib/aiModels";
import { colors } from "../../theme";
import type { PhotoComponent, PhotoEstimate } from "./photoEstimate";

const MAX_TURNS = 3;

const QUICK_STARTERS = [
  {
    label: "Bigger portion",
    prompt: "The portion was bigger than shown.",
    icon: "arrow-expand-all" as const,
  },
  {
    label: "Smaller portion",
    prompt: "The portion was smaller than shown.",
    icon: "arrow-collapse-all" as const,
  },
  {
    label: "Missing food",
    prompt: "The estimate is missing ",
    icon: "plus-circle-outline" as const,
  },
  {
    label: "Wrong food",
    prompt: "It identified the wrong food. It was ",
    icon: "swap-horizontal" as const,
  },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  kind?: "normal" | "error";
}

interface RevisedEstimate {
  name: string;
  amount?: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  components?: PhotoComponent[];
  revision_note?: string | null;
}

interface MacroAdjustChatProps {
  estimate: PhotoEstimate;
  model?: AiModelId;
  photoLogId?: string | null;
  onPhotoLogId?: (id: string) => void;
  onAcceptRevision: (revised: RevisedEstimate) => void;
  onClose: () => void;
}

function stripJsonBlock(text: string): string {
  return text
    .replace(/```json[\s\S]*?```/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

function displayNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function deltaLabel(value: number, previousValue?: number) {
  if (previousValue === undefined) return null;
  const delta = Math.round((value - previousValue) * 10) / 10;
  if (delta === 0) return "No change";
  return `${delta > 0 ? "+" : "−"}${displayNumber(Math.abs(delta))}`;
}

function MacroPill({
  label,
  value,
  unit,
  color,
  previousValue,
}: {
  label: string;
  value: number;
  unit: string;
  color: string;
  previousValue?: number;
}) {
  const delta = deltaLabel(value, previousValue);
  return (
    <View style={s.macroPill}>
      <View style={s.macroValueRow}>
        <Text style={[s.macroPillValue, { color }]}>{displayNumber(value)}</Text>
        <Text style={s.macroPillUnit}>{unit}</Text>
      </View>
      <Text style={s.macroPillLabel}>{label}</Text>
      {delta ? (
        <Text
          style={[
            s.macroDelta,
            delta === "No change" ? s.macroDeltaSame : s.macroDeltaChanged,
          ]}
        >
          {delta}
        </Text>
      ) : null}
    </View>
  );
}

function EstimateMacros({
  estimate,
  previous,
}: {
  estimate: RevisedEstimate | PhotoEstimate;
  previous?: PhotoEstimate;
}) {
  return (
    <View style={s.macroRow}>
      <MacroPill
        label="Calories"
        value={estimate.calories}
        unit="kcal"
        color="#9CC0E8"
        previousValue={previous?.calories}
      />
      <MacroPill
        label="Protein"
        value={estimate.protein}
        unit="g"
        color="#E4B896"
        previousValue={previous?.protein}
      />
      <MacroPill
        label="Carbs"
        value={estimate.carbs}
        unit="g"
        color="#F5C542"
        previousValue={previous?.carbs}
      />
      <MacroPill
        label="Fat"
        value={estimate.fats}
        unit="g"
        color="#C4B5FD"
        previousValue={previous?.fats}
      />
      <MacroPill
        label="Fiber"
        value={estimate.fiber}
        unit="g"
        color="#86D7A5"
        previousValue={previous?.fiber}
      />
    </View>
  );
}

function CurrentEstimateCard({ estimate }: { estimate: PhotoEstimate }) {
  return (
    <View style={s.currentCard}>
      <View style={s.estimateHeader}>
        <View style={s.estimateHeading}>
          <Text style={s.eyebrow}>CURRENT ESTIMATE</Text>
          <Text style={s.estimateName} numberOfLines={2}>
            {estimate.name}
          </Text>
          <Text style={s.estimateAmount}>
            {estimate.amount || "Estimated portion"}
          </Text>
        </View>
        <View style={s.aiBadge}>
          <MaterialCommunityIcons name="creation" size={13} color="#5EEAD4" />
          <Text style={s.aiBadgeText}>AI estimate</Text>
        </View>
      </View>
      <EstimateMacros estimate={estimate} />
    </View>
  );
}

function RevisedCard({
  revised,
  original,
  onAccept,
}: {
  revised: RevisedEstimate;
  original: PhotoEstimate;
  onAccept: () => void;
}) {
  return (
    <View style={s.revisedCard}>
      <View style={s.revisedHeader}>
        <View style={s.revisedIcon}>
          <MaterialCommunityIcons name="check" size={15} color="#07110F" />
        </View>
        <View style={s.revisedHeading}>
          <Text style={s.revisedTitle}>Updated estimate</Text>
          <Text style={s.revisedSubtitle}>Review before applying</Text>
        </View>
      </View>

      {revised.revision_note ? (
        <Text style={s.revisionNote}>{revised.revision_note}</Text>
      ) : null}

      <View>
        <Text style={s.revisedFoodName}>{revised.name}</Text>
        <Text style={s.revisedFoodAmount}>
          {revised.amount || "Updated portion"}
        </Text>
      </View>

      <EstimateMacros estimate={revised} previous={original} />

      {revised.components?.length ? (
        <View style={s.ledger}>
          <Text style={s.ledgerTitle}>What’s counted</Text>
          {revised.components.map((component, index) => (
            <View key={`${component.name}-${index}`} style={s.ledgerRow}>
              <Text style={s.ledgerName} numberOfLines={1}>
                {component.name}
                {component.amount ? (
                  <Text style={s.ledgerAmount}>{`  ${component.amount}`}</Text>
                ) : null}
              </Text>
              <Text style={s.ledgerCal}>{component.calories} kcal</Text>
            </View>
          ))}
        </View>
      ) : null}

      <TouchableOpacity
        style={s.acceptBtn}
        onPress={onAccept}
        accessibilityRole="button"
        accessibilityLabel="Apply updated nutrition estimate"
      >
        <MaterialCommunityIcons name="check" size={18} color={colors.onAccent} />
        <Text style={s.acceptBtnText}>Apply changes</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MacroAdjustChat({
  estimate,
  model,
  photoLogId,
  onPhotoLogId,
  onAcceptRevision,
  onClose,
}: MacroAdjustChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [completedTurns, setCompletedTurns] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [latestRevision, setLatestRevision] = useState<RevisedEstimate | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [logId, setLogId] = useState<string | null>(photoLogId || null);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const atLimit = completedTurns >= MAX_TURNS;

  useEffect(() => {
    setLogId(photoLogId || null);
  }, [photoLogId]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, sending, latestRevision]);

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  const chooseStarter = (prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const retryLastMessage = () => {
    if (!lastFailedMessage) return;
    setInput(lastFailedMessage);
    setLastFailedMessage(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || atLimit) return;

    setInput("");
    setLastFailedMessage(null);
    setMessages((previous) => [...previous, { role: "user", content: text }]);
    setSending(true);

    try {
      // Keep follow-ups anchored to the newest revision. Re-sending the
      // original estimate makes later corrections drift instead of converge.
      const live = latestRevision ?? estimate;
      const liveComponents =
        latestRevision?.components ?? estimate.analysis?.components ?? [];

      const response = await apiClient.post(
        "/api/macros/adjust-estimate",
        {
          message: text,
          current_estimate: {
            name: live.name,
            amount: live.amount,
            calories: live.calories,
            protein: live.protein,
            carbs: live.carbs,
            fats: live.fats,
            fiber: live.fiber,
            components: liveComponents,
            assumptions: estimate.analysis?.assumptions,
            uncertainties: estimate.analysis?.uncertainties,
          },
          conversation_history: history,
          photo_log_id: logId || undefined,
          model,
        },
        { timeout: model === "gpt-5.6-sol" ? 120000 : 60000 }
      );

      const reply =
        typeof response.data?.reply === "string"
          ? response.data.reply
          : "I updated the estimate based on your note.";
      const revised: RevisedEstimate | null =
        response.data?.revised_estimate || null;
      const nextHistory = response.data?.conversation_history || history;
      const nextLogId =
        typeof response.data?.photo_log_id === "string"
          ? response.data.photo_log_id
          : null;

      if (nextLogId) {
        setLogId(nextLogId);
        onPhotoLogId?.(nextLogId);
      }
      if (revised) setLatestRevision(revised);
      setHistory(nextHistory);
      setCompletedTurns((turns) => turns + 1);
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content:
            stripJsonBlock(reply) ||
            "I updated the estimate. Review the changes below.",
        },
      ]);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      const message =
        typeof detail === "string" && detail.trim()
          ? detail
          : "I couldn’t update that just now. Your estimate is unchanged.";
      setLastFailedMessage(text);
      setMessages((previous) => [
        ...previous,
        { role: "assistant", content: message, kind: "error" },
      ]);
    } finally {
      setSending(false);
    }
  };

  const acceptRevision = () => {
    if (!latestRevision) return;
    Keyboard.dismiss();
    onAcceptRevision(latestRevision);
  };

  const refinementsLeft = Math.max(0, MAX_TURNS - completedTurns);

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
    >
      <SafeAreaView style={s.screen}>
        <KeyboardAvoidingView
          style={s.keyboardView}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <View style={s.header}>
            <TouchableOpacity
              style={s.closeBtn}
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close nutrition estimate refinement"
            >
              <MaterialCommunityIcons name="chevron-left" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={s.headerCopy}>
              <Text style={s.headerTitle}>Refine estimate</Text>
              <Text style={s.headerSubtitle} numberOfLines={1}>
                {estimate.name}
              </Text>
            </View>
            <View style={s.headerSpacer} />
          </View>

          <ScrollView
            ref={scrollRef}
            style={s.chatScroll}
            contentContainerStyle={s.chatContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: true })
            }
          >
            <CurrentEstimateCard estimate={estimate} />

            <View style={s.assistantRow}>
              <View style={s.assistantAvatar}>
                <MaterialCommunityIcons name="creation" size={15} color="#5EEAD4" />
              </View>
              <View style={[s.bubble, s.bubbleAssistant]}>
                <Text style={[s.bubbleText, s.bubbleTextAssistant]}>
                  Tell me what looks off. I’ll update the portions and macros,
                  then you can review everything before applying it.
                </Text>
              </View>
            </View>

            {messages.length === 0 ? (
              <View style={s.startersSection}>
                <Text style={s.startersLabel}>QUICK START</Text>
                <View style={s.startersGrid}>
                  {QUICK_STARTERS.map((starter) => (
                    <TouchableOpacity
                      key={starter.label}
                      style={s.starterChip}
                      onPress={() => chooseStarter(starter.prompt)}
                      accessibilityRole="button"
                    >
                      <MaterialCommunityIcons
                        name={starter.icon}
                        size={16}
                        color="#9CC0E8"
                      />
                      <Text style={s.starterText}>{starter.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.starterHint}>
                  Choose one to start, then add the detail that matters.
                </Text>
              </View>
            ) : null}

            {messages.map((message, index) =>
              message.role === "user" ? (
                <View key={`${message.role}-${index}`} style={[s.bubble, s.bubbleUser]}>
                  <Text style={[s.bubbleText, s.bubbleTextUser]}>{message.content}</Text>
                </View>
              ) : (
                <View key={`${message.role}-${index}`} style={s.assistantRow}>
                  <View
                    style={[
                      s.assistantAvatar,
                      message.kind === "error" && s.errorAvatar,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={message.kind === "error" ? "alert-circle-outline" : "creation"}
                      size={15}
                      color={message.kind === "error" ? "#F59E8B" : "#5EEAD4"}
                    />
                  </View>
                  <View
                    style={[
                      s.bubble,
                      s.bubbleAssistant,
                      message.kind === "error" && s.bubbleError,
                    ]}
                  >
                    <Text
                      style={[
                        s.bubbleText,
                        s.bubbleTextAssistant,
                        message.kind === "error" && s.bubbleTextError,
                      ]}
                    >
                      {message.content}
                    </Text>
                    {message.kind === "error" && lastFailedMessage ? (
                      <TouchableOpacity style={s.retryBtn} onPress={retryLastMessage}>
                        <MaterialCommunityIcons name="refresh" size={14} color="#F3B4A9" />
                        <Text style={s.retryText}>Edit and try again</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              )
            )}

            {sending ? (
              <View style={s.assistantRow}>
                <View style={s.assistantAvatar}>
                  <MaterialCommunityIcons name="creation" size={15} color="#5EEAD4" />
                </View>
                <View style={[s.bubble, s.bubbleAssistant, s.loadingBubble]}>
                  <ActivityIndicator size="small" color="#5EEAD4" />
                  <View>
                    <Text style={s.loadingTitle}>Rechecking your meal</Text>
                    <Text style={s.loadingSubtitle}>Updating portions and macros…</Text>
                  </View>
                </View>
              </View>
            ) : null}

            {latestRevision ? (
              <RevisedCard
                revised={latestRevision}
                original={estimate}
                onAccept={acceptRevision}
              />
            ) : null}

            {atLimit ? (
              <View style={s.limitCard}>
                <MaterialCommunityIcons
                  name="check-circle-outline"
                  size={18}
                  color="#8CBAB2"
                />
                <Text style={s.limitText}>
                  {latestRevision
                    ? "That’s all three refinements. Apply the updated estimate above, or go back to keep the current one."
                    : "That’s all three refinements. Go back to keep the current estimate."}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {!atLimit ? (
            <View style={s.composerWrap}>
              <View style={s.composerMeta}>
                <Text style={s.turnText}>
                  {refinementsLeft} {refinementsLeft === 1 ? "refinement" : "refinements"} left
                </Text>
                {input.length >= 240 ? (
                  <Text style={s.characterCount}>{input.length}/300</Text>
                ) : null}
              </View>
              <View style={s.inputRow}>
                <TextInput
                  ref={inputRef}
                  style={s.input}
                  value={input}
                  onChangeText={setInput}
                  placeholder="What should I change?"
                  placeholderTextColor="#596575"
                  multiline
                  maxLength={300}
                  editable={!sending}
                  returnKeyType="send"
                  submitBehavior="submit"
                  onSubmitEditing={() => void handleSend()}
                  accessibilityLabel="Describe what is wrong with the nutrition estimate"
                />
                <TouchableOpacity
                  style={[
                    s.sendBtn,
                    (!input.trim() || sending) && s.sendBtnDisabled,
                  ]}
                  disabled={!input.trim() || sending}
                  onPress={() => void handleSend()}
                  accessibilityRole="button"
                  accessibilityLabel="Send refinement"
                >
                  {sending ? (
                    <ActivityIndicator size="small" color={colors.onAccent} />
                  ) : (
                    <MaterialCommunityIcons
                      name="arrow-up"
                      size={20}
                      color={colors.onAccent}
                    />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  closeBtn: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "800",
  },
  headerSubtitle: {
    maxWidth: "90%",
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  headerSpacer: {
    width: 42,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 22,
    gap: 14,
  },
  currentCard: {
    gap: 13,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#101217",
    borderWidth: 1,
    borderColor: colors.border,
  },
  estimateHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  estimateHeading: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: "#667487",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 5,
  },
  estimateName: {
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "800",
  },
  estimateAmount: {
    color: "#7C8CA0",
    fontSize: 12,
    marginTop: 3,
  },
  aiBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(94,234,212,0.08)",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.18)",
  },
  aiBadgeText: {
    color: "#8FCFC4",
    fontSize: 10,
    fontWeight: "700",
  },
  macroRow: {
    flexDirection: "row",
    gap: 5,
  },
  macroPill: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    paddingHorizontal: 2,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#080A0E",
    borderWidth: 1,
    borderColor: colors.border,
  },
  macroValueRow: {
    minHeight: 18,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 1,
  },
  macroPillValue: {
    fontSize: 14,
    fontWeight: "800",
  },
  macroPillUnit: {
    color: "#55647A",
    fontSize: 8,
    fontWeight: "700",
  },
  macroPillLabel: {
    color: "#657286",
    fontSize: 9,
    fontWeight: "600",
    marginTop: 2,
  },
  macroDelta: {
    fontSize: 8,
    fontWeight: "800",
    marginTop: 3,
  },
  macroDeltaSame: {
    color: "#596575",
  },
  macroDeltaChanged: {
    color: "#76CFC0",
  },
  assistantRow: {
    maxWidth: "91%",
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  assistantAvatar: {
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(94,234,212,0.09)",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.18)",
  },
  errorAvatar: {
    backgroundColor: "rgba(245,158,139,0.08)",
    borderColor: "rgba(245,158,139,0.22)",
  },
  bubble: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 15,
  },
  bubbleUser: {
    maxWidth: "84%",
    alignSelf: "flex-end",
    backgroundColor: "#20364B",
    borderBottomRightRadius: 5,
  },
  bubbleAssistant: {
    flexShrink: 1,
    backgroundColor: "#16191F",
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: "#20242C",
  },
  bubbleError: {
    backgroundColor: "rgba(245,158,139,0.07)",
    borderColor: "rgba(245,158,139,0.2)",
  },
  bubbleText: {
    fontSize: 13,
    lineHeight: 19,
  },
  bubbleTextUser: {
    color: "#E5F0FC",
  },
  bubbleTextAssistant: {
    color: "#BAC4D0",
  },
  bubbleTextError: {
    color: "#E1B7B0",
  },
  startersSection: {
    marginLeft: 36,
    gap: 8,
  },
  startersLabel: {
    color: "#5C6878",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  startersGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  starterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: "rgba(156,192,232,0.07)",
    borderWidth: 1,
    borderColor: "rgba(156,192,232,0.19)",
  },
  starterText: {
    color: "#B8CBE0",
    fontSize: 12,
    fontWeight: "700",
  },
  starterHint: {
    color: "#626E7E",
    fontSize: 10,
    lineHeight: 14,
  },
  loadingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
  },
  loadingTitle: {
    color: "#BFD3D0",
    fontSize: 12,
    fontWeight: "700",
  },
  loadingSubtitle: {
    color: "#687986",
    fontSize: 10,
    marginTop: 2,
  },
  retryBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 9,
    paddingVertical: 3,
  },
  retryText: {
    color: "#F3B4A9",
    fontSize: 11,
    fontWeight: "800",
  },
  revisedCard: {
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(94,234,212,0.055)",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.24)",
  },
  revisedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  revisedIcon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#5EEAD4",
  },
  revisedHeading: {
    flex: 1,
  },
  revisedTitle: {
    color: "#B8F1E8",
    fontSize: 14,
    fontWeight: "800",
  },
  revisedSubtitle: {
    color: "#6F938E",
    fontSize: 10,
    marginTop: 1,
  },
  revisionNote: {
    color: "#9FC7C0",
    fontSize: 12,
    lineHeight: 17,
  },
  revisedFoodName: {
    color: "#E4F5F2",
    fontSize: 15,
    fontWeight: "800",
  },
  revisedFoodAmount: {
    color: "#71918C",
    fontSize: 11,
    marginTop: 2,
  },
  ledger: {
    gap: 7,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(94,234,212,0.2)",
  },
  ledgerTitle: {
    color: "#75958F",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 1,
  },
  ledgerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  ledgerName: {
    flex: 1,
    minWidth: 0,
    color: "#B3C6C3",
    fontSize: 12,
  },
  ledgerAmount: {
    color: "#647C78",
    fontSize: 10,
  },
  ledgerCal: {
    color: "#8FC5BC",
    fontSize: 11,
    fontWeight: "700",
  },
  acceptBtn: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 12,
    backgroundColor: "#5EEAD4",
  },
  acceptBtnText: {
    color: colors.onAccent,
    fontSize: 14,
    fontWeight: "800",
  },
  limitCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(94,234,212,0.05)",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.14)",
  },
  limitText: {
    flex: 1,
    color: "#829C98",
    fontSize: 11,
    lineHeight: 16,
  },
  composerWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: Platform.OS === "ios" ? 7 : 10,
    backgroundColor: "#0B0C0F",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  composerMeta: {
    minHeight: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 3,
    marginBottom: 5,
  },
  turnText: {
    color: "#647082",
    fontSize: 10,
    fontWeight: "600",
  },
  characterCount: {
    color: "#647082",
    fontSize: 10,
  },
  inputRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingLeft: 13,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#14171C",
    borderWidth: 1,
    borderColor: "#272C35",
  },
  input: {
    flex: 1,
    minHeight: 34,
    maxHeight: 96,
    paddingTop: Platform.OS === "ios" ? 8 : 5,
    paddingBottom: Platform.OS === "ios" ? 7 : 5,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
  },
  sendBtn: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#9CC0E8",
  },
  sendBtnDisabled: {
    opacity: 0.28,
  },
});
