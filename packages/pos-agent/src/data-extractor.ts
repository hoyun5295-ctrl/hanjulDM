/**
 * AI 매핑 기반 주기적 데이터 추출 (V2)
 *
 * 서버에서 받은 SchemaMapping의 extractQueries를 사용하여 POS DB에서 증분 데이터 추출.
 *
 * V2 흐름:
 *  1. extractQueries 실행 → rows 추출
 *  2. 컬럼 매핑 적용 (POS 컬럼 → 표준 필드)
 *  3. mask-bypass 적용 (전화번호 정규화 + 마스킹 감지)
 *  4. local-cache.enqueue (push 즉시 X — cache-pusher cron이 push 전담)
 *  5. lastSync 시각 저장
 *
 * 효과:
 *  - 추출과 푸시 분리 = 인터넷 단절 시에도 추출 계속 가능
 *  - cache-pusher가 retry + 멱등 처리 = 중복 전송 0
 *  - 큐 한도 10000건 = 매장 정상 대비 충분
 *
 * 반환값:
 *  - extractAndPushXxx() → enqueue된 신규 건수 (멱등 dedupe 후)
 */

import { executeQuery } from './db-connector';
import { getConfig, saveConfig } from './config';
import { logger } from './logger';
import { enqueueSales, enqueueMembers, enqueueInventory } from './local-cache';
import { normalizeKoreanPhone } from './adapters/base';

interface SchemaMapping {
  memberTable: string | null;
  salesTable: string | null;
  inventoryTable: string | null;
  memberColumns: Record<string, string>;
  salesColumns: Record<string, string>;
  inventoryColumns: Record<string, string> | null;
  extractQueries: {
    newMembers: string;
    newSales: string;
    inventorySnapshot: string;
  };
}

// ============================================================
// 판매 데이터 추출 + 큐 적재
// ============================================================

export async function extractAndPushSales(mapping: SchemaMapping): Promise<number> {
  if (!mapping.salesTable || !mapping.extractQueries.newSales) {
    logger.debug('판매 테이블 미매핑 — 스킵');
    return 0;
  }

  const config = getConfig();
  const lastSync = config.lastSalesSync || '2000-01-01T00:00:00';

  try {
    const sql = bindSyncParam(mapping.extractQueries.newSales, config.db.type);
    const rows = await executeQuery(sql, [lastSync]);

    if (rows.length === 0) {
      logger.debug('새 판매 데이터 없음');
      return 0;
    }

    const mapped = rows.map(row => mapColumns(row, mapping.salesColumns));

    // 큐에 적재 (push는 cache-pusher가 전담)
    const result = enqueueSales(mapped);
    saveConfig({ lastSalesSync: new Date().toISOString() });

    logger.info(`판매 추출: ${rows.length}건 → enqueued ${result.enqueued} (dup ${result.duplicated}, dropped ${result.dropped})`);
    return result.enqueued;
  } catch (err: any) {
    logger.error('판매 데이터 추출 실패:', err.message);
    return 0;
  }
}

// ============================================================
// 회원 데이터 추출 + 큐 적재 (phone 정규화)
// ============================================================

export async function extractAndPushMembers(mapping: SchemaMapping): Promise<number> {
  if (!mapping.memberTable || !mapping.extractQueries.newMembers) {
    logger.debug('회원 테이블 미매핑 — 스킵');
    return 0;
  }

  const config = getConfig();
  const lastSync = config.lastMembersSync || '2000-01-01T00:00:00';

  try {
    const sql = bindSyncParam(mapping.extractQueries.newMembers, config.db.type);
    const rows = await executeQuery(sql, [lastSync]);

    if (rows.length === 0) {
      logger.debug('새 회원 데이터 없음');
      return 0;
    }

    // 매핑 + phone 정규화
    const mapped = rows
      .map(row => {
        const m = mapColumns(row, mapping.memberColumns);
        if (m.phone) {
          const normalized = normalizeKoreanPhone(m.phone);
          if (!normalized) {
            logger.debug(`회원 phone 비정상 — 스킵: ${m.phone}`);
            return null;
          }
          m.phone = normalized;
        }
        return m;
      })
      .filter(m => m !== null);

    const result = enqueueMembers(mapped);
    saveConfig({ lastMembersSync: new Date().toISOString() });

    logger.info(`회원 추출: ${rows.length}건 → enqueued ${result.enqueued} (dup ${result.duplicated}, dropped ${result.dropped})`);
    return result.enqueued;
  } catch (err: any) {
    logger.error('회원 데이터 추출 실패:', err.message);
    return 0;
  }
}

// ============================================================
// 재고 스냅샷 추출 + 큐 적재
// ============================================================

export async function extractAndPushInventory(mapping: SchemaMapping): Promise<number> {
  if (!mapping.inventoryTable || !mapping.extractQueries.inventorySnapshot) {
    logger.debug('재고 테이블 미매핑 — 스킵');
    return 0;
  }

  try {
    const rows = await executeQuery(mapping.extractQueries.inventorySnapshot);

    if (rows.length === 0) {
      logger.debug('재고 데이터 없음');
      return 0;
    }

    const snapshotAt = new Date().toISOString().slice(0, 10);
    const mapped = rows.map(row => ({
      ...mapColumns(row, mapping.inventoryColumns || {}),
      snapshot_at: snapshotAt,
    }));

    const result = enqueueInventory(mapped);
    saveConfig({ lastInventorySync: new Date().toISOString() });

    logger.info(`재고 추출: ${rows.length}건 → enqueued ${result.enqueued} (dup ${result.duplicated}, dropped ${result.dropped})`);
    return result.enqueued;
  } catch (err: any) {
    logger.error('재고 데이터 추출 실패:', err.message);
    return 0;
  }
}

// ============================================================
// 컬럼 매핑 + 파라미터 바인딩 (V1 유지)
// ============================================================

function mapColumns(row: Record<string, any>, columnMapping: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = {};

  const reverseMap: Record<string, string> = {};
  for (const [standardField, posColumn] of Object.entries(columnMapping)) {
    reverseMap[posColumn.toLowerCase()] = standardField;
  }

  for (const [posCol, value] of Object.entries(row)) {
    const standardField = reverseMap[posCol.toLowerCase()];
    if (standardField) {
      result[standardField] = value;
    }
  }

  result.raw = row;
  return result;
}

function bindSyncParam(sql: string, dbType: string): string {
  const placeholder = dbType === 'mssql' ? '@p0' : '?';
  return sql.replace(/:LAST_SYNC_AT/g, placeholder);
}
