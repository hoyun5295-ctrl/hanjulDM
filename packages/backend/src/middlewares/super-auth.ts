/**
 * ★ 한줄전단 슈퍼관리자 인증 미들웨어
 *
 * flyer-auth.ts 패턴 미러 + super 컨텍스트.
 * - flyer_super_admins 테이블 기반
 * - JWT payload service='flyer_super' 강제 → flyer 토큰 + 한줄AI 토큰과 교차 차단
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';

export interface FlyerSuperJwtPayload {
  service: 'flyer_super';
  adminId: string;
  loginId: string;
  role: string;
  sessionId?: string;
}

declare global {
  namespace Express {
    interface Request {
      flyerSuperUser?: FlyerSuperJwtPayload;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ [FATAL] JWT_SECRET 미설정. 서버 기동 불가.');
  process.exit(1);
}

const SUPER_JWT_EXPIRY = process.env.SUPER_JWT_EXPIRY || '24h';

export const generateFlyerSuperToken = (payload: Omit<FlyerSuperJwtPayload, 'service'>): string => {
  const full: FlyerSuperJwtPayload = { ...payload, service: 'flyer_super' };
  return jwt.sign(full as object, JWT_SECRET, { expiresIn: SUPER_JWT_EXPIRY } as any);
};

export const verifyFlyerSuperToken = (token: string): FlyerSuperJwtPayload => {
  const decoded = jwt.verify(token, JWT_SECRET) as FlyerSuperJwtPayload;
  if (decoded.service !== 'flyer_super') {
    throw new Error('Not a flyer_super token');
  }
  return decoded;
};

/**
 * 한줄전단 슈퍼관리자 인증 미들웨어.
 * Bearer token 검증 + flyer_super_admins is_active 확인.
 */
export const flyerSuperAuthenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyFlyerSuperToken(token);
    req.flyerSuperUser = decoded;

    const result = await query(
      'SELECT id, is_active, deleted_at FROM flyer_super_admins WHERE id = $1',
      [decoded.adminId]
    );
    if (result.rows.length === 0 || result.rows[0].deleted_at || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Super admin not found or disabled' });
    }

    next();
  } catch (error: any) {
    return res.status(401).json({ error: 'Invalid token', detail: error?.message });
  }
};

/**
 * super role 가드 (확장 대비 — 향후 role 분기).
 */
export const requireFlyerSuper = (req: Request, res: Response, next: NextFunction) => {
  if (!req.flyerSuperUser) {
    return res.status(403).json({ error: '슈퍼관리자 권한이 필요합니다' });
  }
  next();
};

export default { flyerSuperAuthenticate, requireFlyerSuper, generateFlyerSuperToken, verifyFlyerSuperToken };
