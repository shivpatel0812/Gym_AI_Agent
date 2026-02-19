"""
Test Script - Demonstrates data processing without API calls
Shows what summaries are generated for the AI to analyze
"""

import json
import os
import calendar
from datetime import datetime

# Import just the analyzer (no OpenAI needed)
from fitnessai_analyzer import FitnessDataAnalyzer

def print_section(title):
    """Print a formatted section header."""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)

def main():
    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    DATA_PATH = os.path.join(script_dir, "fitness_data_180_days.json")
    
    print_section("FITNESS DATA ANALYZER - DATA PROCESSING TEST")
    
    # Load data
    print("\n📊 Loading fitness data...")
    analyzer = FitnessDataAnalyzer(DATA_PATH)
    print(f"✓ Loaded data for user: {analyzer.user_id}")
    
    # Build summaries for different months
    # Analyze July, August, and September 2024 (months with data)
    months_to_analyze = [
        (2024, 7),   # July 2024
        (2024, 8),   # August 2024
        (2024, 9),   # September 2024
    ]
    
    for year, month in months_to_analyze:
        month_name = calendar.month_name[month]
        print_section(f"SUMMARY: {month_name} {year}")
        
        summary = analyzer.build_complete_summary(year=year, month=month)
        
        # Training Summary
        training = summary['training']
        print(f"\n🏋️  TRAINING")
        print(f"   Period: {training['start_date']} to {training['end_date']}")
        print(f"   Total Sessions: {training['total_sessions']}")
        print(f"   Sessions/Week: {training['sessions_per_week']}")
        print(f"   Total Sets: {training['total_sets']}")
        print(f"   Total Reps: {training['total_reps']}")
        print(f"   Avg Sets/Session: {training['avg_sets_per_session']}")
        print(f"   Progression: {training['progression']}")
        print(f"   Missed Sessions: {training['missed_sessions']}")
        print(f"   Split Distribution:")
        for split, count in training['split_distribution'].items():
            print(f"      - {split}: {count} sessions")
        
        # Nutrition Summary
        nutrition = summary['nutrition']
        print(f"\n🍽️  NUTRITION")
        print(f"   Days Logged: {nutrition['days_logged']}")
        print(f"   Avg Calories: {nutrition['avg_calories']} kcal")
        print(f"   Calorie Range: {nutrition['calories_range'][0]} - {nutrition['calories_range'][1]} kcal")
        print(f"   Avg Protein: {nutrition['avg_protein']}g")
        print(f"   Avg Carbs: {nutrition['avg_carbs']}g")
        print(f"   Avg Fats: {nutrition['avg_fats']}g")
        print(f"   Consistency: {nutrition['consistency']}")
        print(f"   Protein Ratio: {nutrition['protein_ratio']}% of calories")
        
        # Recovery Summary
        recovery = summary['recovery']
        print(f"\n😴 RECOVERY")
        print(f"   Avg Sleep: {recovery['avg_sleep_hours']} hours")
        print(f"   Sleep Range: {recovery['sleep_range'][0]} - {recovery['sleep_range'][1]} hours")
        print(f"   Avg Sleep Quality: {recovery['avg_sleep_quality']}/10")
        print(f"   Sleep Trend: {recovery['sleep_trend']}")
        print(f"   Avg Fatigue: {recovery['avg_fatigue']}/10")
        print(f"   Fatigue Trend: {recovery['fatigue_trend']}")
        print(f"   Avg Energy: {recovery['avg_energy']}/10")
        print(f"   Avg Body Aches: {recovery['avg_body_aches']}/10")
        
        # Lifestyle Summary
        lifestyle = summary['lifestyle']
        print(f"\n🧘 LIFESTYLE")
        print(f"   Avg Stress: {lifestyle['avg_stress']}/10")
        print(f"   High Stress Days: {lifestyle['high_stress_days']}")
        print(f"   Avg Steps: {lifestyle['avg_steps']:,}")
        print(f"   Active Days (>5k steps): {lifestyle['active_days']}")
        
        print("\n" + "-" * 70)
    
    # Show compound lift progression for July 2024
    print_section("COMPOUND LIFT TRACKING (July 2024)")
    
    summary_july = analyzer.build_complete_summary(year=2024, month=7)
    compound_lifts = summary_july['training']['compound_lifts']
    
    if compound_lifts:
        for lift_name, history in compound_lifts.items():
            print(f"\n📈 {lift_name}")
            print(f"   Sessions tracked: {len(history)}")
            weights = [h['max_weight'] for h in history]
            print(f"   Max weight range: {min(weights)} - {max(weights)} lbs")
            print(f"   Recent sessions:")
            for session in history[-3:]:  # Last 3 sessions
                print(f"      {session['date']}: {session['max_weight']} lbs x {session['total_reps']} reps")
    else:
        print("   No compound lifts tracked in this period")
    
    # Show what gets sent to AI
    print_section("WHAT GETS SENT TO AI (Condensed Format - July 2024)")
    
    condensed = {
        "training": {
            "sessions_per_week": summary_july['training']['sessions_per_week'],
            "progression": summary_july['training']['progression'],
            "missed_sessions": summary_july['training']['missed_sessions']
        },
        "nutrition": {
            "avg_calories": summary_july['nutrition']['avg_calories'],
            "avg_protein": summary_july['nutrition']['avg_protein'],
            "consistency": summary_july['nutrition']['consistency']
        },
        "recovery": {
            "avg_sleep": summary_july['recovery']['avg_sleep_hours'],
            "sleep_trend": summary_july['recovery']['sleep_trend'],
            "fatigue": summary_july['recovery']['avg_fatigue'],
            "fatigue_trend": summary_july['recovery']['fatigue_trend']
        },
        "lifestyle": {
            "avg_stress": summary_july['lifestyle']['avg_stress'],
            "high_stress_days": summary_july['lifestyle']['high_stress_days']
        }
    }
    
    print("\n" + json.dumps(condensed, indent=2))
    
    print_section("KEY INSIGHTS FROM DATA (July 2024)")
    
    # Generate some deterministic insights
    insights = []
    
    # Training insights
    if summary_july['training']['sessions_per_week'] < 3:
        insights.append("⚠️  Training frequency is below target (3+ sessions/week recommended)")
    elif summary_july['training']['sessions_per_week'] >= 4:
        insights.append("✓ Training frequency is solid")
    
    if summary_july['training']['missed_sessions'] > 2:
        insights.append("⚠️  Multiple missed sessions - consistency could be improved")
    
    # Nutrition insights
    if summary_july['nutrition']['avg_protein'] < 140:
        insights.append("⚠️  Protein intake may be suboptimal for muscle building")
    elif summary_july['nutrition']['avg_protein'] >= 150:
        insights.append("✓ Protein intake is adequate for goals")
    
    # Recovery insights
    if summary_july['recovery']['avg_sleep_hours'] < 7:
        insights.append("⚠️  Sleep is below recommended 7-9 hours")
    
    if summary_july['recovery']['sleep_trend'] == 'declining':
        insights.append("⚠️  Sleep trend is declining - this will impact recovery")
    
    if summary_july['recovery']['fatigue_trend'] == 'increasing':
        insights.append("⚠️  Fatigue is rising - may indicate accumulating stress")
    
    # Lifestyle insights
    if summary_july['lifestyle']['avg_stress'] >= 7:
        insights.append("⚠️  High average stress - this affects both training and recovery")
    
    if summary_july['lifestyle']['high_stress_days'] > 10:  # Adjusted for monthly data
        insights.append("⚠️  Many high-stress days this month")
    
    for insight in insights:
        print(f"  {insight}")
    
    if not insights:
        print("  ✓ All metrics look solid!")
    
    print("\n" + "=" * 70)
    print("✓ Data processing complete!")
    print("=" * 70)
    
    # Save the July summary for reference
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, "processed_summary_july_2024.json")
    with open(output_path, 'w') as f:
        json.dump(summary_july, f, indent=2)
    
    print(f"\n💾 Saved July 2024 summary to: {output_path}")
    print("\nThis summary would be sent to OpenAI API for AI-powered analysis.")

if __name__ == "__main__":
    main()