/**
 * ★ 전단AI: 단축URL 리다이렉트 + 전단지 공개 페이지 렌더링
 *
 * 마운트: /api/flyer/p (공개 — 인증 불필요)
 * - GET /api/flyer/p/:code — 전단지 공개 페이지 렌더링 (hanjul-flyer.kr/:code 에서 프록시)
 *
 * ⚠️ 이 라우트는 인증 없이 공개 접근 가능 (고객이 SMS 링크로 접근)
 * ★ hanjulDM 분리 (2026-05-12): DM Builder 라우트 제거. DM은 한줄AI 본진 hanjul.ai/d/{code} 전용
 */

import express, { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import { renderTemplate, type FlyerRenderData } from '../../utils/flyer/product/flyer-templates';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';

const router = Router();

// ============================================================
// ★ D154 PHASE 0 — POST /preview-html
// 사장님 화면 실시간 미리보기용 (미발행 전단 + 옵션 변경 즉시 반영)
// 인증 불필요 (사장님 입력 데이터 그대로 렌더, DB 변경 0)
// ============================================================
const previewParser = express.json({ limit: '512kb' });
router.post('/preview-html', previewParser, flyerAuthenticate, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    if (!body.title && !body.store_name && (!body.categories || body.categories.length === 0)) {
      return res.status(400).send('Empty payload');
    }

    // ★ D154 PHASE 0 §7: 사장님 회사 매장 프로필 자동 join → externalLinks/announcements merge
    let rawExtra = body.extra_data || {};
    const companyId = req.flyerUser?.companyId;
    if (companyId) {
      try {
        const companyResult = await query(
          `SELECT store_phone, address, store_hours, map_url, kakao_channel_url,
                  instagram_url, band_url, blog_url, shop_url
           FROM flyer_companies WHERE id = $1 AND deleted_at IS NULL`,
          [companyId]
        );
        if (companyResult.rows.length > 0) {
          rawExtra = mergeCompanyProfileToExtraData(rawExtra, companyResult.rows[0]);
        }
      } catch (err: any) {
        console.error('[preview-html] 회사 프로필 join 실패:', err && err.message);
      }
    }

    const data: FlyerRenderData = {
      storeName: body.store_name || '',
      title: body.title || '',
      period: body.period || '',
      categories: Array.isArray(body.categories) ? body.categories : [],
      periodStart: body.period_start || null,
      periodEnd: body.period_end || null,
      externalLinks: rawExtra.externalLinks,
      announcements: rawExtra.announcements,
      bannerGifUrl: rawExtra.bannerGifUrl,
    };

    const templateCode = body.template || 'grid_hero';
    const html = renderTemplate(templateCode, data);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store'); // 실시간 미리보기는 캐싱 X
    return res.send(html);
  } catch (err: any) {
    console.error('[preview-html] 생성 실패:', err && err.message ? err.message : err);
    return res.status(500).send('Internal error');
  }
});

// ============================================================
// GET /:code — 전단지 공개 페이지 렌더링 + 클릭 로그
// ============================================================
router.get('/:code', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    // 단축URL + 전단지 조인 조회
    const result = await query(
      `SELECT f.*,
              TO_CHAR(f.period_start, 'YYYY-MM-DD') as period_start,
              TO_CHAR(f.period_end, 'YYYY-MM-DD') as period_end,
              su.id as short_url_id, su.expires_at,
              su.phone as tracking_phone, su.url_type, su.campaign_id as tracking_campaign_id
       FROM short_urls su
       JOIN flyers f ON f.id = su.flyer_id
       WHERE su.code = $1`,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(renderErrorPage('전단지를 찾을 수 없습니다.'));
    }

    const flyer = result.rows[0];

    // 만료 체크 — 단축URL 90일 만료
    if (flyer.expires_at && new Date(flyer.expires_at) < new Date()) {
      return res.status(410).send(renderErrorPage('이 전단지는 기간이 만료되었습니다.'));
    }

    // ★ 행사 기간 종료 체크 — period_end가 지나면 "행사 종료" 안내
    // TO_CHAR로 YYYY-MM-DD 문자열 반환이므로 단순 문자열 비교
    if (flyer.period_end) {
      const endDate = String(flyer.period_end).trim().slice(0, 10);
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (endDate < todayStr) {
        return res.status(410).send(renderExpiredPage(flyer.store_name || '', flyer.title || '', endDate));
      }
    }

    // ★ Phase 1: 클릭 로그에 phone 포함 (tracking URL이면 수신자 식별 가능)
    const ip = req.ip || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;
    const trackingPhone = flyer.tracking_phone || null;
    query(
      'INSERT INTO url_clicks (short_url_id, ip, user_agent, phone) VALUES ($1, $2, $3, $4)',
      [flyer.short_url_id, ip, userAgent, trackingPhone]
    ).catch(err => console.error('[전단AI] 클릭 로그 실패:', err.message));

    // ★ Phase 3: tracking URL이면 phone을 뷰어 컨텍스트에 전달 (장바구니 식별용)
    // ★ D154 PHASE 0: shortCode 전달 (og:image 동적 라우트 URL 생성용)
    const html = await renderFlyerPage(flyer, trackingPhone, code);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error('[전단AI] 공개 페이지 렌더링 실패:', err.message);
    res.status(500).send(renderErrorPage('페이지를 불러올 수 없습니다.'));
  }
});

// ============================================================
// 에러 페이지
// ============================================================
function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>전단AI</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Noto Sans KR', sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .msg { text-align: center; padding: 40px; }
  .msg h1 { font-size: 20px; color: #666; margin-bottom: 8px; }
  .msg p { font-size: 14px; color: #999; }
</style>
</head>
<body><div class="msg"><h1>${message}</h1><p>hanjul-flyer.kr</p></div></body>
</html>`;
}

// ============================================================
// 행사 종료 안내 페이지
// ============================================================
function renderExpiredPage(storeName: string, title: string, endDate: string): string {
  const [, m, d] = endDate.split('-').map(Number);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>행사 종료 — ${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Noto Sans KR',sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{text-align:center;padding:48px 32px;background:#fff;border-radius:20px;box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:360px;width:90%}
  .icon{font-size:48px;margin-bottom:16px}
  .store{font-size:12px;color:#999;letter-spacing:2px;margin-bottom:8px}
  .title{font-size:18px;font-weight:700;color:#333;margin-bottom:8px}
  .msg{font-size:14px;color:#888;line-height:1.6;margin-bottom:4px}
  .date{font-size:13px;color:#aaa;margin-top:12px}
  .footer{margin-top:24px;font-size:11px;color:#ccc}
</style>
</head>
<body>
<div class="card">
  <div class="icon">📋</div>
  ${storeName ? `<div class="store">${escapeHtml(storeName)}</div>` : ''}
  <div class="title">${escapeHtml(title)}</div>
  <p class="msg">이 행사는 종료되었습니다.</p>
  <p class="msg">다음 행사를 기대해주세요!</p>
  <p class="date">행사 기간: ~ ${m}/${d}</p>
  <div class="footer">hanjul-flyer.kr</div>
</div>
</body>
</html>`;
}

// ============================================================
// ★ D154 PHASE 0 §7 — 회사 매장 프로필 → externalLinks/announcements 자동 merge
// 사장님 SettingsPage 1회 입력 → 전단 발행 시점에 자동 박음 (전단별 override 우선)
// ============================================================
interface ExternalLink { label: string; url: string; icon: string; }
interface Announcement { title: string; content: string; }

function mergeCompanyProfileToExtraData(extra: any, profile: any): any {
  if (!profile) return extra || {};
  const base = extra || {};
  const externalLinks: ExternalLink[] = Array.isArray(base.externalLinks) ? [...base.externalLinks] : [];
  const announcements: Announcement[] = Array.isArray(base.announcements) ? [...base.announcements] : [];
  const hasIcon = (icon: string) => externalLinks.some(l => l.icon === icon);
  const hasAnn = (kw: string) => announcements.some(a => (a.title || '').indexOf(kw) >= 0);

  if (profile.store_phone && !hasIcon('phone')) {
    externalLinks.push({ label: profile.store_phone, url: 'tel:' + String(profile.store_phone).replace(/-/g, ''), icon: 'phone' });
  }
  // ★ map_url 미입력해도 address 있으면 카카오맵 검색 URL 자동 fallback
  if ((profile.map_url || profile.address) && !hasIcon('map')) {
    const mapUrl = profile.map_url
      || ('https://map.kakao.com/?q=' + encodeURIComponent(profile.address));
    externalLinks.push({ label: profile.address || '길찾기', url: mapUrl, icon: 'map' });
  }
  if (profile.kakao_channel_url && !hasIcon('link')) {
    externalLinks.push({ label: '카카오 채널', url: profile.kakao_channel_url, icon: 'link' });
  }
  if (profile.instagram_url && !hasIcon('instagram')) {
    externalLinks.push({ label: '인스타그램', url: profile.instagram_url, icon: 'instagram' });
  }
  if (profile.band_url && !hasIcon('band')) {
    externalLinks.push({ label: '밴드', url: profile.band_url, icon: 'band' });
  }
  if (profile.blog_url && !hasIcon('blog')) {
    externalLinks.push({ label: '블로그', url: profile.blog_url, icon: 'blog' });
  }
  if (profile.shop_url && !hasIcon('shop')) {
    externalLinks.push({ label: '쇼핑몰', url: profile.shop_url, icon: 'shop' });
  }

  if (profile.store_hours && !hasAnn('영업')) {
    announcements.unshift({ title: '영업시간', content: profile.store_hours });
  }
  if (profile.address && !hasAnn('주소')) {
    announcements.push({ title: '주소', content: profile.address });
  }

  return { ...base, externalLinks, announcements };
}

// ============================================================
// 전단지 렌더링 — CT-F14 컨트롤타워 위임
// ============================================================
export async function renderFlyerPage(flyer: any, trackingPhone?: string | null, shortCode?: string | null): Promise<string> {
  const categories = typeof flyer.categories === 'string' ? JSON.parse(flyer.categories) : (flyer.categories || []);
  const storeName = flyer.store_name || '';
  const title = flyer.title || '';
  const periodStart = flyer.period_start ? formatDate(flyer.period_start) : '';
  const periodEnd = flyer.period_end ? formatDate(flyer.period_end) : '';
  const period = periodStart && periodEnd ? `${periodStart} ~ ${periodEnd}` : (periodStart || periodEnd || '');

  // QR 쿠폰 연결 확인
  let qrCodeDataUrl: string | undefined;
  let qrCouponText: string | undefined;
  try {
    const couponResult = await query(
      `SELECT qr_data_url, coupon_name, discount_value, coupon_type, discount_description
       FROM flyer_coupon_campaigns
       WHERE flyer_id = $1 AND status = 'active'
       LIMIT 1`,
      [flyer.id]
    );
    if (couponResult.rows.length > 0) {
      const c = couponResult.rows[0];
      qrCodeDataUrl = c.qr_data_url;
      qrCouponText = c.discount_description
        || (c.coupon_type === 'percent' ? `스캔하고 ${c.discount_value}% 할인!` : `스캔하고 ${Number(c.discount_value).toLocaleString()}원 할인!`);
    }
  } catch {}

  // extra_data 파싱 (외부링크/공지/GIF)
  const rawExtra = typeof flyer.extra_data === 'string'
    ? JSON.parse(flyer.extra_data || '{}')
    : (flyer.extra_data || {});

  // ★ D154 PHASE 0 §7: 회사 매장 프로필 → externalLinks/announcements 자동 merge (전단별 override 우선)
  let extraData = rawExtra;
  if (flyer.company_id) {
    try {
      const companyResult = await query(
        `SELECT store_phone, address, store_hours, map_url, kakao_channel_url,
                instagram_url, band_url, blog_url, shop_url
         FROM flyer_companies WHERE id = $1 AND deleted_at IS NULL`,
        [flyer.company_id]
      );
      if (companyResult.rows.length > 0) {
        extraData = mergeCompanyProfileToExtraData(rawExtra, companyResult.rows[0]);
      }
    } catch (err: any) {
      console.error('[short-urls] 회사 프로필 join 실패:', err && err.message);
    }
  }

  return renderTemplate(flyer.template || 'grid_hero', {
    storeName, title, period, categories, qrCodeDataUrl, qrCouponText,
    externalLinks: extraData.externalLinks,
    announcements: extraData.announcements,
    bannerGifUrl: extraData.bannerGifUrl,
    trackingPhone: trackingPhone || undefined,
    flyerId: flyer.id,
    companyId: flyer.company_id,
    // ★ D154 PHASE 0: 시즌 토큰 자동 매핑 + DEAL FEED 카운트다운용 원본 날짜
    periodStart: flyer.period_start || null,
    periodEnd: flyer.period_end || null,
    // ★ D154 PHASE 0: og:image 동적 라우트 URL 생성용 (/api/flyer/og/{shortCode}.png)
    shortCode: shortCode || null,
  });
}

function formatDate(d: string | Date): string {
  // ★ D100: 순수 YYYY-MM-DD는 직접 파싱 (new Date() UTC 변환 → 하루 밀림 방지)
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
    const [, m, day] = d.trim().split('-').map(Number);
    return `${m}/${day}`;
  }
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default router;
