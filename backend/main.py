print("GymAI boot: start", flush=True)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

load_dotenv()
print("GymAI boot: loading db", flush=True)
import db
print("GymAI boot: loading routers", flush=True)
from routers import daily_coach, exercises, splits, workout_sessions, physical_activities, macros, stress, body_feelings, wellness_survey, sleep, hydration, daily_routines, ai_analysis, user_profile, workout_plan, training_plan, nutrition_plan, ai_access, account, content_reports, body_scan, user_state, progress
print("GymAI boot: app configured", flush=True)

app = FastAPI()

# Default to the known first-party origins rather than "*". A wildcard is only
# used when CORS_ALLOWED_ORIGINS is explicitly set to "*", so a missing env var
# in production fails closed instead of opening the API to every site.
DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://localhost:8081,http://localhost:19006"

cors_origins_env = os.getenv("CORS_ALLOWED_ORIGINS", DEFAULT_CORS_ORIGINS)
# Parse CORS origins - strip whitespace and filter empty strings
cors_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
# Note: allow_credentials cannot be True when allow_origins=["*"]
allow_all_origins = "*" in cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if not allow_all_origins else ["*"],
    # Keep Vercel frontends working even if CORS_ALLOWED_ORIGINS is localhost-only
    allow_origin_regex=None if allow_all_origins else r"https://([a-z0-9-]+\.)*vercel\.app",
    allow_credentials=not allow_all_origins,  # Can't use credentials with wildcard
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(exercises.router)
app.include_router(splits.router)
app.include_router(workout_sessions.router)
app.include_router(physical_activities.router)
app.include_router(macros.router)
app.include_router(stress.router)
app.include_router(body_feelings.router)
app.include_router(wellness_survey.router)
app.include_router(sleep.router)
app.include_router(hydration.router)
app.include_router(daily_routines.router)
app.include_router(daily_coach.router)
app.include_router(ai_analysis.router)
app.include_router(user_profile.router)
app.include_router(workout_plan.router)
app.include_router(training_plan.router)
app.include_router(nutrition_plan.router)
app.include_router(ai_access.router)
app.include_router(account.router)
app.include_router(content_reports.router)
app.include_router(body_scan.router)
app.include_router(user_state.router)
app.include_router(progress.router)

@app.get("/")
async def root():
    return {"message": "GymAI API"}


@app.get("/health")
async def health():
    """Cheap liveness probe — keep a warm-up ping pointed here during App Review."""
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
