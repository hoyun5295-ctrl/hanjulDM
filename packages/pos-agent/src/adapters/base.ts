/**
 * ★ POS Adapter — 공통 interface + 기본 헬퍼
 *
 * POS 종류별 데이터 추출 추상화.
 * 알려진 8종 (okpos/posbank/togethers/unipos/tomato/smartro/cashnote/samsung-sds)은
 * 각자 자기 어댑터에서 테이블/컬럼 약속 사전 박음 (confidence 100%).
 * 모르는 POS는 ai-fallback.ts가 처리.
 */

import type { DiscoveredCredential } from '../credential-discovery';

export interface PosTableMapping {
  /** 회원 테이블 이름 */
  memberTable?: string;
  /** 판매 테이블 이름 */
  salesTable?: string;
  /** 재고 테이블 이름 */
  inventoryTable?: string;
  /** 회원 컬럼 매핑 (표준필드 → POS컬럼) */
  memberColumns?: Record<string, string>;
  /** 판매 컬럼 매핑 */
  salesColumns?: Record<string, string>;
  /** 재고 컬럼 매핑 */
  inventoryColumns?: Record<string, string>;
  /** 증분 추출 쿼리 */
  extractQueries?: {
    newMembers: string;
    newSales: string;
    inventorySnapshot: string;
  };
  /** 전화번호 저장 형식 */
  phoneFormat?: 'raw' | 'masked' | 'encrypted';
  /** 매핑 신뢰도 (0~100) */
  confidence: number;
}

export interface PosAdapter {
  /** 어댑터 이름 (POS 종류) */
  name: string;
  /** 어댑터 버전 */
  version: string;
  /** 우선순위 (낮을수록 먼저 시도) */
  priority: number;
  /** 사람이 읽는 설명 */
  description: string;

  /** 이 어댑터가 주어진 컨텍스트를 처리할 수 있는지 */
  matches(posType: string, candidate?: DiscoveredCredential): boolean;

  /** 사전 박힌 테이블/컬럼 매핑 반환 (실제 DB 접근 없이 즉시 반환) */
  getStaticMapping(): PosTableMapping | null;

  /** 자격증명 발견 후 실 DB 접근으로 매핑 검증 (옵션) */
  validateMapping?(credential: DiscoveredCredential): Promise<PosTableMapping | null>;

  /**
   * UI 자동화 fallback (mask-bypass 3차).
   * DB 접근 실패 또는 마스킹 우회 불가 시 POS 클라이언트 UI 자동화로 회원 데이터 추출.
   * 새벽 무인 시간대만 가동.
   * 박힌 어댑터만 지원 (OKPOS/POSBank/Togethers 우선).
   */
  uiAutomationFallback?(): Promise<{ ok: boolean; recordCount: number; error?: string }>;
}

// ============================================================
// 헬퍼 — 컬럼명 후보 패턴
// ============================================================

/** 한국 POS 공통 컬럼명 후보 — schema-reader가 발견한 컬럼 vs 이 후보 매칭 */
export const COMMON_COLUMN_HINTS = {
  // 회원
  phone: ['phone', 'hp', 'mobile', 'tel', 'cust_hp', 'cust_phone', 'member_phone', 'cust_mobile', '휴대폰', '전화'],
  name: ['name', 'cust_nm', 'member_name', 'cust_name', 'mem_nm', '성명', '이름'],
  gender: ['gender', 'sex', 'cust_sex', 'mem_sex'],
  birthDate: ['birth', 'birth_date', 'birthday', 'cust_birth', 'mem_birth'],
  memberGrade: ['grade', 'level', 'member_grade', 'mem_grade', 'cust_grade'],
  smsOptIn: ['sms_yn', 'sms_agree', 'sms_opt', 'mkt_yn', 'marketing_yn'],
  posMemberId: ['mem_id', 'member_id', 'cust_id', 'mem_no', 'member_no'],

  // 판매
  receiptNo: ['receipt_no', 'sale_no', 'tran_no', 'rcpt_no', 'order_no'],
  soldAt: ['sold_at', 'sale_date', 'tran_date', 'sale_dt', 'reg_dt', 'reg_date'],
  productCode: ['prod_cd', 'product_code', 'item_code', 'goods_cd', 'sku'],
  productName: ['prod_nm', 'product_name', 'item_name', 'goods_nm'],
  category: ['category', 'cate_cd', 'category_code', 'item_cate'],
  quantity: ['qty', 'quantity', 'sale_qty', 'cnt'],
  unitPrice: ['price', 'unit_price', 'sale_price'],
  costPrice: ['cost', 'cost_price', 'in_price'],

  // 재고
  currentStock: ['stock', 'qty', 'current_qty', 'stock_qty', 'inventory'],
  unit: ['unit', 'unit_nm', 'sale_unit'],
  expiryDate: ['expiry', 'exp_date', 'expire_dt', 'use_by'],
};

/** 컬럼명에서 표준 필드 추론 (스키마 매핑 시 사용) */
export function inferStandardField(columnName: string): string | null {
  const lower = columnName.toLowerCase();
  for (const [stdField, hints] of Object.entries(COMMON_COLUMN_HINTS)) {
    if (hints.some(h => lower === h || lower.includes(h))) {
      return stdField;
    }
  }
  return null;
}

/** 한국 전화번호 정규화 — 010-1234-5678 / 01012345678 / +82-10-... → 01012345678 */
export function normalizeKoreanPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');

  // +82 prefix 처리
  if (digits.startsWith('82')) return '0' + digits.slice(2);

  // 010/011/016/017/018/019 + 7~8자리
  if (/^01[016789]\d{7,8}$/.test(digits)) return digits;

  return null;
}

/** 전화번호 마스킹 여부 감지 */
export function detectPhoneMasking(phone: string | null | undefined): 'raw' | 'masked' | 'unknown' {
  if (!phone) return 'unknown';
  const s = String(phone);
  // 010-**95-8517 같은 패턴
  if (/[*#x]/i.test(s)) return 'masked';
  // 010-1234-5678 정상
  if (/^\d{3}-?\d{3,4}-?\d{4}$/.test(s)) return 'raw';
  return 'unknown';
}
