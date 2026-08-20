/**
 * ★ 전단AI 전용 인증 미들웨어 (CT-F)
 *
 * 한줄로 middlewares/auth.ts와 완전 분리.
 * - flyer_users 테이블 기반 사용자 인증
 * - JWT payload에 service='flyer' 강제 주입 → 한줄로 토큰 교차 사용 차단
 * - flyer_companies 기반 회사 격리
 *
 * 참조 문서: FLYER-MIGRATION-PLAN.md, FLYER-SUPERADMIN.md
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import {
  resolveFlyerStoreAccess,
  isFlyerBillingOpenPath,
  type FlyerAccessResult,
} from '../utils/flyer/billing/flyer-payment-status';

export interface FlyerJwtPayload {
  service: 'flyer';
  userId: string;
  companyId: string;
  role: 'flyer_admin' | 'flyer_staff';
  loginId: string;
  businessType: string; // D113: 업종 (mart/butcher 등)
  sessionId?: string;
}

declare global {
  namespace Express {
    interface Request {
      flyerUser?: FlyerJwtPayload;
      /** ★ CT-F26 판정 결과. 인증 통과 후 라우트가 재조회 없이 쓴다. */
      flyerAccess?: FlyerAccessResult;
    }
  }
}

// 전단AI 전용 JWT 시크릿. 미설정 시 메인 JWT_SECRET 재사용(서버 기동 시 자동 fallback)
const FLYER_JWT_SECRET = process.env.FLYER_JWT_SECRET || process.env.JWT_SECRET;
if (!FLYER_JWT_SECRET) {
  console.error('❌ [FATAL] FLYER_JWT_SECRET(또는 JWT_SECRET) 미설정. 서버 기동 불가.');
  process.exit(1);
}

const FLYER_JWT_EXPIRY = process.env.FLYER_JWT_EXPIRY || '24h';

export const generateFlyerToken = (payload: Omit<FlyerJwtPayload, 'service'>): string => {
  const full: FlyerJwtPayload = { ...payload, service: 'flyer' };
  return jwt.sign(full as object, FLYER_JWT_SECRET, { expiresIn: FLYER_JWT_EXPIRY } as any);
};

export const verifyFlyerToken = (token: string): FlyerJwtPayload => {
  const decoded = jwt.verify(token, FLYER_JWT_SECRET) as FlyerJwtPayload;
  if (decoded.service !== 'flyer') {
    throw new Error('Not a flyer token');
  }
  return decoded;
};

/**
 * 전단AI 전용 인증 미들웨어.
 * 한줄로 authenticate와 엄격히 분리. 한줄로 토큰은 service 필드 없어서 거부됨.
 */
export const flyerAuthenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyFlyerToken(token);
    req.flyerUser = decoded;

    // ★ CT-F26: 총판 + 매장 상태를 한 번에 읽어 판정에 넘긴다.
    //   컬럼명이 겹치므로 매장 쪽은 반드시 별칭으로 받는다(u.* 뒤에 c.payment_status를 두면 뒤 값이 이긴다).
    const rowRes = await query(
      `SELECT c.payment_status  AS company_payment_status,
              c.plan_expires_at AS company_plan_expires_at,
              c.deleted_at      AS company_deleted_at,
              u.payment_status  AS store_payment_status,
              u.plan_expires_at AS store_plan_expires_at,
              u.deleted_at      AS store_deleted_at,
              u.business_type
       FROM flyer_users u
       JOIN flyer_companies c ON c.id = u.company_id
       WHERE u.id = $1 AND u.company_id = $2`,
      [decoded.userId, decoded.companyId]
    );
    if (rowRes.rows.length === 0) {
      return res.status(401).json({ error: 'User not found or disabled' });
    }

    const row = rowRes.rows[0];
    if (row.company_deleted_at) {
      return res.status(401).json({ error: 'Company not found or deleted' });
    }
    if (row.store_deleted_at) {
      return res.status(401).json({ error: 'User not found or disabled' });
    }

    const access = resolveFlyerStoreAccess({
      companyPaymentStatus: row.company_payment_status,
      companyPlanExpiresAt: row.company_plan_expires_at,
      storePaymentStatus: row.store_payment_status,
      storePlanExpiresAt: row.store_plan_expires_at,
    });

    // 미결제·기간만료처럼 매장이 스스로 해소할 수 있는 차단은 결제·인증 경로만 열어둔다.
    // 결제 엔드포인트를 차단 뒤에 두면 만료된 매장이 결제 자체를 못 하는 잠금이 된다.
    if (!access.allowed && !(access.billingAccessible && isFlyerBillingOpenPath(req.baseUrl))) {
      return res.status(403).json({ error: access.reason, code: access.code });
    }

    req.flyerAccess = access;

    // D113: JWT에 businessType 없으면 DB에서 보정 (기존 토큰 하위호환)
    if (!decoded.businessType) {
      decoded.businessType = row.business_type || 'mart';
      req.flyerUser = decoded;
    }

    next();
  } catch (error: any) {
    return res.status(401).json({ error: 'Invalid token', detail: error?.message });
  }
};

/**
 * flyer_admin 권한 전용 가드 (사장님). flyer_staff(직원) 차단.
 */
export const requireFlyerAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.flyerUser || req.flyerUser.role !== 'flyer_admin') {
    return res.status(403).json({ error: '관리자 권한이 필요합니다' });
  }
  next();
};

export default { flyerAuthenticate, requireFlyerAdmin, generateFlyerToken, verifyFlyerToken };
