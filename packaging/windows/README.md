# Portable Windows build

This build uses PyInstaller only. It produces a portable
dist/CoffeeTerminal/ directory; zip that directory for distribution.

## Build on Windows

Run from the repository root in a clean Python environment:

~~~powershell
python -m pip install -r requirements.lock
python -m pip install pyinstaller
pyinstaller --clean packaging/windows/CoffeeTerminal.spec
~~~

The release artifact is:

~~~text
dist/CoffeeTerminal/CoffeeTerminal.exe
~~~

The first run creates the default instance under
%LOCALAPPDATA%\CoffeeTerminal\instances\default. The packaged entrypoint
enables Windows DPAPI protection for credentials and the simulator identity
private key. Do not add .secrets, .identity, state, or a real device.json
credential to the build input.

The package expects Microsoft WebView2 Runtime to be installed on the target
machine. The release ZIP should include a short prerequisite note or a
WebView2 Evergreen Standalone Installer for offline environments.
