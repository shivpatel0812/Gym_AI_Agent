"""
Fitness AI Analyzer
===================
Analyzes fitness data and generates personalized insights using OpenAI API.

Two main features:
1. General Analysis - Comprehensive weekly review of training, nutrition, recovery, lifestyle
2. AI Chatbot - Context-aware Q&A about fitness data

Author: Built for WellnessAI/GymAI MVP
"""

import json
import os
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from collections import defaultdict
import statistics
import calendar

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # dotenv not installed, continue without it (will use system env vars)
    pass

# OpenAI import (install with: pip install openai --break-system-packages)
try:
    from openai import OpenAI
except ImportError:
    print("Installing OpenAI package...")
    os.system("pip install openai --break-system-packages")
    from openai import OpenAI


class FitnessDataAnalyzer:
    """Processes raw fitness data and builds rolling summaries."""
    
    def __init__(self, json_path: str):
        """Load fitness data from JSON file."""
        with open(json_path, 'r') as f:
            self.data = json.load(f)
        
        self.user_id = self.data['user_id']
        self.collections = self.data['collections']
        
    def _get_month_date_range(self, year: int, month: int) -> tuple:
        """Get start and end dates for a given month (year, month)."""
        # Get first day of the month
        start_date = datetime(year, month, 1)
        
        # Get last day of the month
        last_day = calendar.monthrange(year, month)[1]
        end_date = datetime(year, month, last_day)
        
        return start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d')
    
    def _get_days_in_month(self, year: int, month: int) -> int:
        """Get number of days in a given month."""
        return calendar.monthrange(year, month)[1]
    
    def _filter_by_date_range(self, collection: List[Dict], start_date: str, end_date: str) -> List[Dict]:
        """Filter collection items within date range."""
        return [
            item for item in collection
            if start_date <= item['date'] <= end_date
        ]
    
    def build_training_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build training metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        days_in_month = self._get_days_in_month(year, month)
        workouts = self._filter_by_date_range(self.collections['workout_sessions'], start_date, end_date)
        
        # Calculate basic metrics
        total_sessions = len(workouts)
        sessions_per_week = (total_sessions / days_in_month) * 7
        
        # Split adherence
        split_distribution = defaultdict(int)
        for workout in workouts:
            split_distribution[workout['split_name']] += 1
        
        # Volume and progression tracking
        total_sets = 0
        total_reps = 0
        compound_movements = {}  # Track key lifts
        
        for workout in workouts:
            for exercise in workout['exercises']:
                sets = exercise['sets']
                total_sets += len(sets)
                total_reps += sum(s['reps'] for s in sets)
                
                # Track compound lifts (Deadlift, Squat, Bench)
                ex_name = exercise['exercise_name']
                if any(compound in ex_name for compound in ['Deadlift', 'Squat', 'Bench Press']):
                    if ex_name not in compound_movements:
                        compound_movements[ex_name] = []
                    
                    # Track max weight per session
                    max_weight = max((s['weight'] or 0) for s in sets)
                    compound_movements[ex_name].append({
                        'date': workout['date'],
                        'max_weight': max_weight,
                        'total_reps': sum(s['reps'] for s in sets)
                    })
        
        # Calculate progression (simple: compare first half vs second half)
        progression = "stable"
        if len(workouts) >= 4:
            mid_point = len(workouts) // 2
            early_workouts = workouts[:mid_point]
            recent_workouts = workouts[mid_point:]
            
            early_volume = sum(len(ex['sets']) for w in early_workouts for ex in w['exercises'])
            recent_volume = sum(len(ex['sets']) for w in recent_workouts for ex in w['exercises'])
            
            if recent_volume > early_volume * 1.1:
                progression = "increasing"
            elif recent_volume < early_volume * 0.9:
                progression = "decreasing"
        
        # Expected sessions (assuming 4-5 per week for PPL)
        expected_sessions = (days_in_month / 7) * 4.5
        missed_sessions = max(0, int(expected_sessions - total_sessions))
        
        month_name = calendar.month_name[month]
        return {
            "time_window": f"{month_name} {year}",
            "start_date": start_date,
            "end_date": end_date,
            "total_sessions": total_sessions,
            "sessions_per_week": round(sessions_per_week, 1),
            "split_distribution": dict(split_distribution),
            "total_sets": total_sets,
            "total_reps": total_reps,
            "avg_sets_per_session": round(total_sets / total_sessions, 1) if total_sessions > 0 else 0,
            "progression": progression,
            "missed_sessions": missed_sessions,
            "compound_lifts": compound_movements
        }
    
    def build_nutrition_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build nutrition metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        month_name = calendar.month_name[month]
        macros = self._filter_by_date_range(self.collections['macros'], start_date, end_date)
        
        if not macros:
            return {"error": "No nutrition data available"}
        
        calories = [m['total_calories'] for m in macros]
        protein = [m['total_protein'] for m in macros]
        carbs = [m['total_carbs'] for m in macros]
        fats = [m['total_fats'] for m in macros]
        
        # Consistency score (lower std dev = more consistent)
        cal_std = statistics.stdev(calories) if len(calories) > 1 else 0
        consistency = "excellent" if cal_std < 150 else "good" if cal_std < 250 else "variable"
        
        return {
            "time_window": f"{month_name} {year}",
            "days_logged": len(macros),
            "avg_calories": round(statistics.mean(calories)),
            "calories_range": [min(calories), max(calories)],
            "avg_protein": round(statistics.mean(protein)),
            "avg_carbs": round(statistics.mean(carbs)),
            "avg_fats": round(statistics.mean(fats)),
            "consistency": consistency,
            "protein_ratio": round((statistics.mean(protein) * 4 / statistics.mean(calories)) * 100, 1)
        }
    
    def build_recovery_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build recovery metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        month_name = calendar.month_name[month]
        wellness = self._filter_by_date_range(self.collections['wellness_survey'], start_date, end_date)
        
        if not wellness:
            return {"error": "No wellness data available"}
        
        sleep_hours = [w['sleep_hours'] for w in wellness]
        sleep_quality = [w['sleep_quality'] for w in wellness]
        fatigue = [w['fatigue'] for w in wellness]
        energy = [w['energy'] for w in wellness]
        body_aches = [w['body_aches'] for w in wellness]
        
        # Trend calculation (compare first half to second half)
        mid = len(sleep_hours) // 2
        sleep_trend = "stable"
        fatigue_trend = "stable"
        
        if len(sleep_hours) >= 4:
            early_sleep = statistics.mean(sleep_hours[:mid])
            recent_sleep = statistics.mean(sleep_hours[mid:])
            if recent_sleep < early_sleep - 0.5:
                sleep_trend = "declining"
            elif recent_sleep > early_sleep + 0.5:
                sleep_trend = "improving"
            
            early_fatigue = statistics.mean(fatigue[:mid])
            recent_fatigue = statistics.mean(fatigue[mid:])
            if recent_fatigue > early_fatigue + 1:
                fatigue_trend = "increasing"
            elif recent_fatigue < early_fatigue - 1:
                fatigue_trend = "decreasing"
        
        return {
            "time_window": f"{month_name} {year}",
            "avg_sleep_hours": round(statistics.mean(sleep_hours), 1),
            "sleep_range": [round(min(sleep_hours), 1), round(max(sleep_hours), 1)],
            "avg_sleep_quality": round(statistics.mean(sleep_quality), 1),
            "sleep_trend": sleep_trend,
            "avg_fatigue": round(statistics.mean(fatigue), 1),
            "fatigue_trend": fatigue_trend,
            "avg_energy": round(statistics.mean(energy), 1),
            "avg_body_aches": round(statistics.mean(body_aches), 1)
        }
    
    def build_lifestyle_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build lifestyle metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        month_name = calendar.month_name[month]
        stress = self._filter_by_date_range(self.collections['stress'], start_date, end_date)
        activities = self._filter_by_date_range(self.collections['physical_activities'], start_date, end_date)
        
        stress_levels = [s['level'] for s in stress] if stress else [5]
        steps = [a['steps'] for a in activities] if activities else [0]
        
        # Count high stress days (stress >= 7)
        high_stress_days = sum(1 for s in stress_levels if s >= 7)
        
        return {
            "time_window": f"{month_name} {year}",
            "avg_stress": round(statistics.mean(stress_levels), 1),
            "high_stress_days": high_stress_days,
            "avg_steps": round(statistics.mean(steps)),
            "active_days": sum(1 for s in steps if s > 5000)
        }
    
    def build_complete_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build complete summary for AI analysis for a specific month."""
        month_name = calendar.month_name[month]
        return {
            "user_id": self.user_id,
            "analysis_period": f"{month_name} {year}",
            "training": self.build_training_summary(year, month),
            "nutrition": self.build_nutrition_summary(year, month),
            "recovery": self.build_recovery_summary(year, month),
            "lifestyle": self.build_lifestyle_summary(year, month)
        }


class FitnessAICoach:
    """AI-powered fitness coach using OpenAI API."""
    
    def __init__(self, api_key: str, model: str = "gpt-4o"):
        """Initialize OpenAI client."""
        self.client = OpenAI(api_key=api_key)
        self.model = model
        
        # User profile (in production, this would be stored in DB)
        self.user_profile = {
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
        prompt = f"""You are an expert fitness coach providing a personalized monthly review.

USER PROFILE:
{json.dumps(self.user_profile, indent=2)}
"""
        
        # Add previous months' analyses as context if provided
        if previous_analyses and len(previous_analyses) > 0:
            if len(previous_analyses) == 1:
                prompt += f"""
PREVIOUS MONTH'S ANALYSIS (for context and comparison):
{previous_analyses[0]}

"""
            else:
                prompt += f"""
PREVIOUS MONTHS' ANALYSES (in chronological order, for context and trend analysis):
"""
                for i, analysis in enumerate(previous_analyses, 1):
                    prompt += f"""
--- Month {i} ---
{analysis}

"""
        
        prompt += f"""CURRENT MONTH DATA:
{json.dumps(summary, indent=2)}

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
        
        return prompt
    
    def generate_general_analysis(self, summary: Dict[str, Any], previous_analyses: Optional[List[str]] = None) -> Dict[str, str]:
        """Generate comprehensive General Analysis report with optional previous months' context.
        
        Args:
            summary: Current month's data summary
            previous_analyses: List of previous months' analyses (in chronological order)
        """
        prompt = self._build_general_analysis_prompt(summary, previous_analyses)
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert fitness coach providing personalized, data-driven insights. You are direct, supportive, and focused on long-term sustainable progress."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
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
        return f"""USER PROFILE:
{json.dumps(self.user_profile, indent=2)}

RECENT DATA (14-day summary):
Training: {summary['training']['sessions_per_week']} sessions/week, {summary['training']['progression']} progression
Nutrition: ~{summary['nutrition']['avg_calories']} cal, ~{summary['nutrition']['avg_protein']}g protein
Recovery: {summary['recovery']['avg_sleep_hours']}h sleep (trend: {summary['recovery']['sleep_trend']}), fatigue {summary['recovery']['avg_fatigue']}/10
Lifestyle: Stress {summary['lifestyle']['avg_stress']}/10, {summary['lifestyle']['high_stress_days']} high-stress days
"""
    
    def chat(self, user_message: str, summary: Dict[str, Any], conversation_history: List[Dict] = None) -> Dict[str, Any]:
        """Handle chatbot interactions with context awareness."""
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


def main():
    """Main execution function - processes December with all previous months as context."""
    
    # Configuration
    script_dir = os.path.dirname(os.path.abspath(__file__))
    DATA_PATH = os.path.join(script_dir, "fitness_data_180_days.json")
    OUTPUT_FILE = os.path.join(script_dir, "fitness_analysis_output.json")
    
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    
    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY environment variable not set!")
        print("Set it in your .env file or export it as an environment variable")
        return
    
    print("=" * 80)
    print("FITNESS AI ANALYZER - December Analysis with Full Context")
    print("=" * 80)
    
    # Load fitness data
    print("\n[1/4] Loading fitness data...")
    analyzer = FitnessDataAnalyzer(DATA_PATH)
    print(f"✓ Loaded data for user: {analyzer.user_id}")
    
    # Load all previous months' analyses for context (July through November)
    previous_analyses = []
    year = 2024
    context_months = [7, 8, 9, 10, 11]  # July through November
    context_month_names = [calendar.month_name[m] for m in context_months]
    
    print(f"\n[2/4] Loading context from previous months ({', '.join(context_month_names)})...")
    
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, 'r') as f:
                existing_data = json.load(f)
                
                # Try new format first (monthly_results)
                if 'monthly_results' in existing_data:
                    monthly_results = existing_data['monthly_results']
                    for month_num in context_months:
                        month_name = calendar.month_name[month_num]
                        if month_name in monthly_results and 'analysis' in monthly_results[month_name]:
                            previous_analyses.append(monthly_results[month_name]['analysis'])
                            print(f"  ✓ Loaded {month_name} analysis")
                        else:
                            print(f"  ⚠ {month_name} analysis not found")
                
                # Try old format (single general_analysis) - only use if it's for a context month
                elif 'general_analysis' in existing_data and existing_data['general_analysis'].get('status') == 'success':
                    analysis = existing_data['general_analysis'].get('analysis', '')
                    if analysis:
                        previous_analyses.append(analysis)
                        print(f"  ✓ Loaded previous analysis (old format)")
        except Exception as e:
            print(f"  ⚠ Could not load previous analyses: {e}")
    
    if not previous_analyses:
        print("  ⚠ No previous analyses found - December will be analyzed without context")
    else:
        print(f"  ✓ Loaded {len(previous_analyses)} previous month(s) as context")
    
    # Initialize AI Coach
    print("\n[3/4] Initializing AI Coach...")
    coach = FitnessAICoach(api_key=OPENAI_API_KEY)
    
    # Process only December (month 12)
    target_month = 12
    month_name = calendar.month_name[target_month]
    
    print(f"\n[4/4] Processing {month_name} {year}...")
    print("=" * 80)
    
    print(f"\n{'='*80}")
    print(f"PROCESSING: {month_name} {year}")
    print(f"{'='*80}")
    
    # Build summary for December (reads only December data)
    print(f"\n📊 Building summary for {month_name} {year}...")
    summary = analyzer.build_complete_summary(year=year, month=target_month)
    
    print(f"  - Training: {summary['training']['total_sessions']} sessions")
    print(f"  - Nutrition: {summary['nutrition'].get('days_logged', 0)} days logged")
    if 'error' not in summary.get('recovery', {}):
        print(f"  - Sleep: {summary['recovery']['avg_sleep_hours']}h average")
        print(f"  - Stress: {summary['lifestyle']['avg_stress']}/10 average")
    
    # Generate analysis with all previous months as context
    print(f"\n🤖 Generating AI analysis for {month_name} {year}...")
    if previous_analyses:
        print(f"  (Using {len(previous_analyses)} previous month(s) as context: {', '.join(context_month_names[:len(previous_analyses)])})")
    else:
        print(f"  (No previous context available)")
    
    analysis_result = coach.generate_general_analysis(summary, previous_analyses if previous_analyses else None)
    
    # Load existing results to preserve previous months
    all_results = {}
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, 'r') as f:
                existing_data = json.load(f)
                if 'monthly_results' in existing_data:
                    all_results = existing_data['monthly_results'].copy()
        except:
            pass
    
    if analysis_result['status'] == 'success':
        print(f"  ✓ Analysis complete (Tokens: {analysis_result['tokens_used']})")
        
        # Store December results
        all_results[month_name] = {
            "month": target_month,
            "year": year,
            "summary": summary,
            "analysis": analysis_result['analysis'],
            "tokens_used": analysis_result['tokens_used']
        }
    else:
        print(f"  ✗ Error: {analysis_result.get('error', 'Unknown error')}")
        all_results[month_name] = {
            "month": target_month,
            "year": year,
            "summary": summary,
            "error": analysis_result.get('error', 'Unknown error')
        }
    
    print(f"\n[5/5] Saving results...")
    print("=" * 80)
    
    # Save all results (preserving previous months + adding/updating December)
    output_data = {
        "user_id": analyzer.user_id,
        "analysis_timestamp": datetime.now().isoformat(),
        "months_analyzed": list(all_results.keys()),
        "monthly_results": all_results
    }
    
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output_data, f, indent=2)
    
    print(f"\n✓ Results saved to: {OUTPUT_FILE}")
    print(f"\n{'='*80}")
    print("ANALYSIS COMPLETE")
    print(f"{'='*80}")
    if analysis_result['status'] == 'success':
        print(f"\n✓ {month_name} {year} analyzed successfully")
        print(f"  Tokens used: {analysis_result['tokens_used']}")
        if previous_analyses:
            print(f"  Context: {len(previous_analyses)} previous month(s)")
    else:
        print(f"\n✗ {month_name} {year} analysis failed")


if __name__ == "__main__":
    main()