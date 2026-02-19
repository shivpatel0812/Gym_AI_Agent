"""
GPT fallback for nutrition estimation when USDA API fails
"""
import os
import json
from typing import List, Dict, Optional
from openai import OpenAI

def get_openai_client() -> Optional[OpenAI]:
    """Get OpenAI client if API key is available"""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    return OpenAI(api_key=api_key)

def gpt_estimate(food_list: List[str]) -> Optional[Dict]:
    """
    Use GPT to estimate macros for foods not found in USDA database
    
    Args:
        food_list: List of food names to estimate
    
    Returns:
        Dict mapping food names to their estimated macros, or None if error
    """
    client = get_openai_client()
    if not client:
        print("Warning: OPENAI_API_KEY not set. Skipping GPT fallback.")
        return None
    
    try:
        prompt = f"""Estimate nutrition macros for these foods with standard portions (100g or typical serving size):
{', '.join(food_list)}

Return a JSON object where each food name maps to an object with:
- calories (number)
- protein (number in grams)
- carbs (number in grams)
- fat (number in grams)

Format: {{"food_name": {{"calories": X, "protein": Y, "carbs": Z, "fat": W}}, ...}}

Only return valid JSON, no other text."""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1000,  # Increased to handle multiple foods
            temperature=0.3
        )
        
        content = response.choices[0].message.content.strip()
        
        # Try to parse JSON (might be wrapped in code blocks)
        if content.startswith("```"):
            # Remove markdown code blocks
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        
        result = json.loads(content)
        return result
    except json.JSONDecodeError as e:
        print(f"Error parsing GPT response as JSON: {e}")
        print(f"Response was: {content}")
        # Try to extract partial JSON if response was truncated
        try:
            # Find the last complete food entry
            last_brace = content.rfind('}')
            if last_brace > 0:
                # Try to close the JSON object
                partial_json = content[:last_brace + 1]
                # Add closing brace if needed
                if not partial_json.strip().endswith('}'):
                    partial_json += '}'
                result = json.loads(partial_json)
                print(f"Successfully parsed partial JSON with {len(result)} items")
                return result
        except:
            pass
        return None
    except Exception as e:
        print(f"Error calling GPT API: {e}")
        return None

