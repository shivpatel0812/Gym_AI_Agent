"""
Fitness AI Coach - OpenAI Integration
Generates personalized fitness insights using OpenAI API.
"""

import json
from typing import Dict, List, Any, Optional
from openai import OpenAI


def clean_for_json(obj: Any) -> Any:
    """Recursively remove None values and ensure all values are JSON-serializable."""
    if obj is None:
        return None
    elif isinstance(obj, dict):
        cleaned = {k: clean_for_json(v) for k, v in obj.items() if v is not None}
        # Remove empty strings from dict values
        cleaned = {k: v for k, v in cleaned.items() if v != ""}
        return cleaned if cleaned else None
    elif isinstance(obj, list):
        cleaned = [clean_for_json(item) for item in obj if item is not None]
        # Remove empty strings from list
        cleaned = [item for item in cleaned if item != ""]
        return cleaned if cleaned else None
    elif isinstance(obj, (str, int, float, bool)):
        # Return empty string as None to be filtered out
        return obj if (not isinstance(obj, str) or obj.strip()) else None
    else:
        # Convert to string, but return None if empty
        str_obj = str(obj) if obj else None
        return str_obj if (str_obj and str_obj.strip()) else None


class FitnessAICoach:
    """AI-powered fitness coach using OpenAI API."""

    def __init__(self, api_key: str, model: str = "gpt-4o", user_profile: Optional[Dict] = None):
        """
        Initialize OpenAI client.

        Args:
            api_key: OpenAI API key
            model: Model to use (default: gpt-4o)
            user_profile: Optional user profile data
        """
        self.client = OpenAI(api_key=api_key)
        self.model = model

        # Default user profile (can be customized per user)
        self.user_profile = user_profile or {
            "goal": "Get strong and build muscle",
            "priority": "Long-term consistency over short-term aesthetics",
            "constraints": ["Busy work schedule", "Student with exam periods"],
            "training_style": "Prefers efficient sessions with progressive overload",
            "experience_level": "intermediate",
            "preferences": {
                "workout_duration": "45-60 minutes",
                "training_frequency": "4-5 days per week",
                "preferred_time": "evening"
            }
        }

    def _build_general_analysis_prompt(self, summary: Dict[str, Any], previous_analyses: Optional[List[str]] = None) -> str:
        """Build structured prompt for General Analysis with optional previous months' context."""
        try:
            cleaned_profile = clean_for_json(self.user_profile)
            profile_json = json.dumps(cleaned_profile, indent=2, default=str)
            # More strict validation - check if JSON is meaningful
            if not profile_json or not profile_json.strip() or profile_json in ["null", "{}", "[]"]:
                profile_json = json.dumps({
                    "goal": "Get strong and build muscle",
                    "experience_level": "intermediate"
                }, indent=2)
        except Exception as e:
            print(f"Error processing profile: {e}")
            profile_json = json.dumps({
                "goal": "Get strong and build muscle",
                "experience_level": "intermediate"
            }, indent=2)
        
        try:
            cleaned_summary = clean_for_json(summary)
            summary_json = json.dumps(cleaned_summary, indent=2, default=str)
            # More strict validation
            if not summary_json or not summary_json.strip() or summary_json in ["null", "{}", "[]"]:
                summary_json = json.dumps({
                    "message": "No data available for this period"
                }, indent=2)
        except Exception as e:
            print(f"Error processing summary: {e}")
            summary_json = json.dumps({
                "message": "Error processing data"
            }, indent=2)
        
        prompt = f"""You are an expert fitness coach providing a personalized monthly review.

USER PROFILE:
{profile_json}
"""

        # Add previous months' analyses as context if provided
        if previous_analyses and len(previous_analyses) > 0:
            valid_analyses = [str(a).strip() for a in previous_analyses if a and str(a).strip()]
            if valid_analyses:
                if len(valid_analyses) == 1:
                    prompt += f"""
PREVIOUS MONTH'S ANALYSIS (for context and comparison):
{valid_analyses[0]}

"""
                else:
                    prompt += f"""
PREVIOUS MONTHS' ANALYSES (in chronological order, for context and trend analysis):
"""
                    for i, analysis in enumerate(valid_analyses, 1):
                        prompt += f"""
--- Month {i} ---
{analysis}

"""

        prompt += f"""CURRENT MONTH DATA:
{summary_json}


Provide a structured analysis covering these sections:

1. TRAINING
   - Evaluate training frequency, volume, and progression
   - Note any concerning patterns or positive trends

2. NUTRITION
   - Assess calorie and protein intake relative to goals
   - Comment on consistency and adequacy

3. RECOVERY
   - Analyze sleep quality and quantity
   - Assess fatigue and energy levels
   - Identify any recovery deficits

4. LIFESTYLE
   - Consider stress impact on training and recovery
   - Evaluate overall activity levels

5. WHAT TO CHANGE
   - Provide 2-3 specific, actionable changes
   - Prioritize based on biggest limiting factors
   - Make recommendations realistic and incremental

6. WHAT TO KEEP
   - Identify 2-3 things that are working well
   - Reinforce positive behaviors

7. PRIORITY FOCUS (Next 1-2 Weeks)
   - One clear, measurable focus area
   - Explain why this is the priority

GUIDELINES:
- Be specific and personal (use actual numbers from the data)
- Be realistic about constraints (busy student schedule)
- Prioritize sustainability over optimization
- Avoid generic advice
- Use a supportive but direct coaching tone
- Keep each section concise (2-4 sentences max)
"""

        if previous_analyses and len(previous_analyses) > 0:
            if len(previous_analyses) == 1:
                prompt += """- Compare current month's performance with the previous month
- Note improvements, declines, or trends
- Reference specific changes from the previous analysis when relevant
"""
            else:
                prompt += """- Compare current month's performance with all previous months
- Identify trends and patterns across the entire period
- Note improvements, declines, or consistent patterns over time
- Reference specific changes and progressions from earlier months when relevant
"""

        prompt += """
Format your response with clear section headers."""

        # Final validation before returning
        if not prompt or not prompt.strip() or len(prompt.strip()) < 50:
            return "You are an expert fitness coach. Provide a comprehensive monthly fitness analysis based on the available data."
        
        return prompt

    def generate_general_analysis(self, summary: Dict[str, Any], previous_analyses: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Generate comprehensive General Analysis report with optional previous months' context.

        Args:
            summary: Current month's data summary
            previous_analyses: List of previous months' analyses (in chronological order)

        Returns:
            Dict containing analysis status, text, tokens used, etc.
        """
        if previous_analyses:
            previous_analyses = [str(analysis) for analysis in previous_analyses if analysis and str(analysis).strip()]
        
        prompt = self._build_general_analysis_prompt(summary, previous_analyses)
        
        if not prompt or not prompt.strip():
            return {
                "status": "error",
                "error": "Generated prompt is empty"
            }

        try:
            system_content = "You are an expert fitness coach providing personalized, data-driven insights. You are direct, supportive, and focused on long-term sustainable progress."
            
            if not isinstance(system_content, str) or not system_content.strip():
                system_content = "You are an expert fitness coach."
            
            if not isinstance(prompt, str) or not prompt.strip():
                return {
                    "status": "error",
                    "error": "Prompt is not a valid string"
                }
            
            messages = [
                {
                    "role": "system",
                    "content": system_content
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
            
            for msg in messages:
                if not isinstance(msg.get("content"), str) or not msg["content"].strip():
                    return {
                        "status": "error",
                        "error": f"Message content is invalid: {msg.get('role')}"
                    }
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                max_tokens=1500
            )

            analysis_text = response.choices[0].message.content

            return {
                "status": "success",
                "analysis": analysis_text,
                "model": self.model,
                "tokens_used": response.usage.total_tokens,
                "summary_data": summary
            }

        except Exception as e:
            return {
                "status": "error",
                "error": str(e)
            }

    def _build_chatbot_context(self, summary: Dict[str, Any]) -> str:
        """Build condensed context for chatbot."""
        training = summary.get('training', {})
        nutrition = summary.get('nutrition', {})
        recovery = summary.get('recovery', {})
        lifestyle = summary.get('lifestyle', {})

        return f"""USER PROFILE:
{json.dumps(self.user_profile, indent=2)}

RECENT DATA (monthly summary):
Training: {training.get('sessions_per_week', 0)} sessions/week, {training.get('progression', 'stable')} progression
Nutrition: ~{nutrition.get('avg_calories', 0)} cal, ~{nutrition.get('avg_protein', 0)}g protein
Recovery: {recovery.get('avg_sleep_hours', 0)}h sleep (trend: {recovery.get('sleep_trend', 'stable')}), fatigue {recovery.get('avg_fatigue', 0)}/10
Lifestyle: Stress {lifestyle.get('avg_stress', 0)}/10, {lifestyle.get('high_stress_days', 0)} high-stress days
"""

    def chat(self, user_message: str, summary: Dict[str, Any], conversation_history: Optional[List[Dict]] = None) -> Dict[str, Any]:
        """
        Handle chatbot interactions with context awareness.

        Args:
            user_message: User's question/message
            summary: Current fitness data summary
            conversation_history: Previous conversation messages

        Returns:
            Dict containing response status, message, tokens used, and updated history
        """
        if conversation_history is None:
            conversation_history = []

        context = self._build_chatbot_context(summary)

        system_message = f"""You are a personal fitness coach who knows this user's training history and current status.

{context}

Provide specific, personalized advice based on their actual data. Be conversational but precise.
Reference their actual numbers when relevant (sleep hours, training frequency, etc.).
Consider their constraints (busy student schedule) in your recommendations."""

        messages = [{"role": "system", "content": system_message}]
        messages.extend(conversation_history)
        messages.append({"role": "user", "content": user_message})

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                max_tokens=500
            )

            assistant_message = response.choices[0].message.content

            return {
                "status": "success",
                "response": assistant_message,
                "tokens_used": response.usage.total_tokens,
                "conversation_history": conversation_history + [
                    {"role": "user", "content": user_message},
                    {"role": "assistant", "content": assistant_message}
                ]
            }

        except Exception as e:
            return {
                "status": "error",
                "error": str(e)
            }
