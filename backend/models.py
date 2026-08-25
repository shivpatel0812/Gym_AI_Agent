from typing import Optional, List, Dict, Union
from pydantic import BaseModel
from enum import Enum

class WorkoutType(str, Enum):
    CARDIO = "cardio"
    STRENGTH = "strength"
    CUSTOM = "custom"


class TopLiftEntry(BaseModel):
    """A representative set supplied for strength context; not necessarily a max."""
    weight: float
    reps: Optional[int] = None


TopLifts = Dict[str, Union[float, TopLiftEntry]]

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

class WorkoutSet(BaseModel):
    """Individual set within an exercise - defines optional enhanced tracking fields."""
    weight: Optional[float] = None
    reps: Optional[int] = None
    # Phase 1: Enhanced tracking fields (all optional for backward compatibility)
    rpe: Optional[int] = None  # Rate of Perceived Exertion (1-10 scale)
    rir: Optional[int] = None  # Reps In Reserve (0-5)
    completed: Optional[bool] = None  # Whether the set was successfully completed
    form_quality: Optional[str] = None  # "excellent", "good", "fair", "poor"
    notes: Optional[str] = None  # Any additional notes about this specific set
    difficulty: Optional[str] = None  # "easy", "solid", "grind", "failed"

class WorkoutSession(BaseModel):
    id: Optional[str] = None
    date: str
    workout_name: Optional[str] = None
    split_id: Optional[str] = None
    split_name: Optional[str] = None
    split_day: Optional[str] = None
    exercises: List[dict]
    notes: Optional[str] = None
    cardio_sport: Optional[str] = None
    cardio_minutes: Optional[float] = None
    cardio_intensity: Optional[int] = None
    cardio_fatigue: Optional[int] = None
    timer_accumulated_ms: Optional[int] = None
    timer_running_since: Optional[str] = None
    timer_started_at: Optional[str] = None

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
    fiber: Optional[float] = None
    sodium: Optional[float] = None
    meal: Optional[str] = None
    amount: Optional[str] = None
    # How many units this row represents. The macro fields above are always the
    # PRODUCT (per-unit x quantity), so every existing total keeps working; this
    # is kept alongside so the row can be re-scaled without re-deriving.
    quantity: Optional[float] = None
    # The per-unit label ("1 cake, 9g") that `quantity` multiplies.
    unit_amount: Optional[str] = None
    # Set when the item came from a one-tap "usual" so the same tap can undo it.
    # Kept on the model so re-saving a day's food_items does not strip the tag.
    usual_id: Optional[str] = None
    # Plan meal anchor this log fulfills (import or explicit tag).
    anchor_id: Optional[str] = None
    # Logged when the user wasn't sure what they'd eat (esp. lunch/dinner).
    uncertain: Optional[bool] = None

class SavedFood(BaseModel):
    id: Optional[str] = None
    name: str
    serving: str
    grams: float
    calories: float
    protein: float
    carbs: Optional[float] = 0
    fats: Optional[float] = 0
    fiber: Optional[float] = 0
    aliases: Optional[List[str]] = None


class SavedFoodUpdate(BaseModel):
    name: Optional[str] = None
    serving: Optional[str] = None
    grams: Optional[float] = None
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fats: Optional[float] = None
    fiber: Optional[float] = None
    aliases: Optional[List[str]] = None


class FoodEstimateRequest(BaseModel):
    query: str
    name: Optional[str] = None


class MacroEntry(BaseModel):
    id: Optional[str] = None
    date: str
    food_items: List[FoodItem]
    total_calories: Optional[float] = None
    total_protein: Optional[float] = None
    total_carbs: Optional[float] = None
    total_fats: Optional[float] = None
    total_fiber: Optional[float] = None
    total_sodium: Optional[float] = None

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

class DailyRoutine(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    icon: Optional[str] = "checkbox-marked-circle-outline"
    sort_order: Optional[int] = 0
    completed_dates: Optional[List[str]] = None


class HydrationEntry(BaseModel):
    id: Optional[str] = None
    date: str
    amount_cups: float
    notes: Optional[str] = None

class AIAnalysis(BaseModel):
    id: Optional[str] = None
    user_id: str
    year: int
    month: int
    analysis: str
    model: Optional[str] = None
    tokens_used: Optional[int] = None
    summary_data: Optional[dict] = None
    created_at: Optional[str] = None
    previous_context_count: Optional[int] = 0

class UserProfile(BaseModel):
    id: Optional[str] = None
    height_ft: Optional[int] = None
    height_in: Optional[int] = None
    height_cm: Optional[float] = None
    weight: Optional[float] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    primary_goal: Optional[str] = None
    primary_goal_custom: Optional[str] = None
    secondary_goals: Optional[List[str]] = None
    time_horizon: Optional[str] = None
    experience_level: Optional[str] = None
    training_history_style: Optional[List[str]] = None
    training_history_notes: Optional[str] = None
    work_school_hours: Optional[float] = None
    busy_level: Optional[int] = None
    family_obligations: Optional[bool] = None
    family_obligations_note: Optional[str] = None
    typical_stress_level: Optional[int] = None
    # Target hours per night. Optional and never asked during onboarding — when
    # unset, the recovery digest infers a baseline from logged sleep instead,
    # and cancels sleep out entirely if too little has been logged to infer one.
    sleep_goal: Optional[float] = None
    stress_fluctuates: Optional[bool] = None
    preferred_workout_time: Optional[str] = None
    preferred_session_length: Optional[str] = None
    preferred_workout_frequency: Optional[str] = None
    coaching_style_preference: Optional[str] = None
    dietary_preference: Optional[str] = None
    # IANA zone reported by the device, e.g. "America/New_York". Used for
    # server-side date defaults; never asked of the user.
    timezone: Optional[str] = None
    dietary_preference_other: Optional[str] = None
    willingness_to_track: Optional[str] = None
    progress_feeling: Optional[str] = None
    biggest_blocker: Optional[str] = None
    open_reflection: Optional[str] = None
    available_equipment: Optional[List[str]] = None
    preferred_workout_days: Optional[List[str]] = None
    top_lifts: Optional[dict] = None
    top_lifts_updated: Optional[str] = None


class PlanExercise(BaseModel):
    exercise_id: str
    exercise_name: str
    sets: int
    reps: int
    rest_seconds: Optional[int] = None
    notes: Optional[str] = None
    order: int
    intensity: Optional[str] = None  # "heavy", "light", "normal"
    # --- Goal-plan intent. Drives the recommender; never exact numbers. ---
    goal: Optional[str] = None  # "strength", "hypertrophy", "fat_loss", "general"
    priority: Optional[str] = None  # "high", "supporting", "normal"
    target_rep_range: Optional[List[int]] = None  # [low, high]

class WorkoutPlanDay(BaseModel):
    day_name: str
    focus: str
    exercises: List[PlanExercise]
    estimated_duration_minutes: Optional[int] = None
    intensity: Optional[str] = None  # "heavy", "light", "normal"
    # --- Goal-plan intent applied to every exercise on this day ---
    day_goal: Optional[str] = None  # human-readable, e.g. "Incline strength"
    day_type: Optional[str] = None  # "heavy", "volume", "normal", "deload"
    goal: Optional[str] = None  # default goal key for exercises on this day

class PlanChange(BaseModel):
    """One structural change the plan makes relative to the user's split."""
    action: str  # "added", "removed", "swapped", "reordered", "frequency", "rep_range"
    day_name: Optional[str] = None
    exercise_name: Optional[str] = None
    replaces: Optional[str] = None
    reason: Optional[str] = None

class WeeklySchedule(BaseModel):
    monday: Optional[str] = None
    tuesday: Optional[str] = None
    wednesday: Optional[str] = None
    thursday: Optional[str] = None
    friday: Optional[str] = None
    saturday: Optional[str] = None
    sunday: Optional[str] = None

class WorkoutPlan(BaseModel):
    id: Optional[str] = None
    plan_name: str
    plan_description: Optional[str] = None
    split_type: str
    weekly_schedule: WeeklySchedule
    days: List[WorkoutPlanDay]
    progression_notes: Optional[str] = None
    deload_schedule: Optional[str] = None
    is_active: bool = True
    linked_split_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    generation_metadata: Optional[dict] = None
    creation_mode: Optional[str] = None
    source_split_id: Optional[str] = None
    owns_linked_split: bool = False

    # --- Goal-based Active Plan fields ---
    # "structural" = the wizard-generated program (legacy default).
    # "goal" = a goal-based plan created from an AI Coach conversation.
    plan_type: str = "structural"
    # draft -> active -> paused -> completed. is_active stays in sync for
    # backward compatibility with existing queries.
    status: Optional[str] = None
    # How far the plan may stray from the user's Current Split.
    plan_mode: Optional[str] = None  # "follow_split", "adapt_split", "build_for_me"

    # Human-readable guidance. Explains the plan; does not drive behaviour.
    primary_goal: Optional[str] = None
    strategy: Optional[List[str]] = None
    guidelines: Optional[List[str]] = None

    start_date: Optional[str] = None
    duration_weeks: Optional[int] = None
    ended_at: Optional[str] = None

    changes: Optional[List[PlanChange]] = None
    source_conversation_id: Optional[str] = None
    version: int = 1
    supersedes_plan_id: Optional[str] = None


# --- Nutrition Plan -------------------------------------------------------

class MealAnchorFood(BaseModel):
    name: str
    amount: Optional[str] = None
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fats: Optional[float] = None
    fiber: Optional[float] = None
    # Foods sharing group_key are OR-alternatives for one meal component
    # (e.g. Premier Protein + Fairlife both count as the "shake" slot).
    group_key: Optional[str] = None
    # When true, Previous matching also accepts same-category foods
    # (e.g. any yogurt for an Oikos Yogurt slot).
    match_similar: Optional[bool] = None


class MealAnchor(BaseModel):
    """A predictable food or meal the user eats often."""
    id: Optional[str] = None
    slot: str = "other"  # breakfast, lunch, snack, shake, dinner, late_night, other
    label: str
    foods: List[MealAnchorFood] = []
    frequency: str = "most_days"
    days: Optional[List[str]] = None
    notes: Optional[str] = None
    # individual | potential | uncertain — potential ≈ rotates options; uncertain = TBD
    kind: Optional[str] = None
    varies: Optional[bool] = None
    uncertain: Optional[bool] = None
    place: Optional[str] = None


class FlexibleMeal(BaseModel):
    """A meal the user does not fully control (e.g. family dinner)."""
    id: Optional[str] = None
    name: str
    frequency: str = "most_days"
    days: Optional[List[str]] = None
    calorie_min: Optional[float] = None
    calorie_max: Optional[float] = None
    protein_min: Optional[float] = None
    protein_max: Optional[float] = None
    user_controls_food: bool = False
    notes: Optional[str] = None


class GoToItem(BaseModel):
    """A staple food the user reaches for often — logged individually, not as a full meal."""
    id: Optional[str] = None
    slot: str = "other"  # breakfast, lunch, snack, shake, dinner, late_night, other (anytime)
    name: str
    amount: Optional[str] = None
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fats: Optional[float] = None
    fiber: Optional[float] = None
    days: Optional[List[str]] = None
    notes: Optional[str] = None


class NutritionPlanPreferences(BaseModel):
    likes: List[str] = []
    dislikes: List[str] = []
    dietary_restrictions: Optional[str] = None
    foods_on_hand: List[str] = []
    preferred_meal_count: Optional[int] = None
    larger_dinner: Optional[bool] = None
    guidance_style: Optional[str] = None  # "strict" | "flexible"


class NutritionPlanTargets(BaseModel):
    calories: Optional[float] = None
    calories_min: Optional[float] = None
    calories_max: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fats: Optional[float] = None
    fiber: Optional[float] = None


class NutritionPlan(BaseModel):
    """
    Persistent nutrition strategy — not a daily meal spreadsheet.

    Structured fields drive Today guidance. `strategy` is the readable explanation.
    """
    id: Optional[str] = None
    goal: str = "maintain"
    goal_detail: Optional[str] = None
    status: str = "draft"  # draft | active | paused | completed
    targets: NutritionPlanTargets = NutritionPlanTargets()
    strategy: Optional[str] = None
    meal_anchors: List[MealAnchor] = []
    flexible_meals: List[FlexibleMeal] = []
    go_to_items: List[GoToItem] = []
    preferences: NutritionPlanPreferences = NutritionPlanPreferences()
    food_priorities: List[str] = []
    typical_day_notes: Optional[str] = None
    # "Your current anchors stay — added on top: ..." after an AI regenerate.
    carryover_note: Optional[str] = None
    # Eating-pattern focus, e.g. ["cholesterol"]. Guidance, never treatment.
    health_focuses: List[str] = []
    health_notes: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    ended_at: Optional[str] = None
    version: int = 1


