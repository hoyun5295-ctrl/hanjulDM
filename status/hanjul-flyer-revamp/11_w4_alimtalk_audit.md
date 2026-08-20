# 11 슈퍼버전업 검수 — 무기 4: 알림톡 축 (W4)

> **작성일:** 2026-08-20 · 비토 정밀 검수 1차 (소스 실측 — 추측 0)
> **배경:** 실사용 실측 = 회사 2·고객 0·캠페인 0·에이전트 1 (2026-08-20 psql) — 하위호환 제약 없음.
> **범위:** 알림톡 축 전체 — 라우트 2본(flyer/alimtalk·admin/alimtalk) · CT 4본(alimtalk-api/jobs/result-map/webhook-handler) · 발송 경로(flyer-send ALIMTALK 분기) · 차감(flyer-billing) · 프론트(AlimtalkPage·SendPage·ResultsPage·AlimtalkManagementPage).

---

## 1. 되어 있는 것 (예상보다 충실 — D157~D158 + 이후 무커밋 분량 포함)

| 축 | 상태 | 근거 |
|---|---|---|
| 매장측 조회 | 발신프로필(APPROVED만)·템플릿(APPROVED만)·신청 이력·카테고리 4종 | `routes/flyer/alimtalk.ts` |
| 대행 등록 | 슈퍼관리자 대행 정책(사장님 직접 등록 X) + admin 라우트 + 관리 화면 | `routes/admin/alimtalk.ts` · `AlimtalkManagementPage` |
| 발송 경로 | `/send` ALIMTALK 분기 → `flyer-send.ts`(templateCode+profileId 필수 검증, kakao_* 컬럼 기록) → `insertAlimtalkQueue`(msg_type='K'·k_template_code·k_button_json) | `flyer-send.ts:88~290` |
| 변수 치환 | `#{변수명}` 치환 CT + 미매칭 빈 문자열 안전망 | `flyer-message.ts` |
| 스케줄러 3종 | 카테고리 일일 sync · 검수중 템플릿 5분 폴링(웹훅 누락 fallback) · 프로필 상태 1시간 폴링 — app.ts:183 기동 배선 확인 | `alimtalk-jobs.ts` |
| 웹훅 수신 | HMAC-SHA256 + IP 화이트리스트 + `flyer_kakao_webhook_events` idempotent 적재 | `alimtalk-webhook-handler.ts` |
| 검수 통지 | 템플릿 검수 결과 문자 통지 조립·발송 배선 | `alimtalk-jobs.ts:392` |
| 선불 차감 | 잔액 조건부 atomic UPDATE | `flyer-billing.ts:169` |

## 2. 빈틈 (심각도순 — 소스 근거 명시)

- **A (치명) 발송 결과 폐회로 부재 — 문자·알림톡 공통.** 두 구멍이 겹친다:
  ① 웹훅 핸들러가 이벤트 적재까지만 — `flyer_campaigns` 등 발송 매핑 실 UPDATE는 "Phase 2 착수 예정"으로 멈춤(`alimtalk-webhook-handler.ts` 머리 주석 "담당 범위 한계").
  ② `stats.ts:59` TODO — "MySQL 큐 결과 조회는 Phase 2에서 구현 예정". ResultsPage는 캠페인 행 정보만 본다.
  ⇒ **발송하고 나면 성공·실패를 어디서도 못 본다.** 슈퍼버전업 W4의 1순위. 처방 방향 = 한줄로 LIVE/LOG 게이트웨이 패턴 재구현(코드 import 금지 — 패턴만) + 웹훅 매핑 UPDATE 완성. messageKey 생성 규칙(CR/DS/TS/AC)은 이미 핸들러가 소유.
- **B (높음) 알림톡 실패 시 SMS 대체발송 부재.** 카카오 미가입·차단 실패가 구조적으로 존재하는 채널인데 대체 경로가 없다 — 도달 구멍 + 사장님 체감 품질 직결. A의 결과 축이 서야 실패 판정이 가능하므로 A 뒤에 붙는다.
- **C (높음) 알림톡 단가 축 부재.** `flyer-billing.ts:163` — `ALIMTALK: Number(u.sms_unit_price || 9)`. `flyer_users`에 alimtalk_unit_price 컬럼 자체가 없다(D158 커밋에 "임시, Phase 1+ 별건" 명시된 그대로 잔존). 알림톡 원가는 SMS와 다르다 — 과금 정확성 결함.
- **D (구조 · 실측 필요) IMC 키 공유 구조의 웹훅 수신처.** 한줄로와 같은 IMC 키를 공유하는데, IMC 웹훅 등록 URL이 계정당 하나라면 이벤트는 본진 도메인으로만 간다 — 그 경우 hanjulDM 웹훅 라우트는 영구 미수신이고 폴링 fallback만 남는다. 같은 키 아래 프로필·템플릿 네임스페이스 충돌 여부도 함께 확인 대상. **IMC 콘솔 실측 전에는 단정하지 않는다.**
- **E (중간 · 실측 필요) 서버 IMC env 설정 여부.** `alimtalk-jobs.ts` — env 미설정이면 스케줄러 전부 no-op(검수 폴링도 안 돎). hanjuldm-app/.env 실측 필요.
- **F (중간) 템플릿 신청 접수 창구 없음.** 매장 화면은 조회 전용 + "운영팀에 알려달라" 안내 문구뿐(`AlimtalkPage.tsx:99~122`) — 신청이 전화·카톡 수기 접수다. 매장이 늘면 운영 부하 축. 처방 방향 = 신청 폼(채널 ID·관리자 폰) + 관리 메뉴 접수함.
- **G (낮음) 검수 진행 상황 가시성.** 매장측 이력 화면은 있으나 REJECTED 사유 노출·재신청 흐름은 확인 필요(2차 검수에서 화면 실측).

## 3. Harold 실측 필요 2건

1. 서버 IMC env 존재 여부 (값 노출 없이 개수만): `grep -c "^IMC_" /home/administrator/hanjuldm-app/.env`
2. IMC 콘솔 — 웹훅 등록 URL이 어느 도메인인지(본진 vs hanjul-flyer.kr), 계정당 웹훅 URL 개수 제약.

## 4. W4 마감 순서 제안 (구현은 승인 후)

A 결과 폐회로(웹훅 매핑 + MySQL 결과 조회 + ResultsPage) → C 단가 컬럼(DDL 1) → B 대체발송 → F 신청 창구 → G 화면 마감. D·E 실측 결과가 A의 설계(웹훅 주도 vs 폴링 주도)를 가른다.
