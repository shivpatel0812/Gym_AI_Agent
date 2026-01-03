# AI Analysis Module

This module integrates AI-powered fitness analysis into the GymAI backend, using OpenAI to generate personalized insights based on user fitness data.

## Overview

The AI Analysis module consists of:

1. **FitnessDataAnalyzer** (`data_analyzer.py`) - Fetches and processes fitness data from Firestore
2. **FitnessAICoach** (`ai_coach.py`) - Generates AI-powered insights using OpenAI
3. **API Router** (`routers/ai_analysis.py`) - REST API endpoints for AI features

## Features

### Data Processing

The `FitnessDataAnalyzer` class builds comprehensive monthly summaries including:

- **Training metrics**: Sessions, volume, progression, compound lift tracking
- **Nutrition metrics**: Calories, macros, consistency
- **Recovery metrics**: Sleep hours/quality, fatigue, energy levels
- **Lifestyle metrics**: Stress levels, daily steps, activity

### AI Analysis

The `FitnessAICoach` class provides:

1. **General Analysis**: Comprehensive monthly review with:
   - Training evaluation
   - Nutrition assessment
   - Recovery analysis
   - Lifestyle impact
   - Actionable recommendations
   - Priority focus areas

2. **AI Chatbot**: Context-aware Q&A about fitness data

## API Endpoints

### 1. Get Monthly Summary

```
GET /api/ai-analysis/summary?year=2024&month=12
```

Returns processed fitness data for a specific month.

### 2. Generate AI Analysis

```
POST /api/ai-analysis/generate
{
  "year": 2024,
  "month": 12,
  "include_previous_months": true
}
```

Generates AI-powered analysis for a month. Set `include_previous_months: true` to include context from previous months for trend analysis.

### 3. Get All Analyses

```
GET /api/ai-analysis/analyses?year=2024&limit=10
```

Retrieves stored AI analyses for the user.

### 4. Get Specific Analysis

```
GET /api/ai-analysis/analyses/2024-12
```

Retrieves a specific analysis by ID (format: YYYY-MM).

### 5. Chat with AI Coach

```
POST /api/ai-analysis/chat
{
  "message": "Why am I so fatigued?",
  "year": 2024,
  "month": 12,
  "conversation_history": []
}
```

Interactive chat with AI coach using current or specified month's data as context.

### 6. Delete Analysis

```
DELETE /api/ai-analysis/analyses/2024-12
```

Deletes a specific AI analysis.

## Setup

### Environment Variables

Add your OpenAI API key to `.env`:

```
OPENAI_API_KEY=your_openai_api_key_here
```

### Dependencies

The module requires:
- `openai` - OpenAI Python SDK

Install with:
```bash
pip install openai
```

## Database Structure

AI analyses are stored in Firestore:

```
users/{user_id}/ai_analyses/{year-month}
  - user_id: string
  - year: int
  - month: int
  - status: string
  - analysis: string (AI-generated text)
  - model: string (e.g., "gpt-4o")
  - tokens_used: int
  - summary_data: object
  - created_at: timestamp
  - previous_context_count: int
```

## How It Works

### Data Flow

1. **Data Collection**: Fetches user data from Firestore collections:
   - `workout_sessions`
   - `macros`
   - `sleep`
   - `wellness_survey`
   - `stress`
   - `physical_activities`

2. **Data Processing**: Builds monthly summaries with metrics and trends

3. **AI Generation**: Sends summary to OpenAI with:
   - User profile (goals, constraints, preferences)
   - Previous months' analyses (for context)
   - Structured prompt for consistent output

4. **Storage**: Saves analysis to Firestore for future retrieval

### Context Awareness

The AI Coach can use previous months' analyses to:
- Identify long-term trends
- Track progress over time
- Compare current performance with past months
- Provide more informed recommendations

## User Profile Integration

The AI analysis now automatically uses the user's actual profile from the "About Me" section:

### Integrated Profile Data

- **Physical Stats**: Height, weight, age, gender
- **Goals**: Primary goal, secondary goals, time horizon
- **Experience**: Training history, experience level
- **Lifestyle**: Work/school hours, busy level, family obligations, stress levels
- **Training Preferences**: Workout time, session length, frequency, coaching style
- **Nutrition**: Dietary preferences, tracking willingness
- **Mindset**: Progress feeling, biggest blocker, personal reflection

### Profile Transformer

The `profile_transformer.py` module converts UserProfile data into AI-friendly format:

```python
from ai_analysis import get_user_profile_for_ai

# Fetches and transforms user profile for AI
user_profile = get_user_profile_for_ai(db, user_id)
```

### Example Transformed Profile

Here's how your UserProfile data looks when sent to the AI:

```python
{
    "physical_stats": "Height: 180cm, Weight: 175lbs, Age: 25, Gender: Male",
    "goal": "Build muscle | Also: Increase strength, Improve endurance",
    "priority": "6 months timeframe",
    "constraints": [
        "Works/studies 8 hours/day",
        "Moderately busy schedule",
        "High stress levels",
        "Stress levels fluctuate significantly"
    ],
    "experience_level": "intermediate",
    "training_style": "Experience with: PPL, Upper/Lower | Been training for 2 years consistently | Prefers structured and analytical coaching style",
    "preferences": {
        "workout_duration": "45-60 minutes",
        "training_frequency": "4-5 days per week",
        "preferred_time": "evening"
    },
    "nutrition_context": "No strict diet | Tracking willingness: Willing to track macros daily",
    "mindset": "Feels progress is: Slow but steady | Biggest blocker: Inconsistent sleep | Personal reflection: Want to focus on compound lifts and progressive overload"
}
```

### Default Profile

If a user hasn't filled out their profile yet, a default profile is used:

```python
{
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
```

### AI Model

Change the OpenAI model in `FitnessAICoach.__init__()`:

```python
coach = FitnessAICoach(api_key=api_key, model="gpt-4")
```

## Example Usage

### Python

```python
from ai_analysis import FitnessDataAnalyzer, FitnessAICoach
from db import db

# Initialize analyzer
analyzer = FitnessDataAnalyzer(db, "user_id_123")

# Build summary for December 2024
summary = analyzer.build_complete_summary(2024, 12)

# Generate AI analysis
coach = FitnessAICoach(api_key="your_key")
result = coach.generate_general_analysis(summary)
print(result["analysis"])
```

### API Call

```bash
# Generate December 2024 analysis
curl -X POST http://localhost:8000/api/ai-analysis/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "year": 2024,
    "month": 12,
    "include_previous_months": true
  }'
```

## Differences from Original Script

The backend integration differs from `AI_Analysis/fitnessai_analyzer.py`:

1. **Data Source**: Fetches from Firestore instead of JSON files
2. **API-based**: Exposed as REST endpoints instead of standalone script
3. **User Authentication**: Integrated with backend auth system
4. **Persistent Storage**: Analyses stored in Firestore
5. **Multi-user**: Supports multiple users with separate data

The core AI logic and data processing algorithms remain the same.
