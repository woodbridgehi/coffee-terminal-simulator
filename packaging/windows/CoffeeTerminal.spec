# PyInstaller spec for the portable Windows build.
from pathlib import Path
import sys

from PyInstaller.utils.hooks import collect_submodules


project = Path(SPECPATH).parent.parent
# Conda's ``_ctypes.pyd`` links to ffi-*.dll under Library/bin.  PyInstaller
# does not always discover that dependency, which makes the windowed release
# exit during startup with ``ImportError: DLL load failed ... _ctypes``.
ffi_binaries = [
    (str(dll), ".")
    for dll in (Path(sys.prefix) / "Library" / "bin").glob("ffi*.dll")
]
datas = [
    (str(project / "coffee-terminal" / "web"), "coffee-terminal/web"),
    (str(project / "config" / "device.bootstrap.template.json"), "config"),
    (str(project / "config" / "instances" / "coffee-bot-003" / "materials.json"), "config/instances/coffee-bot-003"),
    (str(project / "config" / "instances" / "coffee-bot-003" / "failures.json"), "config/instances/coffee-bot-003"),
    (str(project / "config" / "instances" / "coffee-bot-003" / "recipes"), "config/instances/coffee-bot-003/recipes"),
]
hiddenimports = collect_submodules("clr_loader") + collect_submodules("pythonnet") + [
    "app",
    "backend",
    "catalog",
    "cloud",
    "configuration",
    "failures",
    "inventory",
    "local_api",
    "locales",
    "mqtt_transport",
    "onboarding",
    "platform_paths",
    "robot_view",
    "simulator_identity",
    "state_store",
    "showcase_packages",
    "windows_security",
]

a = Analysis(
    [str(project / "windows_entry.py")],
    pathex=[str(project / "coffee-terminal")],
    binaries=ffi_binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="CoffeeTerminal",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(project / "assets" / "coffee-bean.ico"),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="CoffeeTerminal",
)
