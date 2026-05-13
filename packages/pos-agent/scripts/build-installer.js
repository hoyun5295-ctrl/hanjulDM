/**
 * NSIS 인스톨러 빌드 자동화.
 *
 * 사전 요건:
 *  1. NSIS 3.x 설치 (https://nsis.sourceforge.io/Download)
 *     기본 경로: C:\Program Files (x86)\NSIS\makensis.exe
 *     또는 NSIS_PATH 환경변수로 지정.
 *  2. npm run build:exe 먼저 실행 (build/hanjul-pos-agent.exe 박혀있어야 함)
 *
 * 흐름:
 *  1. NSIS 컴파일러 경로 확인
 *  2. build/hanjul-pos-agent.exe 존재 확인 (사전 빌드 필수)
 *  3. installer/installer.nsi 컴파일 → build/Setup-{version}.exe 출력
 *  4. checksum (SHA-256) 계산 + 출력
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const NSI_FILE = path.join(ROOT_DIR, 'installer', 'installer.nsi');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const EXE_FILE = path.join(BUILD_DIR, 'hanjul-pos-agent.exe');

const NSIS_COMPILER = process.env.NSIS_PATH || 'C:\\Program Files (x86)\\NSIS\\makensis.exe';

// ============================================================
// 사전 검증
// ============================================================

function checkPrerequisites() {
  if (!fs.existsSync(NSIS_COMPILER)) {
    console.error(`✗ NSIS 컴파일러 없음: ${NSIS_COMPILER}`);
    console.error('  NSIS 설치: https://nsis.sourceforge.io/Download');
    console.error('  또는 NSIS_PATH 환경변수로 경로 지정: $env:NSIS_PATH="C:\\path\\to\\makensis.exe"');
    process.exit(1);
  }

  if (!fs.existsSync(EXE_FILE)) {
    console.error(`✗ Agent .exe 없음: ${EXE_FILE}`);
    console.error('  먼저 실행: npm run build:exe');
    process.exit(1);
  }

  if (!fs.existsSync(NSI_FILE)) {
    console.error(`✗ NSI 스크립트 없음: ${NSI_FILE}`);
    process.exit(1);
  }
}

// ============================================================
// 버전 추출 (package.json)
// ============================================================

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
  return pkg.version || '1.0.0';
}

// ============================================================
// 빌드
// ============================================================

function buildInstaller() {
  console.log(`NSIS 인스톨러 빌드 시작...`);
  console.log(`  NSIS: ${NSIS_COMPILER}`);
  console.log(`  NSI:  ${NSI_FILE}`);

  try {
    execSync(`"${NSIS_COMPILER}" /V2 "${NSI_FILE}"`, {
      stdio: 'inherit',
      cwd: path.dirname(NSI_FILE),
    });
  } catch (err) {
    console.error('✗ NSIS 컴파일 실패:', err.message);
    process.exit(1);
  }
}

// ============================================================
// checksum 계산
// ============================================================

function computeChecksum(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ============================================================
// 메인
// ============================================================

(async () => {
  checkPrerequisites();
  const version = getVersion();

  buildInstaller();

  const outputFile = path.join(BUILD_DIR, `Setup-${version}.exe`);
  if (!fs.existsSync(outputFile)) {
    console.error(`✗ 출력 파일 없음: ${outputFile}`);
    process.exit(1);
  }

  const checksum = computeChecksum(outputFile);
  const fileSize = fs.statSync(outputFile).size;

  console.log('\n✓ 인스톨러 빌드 완료');
  console.log(`  파일:     ${outputFile}`);
  console.log(`  크기:     ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  SHA-256:  ${checksum}`);
  console.log('\n슈퍼관리자 자동 업데이트 등록 SQL (주인님 psql 실행):');
  console.log(`
INSERT INTO flyer_settings (setting_key, setting_value)
VALUES ('latest_pos_agent_version', '{
  "latestVersion": "${version}",
  "downloadUrl": "https://hanjul-flyer.kr/downloads/Setup-${version}.exe",
  "checksum": "${checksum}",
  "fileSize": ${fileSize},
  "releaseNotes": "v${version} — POS Agent V2 (Credential Discovery + Mask Bypass + 양방향)",
  "mandatory": false
}')
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = EXCLUDED.setting_value,
  updated_at = NOW();
`);
})();
