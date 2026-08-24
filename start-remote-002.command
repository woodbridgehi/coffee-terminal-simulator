#!/bin/bash
set -e
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
SECRET_FILE="$PROJECT_ROOT/.secrets/coffee-bot-002.env"
if [ ! -f "$SECRET_FILE" ]; then
  echo "缺少凭证文件：$SECRET_FILE"
  echo "请先按 plan-gpt/10-vps-online-mvp/04-deployment-guide.md 部署并同步凭证。"
  exit 1
fi
exec "$PROJECT_ROOT/start-instance.command" coffee-bot-002 --env-file "$SECRET_FILE"

