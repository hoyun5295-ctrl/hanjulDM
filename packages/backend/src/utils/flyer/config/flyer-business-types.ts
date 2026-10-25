/**
 * ★ CT-F13 — 전단AI 업종 레지스트리 컨트롤타워
 *
 * 업종(business_type) 조회 + 템플릿 메타데이터의 유일한 진입점.
 * - DB: flyer_business_types 테이블에서 업종별 카테고리 프리셋 + 사용 가능 템플릿 조회
 * - 코드: TEMPLATE_REGISTRY에 템플릿 label/desc/color 메타데이터 정의
 *
 * 업종 추가: DB INSERT만으로 확장 (코드 수정 없음)
 * 템플릿 추가: TEMPLATE_REGISTRY + CT-F14 렌더러 추가
 */

import { query } from '../../../config/database';

// ============================================================
// 인터페이스
// ============================================================

export interface BusinessType {
  type_code: string;
  type_name: string;
  category_presets: string[];
  default_template: string;
  is_active: boolean;
  sort_order: number;
}

export interface TemplateInfo {
  value: string;
  label: string;
  desc: string;
  color: string; // ★ D114: CSS gradient (인라인 스타일용) — Tailwind 동적 클래스는 purge됨
  /** ★ 1025 17번 §3-5 갤러리 — 장면 한 줄 · 상품 수 범위 · 사진 필요 · 행사 성격 걸러보기 */
  scene?: string;
  itemRange?: string;
  needsPhoto?: boolean;
  filter?: TemplateFilter;
}

export type TemplateFilter = 'weekly' | 'deal' | 'fresh' | 'holiday' | 'premium';

/**
 * ★ 1026 18번 — 「매대 가격표」 한 엔진(renderShowcardEngine) + 템플릿마다 사양 하나.
 *   구조(layout) 7 · 대표 상품 수(heroN) · 색 테마(theme) · 갤러리 목업(mockSet).
 *   카드·가격 규칙(행사가 최대 · 할인율 딱지 · 정상가 취소선 · 아끼는 금액)은 엔진 공용 — 20종 모두 같은 가독성.
 *   (layout, heroN, theme) 조합은 템플릿마다 달라야 한다(시험이 검사).
 */
export type ShowcardLayout = 'heroGrid' | 'grid' | 'list' | 'tiles' | 'single' | 'tiers' | 'heroList';
export type ShowcardTheme =
  | 'yellow' | 'paper' | 'red' | 'green' | 'leaf' | 'navy' | 'sky' | 'aqua'
  | 'pink' | 'orange' | 'brown' | 'gold' | 'seol' | 'harvest' | 'premium' | 'gray';
export interface ShowcardSpec {
  layout: ShowcardLayout;
  /** 대표(크게) 상품 수 — heroGrid·heroList·single 에서만 쓴다 */
  heroN: 0 | 1 | 2;
  theme: ShowcardTheme;
  /** 갤러리 미리보기 목업 세트(template-mocks.ts) */
  mockSet: string;
}
export const TEMPLATE_SPEC: Record<string, ShowcardSpec> = {
  grid_hero:    { layout: 'heroGrid', heroN: 1, theme: 'yellow',  mockSet: 'mixed' },
  fresh_daily:  { layout: 'heroGrid', heroN: 1, theme: 'green',   mockSet: 'produce' },
  market_board: { layout: 'list',     heroN: 0, theme: 'paper',   mockSet: 'grocery' },
  deal_feed:    { layout: 'heroList', heroN: 1, theme: 'red',     mockSet: 'mixed' },
  deal_bento:   { layout: 'grid',     heroN: 0, theme: 'sky',     mockSet: 'dairy' },
  grid_muji:    { layout: 'heroGrid', heroN: 1, theme: 'premium', mockSet: 'gift' },
  poster_promo: { layout: 'heroGrid', heroN: 2, theme: 'red',     mockSet: 'meat' },
  poster_pop:   { layout: 'grid',     heroN: 0, theme: 'aqua',    mockSet: 'produce' },
  magazine:     { layout: 'heroList', heroN: 1, theme: 'brown',   mockSet: 'meat' },
  catalog_dark: { layout: 'list',     heroN: 0, theme: 'navy',    mockSet: 'drinks' },
  price_board:  { layout: 'tiles',    heroN: 0, theme: 'yellow',  mockSet: 'priceBoard' },
  single_hero:  { layout: 'single',   heroN: 1, theme: 'red',     mockSet: 'single' },
  gift_set:     { layout: 'tiers',    heroN: 0, theme: 'gold',    mockSet: 'gift' },
  fd_produce:   { layout: 'grid',     heroN: 0, theme: 'leaf',    mockSet: 'produce' },
  fd_seafood:   { layout: 'heroGrid', heroN: 2, theme: 'navy',    mockSet: 'seafood' },
  mb_seol:      { layout: 'heroList', heroN: 1, theme: 'seol',    mockSet: 'meat' },
  mb_dense:     { layout: 'tiles',    heroN: 0, theme: 'gray',    mockSet: 'grocery' },
  pp_opening:   { layout: 'heroGrid', heroN: 2, theme: 'pink',    mockSet: 'mixed' },
  pp_chuseok:   { layout: 'list',     heroN: 0, theme: 'harvest', mockSet: 'gift' },
  pp_weekend:   { layout: 'heroList', heroN: 2, theme: 'orange',  mockSet: 'mixed' },
};

// ============================================================
// 템플릿 메타데이터 레지스트리 (코드에서 정의)
// ★ D114: color를 Tailwind 클래스 → CSS linear-gradient hex로 변경
//   이유: API에서 동적으로 받아오는 Tailwind 클래스는 빌드 시 purge되어 색상 미표시
// ============================================================

// ============================================================
// ★ D154 PHASE 0 — D155 확장 (10 활성 엔진 + STORY는 코드 폴백 유지)
// ============================================================
// D154 = 6 엔진 (story/magazine/deal_feed/grid_hero/catalog_swipe/poster_promo).
// D155 = STORY 제외 5 엔진의 b-variant 5 추가 = 10 활성 엔진:
//   magazine + magazine_zine / deal_feed + deal_bento / grid_hero + grid_muji
//   / catalog_swipe + catalog_dark / poster_promo + poster_pop
// STORY는 RENDERERS에 코드 유지 (옛 발행 전단 URL template='story' 자동 폴백 안전), TEMPLATE_REGISTRY에서만 제거.
// 시즌·행사는 별도 시즌 토큰 8종으로 분리 (CT-F season-resolver.ts + season-tokens.json).
//
// deprecated 22종 발행 전단 안전 렌더: DEPRECATED_FALLBACK_MAP + CT-F14 renderTemplate 분기.
// ============================================================
export const TEMPLATE_REGISTRY: Record<string, TemplateInfo> = {
  // ★ 1026 18번 — 20종 모두 「매대 가격표」 카드 규칙. 코드는 그대로(저장된 전단 호환) · 이름·장면은 새 구성.
  grid_hero:    { value: 'grid_hero',    label: '이번 주 행사',     desc: '대표 상품 하나를 크게, 나머지는 두 줄 카드 — 주간 행사 기본',     color: 'linear-gradient(135deg, #FFE14D, #F5C800)', scene: '주간 행사 기본', itemRange: '6~30개', needsPhoto: false, filter: 'weekly' },
  fresh_daily:  { value: 'fresh_daily',  label: '신선 코너',        desc: '초록 머리 · 대표 하나 + 두 줄 카드 — 청과·채소 위주',           color: 'linear-gradient(135deg, #1F7A3A, #2F9A4F)', scene: '신선 상품', itemRange: '5~20개', needsPhoto: false, filter: 'fresh' },
  market_board: { value: 'market_board', label: '시장 가격판',      desc: '줄마다 상품 · 가격 — 사진 없이도 읽기 쉬운 가격표',            color: 'linear-gradient(135deg, #F3EAD3, #E2D3AE)', scene: '가격판', itemRange: '8~40개', needsPhoto: false, filter: 'weekly' },
  deal_feed:    { value: 'deal_feed',    label: '오늘 특가',        desc: '빨간 머리 · 대표 하나 + 가격 줄표 — 오늘만·급처분',            color: 'linear-gradient(135deg, #C8161A, #E43A3D)', scene: '오늘 특가', itemRange: '3~15개', needsPhoto: false, filter: 'deal' },
  deal_bento:   { value: 'deal_bento',   label: '아침 식탁',        desc: '하늘색 머리 · 두 줄 카드 — 우유·계란·빵 같은 생활 식품',        color: 'linear-gradient(135deg, #CFE6FB, #A9D2F7)', scene: '생활 식품', itemRange: '4~16개', needsPhoto: false, filter: 'weekly' },
  grid_muji:    { value: 'grid_muji',    label: '프리미엄 상품',    desc: '흰 머리 + 금색 선 · 대표 하나 + 두 줄 카드 — 한우·고급 상품',    color: 'linear-gradient(135deg, #FFFFFF, #D9B76A)', scene: '고급 상품', itemRange: '4~16개', needsPhoto: false, filter: 'premium' },
  poster_promo: { value: 'poster_promo', label: '대형 행사',        desc: '빨간 머리 · 대표 둘 + 두 줄 카드 — 큰 행사 주간',              color: 'linear-gradient(135deg, #C8161A, #FFE14D)', scene: '대형 행사', itemRange: '8~30개', needsPhoto: false, filter: 'deal' },
  poster_pop:   { value: 'poster_pop',   label: '여름 시원 특가',   desc: '청록 머리 · 두 줄 카드 — 여름 과일·음료',                       color: 'linear-gradient(135deg, #BDEBE6, #7FD6CB)', scene: '여름 시즌', itemRange: '6~20개', needsPhoto: false, filter: 'deal' },
  magazine:     { value: 'magazine',     label: '정육 특선',        desc: '갈색 머리 · 대표 하나 + 가격 줄표 — 정육 코너 행사',             color: 'linear-gradient(135deg, #5A3A22, #8A5A36)', scene: '정육', itemRange: '5~20개', needsPhoto: false, filter: 'premium' },
  catalog_dark: { value: 'catalog_dark', label: '음료·주류',        desc: '남색 머리 · 가격 줄표 — 음료·주류·간식 묶음',                   color: 'linear-gradient(135deg, #17335E, #2B5290)', scene: '음료·주류', itemRange: '6~30개', needsPhoto: false, filter: 'weekly' },
  price_board:  { value: 'price_board',  label: '빼곡 가격표',      desc: '사진 없이 두 칸 가격표 — 30개 넘는 주간 행사를 한 장에',        color: 'linear-gradient(135deg, #FFE14D, #FFFFFF)', scene: '대량 품목', itemRange: '20개 이상', needsPhoto: false, filter: 'weekly' },
  single_hero:  { value: 'single_hero',  label: '오늘 딱 하나',     desc: '한 상품을 화면 가득 · 나머지는 줄표 — 하나를 세게 밀 때',        color: 'linear-gradient(135deg, #C8161A, #FFE14D)', scene: '단일 상품', itemRange: '1~5개', needsPhoto: false, filter: 'deal' },
  gift_set:     { value: 'gift_set',     label: '명절 선물세트',    desc: '가격대별 묶음(3만·5만·10만) — 설·추석 선물 진열',               color: 'linear-gradient(135deg, #7E1A1A, #E2B34A)', scene: '명절 선물', itemRange: '6~20개', needsPhoto: false, filter: 'holiday' },
  fd_produce:   { value: 'fd_produce',   label: '제철 과일·채소',   desc: '연두 머리 · 두 줄 카드 — 산지·규격을 함께',                     color: 'linear-gradient(135deg, #CDEBB8, #9ED37F)', scene: '제철 청과', itemRange: '6~24개', needsPhoto: false, filter: 'fresh' },
  fd_seafood:   { value: 'fd_seafood',   label: '수산 입고',        desc: '남색 머리 · 대표 둘 + 두 줄 카드 — 오늘 들어온 생선',            color: 'linear-gradient(135deg, #17335E, #3B6FB6)', scene: '수산', itemRange: '6~18개', needsPhoto: false, filter: 'fresh' },
  mb_seol:      { value: 'mb_seol',      label: '설 장보기',        desc: '빨강·금색 머리 · 대표 하나 + 가격 줄표 — 설 장보기 품목',        color: 'linear-gradient(135deg, #B3121A, #E2B34A)', scene: '설 장보기', itemRange: '8~30개', needsPhoto: false, filter: 'holiday' },
  mb_dense:     { value: 'mb_dense',     label: '생필품 대량',      desc: '회색 머리 · 두 칸 가격표 — 휴지·세제 같은 생필품',              color: 'linear-gradient(135deg, #3F4A57, #6B7785)', scene: '생필품', itemRange: '12~40개', needsPhoto: false, filter: 'weekly' },
  pp_opening:   { value: 'pp_opening',   label: '개점·리뉴얼',      desc: '분홍 머리 · 대표 둘 + 두 줄 카드 — 개점 첫 주 행사',             color: 'linear-gradient(135deg, #C42E66, #FFE14D)', scene: '개점', itemRange: '6~20개', needsPhoto: false, filter: 'deal' },
  pp_chuseok:   { value: 'pp_chuseok',   label: '추석 제수용품',    desc: '갈색·금색 머리 · 가격 줄표 — 추석 장보기·제수용품',              color: 'linear-gradient(135deg, #6B4423, #F2D27A)', scene: '추석 장보기', itemRange: '8~30개', needsPhoto: false, filter: 'holiday' },
  pp_weekend:   { value: 'pp_weekend',   label: '주말 특가',        desc: '주황 머리 · 대표 둘 + 가격 줄표 — 금토일 한정',                 color: 'linear-gradient(135deg, #C8500E, #FFB070)', scene: '주말 한정', itemRange: '6~16개', needsPhoto: false, filter: 'deal' },
};

// ============================================================
// ★ D154 PHASE 0 — Deprecated templateCode 폴백 매핑
// ============================================================
// 기존 발행 전단(flyer_flyers.template = 'grid'|'magazine'|...)의 deprecated 22 templateCode를
// 신규 6 엔진 중 가장 적합한 것으로 매핑. CT-F14 renderTemplate(templateCode, data) 진입점에서
// RENDERER_MAP 미존재 시 DEPRECATED_FALLBACK_MAP 조회 → 매핑된 신규 엔진 + 시즌 토큰 자동 주입.
//
// DB 마이그레이션 0건 — 코드 분기로만 안전 렌더 보장. (옛 발행 전단 흔들림 0)
// ============================================================
export const DEPRECATED_FALLBACK_MAP: Record<string, string> = {
  // ★ 2026-08-20 16번 설계 §3 — 베스트 10 통합으로 폐기된 2코드
  magazine_zine:    'magazine',
  story:            'grid_hero', // ★ 1026: 옛 STORY 엔진 폐기 — 옛 발행 전단은 기본형으로
  catalog_swipe:    'catalog_dark',
  // 기본 5 → 신규
  grid:             'grid_hero',
  magazine:         'magazine',
  editorial:        'poster_promo',
  showcase:         'poster_promo',
  highlight:        'poster_promo',

  // 시즌 5 → 신규 (시즌 토큰은 season-resolver가 별도 처리)
  season_newyear:   'poster_promo',
  season_chuseok:   'poster_promo',
  season_christmas: 'deal_feed',
  season_summer:    'grid_hero',
  season_winter:    'magazine',

  // 행사 4 → 신규
  event_bogo:       'poster_promo',
  event_timesale:   'deal_feed',
  event_membership: 'magazine',
  event_grand_open: 'poster_promo',

  // 마트 4 → 신규
  mart_fresh:       'fresh_daily',   // 0820 정정 — swipe 폐기로 이중 홉 차단
  mart_clearance:   'deal_feed',
  mart_general:     'grid_hero',
  mart_seafood:     'fresh_daily',   // 0820 정정 — swipe 폐기로 이중 홉 차단

  // 정육 3 → 신규 (PHASE 1에서 정육 prefix 분리 별도 작업 예정)
  butcher_premium:  'magazine',
  butcher_hanwoo:   'poster_promo',
  butcher_giftset:  'magazine',
};

// ============================================================
// 캐시 (5분 TTL)
// ============================================================

let _cache: BusinessType[] | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateBusinessTypeCache(): void {
  _cache = null;
  _cacheTime = 0;
}

// ============================================================
// 업종 조회 함수
// ============================================================

/**
 * 전체 활성 업종 목록 (캐시 5분).
 */
export async function getBusinessTypes(): Promise<BusinessType[]> {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) return _cache;

  const result = await query(
    `SELECT type_code, type_name, category_presets, default_template, is_active, sort_order
     FROM flyer_business_types
     WHERE is_active = true
     ORDER BY sort_order ASC, type_code ASC`
  );

  const types: BusinessType[] = result.rows.map((r: any) => ({
    type_code: r.type_code,
    type_name: r.type_name,
    category_presets: typeof r.category_presets === 'string'
      ? JSON.parse(r.category_presets)
      : (r.category_presets || []),
    default_template: r.default_template || 'grid_hero',
    is_active: r.is_active,
    sort_order: r.sort_order || 0,
  }));

  _cache = types;
  _cacheTime = now;
  return types;
}

/**
 * 단건 조회. 캐시에서 검색.
 */
export async function getBusinessType(typeCode: string): Promise<BusinessType | null> {
  const types = await getBusinessTypes();
  return types.find(t => t.type_code === typeCode) || null;
}

/**
 * 업종별 카테고리 프리셋. 미존재 시 빈 배열.
 */
export async function getCategoryPresets(typeCode: string): Promise<string[]> {
  const bt = await getBusinessType(typeCode);
  return bt?.category_presets || [];
}

/**
 * 업종별 사용 가능 템플릿 (메타데이터 포함).
 *
 * D154 PHASE 0: 모바일 6 엔진을 모든 업종(마트·정육·식자재·과일·수산) 공통 노출.
 * 업종 prefix 분리(mart_ / butcher_ / 등)는 PHASE 1에서 점진 확장 예정.
 * typeCode 인자는 시그니처 호환 유지용 (라우트 호출처 변경 0).
 */
export async function getAvailableTemplates(typeCode: string): Promise<TemplateInfo[]> {
  void typeCode; // PHASE 1 업종별 확장 시 사용
  // ★ 1025: 손 등재 목록(폐기 코드 4개가 섞여 8종만 돌려주던 상태) → 레지스트리 전체가 단일 기준
  return Object.values(TEMPLATE_REGISTRY);
}

/**
 * 전체 업종 목록 (관리용 — is_active 무관).
 */
export async function getAllBusinessTypes(): Promise<BusinessType[]> {
  const result = await query(
    `SELECT type_code, type_name, category_presets, default_template, is_active, sort_order
     FROM flyer_business_types
     ORDER BY sort_order ASC, type_code ASC`
  );

  return result.rows.map((r: any) => ({
    type_code: r.type_code,
    type_name: r.type_name,
    category_presets: typeof r.category_presets === 'string'
      ? JSON.parse(r.category_presets)
      : (r.category_presets || []),
    default_template: r.default_template || 'grid_hero',
    is_active: r.is_active,
    sort_order: r.sort_order || 0,
  }));
}
