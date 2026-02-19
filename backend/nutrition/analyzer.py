"""
Main analyzer that combines YOLO detection, USDA lookup, and GPT fallback
"""
from typing import List, Dict, Optional
from .yolo_detect import detect_food
from .usda_lookup import get_macros as get_usda_macros
from .gpt_fallback import gpt_estimate


def analyze_food_image(image_path: str) -> Dict:
    """
    Complete food analysis pipeline:
    1. Detect foods using YOLO
    2. Look up macros from USDA API
    3. Use GPT fallback for missing foods
    
    Args:
        image_path: Path to the image file
    
    Returns:
        Dict with:
            - foods: List of detected food names
            - food_items: List of food items with macro information
            - message: Status message
    """
    # Step 1: Detect foods using YOLO
    detected_foods = detect_food(image_path)
    
    if not detected_foods:
        return {
            "foods": [],
            "food_items": [],
            "message": "No food items detected in the image. Try a clearer image with visible food."
        }
    
    # Step 2: Look up macros from USDA API
    food_items: List[Dict] = []
    missing_foods: List[str] = []
    
    for food in detected_foods:
        macros = get_usda_macros(food)
        if macros:
            food_items.append({
                "name": food,
                "calories": macros.get("calories", 0),
                "protein": macros.get("protein", 0),
                "carbs": macros.get("carbs", 0),
                "fats": macros.get("fat", 0)
            })
        else:
            missing_foods.append(food)
    
    # Step 3: GPT fallback for missing foods
    if missing_foods:
        gpt_results = gpt_estimate(missing_foods)
        if gpt_results:
            for food_name, macros in gpt_results.items():
                if isinstance(macros, dict):
                    food_items.append({
                        "name": food_name,
                        "calories": macros.get("calories", 0),
                        "protein": macros.get("protein", 0),
                        "carbs": macros.get("carbs", 0),
                        "fats": macros.get("fat", 0)
                    })
                else:
                    # If GPT returned a single value, create a basic entry
                    food_items.append({
                        "name": food_name,
                        "calories": 0,
                        "protein": 0,
                        "carbs": 0,
                        "fats": 0
                    })
    
    return {
        "foods": detected_foods,
        "food_items": food_items,
        "message": f"Detected {len(detected_foods)} food item(s)"
    }


