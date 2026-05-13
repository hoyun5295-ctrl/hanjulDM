/**
 * /api/flyer/alimtalk/* — 매장 사장님 알림톡 조회 라우트
 *
 * 마운트: /api/flyer/alimtalk
 * 권한: flyerAuthenticate (사장님/직원 둘 다 발송 가능 → 본인 회사 조회만)
 *
 * 정책 (Harold 명시 대행 본질):
 *   - 매장 사장님은 직접 등록·수정 X. 슈퍼관리자(routes/admin/alimtalk.ts) 대행 신청.
 *   - 본 라우트는 발송 화면 dropdown용 + 검수 결과 조회용 단순 SELECT만.
 *   - 회사 ID는 req.flyerUser.companyId 자동 추출 (body/query 무시, 보안).
 *
 * hanjulDM isolation 룰 준수 — 한줄AI 코드 import X, flyer_kakao_* 테이블만.
 */

import { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';

const router = Router();

// 모든 라우트 매장 사용자 인증 (사장님 + 직원 둘 다 통과)
router.use(flyerAuthenticate);

// ════════════════════════════════════════════════════════════
// 발신프로필 목록 (발송 화면 dropdown용)
//   APPROVED + is_active=true만 노출 (PENDING/REJECTED는 슈퍼관리자 화면에서만 보임)
// ════════════════════════════════════════════════════════════

router.get('/senders', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }
    const r = await query(
      `SELECT id, profile_key, profile_name, yellow_id, category_code, category_name_cache,
              admin_phone_number, status, brand_targeting_yn, registered_at
         FROM flyer_kakao_sender_profiles
        WHERE company_id = $1
          AND approval_status = 'APPROVED'
          AND is_active = true
          AND status NOT IN ('DELETED', 'BLOCKED')
        ORDER BY registered_at DESC`,
      [companyId],
    );
    res.json({ success: true, profiles: r.rows });
  } catch (error: any) {
    console.error('[flyer/alimtalk] senders 조회 실패', error);
    res.status(500).json({ success: false, error: '발신프로필 조회에 실패했습니다' });
  }
});

// ════════════════════════════════════════════════════════════
// 알림톡 템플릿 목록 (발송 화면 dropdown용)
//   status='APPROVED'만 노출 (DRAFT/REQUESTED/REVIEWING/KREQ/HREJ/KREJ/REJECTED는 제외 — 발송 불가)
//   profileId 필터 가능 (특정 발신프로필 소속 템플릿만)
// ════════════════════════════════════════════════════════════

router.get('/templates', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }
    const { profileId } = req.query as any;
    const where: string[] = ['t.company_id = $1', `t.status = 'APPROVED'`];
    const params: any[] = [companyId];
    if (profileId) {
      params.push(profileId);
      where.push(`t.profile_id = $${params.length}`);
    }
    const r = await query(
      `SELECT t.id, t.template_code, t.template_key, t.template_name,
              t.content, t.buttons, t.variables, t.message_type,
              t.emphasize_type, t.emphasize_title, t.emphasize_subtitle,
              t.image_url, t.image_name, t.template_header,
              t.item_highlight, t.item_list, t.item_summary, t.represent_link,
              t.security_flag, t.quick_replies, t.preview_message,
              t.approved_at, t.requested_at,
              p.id AS profile_id, p.profile_key, p.profile_name, p.yellow_id
         FROM flyer_kakao_templates t
         LEFT JOIN flyer_kakao_sender_profiles p ON p.id = t.profile_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.approved_at DESC NULLS LAST, t.updated_at DESC`,
      params,
    );
    res.json({ success: true, templates: r.rows });
  } catch (error: any) {
    console.error('[flyer/alimtalk] templates 조회 실패', error);
    res.status(500).json({ success: false, error: '템플릿 조회에 실패했습니다' });
  }
});

// ════════════════════════════════════════════════════════════
// 알림톡 신청 이력 (사장님 본인 회사 전체 검수 진행 상황)
//   APPROVED + 진행중 + REJECTED + DELETED 모두 노출 (이력 추적 + 슈퍼관리자 진행상황 확인)
// ════════════════════════════════════════════════════════════

router.get('/templates/all', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }
    const r = await query(
      `SELECT t.id, t.template_code, t.template_key, t.template_name,
              t.content, t.status, t.reject_reason, t.message_type,
              t.requested_at, t.approved_at, t.updated_at, t.last_synced_at,
              p.profile_name, p.yellow_id
         FROM flyer_kakao_templates t
         LEFT JOIN flyer_kakao_sender_profiles p ON p.id = t.profile_id
        WHERE t.company_id = $1
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC`,
      [companyId],
    );
    res.json({ success: true, templates: r.rows });
  } catch (error: any) {
    console.error('[flyer/alimtalk] templates/all 조회 실패', error);
    res.status(500).json({ success: false, error: '템플릿 이력 조회에 실패했습니다' });
  }
});

// ════════════════════════════════════════════════════════════
// 카테고리 조회 (참고용 — 슈퍼관리자가 등록한 발신프로필/템플릿의 카테고리명 노출)
//   매장 사장님이 직접 등록 안 하지만 카테고리명 표시 시 사용
// ════════════════════════════════════════════════════════════

router.get('/categories/sender', async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT category_code, parent_code, level, name
         FROM flyer_kakao_sender_categories
        WHERE active_yn = 'Y'
        ORDER BY level ASC, category_code ASC`,
    );
    res.json({ success: true, categories: r.rows });
  } catch (error: any) {
    console.error('[flyer/alimtalk] categories/sender 조회 실패', error);
    res.status(500).json({ success: false, error: '카테고리 조회에 실패했습니다' });
  }
});

router.get('/categories/template', async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT category_code, name, group_name, inclusion, exclusion
         FROM flyer_kakao_template_categories
        WHERE active_yn = 'Y'
        ORDER BY group_name NULLS LAST, category_code ASC`,
    );
    res.json({ success: true, categories: r.rows });
  } catch (error: any) {
    console.error('[flyer/alimtalk] categories/template 조회 실패', error);
    res.status(500).json({ success: false, error: '카테고리 조회에 실패했습니다' });
  }
});

export default router;
