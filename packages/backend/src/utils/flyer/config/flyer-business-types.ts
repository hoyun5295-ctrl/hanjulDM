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
}

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
  magazine:      { value: 'magazine',      label: '매거진 스크롤', desc: '패럴랙스 + 챕터 헤드 무드보드',                       color: 'linear-gradient(135deg, #292524, #C2410C)' },
  magazine_zine: { value: 'magazine_zine', label: '매거진 ZINE',   desc: 'Riso 인쇄 + halftone + 미스레지스트레이션 인쇄 미감', color: 'linear-gradient(135deg, #FF3D2E, #2056FF)' },
  deal_feed:     { value: 'deal_feed',     label: '오늘의 핫딜',   desc: '카운트다운 + 잔여수량 + 좋아요·공유',                  color: 'linear-gradient(135deg, #171717, #EF4444)' },
  deal_bento:    { value: 'deal_bento',    label: '핫딜 벤또',     desc: '파스텔 8 컬러 벤또 그리드 + 카운트다운 + 마감 임박',   color: 'linear-gradient(135deg, #FFC9A0, #FFE9C6)' },
  grid_hero:     { value: 'grid_hero',     label: '위클리 메인',   desc: 'Hero + 카테고리 sticky + 그리드 + 단가',               color: 'linear-gradient(135deg, #7C3AED, #EC4899)' },
  grid_muji:     { value: 'grid_muji',     label: '미니멀 카탈로그', desc: 'MUJI 미니멀 + 카테고리 section + pgrid 2col',         color: 'linear-gradient(135deg, #FAFAFA, #C8261A)' },
  catalog_swipe: { value: 'catalog_swipe', label: '카탈로그 가로', desc: '카테고리별 가로 스와이프 + hold 확대',                 color: 'linear-gradient(135deg, #1D4ED8, #3B82F6)' },
  catalog_dark:  { value: 'catalog_dark',  label: '다크 NOW PLAYING', desc: 'Netflix 다크 모드 + 음악 스트리밍 풍 swipe row',    color: 'linear-gradient(135deg, #0A0A0B, #F97316)' },
  poster_promo:  { value: 'poster_promo',  label: '포스터 임팩트', desc: '인쇄 전단풍 + 6매체 정합 본진',                        color: 'linear-gradient(135deg, #1C1917, #FBBF24)' },
  poster_pop:    { value: 'poster_pop',    label: '팝 아트 포스터', desc: '한국 팝 아트 + Memphis decorations + 큰 pop sticker',  color: 'linear-gradient(135deg, #FF3D2E, #FFD300)' },
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
  mart_fresh:       'catalog_swipe',
  mart_clearance:   'deal_feed',
  mart_general:     'grid_hero',
  mart_seafood:     'catalog_swipe',

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
  // ★ D155: STORY 제거 + 5 신규 추가 = 10 활성 엔진
  const commonCodes = [
    'magazine', 'magazine_zine',
    'deal_feed', 'deal_bento',
    'grid_hero', 'grid_muji',
    'catalog_swipe', 'catalog_dark',
    'poster_promo', 'poster_pop',
  ];

  return commonCodes
    .map(code => TEMPLATE_REGISTRY[code])
    .filter((t): t is TemplateInfo => !!t);
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
