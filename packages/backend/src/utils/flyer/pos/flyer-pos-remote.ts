/**
 * ★ CT-F23 — 전단AI POS Agent 양방향 통신 컨트롤타워
 *
 * 슈퍼관리자가 발행한 원격 명령을 Agent에 long polling으로 전달.
 * Agent 처리 후 결과 보고 → 슈퍼관리자에 즉시 노출.
 *
 * 테이블: flyer_pos_commands (id/agent_id/type/payload/issued_by/status/issued_at/polled_at/responded_at/result)
 *
 * Polling 흐름:
 *  - Agent POST /remote-command/poll (waitMs=25000)
 *  - 서버: pollPendingCommand(agentId) — SELECT FOR UPDATE SKIP LOCKED (동시성 보장)
 *  - 대기 명령 없으면 200ms 간격 polling, 25초 후 빈 응답 (HTTP 204)
 *  - 대기 명령 있으면 즉시 응답 + status='polled' 마킹
 *
 * 명령 expire: 10분 = 'expired' 자동 마킹 (만료 대기 명령 cleanup 워커 별건)
 */

import { query } from '../../../config/database';

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

export type RemoteCommandStatus = 'pending' | 'polled' | 'completed' | 'failed' | 'expired';

export interface RemoteCommandRecord {
  id: string;
  agent_id: string;
  type: RemoteCommandType;
  payload: any;
  issued_by: string;
  issued_at: Date;
  polled_at: Date | null;
  responded_at: Date | null;
  result: any;
  error_message: string | null;
  status: RemoteCommandStatus;
}

// ============================================================
// 명령 발행 (슈퍼관리자 → DB)
// ============================================================

export async function issueRemoteCommand(
  agentId: string,
  type: RemoteCommandType,
  payload: any,
  issuedBy: string
): Promise<string> {
  const result = await query(
    `INSERT INTO flyer_pos_commands (agent_id, type, payload, issued_by, status, issued_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())
     RETURNING id`,
    [agentId, type, payload ? JSON.stringify(payload) : null, issuedBy]
  );

  return result.rows[0].id;
}

// ============================================================
// 명령 폴링 (Agent → 서버) — Long polling
// ============================================================

/**
 * Long polling으로 대기 명령 가져오기.
 *
 * @param agentId Agent ID
 * @param waitMs 최대 대기 시간 (기본 25초)
 * @returns 명령 또는 null (timeout)
 */
export async function pollPendingCommand(
  agentId: string,
  waitMs: number = 25000
): Promise<RemoteCommandRecord | null> {
  const startMs = Date.now();
  const pollIntervalMs = 200;

  while (Date.now() - startMs < waitMs) {
    const cmd = await dequeueOneCommand(agentId);
    if (cmd) return cmd;

    // 다음 폴링까지 200ms 대기
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  return null;
}

async function dequeueOneCommand(agentId: string): Promise<RemoteCommandRecord | null> {
  // SELECT FOR UPDATE SKIP LOCKED — 동시 Agent 폴링 시 단일 명령이 두 곳에 안 가도록
  const result = await query(
    `UPDATE flyer_pos_commands
     SET polled_at = NOW(), status = 'polled'
     WHERE id = (
       SELECT id FROM flyer_pos_commands
       WHERE agent_id = $1
         AND status = 'pending'
         AND issued_at > NOW() - INTERVAL '10 minutes'
       ORDER BY issued_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [agentId]
  );

  if (result.rows.length === 0) return null;
  return parseRow(result.rows[0]);
}

// ============================================================
// 명령 결과 보고 (Agent → 서버)
// ============================================================

export async function recordCommandResult(
  commandId: string,
  ok: boolean,
  output: any,
  error?: string,
  durationMs?: number
): Promise<void> {
  const status: RemoteCommandStatus = ok ? 'completed' : 'failed';

  await query(
    `UPDATE flyer_pos_commands
     SET responded_at = NOW(),
         result = $2,
         error_message = $3,
         duration_ms = $4,
         status = $5
     WHERE id = $1`,
    [
      commandId,
      output !== undefined ? JSON.stringify(output) : null,
      error || null,
      durationMs || null,
      status,
    ]
  );
}

// ============================================================
// 명령 이력 조회 (슈퍼관리자 UI)
// ============================================================

export async function listCommandHistory(
  agentId: string,
  limit: number = 50
): Promise<RemoteCommandRecord[]> {
  const result = await query(
    `SELECT * FROM flyer_pos_commands
     WHERE agent_id = $1
     ORDER BY issued_at DESC
     LIMIT $2`,
    [agentId, Math.min(limit, 200)]
  );

  return result.rows.map(parseRow);
}

export async function getCommandById(commandId: string): Promise<RemoteCommandRecord | null> {
  const result = await query(`SELECT * FROM flyer_pos_commands WHERE id = $1`, [commandId]);
  if (result.rows.length === 0) return null;
  return parseRow(result.rows[0]);
}

// ============================================================
// Expire 대기 명령 (10분 초과) — cron 워커에서 호출
// ============================================================

export async function expireOldCommands(): Promise<number> {
  const result = await query(
    `UPDATE flyer_pos_commands
     SET status = 'expired'
     WHERE status IN ('pending', 'polled')
       AND issued_at < NOW() - INTERVAL '10 minutes'
       AND responded_at IS NULL`
  );
  return result.rowCount || 0;
}

// ============================================================
// 어댑터 학습 후보 (Agent → 서버)
// ============================================================

export interface AdapterCandidate {
  posType: string;
  mapping: any;
  detection: any;
  agentId: string;
  reportedAt: Date;
}

export async function recordAdapterCandidate(
  agentId: string,
  posType: string,
  mapping: any,
  detection: any
): Promise<string> {
  const result = await query(
    `INSERT INTO flyer_pos_adapter_candidates
       (agent_id, pos_type, mapping, detection, status, reported_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())
     RETURNING id`,
    [agentId, posType, JSON.stringify(mapping), JSON.stringify(detection)]
  );
  return result.rows[0].id;
}

export async function listAdapterCandidates(status?: string): Promise<any[]> {
  const sql = status
    ? `SELECT * FROM flyer_pos_adapter_candidates WHERE status = $1 ORDER BY reported_at DESC LIMIT 100`
    : `SELECT * FROM flyer_pos_adapter_candidates ORDER BY reported_at DESC LIMIT 100`;
  const result = status ? await query(sql, [status]) : await query(sql);
  return result.rows;
}

// ============================================================
// Credential Discovery 학습 로그 (Agent → 서버)
// ============================================================

export async function recordCredentialDiscoveryLog(
  agentId: string,
  posType: string,
  attemptedAdapters: string[],
  succeededAdapter: string | null,
  highestConfidence: number
): Promise<void> {
  await query(
    `INSERT INTO flyer_credential_discovery_log
       (agent_id, pos_type, attempted_adapters, succeeded_adapter, highest_confidence, reported_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [agentId, posType, JSON.stringify(attemptedAdapters), succeededAdapter, highestConfidence]
  );
}

// ============================================================
// 자동 업데이트 (서버 측)
// ============================================================

export interface AgentUpdateInfo {
  available: boolean;
  latestVersion?: string;
  downloadUrl?: string;
  checksum?: string;
  fileSize?: number;
  releaseNotes?: string;
  mandatory?: boolean;
}

const LATEST_AGENT_VERSION_KEY = 'latest_pos_agent_version';

export async function getLatestAgentInfo(currentVersion: string): Promise<AgentUpdateInfo> {
  // 슈퍼관리자가 신규 .exe 업로드 시 flyer_settings에 저장하는 패턴
  const result = await query(
    `SELECT setting_value FROM flyer_settings WHERE setting_key = $1`,
    [LATEST_AGENT_VERSION_KEY]
  );

  if (result.rows.length === 0) {
    return { available: false };
  }

  let latestInfo: AgentUpdateInfo;
  try {
    latestInfo = JSON.parse(result.rows[0].setting_value);
  } catch {
    return { available: false };
  }

  // 버전 비교 (semver simple)
  if (!latestInfo.latestVersion || !isNewerVersion(latestInfo.latestVersion, currentVersion)) {
    return { available: false };
  }

  return {
    ...latestInfo,
    available: true,
  };
}

export async function recordAgentInstalled(
  agentId: string,
  version: string,
  installedAt: string
): Promise<void> {
  await query(
    `UPDATE flyer_pos_agents
     SET agent_version = $2, last_update_at = $3, updated_at = NOW()
     WHERE id = $1`,
    [agentId, version, installedAt]
  );
}

function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(s => parseInt(s) || 0);
  const pb = b.split('.').map(s => parseInt(s) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return false;
}

// ============================================================
// row → record 변환
// ============================================================

function parseRow(row: any): RemoteCommandRecord {
  return {
    id: row.id,
    agent_id: row.agent_id,
    type: row.type,
    payload: row.payload,
    issued_by: row.issued_by,
    issued_at: row.issued_at,
    polled_at: row.polled_at,
    responded_at: row.responded_at,
    result: row.result,
    error_message: row.error_message,
    status: row.status,
  };
}
