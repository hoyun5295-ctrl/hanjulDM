# hanjulDM 프로젝트 현황

> **업데이트:** 2026-05-13 (D153)
> **상태:** ★ 배포 인프라 100% 종결. PHASE 0 진입 준비.

## 현재 단계 (CURRENT_TASK)

**D153 종결 (2026-05-13)** — hanjulDM 분리 코드 + 배포 인프라 + 슈퍼관리자 구축 100% 완료. 외부 도메인 `https://sys.hanjul-flyer.co.kr` 슈퍼관리자 LoginPage 정상 + ceo/qwer1234 → TOTP enrollment 흐름 정상 검증.

**D152 + D153 누적 매트릭스**:

| 단계 | 결과 |
|------|------|
| **D152 분리 코드** | Step 1~8 (폴더 골격 + 140+ 파일 복사 + 본진 의존 15건 복제 + app.ts 신규 + 한줄AI flyer 코드 제거, tsc 0 errors 양쪽) |
| **D152 git push** | targetup commit 3dff1ec + hanjulDM GitHub Private push + 서버 git clone + .env 작성 |
| **D153 작업 #1 admin-frontend** | 17 파일 신규 골격 — D152에 src/pages/FlyerAdminDashboard.tsx 1개만 + 한줄AI 의존성 박혀 있던 미완 상태 보완. 빌드 환경 7 + entry 2 + 신규 3(App+LoginPage+Dashboard placeholder) + UI 미러 5 |
| **D153 작업 #2 슈퍼관리자** | TOTP 2FA + must_change_password. utils/totp.ts CT + middlewares/super-auth.ts + routes/flyer/super.ts + flyer_super_admins 테이블 + ceo 초기 계정 (qwer1234, must_change=TRUE) + admin-frontend LoginPage TOTP 확장 + ChangePasswordPage 신규 + App.tsx 분기 |
| **D153 한줄AI 정합** | sys.hanjullo.com 슈퍼관리자에서 전단AI 메뉴 사라짐 (targetup frontend 단독 재빌드 + nginx reload, backend 옛 dist 유지로 hanjul-flyer.kr 무중단) |
| **D153 Phase 4 webroot** | `/var/www/certbot` mkdir + 기존 hanjul-flyer nginx에 acme location + admin/sys 임시 server block |
| **D153 Phase 5 DNS** | `sys.hanjul-flyer.co.kr` A → 58.227.193.62 (Harold 콘솔, TTL 3600) |
| **D153 Phase 6 SSL** | certbot --webroot 단일 발급, `/etc/letsencrypt/live/sys.hanjul-flyer.co.kr/` (만료 2026-08-10, 자동 갱신 cron) |
| **D153 Phase 7 nginx swap** | 매장 사장님 6 도메인(.kr/.com/.co.kr × www) + 슈퍼관리자 sys.hanjul-flyer.co.kr, 다운타임 0초 graceful reload |
| **D153 CORS fix** | .env CORS_ORIGIN에 sys.hanjul-flyer.co.kr 추가 + pm2 restart |

**한줄AI 영향 0건 보장:** 한줄AI tsc 0 errors. hanjul-flyer.kr 매장 사장님 운영 무중단.

## ★ 도메인 매핑 정답 (D153 정정)

D152 인계 문서 + 04_master_plan + 신규 nginx config가 모두 `admin.hanjuldm.kr` + `sys.hanjuldm.kr` 신규 도메인 가정으로 작성됨 — 실제 `hanjuldm.kr` 도메인 **미보유**. D153에서 정정:

| 도메인 | 용도 | dist | SSL |
|--------|------|------|-----|
| hanjul-flyer.kr / www | 매장 사장님 (canonical) | packages/frontend/dist | /etc/letsencrypt/live/hanjul-flyer.com/ (SAN 6 포함) |
| hanjul-flyer.com / www | 매장 사장님 (사용자 노출 URL 유지) | 동일 | 동일 |
| hanjul-flyer.co.kr / www | 매장 사장님 (canonical redirect 또는 동일) | 동일 | 동일 |
| **sys.hanjul-flyer.co.kr** | **슈퍼관리자 (subdomain 신규)** | packages/admin-frontend/dist | /etc/letsencrypt/live/sys.hanjul-flyer.co.kr/ (신규 발급, 만료 2026-08-10) |

## 남은 작업 (D154+)

1. **Phase 8** crontab — monitor-dist.sh 1분 주기 등록
2. **Phase 9 C-1** targetup `tp-push` — D152 commit 3dff1ec backend dist 적용 (hanjul-flyer.kr nginx swap 완료 후이므로 backend pm2 restart 안전)
3. **Phase 9 C-2** sys.hanjullo.com 슈퍼관리자 + 67사 무료체험 funnel 정상 확인
4. **PHASE 0 트랙 A** 진입 (D154~) — `hanjul-flyer.kr/{code}` URL 페이지 Claude Design 통합
5. **PHASE 0 트랙 B** — AI 자동 생성 전단 Claude Design + Opus 4.7 동적
6. **PHASE 0 6매체** 통합 디자인 토큰

## 인프라 매트릭스 (코드 독립, 인스턴스 공유)

| 영역 | 한줄AI (그대로) | hanjulDM (분리 후) |
|------|-------------|------------------|
| 폴더 | C:\Users\ceo\projects\targetup | C:\Users\ceo\projects\hanjulDM |
| 백엔드 포트 | 3000 | 3001 |
| PM2 프로세스명 | targetup-backend | hanjuldm-api |
| 빌드 명령 | npm run build:safe | npm run build:safe (자체) |
| 배포 함수 | tp-push | hdm-push |
| 도메인 | hanjul.ai, sys.hanjullo.com | hanjul-flyer.kr/.com/.co.kr × www + sys.hanjul-flyer.co.kr |
| nginx config | /etc/nginx/sites-enabled/targetup | /etc/nginx/sites-enabled/hanjul-flyer |
| 서버 디렉토리 | /home/administrator/targetup-app/ | /home/administrator/hanjuldm-app/ |

## 인프라 공유 (인스턴스 같음, 영역만 격리)

- PostgreSQL: 같은 인스턴스, hanjulDM은 `flyer_*` 테이블만 접근 (신규 `flyer_super_admins` 포함)
- QTmsg MySQL: 같은 11라인 SMSQ_SEND, hanjulDM 회사 캠페인만 INSERT
- 카카오 IMC: 같은 API 키, hanjulDM 회사 발신프로필만 호출
- TossPayments: 같은 키, hanjulDM 회사 결제만

## D-시리즈 매핑 (PHASE 0 진입 준비)

- **D153 (수)** ✓ 분리 100% 종결 + 슈퍼관리자 구축
- **D154 (목)** Phase 9 C-1 tp-push + C-2 검증 + PHASE 0 트랙 A 진입
- **D155 (금)** PHASE 0 트랙 B (Claude Design 동적 생성)
- **D156 (토)** 6매체 통합 디자인 토큰 + 직원 3인 + 마트 사장 1인 블라인드 검증
- **D157 (일)** PHASE 0 완료 정의 통과 확인 + PHASE 1 진입 준비

## PHASE 0 정의 (D154~D157)

- 트랙 A: hanjul-flyer.kr/{code} URL 페이지 퀄리티 (Claude Design 통합 시스템)
- 트랙 B: AI 자동 생성 전단 퀄리티 (Claude Design + Opus 4.7 동적)
- 6매체 동일 디자인 토큰 (디지털·인쇄·POP·MMS·알림톡·랜딩)
- 완료 정의: Harold 4.0/5.0 + 비토 4.0/5.0 + 직원 3인 평균 4.0/5.0 + 마트 사장 1인 "외주보다 낫다" + 마트 고객 5인 중 4인 "보고 싶다"

## PHASE 1 — 7대 무기 (D158+)

1. POS Agent 직접연결 (협조 X) + Retail Brain
2. CT-F10 RFM 실구현
3. One-Input + Campaign Autopilot + 한줄로 본진 GTM
4. ROI Closed Loop (POS 매출 귀속)
5. Outside DB Local Ads (TargetUP·POPPON)
6. 분리 ✓ (D152~D153 완료)
7. 정부 스마트상점 결제 모듈
