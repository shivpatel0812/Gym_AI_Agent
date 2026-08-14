# GymAI Sandbox

Isolated lab for building AI logic from scratch. Nothing here is imported by `backend/` or `web-app/`.

## Layout

```
sandbox/
  data/              # workout shapes + loaders (mirrors frontend types)
  fixtures/          # sample JSON — your "fake gym database"
    workout_history.json
  experiments/       # one folder per AI idea
  notebooks/
  requirements.txt
  .env.example
```

## Step 1 right now: workout data (no GPT yet)

Your workout info lives in `fixtures/workout_history.json` in the **same shape as the frontend**:

- `profile` — goals, equipment, top lifts
- `split` — Push / Pull / Legs
- `sessions` — logged workouts with `WorkoutSet[]` (reps, weight, RPE, …)
- `exercises` — small catalog subset with real `default-*` IDs

```bash
cd sandbox
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# summarize what's in the fixture
python -m data.inspect

# one exercise over time (what you'd later send to GPT)
python -m data.inspect --exercise default-chest-bb-bench-press
```

Edit `fixtures/workout_history.json` (or copy it) to use your own numbers. Loaders validate against `data/models.py`.

## Later: GPT

When you're ready, experiments will take this structured data → build a prompt → call OpenAI. Keep that in `experiments/`, not in `data/`.

## Quick experiment stub

```bash
python -m experiments.recommender_v2.run
python -m experiments.recommender_v2.run default-legs-bb-back-squats
```

## Rules

1. **No imports from sandbox into backend.** Promote by copying clean modules.
2. **Pure functions first.** `input dict → output dict`.
3. **Fixtures over Firestore** until logic is solid.
4. **One experiment per folder.**

## Promote checklist

1. Extract pure logic (no CLI / fixture paths).
2. Copy into `backend/ai_analysis/`.
3. Wrap with `db` / `user_id` / request models.
4. Add router + tests, then frontend.
