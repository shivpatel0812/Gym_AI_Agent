import { useState, useEffect } from "react";
import apiClient from "../lib/api-client";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

interface UserProfile {
  id?: string;
  height_ft?: number;
  height_in?: number;
  height_cm?: number;
  weight?: number;
  age?: number;
  gender?: string;
  primary_goal?: string;
  secondary_goals?: string[];
  time_horizon?: string;
  experience_level?: string;
  training_history_style?: string[];
  training_history_notes?: string;
  work_school_hours?: number;
  busy_level?: number;
  family_obligations?: boolean;
  family_obligations_note?: string;
  typical_stress_level?: number;
  stress_fluctuates?: boolean;
  preferred_workout_time?: string;
  preferred_session_length?: string;
  preferred_workout_frequency?: string;
  coaching_style_preference?: string;
  dietary_preference?: string;
  dietary_preference_other?: string;
  willingness_to_track?: string;
  progress_feeling?: string;
  biggest_blocker?: string;
  open_reflection?: string;
}

export default function AboutMyselfPage() {
  const [profile, setProfile] = useState<UserProfile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [useMetric, setUseMetric] = useState(false);
  const [heightUnit, setHeightUnit] = useState<"ftin" | "cm">("ftin");

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await apiClient.get("/api/user-profile");
      if (res.data) {
        setProfile(res.data);
        if (res.data.height_cm) {
          setUseMetric(true);
          setHeightUnit("cm");
        } else {
          setHeightUnit("ftin");
        }
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const profileData = { ...profile };
      if (heightUnit === "cm") {
        profileData.height_ft = undefined;
        profileData.height_in = undefined;
      } else {
        profileData.height_cm = undefined;
      }

      if (profile.id) {
        await apiClient.put("/api/user-profile", profileData);
      } else {
        await apiClient.post("/api/user-profile", profileData);
      }
      await fetchProfile();
      alert("Profile saved successfully!");
    } catch (error) {
      console.error("Error saving profile:", error);
      alert("Error saving profile");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof UserProfile, value: any) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const updateArrayField = (field: keyof UserProfile, value: string, checked: boolean) => {
    setProfile((prev) => {
      const current = (prev[field] as string[]) || [];
      if (checked) {
        return { ...prev, [field]: [...current, value] };
      } else {
        return { ...prev, [field]: current.filter((v) => v !== value) };
      }
    });
  };

  if (loading) {
    return (
      <div className="p-8 lg:p-12 max-w-[1200px] mx-auto">
        <div className="text-center text-[#9CA3AF]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8 lg:p-12 max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h1 className="text-4xl font-bold text-[#F9FAFB] mb-2">About Myself</h1>
        <p className="text-[#9CA3AF]">Tell us about yourself to personalize your fitness journey</p>
      </div>

      <Card className="mb-6">
        <h2 className="text-2xl font-bold text-[#F9FAFB] mb-4">Section 1: Basic Info</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Height Unit
            </label>
            <div className="flex gap-4 mb-4">
              <label className="flex items-center gap-2 text-[#F9FAFB] cursor-pointer">
                <input
                  type="radio"
                  checked={heightUnit === "ftin"}
                  onChange={() => setHeightUnit("ftin")}
                  className="w-4 h-4"
                />
                Feet/Inches
              </label>
              <label className="flex items-center gap-2 text-[#F9FAFB] cursor-pointer">
                <input
                  type="radio"
                  checked={heightUnit === "cm"}
                  onChange={() => setHeightUnit("cm")}
                  className="w-4 h-4"
                />
                Centimeters
              </label>
            </div>
          </div>
        </div>
        {heightUnit === "ftin" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              type="number"
              label="Height (feet)"
              value={profile.height_ft || ""}
              onChange={(e) => updateField("height_ft", parseInt(e.target.value) || undefined)}
            />
            <Input
              type="number"
              label="Height (inches)"
              value={profile.height_in || ""}
              onChange={(e) => updateField("height_in", parseInt(e.target.value) || undefined)}
            />
          </div>
        ) : (
          <Input
            type="number"
            label="Height (cm)"
            value={profile.height_cm || ""}
            onChange={(e) => updateField("height_cm", parseFloat(e.target.value) || undefined)}
          />
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            type="number"
            label="Weight (current)"
            value={profile.weight || ""}
            onChange={(e) => updateField("weight", parseFloat(e.target.value) || undefined)}
          />
          <Input
            type="number"
            label="Age"
            value={profile.age || ""}
            onChange={(e) => updateField("age", parseInt(e.target.value) || undefined)}
          />
        </div>
        <Input
          type="text"
          label="Gender (optional)"
          value={profile.gender || ""}
          onChange={(e) => updateField("gender", e.target.value)}
        />
      </Card>

      <Card className="mb-6">
        <h2 className="text-2xl font-bold text-[#F9FAFB] mb-4">Section 2: Fitness Goals</h2>
        <div className="mb-4">
          <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
            Primary fitness goal
          </label>
          <textarea
            className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1] min-h-[120px]"
            value={profile.primary_goal || ""}
            onChange={(e) => updateField("primary_goal", e.target.value)}
            placeholder="Describe your primary fitness goal..."
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
            Secondary goals (multi-select)
          </label>
          {[
            "Lose weight",
            "Gain muscle",
            "Get stronger",
            "Improve overall health",
            "Reduce stress",
            "Maintain fitness",
          ].map((goal) => (
            <label key={goal} className="flex items-center gap-2 mb-2 text-[#F9FAFB] cursor-pointer">
              <input
                type="checkbox"
                checked={(profile.secondary_goals || []).includes(goal)}
                onChange={(e) => updateArrayField("secondary_goals", goal, e.target.checked)}
                className="w-4 h-4"
              />
              {goal}
            </label>
          ))}
        </div>
        <div>
          <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
            Time horizon
          </label>
          <select
            className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
            value={profile.time_horizon || ""}
            onChange={(e) => updateField("time_horizon", e.target.value)}
          >
            <option value="">Select</option>
            <option value="Short-term (1–3 months)">Short-term (1–3 months)</option>
            <option value="Medium-term (3–6 months)">Medium-term (3–6 months)</option>
            <option value="Long-term (6+ months)">Long-term (6+ months)</option>
          </select>
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-2xl font-bold text-[#F9FAFB] mb-4">Section 3: Fitness Background</h2>
        <div className="mb-4">
          <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
            How long have you been working out?
          </label>
          <select
            className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
            value={profile.experience_level || ""}
            onChange={(e) => updateField("experience_level", e.target.value)}
          >
            <option value="">Select</option>
            <option value="Beginner (0–6 months)">Beginner (0–6 months)</option>
            <option value="Intermediate (6–24 months)">Intermediate (6–24 months)</option>
            <option value="Advanced (2+ years)">Advanced (2+ years)</option>
          </select>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
            Training history style (multi-select)
          </label>
          {[
            "Gym lifting",
            "Sports",
            "Cardio-focused",
            "On-and-off training",
            "Long breaks",
          ].map((style) => (
            <label key={style} className="flex items-center gap-2 mb-2 text-[#F9FAFB] cursor-pointer">
              <input
                type="checkbox"
                checked={(profile.training_history_style || []).includes(style)}
                onChange={(e) => updateArrayField("training_history_style", style, e.target.checked)}
                className="w-4 h-4"
              />
              {style}
            </label>
          ))}
        </div>
        <div>
          <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
            Notes about past training (optional)
          </label>
          <textarea
            className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1] min-h-[100px]"
            value={profile.training_history_notes || ""}
            onChange={(e) => updateField("training_history_notes", e.target.value)}
          />
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-2xl font-bold text-[#F9FAFB] mb-4">Section 4: Lifestyle & Schedule</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Input
            type="number"
            label="Average work/school hours per day"
            value={profile.work_school_hours || ""}
            onChange={(e) => updateField("work_school_hours", parseFloat(e.target.value) || undefined)}
          />
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              How busy are you most weeks? (1–10 scale)
            </label>
            <select
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              value={profile.busy_level || ""}
              onChange={(e) => updateField("busy_level", parseInt(e.target.value) || undefined)}
            >
              <option value="">Select</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                <option key={num} value={num}>
                  {num}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mb-4">
          <label className="flex items-center gap-2 mb-2 text-[#F9FAFB] cursor-pointer">
            <input
              type="checkbox"
              checked={profile.family_obligations || false}
              onChange={(e) => updateField("family_obligations", e.target.checked)}
              className="w-4 h-4"
            />
            Family or major life obligations
          </label>
          {profile.family_obligations && (
            <textarea
              className="w-full mt-2 px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1] min-h-[80px]"
              placeholder="Optional note"
              value={profile.family_obligations_note || ""}
              onChange={(e) => updateField("family_obligations_note", e.target.value)}
            />
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Typical stress level (1–10 scale)
            </label>
            <select
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              value={profile.typical_stress_level || ""}
              onChange={(e) => updateField("typical_stress_level", parseInt(e.target.value) || undefined)}
            >
              <option value="">Select</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                <option key={num} value={num}>
                  {num}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Does stress fluctuate week to week?
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-[#F9FAFB] cursor-pointer">
                <input
                  type="radio"
                  name="stress_fluctuates"
                  checked={profile.stress_fluctuates === true}
                  onChange={() => updateField("stress_fluctuates", true)}
                  className="w-4 h-4"
                />
                Yes
              </label>
              <label className="flex items-center gap-2 text-[#F9FAFB] cursor-pointer">
                <input
                  type="radio"
                  name="stress_fluctuates"
                  checked={profile.stress_fluctuates === false}
                  onChange={() => updateField("stress_fluctuates", false)}
                  className="w-4 h-4"
                />
                No
              </label>
            </div>
          </div>
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-2xl font-bold text-[#F9FAFB] mb-4">Section 5: Training Preferences</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Preferred workout time
            </label>
            <select
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              value={profile.preferred_workout_time || ""}
              onChange={(e) => updateField("preferred_workout_time", e.target.value)}
            >
              <option value="">Select</option>
              <option value="Morning">Morning</option>
              <option value="Afternoon">Afternoon</option>
              <option value="Evening">Evening</option>
              <option value="Flexible">Flexible</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Preferred session length
            </label>
            <select
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              value={profile.preferred_session_length || ""}
              onChange={(e) => updateField("preferred_session_length", e.target.value)}
            >
              <option value="">Select</option>
              <option value="20–30 min">20–30 min</option>
              <option value="30–45 min">30–45 min</option>
              <option value="45–60 min">45–60 min</option>
              <option value="60–90 min">60–90 min</option>
              <option value="90+ min">90+ min</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Preferred workout frequency
            </label>
            <select
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              value={profile.preferred_workout_frequency || ""}
              onChange={(e) => updateField("preferred_workout_frequency", e.target.value)}
            >
              <option value="">Select</option>
              <option value="2–3x/week">2–3x/week</option>
              <option value="3–4x/week">3–4x/week</option>
              <option value="5+ times/week">5+ times/week</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Coaching style preference
            </label>
            <select
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              value={profile.coaching_style_preference || ""}
              onChange={(e) => updateField("coaching_style_preference", e.target.value)}
            >
              <option value="">Select</option>
              <option value="Structured">Structured</option>
              <option value="Flexible">Flexible</option>
              <option value="Minimal guidance">Minimal guidance</option>
              <option value="Push hard when possible">Push hard when possible</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-2xl font-bold text-[#F9FAFB] mb-4">Section 6: Nutrition Preferences</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Dietary preference
            </label>
            <select
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              value={profile.dietary_preference || ""}
              onChange={(e) => updateField("dietary_preference", e.target.value)}
            >
              <option value="">Select</option>
              <option value="None">None</option>
              <option value="Vegetarian">Vegetarian</option>
              <option value="Vegan">Vegan</option>
              <option value="Other">Other</option>
            </select>
            {profile.dietary_preference === "Other" && (
              <Input
                className="mt-2"
                type="text"
                label="Specify other dietary preference"
                value={profile.dietary_preference_other || ""}
                onChange={(e) => updateField("dietary_preference_other", e.target.value)}
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Willingness to track
            </label>
            <select
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              value={profile.willingness_to_track || ""}
              onChange={(e) => updateField("willingness_to_track", e.target.value)}
            >
              <option value="">Select</option>
              <option value="Calories">Calories</option>
              <option value="Protein only">Protein only</option>
              <option value="No tracking">No tracking</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-2xl font-bold text-[#F9FAFB] mb-4">
          Section 7: Self-Perceived Progress & Mindset
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              How do you feel about your fitness progress so far?
            </label>
            <select
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              value={profile.progress_feeling || ""}
              onChange={(e) => updateField("progress_feeling", e.target.value)}
            >
              <option value="">Select</option>
              <option value="Very happy">Very happy</option>
              <option value="Somewhat happy">Somewhat happy</option>
              <option value="Neutral">Neutral</option>
              <option value="Frustrated">Frustrated</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Biggest blocker right now
            </label>
            <select
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              value={profile.biggest_blocker || ""}
              onChange={(e) => updateField("biggest_blocker", e.target.value)}
            >
              <option value="">Select</option>
              <option value="Time">Time</option>
              <option value="Stress">Stress</option>
              <option value="Motivation">Motivation</option>
              <option value="Consistency">Consistency</option>
              <option value="Not sure">Not sure</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-2xl font-bold text-[#F9FAFB] mb-4">Section 8: Open Reflection</h2>
        <div>
          <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
            In your own words, describe your fitness journey so far. What has worked, what hasn't, and
            anything you want your AI coach to know.
          </label>
          <textarea
            className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1] min-h-[200px]"
            value={profile.open_reflection || ""}
            onChange={(e) => updateField("open_reflection", e.target.value)}
            placeholder="Share your fitness journey, what's worked, what hasn't, and anything else you'd like your AI coach to know..."
          />
        </div>
      </Card>

      <div className="flex justify-end gap-4">
        <Button onClick={handleSave} disabled={saving} loading={saving}>
          Save Profile
        </Button>
      </div>
    </div>
  );
}

