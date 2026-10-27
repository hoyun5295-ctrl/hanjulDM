/**
 * ★ CT-F 1025 — 전단 파일 등록 값 규칙 (17번 설계 §2-3)
 *
 * 원칙: 값은 규칙만 만든다 — AI가 가격·수량을 쓰는 경로 0.
 *       못 읽으면 null + 사유(0으로 바꾸지 않는다 — 「2개 5000원」이 2원이 되던 결함).
 * 소비처: flyer-excel-mapper.ts(applyFlyerMapping) · sheetDateToYmd = routes/flyer/customers.ts(고객 엑셀 업로드 생일).
 */

/** 셀 원문 → 비교용 문자열(공백 정리) */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

export interface WonParse {
  /** 읽은 금액(원). 못 읽음 = null · 빈 칸 = null(empty=true) */
  value: number | null;
  empty: boolean;
  /** 「2개 5000원」처럼 가격 칸에 묶음이 적힌 경우 */
  bundle?: { qty: number; price: number };
}

const UNIT_WORDS = '개|입|팩|봉|병|캔|통|묶음|ea|EA|Ea';

/** 금액 한 칸 해석 — 「1,980원」「₩1980」「1980」「2개 5,000원」「2개에 5000」 */
export function parseWon(raw: unknown): WonParse {
  const t = cellText(raw);
  if (!t) return { value: null, empty: true };
  const bundle = t.match(new RegExp(`^(\\d+)\\s*(?:${UNIT_WORDS})\\s*(?:에)?\\s*[₩\\\\]?\\s*([\\d,]+)\\s*원?$`));
  if (bundle) {
    const qty = Number(bundle[1]);
    const price = Number(bundle[2].replace(/,/g, ''));
    if (qty >= 2 && Number.isFinite(price) && price > 0) return { value: price, empty: false, bundle: { qty, price } };
    return { value: null, empty: false };
  }
  const plain = t.replace(/[₩\\\s]/g, '').replace(/원$/, '');
  if (/^\d{1,3}(,\d{3})+$|^\d+$/.test(plain)) return { value: Number(plain.replace(/,/g, '')), empty: false };
  // 엑셀 숫자 셀이 「1980.0」으로 오는 경우
  if (/^\d+\.0+$/.test(plain)) return { value: Number(plain), empty: false };
  return { value: null, empty: false };
}

/** 양의 정수 수량 — 「2」「2개」「30개 한정」 */
export function parseQty(raw: unknown): { value: number | null; empty: boolean } {
  const t = cellText(raw);
  if (!t) return { value: null, empty: true };
  const m = t.match(new RegExp(`^(\\d+)\\s*(?:${UNIT_WORDS})?(?:\\s*한정)?$`));
  if (!m) return { value: null, empty: false };
  const n = Number(m[1]);
  return n > 0 ? { value: n, empty: false } : { value: null, empty: false };
}

/** 행사 뱃지 허용 목록(예시 양식 「목록」 시트와 같은 값) */
export const BADGE_VALUES = ['1+1', '2+1', '한정', '카드할인', '오늘만', '신상품'] as const;

/** 뱃지 원문 → 허용 값. 「1 + 1」「3+1」도 받는다. 못 읽음 = null */
export function normalizeBadge(raw: unknown): { value: string | null; empty: boolean } {
  const t = cellText(raw).replace(/\s+/g, '');
  if (!t) return { value: null, empty: true };
  if (/^\d\+\d$/.test(t)) return { value: t, empty: false };
  const hit = (BADGE_VALUES as readonly string[]).find(b => b === t);
  return { value: hit || null, empty: false };
}

/** 대표 상품 표시 — 「○」「O」「Y」「예」「대표」「1」「V」「✓」 */
export function isMarked(raw: unknown): boolean {
  return /^(○|◯|O|o|Y|y|예|대표|1|V|v|✓|✔|TRUE|true)$/.test(cellText(raw));
}

/**
 * 엑셀 날짜 칸(Date) · 날짜 글자 → YYYY-MM-DD · 못 읽으면 null
 * ★ 1027: SheetJS 0.20.3 은 날짜 칸을 프로세스 시각대의 그날 자정으로 준다 → 그 시각대로 읽는다(UTC 로 읽으면 한국 시각대에서 하루 앞)
 */
export function sheetDateToYmd(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const match = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return null;
}
