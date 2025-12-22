from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from routers import exercises, splits, workout_sessions, physical_activities, macros, stress, body_feelings, wellness_survey
import db

load_dotenv()

app = FastAPI()

cors_origins = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8081").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
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

@app.get("/")
async def root():
    return {"message": "GymAI API"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
