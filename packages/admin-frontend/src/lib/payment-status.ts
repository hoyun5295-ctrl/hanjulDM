/**
 * 결제 상태 표시 축 (슈퍼관리자 화면 공용)
 *
 * ★ 값의 SoT는 backend CT-F25 `utils/flyer/billing/flyer-payment-status.ts` 다.
 *   패키지가 달라 import 할 수 없어 값만 미러한다. 서버가 화이트리스트로 재검증하므로
 *   여기가 틀리면 저장이 400으로 거부된다(조용히 어긋나지 않는다).
 *
 * ⚠ 'paid' 는 청구서(flyer_billing_history) 전용 값이다. 매장·총판 축에 쓰지 않는다.
 */

export type BadgeTone = 'success' | 'error' | 'warn' | 'neutral' | 'brand';

/** 매장(flyer_users) — pending / active / suspended */
export const STORE_PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'pending', label: '결제대기' },
  { value: 'active', label: '이용중' },
  { value: 'suspended', label: '정지' },
];

/** 총판(flyer_companies) — active / expired / suspended */
export const COMPANY_PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'active', label: '이용중' },
  { value: 'expired', label: '만료' },
  { value: 'suspended', label: '정지' },
];

/** 청구서(flyer_billing_history) — pending / paid / failed */
export const BILLING_PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'pending', label: '미결제' },
  { value: 'paid', label: '결제완료' },
  { value: 'failed', label: '실패' },
];

const TONES: Record<string, BadgeTone> = {
  active: 'success',
  paid: 'success',
  pending: 'warn',
  expired: 'neutral',
  suspended: 'error',
  failed: 'error',
};

function labelOf(options: { value: string; label: string }[], value?: string | null): string {
  if (!value) return '-';
  return options.find(o => o.value === value)?.label || value; // 축 밖 값은 원문 그대로 드러낸다
}

function toneOf(options: { value: string; label: string }[], value?: string | null): BadgeTone {
  if (!value) return 'neutral';
  if (!options.some(o => o.value === value)) return 'error'; // 축 밖 값 = 눈에 띄게
  return TONES[value] || 'neutral';
}

export const storePaymentLabel = (v?: string | null) => labelOf(STORE_PAYMENT_OPTIONS, v);
export const storePaymentTone = (v?: string | null) => toneOf(STORE_PAYMENT_OPTIONS, v);
export const companyPaymentLabel = (v?: string | null) => labelOf(COMPANY_PAYMENT_OPTIONS, v);
export const companyPaymentTone = (v?: string | null) => toneOf(COMPANY_PAYMENT_OPTIONS, v);
export const billingPaymentLabel = (v?: string | null) => labelOf(BILLING_PAYMENT_OPTIONS, v);
export const billingPaymentTone = (v?: string | null) => toneOf(BILLING_PAYMENT_OPTIONS, v);
