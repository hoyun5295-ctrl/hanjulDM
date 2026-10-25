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
  /** ★ 1025 17번 §3-5 갤러리 — 장면 한 줄 · 상품 수 범위 · 사진 필요 · 행사 성격 걸러보기 · 판이면 기반 디자인 */
  scene?: string;
  itemRange?: string;
  needsPhoto?: boolean;
  filter?: TemplateFilter;
  baseOf?: string;
}

export type TemplateFilter = 'weekly' | 'deal' | 'fresh' | 'holiday' | 'premium';

/** ★ 1025 17번 §3-2 — 판 = 기존 엔진 + 구조 차이(DOM). 템플릿 코드로 저장돼 다시 열어도 같은 판이다. */
export interface PanLayout {
  /** 대표(크게) 상품 수 */
  hero: 0 | 1 | 2;
  /** 목록 열 수 */
  cols: 1 | 2 | 3;
  /** dense = 상품 수와 무관하게 빼곡 밴드 */
  band: 'auto' | 'dense';
}
export interface PanSpec {
  engine: string;
  layout: PanLayout;
  season?: 'grand_open' | 'urgent' | 'newyear' | 'chuseok' | 'christmas' | 'summer' | 'winter';
  /** 갤러리 미리보기 목업 세트(template-mocks.ts) */
  mockSet: string;
}
export const PAN_TABLE: Record<string, PanSpec> = {
  fd_produce: { engine: 'fresh_daily',  layout: { hero: 0, cols: 3, band: 'auto' },  season: 'summer',     mockSet: 'produce' },
  fd_seafood: { engine: 'fresh_daily',  layout: { hero: 2, cols: 3, band: 'auto' },                       mockSet: 'seafood' },
  mb_seol:    { engine: 'market_board', layout: { hero: 1, cols: 2, band: 'auto' },  season: 'newyear',    mockSet: 'meat' },
  mb_dense:   { engine: 'market_board', layout: { hero: 0, cols: 2, band: 'dense' },                      mockSet: 'grocery' },
  pp_opening: { engine: 'poster_pop',   layout: { hero: 2, cols: 3, band: 'auto' },  season: 'grand_open', mockSet: 'mixed' },
  pp_chuseok: { engine: 'poster_pop',   layout: { hero: 0, cols: 3, band: 'auto' },  season: 'chuseok',    mockSet: 'gift' },
  pp_weekend: { engine: 'poster_pop',   layout: { hero: 2, cols: 2, band: 'dense' }, season: 'urgent',     mockSet: 'mixed' },
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
  // ★ 2026-08-20 베스트 10 (16번 설계 §3) — 각 템플릿이 장사 장면 하나씩을 소유한다.
  grid_hero:     { value: 'grid_hero',     label: '위클리 메인',     desc: '커머스 그리드 · 주간 행사 기본값 — 어떤 매장이든 안전한 첫 선택',   color: 'linear-gradient(135deg, #7C3AED, #EC4899)', scene: '주간 행사 기본', itemRange: '6~30개', needsPhoto: false, filter: 'weekly' },
  fresh_daily:   { value: 'fresh_daily',   label: '신선 데일리',     desc: '딥그린 + 큰 사진 + 원산지 먼저 — 청과·수산·축산 신선 소구',        color: 'linear-gradient(135deg, #15803D, #65A30D)', scene: '신선 코너', itemRange: '5~20개', needsPhoto: true, filter: 'fresh' },
  market_board:  { value: 'market_board',  label: '시장 대자보',     desc: '갱지 + 붉은 인장 + 점선 리더 — 사진 없이도 서는 유일한 판',         color: 'linear-gradient(135deg, #FBF6EA, #C0392B)', scene: '시장 가격판', itemRange: '8~40개', needsPhoto: false, filter: 'weekly' },
  deal_feed:     { value: 'deal_feed',     label: '오늘의 핫딜',     desc: '카운트다운 + 마감 임박 — 타임세일·급처분의 긴박',                   color: 'linear-gradient(135deg, #0A0A0B, #FF2E2E)', scene: '타임세일', itemRange: '3~15개', needsPhoto: false, filter: 'deal' },
  deal_bento:    { value: 'deal_bento',    label: '벤또 마켓',       desc: '파스텔 벤또 블록 — 소량 상품·감성 소구에 최강',                     color: 'linear-gradient(135deg, #FFC9A0, #FFE9C6)', scene: '소량 감성', itemRange: '4~12개', needsPhoto: false, filter: 'deal' },
  grid_muji:     { value: 'grid_muji',     label: '프리미엄 셀렉트', desc: '여백 + 세리프 — 선물세트·고단가 상품의 정갈한 얼굴',               color: 'linear-gradient(135deg, #FAFAFA, #292524)', scene: '고단가·선물', itemRange: '4~16개', needsPhoto: true, filter: 'premium' },
  poster_promo:  { value: 'poster_promo',  label: '포스터 임팩트',   desc: '인쇄 전단 룩 그대로 — POP·인쇄까지 6매체 정합 본진',               color: 'linear-gradient(135deg, #1C1917, #FBBF24)', scene: '인쇄 전단 룩', itemRange: '6~24개', needsPhoto: false, filter: 'weekly' },
  poster_pop:    { value: 'poster_pop',    label: '팝 아트',         desc: '멤피스 스티커 + 형광 — 개점·이벤트·젊은 상권',                     color: 'linear-gradient(135deg, #FF3D2E, #FFD300)', scene: '개점·이벤트', itemRange: '5~18개', needsPhoto: false, filter: 'deal' },
  magazine:      { value: 'magazine',      label: '매거진 스토리',   desc: '세리프 표지 + 챕터 — 사진 좋은 매장의 브랜드 전단',                 color: 'linear-gradient(135deg, #211D19, #B4552D)', scene: '브랜드 전단', itemRange: '6~20개', needsPhoto: true, filter: 'premium' },
  catalog_dark:  { value: 'catalog_dark',  label: '다크 쇼케이스',   desc: '블랙 무대 + 조명 앰버 — 심야·주류·프리미엄 정육',                   color: 'linear-gradient(135deg, #050505, #FFB020)', scene: '주류·정육 프리미엄', itemRange: '4~16개', needsPhoto: false, filter: 'premium' },
  // ★ 1025 17번 §3-1 새 엔진 3 — 현 10종이 못 덮는 상품 수 축
  price_board:   { value: 'price_board',   label: '빼곡 가격표',     desc: '사진 없이 품목·규격·가격 줄표 — 30개 넘는 주간 행사를 한 장에',    color: 'linear-gradient(135deg, #F5F5F4, #DC2626)', scene: '대량 품목 가격표', itemRange: '30개 이상', needsPhoto: false, filter: 'weekly' },
  single_hero:   { value: 'single_hero',   label: '단일 상품 폭탄',  desc: '한 상품을 화면 가득 — 오늘 딱 하나 밀 때',                         color: 'linear-gradient(135deg, #DC2626, #F59E0B)', scene: '단일 상품 집중', itemRange: '1~3개', needsPhoto: false, filter: 'deal' },
  gift_set:      { value: 'gift_set',      label: '명절 선물세트',   desc: '세트 카드 + 가격대 묶음(3만·5만·10만) — 설·추석 선물 진열',        color: 'linear-gradient(135deg, #7F1D1D, #CA8A04)', scene: '명절 선물', itemRange: '6~20개', needsPhoto: false, filter: 'holiday' },
  // ★ 1025 17번 §3-2 판 7 — 기존 디자인 + 구조 차이(PAN_TABLE) · 이름 뒤 「판」 정직 표기
  fd_produce:    { value: 'fd_produce',    label: '청과 산지판',     desc: '대표 없이 3열 — 과일·채소를 산지·규격과 함께 촘촘히',              color: 'linear-gradient(135deg, #166534, #FACC15)', scene: '청과 진열', itemRange: '9~24개', needsPhoto: false, filter: 'fresh', baseOf: '신선 데일리' },
  fd_seafood:    { value: 'fd_seafood',    label: '수산 새벽판',     desc: '대표 둘 + 3열 — 오늘 들어온 생선 둘을 크게',                       color: 'linear-gradient(135deg, #0C4A6E, #22D3EE)', scene: '수산 입고', itemRange: '6~18개', needsPhoto: false, filter: 'fresh', baseOf: '신선 데일리' },
  mb_seol:       { value: 'mb_seol',       label: '설 장터판',       desc: '대표 하나 + 2열 가격판 — 설 장보기 품목을 장터처럼',               color: 'linear-gradient(135deg, #FBF6EA, #B91C1C)', scene: '설 장보기', itemRange: '8~30개', needsPhoto: false, filter: 'holiday', baseOf: '시장 대자보' },
  mb_dense:      { value: 'mb_dense',      label: '빼곡 장터판',     desc: '2열 빼곡 가격판 — 공산품·생필품 대량 행사',                        color: 'linear-gradient(135deg, #FBF6EA, #1F2937)', scene: '생필품 대량', itemRange: '12~40개', needsPhoto: false, filter: 'weekly', baseOf: '시장 대자보' },
  pp_opening:    { value: 'pp_opening',    label: '개점 축하판',     desc: '대표 둘 + 3칸 묶음 — 개점·리뉴얼 첫 주의 들뜬 얼굴',               color: 'linear-gradient(135deg, #DB2777, #FFD300)', scene: '개점·리뉴얼', itemRange: '6~18개', needsPhoto: false, filter: 'deal', baseOf: '팝 아트' },
  pp_chuseok:    { value: 'pp_chuseok',    label: '추석 대목판',     desc: '3칸 묶음 진열 — 추석 선물·제수용품 대목',                         color: 'linear-gradient(135deg, #92400E, #FCD34D)', scene: '추석 대목', itemRange: '6~18개', needsPhoto: false, filter: 'holiday', baseOf: '팝 아트' },
  pp_weekend:    { value: 'pp_weekend',    label: '주말 타임세일판', desc: '대표 둘 + 빼곡 밴드 — 금토일 한정 특가',                          color: 'linear-gradient(135deg, #111827, #EF4444)', scene: '주말 한정', itemRange: '6~16개', needsPhoto: false, filter: 'deal', baseOf: '팝 아트' },
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
