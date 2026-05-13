/**
 * Windows 서비스 해제.
 * 관리자 권한 필요.
 */

const { execSync } = require('child_process');

const SERVICE_NAME = 'HanjulPosAgent';

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
    console.error('✗ 관리자 권한 필요');
    process.exit(1);
  }

  console.log(`Windows 서비스 해제 시작: ${SERVICE_NAME}`);

  // 1. 정지
  try {
    execSync(`sc.exe stop "${SERVICE_NAME}"`, { stdio: 'inherit', windowsHide: true });
    console.log('✓ 서비스 정지');
  } catch (err) {
    console.log('  (이미 정지됨 또는 미등록)');
  }

  // 2. 삭제
  try {
    execSync(`sc.exe delete "${SERVICE_NAME}"`, { stdio: 'inherit', windowsHide: true });
    console.log('✓ 서비스 제거 완료');
  } catch (err) {
    console.error('✗ 서비스 제거 실패:', err.message);
    process.exit(1);
  }
}

main();
