import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MdAutoAwesome, MdRefresh } from "react-icons/md";
import apiClient from "../../lib/api-client";

export type CoachAction = "workout" | "nutrition" | "water" | "wellness" | "routine";

type Brief = {
  date: string;
  title: string;
  summary: string;
  yesterday: string;
  source: "ai" | "rules";
  generated_at: string;
  unavailable: string[];
  based_on: string[];
  context_coverage?: {
    previous_week_start: string;
    previous_week_end: string;
    history_through?: string;
    sources: Record<string, { status: string; days_logged?: number }>;
  };
  targets: Record<string, number | null>;
  totals: Record<string, number | null>;
  priorities: { id: string; title: string; detail: string; action: CoachAction }[];
};

const labels: Record<CoachAction, string> = {
  workout: "Open workout",
  nutrition: "Open nutrition",
  water: "View water log",
  wellness: "Check in",
  routine: "View routines",
};

const actionRoutes: Record<CoachAction, string> = {
  workout: "/workouts",
  nutrition: "/nutrition",
  water: "/nutrition",
  wellness: "/wellness",
  routine: "/plan",
};

export default function DailyCoach({
  date,
  revision = 0,
  onAction,
}: {
  date: string;
  revision?: number;
  onAction?: (action: CoachAction) => void;
}) {
  const navigate = useNavigate();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      const seq = ++generation.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      setError(false);
      try {
        const res = await apiClient.get<Brief>("/api/daily-coach", {
          params: { refresh },
          timeout: 45000,
          signal: controller.signal,
        });
        if (seq !== generation.current) return;
        if (res.data.date !== date) throw new Error("Coach date does not match device date");
        setBrief(res.data);
      } catch {
        if (seq === generation.current) setError(true);
      } finally {
        if (seq === generation.current) setBusy(false);
      }
    },
    [date]
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 800);
    return () => {
      clearTimeout(timer);
      generation.current++;
      abort.current?.abort();
    };
  }, [load, revision]);

  const handleAction = (action: CoachAction) => {
    if (onAction) onAction(action);
    else navigate(actionRoutes[action]);
  };

  const current = brief?.date === date ? brief : null;

  return (
    <section className="mb-6 rounded-2xl border border-[#2A2D35] bg-[#161A22] p-5" data-testid="daily-coach">
      <div className="mb-3 flex items-center gap-2">
        <MdAutoAwesome className="text-[#5EEAD4]" size={20} />
        <p className="flex-1 text-[11px] font-extrabold tracking-[0.12em] text-[#5EEAD4]">
          YOUR DAILY COACH
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(true)}
          className="rounded-lg p-2 text-[#5EEAD4] hover:bg-white/5 disabled:opacity-50"
          aria-label="Refresh daily coach"
        >
          <MdRefresh size={20} className={busy ? "animate-spin" : ""} />
        </button>
      </div>

      {error ? (
        <p className="text-sm text-[#E4896B]" role="alert">
          {current
            ? "This briefing may be out of date. Tap refresh to try again."
            : "Your coach couldn’t load. Tap refresh to try again."}
        </p>
      ) : null}

      {!current && !error ? (
        <p className="text-sm leading-6 text-[#8E8E93]">
          Connecting yesterday’s logs with today’s meals, training and routines…
        </p>
      ) : null}

      {current ? (
        <div className="space-y-3">
          {expanded ? <h2 className="text-xl font-bold text-white">{current.title}</h2> : null}
          <p className={`text-sm leading-6 text-[#8E8E93] ${expanded ? "" : "line-clamp-3"}`}>
            {current.summary}
          </p>
          {!expanded ? (
            <p className="text-xs font-bold text-[#FF6B35]">
              {(["calories", "protein", "water"] as const)
                .filter((key) => current.targets[key] != null && current.targets[key]! > 0)
                .map(
                  (key) =>
                    `${current.targets[key]} ${
                      key === "calories" ? "kcal" : key === "protein" ? "g protein" : "cups water"
                    }`
                )
                .join(" · ")}
            </p>
          ) : null}

          {expanded ? (
            <>
              <div className="flex flex-wrap gap-2">
                {(["calories", "protein", "water"] as const).map((key) => {
                  const target = current.targets[key];
                  if (target == null || target <= 0) return null;
                  const unit =
                    key === "calories" ? "kcal" : key === "protein" ? "g protein" : "cups water";
                  const logged = current.totals[key];
                  return (
                    <div key={key} className="rounded-xl bg-[#0B0C10] px-3 py-2">
                      <p className="text-xs font-bold text-[#FF6B35]">
                        {target} {unit}
                      </p>
                      <p className="text-[11px] text-[#7C8CA0]">
                        {logged == null ? "No log yet" : `${logged} logged so far`}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] font-extrabold tracking-wider text-[#7C8CA0]">FROM YESTERDAY</p>
              <p className="text-sm leading-6 text-[#8E8E93]">{current.yesterday}</p>
              <p className="text-[10px] font-extrabold tracking-wider text-[#7C8CA0]">
                TODAY’S PRIORITIES
              </p>
              {current.priorities.map((item, index) => (
                <button
                  key={`${item.id}-${index}`}
                  type="button"
                  onClick={() => handleAction(item.action)}
                  className="w-full border-t border-[#2A2D35] pt-3 text-left"
                >
                  <p className="text-[15px] font-semibold text-white">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-[#8E8E93]">{item.detail}</p>
                  <p className="mt-1 text-xs font-semibold text-[#FF6B35]">
                    {labels[item.action]} →
                  </p>
                </button>
              ))}
            </>
          ) : null}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-semibold text-[#FF6B35]"
            aria-expanded={expanded}
          >
            {expanded ? "Show less" : "View today’s briefing →"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
