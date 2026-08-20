/**
 * ★ 전단AI 잔액/과금 라우트
 * 마운트: /api/flyer/balance
 * CT: CT-F03 flyer-billing.ts · CT-F26 결제 상태 판정 · CT-F27 잔액 원장
 *
 * ⚠ 이 라우터는 미결제·기간만료 상태에서도 열린다(flyer-auth 개방 경로).
 *   결제 엔드포인트를 차단 뒤에 두면 매장이 스스로 결제할 방법이 사라진다.
 */

import { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';
import {
  aggregateFlyerMonthlyUsage,
  resolveFlyerStoreAccess,
  withFlyerTx,
  changeFlyerBalance,
  queryFlyerBalanceTransactions,
} from '../../utils/flyer';
import { handleDbMigrationError } from '../../utils/flyer/db-migration-error';

const router = Router();
router.use(flyerAuthenticate);

/**
 * GET / — 현재 플랜 + 이번 달 발송량 요약
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { companyId, userId } = req.flyerUser!;

    // ★ D114: 매장(flyer_users) 정보 우선 — 이용료/잔액/구독상태는 매장 단위
    // ★ 컬럼명이 겹치므로 매장·총판 상태는 반드시 별칭으로 분리해서 받는다.
    const userRes = await query(
      `SELECT u.monthly_fee, u.prepaid_balance,
              u.payment_status  AS store_payment_status,
              u.plan_started_at AS store_plan_started_at,
              u.plan_expires_at AS store_plan_expires_at,
              c.payment_status  AS company_payment_status,
              c.plan_expires_at AS company_plan_expires_at,
              c.sms_unit_price, c.lms_unit_price, c.mms_unit_price
       FROM flyer_users u
       JOIN flyer_companies c ON c.id = u.company_id
       WHERE u.id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Store not found' });

    const store = userRes.rows[0];
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const usage = await aggregateFlyerMonthlyUsage(companyId, yearMonth);

    // ★ CT-F26: 이용 가능 여부 판정은 서버가 한다. 프론트는 이 값을 그대로 쓴다.
    const access = resolveFlyerStoreAccess({
      companyPaymentStatus: store.company_payment_status,
      companyPlanExpiresAt: store.company_plan_expires_at,
      storePaymentStatus: store.store_payment_status,
      storePlanExpiresAt: store.store_plan_expires_at,
    });

    return res.json({
      balance: Number(store.prepaid_balance || 0),
      billing_type: 'prepaid', // 전단AI는 100% 선불. 후불 요금제는 존재하지 않는다.
      costPerSms: Number(store.sms_unit_price || 9),
      costPerLms: Number(store.lms_unit_price || 29),
      costPerMms: Number(store.mms_unit_price || 80),
      plan: {
        monthly_fee: Number(store.monthly_fee || 150000),
        payment_status: store.store_payment_status,
        plan_started_at: store.store_plan_started_at,
        plan_expires_at: store.store_plan_expires_at,
        // 화면 판정 축 — 프론트에서 상태 문자열을 다시 비교하지 않는다
        service_active: access.allowed,
        access_code: access.code,
        access_reason: access.reason,
        payable: access.allowed || access.billingAccessible,
      },
      currentMonth: yearMonth,
      usage,
    });
  } catch (error: any) {
    console.error('[flyer/balance] get error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /history — 청구 이력 (총판 단위 월별 청구서)
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const result = await query(
      `SELECT billing_month, monthly_fee, sms_overage, total_amount, payment_status, paid_at
       FROM flyer_billing_history
       WHERE company_id = $1
       ORDER BY billing_month DESC
       LIMIT 12`,
      [companyId]
    );
    return res.json(result.rows);
  } catch (error: any) {
    console.error('[flyer/balance] history error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /transactions — 매장 잔액 거래 내역 (CT-F26 원장)
 * ★ 청구 이력(flyer_billing_history)이 아니다. 그건 총판 단위 월 청구서다.
 */
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const { userId } = req.flyerUser!;
    const result = await queryFlyerBalanceTransactions({
      userId,
      type: (req.query.type as string) || null,
      startDate: (req.query.startDate as string) || null,
      endDate: (req.query.endDate as string) || null,
      page: parseInt(String(req.query.page || '1'), 10),
      limit: parseInt(String(req.query.limit || '20'), 10),
    });
    return res.json(result);
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'flyer_balance_transactions 신규 테이블')) return;
    console.error('[flyer/balance] transactions error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /summary — 최근 N개월 잔액 요약 (충전/사용/환불)
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { userId } = req.flyerUser!;
    const months = Math.min(24, Math.max(1, parseInt(String(req.query.months || '6'), 10)));
    const result = await query(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month,
              COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND type <> 'refund'), 0)::int AS total_charged,
              COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0)::int AS total_deducted,
              COALESCE(SUM(amount) FILTER (WHERE type = 'refund'), 0)::int AS total_refunded,
              COUNT(*)::int AS transaction_count
       FROM flyer_balance_transactions
       WHERE user_id = $1
         AND created_at >= DATE_TRUNC('month', CURRENT_DATE) - ($2 || ' months')::interval
       GROUP BY 1
       ORDER BY 1 DESC`,
      [userId, months]
    );
    return res.json({ summary: result.rows });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'flyer_balance_transactions 신규 테이블')) return;
    console.error('[flyer/balance] summary error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /deposit-request — 입금 요청 접수 (실제 충전은 관리자 입금 확인 후)
 * ★ 잔액을 움직이지 않는다. 청구 이력에 pending 으로 남길 뿐이다.
 */
router.post('/deposit-request', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { amount, depositorName } = req.body;
    const depositAmount = parseInt(String(amount || '0'), 10);
    if (!depositAmount || depositAmount <= 0 || !depositorName) {
      return res.status(400).json({ error: '금액과 입금자명을 입력해주세요' });
    }
    await query(
      `INSERT INTO flyer_billing_history (id, company_id, billing_month, monthly_fee, total_amount, payment_status, created_at)
       VALUES (gen_random_uuid(), $1, DATE_TRUNC('month', CURRENT_DATE), $2, $2, 'pending', NOW())
       ON CONFLICT (company_id, billing_month) DO UPDATE SET
         total_amount = flyer_billing_history.total_amount + EXCLUDED.total_amount`,
      [companyId, depositAmount]
    );
    return res.json({ message: '입금 요청이 등록되었습니다', amount: depositAmount, depositorName });
  } catch (error: any) {
    console.error('[flyer/balance] deposit-request error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * ★ D114: POST /subscribe — 이용료 결제 (매장 사장님이 직접)
 * 잔액에서 monthly_fee 차감 → payment_status='active' + 30일.
 * 이미 이용중이고 기간이 남아 있으면 만료일에서 +30일 연장.
 */
router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const userId = req.flyerUser!.userId;

    const userRes = await query(
      `SELECT u.id, u.store_name, u.monthly_fee, u.prepaid_balance,
              u.payment_status  AS store_payment_status,
              u.plan_expires_at AS store_plan_expires_at,
              c.payment_status  AS company_payment_status,
              c.plan_expires_at AS company_plan_expires_at
       FROM flyer_users u
       JOIN flyer_companies c ON c.id = u.company_id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: '매장 정보를 찾을 수 없습니다' });

    const store = userRes.rows[0];
    const access = resolveFlyerStoreAccess({
      companyPaymentStatus: store.company_payment_status,
      companyPlanExpiresAt: store.company_plan_expires_at,
      storePaymentStatus: store.store_payment_status,
      storePlanExpiresAt: store.store_plan_expires_at,
    });

    // ★ 총판 차단·매장 정지는 결제로 풀리지 않는다. 돈만 받고 열리지 않는 상태를 만들지 않는다.
    if (!access.allowed && !access.billingAccessible) {
      return res.status(403).json({ error: access.reason, code: access.code });
    }

    const preFee = Number(store.monthly_fee || 150000);
    const preBalance = Number(store.prepaid_balance || 0);
    if (preBalance < preFee) {
      return res.status(400).json({
        error: `잔액이 부족합니다. 이용료 ₩${preFee.toLocaleString()} / 현재 잔액 ₩${preBalance.toLocaleString()}`,
        code: 'INSUFFICIENT_BALANCE',
        required: preFee,
        balance: preBalance,
      });
    }

    // ★ 자격·요금은 트랜잭션 안에서 잠그고 다시 읽는다.
    //   밖에서 판정한 값으로 차감하면, 조회와 차감 사이에 정지된 매장이 결제로 정지를 덮어쓴다.
    const result = await withFlyerTx(async client => {
      const lockRes = await client.query(
        `SELECT u.store_name, u.monthly_fee, u.prepaid_balance,
                u.payment_status  AS store_payment_status,
                u.plan_expires_at AS store_plan_expires_at,
                c.payment_status  AS company_payment_status,
                c.plan_expires_at AS company_plan_expires_at
         FROM flyer_users u
         JOIN flyer_companies c ON c.id = u.company_id
         WHERE u.id = $1 AND u.deleted_at IS NULL
         FOR NO KEY UPDATE OF u`,
        [userId]
      );
      if (lockRes.rows.length === 0) return { ok: false as const, reason: '매장 정보를 찾을 수 없습니다' };
      const cur = lockRes.rows[0];

      const curAccess = resolveFlyerStoreAccess({
        companyPaymentStatus: cur.company_payment_status,
        companyPlanExpiresAt: cur.company_plan_expires_at,
        storePaymentStatus: cur.store_payment_status,
        storePlanExpiresAt: cur.store_plan_expires_at,
      });
      if (!curAccess.allowed && !curAccess.billingAccessible) {
        return { ok: false as const, reason: curAccess.reason, code: curAccess.code, status: 403 as const };
      }

      const fee = Number(cur.monthly_fee || 150000);
      // 멱등 키 = 직전 만료일. 더블클릭 2번째는 같은 키로 들어와 돈이 다시 움직이지 않는다.
      const opId = `subscribe:${userId}:${cur.store_plan_expires_at ? String(cur.store_plan_expires_at).slice(0, 10) : 'none'}`;

      const charged = await changeFlyerBalance(client, {
        userId,
        amount: -fee,
        type: 'subscribe',
        description: '월 이용료 결제 (30일)',
        operationId: opId,
        createdBy: 'store',
      });
      if (!charged.ok) return { ok: false as const, reason: charged.reason };
      if (charged.replayed) {
        // 이미 처리된 요청 — 기간을 또 늘리지 않는다
        const cur2 = await client.query(
          `SELECT store_name, prepaid_balance, payment_status, plan_started_at, plan_expires_at
           FROM flyer_users WHERE id = $1`, [userId]
        );
        return { ok: true as const, row: cur2.rows[0], balanceAfter: charged.balanceAfter, fee, replayed: true };
      }

      // 만료일은 당일까지 유효(포함) 규칙이다 → 신규·만료는 오늘 포함 30일 = 오늘 + 29일.
      // 이미 유효한 구독은 포함 만료일 뒤로 30일을 더한다.
      const planRes = await client.query(
        `UPDATE flyer_users
         SET payment_status = 'active',
             plan_started_at = CASE WHEN payment_status <> 'active'
               THEN (NOW() AT TIME ZONE 'Asia/Seoul')::date ELSE plan_started_at END,
             plan_expires_at = CASE
               WHEN payment_status = 'active' AND plan_expires_at >= (NOW() AT TIME ZONE 'Asia/Seoul')::date
                 THEN plan_expires_at + INTERVAL '30 days'
               ELSE (NOW() AT TIME ZONE 'Asia/Seoul')::date + INTERVAL '29 days'
             END,
             updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING store_name, prepaid_balance, payment_status, plan_started_at, plan_expires_at`,
        [userId]
      );
      // ★ 기간 갱신이 0행이면 돈만 빠진 상태가 된다. 던져서 차감까지 롤백한다.
      if (planRes.rows.length === 0) throw new Error('subscribe: 기간 갱신 대상 매장 없음');
      return { ok: true as const, row: planRes.rows[0], balanceAfter: charged.balanceAfter, fee, replayed: false };
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.reason || '결제 처리에 실패했습니다. 다시 시도해주세요.',
        ...(result.code ? { code: result.code } : {}),
      });
    }
    const fee = result.fee;

    const updated = result.row;
    console.log(`[flyer/balance] 이용료 결제: ${updated.store_name} ₩${fee.toLocaleString()} → 잔액 ₩${Number(result.balanceAfter).toLocaleString()}, 만료 ${updated.plan_expires_at}`);

    return res.json({
      success: true,
      message: `이용료 ₩${fee.toLocaleString()} 결제 완료. 30일간 전단AI를 이용하실 수 있습니다.`,
      fee,
      balance: Number(result.balanceAfter),
      plan_expires_at: updated.plan_expires_at,
    });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'flyer_balance_transactions 신규 테이블')) return;
    console.error('[flyer/balance] subscribe error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

export default router;
