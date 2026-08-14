import { useState } from "react";
import apiClient from "../../lib/api-client";
import type { Split } from "../../types";
import {
  MdAdd,
  MdCalendarToday,
  MdCheckCircle,
  MdClose,
} from "react-icons/md";

interface SplitSelectorProps {
  splits: Split[];
  selectedId?: string;
  loading?: boolean;
  onSelect: (splitId: string) => void;
  onCreated?: (split: Split) => void;
}

export default function SplitSelector({
  splits,
  selectedId,
  loading,
  onSelect,
  onCreated,
}: SplitSelectorProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState<string[]>(["Push", "Pull", "Legs"]);
  const [error, setError] = useState<string | null>(null);

  const resetCreateForm = () => {
    setName("");
    setDays(["Push", "Pull", "Legs"]);
    setError(null);
    setShowCreate(false);
  };

  const updateDay = (index: number, value: string) => {
    setDays((prev) => prev.map((day, i) => (i === index ? value : day)));
  };

  const removeDay = (index: number) => {
    setDays((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)
    );
  };

  const handleCreate = async () => {
    const cleanedDays = days.map((day) => day.trim()).filter(Boolean);
    if (!name.trim()) {
      setError("Give your split a name.");
      return;
    }
    if (!cleanedDays.length) {
      setError("Add at least one workout day.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const res = await apiClient.post("/api/splits", {
        name: name.trim(),
        days: cleanedDays,
      });
      const created = res.data as Split;
      onCreated?.(created);
      if (created.id) onSelect(created.id);
      resetCreateForm();
    } catch (err) {
      console.error("Error creating split:", err);
      setError("Couldn’t create that split. Try again.");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <p className="py-5 text-sm text-[#8E8E93]">Loading your splits…</p>;
  }

  return (
    <div className="space-y-2">
      {splits.map((split) => {
        const selected = split.id === selectedId;
        return (
          <button
            key={split.id}
            type="button"
            onClick={() => split.id && onSelect(split.id)}
            className={`flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-all ${
              selected
                ? "border-[#FF6B35] bg-[#FF6B35]/10"
                : "border-[#2A2D35] bg-[#161A22] hover:border-[#3A3A3C]"
            }`}
          >
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#0B0C10] text-[#FF6B35]">
              <MdCalendarToday />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-white">{split.name}</span>
              <span className="mt-0.5 block truncate text-xs text-[#8E8E93]">
                {split.days.length} days · {split.days.join(" · ")}
              </span>
            </span>
            {selected && <MdCheckCircle className="text-xl text-[#FF6B35]" />}
          </button>
        );
      })}

      {!showCreate ? (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-[#2A2D35] bg-[#161A22] p-4 text-left transition-all hover:border-[#FF6B35]/50"
        >
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#0B0C10] text-[#FF6B35]">
            <MdAdd size={22} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-white">
              Create a new split
            </span>
            <span className="mt-0.5 block text-xs text-[#8E8E93]">
              Name the days yourself (e.g. Push / Pull / Legs)
            </span>
          </span>
        </button>
      ) : (
        <div className="rounded-xl border-2 border-[#FF6B35]/40 bg-[#161A22] p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">New split</p>
            <button
              type="button"
              onClick={resetCreateForm}
              className="text-[#8E8E93] transition-colors hover:text-white"
              aria-label="Cancel creating split"
            >
              <MdClose size={18} />
            </button>
          </div>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-[#8E8E93]">
              Split name
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Push / Pull / Legs"
              className="w-full rounded-lg border border-[#2A2D35] bg-[#0B0C10] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#636366] focus:border-[#FF6B35]"
            />
          </label>

          <div className="space-y-2">
            {days.map((day, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={day}
                  onChange={(event) => updateDay(index, event.target.value)}
                  placeholder={`Day ${index + 1}`}
                  className="min-w-0 flex-1 rounded-lg border border-[#2A2D35] bg-[#0B0C10] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#636366] focus:border-[#FF6B35]"
                />
                {days.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDay(index)}
                    className="rounded-lg p-2 text-[#8E8E93] hover:bg-[#0B0C10] hover:text-white"
                    aria-label={`Remove day ${index + 1}`}
                  >
                    <MdClose size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDays((prev) => [...prev, ""])}
              className="rounded-lg border border-[#2A2D35] px-3 py-2 text-xs font-semibold text-[#8E8E93] hover:border-[#3A3A3C] hover:text-white"
            >
              Add day
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="rounded-lg bg-[#FF6B35] px-3 py-2 text-xs font-semibold text-white hover:bg-[#FF7A4A] disabled:opacity-60"
            >
              {creating ? "Creating…" : "Save split"}
            </button>
          </div>

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
