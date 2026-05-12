/**
 * ★ 한줄전단 슈퍼관리자 인증 라우트
 * 마운트: /api/flyer/super
 *
 * 한줄AI routes/auth.ts super_admin 분기 패턴 미러 + flyer_super_admins 테이블 기반.
 * - POST /login — bcrypt + TOTP enrollment / needTotp 분기
 * - POST /confirm-totp — enrollToken 검증 + totp_enabled=true 후 자동 로그인
 * - GET /session-check — flyerSuperAuthenticate 통과 확인
 * - POST /change-password — must_change_password 시 강제 변경 (인증 후)
 */

import bcrypt from 'bcryptjs';
import { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import {
  flyerSuperAuthenticate,
  generateFlyerSuperToken,
  FlyerSuperJwtPayload,
} from '../../middlewares/super-auth';
import {
  generateTotpSecret,
  buildOtpAuthUrl,
  generateQrDataUrl,
  verifyTotpCode,
  generateBackupCodesPlain,
  hashBackupCodes,
  verifyBackupCode,
  signEnrollToken,
  verifyEnrollToken,
  BackupCodeRecord,
} from '../../utils/totp';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const loginId: string = String(req.body.login_id || req.body.loginId || '').trim();
    const { password } = req.body;

    if (!loginId || !password) {
      return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요' });
    }

    const result = await query(
      'SELECT * FROM flyer_super_admins WHERE login_id = $1 AND is_active = true AND deleted_at IS NULL',
      [loginId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 잘못되었습니다' });
    }

    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 잘못되었습니다' });
    }

    // ★ TOTP enrollment 분기 — totp_enabled=false 시 QR + 백업 코드 발급
    if (!admin.totp_enabled) {
      const newSecret = generateTotpSecret();
      const plainBackupCodes = generateBackupCodesPlain();
      const hashedBackupCodes = await hashBackupCodes(plainBackupCodes);
      await query(
        'UPDATE flyer_super_admins SET totp_secret = $1, backup_codes = $2 WHERE id = $3',
        [newSecret, JSON.stringify(hashedBackupCodes), admin.id]
      );
      const otpAuthUrl = buildOtpAuthUrl(admin.login_id, newSecret);
      const qrDataUrl = await generateQrDataUrl(otpAuthUrl);
      const enrollToken = signEnrollToken(admin.id);
      return res.json({
        enrollmentRequired: true,
        enrollToken,
        qrDataUrl,
        backupCodes: plainBackupCodes,
        loginId: admin.login_id,
      });
    }

    // ★ TOTP 검증 분기 — totp_enabled=true 시 6자리 또는 백업코드 8자 hex
    const totpCodeRaw = String(req.body.totpCode || '').trim();
    if (!totpCodeRaw) {
      return res.status(401).json({ error: 'OTP 코드가 필요합니다.', needTotp: true });
    }
    let totpValid = verifyTotpCode(admin.totp_secret, totpCodeRaw);
    let usedBackup = false;
    let updatedBackupCodes: BackupCodeRecord[] = Array.isArray(admin.backup_codes) ? admin.backup_codes : [];
    if (!totpValid) {
      const br = await verifyBackupCode(updatedBackupCodes, totpCodeRaw);
      if (br.matched) {
        totpValid = true;
        usedBackup = true;
        updatedBackupCodes = br.updatedCodes;
      }
    }
    if (!totpValid) {
      return res.status(401).json({ error: 'OTP 코드가 일치하지 않습니다.', needTotp: true });
    }
    if (usedBackup) {
      await query(
        'UPDATE flyer_super_admins SET backup_codes = $1 WHERE id = $2',
        [JSON.stringify(updatedBackupCodes), admin.id]
      );
    }

    const payload: Omit<FlyerSuperJwtPayload, 'service'> = {
      adminId: admin.id,
      loginId: admin.login_id,
      role: admin.role || 'super',
    };
    const token = generateFlyerSuperToken(payload);

    await query(
      'UPDATE flyer_super_admins SET last_login_at = NOW() WHERE id = $1',
      [admin.id]
    );

    return res.json({
      token,
      user: {
        id: admin.id,
        login_id: admin.login_id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        mustChangePassword: admin.must_change_password || false,
      },
    });
  } catch (error: any) {
    console.error('[flyer/super] login error:', error);
    return res.status(500).json({ error: 'Server error', detail: error?.message });
  }
});

/**
 * TOTP 등록 확정 — enrollToken으로 첫 6자리 검증 후 totp_enabled=true + 자동 로그인.
 */
router.post('/confirm-totp', async (req: Request, res: Response) => {
  try {
    const enrollToken = String(req.body.enrollToken || '');
    const code = String(req.body.code || '').trim();
    const adminId = verifyEnrollToken(enrollToken);
    if (!adminId) {
      return res.status(401).json({ error: '등록 토큰이 만료되었습니다. 다시 로그인해주세요.' });
    }
    const r = await query(
      'SELECT * FROM flyer_super_admins WHERE id = $1 AND is_active = true AND deleted_at IS NULL',
      [adminId]
    );
    if (r.rows.length === 0) {
      return res.status(401).json({ error: '관리자 계정을 찾을 수 없습니다.' });
    }
    const admin = r.rows[0];
    if (!admin.totp_secret) {
      return res.status(400).json({ error: '등록 절차를 다시 시작해주세요.' });
    }
    if (!verifyTotpCode(admin.totp_secret, code)) {
      return res.status(401).json({ error: 'OTP 코드가 일치하지 않습니다.' });
    }
    await query('UPDATE flyer_super_admins SET totp_enabled = TRUE WHERE id = $1', [admin.id]);

    const payload: Omit<FlyerSuperJwtPayload, 'service'> = {
      adminId: admin.id,
      loginId: admin.login_id,
      role: admin.role || 'super',
    };
    const token = generateFlyerSuperToken(payload);
    await query(
      'UPDATE flyer_super_admins SET last_login_at = NOW() WHERE id = $1',
      [admin.id]
    );

    return res.json({
      token,
      user: {
        id: admin.id,
        login_id: admin.login_id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        mustChangePassword: admin.must_change_password || false,
      },
    });
  } catch (err: any) {
    console.error('[flyer/super] confirm-totp:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * 세션 확인 (frontend 토큰 유효성).
 */
router.get('/session-check', flyerSuperAuthenticate, async (req: Request, res: Response) => {
  res.json({ ok: true, user: req.flyerSuperUser });
});

/**
 * 비밀번호 변경 — must_change_password 시 진입 또는 일반 변경.
 */
router.post('/change-password', flyerSuperAuthenticate, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다' });
    }
    const adminId = req.flyerSuperUser!.adminId;

    const result = await query('SELECT password_hash FROM flyer_super_admins WHERE id = $1', [adminId]);
    if (result.rows.length === 0) return res.status(404).json({ error: '관리자를 찾을 수 없습니다' });

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다' });

    const newHash = await bcrypt.hash(newPassword, 10);
    await query(
      `UPDATE flyer_super_admins SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2`,
      [newHash, adminId]
    );

    return res.json({ message: '비밀번호가 변경되었습니다' });
  } catch (error: any) {
    console.error('[flyer/super] change-password:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
