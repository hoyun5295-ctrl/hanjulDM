/**
 * ★ 결제 상태·잔액 축 재발 방지 게이트 (2026-08-20)
 *
 * 이 축의 뿌리 사고 = 같은 뜻의 상태를 화면마다 다른 값으로 부른 것.
 *   슈퍼관리자는 'paid'를 쓰고, 매장 화면은 'active'만 인정하고, 발송 게이트는 'paid'를 통과시켰다.
 *   여기에 유령 컬럼(amount/status)과 기록 없는 잔액 이동이 겹쳐 화면이 조용히 비었다.
 *
 * 게이트:
 *   1. 판정 표 — CT-F26 resolveFlyerStoreAccess 의 값 축·개방 규칙 고정
 *   2. 만료 경계 — 만료일 당일은 유효(하루 손실 금지)
 *   3. 소비처 배선 — 판정·검증 함수가 실제 경계마다 호출되는지(미배선 재발 차단)
 *   4. 금지 패턴 — 'paid' 매장 축 혼입 · 유령 컬럼 · CT 밖 잔액 UPDATE · '후불' 표기
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  resolveFlyerStoreAccess,
  isPlanExpired,
  businessToday,
  isFlyerBillingOpenPath,
  isValidStorePaymentStatus,
  isValidCompanyPaymentStatus,
  STORE_PAYMENT_STATUSES,
  COMPANY_PAYMENT_STATUSES,
} from './billing/flyer-payment-status';

const BACKEND_SRC = path.resolve(__dirname, '..', '..');
const FRONTEND_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const ADMIN_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'admin-frontend', 'src');

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== 'dist') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f.name)) out.push(p);
  }
  return out;
}
const read = (p: string) => fs.readFileSync(p, 'utf-8');
const rel = (p: string) => p.replace(/\\/g, '/');

const DAY = 86400000;
const dateOnly = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

// ────────────────────────────────────────────────────
// 1. 판정 표
// ────────────────────────────────────────────────────
describe('게이트 1 — 결제 상태 판정 표(CT-F26)', () => {
  const OK = { companyPaymentStatus: 'active', storePaymentStatus: 'active', storePlanExpiresAt: dateOnly(10) };

  it('정상 = 이용 가능', () => {
    const r = resolveFlyerStoreAccess(OK);
    expect(r.allowed).toBe(true);
    expect(r.code).toBe('OK');
  });

  it('총판 정지 = 전면 차단(결제로 풀리지 않는다)', () => {
    const r = resolveFlyerStoreAccess({ ...OK, companyPaymentStatus: 'suspended' });
    expect(r.allowed).toBe(false);
    expect(r.billingAccessible).toBe(false);
    expect(r.code).toBe('COMPANY_SUSPENDED');
  });

  it('매장 정지 = 전면 차단', () => {
    const r = resolveFlyerStoreAccess({ ...OK, storePaymentStatus: 'suspended' });
    expect(r.allowed).toBe(false);
    expect(r.billingAccessible).toBe(false);
    expect(r.code).toBe('STORE_SUSPENDED');
  });

  it('미결제 = 기능 차단 + 결제 경로 개방', () => {
    const r = resolveFlyerStoreAccess({ ...OK, storePaymentStatus: 'pending' });
    expect(r.allowed).toBe(false);
    expect(r.billingAccessible).toBe(true);
    expect(r.code).toBe('STORE_PENDING');
  });

  it('기간 만료 = 기능 차단 + 결제 경로 개방(스스로 결제할 수 있어야 한다)', () => {
    const r = resolveFlyerStoreAccess({ ...OK, storePlanExpiresAt: dateOnly(-1) });
    expect(r.allowed).toBe(false);
    expect(r.billingAccessible).toBe(true);
    expect(r.code).toBe('PLAN_EXPIRED');
  });

  it("★ 'paid'는 매장 축이 아니다 — 통과시키지 않는다(무료 발송 구멍 차단)", () => {
    const r = resolveFlyerStoreAccess({ ...OK, storePaymentStatus: 'paid' });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('STORE_STATUS_UNKNOWN');
  });

  it('축 밖 값·오타는 전부 차단(화이트리스트)', () => {
    for (const bogus of ['', 'PAID', 'actived', 'unknown', null, undefined]) {
      expect(resolveFlyerStoreAccess({ ...OK, storePaymentStatus: bogus as any }).allowed).toBe(false);
    }
  });

  it('★ 총판 축도 fail-close — NULL·오타·옛 paid 는 전면 차단(그 총판 전 매장이 열리는 구멍)', () => {
    for (const bogus of ['', 'paid', 'Active', 'unknown', null, undefined]) {
      const r = resolveFlyerStoreAccess({ ...OK, companyPaymentStatus: bogus as any });
      expect(r.allowed).toBe(false);
      expect(r.billingAccessible).toBe(false); // 총판 오류는 매장 결제로 풀 수 없다
      expect(r.code).toBe('COMPANY_STATUS_UNKNOWN');
    }
  });

  it('값 축 자체가 바뀌면 실패한다(문서·화면 동시 정정 강제)', () => {
    expect([...STORE_PAYMENT_STATUSES]).toEqual(['pending', 'active', 'suspended']);
    expect([...COMPANY_PAYMENT_STATUSES]).toEqual(['active', 'expired', 'suspended']);
    expect(isValidStorePaymentStatus('paid')).toBe(false);
    expect(isValidCompanyPaymentStatus('paid')).toBe(false);
  });
});

// ────────────────────────────────────────────────────
// 2. 만료 경계
// ────────────────────────────────────────────────────
describe('게이트 2 — 만료 경계(만료일 당일은 유효)', () => {
  it('만료일 당일은 만료가 아니다', () => {
    expect(isPlanExpired(dateOnly(0))).toBe(false);
  });
  it('만료일 다음 날부터 만료', () => {
    expect(isPlanExpired(dateOnly(-1))).toBe(true);
  });
  it('만료일 미설정 = 기간 제한 없음', () => {
    expect(isPlanExpired(null)).toBe(false);
    expect(isPlanExpired(undefined)).toBe(false);
  });
  it('문자열 YYYY-MM-DD 는 KST 날짜 키로 비교한다(UTC 파싱으로 하루 밀리지 않는다)', () => {
    const today = businessToday();
    expect(isPlanExpired(today)).toBe(false);
    expect(isPlanExpired(`${today}T00:00:00.000Z`)).toBe(false);
  });
  it('값이 있는데 해석 불가 = 만료로 본다(fail-closed)', () => {
    expect(isPlanExpired('언젠가')).toBe(true);
    expect(isPlanExpired('2026-13-40')).toBe(false); // 형식은 맞으므로 날짜 키 비교로 넘어간다
    expect(isPlanExpired(new Date('bad'))).toBe(true);
  });
});

// ────────────────────────────────────────────────────
// 2-1. 잔액 이동 멱등 계약 (CT-F27)
// ────────────────────────────────────────────────────
describe('게이트 2-1 — 잔액 이동 멱등 계약', () => {
  const ledger = read(path.resolve(BACKEND_SRC, 'utils/flyer/billing/flyer-balance-ledger.ts'));

  it('operationId 없이 잔액을 움직일 수 없다(타입 필수 + 런타임 차단)', () => {
    expect(/operationId: string;/.test(ledger)).toBe(true);
    expect(ledger.includes("reason: '작업 식별자가 없습니다'")).toBe(true);
  });
  it('행 잠금 후 재시도 판별 — 확인-후-실행이 경합에서 안전하다', () => {
    expect(/FOR UPDATE/.test(ledger)).toBe(true);
    expect(/WHERE user_id = \$1 AND operation_id = \$2/.test(ledger)).toBe(true);
    expect(/replayed: true/.test(ledger)).toBe(true);
  });
  it('원장 INSERT 에 operation_id 가 함께 박힌다', () => {
    expect(/operation_id, type, amount, balance_after/.test(ledger)).toBe(true);
  });
  it('돈 이동 4경로가 전부 멱등 키를 넘긴다', () => {
    const billing = read(path.resolve(BACKEND_SRC, 'utils/flyer/billing/flyer-billing.ts'));
    const balance = read(path.resolve(BACKEND_SRC, '..', 'src/routes/flyer/balance.ts'));
    const admin = read(path.resolve(BACKEND_SRC, '..', 'src/routes/admin/flyer-admin.ts'));
    expect(billing.includes('`deduct:${ref.campaignId}`')).toBe(true);
    expect(billing.includes('`refund:${ref.campaignId}`')).toBe(true);
    expect(balance.includes('`subscribe:${userId}:')).toBe(true);
    expect(admin.includes('operationId: opId')).toBe(true);
  });
  it('구독 결제는 트랜잭션 안에서 자격을 다시 판정한다', () => {
    const balance = read(path.resolve(BACKEND_SRC, '..', 'src/routes/flyer/balance.ts'));
    expect(/FOR NO KEY UPDATE OF u/.test(balance)).toBe(true);
    expect(balance.includes('curAccess')).toBe(true);
  });
  it('발송 큐 적재 실패 시 보상 환불이 배선돼 있다', () => {
    const send = read(path.resolve(BACKEND_SRC, 'utils/flyer/send/flyer-send.ts'));
    expect(send.includes('refundFlyerPrepaid(')).toBe(true);
    expect(send.includes('발송 큐 적재 실패 환불')).toBe(true);
  });
});

// ────────────────────────────────────────────────────
// 3. 소비처 배선 (미배선 재발 차단)
// ────────────────────────────────────────────────────
describe('게이트 3 — 판정·검증 함수가 경계마다 배선돼 있다', () => {
  const WIRED: Array<{ fn: string; file: string }> = [
    { fn: 'resolveFlyerStoreAccess', file: 'src/middlewares/flyer-auth.ts' },
    { fn: 'resolveFlyerStoreAccess', file: 'src/routes/flyer/balance.ts' },
    { fn: 'resolveFlyerStoreAccess', file: 'src/routes/flyer/auth.ts' },
    { fn: 'resolveFlyerStoreAccess', file: 'src/utils/flyer/billing/flyer-billing.ts' },
    { fn: 'isValidStorePaymentStatus', file: 'src/routes/admin/flyer-admin.ts' },
    { fn: 'isValidCompanyPaymentStatus', file: 'src/routes/admin/flyer-admin.ts' },
    { fn: 'isFlyerBillingOpenPath', file: 'src/middlewares/flyer-auth.ts' },
    { fn: 'changeFlyerBalance', file: 'src/routes/admin/flyer-admin.ts' },
    { fn: 'changeFlyerBalance', file: 'src/routes/flyer/balance.ts' },
    { fn: 'changeFlyerBalance', file: 'src/utils/flyer/billing/flyer-billing.ts' },
  ];

  for (const w of WIRED) {
    it(`${w.fn} — ${w.file} 에 배선`, () => {
      const text = read(path.resolve(BACKEND_SRC, '..', w.file));
      expect(text.includes(`${w.fn}(`)).toBe(true);
    });
  }

  it('결제 경로 개방 목록에 balance·auth 가 있다', () => {
    expect(isFlyerBillingOpenPath('/api/flyer/balance')).toBe(true);
    expect(isFlyerBillingOpenPath('/api/flyer/auth')).toBe(true);
    expect(isFlyerBillingOpenPath('/api/flyer/campaigns')).toBe(false);
    expect(isFlyerBillingOpenPath('')).toBe(false);
  });
});

// ────────────────────────────────────────────────────
// 4. 금지 패턴
// ────────────────────────────────────────────────────
describe('게이트 4 — 금지 패턴 재발 차단', () => {
  const backendFiles = walk(BACKEND_SRC).filter(f => !f.endsWith('.test.ts'));

  it('유령 컬럼 — flyer_billing_history 쿼리에 amount·status 를 다시 쓰지 않는다', () => {
    // 파일 단위가 아니라 "그 테이블을 건드리는 SQL 문자열" 단위로 본다.
    const hits: string[] = [];
    for (const f of backendFiles) {
      const queries = (read(f).match(/`[^`]*flyer_billing_history[^`]*`/g) || [])
        .filter(q => /(FROM|INTO|UPDATE)\s+flyer_billing_history/.test(q)); // 주석 사이 구간 제외
      for (const sql of queries) {
        const stripped = sql.replace(/payment_status/g, '').replace(/total_amount/g, '');
        if (/\b(SUM|COUNT)\s*\(\s*amount\s*\)/.test(stripped) || /\bstatus\b/.test(stripped)) {
          hits.push(`${rel(f)} :: ${sql.slice(0, 60).replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('잔액 UPDATE 는 CT-F27 밖에서 하지 않는다', () => {
    const LEDGER = 'flyer-balance-ledger.ts';
    const hits = backendFiles
      .filter(f => !f.endsWith(LEDGER))
      .filter(f => /prepaid_balance\s*=\s*prepaid_balance/.test(read(f)))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("매장 상태 화면에서 'paid' 로 판정하지 않는다(청구 화면 BillingPage 는 청구서 축이라 예외)", () => {
    const files = [...walk(ADMIN_SRC), ...walk(FRONTEND_SRC)]
      .filter(f => !/BillingPage\.tsx$/.test(f))
      .filter(f => !/lib[\\/]payment-status\.ts$/.test(f));
    const codeLines = (f: string) => read(f)
      .split(/\r?\n/)
      .filter(l => !/^\s*(\/\/|\*|\/\*|\{\s*\/\*)/.test(l)); // 주석 줄 제외
    const hits = files.filter(f => codeLines(f).some(l => /['"]paid['"]/.test(l))).map(rel);
    expect(hits).toEqual([]);
  });

  it("매장 화면에 '후불' 표기가 없다(전단AI는 100% 선불)", () => {
    const hits = walk(FRONTEND_SRC).filter(f => read(f).includes('후불')).map(rel);
    expect(hits).toEqual([]);
  });

  it('원장 조회가 화면 표시 필드를 모두 돌려준다', () => {
    const ledger = read(path.resolve(BACKEND_SRC, 'utils/flyer/billing/flyer-balance-ledger.ts'));
    for (const field of ['id', 'type', 'amount', 'balance_after', 'description', 'created_at']) {
      expect(ledger.includes(field)).toBe(true);
    }
    const page = read(path.resolve(FRONTEND_SRC, 'pages/BalancePage.tsx'));
    for (const field of ['balance_after', 'description', 'created_at']) {
      expect(page.includes(field)).toBe(true);
    }
  });
});
