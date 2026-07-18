from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from routers import exercises, splits, workout_sessions, physical_activities, macros, stress, body_feelings, wellness_survey, sleep, hydration, ai_analysis, user_profile, workout_plan
import db

load_dotenv()

app = FastAPI()

cors_origins_env = os.getenv("CORS_ALLOWED_ORIGINS", "*")
# Parse CORS origins - strip whitespace and filter empty strings
cors_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
# Use cors_origins if specified, otherwise allow all origins
# Note: allow_credentials cannot be True when allow_origins=["*"]
allow_all_origins = "*" in cors_origins or (len(cors_origins) == 1 and cors_origins[0] == "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if not allow_all_origins else ["*"],
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
app.include_router(ai_analysis.router)
app.include_router(user_profile.router)
app.include_router(workout_plan.router)

@app.get("/")
async def root():
    return {"message": "GymAI API"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
