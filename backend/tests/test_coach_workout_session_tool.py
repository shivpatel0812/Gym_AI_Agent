from ai_analysis.coach_tools import CoachToolbox, TOOL_SCHEMAS


class Doc:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return self._data


class Query:
    def __init__(self, docs, requested_date=None):
        self.docs = docs
        self.requested_date = requested_date

    def where(self, field, operator, value):
        assert (field, operator) == ("date", "==")
        return Query(self.docs, requested_date=value)

    def stream(self):
        if self.requested_date is None:
            return self.docs
        return [doc for doc in self.docs if doc.to_dict().get("date") == self.requested_date]


class Collection:
    def __init__(self, query):
        self.query = query

    def document(self, _):
        return self

    def collection(self, _):
        return self.query


class DB:
    def __init__(self, docs):
        self.query = Query(docs)

    def collection(self, _):
        return Collection(self.query)


def test_exact_workout_day_preserves_exercises_and_all_sets():
    db = DB([Doc("session-1", {
        "date": "2026-08-03",
        "split_name": "Push",
        "split_day": "Push A",
        "exercises": [
            {
                "exercise_id": "incline-db",
                "exercise_name": "Incline Dumbbell Press",
                "sets": [
                    {"weight": 75, "reps": 8, "rpe": 8},
                    {"weight": 75, "reps": 7, "completed": True},
                ],
            },
            {
                "exercise_id": "lateral-raise",
                "exercise_name": "Lateral Raise",
                "sets": [{"weight": 20, "reps": 15}],
            },
        ],
    }), Doc("session-older", {
        "date": "2026-07-20",
        "split_name": "Pull",
        "exercises": [{
            "exercise_id": "incline-db",
            "exercise_name": "Incline Dumbbell Press",
            "sets": [{"weight": 85, "reps": 6}],
        }],
    })])

    result = CoachToolbox(db, "u1").get_workout_session("2026-08-03")

    assert result["found"] is True
    session = result["sessions"][0]
    assert session["exercise_count"] == 2
    assert [exercise["name"] for exercise in session["exercises"]] == [
        "Incline Dumbbell Press", "Lateral Raise"
    ]
    assert session["exercises"][0]["sets"] == [
        {"set_number": 1, "weight": 75, "reps": 8, "rpe": 8,
         "difficulty": None, "completed": None},
        {"set_number": 2, "weight": 75, "reps": 7, "rpe": None,
         "difficulty": None, "completed": True},
    ]
    history = session["exercises"][0]["history_context"]
    assert history["lifetime_session_count"] == 2
    assert history["best_weighted_set"] == {
        "weight": 85, "reps": 6, "rpe": None, "completed": None,
        "date": "2026-07-20",
    }


def test_pullup_context_keeps_weighted_history_when_selected_day_is_bodyweight():
    db = DB([
        Doc("bodyweight-day", {
            "date": "2026-08-03",
            "exercises": [{
                "exercise_id": "pullups",
                "exercise_name": "Pull-Ups",
                "sets": [{"weight": 0, "reps": 6}],
            }],
        }),
        Doc("weighted-day", {
            "date": "2026-07-27",
            "exercises": [{
                "exercise_id": "pullups",
                "exercise_name": "Pull-Ups",
                "sets": [{"weight": 25, "reps": 5}],
            }],
        }),
    ])

    result = CoachToolbox(db, "u1").get_workout_session("2026-08-03")
    context = result["sessions"][0]["exercises"][0]["history_context"]

    assert context["lifetime_session_count"] == 2
    assert context["best_weighted_set"]["weight"] == 25
    assert context["most_recent_weighted_set"]["date"] == "2026-07-27"
    assert context["best_bodyweight_rep_set"]["reps"] == 6


def test_history_falls_back_to_exact_name_when_catalog_id_changed():
    db = DB([Doc("legacy-dips", {
        "date": "2026-07-15",
        "exercises": [{
            "exercise_id": "old-custom-dips-id",
            "exercise_name": "Parallel Bar Dips",
            "sets": [{"weight": 35, "reps": 8}],
        }],
    })])

    result = CoachToolbox(db, "u1").get_workout_session("2026-07-15")
    # Exercise history requested through a new default catalog id still joins
    # to the legacy record by its exact normalized display name.
    from ai_analysis.coach_tools import _exercise_history_context
    context = _exercise_history_context(
        [doc.to_dict() for doc in db.query.docs],
        "default-triceps-bw-parallel-dips",
        "Parallel Bar Dips",
    )

    assert result["found"] is True
    assert context["lifetime_session_count"] == 1
    assert context["best_weighted_set"]["weight"] == 35


def test_exact_workout_day_rejects_ambiguous_date():
    result = CoachToolbox(DB([]), "u1").get_workout_session("August 3")
    assert "error" in result


def test_exact_workout_day_is_exposed_to_the_model():
    names = {schema["function"]["name"] for schema in TOOL_SCHEMAS}
    assert "get_workout_session" in names
