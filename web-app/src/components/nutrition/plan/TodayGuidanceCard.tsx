import { MdLightbulbOutline } from "react-icons/md";
import { TodayGuidance } from "../../../api/nutritionPlan";

export default function TodayGuidanceCard({ guidance }: { guidance: TodayGuidance | null }) {
  if (!guidance?.has_plan || !guidance.messages?.length) return null;

  return (
    <div className="rounded-2xl bg-[#161A22] border border-[rgba(255,107,53,0.35)] p-5 mb-6 space-y-2">
      <div className="flex items-center gap-2">
        <MdLightbulbOutline className="text-[#FF6B35]" size={18} />
        <p className="text-[13px] font-bold text-[#FF6B35] tracking-wide">From your plan</p>
      </div>
      {guidance.headline ? (
        <p className="text-[15px] font-semibold text-white leading-snug">{guidance.headline}</p>
      ) : null}
      {(guidance.messages || [])
        .filter((m) => m !== guidance.headline)
        .map((message, i) => (
          <p key={i} className="text-sm text-[#8E8E93] leading-relaxed">
            {message}
          </p>
        ))}
    </div>
  );
}
