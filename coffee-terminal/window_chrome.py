"""Small, allow-listed bridge for the branded Windows window chrome."""
from __future__ import annotations

from typing import Any


class WindowChromeBridge:
    def _init_window_chrome(self, enabled: bool = False) -> None:
        self._window_chrome_enabled = bool(enabled)
        self._window: Any = None
        self._window_maximized = False

    def _bind_window(self, window: Any) -> None:
        self._window = window
        if not self._window_chrome_enabled:
            return
        window.events.maximized += lambda *args: setattr(self, "_window_maximized", True)
        window.events.restored += lambda *args: setattr(self, "_window_maximized", False)

    def get_window_chrome(self) -> dict[str, Any]:
        return {"enabled": self._window_chrome_enabled, "maximized": self._window_maximized}

    def window_control(self, action: str) -> dict[str, Any]:
        if not self._window_chrome_enabled or self._window is None:
            return {"ok": False, "error": "窗口控制仅在 Windows 无边框模式可用"}
        if action == "minimize":
            self._window.minimize()
        elif action == "toggle-maximize":
            if self._window_maximized:
                self._window.restore()
                self._window_maximized = False
            else:
                self._window.maximize()
                self._window_maximized = True
        elif action == "close":
            self._window.destroy()
        else:
            return {"ok": False, "error": "不支持的窗口操作"}
        return {"ok": True, "maximized": self._window_maximized}
