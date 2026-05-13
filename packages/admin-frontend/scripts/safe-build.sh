#!/bin/bash
# D155 (2026-05-13) — admin-frontend atomic deploy 패턴 (frontend safe-build.sh 미러)
# 슈퍼관리자(sys.hanjul-flyer.co.kr) dist atomic swap.
set -euo pipefail
cd "$(dirname "$0")/.."

DIST_DIR="$(pwd)/dist"
DIST_NEW="$(pwd)/dist-new"
DIST_OLD="$(pwd)/dist-old"

echo "[atomic-build:admin] $(date '+%Y-%m-%d %H:%M:%S')"

# devDependencies 누락 자동 차단 안전망 (D151-6 패턴 미러)
if [ ! -d "node_modules/typescript" ]; then
  echo "[atomic-build:admin] devDependencies 누락 감지. npm install --include=dev 자동 실행"
  npm install --include=dev
fi

if [ -d "$DIST_NEW" ]; then rm -rf "$DIST_NEW"; fi

npx tsc -b
npx vite build --outDir dist-new

if [ ! -f "$DIST_NEW/index.html" ]; then
  echo "❌ [admin] index.html 없음 / 옛 dist 유지"
  rm -rf "$DIST_NEW"; exit 1
fi

INDEX_SIZE=$(stat -c %s "$DIST_NEW/index.html" 2>/dev/null || stat -f %z "$DIST_NEW/index.html")
if [ "$INDEX_SIZE" -lt 100 ]; then
  echo "❌ [admin] index.html 비정상 사이즈 ($INDEX_SIZE bytes) / 옛 dist 유지"
  rm -rf "$DIST_NEW"; exit 1
fi

if [ ! -d "$DIST_NEW/assets" ]; then
  echo "❌ [admin] assets 없음 / 옛 dist 유지"
  rm -rf "$DIST_NEW"; exit 1
fi

if [ -d "$DIST_OLD" ]; then rm -rf "$DIST_OLD"; fi
if [ -d "$DIST_DIR" ]; then mv "$DIST_DIR" "$DIST_OLD"; fi
mv "$DIST_NEW" "$DIST_DIR"

echo "✅ [admin] swap 완료 ($INDEX_SIZE bytes)"
exit 0
