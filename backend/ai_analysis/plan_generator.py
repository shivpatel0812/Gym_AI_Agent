"""
AI Workout Plan Generator.
Uses GPT-4o to create structured workout programs from user preferences.
"""

import json
import os
from typing import Optional
from openai import OpenAI
from data.default_exercises import filter_exercises_by_equipment, validate_exercise_id


class WorkoutPlanGenerator:
    """Generates structured workout plans using AI."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.client = OpenAI(api_key=self.api_key)

    def generate_plan(self, request: dict, user_profile: dict) -> dict:
        """
        Generate a workout plan based on user preferences.

        Args:
            request: PlanGenerationRequest fields as dict
            user_profile: Existing UserProfile data as dict

        Returns:
            Validated WorkoutPlan dict
        """
        available_equipment = request.get("available_equipment", ["Full Gym"])
        filtered_exercises = filter_exercises_by_equipment(available_equipment)

        # Build the exercise catalog string for the prompt
        catalog_by_category = {}
        for ex in filtered_exercises:
            cat = ex["category"]
            if cat not in catalog_by_category:
                catalog_by_category[cat] = []
            catalog_by_category[cat].append(ex)

        catalog_str = ""
        for cat, exercises in catalog_by_category.items():
            catalog_str += f"\n{cat}:\n"
            for ex in exercises:
                catalog_str += f'  - id: "{ex["id"]}", name: "{ex["name"]}", equipment: {ex["equipment"]}\n'

        # Build context from user profile
        profile_context = self._build_profile_context(user_profile)

        system_prompt = """You are an expert personal trainer and exercise scientist. Create a structured workout program.

CRITICAL RULES:
1. You MUST only select exercises from the provided catalog by their EXACT ID. Do not invent exercise IDs.
2. Each workout day should have 4-7 exercises.
3. Start each day with compound movements, then isolation exercises.
4. Ensure balanced muscle development across the program.
5. Rest days are important - include them in the weekly schedule.
6. Rep ranges should match the user's goal:
   - Build Muscle: 8-12 reps
   - Lose Fat: 12-15 reps with some 8-10 for compounds
   - Get Stronger: 3-6 reps for main lifts, 8-12 for accessories
   - General Fitness: 8-15 reps mixed

Return a JSON object with this exact structure:
{
  "plan_name": "string - e.g. Push/Pull/Legs",
  "plan_description": "string - 1-2 sentence description",
  "split_type": "string - e.g. PPL, Upper/Lower, Full Body, Bro Split",
  "weekly_schedule": {
    "monday": "day_name or Rest",
    "tuesday": "day_name or Rest",
    "wednesday": "day_name or Rest",
    "thursday": "day_name or Rest",
    "friday": "day_name or Rest",
    "saturday": "day_name or Rest",
    "sunday": "day_name or Rest"
  },
  "days": [
    {
      "day_name": "string - e.g. Push Day",
      "focus": "string - e.g. Chest, Shoulders, Triceps",
      "estimated_duration_minutes": number,
      "exercises": [
        {
          "exercise_id": "string - MUST be from the catalog",
          "exercise_name": "string",
          "sets": number,
          "reps": number,
          "rest_seconds": number,
          "notes": "string - coaching cue",
          "order": number (1-indexed)
        }
      ]
    }
  ],
  "progression_notes": "string - how to progress over time",
  "deload_schedule": "string - when to deload"
}"""

        user_prompt = f"""Create a workout program for this user:

PRIMARY GOAL: {request.get('primary_goal', 'General Fitness')}
EXPERIENCE LEVEL: {request.get('experience_level', 'Intermediate')}
WORKOUT FREQUENCY: {request.get('preferred_workout_frequency', '3-4x/week')}
SESSION LENGTH: {request.get('preferred_session_length', '45-60 min')}
AVAILABLE EQUIPMENT: {', '.join(available_equipment)}
{f"PREFERRED DAYS: {', '.join(request.get('preferred_workout_days', []))}" if request.get('preferred_workout_days') else ""}
{f"SECONDARY GOALS: {', '.join(request.get('secondary_goals', []))}" if request.get('secondary_goals') else ""}
{f"COACHING STYLE: {request.get('coaching_style', '')}" if request.get('coaching_style') else ""}

{profile_context}

AVAILABLE EXERCISE CATALOG (you MUST only use exercises from this list):
{catalog_str}

Generate the workout program as JSON."""

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.7,
            max_tokens=4000,
        )

        raw_plan = json.loads(response.choices[0].message.content)

        # Track token usage
        usage = response.usage
        metadata = {
            "model": "gpt-4o",
            "prompt_tokens": usage.prompt_tokens if usage else 0,
            "completion_tokens": usage.completion_tokens if usage else 0,
            "total_tokens": usage.total_tokens if usage else 0,
        }

        # Validate and clean the plan
        validated_plan = self._validate_plan(raw_plan)
        validated_plan["generation_metadata"] = metadata

        return validated_plan

    def _build_profile_context(self, profile: dict) -> str:
        """Build user profile context string for the prompt."""
        parts = []
        if profile.get("age"):
            parts.append(f"Age: {profile['age']}")
        if profile.get("gender"):
            parts.append(f"Gender: {profile['gender']}")
        if profile.get("weight"):
            parts.append(f"Weight: {profile['weight']} lbs")
        if profile.get("coaching_style_preference"):
            parts.append(f"Coaching style: {profile['coaching_style_preference']}")
        if profile.get("training_history_notes"):
            parts.append(f"Training background: {profile['training_history_notes']}")
        if profile.get("biggest_blocker"):
            parts.append(f"Biggest challenge: {profile['biggest_blocker']}")

        if parts:
            return "USER PROFILE:\n" + "\n".join(f"- {p}" for p in parts)
        return ""

    def _validate_plan(self, plan: dict) -> dict:
        """Validate AI output and fix issues."""
        # Validate each day's exercises
        for day in plan.get("days", []):
            valid_exercises = []
            for ex in day.get("exercises", []):
                exercise_id = ex.get("exercise_id", "")
                if validate_exercise_id(exercise_id):
                    # Clamp rep ranges
                    ex["reps"] = max(1, min(30, ex.get("reps", 10)))
                    ex["sets"] = max(1, min(10, ex.get("sets", 3)))
                    valid_exercises.append(ex)
                else:
                    print(f"[PlanGenerator] Removed invalid exercise ID: {exercise_id}")
            day["exercises"] = valid_exercises

            # Re-number order
            for i, ex in enumerate(day["exercises"]):
                ex["order"] = i + 1

        # Ensure required fields
        if "plan_name" not in plan:
            plan["plan_name"] = "Custom Workout Plan"
        if "split_type" not in plan:
            plan["split_type"] = "Custom"
        if "weekly_schedule" not in plan:
            plan["weekly_schedule"] = {
                "monday": "Rest", "tuesday": "Rest", "wednesday": "Rest",
                "thursday": "Rest", "friday": "Rest", "saturday": "Rest",
                "sunday": "Rest"
            }

        return plan
