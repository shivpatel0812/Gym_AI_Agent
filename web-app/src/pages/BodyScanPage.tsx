import { useCallback, useEffect, useState } from "react";
import {
  BODY_SCAN_VIEWS,
  BodyScanSession,
  BodyScanView,
  acceptBodyScanConsent,
  analyzeBodyScan,
  applyBodyScanFocus,
  getBodyScanConsent,
  getLatestBodyScan,
  listBodyScans,
} from "../api/bodyScan";
import { AI_MODEL_STORAGE_KEY, normalizeAiModel } from "../lib/aiModels";

const VIEW_COPY: Record<BodyScanView, string> = {
  front: "Front — arms slightly out, full body in frame",
  side: "Side — turn 90°, stand tall",
  back: "Back — face away, same distance as front",
};

const DISCLAIMER =
  "Appearance-based coaching observations from photos — not a medical or body-composition assessment. Photos are analyzed then deleted.";

export default function BodyScanPage() {
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [copy, setCopy] = useState({ title: "Body scan privacy", body: "" });
  const [goalText, setGoalText] = useState("");
  const [files, setFiles] = useState<Partial<Record<BodyScanView, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<BodyScanView, string>>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [scan, setScan] = useState<BodyScanSession | null>(null);
  const [history, setHistory] = useState<BodyScanSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [consent, latest, scans] = await Promise.all([
        getBodyScanConsent(),
        getLatestBodyScan(),
        listBodyScans(),
      ]);
      setAccepted(consent.accepted);
      setCopy(consent.copy);
      setScan(latest);
      setHistory(scans);
    } catch {
      setError("Could not load body scan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      Object.values(previews).forEach((url) => url && URL.revokeObjectURL(url));
    };
  }, [previews]);

  const onFile = (view: BodyScanView, file?: File | null) => {
    if (!file) return;
    setFiles((prev) => ({ ...prev, [view]: file }));
    setPreviews((prev) => {
      if (prev[view]) URL.revokeObjectURL(prev[view]!);
      return { ...prev, [view]: URL.createObjectURL(file) };
    });
  };

  const onAnalyze = async () => {
    setError(null);
    if (!files.front || !files.side || !files.back) {
      setError("Front, side, and back photos are required.");
      return;
    }
    if (goalText.trim().length < 3) {
      setError("Describe your goal in a sentence or two.");
      return;
    }
    setAnalyzing(true);
    try {
      const model = normalizeAiModel(localStorage.getItem(AI_MODEL_STORAGE_KEY));
      const result = await analyzeBodyScan({
        goalText: goalText.trim(),
        front: files.front,
        side: files.side,
        back: files.back,
        model,
      });
      setScan(result);
      setHistory((prev) => [result, ...prev.filter((s) => s.id !== result.id)]);
      setFiles({});
      setPreviews({});
    } catch (e: any) {
      setError(
        e?.response?.data?.detail?.message ||
          e?.response?.data?.detail ||
          e?.message ||
          "Analysis failed."
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const onApply = async () => {
    if (!scan?.id) return;
    setApplying(true);
    try {
      const { scan: updated } = await applyBodyScanFocus(scan.id);
      setScan(updated);
    } catch {
      setError("Could not apply training focus.");
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-10 h-10 border-2 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!accepted) {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-4">
        <p className="text-[11px] font-extrabold tracking-[0.12em] text-[#5EEAD4]">AI BODY SCAN</p>
        <h1 className="text-3xl font-extrabold text-white">{copy.title}</h1>
        <p className="text-[#8E8E93] leading-relaxed">{copy.body}</p>
        <p className="text-xs text-[#636366]">{DISCLAIMER}</p>
        <button
          type="button"
          onClick={async () => {
            await acceptBodyScanConsent();
            setAccepted(true);
          }}
          className="w-full py-3 rounded-xl bg-[#FF6B35] text-white font-bold"
        >
          I understand — continue
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <p className="text-[11px] font-extrabold tracking-[0.12em] text-[#5EEAD4]">AI BODY SCAN</p>
        <h1 className="text-3xl font-extrabold text-white mt-1">Guided progress photos</h1>
        <p className="text-[#8E8E93] mt-2">
          Front, side, and back — plus your goal. Emphasis is grounded in what you've actually logged.
        </p>
        <p className="text-xs text-[#636366] mt-2">{DISCLAIMER}</p>
      </div>

      {error ? <p className="text-sm text-[#FF453A]">{String(error)}</p> : null}

      <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-5 space-y-3">
        <p className="text-sm font-bold text-white">Your goal</p>
        <textarea
          className="w-full min-h-[96px] rounded-xl bg-[#0B0C10] border border-[#2A2D35] text-white p-3 text-sm"
          value={goalText}
          onChange={(e) => setGoalText(e.target.value)}
          placeholder='e.g. "bigger shoulders, keep my squat strength"'
        />
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {BODY_SCAN_VIEWS.map((view) => (
          <label
            key={view}
            className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-4 cursor-pointer hover:border-[#FF6B35]/40 transition"
          >
            <p className="text-sm font-bold text-white capitalize">{view}</p>
            <p className="text-xs text-[#636366] mt-1 mb-3">{VIEW_COPY[view]}</p>
            {previews[view] ? (
              <img src={previews[view]} alt={view} className="w-full h-40 object-cover rounded-xl mb-2" />
            ) : (
              <div className="w-full h-40 rounded-xl bg-[#0B0C10] border border-dashed border-[#2A2D35] flex items-center justify-center text-[#636366] text-xs mb-2">
                Silhouette guide · full body
              </div>
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="text-xs text-[#8E8E93] w-full"
              onChange={(e) => onFile(view, e.target.files?.[0])}
            />
          </label>
        ))}
      </div>

      <button
        type="button"
        disabled={analyzing}
        onClick={onAnalyze}
        className="w-full py-3 rounded-xl bg-[#FF6B35] text-white font-bold disabled:opacity-60"
      >
        {analyzing ? "Analyzing (photos will be deleted)…" : "Analyze scan"}
      </button>

      {scan ? (
        <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-extrabold text-white">Latest scan</p>
              <p className="text-xs text-[#636366]">
                {(scan.created_at || "").slice(0, 10)} · confidence{" "}
                {scan.observations?.confidence || "low"} · photos deleted
              </p>
            </div>
            {!scan.synthesis?.applied ? (
              <button
                type="button"
                disabled={applying}
                onClick={onApply}
                className="px-3 py-2 rounded-full border border-[#5EEAD4]/40 text-[#5EEAD4] text-xs font-bold"
              >
                {applying ? "…" : "Apply focus"}
              </button>
            ) : (
              <span className="text-xs font-bold text-[#4ADE80]">Focus applied</span>
            )}
          </div>
          {scan.synthesis?.explanation ? (
            <p className="text-sm text-[#8E8E93] leading-relaxed">{scan.synthesis.explanation}</p>
          ) : null}
          {scan.goal?.raw_text ? (
            <p className="text-sm text-white font-semibold">Goal: {scan.goal.raw_text}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {Object.entries(scan.synthesis?.emphasis || {}).map(([k, v]) => (
              <span
                key={k}
                className="px-2.5 py-1 rounded-full bg-[rgba(94,234,212,0.12)] text-[#5EEAD4] text-[11px] font-bold"
              >
                {k} {v}
              </span>
            ))}
          </div>
          {scan.observations?.limitations ? (
            <p className="text-xs text-[#636366] italic">{scan.observations.limitations}</p>
          ) : null}
        </div>
      ) : null}

      {history.length > 1 ? (
        <div className="space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[#636366]">Trend</p>
          {history.slice(0, 8).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScan(s)}
              className="w-full flex justify-between text-left py-2 border-b border-[#2A2D35] text-sm"
            >
              <span className="text-white font-bold">{(s.created_at || "").slice(0, 10)}</span>
              <span className="text-[#636366]">
                {s.goal?.direction || "goal"} · {s.observations?.confidence || "?"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
