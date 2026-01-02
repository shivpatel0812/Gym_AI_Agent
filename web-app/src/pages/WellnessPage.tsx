import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import StressSection from "../components/wellness/StressSection";
import BodyFeelingsSection from "../components/wellness/BodyFeelingsSection";
import WellnessSurveySection from "../components/wellness/WellnessSurveySection";
import {
  MdPsychology,
  MdSentimentSatisfied,
  MdAssessment,
} from "react-icons/md";

type TabType = "stress" | "body" | "survey";

export default function WellnessPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>("stress");

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const editParam = searchParams.get('edit');
    
    if (tabParam && ['stress', 'body', 'survey'].includes(tabParam)) {
      setActiveTab(tabParam as TabType);
    }
  }, [searchParams]);

  const tabs = [
    { id: "stress" as TabType, label: "Stress", icon: MdPsychology },
    {
      id: "body" as TabType,
      label: "Body Feelings",
      icon: MdSentimentSatisfied,
    },
    { id: "survey" as TabType, label: "Survey", icon: MdAssessment },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#F9FAFB] mb-2">Wellness</h1>
        <p className="text-sm text-[#9CA3AF]">
          Track your mental and physical well-being
        </p>
      </div>

      <div className="flex gap-3 mb-8 bg-[#1A1F3A] p-1.5 rounded-xl border border-[#374151] w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg transition-all duration-200 ${
                isActive
                  ? "bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-lg shadow-[#6366F1]/20"
                  : "text-[#9CA3AF] hover:text-[#F9FAFB] hover:bg-[#374151]/30"
              }`}
            >
              <Icon className="text-lg" />
              <span className="font-semibold text-sm">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "stress" && <StressSection editEntryId={searchParams.get('edit')} />}
      {activeTab === "body" && <BodyFeelingsSection editEntryId={searchParams.get('edit')} />}
      {activeTab === "survey" && <WellnessSurveySection editEntryId={searchParams.get('edit')} />}
    </div>
  );
}
