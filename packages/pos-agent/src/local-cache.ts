/**
 * ★ Local Cache — SQLite 오프라인 큐 + 멱등성
 *
 * 인터넷 단절 대비 + 중복 전송 방지.
 * better-sqlite3 사용 (이미 db-connector에서 의존성 박힘).
 *
 * 테이블:
 *  - pending_sales       — 서버 전송 대기 판매 데이터
 *  - pending_members     — 서버 전송 대기 회원 데이터
 *  - pending_inventory   — 서버 전송 대기 재고 스냅샷
 *  - sync_log            — 서버 전송 이력 (성공/실패)
 *
 * 멱등키:
 *  - sales:     receipt_no + product_code + sold_at
 *  - members:   pos_member_id 또는 phone
 *  - inventory: snapshot_at + product_code
 *
 * 한도:
 *  - 큐별 10,000건 (초과 시 오래된 것부터 drop + 알림)
 *  - 보존: push 성공 후 7일 (디버깅용), 그 후 자동 cleanup
 */

import { logger } from './logger';
import { appPath } from './app-paths';

// ============================================================
// 상수
// ============================================================

const CACHE_PATH = appPath('pos-cache.sqlite');
const MAX_QUEUE_SIZE = 10000;
const RETENTION_DAYS = 7;

// ============================================================
// 내부 상태
// ============================================================

let db: any = null;

// ============================================================
// 초기화
// ============================================================

export function initLocalCache(): void {
  if (db) return;

  try {
    const Database = require('better-sqlite3');
    db = new Database(CACHE_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    // 테이블 박음
    db.exec(`
      CREATE TABLE IF NOT EXISTS pending_sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotent_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        pushed_at TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pending_sales_pushed ON pending_sales(pushed_at) WHERE pushed_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_pending_sales_created ON pending_sales(created_at);

      CREATE TABLE IF NOT EXISTS pending_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotent_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        pushed_at TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pending_members_pushed ON pending_members(pushed_at) WHERE pushed_at IS NULL;

      CREATE TABLE IF NOT EXISTS pending_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotent_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        pushed_at TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pending_inventory_pushed ON pending_inventory(pushed_at) WHERE pushed_at IS NULL;

      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        record_count INTEGER NOT NULL DEFAULT 0,
        accepted_count INTEGER NOT NULL DEFAULT 0,
        rejected_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sync_log_created ON sync_log(created_at);
    `);

    logger.info(`Local Cache 초기화 완료: ${CACHE_PATH}`);
  } catch (err: any) {
    logger.error(`Local Cache 초기화 실패: ${err.message}`);
    throw err;
  }
}

// ============================================================
// 멱등키 생성
// ============================================================

function buildSalesIdempotentKey(item: any): string {
  const receipt = item.receipt_no || item.receiptNo || '';
  const product = item.product_code || item.productCode || '';
  const soldAt = item.sold_at || item.soldAt || '';
  return `${receipt}|${product}|${soldAt}`;
}

function buildMemberIdempotentKey(item: any): string {
  return String(item.pos_member_id || item.posMemberId || item.phone || '');
}

function buildInventoryIdempotentKey(item: any): string {
  const product = item.product_code || item.productCode || '';
  const snapshot = item.snapshot_at || item.snapshotAt || new Date().toISOString().slice(0, 10);
  return `${product}|${snapshot}`;
}

// ============================================================
// 큐에 추가 (enqueue)
// ============================================================

interface EnqueueResult {
  enqueued: number;
  duplicated: number;
  dropped: number; // 한도 초과로 버려진 옛 항목 수
}

function enqueueGeneric(table: string, items: any[], keyBuilder: (item: any) => string): EnqueueResult {
  if (!db) initLocalCache();
  if (items.length === 0) return { enqueued: 0, duplicated: 0, dropped: 0 };

  let enqueued = 0;
  let duplicated = 0;

  const stmt = db.prepare(`
    INSERT INTO ${table} (idempotent_key, payload, created_at)
    VALUES (@key, @payload, datetime('now'))
    ON CONFLICT(idempotent_key) DO NOTHING
  `);

  const tx = db.transaction((rows: any[]) => {
    for (const item of rows) {
      const key = keyBuilder(item);
      if (!key || key === '||' || key.startsWith('|')) {
        duplicated++; // 멱등키 못 만들면 스킵
        continue;
      }
      const result = stmt.run({ key, payload: JSON.stringify(item) });
      if (result.changes > 0) enqueued++;
      else duplicated++;
    }
  });

  try {
    tx(items);
  } catch (err: any) {
    logger.error(`[${table}] enqueue 실패: ${err.message}`);
  }

  // 한도 enforce
  const dropped = enforceCapacity(table);

  return { enqueued, duplicated, dropped };
}

export function enqueueSales(items: any[]): EnqueueResult {
  return enqueueGeneric('pending_sales', items, buildSalesIdempotentKey);
}

export function enqueueMembers(items: any[]): EnqueueResult {
  return enqueueGeneric('pending_members', items, buildMemberIdempotentKey);
}

export function enqueueInventory(items: any[]): EnqueueResult {
  return enqueueGeneric('pending_inventory', items, buildInventoryIdempotentKey);
}

// ============================================================
// 큐에서 가져오기 (dequeue)
// ============================================================

export interface QueuedItem {
  id: number;
  idempotent_key: string;
  payload: any;
  retry_count: number;
}

function dequeueGeneric(table: string, limit: number): QueuedItem[] {
  if (!db) initLocalCache();

  const rows = db.prepare(`
    SELECT id, idempotent_key, payload, retry_count
    FROM ${table}
    WHERE pushed_at IS NULL
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(r => ({
    id: r.id,
    idempotent_key: r.idempotent_key,
    payload: JSON.parse(r.payload),
    retry_count: r.retry_count,
  }));
}

export function dequeueSales(limit: number): QueuedItem[] {
  return dequeueGeneric('pending_sales', limit);
}

export function dequeueMembers(limit: number): QueuedItem[] {
  return dequeueGeneric('pending_members', limit);
}

export function dequeueInventory(limit: number): QueuedItem[] {
  return dequeueGeneric('pending_inventory', limit);
}

// ============================================================
// 전송 완료 표시 (markPushed)
// ============================================================

function markPushedGeneric(table: string, ids: number[]): number {
  if (!db) initLocalCache();
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`
    UPDATE ${table} SET pushed_at = datetime('now') WHERE id IN (${placeholders})
  `).run(...ids);

  return result.changes;
}

export function markSalesPushed(ids: number[]): number {
  return markPushedGeneric('pending_sales', ids);
}

export function markMembersPushed(ids: number[]): number {
  return markPushedGeneric('pending_members', ids);
}

export function markInventoryPushed(ids: number[]): number {
  return markPushedGeneric('pending_inventory', ids);
}

// ============================================================
// 전송 실패 기록 (markFailed)
// ============================================================

function markFailedGeneric(table: string, ids: number[], errorMessage: string): number {
  if (!db) initLocalCache();
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`
    UPDATE ${table}
    SET retry_count = retry_count + 1, last_error = ?
    WHERE id IN (${placeholders})
  `).run(errorMessage, ...ids);

  return result.changes;
}

export function markSalesFailed(ids: number[], error: string): number {
  return markFailedGeneric('pending_sales', ids, error);
}

export function markMembersFailed(ids: number[], error: string): number {
  return markFailedGeneric('pending_members', ids, error);
}

export function markInventoryFailed(ids: number[], error: string): number {
  return markFailedGeneric('pending_inventory', ids, error);
}

// ============================================================
// 큐 한도 enforce + cleanup
// ============================================================

function enforceCapacity(table: string): number {
  if (!db) return 0;

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM ${table}`).get() as { cnt: number };
  if (total.cnt <= MAX_QUEUE_SIZE) return 0;

  const toDrop = total.cnt - MAX_QUEUE_SIZE;
  const result = db.prepare(`
    DELETE FROM ${table}
    WHERE id IN (
      SELECT id FROM ${table}
      ORDER BY created_at ASC
      LIMIT ?
    )
  `).run(toDrop);

  if (result.changes > 0) {
    logger.warn(`[${table}] 한도 초과 — ${result.changes}건 drop (오래된 것부터)`);
  }
  return result.changes;
}

/** 7일 지난 push 완료 항목 자동 삭제 */
export function cleanupOldEntries(): void {
  if (!db) initLocalCache();

  const tables = ['pending_sales', 'pending_members', 'pending_inventory'];
  let totalDeleted = 0;

  for (const table of tables) {
    const result = db.prepare(`
      DELETE FROM ${table}
      WHERE pushed_at IS NOT NULL
        AND pushed_at < datetime('now', '-${RETENTION_DAYS} days')
    `).run();
    totalDeleted += result.changes;
  }

  // sync_log도 30일 보존
  const logResult = db.prepare(`
    DELETE FROM sync_log WHERE created_at < datetime('now', '-30 days')
  `).run();
  totalDeleted += logResult.changes;

  if (totalDeleted > 0) {
    logger.info(`Local Cache cleanup: ${totalDeleted}건 삭제 (${RETENTION_DAYS}일/30일 보존)`);
  }
}

// ============================================================
// 통계
// ============================================================

export interface CacheStats {
  pendingSales: number;
  pendingMembers: number;
  pendingInventory: number;
  totalPending: number;
  syncLog24h: { success: number; failure: number };
}

export function getCacheStats(): CacheStats {
  if (!db) initLocalCache();

  const sales = (db.prepare(`SELECT COUNT(*) AS cnt FROM pending_sales WHERE pushed_at IS NULL`).get() as any).cnt;
  const members = (db.prepare(`SELECT COUNT(*) AS cnt FROM pending_members WHERE pushed_at IS NULL`).get() as any).cnt;
  const inventory = (db.prepare(`SELECT COUNT(*) AS cnt FROM pending_inventory WHERE pushed_at IS NULL`).get() as any).cnt;

  const syncLog24h = db.prepare(`
    SELECT status, COUNT(*) AS cnt
    FROM sync_log
    WHERE created_at > datetime('now', '-24 hours')
    GROUP BY status
  `).all() as any[];

  const success = syncLog24h.find(r => r.status === 'success')?.cnt || 0;
  const failure = syncLog24h.find(r => r.status === 'failure')?.cnt || 0;

  return {
    pendingSales: sales,
    pendingMembers: members,
    pendingInventory: inventory,
    totalPending: sales + members + inventory,
    syncLog24h: { success, failure },
  };
}

// ============================================================
// sync_log 기록
// ============================================================

export function recordSyncLog(type: 'sales' | 'members' | 'inventory', status: 'success' | 'failure', recordCount: number, accepted: number, rejected: number, errorMessage?: string): void {
  if (!db) initLocalCache();

  db.prepare(`
    INSERT INTO sync_log (type, status, record_count, accepted_count, rejected_count, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(type, status, recordCount, accepted, rejected, errorMessage || null);
}

// ============================================================
// 종료
// ============================================================

export function closeLocalCache(): void {
  if (db) {
    try { db.close(); } catch {}
    db = null;
    logger.info('Local Cache 종료');
  }
}
