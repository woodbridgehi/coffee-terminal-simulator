"""Set the native macOS application icon for the development pywebview app."""
from __future__ import annotations

import sys
from pathlib import Path


def set_macos_app_icon(icon_path: Path) -> None:
    """Apply a PNG icon to the Dock when running on macOS.

    The import is intentionally lazy so this module remains harmless on
    Windows and Linux, where AppKit is unavailable.
    """
    if sys.platform != "darwin":
        return
    try:
        from AppKit import NSApplication, NSImage
    except ImportError:
        return

    image = NSImage.alloc().initWithContentsOfFile_(str(icon_path))
    if image is not None:
        NSApplication.sharedApplication().setApplicationIconImage_(image)
