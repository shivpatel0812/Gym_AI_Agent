import { useState, useEffect, useRef } from "react";
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
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import LinearGradient from "./shared/LinearGradient";
import Button from "./shared/Button";
import apiClient from "../api/client";
import { colors, spacing, borderRadius, shadows } from "../theme";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<any[]>([]);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    // Scroll to bottom when messages change
    if (messages.length > 0 && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!inputMessage.trim() || loading) return;

    const messageToSend = inputMessage.trim();
    const userMessage: Message = { role: "user", content: messageToSend };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputMessage("");
    setLoading(true);

    try {
      const res = await apiClient.post("/api/ai-analysis/chat", {
        message: messageToSend,
        conversation_history: conversationHistory,
      });

      if (res.data.status === "success") {
        const assistantMessage: Message = {
          role: "assistant",
          content: res.data.response,
        };
        setMessages([...updatedMessages, assistantMessage]);
        setConversationHistory(res.data.conversation_history || []);
      } else {
        throw new Error("Chat failed");
      }
    } catch (error: any) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        role: "assistant",
        content:
          error.response?.data?.detail || "Sorry, I encountered an error. Please try again.",
      };
      setMessages([...updatedMessages, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    Alert.alert(
      "Clear Conversation",
      "Are you sure you want to clear the conversation history?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            setMessages([]);
            setConversationHistory([]);
          },
        },
      ]
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
          <LinearGradient
            colors={[colors.accentPrimary, colors.accentSecondary]}
            style={styles.messageBubble}
          >
            <Text style={styles.messageText}>{item.content}</Text>
          </LinearGradient>
        ) : (
          <View style={[styles.messageBubble, styles.assistantBubble]}>
            <Text style={styles.messageText}>{item.content}</Text>
          </View>
        )}
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons name="robot" size={80} color={colors.accentPrimary} />
      <Text style={styles.emptyTitle}>Start a conversation with your AI coach</Text>
      <Text style={styles.emptySubtitle}>
        Ask questions about your fitness progress, get personalized advice, or discuss your
        training and nutrition goals.
      </Text>
    </View>
  );

  const renderLoadingIndicator = () => (
    <View style={[styles.messageContainer, styles.assistantMessageContainer]}>
      <View style={[styles.messageBubble, styles.assistantBubble, styles.loadingBubble]}>
        <View style={styles.loadingDots}>
          <LoadingDot delay={0} />
          <LoadingDot delay={150} />
          <LoadingDot delay={300} />
        </View>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <LinearGradient colors={[colors.background, colors.cardBackground]} style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <MaterialCommunityIcons name="robot" size={32} color={colors.accentPrimary} />
            <View>
              <Text style={styles.headerTitle}>AI Coach</Text>
              <Text style={styles.headerSubtitle}>Your fitness companion</Text>
            </View>
          </View>
          {messages.length > 0 && (
            <TouchableOpacity onPress={clearConversation} style={styles.clearButton}>
              <MaterialCommunityIcons name="delete" size={20} color={colors.danger} />
            </TouchableOpacity>
          )}
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
        ListFooterComponent={loading ? renderLoadingIndicator : null}
        keyboardShouldPersistTaps="handled"
      />

      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            value={inputMessage}
            onChangeText={setInputMessage}
            placeholder="Ask your AI coach a question..."
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={500}
            editable={!loading}
          />
          <TouchableOpacity
            onPress={sendMessage}
            style={[styles.sendButton, (!inputMessage.trim() || loading) && styles.sendButtonDisabled]}
            disabled={!inputMessage.trim() || loading}
          >
            <MaterialCommunityIcons
              name="send"
              size={24}
              color={!inputMessage.trim() || loading ? colors.textSecondary : colors.accentPrimary}
            />
          </TouchableOpacity>
        </View>
      </View>
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
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  clearButton: {
    padding: spacing.sm,
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
