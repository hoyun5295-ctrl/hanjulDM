/**
 * ★ CT-F24 — 전단AI 파일 등록: 헤더 매핑 + 행 판정 (17번 설계 §2-3·§2-4 개정 2026-10-25)
 *
 * 흐름: 시트 읽기(flyer-sheet-reader) → 헤더 매핑(여기) → 행 판정(여기 · 값 규칙 = flyer-value-normalizer)
 *   - 우리 예시 양식 헤더면 AI 0회.
 *   - 그 밖의 파일만 AI가 「헤더 → 필드」 매핑을 고른다. 값은 AI가 쓰지 않는다.
 *   - AI 응답·화면이 보낸 매핑 모두 허용 목록(필드 키 · 실존 헤더)으로 거른다.
 *   - 못 읽은 값은 0이 아니라 null + 사유 → 행 판정 ok | needsReview | dropped.
 */

import { AI_MAX_TOKENS } from '../../../config/defaults';
import { callAIWithFallback } from '../ai/flyer-ai-call';
import { cellText, parseWon, parseQty, normalizeBadge, isMarked } from './flyer-value-normalizer';

// ============================================================
// 타입
// ============================================================
export interface FlyerProductMapping {
  [excelHeader: string]: string | null;
}

export interface FlyerMappingResult {
  mapping: FlyerProductMapping;
  source: 'template' | 'ai';
  unmapped: string[];
  hasProductName: boolean;
  hasSalePrice: boolean;
  message: string;
}

export interface MappedProduct {
  productName: string;
  salePrice: number;
  originalPrice: number;
  unit: string;
  category: string;
  promoType: 'main' | 'sub' | 'general';
  origin: string;
  imageUrl: string;
  /** ★ 1025 신규(optional) — 기존 8키는 이름·뜻 불변(0820 productName 사고) */
  badge?: string;
  cardDiscount?: string;
  /** 사장님 확인이 필요한 사유 */
  review?: string[];
  /** 가격을 읽지 못함 — 인쇄 관문 차단 대상 */
  reviewPrice?: boolean;
}

export type RowStatus = 'ok' | 'needsReview' | 'dropped';

export interface JudgedRow {
  /** 엑셀 행 번호(1부터 · 화면 표시용) */
  index: number;
  status: RowStatus;
  reasons: string[];
  /** reasons 와 같은 순서의 기계 키 — 화면은 문구가 아니라 이 키로 판단한다(★1025 Codex 1R)
   *  가격 키(PRICE_REASON_KEYS)가 남아 있으면 인쇄 차단 */
  reasonKeys: string[];
  raw: Record<string, string>;
  product: MappedProduct | null;
}

// ============================================================
// 필드 · 예시 양식 헤더
// ============================================================
const FLYER_PRODUCT_FIELDS: Record<string, string> = {
  product_name: '상품명 (필수 — 상품이름, 품명, 품목, 제품명)',
  sale_price: '행사가 (필수 — 판매가, 할인가, 가격, 판매금액, 특가)',
  original_price: '정상가 (원가, 기존가, 원래가격)',
  unit: '규격 (단위, kg, g, 팩, 봉, 개, 박스, 100g 등)',
  category: '카테고리 (분류, 축산, 정육, 청과, 수산, 유제품, 공산, 생활용품 등)',
  bundle_qty: '묶음 수량 (2개 묶음의 2)',
  bundle_price: '묶음가 (묶음 전체 가격)',
  badge: '행사 뱃지 (1+1, 2+1, 한정, 카드할인, 오늘만, 신상품, 행사구분)',
  card_discount: '카드할인 (예: KB카드 10%)',
  limit_qty: '한정 수량',
  origin: '원산지 (국내산, 미국산, 호주산 등)',
  featured: '대표 상품 (○ 표시)',
  image_url: '이미지 URL',
};
export const FLYER_FIELD_KEYS = Object.keys(FLYER_PRODUCT_FIELDS);

/** 예시 양식(public/samples/hanjul-flyer-sample.xlsx) 시트1 헤더 — 순서 고정 · 양식 파일 시험이 대조한다 */
export const TEMPLATE_HEADERS: Array<[string, string]> = [
  ['카테고리', 'category'],
  ['상품명', 'product_name'],
  ['규격', 'unit'],
  ['정상가', 'original_price'],
  ['행사가', 'sale_price'],
  ['묶음 수량', 'bundle_qty'],
  ['묶음가', 'bundle_price'],
  ['행사 뱃지', 'badge'],
  ['카드할인', 'card_discount'],
  ['한정 수량', 'limit_qty'],
  ['원산지', 'origin'],
  ['대표 상품', 'featured'],
];

/** 헤더 비교용 정규화 — 공백·필수 표시(*)·괄호 설명 제거 */
export function normHeader(h: string): string {
  return cellText(h).replace(/\(.*?\)/g, '').replace(/[\s*]/g, '');
}

const TEMPLATE_MAP = new Map(TEMPLATE_HEADERS.map(([h, f]) => [normHeader(h), f]));

/** 헤더 행 탐지 점수용 동의어(값 매핑에는 쓰지 않는다 — 탐지만) */
const HEADER_SYNONYMS: Record<string, string[]> = {
  product_name: ['상품명', '품명', '품목', '제품명', '상품', '상품이름', '품목명'],
  sale_price: ['행사가', '판매가', '할인가', '가격', '판매금액', '특가', '행사가격', '판매가격'],
  original_price: ['정상가', '원가', '기존가', '정가', '소비자가'],
  unit: ['규격', '단위', '용량', '중량'],
  category: ['카테고리', '분류', '대분류', '부문'],
  origin: ['원산지', '산지'],
  badge: ['행사뱃지', '행사구분', '행사', '뱃지'],
  bundle_qty: ['묶음수량'],
  bundle_price: ['묶음가'],
  card_discount: ['카드할인'],
  limit_qty: ['한정수량'],
  featured: ['대표상품'],
};
const SYNONYM_SET = new Set(Object.values(HEADER_SYNONYMS).flat().map(normHeader));

/** 헤더 후보 행 점수 = 동의어에 맞는 칸 수 (flyer-sheet-reader가 제목행 탐지에 쓴다) */
export function headerScore(cells: string[]): number {
  return cells.filter(c => SYNONYM_SET.has(normHeader(c))).length;
}

/** 우리 예시 양식이면 매핑을 바로 만든다(AI 0회). 아니면 null */
export function templateMapping(headers: string[]): FlyerProductMapping | null {
  const named = headers.filter(h => cellText(h));
  if (named.length === 0) return null;
  const mapping: FlyerProductMapping = {};
  for (const h of headers) {
    if (!cellText(h)) continue;
    const f = TEMPLATE_MAP.get(normHeader(h));
    if (!f) return null;
    mapping[h] = f;
  }
  const fields = Object.values(mapping);
  return fields.includes('product_name') && (fields.includes('sale_price') || fields.includes('bundle_price')) ? mapping : null;
}

/** 외부 입력 매핑(AI 응답 · 화면) → 허용 목록 통과분만. 키=실존 헤더 · 값=필드 키 또는 null */
export function sanitizeMapping(raw: unknown, headers: string[]): FlyerProductMapping {
  const out: FlyerProductMapping = {};
  for (const h of headers) if (cellText(h)) out[h] = null;
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(out, k)) continue;
    out[k] = typeof v === 'string' && FLYER_FIELD_KEYS.includes(v) ? v : null;
  }
  return out;
}

function summarize(mapping: FlyerProductMapping, source: 'template' | 'ai'): FlyerMappingResult {
  const fields = Object.values(mapping);
  const hasProductName = fields.includes('product_name');
  const hasSalePrice = fields.includes('sale_price') || fields.includes('bundle_price');
  return {
    mapping,
    source,
    unmapped: Object.entries(mapping).filter(([, v]) => v === null).map(([k]) => k),
    hasProductName,
    hasSalePrice,
    message: hasProductName && hasSalePrice
      ? (source === 'template' ? '예시 양식으로 읽었습니다' : 'AI가 열을 연결했습니다')
      : !hasProductName ? '상품명 열을 찾지 못했습니다.' : '가격 열을 찾지 못했습니다.',
  };
}

/** 화면이 고친 매핑을 검증해 요약까지 만든다 */
export function summarizeUserMapping(raw: unknown, headers: string[]): FlyerMappingResult {
  return summarize(sanitizeMapping(raw, headers), 'ai');
}

// ============================================================
// 헤더 매핑 — 양식이면 규칙, 아니면 AI(헤더만)
// ============================================================
export async function mapFlyerExcelHeaders(headers: string[]): Promise<FlyerMappingResult> {
  const tpl = templateMapping(headers);
  if (tpl) return summarize(tpl, 'template');

  const named = headers.filter(h => cellText(h));
  const mappingPrompt = `엑셀 파일의 컬럼명을 마트 전단지 상품 데이터 필드에 매핑해줘.

엑셀 컬럼명: ${JSON.stringify(named)}

매핑 대상 필드:
${Object.entries(FLYER_PRODUCT_FIELDS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

규칙:
1. 의미가 비슷하면 매핑 (예: 품명 → product_name, 가격 → sale_price, 정상가 → original_price)
2. 매핑할 수 없는 컬럼은 null
3. 한 필드에는 컬럼 하나만
4. "가격"이 하나만 있으면 sale_price로 매핑
5. "가격"이 두 개면 큰 쪽을 original_price, 작은 쪽을 sale_price

JSON 형식으로만 응답 (다른 설명 없이):
{"엑셀컬럼명": "필드명(영문) 또는 null", ...}`;

  let aiText = '{}';
  try {
    aiText = await callAIWithFallback({
      system: '너는 엑셀 컬럼명을 정해진 영문 필드 키에 연결하는 도구다. JSON 객체만 출력한다.',
      userMessage: mappingPrompt,
      maxTokens: AI_MAX_TOKENS.fieldMapping || 1024,
      temperature: 0,
    });
  } catch (err: any) {
    console.warn('[CT-F24] AI 헤더 매핑 실패 — 빈 매핑으로 진행(화면에서 연결):', err?.message || err);
  }

  let parsed: unknown = {};
  try {
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.error('[CT-F24] AI 응답 파싱 실패:', aiText.slice(0, 200));
  }
  return summarize(sanitizeMapping(parsed, headers), 'ai');
}

// ============================================================
// 행 판정: 시트 행 → 상품 + 상태
// ============================================================
export const REASON_PRICE = '가격을 읽지 못했습니다';
/** 판매 조건(가격·묶음 수량·규격)을 확정하지 못한 사유 키 — 하나라도 남으면 reviewPrice(인쇄 차단).
 *  사장님이 가격을 확인하면 이 키들만 걷힌다. 열 중복도 판매 조건 칸이면 여기(★1025 Codex 2R: dup:bundle_qty 우회) */
export const PRICE_REASON_KEYS = ['price', 'bundle', 'dup:sale_price', 'dup:bundle_price', 'dup:bundle_qty', 'dup:unit'];

export function applyFlyerMapping(headers: string[], rows: string[][], mapping: FlyerProductMapping, firstRowNumber = 2): JudgedRow[] {
  // 필드 → 헤더 열 번호(첫 연결만 쓰고, 두 번 연결된 필드는 전 행 확인 필요)
  const colOf: Record<string, number> = {};
  const dupFields = new Set<string>();
  headers.forEach((h, i) => {
    const f = cellText(h) ? mapping[h] : null;
    if (!f) return;
    if (colOf[f] !== undefined) dupFields.add(f);
    else colOf[f] = i;
  });
  const dupReasons = [...dupFields].map(f => ({ key: 'dup:' + f, text: `「${FLYER_PRODUCT_FIELDS[f].split(' (')[0]}」 열이 두 개 연결됐습니다` }));

  const out: JudgedRow[] = [];
  rows.forEach((row, ri) => {
    const get = (f: string) => (colOf[f] === undefined ? '' : cellText(row[colOf[f]]));
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => { if (cellText(h)) raw[h] = cellText(row[i]); });
    if (Object.values(raw).every(v => !v)) return; // 빈 행(양식의 빈 칸)은 행으로 치지 않는다

    const index = firstRowNumber + ri;
    const name = get('product_name');
    if (!name) {
      out.push({ index, status: 'dropped', reasons: ['상품명 없음'], reasonKeys: ['no_name'], raw, product: null });
      return;
    }

    const found: Array<{ key: string; text: string }> = [...dupReasons];
    const add = (key: string, text: string) => found.push({ key, text });

    const sale = parseWon(get('sale_price'));
    const orig = parseWon(get('original_price'));
    const bQty = parseQty(get('bundle_qty'));
    const bPrice = parseWon(get('bundle_price'));
    let unit = get('unit');

    let salePrice: number | null = sale.value;
    let bundle = sale.bundle || null;
    if (!bundle && (!bQty.empty || !bPrice.empty)) {
      if (bQty.value && bQty.value >= 2 && bPrice.value) bundle = { qty: bQty.value, price: bPrice.value };
      else add('bundle', '묶음 수량과 묶음가를 함께 적어 주세요'); // 묶음 조건을 못 읽음 = 가격 미확정(인쇄 차단)
    }
    if (bundle) {
      salePrice = bundle.price;
      unit = unit ? `${bundle.qty}개 · ${unit}` : `${bundle.qty}개`;
    }
    if (!salePrice) add('price', REASON_PRICE);

    let originalPrice = orig.value || 0;
    if (!orig.empty && orig.value === null) add('orig', '정상가를 읽지 못했습니다');
    if (originalPrice > 0 && salePrice && originalPrice < salePrice && !bundle) {
      add('orig_low', '정상가가 행사가보다 낮습니다');
      originalPrice = 0;
    }

    const badgeRaw = normalizeBadge(get('badge'));
    if (!badgeRaw.empty && !badgeRaw.value) add('badge', '행사 뱃지를 읽지 못했습니다');
    let badge = badgeRaw.value || '';
    const lim = parseQty(get('limit_qty'));
    if (!lim.empty && !lim.value) add('limit', '한정 수량을 읽지 못했습니다');
    if (lim.value && (!badge || badge === '한정')) badge = `한정 ${lim.value}`;
    const cardDiscount = get('card_discount');
    if (cardDiscount && !badge) badge = '카드할인';

    const reasons = found.map(f => f.text);
    const reasonKeys = found.map(f => f.key);
    const reviewPrice = reasonKeys.some(k => PRICE_REASON_KEYS.includes(k));
    const needsReview = reasons.length > 0;
    // 대표 표시 > 할인율 자동 승격(확인 필요 행은 승격 금지 — 오파싱 가격이 메인으로 번지던 경로)
    let promoType: MappedProduct['promoType'] = 'general';
    if (isMarked(get('featured'))) promoType = 'main';
    else if (!needsReview && originalPrice > 0 && salePrice) {
      const discRate = Math.round((1 - salePrice / originalPrice) * 100);
      if (discRate >= 30) promoType = 'main';
      else if (discRate >= 10) promoType = 'sub';
    }

    const product: MappedProduct = {
      productName: name,
      salePrice: salePrice || 0,
      originalPrice,
      unit,
      category: get('category') || '기타',
      promoType,
      origin: get('origin'),
      imageUrl: get('image_url'),
      ...(badge ? { badge } : {}),
      ...(cardDiscount ? { cardDiscount } : {}),
      ...(needsReview ? { review: reasons } : {}),
      ...(reviewPrice ? { reviewPrice: true } : {}),
    };
    out.push({ index, status: needsReview ? 'needsReview' : 'ok', reasons, reasonKeys, raw, product });
  });
  return out;
}

// ============================================================
// 매핑 대상 필드 목록 (프론트엔드 UI용)
// ============================================================
export function getFlyerMappingFields() {
  return Object.entries(FLYER_PRODUCT_FIELDS).map(([key, desc]) => ({
    fieldKey: key,
    displayName: desc.split('(')[0].trim(),
    description: desc,
    required: key === 'product_name' || key === 'sale_price',
  }));
}
