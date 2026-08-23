#!/bin/bash
set -e
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"
INSTANCE="${1:-coffee-bot-001}"
"$PROJECT_ROOT/.venv/bin/python" "$PROJECT_ROOT/scripts/start_instance.py" "$INSTANCE"
