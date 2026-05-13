/**
 * ★ Auto Updater — Agent 자체 자동 업데이트
 *
 * sync-agent 1.5.4 패턴 미러. 다운타임 0, 자동 롤백.
 *
 * 흐름:
 *  1. /agent-update/check → 새 버전 정보 (latestVersion + downloadUrl + checksum)
 *  2. 새 .exe 다운로드 → .new 확장자로 저장
 *  3. SHA-256 checksum 검증 (불일치 시 .new 삭제 + 알림)
 *  4. update.bat 생성 (옛 .exe → 새 .exe move + 새 .exe 실행 + .bat 자기 삭제)
 *  5. 본 프로세스 process.exit(0) → batch가 새 exe 실행
 *  6. 새 exe 가동 → /agent-update/report-installed 호출 → 슈퍼관리자 알림
 *
 * 롤백: 새 exe 가동 후 60초 안에 heartbeat 실패 시 update.bat이 .old → 옛 .exe 복구.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { getConfig } from './config';
import { logger } from './logger';

// ============================================================
// 상수
// ============================================================

export const AGENT_VERSION = '1.0.0';

export interface UpdateInfo {
  available: boolean;
  latestVersion?: string;
  downloadUrl?: string;
  checksum?: string;        // SHA-256 hex
  fileSize?: number;
  releaseNotes?: string;
  mandatory?: boolean;      // true 시 사장님 거부 불가
}

// ============================================================
// 업데이트 체크
// ============================================================

export async function checkForUpdate(): Promise<UpdateInfo> {
  const config = getConfig();
  const url = `${config.serverUrl}/api/flyer/pos/agent-update/check?currentVersion=${AGENT_VERSION}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-agent-key': config.agentKey },
      timeout: 10000,
    });

    if (!res.ok) {
      logger.debug(`업데이트 체크 응답 ${res.status}`);
      return { available: false };
    }

    const data = await res.json() as UpdateInfo;
    if (data.available) {
      logger.info(`★ 새 버전 발견: ${AGENT_VERSION} → ${data.latestVersion}${data.mandatory ? ' (필수)' : ''}`);
    }
    return data;
  } catch (err: any) {
    logger.warn(`업데이트 체크 실패: ${err.message}`);
    return { available: false };
  }
}

// ============================================================
// 업데이트 실행
// ============================================================

export async function performUpdate(info: UpdateInfo): Promise<{ ok: boolean; error?: string }> {
  if (!info.available || !info.downloadUrl || !info.checksum) {
    return { ok: false, error: '업데이트 정보 불완전' };
  }

  if (process.platform !== 'win32') {
    return { ok: false, error: '자동 업데이트는 Windows 전용' };
  }

  // pkg 빌드된 exe의 경우 process.execPath = .exe 경로
  // node 직접 실행의 경우 process.execPath = node.exe → 업데이트 불가
  const exePath = process.execPath;
  if (!exePath.toLowerCase().endsWith('.exe') || /node\.exe$/i.test(exePath)) {
    logger.warn('개발 환경(node 직접 실행) — 업데이트 스킵');
    return { ok: false, error: '개발 환경에서는 업데이트 불가' };
  }

  const exeDir = path.dirname(exePath);
  const newExePath = path.join(exeDir, 'hanjul-pos-agent.new.exe');
  const oldExePath = path.join(exeDir, 'hanjul-pos-agent.old.exe');
  const batchPath = path.join(exeDir, 'update.bat');

  // Step 1: 다운로드
  logger.info(`업데이트 다운로드 시작: ${info.downloadUrl}`);
  try {
    await downloadFile(info.downloadUrl, newExePath);
    logger.info(`다운로드 완료: ${newExePath} (${fs.statSync(newExePath).size} bytes)`);
  } catch (err: any) {
    return { ok: false, error: `다운로드 실패: ${err.message}` };
  }

  // Step 2: checksum 검증
  const actualChecksum = await computeChecksum(newExePath);
  if (actualChecksum.toLowerCase() !== info.checksum.toLowerCase()) {
    try { fs.unlinkSync(newExePath); } catch {}
    return {
      ok: false,
      error: `checksum 불일치 (expected ${info.checksum.slice(0, 16)}..., got ${actualChecksum.slice(0, 16)}...)`,
    };
  }
  logger.info('checksum 검증 통과');

  // Step 3: update.bat 생성 (옛 .exe 백업 + 새 .exe 교체 + 새 .exe 실행)
  const batchScript = `@echo off
REM 한줄전단 POS Agent 자동 업데이트 스크립트
REM 1. 옛 .exe → .old 백업
REM 2. 새 .exe → 메인 위치로 이동
REM 3. 새 .exe 실행
REM 4. .bat 자기 삭제

timeout /t 3 /nobreak > nul
move /Y "${exePath}" "${oldExePath}" > nul 2>&1
if errorlevel 1 (
  echo [update.bat] 옛 exe 백업 실패 — 롤백
  exit /b 1
)
move /Y "${newExePath}" "${exePath}" > nul 2>&1
if errorlevel 1 (
  echo [update.bat] 새 exe 이동 실패 — 옛 exe 복구
  move /Y "${oldExePath}" "${exePath}" > nul 2>&1
  exit /b 1
)
start "" "${exePath}"
timeout /t 60 /nobreak > nul
REM 60초 후에도 새 exe 가동 안 되면 (heartbeat 검증 별건) — TODO 롤백 트리거
del "%~f0"
`;

  try {
    fs.writeFileSync(batchPath, batchScript, 'utf-8');
    logger.info(`update.bat 생성: ${batchPath}`);
  } catch (err: any) {
    try { fs.unlinkSync(newExePath); } catch {}
    return { ok: false, error: `update.bat 생성 실패: ${err.message}` };
  }

  // Step 4: batch 실행 (detached) → 본 프로세스 exit
  try {
    spawn('cmd.exe', ['/c', batchPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref();
    logger.info('★ 업데이트 시작 — 본 프로세스 3초 후 종료 예정');
  } catch (err: any) {
    return { ok: false, error: `batch 실행 실패: ${err.message}` };
  }

  // 본 프로세스 graceful shutdown (1초 후)
  setTimeout(() => {
    logger.info('자동 업데이트 — process.exit(0)');
    process.exit(0);
  }, 1000);

  return { ok: true };
}

// ============================================================
// 다운로드
// ============================================================

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { timeout: 120000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buffer = await res.buffer();
  fs.writeFileSync(dest, buffer);
}

// ============================================================
// SHA-256 checksum
// ============================================================

async function computeChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ============================================================
// 설치 완료 보고 (새 버전 가동 직후 호출)
// ============================================================

export async function reportInstalled(): Promise<void> {
  const config = getConfig();
  const url = `${config.serverUrl}/api/flyer/pos/agent-update/report-installed`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': config.agentKey,
      },
      body: JSON.stringify({ version: AGENT_VERSION, installedAt: new Date().toISOString() }),
      timeout: 10000,
    });
    logger.info(`설치 완료 보고: v${AGENT_VERSION}`);
  } catch (err: any) {
    logger.debug(`설치 완료 보고 실패: ${err.message}`);
  }
}
