/**
 * ★ CT-F27 — 전단AI 잔액 원장 컨트롤타워
 *
 * flyer_users.prepaid_balance 를 움직이는 **유일한 경로**.
 * 잔액 UPDATE와 원장 INSERT를 한 트랜잭션에서 함께 처리한다.
 * 잔액만 바꾸고 기록을 남기지 않는 코드가 다시 생기지 않게, 이동 자체를 이 함수가 소유한다.
 *
 * 소비처: 관리자 충전(activate/charge) · 이용료 결제(subscribe) · 발송 차감 · 환불
 *
 * ⚠ 원장 테이블(flyer_balance_transactions)이 없으면 잔액 이동 전체가 롤백되고
 *   호출부는 503 DB_MIGRATION_PENDING 을 돌려준다. 기록 없는 이동을 허용하지 않는다.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../config/database';

export type FlyerBalanceTxType =
  | 'admin_charge'    // 슈퍼관리자 충전
  | 'deposit_charge'  // 입금 확인 충전
  | 'subscribe'       // 월 이용료 결제
  | 'deduct'          // 발송 차감
  | 'refund';         // 발송 실패·취소 환불

export const FLYER_BALANCE_TX_LABELS: Record<FlyerBalanceTxType, string> = {
  admin_charge: '관리자충전',
  deposit_charge: '입금충전',
  subscribe: '이용료결제',
  deduct: '사용',
  refund: '환불',
};

export interface FlyerBalanceChangeParams {
  userId: string;
  /** 부호 포함 금액. 양수 = 충전, 음수 = 차감 */
  amount: number;
  type: FlyerBalanceTxType;
  description: string;
  /**
   * ★ 멱등 키(필수). 같은 키로 다시 들어오면 돈을 다시 움직이지 않고 최초 결과를 돌려준다.
   * 더블클릭·응답 유실 재시도·워커 재실행이 전부 이 키 하나로 막힌다.
   * 예: subscribe:{userId}:{직전 만료일} · deduct:{campaignId} · charge:{요청 UUID}
   */
  operationId: string;
  refType?: string | null;
  refId?: string | null;
  /** 실행 주체 표기 (super_admin id / 'store' / 'system') */
  createdBy?: string | null;
}

export type FlyerBalanceChangeResult =
  | { ok: true; balanceAfter: number; companyId: string; replayed: boolean }
  | { ok: false; reason: string; balance: number };

/**
 * 트랜잭션 실행 헬퍼. 잔액이 움직이는 모든 경로가 이걸 통해 돈다.
 */
export async function withFlyerTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* 롤백 실패는 원 에러를 가리지 않는다 */ }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 잔액 이동 + 원장 기록 (같은 트랜잭션 안에서 호출할 것).
 *
 * 순서가 안전의 근거다.
 *   ① 매장 행을 FOR UPDATE 로 잠근다 — 동시 요청을 줄 세운다.
 *   ② 같은 operationId 원장이 이미 있으면 그 결과를 그대로 돌려준다(재시도 = 무이동).
 *   ③ 잔액 검사 → UPDATE → 원장 INSERT.
 * UNIQUE (user_id, operation_id) 가 마지막 방어선이다.
 */
export async function changeFlyerBalance(
  client: PoolClient,
  params: FlyerBalanceChangeParams
): Promise<FlyerBalanceChangeResult> {
  const { userId, amount, type, description, operationId } = params;
  const delta = Math.trunc(amount);

  if (!operationId) {
    return { ok: false, reason: '작업 식별자가 없습니다', balance: 0 };
  }
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: false, reason: '변경 금액이 올바르지 않습니다', balance: 0 };
  }

  // ① 행 잠금 — 이 잠금이 있어야 ②의 확인-후-실행이 경합에서 안전하다
  const lockRes = await client.query(
    `SELECT prepaid_balance, company_id FROM flyer_users
     WHERE id = $1 AND deleted_at IS NULL
     FOR UPDATE`,
    [userId]
  );
  if (lockRes.rows.length === 0) {
    return { ok: false, reason: '매장 정보를 찾을 수 없습니다', balance: 0 };
  }
  const balanceBefore = Number(lockRes.rows[0].prepaid_balance || 0);
  const companyId = lockRes.rows[0].company_id as string;

  // ② 재시도 판별
  const dupRes = await client.query(
    `SELECT balance_after FROM flyer_balance_transactions
     WHERE user_id = $1 AND operation_id = $2`,
    [userId, operationId]
  );
  if (dupRes.rows.length > 0) {
    return { ok: true, balanceAfter: Number(dupRes.rows[0].balance_after || 0), companyId, replayed: true };
  }

  // ③ 잔액 검사 + 이동
  const needed = delta < 0 ? Math.abs(delta) : 0;
  if (needed > 0 && balanceBefore < needed) {
    return {
      ok: false,
      balance: balanceBefore,
      reason: `잔액이 부족합니다 (필요: ₩${needed.toLocaleString()}, 잔액: ₩${balanceBefore.toLocaleString()})`,
    };
  }

  const updateRes = await client.query(
    `UPDATE flyer_users
     SET prepaid_balance = prepaid_balance + $1, updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING prepaid_balance`,
    [delta, userId]
  );
  const balanceAfter = Number(updateRes.rows[0].prepaid_balance || 0);

  await client.query(
    `INSERT INTO flyer_balance_transactions
       (id, user_id, company_id, operation_id, type, amount, balance_after, description, ref_type, ref_id, created_by, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
    [
      userId,
      companyId,
      operationId,
      type,
      delta,
      balanceAfter,
      description,
      params.refType || null,
      params.refId || null,
      params.createdBy || null,
    ]
  );

  return { ok: true, balanceAfter, companyId, replayed: false };
}

export interface FlyerBalanceTxQuery {
  userId: string;
  type?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  page?: number;
  limit?: number;
}

/**
 * 매장 거래 내역 조회 (프론트 BalancePage 표시 축과 동일 필드).
 */
export async function queryFlyerBalanceTransactions(params: FlyerBalanceTxQuery) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
  const offset = (page - 1) * limit;

  const where: string[] = ['user_id = $1'];
  const args: any[] = [params.userId];

  if (params.type) {
    // 프론트 필터(charge/deduct/refund)는 묶음 축이다. 원장 type과 매핑해서 받는다.
    const group = FLYER_BALANCE_TX_FILTER_GROUPS[params.type];
    if (group) {
      args.push(group);
      where.push(`type = ANY($${args.length}::text[])`);
    }
  }
  if (params.startDate) {
    args.push(params.startDate);
    where.push(`created_at >= $${args.length}::date`);
  }
  if (params.endDate) {
    args.push(params.endDate);
    where.push(`created_at < ($${args.length}::date + INTERVAL '1 day')`);
  }

  const whereSql = where.join(' AND ');
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM flyer_balance_transactions WHERE ${whereSql}`,
    args
  );

  args.push(limit, offset);
  const listRes = await pool.query(
    `SELECT id, type, amount, balance_after, description, ref_type, ref_id, created_at
     FROM flyer_balance_transactions
     WHERE ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args
  );

  return { transactions: listRes.rows, total: countRes.rows[0]?.cnt || 0, page, limit };
}

/** 프론트 구분 필터 → 원장 type 묶음 */
const FLYER_BALANCE_TX_FILTER_GROUPS: Record<string, FlyerBalanceTxType[]> = {
  charge: ['admin_charge', 'deposit_charge'],
  deduct: ['deduct', 'subscribe'],
  refund: ['refund'],
};

// ⚠ 마이그레이션 미실행(테이블 부재) 판정은 CT-F25 `db-migration-error.ts` 가 소유한다.
//   라우트 catch에서 handleDbMigrationError(err, res, 'flyer_balance_transactions 신규 테이블') 로 처리할 것.
