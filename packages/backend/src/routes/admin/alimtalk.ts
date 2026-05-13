/**
 * /api/admin/alimtalk/* — hanjulDM 슈퍼관리자 알림톡 대행 라우트
 *
 * 마운트: /api/admin/alimtalk
 * 한줄AI 본진 routes/alimtalk.ts 핵심 발췌 + 슈퍼관리자 대행 흐름으로 단순화.
 * hanjulDM isolation 룰 준수 — 한줄AI 코드 import X, flyer_super_admins 인증만, flyer_kakao_* 테이블만.
 *
 * 권한:
 *   - router.use(flyerSuperAuthenticate) — 모든 라우트 슈퍼관리자만
 *   - 본진의 회사관리자/슈퍼관리자 분기 폐기 (대행 본질)
 *
 * 대행 흐름:
 *   - 회사/사용자 ID는 body.targetCompanyId + body.targetUserId(템플릿 created_by)로 받음
 *   - 매장 사장님은 결과만 받음 (조회는 Phase D matter)
 *   - 카카오 채널 인증 토큰: 슈퍼관리자가 yellow_id + 사장님 폰 입력 → IMC 토큰 발급 →
 *     사장님 폰 SMS → 사장님이 슈퍼관리자에게 코드 전달 → 슈퍼관리자가 token+코드 입력 → createSender
 */

import { Request, Response, Router } from 'express';
import multer from 'multer';
import { query } from '../../config/database';
import { flyerSuperAuthenticate } from '../../middlewares/super-auth';
import * as imc from '../../utils/flyer/alimtalk/alimtalk-api';
import { ImcApiError } from '../../utils/flyer/alimtalk/alimtalk-api';
import { resolveImcCode } from '../../utils/flyer/alimtalk/alimtalk-result-map';
import {
  syncCategoriesJob,
  syncPendingTemplatesJob,
  syncSenderStatusJob,
} from '../../utils/flyer/alimtalk/alimtalk-jobs';
import { getRecentWebhookEvents } from '../../utils/flyer/alimtalk/alimtalk-webhook-handler';

const router = Router();

// 메모리 storage — IMC로 즉시 스트림
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB (IMC 매뉴얼 한도)
});

// 모든 라우트 슈퍼관리자 인증
router.use(flyerSuperAuthenticate);

// ════════════════════════════════════════════════════════════
// 공통 유틸
// ════════════════════════════════════════════════════════════

/**
 * IMC raw 메시지 정제 — 사용자 노출 텍스트에 영문 ExceptionName/IMC/파일명 제거.
 */
function sanitizeImcMessageForUser(
  rawMsg: string | undefined,
  code: string | undefined,
  fallback: string = '요청 처리에 실패했습니다',
): string {
  const msg = (rawMsg || '').trim();
  if (!msg) return code ? `${fallback} (코드 ${code})` : fallback;
  const m = msg.match(/^[A-Za-z][A-Za-z0-9_]*(?:Exception|Error|Failure)\s*\((.+)\)\s*$/);
  let inner = m ? m[1] : msg;
  const commaIdx = inner.indexOf(',');
  if (commaIdx > 0) inner = inner.slice(0, commaIdx);
  inner = inner.replace(/\bIMC\b/gi, '').replace(/humuson/gi, '').trim();
  inner = inner.replace(/\s{2,}/g, ' ').trim();
  return inner || (code ? `${fallback} (코드 ${code})` : fallback);
}

/**
 * IMC 관리 API 응답 통합 핸들러 — 성공 시 extra 포함, 실패 시 정제된 error 노출.
 */
function sendImcManagedResponse(
  res: Response,
  r: imc.ImcResponse<any>,
  opts: {
    fallback?: string;
    statusOnFail?: number;
    extra?: Record<string, any>;
  } = {},
) {
  const ok = r?.code === '0000';
  if (ok) {
    return res.json({ success: true, ...(opts.extra || {}), imc: r });
  }
  const fallback = opts.fallback || '요청 처리에 실패했습니다';
  console.warn(`[flyer-alimtalk][imc-managed 실패] code=${r?.code || 'N/A'} rawMsg=${r?.message || 'N/A'}`);
  return res.status(opts.statusOnFail || 400).json({
    success: false,
    code: r?.code,
    error: sanitizeImcMessageForUser(r?.message, r?.code, fallback),
    imc: r,
  });
}

/**
 * 다양한 IMC 응답 래핑에서 imageUrl/imageName 추출 — 본진 D143 E + D146 stringCands 미러.
 */
function extractImageFromAnyShape(r: any): { imageUrl?: string; imageName?: string } {
  if (!r) return {};
  const cands = [r?.data, r?.data?.data, r?.data?.data?.data, r?.data?.image, r];
  for (const c of cands) {
    if (c && typeof c === 'object' && (c.imageUrl || c.imageName)) {
      return { imageUrl: c.imageUrl, imageName: c.imageName };
    }
  }
  // D146 stringCands — IMC가 단일 'image' 키 + string URL 변종
  const stringCands = [r?.data?.image, r?.image, r?.data?.imageUrl];
  for (const url of stringCands) {
    if (typeof url === 'string' && url.startsWith('http')) {
      const tail = url.split('/').pop() || '';
      const imageName = (tail.split('?')[0] || 'image').slice(0, 200);
      return { imageUrl: url, imageName };
    }
  }
  return {};
}

function sendImageUploadResponse(
  res: Response,
  r: imc.ImcResponse<imc.ImageUploadResult>,
) {
  const ok = r?.code === '0000';
  if (ok) {
    const { imageUrl, imageName } = extractImageFromAnyShape(r);
    if (!imageUrl || !imageName) {
      console.error(
        `[flyer-alimtalk][image-upload 비정상응답] code=0000인데 추출 불가. raw=${JSON.stringify(r).slice(0, 800)}`,
      );
      return res.status(502).json({
        success: false,
        code: '0000',
        error: '이미지 업로드는 처리됐으나 응답에서 이미지 정보를 추출하지 못했습니다. 다시 시도해주세요.',
        imc: r,
      });
    }
    return res.json({ success: true, imageUrl, imageName, imc: r });
  }
  console.warn(`[flyer-alimtalk][image-upload 실패] code=${r?.code || 'N/A'} rawMsg=${r?.message || 'N/A'}`);
  return res.status(400).json({
    success: false,
    code: r?.code,
    error: sanitizeImcMessageForUser(r?.message, r?.code, '이미지 업로드에 실패했습니다'),
    imc: r,
  });
}

/**
 * multer 한글 파일명 utf-8 복원 (latin1 → utf8).
 */
function decodeOriginalName(file: Express.Multer.File): Express.Multer.File {
  if (file && typeof file.originalname === 'string') {
    try {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {
      /* noop */
    }
  }
  return file;
}

function requireFile(req: Request, res: Response): Express.Multer.File | null {
  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ success: false, error: '파일이 필요합니다' });
    return null;
  }
  return decodeOriginalName(file);
}

function handleImcError(res: Response, err: any): Response {
  if (err instanceof ImcApiError) {
    const mapped = resolveImcCode(err.code);
    const statusHttp =
      mapped.kind === 'user_error' || mapped.kind === 'inspect' ? 400
      : mapped.kind === 'retryable' ? 503
      : 500;
    try {
      const bodyPreview =
        err.responseBody !== undefined
          ? JSON.stringify(err.responseBody).slice(0, 2000)
          : 'n/a';
      console.error(
        `[flyer-alimtalk][IMC ${err.code}] ${err.message} http=${err.httpStatus} kind=${mapped.kind} body=${bodyPreview}`,
      );
    } catch {
      console.error(`[flyer-alimtalk][IMC ${err.code}] ${err.message} http=${err.httpStatus}`);
    }
    return res.status(statusHttp).json({
      success: false,
      code: err.code,
      error: mapped.userMessage || sanitizeImcMessageForUser(err.message, err.code),
      kind: mapped.kind,
    });
  }
  console.error('[flyer-alimtalk] 처리 실패', err);
  return res.status(500).json({
    success: false,
    error: sanitizeImcMessageForUser(err?.message, undefined, '알 수 없는 오류'),
  });
}

function requireTargetCompany(req: Request, res: Response): string | null {
  const companyId = (req.body?.targetCompanyId || req.query?.companyId) as string | undefined;
  if (!companyId) {
    res.status(400).json({ success: false, error: 'targetCompanyId(또는 companyId 쿼리)가 필요합니다' });
    return null;
  }
  return companyId;
}

// templateCode → { senderKey, id, companyId } 찾기 (슈퍼관리자 회사 무관 접근)
type TemplateCtx = { senderKey: string; id: string; companyId: string };

async function resolveTemplateContext(templateCode: string): Promise<TemplateCtx | null> {
  const r = await query(
    `SELECT t.id, t.company_id, p.profile_key
       FROM flyer_kakao_templates t
       JOIN flyer_kakao_sender_profiles p ON p.id = t.profile_id
      WHERE t.template_code = $1
      LIMIT 1`,
    [templateCode],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return { senderKey: row.profile_key, id: row.id, companyId: row.company_id };
}

async function requireTemplateAccess(
  req: Request,
  res: Response,
): Promise<TemplateCtx | null> {
  const ctx = await resolveTemplateContext(req.params.templateCode);
  if (!ctx) {
    res.status(404).json({ success: false, error: '템플릿 없음' });
    return null;
  }
  return ctx;
}

// ════════════════════════════════════════════════════════════
// 발신프로필 (Sender) — 슈퍼관리자 대행
// ════════════════════════════════════════════════════════════

// 인증번호 요청 (yellow_id + 사장님 폰 → IMC가 SMS 발송)
router.post('/senders/token', async (req: Request, res: Response) => {
  try {
    const { yellowId, phoneNumber } = req.body || {};
    if (!yellowId || !phoneNumber) {
      return res.status(400).json({ success: false, error: 'yellowId와 phoneNumber는 필수입니다' });
    }
    const r = await imc.requestSenderToken({ yellowId, phoneNumber });
    res.json({ success: r.code === '0000', imc: r });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// 발신프로필 대행 등록 — body.targetCompanyId 필수
router.post('/senders', async (req: Request, res: Response) => {
  try {
    const {
      token,
      yellowId,
      phoneNumber,
      categoryCode,
      topSenderKeyYn,
      targetCompanyId,
      profileName,
    } = req.body || {};

    if (!token || !yellowId || !phoneNumber || !categoryCode || !targetCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'token/yellowId/phoneNumber/categoryCode/targetCompanyId는 필수입니다',
      });
    }

    // 동일 회사 내 동일 yellow_id 중복 차단
    const dup = await query(
      `SELECT id, profile_key, approval_status, status
         FROM flyer_kakao_sender_profiles
        WHERE company_id = $1 AND yellow_id = $2
        LIMIT 1`,
      [targetCompanyId, yellowId],
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: `이미 등록된 발신프로필입니다 (${yellowId}). 기존 프로필을 사용하거나 삭제 후 재등록 하세요.`,
        existingProfileId: dup.rows[0].id,
      });
    }

    const r = await imc.createSender({
      token,
      yellowId,
      phoneNumber,
      categoryCode,
      topSenderKeyYn,
    });
    if (r.code !== '0000' || !r.data?.senderKey) {
      return res.status(400).json({
        success: false,
        code: r.code,
        error: sanitizeImcMessageForUser(r.message, r.code, '발신프로필 등록에 실패했습니다'),
      });
    }

    // 카테고리 이름 캐시
    let categoryNameCache: string | null = null;
    try {
      const cat = await imc.getSenderCategory(categoryCode);
      if (cat.code === '0000' && cat.data) categoryNameCache = cat.data.name;
    } catch {
      /* 카테고리 조회 실패 무시 */
    }

    // 슈퍼관리자 대행이므로 즉시 APPROVED + approved_by = 슈퍼관리자 ID
    const ins = await query(
      `INSERT INTO flyer_kakao_sender_profiles
         (company_id, profile_key, profile_name, is_active,
          yellow_id, admin_phone_number, category_code, category_name_cache,
          top_sender_yn, custom_sender_key, status,
          approval_status, approval_requested_at,
          approved_at, approved_by,
          registered_at)
       VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,
               'APPROVED', now(),
               now(), $11,
               now())
       RETURNING *`,
      [
        targetCompanyId,
        r.data.senderKey,
        profileName || yellowId,
        yellowId,
        phoneNumber,
        categoryCode,
        categoryNameCache,
        topSenderKeyYn || 'N',
        null, // custom_sender_key 폐지 (D131)
        r.data.status || 'NORMAL',
        req.flyerSuperUser?.adminId || null,
      ],
    );

    res.status(201).json({ success: true, profile: ins.rows[0], imc: r });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// 발신프로필 목록 — query.companyId 선택 (없으면 전체)
router.get('/senders', async (req: Request, res: Response) => {
  try {
    const companyId = (req.query?.companyId as string) || null;
    let rows;
    if (companyId) {
      const r = await query(
        `SELECT p.*, c.company_name
           FROM flyer_kakao_sender_profiles p
           LEFT JOIN flyer_companies c ON c.id = p.company_id
          WHERE p.company_id = $1
          ORDER BY p.created_at DESC`,
        [companyId],
      );
      rows = r.rows;
    } else {
      const r = await query(
        `SELECT p.*, c.company_name
           FROM flyer_kakao_sender_profiles p
           LEFT JOIN flyer_companies c ON c.id = p.company_id
          ORDER BY p.created_at DESC`,
      );
      rows = r.rows;
    }
    res.json({ success: true, profiles: rows });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.get('/senders/:id', async (req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT p.*, c.company_name FROM flyer_kakao_sender_profiles p
         LEFT JOIN flyer_companies c ON c.id = p.company_id
        WHERE p.id = $1`,
      [req.params.id],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: '발신프로필 없음' });
    }
    res.json({ success: true, profile: r.rows[0] });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.put('/senders/:id/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { unsubscribePhoneNumber, unsubscribeAuthNumber } = req.body || {};
    if (!unsubscribePhoneNumber || !unsubscribeAuthNumber) {
      return res.status(400).json({ success: false, error: '080번호와 인증번호가 필요합니다' });
    }
    const row = await query(
      `SELECT profile_key FROM flyer_kakao_sender_profiles WHERE id = $1`,
      [req.params.id],
    );
    if (row.rows.length === 0 || !row.rows[0].profile_key) {
      return res.status(404).json({ success: false, error: '발신프로필 없음' });
    }
    const r = await imc.updateSenderUnsubscribe(row.rows[0].profile_key, {
      unsubscribePhoneNumber,
      unsubscribeAuthNumber,
    });
    await query(
      `UPDATE flyer_kakao_sender_profiles
          SET unsubscribe_phone = $1,
              unsubscribe_auth  = $2,
              updated_at        = now()
        WHERE id = $3`,
      [unsubscribePhoneNumber, unsubscribeAuthNumber, req.params.id],
    );
    res.json({ success: r.code === '0000', imc: r });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.put('/senders/:id/release', async (req: Request, res: Response) => {
  try {
    const row = await query(
      `SELECT profile_key FROM flyer_kakao_sender_profiles WHERE id = $1`,
      [req.params.id],
    );
    if (row.rows.length === 0 || !row.rows[0].profile_key) {
      return res.status(404).json({ success: false, error: '발신프로필 없음' });
    }
    const r = await imc.releaseSenderDormant(row.rows[0].profile_key);
    await query(
      `UPDATE flyer_kakao_sender_profiles SET status='NORMAL', updated_at=now() WHERE id=$1`,
      [req.params.id],
    );
    res.json({ success: r.code === '0000', imc: r });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// ════════════════════════════════════════════════════════════
// 카테고리
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
  } catch (err) {
    return handleImcError(res, err);
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
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.post('/categories/sync', async (_req: Request, res: Response) => {
  try {
    await syncCategoriesJob();
    res.json({ success: true, message: '카테고리 동기화 요청 완료' });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// ════════════════════════════════════════════════════════════
// 알림톡 템플릿 — 슈퍼관리자 대행
// ════════════════════════════════════════════════════════════

// 템플릿 목록 — query.companyId 선택
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const companyId = (req.query?.companyId as string) || null;
    const { status, profileId } = req.query as any;
    const where: string[] = [];
    const params: any[] = [];
    if (companyId) {
      params.push(companyId);
      where.push(`t.company_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }
    if (profileId) {
      params.push(profileId);
      where.push(`t.profile_id = $${params.length}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const r = await query(
      `SELECT t.*, p.profile_key, p.profile_name, c.company_name,
              u.name AS created_by_name, u.login_id AS created_by_login_id
         FROM flyer_kakao_templates t
         LEFT JOIN flyer_kakao_sender_profiles p ON p.id = t.profile_id
         LEFT JOIN flyer_companies c ON c.id = t.company_id
         LEFT JOIN flyer_users u ON u.id = t.created_by
         ${whereSql}
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC`,
      params,
    );
    // BYTEA(증빙자료 data)는 목록에서 제외
    const rows = r.rows.map((row: any) => {
      const { inspection_evidence_data, ...rest } = row;
      void inspection_evidence_data;
      return rest;
    });
    res.json({ success: true, templates: rows });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// 템플릿 대행 등록 — body.targetCompanyId + body.targetUserId(created_by) + profileId 필수
router.post('/templates', async (req: Request, res: Response) => {
  try {
    const { profileId, targetCompanyId, targetUserId, ...body } = req.body || {};
    if (!targetCompanyId || !profileId) {
      return res.status(400).json({ success: false, error: 'targetCompanyId/profileId 필수' });
    }

    // 승인된 발신프로필만 사용 허용
    const prof = await query(
      `SELECT profile_key, approval_status FROM flyer_kakao_sender_profiles
        WHERE id = $1 AND company_id = $2`,
      [profileId, targetCompanyId],
    );
    if (prof.rows.length === 0 || !prof.rows[0].profile_key) {
      return res.status(404).json({ success: false, error: '발신프로필 없음' });
    }
    if (prof.rows[0].approval_status !== 'APPROVED') {
      return res.status(400).json({
        success: false,
        error: '승인 완료된 발신프로필만 사용할 수 있습니다',
      });
    }
    const senderKey = prof.rows[0].profile_key;

    // templateKey IMC 제한 20자
    const rawKey = typeof body.templateKey === 'string' ? body.templateKey.trim() : '';
    if (rawKey && rawKey.length > 20) {
      return res.status(400).json({
        success: false,
        error: 'templateKey는 최대 20자까지 허용됩니다 (IMC 제한)',
      });
    }
    const templateKey: string =
      rawKey ||
      `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.slice(0, 20);

    console.log(
      `[flyer-alimtalk][createTemplate 진입] targetCompanyId=${targetCompanyId} templateKey=${templateKey} manageName=${body.manageName}`,
    );

    let r = await imc.createAlimtalkTemplate(senderKey, {
      ...body,
      templateKey,
    });

    // D147 3단계 fallback (templateCode → templateKey → 로컬 templateKey)
    let templateCode: string | null =
      r.data?.templateCode || (r.data as any)?.templateKey || templateKey || null;

    // D135+ B3 복구: 4014 중복 → 기존 템플릿 조회
    if (r.code === '4014' && !templateCode) {
      try {
        const lst = await imc.listAlimtalkTemplates({ page: 0, count: 100 });
        const items: any[] =
          (lst.data as any)?.list || (lst.data as any)?.data?.list || [];
        const found = items.find((t: any) => t.templateKey === templateKey);
        if (found?.templateCode) {
          templateCode = found.templateCode;
          r = { code: '0000', message: 'OK (B3 복구)', data: found };
          console.log(`[flyer-alimtalk][B3 복구] templateKey=${templateKey} → templateCode=${templateCode}`);
        }
      } catch (lookupErr: any) {
        console.error('[flyer-alimtalk][B3 복구 실패]', lookupErr?.message || lookupErr);
      }
    }

    if (r.code !== '0000' || !templateCode) {
      return res.status(400).json({
        success: false,
        code: r.code,
        error: sanitizeImcMessageForUser(r.message, r.code, '템플릿 등록에 실패했습니다'),
      });
    }

    // D139 #1+#3: PG INSERT 실패 시 IMC 롤백
    let ins;
    try {
      // D146: emphasize_subtitle + emphasize_sub_title 두 컬럼 동시 INSERT (정합화)
      ins = await query(
      `INSERT INTO flyer_kakao_templates
         (company_id, profile_id, template_code, template_key, template_name,
          content, buttons, variables, status,
          category, message_type, emphasize_type, emphasize_title, emphasize_subtitle, emphasize_sub_title,
          image_name, extra_content, ad_content, security_flag, quick_replies,
          template_header, item_highlight, item_list, item_summary, represent_link,
          preview_message, alarm_phone_numbers, service_mode, custom_template_code,
          created_by, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text[],'DRAFT',
               $9,$10,$11,$12,$13,$13,$14,$15,$16,$17,$18::jsonb,
               $19,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,
               $24,$25,$26,$27,$28,now())
       RETURNING *`,
      [
        targetCompanyId,
        profileId,
        templateCode,
        templateKey,
        body.manageName,
        body.templateContent,
        JSON.stringify(body.buttonList || []),
        body.variables || [],
        body.categoryCode,
        body.templateMessageType,
        body.templateEmphasizeType,
        body.templateTitle || null,
        body.templateSubtitle || null,
        body.templateImageName || null,
        body.templateExtra || null,
        body.adContent || null,
        body.securityFlag || false,
        JSON.stringify(body.quickReplyList || []),
        body.templateHeader || null,
        body.templateItemHighlight ? JSON.stringify(body.templateItemHighlight) : null,
        body.templateItem?.list ? JSON.stringify(body.templateItem.list) : null,
        body.templateItem?.summary ? JSON.stringify(body.templateItem.summary) : null,
        body.templateRepresentLink ? JSON.stringify(body.templateRepresentLink) : null,
        body.templatePreviewMessage || null,
        body.alarmPhoneNumber || null,
        body.serviceMode || 'PRD',
        body.customTemplateCode || null,
        targetUserId || null,
      ],
      );
    } catch (insertErr: any) {
      const errDetail = insertErr?.message || insertErr?.detail || '알 수 없는 DB 오류';
      console.error(
        `[flyer-alimtalk][DB INSERT 실패] templateCode=${templateCode} templateKey=${templateKey} → IMC 롤백 시도. detail=${errDetail}`,
      );
      try {
        await imc.deleteAlimtalkTemplate(senderKey, templateCode);
        console.log(`[flyer-alimtalk][롤백] IMC 템플릿 삭제 완료: ${templateCode}`);
      } catch (rollbackErr: any) {
        console.error(
          `[flyer-alimtalk][롤백 실패] ${templateCode}: ${rollbackErr?.message || rollbackErr}`,
        );
      }
      return res.status(500).json({
        success: false,
        error: `DB 저장에 실패했습니다 (${errDetail}). IMC 등록은 자동 롤백되었습니다. 다시 시도해주세요.`,
        dbError: errDetail,
      });
    }

    console.log(
      `[flyer-alimtalk][createTemplate 성공] id=${ins.rows[0].id} templateCode=${templateCode} status=DRAFT`,
    );

    res.status(201).json({ success: true, template: ins.rows[0], imc: r });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.get('/templates/:templateCode', async (req: Request, res: Response) => {
  try {
    const ctx = await requireTemplateAccess(req, res);
    if (!ctx) return;

    // IMC 최신 상태 동기화
    try {
      const r = await imc.getAlimtalkTemplate(ctx.senderKey, req.params.templateCode);
      if (r.code === '0000' && r.data) {
        await query(
          `UPDATE flyer_kakao_templates
              SET status = $1, last_synced_at = now()
            WHERE id = $2`,
          [(r.data as any).inspectionStatus || (r.data as any).status || 'UNKNOWN', ctx.id],
        );
      }
    } catch {
      /* IMC 실패 시 DB 폴백 */
    }

    const row = await query(
      `SELECT t.*, p.profile_key, p.profile_name, c.company_name,
              u.name AS created_by_name, u.login_id AS created_by_login_id
         FROM flyer_kakao_templates t
         LEFT JOIN flyer_kakao_sender_profiles p ON p.id = t.profile_id
         LEFT JOIN flyer_companies c ON c.id = t.company_id
         LEFT JOIN flyer_users u ON u.id = t.created_by
        WHERE t.id = $1`,
      [ctx.id],
    );
    res.json({ success: true, template: row.rows[0] });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// 템플릿 수정 (D149-#A 22 컬럼 COALESCE 패턴)
router.put('/templates/:templateCode', async (req: Request, res: Response) => {
  try {
    const ctx = await requireTemplateAccess(req, res);
    if (!ctx) return;
    const body = req.body || {};
    const r = await imc.updateAlimtalkTemplate(ctx.senderKey, req.params.templateCode, body);
    if (r.code !== '0000') {
      return res.status(400).json({
        success: false,
        code: r.code,
        error: sanitizeImcMessageForUser(r.message, r.code, '템플릿 수정에 실패했습니다'),
        imc: r,
      });
    }
    await query(
      `UPDATE flyer_kakao_templates SET
         template_name        = COALESCE($2, template_name),
         content              = COALESCE($3, content),
         buttons              = COALESCE($4::jsonb, buttons),
         variables            = COALESCE($5::text[], variables),
         category             = COALESCE($6, category),
         message_type         = COALESCE($7, message_type),
         emphasize_type       = COALESCE($8, emphasize_type),
         emphasize_title      = COALESCE($9, emphasize_title),
         emphasize_subtitle   = COALESCE($10, emphasize_subtitle),
         emphasize_sub_title  = COALESCE($10, emphasize_sub_title),
         image_name           = COALESCE($11, image_name),
         extra_content        = COALESCE($12, extra_content),
         security_flag        = COALESCE($13, security_flag),
         quick_replies        = COALESCE($14::jsonb, quick_replies),
         template_header      = COALESCE($15, template_header),
         item_highlight       = COALESCE($16::jsonb, item_highlight),
         item_list            = COALESCE($17::jsonb, item_list),
         item_summary         = COALESCE($18::jsonb, item_summary),
         represent_link       = COALESCE($19::jsonb, represent_link),
         preview_message      = COALESCE($20, preview_message),
         service_mode         = COALESCE($21, service_mode),
         custom_template_code = COALESCE($22, custom_template_code),
         updated_at           = now(),
         last_synced_at       = now()
       WHERE id = $1`,
      [
        ctx.id,
        body.manageName || null,
        body.templateContent || null,
        body.buttonList ? JSON.stringify(body.buttonList) : null,
        body.variables || null,
        body.categoryCode || null,
        body.templateMessageType || null,
        body.templateEmphasizeType || null,
        body.templateTitle || null,
        body.templateSubtitle || null,
        body.templateImageName || null,
        body.templateExtra || null,
        typeof body.securityFlag === 'boolean' ? body.securityFlag : null,
        body.quickReplyList ? JSON.stringify(body.quickReplyList) : null,
        body.templateHeader || null,
        body.templateItemHighlight ? JSON.stringify(body.templateItemHighlight) : null,
        body.templateItem?.list ? JSON.stringify(body.templateItem.list) : null,
        body.templateItem?.summary ? JSON.stringify(body.templateItem.summary) : null,
        body.templateRepresentLink ? JSON.stringify(body.templateRepresentLink) : null,
        body.templatePreviewMessage || null,
        body.serviceMode || null,
        body.customTemplateCode || null,
      ],
    );
    console.log(`[flyer-alimtalk][updateTemplate 성공] templateCode=${req.params.templateCode} (PG 본문+IMC 갱신)`);
    res.json({ success: true, imc: r });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.delete('/templates/:templateCode', async (req: Request, res: Response) => {
  try {
    const ctx = await requireTemplateAccess(req, res);
    if (!ctx) return;
    const r = await imc.deleteAlimtalkTemplate(ctx.senderKey, req.params.templateCode);
    await query(
      `UPDATE flyer_kakao_templates SET status='DELETED', updated_at=now() WHERE id=$1`,
      [ctx.id],
    );
    res.json({ success: r.code === '0000', imc: r });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// 검수요청 메타 (코멘트 + 증빙자료) — multer
router.post(
  '/templates/:templateCode/inspection-meta',
  upload.single('evidenceFile'),
  async (req: Request, res: Response) => {
    try {
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const file = (req as any).file as Express.Multer.File | undefined;
      const decodedFile = file ? decodeOriginalName(file) : undefined;
      const comment = (req.body?.comment ?? '').toString();

      if (decodedFile) {
        await query(
          `UPDATE flyer_kakao_templates
              SET inspection_comment = $1,
                  inspection_evidence_filename = $2,
                  inspection_evidence_mimetype = $3,
                  inspection_evidence_data = $4,
                  updated_at = now()
            WHERE id = $5`,
          [comment, decodedFile.originalname, decodedFile.mimetype, decodedFile.buffer, ctx.id],
        );
      } else {
        await query(
          `UPDATE flyer_kakao_templates
              SET inspection_comment = $1,
                  updated_at = now()
            WHERE id = $2`,
          [comment, ctx.id],
        );
      }
      res.json({
        success: true,
        inspection_comment: comment,
        inspection_evidence_filename: decodedFile?.originalname || null,
      });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// 검수요청 — DB의 코멘트+증빙자료 자동 사용
router.post('/templates/:templateCode/inspect', async (req: Request, res: Response) => {
  try {
    const ctx = await requireTemplateAccess(req, res);
    if (!ctx) return;

    const meta = await query(
      `SELECT inspection_comment, inspection_evidence_filename, inspection_evidence_mimetype, inspection_evidence_data
         FROM flyer_kakao_templates WHERE id = $1`,
      [ctx.id],
    );
    const row = meta.rows[0] || {};
    const finalComment: string = (req.body?.comment as string) || row.inspection_comment || '';
    const evidenceBuffer: Buffer | null =
      row.inspection_evidence_data && Buffer.isBuffer(row.inspection_evidence_data)
        ? row.inspection_evidence_data
        : null;
    const evidenceFilename: string = row.inspection_evidence_filename || 'evidence';
    const evidenceMimetype: string | undefined = row.inspection_evidence_mimetype || undefined;

    let r;
    if (evidenceBuffer) {
      r = await imc.requestInspectionWithFile(
        ctx.senderKey,
        req.params.templateCode,
        finalComment,
        evidenceBuffer,
        evidenceFilename,
        evidenceMimetype,
      );
    } else {
      r = await imc.requestInspection(
        ctx.senderKey,
        req.params.templateCode,
        finalComment || undefined,
      );
    }
    await query(
      `UPDATE flyer_kakao_templates SET status='REQUESTED', requested_at=now(), updated_at=now() WHERE id=$1`,
      [ctx.id],
    );
    res.json({ success: r.code === '0000', imc: r });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.put('/templates/:templateCode/cancel-inspect', async (req: Request, res: Response) => {
  try {
    const ctx = await requireTemplateAccess(req, res);
    if (!ctx) return;
    const r = await imc.cancelInspection(ctx.senderKey, req.params.templateCode);
    await query(
      `UPDATE flyer_kakao_templates SET status='DRAFT', updated_at=now() WHERE id=$1`,
      [ctx.id],
    );
    res.json({ success: r.code === '0000', imc: r });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.put('/templates/:templateCode/release', async (req: Request, res: Response) => {
  try {
    const ctx = await requireTemplateAccess(req, res);
    if (!ctx) return;
    const r = await imc.releaseTemplateDormant(ctx.senderKey, req.params.templateCode);
    await query(
      `UPDATE flyer_kakao_templates SET status='APPROVED', updated_at=now() WHERE id=$1`,
      [ctx.id],
    );
    res.json({ success: r.code === '0000', imc: r });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// 템플릿 이력
router.get('/templates/:templateCode/history', async (req: Request, res: Response) => {
  try {
    const ctx = await requireTemplateAccess(req, res);
    if (!ctx) return;
    const r = await imc.getAlimtalkTemplateHistory(ctx.senderKey, req.params.templateCode);
    return sendImcManagedResponse(res, r, { fallback: '이력 조회에 실패했습니다' });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.get('/templates/:templateCode/history/:histId', async (req: Request, res: Response) => {
  try {
    const ctx = await requireTemplateAccess(req, res);
    if (!ctx) return;
    const r = await imc.getAlimtalkTemplateHistoryDetail(
      ctx.senderKey,
      req.params.templateCode,
      req.params.histId,
    );
    return sendImcManagedResponse(res, r, { fallback: '이력 상세 조회에 실패했습니다' });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// ════════════════════════════════════════════════════════════
// 이미지 업로드 (알림톡 2개, 다른 브랜드/marketing은 별건 후속)
// ════════════════════════════════════════════════════════════

router.post('/images/alimtalk/template', upload.single('image'), async (req: Request, res: Response) => {
  try {
    const file = requireFile(req, res); if (!file) return;
    const r = await imc.uploadAlimtalkTemplateImage(file.buffer, file.originalname);
    return sendImageUploadResponse(res, r);
  } catch (err) { return handleImcError(res, err); }
});

router.post('/images/alimtalk/highlight', upload.single('image'), async (req: Request, res: Response) => {
  try {
    const file = requireFile(req, res); if (!file) return;
    const r = await imc.uploadAlimtalkHighlightImage(file.buffer, file.originalname);
    return sendImageUploadResponse(res, r);
  } catch (err) { return handleImcError(res, err); }
});

// ════════════════════════════════════════════════════════════
// 검수 알림 수신자 — 회사당 3명 제한 (D135+ IMC 4032 회피, hanjulDM 자체 SMS)
// ════════════════════════════════════════════════════════════

router.get('/alarm-users', async (req: Request, res: Response) => {
  try {
    const companyId = requireTargetCompany(req, res);
    if (!companyId) return;
    const r = await query(
      `SELECT * FROM flyer_kakao_alarm_users
        WHERE company_id = $1
        ORDER BY created_at DESC`,
      [companyId],
    );
    res.json({ success: true, users: r.rows });
  } catch (err) { return handleImcError(res, err); }
});

router.post('/alarm-users', async (req: Request, res: Response) => {
  try {
    const { targetCompanyId, name, phoneNumber, activeYn } = req.body || {};
    if (!targetCompanyId) {
      return res.status(400).json({ success: false, error: 'targetCompanyId 필수' });
    }
    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'phoneNumber 필수' });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: '수신자 이름은 필수입니다' });
    }
    const cnt = await query(
      `SELECT COUNT(*)::int AS c FROM flyer_kakao_alarm_users
        WHERE company_id = $1 AND COALESCE(active_yn,'Y') = 'Y'`,
      [targetCompanyId],
    );
    if ((cnt.rows[0]?.c ?? 0) >= 3 && (activeYn || 'Y') === 'Y') {
      return res.status(400).json({
        success: false,
        error: '활성 알림 수신자는 최대 3명까지 등록 가능합니다',
      });
    }
    const alarmUserKey = `${targetCompanyId.replace(/-/g, '').slice(0, 12)}_${phoneNumber}`;
    const ins = await query(
      `INSERT INTO flyer_kakao_alarm_users
         (company_id, name, phone_number, active_yn, imc_alarm_user_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (company_id, phone_number) DO UPDATE SET
         name = EXCLUDED.name,
         active_yn = EXCLUDED.active_yn,
         imc_alarm_user_id = EXCLUDED.imc_alarm_user_id,
         updated_at = now()
       RETURNING *`,
      [targetCompanyId, name || null, phoneNumber, activeYn || 'Y', alarmUserKey],
    );
    res.status(201).json({ success: true, user: ins.rows[0] });
  } catch (err) { return handleImcError(res, err); }
});

router.put('/alarm-users/:id', async (req: Request, res: Response) => {
  try {
    const row = await query(`SELECT id, company_id FROM flyer_kakao_alarm_users WHERE id = $1`, [req.params.id]);
    if (row.rows.length === 0) {
      return res.status(404).json({ success: false, error: '수신자 없음' });
    }
    const { name, phoneNumber, activeYn } = req.body || {};
    if (activeYn === 'Y') {
      const cnt = await query(
        `SELECT COUNT(*)::int AS c FROM flyer_kakao_alarm_users
          WHERE company_id = $1 AND COALESCE(active_yn,'Y') = 'Y' AND id <> $2`,
        [row.rows[0].company_id, req.params.id],
      );
      if ((cnt.rows[0]?.c ?? 0) >= 3) {
        return res.status(400).json({
          success: false,
          error: '활성 알림 수신자는 최대 3명까지 등록 가능합니다',
        });
      }
    }
    const upd = await query(
      `UPDATE flyer_kakao_alarm_users
          SET name = COALESCE($1,name),
              phone_number = COALESCE($2,phone_number),
              active_yn = COALESCE($3,active_yn),
              updated_at = now()
        WHERE id = $4
        RETURNING *`,
      [name, phoneNumber, activeYn, req.params.id],
    );
    res.json({ success: true, user: upd.rows[0] });
  } catch (err) { return handleImcError(res, err); }
});

router.delete('/alarm-users/:id', async (req: Request, res: Response) => {
  try {
    const row = await query(`SELECT id FROM flyer_kakao_alarm_users WHERE id = $1`, [req.params.id]);
    if (row.rows.length === 0) {
      return res.status(404).json({ success: false, error: '수신자 없음' });
    }
    await query(`DELETE FROM flyer_kakao_alarm_users WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { return handleImcError(res, err); }
});

// ════════════════════════════════════════════════════════════
// 운영 진단
// ════════════════════════════════════════════════════════════

router.get('/webhook-events', async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const rows = await getRecentWebhookEvents(limit);
    res.json({ success: true, events: rows });
  } catch (err) { return handleImcError(res, err); }
});

router.post('/jobs/sync-pending-templates', async (_req: Request, res: Response) => {
  try {
    await syncPendingTemplatesJob();
    res.json({ success: true });
  } catch (err) { return handleImcError(res, err); }
});

router.post('/jobs/sync-sender-status', async (_req: Request, res: Response) => {
  try {
    await syncSenderStatusJob();
    res.json({ success: true });
  } catch (err) { return handleImcError(res, err); }
});

export default router;
