/**
 * ★ CT-F14 — 전단AI 템플릿 렌더링 (1026 18번 개편)
 *
 * 전단지 공개 페이지 HTML 렌더링의 유일한 진입점 = renderTemplate(templateCode, data).
 * 20종 = 「매대 가격표」 엔진 하나(renderShowcardEngine) + 템플릿마다 사양(TEMPLATE_SPEC · CT-F13).
 *   옛 17 엔진(STORY·MAGAZINE·DEAL FEED·GRID HERO·POSTER POP …)은 40~60대 판독 기준 미달로 폐기(1026 Harold).
 *   저장된 전단의 템플릿 코드는 그대로 새 엔진으로 렌더된다 · 폐기 코드는 DEPRECATED_FALLBACK_MAP.
 * 후처리: 매체 토큰 · 밴드 속성 · renderDynamicSection · renderQrSection · renderCartScript.
 * og:image 렌더(renderOgImageHtml)는 별도 1200x630 화면.
 */

import { resolveSeasonToken, SEASON_TOKENS, type SeasonToken } from './season-resolver';
import { DEPRECATED_FALLBACK_MAP, TEMPLATE_SPEC, type ShowcardSpec, type ShowcardTheme } from '../config/flyer-business-types';
import { renderQrSection, renderCartScript } from './flyer-page-injections';
// ★ 2026-08-20 슈퍼버전업 2단계 — 렌더 준비 CT(프로모 분리·밴드·픽토그램) + URL 매체 토큰(13번 설계 §4·§5)
import { prepareFlyerData, itemCountBand, countItems, bandStyleBlock, categoryPictogram, nameSizeClass, priceScaleClass, priceStyleBlock } from './flyer-render-prep';
import { generateMediaCssBlock } from './design-tokens';
// ★ 1026: 사진 주소가 빈 상품은 그릴 때 내장 사진 라이브러리를 한 번 더 찾는다(옛 엔진 동작 복원)
import { resolveProductImageUrl } from '../../product-images';
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
  /** ★ 1026: 상품명 사진 자동 찾기 끔(갤러리 견본 = 사진을 직접 고른 목업이라 이름 매칭 오답을 막는다) */
  noAutoImage?: boolean;
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
  if (url.startsWith('http') || url.startsWith('data:image/')) return url; // ★ 1026: 견본 사진(data URL)에 base 를 붙이면 깨진다
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
.dyn-link{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 16px;border-radius:12px;background:#f5f5f5;border:1.5px solid #141210;text-decoration:none;color:#141210;font-size:15px;font-weight:800;min-width:84px;min-height:64px;transition:background .2s}
.dyn-link:active{background:#e5e5e5}
.dyn-anns{margin-bottom:8px}
.dyn-anns-title{font-size:18px;font-weight:900;margin-bottom:8px;color:#141210}
.dyn-ann{background:#f9fafb;border-radius:10px;margin-bottom:6px;border:1px solid #e5e7eb}
.dyn-ann summary{padding:12px 14px;font-size:16px;font-weight:800;color:#141210;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center}
.dyn-ann summary::after{content:'▸';font-size:10px;color:#9ca3af;transition:transform .2s}
.dyn-ann[open] summary::after{transform:rotate(90deg)}
.dyn-ann p{padding:0 14px 12px;font-size:15px;color:#3B3631;line-height:1.6}
</style>
<div class="dyn-section">${parts.join('')}</div>`;
}

// ============================================================
// ★ 1026 18번 — 「매대 가격표」 엔진 (20종 공용 · PRODUCT.md 원칙 1~3 · 40~60대 판독 기준)
//   카드 규칙: 정상가(취소선) → 행사가(가장 크게 · 빨강) + 할인율 딱지 → 「N원 싸게」 → 카드할인.
//   첫 화면 = 머리 띠(매장·행사·기간·전부 사면 아끼는 돈) 바로 아래 상품. 장식·영문 문구·기울인 글씨 없음.
//   클래스는 전부 sc- 접두사 — 공용 CSS(priceStyleBlock·bandStyleBlock)의 범용 셀렉터와 섞이지 않게.
// ============================================================

interface ScThemeInfo { band: string; ink: string; tint: string; chip: string; chipInk: string; rule: string }
const SC_THEMES: Record<ShowcardTheme, ScThemeInfo> = {
  yellow:  { band: '#FFE14D', ink: '#141210', tint: '#F6EFDF', chip: '#FFFFFF', chipInk: '#141210', rule: '#141210' },
  paper:   { band: '#F3EAD3', ink: '#141210', tint: '#F3EAD3', chip: '#FFFFFF', chipInk: '#141210', rule: '#141210' },
  red:     { band: '#C8161A', ink: '#FFFFFF', tint: '#FBE7E3', chip: '#FFE14D', chipInk: '#141210', rule: '#141210' },
  green:   { band: '#1F7A3A', ink: '#FFFFFF', tint: '#E5F2E8', chip: '#FFFFFF', chipInk: '#14421F', rule: '#141210' },
  leaf:    { band: '#CDEBB8', ink: '#14301A', tint: '#EEF7E6', chip: '#FFFFFF', chipInk: '#14301A', rule: '#14301A' },
  navy:    { band: '#17335E', ink: '#FFFFFF', tint: '#E6EDF7', chip: '#FFFFFF', chipInk: '#17335E', rule: '#141210' },
  sky:     { band: '#CFE6FB', ink: '#0F2A47', tint: '#EAF4FE', chip: '#FFFFFF', chipInk: '#0F2A47', rule: '#0F2A47' },
  aqua:    { band: '#BDEBE6', ink: '#0E3B37', tint: '#E8F8F6', chip: '#FFFFFF', chipInk: '#0E3B37', rule: '#0E3B37' },
  pink:    { band: '#C42E66', ink: '#FFFFFF', tint: '#FBE6EE', chip: '#FFE14D', chipInk: '#141210', rule: '#141210' },
  orange:  { band: '#C8500E', ink: '#FFFFFF', tint: '#FCEBDD', chip: '#FFFFFF', chipInk: '#8A3407', rule: '#141210' },
  brown:   { band: '#5A3A22', ink: '#FFFFFF', tint: '#F3E9DF', chip: '#F2D27A', chipInk: '#3A2414', rule: '#141210' },
  gold:    { band: '#7E1A1A', ink: '#FFFFFF', tint: '#F7EEDC', chip: '#E2B34A', chipInk: '#3A1010', rule: '#141210' },
  seol:    { band: '#B3121A', ink: '#FFFFFF', tint: '#FBE7E3', chip: '#E2B34A', chipInk: '#3A1010', rule: '#141210' },
  harvest: { band: '#6B4423', ink: '#FFFFFF', tint: '#F6EBDA', chip: '#F2D27A', chipInk: '#3A2414', rule: '#141210' },
  premium: { band: '#FFFFFF', ink: '#141210', tint: '#F7F2E6', chip: '#B8892B', chipInk: '#FFFFFF', rule: '#B8892B' },
  gray:    { band: '#3F4A57', ink: '#FFFFFF', tint: '#ECEFF2', chip: '#FFE14D', chipInk: '#141210', rule: '#141210' },
};

/** 가격대 묶음(gift tiers) — 판매가 기준 단일 규칙 */
const SC_TIERS: Array<{ max: number; label: string }> = [
  { max: 30000, label: '3만원 이하' },
  { max: 50000, label: '5만원 이하' },
  { max: 100000, label: '10만원 이하' },
  { max: Infinity, label: '10만원 이상' },
];

type ScItem = FlyerRenderItem & { category: string };
type ScSize = 'hero' | 'card' | 'row' | 'tile' | 'single';

function scPrice(it: FlyerRenderItem, size: ScSize): string {
  const disc = calcDisc(it.originalPrice, it.salePrice);
  const hasWas = it.originalPrice > it.salePrice && it.salePrice > 0;
  return '<div class="sc-pr sc-pr-' + size + '">' +
    (hasWas ? '<span class="sc-was">' + fmtPrice(it.originalPrice) + '원</span>' : '') +
    '<div class="sc-line"><span class="sc-now ' + priceScaleClass(it.salePrice) + '">' + fmtPrice(it.salePrice) + '<small>원</small></span>' +
    (disc > 0 ? '<span class="sc-off"><b>' + disc + '%</b><span>할인</span></span>' : '') + '</div>' +
    (hasWas ? '<span class="sc-save">' + fmtPrice(it.originalPrice - it.salePrice) + '원 싸게</span>' : '') +
    (it.cardDiscount ? '<span class="sc-cardd">' + esc(it.cardDiscount) + '</span>' : '') +
  '</div>';
}

function scSpec(it: FlyerRenderItem): string {
  const parts = [it.unit, it.origin].filter(Boolean).map(v => esc(String(v)));
  return parts.length ? '<p class="sc-spec">' + parts.join(' · ') + '</p>' : '';
}

function scTag(badge?: string): string {
  if (!badge) return '';
  return '<span class="sc-tag' + (/한정|오늘만|마감/.test(badge) ? ' sc-tag-r' : '') + '">' + esc(badge) + '</span>';
}

function scPic(it: FlyerRenderItem, cat: string, withTag: boolean): string {
  const img = toAbsUrl(it.imageUrl || '');
  return '<div class="sc-pic">' +
    '<span class="sc-ico">' + categoryPictogram(cat) + '</span>' +
    (img ? '<img src="' + esc(img) + '" alt="' + esc(it.name) + '" loading="lazy" onerror="this.remove()">' : '') +
    (withTag ? scTag(it.badge) : '') +
  '</div>';
}

function scHero(it: ScItem): string {
  return '<article class="sc-hero" data-hero' + productDataAttr(it, it.category) + '>' +
    scPic(it, it.category, false) +
    '<div class="sc-body"><span class="sc-pick">이번 주 대표</span>' + scTag(it.badge) +
      '<h3 class="sc-nm ' + nameSizeClass(it.name) + '">' + esc(it.name) + '</h3>' + scSpec(it) + scPrice(it, 'hero') + '</div>' +
  '</article>';
}

function scCard(it: ScItem): string {
  return '<article class="sc-card"' + productDataAttr(it, it.category) + '>' + scPic(it, it.category, true) +
    '<div class="sc-body"><h3 class="sc-nm ' + nameSizeClass(it.name) + '">' + esc(it.name) + '</h3>' + scSpec(it) + scPrice(it, 'card') + '</div></article>';
}

function scRow(it: ScItem): string {
  return '<li class="sc-row"' + productDataAttr(it, it.category) + '>' + scPic(it, it.category, false) +
    '<div class="sc-rl"><h3 class="sc-nm ' + nameSizeClass(it.name) + '">' + esc(it.name) + scTag(it.badge) + '</h3>' + scSpec(it) + '</div>' +
    scPrice(it, 'row') + '</li>';
}

function scTile(it: ScItem): string {
  return '<article class="sc-tile"' + productDataAttr(it, it.category) + '>' + scPic(it, it.category, true) +
    '<h3 class="sc-nm ' + nameSizeClass(it.name) + '">' + esc(it.name) + '</h3>' + scSpec(it) + scPrice(it, 'tile') + '</article>';
}

function scSingle(it: ScItem): string {
  return '<article class="sc-single" data-hero' + productDataAttr(it, it.category) + '>' + scPic(it, it.category, false) +
    '<div class="sc-body">' + scTag(it.badge) + '<h3 class="sc-nm ' + nameSizeClass(it.name) + '">' + esc(it.name) + '</h3>' + scSpec(it) + scPrice(it, 'single') + '</div></article>';
}

function scCatHead(name: string, count: number, id: string): string {
  return '<h2 class="sc-cat" id="' + id + '"><span class="sc-cico">' + categoryPictogram(name) + '</span>' + esc(name) + '<em>' + count + '개</em></h2>';
}

export function renderShowcardEngine(d: FlyerRenderData, token: SeasonToken, spec: ShowcardSpec): string {
  const th = SC_THEMES[spec.theme] || SC_THEMES.yellow;
  // 사진 주소가 빈 상품 = 상품명으로 내장 사진 라이브러리를 찾는다(못 찾으면 그림 아이콘)
  if (!d.noAutoImage) {
    d = { ...d, categories: d.categories.map(c => ({ ...c, items: c.items.map(x => (x.imageUrl ? x : { ...x, imageUrl: resolveProductImageUrl(x.name) || undefined })) })) };
  }
  const items: ScItem[] = flattenItems(d);
  const heroN = spec.layout === 'single' ? Math.min(1, items.length)
    : (spec.layout === 'heroGrid' || spec.layout === 'heroList') ? Math.min(spec.heroN, items.length) : 0;
  const heroes = items.slice(0, heroN);
  const totalSave = items.reduce((s, it) => s + (it.originalPrice > it.salePrice && it.salePrice > 0 ? it.originalPrice - it.salePrice : 0), 0);
  const period = d.periodStart && d.periodEnd
    ? d.periodStart.replace(/-/g, '.').slice(5) + ' ~ ' + d.periodEnd.replace(/-/g, '.').slice(5)
    : (d.period || '');
  const phone = (d.externalLinks || []).find(l => l.icon === 'phone');
  const ogTitle = d.storeName + ' · ' + d.title;
  const ogDesc = items.slice(0, 3).map(i => i.name + ' ' + fmtPrice(i.salePrice) + '원').join(' · ');

  // 대표를 뺀 나머지를 카테고리별로(위치로 판정 — 같은 이름 상품 오제외 차단)
  let pos = 0;
  const groups = d.categories.map(cat => ({
    name: cat.name,
    items: cat.items.map(it => ({ ...it, category: cat.name } as ScItem)).filter(() => pos++ >= heroN),
  })).filter(g => g.items.length > 0);

  let body = '';
  if (heroes.length) body += '<section class="sc-heroes' + (heroes.length === 2 ? ' sc-h2' : '') + '">' + heroes.map(spec.layout === 'single' ? scSingle : scHero).join('') + '</section>';

  if (spec.layout === 'tiers') {
    const tiers = SC_TIERS.map(t => ({ ...t, items: [] as ScItem[] }));
    for (const it of items) tiers.find(t => it.salePrice <= t.max)!.items.push(it);
    body += tiers.filter(t => t.items.length).map((t, i) =>
      '<section class="sc-sec"><h2 class="sc-cat sc-tier" id="sc-c' + i + '">' + esc(t.label) + '<em>' + t.items.length + '종</em></h2>' +
      '<div class="sc-grid">' + t.items.map(scCard).join('') + '</div></section>').join('');
  } else {
    body += groups.map((g, i) => {
      const head = scCatHead(g.name, g.items.length, 'sc-c' + i);
      if (spec.layout === 'list' || spec.layout === 'heroList' || spec.layout === 'single') {
        return '<section class="sc-sec">' + head + '<ul class="sc-rows">' + g.items.map(scRow).join('') + '</ul></section>';
      }
      if (spec.layout === 'tiles') {
        return '<section class="sc-sec">' + head + '<div class="sc-tiles">' + g.items.map(scTile).join('') + '</div></section>';
      }
      return '<section class="sc-sec">' + head + '<div class="sc-grid">' + g.items.map(scCard).join('') + '</div></section>';
    }).join('');
  }

  const tabNames = spec.layout === 'tiers' ? [] : groups.map(g => g.name);
  // 분류 이동 줄은 분류 셋 이상일 때만 — 둘 이하는 스크롤 한 번이면 닿고, 첫 화면 상품 자리를 먼저 쓴다
  const tabs = tabNames.length >= 3
    ? '<nav class="sc-tabs" aria-label="상품 분류">' + tabNames.map((n, i) => '<a href="#sc-c' + i + '">' + esc(n) + '</a>').join('') + '</nav>'
    : '';

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ogTitle)}</title>
<meta property="og:title" content="${esc(ogTitle)}"><meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(buildOgImageUrl(d, token))}"><meta property="og:type" content="website">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap" rel="stylesheet">
<style>
:root{--sc-band:${th.band};--sc-band-ink:${th.ink};--sc-tint:${th.tint};--sc-chip:${th.chip};--sc-chip-ink:${th.chipInk};--sc-rule:${th.rule};
  --sc-red:#D7191C;--sc-red-ink:#A50E12;--sc-ink:#141210;--sc-ink-2:#3B3631;--sc-ink-3:#5E5750;--sc-line:#141210;--sc-dash:#CFC8BB;
  --sc-num:'Black Han Sans','Pretendard Variable',sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{background:#FFFFFF;color:var(--sc-ink);font-family:'Pretendard Variable',system-ui,sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
::selection{background:#FFE14D;color:#141210}
a:focus-visible,button:focus-visible{outline:3px solid var(--sc-red);outline-offset:2px}
.sc{max-width:520px;margin:0 auto;padding-bottom:40px}
.sc-top{position:relative;background:var(--sc-band);color:var(--sc-band-ink);padding:12px 16px 12px;border-bottom:2px solid var(--sc-rule)}
.sc-store{font-size:15px;font-weight:800;padding-right:60px}
.sc-ttl{margin-top:1px;font-size:26px;font-weight:900;letter-spacing:-0.03em;line-height:1.2;word-break:keep-all;padding-right:56px}
.sc-per{margin-top:3px;font-size:15px;font-weight:700;opacity:.92}
.sc-sum{margin-top:8px;display:inline-flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;padding:6px 12px;background:#FFFFFF;color:var(--sc-ink);border:1.5px solid var(--sc-line);border-radius:6px;font-size:15px;font-weight:800}
.sc-sum b{font-family:var(--sc-num);font-weight:400;font-size:22px;color:var(--sc-red);white-space:nowrap}
.sc-call{position:absolute;right:14px;top:14px;width:48px;height:48px;border-radius:10px;border:1.5px solid var(--sc-line);background:#FFFFFF;color:var(--sc-ink);display:grid;place-items:center}
.sc-call svg{width:22px;height:22px}
.sc-tabs{position:sticky;top:0;z-index:5;display:flex;gap:6px;padding:10px 12px;background:#FFFFFF;border-bottom:1.5px solid var(--sc-line);overflow-x:auto;scrollbar-width:none}
.sc-tabs::-webkit-scrollbar{display:none}
.sc-tabs a{flex:none;height:40px;padding:0 15px;display:flex;align-items:center;border-radius:999px;border:1.5px solid var(--sc-line);font-size:16px;font-weight:800;color:var(--sc-ink);text-decoration:none;background:#FFFFFF}
.sc-cat{display:flex;align-items:center;gap:8px;padding:14px 16px 6px;font-size:21px;font-weight:900;letter-spacing:-0.02em;scroll-margin-top:64px}
.sc-cico{width:32px;height:32px;border-radius:8px;background:var(--sc-ink);display:grid;place-items:center;font-size:19px;--picto-color:#FFFFFF}
.sc-cico svg{display:block}
.sc-cat em{font-style:normal;font-size:15px;font-weight:700;color:var(--sc-ink-3);margin-left:auto}
.sc-tier{color:var(--sc-ink)}
.sc-tier::before{content:"";width:10px;height:24px;border-radius:3px;background:var(--sc-band);border:1.5px solid var(--sc-line)}
.sc-heroes{display:grid;gap:10px;padding:12px 12px 2px}
/* 대표 둘 = 나란히 두 장(세로 카드) — 첫 화면에 다음 줄 상품까지 들어오게 */
.sc-heroes.sc-h2{grid-template-columns:1fr 1fr}
.sc-h2 .sc-hero{grid-template-columns:1fr}
.sc-h2 .sc-hero .sc-pic{border-right:0;border-bottom:2px solid var(--sc-line);min-height:0;height:76px}
.sc-h2 .sc-hero .sc-ico{font-size:48px}
.sc-h2 .sc-hero .sc-body{padding:10px 11px 12px}
.sc-h2 .sc-pick{margin-bottom:4px}
.sc-h2 .sc-hero .sc-nm{font-size:18px}.sc-h2 .sc-hero .sc-nm.nm-m,.sc-h2 .sc-hero .sc-nm.nm-l{font-size:16px}
.sc-h2 .sc-pr-hero .sc-now{font-size:32px}.sc-h2 .sc-pr-hero .sc-now small{font-size:16px}.sc-h2 .sc-pr-hero .sc-off{min-width:46px;height:40px}.sc-h2 .sc-pr-hero .sc-off b{font-size:18px}.sc-h2 .sc-pr-hero .sc-off span{font-size:11px}
.sc-tag{display:inline-flex;align-items:center;height:26px;padding:0 9px;border-radius:5px;font-size:14px;font-weight:900;background:#FFE14D;color:#141210;border:1.5px solid var(--sc-line);white-space:nowrap}
.sc-tag-r{background:var(--sc-red);color:#FFFFFF;border-color:var(--sc-red)}
.sc-pick{display:inline-flex;align-items:center;height:26px;padding:0 9px;margin-right:6px;border-radius:5px;font-size:14px;font-weight:900;background:var(--sc-chip);color:var(--sc-chip-ink);border:1.5px solid var(--sc-line)}
.sc-pic{position:relative;background:var(--sc-tint);display:grid;place-items:center;overflow:hidden}
.sc-pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;background:#FFFFFF}
.sc-ico{display:flex;color:var(--sc-ink);--picto-color:var(--sc-ink)}
.sc-pic .sc-tag{position:absolute;left:8px;top:8px}
.sc-nm{font-weight:900;letter-spacing:-0.02em;line-height:1.3;word-break:keep-all}
.sc-spec{margin-top:2px;font-size:15px;font-weight:600;color:var(--sc-ink-3)}
.sc-was{display:block;font-size:15px;font-weight:600;color:var(--sc-ink-3);text-decoration:line-through;text-decoration-thickness:1.5px;font-variant-numeric:tabular-nums}
.sc-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sc-now{font-family:var(--sc-num);font-weight:400;line-height:1;color:var(--sc-red);font-variant-numeric:tabular-nums}
.sc-now small{margin-left:1px}
.sc-off{display:inline-grid;place-items:center;align-content:center;padding:0 6px;background:var(--sc-red);color:#FFFFFF;border-radius:6px;line-height:1;text-align:center}
.sc-off b{font-family:var(--sc-num);font-weight:400;display:block}
.sc-off span{font-weight:800;display:block;margin-top:2px}
.sc-save{display:block;margin-top:3px;font-size:15px;font-weight:800;color:var(--sc-red-ink)}
.sc-cardd{display:block;margin-top:4px;font-size:14px;font-weight:800;color:#1D4ED8}
/* 크기 계단 — 행사가는 어느 형태에서도 28px 이상 */
.sc-pr-hero .sc-now{font-size:42px}.sc-pr-hero .sc-now small{font-size:20px}.sc-pr-hero .sc-off{min-width:56px;height:48px}.sc-pr-hero .sc-off b{font-size:23px}.sc-pr-hero .sc-off span{font-size:12px}
.sc-pr-card .sc-now{font-size:30px}.sc-pr-card .sc-now small{font-size:16px}.sc-pr-card .sc-off{min-width:46px;height:40px}.sc-pr-card .sc-off b{font-size:18px}.sc-pr-card .sc-off span{font-size:11px}
.sc-pr-row .sc-now{font-size:30px}.sc-pr-row .sc-now small{font-size:16px}.sc-pr-row .sc-off{min-width:44px;height:38px}.sc-pr-row .sc-off b{font-size:17px}.sc-pr-row .sc-off span{font-size:11px}
.sc-pr-tile .sc-now{font-size:28px}.sc-pr-tile .sc-now small{font-size:15px}.sc-pr-tile .sc-off{min-width:42px;height:36px}.sc-pr-tile .sc-off b{font-size:16px}.sc-pr-tile .sc-off span{font-size:11px}
.sc-pr-single .sc-now{font-size:72px}.sc-pr-single .sc-now small{font-size:28px}.sc-pr-single .sc-off{min-width:72px;height:62px}.sc-pr-single .sc-off b{font-size:30px}.sc-pr-single .sc-off span{font-size:14px}
.sc-now.pr-m{transform-origin:left center}
.sc-pr-card .sc-now.pr-l,.sc-pr-row .sc-now.pr-l{font-size:28px}
.sc-pr-hero .sc-now.pr-l{font-size:32px}
/* 가로 대표 카드 = 가격과 할인율 딱지를 한 줄로(여섯 자리 가격이 딱지를 밀어내 카드가 길어지던 것) */
.sc-heroes:not(.sc-h2) .sc-pr-hero .sc-line{flex-wrap:nowrap}
/* 대표 카드 */
.sc-hero{display:grid;grid-template-columns:128px 1fr;border:2px solid var(--sc-line);border-radius:10px;overflow:hidden;background:#FFFFFF}
.sc-hero .sc-pic{border-right:2px solid var(--sc-line);min-height:132px}
.sc-hero .sc-ico{font-size:56px}
.sc-hero .sc-body{padding:10px 14px}
.sc-hero .sc-nm{margin-top:6px;font-size:21px}
.sc-hero .sc-nm.nm-m{font-size:19px}.sc-hero .sc-nm.nm-l{font-size:17px}
.sc-hero .sc-pr{margin-top:4px}
/* 2열 카드 */
.sc-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:6px 12px 4px}
.sc-card{border:1.5px solid var(--sc-line);border-radius:9px;overflow:hidden;display:flex;flex-direction:column;background:#FFFFFF}
.sc-card .sc-pic{height:96px;border-bottom:1.5px solid var(--sc-line)}
.sc-card .sc-ico{font-size:34px}
.sc-card .sc-body{padding:9px 11px 11px;display:flex;flex-direction:column;flex:1}
.sc-card .sc-nm{font-size:17px}.sc-card .sc-nm.nm-m{font-size:16px}.sc-card .sc-nm.nm-l{font-size:16px}
.sc-card .sc-spec{font-size:14px}
.sc-card .sc-pr{margin-top:auto;padding-top:4px}
.sc-card .sc-was{font-size:14px}.sc-card .sc-save{font-size:14px}
/* 가격 줄표 */
.sc-rows{list-style:none;padding:0 14px}
.sc-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 2px;border-bottom:1.5px dashed var(--sc-dash)}
.sc-row .sc-pic{flex:none;width:68px;height:68px;border:1.5px solid var(--sc-line);border-radius:8px}
.sc-row .sc-ico{font-size:32px}
.sc-rl{min-width:0;flex:1}
.sc-row .sc-nm{font-size:17px;font-weight:800}
.sc-row .sc-nm .sc-tag{height:22px;font-size:12.5px;padding:0 7px;margin-left:6px;vertical-align:2px}
.sc-row .sc-spec{font-size:14px}
.sc-row .sc-pr{text-align:right;flex:none}
.sc-row .sc-line{justify-content:flex-end;gap:6px}
.sc-row .sc-was{font-size:14px}.sc-row .sc-save{font-size:14px}
/* 두 칸 가격표 */
.sc-tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px 12px 4px}
.sc-tile{border:1.5px solid var(--sc-line);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;background:#FFFFFF}
.sc-tile .sc-pic{height:84px;border-bottom:1.5px solid var(--sc-line)}
.sc-tile .sc-ico{font-size:34px}
.sc-tile .sc-tag{height:22px;font-size:12.5px;padding:0 7px}
.sc-tile .sc-nm{padding:8px 10px 0}.sc-tile .sc-spec{padding:0 10px}.sc-tile .sc-pr{padding:6px 10px 10px}
.sc-tile .sc-nm{font-size:16px;font-weight:800}
.sc-tile .sc-spec{font-size:14px}
.sc-tile .sc-pr{margin-top:auto}
.sc-tile .sc-was{font-size:14px}.sc-tile .sc-save{font-size:14px}
/* 단일 */
.sc-single{border:2px solid var(--sc-line);border-radius:12px;overflow:hidden;background:#FFFFFF}
.sc-single .sc-pic{aspect-ratio:4/3;border-bottom:2px solid var(--sc-line)}
.sc-single .sc-ico{font-size:120px}
.sc-single .sc-body{padding:14px 16px 16px}
.sc-single .sc-nm{margin-top:6px;font-size:28px}.sc-single .sc-nm.nm-m{font-size:25px}.sc-single .sc-nm.nm-l{font-size:22px}
.sc-single .sc-spec{font-size:16px}
.sc-single .sc-pr{margin-top:10px}.sc-single .sc-was{font-size:18px}.sc-single .sc-save{font-size:18px}
.sc-foot{margin-top:30px;padding:18px 16px 0;text-align:center;border-top:1.5px solid var(--sc-dash)}
.sc-foot b{display:block;font-size:20px;font-weight:900}
.sc-foot p{margin-top:6px;font-size:14px;color:var(--sc-ink-3)}
@media (max-width:360px){.sc-hero{grid-template-columns:104px 1fr}.sc-pr-hero .sc-now{font-size:36px}.sc-grid,.sc-tiles{gap:8px;padding-left:8px;padding-right:8px}}
</style>
</head>
<body>
<main class="sc" data-layout="${spec.layout}" data-theme="${spec.theme}">
  <header class="sc-top">
    <p class="sc-store">${esc(d.storeName)}</p>
    <h1 class="sc-ttl">${esc(d.title)}</h1>
    ${period ? '<p class="sc-per">' + esc(period) + '</p>' : ''}
    ${totalSave > 0 ? '<p class="sc-sum">이번 전단 다 사면 <b>' + fmtPrice(totalSave) + '원</b> 아껴요</p>' : ''}
    ${phone ? '<a class="sc-call" href="' + esc(phone.url) + '" aria-label="매장 전화"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg></a>' : ''}
  </header>
  ${tabs}
  ${body}
  <footer class="sc-foot"><b>${esc(d.storeName)}</b><p>준비 수량이 다 팔리면 행사가 일찍 끝날 수 있습니다</p></footer>
</main>
</body>
</html>`;
}

// ============================================================
// 단일 진입점 — 템플릿 코드 → 사양 → 매대 가격표 엔진 + 후처리
// ============================================================

/**
 * ★ 단일 진입점.
 * 1. templateCode → TEMPLATE_SPEC(20종) · 폐기 코드는 DEPRECATED_FALLBACK_MAP 로 20종 중 하나 · 그 밖은 grid_hero.
 * 2. 시즌 토큰 결정(data.seasonToken 우선, 미지정 시 title+periodStart) — 매체 토큰·og 이미지용.
 * 3. 엔진 호출 + 후처리(밴드 속성 · 매체 토큰 · 변형 · dynamic · qr · cart-script).
 */
export function renderTemplate(
  templateCode: string,
  data: FlyerRenderData,
  opts?: { variant?: DesignVariant | null },
): string {
  // 자기 키만 본다 — 'constructor' 같은 프로토타입 키가 사양으로 잡히면 렌더가 깨진다(외부 입력 코드)
  const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  let code = own(TEMPLATE_SPEC, templateCode)
    ? templateCode
    : (own(DEPRECATED_FALLBACK_MAP, templateCode) ? DEPRECATED_FALLBACK_MAP[templateCode] : 'grid_hero');
  if (!own(TEMPLATE_SPEC, code)) code = 'grid_hero';

  const prepped = prepareFlyerData(data);
  const seasonToken: SeasonToken = prepped.seasonToken || resolveSeasonToken(prepped.title, prepped.periodStart);
  let html = renderShowcardEngine(prepped, seasonToken, TEMPLATE_SPEC[code]);

  const band = itemCountBand(countItems(prepped));
  html = html.replace('<html lang="ko" data-season=', `<html lang="ko" data-engine="showcard" data-template="${code}" data-band="${band}" data-season=`);
  const headInject = `<style data-media-css>${generateMediaCssBlock('url', seasonToken)}</style>` + bandStyleBlock(band)
    + `<style data-price-css>${priceStyleBlock()}</style>`
    + (opts?.variant ? `<style data-variant-css>${variantToStyleBlock(opts.variant)}</style>` : '');
  html = html.replace('</head>', headInject + '</head>');

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
