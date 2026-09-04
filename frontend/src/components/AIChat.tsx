import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Animated,
  Modal,
  ActivityIndicator,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import LinearGradient from "./shared/LinearGradient";
import Button from "./shared/Button";
import Markdown from "./shared/Markdown";
import ConversationSidebar from "./chat/ConversationSidebar";
import CreatePlanModal from "./plan/CreatePlanModal";
import CreateNutritionPlanModal from "./nutrition/plan/CreateNutritionPlanModal";
import { NutritionSuggestionArtifact } from "../api/nutritionPlan";
import apiClient from "../api/client";
import { streamChat, StreamError } from "../api/streamChat";
import RequestAiAccessModal from "./ai/RequestAiAccessModal";
import ReportContentModal from "./ai/ReportContentModal";
import { fetchAiAccessStatus, AiAccessStatus, quotaDetailFromError, blockedDetailFromError } from "../api/aiAccess";
import { AI_DISCLAIMER } from "./legal/disclaimers";
import {
  ConversationSummary,
  listConversations,
  getConversation,
  renameConversation,
  deleteConversation,
} from "../api/conversations";
import { colors, spacing, borderRadius, shadows } from "../theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AI_MODEL_OPTIONS,
  AI_MODEL_STORAGE_KEY,
  AiModelId,
  DEFAULT_AI_MODEL,
  normalizeAiModel,
} from "../lib/aiModels";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** Plan edits this turn staged for review. Chat never writes the plan. */
  suggestions?: NutritionSuggestionArtifact;
  /** Coach-mode message that sounds like a durable program decision. */
  planIntent?: boolean;
}

const PLAN_INTENT_PATTERNS = [
  /\b(add|remove|replace|swap|change)\b.{0,35}\b(exercise|lift|movement|workout|day)\b/i,
  /\b(change|switch|update|redo|edit|adjust)\b.{0,30}\b(plan|split|program|routine|goal)\b/i,
  /\b(push\s*pull\s*legs|upper\s*lower|full[ -]?body|training split)\b/i,
  /\b(build|building|maintain|maintaining)\b.{0,35}\b(bench|press|squat|deadlift|row|lift|strength|muscle)\b/i,
  /\b(goal|target)\b.{0,45}\b(by|within|for my|on my plan|this block)\b/i,
  /\b(make|set)\b.{0,25}\b(my )?(goal|target)\b/i,
  /\bput\b.{0,25}\b(in|into|on)\b.{0,15}\b(my )?plan\b/i,
];

function looksLikePlanIntent(message: string): boolean {
  return PLAN_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}

function suggestionArtifact(artifacts?: any[]): NutritionSuggestionArtifact | undefined {
  return (artifacts || []).find((a) => a?.type === "nutrition_suggestions");
}

// Shown while the coach is pulling data mid-answer
const TOOL_LABELS: Record<string, string> = {
  get_recent_activity: "Reviewing your recent workouts and nutrition...",
  get_recent_sessions: "Checking your recent workouts...",
  get_workout_session: "Opening that workout day...",
  get_exercise_history: "Looking up your lift history...",
  get_todays_plan: "Checking today's plan...",
  get_current_split: "Looking at your current split...",
  get_nutrition_log: "Reviewing your nutrition log...",
  get_nutrition_plan: "Checking your nutrition plan...",
  propose_nutrition_edits: "Drafting plan updates...",
  get_training_plan: "Looking at your training plan...",
  get_wellness_log: "Reviewing your sleep and recovery...",
  get_personal_records: "Looking up your personal bests...",
};

type ChatMode = "coach" | "plan" | "nutrition";

interface AIChatProps {
  /** A starter prompt handed over from another tab (e.g. "Ask Coach About Plan"). */
  initialPrompt?: string | null;
  onPromptConsumed?: () => void;
  /** Opens Plan or Nutrition interview mode from another tab. */
  initialMode?: ChatMode | null;
  onModeConsumed?: () => void;
  /** Jumps to the Nutrition Plan tab to review coach-staged plan edits. */
  onOpenNutritionPlan?: () => void;
}

export default function AIChat({
  initialPrompt,
  onPromptConsumed,
  initialMode,
  onModeConsumed,
  onOpenNutritionPlan,
}: AIChatProps = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<any[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameText, setRenameText] = useState("");
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [createNutritionOpen, setCreateNutritionOpen] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("coach");
  const [aiModel, setAiModel] = useState<AiModelId>(DEFAULT_AI_MODEL);
  const [aiStatus, setAiStatus] = useState<AiAccessStatus | null>(null);
  const [refreshingAiStatus, setRefreshingAiStatus] = useState(false);
  const [requestAccessOpen, setRequestAccessOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const cancelStreamRef = useRef<(() => void) | null>(null);

  const refreshConversations = async () => {
    setLoadingList(true);
    try {
      setConversations(await listConversations());
    } catch (error) {
      console.error("Error loading conversations:", error);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    refreshConversations();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(AI_MODEL_STORAGE_KEY)
      .then((raw) => {
        if (raw) setAiModel(normalizeAiModel(raw));
      })
      .catch(() => {});
  }, []);

  const selectAiModel = (model: AiModelId) => {
    setAiModel(model);
    AsyncStorage.setItem(AI_MODEL_STORAGE_KEY, model).catch(() => {});
  };

  const startNewChat = (keepPlanMode = false) => {
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
    setMessages([]);
    setConversationHistory([]);
    setConversationId(null);
    setLoading(false);
    setToolStatus(null);
    setSidebarOpen(false);
    if (!keepPlanMode) setChatMode("coach");
  };

  const openConversation = async (id: string) => {
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
    setSidebarOpen(false);
    setLoading(false);
    setToolStatus(null);

    try {
      const conversation = await getConversation(id);
      if (!conversation) return;
      const loaded: Message[] = conversation.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));
      setMessages(loaded);
      setConversationHistory(loaded);
      setConversationId(id);
      setChatMode(
        conversation.mode === "plan" || conversation.mode === "nutrition"
          ? conversation.mode
          : "coach"
      );
    } catch (error) {
      console.error("Error opening conversation:", error);
      Alert.alert("Error", "Could not open that chat.");
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      // Deleting the open chat leaves the view on a fresh thread
      if (id === conversationId) startNewChat();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      Alert.alert("Error", "Could not delete that chat.");
    }
  };

  const enterMode = (next: ChatMode) => {
    if (messages.length > 0 && chatMode !== next) {
      startNewChat(true);
    }
    setChatMode(next);
  };

  const toggleMode = (next: "plan" | "nutrition") => {
    if (chatMode === next) setChatMode("coach");
    else enterMode(next);
  };

  const continueInPlanMode = (prompt: string) => {
    startNewChat(true);
    setChatMode("plan");
    setInputMessage(prompt);
  };
  const handleRenameConversation = (id: string, currentTitle: string) => {
    setRenameTarget({ id, title: currentTitle });
    setRenameText(currentTitle);
  };

  const submitRename = async () => {
    const target = renameTarget;
    const title = renameText.trim();
    setRenameTarget(null);
    if (!target || !title) return;

    try {
      await renameConversation(target.id, title);
      setConversations((prev) =>
        prev.map((c) => (c.id === target.id ? { ...c, title } : c))
      );
    } catch (error) {
      console.error("Error renaming conversation:", error);
      Alert.alert("Error", "Could not rename that chat.");
    }
  };

  useEffect(() => {
    // Scroll to bottom when messages change
    if (messages.length > 0 && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // Abort any in-flight stream when the tab unmounts
  useEffect(() => () => cancelStreamRef.current?.(), []);

  // Prefill (but don't send) a prompt handed over from the Plan tab, so the
  // user can finish the sentence themselves
  useEffect(() => {
    if (initialPrompt) {
      setInputMessage(initialPrompt);
      onPromptConsumed?.();
    }
  }, [initialPrompt, onPromptConsumed]);

  useEffect(() => {
    if (initialMode === "plan" || initialMode === "nutrition") {
      setChatMode(initialMode);
      onModeConsumed?.();
    }
  }, [initialMode, onModeConsumed]);

  const refreshAiStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setRefreshingAiStatus(true);
    try {
      setAiStatus(await fetchAiAccessStatus());
    } catch {
      // A failed status read shouldn't block chatting; the backend is still the
      // authority and will return 429 if the user is actually out.
    } finally {
      if (!opts?.silent) setRefreshingAiStatus(false);
    }
  }, []);

  useEffect(() => {
    refreshAiStatus({ silent: true });
  }, [refreshAiStatus]);

  useFocusEffect(
    useCallback(() => {
      refreshAiStatus({ silent: true });
    }, [refreshAiStatus])
  );

  /** Show the limit message as a coach turn and offer the request-access flow. */
  const showQuotaMessage = (baseMessages: Message[], message: string) => {
    setMessages([...baseMessages, { role: "assistant", content: message }]);
    refreshAiStatus();
  };

  // Falls back to the buffered endpoint when streaming fails before any text
  // has arrived, so a proxy that won't pass SSE through still gets an answer
  const sendBuffered = async (messageToSend: string, baseMessages: Message[]) => {
    try {
      const res = await apiClient.post(
        "/api/ai-analysis/chat",
        {
          message: messageToSend,
          conversation_id: conversationId,
          conversation_history: conversationHistory,
          mode: chatMode,
          model: aiModel,
        },
        // GPT-4o responses regularly run past the default 30s client timeout
        { timeout: chatMode === "coach" && aiModel !== "gpt-5.6-sol" ? 90000 : 120000 }
      );

      if (res.data.status !== "success") throw new Error("Chat failed");

      setMessages([
        ...baseMessages,
        {
          role: "assistant",
          content: res.data.response,
          suggestions: suggestionArtifact(res.data.artifacts),
        },
      ]);
      setConversationHistory(res.data.conversation_history || []);
      if (res.data.conversation_id) setConversationId(res.data.conversation_id);
      if (res.data.ai_access) setAiStatus(res.data.ai_access);
      refreshConversations();
    } catch (error: any) {
      const quota = quotaDetailFromError(error);
      if (quota) {
        showQuotaMessage(baseMessages, quota.message);
        return;
      }
      const blocked = blockedDetailFromError(error);
      if (blocked) {
        setMessages([...baseMessages, { role: "assistant", content: blocked.message }]);
        return;
      }
      console.error("Error sending message:", error);
      const detail = error.response?.data?.detail;
      setMessages([
        ...baseMessages,
        {
          role: "assistant",
          content:
            (typeof detail === "string" && detail) ||
            detail?.message ||
            "Sorry, I encountered an error. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
      setToolStatus(null);
    }
  };

  const sendMessage = () => {
    if (!inputMessage.trim() || loading) return;
    if (outOfQuota) {
      setRequestAccessOpen(true);
      return;
    }

    const messageToSend = inputMessage.trim();
    const updatedMessages: Message[] = [
      ...messages,
      {
        role: "user",
        content: messageToSend,
        planIntent: chatMode === "coach" && looksLikePlanIntent(messageToSend),
      },
    ];
    setMessages(updatedMessages);
    setInputMessage("");
    setLoading(true);
    setToolStatus(null);

    let streamed = "";

    cancelStreamRef.current = streamChat(
      {
        message: messageToSend,
        conversationId,
        conversationHistory,
        mode: chatMode,
        model: aiModel,
      },
      {
        onTool: (name) => setToolStatus(TOOL_LABELS[name] || "Looking that up..."),
        onDelta: (text) => {
          streamed += text;
          setToolStatus(null);
          // Replace the in-progress assistant bubble on each chunk
          setMessages([...updatedMessages, { role: "assistant", content: streamed }]);
        },
        onDone: (payload) => {
          setMessages([
            ...updatedMessages,
            {
              role: "assistant",
              content: payload.response || streamed,
              suggestions: suggestionArtifact(payload.artifacts),
            },
          ]);
          setConversationHistory(payload.conversation_history || []);
          if (payload.conversation_id) setConversationId(payload.conversation_id);
          if (payload.ai_access) setAiStatus(payload.ai_access);
          setLoading(false);
          setToolStatus(null);
          cancelStreamRef.current = null;
          refreshConversations();
        },
        onError: (error: StreamError) => {
          cancelStreamRef.current = null;
          if (streamed) {
            // Partial answer on screen — keep it rather than discarding
            console.error("Stream interrupted:", error);
            setMessages([...updatedMessages, { role: "assistant", content: streamed }]);
            setLoading(false);
            setToolStatus(null);
            return;
          }

          // These are deliberate refusals, not transport failures. Retrying on
          // the buffered endpoint would spend a second AI call against the same
          // limit (or re-trip the same moderation block), so stop here.
          if (error.kind === "quota" || error.kind === "blocked" || error.kind === "auth") {
            if (error.kind === "quota") {
              showQuotaMessage(updatedMessages, error.message);
            } else {
              setMessages([...updatedMessages, { role: "assistant", content: error.message }]);
            }
            setLoading(false);
            setToolStatus(null);
            return;
          }

          console.warn("Streaming unavailable, falling back:", error.message);
          sendBuffered(messageToSend, updatedMessages);
        },
      }
    );
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isUser = item.role === "user";

    return (
      <View
        style={[
          styles.messageContainer,
          isUser ? styles.userMessageContainer : styles.assistantMessageContainer,
        ]}
      >
        {isUser ? (
          <View style={styles.userColumn}>
            <LinearGradient
              colors={[colors.accentPrimary, colors.accentSecondary]}
              style={styles.messageBubble}
            >
              <Text style={styles.messageText}>{item.content}</Text>
            </LinearGradient>
            {item.planIntent ? (
              <TouchableOpacity
                style={styles.planIntentCard}
                onPress={() => continueInPlanMode(item.content)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Continue this request in Plan Mode"
              >
                <MaterialCommunityIcons name="target" size={16} color={colors.accentPrimary} />
                <View style={styles.planIntentCopy}>
                  <Text style={styles.planIntentTitle}>Make this part of your plan?</Text>
                  <Text style={styles.planIntentBody}>Continue in Plan Mode so this becomes a durable plan change.</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={19} color={colors.accentPrimary} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <View style={styles.assistantColumn}>
            <View style={[styles.messageBubble, styles.assistantBubble]}>
              <Markdown style={styles.messageText}>{item.content}</Markdown>
            </View>
            {item.suggestions ? (
              <TouchableOpacity
                style={styles.suggestionCard}
                onPress={() => onOpenNutritionPlan?.()}
                activeOpacity={0.85}
              >
                <View style={styles.suggestionCardHeader}>
                  <MaterialCommunityIcons
                    name="auto-fix"
                    size={16}
                    color={colors.ai}
                  />
                  <Text style={styles.suggestionCardTitle}>
                    {item.suggestions.count}{" "}
                    {item.suggestions.count === 1 ? "plan update" : "plan updates"} ready
                  </Text>
                </View>
                {item.suggestions.titles.slice(0, 3).map((title) => (
                  <Text key={title} style={styles.suggestionCardLine} numberOfLines={1}>
                    · {title}
                  </Text>
                ))}
                <Text style={styles.suggestionCardCta}>Review updates →</Text>
              </TouchableOpacity>
            ) : null}
            {/* Guideline 1.2: every AI response must be reportable */}
            <TouchableOpacity
              style={styles.reportButton}
              onPress={() => setReportTarget(item.content)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons
                name="flag-outline"
                size={13}
                color={colors.textMuted}
              />
              <Text style={styles.reportButtonText}>Report</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons
        name={chatMode === "plan" ? "target" : chatMode === "nutrition" ? "food-apple" : "robot"}
        size={80}
        color={colors.accentPrimary}
      />
      <Text style={styles.emptyTitle}>
        {chatMode === "plan"
          ? "Let's design your plan"
          : chatMode === "nutrition"
            ? "Let's design how you eat"
            : "Start a conversation with your AI coach"}
      </Text>
      <Text style={styles.emptySubtitle}>
        {chatMode === "plan"
          ? "Tell me what you want this block to achieve. I'll look at your split and recent workouts, then ask follow-ups until we can build a program that fits."
          : chatMode === "nutrition"
            ? "Tell me how you actually eat and what your training is for. I'll ask follow-ups, then we can save a nutrition plan that supports your workouts."
            : "Ask questions about your fitness progress, get personalized advice, or tap Plan / Nutrition to design a program."}
      </Text>
      <View style={styles.emptyDisclaimer}>
        <MaterialCommunityIcons
          name="information-outline"
          size={14}
          color={colors.textMuted}
        />
        <Text style={styles.emptyDisclaimerText}>{AI_DISCLAIMER}</Text>
      </View>
    </View>
  );

  const renderLoadingIndicator = () => (
    <View style={[styles.messageContainer, styles.assistantMessageContainer]}>
      <View style={[styles.messageBubble, styles.assistantBubble, styles.loadingBubble]}>
        {toolStatus ? (
          <Text style={styles.toolStatusText}>{toolStatus}</Text>
        ) : (
          <View style={styles.loadingDots}>
            <LoadingDot delay={0} />
            <LoadingDot delay={150} />
            <LoadingDot delay={300} />
          </View>
        )}
      </View>
    </View>
  );

  // Once tokens start arriving the assistant bubble itself shows progress, so
  // the dots would be redundant
  const isAwaitingFirstToken =
    loading && messages[messages.length - 1]?.role !== "assistant";

  const hasUserMessage = messages.some((m) => m.role === "user");

  // The backend is the real gate; these only drive the UI so the user isn't
  // surprised by a refusal after typing a long message.
  const outOfQuota = !!aiStatus && !aiStatus.unlimited && (aiStatus.remaining ?? 0) <= 0;
  const lowQuota =
    !!aiStatus && !aiStatus.unlimited && (aiStatus.remaining ?? 0) > 0 && (aiStatus.remaining ?? 0) <= 2;

  const conversationTitle = conversations.find((c) => c.id === conversationId)?.title;
  const activeTitle =
    conversationTitle ||
    (chatMode === "plan" ? "Plan Mode" : chatMode === "nutrition" ? "Nutrition Plan Mode" : "AI Coach");

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <LinearGradient colors={[colors.background, colors.cardBackground]} style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={() => setSidebarOpen(true)}
              style={styles.menuButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="menu" size={26} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.headerText}>
              <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
                {activeTitle}
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1} ellipsizeMode="tail">
                {chatMode === "plan"
                  ? "Interview, then generate a program"
                  : chatMode === "nutrition"
                    ? "Interview, then generate a nutrition plan"
                    : "Your fitness companion"}
              </Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => refreshAiStatus()}
              style={styles.refreshButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              disabled={refreshingAiStatus}
              accessibilityLabel="Refresh AI access"
            >
              {refreshingAiStatus ? (
                <ActivityIndicator size="small" color={colors.accentPrimary} />
              ) : (
                <MaterialCommunityIcons
                  name="refresh"
                  size={22}
                  color={colors.accentPrimary}
                />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => toggleMode("plan")}
              style={[styles.planButton, chatMode === "plan" && styles.planButtonActive]}
            >
              <MaterialCommunityIcons
                name="target"
                size={16}
                color={chatMode === "plan" ? "#fff" : colors.accentPrimary}
              />
              <Text style={[styles.planButtonText, chatMode === "plan" && styles.planButtonTextActive]}>
                Plan
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => toggleMode("nutrition")}
              style={[styles.planButton, chatMode === "nutrition" && styles.planButtonActive]}
            >
              <MaterialCommunityIcons
                name="food-apple"
                size={16}
                color={chatMode === "nutrition" ? "#fff" : colors.accentPrimary}
              />
              <Text style={[styles.planButtonText, chatMode === "nutrition" && styles.planButtonTextActive]}>
                Food
              </Text>
            </TouchableOpacity>
            {messages.length > 0 && (
              <TouchableOpacity onPress={() => startNewChat()} style={styles.clearButton}>
                <MaterialCommunityIcons
                  name="plus-circle-outline"
                  size={22}
                  color={colors.accentPrimary}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
        <View style={styles.modelRow}>
          <Text style={styles.modelLabel}>Model</Text>
          <View style={styles.modelToggle}>
            {AI_MODEL_OPTIONS.map((opt) => {
              const active = aiModel === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  onPress={() => selectAiModel(opt.id)}
                  style={[styles.modelChip, active && styles.modelChipActive]}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <Text style={[styles.modelChipText, active && styles.modelChipTextActive]}>
                    {opt.short}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </LinearGradient>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item, index) => index.toString()}
        contentContainerStyle={[
          styles.messagesList,
          messages.length === 0 && styles.messagesListEmpty,
        ]}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={isAwaitingFirstToken ? renderLoadingIndicator : null}
        keyboardShouldPersistTaps="handled"
      />

      <View style={styles.inputContainer}>
        {outOfQuota ? (
          <View style={styles.quotaBanner}>
            <MaterialCommunityIcons name="lock-outline" size={16} color={colors.warning} />
            <TouchableOpacity
              style={{ flex: 1 }}
              onPress={() => setRequestAccessOpen(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.quotaBannerText}>
                You've used all {aiStatus?.daily_limit} AI requests for today.
                {aiStatus?.request_status === "pending"
                  ? " Your access request is being reviewed."
                  : " Tap to request more access."}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => refreshAiStatus()}
              style={styles.quotaRefreshBtn}
              disabled={refreshingAiStatus}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Refresh quota"
            >
              {refreshingAiStatus ? (
                <ActivityIndicator size="small" color={colors.warning} />
              ) : (
                <MaterialCommunityIcons name="refresh" size={18} color={colors.warning} />
              )}
            </TouchableOpacity>
          </View>
        ) : lowQuota ? (
          <View style={styles.quotaHint}>
            <Text style={styles.quotaHintText}>
              {aiStatus?.remaining} AI {aiStatus?.remaining === 1 ? "request" : "requests"} left today
            </Text>
            <TouchableOpacity
              onPress={() => refreshAiStatus()}
              disabled={refreshingAiStatus}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {refreshingAiStatus ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <MaterialCommunityIcons name="refresh" size={14} color={colors.textMuted} />
              )}
            </TouchableOpacity>
          </View>
        ) : null}
        {chatMode === "plan" && hasUserMessage ? (
          <TouchableOpacity
            style={styles.generateBar}
            onPress={() => setCreatePlanOpen(true)}
            disabled={loading}
          >
            <MaterialCommunityIcons name="auto-fix" size={18} color="#fff" />
            <Text style={styles.generateBarText}>Generate Plan</Text>
          </TouchableOpacity>
        ) : null}
        {chatMode === "nutrition" && hasUserMessage ? (
          <TouchableOpacity
            style={styles.generateBar}
            onPress={() => setCreateNutritionOpen(true)}
            disabled={loading}
          >
            <MaterialCommunityIcons name="auto-fix" size={18} color="#fff" />
            <Text style={styles.generateBarText}>Generate Nutrition Plan</Text>
          </TouchableOpacity>
        ) : null}
        <View style={[styles.inputWrapper, chatMode !== "coach" && styles.inputWrapperPlan]}>
          <TextInput
            style={styles.input}
            value={inputMessage}
            onChangeText={setInputMessage}
            placeholder={
              chatMode === "plan"
                ? "What do you want this plan to achieve?"
                : chatMode === "nutrition"
                  ? "How do you actually eat — and what should food support?"
                  : "Ask your AI coach a question..."
            }
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={chatMode === "coach" ? 500 : 800}
            editable={!loading && !outOfQuota}
          />
          <TouchableOpacity
            onPress={sendMessage}
            style={[
              styles.sendButton,
              (!inputMessage.trim() || loading || outOfQuota) && styles.sendButtonDisabled,
            ]}
            disabled={!inputMessage.trim() || loading || outOfQuota}
          >
            <MaterialCommunityIcons
              name="send"
              size={24}
              color={
                !inputMessage.trim() || loading || outOfQuota
                  ? colors.textSecondary
                  : colors.accentPrimary
              }
            />
          </TouchableOpacity>
        </View>
      </View>

      <RequestAiAccessModal
        visible={requestAccessOpen}
        status={aiStatus}
        onClose={() => setRequestAccessOpen(false)}
        onSubmitted={refreshAiStatus}
      />

      <ReportContentModal
        content={reportTarget}
        conversationId={conversationId}
        onClose={() => setReportTarget(null)}
      />

      <CreatePlanModal
        visible={createPlanOpen}
        conversationId={conversationId}
        onClose={() => setCreatePlanOpen(false)}
        onAdjustWithCoach={(prompt) => {
          setCreatePlanOpen(false);
          setInputMessage(prompt);
        }}
        onCreated={() => {
          setCreatePlanOpen(false);
          Alert.alert("Plan active", "Your workouts and recommendations now follow this plan.");
        }}
      />

      <CreateNutritionPlanModal
        visible={createNutritionOpen}
        conversationId={conversationId}
        model={aiModel}
        onClose={() => setCreateNutritionOpen(false)}
        onCreated={() => {
          setCreateNutritionOpen(false);
          Alert.alert(
            "Nutrition plan active",
            "Today guidance and your calorie rings now follow this plan."
          );
        }}
      />

      <ConversationSidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={conversationId}
        loading={loadingList}
        onClose={() => setSidebarOpen(false)}
        onSelect={openConversation}
        onNewChat={() => startNewChat()}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
      />

      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename chat</Text>
            <TextInput
              style={styles.modalInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="Chat name"
              placeholderTextColor={colors.textMuted}
              autoFocus
              maxLength={48}
              onSubmitEditing={submitRename}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setRenameTarget(null)} style={styles.modalButton}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitRename}
                style={styles.modalButton}
                disabled={!renameText.trim()}
              >
                <Text style={[styles.modalSave, !renameText.trim() && styles.modalSaveDisabled]}>
                  Save
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// Animated loading dot component
function LoadingDot({ delay }: { delay: number }) {
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 600,
          delay,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [delay, animatedValue]);

  const translateY = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -8],
  });

  return (
    <Animated.View
      style={[styles.loadingDot, { transform: [{ translateY }] }]}
    />
  );
}

const styles = StyleSheet.create({
  userColumn: {
    alignItems: "flex-end",
    maxWidth: "100%",
  },
  planIntentCard: {
    width: "86%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderHover,
    borderRadius: borderRadius.md,
  },
  planIntentCopy: { flex: 1 },
  planIntentTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  planIntentBody: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  assistantColumn: {
    alignItems: "flex-start",
    maxWidth: "100%",
  },
  reportButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginTop: 2,
  },
  reportButtonText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  emptyDisclaimer: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.xl,
  },
  emptyDisclaimerText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  quotaBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  quotaBannerText: {
    flex: 1,
    color: colors.warning,
    fontSize: 12,
    lineHeight: 17,
  },
  quotaRefreshBtn: {
    padding: 2,
  },
  quotaHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  quotaHintText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  refreshButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    flex: 1,
    minWidth: 0,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  clearButton: {
    padding: spacing.xs,
  },
  messagesList: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  messagesListEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing["3xl"],
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  messageContainer: {
    marginBottom: spacing.md,
  },
  userMessageContainer: {
    alignItems: "flex-end",
  },
  assistantMessageContainer: {
    alignItems: "flex-start",
  },
  messageBubble: {
    maxWidth: "80%",
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    ...shadows.medium,
  },
  assistantBubble: {
    backgroundColor: colors.cardBackground,
  },
  messageText: {
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  loadingBubble: {
    paddingVertical: spacing.lg,
  },
  toolStatusText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: "italic",
  },
  menuButton: {
    paddingRight: spacing.xs,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexShrink: 0,
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  modelLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  modelToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  modelChip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: 999,
  },
  modelChipActive: {
    backgroundColor: colors.accentPrimary,
  },
  modelChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  modelChipTextActive: {
    color: colors.onAccent,
  },
  suggestionCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: "rgba(94,234,212,0.08)",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.4)",
  },
  suggestionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  suggestionCardTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
  suggestionCardLine: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  suggestionCardCta: {
    color: colors.ai,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  planButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accentPrimary,
    backgroundColor: "transparent",
    flexShrink: 0,
  },
  planButtonActive: {
    backgroundColor: colors.accentPrimary,
    borderColor: colors.accentPrimary,
  },
  planButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.accentPrimary,
  },
  planButtonTextActive: {
    color: colors.onAccent,
  },
  generateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.accentPrimary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  generateBarText: {
    color: colors.onAccent,
    fontWeight: "700",
    fontSize: 15,
  },
  inputWrapperPlan: {
    borderColor: "rgba(156, 192, 232,0.45)",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  modalButton: {
    paddingVertical: spacing.xs,
  },
  modalCancel: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: "600",
  },
  modalSave: {
    color: colors.accentPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  modalSaveDisabled: {
    opacity: 0.4,
  },
  loadingDots: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textSecondary,
  },
  inputContainer: {
    padding: spacing.lg,
    backgroundColor: colors.cardBackground,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    maxHeight: 100,
    paddingVertical: spacing.sm,
  },
  sendButton: {
    padding: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
