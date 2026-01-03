"""
User Profile Transformer
Converts UserProfile data from Firestore into AI-friendly format.
"""

from typing import Dict, Any, Optional, List


def safe_str(value):
    if value is None:
        return ""
    return str(value).strip()


def transform_user_profile(profile_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Transform UserProfile from Firestore into format suitable for AI analysis.

    Args:
        profile_data: Raw user profile data from Firestore

    Returns:
        Transformed profile data for AI prompts
    """
    if not profile_data:
        return {
            "goal": "Get strong and build muscle",
            "priority": "Long-term consistency over short-term aesthetics",
            "constraints": ["Busy work schedule"],
            "training_style": "Prefers efficient sessions with progressive overload",
            "experience_level": "intermediate",
            "preferences": {
                "workout_duration": "45-60 minutes",
                "training_frequency": "4-5 days per week",
                "preferred_time": "evening"
            }
        }

    # Build transformed profile
    profile = {}

    # Physical Stats
    physical_stats = []
    if profile_data.get('height_cm'):
        physical_stats.append(f"Height: {profile_data['height_cm']}cm")
    elif profile_data.get('height_ft') and profile_data.get('height_in'):
        physical_stats.append(f"Height: {profile_data['height_ft']}'{profile_data['height_in']}\"")

    if profile_data.get('weight'):
        physical_stats.append(f"Weight: {profile_data['weight']}lbs")

    if profile_data.get('age'):
        physical_stats.append(f"Age: {profile_data['age']}")

    if profile_data.get('gender'):
        physical_stats.append(f"Gender: {profile_data['gender']}")

    if physical_stats:
        profile['physical_stats'] = ', '.join(physical_stats)

    # Goals
    goal_parts = []
    primary_goal = profile_data.get('primary_goal')
    
    if primary_goal:
        primary_goal_str = safe_str(primary_goal)
        if primary_goal_str:
            goal_parts.append(primary_goal_str)

    # Check for custom primary goal text field (if exists)
    primary_goal_custom = profile_data.get('primary_goal_custom') or profile_data.get('primary_goal_text')
    if primary_goal_custom:
        goal_parts.append(primary_goal_custom)

    if profile_data.get('secondary_goals'):
        secondary = profile_data['secondary_goals']
        if isinstance(secondary, list) and secondary:
            secondary_str = [safe_str(s) for s in secondary if safe_str(s)]
            if secondary_str:
                goal_parts.append(f"Also: {', '.join(secondary_str)}")

    profile['goal'] = ' | '.join(goal_parts) if goal_parts else "Get strong and build muscle"

    # Time Horizon / Priority
    if profile_data.get('time_horizon'):
        profile['priority'] = f"{profile_data['time_horizon']} timeframe"
    else:
        profile['priority'] = "Long-term consistency over short-term aesthetics"

    # Constraints (from lifestyle/schedule)
    constraints = []

    if profile_data.get('work_school_hours'):
        constraints.append(f"Works/studies {profile_data['work_school_hours']} hours/day")

    # Busy level scale: 1-10 (1 = not busy, 10 = extremely busy)
    busy_level = profile_data.get('busy_level')
    if busy_level:
        if busy_level >= 9:
            constraints.append("Extremely busy schedule - very limited free time")
        elif busy_level >= 7:
            constraints.append("Very busy schedule - limited free time")
        elif busy_level >= 5:
            constraints.append("Moderately busy schedule")
        elif busy_level >= 3:
            constraints.append("Somewhat busy - manageable schedule")
        elif busy_level >= 1:
            constraints.append("Flexible schedule with good availability")

    if profile_data.get('family_obligations'):
        note = profile_data.get('family_obligations_note', '')
        if note:
            constraints.append(f"Family obligations: {note}")
        else:
            constraints.append("Has family obligations")

    stress_level = profile_data.get('typical_stress_level')
    if stress_level and stress_level >= 7:
        constraints.append("High stress levels")
        if profile_data.get('stress_fluctuates'):
            constraints.append("Stress levels fluctuate significantly")
    elif stress_level and stress_level >= 5:
        constraints.append("Moderate stress levels")

    profile['constraints'] = constraints if constraints else ["Busy work schedule"]

    # Experience Level
    profile['experience_level'] = profile_data.get('experience_level', 'intermediate')

    # Training Style / History
    training_style_parts = []

    if profile_data.get('training_history_style'):
        styles = profile_data['training_history_style']
        if isinstance(styles, list):
            styles_str = [safe_str(s) for s in styles if safe_str(s)]
            if styles_str:
                training_style_parts.append(f"Experience with: {', '.join(styles_str)}")

    if profile_data.get('training_history_notes'):
        training_style_parts.append(profile_data['training_history_notes'])

    if profile_data.get('coaching_style_preference'):
        training_style_parts.append(f"Prefers {profile_data['coaching_style_preference']} coaching style")

    profile['training_style'] = ' | '.join(training_style_parts) if training_style_parts else "Prefers efficient sessions with progressive overload"

    # Preferences
    preferences = {}

    # Session length - handles: "30-45 min", "45-60 min", "60-90 min", "90+ min"
    session_length = profile_data.get('preferred_session_length')
    if session_length:
        preferences['workout_duration'] = session_length
        # Add context based on session length preference
        if "90+" in session_length or "90-" in session_length:
            preferences['duration_note'] = "Prefers longer training sessions - likely high volume tolerance"
        elif "30-45" in session_length:
            preferences['duration_note'] = "Prefers shorter, efficient sessions - time-constrained"
    else:
        preferences['workout_duration'] = "45-60 minutes"

    if profile_data.get('preferred_workout_frequency'):
        preferences['training_frequency'] = profile_data['preferred_workout_frequency']
    else:
        preferences['training_frequency'] = "4-5 days per week"

    if profile_data.get('preferred_workout_time'):
        preferences['preferred_time'] = profile_data['preferred_workout_time']
    else:
        preferences['preferred_time'] = "flexible"

    profile['preferences'] = preferences

    # Nutrition Context
    nutrition_parts = []

    if profile_data.get('dietary_preference'):
        dietary = profile_data['dietary_preference']
        if dietary == "Other" and profile_data.get('dietary_preference_other'):
            nutrition_parts.append(profile_data['dietary_preference_other'])
        else:
            nutrition_parts.append(dietary)

    if profile_data.get('willingness_to_track'):
        nutrition_parts.append(f"Tracking willingness: {profile_data['willingness_to_track']}")

    if nutrition_parts:
        profile['nutrition_context'] = ' | '.join(nutrition_parts)

    # Mindset / Self-Perception
    mindset_parts = []

    if profile_data.get('progress_feeling'):
        mindset_parts.append(f"Feels progress is: {profile_data['progress_feeling']}")

    if profile_data.get('biggest_blocker'):
        mindset_parts.append(f"Biggest blocker: {profile_data['biggest_blocker']}")

    if profile_data.get('open_reflection'):
        mindset_parts.append(f"Personal reflection: {profile_data['open_reflection']}")

    if mindset_parts:
        profile['mindset'] = ' | '.join(mindset_parts)

    return profile


def get_user_profile_for_ai(db, user_id: str) -> Dict[str, Any]:
    """
    Fetch user profile from Firestore and transform it for AI analysis.

    Args:
        db: Firestore database client
        user_id: User ID

    Returns:
        Transformed user profile ready for AI prompts
    """
    try:
        doc_ref = db.collection("users").document(user_id).collection("user_profile").document("profile")
        doc = doc_ref.get()

        if doc.exists:
            profile_data = doc.to_dict()
            return transform_user_profile(profile_data)
        else:
            # Return default profile if user hasn't filled it out yet
            return transform_user_profile(None)
    except Exception as e:
        print(f"Error fetching user profile: {e}")
        return transform_user_profile(None)
