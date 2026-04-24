"""Platform and dependency validation for PowerPoint automation.

This module provides utilities to verify that the system meets the requirements
for PowerPoint automation features (Windows OS, PowerPoint installation, etc.).
"""

import platform
import sys
from typing import Tuple, Optional


class PlatformCheckError(Exception):
    """Base exception for platform compatibility issues."""
    pass


class WindowsRequiredError(PlatformCheckError):
    """Raised when PowerPoint features are used on non-Windows platforms."""
    pass


class PowerPointNotInstalledError(PlatformCheckError):
    """Raised when PowerPoint is not installed or not accessible."""
    pass


class PyWin32NotInstalledError(PlatformCheckError):
    """Raised when pywin32 package is not installed."""
    pass


def is_windows() -> bool:
    """Check if the current platform is Windows.
    
    Returns:
        True if running on Windows, False otherwise
    """
    return platform.system() == 'Windows'


def check_platform_compatibility() -> Tuple[bool, Optional[str]]:
    """Verify the system can run PowerPoint automation.
    
    Returns:
        Tuple of (is_compatible, error_message)
        - is_compatible: True if all requirements met
        - error_message: None if compatible, error description otherwise
    """
    # Check if running on Windows
    if not is_windows():
        return False, (
            f"PowerPoint automation requires Windows. "
            f"Current platform: {platform.system()} {platform.release()}"
        )
    
    # Check if pywin32 is installed
    try:
        import win32com.client
    except ImportError:
        return False, (
            "pywin32 is not installed. "
            "Install with: pip install pywin32"
        )
    
    return True, None


def check_powerpoint_installed() -> Tuple[bool, Optional[str]]:
    """Check if Microsoft PowerPoint is installed and accessible via COM.
    
    Returns:
        Tuple of (is_installed, error_message)
        - is_installed: True if PowerPoint is accessible
        - error_message: None if installed, error description otherwise
    """
    if not is_windows():
        return False, "PowerPoint is only available on Windows"
    
    try:
        import win32com.client
        import pywintypes
        
        # Try to create PowerPoint application instance
        try:
            ppt = win32com.client.Dispatch("PowerPoint.Application")
            version = ppt.Version
            ppt.Quit()
            return True, None
        except pywintypes.com_error as e:
            return False, (
                "Microsoft PowerPoint is not installed or not accessible. "
                f"COM error: {e.args[2][2] if len(e.args) > 2 else str(e)}"
            )
    except ImportError:
        return False, "pywin32 is not installed"


def get_powerpoint_version() -> Optional[str]:
    """Get the installed PowerPoint version.
    
    Returns:
        Version string (e.g., "16.0") or None if not installed
    """
    if not is_windows():
        return None
    
    try:
        import win32com.client
        ppt = win32com.client.Dispatch("PowerPoint.Application")
        version = ppt.Version
        ppt.Quit()
        return version
    except Exception:
        return None


def check_all_requirements() -> Tuple[bool, str]:
    """Check all requirements for PowerPoint automation.
    
    Returns:
        Tuple of (all_met, status_message)
        - all_met: True if all requirements are met
        - status_message: Detailed status message
    """
    messages = []
    all_met = True
    
    # Check platform
    platform_ok, platform_msg = check_platform_compatibility()
    if not platform_ok:
        all_met = False
        messages.append(f"❌ Platform: {platform_msg}")
    else:
        messages.append(f"✓ Platform: Windows {platform.release()}")
    
    # Check PowerPoint installation
    if platform_ok:
        ppt_ok, ppt_msg = check_powerpoint_installed()
        if not ppt_ok:
            all_met = False
            messages.append(f"❌ PowerPoint: {ppt_msg}")
        else:
            version = get_powerpoint_version()
            messages.append(f"✓ PowerPoint: Version {version} installed")
    
    # Check Python version
    py_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    if sys.version_info >= (3, 8):
        messages.append(f"✓ Python: {py_version}")
    else:
        all_met = False
        messages.append(f"❌ Python: {py_version} (requires 3.8+)")
    
    status_message = "\n".join(messages)
    return all_met, status_message


def require_windows() -> None:
    """Raise an exception if not running on Windows.
    
    Raises:
        WindowsRequiredError: If not running on Windows
    """
    if not is_windows():
        raise WindowsRequiredError(
            f"This feature requires Windows. Current platform: {platform.system()}"
        )


def require_powerpoint() -> None:
    """Raise an exception if PowerPoint is not installed.
    
    Raises:
        PowerPointNotInstalledError: If PowerPoint is not accessible
    """
    is_installed, error_msg = check_powerpoint_installed()
    if not is_installed:
        raise PowerPointNotInstalledError(error_msg)


def require_all() -> None:
    """Raise an exception if any requirements are not met.
    
    Raises:
        PlatformCheckError: If any requirement is not met
    """
    all_met, status_message = check_all_requirements()
    if not all_met:
        raise PlatformCheckError(
            f"PowerPoint automation requirements not met:\n{status_message}"
        )


if __name__ == "__main__":
    # Run checks when executed directly
    all_met, status = check_all_requirements()
    print("PowerPoint Automation Requirements Check")
    print("=" * 50)
    print(status)
    print("=" * 50)
    if all_met:
        print("\n✓ All requirements met! PowerPoint automation is available.")
    else:
        print("\n❌ Some requirements are not met. PowerPoint automation is unavailable.")
        sys.exit(1)
