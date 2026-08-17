import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import apiClient from "../lib/api-client";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import CreateNutritionPlanModal from "../components/nutrition/plan/CreateNutritionPlanModal";
import {
  MdSend,
  MdChatBubble,
  MdDelete,
  MdLunchDining,
  MdFitnessCenter,
  MdAutoAwesome,
} from "react-icons/md";

interface Message {
  role: "user" | "assistant";
  content: string;
}

type ChatMode = "coach" | "plan" | "nutrition";

export default function ChatbotPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<any[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<ChatMode>("coach");
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const seededPrompt = useRef(false);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const modeParam = searchParams.get("mode");
    const promptParam = searchParams.get("prompt");
    if (modeParam === "plan" || modeParam === "nutrition" || modeParam === "coach") {
      setChatMode(modeParam);
    }
    if (promptParam && !seededPrompt.current) {
      seededPrompt.current = true;
      setInputMessage(promptParam);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const resetConversation = () => {
    setMessages([]);
    setConversationHistory([]);
    setConversationId(null);
  };

  const toggleMode = (next: "plan" | "nutrition") => {
    if (chatMode === next) {
      setChatMode("coach");
    } else {
      setChatMode(next);
      resetConversation();
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || loading) return;

    const messageToSend = inputMessage.trim();
    const userMessage: Message = { role: "user", content: messageToSend };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputMessage("");
    setLoading(true);

    try {
      const res = await apiClient.post(
        "/api/ai-analysis/chat",
        {
          message: messageToSend,
          conversation_history: conversationHistory,
          conversation_id: conversationId,
          mode: chatMode,
        },
        { timeout: chatMode === "plan" || chatMode === "nutrition" ? 120000 : 60000 }
      );

      if (res.data.status === "success") {
        const assistantMessage: Message = {
          role: "assistant",
          content: res.data.response,
        };
        setMessages([...updatedMessages, assistantMessage]);
        setConversationHistory(res.data.conversation_history || []);
        if (res.data.conversation_id) {
          setConversationId(res.data.conversation_id);
        }
      } else {
        throw new Error("Chat failed");
      }
    } catch (error: any) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        role: "assistant",
        content: error.response?.data?.detail || "Sorry, I encountered an error. Please try again.",
      };
      setMessages([...updatedMessages, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    if (confirm("Clear conversation history?")) {
      resetConversation();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const hasUserMessage = messages.some((m) => m.role === "user");

  const title =
    chatMode === "plan"
      ? "Plan Mode"
      : chatMode === "nutrition"
        ? "Nutrition Plan Mode"
        : "AI Coach";

  const emptyTitle =
    chatMode === "plan"
      ? "Build a training plan together"
      : chatMode === "nutrition"
        ? "Design a nutrition plan that fits your life"
        : "Start a conversation with your AI coach";

  const emptyBody =
    chatMode === "plan"
      ? "Tell me your goals, schedule, and equipment. I'll interview you, then we can generate a structured workout plan."
      : chatMode === "nutrition"
        ? "Tell me how you actually eat and what your training is for. I'll ask follow-ups, then we can save a nutrition plan that supports your workouts."
        : "Ask questions about your fitness progress, get personalized advice, or discuss your training and nutrition goals.";

  const placeholder =
    chatMode === "plan"
      ? "Describe your training goals..."
      : chatMode === "nutrition"
        ? "How do you usually eat on a training day?"
        : "Ask your AI coach a question...";

  return (
    <div className="p-8 lg:p-12 max-w-[1000px] mx-auto h-[calc(100vh-4rem)] flex flex-col">
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-4xl font-bold text-[#FFFFFF] mb-2">{title}</h1>
            <p className="text-[#8E8E93]">
              {chatMode === "nutrition"
                ? "Interview, then generate a nutrition plan"
                : chatMode === "plan"
                  ? "Interview, then generate a workout plan"
                  : "Chat with your AI fitness coach"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => toggleMode("plan")}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                chatMode === "plan"
                  ? "bg-[#FF6B35] border-[#FF6B35] text-white"
                  : "bg-[#161A22] border-[#2A2D35] text-[#FF6B35]"
              }`}
            >
              <MdFitnessCenter size={16} />
              Plan
            </button>
            <button
              type="button"
              onClick={() => toggleMode("nutrition")}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                chatMode === "nutrition"
                  ? "bg-[#FF6B35] border-[#FF6B35] text-white"
                  : "bg-[#161A22] border-[#2A2D35] text-[#FF6B35]"
              }`}
            >
              <MdLunchDining size={16} />
              Nutrition
            </button>
            {messages.length > 0 && (
              <Button onClick={clearConversation} variant="secondary" icon={<MdDelete />}>
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden mb-4">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              {chatMode === "nutrition" ? (
                <MdLunchDining className="text-6xl text-[#FF6B35] mb-4" />
              ) : chatMode === "plan" ? (
                <MdFitnessCenter className="text-6xl text-[#FF6B35] mb-4" />
              ) : (
                <MdChatBubble className="text-6xl text-[#FF6B35] mb-4" />
              )}
              <h3 className="text-xl font-bold text-[#FFFFFF] mb-2">{emptyTitle}</h3>
              <p className="text-[#8E8E93] max-w-md">{emptyBody}</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${
                    message.role === "user"
                      ? "bg-[#FF6B35] text-white"
                      : "bg-[#2A2D35] text-[#FFFFFF]"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{message.content}</div>
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#2A2D35] text-[#FFFFFF] rounded-lg p-4">
                <div className="flex gap-2">
                  <div
                    className="w-2 h-2 bg-[#8E8E93] rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <div
                    className="w-2 h-2 bg-[#8E8E93] rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <div
                    className="w-2 h-2 bg-[#8E8E93] rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {chatMode === "nutrition" && hasUserMessage ? (
          <button
            type="button"
            onClick={() => setCreatePlanOpen(true)}
            className="mx-4 mb-2 flex items-center justify-center gap-2 py-3 rounded-xl border border-[rgba(255,107,53,0.45)] bg-[rgba(255,107,53,0.08)] text-[#FF6B35] font-bold text-sm hover:bg-[rgba(255,107,53,0.15)]"
          >
            <MdAutoAwesome size={18} />
            Generate Nutrition Plan
          </button>
        ) : null}

        <div className="border-t border-[#2A2D35] p-4">
          <div className="flex gap-3">
            <Input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex-1"
            />
            <Button
              onClick={sendMessage}
              disabled={!inputMessage.trim() || loading}
              loading={loading}
              icon={<MdSend />}
            >
              Send
            </Button>
          </div>
        </div>
      </Card>

      <CreateNutritionPlanModal
        visible={createPlanOpen}
        conversationId={conversationId}
        onClose={() => setCreatePlanOpen(false)}
        onCreated={() => {
          setCreatePlanOpen(false);
        }}
      />
    </div>
  );
}
