#!/bin/bash
# ============================================================
# hanjulDM Atomic deploy 패턴 — 3 패키지 통합 빌드
# 분리 시점: 2026-05-12 (D152) (한줄AI safe-build.sh와 완전 독립)
# D155 (2026-05-13) — root 통합 빌드 스크립트 신규 (누락 fix)
# ============================================================
# 동작: backend → frontend → admin-frontend 순차 atomic 빌드
# 각 패키지 자체 scripts/safe-build.sh 호출 (atomic swap 패턴)
# 한 패키지 실패 = 즉시 종료 (set -e), 다른 패키지 dist 영향 0
# ============================================================

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

echo "============================================================"
echo "[hanjulDM atomic safe-build] 시작 — $(date '+%Y-%m-%d %H:%M:%S')"
echo "[hanjulDM atomic safe-build] root: $ROOT_DIR"
echo "============================================================"

# (1/3) backend
echo ""
echo "─── [1/3] backend ────────────────────────────────────"
cd "$ROOT_DIR/packages/backend"
bash scripts/safe-build.sh

# (2/3) frontend (매장 사장님)
echo ""
echo "─── [2/3] frontend ───────────────────────────────────"
cd "$ROOT_DIR/packages/frontend"
bash scripts/safe-build.sh

# (3/3) admin-frontend (슈퍼관리자)
echo ""
echo "─── [3/3] admin-frontend ─────────────────────────────"
cd "$ROOT_DIR/packages/admin-frontend"
bash scripts/safe-build.sh

echo ""
echo "============================================================"
echo "[hanjulDM atomic safe-build] 3 패키지 모두 완료 — $(date '+%Y-%m-%d %H:%M:%S')"
echo "   다음 단계: pm2 restart hanjuldm-api (backend 새 dist 적용)"
echo "   nginx reload 불요 (frontend/admin-frontend dist swap 자동)"
echo "============================================================"
exit 0
