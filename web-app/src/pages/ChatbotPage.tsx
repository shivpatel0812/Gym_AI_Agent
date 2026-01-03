import { useState, useEffect, useRef } from "react";
import apiClient from "../lib/api-client";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import { MdSend, MdChatBubble, MdDelete } from "react-icons/md";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatbotPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
        content: error.response?.data?.detail || "Sorry, I encountered an error. Please try again.",
      };
      setMessages([...updatedMessages, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    if (confirm("Clear conversation history?")) {
      setMessages([]);
      setConversationHistory([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="p-8 lg:p-12 max-w-[1000px] mx-auto h-[calc(100vh-4rem)] flex flex-col">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-[#F9FAFB] mb-2">AI Chatbot</h1>
            <p className="text-[#9CA3AF]">Chat with your AI fitness coach</p>
          </div>
          {messages.length > 0 && (
            <Button
              onClick={clearConversation}
              variant="secondary"
              icon={<MdDelete />}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden mb-4">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <MdChatBubble className="text-6xl text-[#6366F1] mb-4" />
              <h3 className="text-xl font-bold text-[#F9FAFB] mb-2">
                Start a conversation with your AI coach
              </h3>
              <p className="text-[#9CA3AF] max-w-md">
                Ask questions about your fitness progress, get personalized advice, or discuss your
                training and nutrition goals.
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${
                    message.role === "user"
                      ? "bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white"
                      : "bg-[#374151] text-[#F9FAFB]"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{message.content}</div>
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#374151] text-[#F9FAFB] rounded-lg p-4">
                <div className="flex gap-2">
                  <div
                    className="w-2 h-2 bg-[#9CA3AF] rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <div
                    className="w-2 h-2 bg-[#9CA3AF] rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <div
                    className="w-2 h-2 bg-[#9CA3AF] rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-[#374151] p-4">
          <div className="flex gap-3">
            <Input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your AI coach a question..."
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
    </div>
  );
}

