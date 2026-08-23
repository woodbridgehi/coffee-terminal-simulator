#!/bin/bash
set -e
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"
"$PROJECT_ROOT/.venv/bin/python" "$PROJECT_ROOT/scripts/start_all.py"
