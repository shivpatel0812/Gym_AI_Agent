import { useState, useEffect } from "react";
import apiClient from "../lib/api-client";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { MdAnalytics, MdRefresh, MdDelete, MdExpandMore, MdExpandLess } from "react-icons/md";

interface Analysis {
  id: string;
  year: number;
  month: number;
  analysis: string;
  tokens_used?: number;
  model?: string;
  created_at?: string;
  status?: string;
}

export default function GeneralAnalysisPage() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [expandedAnalysis, setExpandedAnalysis] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalyses();
  }, [selectedYear]);

  const fetchAnalyses = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/api/ai-analysis/analyses?year=${selectedYear}&limit=12`);
      if (res.data.status === "success") {
        setAnalyses(res.data.analyses);
      }
    } catch (error) {
      console.error("Error fetching analyses:", error);
    } finally {
      setLoading(false);
    }
  };

  const generateAnalysis = async () => {
    setGenerating(true);
    try {
      await apiClient.post("/api/ai-analysis/generate", {
        year: selectedYear,
        month: selectedMonth,
        include_previous_months: true,
      });
      await fetchAnalyses();
      alert("Analysis generated successfully!");
    } catch (error: any) {
      console.error("Error generating analysis:", error);
      alert(error.response?.data?.detail || "Error generating analysis");
    } finally {
      setGenerating(false);
    }
  };

  const deleteAnalysis = async (analysisId: string) => {
    if (!confirm("Are you sure you want to delete this analysis?")) return;

    try {
      await apiClient.delete(`/api/ai-analysis/analyses/${analysisId}`);
      await fetchAnalyses();
    } catch (error) {
      console.error("Error deleting analysis:", error);
      alert("Error deleting analysis");
    }
  };

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const formatAnalysis = (text: string) => {
    const lines = text.split("\n");
    const formatted: JSX.Element[] = [];
    let currentSection = "";

    lines.forEach((line, index) => {
      if (line.match(/^\*\*.*\*\*$/)) {
        if (currentSection) {
          formatted.push(<div key={`section-${index}`} className="mb-4">{currentSection}</div>);
        }
        currentSection = "";
        const header = line.replace(/\*\*/g, "");
        formatted.push(
          <h3 key={`header-${index}`} className="text-xl font-bold text-[#6366F1] mt-6 mb-3">
            {header}
          </h3>
        );
      } else if (line.trim()) {
        currentSection += (currentSection ? " " : "") + line.trim();
      }
    });

    if (currentSection) {
      formatted.push(<div key="last-section" className="mb-4">{currentSection}</div>);
    }

    return formatted.length > 0 ? formatted : <p className="whitespace-pre-wrap">{text}</p>;
  };

  return (
    <div className="p-8 lg:p-12 max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h1 className="text-4xl font-bold text-[#F9FAFB] mb-2">General Analysis</h1>
        <p className="text-[#9CA3AF]">AI-powered insights based on your fitness data</p>
      </div>

      <Card className="mb-6">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">Year</label>
              <select
                className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              >
                {[2023, 2024, 2025, 2026].map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">Month</label>
              <select
                className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              >
                {monthNames.map((month, index) => (
                  <option key={index + 1} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Button
                onClick={generateAnalysis}
                disabled={generating}
                loading={generating}
                icon={<MdAnalytics />}
                className="w-full"
              >
                Generate Analysis
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {loading ? (
          <Card>
            <div className="text-center text-[#9CA3AF] py-8">Loading analyses...</div>
          </Card>
        ) : analyses.length === 0 ? (
          <Card>
            <div className="text-center text-[#9CA3AF] py-8">
              No analyses found. Generate one to get started!
            </div>
          </Card>
        ) : (
          analyses.map((analysis) => {
            const isExpanded = expandedAnalysis === analysis.id;
            const analysisPreview = analysis.analysis.substring(0, 200);
            const hasMore = analysis.analysis.length > 200;

            return (
              <Card key={analysis.id}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-[#F9FAFB]">
                      {monthNames[analysis.month - 1]} {analysis.year}
                    </h3>
                    {analysis.created_at && (
                      <p className="text-sm text-[#9CA3AF] mt-1">
                        {new Date(analysis.created_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setExpandedAnalysis(isExpanded ? null : analysis.id)
                      }
                      className="p-2 rounded-lg bg-[#374151] text-[#9CA3AF] hover:text-[#F9FAFB] hover:bg-[#4B5563] transition-all"
                    >
                      {isExpanded ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
                    </button>
                    <button
                      onClick={() => deleteAnalysis(analysis.id)}
                      className="p-2 rounded-lg bg-[#EF4444]/20 text-[#EF4444] hover:bg-[#EF4444]/30 transition-all"
                    >
                      <MdDelete size={20} />
                    </button>
                  </div>
                </div>

                <div className="text-[#E5E7EB]">
                  {isExpanded ? (
                    <div className="prose prose-invert max-w-none">
                      {formatAnalysis(analysis.analysis)}
                    </div>
                  ) : (
                    <div>
                      <p className="mb-2">{analysisPreview}...</p>
                      {hasMore && (
                        <button
                          onClick={() => setExpandedAnalysis(analysis.id)}
                          className="text-[#6366F1] hover:text-[#8B5CF6] text-sm font-semibold"
                        >
                          Read more
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {analysis.tokens_used && (
                  <div className="mt-4 pt-4 border-t border-[#374151] text-xs text-[#9CA3AF]">
                    Tokens used: {analysis.tokens_used} | Model: {analysis.model || "gpt-4o"}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

