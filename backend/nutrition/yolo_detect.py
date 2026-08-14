"""
YOLO food detection module - CPU-safe, production-ready
"""
from PIL import Image

# Initialize model once (lazy loading)
_model = None

def get_model():
    """Lazy load YOLO model to avoid loading torch on API startup."""
    global _model
    if _model is None:
        from ultralytics import YOLO
        _model = YOLO("yolov8n.pt")  # nano = fastest + cheapest
    return _model

# Common food-related COCO classes (YOLOv8 uses COCO dataset)
FOOD_CLASSES = {
    'apple', 'banana', 'sandwich', 'orange', 'broccoli', 'carrot', 
    'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant',
    'dining table', 'bowl', 'cup', 'bottle', 'fork', 'knife', 'spoon'
}

def detect_food(image_path: str, conf_threshold: float = 0.4):
    """
    Detect food items in an image using YOLOv8
    
    Args:
        image_path: Path to the image file
        conf_threshold: Confidence threshold for detection (default: 0.4)
    
    Returns:
        List of detected food item names
    """
    try:
        model = get_model()
        img = Image.open(image_path)
        
        # Run inference
        results = model(img, imgsz=640, conf=conf_threshold, verbose=False)
        
        foods = []
        # Known food-related COCO classes (YOLOv8 uses COCO dataset)
        food_keywords = {
            'apple', 'banana', 'sandwich', 'orange', 'broccoli', 'carrot',
            'hot dog', 'pizza', 'donut', 'cake', 'bowl', 'cup', 'bottle'
        }
        
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                label = model.names[cls_id].lower()
                confidence = float(box.conf[0])
                
                # Accept if confidence is high enough
                # Note: YOLO COCO has limited food classes, so we'll be permissive
                # and let USDA/GPT handle filtering and nutrition lookup
                if confidence >= conf_threshold:
                    # Check if it's a known food item or food-related object
                    if any(keyword in label for keyword in food_keywords) or label in food_keywords:
                        foods.append(model.names[cls_id])  # Use original case
                    # Also accept common objects that might contain food (bowl, plate, etc.)
                    elif label in ['bowl', 'cup', 'bottle']:
                        # These are containers, might contain food - let USDA/GPT decide
                        foods.append(model.names[cls_id])
        
        # Return unique food items
        return list(set(foods))
    except Exception as e:
        print(f"Error in YOLO detection: {e}")
        return []


