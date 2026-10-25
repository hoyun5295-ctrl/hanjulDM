/**
 * ★ CT-F01 — 전단AI SMS 큐 컨트롤타워
 *
 * 한줄로 utils/sms-queue.ts와 완전 분리.
 * - 라인그룹 조회: flyer_companies.line_group_id 기반
 * - MySQL QTmsg 큐 조작 함수(smsAggAll/bulkInsertSmsQueue 등)는 sms-queue.ts 것을 재export
 *   (MySQL 테이블 조작은 PG 스키마와 무관하므로 안전)
 *
 * ⚠️ flyer_companies.line_group_id 컬럼이 반드시 있어야 함 (FLYER-SCHEMA.md 참조)
 */

import { query } from '../../../config/database';

// 라인그룹 캐시 (간단한 메모리 캐시, TTL 5분)
const TTL = 5 * 60 * 1000;
const cache = new Map<string, { tables: string[]; expires: number }>();

const BULK_FALLBACK = (process.env.SMS_TABLES || 'SMSQ_SEND').split(',').map(s => s.trim());

/**
 * 전단AI 회사의 발송 라인그룹 테이블 조회.
 * flyer_companies.line_group_id → sms_line_groups → sms_tables 배열
 * 할당 없으면 환경변수 SMS_TABLES fallback (한줄로와 공유하는 기본 라인)
 */
export async function getFlyerCompanySmsTables(companyId: string): Promise<string[]> {
  const cacheKey = `flyer:${companyId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.tables;

  const result = await query(
    `SELECT lg.sms_tables
     FROM sms_line_groups lg
     JOIN flyer_companies fc ON fc.line_group_id = lg.id
     WHERE fc.id = $1 AND lg.is_active = true AND lg.group_type = 'bulk'`,
    [companyId]
  );

  const hasGroup = result.rows.length > 0 && result.rows[0].sms_tables?.length > 0;
  const tables = hasGroup ? result.rows[0].sms_tables : BULK_FALLBACK;
  // ★ 1025 17번 §6-1: 공유 기본 라인으로 떨어지는 순간을 남긴다(캐시 갱신마다 1회 — 5분 TTL).
  //   한줄로 분리 단계에서 「전단이 아직 공유 라인을 쓰는 회사」를 이 로그로 센다.
  if (!hasGroup) console.warn(`[flyer] 회선 폴백 — 회사 라인그룹 없음 · 공유 SMS_TABLES 사용 (company=${companyId})`);

  cache.set(cacheKey, { tables, expires: Date.now() + TTL });
  return tables;
}

export function invalidateFlyerLineGroupCache(companyId?: string) {
  if (companyId) cache.delete(`flyer:${companyId}`);
  else cache.clear();
}

// ──────────────────────────────────────────────────────────
// MySQL 큐 조작은 한줄로 sms-queue.ts 것을 그대로 재export
// (테이블 조작이므로 PG 스키마 격리와 무관)
// ──────────────────────────────────────────────────────────
export {
  toQtmsgType,
  toKoreaTimeStr,
  smsAggAll,
  smsCountAll,
  smsSelectAll,
  smsMinAll,
  smsGroupByAll,
  smsBatchAggByGroup,
  smsExecAll,
  bulkInsertSmsQueue,
  insertTestSmsQueue,
  getTestSmsTables,
  getAuthSmsTable,
} from '../../sms-queue';
