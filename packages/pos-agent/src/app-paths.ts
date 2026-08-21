/**
 * ★ 앱 데이터 경로 — 실행 위치와 무관하게 항상 같은 폴더를 쓴다.
 *
 * 문제: 옛 코드는 config/cache/log를 process.cwd() 기준으로 저장했다.
 *   Windows 서비스로 등록되면 cwd가 C:\Windows\System32 가 되어,
 *   설치 마법사가 쓴 agent-config.json을 못 찾아 매번 재설정에 빠진다.
 *
 * 해결: pkg로 묶인 exe면 exe가 있는 폴더, 개발(node 직접 실행)이면 cwd를 기준으로 고정한다.
 *   POS_AGENT_HOME 환경변수가 있으면 그걸 최우선으로 쓴다(서비스 등록 시 명시 지정 통로).
 */

import fs from 'fs';
import path from 'path';

/** 앱 홈 디렉토리 — config/cache/log가 모두 이 아래 놓인다 */
export function getAppHome(): string {
  const envHome = process.env.POS_AGENT_HOME;
  if (envHome && envHome.trim()) return envHome.trim();

  // pkg 빌드 exe면 process.execPath = ...\hanjul-pos-agent.exe → 그 폴더
  const exePath = process.execPath;
  const isPackagedExe = exePath.toLowerCase().endsWith('.exe') && !/node\.exe$/i.test(exePath);
  if (isPackagedExe) return path.dirname(exePath);

  // 개발 환경(node 직접 실행) — 현재 작업 디렉토리
  return process.cwd();
}

/** 앱 홈 아래 하위 경로. 필요 시 디렉토리 생성 */
export function appPath(...segments: string[]): string {
  return path.join(getAppHome(), ...segments);
}

/** 디렉토리 보장 후 경로 반환 */
export function ensureDir(dirPath: string): string {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // 권한 문제 등은 호출부에서 처리
  }
  return dirPath;
}
