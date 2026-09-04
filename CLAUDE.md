# GymAI — Project Memory

## Project Overview
GymAI is a fitness tracking web app with a React/TypeScript frontend (Vite, Tailwind) and a Python/FastAPI backend using Firestore and OpenAI APIs. The app tracks workouts, nutrition, wellness, and provides AI-powered exercise recommendations.

- **Frontend:** `/web-app/` — React + TypeScript + Tailwind + Vite (port 5173)
- **Backend:** `/backend/` — FastAPI + Firestore + OpenAI (port 8000)
- **API client:** `/web-app/src/lib/api-client.ts` — Axios with Firebase auth interceptor
- **Auth:** Firebase Auth (token verified in `/backend/auth.py`)
- **DB:** Firestore (`/backend/db.py`)

## Design System
- Dark theme: bg `#0B0C10`, cards `#161A22`, borders `#2A2D35`
- Primary orange: `#FF6B35`, AI teal: `#5EEAD4`
- Text: white for headings, `#8E8E93` for secondary
- Components: `Button` (primary/secondary/danger/ai variants), `Card`, `Input`, `Modal` in `/web-app/src/components/ui/`

## AI Workout Plan Generator (Implemented July 2026)

### What it does
Solves the cold-start problem: new users complete a 3-step wizard (goals, schedule, equipment), GPT-4o generates a structured workout program, and it populates into the app. The existing AI recommender fills in weights/reps from history. Working out becomes: open app → see today's workout → do it.

### Architecture
- **Plan = WHAT** (exercise selection, structure, schedule)
- **Recommender = HOW MUCH** (weight, reps from performance history)
- Firestore: `users/{uid}/workout_plans/{plan_id}` + linked split in `users/{uid}/splits`

### New files
| File | Purpose |
|------|---------|
| `/backend/data/default_exercises.py` | Backend exercise catalog (124 exercises with IDs, equipment filtering) |
| `/backend/ai_analysis/plan_generator.py` | `WorkoutPlanGenerator` class — GPT-4o prompt, JSON validation |
| `/backend/routers/workout_plan.py` | Plan API: POST /generate, GET /, GET /today, DELETE /{id}, POST /{id}/regenerate |
| `/web-app/src/pages/PlanGeneratorPage.tsx` | 3-step wizard + plan view |
| `/web-app/src/components/dashboard/TodaysWorkoutCard.tsx` | Dashboard hero card (no_plan / rest_day / workout_day / completed states) |

### Key models
- `WorkoutPlan`, `WorkoutPlanDay`, `PlanExercise`, `WeeklySchedule` in `/backend/models.py`
- Mirrored as TypeScript interfaces in `/web-app/src/types/index.ts`
- `UserProfile` has `available_equipment` and `preferred_workout_days` fields

### "Start Workout" flow
Dashboard TodaysWorkoutCard → `/workouts?tab=sessions&startPlan=true&planDay={name}` → `SessionsSection.tsx` detects URL params → calls `GET /api/workout-plan/today` → pre-populates session form → triggers AI recommendations with `plan_target_sets`/`plan_target_reps`/`plan_notes` context

### Recommender integration
`plan_target_sets`, `plan_target_reps`, `plan_notes` are threaded through: `workout_sessions.py` router → `WorkoutRecommender.get_exercise_recommendation()` → `RecommendationEngine.generate_recommendation()` → `PromptBuilder.build_recommendation_prompt()` (adds "PLAN CONTEXT" section to the AI prompt)

## Plan Roadmap (Aug 2026)
Visual timeline of where the Active Plan leads. Route `/plan` ("Roadmap" in nav);
distinct from `/plan-generator`, which is the creation wizard.

| File | Purpose |
|------|---------|
| `/backend/ai_analysis/plan_projection.py` | Runs `ProgressionEngine` forward week by week |
| `/backend/nutrition/trajectory.py` | Week-by-week calorie/protein ramp + bodyweight curve |
| `/web-app/src/api/trainingPlan.ts` | Client for `/api/training-plan/*` incl. projection |
| `/web-app/src/components/plan/ProjectionChart.tsx` | Reusable SVG line chart with hover layer |
| `/web-app/src/pages/PlanRoadmapPage.tsx` | The page |

`GET /api/training-plan/projection?weeks=N` returns both trajectories on one week axis.

**Two lines, never one.** `best_case` assumes every target is met; `realistic` is that
same curve time-stretched by measured adherence (`measure_adherence`). A single
confident line is the failure mode this avoids — it reads well on day one and tells the
user they are failing by week five when they are training normally. `DEFAULT_ADHERENCE`
is 0.75, never 1.0, for users without enough history to measure.

Gains are reported from **peak** e1RM, not the final week: e1RM genuinely dips on the
session a weight jump lands (50x10 estimates above 55x6), so reading the last week would
report a loss whenever the horizon ends on a reset.

Nutrition ramps **up** for gaining goals (maintenance rises with bodyweight) and never
ramps a deficit deeper — the answer to a stalled cut is a diet break. Bodyweight curves
require a complete profile; `estimate_maintenance_calories` returns None rather than
guessing, and `warnings` flags a plan whose calorie target contradicts its own goal
(the per-goal defaults know nothing about the individual, so a 2800 kcal "lean bulk"
lands below maintenance for many users).

**Charts:** marks use `SERIES_COLORS` (`#0D9488`/`#E2622B`), not the UI accents — the
bright brand teal/orange sit above the OKLCH lightness band that reads as a data mark on
a dark surface. Validated for CVD separation and contrast against `#161A22`. No
dual-axis charts: calories and bodyweight get separate frames.

### Recommender Phase B / C (designed, not built)
- **Cross-exercise fatigue.** `current_workout_exercises` and `position_in_workout` are
  sent by the client, accepted by the router, threaded into `get_exercise_recommendation()`
  — and then dropped. Plan: a `SessionContext` shaped like `ReadinessContext`, resolving
  muscle groups via `resolve_exercise_metadata` (not the ad-hoc keyword dict in the dead
  engine), fed through a generalized `_apply_capacity(readiness, session_fatigue)` taking
  the min. Ship in shadow mode behind an env flag, as readiness was.
- **Analytics as context.** `data_analyzer.py` / `coach_tools.py` never reach the
  recommender. Honor the one-cached-read constraint in `readiness_context.py`: widen the
  cached `user_state` doc rather than querying at rack-side.
- **Cardio.** `_handle_cardio` is `prev_time + 1` min / `speed + 0.5`, unconditionally.
  Needs modality-aware progression and a "what to do today" surface.
  `physical_activities` is CRUD-only with no AI attached.
- **Per-exercise chat.** `/api/ai-analysis/chat` already has modes, tools, streaming and
  `ConversationStore`. Add `mode="exercise"` with a scoped toolset plus the live
  recommendation and its `reasoning_context` as system context.
- **Roadmap chat.** Not built. `POST /api/training-plan/adjust` already takes free text
  and returns a *draft* (never mutating the active plan) — wire a chat on `/plan` to it,
  plus a nutrition ramp adjustment via `build_trajectory(weekly_step_override=...)`,
  which exists and is tested but has no endpoint yet.

### Not yet implemented (Phase 2/3)
- Exercise swap within a plan (without full regeneration)
- Plan adherence tracking (completed vs. scheduled)
- Missed day handling with makeup suggestions
- Calendar integration (show planned workouts as faded future indicators)
- Multi-week periodization (4-week mesocycles)
- Dedicated `/today` mobile-optimized route

## Existing AI Recommender System
Located in `/backend/ai_analysis/workout_recommender/`:
- `__init__.py` — `WorkoutRecommender` orchestrator
- `progression_engine.py` — **the live path.** Pure-Python, no LLM. Computes every weight and rep.
- `prescription.py` — how a session is judged and which prescription shape answers it
- `reasoning_generator.py` — LLM writes prose *about* pre-computed numbers; template fallback
- `goal_configs.py`, `exercise_metadata.py`, `plan_context.py`, `readiness_context.py`, `training_focus.py`, `weight_estimator.py`
- `data_fetcher.py`, `data_processor.py`, `storage.py`, `summary_generator.py`, `exercise_order.py`

**Dead code — do not extend:** `recommendation_engine.py` and `prompt_builder.py` are the
old LLM recommender. `generate_recommendation()` has no callers. `simple_progression.py` is
likewise superseded. `_calculate_fatigue_factor()` in `recommendation_engine.py` implements
within-session muscle-overlap fatigue but is unreachable — see Phase B below.

### Prescription model (Aug 2026)
A recommendation is a **rep band plus a branch**, not a single number.

- `RecommendedSet` carries `reps` (the aim, always present for older clients), plus
  `rep_low`/`rep_high` (the band) and `role` (`straight`/`top`/`backoff`).
- `ProgressionResult` carries `strategy` and `branch`. Two strategies, chosen in
  `select_strategy()`: `BAND` (one load, fill a rep range) and `TOP_SET` (one heavy set
  plus backoffs, with an explicit "if you miss, drop to X" branch). `TOP_SET` applies to
  strength-goal compounds; everything else gets `BAND`.
- The API adds `strategy`, `branch`, `rep_range`, and `last_session` to the response.

**Sessions are judged against their band, never by total volume.** `evaluate_session()`
returns `SWEPT_TOP`/`AT_TOP`/`IN_BAND`/`PARTIAL`/`BELOW`, anchored on the *median* set
rather than the worst one. Two bugs this fixed, both pinned in `tests/test_prescription.py`:

1. Volume comparison scored a completed weight increase as a failure (50x10x3 → the
   prescribed 55x6x3 is less volume), rolling the user back and oscillating forever.
2. Requiring a flawless sweep to add weight stranded anyone who reliably drops a rep.

Trend still matters: `count_regressions()` catches declining reps, but **only at a fixed
load** — that qualifier is the whole point, since reps falling because the weight rose is
the program working.

### Every prescription must be able to move (Sep 2026)
Three dead ends, all of which produced a card that could never change. Pinned in
`tests/test_progression_dead_ends.py`.

**Bodyweight history was deleted before the engine saw it.** `_get_exercise_history`
required `weight > 0` per set, which is never true of a pull-up, so the session was
skipped entirely and the user's whole history read as "no history". `is_bodyweight`
now decides whether reps alone qualify a set. The filter's real job — dropping
loadless barbell rows — is unchanged.

**The rep step clamped to the top of the band.** `min(prev + 1, high)` answers an
11-rep set with 10, and under a strength band answers it with 6, both labelled "rep
increase". The band is a target to climb to, never a ceiling to be pushed back under:
the step never returns fewer reps than were already done at that load. Bodyweight
keeps climbing past the top and says external load is what moves it forward now
(`above_band` + `guidance`); weighted work holds, because adding load is
`_handle_increase_weight`'s job.

**MAINTAIN re-served the session that had just failed.** Prescribing the 9×13/8/8 that
missed a 12-15 band guarantees another miss, another hold, forever. The way out is
chosen by the size of the gap: `LOAD_MISMATCH_REPS` (3) reps or more under the floor
means the *load* is what the band cannot survive → `Decision.REDUCE_LOAD`, ~3% per rep
of deficit, capped at 15%, floored so it can never descend past one increment. Closer
than that is a session to repeat better → hold the load, add a rep per set. Both carry
`rep_low`/`rep_high`, so the band stays visible on exactly the decisions where the user
most needs to know what they are aiming at.

`plan_target_reps` reaches the engine now — the router accepted it and dropped it. It
only fills in when the plan resolver found no `target_rep_range`; a plan's own band is
the better statement of intent than the legacy single figure, and `normalize_rep_range`
reads a bare count as `(n, n)` rather than inventing a width around it.

**Est. 1RM is computed within one set.** `max_weight × (1 + max_reps/30)` pairs a heavy
set's load with a light set's reps and reports a 1RM the user has never been near — a
150 lb PR and a 10-rep set became "200 lbs" when the actual best set of 135×8 gives 171.
`/max-exercise` returns `best_e1rm` and `best_e1rm_set`; the card shows the figure and
names the set it came from, or shows nothing when no set qualifies (a bodyweight lift
has no 1RM). Both frontends.

## Nutrition Photo Logging (Sep 2026)

Photo → estimate → correct → log. Files:

| File | Purpose |
|------|---------|
| `/backend/nutrition/gpt_vision.py` | The vision call. Returns macros + `analysis` + `coherence` |
| `/backend/nutrition/vision_prompt.py` | Versioned rule blocks (`v1`, `v2`). Default `v2` |
| `/backend/nutrition/analyzer.py` | **The router.** Cheap pass, then optional strong pass |
| `/backend/nutrition/photo_estimate.py` | Confidence scoring + `should_escalate` |
| `/backend/nutrition/adjust_estimate.py` | "Fix Results" chat |
| `/backend/nutrition/photo_log_store.py` | Archive: image, estimate, chat, accepted label |
| `/backend/nutrition/fit_score.py` | Goal-relative fit score per logged food |
| `/backend/scripts/replay_photo_estimates.py` | Scores a prompt/model change against real logs |

### Cheap-first routing
`analyze_food_image` runs 4o, then re-runs on `ESCALATION_MODEL` when
`should_escalate` fires: 4+ components, the model's own arithmetic off by ≥8%,
explicitly low confidence, or a portion range too wide to log.

**Not routed on the confidence score.** That score grades *photo legibility*,
which is a different thing from accuracy. A sharp, well-lit, fully-visible
five-compartment tray scores 72/"medium" and can still be 30% low; a blurry
photo scores "low" and is the case a stronger model helps with least. Routing
on it escalates exactly the wrong set.

A failed second pass keeps the first answer — escalation must never be able to
*downgrade* to the description-only fallback. `analysis.routing` records the
decision (including when it declined) so a bad estimate traces to the rule that
let it pass.

Reasoning models get `max_completion_tokens=4000`, not the flat 1000. Reasoning
tokens come out of that budget; at 1000 the thinking pass eats it, the JSON
comes back truncated, `_parse_json` returns None, and the estimate silently
demotes to description-only. The "upgrade" would have been a downgrade.

### Why the prompt has versions
v1's rules are individually correct and collectively biased low. On a
multi-compartment plate each component is estimated under the same "be careful,
don't assume" framing; the errors are correlated, so they add instead of
cancelling. v2 replaces prohibitions with anchors (servingware dimensions,
uncertainty pushed into the gram range rather than into a smaller central
estimate), infers cooking fat from the *identified dish* rather than treating
"homemade" as evidence of no oil, and adds an explicit whole-plate check.

v2 also drops v1's "calories should match the component calorie sum" — that
instruction told the model to hide the exact disagreement
`assess_macro_coherence` reads as an escalation signal.

**v2 is the default on argument, not evidence.** The replay harness exists to
settle it and has not been run against a populated archive yet.

### Corrections carry the photo and the ledger
The upload is deleted after the first estimate, so `/adjust-estimate` reloads
the archived copy via `load_archived_image` and re-attaches it at `detail:
"high"`. Without it, "did you count the chakori" can only nudge a scalar.

Revisions edit the **component ledger**, not the total, and the client anchors
each turn on the latest revision rather than the original — re-sending the
original puts the system context in conflict with the conversation history and
the estimate creeps a little at a time instead of moving.

The ledger is rendered ("What's counted") and always sums to the displayed
total: portion scales every line, a cooking-style change books its own oil line
rather than being smeared across the other items, and a manual macro override
hides the ledger entirely since it no longer explains the number.

### Fit score, not health score
`fit_score.py` scores **goal fit**, never absolute healthiness. The same kadhi
is a good fit on a lean bulk and a poor one on a cut; a scorer where that isn't
true is a health score wearing a fit score's name. Protein-per-kcal against the
*day's required* protein-per-kcal is the backbone, with slot budget, fiber, and
a goal-direction term. Deterministic — no model, so the same food always scores
the same.

No plan targets → `None`, not a guess (same stance as
`estimate_maintenance_calories`). Items under 40 kcal return `trivial` rather
than a number, so a smear of ketchup does not read as a dietary failure. Scored
against the **meal slot**, not the running day, so an item's score never
changes because of something logged after it.

Thresholds (bands at 80/65/45, 1.4g fiber per 100 kcal, the 40 kcal floor,
`COMPLEX_MEAL_COMPONENTS = 4`) are reasoned, not calibrated against real logs.

### The eval set
`users/{uid}/food_photo_logs` holds the image, the estimate, the chat, and —
via `POST /api/macros/photo-logs/{id}/accepted` — the macros the user actually
committed. That last field is the only real label: `initial_estimate` is what
the model guessed and `revised_estimate` is what it guessed after being argued
with, and neither is evidence the user agreed.

`photo_log_store.py` was untracked in git until Sep 2026, so nothing was ever
archived and the harness has no history to replay. Prompt and model changes
before that point were never measured.

## Other Key Files
- `/web-app/src/data/defaultExercises.ts` — Frontend exercise catalog (142 exercises)
- `/web-app/src/pages/AboutMyselfPage.tsx` — User profile form (has equipment + preferred days fields)
- `/backend/routers/splits.py` — CRUD for workout splits
- `/backend/ai_analysis/ai_coach.py` — Chat-based AI coach
