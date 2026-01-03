import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import MacrosSection from "../components/nutrition/MacrosSection";
import HydrationSection from "../components/nutrition/HydrationSection";
import { MdRestaurant, MdWaterDrop } from "react-icons/md";

type TabType = "macros" | "hydration";

export default function NutritionPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>("macros");

  useEffect(() => {
    const tabParam = searchParams.get("tab");

    if (tabParam && ["macros", "hydration"].includes(tabParam)) {
      setActiveTab(tabParam as TabType);
    }
  }, [searchParams]);

  const tabs = [
    { id: "macros" as TabType, label: "Log Macros", icon: MdRestaurant },
    { id: "hydration" as TabType, label: "Log Hydration", icon: MdWaterDrop },
  ];

  return (
    <div className="p-8 lg:p-12 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-4xl font-bold text-[#F9FAFB] mb-10">Nutrition</h1>
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

      {activeTab === "macros" && (
        <MacrosSection editEntryId={searchParams.get("edit")} />
      )}
      {activeTab === "hydration" && (
        <HydrationSection editEntryId={searchParams.get("edit")} />
      )}
    </div>
  );
}
