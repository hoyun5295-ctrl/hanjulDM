/**
 * ★ 전단AI 업종 라우트
 * 마운트: /api/flyer/business-types
 *
 * 업종별 카테고리 프리셋 + 사용 가능 템플릿 조회.
 * CT-F13(flyer-business-types) 단일 진입점.
 */

import { Request, Response, Router } from 'express';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';
import { templateSamplePng } from '../../utils/flyer/product/template-sample';
import { getOgBrowser } from './og-image';
import {
  getBusinessTypes,
  getAvailableTemplates,
  TEMPLATE_REGISTRY,
} from '../../utils/flyer';

const router = Router();

/**
 * GET / — 활성 업종 목록 + 카테고리 프리셋 + 템플릿 메타데이터
 *
 * 응답 예:
 * [
 *   {
 *     type_code: 'mart',
 *     type_name: '마트',
 *     category_presets: ['청과/야채', '공산', ...],
 *     default_template: 'grid',
 *     templates: [{ value: 'grid', label: '가격 강조형', desc: '...', color: '...' }, ...]
 *   },
 *   ...
 * ]
 */
router.get('/', flyerAuthenticate, async (_req: Request, res: Response) => {
  try {
    const types = await getBusinessTypes();

    const result = await Promise.all(
      types.map(async (t) => ({
        type_code: t.type_code,
        type_name: t.type_name,
        category_presets: t.category_presets,
        default_template: t.default_template,
        templates: await getAvailableTemplates(t.type_code),
      }))
    );

    return res.json(result);
  } catch (error: any) {
    console.error('[flyer/business-types] error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * ★ 1025 17번 §3-4 — GET /templates/:code/sample.png : 갤러리 미리보기(목업으로 그린 실렌더 PNG)
 * 인증 없음: <img> 요청은 인증 헤더를 못 싣고, 그리는 내용은 목업뿐(매장 데이터 0). 코드는 레지스트리 허용 목록만.
 */
router.get('/templates/:code/sample.png', async (req: Request, res: Response) => {
  try {
    const buf = await templateSamplePng(String(req.params.code || ''), getOgBrowser);
    if (!buf) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'image/png');
    // ★ 1026: 주소는 그대로인데 디자인이 바뀌면 그림이 바뀐다 → 매번 서버에 확인(바뀌지 않았으면 ETag 304)
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(buf);
  } catch (err: any) {
    console.error('[template-sample] 생성 실패:', err?.message || err);
    return res.status(500).send('Internal error');
  }
});

/**
 * GET /templates — 전체 템플릿 레지스트리 (프론트 미리보기용)
 */
router.get('/templates', flyerAuthenticate, async (_req: Request, res: Response) => {
  return res.json(TEMPLATE_REGISTRY);
});

export default router;
