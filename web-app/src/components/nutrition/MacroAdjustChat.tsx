/**
 * Focused chat for correcting a photo/text nutrition estimate.
 * Port of frontend MacroAdjustChat — modal dialog for web-app.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MdArrowUpward,
  MdAutoAwesome,
  MdCheck,
  MdCheckCircleOutline,
  MdChevronLeft,
  MdErrorOutline,
  MdImageNotSupported,
  MdOpenInFull,
  MdPhotoCamera,
  MdCloseFullscreen,
  MdAddCircleOutline,
  MdSwapHoriz,
  MdRefresh,
} from "react-icons/md";
import {
  adjustEstimate,
  type EstimateMacros,
} from "../../api/macrosHelpers";
import type { AiModelId } from "../../lib/aiModels";

const MAX_TURNS = 3;

const QUICK_STARTERS = [
  {
    label: "Bigger portion",
    prompt: "The portion was bigger than shown.",
    icon: MdOpenInFull,
  },
  {
    label: "Smaller portion",
    prompt: "The portion was smaller than shown.",
    icon: MdCloseFullscreen,
  },
  {
    label: "Missing food",
    prompt: "The estimate is missing ",
    icon: MdAddCircleOutline,
  },
  {
    label: "Wrong food",
    prompt: "It identified the wrong food. It was ",
    icon: MdSwapHoriz,
  },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  kind?: "normal" | "error";
}

export type RevisedEstimate = {
  name: string;
  amount?: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  sugar?: number;
  sodium?: number;
  components?: EstimateMacros["components"];
  revision_note?: string | null;
};

export type AdjustChatEstimate = EstimateMacros & {
  name: string;
  analysis?: {
    components?: EstimateMacros["components"];
    assumptions?: string[];
    uncertainties?: string[];
    [key: string]: unknown;
  };
};

function photoSourceNote(
  attached: boolean | null,
  status: string | null
): { text: string; tone: "ok" | "warn" } | null {
  if (attached === null) return null;
  if (attached) {
    return {
      text: "Reading your photo — revisions come from the original image.",
      tone: "ok",
    };
  }
  if (status === "no_log" || status === null) {
    return {
      text: "No photo on this entry — I'm working from the numbers above.",
      tone: "warn",
    };
  }
  return {
    text: "Your photo couldn't be loaded, so I'm working from the numbers above rather than the image.",
    tone: "warn",
  };
}

function stripJsonBlock(text: string) {
  return text
    .replace(/```json[\s\S]*?```/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

function displayNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function deltaLabel(value: number, previousValue?: number) {
  if (previousValue === undefined) return null;
  const delta = Math.round((value - previousValue) * 10) / 10;
  if (delta === 0) return "No change";
  return `${delta > 0 ? "+" : "−"}${displayNumber(Math.abs(delta))}`;
}

function MacroPill({
  label,
  value,
  unit,
  color,
  previousValue,
}: {
  label: string;
  value: number;
  unit: string;
  color: string;
  previousValue?: number;
}) {
  const delta = deltaLabel(value, previousValue);
  return (
    <div className="min-w-0 flex-1 rounded-[10px] border border-[#2A2D35] bg-[#080A0E] px-0.5 py-2 text-center">
      <div className="flex min-h-[18px] items-baseline justify-center gap-0.5">
        <span className="text-sm font-extrabold" style={{ color }}>
          {displayNumber(value)}
        </span>
        <span className="text-[8px] font-bold text-[#55647A]">{unit}</span>
      </div>
      <p className="mt-0.5 text-[9px] font-semibold text-[#657286]">{label}</p>
      {delta ? (
        <p
          className={`mt-0.5 text-[8px] font-extrabold ${
            delta === "No change" ? "text-[#596575]" : "text-[#76CFC0]"
          }`}
        >
          {delta}
        </p>
      ) : null}
    </div>
  );
}

function EstimateMacrosRow({
  estimate,
  previous,
}: {
  estimate: RevisedEstimate | AdjustChatEstimate;
  previous?: AdjustChatEstimate;
}) {
  return (
    <div className="flex gap-1.5">
      <MacroPill
        label="Calories"
        value={estimate.calories}
        unit="kcal"
        color="#FF6B35"
        previousValue={previous?.calories}
      />
      <MacroPill
        label="Protein"
        value={estimate.protein}
        unit="g"
        color="#E4B896"
        previousValue={previous?.protein}
      />
      <MacroPill
        label="Carbs"
        value={estimate.carbs}
        unit="g"
        color="#F5C542"
        previousValue={previous?.carbs}
      />
      <MacroPill
        label="Fat"
        value={estimate.fats}
        unit="g"
        color="#C4B5FD"
        previousValue={previous?.fats}
      />
      <MacroPill
        label="Fiber"
        value={estimate.fiber ?? 0}
        unit="g"
        color="#86D7A5"
        previousValue={previous?.fiber}
      />
    </div>
  );
}

interface MacroAdjustChatProps {
  open: boolean;
  onClose: () => void;
  currentEstimate: AdjustChatEstimate;
  photoLogId?: string | null;
  model?: AiModelId;
  onPhotoLogId?: (id: string) => void;
  onApply: (revised: RevisedEstimate) => void;
}

export default function MacroAdjustChat({
  open,
  onClose,
  currentEstimate,
  photoLogId,
  model,
  onPhotoLogId,
  onApply,
}: MacroAdjustChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [completedTurns, setCompletedTurns] = useState(0);
  const [history, setHistory] = useState<Array<{ role: string; content: string }>>(
    []
  );
  const [latestRevision, setLatestRevision] = useState<RevisedEstimate | null>(
    null
  );
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [logId, setLogId] = useState<string | null>(photoLogId || null);
  const [photoAttached, setPhotoAttached] = useState<boolean | null>(
    photoLogId ? null : false
  );
  const [photoStatus, setPhotoStatus] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atLimit = completedTurns >= MAX_TURNS;

  useEffect(() => {
    if (!open) return;
    setMessages([]);
    setInput("");
    setSending(false);
    setCompletedTurns(0);
    setHistory([]);
    setLatestRevision(null);
    setLastFailedMessage(null);
    setLogId(photoLogId || null);
    setPhotoAttached(photoLogId ? null : false);
    setPhotoStatus(null);
  }, [open, photoLogId, currentEstimate.name]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending, latestRevision]);

  if (!open) return null;

  const chooseStarter = (prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const retryLastMessage = () => {
    if (!lastFailedMessage) return;
    setInput(lastFailedMessage);
    setLastFailedMessage(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || atLimit) return;

    setInput("");
    setLastFailedMessage(null);
    setMessages((previous) => [...previous, { role: "user", content: text }]);
    setSending(true);

    try {
      // Keep follow-ups anchored to the newest revision. Re-sending the
      // original estimate makes later corrections drift instead of converge.
      const live = latestRevision ?? currentEstimate;
      const liveComponents =
        latestRevision?.components ??
        currentEstimate.analysis?.components ??
        currentEstimate.components ??
        [];

      const data = await adjustEstimate(
        {
          message: text,
          current_estimate: {
            name: live.name,
            amount: live.amount,
            calories: live.calories,
            protein: live.protein,
            carbs: live.carbs,
            fats: live.fats,
            fiber: live.fiber ?? 0,
            sugar: live.sugar ?? undefined,
            sodium: live.sodium ?? undefined,
            components: liveComponents,
            analysis: {
              assumptions: currentEstimate.analysis?.assumptions,
              uncertainties: currentEstimate.analysis?.uncertainties,
            },
          },
          conversation_history: history,
          photo_log_id: logId || undefined,
          model,
        },
        { timeout: 120000 }
      );

      const reply =
        typeof data?.reply === "string"
          ? data.reply
          : "I updated the estimate based on your note.";
      const revised = (data?.revised_estimate || null) as RevisedEstimate | null;
      const nextHistory = data?.conversation_history || history;
      const nextLogId =
        typeof data?.photo_log_id === "string" ? data.photo_log_id : null;

      setPhotoAttached(data?.photo_attached === true);
      setPhotoStatus(
        typeof data?.photo_status === "string" ? data.photo_status : null
      );

      if (nextLogId) {
        setLogId(nextLogId);
        onPhotoLogId?.(nextLogId);
      }
      if (revised) {
        setLatestRevision({
          ...revised,
          fiber: revised.fiber ?? 0,
        });
      }
      setHistory(nextHistory);
      setCompletedTurns((turns) => turns + 1);
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content:
            stripJsonBlock(reply) ||
            "I updated the estimate. Review the changes below.",
        },
      ]);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      const message =
        typeof detail === "string" && detail.trim()
          ? detail
          : "I couldn’t update that just now. Your estimate is unchanged.";
      setLastFailedMessage(text);
      setMessages((previous) => [
        ...previous,
        { role: "assistant", content: message, kind: "error" },
      ]);
    } finally {
      setSending(false);
    }
  };

  const acceptRevision = () => {
    if (!latestRevision) return;
    onApply(latestRevision);
  };

  const refinementsLeft = Math.max(0, MAX_TURNS - completedTurns);
  const sourceNote = photoSourceNote(photoAttached, photoStatus);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-0 sm:p-4">
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-[#0B0C10] sm:h-[min(92vh,760px)] sm:rounded-2xl sm:border sm:border-[#2A2D35]"
        role="dialog"
        aria-modal="true"
        aria-label="Refine nutrition estimate"
      >
        <div className="flex min-h-[62px] items-center border-b border-[#2A2D35] px-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-full text-white hover:bg-white/5"
            aria-label="Close nutrition estimate refinement"
          >
            <MdChevronLeft size={26} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[17px] font-extrabold text-white">Refine estimate</p>
            <p className="mt-0.5 truncate text-[11px] text-[#8E8E93]">
              {currentEstimate.name}
            </p>
          </div>
          <div className="w-[42px]" />
        </div>

        {sourceNote ? (
          <div
            className={`flex items-center gap-2 border-b border-[#2A2D35] px-4 py-2.5 ${
              sourceNote.tone === "warn" ? "bg-[#1A100C]" : "bg-[#0B1512]"
            }`}
          >
            {sourceNote.tone === "ok" ? (
              <MdPhotoCamera size={15} className="shrink-0 text-[#5EEAD4]" />
            ) : (
              <MdImageNotSupported size={15} className="shrink-0 text-[#F59E8B]" />
            )}
            <p
              className={`text-xs font-semibold leading-4 ${
                sourceNote.tone === "warn" ? "text-[#F59E8B]" : "text-[#5EEAD4]"
              }`}
            >
              {sourceNote.text}
            </p>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4"
        >
          <div className="space-y-3 rounded-2xl border border-[#2A2D35] bg-[#101217] p-3.5">
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[9px] font-extrabold tracking-widest text-[#667487]">
                  CURRENT ESTIMATE
                </p>
                <p className="text-[17px] font-extrabold leading-5 text-white">
                  {currentEstimate.name}
                </p>
                <p className="mt-1 text-xs text-[#7C8CA0]">
                  {currentEstimate.amount || "Estimated portion"}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(94,234,212,0.18)] bg-[rgba(94,234,212,0.08)] px-2 py-1 text-[10px] font-bold text-[#8FCFC4]">
                <MdAutoAwesome size={13} className="text-[#5EEAD4]" />
                AI estimate
              </span>
            </div>
            <EstimateMacrosRow estimate={currentEstimate} />
          </div>

          <div className="flex max-w-[91%] items-end gap-2 self-start">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[rgba(94,234,212,0.18)] bg-[rgba(94,234,212,0.09)]">
              <MdAutoAwesome size={15} className="text-[#5EEAD4]" />
            </div>
            <div className="rounded-[15px] rounded-bl-[5px] border border-[#20242C] bg-[#16191F] px-3.5 py-2.5">
              <p className="text-[13px] leading-[19px] text-[#BAC4D0]">
                Tell me what looks off. I’ll update the portions and macros, then
                you can review everything before applying it.
              </p>
            </div>
          </div>

          {messages.length === 0 ? (
            <div className="ml-9 space-y-2">
              <p className="text-[9px] font-extrabold tracking-widest text-[#5C6878]">
                QUICK START
              </p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_STARTERS.map((starter) => {
                  const Icon = starter.icon;
                  return (
                    <button
                      key={starter.label}
                      type="button"
                      onClick={() => chooseStarter(starter.prompt)}
                      className="inline-flex items-center gap-1.5 rounded-[11px] border border-[rgba(255,107,53,0.19)] bg-[rgba(255,107,53,0.07)] px-3 py-2 text-xs font-bold text-[#B8CBE0] hover:border-[rgba(255,107,53,0.4)]"
                    >
                      <Icon size={16} className="text-[#FF6B35]" />
                      {starter.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] leading-[14px] text-[#626E7E]">
                Choose one to start, then add the detail that matters.
              </p>
            </div>
          ) : null}

          {messages.map((message, index) =>
            message.role === "user" ? (
              <div
                key={`user-${index}`}
                className="ml-auto max-w-[84%] rounded-[15px] rounded-br-[5px] bg-[#20364B] px-3.5 py-2.5"
              >
                <p className="text-[13px] leading-[19px] text-[#E5F0FC]">
                  {message.content}
                </p>
              </div>
            ) : (
              <div
                key={`assistant-${index}`}
                className="flex max-w-[91%] items-end gap-2"
              >
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                    message.kind === "error"
                      ? "border-[rgba(245,158,139,0.22)] bg-[rgba(245,158,139,0.08)]"
                      : "border-[rgba(94,234,212,0.18)] bg-[rgba(94,234,212,0.09)]"
                  }`}
                >
                  {message.kind === "error" ? (
                    <MdErrorOutline size={15} className="text-[#F59E8B]" />
                  ) : (
                    <MdAutoAwesome size={15} className="text-[#5EEAD4]" />
                  )}
                </div>
                <div
                  className={`rounded-[15px] rounded-bl-[5px] border px-3.5 py-2.5 ${
                    message.kind === "error"
                      ? "border-[rgba(245,158,139,0.2)] bg-[rgba(245,158,139,0.07)]"
                      : "border-[#20242C] bg-[#16191F]"
                  }`}
                >
                  <p
                    className={`text-[13px] leading-[19px] ${
                      message.kind === "error"
                        ? "text-[#E1B7B0]"
                        : "text-[#BAC4D0]"
                    }`}
                  >
                    {message.content}
                  </p>
                  {message.kind === "error" && lastFailedMessage ? (
                    <button
                      type="button"
                      onClick={retryLastMessage}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-extrabold text-[#F3B4A9]"
                    >
                      <MdRefresh size={14} />
                      Edit and try again
                    </button>
                  ) : null}
                </div>
              </div>
            )
          )}

          {sending ? (
            <div className="flex max-w-[91%] items-end gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[rgba(94,234,212,0.18)] bg-[rgba(94,234,212,0.09)]">
                <MdAutoAwesome size={15} className="text-[#5EEAD4]" />
              </div>
              <div className="flex items-center gap-2.5 rounded-[15px] rounded-bl-[5px] border border-[#20242C] bg-[#16191F] px-3.5 py-2.5">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#5EEAD4]/30 border-t-[#5EEAD4]" />
                <div>
                  <p className="text-xs font-bold text-[#BFD3D0]">
                    Rechecking your meal
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#687986]">
                    Updating portions and macros…
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {latestRevision ? (
            <div className="space-y-3 rounded-2xl border border-[rgba(94,234,212,0.24)] bg-[rgba(94,234,212,0.055)] p-3.5">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5EEAD4]">
                  <MdCheck size={15} className="text-[#07110F]" />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-[#B8F1E8]">
                    Updated estimate
                  </p>
                  <p className="text-[10px] text-[#6F938E]">
                    Review before applying
                  </p>
                </div>
              </div>

              {latestRevision.revision_note ? (
                <p className="text-xs leading-[17px] text-[#9FC7C0]">
                  {latestRevision.revision_note}
                </p>
              ) : null}

              <div>
                <p className="text-[15px] font-extrabold text-[#E4F5F2]">
                  {latestRevision.name}
                </p>
                <p className="mt-0.5 text-[11px] text-[#71918C]">
                  {latestRevision.amount || "Updated portion"}
                </p>
              </div>

              <EstimateMacrosRow
                estimate={latestRevision}
                previous={currentEstimate}
              />

              {latestRevision.components?.length ? (
                <div className="space-y-1.5 border-t border-[rgba(94,234,212,0.2)] pt-2.5">
                  <p className="mb-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[#75958F]">
                    What’s counted
                  </p>
                  {latestRevision.components.map((component, index) => (
                    <div
                      key={`${component.name}-${index}`}
                      className="flex items-center justify-between gap-2.5"
                    >
                      <p className="min-w-0 flex-1 truncate text-xs text-[#B3C6C3]">
                        {component.name}
                        {component.amount ? (
                          <span className="text-[10px] text-[#647C78]">
                            {`  ${component.amount}`}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[11px] font-bold text-[#8FC5BC]">
                        {component.calories ?? 0} kcal
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                onClick={acceptRevision}
                className="flex min-h-[46px] w-full items-center justify-center gap-1.5 rounded-xl bg-[#5EEAD4] text-sm font-extrabold text-[#07110F] hover:bg-[#4fd4bf]"
              >
                <MdCheck size={18} />
                Apply changes
              </button>
            </div>
          ) : null}

          {atLimit ? (
            <div className="flex items-start gap-2 rounded-xl border border-[rgba(94,234,212,0.14)] bg-[rgba(94,234,212,0.05)] p-3">
              <MdCheckCircleOutline size={18} className="shrink-0 text-[#8CBAB2]" />
              <p className="text-[11px] leading-4 text-[#829C98]">
                {latestRevision
                  ? "That’s all three refinements. Apply the updated estimate above, or go back to keep the current one."
                  : "That’s all three refinements. Go back to keep the current estimate."}
              </p>
            </div>
          ) : null}
        </div>

        {!atLimit ? (
          <div className="border-t border-[#2A2D35] bg-[#0B0C0F] px-3 pb-3 pt-2">
            <div className="mb-1.5 flex min-h-[14px] items-center justify-between px-1">
              <p className="text-[10px] font-semibold text-[#647082]">
                {refinementsLeft}{" "}
                {refinementsLeft === 1 ? "refinement" : "refinements"} left
              </p>
              {input.length >= 240 ? (
                <p className="text-[10px] text-[#647082]">{input.length}/300</p>
              ) : null}
            </div>
            <div className="flex min-h-12 items-end gap-2 rounded-2xl border border-[#272C35] bg-[#14171C] py-1.5 pl-3.5 pr-1.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="What should I change?"
                maxLength={300}
                rows={1}
                disabled={sending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                aria-label="Describe what is wrong with the nutrition estimate"
                className="max-h-24 min-h-[34px] flex-1 resize-none bg-transparent py-2 text-sm leading-[19px] text-white placeholder:text-[#596575] focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                disabled={!input.trim() || sending}
                onClick={() => void handleSend()}
                aria-label="Send refinement"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FF6B35] text-white disabled:opacity-30"
              >
                {sending ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <MdArrowUpward size={20} />
                )}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
