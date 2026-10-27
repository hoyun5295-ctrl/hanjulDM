# hanjulDM 운영 가이드

> **분리 시점:** 2026-05-12 (D152)
> **원칙:** 한줄AI(targetup) 운영과 완전 독립

## 서버 정보

| 항목 | 값 |
|------|---|
| 서버 호스트 | www.hanjul.ai (한줄AI와 같은 서버) |
| 서버 디렉토리 | /home/administrator/hanjuldm-app/ |
| 포트 | 3001 (한줄AI 3000과 분리) |
| PM2 프로세스명 | hanjuldm-api |
| Node 버전 | 24 LTS(24.22.1 · 2026-10-27 서버 실측 · 한줄로와 같은 NodeSource 패키지) |
| OS | Ubuntu (한줄AI와 동일) |

## 빌드·배포 명령

### 로컬 (Windows PowerShell)

```powershell
# 분리 시점에 만들 hdm-push PowerShell 함수
# (한줄AI의 tp-push와 완전 독립)
hdm-push
```

### 서버 (Ubuntu bash)

```bash
# atomic safe-build (옛 dist 유지 + 빌드 실패 시 안전)
cd /home/administrator/hanjuldm-app/packages/backend
npm run build:safe

# PM2 재시작
pm2 restart hanjuldm-api

# 로그 확인
pm2 logs hanjuldm-api --lines 100
```

### 의존성 설치 · 렌더 크롬 · 로그인 제한 (2026-10-27)

- npm 11(Node 24)은 의존성 설치 스크립트를 기본으로 막는다. 허용 목록 = `packages/backend/package.json` 의 `allowScripts`(puppeteer@25.16.0 만 · 크롬 내려받기). 판을 올리면 목록의 판도 같이 바꾼다.
- 전단 PDF · OG 이미지 크롬은 샌드박스를 켠 채 뜬다(`utils/flyer/product/render-browser.ts`). 크롬 = `/opt/hanjul-chrome/<판>/chrome-linux64/chrome`(root 소유 · AppArmor userns 프로필이 이 경로에만). 설치 = 한줄로 저장소 `scripts/install-render-chrome.sh`(root · 한줄로 운영 가이드 ⑧). 한줄로와 hanjulDM 의 puppeteer 판이 같으면 같은 크롬을 쓴다.
- puppeteer 판을 올리면 그 판이 기대하는 크롬을 /opt 에 먼저 설치한다. 없으면 /opt/hanjul-chrome/current 로 뜨고, 그것도 없거나 샌드박스가 안 뜨면 PDF · OG 생성이 실패한다(샌드박스 없이 띄우지 않는다).
- 로그인 · 비밀번호 확인 5곳 = 같은 IP 기준 처리 중 요청 + 1분 안 실패가 10을 넘으면 429(`middlewares/login-limiter.ts` · 들어올 때 세고 성공하면 뺌 · 몰아 보내는 추측도 10건에서 막음 · 메모리 저장소 · pm2 fork 1개 전제).

## 인프라 공유 영역 (인스턴스 같음, 코드 독립)

| 인프라 | 한줄AI 영역 | hanjulDM 영역 |
|--------|-----------|------------|
| PostgreSQL | 한줄AI 테이블 | `flyer_*` 테이블만 |
| QTmsg MySQL | 한줄AI 캠페인 | hanjulDM 캠페인만 (company_id 기반 라인그룹) |
| 카카오 IMC | 한줄AI 발신프로필 | hanjulDM 발신프로필 (같은 API 키) |
| TossPayments | 한줄AI 결제 | hanjulDM 결제 (같은 PG 키) |

## nginx 도메인 분기

| 도메인 | 백엔드 |
|--------|--------|
| hanjul-flyer.kr / hanjul-flyer.com / hanjul-flyer.co.kr | 127.0.0.1:3001 (hanjulDM) |
| admin.hanjuldm.kr / sys.hanjuldm.kr | 127.0.0.1:3001 (hanjulDM) |
| hanjul.ai / app.hanjul.ai / sys.hanjullo.com | 127.0.0.1:3000 (한줄AI, 변동 없음) |

## monitor-dist cron (1분 주기)

```bash
# /etc/crontab 또는 crontab -e
*/1 * * * * /home/administrator/hanjuldm-app/scripts/monitor-dist.sh
```

hanjulDM dist 부재 자동 감지 + 자동 재빌드 + pm2 restart.
한줄AI dist는 절대 건드리지 않음.

## 로그 위치

| 로그 | 경로 |
|------|------|
| PM2 stdout | /home/administrator/hanjuldm-app/logs/hanjuldm-api-out.log |
| PM2 stderr | /home/administrator/hanjuldm-app/logs/hanjuldm-api-error.log |
| monitor-dist | /home/administrator/hanjuldm-app/logs/monitor-dist.log |
| nginx access | /var/log/nginx/access.log (hanjul-flyer.kr 영역 별도) |
| nginx error | /var/log/nginx/error.log |

## 환경변수 (.env)

`.env.example` 참조. 핵심:

- `PORT=3001`
- `DATABASE_URL` (한줄AI와 같은 PG 인스턴스)
- `QTMSG_DB_*` (한줄AI와 같은 MySQL 인스턴스)
- `IMC_API_KEY` (한줄AI와 같은 API 키)
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NAVER_CLIENT_ID/SECRET`
- `JWT_SECRET` (한줄AI와 다른 값 권장)
- `CORS_ORIGIN` (hanjul-flyer.kr + admin.hanjuldm.kr만)

## 분리 시 한줄AI 본진에서 제거된 항목 (참고)

- `app.ts`: flyer 관련 30+ 라인
- `routes/admin/flyer-admin.ts` 삭제
- `routes/admin/switch-service.ts` 삭제
- `middlewares/flyer-auth.ts` 삭제
- `middlewares/super-service-guard.ts` 삭제
- `frontend/src/pages/FlyerAdminDashboard.tsx` 삭제

## 위험·금지 사항

- ★ 한줄AI 본진 코드 import 절대 X (hanjulDM_isolation)
- ★ 같은 인스턴스라도 `flyer_*` 외 테이블 접근 X
- ★ `tp-push` 명령어 안내 X (한줄AI 전용)
- ★ sudo/git/SSH 직접 실행 X (CLAUDE.md no_system_modification)
