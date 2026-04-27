import json
import os
import threading
from typing import TypedDict, Dict, List, Optional, cast

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

class ProcessEstimateSample(TypedDict):
    input_chars: int
    seconds: float

class ProcessEstimateModel(TypedDict):
    seconds_per_char: float
    samples: int
    runs: List[ProcessEstimateSample]

class ProcessEstimateData(TypedDict):
    min_samples: int
    models: Dict[str, ProcessEstimateModel]

class ETATracker:
    """Tracks and predicts completion times based on historical runs."""
    
    def __init__(
        self,
        storage_path: str = "config/estimated_times.json",
        process_storage_path: str = "config/process_time_estimates.json",
    ) -> None:
        self.storage_path = storage_path
        self.process_storage_path = process_storage_path
        self._lock = threading.Lock()
        self.data: ETAData = self._load_data()
        self.process_data: ProcessEstimateData = self._load_process_data()
        
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

    def _load_process_data(self) -> ProcessEstimateData:
        """Load successful process timing data used for user-facing ETAs."""
        if os.path.exists(self.process_storage_path):
            try:
                with open(self.process_storage_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                data.setdefault("min_samples", 10)
                data.setdefault("models", {})
                return cast(ProcessEstimateData, data)
            except Exception as e:
                print(f"Warning: Error loading process ETA data: {e}")

        return cast(ProcessEstimateData, {"min_samples": 10, "models": {}})
        
    def _save_data(self):
        """Save the current timing data to disk."""
        try:
            os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
            with open(self.storage_path, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, indent=4)
        except Exception as e:
            print(f"⚠️ Error saving ETA data: {e}")
            
    def _save_process_data(self):
        """Save process ETA samples to disk."""
        try:
            os.makedirs(os.path.dirname(self.process_storage_path), exist_ok=True)
            with open(self.process_storage_path, 'w', encoding='utf-8') as f:
                json.dump(self.process_data, f, indent=4)
        except Exception as e:
            print(f"Warning: Error saving process ETA data: {e}")

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

        AI timing is only recorded when a real AI call happened — filtered by
        ``ai_seconds`` rather than the user's ``use_cache`` preference, so cache
        misses (where the AI actually ran) still feed the ETA model even when
        caching is enabled globally.
        """
        del use_cache  # Preserved for API compatibility; filter by duration below.
        updated = False
        ALPHA = 0.3  # Moving average weight (30% new data, 70% historical)

        # 1. Update AI Speed — filter cache hits by duration (<0.5s is a hit).
        if ai_seconds > 0.5 and input_chars > 0:
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

    def record_process_completion(self, model_choice: str, input_chars: int, total_seconds: float) -> None:
        """Record a successful end-to-end process sample.

        User-facing estimates intentionally use only the selected model and
        input character count. Predictions stay hidden until a model has at
        least ``min_samples`` successful process runs.
        """
        if input_chars <= 0 or total_seconds <= 0:
            return

        model = str(model_choice or "default")
        sample: ProcessEstimateSample = {
            "input_chars": int(input_chars),
            "seconds": round(float(total_seconds), 3),
        }

        with self._lock:
            models = self.process_data.setdefault("models", {})
            if model not in models:
                models[model] = cast(ProcessEstimateModel, {
                    "seconds_per_char": 0.0,
                    "samples": 0,
                    "runs": [],
                })

            model_data = models[model]
            runs = model_data.setdefault("runs", [])
            runs.append(sample)
            del runs[:-100]

            total_chars = sum(max(0, int(r.get("input_chars", 0))) for r in runs)
            total_time = sum(max(0.0, float(r.get("seconds", 0))) for r in runs)
            model_data["samples"] = len(runs)
            model_data["seconds_per_char"] = total_time / total_chars if total_chars > 0 else 0.0
            self._save_process_data()

    def predict_process_time(self, model_choice: str, input_chars: int) -> Optional[int]:
        """Predict process seconds once the selected model has enough samples."""
        if input_chars <= 0:
            return None

        model_data = self.process_data.get("models", {}).get(str(model_choice or "default"))
        if not model_data:
            return None
        min_samples = int(self.process_data.get("min_samples", 10))
        if int(model_data.get("samples", 0)) < min_samples:
            return None
        seconds_per_char = float(model_data.get("seconds_per_char", 0.0))
        if seconds_per_char <= 0:
            return None
        return max(5, round(input_chars * seconds_per_char))
            
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
