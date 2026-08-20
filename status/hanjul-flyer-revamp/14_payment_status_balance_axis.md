# 14. 결제 상태·잔액 축 정정 (2026-08-20)

> **이 문서가 소유하는 것** = 이 축의 접수 경위·실측 근거·설계·구현 범위·잔여·⛔.
> 값 축의 코드 SoT = `packages/backend/src/utils/flyer/billing/flyer-payment-status.ts` (CT-F26).
> 여기 적힌 것을 STATUS.md에 복사하지 않는다(STATUS는 경로만).

---

## §1 접수 (Harold, 2026-08-20)

슈퍼관리자 화면에는 매장 잔액 ₩1,050,000이 보이는데, 같은 매장의 사장님 화면(충전관리)에는 잔액이 "-"로 뜨고
"전단AI 이용료 결제가 필요합니다" 배너가 떠 있었다. 요금제 캡션은 "후불 요금제"였다.
지시 = 결제 상태 관련 전수 점검 + 한 번에 정정.

---

## §2 실측 (psql 4회 — 추측 0)

| 확인 | 결과 |
|---|---|
| `flyer_billing_history` 컬럼 | billing_month, company_id, created_at, id, monthly_fee, paid_at, payment_status, sms_overage, total_amount — **amount·status·sms_count류 없음** |
| 대시보드가 참조하는 나머지 6개 테이블 | 참조 컬럼 전부 존재 (실패 쿼리는 청구 1개뿐) |
| 매장·총판 상태 | 매장 `suspended` / 총판 `suspended`, 매장 만료일 2026-12-30(미래), 잔액 1,050,000 |
| payment_status CHECK 제약 | **0건** (값이 자유 문자열 — 오타도 저장된다) |
| `flyer_*` 테이블 31개 | 잔액 원장 성격 테이블 부재. `flyer_plans`는 코드 소비 0건(죽은 테이블) |

---

## §3 원인 (확정)

### 3-1. 슈퍼관리자 통계 카드 7개 전부 "-"
`flyer-admin.ts` 대시보드의 청구 쿼리가 없는 컬럼(`amount`, `status`)을 읽어 예외 → `Promise.all` 전체 거부 → 500.
카드 1개가 아니라 7개가 동시에 빈 것이 지문이었다. 프론트는 catch를 무음 처리해 이유가 화면에 없었다.

### 3-2. 매장 화면 잔액 "-" + "후불 요금제" + 결제 필요 배너
총판·매장이 모두 `suspended` → 미들웨어가 `/api/flyer/*` 전 라우트(13개) 403.
프론트 `apiFetch`는 401만 처리해 403은 무음 → `balance` 상태가 null →
잔액 "-" · 삼항 else가 "후불 요금제" · 충전 요청 버튼 소멸 · 배너 초기값 유지.
**후불은 이 서비스에 존재하지 않는다.** 실패를 반대말로 그린 것이었다(`SettingsPage`의 과금 방식 표기도 같은 형태로 항상 "후불"이었다).

### 3-3. 값 축 분열 (뿌리)
| 위치 | 쓰던 값 |
|---|---|
| 매장 수정 모달 | pending / **paid** / suspended |
| 매장 목록 뱃지·필터 | paid 기준 |
| 총판 목록 뱃지 | paid 비교 (총판 축엔 없는 값) |
| 이용료 결제 쓰기 | active |
| 매장 화면 판정 | active만 인정 |
| 발송 게이트 | pending·suspended만 차단 → **paid 통과** |

관리자가 고를 수 있는 값에 `active`가 없어 **화면만으로는 매장을 되살릴 수 없었고**,
`paid` + 만료일 공란이면 이용료 없이 발송이 열리는 구멍이 있었다.

### 3-4. 잔액이 움직여도 기록이 0건
충전·차감·이용료 결제가 `prepaid_balance`만 UPDATE. 원장 테이블 없음, 감사로그 `balance_charge` 호출부 0.
`/transactions`는 총판 단위 청구 이력을 매장 거래 내역인 척 돌려줘 필드가 어긋났다 → 화면은 영구 "거래 내역이 없습니다".
1,050,000원이 어떻게 들어왔는지 시스템 안에 근거가 없었다.

### 3-5. 로그인 응답 컬럼 충돌
`SELECT u.*, c.payment_status ...` — 같은 이름 뒤 값이 이겨 매장 자신의 상태가 사라졌다.

---

## §4 설계 (Harold 승인 2026-08-20)

값 축 하나로 통일. `paid`는 청구서 전용.

| 대상 | 확정 값 |
|---|---|
| `flyer_users` | pending / active / suspended |
| `flyer_companies` | active / expired / suspended |
| `flyer_billing_history` | pending / paid / failed |

1. **CT-F26 `flyer-payment-status.ts`** — 값 축 + `resolveFlyerStoreAccess` 판정 + 만료 판정 + 개방 경로. 판정 인라인 금지.
   화이트리스트 방식이라 축 밖 값은 통과가 아니라 차단이다.
2. **개방 경로** — 정지·총판 차단은 전 경로 차단, 미결제·기간만료는 `/api/flyer/balance`·`/api/flyer/auth`만 통과.
   결제 엔드포인트를 차단 뒤에 두면 만료 매장이 스스로 결제할 수 없다(잠긴 문 안의 열쇠).
3. **발송 게이트 역전** — `canFlyerStoreSend`가 CT 판정을 쓴다. active가 아니면 차단.
4. **CT-F27 `flyer-balance-ledger.ts`** — `prepaid_balance` 이동의 유일 경로. 잔액 UPDATE + 원장 INSERT를 한 트랜잭션에서.
5. **관리자 화면** — 3값 선택 + 서버 화이트리스트 검증(400) + `active` 지정 시 만료일 필수.
6. **유령 컬럼 정정** + `allSettled` + 실패 지표를 화면에 표기.
7. **매장 화면** — 후불 삼항 제거(선불 고정), 실패와 0 구분, 판정은 서버 `service_active` 사용, 403 사유 안내 배너.

---

## §5 구현 (코드 완료 · 2026-08-20)

| 파일 | 변경 |
|---|---|
| `utils/flyer/billing/flyer-payment-status.ts` | 신규 CT-F26 |
| `utils/flyer/billing/flyer-balance-ledger.ts` | 신규 CT-F27 (`withFlyerTx`·`changeFlyerBalance`·`queryFlyerBalanceTransactions`) |
| `utils/flyer/billing/flyer-billing.ts` | 게이트 2종 CT 판정 위임 · 차감/환불이 원장 경유 |
| `utils/flyer/send/flyer-send.ts` | 차감 시 campaignId 전달(원장 연결) |
| `middlewares/flyer-auth.ts` | CT 판정 + 403에 `code` + 개방 경로 + 컬럼 별칭 분리 |
| `routes/flyer/balance.ts` | `service_active` 응답 · 거래 내역을 원장으로 · 요약을 원장 집계로 · 결제 트랜잭션 |
| `routes/flyer/auth.ts` | 컬럼 충돌 해소 + 매장 상태 별도 축으로 응답 |
| `routes/admin/flyer-admin.ts` | 대시보드 컬럼 정정 + `allSettled` · 상태 값 검증 · 충전 2경로 원장 경유 + 감사로그 |
| `admin-frontend` 4화면 + `lib/payment-status.ts` | 값 축·라벨 통일, 청구 화면 컬럼 정정, 집계 실패 표기 |
| `frontend` `App.tsx`·`BalancePage.tsx`·`SettingsPage.tsx` | 403 사유 배너, 후불 표기 제거, 실패/0 구분, 잔액 컬럼 추가 |
| `utils/flyer/payment-axis-gates.test.ts` | 신규 게이트 27건 |

검증: backend tsc 0 · frontend/admin-frontend build 성공 · vitest 56건 통과(기존 29 + 신규 27).

---

## §6 DDL (배포 **전**에 실행 — 추가만 하므로 기존 코드 영향 0)

실행 전 값 확인 완료(2026-08-20): 매장·총판 각 1행 `suspended`, 청구 이력 0행, 축 밖 값·NULL 0건 → CHECK 포함 가능.

```sql
CREATE TABLE IF NOT EXISTS flyer_balance_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES flyer_users(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  operation_id  TEXT NOT NULL,             -- 멱등 키. 같은 키 = 같은 돈 이동 1회
  type          VARCHAR(20) NOT NULL
                CHECK (type IN ('admin_charge','deposit_charge','subscribe','deduct','refund')),
  amount        INTEGER NOT NULL,          -- 부호 포함 (+충전 / -차감)
  balance_after INTEGER NOT NULL,
  description   TEXT,
  ref_type      VARCHAR(30),               -- 'campaign' 등
  ref_id        UUID,
  created_by    VARCHAR(100),              -- super_admin id / 'store' / 'system'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT flyer_balance_tx_op_unique UNIQUE (user_id, operation_id)
);

CREATE INDEX IF NOT EXISTS idx_flyer_balance_tx_user
  ON flyer_balance_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flyer_balance_tx_company
  ON flyer_balance_transactions (company_id, created_at DESC);

ALTER TABLE flyer_users
  ADD CONSTRAINT flyer_users_payment_status_check
  CHECK (payment_status IN ('pending','active','suspended'));

ALTER TABLE flyer_companies
  ADD CONSTRAINT flyer_companies_payment_status_check
  CHECK (payment_status IN ('active','expired','suspended'));

ALTER TABLE flyer_billing_history
  ADD CONSTRAINT flyer_billing_history_payment_status_check
  CHECK (payment_status IN ('pending','paid','failed'));
```

**순서 = DDL 먼저, 배포 나중.** 신규 테이블은 아무 코드도 읽지 않아 먼저 만들어도 영향이 0이고,
반대로 코드가 먼저 나가면 원장 INSERT가 걸려 충전·결제·발송 차감이 503(DB_MIGRATION_PENDING)으로 막힌다.
CHECK 3개는 값 축 밖 저장을 DB가 직접 거부하게 만드는 이중 방어다(코드 화이트리스트가 1차).

---

## §6-1 Codex 적대 리뷰 1R (2026-08-20) — high 4 · medium 2 전부 수용

| 등급 | 지적 | 처방 |
|---|---|---|
| high | 총판 축 fail-open — NULL·오타·옛 `paid`가 통과해 그 총판 전 매장이 열림 | CT-F26에 `COMPANY_STATUS_UNKNOWN` 추가, 총판도 화이트리스트·결제 경로까지 차단 |
| high | 잔액 이동에 멱등 키 부재 — 더블클릭·재시도로 중복 차감/충전 | `operationId` 필수화 + 행 FOR UPDATE 잠금 후 재시도 판별 + DDL `UNIQUE (user_id, operation_id)` |
| high | 구독 자격 검사가 트랜잭션 밖 — 조회 후 정지된 매장이 결제로 정지를 덮어씀 | 트랜잭션 안에서 총판·매장 잠그고 재판정·요금 재조회 후 차감 |
| high | 차감 후 큐 적재 실패 시 돈만 빠짐 | 큐 적재를 try로 감싸 실패 시 보상 환불(멱등) + 캠페인 취소. **전면 outbox는 별건** |
| medium | 신규 결제가 30일이 아니라 31일 열림(포함 만료일 + 30일) | 신규·만료 = 오늘 + 29일, 연장 = 만료일 + 30일 |
| medium | 만료 판정은 앱 로컬시각, 갱신은 DB CURRENT_DATE(UTC) — 자정~09시 어긋남 | 양쪽을 KST 날짜 키 하나로. `businessToday()` ↔ `(NOW() AT TIME ZONE 'Asia/Seoul')::date` |

수용 근거 = 전부 이번 변경이 만든(또는 이번 변경이 악화시킨) 결함. 게이트 테스트 65건으로 고정.

## §7 잔여

- DDL 실행 + 배포
- 실측: 관리자 충전 1건 → 매장 거래 내역 표시 → 이용료 결제 → 이용중 전환 → 발송 차감 1건이 원장에 남는지
- **현재 매장/총판이 `suspended`** — 배포 후 슈퍼관리자 화면에서 이용중(총판은 active)으로 되돌려야 잠금이 풀린다

---

## §8 ⛔ 이 축에서 확정된 함정

- **같은 뜻을 테이블마다 다른 값으로 부르지 않는다.** `paid`는 청구서 값이다. 매장 상태에 쓰면 어떤 게이트도 못 알아본다.
- **판정을 프론트에서 다시 하지 않는다.** 서버가 `service_active`를 내리고 화면은 그것만 쓴다.
- **차단 뒤에 결제 경로를 두지 않는다.** 스스로 풀 수 있는 차단은 결제·인증만 열어둔다.
- **실패를 정상값으로 그리지 않는다.** 삼항의 else가 "후불"이면 장애가 정상 라벨로 위장된다. 실패는 실패로 쓴다.
- **잔액을 기록 없이 움직이지 않는다.** UPDATE 단독 금지 — CT-F27을 통한다.
- **DB에 CHECK가 없으면 코드 화이트리스트가 유일한 방어다.** 조회로 통과한 값이 유효한 값이라는 뜻은 아니다.
- **0건은 안전의 증거가 아니다** — 청구 이력이 비어 있어 유령 컬럼이 오래 안 드러났다.
