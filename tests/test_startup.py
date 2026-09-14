from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "coffee-terminal"))

import app


class WaitableEvent:
    def __init__(self):
        self.handlers = []
        self.wait_calls = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self

    def wait(self, timeout):
        self.wait_calls.append(timeout)
        return True


class FakeWindow:
    def __init__(self):
        self.events = type("Events", (), {"loaded": WaitableEvent(), "closed": WaitableEvent()})()
        self.calls = []
        self.scripts = []

    def show(self):
        self.calls.append("show")

    def destroy(self):
        self.calls.append("destroy")

    def evaluate_js(self, script):
        self.scripts.append(script)


class FakeRuntime:
    def __init__(self, config, instance_path):
        self.config = config
        self.instance_path = instance_path
        self.bound_window = None
        self.closed = False

    def _bind_window(self, window):
        self.bound_window = window

    def close(self):
        self.closed = True


def test_runtime_initializes_behind_splash_then_replaces_it(monkeypatch, tmp_path):
    splash = FakeWindow()
    target = FakeWindow()
    created = []

    def create_window(*args, **kwargs):
        created.append((args, kwargs))
        return target

    monkeypatch.setattr(app, "CoffeeDeviceRuntime", FakeRuntime)
    monkeypatch.setattr(app.webview, "create_window", create_window)
    monkeypatch.setattr(app, "MIN_SPLASH_SECONDS", 0)
    config = {
        "deviceId": "coffee-bot-test",
        "deviceName": "测试设备",
        "backend": {"mode": "local"},
    }

    app._launch_application(splash, config, tmp_path / "device.json", tmp_path, False)

    assert splash.events.loaded.wait_calls == [10]
    assert created[0][1]["hidden"] is True
    assert created[0][1]["background_color"] == "#F6F0E5"
    assert target.events.loaded.wait_calls == [12]
    assert target.calls == ["show"]
    assert splash.calls == ["destroy"]
    assert len(target.events.closed.handlers) == 1


def test_startup_failure_remains_visible_on_splash(monkeypatch, tmp_path):
    splash = FakeWindow()

    class BrokenRuntime:
        def __init__(self, *_args):
            raise OSError(48, "Address already in use")

    monkeypatch.setattr(app, "CoffeeDeviceRuntime", BrokenRuntime)
    config = {
        "deviceId": "coffee-bot-003",
        "deviceName": "003 号设备",
        "backend": {"mode": "local"},
        "localApi": {"host": "127.0.0.1", "port": 8765},
    }

    app._launch_application(splash, config, tmp_path / "device.json", tmp_path, False)

    assert splash.events.loaded.wait_calls == [10]
    assert splash.calls == []
    assert len(splash.scripts) == 1
    assert "8765" in splash.scripts[0]
    assert "coffee-bot-003" in splash.scripts[0]
