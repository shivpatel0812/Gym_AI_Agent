import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import StressSection from "../components/wellness/StressSection";
import BodyFeelingsSection from "../components/wellness/BodyFeelingsSection";
import WellnessSurveySection from "../components/wellness/WellnessSurveySection";
import SleepSection from "../components/wellness/SleepSection";
import {
  MdPsychology,
  MdSentimentSatisfied,
  MdAssessment,
  MdBedtime,
} from "react-icons/md";

type TabType = "stress" | "body" | "survey" | "sleep";

export default function WellnessPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>("stress");

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    
    if (tabParam && ['stress', 'body', 'survey', 'sleep'].includes(tabParam)) {
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
    { id: "sleep" as TabType, label: "Sleep", icon: MdBedtime },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-[#FFFFFF] mb-1.5 sm:mb-2">Wellness</h1>
        <p className="text-xs sm:text-sm text-[#8E8E93]">
          Track your mental and physical well-being
        </p>
      </div>

      <div className="grid grid-cols-2 sm:inline-flex p-1 rounded-xl bg-[#1C1C1E] border border-[#2A2D35] mb-6 sm:mb-8 w-full sm:w-auto gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                isActive
                  ? "bg-[#FF6B35] text-white shadow-sm"
                  : "text-[#8E8E93] hover:text-[#FFFFFF]"
              }`}
            >
              <Icon className="text-base sm:text-lg" />
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "stress" && <StressSection editEntryId={searchParams.get('edit')} />}
      {activeTab === "body" && <BodyFeelingsSection editEntryId={searchParams.get('edit')} />}
      {activeTab === "survey" && <WellnessSurveySection editEntryId={searchParams.get('edit')} />}
      {activeTab === "sleep" && <SleepSection editEntryId={searchParams.get('edit')} />}
    </div>
  );
}
