import apiClient from "./client";

export interface ConversationSummary {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
  message_count: number;
  preview: string;
  mode?: "coach" | "plan" | "nutrition";
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
  messages: ConversationMessage[];
  mode?: "coach" | "plan" | "nutrition";
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await apiClient.get("/api/ai-analysis/conversations");
  return Array.isArray(res.data?.conversations) ? res.data.conversations : [];
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const res = await apiClient.get(`/api/ai-analysis/conversations/${id}`);
  return res.data?.conversation ?? null;
}

export async function renameConversation(id: string, title: string): Promise<void> {
  await apiClient.patch(`/api/ai-analysis/conversations/${id}`, { title });
}

export async function deleteConversation(id: string): Promise<void> {
  await apiClient.delete(`/api/ai-analysis/conversations/${id}`);
}
