/**
 * ★ CT-F03 — 전단AI 과금/결제 컨트롤타워
 *
 * 한줄로 utils/prepaid.ts와 완전 분리.
 * - 전단AI는 매장당 월 15만원 + 문자 100% 선불 (후불 없음)
 * - 과금 주체: flyer_users (매장). flyer_companies(총판)는 상위 차단만.
 * - flyer_billing_history에 월별 청구 기록
 *
 * D113: 매장별 과금 체계로 전환. canFlyerStoreSend + deductFlyerPrepaid + refundFlyerPrepaid 신설.
 * 기존 canFlyerCompanySend는 총판 레벨 체크용으로 유지 (하위호환).
 */

import { randomUUID } from 'crypto';
import { query } from '../../../config/database';
import { resolveFlyerStoreAccess, type FlyerAccessCode } from './flyer-payment-status';
import { withFlyerTx, changeFlyerBalance } from './flyer-balance-ledger';

export interface FlyerBillingSummary {
  company_id: string;
  month: string; // YYYY-MM
  sms_count: number;
  lms_count: number;
  mms_count: number;
  total_cost: number;
}

/**
 * 회사 월 발송량 집계 (flyer_campaigns 기준).
 * 기본 정액 15만원 + 초과분 (단가 x 발송수) 계산.
 */
export async function aggregateFlyerMonthlyUsage(
  companyId: string,
  yearMonth: string // 'YYYY-MM'
): Promise<FlyerBillingSummary> {
  const [year, month] = yearMonth.split('-').map(Number);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;

  const result = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN message_type='SMS' THEN success_count ELSE 0 END), 0)::int AS sms,
       COALESCE(SUM(CASE WHEN message_type='LMS' THEN success_count ELSE 0 END), 0)::int AS lms,
       COALESCE(SUM(CASE WHEN message_type='MMS' THEN success_count ELSE 0 END), 0)::int AS mms
     FROM flyer_campaigns
     WHERE company_id = $1
       AND sent_at >= ($2::date || ' 00:00:00+09')::timestamptz
       AND sent_at <  (($2::date + INTERVAL '1 month')::date || ' 00:00:00+09')::timestamptz
       AND status = 'completed'`,
    [companyId, monthStart]
  );

  const { sms, lms, mms } = result.rows[0] || { sms: 0, lms: 0, mms: 0 };

  // 단가 조회
  const priceRes = await query(
    `SELECT sms_unit_price, lms_unit_price, mms_unit_price, monthly_fee
     FROM flyer_companies WHERE id = $1`,
    [companyId]
  );
  const c = priceRes.rows[0] || {};
  const sendCost = sms * Number(c.sms_unit_price || 9) +
                   lms * Number(c.lms_unit_price || 29) +
                   mms * Number(c.mms_unit_price || 80);

  return {
    company_id: companyId,
    month: yearMonth,
    sms_count: sms,
    lms_count: lms,
    mms_count: mms,
    total_cost: Number(c.monthly_fee || 150000) + sendCost,
  };
}

/**
 * 월별 청구 기록 생성 (매월 1일 배치에서 호출).
 */
export async function recordFlyerMonthlyBilling(companyId: string, yearMonth: string): Promise<void> {
  const summary = await aggregateFlyerMonthlyUsage(companyId, yearMonth);
  const monthStart = `${yearMonth}-01`;

  const feeRes = await query(`SELECT monthly_fee FROM flyer_companies WHERE id = $1`, [companyId]);
  const monthlyFee = Number(feeRes.rows[0]?.monthly_fee || 150000);
  const overage = Math.max(0, summary.total_cost - monthlyFee);

  await query(
    `INSERT INTO flyer_billing_history
       (id, company_id, billing_month, monthly_fee, sms_overage, total_amount, payment_status, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'pending', NOW())
     ON CONFLICT (company_id, billing_month) DO UPDATE SET
       monthly_fee = EXCLUDED.monthly_fee,
       sms_overage = EXCLUDED.sms_overage,
       total_amount = EXCLUDED.total_amount`,
    [companyId, monthStart, monthlyFee, overage, summary.total_cost]
  );
}

/**
 * [하위호환] 총판(flyer_companies) 레벨 발송 가능 여부.
 * 판정은 CT-F26이 소유한다. 여기서는 조회만 한다.
 */
export async function canFlyerCompanySend(
  companyId: string
): Promise<{ ok: boolean; reason?: string; code?: FlyerAccessCode }> {
  const result = await query(
    `SELECT payment_status, plan_expires_at FROM flyer_companies WHERE id = $1 AND deleted_at IS NULL`,
    [companyId]
  );
  if (result.rows.length === 0) return { ok: false, reason: 'company_not_found' };

  const c = result.rows[0];
  const access = resolveFlyerStoreAccess({
    companyPaymentStatus: c.payment_status,
    companyPlanExpiresAt: c.plan_expires_at,
    // 총판만 보는 호출이므로 매장 축은 통과값으로 둔다
    storePaymentStatus: 'active',
    storePlanExpiresAt: null,
  });
  return access.allowed ? { ok: true } : { ok: false, reason: access.reason, code: access.code };
}

/**
 * ★ D113: 매장(flyer_users) 레벨 발송 가능 여부 확인.
 * 총판 + 매장을 한 번에 읽어 CT-F26 판정에 넘긴다.
 * ⚠ 화이트리스트 판정이라 축에 없는 값('paid' 등)은 통과하지 않는다.
 */
export async function canFlyerStoreSend(
  userId: string
): Promise<{ ok: boolean; reason?: string; code?: FlyerAccessCode }> {
  const userRes = await query(
    `SELECT u.payment_status  AS store_payment_status,
            u.plan_expires_at AS store_plan_expires_at,
            c.payment_status  AS company_payment_status,
            c.plan_expires_at AS company_plan_expires_at
     FROM flyer_users u
     JOIN flyer_companies c ON c.id = u.company_id
     WHERE u.id = $1 AND u.deleted_at IS NULL AND c.deleted_at IS NULL`,
    [userId]
  );
  if (userRes.rows.length === 0) return { ok: false, reason: '매장 정보를 찾을 수 없습니다' };

  const r = userRes.rows[0];
  const access = resolveFlyerStoreAccess({
    companyPaymentStatus: r.company_payment_status,
    companyPlanExpiresAt: r.company_plan_expires_at,
    storePaymentStatus: r.store_payment_status,
    storePlanExpiresAt: r.store_plan_expires_at,
  });
  return access.allowed ? { ok: true } : { ok: false, reason: access.reason, code: access.code };
}

/**
 * ★ D113: 선불 잔액 차감 (Atomic).
 * prepaid_balance >= totalAmount 조건부 UPDATE로 잔액 부족 시 실패 반환.
 */
export async function deductFlyerPrepaid(
  userId: string,
  count: number,
  messageType: 'SMS' | 'LMS' | 'MMS' | 'ALIMTALK',
  ref?: { campaignId?: string | null }
): Promise<{ ok: boolean; deducted?: number; balance?: number; reason?: string }> {
  // 단가 조회
  const priceRes = await query(
    `SELECT sms_unit_price, lms_unit_price, mms_unit_price, prepaid_balance
     FROM flyer_users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (priceRes.rows.length === 0) return { ok: false, reason: '매장 정보를 찾을 수 없습니다' };

  const u = priceRes.rows[0];
  // ★ D158 알림톡 단가 임시 = SMS 단가 (가장 저렴 보수적 — 실제 IMC 알림톡 ≈ 7~13원).
  //   Phase 1+ 본격화 시 flyer_users.alimtalk_unit_price 컬럼 ALTER + 별도 단가 매핑 (별건).
  const priceMap: Record<string, number> = {
    SMS:      Number(u.sms_unit_price || 9),
    LMS:      Number(u.lms_unit_price || 29),
    MMS:      Number(u.mms_unit_price || 80),
    ALIMTALK: Number(u.sms_unit_price || 9),
  };
  const unitPrice = priceMap[messageType] || 9;
  const totalAmount = Math.ceil(unitPrice * count);

  // ★ CT-F27: 차감 + 원장 기록을 한 트랜잭션에서. 기록 없는 잔액 이동을 만들지 않는다.
  //   멱등 키 = 캠페인 1건당 차감 1회. 같은 캠페인으로 재진입해도 두 번 빠지지 않는다.
  const opId = ref?.campaignId ? `deduct:${ref.campaignId}` : `deduct:${randomUUID()}`;
  let result: Awaited<ReturnType<typeof changeFlyerBalance>>;
  try {
    result = await withFlyerTx(client =>
      changeFlyerBalance(client, {
        userId,
        amount: -totalAmount,
        type: 'deduct',
        description: `${messageType} 발송 ${count.toLocaleString()}건 (건당 ₩${unitPrice.toLocaleString()})`,
        operationId: opId,
        refType: ref?.campaignId ? 'campaign' : null,
        refId: ref?.campaignId || null,
        createdBy: 'store',
      })
    );
  } catch (err: any) {
    // ★ 던지면 발송 오케스트레이터가 캠페인을 'sending'인 채로 두고 끝난다.
    //   실패는 반환값으로 돌려 호출부가 캠페인을 취소 처리하게 한다.
    console.error('[CT-F03] 잔액 차감 실패:', err?.message || err);
    return { ok: false, reason: '잔액 처리 중 오류가 발생했습니다. 발송이 취소되었습니다.' };
  }

  if (!result.ok) {
    return { ok: false, balance: result.balance, reason: result.reason };
  }

  return { ok: true, deducted: totalAmount, balance: result.balanceAfter };
}

/**
 * ★ D113: 선불 잔액 환불 (발송 취소 시).
 */
export async function refundFlyerPrepaid(
  userId: string,
  amount: number,
  ref?: { campaignId?: string | null; reason?: string }
): Promise<{ ok: boolean; balance?: number }> {
  if (amount <= 0) return { ok: true };

  // 멱등 키 = 캠페인 1건당 환불 1회. 재시도해도 두 번 돌려주지 않는다.
  const opId = ref?.campaignId ? `refund:${ref.campaignId}` : `refund:${randomUUID()}`;
  try {
    const result = await withFlyerTx(client =>
      changeFlyerBalance(client, {
        userId,
        amount: Math.trunc(amount),
        type: 'refund',
        description: ref?.reason || '발송 취소 환불',
        operationId: opId,
        refType: ref?.campaignId ? 'campaign' : null,
        refId: ref?.campaignId || null,
        createdBy: 'system',
      })
    );
    if (!result.ok) return { ok: false };
    return { ok: true, balance: result.balanceAfter };
  } catch (err: any) {
    console.error('[CT-F03] 환불 실패:', err?.message || err);
    return { ok: false };
  }
}
