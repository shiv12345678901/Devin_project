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

class ProcessEstimateSample(TypedDict, total=False):
    input_chars: int
    seconds: float
    resolution: str
    concurrent: bool

class ProcessEstimateModel(TypedDict):
    seconds_per_char: float
    samples: int
    runs: List[ProcessEstimateSample]

class ProcessEstimateData(TypedDict):
    min_samples: int
    models: Dict[str, ProcessEstimateModel]

# ─── Resolution & concurrency feature engineering ───────────────────────────
#
# Video export time scales roughly with pixel count, while AI/screenshot
# stages don't. The factors below are *priors* — they're only used when a
# bucket has fewer than ``_BUCKET_MIN_SAMPLES`` real observations. As more
# data comes in, the factors are computed empirically per (model, resolution).

RESOLUTION_ALIASES: Dict[str, str] = {
    "720": "720p",
    "720p": "720p",
    "hd": "720p",
    "1080": "1080p",
    "1080p": "1080p",
    "fhd": "1080p",
    "1440": "1440p",
    "1440p": "1440p",
    "qhd": "1440p",
    "2k": "1440p",
    "4k": "4k",
    "2160": "4k",
    "2160p": "4k",
    "uhd": "4k",
}

# Default multipliers vs 1080p baseline, tuned to typical PowerPoint MP4
# export costs. These are only consulted as priors; the tracker will
# replace them with observed data once a (model, resolution) bucket has
# enough samples.
_RESOLUTION_PRIOR_FACTOR: Dict[str, float] = {
    "720p": 0.7,
    "1080p": 1.0,
    "1440p": 1.6,
    "4k": 2.5,
}

# Concurrency slowdown prior — running two pipelines in parallel roughly
# 1.5x's a single run because the AI/PowerPoint stages contend for the
# same resources.
_CONCURRENCY_PRIOR_FACTOR = 1.5

_BUCKET_MIN_SAMPLES = 3  # smallest bucket that overrides the prior
DEFAULT_RESOLUTION = "1080p"


def normalize_resolution(label) -> str:
    """Canonicalize a user-supplied resolution string to a known bucket.

    Falls back to ``"1080p"`` so legacy samples without an explicit
    resolution land in the same bucket as the modal default — which is
    what the user asked for when they said *label existing data as
    1080p*.
    """
    if isinstance(label, (list, tuple)) and len(label) >= 2:
        # Stored as ``[width, height]`` in the run settings — map back to
        # the closest named bucket by total pixel count.
        try:
            pixels = int(label[0]) * int(label[1])
        except (TypeError, ValueError):
            return DEFAULT_RESOLUTION
        if pixels >= 3840 * 2160 * 0.9:
            return "4k"
        if pixels >= 2560 * 1440 * 0.9:
            return "1440p"
        if pixels >= 1920 * 1080 * 0.9:
            return "1080p"
        return "720p"
    text = str(label or "").strip().lower()
    if not text:
        return DEFAULT_RESOLUTION
    return RESOLUTION_ALIASES.get(text, DEFAULT_RESOLUTION)

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
        self._migrated_on_load = False
        self.data: ETAData = self._load_data()
        self.process_data: ProcessEstimateData = self._load_process_data()
        # Persist the resolution/concurrent backfill so we don't re-do it
        # on every boot and so the on-disk file matches the in-memory shape.
        if self._migrated_on_load:
            self._save_process_data()
        
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
                # Backfill the new resolution/concurrent fields onto pre-
                # existing samples — per the user's request, runs without
                # an explicit resolution count as 1080p (the modal default
                # and what the existing data was almost certainly captured
                # at).
                migrated = False
                for model_data in data["models"].values():
                    for run in model_data.get("runs", []) or []:
                        if "resolution" not in run:
                            run["resolution"] = DEFAULT_RESOLUTION
                            migrated = True
                        if "concurrent" not in run:
                            run["concurrent"] = False
                            migrated = True
                self._migrated_on_load = migrated
                return cast(ProcessEstimateData, data)
            except Exception as e:
                print(f"Warning: Error loading process ETA data: {e}")

        self._migrated_on_load = False
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

    def record_process_completion(
        self,
        model_choice: str,
        input_chars: int,
        total_seconds: float,
        resolution: Optional[object] = None,
        concurrent: bool = False,
    ) -> None:
        """Record a successful end-to-end process sample.

        ``resolution`` and ``concurrent`` get folded into per-bucket
        statistics so the predictor can charge a 4K run more time than a
        1080p one and bake in the concurrent-pipeline slowdown rather
        than averaging it away. Older callers that don't pass the new
        kwargs land in the ``1080p`` / non-concurrent bucket — the same
        bucket pre-existing samples migrate into.
        """
        if input_chars <= 0 or total_seconds <= 0:
            return

        model = str(model_choice or "default")
        sample: ProcessEstimateSample = {
            "input_chars": int(input_chars),
            "seconds": round(float(total_seconds), 3),
            "resolution": normalize_resolution(resolution),
            "concurrent": bool(concurrent),
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

    def _bucket_seconds_per_char(self, runs: List[ProcessEstimateSample], **filters) -> Optional[float]:
        """Mean seconds-per-character across ``runs`` matching ``filters``.

        Returns ``None`` when fewer than ``_BUCKET_MIN_SAMPLES`` runs match
        — caller falls back to a wider bucket or a prior multiplier.
        """
        matched = [
            r for r in runs
            if all(r.get(key) == value for key, value in filters.items())
        ]
        if len(matched) < _BUCKET_MIN_SAMPLES:
            return None
        chars = sum(max(0, int(r.get("input_chars", 0))) for r in matched)
        secs = sum(max(0.0, float(r.get("seconds", 0))) for r in matched)
        if chars <= 0:
            return None
        return secs / chars

    def _resolution_factor(self, runs: List[ProcessEstimateSample], resolution: str) -> float:
        """Multiplier vs the 1080p baseline, observed-or-prior."""
        if resolution == DEFAULT_RESOLUTION:
            return 1.0
        baseline = self._bucket_seconds_per_char(runs, resolution=DEFAULT_RESOLUTION)
        observed = self._bucket_seconds_per_char(runs, resolution=resolution)
        if baseline and observed and baseline > 0:
            return observed / baseline
        return _RESOLUTION_PRIOR_FACTOR.get(resolution, 1.0)

    def _concurrency_factor(self, runs: List[ProcessEstimateSample]) -> float:
        """Multiplier for concurrent vs solo pipeline runs, observed-or-prior."""
        solo = self._bucket_seconds_per_char(runs, concurrent=False)
        concurrent = self._bucket_seconds_per_char(runs, concurrent=True)
        if solo and concurrent and solo > 0:
            return concurrent / solo
        return _CONCURRENCY_PRIOR_FACTOR

    def predict_process_time(
        self,
        model_choice: str,
        input_chars: int,
        resolution: Optional[object] = None,
        concurrent: bool = False,
    ) -> Optional[int]:
        """Predict process seconds factoring in resolution and concurrency.

        Stays silent (returns ``None``) until the selected model has at
        least ``min_samples`` total runs — matches the user's ask of
        "only show ETA after 10 processes".
        """
        if input_chars <= 0:
            return None

        model_data = self.process_data.get("models", {}).get(str(model_choice or "default"))
        if not model_data:
            return None
        min_samples = int(self.process_data.get("min_samples", 10))
        runs = model_data.get("runs", []) or []
        if len(runs) < min_samples:
            return None

        target_resolution = normalize_resolution(resolution)
        is_concurrent = bool(concurrent)

        # Use the most specific bucket that has enough samples; fall back
        # to multiplying the broader bucket by an observed-or-prior factor.
        bucket_filters: List[Dict[str, object]] = [
            {"resolution": target_resolution, "concurrent": is_concurrent},
            {"resolution": target_resolution},
            {"concurrent": is_concurrent},
            {},
        ]
        spc: Optional[float] = None
        used_filters: Dict[str, object] = {}
        for filt in bucket_filters:
            spc = self._bucket_seconds_per_char(runs, **filt)
            if spc is not None:
                used_filters = filt
                break
        if spc is None or spc <= 0:
            spc = float(model_data.get("seconds_per_char", 0.0))
        if spc <= 0:
            return None

        predicted = spc * input_chars
        if "resolution" not in used_filters and target_resolution != DEFAULT_RESOLUTION:
            predicted *= self._resolution_factor(runs, target_resolution)
        if "concurrent" not in used_filters and is_concurrent:
            predicted *= self._concurrency_factor(runs)

        return max(5, round(predicted))
            
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
