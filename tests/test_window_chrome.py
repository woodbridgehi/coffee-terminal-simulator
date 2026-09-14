from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "coffee-terminal"))

from window_chrome import WindowChromeBridge


class Event:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self

    def fire(self):
        for handler in self.handlers:
            handler()


class FakeWindow:
    def __init__(self):
        self.calls = []
        self.events = type("Events", (), {"maximized": Event(), "restored": Event()})()

    def minimize(self): self.calls.append("minimize")
    def maximize(self): self.calls.append("maximize")
    def restore(self): self.calls.append("restore")
    def destroy(self): self.calls.append("destroy")


def test_window_controls_are_allow_listed_and_track_maximize_state():
    bridge = WindowChromeBridge()
    bridge._init_window_chrome(True)
    window = FakeWindow()
    bridge._bind_window(window)

    assert bridge.get_window_chrome() == {"enabled": True, "maximized": False}
    assert bridge.window_control("minimize")["ok"]
    assert bridge.window_control("toggle-maximize") == {"ok": True, "maximized": True}
    assert bridge.window_control("toggle-maximize") == {"ok": True, "maximized": False}
    assert bridge.window_control("close")["ok"]
    assert window.calls == ["minimize", "maximize", "restore", "destroy"]
    assert bridge.window_control("move") == {"ok": False, "error": "不支持的窗口操作"}


def test_window_controls_stay_disabled_outside_windows_mode():
    bridge = WindowChromeBridge()
    bridge._init_window_chrome(False)
    bridge._bind_window(FakeWindow())
    assert bridge.get_window_chrome()["enabled"] is False
    assert bridge.window_control("close")["ok"] is False
