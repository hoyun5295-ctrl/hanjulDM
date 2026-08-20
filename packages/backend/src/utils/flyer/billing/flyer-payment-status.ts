/**
 * ★ CT-F26 — 전단AI 결제 상태 판정 컨트롤타워
 *
 * 결제 상태 값 축과 접근 판정의 유일한 기준.
 * 미들웨어(flyer-auth) · 발송 게이트(canFlyerStoreSend) · 잔액 라우트(balance) ·
 * 슈퍼관리자 수정(flyer-admin PUT)이 전부 이 파일만 호출한다. 판정 인라인 금지.
 *
 * [값 축 — 서로 다른 테이블은 서로 다른 축을 쓴다]
 *   flyer_users(매장)          = pending / active / suspended
 *   flyer_companies(총판)      = active / expired / suspended
 *   flyer_billing_history(청구) = pending / paid / failed
 *   ⚠ 'paid'는 청구서 전용. 매장·총판 축에 쓰지 않는다.
 *
 * [화이트리스트 판정] 축에 없는 값(옛 'paid' 등)은 통과가 아니라 차단이다.
 *   DB에 CHECK 제약이 없어(2026-08-20 실측 0건) 오타·레거시 값이 들어올 수 있다.
 */

// ══════════════════════════════════════════
// 값 축
// ══════════════════════════════════════════
export const STORE_PAYMENT_STATUSES = ['pending', 'active', 'suspended'] as const;
export type StorePaymentStatus = (typeof STORE_PAYMENT_STATUSES)[number];

export const COMPANY_PAYMENT_STATUSES = ['active', 'expired', 'suspended'] as const;
export type CompanyPaymentStatus = (typeof COMPANY_PAYMENT_STATUSES)[number];

export const BILLING_PAYMENT_STATUSES = ['pending', 'paid', 'failed'] as const;
export type BillingPaymentStatus = (typeof BILLING_PAYMENT_STATUSES)[number];

export const STORE_PAYMENT_STATUS_LABELS: Record<StorePaymentStatus, string> = {
  pending: '결제대기',
  active: '이용중',
  suspended: '정지',
};

export const COMPANY_PAYMENT_STATUS_LABELS: Record<CompanyPaymentStatus, string> = {
  active: '이용중',
  expired: '만료',
  suspended: '정지',
};

export function isValidStorePaymentStatus(v: unknown): v is StorePaymentStatus {
  return typeof v === 'string' && (STORE_PAYMENT_STATUSES as readonly string[]).includes(v);
}

export function isValidCompanyPaymentStatus(v: unknown): v is CompanyPaymentStatus {
  return typeof v === 'string' && (COMPANY_PAYMENT_STATUSES as readonly string[]).includes(v);
}

// ══════════════════════════════════════════
// 만료 판정 — 업무 타임존(KST) 날짜로만 비교, 만료일 당일까지 유효
// ══════════════════════════════════════════
/**
 * ⚠ 앱 프로세스 로컬시각으로 오늘을 계산하면 DB(PostgreSQL timezone=Etc/UTC)의
 *   CURRENT_DATE 와 자정~오전 9시 사이에 하루 어긋난다. 판정도 갱신도 KST 날짜 하나로 맞춘다.
 *   SQL 쪽 짝 = (NOW() AT TIME ZONE 'Asia/Seoul')::date
 */
export const BUSINESS_TIMEZONE = 'Asia/Seoul';

/** KST 기준 오늘 날짜 키(YYYY-MM-DD) */
export function businessToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * 날짜 키(YYYY-MM-DD) 추출. Date 객체는 KST 날짜로 투영하고,
 * 문자열은 앞 10자를 엄격히 검사한다(Date 생성자에 맡기면 UTC 파싱으로 하루 밀린다).
 * 해석 불가 = null 이 아니라 'invalid' — 호출부가 fail-closed 로 다룬다.
 */
function toDateKey(v?: string | Date | null): string | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return 'invalid';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(v);
  }
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : 'invalid';
}

/**
 * plan_expires_at 은 DATE 컬럼이다. 만료 = KST 오늘이 만료일을 지난 경우(당일은 유효).
 * 값이 있는데 해석되지 않으면 만료로 본다(fail-closed) — 깨진 값으로 무기한 열지 않는다.
 */
export function isPlanExpired(expiresAt?: string | Date | null): boolean {
  const key = toDateKey(expiresAt);
  if (key === null) return false;      // 미설정 = 기간 제한 없음
  if (key === 'invalid') return true;  // 해석 불가 = 차단
  return businessToday() > key;        // YYYY-MM-DD 는 사전순 = 날짜순
}

// ══════════════════════════════════════════
// 접근 판정
// ══════════════════════════════════════════
export type FlyerAccessCode =
  | 'OK'
  | 'COMPANY_SUSPENDED'
  | 'COMPANY_EXPIRED'
  | 'COMPANY_STATUS_UNKNOWN'
  | 'STORE_SUSPENDED'
  | 'STORE_PENDING'
  | 'STORE_STATUS_UNKNOWN'
  | 'PLAN_EXPIRED';

export interface FlyerAccessInput {
  companyPaymentStatus?: string | null;
  companyPlanExpiresAt?: string | Date | null;
  storePaymentStatus?: string | null;
  storePlanExpiresAt?: string | Date | null;
}

export interface FlyerAccessResult {
  /** 서비스 기능(발송·제작) 사용 가능 여부 */
  allowed: boolean;
  /**
   * 결제·잔액 조회 경로 개방 여부.
   * 매장이 스스로 결제해서 해소할 수 있는 차단(미결제·기간만료)일 때만 true.
   * 정지·총판 차단은 관리자 조치 영역이므로 false — 결제받고 서비스가 안 열리는 상태를 만들지 않는다.
   */
  billingAccessible: boolean;
  code: FlyerAccessCode;
  reason: string;
}

const OK_RESULT: FlyerAccessResult = {
  allowed: true,
  billingAccessible: true,
  code: 'OK',
  reason: '',
};

/**
 * 매장 접근 판정. 총판(상위) → 매장(하위) 순으로 본다.
 */
export function resolveFlyerStoreAccess(input: FlyerAccessInput): FlyerAccessResult {
  // 1. 총판 레벨 — 하위 전 매장 차단. 매장 결제로 해소되지 않는다.
  if (input.companyPaymentStatus === 'suspended') {
    return {
      allowed: false,
      billingAccessible: false,
      code: 'COMPANY_SUSPENDED',
      reason: '총판 계정이 정지되었습니다. 관리자에게 문의해주세요.',
    };
  }
  if (input.companyPaymentStatus === 'expired' || isPlanExpired(input.companyPlanExpiresAt)) {
    return {
      allowed: false,
      billingAccessible: false,
      code: 'COMPANY_EXPIRED',
      reason: '총판 계약 기간이 만료되었습니다. 관리자에게 문의해주세요.',
    };
  }
  // ★ 총판 축도 화이트리스트다. NULL·옛 'paid'·오타를 통과시키면 그 총판의 전 매장이 열린다.
  //   총판 축 오류는 매장 결제로 풀 수 없으므로 결제 경로도 닫는다.
  if (!isValidCompanyPaymentStatus(input.companyPaymentStatus)) {
    return {
      allowed: false,
      billingAccessible: false,
      code: 'COMPANY_STATUS_UNKNOWN',
      reason: '총판 이용 상태를 확인할 수 없습니다. 관리자에게 문의해주세요.',
    };
  }

  // 2. 매장 레벨
  if (input.storePaymentStatus === 'suspended') {
    return {
      allowed: false,
      billingAccessible: false,
      code: 'STORE_SUSPENDED',
      reason: '매장 이용이 정지되었습니다. 관리자에게 문의해주세요.',
    };
  }
  if (input.storePaymentStatus === 'pending') {
    return {
      allowed: false,
      billingAccessible: true,
      code: 'STORE_PENDING',
      reason: '이용료 결제 후 이용하실 수 있습니다.',
    };
  }
  if (!isValidStorePaymentStatus(input.storePaymentStatus)) {
    // 축에 없는 값 = 통과시키지 않는다. 결제로 정상화할 수 있게 결제 경로만 연다.
    return {
      allowed: false,
      billingAccessible: true,
      code: 'STORE_STATUS_UNKNOWN',
      reason: '이용 상태를 확인할 수 없습니다. 이용료 결제 후 이용하실 수 있습니다.',
    };
  }
  if (isPlanExpired(input.storePlanExpiresAt)) {
    return {
      allowed: false,
      billingAccessible: true,
      code: 'PLAN_EXPIRED',
      reason: '이용 기간이 만료되었습니다. 이용료 결제 후 계속 이용하실 수 있습니다.',
    };
  }

  return OK_RESULT;
}

// ══════════════════════════════════════════
// 차단 중에도 열어두는 경로
// ══════════════════════════════════════════
/**
 * 매장이 스스로 해소할 수 있는 차단(미결제·기간만료) 상태에서 통과시킬 마운트 경로.
 * 결제 엔드포인트를 차단 뒤에 두면 만료된 매장이 결제 자체를 못 하는 잠금이 된다.
 */
const FLYER_BILLING_OPEN_PATHS = ['/api/flyer/balance', '/api/flyer/auth'];

export function isFlyerBillingOpenPath(baseUrl?: string | null): boolean {
  if (!baseUrl) return false;
  return FLYER_BILLING_OPEN_PATHS.some(p => baseUrl === p || baseUrl.startsWith(`${p}/`));
}
