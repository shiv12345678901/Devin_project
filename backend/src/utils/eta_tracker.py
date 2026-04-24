import json
import os
from typing import TypedDict, Dict, Any, cast

class ModelSpeed(TypedDict):
    chars_per_second: float
    samples: int

class ScreenshotSpeed(TypedDict):
    seconds_per_screenshot: float
    samples: int

class VerificationSpeed(TypedDict):
    average_seconds: float
    samples: int

class ETAData(TypedDict):
    models: Dict[str, ModelSpeed]
    screenshots: ScreenshotSpeed
    verification: VerificationSpeed

class ETATracker:
    """Tracks and predicts completion times based on historical runs."""
    
    def __init__(self, storage_path: str = "config/estimated_times.json") -> None:
        self.storage_path = storage_path
        self.data: ETAData = self._load_data()
        
    def _load_data(self) -> ETAData:
        """Load historical timing data from disk, or initialize defaults."""
        if os.path.exists(self.storage_path):
            try:
                with open(self.storage_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # Migrating old data if necessary
                    if "verification" not in data:
                        data["verification"] = {"average_seconds": 15.0, "samples": 0}
                    return cast(ETAData, data)
            except Exception as e:
                print(f"⚠️ Error loading ETA data: {e}")
                
        # Defaults if no file exists
        return cast(ETAData, {
            "models": {
                "default": {"chars_per_second": 500.0, "samples": 0},
                "fast": {"chars_per_second": 1500.0, "samples": 0},
                "kimi": {"chars_per_second": 300.0, "samples": 0},
                "deepseek": {"chars_per_second": 400.0, "samples": 0},
                "devstral": {"chars_per_second": 1000.0, "samples": 0}
            },
            "screenshots": {"seconds_per_screenshot": 1.5, "samples": 0},
            "verification": {"average_seconds": 15.0, "samples": 0}
        })
        
    def _save_data(self):
        """Save the current timing data to disk."""
        try:
            os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
            with open(self.storage_path, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, indent=4)
        except Exception as e:
            print(f"⚠️ Error saving ETA data: {e}")
            
    def record_verification(self, seconds: float):
        """Record the time taken for a verification pass."""
        if seconds <= 0:
            return
            
        ALPHA = 0.2 # Slower moving average for verification
        ver_data = self.data["verification"]
        
        if ver_data["samples"] == 0:
            ver_data["average_seconds"] = seconds
        else:
            ver_data["average_seconds"] = (ALPHA * seconds) + ((1 - ALPHA) * ver_data["average_seconds"])
            
        ver_data["samples"] += 1
        self._save_data()

    def record_completion(self, model_choice, input_chars, ai_seconds, screenshot_count, screenshot_seconds, use_cache=False):
        """
        Record a successful run to improve future predictions.
        (Skips AI timing if cache was hit)
        """
        updated = False
        ALPHA = 0.3  # Moving average weight (30% new data, 70% historical)
        
        # 1. Update AI Speed (if not cached and time > 0)
        if not use_cache and ai_seconds > 0 and input_chars > 0:
            if "models" not in self.data:
                self.data["models"] = {}
                
            if model_choice not in self.data["models"]:
                self.data["models"][model_choice] = cast(ModelSpeed, {"chars_per_second": 500.0, "samples": 0})
                
            model_data = self.data["models"][model_choice]
            current_cps = input_chars / ai_seconds
            
            if model_data["samples"] == 0:
                model_data["chars_per_second"] = current_cps
            else:
                model_data["chars_per_second"] = (ALPHA * current_cps) + ((1 - ALPHA) * model_data["chars_per_second"])
                
            model_data["samples"] += 1
            updated = True
            
        # 2. Update Screenshot Speed (if screenshots taken)
        if screenshot_count > 0 and screenshot_seconds > 0:
            screens_data = self.data["screenshots"]
            current_sps = screenshot_seconds / screenshot_count
            
            if screens_data["samples"] == 0:
                screens_data["seconds_per_screenshot"] = current_sps
            else:
                screens_data["seconds_per_screenshot"] = (ALPHA * current_sps) + ((1 - ALPHA) * screens_data["seconds_per_screenshot"])
                
            screens_data["samples"] += 1
            updated = True
            
        if updated:
            self._save_data()
            
    def predict_total_time(self, model_choice, input_chars, estimated_screenshots=10, use_cache=False, enable_verification=True):
        """
        Predict total seconds required for generation.
        """
        total_seconds = 0.0
        
        # 1. AI Generation Time
        if not use_cache and input_chars > 0:
            model_data = self.data["models"].get(model_choice, self.data["models"].get("default"))
            if model_data and model_data["chars_per_second"] > 0:
                ai_seconds = input_chars / model_data["chars_per_second"]
                total_seconds += ai_seconds
                
        # 2. Verification Time (if enabled)
        if enable_verification:
            ver_data = self.data["verification"]
            # Assume 1 pass on average (the system does up to 3, but 1 is most common)
            total_seconds += ver_data["average_seconds"]
                
        # 3. Add fixed overhead (network/process spin up)
        total_seconds += 3.0 
        
        # 4. Screenshot Rendering Time
        if estimated_screenshots > 0:
            screens_data = self.data["screenshots"]
            screen_seconds = estimated_screenshots * screens_data["seconds_per_screenshot"]
            total_seconds += screen_seconds
            
        return max(5.0, round(total_seconds))
            
eta_tracker = ETATracker()
