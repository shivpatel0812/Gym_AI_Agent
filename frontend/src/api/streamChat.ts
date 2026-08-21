import { auth } from "../firebase";
import { API_BASE_URL } from "../config";

/**
 * SSE client for the coach chat endpoint.
 *
 * React Native's fetch does not expose a streaming response body, so this uses
 * XMLHttpRequest and reads the incrementally-growing responseText. That works
 * on iOS, Android, and react-native-web alike.
 */

const STREAM_TIMEOUT_MS = 90000;

export interface StreamHandlers {
  /** A chunk of the answer arrived. */
  onDelta: (text: string) => void;
  /** The coach started a data lookup. */
  onTool?: (name: string) => void;
  /** Stream finished cleanly. */
  onDone: (payload: {
    response: string;
    conversation_history: any[];
    conversation_id?: string;
    tools_used?: string[];
    ai_access?: any;
  }) => void;
  /** Stream failed. Fired at most once, and never after onDone. */
  onError: (error: StreamError) => void;
}

/**
 * A stream failure. `kind` lets the UI branch without string-matching:
 * `quota` means the daily AI limit is spent, `blocked` means moderation
 * rejected the message.
 */
export class StreamError extends Error {
  kind: "quota" | "blocked" | "auth" | "network";
  detail?: any;

  constructor(message: string, kind: StreamError["kind"] = "network", detail?: any) {
    super(message);
    this.name = "StreamError";
    this.kind = kind;
    this.detail = detail;
  }
}

export interface StreamRequest {
  message: string;
  conversationId?: string | null;
  conversationHistory?: any[];
  mode?: "coach" | "plan" | "nutrition";
  model?: string;
}

/**
 * Turn a non-2xx response into a typed error.
 *
 * The quota and moderation checks run before the stream opens, so these come
 * back as an ordinary JSON error body rather than an SSE frame.
 */
function errorForStatus(xhr: XMLHttpRequest): StreamError {
  let detail: any;
  try {
    detail = JSON.parse(xhr.responseText)?.detail;
  } catch {
    detail = undefined;
  }
  const message =
    (typeof detail === "object" && detail?.message) ||
    (typeof detail === "string" && detail) ||
    undefined;

  if (xhr.status === 429) {
    return new StreamError(
      message || "You've used all of today's AI requests.",
      "quota",
      detail
    );
  }
  if (xhr.status === 400 && detail?.error === "content_blocked") {
    return new StreamError(message, "blocked", detail);
  }
  if (xhr.status === 401 || xhr.status === 403) {
    return new StreamError(message || "Please sign in again.", "auth", detail);
  }
  return new StreamError(
    message || `Coach request failed (${xhr.status})`,
    "network",
    detail
  );
}

/** Starts a streaming chat request. Returns a cancel function. */
export function streamChat(
  { message, conversationId, conversationHistory, mode, model }: StreamRequest,
  handlers: StreamHandlers
): () => void {
  const xhr = new XMLHttpRequest();
  let cancelled = false;
  let settled = false;
  let processed = 0;
  let buffer = "";

  const finish = (fn: () => void) => {
    if (settled || cancelled) return;
    settled = true;
    fn();
  };

  const handleEvent = (payload: any) => {
    switch (payload?.type) {
      case "delta":
        if (payload.text) handlers.onDelta(payload.text);
        break;
      case "tool":
        handlers.onTool?.(payload.name);
        break;
      case "done":
        finish(() => handlers.onDone(payload));
        break;
      case "error":
        finish(() => handlers.onError(new StreamError(payload.error || "Coach failed")));
        break;
    }
  };

  // Frames are separated by a blank line; a trailing partial frame stays in
  // the buffer until the rest of it arrives
  const consume = () => {
    if (cancelled) return;
    const text = xhr.responseText;
    if (text.length <= processed) return;

    buffer += text.slice(processed);
    processed = text.length;

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          handleEvent(JSON.parse(raw));
        } catch {
          // Ignore an unparseable frame rather than killing the stream
        }
      }
    }
  };

  const start = async () => {
    let token = "";
    try {
      token = (await auth.currentUser?.getIdToken()) || "";
    } catch {
      // Fall through unauthenticated; the backend will reject it
    }
    if (cancelled) return;

    xhr.open("POST", `${API_BASE_URL}/api/ai-analysis/chat/stream`);
    xhr.setRequestHeader("Content-Type", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout =
      mode === "plan" || mode === "nutrition" || model === "gpt-5.6-sol"
        ? 120000
        : STREAM_TIMEOUT_MS;

    xhr.onprogress = consume;
    xhr.onload = () => {
      consume();
      if (xhr.status >= 400) {
        finish(() => handlers.onError(errorForStatus(xhr)));
        return;
      }
      // Server closed without a done event
      finish(() =>
        handlers.onError(new StreamError("Coach response ended unexpectedly"))
      );
    };
    xhr.onerror = () =>
      finish(() =>
        handlers.onError(new StreamError("Network error reaching the coach"))
      );
    xhr.ontimeout = () =>
      finish(() => handlers.onError(new StreamError("Coach request timed out")));

    xhr.send(
      JSON.stringify({
        message,
        conversation_id: conversationId || null,
        conversation_history: conversationHistory || [],
        mode: mode || "coach",
        model: model || undefined,
      })
    );
  };

  start();

  return () => {
    cancelled = true;
    try {
      xhr.abort();
    } catch {
      // Already finished
    }
  };
}
