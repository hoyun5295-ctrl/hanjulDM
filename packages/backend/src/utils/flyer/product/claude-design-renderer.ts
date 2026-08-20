/**
 * ★ CT-F (신규) — Claude Design 동적 생성 (D154 PHASE 0 트랙 B 본진)
 *
 * master plan §1-2: "매번 다른 디자인 — 업종·시즌·상품·가격대·이벤트 조합별
 *   최적 레이아웃·컬러·타이포 자동 선택"
 *
 * PHASE 0 (현재) — 시드 기반 휴리스틱 변형 (Claude API 호출 0건, 매번 호출 비용 0):
 *   1. computeDesignSeed(data) — 입력 데이터 hash + 발행 시점 → 시드
 *   2. recommendDesign(data, baseToken) — 시드 → 6 변형 중 1개 선택
 *   3. 결과 DesignVariant — palette/typeScale/decorIntensity/variantSeed
 *   4. variantToStyleBlock(variant) — CSS variable 분기 블록
 *
 * PHASE 1 (예정 D158+) — Claude Opus 4.7 callAIWithFallback 호출:
 *   - 입력 → 디자인 추천 (레이아웃·컬러·타이포·카피 통합)
 *   - 응답 캐싱 (발행 시점만 호출, 결과 flyer_flyers.design_variant JSON 컬럼 저장)
 *   - AI 카피 강화 (flyer-ai-copy.ts 통합)
 *
 * 호출 위치 (PHASE 0): renderTemplate(templateCode, data) 진입점에서 옵션 활용 가능.
 *   기본 호출에는 영향 0 — 외부 호출자가 명시 활용 시만 적용.
 */

import type { FlyerRenderData } from './flyer-templates';
import { SEASON_TOKENS, type SeasonToken } from './season-resolver';

// ============================================================
// 타입
// ============================================================

export interface DesignVariant {
  /** 6 엔진 중 1개 (template-recommender.ts에서 별도 선정, 미지정 시 fixedTemplateCode 폴백) */
  templateCode: string;
  /** 시즌 토큰 8종 중 1개 (resolveSeasonToken과 별개로 강제 지정 가능) */
  seasonToken: SeasonToken;
  /** 동적 팔레트 (시즌 토큰 변형: hue/saturation/lightness 조정) */
  palette: {
    primary: string;
    accent: string;
    onPrimary: string;
  };
  /** 폰트 크기 스케일 (0.95 / 1.0 / 1.05 / 1.1) */
  typeScale: number;
  /** 데코 강도 */
  decorIntensity: 'subtle' | 'standard' | 'bold';
  /** 변형 시드 (디버깅·재현용) */
  variantSeed: number;
  /** 변형 라벨 (사장님 화면 표시·디버깅용) */
  variantLabel: string;
}

// ============================================================
// 시드 생성 (입력 hash + 발행 시점)
// ============================================================

/** djb2 hash — 단순 string → number */
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return Math.abs(hash);
}

/**
 * 입력 데이터 + 발행 시점(hour) → 시드.
 * 발행 시점이 바뀌면 시드가 바뀜 → 매번 다른 결과물 보장.
 * 캐싱 위해 hour 단위 (1시간 안에 같은 입력 → 같은 결과).
 */
export function computeDesignSeed(data: FlyerRenderData): number {
  const hourTs = Math.floor(Date.now() / (60 * 60 * 1000));
  const itemNames = data.categories
    .flatMap(c => c.items.map(i => i.name))
    .slice(0, 5)
    .join(',');
  const key = [
    data.storeName || '',
    data.title || '',
    data.periodStart || '',
    itemNames,
    hourTs,
  ].join('|');
  return hashString(key);
}

// ============================================================
// HSL ↔ HEX 변환 (팔레트 변형용)
// ============================================================

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1].slice(0, 2), 16),
    g: parseInt(m[1].slice(2, 4), 16),
    b: parseInt(m[1].slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

/** HEX hue/saturation/lightness 조정 → 신규 HEX */
function shiftHsl(hex: string, dH: number, dS: number, dL: number): string {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const h = (hsl.h + dH + 1) % 1;
  const s = Math.max(0, Math.min(1, hsl.s + dS));
  const l = Math.max(0, Math.min(1, hsl.l + dL));
  const out = hslToRgb(h, s, l);
  return rgbToHex(out.r, out.g, out.b);
}

// ============================================================
// 6 변형 매트릭스 (시드 % 6 → variant)
// ============================================================

interface VariantSpec {
  label: string;
  hShift: number;   // hue shift (-0.05~+0.05)
  sShift: number;   // saturation shift (-0.10~+0.15)
  lShift: number;   // lightness shift (-0.10~+0.10)
  typeScale: number;
  decorIntensity: 'subtle' | 'standard' | 'bold';
}

const VARIANTS: VariantSpec[] = [
  { label: '기본',     hShift:  0.000, sShift:  0.00, lShift:  0.00, typeScale: 1.00, decorIntensity: 'standard' },
  { label: '밝은 톤',  hShift:  0.000, sShift: -0.05, lShift:  0.08, typeScale: 1.00, decorIntensity: 'subtle'   },
  { label: '진한 톤',  hShift:  0.000, sShift:  0.10, lShift: -0.08, typeScale: 1.00, decorIntensity: 'bold'     },
  { label: '시원 톤',  hShift:  0.050, sShift:  0.00, lShift:  0.00, typeScale: 0.95, decorIntensity: 'standard' },
  { label: '따뜻 톤',  hShift: -0.040, sShift:  0.05, lShift:  0.00, typeScale: 1.05, decorIntensity: 'standard' },
  { label: '강조 톤',  hShift:  0.000, sShift:  0.15, lShift: -0.05, typeScale: 1.10, decorIntensity: 'bold'     },
];

// ============================================================
// 진입점
// ============================================================

/**
 * ★ 단일 진입점. 입력 데이터 → 동적 디자인 변형 결정.
 *
 * @param data           FlyerRenderData (storeName, title, periodStart, categories)
 * @param baseToken      시즌 토큰 (resolveSeasonToken 결과 활용)
 * @param opts.fixedSeed 강제 시드 (재현용)
 * @param opts.fixedTemplateCode 강제 templateCode (template-recommender 미연동 시)
 *
 * @returns DesignVariant — 6 엔진 호출 시 CSS variable 변형 + 시즌 토큰 + 타입 스케일
 */
export function recommendDesign(
  data: FlyerRenderData,
  baseToken: SeasonToken,
  opts?: { fixedTemplateCode?: string; fixedSeed?: number }
): DesignVariant {
  const seed = opts?.fixedSeed ?? computeDesignSeed(data);
  const variantIdx = seed % VARIANTS.length;
  const variant = VARIANTS[variantIdx];
  const baseInfo = SEASON_TOKENS[baseToken];

  return {
    templateCode: opts?.fixedTemplateCode || 'grid_hero',
    seasonToken: baseToken,
    palette: {
      primary: shiftHsl(baseInfo.primary, variant.hShift, variant.sShift, variant.lShift),
      accent:  shiftHsl(baseInfo.accent,  variant.hShift, variant.sShift, variant.lShift),
      onPrimary: baseInfo.onPrimary,
    },
    typeScale: variant.typeScale,
    decorIntensity: variant.decorIntensity,
    variantSeed: seed,
    variantLabel: variant.label,
  };
}

/**
 * DesignVariant → CSS variable 분기 블록 (renderXxxEngine 안 :root에 주입).
 * 미주입 시 6 엔진은 SEASON_TOKENS 기본값으로 작동 (호환).
 */
export function variantToStyleBlock(variant: DesignVariant): string {
  return `:root{` +
    `--color-primary:${variant.palette.primary};` +
    `--color-accent:${variant.palette.accent};` +
    `--color-on-primary:${variant.palette.onPrimary};` +
    `--type-scale:${variant.typeScale};` +
  `}`;
}

/**
 * decorIntensity → 시각 강도 클래스명 (HTML <body> data-decor 속성 활용).
 * subtle/standard/bold 3단계로 데코(그라데이션·텍스처·sticker) 강약 조절.
 */
/**
 * ★ 2026-08-20 3단계 — 외부 입력(저장 JSONB·프론트 body) → DesignVariant 형태 검증.
 * 미달 = null(무변형 렌더 — fail-closed로 깨진 변형을 주입하지 않는다).
 */
export function coerceDesignVariant(v: unknown): DesignVariant | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as any;
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (!o.palette || typeof o.palette !== 'object') return null;
  if (!hex.test(String(o.palette.primary || '')) || !hex.test(String(o.palette.accent || '')) || !hex.test(String(o.palette.onPrimary || ''))) return null;
  const typeScale = Number(o.typeScale);
  if (!Number.isFinite(typeScale) || typeScale < 0.8 || typeScale > 1.3) return null;
  const decor = o.decorIntensity === 'subtle' || o.decorIntensity === 'standard' || o.decorIntensity === 'bold' ? o.decorIntensity : 'standard';
  return {
    templateCode: String(o.templateCode || 'grid_hero'),
    seasonToken: (o.seasonToken || 'default') as DesignVariant['seasonToken'],
    palette: { primary: o.palette.primary, accent: o.palette.accent, onPrimary: o.palette.onPrimary },
    typeScale,
    decorIntensity: decor,
    variantSeed: Number(o.variantSeed) || 0,
    variantLabel: String(o.variantLabel || ''),
  };
}

export function variantToDecorClass(variant: DesignVariant): string {
  return variant.decorIntensity;
}
