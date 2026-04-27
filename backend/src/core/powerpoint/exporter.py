"""
PowerPoint COM Automation Module

This module handles COM automation for PowerPoint video export functionality.
It provides a wrapper around the Windows COM interface to PowerPoint for
exporting presentations to video format.
"""

import os
import time
from pathlib import Path
from typing import Optional, Tuple
import logging

# Import platform check utilities
from src.utils.platform_check import is_windows, require_windows

# Set up logging
logger = logging.getLogger(__name__)


class PowerPointExporter:
    """Handles COM automation for PowerPoint video export.
    
    This class provides methods to open PowerPoint presentations via COM,
    export them to video format, and manage the PowerPoint application lifecycle.
    
    Attributes:
        ppt_app: PowerPoint Application COM object
        presentation: Currently open presentation COM object
    """
    
    def __init__(self):
        """Initialize COM interface to PowerPoint.
        
        Raises:
            RuntimeError: If not running on Windows
            ImportError: If pywin32 is not installed
        """
        # Ensure we're on Windows
        require_windows()
        
        # Import Windows-specific modules
        try:
            import win32com.client
            import pywintypes
            import pythoncom
            self.win32com = win32com
            self.pywintypes = pywintypes
            self.pythoncom = pythoncom
        except ImportError as e:
            raise ImportError(
                "pywin32 is required for PowerPoint automation. "
                "Install with: pip install pywin32"
            ) from e
        
        self.ppt_app = None
        self.presentation = None
        self._com_initialized = False
    
    def is_powerpoint_installed(self) -> bool:
        """Check if PowerPoint is installed and accessible.
        
        Returns:
            True if PowerPoint is available, False otherwise
        """
        if not is_windows():
            return False
        
        try:
            self.pythoncom.CoInitialize()
            # Try to create PowerPoint application instance
            ppt = self.win32com.client.DispatchEx("PowerPoint.Application")
            ppt.Quit()
            return True
        except Exception as e:
            logger.warning(f"PowerPoint not accessible: {e}")
            return False
        finally:
            try:
                self.pythoncom.CoUninitialize()
            except Exception:
                pass
    
    def _initialize_powerpoint(self) -> None:
        """Initialize PowerPoint application if not already initialized.
        
        Raises:
            RuntimeError: If PowerPoint cannot be initialized
        """
        if self.ppt_app is None:
            try:
                self.pythoncom.CoInitialize()
                self._com_initialized = True
                self.ppt_app = self.win32com.client.DispatchEx("PowerPoint.Application")
                # Make PowerPoint visible (required for CreateVideo)
                self.ppt_app.Visible = 1
                # Disable alerts (e.g., macro warnings, link updates) which can hang COM
                self.ppt_app.DisplayAlerts = 1  # 1 = ppAlertsNone
                logger.info("PowerPoint application initialized")
            except Exception as e:
                if self._com_initialized:
                    try:
                        self.pythoncom.CoUninitialize()
                    except Exception:
                        pass
                    self._com_initialized = False
                raise RuntimeError(
                    f"Failed to initialize PowerPoint application: {e}"
                ) from e
    
    def open_presentation(self, path: str) -> None:
        """Open a presentation file in PowerPoint.
        
        Args:
            path: Path to .pptx file to open
            
        Raises:
            FileNotFoundError: If presentation file doesn't exist
            RuntimeError: If PowerPoint cannot open the file
        """
        # Validate file exists
        if not os.path.exists(path):
            raise FileNotFoundError(f"Presentation file not found: {path}")
        
        # Convert to absolute path
        abs_path = str(Path(path).resolve())
        
        # Initialize PowerPoint if needed
        self._initialize_powerpoint()
        
        # Close any existing presentation
        if self.presentation is not None:
            try:
                self.presentation.Close()
            except Exception as e:
                logger.warning(f"Error closing previous presentation: {e}")
        
        # Open the presentation with retry logic
        max_retries = 3
        retry_delay = 1  # seconds
        
        for attempt in range(max_retries):
            try:
                self.presentation = self.ppt_app.Presentations.Open(
                    abs_path,
                    ReadOnly=False,
                    Untitled=False,
                    WithWindow=True
                )
                logger.info(f"Opened presentation: {abs_path}")
                return
            except self.pywintypes.com_error as e:
                if attempt < max_retries - 1:
                    logger.warning(
                        f"Attempt {attempt + 1} failed to open presentation, "
                        f"retrying in {retry_delay}s: {e}"
                    )
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    raise RuntimeError(
                        f"Failed to open presentation after {max_retries} attempts: {e}"
                    ) from e
    
    def export_video(
        self,
        output_path: str,
        width: int = 3840,
        height: int = 2160,
        fps: int = 30,
        quality: int = 5,
        default_slide_duration: float = 3.0,
        progress_callback=None,
        cancel_event=None
    ) -> None:
        """Export presentation to video using PowerPoint's native export.
        
        Uses PowerPoint's CreateVideo method via COM automation to export
        the presentation to MP4 video format.
        
        Args:
            output_path: Path where video file should be saved
            width: Video width in pixels (default: 3840 for 4K)
            height: Video height in pixels (default: 2160 for 4K)
            fps: Frames per second (default: 30)
            quality: Video quality 1-100, or legacy 1-5 (default: 5)
            default_slide_duration: Fallback seconds per slide
            progress_callback: Optional callback(dict) for progress updates
            cancel_event: Optional threading.Event for cancellation
            
        Raises:
            RuntimeError: If no presentation is open or export fails
            ValueError: If quality is not in range 1-5
        """
        if self.presentation is None:
            raise RuntimeError("No presentation is open. Call open_presentation() first.")
        
        def _normalize_quality(q: int) -> int:
            if 1 <= int(q) <= 5:
                return {1: 20, 2: 40, 3: 60, 4: 80, 5: 100}[int(q)]
            if 1 <= int(q) <= 100:
                return int(q)
            raise ValueError(f"Quality must be 1-100 (or legacy 1-5), got: {q}")

        quality_100 = _normalize_quality(int(quality))
        
        # Ensure output directory exists
        output_dir = Path(output_path).parent
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Convert to absolute path
        abs_output_path = str(Path(output_path).resolve())
        
        # Remove existing file if it exists
        if os.path.exists(abs_output_path):
            try:
                os.remove(abs_output_path)
                logger.info(f"Removed existing video file: {abs_output_path}")
            except Exception as e:
                logger.warning(f"Could not remove existing file: {e}")
        
        # Export video with retry logic
        max_retries = 3
        retry_delay = 2  # seconds
        
        for attempt in range(max_retries):
            try:
                if cancel_event is not None and cancel_event.is_set():
                    raise RuntimeError("Operation cancelled")
                # PowerPoint CreateVideo method parameters:
                # CreateVideo(FileName, UseTimingsAndNarrations,
                #             DefaultSlideDuration, VertResolution,
                #             FramesPerSecond, Quality)
                # 
                # UseTimingsAndNarrations: True to use slide timings
                # VertResolution: Vertical resolution in pixels
                # FramesPerSecond: Frames per second
                # Quality: 1-5 where 5 is highest quality
                
                logger.info(
                    f"Starting video export: {abs_output_path} "
                    f"({width}x{height}, {fps}fps, quality={quality_100})"
                )
                if progress_callback:
                    progress_callback({
                        "stage": "video_export",
                        "progress": 95,
                        "message": "Video export started",
                        "output_path": abs_output_path,
                    })

                try:
                    self.presentation.CreateVideo(
                        abs_output_path,
                        True,  # Use timings and narrations
                        float(default_slide_duration),
                        int(height),  # Vertical resolution (PowerPoint uses vertical resolution)
                        int(fps),
                        int(quality_100),
                    )
                except Exception:
                    self.presentation.CreateVideo(
                        abs_output_path,
                        True,
                        int(height),
                        int(fps),
                        int(quality_100),
                    )
                
                # Wait for export to complete
                # PowerPoint's CreateVideo is asynchronous, so we need to wait
                # for the file to be created and finalized
                self._wait_for_video_export(
                    abs_output_path,
                    progress_callback=progress_callback,
                    cancel_event=cancel_event,
                )
                
                logger.info(f"Video export completed: {abs_output_path}")
                return
                
            except self.pywintypes.com_error as e:
                if attempt < max_retries - 1:
                    logger.warning(
                        f"Attempt {attempt + 1} failed to export video, "
                        f"retrying in {retry_delay}s: {e}"
                    )
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    raise RuntimeError(
                        f"Failed to export video after {max_retries} attempts: {e}"
                    ) from e
    
    def _wait_for_video_export(
        self, 
        output_path: str, 
        timeout: int = 1800,
        check_interval: int = 5,
        progress_callback=None,
        cancel_event=None
    ) -> None:
        """Wait for video export to complete.
        
        PowerPoint's CreateVideo method is asynchronous, so we need to wait
        for the file to be created and finalized before returning.
        
        Args:
            output_path: Path to the video file being created
            timeout: Maximum time to wait in seconds (default: 1800 = 30 minutes)
            check_interval: How often to check file status in seconds (default: 5)
            
        Raises:
            TimeoutError: If export doesn't complete within timeout
        """
        start_time = time.time()
        last_size = 0
        stable_count = 0
        stable_threshold = 3  # Number of checks with same size to consider complete
        status_done_seen = False
        status_failed_seen_at = None
        
        logger.info(f"Waiting for video export to complete (timeout: {timeout}s)...")
        
        while True:
            elapsed = time.time() - start_time
            if cancel_event is not None and cancel_event.is_set():
                raise RuntimeError("Operation cancelled")
            
            # Check timeout
            if elapsed > timeout:
                raise TimeoutError(
                    f"Video export did not complete within {timeout} seconds"
                )
            
            try:
                status = None
                if self.presentation is not None and hasattr(self.presentation, "CreateVideoStatus"):
                    status = int(self.presentation.CreateVideoStatus)
                if status == 2:
                    status_done_seen = True
                if status == 3:
                    status_failed_seen_at = status_failed_seen_at or time.time()
            except Exception:
                pass

            # Check if file exists and get size
            if os.path.exists(output_path):
                try:
                    current_size = os.path.getsize(output_path)
                    if progress_callback:
                        progress_callback({
                            "stage": "video_export",
                            "progress": 97,
                            "message": "Video export in progress",
                            "elapsed_seconds": int(elapsed),
                            "size_bytes": int(current_size),
                            "output_path": output_path,
                        })
                    
                    # Check if file size is stable (not growing)
                    if current_size == last_size and current_size > 0:
                        stable_count += 1
                        if stable_count >= stable_threshold:
                            # File size has been stable for multiple checks
                            logger.info(
                                f"Video export complete. File size: {current_size} bytes"
                            )
                            if progress_callback:
                                progress_callback({
                                    "stage": "video_complete",
                                    "progress": 99,
                                    "message": "Video export completed",
                                    "size_bytes": int(current_size),
                                    "output_path": output_path,
                                })
                            return
                    else:
                        stable_count = 0
                        last_size = current_size
                        logger.debug(
                            f"Video export in progress... Size: {current_size} bytes "
                            f"(elapsed: {elapsed:.1f}s)"
                        )
                except OSError as e:
                    # File might be locked during write
                    logger.debug(f"Could not check file size: {e}")
            elif status_failed_seen_at is not None and time.time() - status_failed_seen_at > 30:
                raise RuntimeError("PowerPoint reported CreateVideoStatus=Failed")
            elif status_done_seen and progress_callback:
                progress_callback({
                    "stage": "video_export",
                    "progress": 98,
                    "message": "Finalizing video file...",
                    "elapsed_seconds": int(elapsed),
                    "output_path": output_path,
                })
            
            # Wait before next check
            time.sleep(check_interval)
    
    def create_from_template(
        self,
        template_path: str,
        image_files: list,
        output_path: str,
        base_slide_index: int = 3,
        slide_duration: float = 3.0,
        intro_thumbnail_path: Optional[str] = None,
        intro_thumbnail_duration: float = 5.0,
        outro_thumbnail_path: Optional[str] = None,
        outro_thumbnail_duration: float = 5.0,
        progress_callback=None,
        cancel_event=None
    ) -> str:
        """
        Create presentation from template using COM automation.
        
        Replicates default-template macro logic:
        1. Open template
        2. Preserve slides 1, 2, 3, and the final four template slides
        3. Remove old generated slides after slide 3 through the 5th-last slide
        4. Duplicate slide 3 for each screenshot
        5. Insert screenshots behind the existing slide design/watermark
        6. Optionally insert intro/outro thumbnails into slide 2 / 2nd-last
           (when no outro thumbnail is provided, the 2nd-last slide is
           deleted before export)
        7. Save As to output_path
        
        Args:
            template_path: Path to .pptm template file
            image_files: List of image file paths (already sorted)
            output_path: Where to save the presentation
            base_slide_index: 1-based index of the base content slide (default: 3)
            
        Returns:
            Path to created presentation file
        """
        import re
        
        # Validate
        if not os.path.exists(template_path):
            raise FileNotFoundError(f"Template not found: {template_path}")
        
        if not image_files:
            raise ValueError("No image files provided")
        
        # Sort image files by numeric order: N(M).png -> sort by M
        def sort_key(filepath):
            basename = os.path.basename(filepath)
            # Match pattern like "1(2).png" or "screenshot_1(3).png"
            match = re.search(r'\((\d+)\)', basename)
            if match:
                return int(match.group(1))
            # Fallback: try any number in filename
            nums = re.findall(r'\d+', basename)
            return int(nums[-1]) if nums else 0
        
        sorted_images = sorted(image_files, key=sort_key)
        
        # Convert paths to absolute
        abs_template = str(Path(template_path).resolve())
        abs_output = str(Path(output_path).resolve())
        
        # Ensure output directory exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        
        # Initialize PowerPoint
        self._initialize_powerpoint()
        
        try:
            # Open template
            print(f"DEBUG: Opening template {abs_template}...")
            # Use explicit integer constants for COM booleans: msoFalse = 0, msoTrue = -1
            self.presentation = self.ppt_app.Presentations.Open(
                abs_template,
                ReadOnly=0,
                Untitled=0,
                WithWindow=-1
            )
            
            total_slides = self.presentation.Slides.Count
            print(f"DEBUG: Template opened successfully. Total slides: {total_slides}")
            logger.info(f"Template opened: {total_slides} slides")
            if progress_callback:
                progress_callback({
                    "stage": "powerpoint",
                    "progress": 90,
                    "message": "Template opened",
                    "total_slides": int(total_slides),
                })
            if cancel_event is not None and cancel_event.is_set():
                raise RuntimeError("Operation cancelled")
            
            if total_slides < base_slide_index:
                raise ValueError(
                    f"Template has only {total_slides} slides, "
                    f"but base_slide_index is {base_slide_index}"
                )
            
            # Step 1: Remove old generated content.
            # Keep slide 3 as the base slide. Also keep the final four
            # template slides intact: 4th-last, 3rd-last, 2nd-last, last.
            # Therefore delete slide 4 through the original 5th-last slide.
            delete_first = base_slide_index + 1
            delete_last = total_slides - 4
            if delete_last >= delete_first:
                for i in range(delete_last, delete_first - 1, -1):
                    if cancel_event is not None and cancel_event.is_set():
                        raise RuntimeError("Operation cancelled")
                    try:
                        self.presentation.Slides(i).Delete()
                        logger.debug(f"Deleted old content slide at index {i}")
                    except Exception as e:
                        logger.warning(f"Could not delete slide {i}: {e}")
            
            remaining = self.presentation.Slides.Count
            logger.info(f"After cleanup: {remaining} slides remaining")
            
            # Step 2: Duplicate base slide for each image
            # The base slide is at index base_slide_index (1-based)
            base_slide = self.presentation.Slides(base_slide_index)
            slide_width = self.presentation.PageSetup.SlideWidth
            slide_height = self.presentation.PageSetup.SlideHeight
            self._clear_full_bleed_images(base_slide, slide_width, slide_height)
            
            # Duplicate (count - 1) times (base slide itself will get the first image)
            for i in range(len(sorted_images) - 1):
                if cancel_event is not None and cancel_event.is_set():
                    raise RuntimeError("Operation cancelled")
                base_slide.Duplicate()
            
            logger.info(f"Duplicated base slide {len(sorted_images) - 1} times")
            
            # Step 3: Insert images into slides starting at base_slide_index
            for i, img_path in enumerate(sorted_images):
                if cancel_event is not None and cancel_event.is_set():
                    raise RuntimeError("Operation cancelled")
                slide_idx = base_slide_index + i
                abs_img = str(Path(img_path).resolve())
                
                if not os.path.exists(abs_img):
                    logger.warning(f"Image not found, skipping: {abs_img}")
                    continue
                
                slide = self.presentation.Slides(slide_idx)
                self._clear_full_bleed_images(slide, slide_width, slide_height)
                
                print(f"DEBUG: Inserting image {abs_img} into slide {slide_idx}...")
                # Add picture: msoFalse = 0, msoTrue = -1
                pic = slide.Shapes.AddPicture(
                    FileName=abs_img,
                    LinkToFile=0,     # msoFalse
                    SaveWithDocument=-1, # msoTrue
                    Left=0,
                    Top=0,
                    Width=slide_width,
                    Height=slide_height
                )
                
                # Send image to back (behind watermark and other elements)
                pic.ZOrder(1) # 1 = msoSendToBack
                self._set_slide_duration(slide, slide_duration)
                print(f"DEBUG: Image {i+1}/{len(sorted_images)} inserted successfully.")
                if progress_callback:
                    progress_callback({
                        "stage": "powerpoint",
                        "progress": 90 + int(((i + 1) / max(len(sorted_images), 1)) * 4),
                        "message": f"Inserted screenshot {i+1}/{len(sorted_images)}",
                        "screenshot_index": int(i + 1),
                        "screenshots_total": int(len(sorted_images)),
                        "slide_index": int(slide_idx),
                        "filename": os.path.basename(img_path),
                    })
                
                logger.debug(f"Inserted image {os.path.basename(img_path)} into slide {slide_idx}")
            
            logger.info(f"Inserted {len(sorted_images)} images")

            if intro_thumbnail_path:
                intro_slide = self.presentation.Slides(2)
                self._replace_full_slide_image(
                    intro_slide,
                    intro_thumbnail_path,
                    slide_width,
                    slide_height,
                )
                self._set_slide_duration(intro_slide, intro_thumbnail_duration)
                logger.info("Inserted intro thumbnail on slide 2")

            if outro_thumbnail_path:
                outro_slide_index = max(1, self.presentation.Slides.Count - 1)
                outro_slide = self.presentation.Slides(outro_slide_index)
                self._replace_full_slide_image(
                    outro_slide,
                    outro_thumbnail_path,
                    slide_width,
                    slide_height,
                )
                self._set_slide_duration(outro_slide, outro_thumbnail_duration)
                logger.info(f"Inserted outro thumbnail on slide {outro_slide_index}")
            else:
                current_count = self.presentation.Slides.Count
                outro_slide_index = current_count - 1
                if outro_slide_index > base_slide_index:
                    try:
                        self.presentation.Slides(outro_slide_index).Delete()
                        logger.info(
                            f"Deleted 2nd-last slide at index {outro_slide_index} "
                            "because no outro thumbnail was provided"
                        )
                    except Exception as e:
                        logger.warning(
                            f"Could not delete 2nd-last slide {outro_slide_index}: {e}"
                        )
                else:
                    logger.info(
                        "Skipped 2nd-last slide deletion: "
                        f"only {current_count} slides present"
                    )
            
            # Step 4: Save As to output path
            # ppSaveAsDefault = 11, ppSaveAsOpenXMLPresentation = 24
            # ppSaveAsOpenXMLPresentationMacroEnabled = 25
            ext = os.path.splitext(output_path)[1].lower()
            if ext == '.pptm':
                save_format = 25  # ppSaveAsOpenXMLPresentationMacroEnabled
            else:
                save_format = 24  # ppSaveAsOpenXMLPresentation
            
            print(f"DEBUG: Saving presentation as {abs_output} (format {save_format})...")
            self.presentation.SaveAs(abs_output, save_format)
            print("DEBUG: Presentation saved successfully.")
            logger.info(f"Presentation saved: {abs_output}")
            if progress_callback:
                progress_callback({
                    "stage": "powerpoint_complete",
                    "progress": 94,
                    "message": "Presentation saved",
                    "presentation_path": abs_output,
                })
            
            return output_path
            
        except Exception as e:
            logger.error(f"Error creating presentation from template: {e}")
            raise

    def _set_slide_duration(self, slide, duration_seconds: float) -> None:
        """Set automatic slide advance timing without changing slide design."""
        duration = max(0.1, float(duration_seconds or 0.1))
        try:
            transition = slide.SlideShowTransition
            transition.AdvanceOnClick = 0
            transition.AdvanceOnTime = -1
            transition.AdvanceTime = duration
        except Exception as e:
            logger.warning(f"Could not set slide timing: {e}")

    def _replace_full_slide_image(
        self,
        slide,
        image_path: str,
        slide_width: float,
        slide_height: float,
    ) -> None:
        """Replace the full-bleed image layer while preserving overlays."""
        abs_img = str(Path(image_path).resolve())
        if not os.path.exists(abs_img):
            raise FileNotFoundError(f"Thumbnail not found: {image_path}")
        self._clear_full_bleed_images(slide, slide_width, slide_height)
        pic = slide.Shapes.AddPicture(
            FileName=abs_img,
            LinkToFile=0,
            SaveWithDocument=-1,
            Left=0,
            Top=0,
            Width=slide_width,
            Height=slide_height,
        )
        pic.ZOrder(1)
    
    def _clear_full_bleed_images(self, slide, slide_width: float, slide_height: float) -> None:
        """Remove full-slide picture placeholders while preserving overlays."""
        picture_types = {11, 13}  # msoLinkedPicture, msoPicture
        tol_w = slide_width * 0.02
        tol_h = slide_height * 0.02
        for i in range(slide.Shapes.Count, 0, -1):
            try:
                shape = slide.Shapes(i)
                if int(getattr(shape, "Type", -1)) not in picture_types:
                    continue
                left = float(shape.Left)
                top = float(shape.Top)
                width = float(shape.Width)
                height = float(shape.Height)
                full_bleed = (
                    abs(left) <= tol_w and
                    abs(top) <= tol_h and
                    abs(width - slide_width) <= tol_w and
                    abs(height - slide_height) <= tol_h
                )
                if full_bleed:
                    shape.Delete()
            except Exception:
                continue


    
    def close_presentation(self, save: bool = False) -> None:
        """Close the current presentation.
        
        Args:
            save: Whether to save changes before closing (default: False)
        """
        if self.presentation is not None:
            try:
                if save:
                    self.presentation.Save()
                self.presentation.Close()
                logger.info("Presentation closed")
            except Exception as e:
                logger.warning(f"Error closing presentation: {e}")
            finally:
                self.presentation = None
    
    def quit_powerpoint(self) -> None:
        """Quit PowerPoint application.
        
        This should be called when done with all PowerPoint operations
        to properly clean up COM resources.
        """
        # Close presentation if open
        if self.presentation is not None:
            self.close_presentation(save=False)
        
        # Quit PowerPoint application
        if self.ppt_app is not None:
            try:
                self.ppt_app.Quit()
                logger.info("PowerPoint application quit")
            except Exception as e:
                logger.warning(f"Error quitting PowerPoint: {e}")
            finally:
                self.ppt_app = None
        
        if self._com_initialized:
            try:
                self.pythoncom.CoUninitialize()
            except Exception as e:
                logger.warning(f"Error uninitializing COM: {e}")
            finally:
                self._com_initialized = False
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - ensures cleanup."""
        self.quit_powerpoint()
        return False
