/**
 * ★ D112: 전단AI 슈퍼관리자 통합 라우트
 * 마운트: /api/admin/flyer
 *
 * 전단AI 모드에서의 회사/사용자/캠페인/결제/POS Agent 관리.
 * flyer_* 테이블만 조회. 한줄로 companies/users 무접촉.
 */

import { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../../config/database';
import { flyerSuperAuthenticate } from '../../middlewares/super-auth';

const router = Router();

// ★ hanjulDM 슈퍼관리자(flyer_super_admins) 인증 통과 후 데이터 API 접근
// (한줄AI authenticate + requireSuperAdmin 의존성 제거 — D153)
router.use(flyerSuperAuthenticate);

// ══════════════════════════════════════════
// 대시보드 통계
// ══════════════════════════════════════════
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    // ★ D155 확장: 매장수 + POS Agent 활성/전체 + 이달 청구액 추가
    const [companies, users, campaigns, customers, stores, posAgents, billing, senderReg] = await Promise.all([
      query(`SELECT COUNT(*)::int AS cnt FROM flyer_companies WHERE deleted_at IS NULL`),
      query(`SELECT COUNT(*)::int AS cnt FROM flyer_users WHERE deleted_at IS NULL`),
      query(`SELECT
               COUNT(*)::int AS total,
               COALESCE(SUM(sent_count), 0)::int AS total_sent,
               COALESCE(SUM(success_count), 0)::int AS total_success
             FROM flyer_campaigns WHERE status IN ('completed','sending')`),
      query(`SELECT COUNT(*)::int AS cnt FROM flyer_customers WHERE deleted_at IS NULL`),
      query(`SELECT COUNT(*)::int AS cnt FROM flyer_users WHERE deleted_at IS NULL AND store_name IS NOT NULL`),
      query(`SELECT
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE last_heartbeat > NOW() - INTERVAL '5 minutes')::int AS active
             FROM flyer_pos_agents`),
      query(`SELECT
               COALESCE(SUM(amount), 0)::bigint AS month_total,
               COUNT(*) FILTER (WHERE status != 'paid')::int AS unpaid_count
             FROM flyer_billing_history
             WHERE billing_month >= DATE_TRUNC('month', CURRENT_DATE)`),
      // ★ D156: 발신번호 등록 신청 대기 카운트
      query(`SELECT COUNT(*)::int AS cnt FROM flyer_sender_registrations WHERE status = 'pending'`),
    ]);

    return res.json({
      activeCompanies: companies.rows[0]?.cnt || 0,
      totalUsers: users.rows[0]?.cnt || 0,
      totalCampaigns: campaigns.rows[0]?.total || 0,
      totalSent: campaigns.rows[0]?.total_sent || 0,
      totalSuccess: campaigns.rows[0]?.total_success || 0,
      totalCustomers: customers.rows[0]?.cnt || 0,
      // D155 확장
      totalStores: stores.rows[0]?.cnt || 0,
      posAgentsTotal: posAgents.rows[0]?.total || 0,
      posAgentsActive: posAgents.rows[0]?.active || 0,
      monthlyBilling: Number(billing.rows[0]?.month_total || 0),
      unpaidCount: billing.rows[0]?.unpaid_count || 0,
      // D156 확장
      senderRegPending: senderReg.rows[0]?.cnt || 0,
    });
  } catch (error: any) {
    console.error('[admin/flyer] dashboard error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// 회사 관리 (flyer_companies)
// ══════════════════════════════════════════
router.get('/companies', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string || '';
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = 20;
    const offset = (page - 1) * limit;

    let where = `deleted_at IS NULL`;
    const params: any[] = [];
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (company_name ILIKE $${params.length} OR owner_name ILIKE $${params.length})`;
    }

    const countRes = await query(`SELECT COUNT(*)::int AS cnt FROM flyer_companies WHERE ${where}`, params);
    params.push(limit, offset);
    const listRes = await query(
      `SELECT id, company_name, business_type, owner_name, owner_phone,
              plan_type, monthly_fee, payment_status, pos_type, pos_last_sync_at,
              created_at
       FROM flyer_companies WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({ items: listRes.rows, total: countRes.rows[0]?.cnt || 0, page, pageSize: limit });
  } catch (error: any) {
    console.error('[admin/flyer] companies list error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/companies', async (req: Request, res: Response) => {
  try {
    const {
      company_name, business_type, business_number, owner_name, owner_phone,
      address, store_hours, pos_type,
      // ★ D114: 사업자등록증 + 세금계산서 전체 필드
      business_reg_name, business_reg_owner, business_category, business_item, business_address,
      tax_email, tax_manager_name, tax_manager_phone,
      admin_login_id, admin_password, admin_name, admin_email,
    } = req.body;

    if (!company_name || !admin_login_id || !admin_password) {
      return res.status(400).json({ error: '회사명, 관리자 아이디, 비밀번호는 필수입니다' });
    }

    // ★ D114: 총판명 중복 방지
    const dupCheck = await query('SELECT id FROM flyer_companies WHERE company_name = $1 AND deleted_at IS NULL', [company_name]);
    if (dupCheck.rows.length > 0) {
      return res.status(400).json({ error: `"${company_name}" 총판이 이미 존재합니다.` });
    }

    // 1. 회사 생성
    const companyRes = await query(
      `INSERT INTO flyer_companies
         (id, company_name, business_type, business_number, owner_name, owner_phone,
          address, store_hours, pos_type, plan_type, monthly_fee, payment_status,
          plan_started_at,
          business_reg_name, business_reg_owner, business_category, business_item, business_address,
          tax_email, tax_manager_name, tax_manager_phone,
          created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
               'flyer_basic', 150000, 'active', CURRENT_DATE,
               $9, $10, $11, $12, $13, $14, $15, $16,
               NOW())
       RETURNING id`,
      [company_name, business_type || 'mart', business_number || null,
       owner_name || null, owner_phone || null, address || null,
       store_hours || null, pos_type || null,
       business_reg_name || null, business_reg_owner || null,
       business_category || null, business_item || null, business_address || null,
       tax_email || null, tax_manager_name || null, tax_manager_phone || null]
    );
    const companyId = companyRes.rows[0].id;

    // 2. 관리자 사용자 생성 (login_id 기반)
    const hash = await bcrypt.hash(admin_password, 10);
    await query(
      `INSERT INTO flyer_users (id, company_id, login_id, email, password_hash, name, role, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'flyer_admin', NOW())`,
      [companyId, admin_login_id, admin_email || '', hash, admin_name || owner_name || '관리자']
    );

    return res.status(201).json({ id: companyId, company_name });
  } catch (error: any) {
    console.error('[admin/flyer] company create error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 존재하는 이메일입니다' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/companies/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(`SELECT * FROM flyer_companies WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const users = await query(
      `SELECT id, email, name, role, last_login_at, created_at
       FROM flyer_users WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [id]
    );

    const customers = await query(
      `SELECT COUNT(*)::int AS cnt FROM flyer_customers WHERE company_id = $1 AND deleted_at IS NULL`,
      [id]
    );

    return res.json({
      ...result.rows[0],
      users: users.rows,
      customerCount: customers.rows[0]?.cnt || 0,
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/companies/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    // ★ D114: 사업자등록증 전체 필드 + 세금계산서 허용 추가
    const allowed = [
      'company_name', 'business_type', 'business_number', 'owner_name', 'owner_phone',
      'address', 'store_hours', 'pos_type', 'monthly_fee', 'payment_status',
      'opt_out_080_number', 'sms_unit_price', 'lms_unit_price', 'mms_unit_price',
      'business_reg_name', 'business_reg_owner', 'business_category', 'business_item',
      'business_address', 'tax_email', 'tax_manager_name', 'tax_manager_phone',
    ];

    const sets: string[] = [];
    const params: any[] = [id];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    sets.push(`updated_at = NOW()`);
    await query(`UPDATE flyer_companies SET ${sets.join(', ')} WHERE id = $1`, params);
    return res.json({ message: '수정되었습니다' });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ★ D155: 회사 soft delete + 회원 cascade + 슈퍼관리자 감사로그
router.delete('/companies/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.params.id;
    const superAdmin = req.flyerSuperUser!;

    // 회사 + 회원수 정보 조회 (audit log details)
    const companyRes = await query(
      `SELECT company_name FROM flyer_companies WHERE id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    if (companyRes.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없거나 이미 삭제됨' });
    }
    const companyName = companyRes.rows[0].company_name;

    const usersRes = await query(
      `SELECT COUNT(*)::int AS cnt FROM flyer_users WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    const cascadeUserCount = usersRes.rows[0].cnt;

    // 회원 cascade soft delete (회사 삭제 = 소속 회원도 함께)
    await query(
      `UPDATE flyer_users SET deleted_at = NOW() WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );

    // 회사 soft delete
    await query(`UPDATE flyer_companies SET deleted_at = NOW() WHERE id = $1`, [companyId]);

    // 슈퍼관리자 감사로그
    await logFlyerSuperAdminAudit({
      superAdminId: superAdmin.adminId,
      superAdminLoginId: superAdmin.loginId,
      action: 'company_delete',
      targetType: 'company',
      targetId: companyId,
      targetCompanyId: companyId,
      details: { companyName, cascadeUserCount },
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    return res.json({ message: '삭제되었습니다', cascadeUserCount });
  } catch (error: any) {
    console.error('[flyer-admin] company DELETE error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ★ D155: 회원 soft delete + 슈퍼관리자 감사로그
router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const superAdmin = req.flyerSuperUser!;

    const userRes = await query(
      `SELECT login_id, name, company_id, store_name FROM flyer_users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: '회원을 찾을 수 없거나 이미 삭제됨' });
    }
    const user = userRes.rows[0];

    await query(`UPDATE flyer_users SET deleted_at = NOW() WHERE id = $1`, [userId]);

    await logFlyerSuperAdminAudit({
      superAdminId: superAdmin.adminId,
      superAdminLoginId: superAdmin.loginId,
      action: 'user_delete',
      targetType: 'user',
      targetId: userId,
      targetCompanyId: user.company_id || null,
      details: { loginId: user.login_id, name: user.name, storeName: user.store_name },
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    return res.json({ message: '삭제되었습니다' });
  } catch (error: any) {
    console.error('[flyer-admin] user DELETE error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// 사용자 관리 (flyer_users)
// ══════════════════════════════════════════
router.get('/users', async (req: Request, res: Response) => {
  try {
    const companyId = req.query.companyId as string;
    const where = companyId
      ? `u.company_id = $1 AND u.deleted_at IS NULL`
      : `u.deleted_at IS NULL`;
    const params = companyId ? [companyId] : [];

    const result = await query(
      `SELECT u.id, u.email, u.name, u.role, u.last_login_at, u.created_at,
              c.company_name
       FROM flyer_users u
       JOIN flyer_companies c ON c.id = u.company_id
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT 100`,
      params
    );
    return res.json(result.rows);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users', async (req: Request, res: Response) => {
  try {
    const { company_id, login_id, email, password, name, role } = req.body;
    if (!company_id || !login_id || !password) {
      return res.status(400).json({ error: '회사, 아이디, 비밀번호 필수' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO flyer_users (id, company_id, login_id, email, password_hash, name, role, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, login_id, name, role`,
      [company_id, login_id, email || '', hash, name || null, role || 'flyer_staff']
    );
    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(400).json({ error: '이미 존재하는 아이디' });
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await query(`UPDATE flyer_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, req.params.id]);
    return res.json({ message: '비밀번호가 초기화되었습니다' });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// ★ D113: 매장(store) 관리 — flyer_users 확장 필드 기반
// 슈퍼관리자만 생성/수정/입금확인/충전 가능
// ══════════════════════════════════════════

/**
 * GET /stores — 매장 목록 (필터: companyId, businessType, paymentStatus)
 */
router.get('/stores', async (req: Request, res: Response) => {
  try {
    const { companyId, businessType, paymentStatus, search } = req.query;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = 20;
    const offset = (page - 1) * limit;

    // store_name IS NOT NULL → 매장 등록(POST /stores)으로 생성된 계정만. 총판 자동생성 관리자 제외
    let where = `u.deleted_at IS NULL AND u.store_name IS NOT NULL`;
    const params: any[] = [];
    if (companyId) { params.push(companyId); where += ` AND u.company_id = $${params.length}`; }
    if (businessType) { params.push(businessType); where += ` AND u.business_type = $${params.length}`; }
    if (paymentStatus) { params.push(paymentStatus); where += ` AND u.payment_status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); where += ` AND (u.store_name ILIKE $${params.length} OR u.name ILIKE $${params.length} OR u.login_id ILIKE $${params.length})`; }

    const countRes = await query(`SELECT COUNT(*)::int AS cnt FROM flyer_users u WHERE ${where}`, params);
    params.push(limit, offset);
    const listRes = await query(
      `SELECT u.id, u.login_id, u.name, u.store_name, u.business_type,
              u.business_number, u.payment_status, u.prepaid_balance,
              u.monthly_fee, u.plan_started_at, u.plan_expires_at,
              u.contact_name, u.contact_phone, u.role, u.last_login_at, u.created_at,
              c.company_name
       FROM flyer_users u
       JOIN flyer_companies c ON c.id = u.company_id
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({ items: listRes.rows, total: countRes.rows[0]?.cnt || 0, page, pageSize: limit });
  } catch (error: any) {
    console.error('[admin/flyer] stores list error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /stores — 매장 생성 (사업자등록증 + 세금계산서 + 담당자 + 과금 정보)
 */
router.post('/stores', async (req: Request, res: Response) => {
  try {
    const {
      company_id, login_id, password, name, phone, role,
      business_type, store_name,
      // 사업자등록증
      business_number, business_reg_name, business_reg_owner,
      business_category, business_item, business_address,
      // 세금계산서
      tax_email, tax_manager_name, tax_manager_phone,
      // 담당자
      contact_name, contact_phone, contact_email,
      // 과금
      monthly_fee, plan_started_at,
      // 관리
      memo,
    } = req.body;

    if (!company_id || !login_id || !password || !business_type) {
      return res.status(400).json({ error: '총판, 아이디, 비밀번호, 업종은 필수입니다' });
    }

    // 총판 존재 확인
    const companyCheck = await query(
      `SELECT id FROM flyer_companies WHERE id = $1 AND deleted_at IS NULL`, [company_id]
    );
    if (companyCheck.rows.length === 0) {
      return res.status(400).json({ error: '존재하지 않는 총판입니다' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO flyer_users (
        id, company_id, login_id, email, password_hash, name, phone, role,
        business_type, store_name,
        business_number, business_reg_name, business_reg_owner,
        business_category, business_item, business_address,
        tax_email, tax_manager_name, tax_manager_phone,
        contact_name, contact_phone, contact_email,
        monthly_fee, payment_status, plan_started_at,
        memo, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, '', $3, $4, $5, $6,
        $7, $8,
        $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17,
        $18, $19, $20,
        $21, 'pending', $22,
        $23, NOW()
      ) RETURNING id, login_id, store_name, business_type`,
      [
        company_id, login_id, hash, name || null, phone || null, role || 'flyer_admin',
        business_type, store_name || name || null,
        business_number || null, business_reg_name || null, business_reg_owner || null,
        business_category || null, business_item || null, business_address || null,
        tax_email || null, tax_manager_name || null, tax_manager_phone || null,
        contact_name || null, contact_phone || null, contact_email || null,
        monthly_fee || 150000, plan_started_at || null,
        memo || null,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    console.error('[admin/flyer] store create error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 존재하는 아이디입니다' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /stores/:id — 매장 상세
 */
router.get('/stores/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT u.*, c.company_name
       FROM flyer_users u
       JOIN flyer_companies c ON c.id = u.company_id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    // 비밀번호 해시 제거
    const store = result.rows[0];
    delete store.password_hash;

    return res.json(store);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /stores/:id — 매장 정보 수정
 */
router.put('/stores/:id', async (req: Request, res: Response) => {
  try {
    const fields = req.body;
    const allowed = [
      'name', 'phone', 'store_name', 'business_type',
      'business_number', 'business_reg_name', 'business_reg_owner',
      'business_category', 'business_item', 'business_address',
      'tax_email', 'tax_manager_name', 'tax_manager_phone',
      'contact_name', 'contact_phone', 'contact_email',
      'monthly_fee', 'payment_status', 'plan_started_at', 'plan_expires_at',
      'sms_unit_price', 'lms_unit_price', 'mms_unit_price',
      'memo',
    ];

    const sets: string[] = [];
    const params: any[] = [req.params.id];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    sets.push(`updated_at = NOW()`);
    await query(`UPDATE flyer_users SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL`, params);
    return res.json({ message: '수정되었습니다' });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /stores/:id/activate — 입금 확인 → 잔액 충전 (active 아님!)
 * ★ D114: 입금확인 = 충전만. 매장 사장님이 "이용료 결제" 해야 active.
 */
router.post('/stores/:id/activate', async (req: Request, res: Response) => {
  try {
    const { amount } = req.body; // 입금 금액
    const chargeAmount = parseInt(String(amount || '0'), 10);
    if (chargeAmount <= 0) return res.status(400).json({ error: '입금 금액을 입력해주세요' });

    const result = await query(
      `UPDATE flyer_users
       SET prepaid_balance = prepaid_balance + $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, store_name, prepaid_balance, payment_status`,
      [chargeAmount, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.json({ ...result.rows[0], message: `₩${chargeAmount.toLocaleString()} 충전 완료. 매장에서 이용료 결제 시 활성화됩니다.` });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /stores/:id/charge — 선불 잔액 충전
 */
router.post('/stores/:id/charge', async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;
    const chargeAmount = parseInt(String(amount || '0'), 10);
    if (chargeAmount <= 0) return res.status(400).json({ error: '충전 금액은 1원 이상' });

    const result = await query(
      `UPDATE flyer_users
       SET prepaid_balance = prepaid_balance + $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, store_name, prepaid_balance`,
      [chargeAmount, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(result.rows[0]);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// ★ D113: 업종 관리 (flyer_business_types)
// ══════════════════════════════════════════
router.get('/business-types', async (_req: Request, res: Response) => {
  try {
    const { getAllBusinessTypes } = await import('../../utils/flyer/config/flyer-business-types');
    const types = await getAllBusinessTypes();
    return res.json(types);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// POS Agent 모니터링 (flyer_pos_agents)
// ══════════════════════════════════════════
router.get('/pos-agents', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT pa.*, c.company_name
       FROM flyer_pos_agents pa
       JOIN flyer_companies c ON c.id = pa.company_id
       ORDER BY pa.last_heartbeat DESC NULLS LAST`
    );
    return res.json(result.rows);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/pos-agents/generate-key', async (req: Request, res: Response) => {
  try {
    const { company_id, pos_type } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id 필수' });

    const crypto = await import('crypto');
    const agentKey = `FPA-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const result = await query(
      `INSERT INTO flyer_pos_agents (id, company_id, agent_key, pos_type, sync_status, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'disconnected', NOW())
       RETURNING id, agent_key`,
      [company_id, agentKey, pos_type || null]
    );

    // flyer_companies에도 agent_key/pos_type 업데이트
    await query(
      `UPDATE flyer_companies SET pos_agent_key = $1, pos_type = COALESCE($2, pos_type) WHERE id = $3`,
      [agentKey, pos_type, company_id]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// 결제/과금 (flyer_billing_history)
// ══════════════════════════════════════════
router.get('/billing', async (req: Request, res: Response) => {
  try {
    const companyId = req.query.companyId as string;
    const where = companyId ? `bh.company_id = $1` : `1=1`;
    const params = companyId ? [companyId] : [];

    const result = await query(
      `SELECT bh.*, c.company_name
       FROM flyer_billing_history bh
       JOIN flyer_companies c ON c.id = bh.company_id
       WHERE ${where}
       ORDER BY bh.billing_month DESC
       LIMIT 100`,
      params
    );
    return res.json(result.rows);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// ★ 감사로그 조회 (슈퍼관리자)
// ============================================================
import { queryFlyerAuditLogs, AUDIT_ACTION_LABELS, logFlyerSuperAdminAudit } from '../../utils/flyer/audit/flyer-audit-log';

router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const { company_id, user_id, action, from_date, to_date, page, limit } = req.query;
    const result = await queryFlyerAuditLogs({
      companyId: company_id as string,
      userId: user_id as string,
      action: action as string,
      fromDate: from_date as string,
      toDate: to_date as string,
      page: page ? parseInt(String(page), 10) : 1,
      limit: limit ? parseInt(String(limit), 10) : 50,
    });
    return res.json({ ...result, actionLabels: AUDIT_ACTION_LABELS });
  } catch (error: any) {
    console.error('[flyer-admin] audit-logs error:', error);
    return res.status(500).json({ error: '감사로그 조회 실패' });
  }
});

// ============================================================
// ★ D156: 발신번호 등록 신청 승인 플로우 (매장 사장님 신청 → 슈퍼관리자 처리)
// ============================================================
import fs from 'fs';
import path from 'path';

const SENDER_CERT_DIR = path.join(process.cwd(), 'uploads', 'flyer-sender-certificates');

/**
 * GET /sender-registrations?status= — 전체 신청 목록 (회사명 + 신청자명 join)
 */
router.get('/sender-registrations', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    let where = '1=1';
    const params: any[] = [];
    if (status && typeof status === 'string') {
      params.push(status);
      where += ` AND sr.status = $${params.length}`;
    }
    const result = await query(
      `SELECT sr.id, sr.company_id, sr.user_id, sr.phone, sr.label,
              sr.certificate_url, sr.certificate_filename,
              sr.carrier, sr.business_name, sr.business_number,
              sr.status, sr.rejection_reason, sr.notes,
              sr.requested_at, sr.processed_at,
              c.company_name,
              u.login_id, u.name AS user_name, u.store_name
       FROM flyer_sender_registrations sr
       JOIN flyer_companies c ON c.id = sr.company_id
       LEFT JOIN flyer_users u ON u.id = sr.user_id
       WHERE ${where}
       ORDER BY sr.requested_at DESC
       LIMIT 200`,
      params
    );
    return res.json({ items: result.rows });
  } catch (error: any) {
    console.error('[flyer-admin] sender-registrations list error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /sender-registrations/:id/certificate — 통신가입증명원 다운로드 (슈퍼관리자 전용)
 */
router.get('/sender-registrations/:id/certificate', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT certificate_url, certificate_filename FROM flyer_sender_registrations WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0 || !result.rows[0].certificate_url) {
      return res.status(404).json({ error: '증명원 없음' });
    }
    const certUrl = result.rows[0].certificate_url as string;
    const filename = path.basename(certUrl);
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(SENDER_CERT_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    return res.sendFile(filePath);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /sender-registrations/:id/approve — 승인 → flyer_callback_numbers 신규 INSERT
 */
router.post('/sender-registrations/:id/approve', async (req: Request, res: Response) => {
  try {
    const superAdmin = req.flyerSuperUser!;
    const { id } = req.params;

    // 신청 조회 (pending만 처리)
    const regRes = await query(
      `SELECT * FROM flyer_sender_registrations WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    if (regRes.rows.length === 0) {
      return res.status(404).json({ error: '대기 중인 신청이 아닙니다' });
    }
    const reg = regRes.rows[0];

    // 같은 회사 같은 번호 이미 등록되어 있으면 거부
    const existing = await query(
      `SELECT id FROM flyer_callback_numbers
       WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL`,
      [reg.company_id, reg.phone]
    );
    if (existing.rows.length > 0) {
      // 신청만 approved로 마킹하고 신규 INSERT는 skip
      await query(
        `UPDATE flyer_sender_registrations
         SET status = 'approved', processed_at = NOW(), processed_by = $1, notes = COALESCE(notes,'') || '\n[승인 시 이미 등록된 발신번호로 callback row 신규 INSERT 생략]'
         WHERE id = $2`,
        [superAdmin.adminId, id]
      );
    } else {
      // 신규 발신번호 INSERT (첫 번호면 is_default=true)
      const cnt = await query(
        `SELECT COUNT(*)::int AS cnt FROM flyer_callback_numbers WHERE company_id = $1 AND deleted_at IS NULL`,
        [reg.company_id]
      );
      const isDefault = cnt.rows[0].cnt === 0;
      await query(
        `INSERT INTO flyer_callback_numbers (id, company_id, phone, label, is_default, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
        [reg.company_id, reg.phone, reg.label || null, isDefault]
      );
      // 신청 status 갱신
      await query(
        `UPDATE flyer_sender_registrations
         SET status = 'approved', processed_at = NOW(), processed_by = $1
         WHERE id = $2`,
        [superAdmin.adminId, id]
      );
    }

    // 감사로그
    await logFlyerSuperAdminAudit({
      superAdminId: superAdmin.adminId,
      superAdminLoginId: superAdmin.loginId,
      action: 'sender_registration_approve',
      targetType: 'sender_registration',
      targetId: id,
      targetCompanyId: reg.company_id,
      details: { phone: reg.phone, label: reg.label, carrier: reg.carrier },
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    return res.json({ message: '발신번호 등록이 승인되었습니다', phone: reg.phone });
  } catch (error: any) {
    console.error('[flyer-admin] sender-registrations approve error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /sender-registrations/:id/reject — 반려 (rejection_reason 필수)
 */
router.post('/sender-registrations/:id/reject', async (req: Request, res: Response) => {
  try {
    const superAdmin = req.flyerSuperUser!;
    const { id } = req.params;
    const { rejection_reason } = req.body;
    if (!rejection_reason || String(rejection_reason).trim().length === 0) {
      return res.status(400).json({ error: '반려 사유 필수' });
    }

    const regRes = await query(
      `SELECT company_id, phone FROM flyer_sender_registrations WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    if (regRes.rows.length === 0) {
      return res.status(404).json({ error: '대기 중인 신청이 아닙니다' });
    }
    const reg = regRes.rows[0];

    await query(
      `UPDATE flyer_sender_registrations
       SET status = 'rejected', rejection_reason = $1, processed_at = NOW(), processed_by = $2
       WHERE id = $3`,
      [rejection_reason, superAdmin.adminId, id]
    );

    await logFlyerSuperAdminAudit({
      superAdminId: superAdmin.adminId,
      superAdminLoginId: superAdmin.loginId,
      action: 'sender_registration_reject',
      targetType: 'sender_registration',
      targetId: id,
      targetCompanyId: reg.company_id,
      details: { phone: reg.phone, rejection_reason },
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    return res.json({ message: '발신번호 등록이 반려되었습니다' });
  } catch (error: any) {
    console.error('[flyer-admin] sender-registrations reject error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
