/**
 * ★ 전단AI 발신번호 등록 신청 라우트 (D156 — 승인 플로우 + 통신가입증명원)
 * 마운트: /api/flyer/companies/sender-registration
 *
 * 한줄로 본진 manage-callbacks.ts(company_admin 즉시 CRUD) 패턴과 다름:
 * - 매장 사장님(flyer_admin)이 신청 + 통신가입증명원 업로드
 * - 슈퍼관리자가 승인/반려 (routes/admin/flyer-admin.ts에 별도 라우트)
 * - 승인 시 flyer_callback_numbers 신규 row 자동 INSERT
 *
 * 신규 테이블: flyer_sender_registrations
 */

import { Request, Response, Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query } from '../../config/database';
import { flyerAuthenticate, requireFlyerAdmin } from '../../middlewares/flyer-auth';

const router = Router();
router.use(flyerAuthenticate);

// 통신가입증명원 업로드 디렉토리
const CERT_DIR = path.join(process.cwd(), 'uploads', 'flyer-sender-certificates');
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

const certUpload = multer({
  storage: multer.diskStorage({
    destination: CERT_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '';
      const safe = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      cb(null, safe + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ok = /(pdf|jpg|jpeg|png|gif)$/i.test(file.mimetype || '') || /\.(pdf|jpg|jpeg|png|gif)$/i.test(file.originalname || '');
    if (ok) return cb(null, true);
    return cb(new Error('PDF 또는 이미지 파일만 업로드 가능합니다'));
  },
});

/**
 * GET /my — 내 회사 발신번호(승인된) + 신청 이력 통합
 */
router.get('/my', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const [numbers, requests] = await Promise.all([
      query(
        `SELECT id, phone, label, is_default, created_at
         FROM flyer_callback_numbers
         WHERE company_id = $1 AND deleted_at IS NULL
         ORDER BY is_default DESC, created_at ASC`,
        [companyId]
      ),
      query(
        `SELECT id, phone, label, certificate_filename, carrier, business_name, business_number,
                status, rejection_reason, requested_at, processed_at
         FROM flyer_sender_registrations
         WHERE company_id = $1
         ORDER BY requested_at DESC
         LIMIT 50`,
        [companyId]
      ),
    ]);
    return res.json({ numbers: numbers.rows, requests: requests.rows });
  } catch (error: any) {
    console.error('[sender-registration/my]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /request — 발신번호 등록 신청 (통신가입증명원 multer 업로드)
 * required: phone + certificate(file)
 * optional: label / carrier / business_name / business_number / notes
 */
router.post('/request', requireFlyerAdmin, certUpload.single('certificate'), async (req: Request, res: Response) => {
  try {
    const { companyId, userId } = req.flyerUser!;
    const { phone, label, carrier, business_name, business_number, notes } = req.body;

    if (!phone) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: '발신번호 필수' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '통신가입증명원 파일 필수 (PDF 또는 이미지)' });
    }

    // 중복 신청 차단 (pending 또는 approved 상태 있으면 거부)
    const dup = await query(
      `SELECT status FROM flyer_sender_registrations
       WHERE company_id = $1 AND phone = $2 AND status IN ('pending', 'approved')
       ORDER BY requested_at DESC LIMIT 1`,
      [companyId, phone]
    );
    if (dup.rows.length > 0) {
      try { fs.unlinkSync(req.file.path); } catch {}
      const stat = dup.rows[0].status === 'pending' ? '심사 중' : '이미 등록됨';
      return res.status(400).json({ error: `해당 발신번호는 ${stat}입니다` });
    }

    const certificateFilename = req.file.originalname;
    const certificateUrl = `/api/flyer/companies/sender-registration/certificate/${path.basename(req.file.path)}`;

    const result = await query(
      `INSERT INTO flyer_sender_registrations
         (id, company_id, user_id, phone, label, certificate_url, certificate_filename,
          carrier, business_name, business_number, notes, status, requested_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW())
       RETURNING id, phone, status, requested_at`,
      [
        companyId, userId, phone, label || null,
        certificateUrl, certificateFilename,
        carrier || null, business_name || null, business_number || null, notes || null,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    console.error('[sender-registration/request]', error.message);
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

/**
 * GET /certificate/:filename — 통신가입증명원 다운로드 (본인만)
 * 슈퍼관리자 다운로드는 /api/admin/flyer/sender-registrations/:id/certificate (별도 라우트)
 */
router.get('/certificate/:filename', async (req: Request, res: Response) => {
  try {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(CERT_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

    const { companyId } = req.flyerUser!;
    const certUrl = `/api/flyer/companies/sender-registration/certificate/${filename}`;
    const own = await query(
      `SELECT id FROM flyer_sender_registrations
       WHERE company_id = $1 AND certificate_url = $2 LIMIT 1`,
      [companyId, certUrl]
    );
    if (own.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

    return res.sendFile(filePath);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /:id — 본인 신청 취소 (pending만)
 */
router.delete('/:id', requireFlyerAdmin, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const result = await query(
      `DELETE FROM flyer_sender_registrations
       WHERE id = $1 AND company_id = $2 AND status = 'pending'
       RETURNING certificate_url`,
      [req.params.id, companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '대기 중인 신청만 취소 가능' });
    }
    const certUrl = result.rows[0].certificate_url;
    if (certUrl) {
      const filename = path.basename(certUrl);
      try { fs.unlinkSync(path.join(CERT_DIR, filename)); } catch {}
    }
    return res.json({ message: '신청이 취소되었습니다' });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
