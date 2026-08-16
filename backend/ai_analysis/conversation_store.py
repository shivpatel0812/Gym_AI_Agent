"""
Conversation Store - server-side persistence for AI coach chats.

Chat history used to live in React state and be round-tripped through the
client, so it died on tab switch and could be tampered with. This stores it in
Firestore under users/{uid}/coach_conversations/{id}, keyed by conversation, so
the client only ever needs to send a conversation id.

Document shape:
    title          str    derived from the first user message
    created_at     str    ISO timestamp
    updated_at     str    ISO timestamp, used for list ordering
    message_count  int
    messages       list   [{role, content, created_at}, ...]
"""

import re
from datetime import datetime
from typing import Dict, List, Any, Optional

COLLECTION = "coach_conversations"

# Firestore caps a document at 1MB. Chats never approach that, but a runaway
# client shouldn't be able to wedge a conversation into an unwritable state.
MAX_STORED_MESSAGES = 200

# How many past turns to replay to the model
MAX_CONTEXT_MESSAGES = 20

DEFAULT_TITLE = "New chat"
MAX_TITLE_LENGTH = 48


def derive_title(message: str) -> str:
    """Build a sidebar title from the first user message."""
    if not message or not message.strip():
        return DEFAULT_TITLE
    clean = re.sub(r"\s+", " ", message.strip())
    if len(clean) <= MAX_TITLE_LENGTH:
        return clean
    # Prefer breaking on a word boundary
    cut = clean[:MAX_TITLE_LENGTH].rsplit(" ", 1)[0] or clean[:MAX_TITLE_LENGTH]
    return cut.rstrip(",.;:!?-") + "..."


class ConversationStore:
    """Reads and writes a user's saved coach conversations."""

    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id

    def _collection(self):
        return self.db.collection("users").document(self.user_id).collection(COLLECTION)

    # --- reads ------------------------------------------------------------

    def list_conversations(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Conversation summaries, most recently updated first."""
        try:
            docs = list(
                self._collection()
                .order_by("updated_at", direction="DESCENDING")
                .limit(limit)
                .stream()
            )
        except Exception:
            # Ordering needs an index on first use; fall back to client-side sort
            docs = list(self._collection().limit(limit).stream())

        conversations = []
        for doc in docs:
            data = doc.to_dict() or {}
            messages = data.get("messages") or []
            last = messages[-1] if messages else None
            conversations.append({
                "id": doc.id,
                "title": data.get("title") or DEFAULT_TITLE,
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
                "message_count": data.get("message_count", len(messages)),
                "preview": (last or {}).get("content", "")[:120],
                "mode": data.get("mode") or "coach",
            })

        conversations.sort(key=lambda c: c.get("updated_at") or "", reverse=True)
        return conversations

    def get_conversation(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        """Full conversation including messages, or None if it doesn't exist."""
        doc = self._collection().document(conversation_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        return {
            "id": doc.id,
            "title": data.get("title") or DEFAULT_TITLE,
            "created_at": data.get("created_at"),
            "updated_at": data.get("updated_at"),
            "messages": data.get("messages") or [],
            "mode": data.get("mode") or "coach",
        }

    def get_history_for_model(
        self, conversation_id: str, limit: Optional[int] = None
    ) -> List[Dict[str, str]]:
        """
        Recent turns in OpenAI message form.

        Returns an empty list for a missing conversation so a stale client id
        starts a fresh thread rather than failing the request.
        """
        conversation = self.get_conversation(conversation_id)
        if not conversation:
            return []

        history = [
            {"role": m["role"], "content": m["content"]}
            for m in conversation["messages"]
            if isinstance(m, dict)
            and m.get("role") in ("user", "assistant")
            and isinstance(m.get("content"), str)
            and m["content"].strip()
        ]
        cap = limit if limit is not None else MAX_CONTEXT_MESSAGES
        return history[-cap:]

    # --- writes -----------------------------------------------------------

    def create_conversation(self, title: Optional[str] = None, mode: str = "coach") -> str:
        """Create an empty conversation and return its id."""
        now = datetime.now().isoformat()
        doc_ref = self._collection().document()
        doc_ref.set({
            "title": title or DEFAULT_TITLE,
            "created_at": now,
            "updated_at": now,
            "message_count": 0,
            "messages": [],
            "mode": mode if mode in ("plan", "coach") else "coach",
        })
        return doc_ref.id

    def append_exchange(
        self,
        conversation_id: Optional[str],
        user_message: str,
        assistant_message: str,
        mode: Optional[str] = None,
    ) -> str:
        """
        Append a user/assistant exchange, creating the conversation if needed.

        Returns the conversation id so a new thread's id reaches the client.
        """
        now = datetime.now().isoformat()
        new_messages = [
            {"role": "user", "content": user_message, "created_at": now},
            {"role": "assistant", "content": assistant_message, "created_at": now},
        ]

        doc_ref = (
            self._collection().document(conversation_id)
            if conversation_id else self._collection().document()
        )
        snapshot = doc_ref.get()

        if snapshot.exists:
            data = snapshot.to_dict() or {}
            messages = (data.get("messages") or []) + new_messages
            messages = messages[-MAX_STORED_MESSAGES:]
            update = {
                "messages": messages,
                "message_count": len(messages),
                "updated_at": now,
            }
            # Backfill a title if the thread was created empty
            if not data.get("title") or data.get("title") == DEFAULT_TITLE:
                update["title"] = derive_title(user_message)
            if mode in ("plan", "coach"):
                update["mode"] = mode
            doc_ref.update(update)
        else:
            payload = {
                "title": derive_title(user_message),
                "created_at": now,
                "updated_at": now,
                "message_count": len(new_messages),
                "messages": new_messages,
            }
            if mode in ("plan", "coach"):
                payload["mode"] = mode
            doc_ref.set(payload)

        return doc_ref.id

    def rename_conversation(self, conversation_id: str, title: str) -> bool:
        """Rename a conversation. False if it doesn't exist."""
        doc_ref = self._collection().document(conversation_id)
        if not doc_ref.get().exists:
            return False
        clean = re.sub(r"\s+", " ", (title or "").strip())[:MAX_TITLE_LENGTH]
        doc_ref.update({
            "title": clean or DEFAULT_TITLE,
            "updated_at": datetime.now().isoformat(),
        })
        return True

    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation. False if it doesn't exist."""
        doc_ref = self._collection().document(conversation_id)
        if not doc_ref.get().exists:
            return False
        doc_ref.delete()
        return True
