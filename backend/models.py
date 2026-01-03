from typing import Optional, List
from pydantic import BaseModel
from enum import Enum

class WorkoutType(str, Enum):
    CARDIO = "cardio"
    STRENGTH = "strength"
    CUSTOM = "custom"

class Exercise(BaseModel):
    id: Optional[str] = None
    name: str
    type: WorkoutType
    muscle_group: Optional[str] = None
    is_custom: bool = False

class WorkoutSplit(BaseModel):
    id: Optional[str] = None
    name: str
    days: List[str]

class WorkoutSession(BaseModel):
    id: Optional[str] = None
    date: str
    split_name: Optional[str] = None
    exercises: List[dict]
    notes: Optional[str] = None

class PhysicalActivity(BaseModel):
    id: Optional[str] = None
    date: str
    steps: Optional[int] = None
    activity_type: Optional[str] = None
    description: Optional[str] = None
    duration_minutes: Optional[int] = None
    is_whole_day: Optional[bool] = False
    intensity_level: Optional[int] = None

class FoodItem(BaseModel):
    name: str
    calories: float
    protein: float
    carbs: Optional[float] = None
    fats: Optional[float] = None
    sodium: Optional[float] = None

class MacroEntry(BaseModel):
    id: Optional[str] = None
    date: str
    food_items: List[FoodItem]
    total_calories: Optional[float] = None
    total_protein: Optional[float] = None
    total_carbs: Optional[float] = None
    total_fats: Optional[float] = None

class StressEntry(BaseModel):
    id: Optional[str] = None
    date: str
    level: int
    description: Optional[str] = None

class BodyFeeling(BaseModel):
    id: Optional[str] = None
    date: str
    description: str

class WellnessSurvey(BaseModel):
    id: Optional[str] = None
    date: str
    fatigue: int
    body_aches: int
    energy: Optional[int] = None
    sleep_quality: Optional[int] = None
    mood: Optional[int] = None

class SleepEntry(BaseModel):
    id: Optional[str] = None
    date: str
    hours_slept: float
    quality: Optional[int] = None
    bedtime: Optional[str] = None
    wake_time: Optional[str] = None
    notes: Optional[str] = None

class HydrationEntry(BaseModel):
    id: Optional[str] = None
    date: str
    amount_ml: float
    notes: Optional[str] = None

