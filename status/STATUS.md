# hanjulDM 프로젝트 현황

> **업데이트:** 2026-05-12 (D152)
> **상태:** 분리 진행 중 (D153 진입 직전)

## 현재 단계 (CURRENT_TASK)

**Step 1~8 분리 완전 종결 (D152, 2026-05-12)** — hanjulDM 폴더 골격 + 140+ 파일 복사 + 본진 의존 15건 복제 + short-urls.ts DM Builder 제거 + 신규 app.ts + 인프라 12건 + hanjulDM 빌드 CLEAN (dist 288 files) + 한줄AI app.ts flyer 라인 제거 + 한줄AI flyer 파일 6건 삭제 + 한줄AI frontend FlyerAdmin/ServiceSwitcher 제거. 모두 tsc 0 errors.

**한줄AI 영향 0건 보장:** 한줄AI tsc 0 errors. 한줄AI 작업이 hanjulDM에, hanjulDM 작업이 한줄AI에 영향 0건.

**남은 작업 (Harold 직접):**
1. **Step 9-A (로컬)**: hanjulDM/ git init + 첫 commit + GitHub 원격 레포 push
2. **Step 9-B (로컬)**: PowerShell profile에 `hdm-push` 함수 추가 (tp-push 패턴 미러: hanjulDM 폴더에서 git add/commit/push + ssh 서버에 git pull + npm install --include=dev + npm run build:safe + pm2 restart hanjuldm-api)
3. **Step 9-C (서버)**: `/home/administrator/hanjuldm-app/` 디렉토리 생성 + git clone + `.env` 작성 + npm install + first safe-build + pm2 start ecosystem.config.js
4. **Step 9-D (서버)**: `/etc/nginx/sites-enabled/hanjuldm` symlink + Let's Encrypt 인증서 발급 (`admin.hanjuldm.kr`) + nginx reload
5. **Step 9-E (서버)**: crontab에 hanjulDM monitor-dist.sh 등록
6. **Step 9-F (운영 검증)**: hanjul-flyer.kr 접속 + 로그인 + 매장 사장님 화면 동작 확인 + 발송 1건 테스트
7. **한줄AI 검증**: tp-push로 한줄AI 빌드 + 배포 → sys.hanjullo.com 슈퍼관리자 정상 동작 + 67사 무료체험 funnel 정상 확인
8. **PHASE 0 트랙 A 진입 (D153~)**: Claude Design URL 페이지 퀄리티 작업 시작

## 분리 완료 매트릭스 (Step 1~8)

| 단계 | 결과 |
|------|------|
| Step 1 폴더 골격 13개 | OK |
| Step 2 백엔드/프론트/POS 140+ 파일 복사 | OK |
| Step 3 본진 의존 15건 복제 | OK |
| Step 4 short-urls DM Builder 제거 | OK |
| Step 5 hanjulDM 신규 app.ts | OK |
| Step 6 인프라 12건 | OK |
| Step 7-1 hanjulDM tsc --noEmit | 0 errors |
| Step 7-2 hanjulDM dist 빌드 | 288 files, app.js 8432 bytes |
| Step 8-1 한줄AI app.ts flyer 제거 | 0 errors |
| Step 8-2 한줄AI flyer 파일 6건 삭제 | 0 errors |
| Step 8-3 한줄AI frontend FlyerAdmin+ServiceSwitcher 제거 | 0 errors |

## 분리 완료 매트릭스

| 영역 | 한줄AI (그대로) | hanjulDM (분리) |
|------|-------------|---------------|
| 폴더 | C:\Users\ceo\projects\targetup | C:\Users\ceo\projects\hanjulDM |
| 백엔드 포트 | 3000 | 3001 |
| PM2 프로세스명 | targetup-api | hanjuldm-api |
| 빌드 명령 | npm run build:safe (targetup/.../scripts/safe-build.sh) | npm run build:safe (hanjulDM/.../scripts/safe-build.sh) |
| 배포 함수 | tp-push | hdm-push (신규) |
| 도메인 | hanjul.ai, sys.hanjullo.com | hanjul-flyer.kr, admin.hanjuldm.kr |
| nginx config | /etc/nginx/sites-enabled/targetup | /etc/nginx/sites-enabled/hanjuldm |
| 서버 디렉토리 | /home/administrator/targetup-app/ | /home/administrator/hanjuldm-app/ |

## 인프라 공유 (코드는 독립, 인스턴스는 같음)

- PostgreSQL: 같은 인스턴스, hanjulDM은 `flyer_*` 테이블만 접근
- QTmsg MySQL: 같은 11라인 SMSQ_SEND, hanjulDM 회사 캠페인만 INSERT
- 카카오 IMC: 같은 API 키, hanjulDM 회사 발신프로필만 호출
- 결제 PG (TossPayments): 같은 키, hanjulDM 회사 결제만

## D-시리즈 매핑 (상세는 status/hanjul-flyer-revamp/04_master_plan.md)

- **D153 (월)** 분리 마무리 + PHASE 0 트랙 A 진입
- **D154 (화)** hanjulDM 빌드·실행 검증 + 한줄AI 본진 정리 + 배포 + PHASE 0 트랙 A 계속
- **D155 (수)** PHASE 0 트랙 B 진입 (Claude Design 동적 생성)
- **D156 (목)** 6매체 통합 디자인 토큰 + 직원 3인 + 마트 사장 1인 블라인드 검증
- **D157 (금)** PHASE 0 완료 정의 통과 확인 + PHASE 1 진입 준비

## PHASE 0 정의 (D153~D157)

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
6. 분리 (D153~D154 완료)
7. 정부 스마트상점 결제 모듈
