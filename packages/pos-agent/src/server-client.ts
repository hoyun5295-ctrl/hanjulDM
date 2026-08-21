/**
 * POS Agent → 한줄전단 서버 통신 클라이언트
 *
 * 모든 서버 API 호출의 단일 진입점.
 * agent_key 기반 인증 (x-agent-key 헤더).
 */

import fetch from 'node-fetch';
import { getConfig, saveConfig } from './config';
import { logger } from './logger';

interface ServerResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** 서버 API 호출 공통 함수 */
async function apiCall<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: any
): Promise<ServerResponse<T>> {
  const config = getConfig();
  const url = `${config.serverUrl}/api/flyer/pos${endpoint}`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': config.agentKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      timeout: 30000,
    });

    const data = await res.json() as any;

    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }

    return { ok: true, data };
  } catch (err: any) {
    logger.error(`API 호출 실패: ${endpoint}`, err.message);
    return { ok: false, error: err.message };
  }
}

/** Agent 등록 (최초 실행 시) */
export async function registerAgent(info: {
  hostname: string;
  ip_address?: string;
  pos_type?: string;
  pos_version?: string;
}) {
  const res = await apiCall<{
    agentId: string;
    companyId: string;
    companyName?: string;
    schemaMapping: any;
    message: string;
  }>('POST', '/register', info);

  if (res.ok && res.data) {
    logger.info(`Agent 등록 완료: ${res.data.message}`);
    // 서버에서 받은 설정으로 업데이트
    if (res.data.schemaMapping) {
      logger.info('기존 스키마 매핑 로드됨');
    }
  }
  return res;
}

/** AI 스키마 분석 요청 */
export async function requestSchemaAnalysis(rawSchema: {
  dbType: string;
  tables: Array<{
    name: string;
    columns: Array<{ name: string; dataType: string; nullable: boolean; maxLength?: number; isPrimaryKey?: boolean }>;
    rowCount?: number;
  }>;
  samples?: Record<string, any[]>;
}) {
  logger.info(`AI 스키마 분석 요청: ${rawSchema.tables.length}개 테이블`);
  const res = await apiCall<{ mapping: any; message: string }>('POST', '/analyze-schema', rawSchema);

  if (res.ok && res.data?.mapping) {
    logger.info(`스키마 분석 완료: confidence ${res.data.mapping.confidence}%`);
    logger.info(`회원 테이블: ${res.data.mapping.memberTable}, 판매: ${res.data.mapping.salesTable}`);
  }
  return res;
}

/** Agent 설정 다운로드 */
export async function fetchConfig() {
  const res = await apiCall<{
    schemaMapping: any;
    syncConfig: {
      salesIntervalMinutes: number;
      membersIntervalMinutes: number;
      inventoryIntervalMinutes: number;
      heartbeatIntervalSeconds: number;
      batchSize: number;
    };
  }>('GET', '/config');

  if (res.ok && res.data?.syncConfig) {
    // 서버 설정으로 로컬 업데이트
    saveConfig({ sync: res.data.syncConfig });
    logger.debug('서버 설정 동기화 완료');
  }
  return res;
}

/**
 * 데이터 푸시.
 *
 * ★ 반환에 transportFailedIndices를 포함한다(items[] 기준 절대 인덱스).
 *   = 전송 자체가 실패해 서버에 닿지 못한 항목. cache-pusher는 이 항목만 큐에 남겨 재전송하고,
 *     나머지(서버가 받았거나 잘못된 데이터라 되돌려보낸 것)는 삭제한다.
 *   옛 구조는 배치 하나만 성공해도 전체를 pushed 처리해 실패분이 유실됐다 — 그 구멍을 닫는다.
 */
export async function pushData(
  type: 'sales' | 'members' | 'inventory',
  items: any[]
): Promise<{ ok: boolean; data: { accepted: number; rejected: number; errors: any[] }; transportFailedIndices: number[]; error?: string }> {
  if (items.length === 0) return { ok: true, data: { accepted: 0, rejected: 0, errors: [] }, transportFailedIndices: [] };

  const config = getConfig();
  const batchSize = config.sync.batchSize || 500;

  let totalAccepted = 0;
  let totalRejected = 0;
  const allErrors: any[] = [];
  const transportFailedIndices: number[] = [];

  // 배치 분할 전송
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const res = await apiCall<{ accepted: number; rejected: number; errors: any[] }>('POST', '/push', { type, items: batch });

    if (res.ok && res.data) {
      // 서버가 받았다 — accepted/rejected는 서버 판정. 잘못된 데이터(rejected)는 재전송해도 안 되므로 큐에서 뺀다.
      totalAccepted += res.data.accepted;
      totalRejected += res.data.rejected;
      allErrors.push(...(res.data.errors || []));
    } else {
      // 전송 실패 — 이 배치 전 항목은 서버에 닿지 못했다. 절대 인덱스로 남겨 재전송한다.
      totalRejected += batch.length;
      for (let k = 0; k < batch.length; k++) transportFailedIndices.push(i + k);
      allErrors.push({ index: i, reason: res.error || 'batch failed' });
    }
  }

  logger.info(`[${type}] push 완료: accepted=${totalAccepted}, rejected=${totalRejected}, 전송실패=${transportFailedIndices.length}`);

  return {
    ok: transportFailedIndices.length === 0,
    data: { accepted: totalAccepted, rejected: totalRejected, errors: allErrors },
    transportFailedIndices,
    error: transportFailedIndices.length > 0 ? (allErrors[0]?.reason || 'transport failed') : undefined,
  };
}

/** 하트비트 전송 */
export async function sendHeartbeat(stats: {
  last_sync_at?: string;
  pending_count?: number;
  error_count_24h?: number;
}) {
  return apiCall('POST', '/heartbeat', stats);
}
