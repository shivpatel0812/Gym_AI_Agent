/**
 * Mini chatbot for disputing a photo/text macro estimate.
 *
 * Cal AI-style "Fix Results" flow — the user says what's wrong ("that's
 * chicken thigh not breast", "way more rice") and the AI revises inline.
 * Capped at 3 user turns to keep it fast and token-cheap.
 */

import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { colors } from "../../theme";
import type { MacroValues, PhotoEstimate } from "./photoEstimate";

const MAX_TURNS = 3;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  revisedEstimate?: RevisedEstimate | null;
}

interface RevisedEstimate {
  name: string;
  amount?: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  revision_note?: string | null;
}

interface MacroAdjustChatProps {
  estimate: PhotoEstimate;
  onAcceptRevision: (revised: RevisedEstimate) => void;
  onClose: () => void;
}

function stripJsonBlock(text: string): string {
  return text.replace(/```json[\s\S]*?```/g, "").replace(/```[\s\S]*?```/g, "").trim();
}

function MacroPill({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <View style={s.macroPill}>
      <Text style={[s.macroPillValue, { color }]}>{value}</Text>
      <Text style={s.macroPillUnit}>{unit}</Text>
      <Text style={s.macroPillLabel}>{label}</Text>
    </View>
  );
}

function RevisedCard({
  revised,
  onAccept,
}: {
  revised: RevisedEstimate;
  onAccept: () => void;
}) {
  return (
    <View style={s.revisedCard}>
      <View style={s.revisedHeader}>
        <MaterialCommunityIcons name="pencil-outline" size={14} color="#5EEAD4" />
        <Text style={s.revisedTitle}>Revised estimate</Text>
      </View>
      {revised.revision_note ? (
        <Text style={s.revisionNote}>{revised.revision_note}</Text>
      ) : null}
      <View style={s.macroRow}>
        <MacroPill label="Cal" value={revised.calories} unit="kcal" color="#9CC0E8" />
        <MacroPill label="Protein" value={revised.protein} unit="g" color="#E4B896" />
        <MacroPill label="Carbs" value={revised.carbs} unit="g" color="#F5C542" />
        <MacroPill label="Fat" value={revised.fats} unit="g" color="#C4B5FD" />
      </View>
      <TouchableOpacity style={s.acceptBtn} onPress={onAccept}>
        <Text style={s.acceptBtnText}>Use this estimate</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MacroAdjustChat({
  estimate,
  onAcceptRevision,
  onClose,
}: MacroAdjustChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [latestRevision, setLatestRevision] = useState<RevisedEstimate | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const userTurns = messages.filter((m) => m.role === "user").length;

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, sending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || userTurns >= MAX_TURNS) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setSending(true);

    try {
      const res = await apiClient.post(
        "/api/macros/adjust-estimate",
        {
          message: text,
          current_estimate: {
            name: estimate.name,
            amount: estimate.amount,
            calories: estimate.calories,
            protein: estimate.protein,
            carbs: estimate.carbs,
            fats: estimate.fats,
            fiber: estimate.fiber,
            assumptions: estimate.analysis?.assumptions,
            uncertainties: estimate.analysis?.uncertainties,
          },
          conversation_history: history,
        },
        { timeout: 30000 }
      );

      const reply = res.data?.reply || "I couldn't revise that — try rephrasing.";
      const revised: RevisedEstimate | null = res.data?.revised_estimate || null;
      const newHistory = res.data?.conversation_history || history;

      setHistory(newHistory);
      setLatestRevision(revised);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: stripJsonBlock(reply),
          revisedEstimate: revised,
        },
      ]);
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail || "Something went wrong. Try again.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: detail },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <MaterialCommunityIcons name="chat-processing-outline" size={18} color="#5EEAD4" />
        <Text style={s.headerTitle}>Fix estimate</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12}>
          <MaterialCommunityIcons name="close" size={20} color="#7C8CA0" />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.chatScroll}
        contentContainerStyle={s.chatContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Opening context */}
        <View style={s.contextCard}>
          <Text style={s.contextName}>{estimate.name}</Text>
          <Text style={s.contextAmount}>{estimate.amount || "Estimated portion"}</Text>
          <View style={s.macroRow}>
            <MacroPill label="Cal" value={estimate.calories} unit="kcal" color="#9CC0E8" />
            <MacroPill label="Protein" value={estimate.protein} unit="g" color="#E4B896" />
            <MacroPill label="Carbs" value={estimate.carbs} unit="g" color="#F5C542" />
            <MacroPill label="Fat" value={estimate.fats} unit="g" color="#C4B5FD" />
          </View>
        </View>

        <Text style={s.prompt}>
          What looks wrong? E.g. "That's chicken thigh not breast" or "there was way more rice."
        </Text>

        {messages.map((msg, i) => (
          <View key={i}>
            <View
              style={[
                s.bubble,
                msg.role === "user" ? s.bubbleUser : s.bubbleAssistant,
              ]}
            >
              <Text
                style={[
                  s.bubbleText,
                  msg.role === "user" ? s.bubbleTextUser : s.bubbleTextAssistant,
                ]}
              >
                {msg.content}
              </Text>
            </View>
            {msg.revisedEstimate ? (
              <RevisedCard
                revised={msg.revisedEstimate}
                onAccept={() => onAcceptRevision(msg.revisedEstimate!)}
              />
            ) : null}
          </View>
        ))}

        {sending ? (
          <View style={[s.bubble, s.bubbleAssistant, { flexDirection: "row", gap: 8 }]}>
            <ActivityIndicator size="small" color="#5EEAD4" />
            <Text style={s.bubbleTextAssistant}>Revising...</Text>
          </View>
        ) : null}
      </ScrollView>

      {userTurns >= MAX_TURNS ? (
        <View style={s.limitRow}>
          <Text style={s.limitText}>
            {latestRevision
              ? "Use the revised estimate above, or close to keep the original."
              : "Close to keep the original estimate."}
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={100}
        >
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={input}
              onChangeText={setInput}
              placeholder="What's wrong with the estimate?"
              placeholderTextColor="#55647A"
              multiline
              maxLength={300}
              editable={!sending}
              onSubmitEditing={handleSend}
              blurOnSubmit
            />
            <TouchableOpacity
              style={[s.sendBtn, (!input.trim() || sending) && { opacity: 0.3 }]}
              disabled={!input.trim() || sending}
              onPress={handleSend}
            >
              <MaterialCommunityIcons name="send" size={18} color={colors.onAccent} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    borderRadius: 14,
    backgroundColor: "#0C1017",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.3)",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flex: 1,
    color: "#5EEAD4",
    fontSize: 14,
    fontWeight: "800",
  },
  chatScroll: {
    maxHeight: 380,
  },
  chatContent: {
    padding: 14,
    gap: 10,
  },
  contextCard: {
    gap: 6,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
  },
  contextName: { color: "#fff", fontSize: 15, fontWeight: "800" },
  contextAmount: { color: "#7C8CA0", fontSize: 12 },
  macroRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  macroPill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderRadius: 8,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
  },
  macroPillValue: { fontSize: 14, fontWeight: "800" },
  macroPillUnit: { color: "#55647A", fontSize: 9, fontWeight: "700" },
  macroPillLabel: { color: "#55647A", fontSize: 9, fontWeight: "600", marginTop: 1 },
  prompt: {
    color: "#7C8CA0",
    fontSize: 12,
    lineHeight: 17,
    paddingVertical: 4,
  },
  bubble: {
    maxWidth: "85%",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(156,192,232,0.18)",
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "#161A22",
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 13, lineHeight: 19 },
  bubbleTextUser: { color: "#D4E4F7" },
  bubbleTextAssistant: { color: "#B0BCC9" },
  revisedCard: {
    marginTop: 6,
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "rgba(94,234,212,0.06)",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.22)",
  },
  revisedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  revisedTitle: { color: "#5EEAD4", fontSize: 12, fontWeight: "800" },
  revisionNote: { color: "#8CBAB2", fontSize: 11, lineHeight: 16 },
  acceptBtn: {
    backgroundColor: "#5EEAD4",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  acceptBtnText: { color: "#070708", fontWeight: "800", fontSize: 13 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    color: "#fff",
    fontSize: 13,
    maxHeight: 80,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#5EEAD4",
    alignItems: "center",
    justifyContent: "center",
  },
  limitRow: {
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  limitText: { color: "#7C8CA0", fontSize: 12, textAlign: "center" },
});
