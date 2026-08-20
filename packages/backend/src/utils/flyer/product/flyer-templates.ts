/**
 * ★ CT-F14 — 전단AI 템플릿 렌더링 엔진 V4 (D154 PHASE 0 트랙 A)
 *
 * 전단지 공개 페이지 HTML 렌더링의 유일한 진입점.
 * short-urls.ts에서 호출: renderTemplate(templateCode, data)
 *
 * V4 아키텍처: Claude Design 통합 디자인 시스템 + 시즌 컬러 토큰 8종 동적 주입.
 *   ① renderStoryEngine        — STORY (인스타 스토리, 풀스크린 1상품 5초 자동)
 *   ② renderMagazineEngine     — MAGAZINE (Apple/NYT 스크롤텔링, parallax)
 *   ③ renderDealFeedEngine     — DEAL FEED (무신사/29CM 카운트다운 핫딜)
 *   ④ renderGridHeroEngine     — GRID HERO (마켓컬리 메인, 카테고리 sticky)
 *   ⑤ renderCatalogSwipeEngine — CATALOG SWIPE (넷플릭스 가로 카탈로그)
 *   ⑥ renderPosterPromoEngine  — POSTER PROMO (인쇄 전단풍 + 6매체 정합 본진)
 *
 * 시즌 토큰: season-resolver.ts가 title+periodStart로 8종 중 1종 자동 매핑 →
 *           각 엔진은 <html data-season="..."> 속성 + CSS variable 분기.
 *
 * Deprecated 22 templateCode (V3): DEPRECATED_FALLBACK_MAP으로 신규 6 엔진에 안전 폴백.
 *           DB 마이그레이션 0, 옛 발행 전단 흔들림 0.
 *
 * 후처리 (V3 보존): renderQrSection + renderCartScript (flyer-page-injections.ts 분리).
 *
 * 빌드 호환: renderTemplate / FlyerRenderData / FlyerRenderItem / escapeHtml / formatPrice 그대로 export.
 */

import { renderProductImage, resolveProductImageUrl } from '../../../utils/product-images';
import { resolveSeasonToken, SEASON_TOKENS, type SeasonToken } from './season-resolver';
import { DEPRECATED_FALLBACK_MAP } from '../config/flyer-business-types';
import { renderQrSection, renderCartScript } from './flyer-page-injections';
// ★ 2026-08-20 슈퍼버전업 2단계 — 렌더 준비 CT(프로모 분리·밴드·픽토그램) + URL 매체 토큰(13번 설계 §4·§5)
import { prepareFlyerData, itemCountBand, countItems, bandStyleBlock, categoryPictogram, nameSizeClass, priceScaleClass } from './flyer-render-prep';
import { generateMediaCssBlock } from './design-tokens';
import { variantToStyleBlock, type DesignVariant } from './claude-design-renderer';

// ============================================================
// 인터페이스
// ============================================================

export interface FlyerRenderData {
  storeName: string;
  title: string;
  period: string;
  categories: Array<{ name: string; items: FlyerRenderItem[] }>;
  qrCodeDataUrl?: string;
  qrCouponText?: string;
  /** 외부 링크 (밴드/쇼핑몰/전화/지도/인스타/블로그) */
  externalLinks?: Array<{ label: string; url: string; icon: string }>;
  /** 공지사항/게시판 */
  announcements?: Array<{ title: string; content: string }>;
  /** GIF 배너 URL */
  bannerGifUrl?: string;
  /** Phase 3: 수신자 전화번호 (tracking URL에서 식별) */
  trackingPhone?: string;
  /** Phase 3: 전단지 ID (장바구니 API용) */
  flyerId?: string;
  /** Phase 3: 회사 ID */
  companyId?: string;
  /** D154 PHASE 0: 시즌 토큰 강제 지정 (옵션 — 미지정 시 자동 매핑) */
  seasonToken?: SeasonToken;
  /** D154 PHASE 0: 행사 시작일 YYYY-MM-DD (시즌 토큰 자동 매핑용) */
  periodStart?: string | null;
  /** D154 PHASE 0: 행사 종료일 YYYY-MM-DD (DEAL FEED 카운트다운 + outro용) */
  periodEnd?: string | null;
  /** D154 PHASE 0: 단축 코드 (og:image 동적 라우트 /api/flyer/og/{shortCode}.png 생성용) */
  shortCode?: string | null;
}

export interface FlyerRenderItem {
  name: string;
  originalPrice: number;
  salePrice: number;
  badge?: string;
  imageUrl?: string;
  /** 규격 (e.g. "6kg/통", "500ml", "1박스 20kg") */
  unit?: string;
  /** 원산지 (e.g. "국내산", "미국산", "노르웨이") */
  origin?: string;
  /** 카드할인 (e.g. "농협카드 5% 추가") */
  cardDiscount?: string;
  /** AI 마케팅 문구 */
  aiCopy?: string;
}

// ============================================================
// 공통 헬퍼 (V3 보존 + D154 신규)
// ============================================================

export function esc(str: string | number | null | undefined): string {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtPrice(price: number | null | undefined): string {
  return (Number(price) || 0).toLocaleString('ko-KR');
}

export function toAbsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const base = process.env.FLYER_API_BASE_URL || '';
  return base ? base + url : url;
}

export function calcDisc(orig: number, sale: number): number {
  return orig > 0 ? Math.round((1 - sale / orig) * 100) : 0;
}

/** Phase 3: 카드 data-product 속성 (cart-script 자동 감지용) */
export function productDataAttr(item: FlyerRenderItem, catName?: string): string {
  const data = {
    name: item.name,
    originalPrice: item.originalPrice,
    salePrice: item.salePrice,
    imageUrl: toAbsUrl(item.imageUrl || '') || '',
    unit: item.unit || '',
    category: catName || '',
  };
  return ` data-product="${esc(JSON.stringify(data))}"`;
}

export function resolveImg(name: string, size: number, imageUrl?: string | null): string {
  const absUrl = toAbsUrl(imageUrl || resolveProductImageUrl(name));
  return renderProductImage(name, size, absUrl || undefined);
}

/** D154 PHASE 0: 매장명 첫 글자 (로고 placeholder용) */
export function storeInitial(storeName: string | null | undefined): string {
  const trimmed = (storeName || '').trim();
  return trimmed ? trimmed.charAt(0) : '?';
}

/**
 * D154 PHASE 0: 시즌 토큰 8종 CSS variable 분기 블록.
 * 각 엔진의 <style> 블록 안에 박아 <html data-season="..."> 속성 변경 시 토큰 동적 교체.
 * default 토큰은 각 엔진 :root에서 정의 (본 블록에서는 제외).
 */
export function seasonStyleBlock(): string {
  const lines: string[] = [];
  for (const token of Object.keys(SEASON_TOKENS) as SeasonToken[]) {
    if (token === 'default') continue;
    const info = SEASON_TOKENS[token];
    lines.push(
      `html[data-season="${token}"]{--color-primary:${info.primary};--color-accent:${info.accent};--color-on-primary:${info.onPrimary};}`
    );
  }
  return lines.join('');
}

/** D154 PHASE 0: 카테고리 → 평탄화 (STORY/DEAL FEED 등 flat 활용) */
export function flattenItems(d: FlyerRenderData): Array<FlyerRenderItem & { category: string }> {
  const result: Array<FlyerRenderItem & { category: string }> = [];
  for (const cat of d.categories) {
    for (const item of cat.items) {
      result.push({ ...item, category: cat.name });
    }
  }
  return result;
}

/** D154 PHASE 0: 카테고리 → 이미지 placeholder 배경색 (imageUrl 미존재 시) */
export function categoryBg(name: string): string {
  const trimmed = (name || '').trim();
  const map: Record<string, string> = {
    '청과/야채': '#1f5a2a', '청과': '#1f5a2a', '야채': '#1f5a2a', '과일': '#7a3815',
    '축산': '#5b2222', '정육': '#5b2222', '한우': '#7c1f1f',
    '수산': '#1e3a5f',
    '공산': '#3a3a4a', '공산품': '#3a3a4a',
    '냉동': '#1e293b',
    '유제품': '#71717a',
    '음료/주류': '#292524', '음료': '#1e293b', '주류': '#292524',
    '생활용품': '#475569',
    '베이커리': '#92400e', '빵': '#92400e',
    '간식': '#7c2d12',
  };
  return map[trimmed] || '#3f3f46';
}

/** D154 PHASE 0: 카테고리 → MAGAZINE 챕터 클래스 (meat/prod/fish/dry 4종 + 폴백) */
export function categoryClass(name: string): string {
  const trimmed = (name || '').trim();
  const map: Record<string, string> = {
    '축산': 'meat', '정육': 'meat', '한우': 'meat', '돈육': 'meat',
    '청과/야채': 'prod', '청과': 'prod', '야채': 'prod', '과일': 'prod',
    '수산': 'fish', '냉동': 'fish',
    '공산': 'dry', '공산품': 'dry', '유제품': 'dry',
    '음료/주류': 'dry', '음료': 'dry', '주류': 'dry',
    '생활용품': 'dry', '베이커리': 'dry', '간식': 'dry',
  };
  return map[trimmed] || 'dry';
}

/** D154 PHASE 0: 카테고리 → 영문 라벨 (매거진 헤드 SECTION 표기용) */
export function categoryEn(name: string): string {
  const trimmed = (name || '').trim();
  const map: Record<string, string> = {
    '축산': 'MEAT', '정육': 'MEAT', '한우': 'BEEF', '돈육': 'PORK',
    '청과/야채': 'PRODUCE', '청과': 'FRUIT', '야채': 'VEGETABLE', '과일': 'FRUIT',
    '수산': 'SEAFOOD',
    '공산': 'DRY GOODS', '공산품': 'DRY GOODS',
    '냉동': 'FROZEN',
    '유제품': 'DAIRY',
    '음료/주류': 'BEVERAGE', '음료': 'BEVERAGE', '주류': 'LIQUOR',
    '생활용품': 'HOUSEHOLD',
    '베이커리': 'BAKERY', '빵': 'BAKERY',
    '간식': 'SNACKS',
  };
  return map[trimmed] || (trimmed ? trimmed.toUpperCase() : 'GOODS');
}

// ★ 2026-08-20 슈퍼버전업 2단계 — 이모지 폴백 폐기(13번 설계 §4-1).
//   무이미지 폴백은 flyer-render-prep.ts의 categoryPictogram(단색 SVG)이 소유한다 —
//   OS별 이모지 모양 상이 + 임시 화면 티 제거. 옛 categoryEmoji 함수는 삭제(소비처 전량 전환).

// ============================================================
// 다이나믹 섹션 (V3 보존 — 외부링크/공지/GIF 배너)
// ============================================================

const LINK_ICONS: Record<string, string> = {
  band: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>',
  shop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 01-8 0"/></svg>',
  phone: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>',
  map: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  instagram: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><circle cx="17.5" cy="6.5" r="1.5"/></svg>',
  blog: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
  link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
};

function renderDynamicSection(d: FlyerRenderData): string {
  const parts: string[] = [];

  if (d.bannerGifUrl) {
    parts.push(`<div class="dyn-gif"><img src="${esc(d.bannerGifUrl)}" alt="배너" style="width:100%;border-radius:12px"/></div>`);
  }

  if (d.externalLinks && d.externalLinks.length > 0) {
    const links = d.externalLinks.map(l => {
      const icon = LINK_ICONS[l.icon] || LINK_ICONS.link;
      return `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" class="dyn-link">${icon}<span>${esc(l.label)}</span></a>`;
    }).join('');
    parts.push(`<div class="dyn-links">${links}</div>`);
  }

  if (d.announcements && d.announcements.length > 0) {
    const items = d.announcements.map(a =>
      `<details class="dyn-ann"><summary>${esc(a.title)}</summary><p>${esc(a.content)}</p></details>`
    ).join('');
    parts.push(`<div class="dyn-anns"><div class="dyn-anns-title">공지사항</div>${items}</div>`);
  }

  if (parts.length === 0) return '';
  return `<style>
.dyn-section{padding:16px 12px;max-width:480px;margin:0 auto;font-family:'Pretendard Variable',sans-serif}
.dyn-gif{margin-bottom:12px}
.dyn-links{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px}
.dyn-link{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 14px;border-radius:12px;background:#f5f5f5;text-decoration:none;color:#333;font-size:11px;font-weight:600;min-width:72px;transition:background .2s}
.dyn-link:active{background:#e5e5e5}
.dyn-anns{margin-bottom:8px}
.dyn-anns-title{font-size:13px;font-weight:700;margin-bottom:8px;color:#333}
.dyn-ann{background:#f9fafb;border-radius:10px;margin-bottom:6px;border:1px solid #e5e7eb}
.dyn-ann summary{padding:10px 14px;font-size:12px;font-weight:600;color:#374151;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center}
.dyn-ann summary::after{content:'▸';font-size:10px;color:#9ca3af;transition:transform .2s}
.dyn-ann[open] summary::after{transform:rotate(90deg)}
.dyn-ann p{padding:0 14px 10px;font-size:11px;color:#6b7280;line-height:1.6}
</style>
<div class="dyn-section">${parts.join('')}</div>`;
}

// ============================================================
// 6 엔진 — Phase 2B~2G에서 Claude Design HTML 분해 통합 예정
// 현재는 placeholder (빌드 통과용 임시 standalone HTML)
// ============================================================

function placeholderEngine(engineName: string, d: FlyerRenderData, token: SeasonToken): string {
  const items = flattenItems(d);
  const itemList = items.slice(0, 6).map(it => `
    <div class="ph-card"${productDataAttr(it, it.category)}>
      <div class="ph-name">${esc(it.name)}</div>
      <div class="ph-meta">${esc(it.unit || '')}${it.origin ? ' · ' + esc(it.origin) : ''}${it.category ? ' · ' + esc(it.category) : ''}</div>
      <div class="ph-price"><span class="ph-orig">${fmtPrice(it.originalPrice)}원</span> <span class="ph-sale">${fmtPrice(it.salePrice)}원</span>${it.originalPrice > 0 ? ` <span class="ph-disc">-${calcDisc(it.originalPrice, it.salePrice)}%</span>` : ''}</div>
      ${it.aiCopy ? `<div class="ph-ai">${esc(it.aiCopy)}</div>` : ''}
    </div>
  `).join('');
  return `<!DOCTYPE html>
<html lang="ko" data-season="${token}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(d.storeName)} — ${esc(d.title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root{--color-primary:#F97316;--color-accent:#EF4444;--color-on-primary:#FFFFFF;}
${seasonStyleBlock()}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Pretendard Variable',sans-serif;background:#FAFAFA;color:#171717;max-width:480px;margin:0 auto;padding:20px 16px 80px}
.ph-banner{background:linear-gradient(135deg,var(--color-primary),var(--color-accent));color:var(--color-on-primary);padding:22px 18px;border-radius:18px;margin-bottom:18px;box-shadow:0 6px 18px rgba(0,0,0,0.08)}
.ph-engine{font-size:11px;font-weight:800;letter-spacing:0.14em;opacity:0.85;text-transform:uppercase}
.ph-title{font-size:30px;font-weight:900;letter-spacing:-0.025em;margin-top:6px;line-height:1.1}
.ph-meta-row{font-size:13px;opacity:0.92;margin-top:8px;letter-spacing:-0.01em}
.ph-card{position:relative;background:#fff;border-radius:14px;padding:16px;margin-bottom:10px;box-shadow:0 2px 8px rgba(15,23,42,0.06)}
.ph-name{font-size:17px;font-weight:800;letter-spacing:-0.01em}
.ph-meta{font-size:12px;color:#6B7280;margin-top:5px}
.ph-price{margin-top:10px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-variant-numeric:tabular-nums}
.ph-orig{font-size:13px;color:#9CA3AF;text-decoration:line-through}
.ph-sale{font-size:24px;font-weight:900;color:var(--color-accent);letter-spacing:-0.02em}
.ph-disc{font-size:13px;font-weight:800;color:var(--color-primary)}
.ph-ai{margin-top:8px;font-size:12px;color:#4B5563;line-height:1.5;padding:8px 10px;background:#F9FAFB;border-radius:8px}
.ph-notice{margin-top:24px;padding:14px 16px;background:#FEF3C7;border-radius:12px;font-size:12px;color:#92400E;text-align:center;line-height:1.5}
.ph-token{display:inline-block;margin-top:6px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,0.18);font-size:10px;font-weight:700;letter-spacing:0.08em}
</style>
</head>
<body>
<div class="ph-banner">
  <div class="ph-engine">${esc(engineName)} 엔진</div>
  <div class="ph-title">${esc(d.title)}</div>
  <div class="ph-meta-row">${esc(d.storeName)} · ${esc(d.period)}</div>
  <div class="ph-token">season: ${esc(token)}</div>
</div>
${itemList}
<div class="ph-notice">★ D154 PHASE 0 트랙 A — ${esc(engineName)} 엔진 본체는 Claude Design HTML 통합 후 표시됩니다 (현재 placeholder).</div>
</body>
</html>`;
}

/**
 * ★ STORY 엔진 — Claude Design 01-story.html 동적 변환 (D154 PHASE 0 트랙 A)
 *
 * 인스타 스토리 패턴: 1상품 1슬라이드 풀스크린 100vh, 5초 자동 진행 + 탭/스와이프 + 위로 밀어 상세.
 * 매장명/행사명/기간/상품은 FlyerRenderData에서 동적 치환. 시즌 토큰은 <html data-season> 분기.
 * imageUrl 있으면 <img>, 없으면 categoryBg + categoryEmoji 자동 placeholder.
 */
export function renderStoryEngine(d: FlyerRenderData, token: SeasonToken): string {
  const items = flattenItems(d);
  const tokenInfo = SEASON_TOKENS[token];
  const ogTitle = d.storeName + ' · ' + d.title;
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice) + '원').join(' · ');
  const ogImage = buildOgImageUrl(d, token);

  // 슬라이드 데이터 (frontend JS에 SSR 주입) — XSS 방지로 </script> 차단
  const slideItems = items.map(it => ({
    name: it.name,
    cat: it.category,
    originalPrice: it.originalPrice,
    salePrice: it.salePrice,
    badge: it.badge || '',
    unit: it.unit || '',
    origin: it.origin || '',
    cardDiscount: it.cardDiscount || '',
    aiCopy: it.aiCopy || '',
    imageUrl: toAbsUrl(it.imageUrl || '') || '',
    bg: categoryBg(it.category),
    emoji: categoryPictogram(it.category),
  }));
  const slideItemsJson = JSON.stringify(slideItems).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #F97316;
  --color-accent: #EF4444;
  --color-on-primary: #FFFFFF;
  --color-text-strong: #171717;
  --color-text-weak: #6B7280;
  --color-paper: #F5F1EB;
  --color-discount: #DC2626;
  --motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
${seasonStyleBlock()}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body {
  font-family: 'Pretendard Variable', sans-serif;
  background: #000; color: #fff;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none; user-select: none;
}
.price-num { font-variant-numeric: tabular-nums; }
.stage { position: fixed; inset: 0; overflow: hidden; }
.progress-row {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; gap: 4px; padding: 10px 12px 0; z-index: 30;
}
.progress-row .seg { flex: 1; height: 3px; background: rgba(255,255,255,0.32); border-radius: 2px; overflow: hidden; }
.progress-row .seg .bar { height: 100%; width: 0%; background: #fff; border-radius: 2px; }
.progress-row .seg.done .bar { width: 100%; }
.progress-row .seg.active .bar { animation: storyFill 5000ms linear forwards; }
.paused .progress-row .seg.active .bar { animation-play-state: paused; }
@keyframes storyFill { from { width: 0%; } to { width: 100%; } }
.header {
  position: absolute; top: 22px; left: 0; right: 0;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; z-index: 25;
}
.logo {
  width: 32px; height: 32px; border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
  display: grid; place-items: center; font-weight: 800; font-size: 14px;
  color: var(--color-on-primary); box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}
.store-meta { display: flex; flex-direction: column; gap: 1px; flex: 1; }
.store-meta .name { font-size: 14px; font-weight: 700; line-height: 1.1; }
.store-meta .when { font-size: 11px; font-weight: 500; opacity: 0.8; line-height: 1.1; letter-spacing: -0.01em; }
.header .icon-btn {
  width: 32px; height: 32px; display: grid; place-items: center;
  color: #fff; background: transparent; border: 0; cursor: pointer;
}
.header .icon-btn svg { width: 22px; height: 22px; }
.slides { position: absolute; inset: 0; }
.slide {
  position: absolute; inset: 0;
  opacity: 0; pointer-events: none;
  transition: opacity 280ms ease;
}
.slide.active { opacity: 1; pointer-events: auto; }
.hero { position: absolute; inset: 0; overflow: hidden; }
.hero .hero-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hero .ph {
  position: absolute; inset: 0;
  display: grid; place-items: center;
}
.hero .ph::before {
  content: ""; position: absolute; inset: 0;
  background: radial-gradient(60% 50% at 50% 38%, rgba(255,255,255,0.15), transparent 70%);
}
.hero .ph-emoji {
  position: relative; font-size: 200px; line-height: 1;
  filter: drop-shadow(0 12px 24px rgba(0,0,0,0.35));
}
.hero .mask {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.85) 100%);
}
.tap-zones { position: absolute; inset: 0; z-index: 20; display: flex; }
.tap-zones .zone { flex: 1; }
.tap-zones .zone.mid { flex: 0.6; }
.info {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 22px 24px 110px;
  display: flex; flex-direction: column; gap: 10px; z-index: 22;
}
.chip {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; border-radius: 999px;
  background: rgba(255,255,255,0.18); backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.32);
  font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
}
.chip .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 0 8px var(--color-accent);
}
.pname { font-size: 34px; font-weight: 800; line-height: 1.05; letter-spacing: -0.03em; }
.pmeta { font-size: 13px; font-weight: 500; opacity: 0.78; letter-spacing: -0.01em; }
.price-row { display: flex; align-items: baseline; gap: 12px; margin-top: 4px; }
.price-orig {
  font-size: 15px; font-weight: 500; opacity: 0.6;
  text-decoration: line-through; text-decoration-thickness: 1.5px;
}
.price-sale {
  font-size: 44px; font-weight: 900; letter-spacing: -0.04em; line-height: 1;
}
.price-sale .won { font-size: 22px; font-weight: 700; margin-left: 2px; }
.badge-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 12px; border-radius: 8px;
  background: var(--color-primary); color: var(--color-on-primary);
  font-size: 13px; font-weight: 800; letter-spacing: -0.01em;
  transform-origin: left center;
  animation: pop 600ms var(--motion-spring) both 200ms;
}
.badge.outline {
  background: transparent; color: #fff;
  border: 1px solid rgba(255,255,255,0.5); font-weight: 600;
}
@keyframes pop {
  0% { transform: scale(0.6); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
.cta-bar {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 14px 16px calc(14px + env(safe-area-inset-bottom, 0px));
  display: flex; gap: 10px; z-index: 23;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,0.5) 60%);
}
.cta-bar .ghost {
  width: 52px; height: 52px; border-radius: 16px;
  background: rgba(255,255,255,0.16); backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.28);
  display: grid; place-items: center; color: #fff; cursor: pointer;
}
.cta-bar .ghost svg { width: 22px; height: 22px; }
.cta-bar .primary {
  flex: 1; height: 52px; border-radius: 16px;
  background: var(--color-primary); color: var(--color-on-primary);
  border: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.01em;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  box-shadow: 0 8px 22px rgba(0,0,0,0.35); cursor: pointer;
}
.cta-bar .primary svg { width: 18px; height: 18px; }
.swipe-hint {
  position: absolute; left: 50%; bottom: 88px;
  transform: translateX(-50%);
  font-size: 11px; font-weight: 500; opacity: 0.7; z-index: 22;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  animation: bounceUp 1800ms ease-in-out infinite; pointer-events: none;
}
.swipe-hint svg { width: 16px; height: 16px; }
@keyframes bounceUp {
  0%, 100% { transform: translate(-50%, 0); opacity: 0.55; }
  50% { transform: translate(-50%, -6px); opacity: 1; }
}
.slide.active .info > * {
  animation: slideUp 540ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.slide.active .info > *:nth-child(1) { animation-delay: 80ms; }
.slide.active .info > *:nth-child(2) { animation-delay: 140ms; }
.slide.active .info > *:nth-child(3) { animation-delay: 200ms; }
.slide.active .info > *:nth-child(4) { animation-delay: 260ms; }
.slide.active .info > *:nth-child(5) { animation-delay: 320ms; }
@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
.sheet-scrim {
  position: absolute; inset: 0; background: rgba(0,0,0,0.5);
  opacity: 0; pointer-events: none; z-index: 40;
  transition: opacity 240ms ease;
}
.sheet-scrim.open { opacity: 1; pointer-events: auto; }
.sheet {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: 62vh; background: #fff; color: #171717;
  border-radius: 24px 24px 0 0; z-index: 41;
  transform: translateY(100%); transition: transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1);
  padding: 8px 22px 22px; overflow-y: auto;
}
.sheet.open { transform: translateY(0); }
.sheet .grabber { width: 40px; height: 4px; background: #E5E7EB; border-radius: 2px; margin: 8px auto 14px; }
.sheet h3 { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.sheet .ai-copy { margin-top: 10px; font-size: 14px; line-height: 1.5; color: #4B5563; }
.sheet .row {
  display: flex; justify-content: space-between; padding: 12px 0;
  border-bottom: 1px solid #F3F4F6; font-size: 14px;
}
.sheet .row dt { color: #6B7280; font-weight: 500; }
.sheet .row dd { color: #111827; font-weight: 600; }
.sheet .actions {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px;
}
.sheet .actions button {
  height: 46px; border-radius: 12px; border: 0;
  font-size: 14px; font-weight: 700; letter-spacing: -0.01em; cursor: pointer;
}
.sheet .actions .b1 { background: #F3F4F6; color: #111827; }
.sheet .actions .b2 { background: var(--color-primary); color: var(--color-on-primary); }
.endcard {
  position: absolute; inset: 0; display: none;
  flex-direction: column; align-items: center; justify-content: center;
  padding: 40px; background: radial-gradient(80% 60% at 50% 30%, #1f1f1f 0%, #000 100%);
  z-index: 35; gap: 14px; text-align: center;
}
.endcard.show { display: flex; }
.endcard h2 { font-size: 30px; font-weight: 800; letter-spacing: -0.03em; }
.endcard p { font-size: 14px; opacity: 0.7; }
.endcard .ec-row { display: flex; gap: 8px; margin-top: 10px; }
.endcard .ec-row button {
  height: 46px; padding: 0 18px; border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.3); background: transparent;
  color: #fff; font-size: 14px; font-weight: 700; cursor: pointer;
}
.endcard .ec-row .pr { background: var(--color-primary); border-color: var(--color-primary); }
.sr { position: absolute; left: -9999px; }
@media (prefers-reduced-motion: reduce) {
  .progress-row .seg.active .bar { animation-duration: 99999s; }
  .slide.active .info > * { animation: none; }
  .badge { animation: none; }
  .swipe-hint { animation: none; }
}
</style>
</head>
<body>
<div class="stage" id="stage">
  <div class="progress-row" id="progressRow" aria-hidden="true"></div>
  <div class="header">
    <div class="logo" aria-hidden="true">${esc(storeInitial(d.storeName))}</div>
    <div class="store-meta">
      <div class="name">${esc(d.storeName)}</div>
      <div class="when">${esc(d.title)} · ${esc(d.period)}</div>
    </div>
    <button class="icon-btn" id="pauseBtn" aria-label="일시정지">
      <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
    </button>
    <button class="icon-btn" aria-label="닫기" onclick="history.back()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>
  <div class="slides" id="slides"></div>
  <div class="tap-zones">
    <div class="zone" data-act="prev"></div>
    <div class="zone mid" data-act="pause"></div>
    <div class="zone" data-act="next"></div>
  </div>
  <div class="swipe-hint" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    위로 밀어 상세 보기
  </div>
  <div class="cta-bar">
    <button class="ghost" aria-label="찜">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>
    </button>
    <button class="primary" id="ctaAdd">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 7h14l-1.5 11a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8L5 7zM9 7V5a3 3 0 0 1 6 0v2"/></svg>
      장바구니 담기
    </button>
  </div>
  <div class="sheet-scrim" id="sheetScrim"></div>
  <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="상품 상세">
    <div class="grabber"></div>
    <h3 id="sheetName">—</h3>
    <p class="ai-copy" id="sheetCopy">—</p>
    <dl style="margin-top: 14px;">
      <div class="row"><dt>단위</dt><dd id="sheetUnit">—</dd></div>
      <div class="row"><dt>원산지</dt><dd id="sheetOrigin">—</dd></div>
      <div class="row"><dt>카드 할인</dt><dd id="sheetCard">—</dd></div>
      <div class="row"><dt>유효 기간</dt><dd>${esc(d.period)}</dd></div>
      <div class="row"><dt>매장</dt><dd>${esc(d.storeName)}</dd></div>
    </dl>
    <div class="actions">
      <button class="b1">길찾기</button>
      <button class="b2">장바구니 담기</button>
    </div>
  </div>
  <div class="endcard" id="endcard">
    <h2>전체 상품 ${items.length}개<br>한눈에 보기</h2>
    <p>이번 주 행사 상품을 그리드로 확인하세요</p>
    <div class="ec-row">
      <button onclick="window.__restart()">처음부터</button>
      <button class="pr" onclick="location.reload()">전체 보기</button>
    </div>
  </div>
  <div class="sr" id="srLive" aria-live="polite"></div>
</div>
<script>
(function(){
  var ALL_ITEMS = ${slideItemsJson};
  if (!ALL_ITEMS || ALL_ITEMS.length === 0) return;
  var SLIDE_DURATION = 5000;
  var idx = 0, paused = false, advanceTimer = null, timerStart = 0, remaining = SLIDE_DURATION;
  var slidesEl = document.getElementById('slides');
  var progRow = document.getElementById('progressRow');

  function fmt(n) { return (n || 0).toLocaleString('ko-KR'); }
  function pctOff(o, s) { return o > 0 ? Math.round((1 - s/o) * 100) : 0; }
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function buildSlide(it, i) {
    var seg = document.createElement('div');
    seg.className = 'seg' + (i === 0 ? ' active' : '');
    seg.setAttribute('role', 'progressbar');
    seg.setAttribute('aria-valuenow', '0');
    seg.innerHTML = '<div class="bar"></div>';
    progRow.appendChild(seg);

    var sl = document.createElement('div');
    sl.className = 'slide' + (i === 0 ? ' active' : '');
    sl.setAttribute('aria-label', (i+1) + ' / ' + ALL_ITEMS.length + ' · ' + it.name);
    sl.setAttribute('data-product', JSON.stringify({ name: it.name, originalPrice: it.originalPrice, salePrice: it.salePrice, imageUrl: it.imageUrl, unit: it.unit, category: it.cat }));

    var hero = document.createElement('div');
    hero.className = 'hero';
    if (it.imageUrl) {
      var img = document.createElement('img');
      img.className = 'hero-img';
      img.src = it.imageUrl;
      img.alt = it.name;
      img.loading = i === 0 ? 'eager' : 'lazy';
      hero.appendChild(img);
    } else {
      var ph = document.createElement('div');
      ph.className = 'ph';
      ph.style.backgroundColor = it.bg;
      var em = document.createElement('span');
      em.className = 'ph-emoji';
      em.textContent = it.emoji;
      ph.appendChild(em);
      hero.appendChild(ph);
    }
    var mask = document.createElement('div');
    mask.className = 'mask';
    hero.appendChild(mask);
    sl.appendChild(hero);

    var info = document.createElement('div');
    info.className = 'info';
    var disc = pctOff(it.originalPrice, it.salePrice);
    var metaParts = [];
    if (it.unit) metaParts.push(it.unit);
    if (it.origin) metaParts.push(it.origin);
    if (it.cardDiscount && it.cardDiscount !== '—') metaParts.push(it.cardDiscount);
    var origHtml = it.originalPrice > 0 ? '<span class="price-orig price-num">' + fmt(it.originalPrice) + '원</span>' : '';
    var badgeHtml = it.badge ? '<span class="badge">' + escHtml(it.badge) + '</span>' : (disc > 0 ? '<span class="badge">' + disc + '% 할인</span>' : '');
    var outlineHtml = disc > 0 ? '<span class="badge outline">' + disc + '% OFF</span>' : '';
    info.innerHTML =
      '<span class="chip"><span class="dot"></span>' + escHtml(it.cat) + ' · 오늘의 핫딜</span>' +
      '<div class="pname">' + escHtml(it.name) + '</div>' +
      '<div class="pmeta">' + escHtml(metaParts.join(' · ')) + '</div>' +
      '<div class="price-row">' + origHtml + '<span class="price-sale price-num">' + fmt(it.salePrice) + '<span class="won">원</span></span></div>' +
      '<div class="badge-row">' + badgeHtml + outlineHtml + '</div>';
    sl.appendChild(info);

    slidesEl.appendChild(sl);
  }

  ALL_ITEMS.forEach(buildSlide);

  function showSlide(n) {
    var slides = slidesEl.querySelectorAll('.slide');
    var segs = progRow.querySelectorAll('.seg');
    if (n >= ALL_ITEMS.length) {
      stopAdvance();
      document.getElementById('endcard').classList.add('show');
      return;
    }
    if (n < 0) n = 0;
    document.getElementById('endcard').classList.remove('show');

    slides.forEach(function(s, i){ s.classList.toggle('active', i === n); });
    segs.forEach(function(seg, i){
      seg.classList.remove('active');
      var bar = seg.querySelector('.bar');
      bar.style.animation = 'none';
      void bar.offsetHeight;
      if (i < n) seg.classList.add('done'); else seg.classList.remove('done');
      if (i === n) { seg.classList.add('active'); bar.style.animation = ''; }
    });
    idx = n;
    document.getElementById('srLive').textContent = (n+1) + ' / ' + ALL_ITEMS.length + ' · ' + ALL_ITEMS[n].name;
    startAdvance(SLIDE_DURATION);
  }

  function startAdvance(ms) {
    stopAdvance();
    remaining = ms; timerStart = Date.now();
    if (!paused) advanceTimer = setTimeout(function(){ showSlide(idx + 1); }, ms);
  }
  function stopAdvance() { if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; } }
  function pauseToggle() {
    paused = !paused;
    document.getElementById('stage').classList.toggle('paused', paused);
    var btn = document.getElementById('pauseBtn');
    if (paused) {
      stopAdvance();
      remaining = remaining - (Date.now() - timerStart);
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      btn.setAttribute('aria-label', '재생');
    } else {
      timerStart = Date.now();
      advanceTimer = setTimeout(function(){ showSlide(idx + 1); }, Math.max(remaining, 400));
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
      btn.setAttribute('aria-label', '일시정지');
    }
  }

  document.querySelectorAll('.tap-zones .zone').forEach(function(z){
    z.addEventListener('click', function(){
      var act = z.dataset.act;
      if (act === 'prev') showSlide(idx - 1);
      else if (act === 'next') showSlide(idx + 1);
      else pauseToggle();
    });
  });
  document.getElementById('pauseBtn').addEventListener('click', function(e){ e.stopPropagation(); pauseToggle(); });

  var pressTimer = null;
  var stage = document.getElementById('stage');
  stage.addEventListener('pointerdown', function(){
    pressTimer = setTimeout(function(){ if (!paused) pauseToggle(); }, 350);
  });
  stage.addEventListener('pointerup', function(){
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  });

  var startY = 0;
  stage.addEventListener('touchstart', function(e){ startY = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', function(e){
    var endY = (e.changedTouches[0] || {}).clientY;
    if (endY == null) endY = startY;
    if (startY - endY > 60) openSheet();
  }, { passive: true });

  window.addEventListener('keydown', function(e){
    if (e.key === 'ArrowLeft') showSlide(idx - 1);
    else if (e.key === 'ArrowRight') showSlide(idx + 1);
    else if (e.key === ' ') { e.preventDefault(); pauseToggle(); }
    else if (e.key === 'ArrowUp') openSheet();
    else if (e.key === 'Escape') closeSheet();
  });

  function openSheet() {
    if (!paused) pauseToggle();
    var it = ALL_ITEMS[idx];
    document.getElementById('sheetName').textContent = it.name;
    document.getElementById('sheetCopy').textContent = it.aiCopy || '';
    document.getElementById('sheetUnit').textContent = it.unit || '—';
    document.getElementById('sheetOrigin').textContent = it.origin || '—';
    document.getElementById('sheetCard').textContent = it.cardDiscount || '—';
    document.getElementById('sheet').classList.add('open');
    document.getElementById('sheetScrim').classList.add('open');
  }
  function closeSheet() {
    document.getElementById('sheet').classList.remove('open');
    document.getElementById('sheetScrim').classList.remove('open');
    if (paused) pauseToggle();
  }
  document.getElementById('sheetScrim').addEventListener('click', closeSheet);

  window.__restart = function(){
    document.getElementById('endcard').classList.remove('show');
    showSlide(0);
  };

  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev){
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });

  showSlide(0);
})();
</script>
</body>
</html>`;
}
/** D154 PHASE 0: 카테고리 → MAGAZINE 챕터 헤드라인 (h2 정적 매핑, PHASE 1에서 AI 동적 예정) */
function categoryHeadline(catName: string): string {
  const trimmed = (catName || '').trim();
  const map: Record<string, string> = {
    '축산': '두툼하게,<br>주말의 한 끼.',
    '정육': '두툼하게,<br>주말의 한 끼.',
    '한우': '결을 살린,<br>가족 한 끼.',
    '청과/야채': '햇과일이<br>도착했어요.',
    '청과': '햇과일이<br>도착했어요.',
    '야채': '아삭한,<br>밥상 한 그릇.',
    '과일': '햇과일이<br>도착했어요.',
    '수산': '오늘<br>바다에서<br>왔습니다.',
    '공산': '한 잔이<br>두 잔이 되는<br>주간.',
    '냉동': '시원하게,<br>오래오래.',
    '유제품': '아침 식탁<br>한 잔.',
    '음료/주류': '주말의<br>한 잔.',
    '음료': '주말의<br>한 잔.',
    '주류': '주말의<br>한 잔.',
    '생활용품': '매일 쓰는,<br>알찬 것들.',
    '베이커리': '오늘 구운,<br>한 입의 행복.',
    '간식': '한 봉,<br>오늘의 작은 사치.',
  };
  return map[trimmed] || trimmed + '<br>이번 주.';
}

/** D154 PHASE 0: 카테고리 → MAGAZINE 챕터 설명 (p 정적 매핑) */
function categoryDescription(catName: string): string {
  const trimmed = (catName || '').trim();
  const map: Record<string, string> = {
    '축산': '사장님이 새벽 시장에서 직접 골라온 고기들. 손이 가기 좋은 두께로 손질했습니다.',
    '정육': '사장님이 새벽 시장에서 직접 골라온 고기들. 손이 가기 좋은 두께로 손질했습니다.',
    '한우': '가족 모임을 위한 1++ 등급. 결을 살려 직접 손질했습니다.',
    '청과/야채': '새벽 산지에서 바로 올라온 제철 청과·야채. 사장님이 직접 골라 진열했습니다.',
    '청과': '새벽 산지에서 올라온 제철 과일. 당도 검수를 거친 것만 진열했습니다.',
    '야채': '오늘 새벽 산지에서 받은 신선 야채.',
    '과일': '제철 과일을 한 자리에. 사장님이 당도 직접 확인했습니다.',
    '수산': '오늘 새벽 산지에서 직접 받은 활어·해산물. 콜드체인으로 신선하게.',
    '공산': '이번 주 사장님이 골라온 알찬 공산품. 1+1 행사 포함.',
    '냉동': '신선하게 얼린 냉동 식품. 보관·요리 모두 편리합니다.',
    '유제품': '국산 1등급 원유로 만든 신선 유제품. 아침 식탁의 든든한 한 잔.',
    '음료/주류': '한 잔이 즐거운 음료와 주류. 이번 주만의 행사가.',
    '음료': '시원하게, 든든하게. 이번 주 음료 행사.',
    '주류': '주말의 한 잔. 이번 주만의 행사가.',
    '생활용품': '매일 쓰는 생활용품 알뜰 행사. 사장님이 골라온 가성비.',
    '베이커리': '오늘 매장에서 직접 구운 빵. 신선한 향과 식감.',
    '간식': '오늘의 작은 사치. 한 봉씩 골라가세요.',
  };
  return map[trimmed] || '이번 주 사장님이 골라온 ' + trimmed + ' 행사 상품입니다.';
}

/**
 * ★ MAGAZINE 엔진 — Claude Design 02-magazine.html 동적 변환 (D154 PHASE 0 트랙 A)
 *
 * Apple/NYT 스크롤텔링 + 매거진 무드보드. 카테고리별 챕터 헤드 + 풀블리드 product article.
 * IntersectionObserver로 data-reveal 진입 시 fade-in + price-pop, parallax product 이미지.
 */
export function renderMagazineEngine(d: FlyerRenderData, token: SeasonToken): string {
  const tokenInfo = SEASON_TOKENS[token];
  const items = flattenItems(d);
  const totalItems = items.length;
  const ogTitle = d.storeName + ' · ' + d.title;
  const ogDesc = '이번 주 사장님이 직접 고른 ' + totalItems + '가지';
  const ogImage = buildOgImageUrl(d, token);

  // 카테고리별 카운트 요약 (cover-byline용)
  const catSummary = d.categories.map(c => esc(c.name) + ' ' + c.items.length + '종').join(' · ');

  // 카테고리별 챕터 + 상품 article HTML 생성
  let pageNum = 0;
  const chaptersHtml: string[] = [];
  const dotsHtml: string[] = [`<div class="d" data-target="ch-cover"></div>`];

  d.categories.forEach((cat, ci) => {
    const catClass = categoryClass(cat.name);
    const catEn = categoryEn(cat.name);
    const catId = 'cat-' + (ci + 1);
    const catHeadline = categoryHeadline(cat.name);
    const catDesc = categoryDescription(cat.name);

    chaptersHtml.push(`<section class="cat-head ${catClass}" id="${catId}">
  <div class="label">CHAPTER ${String(ci + 1).padStart(2, '0')} · ${esc(cat.name)}</div>
  <div>
    <h2 data-reveal>${catHeadline}</h2>
    <p data-reveal>${esc(catDesc)}</p>
  </div>
  <div class="meta">
    <span class="num">${cat.items.length}</span> ITEM${cat.items.length > 1 ? 'S' : ''} · ${esc(catEn)}
  </div>
</section>`);
    dotsHtml.push(`<div class="d" data-target="${catId}"></div>`);

    cat.items.forEach(item => {
      pageNum++;
      const numStr = String(pageNum).padStart(2, '0');
      const totalStr = String(totalItems).padStart(2, '0');
      const disc = calcDisc(item.originalPrice, item.salePrice);
      const heroBlock = item.imageUrl
        ? `<img class="img" src="${esc(toAbsUrl(item.imageUrl) || '')}" alt="${esc(item.name)}" style="position:absolute;inset:-8% 0 -12% 0;width:100%;height:114%;object-fit:cover;will-change:transform">`
        : `<div class="img"><div class="ph" style="background:${categoryBg(cat.name)};"><span class="ph-emoji" style="font-size:180px;line-height:1;filter:drop-shadow(0 12px 24px rgba(0,0,0,0.25));">${esc(categoryPictogram(cat.name))}</span></div></div>`;
      const specParts: string[] = [];
      if (item.unit) specParts.push(`<span>${esc(item.unit)}</span>`);
      if (item.origin) specParts.push(`<span>${esc(item.origin)}</span>`);
      const specline = specParts.length > 0
        ? `<div class="specline" data-reveal>${specParts.join('<span class="sep">·</span>')}</div>`
        : '';
      const origPrice = item.originalPrice > 0
        ? `<span class="orig price-num">${fmtPrice(item.originalPrice)}원</span>`
        : '';
      const badgeParts: string[] = [];
      if (item.badge) badgeParts.push(`<span class="b1">${esc(item.badge)}</span>`);
      else if (disc > 0) badgeParts.push(`<span class="b1">${disc}% 할인</span>`);
      if (item.cardDiscount && item.cardDiscount !== '—') badgeParts.push(`<span class="b2">${esc(item.cardDiscount)}</span>`);
      const aiCopyHtml = item.aiCopy
        ? `<p class="copy" data-reveal>${esc(item.aiCopy)}</p>`
        : `<p class="copy" data-reveal>${esc(item.name)}, 이번 주만의 가격으로 만나보세요.</p>`;

      chaptersHtml.push(`<article class="product" data-num="${numStr}"${productDataAttr(item, cat.name)}>
  <div class="num"><b>${numStr}</b> / ${totalStr} · ${esc(cat.name)}</div>
  <div class="pic" data-reveal>
    <div class="img">${heroBlock}</div>
    <div class="frame-label">${esc(item.name.toUpperCase())}${item.unit ? ' · ' + esc(item.unit.toUpperCase()) : ''}</div>
  </div>
  <div class="body">
    <div class="kicker" data-reveal>${esc(item.badge || categoryEn(cat.name))}</div>
    <h3 data-reveal>${esc(item.name)}${item.unit ? '<br>' + esc(item.unit) : ''}</h3>
    ${specline}
    ${aiCopyHtml}
    <div class="price-block" data-reveal>
      ${origPrice}
      <span class="sale price-num"><span class="price-pop">${fmtPrice(item.salePrice)}</span><span class="won">원</span></span>
    </div>
    ${badgeParts.length > 0 ? `<div class="badges" data-reveal>${badgeParts.join('')}</div>` : ''}
  </div>
</article>`);
    });
  });

  dotsHtml.push(`<div class="d" data-target="ch-outro"></div>`);

  // outro 매장 정보 (externalLinks + announcements에서 추출)
  const phoneLink = (d.externalLinks || []).find(l => l.icon === 'phone');
  const mapLink = (d.externalLinks || []).find(l => l.icon === 'map');
  const businessHours = (d.announcements || []).find(a => a.title.indexOf('영업') >= 0 || a.title.indexOf('시간') >= 0);

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #F97316;
  --color-accent: #EF4444;
  --color-on-primary: #FFFFFF;
  --color-text-strong: #171717;
  --color-text-weak: #6B7280;
  --color-paper: #F5F1EB;
  --color-paper-deep: #ECE6DA;
  --color-rule: #DDD5C5;
  --color-discount: #DC2626;
  --motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
${seasonStyleBlock()}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--color-paper); color: var(--color-text-strong); }
body {
  font-family: 'Pretendard Variable', sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
img { display: block; }
.price-num { font-variant-numeric: tabular-nums; }
body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 100;
  opacity: 0.5; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.2  0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0.06 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}
.cover { min-height: 100vh; padding: 32px 24px 40px; display: flex; flex-direction: column; background: var(--color-paper); position: relative; }
.masthead {
  display: flex; align-items: center; justify-content: space-between;
  border-top: 2px solid var(--color-text-strong);
  border-bottom: 1px solid var(--color-text-strong);
  padding: 10px 0;
  font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase;
}
.masthead .issue { font-weight: 800; }
.cover-eyebrow { margin-top: 60px; font-size: 13px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-text-weak); }
.cover-eyebrow::before { content: ""; display: inline-block; width: 36px; height: 1px; background: var(--color-text-weak); margin-right: 12px; vertical-align: middle; }
.cover h1 { margin-top: 18px; font-size: 56px; font-weight: 800; line-height: 1.0; letter-spacing: -0.04em; text-wrap: balance; }
.cover h1 em {
  font-style: normal; color: var(--color-primary);
  background-image: linear-gradient(transparent 70%, currentColor 70%, currentColor 85%, transparent 85%);
  background-repeat: no-repeat; background-size: 100% 100%;
}
.cover-byline { margin-top: 28px; font-size: 14px; line-height: 1.6; color: #2a2a2a; max-width: 320px; }
.cover-foot { margin-top: auto; padding-top: 40px; display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid var(--color-rule); padding-top: 16px; }
.cover-foot .store { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; }
.cover-foot .when { font-size: 12px; color: var(--color-text-weak); margin-top: 2px; letter-spacing: 0.04em; }
.cover-foot .pages { font-size: 11px; letter-spacing: 0.18em; color: var(--color-text-weak); text-transform: uppercase; }
.scroll-hint {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
  font-size: 10px; letter-spacing: 0.2em; color: var(--color-text-weak);
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  animation: bounce 1800ms ease-in-out infinite;
}
.scroll-hint svg { width: 14px; height: 14px; }
@keyframes bounce { 0%,100% { transform: translate(-50%, 0);} 50% { transform: translate(-50%, 5px);} }
.cat-head { height: 60vh; min-height: 380px; padding: 28px 24px; display: flex; flex-direction: column; justify-content: space-between; color: #fff; position: relative; overflow: hidden; }
.cat-head.meat { background: #4b1818; }
.cat-head.prod { background: #1f4a26; }
.cat-head.fish { background: #122a52; }
.cat-head.dry  { background: #3d2f24; }
.cat-head::before { content: ""; position: absolute; inset: 0; background: radial-gradient(50% 38% at 70% 32%, rgba(255,255,255,0.18), transparent 60%), radial-gradient(40% 28% at 18% 78%, rgba(255,255,255,0.12), transparent 60%); mix-blend-mode: screen; }
.cat-head::after { content: ""; position: absolute; inset: 0; background-image: repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 6px); }
.cat-head .label { position: relative; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(255,255,255,0.7); font-weight: 600; }
.cat-head h2 { position: relative; font-size: 52px; font-weight: 800; letter-spacing: -0.04em; line-height: 1.0; max-width: 320px; }
.cat-head p { position: relative; margin-top: 18px; font-size: 15px; line-height: 1.55; opacity: 0.85; max-width: 320px; }
.cat-head .meta { position: relative; display: flex; align-items: center; gap: 12px; font-size: 11px; letter-spacing: 0.16em; opacity: 0.7; }
.cat-head .meta .num { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.4); display: grid; place-items: center; font-weight: 700; font-size: 12px; letter-spacing: 0; }
.product { min-height: 100vh; padding: 56px 24px 80px; display: grid; grid-template-rows: 1fr auto; gap: 28px; position: relative; background: var(--color-paper); }
.product .num { position: absolute; top: 28px; right: 24px; font-size: 11px; letter-spacing: 0.2em; color: var(--color-text-weak); }
.product .num b { color: var(--color-text-strong); font-weight: 800; }
.product .pic { position: relative; aspect-ratio: 4/5; border-radius: 4px; overflow: hidden; box-shadow: 0 14px 32px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08); }
.product .pic .img { position: absolute; inset: -8% 0 -12% 0; will-change: transform; }
.product .pic .frame-label { position: absolute; left: 12px; bottom: 12px; font-size: 10px; letter-spacing: 0.18em; color: #fff; background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 2px; backdrop-filter: blur(4px); }
.ph { position: absolute; inset: 0; display: grid; place-items: center; }
.product .body { display: flex; flex-direction: column; gap: 8px; }
.product .kicker { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-text-weak); font-weight: 600; }
.product h3 { font-size: 32px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05; }
.product .specline { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 13px; color: var(--color-text-weak); font-weight: 500; flex-wrap: wrap; }
.product .specline .sep { color: var(--color-rule); }
.product .copy { margin-top: 10px; font-size: 15px; line-height: 1.55; color: #2a2a2a; max-width: 340px; text-wrap: pretty; }
.product .price-block { display: flex; align-items: baseline; gap: 14px; margin-top: 14px; flex-wrap: wrap; }
.product .orig { font-size: 14px; color: var(--color-text-weak); text-decoration: line-through; }
.product .sale { font-size: 48px; font-weight: 900; letter-spacing: -0.04em; line-height: 1; color: var(--color-text-strong); }
.product .sale .won { font-size: 22px; margin-left: 2px; font-weight: 800; }
.product .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.product .b1 { background: var(--color-primary); color: var(--color-on-primary); padding: 6px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; }
.product .b2 { border: 1px solid var(--color-text-strong); padding: 6px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; }
[data-reveal] { opacity: 0; transform: translateY(28px); transition: opacity 700ms ease, transform 700ms cubic-bezier(0.2, 0.7, 0.2, 1); }
[data-reveal].in { opacity: 1; transform: none; }
.price-pop { display: inline-block; }
.price-pop.fire { animation: pricePop 800ms var(--motion-spring) both; }
@keyframes pricePop {
  0% { transform: scale(0.92); }
  40% { transform: scale(1.12); }
  100% { transform: scale(1); }
}
.outro { min-height: 100vh; padding: 60px 24px 40px; background: var(--color-text-strong); color: #fff; display: flex; flex-direction: column; gap: 22px; position: relative; }
.outro h2 { font-size: 48px; font-weight: 800; letter-spacing: -0.04em; line-height: 1.0; }
.outro h2 em { font-style: normal; color: var(--color-accent); }
.outro .lead { font-size: 15px; line-height: 1.6; opacity: 0.78; max-width: 320px; margin-top: 6px; }
.outro .infogrid { display: grid; gap: 16px; margin-top: 18px; grid-template-columns: 1fr 1fr; }
.outro .infogrid .cell { border-top: 1px solid rgba(255,255,255,0.16); padding-top: 10px; }
.outro .infogrid .cell .k { font-size: 10px; letter-spacing: 0.18em; opacity: 0.6; text-transform: uppercase; }
.outro .infogrid .cell .v { margin-top: 4px; font-size: 16px; font-weight: 700; }
.outro .cta { margin-top: auto; height: 60px; border-radius: 999px; border: 0; background: var(--color-primary); color: var(--color-on-primary); font-size: 17px; font-weight: 800; letter-spacing: -0.01em; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; }
.outro .cta svg { width: 20px; height: 20px; }
.outro .share { display: flex; gap: 8px; }
.outro .share button { flex: 1; height: 44px; border-radius: 999px; background: transparent; border: 1px solid rgba(255,255,255,0.24); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.outro-meta { margin-top: 24px; display: flex; justify-content: space-between; font-size: 10px; letter-spacing: 0.18em; opacity: 0.5; }
.dots { position: fixed; right: 16px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 8px; z-index: 60; mix-blend-mode: difference; }
.dots .d { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.55); transition: transform 200ms, background 200ms; cursor: pointer; }
.dots .d.active { background: #fff; transform: scale(1.6); }
@media (prefers-reduced-motion: reduce) {
  [data-reveal] { transition: none; opacity: 1; transform: none; }
  .price-pop.fire { animation: none; }
  .scroll-hint { animation: none; }
}
</style>
</head>
<body>
<section class="cover" id="ch-cover">
  <div class="masthead">
    <span class="issue">WEEKLY</span>
    <span>${esc(d.period)}</span>
    <span>₩</span>
  </div>
  <div class="cover-eyebrow">이번 주 사장님이 골랐습니다</div>
  <h1 data-reveal>${esc(d.title)}</h1>
  <p class="cover-byline" data-reveal>
    ${esc(d.storeName)}이(가) 발행하는 주간 매대 매거진.<br>
    이번 호엔 ${catSummary}.
    사장님이 새벽 시장에서 직접 본 것만 담았습니다.
  </p>
  <div class="cover-foot">
    <div>
      <div class="store">${esc(d.storeName)}</div>
      <div class="when">${esc(d.period)}</div>
    </div>
    <div class="pages">PP. 01 – ${String(totalItems).padStart(2, '0')}</div>
  </div>
  <div class="scroll-hint">
    SCROLL
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
  </div>
</section>

${chaptersHtml.join('\n')}

<section class="outro" id="ch-outro">
  <div>
    <div class="cover-eyebrow" style="color: rgba(255,255,255,0.6);">마치며</div>
    <h2 data-reveal>이번 주<br><em>매장에서</em><br>만나요.</h2>
    <p class="lead" data-reveal>주문은 매장 방문 또는 카톡 채널 한 줄. 사장님이 직접 받습니다.</p>
  </div>
  <div class="infogrid">
    <div class="cell"><div class="k">영업 시간</div><div class="v">${esc(businessHours ? businessHours.content : '—')}</div></div>
    <div class="cell"><div class="k">전화</div><div class="v">${esc(phoneLink ? phoneLink.label : '—')}</div></div>
    <div class="cell"><div class="k">주소</div><div class="v">${esc(mapLink ? mapLink.label : '—')}</div></div>
    <div class="cell"><div class="k">행사 기간</div><div class="v">${esc(d.period)}</div></div>
  </div>
  <div class="share">
    <button onclick="if(navigator.share){navigator.share({title:document.title,url:location.href}).catch(function(){});}else{navigator.clipboard&&navigator.clipboard.writeText(location.href);}">카톡 공유</button>
    <button onclick="navigator.clipboard&&navigator.clipboard.writeText(location.href);">링크 복사</button>
  </div>
  <button class="cta" ${mapLink ? `onclick="window.open('${esc(mapLink.url)}','_blank')"` : ''}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-3v-7H10v7H7a2 2 0 0 1-2-2v-9z"/></svg>
    매장 방문하기
  </button>
  <div class="outro-meta">
    <span>HANJUL · WEEKLY</span>
    <span>EDITED · ${esc(d.storeName)}</span>
  </div>
</section>

<div class="dots" aria-hidden="true">${dotsHtml.join('')}</div>

<script>
(function(){
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting) {
        e.target.classList.add('in');
        if (e.target.matches('.product .price-block')) {
          var pp = e.target.querySelector('.price-pop');
          if (pp) setTimeout(function(){ pp.classList.add('fire'); }, 380);
        }
      }
    });
  }, { threshold: 0.18 });
  document.querySelectorAll('[data-reveal]').forEach(function(el){ io.observe(el); });

  var pics = document.querySelectorAll('.product .pic');
  function onScroll() {
    var vh = window.innerHeight;
    pics.forEach(function(pic){
      var r = pic.getBoundingClientRect();
      var t = Math.max(0, Math.min(1, 1 - (r.top + r.height/2) / vh + 0.5));
      var img = pic.querySelector('.img');
      if (img) img.style.transform = 'translateY(' + ((t - 0.5) * -60) + 'px)';
    });
    var activeId = null;
    document.querySelectorAll('section, article').forEach(function(s){
      var r = s.getBoundingClientRect();
      if (r.top <= vh * 0.4 && r.bottom > vh * 0.4) activeId = s.id || activeId;
    });
    document.querySelectorAll('.dots .d').forEach(function(d){
      d.classList.toggle('active', d.dataset.target === activeId);
    });
  }
  document.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  document.querySelectorAll('.dots .d').forEach(function(d){
    d.addEventListener('click', function(){
      var t = document.getElementById(d.dataset.target);
      if (t) window.scrollTo({ top: t.offsetTop, behavior: 'smooth' });
    });
  });

  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev){
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });
})();
</script>
</body>
</html>`;
}
/** D154 PHASE 0: badge에서 "한정 N개" 패턴 추출 (DEAL FEED limit 필드) */
function extractLimit(badge: string | undefined): number {
  if (!badge) return 0;
  const m = badge.match(/한정\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** D154 PHASE 0: periodEnd → endsAt timestamp (자정 23:59:59 또는 24h 후 폴백) */
function computeEndsAt(periodEnd: string | null | undefined): number {
  if (periodEnd) {
    const d = new Date(periodEnd + 'T23:59:59');
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return Date.now() + 24 * 3600 * 1000;
}

/**
 * ★ DEAL FEED 엔진 — Claude Design 03-deal-feed.html 동적 변환 (D154 PHASE 0 트랙 A)
 *
 * 무신사/29CM 핫딜 피드 패턴. 카드마다 카운트다운 + 잔여수량 progress + 좋아요·공유·담기.
 * endsAt = periodEnd 자정 (없으면 24h 후), limit = badge "한정 N" 추출, soldPct/likes = 0 디폴트.
 * (PHASE 1에서 POS Agent 연동 시 soldPct/likes 실시간).
 */
export function renderDealFeedEngine(d: FlyerRenderData, token: SeasonToken): string {
  const tokenInfo = SEASON_TOKENS[token];
  const items = flattenItems(d);
  const total = items.length;
  const baseEndsAt = computeEndsAt(d.periodEnd);
  const ogTitle = '오늘의 핫딜 · ' + d.storeName;
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice) + '원').join(' · ') + ' · 마감 임박';
  const ogImage = buildOgImageUrl(d, token);

  // 카테고리별 카운트 (chips용)
  const catCounts: Array<{ name: string; count: number }> = d.categories.map(c => ({ name: c.name, count: c.items.length }));

  // SSR 카드 데이터 (JS DEALS 배열로 주입)
  const deals = items.map((it, idx) => ({
    name: it.name,
    cat: it.category,
    originalPrice: it.originalPrice,
    salePrice: it.salePrice,
    badge: it.badge || '',
    unit: it.unit || '',
    origin: it.origin || '',
    cardDiscount: it.cardDiscount || '',
    limit: extractLimit(it.badge) || (idx < 2 ? 30 : 0),
    soldPct: 0,
    likes: 0,
    endsAt: baseEndsAt,
    imageUrl: toAbsUrl(it.imageUrl || '') || '',
    bg: categoryBg(it.category),
    emoji: categoryPictogram(it.category),
  }));
  const dealsJson = JSON.stringify(deals).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');

  // chips HTML (전체 + 카테고리별)
  const chipsHtml = '<button class="chip active" data-cat="">전체 <span class="num">' + total + '</span></button>'
    + catCounts.map(c => '<button class="chip" data-cat="' + esc(c.name) + '">' + esc(c.name) + ' <span class="num">' + c.count + '</span></button>').join('');

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #F97316;
  --color-accent: #EF4444;
  --color-on-primary: #FFFFFF;
  --color-text-strong: #171717;
  --color-text-weak: #6B7280;
  --color-bg: #F4F4F5;
  --color-card: #FFFFFF;
  --color-rule: #E5E7EB;
  --color-discount: #DC2626;
  --color-amber: #F59E0B;
  --color-red: #EF4444;
  --shadow-card: 0 1px 0 rgba(0,0,0,0.04), 0 6px 18px -8px rgba(0,0,0,0.10);
  --shadow-lift: 0 12px 32px -8px rgba(0,0,0,0.18);
  --motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
${seasonStyleBlock()}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--color-bg); color: var(--color-text-strong); }
body { font-family: 'Pretendard Variable', sans-serif; -webkit-font-smoothing: antialiased; }
.price-num { font-variant-numeric: tabular-nums; }
button { font-family: inherit; }
.topbar {
  position: sticky; top: 0; z-index: 30;
  color: var(--color-on-primary);
  background:
    radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, var(--color-primary), white 14%), transparent 60%),
    linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent) 100%);
  padding: 14px 16px 12px;
}
.topbar .row1 { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; opacity: 0.95; }
.topbar .row1 .pulse {
  width: 8px; height: 8px; border-radius: 50%; background: #fff;
  animation: pulseDot 1400ms ease-out infinite;
}
@keyframes pulseDot {
  0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.7); }
  80%, 100% { box-shadow: 0 0 0 12px rgba(255,255,255,0); }
}
.topbar h1 { margin-top: 4px; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.topbar .count { font-variant-numeric: tabular-nums; font-size: 26px; font-weight: 900; letter-spacing: -0.01em; display: inline-flex; align-items: center; }
.topbar .count .sep { padding: 0 1px; opacity: 0.7; }
.topbar .sub { margin-top: 4px; font-size: 12px; opacity: 0.85; font-weight: 500; }
.chips { position: sticky; top: 0; z-index: 25; background: var(--color-bg); border-bottom: 1px solid var(--color-rule); padding: 10px 0; }
.chips-scroll { display: flex; gap: 6px; padding: 0 14px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.chips-scroll::-webkit-scrollbar { display: none; }
.chip {
  flex: 0 0 auto; scroll-snap-align: start;
  height: 34px; padding: 0 14px; border-radius: 999px;
  background: #fff; border: 1px solid var(--color-rule);
  color: var(--color-text-strong);
  font-size: 13px; font-weight: 600; letter-spacing: -0.01em;
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
}
.chip.active { background: var(--color-text-strong); color: #fff; border-color: var(--color-text-strong); }
.chip .num { font-size: 11px; opacity: 0.7; background: rgba(0,0,0,0.06); padding: 1px 6px; border-radius: 999px; }
.chip.active .num { background: rgba(255,255,255,0.15); opacity: 0.9; }
.sort { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 0; font-size: 13px; font-weight: 600; color: var(--color-text-weak); }
.sort .opts { display: flex; gap: 4px; }
.sort .opt { padding: 6px 10px; border-radius: 8px; cursor: pointer; }
.sort .opt.active { background: #fff; color: var(--color-text-strong); border: 1px solid var(--color-rule); }
.sort .total { font-size: 12px; }
.sort .total b { color: var(--color-text-strong); font-weight: 800; }
.feed { padding: 12px 16px 100px; display: flex; flex-direction: column; gap: 12px; }
.card {
  background: var(--color-card); border-radius: 18px; padding: 12px;
  box-shadow: var(--shadow-card); position: relative; overflow: hidden;
  opacity: 0; transform: translateY(16px);
}
.card.in { opacity: 1; transform: none; transition: opacity 420ms ease, transform 420ms ease; }
.card.urgent { animation: borderPulse 900ms ease-in-out infinite; }
@keyframes borderPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45), var(--shadow-card); }
  50% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.0), var(--shadow-card); }
}
.card.hide { display: none; }
.card .top { display: grid; grid-template-columns: 128px 1fr; gap: 12px; align-items: stretch; }
.pic { position: relative; aspect-ratio: 1/1; width: 128px; border-radius: 12px; overflow: hidden; background: #f3f4f6; }
.pic .ph-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pic .ph { position: absolute; inset: 0; display: grid; place-items: center; }
.pic .ph-emoji { font-size: 78px; line-height: 1; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.12)); }
.pic .stickerBadge { position: absolute; top: 8px; left: 8px; background: var(--color-text-strong); color: #fff; font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 999px; }
.pic .stickerBadge.hot { background: var(--color-discount); }
.pic .countdown {
  position: absolute; left: 8px; right: 8px; bottom: 8px;
  height: 22px; border-radius: 6px; background: rgba(0,0,0,0.7); color: #fff;
  display: flex; align-items: center; justify-content: center; gap: 4px;
  font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.pic .countdown.amber { background: var(--color-amber); }
.pic .countdown.red { background: var(--color-red); animation: shake 800ms ease infinite; }
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-1px); }
  75% { transform: translateX(1px); }
}
.pic .countdown svg { width: 11px; height: 11px; }
.info { display: flex; flex-direction: column; min-width: 0; }
.info .cat { font-size: 10px; letter-spacing: 0.08em; color: var(--color-text-weak); font-weight: 600; text-transform: uppercase; }
.info .name { margin-top: 2px; font-size: 16px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.info .spec { margin-top: 4px; font-size: 12px; color: var(--color-text-weak); font-weight: 500; }
.info .price { margin-top: 6px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.info .price .orig { font-size: 12px; color: var(--color-text-weak); text-decoration: line-through; }
.info .price .sale { font-size: 22px; font-weight: 900; letter-spacing: -0.02em; color: var(--color-text-strong); }
.info .price .sale .won { font-size: 13px; font-weight: 800; margin-left: 1px; }
.info .price .off { font-size: 13px; font-weight: 800; color: var(--color-discount); }
.info .extra { margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--color-text-weak); font-weight: 600; }
.progress { margin-top: 12px; display: flex; flex-direction: column; gap: 5px; }
.progress .lbl { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; color: var(--color-text-weak); }
.progress .lbl b { color: var(--color-discount); font-weight: 800; }
.progress .bar { height: 6px; border-radius: 6px; background: #F1F1F1; overflow: hidden; position: relative; }
.progress .bar .fill { position: absolute; inset: 0; width: var(--sold, 0%); background: linear-gradient(90deg, var(--color-primary), var(--color-accent)); border-radius: 6px; transition: width 800ms cubic-bezier(0.4, 0.7, 0.2, 1); }
.progress .bar.hot .fill { background: linear-gradient(90deg, #F59E0B, var(--color-discount)); }
.actions { margin-top: 12px; display: grid; grid-template-columns: auto auto 1fr; gap: 8px; align-items: center; }
.iconbtn { height: 38px; padding: 0 12px; border-radius: 10px; background: #F4F4F5; border: 0; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--color-text-strong); cursor: pointer; position: relative; }
.iconbtn svg { width: 16px; height: 16px; }
.iconbtn.liked .heart-stroke { stroke: var(--color-discount); fill: var(--color-discount); }
.iconbtn.pop .heart { animation: heartPop 600ms var(--motion-spring); }
@keyframes heartPop {
  0% { transform: scale(0.6); }
  40% { transform: scale(1.4); }
  100% { transform: scale(1); }
}
.actions .cta { height: 38px; border-radius: 10px; background: var(--color-text-strong); color: #fff; border: 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; font-weight: 800; letter-spacing: -0.01em; cursor: pointer; }
.actions .cta svg { width: 14px; height: 14px; }
.actions .cta.added { background: var(--color-primary); }
.toast { position: fixed; bottom: 24px; left: 50%; transform: translate(-50%, 30px); padding: 12px 16px; border-radius: 999px; background: rgba(23,23,23,0.94); color: #fff; font-size: 13px; font-weight: 600; opacity: 0; pointer-events: none; z-index: 80; transition: opacity 200ms, transform 200ms; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
@media (prefers-reduced-motion: reduce) {
  .card.urgent, .pic .countdown.red, .topbar .row1 .pulse { animation: none; }
  .iconbtn.pop .heart { animation: none; }
}
</style>
</head>
<body>
<header class="topbar">
  <div class="row1"><span class="pulse"></span>LIVE · 오늘의 핫딜 · ${esc(d.storeName)}</div>
  <h1>
    <span>지금만 이 가격</span>
    <span class="count" id="cdTop"><span id="h">00</span><span class="sep">:</span><span id="m">00</span><span class="sep">:</span><span id="s">00</span></span>
  </h1>
  <div class="sub" id="topSub">${esc(d.period)} · 카드 ${total}장</div>
</header>
<nav class="chips" aria-label="카테고리">
  <div class="chips-scroll">${chipsHtml}</div>
</nav>
<div class="sort">
  <div class="opts">
    <span class="opt active" data-sort="ends">마감순</span>
    <span class="opt" data-sort="disc">할인율순</span>
    <span class="opt" data-sort="price">가격순</span>
  </div>
  <div class="total"><b id="totalCount">${total}</b>개 행사 중</div>
</div>
<main class="feed" id="feed"></main>
<div class="toast" id="toast">담음</div>
<script>
(function(){
  var DEALS = ${dealsJson};
  if (!DEALS || DEALS.length === 0) return;
  var feed = document.getElementById('feed');
  var min = 60000, hour = 3600000;
  function fmt(n){ return (n||0).toLocaleString('ko-KR'); }
  function pct(o, s){ return o > 0 ? Math.round((1 - s/o) * 100) : 0; }
  function pad(n){ return String(n).padStart(2, '0'); }
  function dStr(ms){
    if (ms <= 0) return '00:00:00';
    var tot = Math.floor(ms / 1000);
    var h = Math.floor(tot / 3600);
    var m = Math.floor((tot % 3600) / 60);
    var s = tot % 60;
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }
  function band(ms){
    if (ms <= 10 * min) return 'red';
    if (ms <= 60 * min) return 'amber';
    return 'default';
  }
  function escHtml(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function buildCard(deal, i) {
    var off = pct(deal.originalPrice, deal.salePrice);
    var card = document.createElement('article');
    card.className = 'card';
    card.dataset.endsAt = deal.endsAt;
    card.dataset.soldPct = deal.soldPct;
    card.dataset.cat = deal.cat;
    card.dataset.price = deal.salePrice;
    card.dataset.disc = off;
    card.style.setProperty('--sold', deal.soldPct + '%');
    card.setAttribute('data-product', JSON.stringify({ name: deal.name, originalPrice: deal.originalPrice, salePrice: deal.salePrice, imageUrl: deal.imageUrl, unit: deal.unit, category: deal.cat }));

    var picHtml = '';
    if (deal.imageUrl) {
      picHtml = '<img class="ph-img" src="' + escHtml(deal.imageUrl) + '" alt="' + escHtml(deal.name) + '">';
    } else {
      picHtml = '<div class="ph" style="background:' + deal.bg + '"><span class="ph-emoji">' + deal.emoji + '</span></div>';
    }
    var stickerCls = deal.limit > 0 && deal.limit <= 20 ? 'stickerBadge hot' : 'stickerBadge';
    var stickerTxt = deal.limit > 0 ? '한정 ' + deal.limit : '핫딜';
    var origHtml = deal.originalPrice > 0
      ? '<div class="price"><span class="orig price-num">' + fmt(deal.originalPrice) + '원</span></div>'
      : '';
    var extra = deal.cardDiscount && deal.cardDiscount !== '—'
      ? '<span class="extra">' + escHtml(deal.cardDiscount) + '</span>'
      : '';
    var soldTxt = deal.limit > 0
      ? '잔여 ' + Math.max(0, deal.limit - Math.round(deal.limit * deal.soldPct / 100)) + '개 · 한정 ' + deal.limit + '개'
      : '진행 중';

    card.innerHTML =
      '<div class="top">' +
        '<div class="pic">' + picHtml +
          '<span class="' + stickerCls + '">' + escHtml(stickerTxt) + '</span>' +
          '<div class="countdown" data-cd>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M10 3h4"/></svg>' +
            '<span data-cd-text>00:00:00</span>' +
          '</div>' +
        '</div>' +
        '<div class="info">' +
          '<div class="cat">' + escHtml(deal.cat) + ' · #' + (i+1) + '</div>' +
          '<div class="name">' + escHtml(deal.name) + '</div>' +
          '<div class="spec">' + escHtml((deal.unit || '') + (deal.origin ? ' · ' + deal.origin : '')) + '</div>' +
          origHtml +
          '<div class="price">' +
            '<span class="sale price-num">' + fmt(deal.salePrice) + '<span class="won">원</span></span>' +
            (off > 0 ? '<span class="off">' + off + '%↓</span>' : '') +
          '</div>' +
          extra +
        '</div>' +
      '</div>' +
      '<div class="progress">' +
        '<div class="lbl"><span>' + soldTxt + '</span><b>' + deal.soldPct + '% 판매</b></div>' +
        '<div class="bar' + (deal.soldPct >= 70 ? ' hot' : '') + '"><div class="fill"></div></div>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="iconbtn like" data-likes="' + deal.likes + '">' +
          '<svg class="heart" viewBox="0 0 24 24" fill="none"><path class="heart-stroke" stroke="currentColor" stroke-width="2" d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>' +
          '<span class="lcount">' + deal.likes + '</span>' +
        '</button>' +
        '<button class="iconbtn share">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
          '<span>공유</span>' +
        '</button>' +
        '<button class="cta add">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 7h14l-1.5 11a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8L5 7zM9 7V5a3 3 0 0 1 6 0v2"/></svg>' +
          '담기' +
        '</button>' +
      '</div>';
    return card;
  }

  DEALS.forEach(function(d, i){ feed.appendChild(buildCard(d, i)); });

  requestAnimationFrame(function(){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.card').forEach(function(c){ io.observe(c); });
    var cards = document.querySelectorAll('.card');
    for (var i = 0; i < Math.min(4, cards.length); i++) {
      (function(c, idx){ setTimeout(function(){ c.classList.add('in'); }, 80 * idx); })(cards[i], i);
    }
  });

  function tick() {
    var now = Date.now();
    document.querySelectorAll('.card').forEach(function(card){
      var endsAt = +card.dataset.endsAt;
      var ms = endsAt - now;
      var txt = card.querySelector('[data-cd-text]');
      var cd = card.querySelector('.countdown');
      if (!txt || !cd) return;
      txt.textContent = dStr(ms);
      cd.classList.remove('amber', 'red');
      var b = band(ms);
      if (b === 'amber') cd.classList.add('amber');
      if (b === 'red') cd.classList.add('red');
      card.classList.toggle('urgent', b === 'red');
    });
    var next = DEALS.reduce(function(acc, dd){ return Math.min(acc, dd.endsAt); }, Infinity) - now;
    var totSec = Math.max(0, Math.floor(next / 1000));
    document.getElementById('h').textContent = pad(Math.floor(totSec / 3600));
    document.getElementById('m').textContent = pad(Math.floor((totSec % 3600) / 60));
    document.getElementById('s').textContent = pad(totSec % 60);
    var sortedDeals = DEALS.slice().sort(function(a,b){ return a.endsAt - b.endsAt; });
    if (sortedDeals[0]) {
      document.getElementById('topSub').textContent = '다음 마감 임박: ' + sortedDeals[0].name;
    }
  }
  tick();
  setInterval(tick, 1000);

  // chips filter
  document.querySelectorAll('.chip').forEach(function(ch){
    ch.addEventListener('click', function(){
      document.querySelectorAll('.chip').forEach(function(c){ c.classList.remove('active'); });
      ch.classList.add('active');
      var cat = ch.dataset.cat || '';
      var shown = 0;
      document.querySelectorAll('.card').forEach(function(card){
        if (!cat || card.dataset.cat === cat) { card.classList.remove('hide'); shown++; }
        else card.classList.add('hide');
      });
      document.getElementById('totalCount').textContent = shown;
    });
  });

  // sort
  document.querySelectorAll('.sort .opt').forEach(function(o){
    o.addEventListener('click', function(){
      document.querySelectorAll('.sort .opt').forEach(function(c){ c.classList.remove('active'); });
      o.classList.add('active');
      var mode = o.dataset.sort;
      var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
      cards.sort(function(a, b){
        if (mode === 'ends') return +a.dataset.endsAt - +b.dataset.endsAt;
        if (mode === 'disc') return +b.dataset.disc - +a.dataset.disc;
        return +a.dataset.price - +b.dataset.price;
      });
      cards.forEach(function(c){ feed.appendChild(c); });
    });
  });

  // actions
  document.addEventListener('click', function(ev){
    var like = ev.target.closest('.like');
    var share = ev.target.closest('.share');
    var add = ev.target.closest('.add');
    if (like) {
      var liked = like.classList.toggle('liked');
      like.classList.add('pop');
      setTimeout(function(){ like.classList.remove('pop'); }, 800);
      var span = like.querySelector('.lcount');
      var n = parseInt(span.textContent, 10) || 0;
      span.textContent = (n + (liked ? 1 : -1));
    } else if (share) {
      var card = share.closest('.card');
      var name = card.querySelector('.name').textContent;
      if (navigator.share) {
        navigator.share({ title: name, text: name + ' 핫딜!', url: location.href }).catch(function(){});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(location.href);
        showToast('공유 링크 복사됨');
      }
    } else if (add) {
      var c2 = add.closest('.card');
      var n2 = c2.querySelector('.name').textContent;
      add.classList.add('added');
      add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4L19 7"/></svg>담음';
      showToast(n2 + ' 담음');
    }
  });

  var toastTimer = null;
  function showToast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 1700);
  }

  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev){
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });
})();
</script>
</body>
</html>`;
}
/**
 * ★ GRID HERO 엔진 — Claude Design 04-grid-hero.html 동적 변환 (D154 PHASE 0 트랙 A)
 *
 * 마켓컬리 메인 패턴. Hero 캐러셀(자동 3.8초) + sticky 카테고리 칩 + 2x2 그리드 + 단가 자동 계산 +
 * 카드 long-press 미리보기 모달 + 하단 sticky 장바구니 바.
 */
export function renderGridHeroEngine(d: FlyerRenderData, token: SeasonToken): string {
  const tokenInfo = SEASON_TOKENS[token];
  const items = flattenItems(d);
  const ogTitle = d.storeName + ' · ' + d.title;
  const ogDesc = '이번 주 진짜 싸요 — 위클리 행사 메인 · ' + items.length + '개 상품';
  const ogImage = buildOgImageUrl(d, token);

  // FEATURED 자동 선정: 카테고리별 첫 상품 순회 최대 4개
  const featured: Array<FlyerRenderItem & { category: string; slogan: string }> = [];
  for (const cat of d.categories) {
    for (const item of cat.items) {
      const headline = categoryHeadline(cat.name).replace(/<br>/g, '<br>');
      featured.push({ ...item, category: cat.name, slogan: headline });
      if (featured.length >= 4) break;
    }
    if (featured.length >= 4) break;
  }
  // 부족 시 평탄 상품으로 보충 (최소 1개 보장)
  if (featured.length === 0 && items.length > 0) {
    featured.push({ ...items[0], slogan: d.title });
  }

  // CATEGORIES SSR (h2 + lede + grid 2x2)
  const categoriesData = d.categories.map(cat => ({
    name: cat.name,
    lede: categoryDescription(cat.name),
    items: cat.items.map(it => ({
      name: it.name,
      originalPrice: it.originalPrice,
      salePrice: it.salePrice,
      badge: it.badge || '',
      unit: it.unit || '',
      origin: it.origin || '',
      cardDiscount: it.cardDiscount || '',
      aiCopy: it.aiCopy || '',
      imageUrl: toAbsUrl(it.imageUrl || '') || '',
      bg: categoryBg(cat.name),
      emoji: categoryPictogram(cat.name),
      // ★ 2026-08-20 계급 판정은 서버(CT-F24) 한 곳 — 화면은 문자열 소비만(13번 설계 §4)
      nmc: nameSizeClass(it.name),
      prc: priceScaleClass(it.salePrice),
    })),
  }));
  const categoriesJson = JSON.stringify(categoriesData).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');

  const featuredData = featured.map(f => ({
    name: f.name,
    originalPrice: f.originalPrice,
    salePrice: f.salePrice,
    unit: f.unit || '',
    imageUrl: toAbsUrl(f.imageUrl || '') || '',
    bg: categoryBg(f.category),
    emoji: categoryPictogram(f.category),
    slogan: f.slogan,
    prc: priceScaleClass(f.salePrice),
  }));
  const featuredJson = JSON.stringify(featuredData).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');

  // 상단 promo (announcements 첫 항목 또는 디폴트)
  const promoAnn = (d.announcements || [])[0];
  const promoTitle = promoAnn ? promoAnn.title : '매장 방문 인증하면 쿠폰 받기';
  const promoSub = promoAnn ? promoAnn.content : '이번 행사 기간 · 1인 1회 한정';

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #F97316;
  --color-accent: #EF4444;
  --color-on-primary: #FFFFFF;
  --color-text-strong: #171717;
  --color-text-weak: #6B7280;
  --color-bg: #FFFFFF;
  --color-soft: #F7F7F5;
  --color-rule: #ECECEA;
  --color-discount: #DC2626;
  --shadow-card: 0 1px 0 rgba(0,0,0,0.04), 0 6px 20px -10px rgba(0,0,0,0.10);
  --shadow-lift: 0 12px 32px -8px rgba(0,0,0,0.16);
  --motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
${seasonStyleBlock()}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--color-bg); color: var(--color-text-strong); }
body { font-family: 'Pretendard Variable', sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 88px; }
button { font-family: inherit; }
.price-num { font-variant-numeric: tabular-nums; }
.topbar { position: sticky; top: 0; z-index: 40; height: 56px; background: rgba(255,255,255,0.92); backdrop-filter: blur(14px); border-bottom: 1px solid var(--color-rule); display: flex; align-items: center; padding: 0 8px; }
.topbar .menu, .topbar .iconbtn { width: 40px; height: 40px; border: 0; background: transparent; color: var(--color-text-strong); display: grid; place-items: center; cursor: pointer; }
.topbar svg { width: 22px; height: 22px; }
.topbar .title { flex: 1; text-align: left; padding: 0 4px; display: flex; align-items: center; gap: 8px; min-width: 0; }
.topbar .title .crest { width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, var(--color-primary), var(--color-accent)); display: grid; place-items: center; color: #fff; font-size: 12px; font-weight: 800; flex-shrink: 0; }
.topbar .title strong { font-size: 15px; font-weight: 800; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar .title span { font-size: 11px; color: var(--color-text-weak); margin-left: 6px; }
.topbar .right { display: flex; }
.hero { position: relative; overflow: hidden; height: 56vh; min-height: 420px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent) 100%); color: var(--color-on-primary); }
.hero::before { content: ""; position: absolute; inset: 0; background-image: radial-gradient(circle at 20% 100%, rgba(255,255,255,0.16), transparent 40%), radial-gradient(circle at 100% 20%, rgba(0,0,0,0.18), transparent 40%); }
.hero .grain { position: absolute; inset: 0; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.4 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); opacity: 0.08; mix-blend-mode: overlay; pointer-events: none; }
.hero .frame { position: absolute; inset: 0; padding: 24px 20px; display: flex; flex-direction: column; }
.hero .ribbon { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: rgba(0,0,0,0.18); backdrop-filter: blur(6px); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; }
.hero .ribbon .dot { width: 6px; height: 6px; border-radius: 50%; background: #fff; }
.hero .productimg { position: absolute; right: -20px; top: 12%; width: 220px; height: 220px; border-radius: 24px; transform: rotate(-6deg); box-shadow: 0 24px 60px -8px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.2); overflow: hidden; transition: transform 540ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.hero .productimg img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hero .productimg .ph { position: absolute; inset: 0; display: grid; place-items: center; }
.hero .productimg .ph-emoji { font-size: 140px; line-height: 1; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.25)); }
.hero .copy { position: absolute; left: 22px; right: 22px; bottom: 92px; display: flex; flex-direction: column; gap: 8px; transition: opacity 360ms ease; }
.hero .copy .slogan { font-size: 38px; font-weight: 900; letter-spacing: -0.04em; line-height: 0.95; text-shadow: 0 2px 12px rgba(0,0,0,0.18); max-width: 280px; }
.hero .copy .pname { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; opacity: 0.95; }
.hero .copy .priceline { display: flex; align-items: baseline; gap: 8px; margin-top: 2px; flex-wrap: wrap; }
.hero .copy .priceline .orig { font-size: 14px; opacity: 0.7; text-decoration: line-through; }
.hero .copy .priceline .sale { font-size: 34px; font-weight: 900; letter-spacing: -0.03em; }
.hero .copy .priceline .sale .won { font-size: 18px; font-weight: 800; margin-left: 1px; }
.hero .heroCTA { position: absolute; left: 20px; right: 20px; bottom: 36px; height: 50px; border: 0; border-radius: 14px; background: rgba(0,0,0,0.92); color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 16px 0 18px; font-size: 15px; font-weight: 800; letter-spacing: -0.01em; cursor: pointer; }
.hero .heroCTA .right { display: flex; align-items: center; gap: 4px; }
.hero .heroCTA svg { width: 16px; height: 16px; }
.hero .dots { position: absolute; left: 20px; bottom: 14px; display: flex; gap: 4px; }
.hero .dots .d { width: 18px; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.4); }
.hero .dots .d.active { background: #fff; }
.catnav { position: sticky; top: 56px; z-index: 30; background: rgba(255,255,255,0.95); backdrop-filter: blur(12px); border-bottom: 1px solid var(--color-rule); }
.catnav-scroll { display: flex; gap: 0; padding: 4px 8px; overflow-x: auto; scrollbar-width: none; }
.catnav-scroll::-webkit-scrollbar { display: none; }
.catnav .chip { flex: 0 0 auto; padding: 12px 14px; background: transparent; border: 0; font-size: 14px; font-weight: 600; color: var(--color-text-weak); letter-spacing: -0.01em; position: relative; cursor: pointer; }
.catnav .chip.active { color: var(--color-text-strong); font-weight: 800; }
.catnav .chip.active::after { content: ""; position: absolute; left: 14px; right: 14px; bottom: 4px; height: 2px; border-radius: 2px; background: var(--color-text-strong); }
.cat-section { padding: 24px 16px 8px; scroll-margin-top: 110px; }
.cat-section h2 { display: flex; align-items: baseline; gap: 8px; font-size: 20px; font-weight: 800; letter-spacing: -0.025em; }
.cat-section h2 small { font-size: 12px; font-weight: 600; color: var(--color-text-weak); letter-spacing: 0; }
.cat-section .seemore { margin-left: auto; font-size: 12px; color: var(--color-text-weak); font-weight: 600; background: transparent; border: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 2px; }
.cat-section .seemore svg { width: 12px; height: 12px; }
.cat-section .lede { font-size: 13px; color: var(--color-text-weak); margin-top: 4px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
.pcard { display: flex; flex-direction: column; border-radius: 14px; background: #fff; position: relative; transition: transform 200ms ease; }
.pcard:active { transform: scale(0.98); }
.pic { position: relative; aspect-ratio: 1/1; border-radius: 14px; overflow: hidden; background: var(--color-soft); }
.pic .ph-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pic .ph { position: absolute; inset: 0; display: grid; place-items: center; }
.pic .ph-emoji { font-size: 80px; line-height: 1; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.15)); }
.pic .b1 { position: absolute; top: 8px; left: 8px; padding: 4px 8px; border-radius: 6px; background: var(--color-discount); color: #fff; font-size: 11px; font-weight: 800; letter-spacing: -0.01em; }
.pic .b1.tag { background: var(--color-text-strong); }
.pic .b2 { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.9); border: 0; display: grid; place-items: center; color: var(--color-text-strong); cursor: pointer; }
.pic .b2 svg { width: 14px; height: 14px; }
.pinfo { padding: 10px 4px 0; display: flex; flex-direction: column; gap: 2px; }
.pinfo .nm { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 35px; }
.pinfo .unitPrice { font-size: 11px; color: var(--color-text-weak); font-weight: 500; }
.pinfo .pricerow { display: flex; align-items: baseline; gap: 6px; margin-top: 2px; }
.pinfo .off { font-size: 13px; font-weight: 800; color: var(--color-discount); }
.pinfo .sale { font-size: 17px; font-weight: 900; letter-spacing: -0.02em; }
.pinfo .sale .won { font-size: 12px; font-weight: 800; }
.pinfo .orig { font-size: 11px; color: var(--color-text-weak); text-decoration: line-through; }
.pinfo .meta { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.pinfo .meta .pill { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--color-soft); color: var(--color-text-weak); font-weight: 600; }
/* ★ 2026-08-20 이름·가격 계급(13번 설계 §4-3·§4-4) */
.pinfo .nm.nm-m { font-size: 13px; }
.pinfo .nm.nm-l { font-size: 12px; letter-spacing: -0.02em; }
.pinfo .sale.pr-m { font-size: 16px; }
.pinfo .sale.pr-l { font-size: 15px; letter-spacing: -0.03em; }
.hero .copy .priceline .sale.pr-l { font-size: 28px; }
/* ★ 무이미지 스펙 조판 슬랩 */
.pic .slab-ph { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.pic .slab-ph .slab-picto { font-size: 44px; line-height: 1; }
.pic .slab-ph .slab-l1 { font-size: 15px; font-weight: 900; color: rgba(255,255,255,0.95); letter-spacing: -0.01em; }
.pic .slab-ph .slab-l2 { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.72); }
.pcard .addbtn { position: absolute; right: 6px; bottom: 90px; width: 32px; height: 32px; border-radius: 50%; border: 0; background: var(--color-text-strong); color: #fff; box-shadow: 0 4px 10px rgba(0,0,0,0.18); cursor: pointer; z-index: 2; }
.pcard .addbtn svg { width: 16px; height: 16px; }
.pcard .addbtn.added { background: var(--color-primary); }
.pcard.popping .addbtn { animation: addPop 600ms var(--motion-spring); }
@keyframes addPop { 0% { transform: scale(1); } 40% { transform: scale(1.25); } 100% { transform: scale(1); } }
.promo { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; margin: 22px 16px 0; padding: 14px 16px; background: rgba(249, 115, 22, 0.08); border-radius: 16px; border: 1px solid rgba(249, 115, 22, 0.25); }
.promo .ic { width: 36px; height: 36px; border-radius: 50%; background: var(--color-primary); color: var(--color-on-primary); display: grid; place-items: center; font-weight: 800; font-size: 16px; }
.promo .t { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.promo .t .h { font-size: 13px; font-weight: 800; letter-spacing: -0.01em; }
.promo .t .s { font-size: 11px; color: var(--color-text-weak); font-weight: 600; }
.promo .go { font-size: 12px; font-weight: 700; padding: 6px 10px; border-radius: 999px; background: var(--color-text-strong); color: #fff; border: 0; cursor: pointer; }
.modal-scrim { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.5); opacity: 0; pointer-events: none; transition: opacity 200ms; }
.modal-scrim.show { opacity: 1; pointer-events: auto; }
.modal { position: fixed; left: 16px; right: 16px; top: 50%; transform: translateY(-50%) scale(0.96); z-index: 61; background: #fff; border-radius: 22px; padding: 16px; box-shadow: var(--shadow-lift); opacity: 0; pointer-events: none; transition: opacity 220ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1); max-height: 80vh; overflow-y: auto; }
.modal.show { opacity: 1; transform: translateY(-50%) scale(1); pointer-events: auto; }
.modal .pic { aspect-ratio: 4/3; }
.modal .pname { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin-top: 14px; }
.modal .aiCopy { font-size: 13px; color: var(--color-text-weak); margin-top: 6px; line-height: 1.5; }
.modal .ms { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
.modal .ms .c { padding: 10px 12px; background: var(--color-soft); border-radius: 10px; }
.modal .ms .c .k { font-size: 11px; color: var(--color-text-weak); }
.modal .ms .c .v { font-size: 14px; font-weight: 700; margin-top: 2px; }
.modal .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
.modal .btns button { height: 46px; border-radius: 12px; border: 0; font-size: 14px; font-weight: 700; cursor: pointer; }
.modal .btns .b1 { background: var(--color-soft); color: var(--color-text-strong); }
.modal .btns .b2 { background: var(--color-primary); color: var(--color-on-primary); }
.bottombar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px)); background: rgba(255,255,255,0.96); backdrop-filter: blur(14px); border-top: 1px solid var(--color-rule); }
.bottombar .bar { height: 56px; border-radius: 14px; background: var(--color-text-strong); color: #fff; display: flex; align-items: center; padding: 0 14px 0 16px; gap: 12px; cursor: pointer; }
.bottombar .badge { width: 26px; height: 26px; border-radius: 50%; background: var(--color-primary); color: var(--color-on-primary); display: grid; place-items: center; font-weight: 800; font-size: 13px; font-variant-numeric: tabular-nums; }
.bottombar .lbl { display: flex; flex-direction: column; min-width: 0; }
.bottombar .lbl .a { font-size: 15px; font-weight: 800; }
.bottombar .lbl .b { font-size: 11px; opacity: 0.7; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bottombar .arrow { margin-left: auto; opacity: 0.9; }
.bottombar .arrow svg { width: 18px; height: 18px; }
.toast { position: fixed; bottom: 86px; left: 50%; transform: translate(-50%, 30px); padding: 10px 14px; border-radius: 999px; background: rgba(23,23,23,0.92); color: #fff; font-size: 13px; font-weight: 600; opacity: 0; pointer-events: none; z-index: 70; transition: opacity 180ms, transform 180ms; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
@media (prefers-reduced-motion: reduce) { .pcard.popping .addbtn { animation: none; } }
</style>
</head>
<body>
<header class="topbar">
  <button class="menu" aria-label="메뉴"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  <div class="title">
    <div class="crest">${esc(storeInitial(d.storeName))}</div>
    <strong>${esc(d.storeName)}</strong>
  </div>
  <div class="right">
    <button class="iconbtn" aria-label="검색"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></button>
    <button class="iconbtn" aria-label="찜"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg></button>
  </div>
</header>
<section class="hero" id="hero">
  <div class="grain"></div>
  <div class="frame">
    <span class="ribbon"><span class="dot"></span>${esc(d.title)} · ${esc(d.period)}</span>
  </div>
  <div class="productimg" id="heroPic"></div>
  <div class="copy" id="heroCopy">
    <div class="slogan" id="heroSlogan">${esc(d.title)}</div>
    <div class="pname" id="heroName">—</div>
    <div class="priceline">
      <span class="orig price-num" id="heroOrig">—</span>
      <span class="sale price-num" id="heroSale">—</span>
    </div>
  </div>
  <div class="dots" id="heroDots"></div>
  <button class="heroCTA">
    <span>지금 보러가기</span>
    <span class="right">
      <span style="font-weight:700;font-size:13px;opacity:0.7;" id="heroIdx">1/1</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
    </span>
  </button>
</section>
<nav class="catnav" aria-label="카테고리">
  <div class="catnav-scroll" id="catnav"></div>
</nav>
<main id="main"></main>
<aside class="promo">
  <div class="ic">★</div>
  <div class="t">
    <div class="h">${esc(promoTitle)}</div>
    <div class="s">${esc(promoSub)}</div>
  </div>
  <button class="go">받기</button>
</aside>
<div class="modal-scrim" id="scrim"></div>
<aside class="modal" id="modal" role="dialog" aria-modal="true">
  <div class="pic"><div class="ph" id="mPh"></div></div>
  <h3 class="pname" id="mName">—</h3>
  <p class="aiCopy" id="mCopy">—</p>
  <div class="ms">
    <div class="c"><div class="k">단위</div><div class="v" id="mUnit">—</div></div>
    <div class="c"><div class="k">원산지</div><div class="v" id="mOrigin">—</div></div>
    <div class="c"><div class="k">단가</div><div class="v" id="mUnitP">—</div></div>
    <div class="c"><div class="k">카드 할인</div><div class="v" id="mCard">—</div></div>
  </div>
  <div class="btns">
    <button class="b1" id="mClose">닫기</button>
    <button class="b2" id="mAdd">담기</button>
  </div>
</aside>
<div class="bottombar">
  <div class="bar">
    <div class="badge" id="cartCount">0</div>
    <div class="lbl">
      <div class="a">장바구니 보기</div>
      <div class="b" id="cartSub">담은 상품 없음</div>
    </div>
    <div class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></div>
  </div>
</div>
<div class="toast" id="toast">담음</div>
<script>
(function(){
  var CATEGORIES = ${categoriesJson};
  var FEATURED = ${featuredJson};
  if (!CATEGORIES || CATEGORIES.length === 0) return;

  function fmt(n){ return (n||0).toLocaleString('ko-KR'); }
  function pct(o, s){ return o > 0 ? Math.round((1 - s/o) * 100) : 0; }
  function escHtml(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function unitPrice(item) {
    var u = (item.unit || '').toLowerCase().trim();
    var m = u.match(/^([\\d.]+)\\s*(kg|g|l|ml|미|개|박스)/);
    if (!m) return null;
    var num = parseFloat(m[1]);
    var u2 = m[2];
    var denom = 0, base = '';
    if (u2 === 'kg') { denom = num * 1000; base = '100g당'; }
    else if (u2 === 'g')  { denom = num; base = '100g당'; }
    else if (u2 === 'l')  { denom = num * 1000; base = '100ml당'; }
    else if (u2 === 'ml') { denom = num; base = '100ml당'; }
    else if (u2 === '미') { denom = num; base = '미당'; }
    else if (u2 === '개') { denom = num; base = '개당'; }
    else if (u2 === '박스') return null;
    if (!denom) return null;
    if (base === '100g당' || base === '100ml당') {
      return base + ' ' + fmt(Math.round(item.salePrice / denom * 100)) + '원';
    }
    return base + ' ' + fmt(Math.round(item.salePrice / denom)) + '원';
  }

  function buildPic(it) {
    if (it.imageUrl) return '<img class="ph-img" src="' + escHtml(it.imageUrl) + '" alt="' + escHtml(it.name) + '">';
    // ★ 2026-08-20 무이미지 = 스펙 조판 슬랩(13번 설계 §4-1) — 폴백이 아니라 1급 비주얼
    var l1 = it.origin || '';
    var l2 = it.unit || '';
    return '<div class="ph slab-ph" style="background:' + it.bg + '">' +
      '<span class="slab-picto">' + it.emoji + '</span>' +
      (l1 ? '<span class="slab-l1">' + escHtml(l1) + '</span>' : '') +
      (l2 ? '<span class="slab-l2">' + escHtml(l2) + '</span>' : '') +
    '</div>';
  }

  var catnav = document.getElementById('catnav');
  var main = document.getElementById('main');

  CATEGORIES.forEach(function(cat, ci){
    var chip = document.createElement('button');
    chip.className = 'chip' + (ci === 0 ? ' active' : '');
    chip.textContent = cat.name;
    chip.dataset.target = 'cat-' + ci;
    chip.addEventListener('click', function(){
      var t = document.getElementById(chip.dataset.target);
      if (t) {
        var top = t.getBoundingClientRect().top + window.scrollY - 110;
        window.scrollTo({ top: top, behavior: 'smooth' });
      }
    });
    catnav.appendChild(chip);

    var sec = document.createElement('section');
    sec.className = 'cat-section';
    sec.id = 'cat-' + ci;
    var h2 = '<h2>' + escHtml(cat.name) + ' <small>' + cat.items.length + '</small><button class="seemore">전체 보기 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button></h2>';
    var lede = '<div class="lede">' + escHtml(cat.lede) + '</div>';
    sec.innerHTML = h2 + lede + '<div class="grid"></div>';
    var grid = sec.querySelector('.grid');

    cat.items.forEach(function(it){
      var card = document.createElement('article');
      card.className = 'pcard';
      card.setAttribute('data-product', JSON.stringify({ name: it.name, originalPrice: it.originalPrice, salePrice: it.salePrice, imageUrl: it.imageUrl, unit: it.unit, category: cat.name }));
      var up = unitPrice(it);
      var disc = pct(it.originalPrice, it.salePrice);
      var badgeTag = (it.badge && (it.badge.indexOf('한정') >= 0 || it.badge.indexOf('1+1') >= 0)) ? ' tag' : '';
      var badgeHtml = it.badge ? '<span class="b1' + badgeTag + '">' + escHtml(it.badge) + '</span>' : (disc > 0 ? '<span class="b1">' + disc + '%</span>' : '');
      var origHtml = it.originalPrice > 0 ? '<div class="orig price-num">' + fmt(it.originalPrice) + '원</div>' : '';
      var metaHtml = '';
      if (it.unit) metaHtml += '<span class="pill">' + escHtml(it.unit) + '</span>';
      if (it.origin) metaHtml += '<span class="pill">' + escHtml(it.origin) + '</span>';
      if (it.cardDiscount) metaHtml += '<span class="pill" style="background:rgba(249,115,22,0.12);color:var(--color-primary);">+카드</span>';

      card.innerHTML =
        '<div class="pic">' + buildPic(it) +
          badgeHtml +
          '<button class="b2" aria-label="찜"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg></button>' +
        '</div>' +
        '<button class="addbtn" aria-label="담기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>' +
        '<div class="pinfo">' +
          '<div class="nm ' + (it.nmc || '') + '">' + escHtml(it.name) + '</div>' +
          (up ? '<div class="unitPrice">' + escHtml(up) + '</div>' : '') +
          '<div class="pricerow">' +
            (disc > 0 ? '<span class="off">' + disc + '%</span>' : '') +
            '<span class="sale price-num ' + (it.prc || '') + '">' + fmt(it.salePrice) + '<span class="won">원</span></span>' +
          '</div>' +
          origHtml +
          (metaHtml ? '<div class="meta">' + metaHtml + '</div>' : '') +
        '</div>';

      var lpTimer = null;
      card.addEventListener('pointerdown', function(){ lpTimer = setTimeout(function(){ openModal(it, cat.name); }, 500); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(ev){ card.addEventListener(ev, function(){ if (lpTimer) clearTimeout(lpTimer); }); });
      card.querySelector('.addbtn').addEventListener('click', function(e){
        e.stopPropagation();
        card.classList.add('popping');
        var btn = card.querySelector('.addbtn');
        btn.classList.add('added');
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4L19 7"/></svg>';
        setTimeout(function(){ card.classList.remove('popping'); }, 600);
        addToCart(it);
      });

      grid.appendChild(card);
    });

    main.appendChild(sec);
  });

  // Hero carousel
  var dotsEl = document.getElementById('heroDots');
  FEATURED.forEach(function(f, i){
    var d = document.createElement('span');
    d.className = 'd' + (i === 0 ? ' active' : '');
    dotsEl.appendChild(d);
  });

  var heroIdx = 0;
  function showHero(i) {
    if (FEATURED.length === 0) return;
    heroIdx = (i + FEATURED.length) % FEATURED.length;
    var f = FEATURED[heroIdx];
    document.getElementById('heroPic').innerHTML = buildPic(f);
    document.getElementById('heroSlogan').innerHTML = f.slogan;
    document.getElementById('heroName').textContent = f.name + (f.unit ? ' · ' + f.unit : '');
    document.getElementById('heroOrig').textContent = f.originalPrice > 0 ? fmt(f.originalPrice) + '원' : '';
    var hs = document.getElementById('heroSale');
    hs.className = 'sale ' + (f.prc || '');
    hs.innerHTML = fmt(f.salePrice) + '<span class="won">원</span>';
    document.getElementById('heroIdx').textContent = (heroIdx + 1) + '/' + FEATURED.length;
    dotsEl.querySelectorAll('.d').forEach(function(d, j){ d.classList.toggle('active', j === heroIdx); });
    document.getElementById('heroCopy').style.opacity = '0';
    document.getElementById('heroPic').style.transform = 'rotate(-6deg) translateX(20px)';
    requestAnimationFrame(function(){
      document.getElementById('heroCopy').style.opacity = '1';
      document.getElementById('heroPic').style.transform = 'rotate(-6deg) translateX(0)';
    });
  }
  showHero(0);
  var heroTimer = null;
  if (FEATURED.length > 1) {
    heroTimer = setInterval(function(){ showHero(heroIdx + 1); }, 3800);
    document.getElementById('hero').addEventListener('click', function(){
      showHero(heroIdx + 1);
      if (heroTimer) clearInterval(heroTimer);
      heroTimer = setInterval(function(){ showHero(heroIdx + 1); }, 3800);
    });
  }

  // Cat chip scrollspy
  var sections = Array.prototype.slice.call(document.querySelectorAll('.cat-section'));
  function spyChip() {
    if (sections.length === 0) return;
    var y = window.scrollY + 110 + 1;
    var active = sections[0].id;
    sections.forEach(function(s){ if (s.offsetTop <= y) active = s.id; });
    document.querySelectorAll('.catnav .chip').forEach(function(c){ c.classList.toggle('active', c.dataset.target === active); });
  }
  document.addEventListener('scroll', spyChip, { passive: true });

  // Modal
  var scrim = document.getElementById('scrim');
  var modal = document.getElementById('modal');
  function openModal(it, catName) {
    var mPh = document.getElementById('mPh');
    mPh.innerHTML = '';
    mPh.style.background = it.bg;
    var em = document.createElement('span');
    em.className = 'ph-emoji';
    em.style.cssText = 'font-size:120px;line-height:1;filter:drop-shadow(0 6px 14px rgba(0,0,0,0.2));';
    em.innerHTML = it.emoji; // ★ SVG 픽토그램 — textContent면 마크업이 글자로 노출
    mPh.appendChild(em);
    document.getElementById('mName').textContent = it.name;
    document.getElementById('mCopy').textContent = it.aiCopy || '';
    document.getElementById('mUnit').textContent = it.unit || '—';
    document.getElementById('mOrigin').textContent = it.origin || '—';
    document.getElementById('mUnitP').textContent = unitPrice(it) || '—';
    document.getElementById('mCard').textContent = it.cardDiscount || '—';
    scrim.classList.add('show');
    modal.classList.add('show');
    document.getElementById('mAdd').onclick = function(){ addToCart(it); closeModal(); };
  }
  function closeModal() { scrim.classList.remove('show'); modal.classList.remove('show'); }
  scrim.addEventListener('click', closeModal);
  document.getElementById('mClose').addEventListener('click', closeModal);

  // Cart
  var cart = [];
  function addToCart(it) {
    cart.push(it);
    document.getElementById('cartCount').textContent = cart.length;
    var last = cart[cart.length - 1];
    var sub = cart.length === 0 ? '담은 상품 없음' : (last.name + (cart.length > 1 ? ' 외 ' + (cart.length - 1) + '개' : ''));
    document.getElementById('cartSub').textContent = sub;
    showToast(it.name + ' 담음');
  }

  var toastTimer = null;
  function showToast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 1700);
  }

  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev){
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });
})();
</script>
</body>
</html>`;
}
/**
 * ★ CATALOG SWIPE 엔진 — Claude Design 05-catalog-swipe.html 동적 변환 (D154 PHASE 0 트랙 A)
 *
 * 넷플릭스 가로 카탈로그 패턴. 매장 카드(상단) + 카테고리별 가로 스와이프 행 + 카드 hold 500ms 확대 미리보기.
 * 별점/리뷰/거리는 FlyerRenderData 미포함 → 생략 (PHASE 1 매장 메타 확장 예정).
 * 영업시간 + 전화 + 길찾기는 announcements/externalLinks 추출 또는 정적 폴백.
 */
export function renderCatalogSwipeEngine(d: FlyerRenderData, token: SeasonToken): string {
  const tokenInfo = SEASON_TOKENS[token];
  const ogTitle = d.storeName + ' · 카탈로그';
  const totalItems = flattenItems(d).length;
  const ogDesc = '카테고리별 추천 상품 ' + totalItems + '개 · ' + d.storeName;
  const ogImage = buildOgImageUrl(d, token);

  // 매장 카드: phone/map externalLinks + 영업시간 announcement 추출
  const phoneLink = (d.externalLinks || []).find(l => l.icon === 'phone');
  const mapLink = (d.externalLinks || []).find(l => l.icon === 'map');
  const hoursAnn = (d.announcements || []).find(a => a.title.indexOf('영업') >= 0 || a.title.indexOf('시간') >= 0);
  const hoursText = hoursAnn ? hoursAnn.content : '문의 매장';

  // CATEGORIES SSR
  const categoriesData = d.categories.map(cat => ({
    name: cat.name,
    copy: categoryDescription(cat.name),
    count: cat.items.length,
    items: cat.items.map(it => ({
      name: it.name,
      originalPrice: it.originalPrice,
      salePrice: it.salePrice,
      badge: it.badge || '',
      unit: it.unit || '',
      origin: it.origin || '',
      cardDiscount: it.cardDiscount || '',
      aiCopy: it.aiCopy || '',
      imageUrl: toAbsUrl(it.imageUrl || '') || '',
      bg: categoryBg(cat.name),
      emoji: categoryPictogram(cat.name),
    })),
  }));
  const categoriesJson = JSON.stringify(categoriesData).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #F97316;
  --color-accent: #EF4444;
  --color-on-primary: #FFFFFF;
  --color-text-strong: #1B1410;
  --color-text-weak: #6B5E52;
  --color-bg: #EFE6D7;
  --color-soft: #F7F1E5;
  --color-card: #FFFCF7;
  --color-rule: #E0D4BD;
  --color-discount: #DC2626;
  --shadow-card: 0 1px 0 rgba(0,0,0,0.04), 0 10px 22px -10px rgba(60,40,20,0.20);
  --shadow-shelf: 0 18px 30px -18px rgba(60,40,20,0.45);
  --motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
${seasonStyleBlock()}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--color-bg); color: var(--color-text-strong); }
body {
  font-family: 'Pretendard Variable', sans-serif; -webkit-font-smoothing: antialiased;
  background-color: var(--color-bg);
  background-image:
    repeating-linear-gradient(91deg, rgba(120, 78, 40, 0.045) 0 2px, transparent 2px 9px),
    repeating-linear-gradient(89deg, rgba(80, 50, 20, 0.035) 0 1px, transparent 1px 11px),
    radial-gradient(140% 60% at 50% 0%, rgba(140, 90, 50, 0.08), transparent 60%);
  padding-bottom: 32px;
}
button { font-family: inherit; }
.price-num { font-variant-numeric: tabular-nums; }
.topbar { position: sticky; top: 0; z-index: 50; height: 50px; padding: 0 14px; background: rgba(239, 230, 215, 0.85); backdrop-filter: blur(14px); border-bottom: 1px solid var(--color-rule); display: flex; align-items: center; gap: 8px; }
.topbar .back, .topbar .iconbtn { width: 36px; height: 36px; border: 0; background: transparent; display: grid; place-items: center; color: var(--color-text-strong); cursor: pointer; }
.topbar svg { width: 20px; height: 20px; }
.topbar .crumbs { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar .crumbs .e1 { font-size: 10px; color: var(--color-text-weak); letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
.topbar .crumbs .e2 { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; margin-top: -2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.store { margin: 16px 14px 4px; border-radius: 22px; overflow: hidden; position: relative; min-height: 200px; color: #fff; box-shadow: var(--shadow-card); }
.store .bg { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.85) 100%), linear-gradient(135deg, #6b4f33 0%, #34221a 100%); }
.store .bg::before { content: ""; position: absolute; inset: 0; background-image: radial-gradient(120% 60% at 20% 10%, rgba(255,200,150,0.18), transparent 60%), radial-gradient(120% 60% at 90% 30%, rgba(255,170,90,0.14), transparent 60%); mix-blend-mode: screen; }
.store .seasonStamp { position: absolute; right: 14px; top: 14px; padding: 5px 10px; border-radius: 999px; background: rgba(255,255,255,0.18); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.32); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; }
.store .content { position: relative; padding: 90px 18px 18px; display: flex; flex-direction: column; gap: 4px; }
.store .name { font-size: 24px; font-weight: 900; letter-spacing: -0.025em; }
.store .meta { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 600; opacity: 0.85; flex-wrap: wrap; }
.store .hours { margin-top: 6px; font-size: 12px; font-weight: 500; opacity: 0.9; }
.store .hours .open { display: inline-flex; align-items: center; gap: 4px; color: #4ADE80; font-weight: 700; }
.store .hours .open .dot { width: 6px; height: 6px; border-radius: 50%; background: #4ADE80; box-shadow: 0 0 8px #4ADE80; }
.store .actions { margin-top: 12px; display: flex; gap: 8px; }
.store .actions a, .store .actions button { flex: 1; height: 38px; border-radius: 10px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: #fff; font-size: 13px; font-weight: 700; letter-spacing: -0.01em; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; backdrop-filter: blur(6px); text-decoration: none; }
.store .actions svg { width: 14px; height: 14px; }
.store .actions .primary { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); }
.row { padding-top: 22px; }
.row .head { display: flex; align-items: flex-end; justify-content: space-between; padding: 0 18px 10px; }
.row .head .titles { display: flex; flex-direction: column; min-width: 0; }
.row .head .titles .cat { font-size: 21px; font-weight: 800; letter-spacing: -0.025em; display: inline-flex; align-items: baseline; gap: 6px; }
.row .head .titles .cat small { font-size: 11px; font-weight: 600; color: var(--color-text-weak); letter-spacing: 0; }
.row .head .titles .copy { font-size: 12px; color: var(--color-text-weak); margin-top: 2px; }
.row .head .more { background: transparent; border: 0; font-size: 12px; font-weight: 700; color: var(--color-text-strong); display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.row .head .more svg { width: 12px; height: 12px; }
.shelf { position: relative; padding: 6px 0 22px; }
.shelf::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 12px; background: linear-gradient(180deg, rgba(80,55,25,0.18), rgba(80,55,25,0.04)), repeating-linear-gradient(90deg, rgba(120,80,40,0.10) 0 3px, transparent 3px 10px); border-top: 1px solid rgba(80,55,25,0.18); }
.swipe { display: flex; gap: 12px; overflow-x: auto; padding: 4px 14px 0; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
.swipe::-webkit-scrollbar { display: none; }
.swipe::before, .swipe::after { content: ""; flex: 0 0 4px; }
.pcard { flex: 0 0 156px; scroll-snap-align: start; background: var(--color-card); border-radius: 16px; padding: 8px 8px 10px; box-shadow: var(--shadow-shelf); position: relative; transition: transform 200ms ease, filter 200ms ease, opacity 200ms ease; cursor: pointer; }
.pcard.hold { transform: scale(1.12); z-index: 5; box-shadow: 0 24px 40px -12px rgba(0,0,0,0.4); }
.row.holding .pcard:not(.hold) { filter: blur(2px); opacity: 0.4; }
.pcard .pic { position: relative; aspect-ratio: 1/1; border-radius: 10px; overflow: hidden; background: var(--color-soft); }
.pcard .pic .ph-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pcard .pic .ph { position: absolute; inset: 0; display: grid; place-items: center; }
.pcard .pic .ph-emoji { font-size: 86px; line-height: 1; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.18)); }
.pcard .b1 { position: absolute; left: 6px; top: 6px; padding: 3px 7px; border-radius: 4px; background: var(--color-discount); color: #fff; font-size: 10px; font-weight: 800; letter-spacing: -0.01em; }
.pcard .b1.tag { background: var(--color-text-strong); }
.pcard .nm { margin-top: 8px; font-size: 13px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 32px; }
.pcard .unit { font-size: 10px; color: var(--color-text-weak); font-weight: 500; margin-top: 1px; }
.pcard .price { display: flex; align-items: baseline; gap: 4px; margin-top: 4px; }
.pcard .price .off { font-size: 12px; font-weight: 800; color: var(--color-discount); }
.pcard .price .sale { font-size: 15px; font-weight: 900; letter-spacing: -0.02em; }
.pcard .price .sale .won { font-size: 10px; font-weight: 800; }
.pcard .orig { font-size: 11px; color: var(--color-text-weak); text-decoration: line-through; }
.pcard .more { position: absolute; left: 0; right: 0; top: 100%; margin-top: 6px; padding: 10px 12px; background: var(--color-text-strong); color: #fff; border-radius: 12px; font-size: 11px; line-height: 1.5; opacity: 0; pointer-events: none; transform: translateY(-6px); transition: opacity 200ms, transform 200ms; z-index: 6; }
.pcard.hold .more { opacity: 1; transform: translateY(0); pointer-events: auto; }
.pcard .more .label { opacity: 0.6; text-transform: uppercase; letter-spacing: 0.06em; font-size: 9px; font-weight: 600; margin-right: 4px; }
.pcard.moreBtn { background: transparent; border: 2px dashed var(--color-rule); box-shadow: none; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--color-text-weak); }
.pcard.moreBtn .pic { background: transparent; }
.pcard.moreBtn .pic .icon { position: absolute; inset: 0; display: grid; place-items: center; font-size: 28px; }
.swipeIndicator { height: 3px; border-radius: 2px; background: var(--color-rule); margin: 0 18px; overflow: hidden; position: relative; }
.swipeIndicator .thumb { position: absolute; left: 0; top: 0; bottom: 0; width: 32%; min-width: 14%; background: var(--color-text-strong); border-radius: 2px; transition: left 100ms linear, width 200ms ease; }
.brand { margin: 24px 18px 0; padding-top: 18px; border-top: 1px solid var(--color-rule); display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--color-text-weak); letter-spacing: 0.1em; }
.brand strong { color: var(--color-text-strong); font-weight: 800; letter-spacing: -0.01em; }
@media (prefers-reduced-motion: reduce) {
  .pcard, .row.holding .pcard:not(.hold), .pcard .more { transition: none; }
}
</style>
</head>
<body>
<header class="topbar">
  <button class="back" aria-label="뒤로" onclick="history.back()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></button>
  <div class="crumbs">
    <div class="e1">WEEKLY · ${esc(d.period)}</div>
    <div class="e2">${esc(d.storeName)}</div>
  </div>
  <button class="iconbtn" aria-label="검색"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></button>
  <button class="iconbtn" aria-label="공유" onclick="if(navigator.share){navigator.share({title:document.title,url:location.href}).catch(function(){});}else if(navigator.clipboard){navigator.clipboard.writeText(location.href);}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.5 8.5 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg></button>
</header>
<section class="store">
  <div class="bg"></div>
  <span class="seasonStamp">${esc(d.title)}</span>
  <div class="content">
    <div class="name">${esc(d.storeName)}</div>
    <div class="meta">
      <span>${esc(d.period)}</span>
    </div>
    <div class="hours">
      <span class="open"><span class="dot"></span>${esc(hoursAnn ? hoursAnn.title : '운영 중')}</span> · ${esc(hoursText)}
    </div>
    <div class="actions">
      ${phoneLink
        ? `<a href="${esc(phoneLink.url)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.97.37 1.92.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.33 1.84.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>전화</a>`
        : `<button disabled style="opacity:0.5;cursor:not-allowed;">전화</button>`}
      ${mapLink
        ? `<a href="${esc(mapLink.url)}" target="_blank" rel="noopener noreferrer" class="primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>길찾기</a>`
        : `<button class="primary" disabled style="opacity:0.5;cursor:not-allowed;">길찾기</button>`}
    </div>
  </div>
</section>
<main id="main"></main>
<div class="brand">
  <strong>HANJUL</strong>
  <span>· 한 줄 전단 · 카탈로그 모드</span>
</div>
<script>
(function(){
  var DATA = ${categoriesJson};
  if (!DATA || DATA.length === 0) return;
  function fmt(n){ return (n||0).toLocaleString('ko-KR'); }
  function pct(o, s){ return o > 0 ? Math.round((1 - s/o) * 100) : 0; }
  function escHtml(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var main = document.getElementById('main');

  DATA.forEach(function(cat, ci){
    var row = document.createElement('section');
    row.className = 'row';
    row.innerHTML =
      '<div class="head">' +
        '<div class="titles">' +
          '<div class="cat">' + escHtml(cat.name) + ' <small>' + cat.count + '</small></div>' +
          '<div class="copy">' + escHtml(cat.copy) + '</div>' +
        '</div>' +
        '<button class="more">더 보기 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>' +
      '</div>' +
      '<div class="shelf"><div class="swipe" data-row="' + ci + '"></div></div>' +
      '<div class="swipeIndicator"><div class="thumb"></div></div>';
    var swipe = row.querySelector('.swipe');

    cat.items.forEach(function(it){
      var card = document.createElement('article');
      card.className = 'pcard';
      card.setAttribute('data-product', JSON.stringify({ name: it.name, originalPrice: it.originalPrice, salePrice: it.salePrice, imageUrl: it.imageUrl, unit: it.unit, category: cat.name }));
      var off = pct(it.originalPrice, it.salePrice);
      var badgeTag = (it.badge && (it.badge.indexOf('한정') >= 0 || it.badge.indexOf('1+1') >= 0)) ? ' tag' : '';
      var badgeHtml = it.badge ? '<span class="b1' + badgeTag + '">' + escHtml(it.badge) + '</span>' : (off > 0 ? '<span class="b1">' + off + '%↓</span>' : '');

      var picHtml = it.imageUrl
        ? '<img class="ph-img" src="' + escHtml(it.imageUrl) + '" alt="' + escHtml(it.name) + '">'
        : '<div class="ph" style="background:' + it.bg + '"><span class="ph-emoji">' + it.emoji + '</span></div>';

      var moreHtml = '<div class="more">';
      moreHtml += '<div><span class="label">한 줄</span>' + escHtml(it.aiCopy || '') + '</div>';
      if (it.origin) moreHtml += '<div style="margin-top:6px;"><span class="label">원산지</span>' + escHtml(it.origin) + '</div>';
      if (it.cardDiscount) moreHtml += '<div style="margin-top:4px;"><span class="label">카드</span>' + escHtml(it.cardDiscount) + '</div>';
      moreHtml += '</div>';

      card.innerHTML =
        '<div class="pic">' + picHtml + badgeHtml + '</div>' +
        '<div class="nm">' + escHtml(it.name) + '</div>' +
        '<div class="unit">' + escHtml((it.unit || '') + (it.origin ? ' · ' + it.origin : '')) + '</div>' +
        '<div class="price">' +
          (off > 0 ? '<span class="off">' + off + '%</span>' : '') +
          '<span class="sale price-num">' + fmt(it.salePrice) + '<span class="won">원</span></span>' +
        '</div>' +
        (it.originalPrice > 0 ? '<div class="orig price-num">' + fmt(it.originalPrice) + '원</div>' : '') +
        moreHtml;

      var lpTimer = null, holding = false;
      card.addEventListener('pointerdown', function(){
        lpTimer = setTimeout(function(){
          holding = true;
          row.classList.add('holding');
          card.classList.add('hold');
        }, 350);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(ev){
        card.addEventListener(ev, function(){
          if (lpTimer) clearTimeout(lpTimer);
          if (holding) {
            holding = false;
            setTimeout(function(){
              row.classList.remove('holding');
              card.classList.remove('hold');
            }, 1400);
          }
        });
      });
      swipe.appendChild(card);
    });

    var sentinel = document.createElement('article');
    sentinel.className = 'pcard moreBtn';
    sentinel.innerHTML =
      '<div class="pic"><span class="icon">→</span></div>' +
      '<div class="nm" style="text-align:center; min-height: 32px; display:flex; align-items:center; justify-content:center;">전체 ' + cat.count + '개<br>보기</div>' +
      '<div class="unit" style="text-align:center;">' + escHtml(cat.name) + '</div>';
    swipe.appendChild(sentinel);

    var thumb = row.querySelector('.thumb');
    function updateThumb() {
      var w = swipe.scrollWidth - swipe.clientWidth;
      var p = w > 0 ? swipe.scrollLeft / w : 0;
      var tw = Math.max(14, (swipe.clientWidth / swipe.scrollWidth) * 100);
      thumb.style.width = tw + '%';
      thumb.style.left = (p * (100 - tw)) + '%';
    }
    swipe.addEventListener('scroll', updateThumb, { passive: true });
    requestAnimationFrame(updateThumb);

    main.appendChild(row);
  });

  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev){
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });
})();
</script>
</body>
</html>`;
}
/**
 * ★ POSTER PROMO 엔진 — Claude Design 06-poster-promo.html 동적 변환 (D154 PHASE 0 트랙 A)
 *
 * 인쇄 전단 + 모션 패턴. 6매체 정합 본진 (URL/인쇄/POP/MMS/알림톡 1:1 변환 가능).
 * 종이결 텍스처 + 대형 한글 슬로건 stagger 모션 + 빨강 sticker 회전 + slab 진열.
 * 첫 상품 = feature slab(대형), 그 외 = 일반 slab. 카테고리별 secmark 분리.
 */
export function renderPosterPromoEngine(d: FlyerRenderData, token: SeasonToken): string {
  const tokenInfo = SEASON_TOKENS[token];
  const items = flattenItems(d);
  const totalItems = items.length;
  const ogTitle = d.storeName + ' · ' + d.title;
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice)).join(' · ');
  const ogImage = buildOgImageUrl(d, token);

  // 슬로건 글자 단위 stagger (마지막 1/3은 red+underline 강조)
  const title = (d.title || '이번 주 진짜 싸요').trim();
  const titleChars = Array.from(title);
  const redStart = Math.max(0, Math.floor(titleChars.length * 0.6));
  const sloganHtml = titleChars.map((c, i) => {
    const cls = i >= redStart ? 'char red' : 'char';
    const delay = i * 55;
    const inner = c === ' ' ? '&nbsp;' : esc(c);
    return '<span class="' + cls + '" style="animation-delay:' + delay + 'ms">' + inner + '</span>';
  }).join('');

  // sticker (첫 상품 badge 또는 max 할인율)
  let stickerL1 = '오늘만!';
  let stickerL3 = '특가';
  if (items.length > 0) {
    const maxDisc = items.reduce((m, it) => Math.max(m, calcDisc(it.originalPrice, it.salePrice)), 0);
    if (maxDisc > 0) stickerL3 = maxDisc + '% OFF';
    if (items[0].badge) stickerL1 = items[0].badge;
  }

  // 매장 정보 추출
  const phoneLink = (d.externalLinks || []).find(l => l.icon === 'phone');
  const mapLink = (d.externalLinks || []).find(l => l.icon === 'map');
  const hoursAnn = (d.announcements || []).find(a => a.title.indexOf('영업') >= 0 || a.title.indexOf('시간') >= 0);
  const addressAnn = (d.announcements || []).find(a => a.title.indexOf('주소') >= 0);

  // 카테고리별 secmark + slab 진열
  let slabNum = 0;
  const sections: string[] = [];
  d.categories.forEach((cat, ci) => {
    const catEn = categoryEn(cat.name);
    const secLabel = ci === 0 ? '이번 주 핵심 / WEEK PICK' : esc(cat.name) + ' / ' + esc(catEn);
    sections.push('<div class="secmark"><span class="num">' + String(ci + 1).padStart(2, '0') + '</span><span>' + secLabel + '</span><span class="line"></span></div>');

    cat.items.forEach((it, ii) => {
      slabNum++;
      const isFeature = ci === 0 && ii === 0;
      const disc = calcDisc(it.originalPrice, it.salePrice);
      const numStr = String(slabNum).padStart(2, '0');
      // ★ 2026-08-20 무이미지 = 스펙 조판 슬랩(13번 설계 §4-1) — 산지·등급·규격을 활자로 세운다(신선식품은 사진보다 강하다)
      const picHtml = it.imageUrl
        ? '<img src="' + esc(toAbsUrl(it.imageUrl) || '') + '" alt="' + esc(it.name) + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">'
        : '<div class="ph slab-typo" style="background:' + categoryBg(cat.name) + '">' +
            '<span class="tp-picto">' + categoryPictogram(cat.name) + '</span>' +
            (it.origin ? '<span class="tp-origin">' + esc(it.origin) + '</span>' : '') +
            (it.unit ? '<span class="tp-unit">' + esc(it.unit) + '</span>' : '') +
          '</div>';
      const stampTxt = it.badge && it.badge.indexOf('한정') >= 0 ? it.badge : (disc > 0 ? disc + '% OFF' : '특가');
      const stampCls = it.badge && it.badge.indexOf('1+1') >= 0 ? 'stamp dark' : 'stamp';
      const specParts: string[] = [];
      if (it.unit) specParts.push(it.unit);
      if (it.origin) specParts.push(it.origin);
      const specText = specParts.join(' · ');
      const origHtml = it.originalPrice > 0 ? '<div class="orig price-num">정가 ' + fmtPrice(it.originalPrice) + '원</div>' : '';
      const saved = it.originalPrice > 0 ? it.originalPrice - it.salePrice : 0;
      const cardCell = it.cardDiscount
        ? '<div class="cell"><div><div class="k">CARD</div>' + esc(it.cardDiscount) + '</div></div>'
        : '<div class="cell"><div><div class="k">FRESH</div>당일 입고</div></div>';
      const saveCell = saved > 0
        ? '<div class="cell"><div><div class="k">SAVE</div>' + fmtPrice(saved) + '원 ↓</div></div>'
        : (it.badge ? '<div class="cell"><div><div class="k">DEAL</div>' + esc(it.badge) + '</div></div>' : '<div class="cell"><div><div class="k">DEAL</div>이번 주 특가</div></div>');
      const featureCls = isFeature ? ' feature' : '';

      sections.push(
        '<article class="slab' + featureCls + '" data-num="' + numStr + '"' + productDataAttr(it, cat.name) + '>' +
          '<div class="hdr">' +
            '<span class="id">NO. ' + numStr + ' · ' + esc(cat.name) + '</span>' +
            '<span class="right">' + (it.badge ? '<span class="pill">' + esc(it.badge) + '</span>' : '') + '<span>' + esc(specText) + '</span></span>' +
          '</div>' +
          '<div class="body">' +
            '<div class="pic">' + picHtml + '<div class="' + stampCls + '">' + esc(stampTxt) + '</div></div>' +
            '<div class="info">' +
              '<div class="name ' + nameSizeClass(it.name) + '">' + esc(it.name) + '</div>' +
              '<div class="spec">' + esc(specText || '이번 주 행사 상품') + '</div>' +
              '<div class="priceCol">' +
                origHtml +
                '<div class="saleRow"><span class="sale price-num ' + priceScaleClass(it.salePrice) + '">' + fmtPrice(it.salePrice) + '<span class="won">원</span></span></div>' +
                (it.aiCopy ? '<div class="unitp">' + esc(it.aiCopy) + '</div>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="footrow">' + cardCell + saveCell + '</div>' +
        '</article>'
      );

      // 첫 카테고리 첫 상품 다음에 stripe (시각적 강조)
      if (isFeature && (cat.items.length > 1 || d.categories.length > 1)) {
        // stripe는 footer 직전 한 번만 박힘 (아래에서)
      }
    });
  });

  // stripe (한 번)
  const stripeText = '★ ' + esc(d.title) + ' · ' + esc(d.period) + ' · ' + esc(d.storeName) + ' · ★ 카드 추가할인 · 한정 특가 · ★';

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=Nanum+Pen+Script&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #F97316;
  --color-accent: #EF4444;
  --color-on-primary: #FFFFFF;
  --ink: #181612;
  --ink-soft: #4A4438;
  --paper: #F2EBDC;
  --paper-deep: #E8DEC8;
  --rule: #1B1611;
  --discount: #C8261A;
  --yellow: #F2C84A;
  --motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
${seasonStyleBlock()}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--paper); color: var(--ink); }
body { font-family: 'Pretendard Variable', sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; padding-bottom: 32px; }
.price-num { font-variant-numeric: tabular-nums; }
body::before { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 200; opacity: 0.65; mix-blend-mode: multiply; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.16  0 0 0 0 0.13  0 0 0 0 0.08  0 0 0 0.08 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.hero { position: relative; padding: 36px 22px 28px; border-bottom: 4px solid var(--rule); overflow: hidden; }
.heroBg { position: absolute; inset: 0; background: radial-gradient(70% 50% at 0% 0%, rgba(200,38,26,0.10), transparent 60%), radial-gradient(60% 40% at 100% 100%, rgba(242,200,74,0.18), transparent 60%); }
.hero .topline { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--rule); font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
.hero .topline .right { display: inline-flex; align-items: center; gap: 8px; }
.hero .topline .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--rule); }
.hero h1 { position: relative; z-index: 1; margin-top: 14px; padding-right: 140px; font-size: 76px; font-weight: 900; line-height: 0.92; letter-spacing: -0.05em; color: var(--ink); word-break: keep-all; }
.hero h1 .red { color: var(--discount); }
.hero h1 .char { display: inline-block; animation: charIn 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@keyframes charIn { from { opacity: 0; transform: translateY(40px) skewY(6deg); } to { opacity: 1; transform: translateY(0) skewY(0); } }
.hero .signByline { position: relative; z-index: 1; margin-top: 18px; display: flex; align-items: baseline; gap: 12px; font-family: 'Gowun Dodum', sans-serif; font-size: 16px; color: var(--ink-soft); flex-wrap: wrap; }
.hero .signByline .store { font-family: 'Nanum Pen Script', cursive; font-size: 30px; color: var(--ink); font-weight: 400; line-height: 1; letter-spacing: -0.02em; }
.hero .period { position: relative; z-index: 1; margin-top: 8px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink); display: inline-flex; align-items: center; gap: 8px; }
.hero .period .line { width: 24px; height: 2px; background: var(--ink); }
.sticker { position: absolute; right: 6px; top: 16px; z-index: 3; width: 132px; height: 132px; background: var(--discount); color: #fff; border-radius: 50%; display: grid; place-items: center; text-align: center; box-shadow: 0 8px 24px rgba(200,38,26,0.35); transform: rotate(-12deg); animation: stickerWobble 2200ms ease-in-out infinite alternate; border: 4px dashed rgba(255,255,255,0.5); line-height: 1; }
@keyframes stickerWobble { from { transform: rotate(-14deg) scale(1); } to { transform: rotate(-7deg) scale(1.04); } }
.sticker .l1 { font-family: 'Nanum Pen Script', cursive; font-size: 32px; font-weight: 400; letter-spacing: -0.02em; margin-top: 4px; padding: 0 6px; }
.sticker .l2 { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; margin-top: 2px; }
.sticker .l3 { font-size: 20px; font-weight: 900; letter-spacing: -0.02em; margin-top: 2px; }
.secmark { margin: 26px 22px 14px; display: flex; align-items: center; gap: 12px; font-size: 12px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
.secmark .num { background: var(--ink); color: var(--paper); padding: 2px 6px; font-size: 11px; letter-spacing: 0; }
.secmark .line { flex: 1; height: 2px; background: var(--ink); }
.slab { margin: 0 22px 14px; border: 3px solid var(--rule); background: var(--paper); position: relative; opacity: 0; transform: translateY(20px); transition: opacity 540ms ease, transform 540ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.slab.in { opacity: 1; transform: none; }
.slab .hdr { background: var(--ink); color: var(--paper); display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; font-size: 12px; font-weight: 800; letter-spacing: 0.04em; flex-wrap: wrap; gap: 6px; }
.slab .hdr .id { font-variant-numeric: tabular-nums; }
.slab .hdr .right { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.slab .hdr .pill { background: var(--paper); color: var(--ink); padding: 2px 8px; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; }
.slab .body { display: grid; grid-template-columns: 132px 1fr; gap: 12px; padding: 12px; }
.slab .pic { position: relative; aspect-ratio: 1/1; border: 2px solid var(--rule); background: var(--paper-deep); overflow: hidden; }
.slab .pic .stamp { position: absolute; right: -8px; top: -8px; background: var(--discount); color: #fff; padding: 4px 8px; font-size: 11px; font-weight: 900; letter-spacing: 0.02em; transform: rotate(6deg); border: 2px solid var(--rule); z-index: 2; }
.slab .pic .stamp.dark { background: var(--ink); }
/* ★ 2026-08-20 무이미지 스펙 조판 슬랩(13번 설계 §4-1) */
.slab .pic .slab-typo { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; }
.slab .pic .slab-typo .tp-picto { font-size: 40px; line-height: 1; }
.slab .pic .slab-typo .tp-origin { font-size: 17px; font-weight: 900; color: rgba(255,255,255,0.96); letter-spacing: -0.01em; }
.slab .pic .slab-typo .tp-unit { font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.75); }
/* ★ 이름·가격 계급(§4-3·§4-4) — 긴 이름·큰 자릿수 방어 */
.slab .info .name.nm-m { font-size: 19px; }
.slab .info .name.nm-l { font-size: 16px; letter-spacing: -0.03em; }
.slab .priceCol .sale.pr-m { font-size: 42px; }
.slab .priceCol .sale.pr-l { font-size: 34px; }
.slab.feature .sale.pr-m { font-size: 62px; }
.slab.feature .sale.pr-l { font-size: 50px; }
.slab .info { display: flex; flex-direction: column; }
.slab .name { font-size: 22px; font-weight: 900; letter-spacing: -0.025em; line-height: 1.05; }
.slab .spec { margin-top: 4px; font-size: 12px; font-weight: 600; color: var(--ink-soft); letter-spacing: 0.02em; }
.slab .priceCol { margin-top: auto; padding-top: 8px; }
.slab .priceCol .orig { font-size: 13px; color: var(--ink-soft); text-decoration: line-through; text-decoration-thickness: 2px; }
.slab .priceCol .saleRow { display: flex; align-items: baseline; gap: 4px; }
.slab .priceCol .sale { font-size: 48px; font-weight: 900; letter-spacing: -0.04em; line-height: 0.95; color: var(--discount); transform-origin: left bottom; }
.slab.in .priceCol .sale { animation: priceStamp 760ms var(--motion-spring) both 200ms; }
@keyframes priceStamp { 0% { transform: scale(0.6) rotate(-3deg); opacity: 0; } 60% { transform: scale(1.1) rotate(0); opacity: 1; } 100% { transform: scale(1) rotate(0); } }
.slab .priceCol .won { font-size: 20px; font-weight: 900; margin-left: 2px; color: var(--discount); }
.slab .priceCol .unitp { margin-top: 6px; font-size: 11px; font-weight: 600; color: var(--ink-soft); letter-spacing: 0.02em; line-height: 1.5; }
.slab .footrow { border-top: 2px solid var(--rule); display: grid; grid-template-columns: 1fr 1fr; }
.slab .footrow .cell { padding: 8px 12px; font-size: 11px; font-weight: 700; color: var(--ink); letter-spacing: 0.02em; display: flex; align-items: center; gap: 6px; }
.slab .footrow .cell:first-child { border-right: 2px solid var(--rule); }
.slab .footrow .cell .k { font-size: 9px; letter-spacing: 0.18em; color: var(--ink-soft); text-transform: uppercase; }
.slab.feature .body { grid-template-columns: 1fr; padding: 0; }
.slab.feature .pic { aspect-ratio: 4/3; border: 0; border-bottom: 2px solid var(--rule); }
.slab.feature .info { padding: 14px 14px 0; }
.slab.feature .sale { font-size: 72px; }
.slab.feature .won { font-size: 28px; }
.stripe { margin: 18px 0; background: var(--ink); color: var(--paper); padding: 10px 0; overflow: hidden; white-space: nowrap; border-top: 4px solid var(--rule); border-bottom: 4px solid var(--rule); }
.stripe .track { display: inline-flex; gap: 24px; animation: marquee 18s linear infinite; font-size: 17px; font-weight: 800; letter-spacing: 0.04em; }
@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.footer { margin: 30px 22px 0; border-top: 3px dashed var(--rule); padding-top: 18px; }
.footer .scissors { position: relative; margin-top: -32px; padding-bottom: 14px; text-align: center; font-size: 14px; }
.footer .scissors span { display: inline-block; background: var(--paper); padding: 0 8px; }
.footer .footName { font-family: 'Nanum Pen Script', cursive; font-size: 34px; letter-spacing: -0.02em; line-height: 1; }
.footer .footLines { margin-top: 12px; display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
.footer .footLines .ln { display: grid; grid-template-columns: 64px 1fr; align-items: baseline; gap: 8px; }
.footer .footLines .k { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-soft); font-weight: 800; }
.footer .ctas { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.footer .ctas a, .footer .ctas button { height: 50px; border: 2px solid var(--rule); background: var(--paper); color: var(--ink); font-family: inherit; font-weight: 800; font-size: 14px; letter-spacing: -0.01em; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; text-decoration: none; }
.footer .ctas .fill { background: var(--ink); color: var(--paper); }
.footer .ctas svg { width: 16px; height: 16px; }
.footer .small { margin-top: 14px; font-size: 10px; color: var(--ink-soft); letter-spacing: 0.04em; text-align: center; padding: 8px 0; border-top: 1px solid var(--rule); }
@media (prefers-reduced-motion: reduce) {
  .sticker { animation: none; }
  .slab.in .priceCol .sale { animation: none; }
  .stripe .track { animation: none; }
  .hero h1 .char { animation: none; opacity: 1; transform: none; }
}
</style>
</head>
<body>
<section class="hero">
  <div class="heroBg"></div>
  <div class="topline">
    <span>HANJUL · ${esc(d.title)}</span>
    <span class="right"><span class="dot"></span>${esc(d.period)}</span>
  </div>
  <h1 id="slogan">${sloganHtml}</h1>
  <div class="signByline">
    <span class="store">${esc(d.storeName)}</span>
    <span style="font-family:inherit; font-size:13px; font-weight:700; letter-spacing:0.02em; color:var(--ink);">사장님 직접 인쇄</span>
  </div>
  <div class="period">
    <span class="line"></span>
    행사 기간 · ${esc(d.period)}
  </div>
  <div class="sticker" role="img" aria-label="${esc(stickerL1 + ' ' + stickerL3)}">
    <div>
      <div class="l1">${esc(stickerL1)}</div>
      <div class="l2">SPECIAL</div>
      <div class="l3">${esc(stickerL3)}</div>
    </div>
  </div>
</section>
${sections.join('\n')}
<div class="stripe" aria-hidden="true">
  <div class="track">
    <span>${stripeText}</span>
    <span>${stripeText}</span>
  </div>
</div>
<footer class="footer">
  <div class="scissors"><span>━━ ✂ ━━ 절취선 ━━ ✂ ━━</span></div>
  <div class="footName">${esc(d.storeName)}</div>
  <div class="footLines">
    <div class="ln"><span class="k">영업</span><span>${esc(hoursAnn ? hoursAnn.content : '문의 매장')}</span></div>
    <div class="ln"><span class="k">전화</span><span>${esc(phoneLink ? phoneLink.label : '문의 매장')}</span></div>
    <div class="ln"><span class="k">주소</span><span>${esc(addressAnn ? addressAnn.content : (mapLink ? mapLink.label : '매장 위치'))}</span></div>
    <div class="ln"><span class="k">기간</span><span>${esc(d.period)}</span></div>
  </div>
  <div class="ctas">
    ${mapLink
      ? `<a href="${esc(mapLink.url)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>길찾기</a>`
      : `<button disabled style="opacity:0.5;cursor:not-allowed;">길찾기</button>`}
    ${phoneLink
      ? `<a href="${esc(phoneLink.url)}" class="fill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.97.37 1.92.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.33 1.84.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>전화 걸기</a>`
      : `<button class="fill" disabled style="opacity:0.5;cursor:not-allowed;">전화 걸기</button>`}
  </div>
  <div class="small">PRINTED VIA HANJUL · 한 줄 전단 · ${esc(d.storeName)} · ${esc(d.period)}</div>
</footer>
<script>
(function(){
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.18 });
  document.querySelectorAll('.slab').forEach(function(s){ io.observe(s); });

  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev){
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });
})();
</script>
</body>
</html>`;
}

// ============================================================
// ★ D155: MAGAZINE ZINE 엔진 (02b-magazine-zine.html 동적 변환)
// Riso 인쇄 / 종이결 / halftone / 미스레지스트레이션 제목 / paper noise
// ============================================================

/** zine 제목 3 라인 미스레지스트레이션 분리 (l1/l2/l3 + ghost layer) */
function splitTitleForZine(title: string): { l1: string; l2: string; l3: string } {
  const parts = title.split(/[\s,·\.]+/).filter(p => p.length > 0);
  if (parts.length >= 3) {
    return { l1: parts[0], l2: parts[1], l3: parts.slice(2).join(' ') + '.' };
  }
  if (parts.length === 2) {
    return { l1: parts[0], l2: parts[1], l3: '싸요.' };
  }
  const word = parts[0] || '이번 주';
  const half = Math.ceil(word.length / 2);
  return { l1: word.slice(0, half) || '이번', l2: word.slice(half) || '주', l3: '싸요.' };
}

/**
 * ★ MAGAZINE ZINE 엔진 — Claude Design 02b-magazine-zine.html 동적 변환 (D155 PHASE 0 트랙 A 확장)
 *
 * 1 상품 / 카드. 첫 카테고리 첫 상품 = zcard.full(대형), 그 외 = 일반(홀수 = flip).
 * Bagel Fat One + Hahmlet + IBM Plex Mono 폰트 / 시즌 토큰 7종 / paper noise + halftone.
 */
export function renderMagazineZineEngine(d: FlyerRenderData, token: SeasonToken): string {
  const items = flattenItems(d);
  const total = items.length;
  const ogTitle = d.storeName + ' · ZINE — ' + d.title;
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice) + '원').join(' · ');
  const ogImage = buildOgImageUrl(d, token);

  // 미스레지스트레이션 제목 — 3 라인 (l1/l2/l3 + ghost)
  const title = (d.title || '이번 주 진짜 싸요').trim();
  const titleParts = splitTitleForZine(title);

  // sticker (max 할인율 + 첫 상품 badge)
  let stickerA = 'SPECIAL';
  let stickerNum = '30%';
  if (items.length > 0) {
    const maxDisc = items.reduce((m, it) => Math.max(m, calcDisc(it.originalPrice, it.salePrice)), 0);
    if (maxDisc > 0) stickerNum = maxDisc + '%';
    if (items[0].badge) stickerA = items[0].badge.slice(0, 8);
  }

  // 매장 정보
  const phoneLink = (d.externalLinks || []).find(l => l.icon === 'phone');
  const mapLink = (d.externalLinks || []).find(l => l.icon === 'map');
  const hoursAnn = (d.announcements || []).find(a => a.title.indexOf('영업') >= 0 || a.title.indexOf('시간') >= 0);
  const addressAnn = (d.announcements || []).find(a => a.title.indexOf('주소') >= 0);

  const issueDate = (d.periodStart && d.periodEnd)
    ? `${d.periodStart.replace(/-/g, '.')} — ${d.periodEnd.replace(/-/g, '.')}`
    : (d.period || '');

  // section + zcard 박힘
  let pageNum = 0;
  const sections: string[] = [];
  d.categories.forEach((cat, ci) => {
    const catEn = categoryEn(cat.name);
    sections.push(
      '<div class="secmark' + (ci % 2 === 1 ? ' alt' : '') + '">' +
        '<span class="no mono">' + String(ci + 1).padStart(2, '0') + ' / ' + esc(cat.name) + '</span>' +
        '<span class="tt han">' + esc(cat.items[0]?.badge || catEn || '이번 주') + '.</span>' +
        '<span class="ll"></span>' +
      '</div>'
    );

    cat.items.forEach((it, ii) => {
      pageNum++;
      const isFirst = ci === 0 && ii === 0;
      const isFlip = !isFirst && ii % 2 === 1;
      const numStr = String(pageNum).padStart(2, '0');
      const cardCls = 'zcard' + (isFirst ? ' full' : '');
      const tapeHtml = isFlip ? '<span class="tape l"></span>' : (isFirst || ii === 0 ? '<span class="tape"></span>' : '');
      const bodyCls = 'body' + (isFlip ? ' flip' : '');
      const halftoneStyle = (ii % 2 === 1) ? ' style="color: var(--color-accent);"' : '';
      const picHtml = it.imageUrl
        ? '<img src="' + esc(toAbsUrl(it.imageUrl) || '') + '" alt="' + esc(it.name) + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">'
        : '<div class="ph"><span class="glyph">' + categoryPictogram(cat.name) + '</span></div>';
      const disc = calcDisc(it.originalPrice, it.salePrice);
      const origHtml = it.originalPrice > 0 ? '<div class="orig price-num mono">정가 ' + fmtPrice(it.originalPrice) + '원</div>' : '';
      const specs: string[] = [];
      if (it.unit) specs.push('<span class="s">' + esc(it.unit.toUpperCase()) + '</span>');
      if (it.origin) specs.push('<span class="s">' + esc(it.origin) + '</span>');
      if (disc > 0) specs.push('<span class="s alt">' + disc + '%↓</span>');
      else if (it.badge) specs.push('<span class="s alt">' + esc(it.badge) + '</span>');
      const aiCopyHtml = it.aiCopy
        ? '<p class="copy">' + esc(it.aiCopy) + '</p>'
        : '<p class="copy">' + esc(it.name) + ', 이번 주만의 가격으로 만나보세요.</p>';
      const kicker = isFirst ? '이번 주 한 줄' : (it.badge || '주말 추천');
      const frameLbl = (catEn + ' · ' + (it.unit || '')).toUpperCase();

      sections.push(
        '<article class="' + cardCls + '" data-num="' + numStr + '"' + productDataAttr(it, cat.name) + '>' +
          tapeHtml +
          '<div class="hdr">' +
            '<span class="pip">' + esc(it.name) + (it.unit ? ' · ' + esc(it.unit) : '') + '</span>' +
            '<span>P.' + numStr + '</span>' +
          '</div>' +
          '<div class="' + bodyCls + '">' +
            '<div class="pic">' +
              picHtml +
              '<div class="halftoneFill"' + halftoneStyle + '></div>' +
              '<span class="indexNum fat">' + numStr + '</span>' +
              '<span class="frame-lbl">' + esc(frameLbl) + '</span>' +
            '</div>' +
            '<div class="info">' +
              '<div class="kicker">' + esc(kicker) + '</div>' +
              '<h3 class="han">' + esc(it.name) + (it.unit ? '<br>' + esc(it.unit) + '.' : '.') + '</h3>' +
              '<div class="specs">' + specs.join('') + '</div>' +
              aiCopyHtml +
              '<div class="priceBox">' +
                origHtml +
                '<div class="saleRow">' +
                  '<span class="sale price-num">' + fmtPrice(it.salePrice) + '<span class="won">원</span></span>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</article>'
      );

      // 첫 카테고리 첫 상품 다음에 manifesto 1회
      if (isFirst && (cat.items.length > 1 || d.categories.length > 1)) {
        const editorDate = d.periodStart ? d.periodStart.slice(5).replace('-', '/') : '';
        const weekNum = Math.ceil((new Date().getTime() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 604800000);
        sections.push(
          '<div class="manifesto">' +
            '<span class="arrow mono">EDITOR\'S NOTE — ' + esc(editorDate) + '</span>' +
            '<h4 class="han">"새벽에 본 것만<br>매대에 올립니다."</h4>' +
            '<div class="signoff">' +
              '<span class="by han">— ' + esc(d.storeName) + '</span>' +
              '<span>WEEK ' + weekNum + ' / ' + new Date().getFullYear() + '</span>' +
            '</div>' +
          '</div>'
        );
      }
    });

    // 카테고리 사이 marquee (2번째 카테고리 후 1회)
    if (ci === 1 && d.categories.length > 2) {
      sections.push(
        '<div class="stripe" aria-hidden="true">' +
          '<div class="track">' +
            '<span>★ ZINE · <span class="red">' + esc(d.period) + '</span> · ' + esc(d.storeName) + ' · ★ 한정 특가 ★ </span>' +
            '<span>★ ZINE · <span class="red">' + esc(d.period) + '</span> · ' + esc(d.storeName) + ' · ★ 한정 특가 ★ </span>' +
          '</div>' +
        '</div>'
      );
    }
  });

  const yy = String(new Date().getFullYear() % 100);
  const yyyy = String(new Date().getFullYear());

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Hahmlet:wght@600;800;900&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #FF3D2E;
  --color-accent:  #2056FF;
  --color-on-primary: #FFF8E7;
  --ink: #141210;
  --paper: #FFF8E7;
  --paper-2: #F4ECCF;
  --rule: #141210;
  --motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
${seasonStyleBlock()}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--paper); color: var(--ink); }
body { font-family: 'Pretendard Variable', sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
.mono { font-family: 'IBM Plex Mono', monospace; }
.han { font-family: 'Hahmlet', 'Pretendard Variable', serif; }
.fat { font-family: 'Bagel Fat One', 'Hahmlet', sans-serif; font-weight: 400; }
.price-num { font-variant-numeric: tabular-nums; }
body::before { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 200; opacity: 0.55; mix-blend-mode: multiply; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.14  0 0 0 0 0.11  0 0 0 0 0.06  0 0 0 0.10 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.cover { padding: 22px 20px 28px; position: relative; border-bottom: 6px solid var(--ink); overflow: hidden; }
.cover .nav { display: flex; justify-content: space-between; align-items: center; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; padding-bottom: 8px; border-bottom: 1.5px solid var(--ink); }
.cover .nav .right { display: inline-flex; align-items: center; gap: 6px; }
.cover .nav .stamp { background: var(--ink); color: var(--paper); padding: 2px 6px; font-weight: 800; }
.cover .issueRow { display: flex; align-items: baseline; justify-content: space-between; margin-top: 14px; font-size: 11px; letter-spacing: 0.06em; }
.cover .issueRow .vol { font-size: 48px; line-height: 0.85; letter-spacing: -0.04em; color: var(--color-primary); transform: translateY(4px); font-family: 'Bagel Fat One', cursive; }
.cover h1 { position: relative; margin-top: 4px; font-size: 84px; line-height: 0.86; letter-spacing: -0.04em; color: var(--ink); text-wrap: balance; padding-right: 130px; word-break: keep-all; }
.cover h1 .l1 { display: block; }
.cover h1 .l2 { display: block; color: var(--color-primary); position: relative; }
.cover h1 .l2::after { content: attr(data-text); position: absolute; left: 3px; top: 2px; color: var(--color-accent); z-index: -1; mix-blend-mode: multiply; opacity: 0.7; }
.cover h1 .l3 { display: block; -webkit-text-stroke: 2px var(--ink); color: transparent; font-weight: 400; }
.cover .stickers { position: absolute; right: -10px; top: 78px; width: 130px; height: 130px; background: var(--color-accent); color: var(--paper); border-radius: 50%; display: grid; place-items: center; text-align: center; transform: rotate(-10deg); border: 3px solid var(--ink); box-shadow: 4px 4px 0 var(--ink); z-index: 2; }
.cover .stickers .a { font-size: 14px; font-weight: 800; letter-spacing: 0.08em; }
.cover .stickers .b { font-size: 34px; line-height: 1; margin-top: 4px; }
.cover .stickers .c { font-size: 11px; font-weight: 700; margin-top: 4px; opacity: 0.9; }
.cover .credit { margin-top: 28px; display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: end; padding-top: 14px; border-top: 1.5px solid var(--ink); }
.cover .credit .l { font-size: 10px; letter-spacing: 0.18em; font-weight: 700; }
.cover .credit .v { font-size: 15px; font-weight: 800; letter-spacing: -0.01em; margin-top: 2px; }
.cover .credit .price { font-size: 34px; color: var(--color-primary); line-height: 1; letter-spacing: -0.04em; font-family: 'Bagel Fat One', cursive; }
.blob { position: absolute; pointer-events: none; z-index: 0; color: var(--color-primary); opacity: 0.85; mix-blend-mode: multiply; }
.blob.b1 { left: -40px; top: -30px; width: 200px; height: 200px; border-radius: 50%; background: radial-gradient(circle at center, currentColor 16%, transparent 20%); background-size: 5px 5px; }
.blob.b2 { right: -20px; bottom: -30px; width: 140px; height: 140px; color: var(--color-accent); background: radial-gradient(circle at center, currentColor 18%, transparent 22%); background-size: 4px 4px; transform: rotate(20deg); }
.secmark { margin: 32px 20px 12px; display: grid; grid-template-columns: auto auto 1fr; gap: 10px; align-items: center; }
.secmark .no { background: var(--ink); color: var(--paper); padding: 2px 8px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; }
.secmark .tt { font-size: 22px; letter-spacing: -0.025em; font-weight: 800; }
.secmark .ll { height: 3px; background: var(--ink); }
.secmark.alt .ll { background: var(--color-primary); }
.zcard { margin: 14px 20px 0; border: 3px solid var(--ink); background: var(--paper); position: relative; overflow: hidden; box-shadow: 5px 5px 0 var(--ink); opacity: 0; transform: translateY(20px); transition: opacity 540ms ease, transform 540ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.zcard.in { opacity: 1; transform: none; }
.zcard .tape { position: absolute; top: -8px; right: 22px; width: 72px; height: 18px; background: var(--color-accent); opacity: 0.7; transform: rotate(6deg); mix-blend-mode: multiply; z-index: 5; }
.zcard .tape.l { right: auto; left: 22px; transform: rotate(-8deg); background: var(--color-primary); }
.zcard .hdr { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 2.5px solid var(--ink); background: var(--paper-2); font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; }
.zcard .hdr .pip { display: inline-flex; align-items: center; gap: 6px; }
.zcard .hdr .pip::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--color-primary); }
.zcard .body { display: grid; grid-template-columns: 1fr 1fr; gap: 0; align-items: stretch; }
.zcard .pic { aspect-ratio: 1/1; position: relative; background: var(--paper-2); border-right: 2.5px solid var(--ink); overflow: hidden; }
.zcard .body.flip .pic { order: 2; border-right: 0; border-left: 2.5px solid var(--ink); }
.ph { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink); }
.ph .glyph { font-size: 132px; line-height: 1; filter: drop-shadow(2px 2px 0 var(--color-primary)) drop-shadow(-2px -1px 0 var(--color-accent)); mix-blend-mode: multiply; }
.pic .halftoneFill { position: absolute; inset: 0; color: var(--color-primary); background-image: radial-gradient(circle at center, currentColor 14%, transparent 18%); background-size: 6px 6px; opacity: 0.55; mix-blend-mode: multiply; pointer-events: none; }
.pic .frame-lbl { position: absolute; left: 8px; bottom: 8px; font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: var(--ink); background: var(--paper); padding: 2px 6px; border: 1.5px solid var(--ink); }
.pic .indexNum { position: absolute; right: 8px; top: 8px; font-family: 'Bagel Fat One', cursive; font-size: 38px; color: var(--paper); -webkit-text-stroke: 2px var(--ink); line-height: 1; }
.zcard .info { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 6px; }
.zcard .kicker { font-family: 'IBM Plex Mono', monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; color: var(--ink); opacity: 0.6; }
.zcard h3 { font-family: 'Hahmlet', serif; font-size: 26px; font-weight: 900; line-height: 0.98; letter-spacing: -0.03em; }
.zcard .specs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.zcard .specs .s { font-family: 'IBM Plex Mono', monospace; font-size: 10px; padding: 2px 6px; background: var(--ink); color: var(--paper); font-weight: 600; }
.zcard .specs .s.alt { background: var(--color-primary); color: var(--paper); }
.zcard .copy { margin-top: 6px; font-size: 12px; line-height: 1.45; color: var(--ink); }
.zcard .priceBox { margin-top: auto; padding-top: 10px; border-top: 1.5px dashed var(--ink); }
.zcard .priceBox .orig { font-family: 'IBM Plex Mono', monospace; font-size: 11px; text-decoration: line-through; text-decoration-thickness: 2px; color: var(--ink); opacity: 0.55; }
.zcard .priceBox .saleRow { display: flex; align-items: baseline; gap: 4px; }
.zcard .sale { font-family: 'Bagel Fat One', cursive; font-size: 42px; color: var(--color-primary); line-height: 1; letter-spacing: -0.02em; -webkit-text-stroke: 1.5px var(--ink); paint-order: stroke fill; }
.zcard.in .sale { animation: priceStomp 700ms var(--motion-spring) both 240ms; }
@keyframes priceStomp { 0% { transform: scale(0.6) rotate(-4deg); opacity: 0; } 60% { transform: scale(1.1) rotate(0); opacity: 1; } 100% { transform: scale(1) rotate(0); } }
.zcard .sale .won { font-size: 18px; }
.zcard.full .body { grid-template-columns: 1fr; }
.zcard.full .pic { aspect-ratio: 5/4; border-right: 0; border-bottom: 2.5px solid var(--ink); }
.zcard.full .info { padding: 14px 16px 18px; }
.zcard.full h3 { font-size: 32px; }
.zcard.full .sale { font-size: 56px; }
.manifesto { margin: 28px 20px 0; padding: 22px; background: var(--color-primary); color: var(--paper); border: 3px solid var(--ink); box-shadow: 5px 5px 0 var(--ink); position: relative; }
.manifesto .arrow { position: absolute; left: -3px; top: -16px; background: var(--ink); color: var(--paper); padding: 4px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; }
.manifesto h4 { font-family: 'Hahmlet', serif; font-size: 36px; line-height: 0.96; letter-spacing: -0.03em; font-weight: 900; text-wrap: balance; }
.manifesto .signoff { margin-top: 16px; display: flex; justify-content: space-between; align-items: baseline; font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; }
.manifesto .signoff .by { font-size: 18px; font-family: 'Hahmlet', serif; font-weight: 800; letter-spacing: -0.02em; }
.stripe { margin: 26px 0 0; background: var(--ink); color: var(--paper); border-top: 4px solid var(--ink); border-bottom: 4px solid var(--ink); padding: 8px 0; overflow: hidden; white-space: nowrap; font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; }
.stripe .track { display: inline-flex; gap: 16px; animation: marquee 22s linear infinite; }
.stripe .track .red { color: var(--color-primary); }
@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.foot { margin: 28px 20px 28px; padding-top: 18px; border-top: 3px solid var(--ink); }
.foot .lockup { display: flex; align-items: baseline; justify-content: space-between; }
.foot .lockup .h { font-family: 'Bagel Fat One', cursive; font-size: 28px; letter-spacing: -0.02em; line-height: 1; color: var(--color-primary); -webkit-text-stroke: 1.5px var(--ink); paint-order: stroke fill; }
.foot .lockup .no { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; }
.foot .grid { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.foot .grid .c { border-top: 1px solid var(--ink); padding-top: 6px; }
.foot .grid .k { font-family: 'IBM Plex Mono', monospace; font-size: 9px; letter-spacing: 0.18em; opacity: 0.6; text-transform: uppercase; }
.foot .grid .v { font-size: 14px; font-weight: 800; margin-top: 2px; letter-spacing: -0.01em; }
.foot .ctas { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.foot .ctas a, .foot .ctas button { height: 48px; border: 2.5px solid var(--ink); background: var(--paper); color: var(--ink); font-family: 'Hahmlet', serif; font-weight: 900; font-size: 14px; cursor: pointer; box-shadow: 3px 3px 0 var(--ink); display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
.foot .ctas .fill { background: var(--ink); color: var(--paper); }
.foot .small { margin-top: 18px; font-family: 'IBM Plex Mono', monospace; font-size: 9px; letter-spacing: 0.1em; text-align: center; padding-top: 10px; border-top: 1px dashed var(--ink); opacity: 0.7; }
@media (prefers-reduced-motion: reduce) {
  .zcard.in .sale { animation: none; }
  .stripe .track { animation: none; }
}
</style>
</head>
<body>
<section class="cover">
  <div class="blob b1"></div>
  <div class="blob b2"></div>
  <nav class="nav">
    <span>HANJUL · ZINE</span>
    <span class="right"><span class="stamp">VOL.${esc(yy)}</span> <span>WEEKLY</span></span>
  </nav>
  <div class="issueRow">
    <span class="mono">${esc(issueDate)}</span>
    <span class="vol">${total}</span>
  </div>
  <h1 class="han">
    <span class="l1">${esc(titleParts.l1)}</span>
    <span class="l2" data-text="${esc(titleParts.l2)}">${esc(titleParts.l2)}</span>
    <span class="l3">${esc(titleParts.l3)}</span>
  </h1>
  <div class="stickers" aria-hidden="true">
    <div>
      <div class="a">${esc(stickerA)}</div>
      <div class="b">${esc(stickerNum)}</div>
      <div class="c">OFF · TODAY</div>
    </div>
  </div>
  <div class="credit">
    <div>
      <div class="l mono">EDITED BY</div>
      <div class="v">${esc(d.storeName)}</div>
    </div>
    <div>
      <div class="l mono">PAGES</div>
      <div class="v">P. 01 — ${String(total).padStart(2, '0')}</div>
    </div>
    <div class="price">₩0<span style="font-size:11px; display:block; color:var(--ink); letter-spacing:0.04em;" class="mono">FREE</span></div>
  </div>
</section>
${sections.join('\n')}
<footer class="foot">
  <div class="lockup">
    <span class="h">${esc(d.storeName)}</span>
    <span class="no mono">VOL.${esc(yy)} / ${esc(yyyy)}</span>
  </div>
  <div class="grid">
    <div class="c"><div class="k">영업</div><div class="v">${esc(hoursAnn ? hoursAnn.content : '문의 매장')}</div></div>
    <div class="c"><div class="k">전화</div><div class="v">${esc(phoneLink ? phoneLink.label : '문의 매장')}</div></div>
    <div class="c"><div class="k">주소</div><div class="v">${esc(addressAnn ? addressAnn.content : (mapLink ? mapLink.label : '매장 위치'))}</div></div>
    <div class="c"><div class="k">기간</div><div class="v">${esc(d.period)}</div></div>
  </div>
  <div class="ctas">
    ${mapLink
      ? `<a href="${esc(mapLink.url)}" target="_blank" rel="noopener noreferrer">길찾기</a>`
      : `<button disabled style="opacity:0.5;cursor:not-allowed;">길찾기</button>`}
    ${phoneLink
      ? `<a href="${esc(phoneLink.url)}" class="fill">전화 걸기</a>`
      : `<button class="fill" disabled style="opacity:0.5;cursor:not-allowed;">전화 걸기</button>`}
  </div>
  <div class="small">PRINTED VIA HANJUL · 한 줄 전단 · ${esc(d.storeName)} · ZINE STYLE</div>
</footer>
<script>
(function(){
  var io = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.15 });
  document.querySelectorAll('.zcard').forEach(function(z) { io.observe(z); });
  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev) {
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });
})();
</script>
</body>
</html>`;
}

// ============================================================
// ★ D155: DEAL BENTO 엔진 (03b-deal-bento.html 동적 변환)
// 무신사/29CM 핫딜 bento 그리드 / 6 컬럼 dense flow / 8 컬러 cycle / 마감 카운트다운
// ============================================================

const BENTO_COLORS = ['t-cream', 't-rose', 't-mint', 't-lemon', 't-sky', 't-lilac', 't-peach', 't-coal'];
const BENTO_SIZES = ['span-tall', 'span-half', 'span-large', 'span-thin', 'span-mid', 'span-half', 'span-tall', 'span-half'];

/**
 * ★ DEAL BENTO 엔진 — Claude Design 03b-deal-bento.html 동적 변환 (D155 PHASE 0 트랙 A 확장)
 *
 * bento 그리드 6 컬럼 dense flow. 첫 상품 = HERO(span-hero) / 나머지 = 사이즈 rotation + 8 컬러 cycle.
 * 특수 타일: countdown(마감 임박 max disc), stats(total + avg disc), card(cardDiscount), more.
 * 시즌 토큰 7종.
 */
export function renderDealBentoEngine(d: FlyerRenderData, token: SeasonToken): string {
  const items = flattenItems(d);
  const total = items.length;
  const ogTitle = '오늘의 핫딜 · ' + d.storeName;
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice) + '원').join(' · ') + ' · 마감 임박';
  const ogImage = buildOgImageUrl(d, token);

  // max disc 상품 (countdown 타일용)
  const urgentItem = items.length > 0
    ? items.reduce((max, it) => calcDisc(it.originalPrice, it.salePrice) > calcDisc(max.originalPrice, max.salePrice) ? it : max, items[0])
    : null;

  // avg disc
  const avgDisc = items.length > 0
    ? Math.round(items.reduce((sum, it) => sum + calcDisc(it.originalPrice, it.salePrice), 0) / items.length)
    : 0;

  // 카드 할인 (모든 상품 cardDiscount 통합)
  const cardDiscounts = Array.from(new Set(items.map(i => i.cardDiscount).filter(c => c && c !== '—'))).slice(0, 3);

  // 매장 정보
  const phoneLink = (d.externalLinks || []).find(l => l.icon === 'phone');
  const mapLink = (d.externalLinks || []).find(l => l.icon === 'map');
  const hoursAnn = (d.announcements || []).find(a => a.title.indexOf('영업') >= 0 || a.title.indexOf('시간') >= 0);
  const addressAnn = (d.announcements || []).find(a => a.title.indexOf('주소') >= 0);

  // 필터 chips (전체 + 카테고리별 + 마감 임박)
  const chips: string[] = [];
  chips.push('<button class="chip active">전체 <span class="em">' + total + '</span></button>');
  d.categories.forEach(c => {
    chips.push('<button class="chip">' + esc(c.name) + ' ' + c.items.length + '</button>');
  });
  if (urgentItem && calcDisc(urgentItem.originalPrice, urgentItem.salePrice) >= 30) {
    chips.push('<button class="chip">마감 임박 <span class="em">1</span></button>');
  }

  // bento 타일 박힘 — HERO + 일반 sale + 특수 타일 mix
  const tiles: string[] = [];

  // HERO 타일 (items[0])
  if (items.length > 0) {
    const it = items[0];
    const sold = 62; // 시뮬레이션 (실제 limit/sold 데이터 박힘 가능)
    tiles.push(
      '<article class="tile hero span-hero" style="--em: \'' + categoryPictogram(it.category) + '\'; --sold: ' + sold + '%;"' + productDataAttr(it, it.category) + '>' +
        '<span class="kicker"><span class="d"></span>WEEK PICK · NO.1</span>' +
        '<div class="pic"></div>' +
        '<div class="name">' + esc(it.name) + (it.unit ? '<br>' + esc(it.unit) : '') + '</div>' +
        '<div class="spec">' + esc(it.origin || '') + (it.unit ? ' · ' + esc(it.unit) : '') + (it.badge ? ' · ' + esc(it.badge) : '') + '</div>' +
        '<div class="priceBlock">' +
          (it.originalPrice > 0 ? '<span class="orig price-num">' + fmtPrice(it.originalPrice) + '원</span>' : '') +
          '<span class="sale price-num">' + fmtPrice(it.salePrice) + '<span class="won">원</span></span>' +
        '</div>' +
        '<div class="footer">' +
          '<div class="progress"><div class="fill"></div></div>' +
          '<span>' + sold + '% · 잔여 표시</span>' +
        '</div>' +
        '<button class="cta">담기' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>' +
        '</button>' +
      '</article>'
    );
  }

  // countdown 타일 (max disc item)
  if (urgentItem) {
    const disc = calcDisc(urgentItem.originalPrice, urgentItem.salePrice);
    const saved = urgentItem.originalPrice > 0 ? urgentItem.originalPrice - urgentItem.salePrice : 0;
    tiles.push(
      '<article class="tile countdown span-half" style="grid-column: span 3; grid-row: span 4;">' +
        '<div>' +
          '<div class="lbl">마감 카운트다운</div>' +
          '<div class="meta">' + esc(urgentItem.name) + '</div>' +
        '</div>' +
        '<div class="clock" id="cdBox"><em>00</em>:<em id="cmm">49</em>:<em id="css">12</em></div>' +
        '<div class="meta" style="opacity:0.75;">' + (disc > 0 ? disc + '%↓' : '특가') + (saved > 0 ? ' · ' + fmtPrice(saved) + '원 ↓' : '') + '</div>' +
      '</article>'
    );
  }

  // stats 타일 (total + avg disc)
  tiles.push(
    '<article class="tile stats span-half t-tile" style="grid-column: span 3; grid-row: span 4;">' +
      '<div>' +
        '<div class="lbl">오늘 행사</div>' +
        '<div class="num">' + total + '<small>건</small></div>' +
      '</div>' +
      '<div class="meta">' + (avgDisc > 0 ? '평균 ' + avgDisc + '% 할인' : '한정 특가') + ' · 카테고리 ' + d.categories.length + '종</div>' +
    '</article>'
  );

  // 일반 sale 타일 (items[1...], 8 컬러 cycle + 사이즈 rotation)
  items.slice(1).forEach((it, idx) => {
    const colorCls = BENTO_COLORS[idx % BENTO_COLORS.length];
    const sizeCls = BENTO_SIZES[idx % BENTO_SIZES.length];
    const isFlash = it === urgentItem || (it.badge && (it.badge.indexOf('한정') >= 0 || it.badge.indexOf('마감') >= 0));
    const flashCls = isFlash ? ' flash' : '';
    const largeCls = sizeCls === 'span-large' ? ' large' : '';
    const disc = calcDisc(it.originalPrice, it.salePrice);
    const saved = it.originalPrice > 0 ? it.originalPrice - it.salePrice : 0;
    const offText = it.badge && it.badge.indexOf('1+1') >= 0 ? '1+1'
      : (disc > 0 ? disc + '%' : (saved > 0 ? fmtPrice(saved) + '원↓' : '특가'));
    const emojiSize = sizeCls === 'span-thin' ? ' style="font-size:44px;"' : '';
    const nameSize = sizeCls === 'span-thin' ? ' style="font-size:14px;"' : '';
    const picHtml = it.imageUrl
      ? '<span class="productEmoji" style="background-image:url(\'' + esc(toAbsUrl(it.imageUrl) || '') + '\');background-size:cover;background-position:center;width:64px;height:64px;display:inline-block;border-radius:12px;align-self:flex-end;margin:-8px -8px 0 0;"></span>'
      : '<span class="productEmoji"' + emojiSize + '>' + categoryPictogram(it.category) + '</span>';

    tiles.push(
      '<article class="tile ' + colorCls + ' ' + sizeCls + largeCls + flashCls + '"' + productDataAttr(it, it.category) + '>' +
        '<span class="badge">' + esc(it.badge || (disc > 0 ? disc + '%↓' : '특가')) + '</span>' +
        picHtml +
        '<div class="name"' + nameSize + '>' + esc(it.name) + (it.unit ? '<br>' + esc(it.unit) : '') + '</div>' +
        (it.origin || it.unit ? '<div class="spec">' + esc(it.origin || it.unit || '') + '</div>' : '') +
        '<div class="priceLine">' +
          (offText !== '특가' ? '<span class="off">' + esc(offText) + '</span>' : '') +
          '<span class="sale price-num">' + fmtPrice(it.salePrice) + '<span class="won">원</span></span>' +
        '</div>' +
        (it.originalPrice > 0 ? '<div class="orig price-num">' + fmtPrice(it.originalPrice) + '원</div>' : '') +
      '</article>'
    );

    // 4번째 일반 타일 후 ctaWide (카드 또는 매장) 박음
    if (idx === 3 && cardDiscounts.length > 0) {
      tiles.push(
        '<article class="tile ctaWide span-wide">' +
          '<div class="l">' +
            '<span class="t1">카드 추가 할인 진행 중</span>' +
            '<span class="t2">' + esc(cardDiscounts.join(' · ')) + '</span>' +
          '</div>' +
          '<div class="r">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>' +
          '</div>' +
        '</article>'
      );
    }
  });

  // card 타일 (cardDiscount 통합)
  if (cardDiscounts.length > 0) {
    tiles.push(
      '<article class="tile card span-wide">' +
        '<div class="lbl">카드 추가 할인</div>' +
        '<div class="v">' + cardDiscounts.map(c => esc(c)).join(' <em>+</em> ') + '</div>' +
      '</article>'
    );
  }

  // more 타일 (전체 보기)
  tiles.push(
    '<article class="tile more span-wide">' +
      '<span class="ic">+</span>' +
      '<span>이번 주 행사 전체 ' + total + '건 보기</span>' +
    '</article>'
  );

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #F97316;
  --color-accent: #EF4444;
  --color-on-primary: #FFFFFF;
  --ink: #0E0D0C;
  --ink-soft: #5B5752;
  --bg: #F5F2EC;
  --tile: #FFFFFF;
  --rule: #E7E2D7;
  --discount: #DC2626;
  --t-cream:  #FFE9C6;
  --t-rose:   #FFD7D2;
  --t-mint:   #CDEACB;
  --t-lemon:  #FCEF8E;
  --t-sky:    #C9DDF8;
  --t-lilac:  #D9D2F2;
  --t-peach:  #FFC9A0;
  --t-coal:   #1A1916;
  --motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
${seasonStyleBlock()}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--bg); color: var(--ink); }
body { font-family: 'Pretendard Variable', sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 96px; }
.price-num { font-variant-numeric: tabular-nums; }
button { font-family: inherit; cursor: pointer; }
.topbar { position: sticky; top: 0; z-index: 30; padding: 14px 16px 12px; background: rgba(245,242,236,0.92); backdrop-filter: blur(14px); border-bottom: 1px solid var(--rule); }
.topbar .row1 { display: flex; align-items: center; gap: 6px; font-size: 11px; letter-spacing: 0.04em; font-weight: 700; color: var(--ink-soft); }
.topbar .row1 .live { display: inline-flex; align-items: center; gap: 5px; background: var(--ink); color: #fff; padding: 3px 8px; border-radius: 999px; font-size: 10px; letter-spacing: 0.08em; }
.topbar .row1 .live .d { width: 5px; height: 5px; border-radius: 50%; background: #ff4d4d; animation: blink 1200ms ease-in-out infinite; }
@keyframes blink { 50% { opacity: 0.2; } }
.topbar h1 { margin-top: 6px; font-size: 28px; font-weight: 900; letter-spacing: -0.035em; line-height: 1.05; display: flex; align-items: baseline; gap: 8px; }
.topbar h1 .cd { margin-left: auto; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; background: var(--ink); color: var(--bg); padding: 4px 10px; border-radius: 8px; }
.topbar .sub { margin-top: 4px; font-size: 12px; color: var(--ink-soft); font-weight: 600; }
.filterRow { display: flex; gap: 6px; padding: 10px 16px 6px; overflow-x: auto; scrollbar-width: none; }
.filterRow::-webkit-scrollbar { display: none; }
.filterRow .chip { flex: 0 0 auto; height: 32px; padding: 0 14px; border-radius: 999px; background: var(--tile); border: 1px solid var(--rule); font-size: 12px; font-weight: 700; color: var(--ink-soft); }
.filterRow .chip.active { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.filterRow .chip .em { color: var(--discount); }
.bento { padding: 10px 14px 28px; display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; grid-auto-rows: 80px; grid-auto-flow: dense; }
.tile { border-radius: 22px; padding: 14px; position: relative; overflow: hidden; display: flex; flex-direction: column; transition: transform 200ms ease; opacity: 0; transform: translateY(14px); }
.tile.in { opacity: 1; transform: none; transition: opacity 420ms ease, transform 420ms ease; }
.tile:active { transform: scale(0.97); }
.span-hero { grid-column: span 6; grid-row: span 5; }
.span-large { grid-column: span 4; grid-row: span 4; }
.span-tall { grid-column: span 3; grid-row: span 5; }
.span-half { grid-column: span 3; grid-row: span 4; }
.span-mid { grid-column: span 3; grid-row: span 3; }
.span-wide { grid-column: span 6; grid-row: span 2; }
.span-thin { grid-column: span 2; grid-row: span 3; }
.t-cream { background: var(--t-cream); }
.t-rose { background: var(--t-rose); }
.t-mint { background: var(--t-mint); }
.t-lemon { background: var(--t-lemon); }
.t-sky { background: var(--t-sky); }
.t-lilac { background: var(--t-lilac); }
.t-peach { background: var(--t-peach); }
.t-coal { background: var(--t-coal); color: var(--bg); }
.t-tile { background: var(--tile); border: 1px solid var(--rule); }
.tile.hero { background: radial-gradient(120% 80% at 100% 0%, color-mix(in oklab, var(--t-peach), white 35%), transparent 60%), linear-gradient(135deg, var(--t-peach) 0%, var(--t-cream) 100%); padding: 18px 18px 16px; }
.tile.hero .kicker { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; background: var(--ink); color: var(--bg); padding: 4px 10px; border-radius: 999px; align-self: flex-start; }
.tile.hero .kicker .d { width: 5px; height: 5px; border-radius: 50%; background: #ff4d4d; }
.tile.hero .pic { position: absolute; right: -14px; top: 30px; width: 200px; height: 200px; border-radius: 24px; background: rgba(255,255,255,0.5); backdrop-filter: blur(8px); transform: rotate(-6deg); display: grid; place-items: center; overflow: hidden; }
.tile.hero .pic::after { content: var(--em, "🛒"); font-size: 130px; line-height: 1; filter: drop-shadow(0 12px 24px rgba(0,0,0,0.18)); }
.tile.hero .name { margin-top: 14px; font-size: 30px; font-weight: 900; letter-spacing: -0.035em; line-height: 1; }
.tile.hero .spec { margin-top: 4px; font-size: 12px; color: var(--ink); opacity: 0.65; font-weight: 600; }
.tile.hero .priceBlock { margin-top: auto; display: flex; align-items: baseline; gap: 8px; }
.tile.hero .orig { font-size: 13px; opacity: 0.55; text-decoration: line-through; }
.tile.hero .sale { font-size: 44px; font-weight: 900; letter-spacing: -0.04em; line-height: 1; }
.tile.hero .sale .won { font-size: 18px; font-weight: 800; margin-left: 1px; }
.tile.hero .footer { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 11px; font-weight: 700; }
.tile.hero .progress { flex: 1; height: 6px; border-radius: 4px; background: rgba(14,13,12,0.12); overflow: hidden; }
.tile.hero .progress .fill { height: 100%; background: var(--ink); width: var(--sold, 60%); border-radius: 4px; }
.tile.hero .cta { align-self: flex-start; margin-top: 12px; display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px 0 16px; border-radius: 999px; background: var(--ink); color: var(--bg); font-size: 13px; font-weight: 800; letter-spacing: -0.01em; border: 0; }
.tile.hero .cta svg { width: 14px; height: 14px; }
.tile .badge { display: inline-flex; align-items: center; align-self: flex-start; background: var(--ink); color: var(--bg); padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; }
.tile.t-coal .badge { background: var(--bg); color: var(--ink); }
.tile .productEmoji { align-self: flex-end; font-size: 56px; line-height: 1; margin: -8px -8px 0 0; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.12)); }
.tile.large .productEmoji { font-size: 72px; }
.tile .name { margin-top: 4px; font-size: 16px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
.tile .spec { margin-top: 2px; font-size: 10px; opacity: 0.6; font-weight: 600; }
.tile .priceLine { margin-top: auto; display: flex; align-items: baseline; gap: 4px; }
.tile .priceLine .off { font-size: 13px; font-weight: 900; color: var(--discount); }
.tile.t-coal .priceLine .off { color: var(--t-lemon); }
.tile .priceLine .sale { font-size: 22px; font-weight: 900; letter-spacing: -0.025em; }
.tile .priceLine .sale .won { font-size: 11px; font-weight: 800; }
.tile .orig { font-size: 11px; opacity: 0.55; text-decoration: line-through; }
.tile.countdown { background: var(--ink); color: var(--bg); display: flex; flex-direction: column; justify-content: space-between; }
.tile.countdown .lbl { font-size: 10px; letter-spacing: 0.18em; opacity: 0.65; font-weight: 700; text-transform: uppercase; }
.tile.countdown .clock { font-size: 32px; font-weight: 900; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.tile.countdown .clock em { font-style: normal; color: var(--color-accent); }
.tile.countdown .meta { font-size: 11px; opacity: 0.85; font-weight: 600; }
.tile.stats .num { font-size: 38px; font-weight: 900; letter-spacing: -0.03em; line-height: 1; color: var(--color-primary); }
.tile.stats .num small { font-size: 14px; font-weight: 800; color: var(--ink); margin-left: 1px; }
.tile.stats .lbl { font-size: 10px; letter-spacing: 0.16em; opacity: 0.55; font-weight: 700; text-transform: uppercase; }
.tile.stats .meta { font-size: 12px; opacity: 0.7; font-weight: 600; }
.tile.card { background: var(--t-coal); color: var(--bg); justify-content: space-between; }
.tile.card .lbl { font-size: 9px; letter-spacing: 0.2em; opacity: 0.55; font-weight: 700; text-transform: uppercase; }
.tile.card .v { font-size: 17px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1; }
.tile.card .v em { font-style: normal; color: var(--color-accent); }
.tile.ctaWide { background: var(--ink); color: var(--bg); flex-direction: row; align-items: center; gap: 12px; justify-content: space-between; }
.tile.ctaWide .l { display: flex; flex-direction: column; gap: 2px; }
.tile.ctaWide .l .t1 { font-size: 16px; font-weight: 900; letter-spacing: -0.02em; }
.tile.ctaWide .l .t2 { font-size: 11px; opacity: 0.6; font-weight: 600; }
.tile.ctaWide .r { width: 44px; height: 44px; border-radius: 50%; background: var(--color-primary); color: var(--color-on-primary); display: grid; place-items: center; }
.tile.ctaWide .r svg { width: 20px; height: 20px; }
.tile.more { background: transparent; border: 2px dashed var(--rule); justify-content: center; align-items: center; color: var(--ink-soft); font-weight: 700; font-size: 13px; gap: 6px; flex-direction: row; }
.tile.more .ic { font-size: 22px; line-height: 1; }
.tile.flash { animation: flashPulse 1600ms ease-in-out infinite; }
@keyframes flashPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); } 50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); } }
@media (max-width: 360px) {
  .bento { grid-template-columns: repeat(4, 1fr); }
  .span-hero, .span-large, .span-wide { grid-column: span 4; }
  .span-tall, .span-half, .span-mid, .span-thin { grid-column: span 2; }
}
</style>
</head>
<body>
<header class="topbar">
  <div class="row1"><span class="live"><span class="d"></span>LIVE</span> 오늘의 핫딜 · ${esc(d.storeName)}</div>
  <h1>지금만 이 가격<span class="cd" id="cdMain">02:14:33</span></h1>
  <div class="sub">${esc(d.period)} · 카드 ${total}장</div>
</header>
<nav class="filterRow" aria-label="카테고리">${chips.join('')}</nav>
<main class="bento" id="bento">
${tiles.join('\n')}
</main>
<script>
(function(){
  var tiles = document.querySelectorAll('.tile');
  var io = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.05 });
  tiles.forEach(function(t, i) { t.style.transitionDelay = (i * 35) + 'ms'; io.observe(t); });
  function pad(n) { return String(n).padStart(2, '0'); }
  var totalSec = 49 * 60 + 12, mainSec = 2 * 3600 + 14 * 60 + 33;
  setInterval(function() {
    totalSec = Math.max(0, totalSec - 1);
    var cmm = document.getElementById('cmm'), css = document.getElementById('css');
    if (cmm) cmm.textContent = pad(Math.floor(totalSec / 60));
    if (css) css.textContent = pad(totalSec % 60);
    mainSec = Math.max(0, mainSec - 1);
    var h = Math.floor(mainSec / 3600), m = Math.floor((mainSec % 3600) / 60), s = mainSec % 60;
    var cdMain = document.getElementById('cdMain');
    if (cdMain) cdMain.textContent = pad(h) + ':' + pad(m) + ':' + pad(s);
  }, 1000);
  document.querySelectorAll('.filterRow .chip').forEach(function(c) {
    c.addEventListener('click', function() {
      document.querySelectorAll('.filterRow .chip').forEach(function(x) { x.classList.remove('active'); });
      c.classList.add('active');
    });
  });
  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev) {
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });
})();
</script>
</body>
</html>`;
}

// ============================================================
// ★ D155: GRID MUJI 엔진 (04b-grid-muji.html 동적 변환)
// MUJI 미니멀 / Hahmlet serif + JetBrains Mono / red sparingly / 카테고리 section + pgrid 2col
// ============================================================

/**
 * ★ GRID MUJI 엔진 — Claude Design 04b-grid-muji.html 동적 변환 (D155 PHASE 0 트랙 A 확장)
 *
 * 매우 조용한(quiet) 톤. featureCard(NO.01 큰 카드) + 카테고리별 cat section + pgrid 2col.
 * scrollspy catnav + secDivider 큰 quiet 숫자 + about block + dock.
 * 시즌 토큰 7종.
 */
export function renderGridMujiEngine(d: FlyerRenderData, token: SeasonToken): string {
  const items = flattenItems(d);
  const total = items.length;
  const featured = items.length > 0 ? items[0] : null;
  const ogTitle = d.storeName + ' · 위클리 카탈로그';
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice) + '원').join(' · ');
  const ogImage = buildOgImageUrl(d, token);

  // 매장 정보
  const phoneLink = (d.externalLinks || []).find(l => l.icon === 'phone');
  const mapLink = (d.externalLinks || []).find(l => l.icon === 'map');
  const hoursAnn = (d.announcements || []).find(a => a.title.indexOf('영업') >= 0 || a.title.indexOf('시간') >= 0);
  const addressAnn = (d.announcements || []).find(a => a.title.indexOf('주소') >= 0);

  // hero stand (카테고리 분포)
  const catSummary = d.categories.map(c => esc(c.name) + ' ' + c.items.length + '종').join(' · ');

  // catnav chips
  const catChips = d.categories.map((c, ci) => {
    return '<button class="chip' + (ci === 0 ? ' active' : '') + '" data-target="sec-' + ci + '">' + esc(c.name) + '<span class="num">' + String(c.items.length).padStart(2, '0') + '</span></button>';
  }).join('');

  // 카테고리별 section + pgrid
  let cardIdx = featured ? 1 : 0; // featured는 NO.01, 일반 grid는 NO.02부터
  const catSections: string[] = [];
  d.categories.forEach((cat, ci) => {
    // 첫 카테고리 첫 상품은 featured에 박힘 — pgrid에서 제외
    const gridItems = ci === 0 ? cat.items.slice(1) : cat.items;
    if (gridItems.length === 0 && ci === 0 && cat.items.length === 1) {
      // featured만 있고 grid 0건 — section skip
      return;
    }

    const lede = ci === 0
      ? '주말 가족 한 끼를 위한 ' + cat.items.length + '가지.'
      : '이번 주 새벽에 도착한 ' + cat.items.length + '가지.';

    const grid: string[] = [];
    gridItems.forEach((it) => {
      cardIdx++;
      const idStr = String(cardIdx).padStart(2, '0');
      const disc = calcDisc(it.originalPrice, it.salePrice);
      const badgeText = it.badge || (disc > 0 ? disc + '%↓' : '특가');
      const tagOnly = it.badge && (it.badge.indexOf('한정') >= 0 || it.badge.indexOf('1+1') >= 0);
      const phStyle = it.imageUrl
        ? 'background:url(\'' + esc(toAbsUrl(it.imageUrl) || '') + '\') center/cover;'
        : '--ph-bg:' + categoryBg(cat.name) + '; --ph-emoji:\'' + categoryPictogram(cat.name) + '\';';
      grid.push(
        '<article class="pcard"' + productDataAttr(it, cat.name) + '>' +
          '<div class="pic">' +
            '<span class="id">No.' + idStr + '</span>' +
            '<div class="ph" style="' + phStyle + '"></div>' +
            '<button class="add" aria-label="담기">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="nameRow">' +
            '<span class="badge' + (tagOnly ? ' tag' : '') + '">' + esc(badgeText) + '</span>' +
          '</div>' +
          '<div class="nm">' + esc(it.name) + '</div>' +
          '<div class="specs">' + esc(it.unit || '') + (it.unit && it.origin ? ' · ' : '') + esc(it.origin || '') + '</div>' +
          '<div class="price">' +
            (it.originalPrice > 0 ? '<span class="orig price-num">' + fmtPrice(it.originalPrice) + '</span>' : '') +
            '<span class="sale price-num">' + fmtPrice(it.salePrice) + '<span class="won">원</span></span>' +
          '</div>' +
          (it.aiCopy ? '<div class="unitp">' + esc(it.aiCopy) + '</div>' : '') +
          (it.cardDiscount && it.cardDiscount !== '—' ? '<div class="cardDisc">' + esc(it.cardDiscount) + '</div>' : '') +
        '</article>'
      );
    });

    if (grid.length === 0) return;
    catSections.push(
      '<section class="cat" id="sec-' + ci + '">' +
        '<div class="head">' +
          '<span class="no">No. ' + String(ci + 1).padStart(2, '0') + '</span>' +
          '<h3 class="ser">' + esc(cat.name) + '</h3>' +
          '<span class="ct">' + String(cat.items.length).padStart(2, '0') + ' ITEMS</span>' +
        '</div>' +
        '<p class="lede">' + esc(lede) + '</p>' +
        '<div class="pgrid">' + grid.join('') + '</div>' +
      '</section>'
    );
  });

  const issuePeriod = d.periodStart && d.periodEnd
    ? esc(d.periodStart.replace(/-/g, '.').slice(5).replace(/^0/, '')) + ' — ' + esc(d.periodEnd.replace(/-/g, '.').slice(5).replace(/^0/, ''))
    : esc(d.period || '');
  const weekNum = Math.ceil((new Date().getTime() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 604800000);
  const yyyy = String(new Date().getFullYear());

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@300;400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #C8261A;
  --color-accent:  #1E1E1E;
  --color-on-primary: #FFFFFF;
  --ink: #1A1A1A;
  --ink-2: #2E2E2E;
  --ink-3: #6E6E6E;
  --ink-4: #9E9E9E;
  --paper: #FAFAFA;
  --paper-2: #F1EFEB;
  --rule: #E2E0DB;
  --rule-strong: #1A1A1A;
}
${seasonStyleBlock()}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--paper); color: var(--ink); }
body { font-family: 'Pretendard Variable', sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 96px; }
button { font-family: inherit; cursor: pointer; }
.price-num { font-variant-numeric: tabular-nums; }
.mono { font-family: 'JetBrains Mono', monospace; font-weight: 400; }
.ser { font-family: 'Hahmlet', serif; }
.topbar { position: sticky; top: 0; z-index: 30; background: rgba(250,250,250,0.95); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid var(--rule); height: 44px; display: flex; align-items: center; padding: 0 8px; }
.topbar .btn { width: 36px; height: 36px; border: 0; background: transparent; color: var(--ink); display: grid; place-items: center; }
.topbar svg { width: 18px; height: 18px; }
.topbar .crumbs { flex: 1; display: flex; flex-direction: column; padding: 0 6px; }
.topbar .crumbs .a { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.16em; color: var(--ink-3); text-transform: uppercase; }
.topbar .crumbs .b { font-size: 13px; font-weight: 700; letter-spacing: -0.01em; margin-top: -1px; }
.hero { padding: 40px 22px 0; }
.hero .eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.18em; color: var(--ink-3); font-weight: 500; display: flex; align-items: center; gap: 10px; }
.hero .eyebrow::before { content: ""; width: 24px; height: 1px; background: var(--ink-3); }
.hero h1 { margin-top: 14px; font-family: 'Hahmlet', serif; font-size: 44px; font-weight: 400; line-height: 1.12; letter-spacing: -0.025em; color: var(--ink); max-width: 320px; }
.hero h1 em { font-style: normal; font-weight: 700; }
.hero .stand { margin-top: 22px; font-size: 14px; line-height: 1.7; color: var(--ink-2); max-width: 320px; }
.hero .info { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--ink); padding-top: 14px; }
.hero .info .c { display: flex; flex-direction: column; gap: 2px; }
.hero .info .k { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.16em; color: var(--ink-3); text-transform: uppercase; }
.hero .info .v { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.featureCard { margin: 22px 22px 0; display: grid; grid-template-columns: 1fr; gap: 14px; padding-top: 22px; border-top: 1px solid var(--ink); }
.featureCard .pic { aspect-ratio: 4/3; background: var(--paper-2); position: relative; overflow: hidden; }
.ph { position: absolute; inset: 0; display: grid; place-items: center; background: var(--ph-bg, var(--paper-2)); }
.ph::after { content: var(--ph-emoji, ""); font-size: 130px; line-height: 1; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.10)); }
.featureCard .pic .id { position: absolute; left: 14px; top: 14px; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; color: var(--ink-3); }
.featureCard .info { display: flex; flex-direction: column; gap: 6px; }
.featureCard .id2 { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.18em; color: var(--ink-3); text-transform: uppercase; }
.featureCard h2 { font-family: 'Hahmlet', serif; font-size: 26px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.15; }
.featureCard .specs { margin-top: 4px; font-size: 12px; color: var(--ink-3); line-height: 1.6; }
.featureCard .specs .sep { color: var(--ink-4); margin: 0 6px; }
.featureCard .priceRow { margin-top: 12px; display: flex; align-items: baseline; gap: 12px; }
.featureCard .priceRow .orig { font-family: 'JetBrains Mono', monospace; font-size: 12px; text-decoration: line-through; color: var(--ink-3); }
.featureCard .priceRow .sale { font-family: 'Hahmlet', serif; font-size: 32px; font-weight: 700; letter-spacing: -0.025em; color: var(--color-primary); }
.featureCard .priceRow .sale .won { font-size: 14px; font-weight: 500; margin-left: 1px; }
.featureCard .unitp { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-3); }
.featureCard .add { margin-top: 16px; height: 48px; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); font-weight: 700; font-size: 14px; letter-spacing: -0.01em; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: background 200ms; }
.featureCard .add:hover { background: var(--ink); color: var(--paper); }
.featureCard .add svg { width: 14px; height: 14px; }
.catnav { position: sticky; top: 44px; z-index: 25; background: rgba(250,250,250,0.95); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-top: 1px solid var(--ink); border-bottom: 1px solid var(--rule); margin-top: 36px; }
.catnav .scroll { display: flex; overflow-x: auto; scrollbar-width: none; padding: 0 12px; }
.catnav .scroll::-webkit-scrollbar { display: none; }
.catnav .chip { flex: 0 0 auto; padding: 14px 12px; background: transparent; border: 0; font-size: 13px; font-weight: 500; color: var(--ink-3); position: relative; letter-spacing: -0.01em; }
.catnav .chip .num { font-family: 'JetBrains Mono', monospace; font-size: 10px; opacity: 0.6; margin-left: 4px; }
.catnav .chip.active { color: var(--ink); font-weight: 700; }
.catnav .chip.active::after { content: ""; position: absolute; left: 12px; right: 12px; bottom: -1px; height: 2px; background: var(--ink); }
.cat { padding: 30px 22px 0; }
.cat .head { display: flex; align-items: baseline; gap: 10px; border-bottom: 1px solid var(--ink); padding-bottom: 6px; }
.cat .head .no { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.16em; color: var(--ink-3); }
.cat .head h3 { font-family: 'Hahmlet', serif; font-size: 22px; font-weight: 500; letter-spacing: -0.02em; }
.cat .head .ct { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-3); }
.cat .lede { margin-top: 12px; font-size: 13px; color: var(--ink-2); line-height: 1.65; max-width: 300px; }
.pgrid { margin-top: 22px; display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--rule); }
.pgrid .pcard { padding: 16px 0 20px; display: flex; flex-direction: column; position: relative; }
.pgrid .pcard:nth-child(odd) { padding-right: 12px; border-right: 1px solid var(--rule); }
.pgrid .pcard:nth-child(even) { padding-left: 12px; }
.pgrid .pcard:not(:nth-last-child(-n+2)) { border-bottom: 1px solid var(--rule); }
.pcard .pic { aspect-ratio: 1/1; background: var(--paper-2); position: relative; overflow: hidden; }
.pcard .pic .id { position: absolute; left: 8px; top: 8px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--ink-3); letter-spacing: 0.1em; }
.pcard .pic .add { position: absolute; right: 8px; bottom: 8px; width: 30px; height: 30px; border-radius: 50%; background: var(--paper); border: 1px solid var(--ink); color: var(--ink); display: grid; place-items: center; cursor: pointer; transition: background 200ms; }
.pcard .pic .add svg { width: 12px; height: 12px; }
.pcard .nameRow { margin-top: 12px; display: flex; align-items: baseline; gap: 6px; }
.pcard .badge { flex: 0 0 auto; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.08em; color: var(--color-primary); font-weight: 500; line-height: 1; margin-top: 2px; }
.pcard .badge.tag { color: var(--ink); }
.pcard .nm { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 35px; }
.pcard .specs { margin-top: 4px; font-size: 11px; color: var(--ink-3); font-family: 'JetBrains Mono', monospace; line-height: 1.5; }
.pcard .price { margin-top: 10px; display: flex; align-items: baseline; gap: 6px; }
.pcard .price .orig { font-family: 'JetBrains Mono', monospace; font-size: 11px; text-decoration: line-through; color: var(--ink-3); }
.pcard .price .sale { font-family: 'Hahmlet', serif; font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); }
.pcard .price .sale .won { font-size: 10px; font-weight: 500; margin-left: 1px; }
.pcard .unitp { margin-top: 4px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-3); }
.pcard .cardDisc { margin-top: 6px; font-size: 10px; color: var(--ink-3); font-style: italic; }
.secDivider { margin: 60px 22px 0; padding: 28px 0; border-top: 1px solid var(--ink); display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: end; }
.secDivider .big { font-family: 'Hahmlet', serif; font-size: 96px; line-height: 0.8; font-weight: 400; letter-spacing: -0.04em; color: var(--ink); }
.secDivider .right { padding-bottom: 6px; display: flex; flex-direction: column; gap: 4px; font-family: 'JetBrains Mono', monospace; }
.secDivider .right .lbl { font-size: 10px; letter-spacing: 0.18em; color: var(--ink-3); text-transform: uppercase; }
.secDivider .right .v { font-size: 14px; font-weight: 500; color: var(--ink); }
.about { margin: 50px 22px 0; padding: 28px 0 0; border-top: 1px solid var(--ink); }
.about .lbl { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.18em; color: var(--ink-3); text-transform: uppercase; }
.about h4 { margin-top: 10px; font-family: 'Hahmlet', serif; font-size: 24px; font-weight: 400; letter-spacing: -0.02em; line-height: 1.3; max-width: 320px; }
.about p { margin-top: 16px; font-size: 13px; line-height: 1.75; color: var(--ink-2); max-width: 320px; }
.ft { margin: 50px 22px 0; padding-top: 22px; border-top: 1px solid var(--ink); }
.ft .row { display: grid; grid-template-columns: 88px 1fr; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--rule); align-items: baseline; }
.ft .k { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.14em; color: var(--ink-3); text-transform: uppercase; }
.ft .v { font-size: 13px; font-weight: 500; }
.ft .small { margin-top: 18px; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.08em; color: var(--ink-3); text-align: center; padding: 12px 0; border-top: 1px solid var(--ink); }
.dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)); background: rgba(250,250,250,0.97); backdrop-filter: blur(14px); border-top: 1px solid var(--ink); }
.dock .bar { height: 48px; background: var(--ink); color: var(--paper); display: flex; align-items: center; gap: 12px; padding: 0 12px 0 14px; }
.dock .ct { width: 24px; height: 24px; background: var(--paper); color: var(--ink); font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 12px; display: grid; place-items: center; }
.dock .tt { display: flex; flex-direction: column; line-height: 1.1; }
.dock .tt .a { font-size: 13px; font-weight: 700; letter-spacing: -0.01em; }
.dock .tt .b { font-size: 10px; opacity: 0.6; font-family: 'JetBrains Mono', monospace; }
.dock .arr { margin-left: auto; }
.dock .arr svg { width: 16px; height: 16px; }
</style>
</head>
<body>
<header class="topbar">
  <button class="btn" aria-label="메뉴"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  <div class="crumbs">
    <div class="a">${esc(issuePeriod)}</div>
    <div class="b">${esc(d.storeName)}</div>
  </div>
  <button class="btn" aria-label="검색"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></button>
  <button class="btn" aria-label="찜"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg></button>
</header>
<section class="hero">
  <div class="eyebrow">${esc(d.period || issuePeriod)}</div>
  <h1 class="ser">이번 주<br><em>${total}가지</em>를<br>골랐습니다.</h1>
  <p class="stand">${esc(d.storeName)}이 새벽 시장에서 직접 본 것만 매대에 올립니다.${catSummary ? ' 이번 주는 ' + esc(catSummary) + '.' : ''}</p>
  <div class="info">
    <div class="c"><div class="k">기간</div><div class="v">${esc(d.period || '')}</div></div>
    <div class="c"><div class="k">총 행사 수</div><div class="v">${total} 품목</div></div>
  </div>
</section>
${featured ? `
<article class="featureCard"${productDataAttr(featured, featured.category || '')}>
  <div class="pic">
    <span class="id">NO.01 · FEATURE</span>
    <div class="ph" style="${featured.imageUrl ? `background:url('${esc(toAbsUrl(featured.imageUrl) || '')}') center/cover;` : `--ph-bg:${categoryBg(featured.category || '')}; --ph-emoji:'${categoryPictogram(featured.category || '')}';`}"></div>
  </div>
  <div class="info">
    <div class="id2 mono">No. 01 · ${esc(featured.category || '')}${featured.unit ? ' · ' + esc(featured.unit) : ''}</div>
    <h2 class="ser">${esc(featured.name)}${featured.aiCopy ? ', ' + esc(featured.aiCopy) : '.'}</h2>
    <div class="specs">${esc(featured.origin || '')}${featured.unit ? ' <span class="sep">/</span> ' + esc(featured.unit) : ''}${featured.badge ? ' <span class="sep">/</span> ' + esc(featured.badge) : ''}</div>
    <div class="priceRow">
      ${featured.originalPrice > 0 ? `<span class="orig price-num">${fmtPrice(featured.originalPrice)}원</span>` : ''}
      <span class="sale price-num">${fmtPrice(featured.salePrice)}<span class="won">원</span></span>
    </div>
    ${featured.cardDiscount && featured.cardDiscount !== '—' ? `<div class="unitp">${esc(featured.cardDiscount)}</div>` : ''}
    <button class="add" aria-label="담기">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      카트에 담기
    </button>
  </div>
</article>` : ''}
<nav class="catnav" aria-label="카테고리">
  <div class="scroll" id="catnav">${catChips}</div>
</nav>
<main id="main">
${catSections.join('\n')}
</main>
<section class="secDivider">
  <span class="big ser">${String(total).padStart(2, '0')}</span>
  <div class="right">
    <div class="lbl">total items</div>
    <div class="v">${yyyy} · ${weekNum}주차</div>
  </div>
</section>
<section class="about">
  <div class="lbl">about this week</div>
  <h4 class="ser">매주 다르지만,<br>고르는 기준은 같습니다.</h4>
  <p>이번 주에 어떤 상품이 좋은지 결정할 때, 우리는 가격이 가장 싼 것보다 그 가격으로 살 가치가 있는 것을 먼저 봅니다. 산지 · 신선도 · 손질 상태 — 사장님이 새벽 도매 시장에서 직접 본 후 매대에 올립니다.</p>
</section>
<footer class="ft">
  <div class="row"><div class="k">store</div><div class="v">${esc(d.storeName)}</div></div>
  <div class="row"><div class="k">hours</div><div class="v">${esc(hoursAnn ? hoursAnn.content : '문의 매장')}</div></div>
  <div class="row"><div class="k">tel</div><div class="v">${esc(phoneLink ? phoneLink.label : '문의 매장')}</div></div>
  <div class="row"><div class="k">addr</div><div class="v">${esc(addressAnn ? addressAnn.content : (mapLink ? mapLink.label : '매장 위치'))}</div></div>
  <div class="row"><div class="k">period</div><div class="v">${esc(d.period)}</div></div>
  <div class="small mono">PUBLISHED VIA HANJUL · ${esc(d.storeName)} / ${yyyy}</div>
</footer>
<div class="dock">
  <div class="bar">
    <span class="ct">00</span>
    <div class="tt">
      <span class="a">장바구니</span>
      <span class="b">담은 상품 없음</span>
    </div>
    <div class="arr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></div>
  </div>
</div>
<script>
(function(){
  document.querySelectorAll('.catnav .chip').forEach(function(c) {
    c.addEventListener('click', function() {
      var t = document.getElementById(c.dataset.target);
      if (t) window.scrollTo({ top: t.offsetTop - 92, behavior: 'smooth' });
    });
  });
  var sections = [].slice.call(document.querySelectorAll('.cat'));
  function spy() {
    var y = window.scrollY + 110;
    var active = sections[0] ? sections[0].id : '';
    sections.forEach(function(s) { if (s.offsetTop <= y) active = s.id; });
    document.querySelectorAll('.catnav .chip').forEach(function(c) { c.classList.toggle('active', c.dataset.target === active); });
  }
  document.addEventListener('scroll', spy, { passive: true });
  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev) {
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });
})();
</script>
</body>
</html>`;
}

// ============================================================
// ★ D155: CATALOG DARK 엔진 (05b-catalog-dark.html 동적 변환)
// Netflix NOW PLAYING 다크 모드 / hero featured + 카테고리별 swipe row + album cover
// ============================================================

const DARK_ALBUM_BGS = ['#3a1818', '#4a1a1a', '#3e2c10', '#0e2540', '#162a1a', '#2e1d10', '#3f2f10', '#222226', '#3a1414', '#1a2540'];

/**
 * ★ CATALOG DARK 엔진 — Claude Design 05b-catalog-dark.html 동적 변환 (D155 PHASE 0 트랙 A 확장)
 *
 * 다크 모드 + 음악 스트리밍 풍. hero featured(NO.1 큰 카드) + storeNow + 카테고리별 swipe row.
 * 첫 row = large 사이즈(220px album), 나머지 = 일반 168px.
 * 시즌 토큰 다크 정합 7종.
 */
export function renderCatalogDarkEngine(d: FlyerRenderData, token: SeasonToken): string {
  const items = flattenItems(d);
  const total = items.length;
  const featured = items.length > 0 ? items[0] : null;
  const ogTitle = d.storeName + ' · NOW PLAYING';
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice) + '원').join(' · ');
  const ogImage = buildOgImageUrl(d, token);

  // 매장 정보
  const phoneLink = (d.externalLinks || []).find(l => l.icon === 'phone');
  const mapLink = (d.externalLinks || []).find(l => l.icon === 'map');

  const issuePeriod = d.periodStart && d.periodEnd
    ? d.periodStart.replace(/-/g, '.').slice(5) + ' — ' + d.periodEnd.replace(/-/g, '.').slice(5)
    : (d.period || '');

  // 카테고리별 row + 첫 row = Editor's Pick(전체 top N max disc)
  const editorsPickItems = items
    .map(it => ({ it, disc: calcDisc(it.originalPrice, it.salePrice) }))
    .sort((a, b) => b.disc - a.disc)
    .slice(0, Math.min(5, items.length))
    .map(x => x.it);

  function buildPCard(it: FlyerRenderItem & { category: string }, idx: number, isFirst: boolean, allCount: number): string {
    const disc = calcDisc(it.originalPrice, it.salePrice);
    const tagOnly = it.badge && (it.badge.indexOf('한정') >= 0 || it.badge.indexOf('1+1') >= 0);
    const badgeText = it.badge || (disc > 0 ? disc + '%↓' : '특가');
    const bgColor = DARK_ALBUM_BGS[idx % DARK_ALBUM_BGS.length];
    const albumStyle = it.imageUrl
      ? `background:url('${esc(toAbsUrl(it.imageUrl) || '')}') center/cover;`
      : `--ph-bg:${bgColor}; --ph-emoji:'${categoryPictogram(it.category)}';`;
    const duration = it.badge && it.badge.indexOf('오늘') >= 0 ? '오늘' : '7일';
    const playingCls = isFirst && allCount > 1 ? ' playing' : '';
    const offText = disc > 0 ? disc + '%' : (it.badge || '특가');

    return (
      '<article class="pcard' + playingCls + '"' + productDataAttr(it, it.category) + '>' +
        '<div class="album" style="' + albumStyle + '">' +
          '<div class="grain"></div>' +
          '<span class="badge' + (tagOnly ? '' : ' hot') + '">' + esc(badgeText) + '</span>' +
          '<span class="duration">' + esc(duration) + ' 남음</span>' +
          '<div class="eq" aria-hidden="true"><i></i><i></i><i></i></div>' +
          '<button class="playOverlay" aria-label="담기">' +
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="info">' +
          '<div class="nm">' + esc(it.name) + '</div>' +
          '<div class="by">' + esc(it.category) + (it.unit ? ' · ' + esc(it.unit) : '') + (it.origin ? ' · ' + esc(it.origin) : '') + '</div>' +
          '<div class="priceRow">' +
            (disc > 0 ? '<span class="off">' + offText + '</span>' : '') +
            '<span class="sale price-num">' + fmtPrice(it.salePrice) + '<span class="won">원</span></span>' +
          '</div>' +
          (it.originalPrice > 0 ? '<div class="orig price-num">' + fmtPrice(it.originalPrice) + '원</div>' : '') +
        '</div>' +
      '</article>'
    );
  }

  const rows: string[] = [];

  // Editor's Pick row (전체 max disc Top 5) — large
  if (editorsPickItems.length > 0 && items.length > 1) {
    const cards = editorsPickItems.map((it, idx) => buildPCard(it as any, idx, idx === 0, editorsPickItems.length)).join('');
    rows.push(
      '<section class="row large">' +
        '<div class="head">' +
          '<div>' +
            '<div class="h"><span class="tt">Editor\'s Pick</span><span class="nn">' + editorsPickItems.length + '곡</span></div>' +
            '<div class="sub">이번 주 사장님이 직접 고른 ' + editorsPickItems.length + '가지</div>' +
          '</div>' +
          '<button class="more">SHOW ALL</button>' +
        '</div>' +
        '<div class="swipe">' + cards + '</div>' +
      '</section>'
    );
  }

  // 카테고리별 row
  d.categories.forEach((cat, ci) => {
    const cards = cat.items.map((it, idx) => buildPCard({ ...it, category: cat.name } as any, idx, false, cat.items.length)).join('');
    const sub = ci === 0 ? '주말 한 끼, 두툼하게' : (ci === 1 ? '햇과일이 도착했어요' : '새벽 활어차 직접 입고');
    rows.push(
      '<section class="row">' +
        '<div class="head">' +
          '<div>' +
            '<div class="h"><span class="tt">' + esc(cat.name) + '</span><span class="nn">' + cat.items.length + '곡</span></div>' +
            '<div class="sub">' + esc(sub) + '</div>' +
          '</div>' +
          '<button class="more">SHOW ALL</button>' +
        '</div>' +
        '<div class="swipe">' + cards + '</div>' +
      '</section>'
    );
  });

  const storeInitial = (d.storeName || '?').trim()[0] || '?';
  const featuredDisc = featured ? calcDisc(featured.originalPrice, featured.salePrice) : 0;

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #F97316;
  --color-accent: #EF4444;
  --color-on-primary: #FFFFFF;
  --bg: #0A0A0B;
  --bg-2: #131316;
  --bg-3: #1B1B20;
  --bg-elev: #232328;
  --text: #F4F4F5;
  --text-soft: #A8A8AE;
  --text-dim: #6C6C72;
  --rule: rgba(255,255,255,0.08);
  --rule-strong: rgba(255,255,255,0.18);
  --discount: #FF6B5B;
}
html[data-season="newyear"]   { --color-primary:#FF4D4D; --color-accent:#FFB020; }
html[data-season="chuseok"]   { --color-primary:#5B8DEF; --color-accent:#FFB020; }
html[data-season="christmas"] { --color-primary:#34D399; --color-accent:#FF6B5B; }
html[data-season="summer"]    { --color-primary:#22D3EE; --color-accent:#06B6D4; }
html[data-season="winter"]    { --color-primary:#F472B6; --color-accent:#FB7185; }
html[data-season="grand_open"]{ --color-primary:#FBBF24; --color-accent:#F4F4F5; }
html[data-season="urgent"]    { --color-primary:#F4F4F5; --color-accent:#EF4444; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--bg); color: var(--text); }
body { font-family: 'Pretendard Variable', sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 96px; }
button { font-family: inherit; cursor: pointer; }
.price-num { font-variant-numeric: tabular-nums; }
.topbar { position: sticky; top: 0; z-index: 40; height: 56px; padding: 0 12px; background: linear-gradient(180deg, var(--bg) 60%, transparent); display: flex; align-items: center; gap: 8px; }
.topbar.scrolled { background: rgba(10,10,11,0.94); backdrop-filter: blur(14px); border-bottom: 1px solid var(--rule); }
.topbar .btn { width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,0.06); border: 0; color: var(--text); display: grid; place-items: center; }
.topbar svg { width: 18px; height: 18px; }
.topbar .title { flex: 1; padding: 0 6px; display: flex; flex-direction: column; line-height: 1.1; }
.topbar .title .t1 { font-size: 14px; font-weight: 800; letter-spacing: -0.02em; }
.topbar .title .t2 { font-size: 11px; color: var(--text-soft); font-weight: 500; margin-top: 1px; }
.hero { margin: 8px 16px 0; border-radius: 20px; background: radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, var(--color-primary), black 30%), transparent 60%), linear-gradient(135deg, color-mix(in oklab, var(--color-primary), black 30%) 0%, color-mix(in oklab, var(--color-accent), black 50%) 100%); padding: 18px 18px 16px; position: relative; overflow: hidden; }
.hero::before { content: ""; position: absolute; inset: 0; background: radial-gradient(40% 30% at 100% 0%, rgba(255,255,255,0.18), transparent 60%); }
.hero .lbl { position: relative; z-index: 1; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; font-weight: 700; opacity: 0.85; }
.hero h1 { position: relative; z-index: 1; margin-top: 8px; font-size: 28px; font-weight: 900; letter-spacing: -0.035em; line-height: 1.05; max-width: 220px; }
.hero .meta { position: relative; z-index: 1; margin-top: 6px; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; opacity: 0.85; }
.hero .meta .dot { width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: 0.6; }
.hero .albumArt { position: absolute; right: -8px; top: 14px; width: 130px; height: 130px; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 40px -10px rgba(0,0,0,0.6); background: rgba(0,0,0,0.3); display: grid; place-items: center; }
.hero .albumArt::after { content: var(--em, "🛒"); font-size: 80px; line-height: 1; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4)); }
.hero .actions { margin-top: 16px; display: flex; align-items: center; gap: 10px; position: relative; z-index: 1; }
.hero .play { width: 52px; height: 52px; border-radius: 50%; background: var(--text); color: var(--bg); border: 0; display: grid; place-items: center; box-shadow: 0 8px 18px rgba(0,0,0,0.3); }
.hero .play svg { width: 18px; height: 18px; transform: translateX(1px); }
.hero .iconbtn { width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.14); backdrop-filter: blur(6px); border: 0; color: var(--text); display: grid; place-items: center; }
.hero .iconbtn svg { width: 18px; height: 18px; }
.row { margin-top: 30px; }
.row .head { padding: 0 16px 12px; display: flex; align-items: baseline; justify-content: space-between; }
.row .head .h { display: flex; align-items: baseline; gap: 8px; }
.row .head .h .tt { font-size: 20px; font-weight: 900; letter-spacing: -0.025em; }
.row .head .h .nn { font-size: 11px; color: var(--text-dim); font-weight: 600; }
.row .head .sub { font-size: 11px; color: var(--text-soft); font-weight: 500; margin-top: 2px; }
.row .head .more { background: transparent; border: 0; color: var(--text-soft); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.swipe { display: flex; gap: 12px; overflow-x: auto; padding: 0 16px 12px; scroll-snap-type: x mandatory; scrollbar-width: none; }
.swipe::-webkit-scrollbar { display: none; }
.pcard { flex: 0 0 168px; scroll-snap-align: start; display: flex; flex-direction: column; position: relative; }
.pcard .album { aspect-ratio: 1/1; border-radius: 14px; position: relative; overflow: hidden; background: var(--bg-3); box-shadow: 0 8px 18px -8px rgba(0,0,0,0.6); background-color: var(--ph-bg, #2a2a30); transition: transform 200ms; }
.pcard:active .album { transform: scale(0.98); }
.album::after { content: var(--ph-emoji, ""); position: absolute; inset: 0; display: grid; place-items: center; font-size: 80px; line-height: 1; filter: drop-shadow(0 10px 18px rgba(0,0,0,0.5)); }
.album .grain { position: absolute; inset: 0; background: radial-gradient(120% 80% at 0% 0%, rgba(255,255,255,0.18), transparent 50%), radial-gradient(80% 60% at 100% 100%, rgba(0,0,0,0.4), transparent 60%); mix-blend-mode: overlay; }
.album .badge { position: absolute; left: 8px; top: 8px; padding: 4px 8px; border-radius: 999px; background: rgba(0,0,0,0.55); backdrop-filter: blur(8px); font-size: 10px; font-weight: 800; letter-spacing: 0.02em; color: var(--text); }
.album .badge.hot { background: var(--color-accent); }
.album .duration { position: absolute; right: 8px; bottom: 8px; padding: 3px 7px; border-radius: 6px; background: rgba(0,0,0,0.65); backdrop-filter: blur(6px); font-size: 10px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.album .playOverlay { position: absolute; right: 8px; bottom: 8px; width: 36px; height: 36px; border-radius: 50%; background: var(--color-primary); color: var(--color-on-primary); display: grid; place-items: center; opacity: 0; transform: translateY(6px); transition: opacity 180ms, transform 180ms; box-shadow: 0 4px 10px rgba(0,0,0,0.35); }
.pcard:hover .album .playOverlay, .pcard:active .album .playOverlay { opacity: 1; transform: translateY(0); }
.album .playOverlay svg { width: 14px; height: 14px; transform: translateX(1px); }
.pcard .info { margin-top: 10px; padding: 0 2px; }
.pcard .info .nm { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
.pcard .info .by { margin-top: 2px; font-size: 11px; color: var(--text-soft); font-weight: 500; }
.pcard .priceRow { margin-top: 8px; display: flex; align-items: baseline; gap: 6px; }
.pcard .off { font-size: 11px; font-weight: 800; color: var(--discount); }
.pcard .sale { font-size: 15px; font-weight: 900; letter-spacing: -0.02em; }
.pcard .sale .won { font-size: 10px; font-weight: 800; }
.pcard .orig { font-size: 10px; color: var(--text-dim); text-decoration: line-through; }
.pcard.playing .album { box-shadow: 0 0 0 2px var(--color-primary), 0 8px 18px -8px rgba(0,0,0,0.6); }
.pcard.playing .nm { color: var(--color-primary); }
.pcard .eq { position: absolute; left: 8px; top: 8px; display: flex; align-items: end; gap: 2px; height: 16px; background: rgba(0,0,0,0.55); backdrop-filter: blur(8px); padding: 3px 6px; border-radius: 999px; }
.pcard:not(.playing) .eq { display: none; }
.pcard .eq i { width: 2px; height: 10px; background: var(--color-primary); animation: eqBounce 800ms ease-in-out infinite; border-radius: 1px; }
.pcard .eq i:nth-child(2) { animation-delay: 120ms; }
.pcard .eq i:nth-child(3) { animation-delay: 240ms; }
@keyframes eqBounce { 0%, 100% { height: 4px; } 50% { height: 12px; } }
.row.large .swipe .pcard { flex-basis: 220px; }
.row.large .swipe .pcard .album { border-radius: 16px; }
.row.large .swipe .pcard .nm { font-size: 16px; }
.storeNow { margin: 30px 16px 0; padding: 14px; background: var(--bg-2); border: 1px solid var(--rule); border-radius: 18px; display: grid; grid-template-columns: 56px 1fr auto; gap: 12px; align-items: center; }
.storeNow .crest { width: 56px; height: 56px; border-radius: 14px; background: linear-gradient(135deg, var(--color-primary), var(--color-accent)); display: grid; place-items: center; font-weight: 900; font-size: 22px; color: var(--color-on-primary); }
.storeNow .l { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.storeNow .l .a { font-size: 10px; letter-spacing: 0.18em; color: var(--text-soft); text-transform: uppercase; font-weight: 700; }
.storeNow .l .b { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; margin-top: 2px; }
.storeNow .l .c { font-size: 11px; color: var(--text-soft); margin-top: 2px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
.storeNow .l .c .live { display: inline-flex; align-items: center; gap: 4px; color: #4ADE80; font-weight: 700; }
.storeNow .l .c .live .d { width: 6px; height: 6px; border-radius: 50%; background: #4ADE80; box-shadow: 0 0 6px #4ADE80; }
.storeNow .actions { display: flex; gap: 6px; }
.storeNow .actions a, .storeNow .actions button { width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,0.08); border: 0; color: var(--text); display: grid; place-items: center; text-decoration: none; }
.storeNow .actions a svg, .storeNow .actions button svg { width: 14px; height: 14px; }
.storeNow .actions .pr { background: var(--color-primary); color: var(--color-on-primary); }
.brand { margin: 36px 16px 18px; padding: 14px 0; border-top: 1px solid var(--rule); display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--text-dim); letter-spacing: 0.16em; text-transform: uppercase; }
.brand strong { color: var(--text); font-weight: 800; letter-spacing: -0.01em; text-transform: none; font-size: 13px; }
</style>
</head>
<body>
<header class="topbar" id="topbar">
  <button class="btn" aria-label="뒤로"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></button>
  <div class="title">
    <div class="t1">${esc(d.storeName)}</div>
    <div class="t2">이번 주 카탈로그 · ${esc(issuePeriod)}</div>
  </div>
  <button class="btn" aria-label="검색"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></button>
  <button class="btn" aria-label="더보기"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
</header>
${featured ? `
<section class="hero" style="--em: '${categoryPictogram(featured.category || '')}';"${productDataAttr(featured, featured.category || '')}>
  <div class="lbl">FEATURED · NO.1 THIS WEEK</div>
  <h1>${esc(featured.name)}${featured.unit ? '<br>' + esc(featured.unit) : ''}</h1>
  <div class="meta">
    <span>${esc(featured.category || '')}</span><span class="dot"></span>
    <span>${esc(featured.origin || '국산')}</span><span class="dot"></span>
    <span>${featuredDisc > 0 ? featuredDisc + '%↓ · ' : ''}${fmtPrice(featured.salePrice)}원</span>
  </div>
  <div class="albumArt"></div>
  <div class="actions">
    <button class="play" aria-label="담기">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    </button>
    <button class="iconbtn save" id="heroSave" aria-label="찜">
      <svg class="heart" viewBox="0 0 24 24" stroke-width="2" fill="none" stroke="currentColor"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>
    </button>
  </div>
</section>` : ''}
<aside class="storeNow">
  <div class="crest">${esc(storeInitial)}</div>
  <div class="l">
    <div class="a">NOW PLAYING IN STORE</div>
    <div class="b">${esc(d.storeName)}</div>
    <div class="c"><span class="live"><span class="d"></span>영업 중</span>${total > 0 ? ' · 이번 주 ' + total + '개' : ''}</div>
  </div>
  <div class="actions">
    ${phoneLink ? `<a href="${esc(phoneLink.url)}" aria-label="전화"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.97.37 1.92.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.33 1.84.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>` : ''}
    ${mapLink ? `<a href="${esc(mapLink.url)}" class="pr" target="_blank" rel="noopener noreferrer" aria-label="길찾기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></a>` : ''}
  </div>
</aside>
<main id="main">
${rows.join('\n')}
</main>
<div class="brand">
  <strong>HANJUL</strong>
  <span>· 한 줄 전단 · NIGHT MODE</span>
</div>
<script>
(function(){
  document.addEventListener('scroll', function() {
    document.getElementById('topbar').classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });
  var heroSave = document.getElementById('heroSave');
  if (heroSave) {
    heroSave.addEventListener('click', function(e) {
      e.currentTarget.classList.toggle('on');
    });
  }
  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev) {
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });
})();
</script>
</body>
</html>`;
}

// ============================================================
// ★ D155: POSTER POP 엔진 (06b-poster-pop.html 동적 변환)
// 한국 팝 아트 / Bagel Fat One + Black Han Sans + Gaegu / Memphis decorations / 큰 pop sticker
// ============================================================

/** pop 제목 3 라인 분리 (l1 + l2 박스 + l3 + bang) */
function splitTitleForPop(title: string): { l1: string; l2: string; l3: string } {
  const parts = title.split(/[\s,·\.]+/).filter(p => p.length > 0);
  if (parts.length >= 3) {
    return { l1: parts[0] + '!', l2: parts[1], l3: parts.slice(2).join(' ') };
  }
  if (parts.length === 2) {
    return { l1: '이번 주!', l2: parts[0], l3: parts[1] };
  }
  return { l1: '이번 주!', l2: '진짜', l3: parts[0] || '싸요' };
}

const POP_SPEC_COLS = ['col-y', 'col-b', 'col-m', 'col-p'];
const POP_STAMP_PALETTE = [
  { bg: 'var(--color-primary)', color: 'var(--paper)', a: 'SAVE', getB: (it: any, disc: number, saved: number) => saved > 0 ? Math.floor(saved / 1000) + 'K' : (disc > 0 ? disc + '%' : '특가') },
  { bg: 'var(--pop-blue)', color: 'var(--paper)', a: 'PREMIUM', getB: (it: any) => it.badge || '★' },
  { bg: 'var(--pop-pink)', color: 'var(--ink)', a: 'HOT!', getB: (_it: any, disc: number) => disc > 0 ? disc + '%' : '특가' },
  { bg: 'var(--color-accent)', color: 'var(--ink)', a: 'TODAY!', getB: (it: any) => it.badge || '한정' },
  { bg: 'var(--pop-mint)', color: 'var(--ink)', a: 'DEAL', getB: (it: any) => it.badge && it.badge.indexOf('1+1') >= 0 ? '1+1' : (it.badge || 'NEW') },
];

/**
 * ★ POSTER POP 엔진 — Claude Design 06b-poster-pop.html 동적 변환 (D155 PHASE 0 트랙 A 확장)
 *
 * 한국 팝 아트 미감. hero slogan(l1/l2 박스/l3 bang circle) + Memphis shapes 6개 + secmark + slab + pair.
 * 카테고리별 secmark blob 컬러 cycle. slab tilt 회전 + stamp pop sticker.
 * 시즌 토큰 7종.
 */
export function renderPosterPopEngine(d: FlyerRenderData, token: SeasonToken): string {
  const items = flattenItems(d);
  const total = items.length;
  const ogTitle = d.storeName + ' · POP! — ' + d.title;
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice) + '원').join(' · ');
  const ogImage = buildOgImageUrl(d, token);

  const title = (d.title || '이번 주 진짜 싸요').trim();
  const titleParts = splitTitleForPop(title);

  // 매장 정보
  const phoneLink = (d.externalLinks || []).find(l => l.icon === 'phone');
  const mapLink = (d.externalLinks || []).find(l => l.icon === 'map');
  const hoursAnn = (d.announcements || []).find(a => a.title.indexOf('영업') >= 0 || a.title.indexOf('시간') >= 0);
  const addressAnn = (d.announcements || []).find(a => a.title.indexOf('주소') >= 0);

  const issuePeriod = d.periodStart && d.periodEnd
    ? d.periodStart.replace(/-/g, '/').slice(5) + ' — ' + d.periodEnd.replace(/-/g, '/').slice(5)
    : (d.period || '');

  // 카테고리별 secmark + slab/pair
  let slabIdx = 0;
  const sections: string[] = [];
  d.categories.forEach((cat, ci) => {
    const markCls = ci === 0 ? '' : (ci === 1 ? ' alt' : ' b');
    sections.push(
      '<div class="secmark' + markCls + '">' +
        '<span class="blob fat">' + String(ci + 1).padStart(2, '0') + '</span>' +
        '<span class="tt">' + esc(cat.name) + '</span>' +
        '<span class="ll"></span>' +
      '</div>'
    );

    // 카테고리 안 상품: 첫 2개는 일반 slab, 그 외는 pair (2 묶음씩)
    const allItems = cat.items;
    let i = 0;
    // 첫 상품 = 일반 slab (큰 사이즈)
    if (allItems.length > 0) {
      sections.push(buildPopSlab(allItems[0], cat.name, ++slabIdx, false));
      i = 1;
    }

    // 두 번째 상품 = pair 또는 단독
    if (allItems.length === 2) {
      sections.push(buildPopSlab(allItems[1], cat.name, ++slabIdx, false));
      i = 2;
    } else if (allItems.length > 2) {
      // pair 묶음 (2개씩)
      const remaining = allItems.slice(1);
      for (let j = 0; j < remaining.length; j += 2) {
        if (j + 1 < remaining.length) {
          const a = buildPopSlab(remaining[j], cat.name, ++slabIdx, true);
          const b = buildPopSlab(remaining[j + 1], cat.name, ++slabIdx, true);
          sections.push('<div class="pair">' + a + b + '</div>');
        } else {
          sections.push(buildPopSlab(remaining[j], cat.name, ++slabIdx, false));
        }
      }
      i = allItems.length;
    }

    // 첫 카테고리 후 megaStrip 1회
    if (ci === 0 && d.categories.length > 1) {
      sections.push(
        '<div class="megaStrip" aria-hidden="true">' +
          '<div class="track fat">' +
            '<span><span class="star">★</span> 진짜 싸요 <span class="yel">·</span> ' + esc(d.period) + ' <span class="star">★</span> 한정 특가 <span class="yel">·</span> 카드 추가할인 <span class="star">★</span></span>' +
            '<span><span class="star">★</span> 진짜 싸요 <span class="yel">·</span> ' + esc(d.period) + ' <span class="star">★</span> 한정 특가 <span class="yel">·</span> 카드 추가할인 <span class="star">★</span></span>' +
          '</div>' +
        '</div>'
      );
    }
  });

  function buildPopSlab(it: any, catName: string, num: number, isPair: boolean): string {
    const disc = calcDisc(it.originalPrice, it.salePrice);
    const saved = it.originalPrice > 0 ? it.originalPrice - it.salePrice : 0;
    const numStr = String(num).padStart(2, '0');
    const tiltCls = num % 2 === 1 ? ' tilt' : ' tilt2';
    const stampPalette = POP_STAMP_PALETTE[(num - 1) % POP_STAMP_PALETTE.length];
    const stampA = stampPalette.a;
    const stampB = stampPalette.getB(it, disc, saved);
    const phStyle = it.imageUrl
      ? `background:url('${esc(toAbsUrl(it.imageUrl) || '')}') center/cover;`
      : `--ph-bg:${categoryBg(catName)}; --ph-emoji:'${categoryPictogram(catName)}';`;
    const specs: string[] = [];
    if (it.unit) specs.push('<span class="' + POP_SPEC_COLS[0] + '">' + esc(it.unit.toUpperCase()) + '</span>');
    if (it.origin) specs.push('<span class="' + POP_SPEC_COLS[1] + '">' + esc(it.origin) + '</span>');
    if (it.badge && !isPair) specs.push('<span class="' + POP_SPEC_COLS[2] + '">' + esc(it.badge) + '</span>');
    if (disc > 0 && !isPair) specs.push('<span class="' + POP_SPEC_COLS[3] + '">' + disc + '%↓</span>');
    const bangHtml = disc >= 30 ? '<span class="bang">!!</span>' : '';
    const unitpText = it.aiCopy || (it.unit && it.salePrice > 0
      ? '단위 ' + esc(it.unit) + ' · 한정 특가!'
      : '한정 특가야!');

    return (
      '<article class="slab' + tiltCls + '" data-num="' + numStr + '"' + productDataAttr(it, catName) + '>' +
        '<div class="pic">' +
          '<div class="ph" style="' + phStyle + '"></div>' +
          '<span class="deco-1"></span>' +
          '<span class="deco-2"></span>' +
          '<div class="stamp fat" style="background:' + stampPalette.bg + ';color:' + stampPalette.color + ';">' +
            '<div class="a">' + esc(stampA) + '</div>' +
            '<div class="b">' + esc(stampB) + '</div>' +
          '</div>' +
          '<div class="stripe"></div>' +
        '</div>' +
        '<div class="body">' +
          '<span class="id">NO. ' + numStr + ' · ' + esc(catName) + '</span>' +
          '<h3>' + esc(it.name) + (it.unit ? ' ' + esc(it.unit) : '') + '</h3>' +
          '<div class="specs">' + specs.join('') + '</div>' +
          '<div class="priceRow">' +
            (it.originalPrice > 0 ? '<span class="orig price-num">' + fmtPrice(it.originalPrice) + '원</span>' : '') +
            '<span class="sale price-num">' + fmtPrice(it.salePrice) + '<span class="won">원</span>' + bangHtml + '</span>' +
          '</div>' +
          '<div class="unitp">' + esc(unitpText) + '</div>' +
        '</div>' +
      '</article>'
    );
  }

  const yy = String(new Date().getFullYear() % 100);

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Black+Han+Sans&family=Gaegu:wght@700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
:root {
  --color-primary: #FF3D2E;
  --color-accent: #FFD300;
  --pop-blue: #2056FF;
  --pop-mint: #00D6A2;
  --pop-pink: #FF7AB6;
  --pop-purple: #7B4DFF;
  --ink: #131110;
  --paper: #FFF7E8;
  --paper-2: #FFEBC4;
  --rule: #131110;
  --color-on-primary: #FFFFFF;
}
${seasonStyleBlock()}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--paper); color: var(--ink); }
body { font-family: 'Pretendard Variable', sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; padding-bottom: 32px; }
.price-num { font-variant-numeric: tabular-nums; }
.han { font-family: 'Black Han Sans', sans-serif; font-weight: 400; }
.fat { font-family: 'Bagel Fat One', cursive; font-weight: 400; }
.geu { font-family: 'Gaegu', cursive; }
body::before { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 200; opacity: 0.42; mix-blend-mode: multiply; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.16  0 0 0 0 0.12  0 0 0 0 0.07  0 0 0 0.08 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.hero { position: relative; padding: 28px 22px 60px; border-bottom: 4px solid var(--ink); overflow: hidden; }
.hero .topline { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 2px solid var(--ink); font-size: 11px; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; }
.shape { position: absolute; pointer-events: none; z-index: 0; }
.shape.s-zigzag { top: 56px; right: 12px; width: 70px; height: 14px; background: linear-gradient(135deg, transparent 33%, var(--pop-blue) 33% 66%, transparent 66%) 0 0/16px 16px; transform: rotate(-8deg); }
.shape.s-dots { bottom: 8px; left: -16px; width: 130px; height: 130px; background-image: radial-gradient(var(--ink) 22%, transparent 24%); background-size: 12px 12px; transform: rotate(8deg); }
.shape.s-disc { top: 230px; left: 12px; width: 56px; height: 56px; border-radius: 50%; background: var(--pop-mint); border: 3px solid var(--ink); box-shadow: 4px 4px 0 var(--ink); }
.shape.s-ring { top: 320px; right: 14px; width: 72px; height: 72px; border-radius: 50%; border: 6px solid var(--pop-blue); transform: rotate(-10deg); }
.shape.s-blob { top: 30%; left: 35%; width: 50px; height: 50px; background: var(--pop-pink); border-radius: 60% 40% 35% 65% / 55% 60% 40% 45%; transform: rotate(20deg); border: 3px solid var(--ink); }
.shape.s-cross { top: 200px; right: 28%; width: 40px; height: 40px; background: var(--pop-purple); clip-path: polygon(40% 0, 60% 0, 60% 40%, 100% 40%, 100% 60%, 60% 60%, 60% 100%, 40% 100%, 40% 60%, 0 60%, 0 40%, 40% 40%); transform: rotate(15deg); }
.hero .slogan { position: relative; z-index: 2; margin-top: 18px; font-size: 70px; line-height: 0.86; letter-spacing: -0.04em; padding-right: 100px; word-break: keep-all; }
.hero .slogan .l1 { display: block; color: var(--ink); }
.hero .slogan .l2 { display: inline-block; background: var(--color-primary); color: var(--paper); padding: 4px 14px 10px; border: 3px solid var(--ink); box-shadow: 6px 6px 0 var(--ink); transform: rotate(-2deg); margin-top: 8px; line-height: 0.85; }
.hero .slogan .l3 { display: inline-block; margin-top: 14px; color: var(--ink); transform: rotate(-1deg); }
.hero .slogan .l3 .bang { display: inline-block; background: var(--color-accent); border: 3px solid var(--ink); width: 68px; height: 68px; border-radius: 50%; text-align: center; line-height: 68px; vertical-align: middle; margin-left: 6px; color: var(--ink); box-shadow: 4px 4px 0 var(--ink); transform: rotate(8deg); font-size: 52px; }
.hero .info { position: relative; z-index: 2; margin-top: 60px; display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; }
.hero .info .store { display: flex; flex-direction: column; }
.hero .info .store .by { font-family: 'Gaegu', cursive; font-size: 18px; color: var(--ink); line-height: 1; }
.hero .info .store .nm { margin-top: 6px; font-family: 'Black Han Sans', sans-serif; font-size: 26px; line-height: 1; color: var(--ink); }
.hero .info .period { background: var(--ink); color: var(--paper); padding: 6px 10px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; transform: rotate(2deg); }
.secmark { margin: 36px 22px 14px; display: flex; align-items: center; gap: 10px; }
.secmark .blob { width: 36px; height: 36px; border-radius: 50%; background: var(--pop-mint); border: 3px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); display: grid; place-items: center; font-family: 'Bagel Fat One', cursive; font-size: 16px; color: var(--ink); }
.secmark .tt { font-family: 'Black Han Sans', sans-serif; font-size: 26px; letter-spacing: -0.025em; color: var(--ink); }
.secmark .ll { flex: 1; height: 3px; background: var(--ink); }
.secmark.alt .blob { background: var(--color-accent); }
.secmark.b .blob { background: var(--pop-pink); }
.slab { margin: 0 22px 18px; background: var(--paper-2); border: 3px solid var(--ink); box-shadow: 6px 6px 0 var(--ink); position: relative; overflow: hidden; opacity: 0; transform: translateY(16px); transition: opacity 540ms ease, transform 540ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.slab.in { opacity: 1; transform: none; }
.slab.tilt { transform: rotate(-1deg); }
.slab.tilt.in { transform: rotate(-0.8deg); }
.slab.tilt2 { transform: rotate(1.2deg); }
.slab.tilt2.in { transform: rotate(0.8deg); }
.slab .pic { aspect-ratio: 16/10; position: relative; background: var(--paper); border-bottom: 3px solid var(--ink); overflow: hidden; }
.ph { position: absolute; inset: 0; display: grid; place-items: center; background: var(--ph-bg, var(--paper)); }
.ph::after { content: var(--ph-emoji, ""); font-size: 130px; line-height: 1; filter: drop-shadow(2px 2px 0 var(--ink)) drop-shadow(0 6px 12px rgba(0,0,0,0.18)); }
.pic .deco-1 { position: absolute; left: 12px; top: 12px; width: 32px; height: 32px; border-radius: 50%; background: var(--pop-blue); border: 2px solid var(--ink); }
.pic .deco-2 { position: absolute; right: 12px; top: 12px; width: 36px; height: 36px; background: var(--color-accent); border: 2px solid var(--ink); transform: rotate(20deg); }
.pic .stripe { position: absolute; left: 0; right: 0; bottom: 0; height: 16px; background: repeating-linear-gradient(45deg, var(--ink) 0 6px, var(--paper) 6px 12px); }
.pic .stamp { position: absolute; right: 12px; bottom: 24px; transform: rotate(-10deg); width: 90px; height: 90px; background: var(--color-primary); color: var(--paper); border: 3px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); border-radius: 50%; display: grid; place-items: center; text-align: center; font-family: 'Bagel Fat One', cursive; line-height: 0.95; z-index: 2; }
.pic .stamp .a { font-size: 11px; font-weight: 400; letter-spacing: 0.02em; }
.pic .stamp .b { font-size: 28px; }
.slab .body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 6px; }
.slab .id { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; background: var(--ink); color: var(--paper); padding: 3px 8px; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; }
.slab h3 { font-family: 'Black Han Sans', sans-serif; font-size: 26px; letter-spacing: -0.025em; color: var(--ink); line-height: 1.05; }
.slab .specs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.slab .specs span { font-size: 11px; font-weight: 700; padding: 3px 8px; background: var(--paper); border: 1.5px solid var(--ink); }
.slab .specs .col-y { background: var(--color-accent); }
.slab .specs .col-b { background: var(--pop-blue); color: var(--paper); }
.slab .specs .col-m { background: var(--pop-mint); }
.slab .specs .col-p { background: var(--pop-pink); }
.slab .priceRow { margin-top: 8px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.slab .orig { font-size: 14px; color: var(--ink); opacity: 0.55; text-decoration: line-through; text-decoration-thickness: 2.5px; }
.slab .sale { font-family: 'Bagel Fat One', cursive; font-size: 52px; line-height: 0.9; color: var(--color-primary); -webkit-text-stroke: 2.5px var(--ink); paint-order: stroke fill; letter-spacing: -0.02em; }
.slab.in .sale { animation: pricePop 800ms cubic-bezier(0.34, 1.56, 0.64, 1) both 220ms; }
@keyframes pricePop { 0% { transform: scale(0.5) rotate(-8deg); opacity: 0; } 60% { transform: scale(1.15) rotate(2deg); opacity: 1; } 100% { transform: scale(1) rotate(0); } }
.slab .sale .won { font-size: 22px; }
.slab .sale .bang { color: var(--color-accent); }
.slab .unitp { font-family: 'Gaegu', cursive; font-size: 16px; color: var(--ink); margin-top: 2px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 22px 18px; }
.pair .slab { margin: 0; box-shadow: 4px 4px 0 var(--ink); }
.pair .slab .pic { aspect-ratio: 1/1; }
.pair .slab h3 { font-size: 18px; }
.pair .slab .sale { font-size: 36px; }
.pair .slab .sale .won { font-size: 14px; }
.pair .slab .unitp { font-size: 13px; }
.pair .slab .specs span { font-size: 10px; padding: 2px 6px; }
.pair .slab .pic .stamp { width: 60px; height: 60px; right: 8px; bottom: 14px; }
.pair .slab .pic .stamp .a { font-size: 9px; }
.pair .slab .pic .stamp .b { font-size: 18px; }
.megaStrip { margin: 24px 0; background: var(--ink); color: var(--paper); padding: 14px 0; border-top: 4px solid var(--ink); border-bottom: 4px solid var(--ink); overflow: hidden; white-space: nowrap; font-family: 'Bagel Fat One', cursive; font-size: 22px; letter-spacing: 0.04em; }
.megaStrip .track { display: inline-flex; gap: 24px; animation: marquee 18s linear infinite; }
.megaStrip .track .red { color: var(--color-primary); }
.megaStrip .track .yel { color: var(--color-accent); }
.megaStrip .track .star { color: var(--color-accent); }
@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.foot { margin: 24px 22px 0; padding: 18px; background: var(--ink); color: var(--paper); border: 3px solid var(--ink); box-shadow: 6px 6px 0 var(--color-primary); position: relative; }
.foot .ribbon { position: absolute; top: -14px; left: 14px; background: var(--color-accent); color: var(--ink); padding: 3px 10px; border: 2px solid var(--ink); font-size: 10px; font-weight: 800; letter-spacing: 0.1em; }
.foot .nameRow { display: flex; align-items: baseline; justify-content: space-between; margin-top: 4px; }
.foot .nameRow .h { font-family: 'Black Han Sans', sans-serif; font-size: 26px; letter-spacing: -0.02em; }
.foot .nameRow .vol { font-family: 'Bagel Fat One', cursive; color: var(--color-accent); font-size: 18px; }
.foot .lines { margin-top: 12px; display: grid; gap: 6px; font-size: 13px; }
.foot .lines .ln { display: grid; grid-template-columns: 60px 1fr; gap: 10px; align-items: baseline; }
.foot .lines .k { font-family: 'Bagel Fat One', cursive; color: var(--color-accent); font-size: 11px; letter-spacing: 0.06em; }
.foot .lines .v { font-weight: 600; }
.foot .ctas { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.foot .ctas a, .foot .ctas button { height: 48px; border: 3px solid var(--paper); background: transparent; color: var(--paper); font-family: 'Bagel Fat One', cursive; font-size: 16px; cursor: pointer; letter-spacing: 0.02em; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
.foot .ctas .fill { background: var(--color-primary); border-color: var(--color-primary); color: var(--paper); }
.foot .small { margin-top: 14px; font-family: 'Gaegu', cursive; font-size: 13px; opacity: 0.7; text-align: center; }
@media (prefers-reduced-motion: reduce) {
  .slab.in .sale { animation: none; }
  .megaStrip .track { animation: none; }
}
</style>
</head>
<body>
<section class="hero">
  <div class="topline">
    <span>HANJUL · POP NO.${esc(yy)}</span>
    <span>${esc(issuePeriod)}</span>
  </div>
  <div class="shape s-zigzag" aria-hidden="true"></div>
  <div class="shape s-disc" aria-hidden="true"></div>
  <div class="shape s-ring" aria-hidden="true"></div>
  <div class="shape s-blob" aria-hidden="true"></div>
  <div class="shape s-cross" aria-hidden="true"></div>
  <div class="shape s-dots" aria-hidden="true"></div>
  <h1 class="slogan han">
    <span class="l1">${esc(titleParts.l1)}</span>
    <span class="l2">${esc(titleParts.l2)}</span>
    <span class="l3">${esc(titleParts.l3)}<span class="bang fat">!</span></span>
  </h1>
  <div class="info">
    <div class="store">
      <div class="by">우리 동네</div>
      <div class="nm">${esc(d.storeName)}</div>
    </div>
    <div class="period">${esc(d.period || (total + '품목'))}</div>
  </div>
</section>
${sections.join('\n')}
<footer class="foot">
  <span class="ribbon">★ STORE INFO ★</span>
  <div class="nameRow">
    <span class="h">${esc(d.storeName)}</span>
    <span class="vol fat">NO. ${esc(yy)}</span>
  </div>
  <div class="lines">
    <div class="ln"><span class="k fat">OPEN</span><span class="v">${esc(hoursAnn ? hoursAnn.content : '문의 매장')}</span></div>
    <div class="ln"><span class="k fat">CALL</span><span class="v">${esc(phoneLink ? phoneLink.label : '문의 매장')}</span></div>
    <div class="ln"><span class="k fat">ADDR</span><span class="v">${esc(addressAnn ? addressAnn.content : (mapLink ? mapLink.label : '매장 위치'))}</span></div>
    <div class="ln"><span class="k fat">DATE</span><span class="v">${esc(d.period)}</span></div>
  </div>
  <div class="ctas">
    ${mapLink
      ? `<a href="${esc(mapLink.url)}" target="_blank" rel="noopener noreferrer">길찾기</a>`
      : `<button disabled style="opacity:0.5;cursor:not-allowed;">길찾기</button>`}
    ${phoneLink
      ? `<a href="${esc(phoneLink.url)}" class="fill">전화 걸기</a>`
      : `<button class="fill" disabled style="opacity:0.5;cursor:not-allowed;">전화 걸기</button>`}
  </div>
  <div class="small">매장에서 직접 보고 가세요 — 사장님이 골랐어요</div>
</footer>
<script>
(function(){
  var io = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.15 });
  document.querySelectorAll('.slab').forEach(function(s) { io.observe(s); });
  var seasonParam = new URLSearchParams(location.search).get('season');
  if (seasonParam) document.documentElement.setAttribute('data-season', seasonParam);
  window.addEventListener('message', function(ev) {
    var msg = ev.data || {};
    if (msg.type === 'season' && msg.value) document.documentElement.setAttribute('data-season', msg.value);
  });
})();
</script>
</body>
</html>`;
}

// ============================================================
// ★ 2026-08-20 신규 엔진 ① — MARKET BOARD (시장 대자보)
// ============================================================
/**
 * 전통시장 손글씨 대자보. 크림 갱지 + 붉은 인장 + 점선 리더로 이름과 가격을 잇는다.
 * 사진이 없어도 성립하는 유일한 축 — 정육·수산·명절 대목처럼 이미지 확보가 어려운 판에 쓴다.
 */
export function renderMarketBoardEngine(d: FlyerRenderData, token: SeasonToken): string {
  const items = flattenItems(d);
  const ogTitle = d.storeName + ' · ' + d.title;
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice) + '원').join(' · ');
  const ogImage = buildOgImageUrl(d, token);
  const period = d.periodStart && d.periodEnd
    ? d.periodStart.replace(/-/g, '.').slice(5) + ' — ' + d.periodEnd.replace(/-/g, '.').slice(5)
    : (d.period || '');

  const sections = d.categories.map((cat, ci) => {
    const rows = cat.items.map(it => {
      const disc = calcDisc(it.originalPrice, it.salePrice);
      const meta = [it.unit, it.origin].filter(Boolean).map(v => esc(String(v))).join(' · ');
      return (
        '<li class="row"' + productDataAttr(it, cat.name) + '>' +
          '<div class="nm">' +
            '<span class="t ' + nameSizeClass(it.name) + '">' + esc(it.name) + '</span>' +
            (it.badge ? '<span class="bdg">' + esc(it.badge) + '</span>' : '') +
            (meta ? '<span class="mt">' + meta + '</span>' : '') +
          '</div>' +
          '<div class="dots" aria-hidden="true"></div>' +
          '<div class="pr">' +
            (it.originalPrice > it.salePrice
              ? '<span class="was">' + fmtPrice(it.originalPrice) + '</span>' : '') +
            '<span class="now ' + priceScaleClass(it.salePrice) + '">' + fmtPrice(it.salePrice) + '<i>원</i></span>' +
            (disc > 0 ? '<span class="off">' + disc + '%</span>' : '') +
          '</div>' +
        '</li>'
      );
    }).join('');
    return (
      '<section class="blk">' +
        '<h2 class="cat"><span class="ico">' + categoryPictogram(cat.name) + '</span>' + esc(cat.name) + '<span class="ln"></span></h2>' +
        '<ul class="rows">' + rows + '</ul>' +
      '</section>'
    );
  }).join('');

  return `<!DOCTYPE html>
<html lang="ko" data-season="${token}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}"><meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}"><meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
:root{--color-primary:#C0392B;--color-accent:#E67E22;--color-on-primary:#fff;--paper:#FBF6EA;--ink:#1A1614;}
${seasonStyleBlock()}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:'Noto Sans KR',sans-serif;
  background-image:radial-gradient(rgba(26,22,20,.055) 1px,transparent 1px);background-size:14px 14px;}
.wrap{max-width:520px;margin:0 auto;padding:0 18px 64px}
.head{position:relative;padding:30px 0 18px;text-align:center;border-bottom:3px double var(--ink)}
.seal{position:absolute;top:22px;right:2px;width:58px;height:58px;border:3px solid var(--color-primary);border-radius:6px;
  display:flex;align-items:center;justify-content:center;transform:rotate(9deg);opacity:.9}
.seal b{font-family:'Black Han Sans',sans-serif;color:var(--color-primary);font-size:13px;line-height:1.05;text-align:center}
.store{display:inline-block;font-size:12px;letter-spacing:.32em;color:var(--color-primary);font-weight:700;margin-bottom:10px}
h1{font-family:'Black Han Sans',sans-serif;font-size:clamp(34px,10vw,52px);line-height:1.04;word-break:keep-all}
.per{margin-top:10px;display:inline-block;padding:4px 14px;border:1.5px solid var(--ink);border-radius:999px;font-size:12px;font-weight:700}
.blk{margin-top:26px}
.cat{display:flex;align-items:center;gap:8px;font-family:'Black Han Sans',sans-serif;font-size:19px;color:var(--color-primary)}
.cat .ico{font-size:20px;line-height:1}
.cat .ln{flex:1;height:2px;background:repeating-linear-gradient(90deg,var(--ink) 0 8px,transparent 8px 14px);opacity:.35}
.rows{list-style:none;margin-top:12px}
.row{display:flex;align-items:flex-end;gap:8px;padding:11px 0;border-bottom:1px dashed rgba(26,22,20,.28)}
.nm{min-width:0;flex-shrink:1}
.nm .t{display:block;font-weight:700;font-size:17px;line-height:1.25;word-break:keep-all}
.nm .t.nm-m{font-size:15px}.nm .t.nm-l{font-size:13.5px}
.nm .bdg{display:inline-block;margin-top:5px;padding:2px 7px;background:var(--color-primary);color:#fff;font-size:11px;font-weight:900;border-radius:3px}
.nm .mt{display:block;margin-top:4px;font-size:11px;color:rgba(26,22,20,.55)}
.dots{flex:1;min-width:14px;height:0;border-bottom:2px dotted rgba(26,22,20,.35);margin-bottom:9px}
.pr{text-align:right;white-space:nowrap;flex-shrink:0}
.pr .was{display:block;font-size:12px;color:rgba(26,22,20,.45);text-decoration:line-through}
.pr .now{font-family:'Black Han Sans',sans-serif;font-size:34px;line-height:1;color:var(--ink)}
.pr .now.pr-m{font-size:30px}.pr .now.pr-l{font-size:26px}
.pr .now i{font-style:normal;font-size:15px;margin-left:2px}
.pr .off{display:inline-block;margin-left:6px;padding:2px 6px;background:var(--ink);color:var(--paper);font-size:12px;font-weight:900;border-radius:3px}
.foot{margin-top:34px;padding-top:16px;border-top:3px double var(--ink);text-align:center}
.foot .nm2{font-family:'Black Han Sans',sans-serif;font-size:22px}
.foot .cp{margin-top:6px;font-size:11px;color:rgba(26,22,20,.5)}
</style>
</head>
<body>
<div class="wrap">
  <header class="head">
    <div class="seal"><b>특가<br>세일</b></div>
    <span class="store">${esc(d.storeName)}</span>
    <h1>${esc(d.title)}</h1>
    ${period ? '<div class="per">' + esc(period) + '</div>' : ''}
  </header>
  ${sections}
  <footer class="foot">
    <p class="nm2">${esc(d.storeName)}</p>
    <p class="cp">가격은 행사 기간 내 매장 사정에 따라 조기 소진될 수 있습니다</p>
  </footer>
</div>
</body>
</html>`;
}

// ============================================================
// ★ 2026-08-20 신규 엔진 ② — FRESH DAILY (신선 데일리)
// ============================================================
/**
 * 신선식품 코너의 얼굴. 흰 바탕 + 딥그린, 사진을 크게 쓰고 원산지·규격을 앞세운다.
 * 첫 상품은 대표 카드로 크게, 나머지는 2열. 청과·수산·축산 판에 쓴다.
 */
export function renderFreshDailyEngine(d: FlyerRenderData, token: SeasonToken): string {
  const items = flattenItems(d);
  const hero = items[0];
  const rest = items.slice(1);
  const ogTitle = d.storeName + ' · ' + d.title;
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice) + '원').join(' · ');
  const ogImage = buildOgImageUrl(d, token);
  const period = d.periodStart && d.periodEnd
    ? d.periodStart.replace(/-/g, '.').slice(5) + ' ~ ' + d.periodEnd.replace(/-/g, '.').slice(5)
    : (d.period || '');

  const chip = (it: FlyerRenderItem) => {
    const parts: string[] = [];
    if (it.origin) parts.push('<span class="ch org">' + esc(it.origin) + '</span>');
    if (it.unit) parts.push('<span class="ch">' + esc(it.unit) + '</span>');
    if (it.cardDiscount) parts.push('<span class="ch card">' + esc(it.cardDiscount) + '</span>');
    return parts.join('');
  };

  const heroHtml = hero ? (
    '<article class="hero"' + productDataAttr(hero, hero.category) + '>' +
      '<div class="ph">' + resolveImg(hero.name, 520, hero.imageUrl) + '</div>' +
      '<div class="body">' +
        '<span class="tag">이번 주 대표</span>' +
        '<h2 class="' + nameSizeClass(hero.name) + '">' + esc(hero.name) + '</h2>' +
        '<div class="chips">' + chip(hero) + '</div>' +
        '<div class="prc">' +
          (hero.originalPrice > hero.salePrice ? '<span class="was">' + fmtPrice(hero.originalPrice) + '원</span>' : '') +
          '<strong class="' + priceScaleClass(hero.salePrice) + '">' + fmtPrice(hero.salePrice) + '<i>원</i></strong>' +
          (calcDisc(hero.originalPrice, hero.salePrice) > 0
            ? '<span class="off">' + calcDisc(hero.originalPrice, hero.salePrice) + '% ↓</span>' : '') +
        '</div>' +
      '</div>' +
    '</article>'
  ) : '';

  const gridHtml = d.categories.map(cat => {
    const list = cat.items.filter(it => !hero || it.name !== hero.name || cat.name !== hero.category);
    if (list.length === 0) return '';
    const cards = list.map(it => (
      '<article class="card"' + productDataAttr(it, cat.name) + '>' +
        '<div class="ph">' + resolveImg(it.name, 300, it.imageUrl) + '</div>' +
        '<div class="body">' +
          '<h3 class="' + nameSizeClass(it.name) + '">' + esc(it.name) + '</h3>' +
          '<div class="chips">' + chip(it) + '</div>' +
          '<div class="prc">' +
            (it.originalPrice > it.salePrice ? '<span class="was">' + fmtPrice(it.originalPrice) + '원</span>' : '') +
            '<strong class="' + priceScaleClass(it.salePrice) + '">' + fmtPrice(it.salePrice) + '<i>원</i></strong>' +
          '</div>' +
        '</div>' +
      '</article>'
    )).join('');
    return (
      '<section class="sec">' +
        '<h2 class="cat"><span class="ico">' + categoryPictogram(cat.name) + '</span>' + esc(cat.name) +
          '<span class="cnt">' + list.length + '</span></h2>' +
        '<div class="grid">' + cards + '</div>' +
      '</section>'
    );
  }).join('');

  return `<!DOCTYPE html>
<html lang="ko" data-season="${token}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}"><meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}"><meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
:root{--color-primary:#15803D;--color-accent:#65A30D;--color-on-primary:#fff;--ink:#111827;--line:#E5E7EB;}
${seasonStyleBlock()}
*{margin:0;padding:0;box-sizing:border-box}
body{background:#fff;color:var(--ink);font-family:'Noto Sans KR',sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:520px;margin:0 auto;padding-bottom:64px}
.top{padding:26px 20px 20px;background:linear-gradient(160deg,var(--color-primary),var(--color-accent));color:#fff}
.top .st{font-size:12px;letter-spacing:.28em;opacity:.9;font-weight:700}
.top h1{font-family:'Black Han Sans',sans-serif;font-size:clamp(30px,8.5vw,42px);line-height:1.08;margin-top:8px;word-break:keep-all}
.top .per{margin-top:10px;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;
  background:rgba(255,255,255,.2);padding:5px 12px;border-radius:999px}
.hero{margin:-18px 16px 0;background:#fff;border:1px solid var(--line);border-radius:22px;overflow:hidden;
  box-shadow:0 12px 30px -12px rgba(17,24,39,.28)}
.hero .ph{aspect-ratio:16/10;background:#F3F4F6;overflow:hidden}
.hero .ph img{width:100%;height:100%;object-fit:cover;display:block}
.hero .body{padding:16px 18px 18px}
.tag{display:inline-block;padding:3px 9px;border-radius:999px;background:var(--color-primary);color:#fff;font-size:11px;font-weight:900}
.hero h2{font-size:23px;font-weight:900;line-height:1.25;margin-top:9px;word-break:keep-all}
.hero h2.nm-m{font-size:20px}.hero h2.nm-l{font-size:18px}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}
.ch{padding:3px 8px;border-radius:6px;background:#F3F4F6;font-size:11px;font-weight:700;color:#4B5563}
.ch.org{background:#DCFCE7;color:#166534}
.ch.card{background:#EFF6FF;color:#1D4ED8}
.prc{display:flex;align-items:baseline;gap:8px;margin-top:12px;flex-wrap:wrap}
.prc .was{font-size:13px;color:#9CA3AF;text-decoration:line-through}
.prc strong{font-family:'Black Han Sans',sans-serif;font-size:36px;line-height:1;color:var(--ink)}
.prc strong.pr-m{font-size:31px}.prc strong.pr-l{font-size:27px}
.prc strong i{font-style:normal;font-size:16px;margin-left:1px}
.prc .off{font-size:13px;font-weight:900;color:var(--color-primary)}
.sec{margin-top:28px;padding:0 16px}
.cat{display:flex;align-items:center;gap:7px;font-size:17px;font-weight:900}
.cat .ico{font-size:19px;line-height:1}
.cat .cnt{margin-left:auto;font-size:12px;font-weight:700;color:#9CA3AF}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:11px;margin-top:12px}
.card{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff}
.card .ph{aspect-ratio:1/1;background:#F3F4F6;overflow:hidden}
.card .ph img{width:100%;height:100%;object-fit:cover;display:block}
.card .body{padding:10px 11px 12px}
.card h3{font-size:14px;font-weight:700;line-height:1.3;word-break:keep-all}
.card h3.nm-m{font-size:13px}.card h3.nm-l{font-size:12px}
.card .prc{margin-top:8px;gap:6px}
.card .prc strong{font-size:22px}
.card .prc strong.pr-m{font-size:20px}.card .prc strong.pr-l{font-size:18px}
.card .prc strong i{font-size:12px}
.foot{margin-top:34px;padding:20px 16px 0;text-align:center;border-top:1px solid var(--line)}
.foot p{font-size:11px;color:#9CA3AF;line-height:1.6}
[data-band="large"] .grid{gap:9px}
[data-band="large"] .card h3{font-size:13px}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <p class="st">${esc(d.storeName)}</p>
    <h1>${esc(d.title)}</h1>
    ${period ? '<span class="per">' + esc(period) + '</span>' : ''}
  </header>
  ${heroHtml}
  ${gridHtml}
  <footer class="foot"><p>산지·기상 사정에 따라 조기 품절될 수 있습니다<br>${esc(d.storeName)}</p></footer>
</div>
</body>
</html>`;
}

// ============================================================
// RENDERER_MAP (신규 6 + D155 추가 5 + 0820 신규 2)
// STORY 함수는 코드 유지(옛 발행 폴백) but REGISTRY/DEFAULT에서 제거 예정
// ============================================================

const RENDERERS: Record<string, (d: FlyerRenderData, token: SeasonToken) => string> = {
  story:         renderStoryEngine,
  magazine:      renderMagazineEngine,
  magazine_zine: renderMagazineZineEngine,
  deal_feed:     renderDealFeedEngine,
  deal_bento:    renderDealBentoEngine,
  grid_hero:     renderGridHeroEngine,
  grid_muji:     renderGridMujiEngine,
  catalog_swipe: renderCatalogSwipeEngine,
  catalog_dark:  renderCatalogDarkEngine,
  poster_promo:  renderPosterPromoEngine,
  poster_pop:    renderPosterPopEngine,
  // ★ 2026-08-20 신규 2종 — 마트 현장에서 가장 많이 쓰는 두 얼굴
  market_board:  renderMarketBoardEngine,
  fresh_daily:   renderFreshDailyEngine,
};

// ============================================================
// 단일 진입점 (Deprecated 폴백 + 시즌 토큰 + 후처리)
// ============================================================

/**
 * ★ 단일 진입점.
 *
 * 1. templateCode → 신규 6 엔진 매핑 (deprecated 22 templateCode는 DEPRECATED_FALLBACK_MAP 자동 변환).
 * 2. 시즌 토큰 결정 (data.seasonToken 우선, 미지정 시 title+periodStart로 자동 매핑).
 * 3. 엔진 호출 + 후처리 (dynamic + qr + cart-script).
 */
export function renderTemplate(
  templateCode: string,
  data: FlyerRenderData,
  opts?: { variant?: DesignVariant | null },
): string {
  // 1. templateCode 정규화 (신규 6 → 그대로 / deprecated → 폴백 / 미존재 → 'grid_hero')
  const resolvedCode = RENDERERS[templateCode]
    ? templateCode
    : (DEPRECATED_FALLBACK_MAP[templateCode] || 'grid_hero');

  // ★ 2026-08-20 2단계 — 렌더 준비(프로모 토큰 분리 → badge 승격·이름 단축). 원본 무변경.
  const prepped = prepareFlyerData(data);

  // 2. 시즌 토큰 결정 (강제 지정 > 자동 매핑)
  const seasonToken: SeasonToken = prepped.seasonToken
    || resolveSeasonToken(prepped.title, prepped.periodStart);

  // 3. 엔진 호출
  const renderer = RENDERERS[resolvedCode] || RENDERERS.grid_hero;
  let html = renderer(prepped, seasonToken);

  // ★ 2026-08-20 2단계 — 상품 수 밴드 3단(≤6/7~20/21+) 속성 + 밴드 CSS +
  //   URL 매체 토큰(:root 변수 — 시즌 동일값이라 색 무변·text/shadow/scale 변수 추가만).
  //   주입은 엔진 <style> 뒤(</head> 직전) — 매체 블록이 이긴다(13번 설계 §5 순서 계약).
  const band = itemCountBand(countItems(prepped));
  html = html.replace('<html lang="ko" data-season=', `<html lang="ko" data-band="${band}" data-season=`);
  const headInject = `<style data-media-css>${generateMediaCssBlock('url', seasonToken)}</style>` + bandStyleBlock(band)
    // ★ 2026-08-20 3단계 — 디자인 변형 주입(죽어 있던 claude-design-renderer 배선 — 13번 설계 §2-④).
    //   맨 뒤 주입 = 변형 팔레트가 최종 우선(재열람 재현성은 저장 스냅샷이 보장).
    + (opts?.variant ? `<style data-variant-css>${variantToStyleBlock(opts.variant)}</style>` : '');
  html = html.replace('</head>', headInject + '</head>');

  // 4. 후처리 (V3 보존): dynamic + qr + cart-script — prepped 기준(표시 파생 일관)
  const dynHtml = renderDynamicSection(prepped);
  if (dynHtml) html = html.replace('</body>', dynHtml + '</body>');
  if (prepped.qrCodeDataUrl) html = html.replace('</body>', renderQrSection(prepped) + '</body>');
  if (prepped.trackingPhone && prepped.flyerId) html = html.replace('</body>', renderCartScript(prepped) + '</body>');

  return html;
}

// ============================================================
// og:image (카톡 인박스 미리보기) — D154 PHASE 0 트랙 A
// ============================================================

/**
 * og:image URL 생성. shortCode 있으면 동적 라우트(/api/flyer/og/{code}.png),
 * 미존재 시 placehold.co 시즌 토큰 컬러 폴백.
 */
export function buildOgImageUrl(data: FlyerRenderData, token: SeasonToken): string {
  if (data.shortCode) {
    const base = process.env.FLYER_API_BASE_URL || '';
    return base + '/api/flyer/og/' + encodeURIComponent(data.shortCode) + '.png';
  }
  const tokenInfo = SEASON_TOKENS[token];
  return 'https://placehold.co/1200x630/' + tokenInfo.primary.slice(1) + '/FFFFFF?text=' + encodeURIComponent(data.storeName || data.title || '한줄전단');
}

/**
 * ★ og:image 동적 HTML 생성 (1200x630, 카톡 인박스 미리보기 압도용)
 *
 * 시즌 토큰 grad 배경 + 매장명 + 행사명 + Hero 상품(max 할인율 자동 선정) + 가격.
 * puppeteer screenshot 대상. 안전 영역 1040x520 (카톡 inbox crop 고려).
 * 호출: routes/flyer/og-image.ts에서 페이지 setContent + screenshot.
 */
export function renderOgImageHtml(d: FlyerRenderData, token: SeasonToken): string {
  const tokenInfo = SEASON_TOKENS[token];
  const items = flattenItems(d);

  // Hero = max 할인율 상품 (없으면 첫 상품)
  let hero: (FlyerRenderItem & { category: string }) | null = null;
  if (items.length > 0) {
    let maxDisc = -1;
    for (const it of items) {
      const disc = calcDisc(it.originalPrice, it.salePrice);
      if (disc > maxDisc) { maxDisc = disc; hero = it; }
    }
    if (!hero) hero = items[0];
  }

  const heroBlock = hero
    ? (hero.imageUrl
        ? `<img class="hero-img" src="${esc(toAbsUrl(hero.imageUrl) || '')}" alt="${esc(hero.name)}">`
        : `<div class="hero-ph" style="background:${categoryBg(hero.category)}"><span class="hero-emoji">${categoryPictogram(hero.category)}</span></div>`)
    : '';
  const heroInfoBlock = hero
    ? `<div class="hero-info">
        <div class="hero-name">${esc(hero.name)}${hero.unit ? ' · ' + esc(hero.unit) : ''}</div>
        ${hero.originalPrice > 0 ? `<div class="hero-orig">${fmtPrice(hero.originalPrice)}원</div>` : ''}
        <div class="hero-sale">${fmtPrice(hero.salePrice)}원${hero.badge ? ' · ' + esc(hero.badge) : ''}</div>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body {
  font-family: 'Pretendard Variable', sans-serif;
  background: linear-gradient(135deg, ${tokenInfo.primary} 0%, ${tokenInfo.accent} 100%);
  color: ${tokenInfo.onPrimary};
  -webkit-font-smoothing: antialiased;
  display: grid; grid-template-columns: 1fr 460px;
  gap: 60px; padding: 80px 80px 80px 80px;
  position: relative;
}
body::before {
  content: ""; position: absolute; inset: 0;
  background: radial-gradient(70% 60% at 0% 100%, rgba(255,255,255,0.18), transparent 60%),
              radial-gradient(60% 50% at 100% 0%, rgba(0,0,0,0.18), transparent 60%);
  pointer-events: none;
}
.left { display: flex; flex-direction: column; justify-content: space-between; z-index: 1; min-width: 0; }
.brand { font-size: 16px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.9; display: flex; align-items: center; gap: 12px; }
.brand .crest { display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: rgba(0,0,0,0.22); font-size: 22px; font-weight: 900; }
.brand .ribbon { letter-spacing: 0.22em; }
.title { font-size: 78px; font-weight: 900; line-height: 0.95; letter-spacing: -0.04em; word-break: keep-all; max-width: 540px; text-shadow: 0 2px 12px rgba(0,0,0,0.18); }
.store { font-size: 28px; font-weight: 800; opacity: 0.98; margin-top: 36px; letter-spacing: -0.01em; }
.period { font-size: 18px; font-weight: 600; opacity: 0.88; margin-top: 8px; letter-spacing: 0.05em; }
.right { position: relative; display: flex; flex-direction: column; justify-content: center; z-index: 1; }
.hero { position: relative; width: 100%; height: 320px; border-radius: 28px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.32); background: rgba(255,255,255,0.12); }
.hero-img { width: 100%; height: 100%; object-fit: cover; }
.hero-ph { width: 100%; height: 100%; display: grid; place-items: center; }
.hero-emoji { font-size: 180px; line-height: 1; filter: drop-shadow(0 16px 32px rgba(0,0,0,0.35)); }
.hero-info { margin-top: 22px; padding: 0 4px; }
.hero-name { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.25; opacity: 0.98; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.hero-orig { font-size: 16px; font-weight: 600; opacity: 0.65; text-decoration: line-through; margin-top: 4px; font-variant-numeric: tabular-nums; }
.hero-sale { font-size: 36px; font-weight: 900; letter-spacing: -0.025em; margin-top: 2px; font-variant-numeric: tabular-nums; }
.empty { display: flex; align-items: center; justify-content: center; width: 100%; height: 320px; font-size: 32px; font-weight: 800; opacity: 0.75; border-radius: 28px; background: rgba(255,255,255,0.12); }
</style>
</head>
<body>
<div class="left">
  <div class="brand">
    <span class="crest">${esc(storeInitial(d.storeName))}</span>
    <span class="ribbon">HANJUL · WEEKLY</span>
  </div>
  <div>
    <div class="title">${esc(d.title || '이번 주 행사')}</div>
    <div class="store">${esc(d.storeName)}</div>
    <div class="period">${esc(d.period)}</div>
  </div>
</div>
<div class="right">
  ${hero ? `<div class="hero">${heroBlock}</div>${heroInfoBlock}` : '<div class="empty">이번 주 행사</div>'}
</div>
</body>
</html>`;
}

// 하위호환 export (V3 호환)
export { esc as escapeHtml, fmtPrice as formatPrice };
