/**
 * exe 빌드 후 native 모듈을 build/ 폴더에 복사.
 *
 * V2 박힘 (D159):
 *  - better-sqlite3 (.node)   — local-cache.ts 의존
 *  - systray2 tray_windows.exe — tray.ts 의존
 *  - tedious/mysql2는 pure JS이므로 native 복사 X (pkg에 포함됨)
 *  - winreg도 pure JS (pkg 포함)
 *  - assets/icon-*.ico         — tray.ts 트레이 아이콘 (placeholder 박힘, 실 .ico는 별건 디자인)
 *  - 기본 agent-config.json    — 첫 실행 시 setup-wizard가 덮어씀
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const NODE_MODULES = path.join(__dirname, '..', 'node_modules');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// ============================================================
// 유틸
// ============================================================

function findNativeFile(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = findNativeFile(full, pattern);
      if (found) return found;
    } else if (e.name.endsWith('.node') && full.includes(pattern)) {
      return full;
    }
  }
  return null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyIfExists(src, dest, label) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✓ ${label}: ${dest}`);
    return true;
  } else {
    console.log(`⚠ ${label} 파일 없음: ${src}`);
    return false;
  }
}

// ============================================================
// build/ 디렉토리 확인
// ============================================================

ensureDir(BUILD_DIR);
ensureDir(path.join(BUILD_DIR, 'assets'));

// ============================================================
// 1. better-sqlite3 native 복사
// ============================================================

const sqliteNative = findNativeFile(
  path.join(NODE_MODULES, 'better-sqlite3'),
  'better_sqlite3'
);

if (sqliteNative) {
  fs.copyFileSync(sqliteNative, path.join(BUILD_DIR, 'better_sqlite3.node'));
  console.log(`✓ better-sqlite3 native 복사: ${path.join(BUILD_DIR, 'better_sqlite3.node')}`);
} else {
  console.log('⚠ better-sqlite3 native 파일을 찾을 수 없습니다.');
}

// ============================================================
// 2. systray2 native binary 복사 (Windows tray helper)
// ============================================================

const systrayBin = path.join(NODE_MODULES, 'systray2', 'traybin', 'tray_windows.exe');
copyIfExists(systrayBin, path.join(BUILD_DIR, 'tray_windows.exe'), 'systray2 native (Windows)');

const systrayBinRelease = path.join(NODE_MODULES, 'systray2', 'traybin', 'tray_windows_release.exe');
copyIfExists(systrayBinRelease, path.join(BUILD_DIR, 'tray_windows_release.exe'), 'systray2 native release (옵션)');

// ============================================================
// 3. 트레이 아이콘 assets 복사 (없으면 fallback 박혀있음)
// ============================================================

if (fs.existsSync(ASSETS_DIR)) {
  const iconFiles = ['icon.ico', 'icon-green.ico', 'icon-yellow.ico', 'icon-red.ico', 'icon-gray.ico'];
  for (const f of iconFiles) {
    copyIfExists(
      path.join(ASSETS_DIR, f),
      path.join(BUILD_DIR, 'assets', f),
      `아이콘 ${f}`
    );
  }
} else {
  console.log('⚠ assets/ 폴더 없음 — 트레이 아이콘 fallback 박힘 (tray.ts FALLBACK_ICON_BASE64)');
}

// ============================================================
// 4. installer/LICENSE-DATA-POLICY.txt 복사 (NSIS가 참조)
// ============================================================

const licenseFile = path.join(__dirname, '..', 'installer', 'LICENSE-DATA-POLICY.txt');
if (fs.existsSync(licenseFile)) {
  copyIfExists(licenseFile, path.join(BUILD_DIR, 'LICENSE-DATA-POLICY.txt'), '약관 파일');
}

// ============================================================
// 5. 기본 agent-config.json 템플릿 생성
// ============================================================

const configTemplate = {
  serverUrl: 'https://hanjul-flyer.kr',
  agentKey: '',
  db: {
    type: 'mssql',
    host: 'localhost',
    port: 1433,
    database: '',
    username: 'sa',
    password: '',
  },
  sync: {
    salesIntervalMinutes: 5,
    membersIntervalMinutes: 30,
    inventoryIntervalMinutes: 60,
    heartbeatIntervalSeconds: 60,
    batchSize: 500,
  },
};

const configDest = path.join(BUILD_DIR, 'agent-config.json');
if (!fs.existsSync(configDest)) {
  fs.writeFileSync(configDest, JSON.stringify(configTemplate, null, 2), 'utf-8');
  console.log(`✓ 기본 설정 파일 생성: ${configDest}`);
}

// ============================================================
// 6. scripts/ 폴더 복사 (서비스 등록/해제 스크립트)
// ============================================================

const scriptsDest = path.join(BUILD_DIR, 'scripts');
ensureDir(scriptsDest);
const scriptFiles = ['install-service.js', 'uninstall-service.js'];
for (const f of scriptFiles) {
  copyIfExists(
    path.join(__dirname, f),
    path.join(scriptsDest, f),
    `서비스 스크립트 ${f}`
  );
}

console.log('\n빌드 완료! build/ 폴더 내용:');
console.log('  - hanjul-pos-agent.exe       (메인 실행 파일)');
console.log('  - better_sqlite3.node        (SQLite native)');
console.log('  - tray_windows.exe           (트레이 helper)');
console.log('  - agent-config.json          (기본 설정 템플릿)');
console.log('  - assets/                    (트레이 아이콘)');
console.log('  - scripts/                   (서비스 install/uninstall)');
console.log('  - LICENSE-DATA-POLICY.txt    (약관)');
console.log('\n인스톨러 빌드: npm run build:installer');
console.log('실행: hanjul-pos-agent.exe (첫 실행 시 설치 마법사 자동 시작)');
