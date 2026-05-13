/**
 * ★ Remote Command — 양방향 통신 채널 (Agent 측)
 *
 * 슈퍼관리자가 서버에서 명령 발행 → Agent가 long polling으로 즉시 수신 → 처리 → 결과 보고.
 *
 * 명령 종류 6종:
 *  - FORCE_SYNC            — 강제 싱크 (판매/회원/재고 즉시 추출)
 *  - RESEND_SCHEMA         — 스키마 재읽기 후 서버에 재전송 (재분석 트리거)
 *  - FETCH_LOGS            — 최근 로그 N줄 가져와 서버에 보고
 *  - REVOKE                — Agent 자살 (config.agentKey wipe + process exit)
 *  - UPDATE                — auto-updater 트리거 (새 버전 다운로드 + 재시작)
 *  - DIAGNOSE_MASK_BYPASS  — mask-bypass.diagnoseMaskBypass 호출 후 결과 보고
 *
 * Long polling 패턴:
 *  - Agent → 서버 POST /remote-command/poll (timeout 30s)
 *  - 서버에 명령 있으면 즉시 응답, 없으면 25초 wait 후 빈 응답
 *  - Agent는 빈 응답 시 즉시 재폴링 (1초 backoff)
 *  - 매장 1만 곳까지 1초 응답 시간 보장
 */

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { getConfig, saveConfig } from './config';
import { logger } from './logger';

// ============================================================
// 타입
// ============================================================

export type RemoteCommandType =
  | 'FORCE_SYNC'
  | 'RESEND_SCHEMA'
  | 'FETCH_LOGS'
  | 'REVOKE'
  | 'UPDATE'
  | 'DIAGNOSE_MASK_BYPASS';

export interface RemoteCommand {
  id: string;
  type: RemoteCommandType;
  payload?: any;
  issuedAt: string;
}

export interface RemoteCommandResult {
  commandId: string;
  ok: boolean;
  output?: any;
  error?: string;
  durationMs: number;
}

export interface RemoteCommandCallbacks {
  /** FORCE_SYNC 처리 — scheduler.ts의 강제 싱크 트리거 */
  onForceSync?: () => Promise<{ acceptedSales: number; acceptedMembers: number; acceptedInventory: number }>;
  /** RESEND_SCHEMA 처리 — schema-reader 재호출 후 서버 재분석 */
  onResendSchema?: () => Promise<{ confidence: number; memberTable: string | null }>;
  /** UPDATE 처리 — auto-updater 트리거 */
  onUpdateTrigger?: () => Promise<void>;
  /** DIAGNOSE_MASK_BYPASS 처리 — mask-bypass 진단 */
  onDiagnoseMaskBypass?: () => Promise<any>;
}

// ============================================================
// 상태
// ============================================================

let pollingActive = false;
let pollTimer: NodeJS.Timeout | null = null;
let callbacks: RemoteCommandCallbacks = {};

const POLL_TIMEOUT_MS = 30000;
const POLL_SERVER_WAIT_MS = 25000;
const POLL_BACKOFF_MS = 1000;
const POLL_ERROR_BACKOFF_MS = 10000;

// ============================================================
// 폴링 시작/종료
// ============================================================

export function startRemoteCommandPolling(initialCallbacks: RemoteCommandCallbacks): void {
  if (pollingActive) {
    logger.warn('Remote command polling 이미 가동 중');
    return;
  }
  callbacks = initialCallbacks;
  pollingActive = true;
  logger.info('Remote command polling 시작 (long polling 30s)');
  void pollLoop();
}

export function stopRemoteCommandPolling(): void {
  pollingActive = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('Remote command polling 종료');
}

// ============================================================
// 폴링 루프
// ============================================================

async function pollLoop(): Promise<void> {
  if (!pollingActive) return;

  let nextBackoff = POLL_BACKOFF_MS;

  try {
    const cmd = await pollForCommand();
    if (cmd) {
      logger.info(`remote-command 수신: ${cmd.type} (id=${cmd.id})`);
      const result = await handleCommand(cmd);
      await reportCommandResult(cmd.id, result);

      // REVOKE 명령은 process.exit으로 끝남 — 도달 시 폴링 중단
      if (cmd.type === 'REVOKE') {
        pollingActive = false;
        return;
      }
    }
  } catch (err: any) {
    logger.warn(`remote-command 폴링 에러: ${err.message}`);
    nextBackoff = POLL_ERROR_BACKOFF_MS;
  }

  pollTimer = setTimeout(pollLoop, nextBackoff);
}

// ============================================================
// 폴링 요청
// ============================================================

async function pollForCommand(): Promise<RemoteCommand | null> {
  const config = getConfig();
  const url = `${config.serverUrl}/api/flyer/pos/remote-command/poll`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': config.agentKey,
      },
      body: JSON.stringify({ waitMs: POLL_SERVER_WAIT_MS }),
      timeout: POLL_TIMEOUT_MS,
    });

    if (!res.ok) {
      if (res.status === 204) return null;
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json() as any;
    return data.command || null;
  } catch (err: any) {
    if (err.type === 'request-timeout' || /timeout/i.test(err.message)) {
      // 정상 timeout — 명령 없음
      return null;
    }
    throw err;
  }
}

// ============================================================
// 명령 처리
// ============================================================

async function handleCommand(cmd: RemoteCommand): Promise<RemoteCommandResult> {
  const start = Date.now();

  try {
    let output: any;

    switch (cmd.type) {
      case 'FORCE_SYNC':
        output = callbacks.onForceSync
          ? await callbacks.onForceSync()
          : { error: '강제 싱크 콜백 미박힘' };
        break;

      case 'RESEND_SCHEMA':
        output = callbacks.onResendSchema
          ? await callbacks.onResendSchema()
          : { error: '스키마 재전송 콜백 미박힘' };
        break;

      case 'FETCH_LOGS':
        output = await fetchRecentLogs(cmd.payload?.lines || 200);
        break;

      case 'REVOKE':
        await revokeAgent();
        output = { revoked: true };
        break;

      case 'UPDATE':
        output = callbacks.onUpdateTrigger
          ? await callbacks.onUpdateTrigger().then(() => ({ updateTriggered: true }))
          : { error: '업데이트 콜백 미박힘' };
        break;

      case 'DIAGNOSE_MASK_BYPASS':
        output = callbacks.onDiagnoseMaskBypass
          ? await callbacks.onDiagnoseMaskBypass()
          : { error: '진단 콜백 미박힘' };
        break;

      default:
        return {
          commandId: cmd.id,
          ok: false,
          error: `미지원 명령: ${cmd.type}`,
          durationMs: Date.now() - start,
        };
    }

    return {
      commandId: cmd.id,
      ok: true,
      output,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    logger.error(`명령 처리 실패 (${cmd.type}): ${err.message}`);
    return {
      commandId: cmd.id,
      ok: false,
      error: err.message,
      durationMs: Date.now() - start,
    };
  }
}

// ============================================================
// FETCH_LOGS 구현
// ============================================================

async function fetchRecentLogs(lines: number): Promise<{ logs: string[]; totalLines: number }> {
  const logDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logDir)) {
    return { logs: [], totalLines: 0 };
  }

  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(logDir, `agent-${today}.log`);
  if (!fs.existsSync(logFile)) {
    return { logs: [], totalLines: 0 };
  }

  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n').filter(l => l.trim().length > 0);
    const requestedLines = Math.min(lines, 500, allLines.length);
    return {
      logs: allLines.slice(-requestedLines),
      totalLines: allLines.length,
    };
  } catch (err: any) {
    logger.warn(`로그 읽기 실패: ${err.message}`);
    return { logs: [], totalLines: 0 };
  }
}

// ============================================================
// REVOKE 구현 — Agent 자살
// ============================================================

async function revokeAgent(): Promise<void> {
  logger.warn('★ REVOKE 명령 수신 — Agent 자살 시작');

  try {
    saveConfig({ agentKey: '' });
    logger.warn('agent-config.json: agentKey wipe 완료');
  } catch (err: any) {
    logger.error(`config wipe 실패: ${err.message}`);
  }

  // 1초 후 강제 종료 (서버에 결과 보고할 시간 확보)
  setTimeout(() => {
    logger.warn('REVOKE — process.exit(0)');
    process.exit(0);
  }, 1000);
}

// ============================================================
// 결과 보고
// ============================================================

async function reportCommandResult(commandId: string, result: RemoteCommandResult): Promise<void> {
  const config = getConfig();
  const url = `${config.serverUrl}/api/flyer/pos/remote-command/respond`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': config.agentKey,
      },
      body: JSON.stringify({
        commandId,
        ok: result.ok,
        output: result.output,
        error: result.error,
        durationMs: result.durationMs,
      }),
      timeout: 10000,
    });
    logger.info(`명령 결과 보고 완료: ${commandId} (${result.ok ? 'OK' : 'FAIL'}, ${result.durationMs}ms)`);
  } catch (err: any) {
    logger.error(`명령 결과 보고 실패 (${commandId}): ${err.message}`);
  }
}

// ============================================================
// 어댑터 후보 보고 (학습 루프)
// ============================================================

/** AI fallback 어댑터가 confidence 95%+로 성공 시 호출 — 학습 데이터로 서버에 보고 */
export async function reportAdapterCandidate(
  posType: string,
  mapping: any,
  detection: any
): Promise<void> {
  const config = getConfig();
  const url = `${config.serverUrl}/api/flyer/pos/adapter-candidate-report`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': config.agentKey,
      },
      body: JSON.stringify({ posType, mapping, detection }),
      timeout: 10000,
    });
    logger.info(`어댑터 후보 보고 완료: posType=${posType}`);
  } catch (err: any) {
    logger.warn(`어댑터 후보 보고 실패: ${err.message}`);
  }
}

/** Credential Discovery 시도 결과 보고 (학습 데이터) */
export async function reportCredentialDiscovery(
  posType: string,
  attemptedAdapters: string[],
  succeededAdapter: string | null,
  highestConfidence: number
): Promise<void> {
  const config = getConfig();
  const url = `${config.serverUrl}/api/flyer/pos/credential-discovery/report`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': config.agentKey,
      },
      body: JSON.stringify({ posType, attemptedAdapters, succeededAdapter, highestConfidence }),
      timeout: 10000,
    });
  } catch (err: any) {
    logger.debug(`Credential Discovery 결과 보고 실패: ${err.message}`);
  }
}
