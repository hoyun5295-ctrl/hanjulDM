/**
 * ★ CT-F (신규) — 6 엔진 자동 선정 알고리즘 (D154 PHASE 0 트랙 B)
 *
 * master plan §1-2: 사장님이 6 중 1을 직접 선택하지 않아도 입력 데이터(업종·시즌·상품·가격대·이벤트)
 * 기반으로 자동 최적 엔진 추천. 사장님은 결과 확인 후 수동 변경 가능.
 *
 * PHASE 0 (현재) — 휴리스틱 규칙 기반 점수 매트릭스:
 *   - 상품 수 / 카테고리 수 / badge 패턴 / 키워드 / 시즌 토큰 → 각 엔진 가중치
 *   - 최고 점수 엔진 반환 + 동점 시 시드 기반 tiebreak
 *
 * PHASE 1 (예정) — Claude Opus 4.7 호출:
 *   - 입력 → 엔진 추천 + 추천 이유 (사장님 화면 표시)
 *   - flyer_flyers.recommended_engine JSON 캐싱
 *
 * 호출 위치:
 *   - flyers.ts INSERT 시 미지정이면 recommendTemplate() 자동 호출
 *   - FlyerPage.tsx 사장님 화면 "AI 추천" 버튼 클릭 시 API 호출
 */

import type { FlyerRenderData } from './flyer-templates';
import { resolveSeasonToken } from './season-resolver';

// ============================================================
// 타입
// ============================================================

export type EngineCode = 'story' | 'magazine' | 'deal_feed' | 'grid_hero' | 'catalog_swipe' | 'poster_promo';

export interface TemplateRecommendation {
  templateCode: EngineCode;
  score: number;
  /** 추천 이유 (사장님 화면 표시·디버깅용) */
  reasons: string[];
  /** 모든 엔진의 점수 (디버깅·튜닝용) */
  allScores: Record<EngineCode, number>;
}

// ============================================================
// 점수 매트릭스 (휴리스틱)
// ============================================================

const ENGINES: EngineCode[] = ['story', 'magazine', 'deal_feed', 'grid_hero', 'catalog_swipe', 'poster_promo'];

interface ScoreContext {
  itemCount: number;
  categoryCount: number;
  hasUrgent: boolean;        // 타임세일/한정/오늘만 badge
  hasBogo: boolean;          // 1+1 / 2+1 badge
  hasPremium: boolean;       // 한우/프리미엄/1++ 키워드
  hasNewYear: boolean;
  hasChuseok: boolean;
  hasGrandOpen: boolean;
  hasChristmas: boolean;
  avgPrice: number;
  maxDiscount: number;       // 0~100
  maxItemsPerCategory: number;
}

function buildContext(data: FlyerRenderData): ScoreContext {
  const items = data.categories.flatMap(c => c.items);
  const allText = (data.title || '').toLowerCase() + ' ' + items.map(i => (i.name + ' ' + (i.badge || '')).toLowerCase()).join(' ');
  let totalPrice = 0;
  let maxDisc = 0;
  for (const it of items) {
    totalPrice += (it.salePrice || 0);
    if (it.originalPrice > 0) {
      const d = Math.round((1 - it.salePrice / it.originalPrice) * 100);
      if (d > maxDisc) maxDisc = d;
    }
  }
  const maxItemsPerCategory = data.categories.reduce((m, c) => Math.max(m, c.items.length), 0);

  return {
    itemCount: items.length,
    categoryCount: data.categories.length,
    hasUrgent: /타임\s*세일|창고\s*대?\s*방출|마감\s*임박|오늘만|한정/.test(allText),
    hasBogo: /1\s*\+\s*1|2\s*\+\s*1/.test(allText),
    hasPremium: /한우|프리미엄|1\+\+|특상|선물세트/.test(allText),
    hasNewYear: /설날|구정|설\s*특선/.test(allText),
    hasChuseok: /추석|한가위/.test(allText),
    hasGrandOpen: /개점|오픈|재오픈|리뉴얼|1주년|신장개업/.test(allText),
    hasChristmas: /크리스마스|성탄|연말|송년/.test(allText),
    avgPrice: items.length > 0 ? totalPrice / items.length : 0,
    maxDiscount: maxDisc,
    maxItemsPerCategory,
  };
}

/** 각 엔진의 점수 계산 (휴리스틱 규칙 매트릭스) */
function scoreEngines(ctx: ScoreContext): { scores: Record<EngineCode, number>; reasons: Record<EngineCode, string[]> } {
  const scores: Record<EngineCode, number> = {
    story: 0, magazine: 0, deal_feed: 0, grid_hero: 0, catalog_swipe: 0, poster_promo: 0,
  };
  const reasons: Record<EngineCode, string[]> = {
    story: [], magazine: [], deal_feed: [], grid_hero: [], catalog_swipe: [], poster_promo: [],
  };

  // === 기본 점수 (디폴트 grid_hero 우대) ===
  scores.grid_hero += 30;
  reasons.grid_hero.push('기본 위클리 메인');

  // === 상품 수 분기 ===
  if (ctx.itemCount <= 3) {
    scores.story += 40;
    scores.poster_promo += 25;
    reasons.story.push('상품 ' + ctx.itemCount + '개 — 풀스크린 집중');
    reasons.poster_promo.push('소수 상품 — 임팩트 포스터');
  } else if (ctx.itemCount <= 6) {
    scores.grid_hero += 25;
    scores.poster_promo += 20;
    scores.story += 15;
    reasons.grid_hero.push('상품 ' + ctx.itemCount + '개 — 그리드 적정');
  } else if (ctx.itemCount <= 12) {
    scores.grid_hero += 20;
    scores.deal_feed += 25;
    scores.catalog_swipe += 20;
    reasons.deal_feed.push('상품 ' + ctx.itemCount + '개 — 피드형');
  } else {
    scores.catalog_swipe += 40;
    scores.deal_feed += 30;
    reasons.catalog_swipe.push('상품 ' + ctx.itemCount + '개 — 가로 카탈로그');
  }

  // === 카테고리 수 분기 ===
  if (ctx.categoryCount >= 4) {
    scores.catalog_swipe += 30;
    scores.grid_hero += 15;
    reasons.catalog_swipe.push('카테고리 ' + ctx.categoryCount + '개 — 가로 행 분리');
  } else if (ctx.categoryCount === 1) {
    scores.magazine += 25;
    scores.story += 15;
    reasons.magazine.push('단일 카테고리 — 스토리텔링');
  }

  // === 카테고리당 상품 밀도 ===
  if (ctx.maxItemsPerCategory >= 5) {
    scores.magazine += 20;
    scores.catalog_swipe += 15;
    reasons.magazine.push('카테고리당 ' + ctx.maxItemsPerCategory + '개 — 깊이 있음');
  }

  // === badge 패턴 ===
  if (ctx.hasUrgent) {
    scores.deal_feed += 40;
    scores.poster_promo += 20;
    reasons.deal_feed.push('타임세일/한정 — 카운트다운 핫딜');
  }
  if (ctx.hasBogo) {
    scores.poster_promo += 20;
    scores.deal_feed += 15;
    reasons.poster_promo.push('1+1 — 임팩트 슬랩');
  }
  if (ctx.hasPremium) {
    scores.magazine += 25;
    scores.poster_promo += 10;
    reasons.magazine.push('프리미엄 — 매거진 스토리');
  }

  // === 시즌·이벤트 키워드 ===
  if (ctx.hasGrandOpen) {
    scores.poster_promo += 40;
    reasons.poster_promo.push('그랜드 오픈 — 인쇄 전단 임팩트');
  }
  if (ctx.hasNewYear || ctx.hasChuseok) {
    scores.poster_promo += 30;
    scores.magazine += 15;
    reasons.poster_promo.push('명절 — 풀블리드 포스터');
  }
  if (ctx.hasChristmas) {
    scores.deal_feed += 20;
    scores.poster_promo += 15;
    reasons.deal_feed.push('크리스마스 — 긴급 핫딜');
  }

  // === 할인율 강도 ===
  if (ctx.maxDiscount >= 50) {
    scores.deal_feed += 20;
    scores.poster_promo += 15;
    reasons.deal_feed.push('최대 ' + ctx.maxDiscount + '% — 강한 할인 강조');
  }

  // === 평균 가격 ===
  if (ctx.avgPrice >= 30000) {
    scores.magazine += 15;
    reasons.magazine.push('고가 상품 — 프리미엄 매거진');
  }

  return { scores, reasons };
}

// ============================================================
// 진입점
// ============================================================

/**
 * ★ 단일 진입점. 입력 데이터 → 최적 6 엔진 추천.
 *
 * @param data 사장님 입력 + 매장 정보 (storeName/title/periodStart/categories)
 * @param opts.fixedTemplateCode 강제 지정 (사장님 수동 선택 우선)
 * @param opts.tieBreakSeed 동점 시 tiebreak 시드 (재현용)
 *
 * @returns TemplateRecommendation — templateCode + score + reasons + allScores
 */
export function recommendTemplate(
  data: FlyerRenderData,
  opts?: { fixedTemplateCode?: EngineCode; tieBreakSeed?: number }
): TemplateRecommendation {
  // 사장님 수동 선택 우선 (휴리스틱 폴백)
  if (opts?.fixedTemplateCode) {
    return {
      templateCode: opts.fixedTemplateCode,
      score: 100,
      reasons: ['사장님 수동 선택'],
      allScores: { story: 0, magazine: 0, deal_feed: 0, grid_hero: 0, catalog_swipe: 0, poster_promo: 0 },
    };
  }

  const ctx = buildContext(data);
  const { scores, reasons } = scoreEngines(ctx);

  // 최고 점수 선정 (동점 시 시드 기반 tiebreak)
  let best: EngineCode = 'grid_hero';
  let bestScore = -Infinity;
  const ties: EngineCode[] = [];
  for (const eng of ENGINES) {
    if (scores[eng] > bestScore) {
      bestScore = scores[eng];
      best = eng;
      ties.length = 0;
      ties.push(eng);
    } else if (scores[eng] === bestScore) {
      ties.push(eng);
    }
  }
  if (ties.length > 1 && opts?.tieBreakSeed !== undefined) {
    best = ties[opts.tieBreakSeed % ties.length];
  }

  return {
    templateCode: best,
    score: bestScore,
    reasons: reasons[best],
    allScores: scores,
  };
}

/**
 * 추천 결과 + 시즌 토큰 통합 조회 (단일 호출 편의).
 */
export function recommendTemplateAndSeason(data: FlyerRenderData) {
  const rec = recommendTemplate(data);
  const seasonToken = resolveSeasonToken(data.title, data.periodStart);
  return { ...rec, seasonToken };
}
