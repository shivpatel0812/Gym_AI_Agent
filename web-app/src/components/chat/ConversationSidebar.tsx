import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationSummary,
  deleteConversation,
  listConversations,
  renameConversation,
} from "../../api/conversations";
import { MdAdd, MdClose, MdDelete, MdEdit } from "react-icons/md";

export interface ConversationSidebarProps {
  open?: boolean;
  onClose?: () => void;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
}

function relativeDate(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ConversationSidebar({
  open,
  onClose,
  activeId,
  onSelect,
  onNew,
}: ConversationSidebarProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const skipRenameBlur = useRef(false);

  const isOverlay = open !== undefined;
  const mobileOpen = !isOverlay || open === true;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConversations(await listConversations());
    } catch (err) {
      console.error("Error loading conversations:", err);
      setError("Could not load chats.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh when a stream stamps a new conversation_id onto the open thread.
  useEffect(() => {
    if (!activeId) return;
    refresh();
  }, [activeId, refresh]);

  // Refresh when the mobile drawer opens so the list is current.
  useEffect(() => {
    if (open !== true) return;
    refresh();
  }, [open, refresh]);

  const startRename = (item: ConversationSummary) => {
    setRenamingId(item.id);
    setRenameText(item.title);
  };

  const cancelRename = () => {
    skipRenameBlur.current = true;
    setRenamingId(null);
    setRenameText("");
  };

  const submitRename = async (id: string) => {
    if (skipRenameBlur.current) {
      skipRenameBlur.current = false;
      return;
    }
    const title = renameText.trim();
    if (!title) {
      setRenamingId(null);
      setRenameText("");
      return;
    }
    setBusyId(id);
    try {
      await renameConversation(id, title);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c))
      );
      cancelRename();
    } catch (err) {
      console.error("Error renaming conversation:", err);
      setError("Could not rename that chat.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: ConversationSummary) => {
    if (!confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    setBusyId(item.id);
    try {
      await deleteConversation(item.id);
      setConversations((prev) => prev.filter((c) => c.id !== item.id));
      if (item.id === activeId) onSelect(null);
    } catch (err) {
      console.error("Error deleting conversation:", err);
      setError("Could not delete that chat.");
    } finally {
      setBusyId(null);
    }
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    onClose?.();
  };

  const handleNew = () => {
    onNew();
    onClose?.();
  };

  return (
    <>
      {isOverlay ? (
        <button
          type="button"
          className={`lg:hidden fixed inset-0 z-40 bg-black/60 transition-opacity ${
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={onClose}
          aria-label="Close chats backdrop"
          tabIndex={mobileOpen ? 0 : -1}
        />
      ) : null}

      <aside
        className={[
          "flex h-full w-72 shrink-0 flex-col bg-[#161A22] border-r border-[#2A2D35]",
          isOverlay
            ? `fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
                mobileOpen ? "translate-x-0" : "-translate-x-full"
              }`
            : "hidden lg:flex",
        ].join(" ")}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h2 className="text-lg font-bold text-white">Chats</h2>
          {isOverlay ? (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#8E8E93] hover:text-white hover:bg-[#2A2D35] lg:hidden"
              aria-label="Close chats"
            >
              <MdClose size={20} />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleNew}
          className="mx-4 mb-3 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[#2A2D35] bg-[#0B0C10] text-[#FF6B35] text-sm font-semibold hover:border-[#FF6B35]/50"
        >
          <MdAdd size={18} />
          New chat
        </button>

        {error ? (
          <p className="mx-4 mb-2 text-xs text-red-400">{error}</p>
        ) : null}

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading && conversations.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[#8E8E93]">Loading…</p>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm font-semibold text-[#8E8E93]">No saved chats yet</p>
              <p className="mt-1 text-xs text-[#8E8E93]/80">
                Your conversations will appear here
              </p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((item) => {
                const isActive = item.id === activeId;
                const isRenaming = renamingId === item.id;
                const busy = busyId === item.id;

                return (
                  <li key={item.id}>
                    <div
                      className={`group flex items-start gap-1 rounded-xl px-2 py-2 ${
                        isActive ? "bg-[#2A2D35]" : "hover:bg-[#2A2D35]/60"
                      } ${busy ? "opacity-60" : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              submitRename(item.id);
                            }}
                          >
                            <input
                              autoFocus
                              value={renameText}
                              onChange={(e) => setRenameText(e.target.value)}
                              onBlur={() => submitRename(item.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelRename();
                                }
                              }}
                              className="w-full rounded-lg border border-[#FF6B35]/50 bg-[#0B0C10] px-2 py-1 text-sm text-white outline-none"
                            />
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSelect(item.id)}
                            className="w-full text-left"
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`truncate text-sm font-medium ${
                                  isActive ? "text-white" : "text-[#8E8E93]"
                                }`}
                              >
                                {item.title}
                              </span>
                              {item.mode === "plan" || item.mode === "nutrition" ? (
                                <span className="shrink-0 rounded-full bg-[rgba(255,107,53,0.18)] px-1.5 py-0.5 text-[10px] font-bold text-[#FF6B35]">
                                  {item.mode === "plan" ? "Plan" : "Nutrition"}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-[#8E8E93]/80">
                              {relativeDate(item.updated_at)}
                              {item.preview ? ` · ${item.preview}` : ""}
                            </p>
                          </button>
                        )}
                      </div>

                      {!isRenaming ? (
                        <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => startRename(item)}
                            className="p-1.5 rounded-lg text-[#8E8E93] hover:text-white"
                            aria-label="Rename chat"
                            disabled={busy}
                          >
                            <MdEdit size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                            className="p-1.5 rounded-lg text-[#8E8E93] hover:text-red-400"
                            aria-label="Delete chat"
                            disabled={busy}
                          >
                            <MdDelete size={16} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
