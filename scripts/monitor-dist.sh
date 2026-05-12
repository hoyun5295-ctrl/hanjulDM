#!/bin/bash
# ============================================================
# hanjulDM dist 자동 감시 + 재빌드 (1분 cron)
# 분리 시점: 2026-05-12 (한줄AI monitor-dist와 완전 독립)
# ============================================================
# 등록: crontab -e
#   */1 * * * * /home/administrator/hanjuldm-app/scripts/monitor-dist.sh
#
# 한줄AI dist는 절대 건드리지 않음. hanjulDM dist만 감시.
# ============================================================

set -euo pipefail

BACKEND_DIR="/home/administrator/hanjuldm-app/packages/backend"
DIST_APP="$BACKEND_DIR/dist/app.js"
LOG_DIR="/home/administrator/hanjuldm-app/logs"
LOG_FILE="$LOG_DIR/monitor-dist.log"

mkdir -p "$LOG_DIR"

if [ ! -f "$DIST_APP" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] hanjulDM dist/app.js 부재 감지 — 자동 재빌드 시도" >> "$LOG_FILE"
  cd "$BACKEND_DIR"
  bash scripts/safe-build.sh >> "$LOG_FILE" 2>&1 || true
  if [ -f "$DIST_APP" ]; then
    pm2 restart hanjuldm-api >> "$LOG_FILE" 2>&1 || true
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 재빌드 성공 + pm2 restart 완료" >> "$LOG_FILE"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 재빌드 실패 — Harold 확인 필요" >> "$LOG_FILE"
  fi
fi

exit 0
