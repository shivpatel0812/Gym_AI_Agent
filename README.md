# GymAI — Your Fitness Companion

**Track workouts, nutrition, and recovery in one place — with AI-powered recommendations to keep you progressing.**

---

## Try the prototype

**[Check out the live prototype →](https://gym-ai-agent-five.vercel.app/dashboard)**

See the app in action: log workouts, get AI set/rep suggestions, view all-time maxes, and explore the dashboard. No setup required.

---

## What it does

- **Workouts** — Log sessions by split, add exercises, track sets/reps/weight. Auto-save so you don’t lose progress.
- **AI recommendations** — Per-exercise suggestions (sets, reps, weight) based on your history, goals, and fatigue (e.g. same muscle group already trained).
- **All-time max & last time** — Per-exercise personal bests, estimated 1RM, heaviest sets, and “last time” summary.
- **Nutrition** — Log food and track macros (with USDA lookup and optional AI fallback).
- **Recovery & wellness** — Sleep, hydration, stress, body feelings, and surveys.
- **Dashboard** — Overview of today’s activity and key metrics.

---

## Tech stack

| Layer   | Stack |
|--------|--------|
| **Web app** | React 18, TypeScript, Vite, Tailwind CSS, Firebase Auth |
| **Backend** | FastAPI (Python), Firestore, OpenAI (recommendations & analysis) |
| **Mobile**  | React Native / Expo (optional frontend) |

---

## Project structure

```
gymaiAgent/
├── web-app/          # React (Vite) web app — main UI
├── backend/          # FastAPI API + AI (workout recommender, summaries)
├── frontend/         # React Native app (Expo)
└── README.md
```

- **Backend** — REST API, Firestore access, modular `workout_recommender` (prompts, simple progression, fatigue logic), AI analysis and chat.
- **Web app** — Dashboard, workout sessions (with recommendations and auto-save), nutrition, wellness, auth.

---

## Setup

### Backend

1. **Install dependencies**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Configure**
   - Add `firebase-service-account.json` to `backend/`.
   - Set env (e.g. in `.env`): `OPENAI_API_KEY`, Firebase config if needed.

3. **Run**
   ```bash
   python main.py
   ```
   API: **http://localhost:8000**

### Web app

1. **Install and env**
   ```bash
   cd web-app
   npm install
   ```
   Create `.env` with your Firebase and API settings (see `web-app/README.md`).

2. **Run**
   ```bash
   npm run dev
   ```
   App: **http://localhost:5173**

Point the web app’s `VITE_API_BASE_URL` at your backend (e.g. `http://localhost:8000` for local dev).

---

## Live prototype

**[GymAI Dashboard (Vercel)](https://gym-ai-agent-five.vercel.app/dashboard)** — try the prototype with no local setup.
