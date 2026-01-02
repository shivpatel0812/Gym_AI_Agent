"use client";

import { useState, useEffect } from "react";
import apiClient from "@/lib/api-client";
import { Split } from "@/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { MdAdd, MdCalendarToday, MdClose } from "react-icons/md";

interface SplitsSectionProps {
  exercises: any[];
  onUpdate: () => void;
}

export default function SplitsSection({
  exercises: _exercises,
  onUpdate,
}: SplitsSectionProps) {
  const [splits, setSplits] = useState<Split[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<{ name: string; days: string[] }>({
    name: "",
    days: [""],
  });

  useEffect(() => {
    fetchSplits();
  }, []);

  const fetchSplits = async () => {
    try {
      const res = await apiClient.get("/api/splits");
      setSplits(res.data);
      onUpdate();
    } catch (error) {
      console.error("Error fetching splits:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post("/api/splits", {
        ...formData,
        days: formData.days.filter((d) => d.trim()),
      });
      setFormData({ name: "", days: [""] });
      setShowForm(false);
      fetchSplits();
    } catch (error) {
      console.error("Error creating split:", error);
    }
  };

  const handleCancel = () => {
    setFormData({ name: "", days: [""] });
    setShowForm(false);
  };

  const addDay = () => {
    setFormData({ ...formData, days: [...formData.days, ""] });
  };

  const updateDay = (index: number, value: string) => {
    const newDays = [...formData.days];
    newDays[index] = value;
    setFormData({ ...formData, days: newDays });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold text-[#F9FAFB]">Workout Splits</h2>
        <Button onClick={() => setShowForm(true)} icon={<MdAdd />}>
          Create
        </Button>
      </div>

      {showForm && (
        <Card className="mb-8 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-[#F9FAFB]">
              Create Split
            </h3>
            <button
              onClick={handleCancel}
              className="text-[#9CA3AF] hover:text-[#F9FAFB] transition-colors"
            >
              <MdClose size={20} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              label="Split Name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="e.g., Push/Pull/Legs"
              required
            />

            {formData.days.map((day, idx) => (
              <Input
                key={idx}
                label={`Day ${idx + 1}`}
                value={day}
                onChange={(e) => updateDay(idx, e.target.value)}
                placeholder={`Day ${idx + 1} name`}
              />
            ))}

            <Button
              type="button"
              variant="secondary"
              onClick={addDay}
              className="w-full"
            >
              Add Day
            </Button>

            <div className="flex gap-4 pt-4">
              <Button type="submit" variant="primary">
                Save
              </Button>
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {splits.map((split) => (
          <Card key={split.id}>
            <div className="flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-lg bg-[#8B5CF6]/20 flex items-center justify-center mb-3">
                <MdCalendarToday className="text-[#8B5CF6] text-xl" />
              </div>
              <h3 className="text-base font-semibold text-[#F9FAFB] mb-3">
                {split.name}
              </h3>
              <div className="flex flex-wrap gap-2 justify-center">
                {split.days.map((day, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-1 rounded-lg bg-[#6366F1]/20 text-[#6366F1] text-xs font-semibold"
                  >
                    {typeof day === "string" ? day : day.day_name}
                  </span>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
