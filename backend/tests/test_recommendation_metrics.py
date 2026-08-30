from ai_analysis.workout_recommender.recommendation_metrics import summarize_recommendation_metrics


class Doc:
    def __init__(self, data):
        self.data = data

    def to_dict(self):
        return self.data


def test_summarizes_cost_reliability_and_latency_signals():
    result = summarize_recommendation_metrics([
        Doc({"calls": 8, "tokens": 800, "fallbacks": 1, "latency_total_ms": 8000, "rejections": 1, "outcomes": 6, "missed_targets": 2, "failed_sets": 1, "manual_changes": 2}),
        Doc({"calls": 2, "tokens": 200, "fallbacks": 0, "latency_total_ms": 1000, "outcomes": 2}),
    ])
    assert result == {
        "days": 2,
        "calls": 10,
        "tokens": 1000,
        "fallbacks": 1,
        "rejections": 1,
        "outcomes": 8,
        "missed_targets": 2,
        "failed_sets": 1,
        "manual_changes": 2,
        "fallback_rate": 0.1,
        "rejection_rate": 0.1,
        "miss_rate": 0.25,
        "average_latency_ms": 900,
    }
