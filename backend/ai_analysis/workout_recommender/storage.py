"""
Storage utilities for workout recommender.
Handles Firestore data sanitization and storage operations.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, Optional


class StorageManager:
    """Handles storage operations for workout summaries."""
    
    def __init__(self, db, user_id: str, summary_refresh_days: int = 7):
        self.db = db
        self.user_id = user_id
        self.SUMMARY_REFRESH_DAYS = summary_refresh_days
    
    def sanitize_for_firestore(self, data: Any) -> Any:
        """
        Recursively sanitize data for Firestore storage.
        - Converts all keys to strings (Firestore requirement)
        - Removes None values from dicts
        - Skips empty string keys (Firestore requirement)
        - Handles nested structures
        """
        if isinstance(data, dict):
            sanitized = {}
            for key, value in data.items():
                # Skip None keys entirely
                if key is None:
                    continue
                # Convert all keys to strings (Firestore requires string keys)
                safe_key = str(key)
                # Skip empty string keys (Firestore doesn't allow them)
                if not safe_key:
                    continue
                # Skip None values, but keep other falsy values like 0, "", []
                if value is not None:
                    sanitized[safe_key] = self.sanitize_for_firestore(value)
            return sanitized
        elif isinstance(data, list):
            return [self.sanitize_for_firestore(item) for item in data if item is not None]
        else:
            return data
    
    def store_summary(self, summary: Dict):
        """Store the workout AI summary in Firestore."""
        summary_ref = self.db.collection("users").document(self.user_id).collection("workout_ai_summary").document("current")
        summary["last_updated"] = datetime.now().isoformat()
        summary["next_refresh"] = (datetime.now() + timedelta(days=self.SUMMARY_REFRESH_DAYS)).isoformat()
        # Sanitize data before storing
        sanitized_summary = self.sanitize_for_firestore(summary)
        summary_ref.set(sanitized_summary)
    
    def needs_summary_refresh(self, stored_summary: Optional[Dict]) -> bool:
        """Check if the summary needs to be refreshed."""
        if not stored_summary:
            return True
        
        next_refresh = stored_summary.get("next_refresh")
        if not next_refresh:
            return True
        
        try:
            refresh_date = datetime.fromisoformat(next_refresh)
            return datetime.now() >= refresh_date
        except:
            return True


