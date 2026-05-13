/**
 * Windows 서비스 등록 — sc.exe 직접 사용.
 *
 * 관리자 권한으로 실행 필요.
 *
 * 옵션:
 *  - 자동 시작 (start=auto)
 *  - 실패 시 60초 후 자동 재시작 (3회)
 *  - 86400초 (24시간) 후 카운터 리셋
 *
 * 사용:
 *  - 인스톨러에서 자동 호출 (installer.nsi SecService)
 *  - 수동: npm run service:install (관리자 권한)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SERVICE_NAME = 'HanjulPosAgent';
const DISPLAY_NAME = '한줄전단 POS Agent';
const DESCRIPTION = '매장 POS 데이터 자동 수집 (한줄전단AI)';

function findExePath() {
  // 인스톨러에서 실행: scripts/ 와 hanjul-pos-agent.exe가 같은 부모 디렉토리
  const installedExe = path.join(__dirname, '..', 'hanjul-pos-agent.exe');
  if (fs.existsSync(installedExe)) return installedExe;

  // 개발 환경: build/hanjul-pos-agent.exe
  const buildExe = path.join(__dirname, '..', 'build', 'hanjul-pos-agent.exe');
  if (fs.existsSync(buildExe)) return buildExe;

  return null;
}

function isElevated() {
  try {
    execSync('net session', { stdio: 'pipe', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function main() {
  if (process.platform !== 'win32') {
    console.error('✗ Windows 전용 스크립트');
    process.exit(1);
  }

  if (!isElevated()) {
    console.error('✗ 관리자 권한 필요 — PowerShell을 "관리자 권한으로 실행"');
    process.exit(1);
  }

  const exePath = findExePath();
  if (!exePath) {
    console.error('✗ hanjul-pos-agent.exe 없음');
    console.error('  설치 후 또는 npm run build:exe 후 실행');
    process.exit(1);
  }

  console.log(`Windows 서비스 등록 시작: ${SERVICE_NAME}`);
  console.log(`  exe: ${exePath}`);

  // 1. 기존 서비스 제거 (있으면)
  try {
    execSync(`sc.exe stop "${SERVICE_NAME}"`, { stdio: 'pipe', windowsHide: true });
  } catch {}
  try {
    execSync(`sc.exe delete "${SERVICE_NAME}"`, { stdio: 'pipe', windowsHide: true });
    console.log('  기존 서비스 제거됨');
  } catch {}

  // 2. 신규 등록
  try {
    execSync(
      `sc.exe create "${SERVICE_NAME}" binPath= "${exePath}" start= auto DisplayName= "${DISPLAY_NAME}"`,
      { stdio: 'inherit', windowsHide: true }
    );
    console.log('✓ 서비스 등록 완료');
  } catch (err) {
    console.error('✗ 서비스 등록 실패:', err.message);
    process.exit(1);
  }

  // 3. 설명 추가
  try {
    execSync(`sc.exe description "${SERVICE_NAME}" "${DESCRIPTION}"`, {
      stdio: 'pipe',
      windowsHide: true,
    });
  } catch {}

  // 4. 자동 재시작 정책 (실패 시 60초 후, 3회 시도, 86400초 후 카운터 리셋)
  try {
    execSync(
      `sc.exe failure "${SERVICE_NAME}" reset= 86400 actions= restart/60000/restart/60000/restart/60000`,
      { stdio: 'inherit', windowsHide: true }
    );
    console.log('✓ 자동 재시작 정책 박힘');
  } catch {}

  // 5. 즉시 시작
  try {
    execSync(`sc.exe start "${SERVICE_NAME}"`, { stdio: 'inherit', windowsHide: true });
    console.log('✓ 서비스 가동 시작');
  } catch (err) {
    console.error('⚠ 서비스 시작 실패 (수동 가동 필요):', err.message);
  }

  console.log('\n서비스 상태 확인: sc.exe query HanjulPosAgent');
  console.log('서비스 해제:      npm run service:uninstall');
}

main();
