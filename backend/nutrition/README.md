# Nutrition Analysis Module

This module provides food detection and nutrition analysis functionality using a multi-stage pipeline:

1. **YOLO Detection** - Detects food items in images using YOLOv8 (CPU-safe)
2. **USDA Lookup** - Retrieves nutrition data from USDA FoodData Central API
3. **GPT Fallback** - Estimates macros using GPT-4o-mini when USDA lookup fails

## Structure

```
nutrition/
├── __init__.py          # Module exports
├── yolo_detect.py       # YOLO food detection
├── usda_lookup.py       # USDA API nutrition lookup
├── gpt_fallback.py      # GPT-based macro estimation
├── analyzer.py          # Main analyzer combining all components
└── README.md            # This file
```

## Usage

### Basic Usage

```python
from nutrition import analyze_food_image

# Analyze an image
result = analyze_food_image("/path/to/image.jpg")

# Result contains:
# {
#     "foods": ["apple", "banana"],
#     "food_items": [
#         {
#             "name": "apple",
#             "calories": 52,
#             "protein": 0.3,
#             "carbs": 14,
#             "fats": 0.2
#         }
#     ],
#     "message": "Detected 2 food item(s)"
# }
```

### Individual Components

```python
from nutrition import detect_food, get_usda_macros, gpt_estimate

# Detect foods in image
foods = detect_food("/path/to/image.jpg")

# Look up macros from USDA
macros = get_usda_macros("apple")

# Estimate macros with GPT
estimates = gpt_estimate(["custom_food_item"])
```

## Environment Variables

- `USDA_API_KEY` (optional): USDA FoodData Central API key
  - Get one at: https://fdc.nal.usda.gov/api-guide.html
  - If not set, USDA lookup will be skipped

- `OPENAI_API_KEY` (optional): OpenAI API key for GPT fallback
  - If not set, GPT fallback will be skipped

## Cost Profile

- **YOLO CPU inference**: ~$0 (runs locally)
- **USDA API**: Free
- **GPT fallback**: ~$0.0001 per call (only triggered 10-20% of the time)
- **Total**: ~$1-5/month for 1k+ meals

## Notes

- YOLOv8 uses the COCO dataset which has limited food classes
- The system is designed to be permissive - detected objects are passed to USDA/GPT for filtering
- GPT fallback only triggers when USDA lookup fails
- All components gracefully handle missing API keys


