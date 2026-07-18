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
- `prompt_builder.py` — Builds detailed prompts with history, RPE, plateaus, deload, fatigue
- `recommendation_engine.py` — Calls GPT-4o-mini, applies 6-layer safety post-processing
- `data_fetcher.py`, `data_processor.py`, `storage.py`, `summary_generator.py`, `simple_progression.py`, `exercise_order.py`

## Other Key Files
- `/web-app/src/data/defaultExercises.ts` — Frontend exercise catalog (142 exercises)
- `/web-app/src/pages/AboutMyselfPage.tsx` — User profile form (has equipment + preferred days fields)
- `/backend/routers/splits.py` — CRUD for workout splits
- `/backend/ai_analysis/ai_coach.py` — Chat-based AI coach
