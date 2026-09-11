import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import CreateNutritionPlanModal from "../components/nutrition/plan/CreateNutritionPlanModal";
import ConversationSidebar from "../components/chat/ConversationSidebar";
import { NutritionSuggestionArtifact } from "../api/nutritionPlan";
import { streamChat, StreamError } from "../api/streamChat";
import { getConversation } from "../api/conversations";
import {
  MdSend,
  MdChatBubble,
  MdDelete,
  MdLunchDining,
  MdFitnessCenter,
  MdAutoAwesome,
  MdMenu,
} from "react-icons/md";
import {
  AI_MODEL_OPTIONS,
  AiModelId,
  loadStoredAiModel,
  persistAiModel,
} from "../lib/aiModels";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** Plan edits this turn staged for review. Chat never writes the plan. */
  suggestions?: NutritionSuggestionArtifact;
}

type ChatMode = "coach" | "plan" | "nutrition";

function streamErrorMessage(error: StreamError): string {
  if (error.message) return error.message;
  switch (error.kind) {
    case "quota":
      return "You've used all of today's AI requests.";
    case "blocked":
      return "That message couldn't be processed. Please rephrase and try again.";
    case "auth":
      return "Please sign in again.";
    default:
      return "Sorry, I encountered an error. Please try again.";
  }
}

export default function ChatbotPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<any[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<ChatMode>("coach");
  const [aiModel, setAiModel] = useState<AiModelId>(() => loadStoredAiModel());
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const seededPrompt = useRef(false);
  const cancelStreamRef = useRef<(() => void) | null>(null);

  const selectAiModel = (model: AiModelId) => {
    setAiModel(model);
    persistAiModel(model);
  };

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

  useEffect(() => () => cancelStreamRef.current?.(), []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const resetConversation = () => {
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
    setMessages([]);
    setConversationHistory([]);
    setConversationId(null);
    setLoading(false);
  };

  const startNewChat = () => {
    resetConversation();
    setSidebarOpen(false);
  };

  const openConversation = async (id: string | null) => {
    if (id === null) {
      startNewChat();
      return;
    }

    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
    setSidebarOpen(false);
    setLoading(false);

    try {
      const conversation = await getConversation(id);
      if (!conversation) {
        setMessages([
          {
            role: "assistant",
            content: "Could not open that chat.",
          },
        ]);
        return;
      }
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
      setMessages([
        {
          role: "assistant",
          content: "Could not open that chat. Please try again.",
        },
      ]);
    }
  };

  const toggleMode = (next: "plan" | "nutrition") => {
    if (chatMode === next) {
      setChatMode("coach");
    } else {
      setChatMode(next);
      resetConversation();
    }
  };

  const sendMessage = () => {
    if (!inputMessage.trim() || loading) return;

    const messageToSend = inputMessage.trim();
    const userMessage: Message = { role: "user", content: messageToSend };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputMessage("");
    setLoading(true);

    let streamed = "";

    cancelStreamRef.current?.();
    cancelStreamRef.current = streamChat(
      {
        message: messageToSend,
        conversationId,
        conversationHistory,
        mode: chatMode,
        model: aiModel,
      },
      {
        onDelta: (text) => {
          streamed += text;
          setMessages([...updatedMessages, { role: "assistant", content: streamed }]);
        },
        onDone: (payload) => {
          const staged = (payload.artifacts || []).find(
            (a: any) => a?.type === "nutrition_suggestions"
          ) as NutritionSuggestionArtifact | undefined;
          setMessages([
            ...updatedMessages,
            {
              role: "assistant",
              content: payload.response || streamed,
              suggestions: staged,
            },
          ]);
          setConversationHistory(payload.conversation_history || []);
          if (payload.conversation_id) {
            setConversationId(payload.conversation_id);
          }
          setLoading(false);
          cancelStreamRef.current = null;
        },
        onError: (error: StreamError) => {
          cancelStreamRef.current = null;
          if (streamed) {
            setMessages([...updatedMessages, { role: "assistant", content: streamed }]);
            setLoading(false);
            return;
          }
          setMessages([
            ...updatedMessages,
            { role: "assistant", content: streamErrorMessage(error) },
          ]);
          setLoading(false);
        },
      }
    );
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

  // Show the bouncing dots only before the first streamed token arrives
  const showTyping =
    loading &&
    !(
      messages.length > 0 &&
      messages[messages.length - 1]?.role === "assistant" &&
      messages[messages.length - 1]?.content
    );

  return (
    <div className="h-[calc(100vh-4rem)] flex bg-[#0B0C10]">
      <ConversationSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeId={conversationId}
        onSelect={openConversation}
        onNew={startNewChat}
      />

      <div className="flex-1 min-w-0 flex flex-col p-6 lg:p-10 max-w-[1000px] mx-auto w-full">
        <div className="mb-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden mt-1 p-2 rounded-xl border border-[#2A2D35] bg-[#161A22] text-[#FF6B35]"
                aria-label="Open chats"
              >
                <MdMenu size={20} />
              </button>
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
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-semibold text-[#8E8E93]">Model</span>
            <div className="inline-flex rounded-full border border-[#2A2D35] bg-[#161A22] p-0.5">
              {AI_MODEL_OPTIONS.map((opt) => {
                const active = aiModel === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => selectAiModel(opt.id)}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                      active ? "bg-[#FF6B35] text-white" : "text-[#8E8E93] hover:text-white"
                    }`}
                  >
                    {opt.short}
                  </button>
                );
              })}
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
                    {message.suggestions ? (
                      <button
                        type="button"
                        data-testid="suggestion-card"
                        onClick={() => navigate("/nutrition?tab=plan&suggestions=1")}
                        className="mt-3 w-full text-left rounded-xl bg-[rgba(94,234,212,0.08)] border border-[#5EEAD4]/40 p-3 hover:bg-[rgba(94,234,212,0.14)]"
                      >
                        <div className="flex items-center gap-2">
                          <MdAutoAwesome className="text-[#5EEAD4] shrink-0" />
                          <span className="text-sm font-bold text-white">
                            {message.suggestions.count}{" "}
                            {message.suggestions.count === 1 ? "plan update" : "plan updates"} ready
                          </span>
                        </div>
                        <ul className="mt-2 space-y-0.5">
                          {message.suggestions.titles.slice(0, 3).map((suggestionTitle) => (
                            <li key={suggestionTitle} className="text-xs text-[#8E8E93]">
                              · {suggestionTitle}
                            </li>
                          ))}
                        </ul>
                        <span className="mt-2 inline-block text-xs font-bold text-[#5EEAD4]">
                          Review on Plan →
                        </span>
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {showTyping && (
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
          model={aiModel}
          onClose={() => setCreatePlanOpen(false)}
          onCreated={() => {
            setCreatePlanOpen(false);
          }}
        />
      </div>
    </div>
  );
}
