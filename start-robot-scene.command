#!/bin/bash
set -e
SCENE_ROOT="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$SCENE_ROOT/.venv/bin/python" ]; then
  exec "$SCENE_ROOT/.venv/bin/python" "$SCENE_ROOT/scripts/serve_scene.py" "$@"
else
  exec python3 "$SCENE_ROOT/scripts/serve_scene.py" "$@"
fi
