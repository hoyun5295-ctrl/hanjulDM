/**
 * ★ CT-F24 — 렌더 준비(자동 완성 품질) 공용 모듈 (2026-08-20 슈퍼버전업 2단계 신설 — 13번 설계 §4)
 *
 * "어떤 입력이 와도 완성"의 데이터·CSS 공용 축. 엔진(flyer-templates.ts)이 소비한다.
 *   1. extractPromoToken   — 상품명 속 프로모 토큰(1+1·2+1·×2)을 badge로 분리(이름 3줄 밀림의 주범 제거)
 *   2. prepareFlyerData    — categories 전 상품에 위 분리 적용(원본 무변경 — 새 객체 반환)
 *   3. itemCountBand       — 상품 수 밴드 3단(≤6 small / 7~20 mid / 21+ large — 회의론자 조건 d)
 *   4. bandStyleBlock      — 밴드별 그리드·밀도 CSS 오버라이드(엔진 실측 셀렉터에만 건다)
 *   5. nameSizeClass·priceScaleClass — 이름 길이·가격 자릿수 계급(엔진 마크업이 부여)
 *   6. categoryPictogram   — 무이미지 폴백 SVG 픽토그램(이모지 폐기 — OS별 모양 상이·폴백 티 제거)
 *
 * ⛔ 판정을 두 곳에 두지 않는다 — 밴드·계급 판정은 전부 여기가 소유하고 엔진은 클래스만 소비한다.
 */

import type { FlyerRenderData, FlyerRenderItem } from './flyer-templates';

// ============================================================
// 1. 프로모 토큰 분리 — "1+1 해태 홈런볼 46g×2" → name "해태 홈런볼 46g", badge "1+1"
// ============================================================

const PROMO_PATTERNS: Array<{ re: RegExp; label: (m: RegExpMatchArray) => string }> = [
  { re: /(\d+)\s*\+\s*(\d+)/, label: (m) => `${m[1]}+${m[2]}` },
  { re: /[×xX*]\s*(\d+)(?=\s|$)/, label: (m) => `${m[1]}개 묶음` },
];

export function extractPromoToken(rawName: string): { name: string; promo: string | null } {
  let name = String(rawName || '');
  let promo: string | null = null;
  for (const p of PROMO_PATTERNS) {
    const m = name.match(p.re);
    if (m) {
      promo = p.label(m);
      name = name.replace(p.re, ' ');
      break; // 첫 토큰 하나만 — 뱃지는 한 장에 하나가 읽힌다
    }
  }
  return { name: name.replace(/\s+/g, ' ').trim() || String(rawName || '').trim(), promo };
}

/**
 * 2. categories 전 상품에 프로모 분리 적용. 기존 badge가 있으면 보존(사장님 입력이 이긴다).
 * 원본을 mutate하지 않는다 — 저장된 answers/categories 원장은 불변(표시 파생만).
 */
export function prepareFlyerData<T extends FlyerRenderData>(data: T): T {
  return {
    ...data,
    categories: (data.categories || []).map(cat => ({
      ...cat,
      items: (cat.items || []).map((it: FlyerRenderItem) => {
        const { name, promo } = extractPromoToken(it.name);
        return { ...it, name, badge: it.badge || promo || undefined };
      }),
    })),
  };
}

// ============================================================
// 3. 상품 수 밴드 — 자동 템플릿 결정의 선행 조건(13번 설계 §4-2)
// ============================================================

export type ItemCountBand = 'small' | 'mid' | 'large';

export function itemCountBand(totalItems: number): ItemCountBand {
  if (totalItems <= 6) return 'small';
  if (totalItems <= 20) return 'mid';
  return 'large';
}

export function countItems(data: FlyerRenderData): number {
  return (data.categories || []).reduce((s, c) => s + (c.items?.length || 0), 0);
}

// ============================================================
// 4. 밴드 CSS 오버라이드 — 엔진 실측 셀렉터에만 건다(2026-08-20 grep 실측:
//    grid_hero .grid / grid_muji .pgrid / poster_pop .pair / deal_bento .bento).
//    small = 상품이 주인공(1열 대판) / mid = 현행 2열 / large = 2열 밀도 압축(스크롤 절감).
// ============================================================

export function bandStyleBlock(band: ItemCountBand): string {
  if (band === 'small') {
    return `<style data-band-css>
html[data-band="small"] .grid{grid-template-columns:1fr}
html[data-band="small"] .pgrid{grid-template-columns:1fr}
html[data-band="small"] .pair{grid-template-columns:1fr}
html[data-band="small"] .bento{grid-auto-rows:96px}
</style>`;
  }
  if (band === 'large') {
    return `<style data-band-css>
html[data-band="large"] .grid{gap:8px}
html[data-band="large"] .grid .card{border-radius:10px}
html[data-band="large"] .pgrid .pcell{padding:10px 8px}
html[data-band="large"] .pair{gap:8px}
html[data-band="large"] .bento{grid-auto-rows:64px;gap:8px}
html[data-band="large"] .slab .body{grid-template-columns:104px 1fr;gap:10px;padding:10px}
</style>`;
  }
  return ''; // mid = 엔진 기본 레이아웃 그대로
}

// ============================================================
// 5. 이름 길이·가격 자릿수 계급 — 값이 극단이어도 칸이 버틴다(13번 설계 §4-3·§4-4)
// ============================================================

/** 이름 계급: nm-s(≤8자) / nm-m(≤16자) / nm-l(초과). 엔진 마크업이 이름 요소에 부여 */
export function nameSizeClass(name: string): 'nm-s' | 'nm-m' | 'nm-l' {
  const len = String(name || '').trim().length;
  if (len <= 8) return 'nm-s';
  if (len <= 16) return 'nm-m';
  return 'nm-l';
}

/** 가격 계급: pr-s(4자리 이하) / pr-m(5자리) / pr-l(6자리 이상). 1,290원과 129,000원은 다른 폭이다 */
export function priceScaleClass(salePrice: number): 'pr-s' | 'pr-m' | 'pr-l' {
  const digits = String(Math.max(0, Math.floor(Number(salePrice) || 0))).length;
  if (digits <= 4) return 'pr-s';
  if (digits === 5) return 'pr-m';
  return 'pr-l';
}

/** 계급 공용 CSS — 부여하는 엔진(grid_hero·poster_promo 1차)의 <style>에 prepend */
export function scaleStyleBlock(): string {
  return `
.nm-s{font-size:1em}
.nm-m{font-size:.92em;letter-spacing:-.02em}
.nm-l{font-size:.82em;letter-spacing:-.03em;line-height:1.3}
.pr-s{font-size:1em}
.pr-m{font-size:.92em;letter-spacing:-.02em}
.pr-l{font-size:.8em;letter-spacing:-.03em}
`;
}

// ============================================================
// 6. 카테고리 픽토그램 — 단색 스트로크 SVG(1em 스케일·흰색 고정 — 폴백 배경은 전부 짙은 색).
//    이모지 폴백 폐기: OS별 모양이 다르고 "임시 화면" 티가 났다(디자이너 1차 수용).
// ============================================================

const P = (paths: string) =>
  `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:.92" aria-hidden="true">${paths}</svg>`;

const PICTOGRAMS: Record<string, string> = {
  leaf: P('<path d="M5 20c0-8 5-14 14-15-1 9-7 14-14 15z"/><path d="M5 20c3-5 7-9 11-11"/>'),
  apple: P('<path d="M12 7c-4-2-8 1-8 6 0 4 3 8 6 8 1 0 1.6-.5 2-.5s1 .5 2 .5c3 0 6-4 6-8 0-5-4-8-8-6z"/><path d="M12 7c0-2 1-4 3-5"/>'),
  meat: P('<ellipse cx="11" cy="12" rx="8" ry="6"/><ellipse cx="11" cy="12" rx="3.4" ry="2.4"/><path d="M19 8l2.2-2.2M21 12h2"/>'),
  fish: P('<path d="M3 12c3-4 7-6 11-6 3 0 6 2 7 6-1 4-4 6-7 6-4 0-8-2-11-6z"/><path d="M14 6l3 6-3 6"/><circle cx="7.5" cy="11" r=".6" fill="#FFFFFF"/>'),
  box: P('<path d="M3 8l9-4 9 4v8l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v8"/>'),
  snowflake: P('<path d="M12 3v18M5 6.5l14 11M19 6.5l-14 11"/><path d="M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2"/>'),
  milk: P('<path d="M9 3h6v3l2 4v9a2 2 0 01-2 2H9a2 2 0 01-2-2v-9l2-4z"/><path d="M7 12h10"/>'),
  cup: P('<path d="M6 4h10l-1.2 16a2 2 0 01-2 1.8H9.2a2 2 0 01-2-1.8z"/><path d="M16 7h3a2 2 0 010 4h-3.4"/>'),
  bottle: P('<path d="M10 3h4v4l2 3v10a2 2 0 01-2 2h-4a2 2 0 01-2-2V10l2-3z"/><path d="M8 14h8"/>'),
  spray: P('<path d="M9 8h6v13H9z"/><path d="M11 8V5h2v3M13 3h4M15 3v2"/>'),
  bread: P('<path d="M4 12a4 4 0 014-4h8a4 4 0 012 7.5V20H6v-4.5A4 4 0 014 12z"/><path d="M10 8c0 3-2 4-2 6M15 8c0 3-2 4-2 6"/>'),
  cookie: P('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r=".7" fill="#FFFFFF"/><circle cx="14.5" cy="9" r=".7" fill="#FFFFFF"/><circle cx="11" cy="15" r=".7" fill="#FFFFFF"/><circle cx="15.5" cy="14" r=".7" fill="#FFFFFF"/>'),
  cart: P('<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2.5l2.3 11.5a1.5 1.5 0 001.5 1.2h7.9a1.5 1.5 0 001.5-1.2L20.5 8H6"/>'),
};

const CATEGORY_PICTO_MAP: Record<string, string> = {
  '청과/야채': 'leaf', '청과': 'apple', '야채': 'leaf', '과일': 'apple',
  '축산': 'meat', '정육': 'meat', '한우': 'meat', '돈육': 'meat',
  '수산': 'fish',
  '공산': 'box', '공산품': 'box',
  '냉동': 'snowflake',
  '유제품': 'milk',
  '음료/주류': 'bottle', '음료': 'cup', '주류': 'bottle',
  '생활용품': 'spray',
  '베이커리': 'bread', '빵': 'bread',
  '간식': 'cookie',
};

/** 무이미지 폴백 픽토그램 — categoryEmoji의 대체(같은 호출 자리에서 그대로 치환 가능) */
export function categoryPictogram(name: string): string {
  const key = CATEGORY_PICTO_MAP[(name || '').trim()] || 'cart';
  return PICTOGRAMS[key];
}
