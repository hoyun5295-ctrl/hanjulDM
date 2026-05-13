/**
 * ★ CT-F (신규) — 6매체 통합 디자인 토큰 SSOT (D154 PHASE 0 §1-3)
 *
 * master plan §1-3: "같은 디자인 토큰(color hex, spacing scale, typography, brand voice)을
 *   6개 매체에 동일 적용. 사장님이 인쇄해서 매장 벽에 붙여도 디지털과 일관된 디자이너급."
 *
 * 6매체:
 *   1. URL 페이지        (hanjul-flyer.kr/{code}) — 모바일 풀스크린
 *   2. 인쇄 A3 PDF       (paged-pdf.ts)         — 297x420mm
 *   3. POP 3종           (flyer-pop-templates)  — A4 210x297mm price/multi/promo
 *   4. MMS 이미지        (신규 mms-image.ts)     — 1080x1920 세로
 *   5. 카카오 알림톡 첨부 (신규 alimtalk-image.ts) — 1000x1000 정사각
 *   6. 브랜드메시지 랜딩  (URL 그대로 활용)
 *
 * 시즌 토큰 8종 (season-tokens.json) + 매체별 사이즈 매트릭스 = 단일 SSOT.
 *
 * 호출 위치:
 *   - 6 엔진 (renderXxxEngine) — generateMediaCssBlock('url', token)
 *   - paged-pdf — generateMediaCssBlock('print_a3', token)
 *   - POP — generateMediaCssBlock('pop', token)
 *   - MMS/알림톡 — 신규 모듈에서 호출
 */

import { SEASON_TOKENS, type SeasonToken } from './season-resolver';

// ============================================================
// 매체 정의
// ============================================================

export type MediaTarget = 'url' | 'print_a3' | 'pop' | 'mms' | 'alimtalk' | 'brand_landing';

export interface MediaSpec {
  /** 매체 폭 (px 또는 mm — print는 mm) */
  width: number;
  /** 매체 높이 */
  height: number;
  /** 단위 ('px' | 'mm') */
  unit: 'px' | 'mm';
  /** 폰트 스케일 (1.0 기준) */
  typeScale: number;
  /** 여백 스케일 (1.0 기준) */
  spacingScale: number;
  /** 그림자 강도 ('none' | 'subtle' | 'standard' | 'strong') */
  shadowIntensity: 'none' | 'subtle' | 'standard' | 'strong';
  /** 라벨 (디버깅·UI 표시용) */
  label: string;
}

export const MEDIA_SPECS: Record<MediaTarget, MediaSpec> = {
  url: {
    width: 393, height: 852, unit: 'px',
    typeScale: 1.0, spacingScale: 1.0, shadowIntensity: 'standard',
    label: 'URL 페이지 (모바일 풀스크린)',
  },
  print_a3: {
    width: 297, height: 420, unit: 'mm',
    typeScale: 2.4, spacingScale: 2.2, shadowIntensity: 'none',
    label: '인쇄 A3 PDF',
  },
  pop: {
    width: 210, height: 297, unit: 'mm',
    typeScale: 1.8, spacingScale: 1.6, shadowIntensity: 'none',
    label: 'POP A4',
  },
  mms: {
    width: 1080, height: 1920, unit: 'px',
    typeScale: 2.6, spacingScale: 2.4, shadowIntensity: 'subtle',
    label: 'MMS 이미지 (세로)',
  },
  alimtalk: {
    width: 1000, height: 1000, unit: 'px',
    typeScale: 2.4, spacingScale: 2.0, shadowIntensity: 'subtle',
    label: '카카오 알림톡 첨부 (정사각)',
  },
  brand_landing: {
    width: 393, height: 852, unit: 'px',
    typeScale: 1.0, spacingScale: 1.0, shadowIntensity: 'standard',
    label: '카카오 브랜드메시지 랜딩 (URL 그대로)',
  },
};

// ============================================================
// 공통 디자인 토큰 (시즌 토큰 + 공통 스케일)
// ============================================================

/** 공통 spacing/radius/motion 토큰 (매체 무관) */
export const COMMON_TOKENS = {
  space: { '1': 4, '2': 8, '3': 16, '4': 24, '5': 40, '6': 64 },
  radius: { sm: 8, md: 16, lg: 24, pill: 999 },
  font: {
    family: "'Pretendard Variable', 'Pretendard', sans-serif",
    weightBody: 400,
    weightBold: 700,
    weightDisplay: 900,
    featuresPrice: "'tnum' 1", // tabular-nums
  },
  motion: {
    fast: '200ms',
    medium: '400ms',
    slow: '800ms',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  textColor: {
    strong: '#171717',
    weak: '#6B7280',
    paper: '#F5F1EB',
    discount: '#DC2626',
  },
};

// ============================================================
// 통합 토큰 세트 (시즌 + 매체 + 공통)
// ============================================================

export interface UnifiedTokenSet {
  media: MediaTarget;
  mediaSpec: MediaSpec;
  season: SeasonToken;
  colorPrimary: string;
  colorAccent: string;
  colorOnPrimary: string;
  textStrong: string;
  textWeak: string;
  paper: string;
  discount: string;
  typeScale: number;
  spacingScale: number;
  shadowIntensity: MediaSpec['shadowIntensity'];
}

/**
 * 매체 + 시즌 토큰 → 통합 토큰 세트.
 * 6매체 모두 같은 컬러 (시즌 토큰) + 매체별 사이즈/그림자만 조정.
 */
export function getUnifiedTokens(media: MediaTarget, season: SeasonToken): UnifiedTokenSet {
  const mediaSpec = MEDIA_SPECS[media];
  const seasonInfo = SEASON_TOKENS[season];

  return {
    media,
    mediaSpec,
    season,
    colorPrimary: seasonInfo.primary,
    colorAccent: seasonInfo.accent,
    colorOnPrimary: seasonInfo.onPrimary,
    textStrong: COMMON_TOKENS.textColor.strong,
    textWeak: COMMON_TOKENS.textColor.weak,
    paper: COMMON_TOKENS.textColor.paper,
    discount: COMMON_TOKENS.textColor.discount,
    typeScale: mediaSpec.typeScale,
    spacingScale: mediaSpec.spacingScale,
    shadowIntensity: mediaSpec.shadowIntensity,
  };
}

// ============================================================
// CSS variable 블록 생성 (HTML <style> 안 :root 주입용)
// ============================================================

const SHADOW_PRESETS: Record<MediaSpec['shadowIntensity'], { card: string; lift: string }> = {
  none:     { card: 'none', lift: 'none' },
  subtle:   { card: '0 1px 2px rgba(0,0,0,0.04)', lift: '0 2px 6px rgba(0,0,0,0.06)' },
  standard: { card: '0 4px 12px rgba(0,0,0,0.06)', lift: '0 8px 24px rgba(0,0,0,0.12)' },
  strong:   { card: '0 6px 18px rgba(0,0,0,0.10)', lift: '0 14px 32px rgba(0,0,0,0.18)' },
};

/**
 * 매체 + 시즌 → CSS :root 블록.
 * 6매체 HTML/PDF 렌더링 시 통합 호출.
 */
export function generateMediaCssBlock(media: MediaTarget, season: SeasonToken): string {
  const t = getUnifiedTokens(media, season);
  const shadow = SHADOW_PRESETS[t.shadowIntensity];
  return `:root{` +
    `--color-primary:${t.colorPrimary};` +
    `--color-accent:${t.colorAccent};` +
    `--color-on-primary:${t.colorOnPrimary};` +
    `--color-text-strong:${t.textStrong};` +
    `--color-text-weak:${t.textWeak};` +
    `--color-paper:${t.paper};` +
    `--color-discount:${t.discount};` +
    `--type-scale:${t.typeScale};` +
    `--spacing-scale:${t.spacingScale};` +
    `--shadow-card:${shadow.card};` +
    `--shadow-lift:${shadow.lift};` +
    `--motion-spring:${COMMON_TOKENS.motion.spring};` +
    `--font-family:${COMMON_TOKENS.font.family};` +
  `}`;
}

/**
 * 8 시즌 토큰 모두 분기 CSS (data-season 속성으로 동적 전환).
 * 6 엔진의 seasonStyleBlock() 함수와 정합.
 */
export function generateAllSeasonsCssBlock(media: MediaTarget): string {
  const lines: string[] = [];
  for (const season of Object.keys(SEASON_TOKENS) as SeasonToken[]) {
    if (season === 'default') continue;
    const t = getUnifiedTokens(media, season);
    lines.push(
      `html[data-season="${season}"]{--color-primary:${t.colorPrimary};--color-accent:${t.colorAccent};--color-on-primary:${t.colorOnPrimary};}`
    );
  }
  return lines.join('');
}

// ============================================================
// 6매체 변환 매트릭스 (디버깅·관리자 UI 표시용)
// ============================================================

export function getMediaMatrix(): Array<{ media: MediaTarget; spec: MediaSpec }> {
  return (Object.keys(MEDIA_SPECS) as MediaTarget[]).map(media => ({
    media,
    spec: MEDIA_SPECS[media],
  }));
}
