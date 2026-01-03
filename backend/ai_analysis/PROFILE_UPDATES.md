# AI Analysis Profile Updates

## Changes Made to Support New UserProfile Options

### 1. Primary Fitness Goal - Custom Text Paragraph

**What Changed:**
- Added support for longer, custom text input for primary fitness goals
- New field: `primary_goal_custom` in UserProfile model

**How It Works:**
- If user selects a predefined option (e.g., "Build muscle"), it uses `primary_goal`
- If user enters custom paragraph text, it's stored in `primary_goal_custom`
- AI analysis includes both in the goal description for comprehensive context

**Example:**
```python
# User selects: "Build muscle" + writes custom text
{
    "primary_goal": "Build muscle",
    "primary_goal_custom": "I want to focus on hypertrophy training with emphasis on upper body development, particularly chest and arms, while maintaining strength in compound lifts."
}

# AI receives:
{
    "goal": "Build muscle | I want to focus on hypertrophy training with emphasis on upper body development, particularly chest and arms, while maintaining strength in compound lifts. | Also: Increase strength, Improve endurance"
}
```

---

### 2. Busy Level Scale - Updated to 1-10

**What Changed:**
- Scale increased from 1-5 to **1-10** for more granular lifestyle assessment
- Updated AI interpretation logic to match new scale

**New Interpretations (1-10 scale):**
- **9-10**: "Extremely busy schedule - very limited free time"
- **7-8**: "Very busy schedule - limited free time"
- **5-6**: "Moderately busy schedule"
- **3-4**: "Somewhat busy - manageable schedule"
- **1-2**: "Flexible schedule with good availability"

**Why This Matters:**
The AI can now better tailor recommendations based on time constraints:
- High busy levels (8+) → AI suggests shorter, efficient workouts
- Low busy levels (1-3) → AI can suggest more comprehensive training programs
- Medium busy levels (4-7) → AI balances efficiency with volume

**Example:**
```python
# User rates busy_level = 8
{
    "constraints": [
        "Works/studies 9 hours/day",
        "Very busy schedule - limited free time",
        "High stress levels"
    ]
}

# AI will recommend:
- Shorter sessions (45-60 min max)
- Focus on compound movements
- 3-4 days/week frequency
- Time-efficient training strategies
```

---

### 3. Session Length - New Duration Options

**What Changed:**
- Added **"60-90 min"** option
- Added **"90+ min"** option
- Enhanced AI interpretation of session length preferences

**Full Options Now:**
- "30-45 min" → Time-constrained, efficient training needed
- "45-60 min" → Standard session length
- "60-90 min" → Moderate to high volume tolerance
- "90+ min" → High volume tolerance, dedicated training time

**AI Context Added:**
The profile transformer now adds intelligent context based on session length:

```python
# If user selects "90+ min"
{
    "preferences": {
        "workout_duration": "90+ min",
        "duration_note": "Prefers longer training sessions - likely high volume tolerance"
    }
}

# If user selects "30-45 min"
{
    "preferences": {
        "workout_duration": "30-45 min",
        "duration_note": "Prefers shorter, efficient sessions - time-constrained"
    }
}
```

**How AI Uses This:**
- **90+ min**: AI suggests high-volume splits (PPL, bro split), more exercises per session
- **60-90 min**: AI suggests moderate volume (Upper/Lower, Push/Pull/Legs)
- **45-60 min**: AI suggests efficient programming (full body, compounds focused)
- **30-45 min**: AI suggests minimalist programs (main lifts only, supersets)

---

## Example: Complete Profile Transformation

### User Input:
```json
{
    "primary_goal": "Build muscle",
    "primary_goal_custom": "Focus on upper body hypertrophy while maintaining lower body strength",
    "busy_level": 7,
    "preferred_session_length": "60-90 min",
    "work_school_hours": 8,
    "typical_stress_level": 6
}
```

### AI Receives:
```json
{
    "goal": "Build muscle | Focus on upper body hypertrophy while maintaining lower body strength",
    "constraints": [
        "Works/studies 8 hours/day",
        "Very busy schedule - limited free time",
        "Moderate stress levels"
    ],
    "preferences": {
        "workout_duration": "60-90 min",
        "duration_note": "Prefers longer training sessions - likely high volume tolerance"
    }
}
```

### AI Analysis Will:
1. ✅ Recognize the specific goal (upper body focus)
2. ✅ Account for busy schedule in frequency recommendations
3. ✅ Suggest programming that fits 60-90 min sessions
4. ✅ Consider stress levels in recovery recommendations
5. ✅ Tailor volume based on session length tolerance

---

## Integration Points

### 1. Data Collection (Frontend)
- UserProfile form collects all new fields
- Stored in Firestore: `users/{userId}/user_profile/profile`

### 2. Profile Transformation (Backend)
- `profile_transformer.py` converts raw data to AI-friendly format
- Adds intelligent context and interpretations

### 3. AI Analysis (OpenAI)
- `FitnessAICoach` receives transformed profile
- Uses profile in system prompts for personalized analysis
- References specific constraints, goals, and preferences in recommendations

---

## Testing the Changes

### Test Case 1: Long Session Preference
```bash
# Create profile with 90+ min sessions
POST /api/user-profile
{
  "preferred_session_length": "90+ min"
}

# Generate analysis
POST /api/ai-analysis/generate
{
  "year": 2024,
  "month": 12
}

# Expected: AI should suggest high-volume training, more exercises
```

### Test Case 2: Custom Goal Text
```bash
# Create profile with custom goal
POST /api/user-profile
{
  "primary_goal": "Build muscle",
  "primary_goal_custom": "I want to compete in a physique competition in 12 months"
}

# Generate analysis
POST /api/ai-analysis/generate

# Expected: AI references competition goal in recommendations
```

### Test Case 3: High Busy Level
```bash
# Create profile with busy_level = 9
POST /api/user-profile
{
  "busy_level": 9,
  "preferred_session_length": "30-45 min"
}

# Generate analysis
POST /api/ai-analysis/generate

# Expected: AI suggests time-efficient training, 3x/week frequency, compound focus
```

---

## Files Updated

1. **`backend/models.py`**
   - Added `primary_goal_custom: Optional[str]` field

2. **`backend/ai_analysis/profile_transformer.py`**
   - Updated `transform_user_profile()` function:
     - Handle custom goal text paragraph
     - Adjust busy level logic for 1-10 scale
     - Add intelligent session length interpretation
     - Add context notes for AI

3. **`backend/ai_analysis/PROFILE_UPDATES.md`**
   - This documentation file

---

## Benefits

### More Personalized AI Recommendations
- AI understands **specific** user goals (not just general categories)
- AI accounts for **realistic** time constraints (1-10 scale vs 1-5)
- AI tailors **programming style** to session length preferences

### Better User Experience
- Users can express goals in their own words
- More granular busy level assessment
- Session lengths match real-world training durations

### Improved Accuracy
- AI recommendations better match user's actual lifestyle
- Programming suggestions align with available training time
- Recovery recommendations consider detailed stress/busy data
