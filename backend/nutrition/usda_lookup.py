"""
USDA Nutrition API lookup module
"""
import requests
import os
from typing import Optional, Dict

USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1"

def get_usda_api_key() -> Optional[str]:
    """Get USDA API key from environment"""
    return os.getenv("USDA_API_KEY")

def get_macros(food_name: str) -> Optional[Dict]:
    """
    Get nutrition macros for a food item from USDA API
    
    Args:
        food_name: Name of the food item
    
    Returns:
        Dict with macros (calories, protein, carbs, fat) or None if not found
    """
    api_key = get_usda_api_key()
    if not api_key:
        print("Warning: USDA_API_KEY not set. Skipping USDA lookup.")
        return None
    
    try:
        url = f"{USDA_API_BASE}/foods/search"
        params = {
            "query": food_name,
            "pageSize": 1,
            "api_key": api_key
        }
        
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        data = response.json()
        
        if not data.get("foods") or len(data["foods"]) == 0:
            return None
        
        # Get the first result
        food = data["foods"][0]
        nutrients = food.get("foodNutrients", [])
        
        macros = {
            "calories": 0,
            "protein": 0,
            "carbs": 0,
            "fat": 0
        }
        
        # Map nutrient names to our macro keys
        nutrient_map = {
            "Energy": "calories",
            "Protein": "protein",
            "Carbohydrate, by difference": "carbs",
            "Total lipid (fat)": "fat"
        }
        
        for nutrient in nutrients:
            nutrient_name = nutrient.get("nutrientName", "")
            nutrient_value = nutrient.get("value", 0)
            
            # Check for matches in our map
            for key, value in nutrient_map.items():
                if key.lower() in nutrient_name.lower():
                    macros[value] = float(nutrient_value) if nutrient_value else 0
                    break
        
        # Return None if no macros found
        if all(v == 0 for v in macros.values()):
            return None
        
        return macros
    except requests.exceptions.RequestException as e:
        print(f"Error fetching from USDA API: {e}")
        return None
    except Exception as e:
        print(f"Error parsing USDA response: {e}")
        return None


