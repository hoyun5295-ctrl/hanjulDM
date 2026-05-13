# hanjulDM LESSONS_LEARNED

> **분리 시점:** 2026-05-12 (D152)
> **마지막 업데이트:** 2026-05-13 (D153 배포 종결)

## 1. 분리 자체 (D152)

### 1-1. 분리 원칙 — "코드는 복제, 인스턴스는 공유"

한줄AI(targetup)와 hanjulDM은 코드는 완전 독립, 인프라(DB·QTmsg·IMC·PG)는 같은 인스턴스 공유.
같은 인스턴스라도 두 코드는 각자 자기 영역만 호출 (flyer_* vs 한줄AI 테이블).

### 1-2. sync 금지

한줄AI에 버그 fix가 들어가도 hanjulDM에 자동 반영 0건.
1년·3년 후 두 코드 완전 독립 진화. 이게 분리의 본질이자 가치.

### 1-3. 한줄AI 본진에 영향 0건 보장

- hanjulDM 작업 시 절대 한줄AI(targetup/) 코드 수정 X
- hdm-push 실행 시 한줄AI dist·프로세스·로그 흔들림 0건
- 같은 인스턴스 DB라도 flyer_* 테이블만 접근

## 2. PowerShell Copy-Item 함정 (D152 분리 시점)

`Copy-Item -Path "...\*" -Destination "..." -Recurse` 사용 시 일부 하위 폴더가 leaf로 인식되어
"Container cannot be copied onto existing leaf item" 에러 발생.

**대책:** robocopy 사용
```powershell
robocopy "$src" "$dst" /E /XD node_modules dist .git /NFL /NDL /NJH /NJS
```

## 3. ★ 도메인 매핑 정정 — hanjuldm.kr 미보유 (D153 핵심 교훈)

### 3-1. 사고

D152 인계 문서 + 04_master_plan §2-1 + 신규 nginx config + CLAUDE.md L123 모두 `admin.hanjuldm.kr` + `sys.hanjuldm.kr` 신규 도메인 박혀 있음. 실제 `hanjuldm.kr` 도메인 **미보유** (Harold 명시 "프로젝트명일 뿐").

D153 배포 시 Phase 5 DNS 작업에서 발견 — `admin.hanjuldm.kr` A 레코드 추가하려는데 `hanjuldm.kr` 자체 도메인 부재.

### 3-2. 정답 1개 (D153 정정)

기존 3 도메인 활용 + 슈퍼관리자 subdomain 신규:
- `hanjul-flyer.kr` / www / `hanjul-flyer.com` / www / `hanjul-flyer.co.kr` / www — 매장 사장님 6 도메인 통합
- `sys.hanjul-flyer.co.kr` — 슈퍼관리자 subdomain 신규 (Harold DNS 콘솔 A 레코드 추가 + certbot --webroot 단일 발급)

### 3-3. 이유

- `hanjul-flyer.com`이 이미 매장 사장님 서비스 노출 URL — 슈퍼관리자로 변경 시 사용자 혼동
- `hanjul-flyer.co.kr` 단독 슈퍼관리자도 사용자 직접 입력 가능성 (드물지만 노출)
- subdomain `sys.*` 추가가 명확한 분리 + 사용자 노출 0

### 3-4. 차후 작업 의무

- 04_master_plan + CLAUDE.md + STATUS.md의 `admin.hanjuldm.kr` / `sys.hanjuldm.kr` 표기 모두 정정 의무 (D153 일부 정합, 나머지 후속 정합)

## 4. ★ admin-frontend 골격 미완 (D153 핵심 사고)

### 4-1. 사고

D152 분리 매트릭스 Step 7-2 "dist 빌드 288 files / app.js 8432 bytes"는 **backend 한정**. admin-frontend는 `src/pages/FlyerAdminDashboard.tsx` 1개 파일만 옮겨진 상태:
- `package.json` / `vite.config.ts` / `tsconfig` 3종 / `index.html` / `eslint.config.js` 모두 누락
- `main.tsx` / `App.tsx` / `Router` / `Login` / `AuthContext` / `ApiClient` 모두 누락
- D152 매트릭스 Step 7-2가 backend만 검증 → frontend 빌드 누락 발견 0

또한 이전된 `FlyerAdminDashboard.tsx`는 한줄AI 본진(packages/frontend) 코드 그대로 — `react-router-dom` + `useAuthStore` (zustand) + `ServiceSwitcher` 등 hanjulDM 컨텍스트와 불일치 의존성 박혀 있음.

### 4-2. 정답

D152 매트릭스의 "신규 골격" 부분이 미완. D153 작업 #1에서 17 파일 신규 작성:
- 빌드 환경 7 (frontend 미러)
- entry 2 (main.tsx + index.css 미러)
- 신규 3 (App.tsx + LoginPage TOTP 확장 + FlyerAdminDashboard 단순 placeholder — 한줄AI 의존성 폐기 + hanjulDM admin stack만)
- UI 미러 5 (ui.tsx + AlertModal + useSessionTimeout + SessionTimer + SessionTimeoutModal)

### 4-3. 교훈

분리 매트릭스 Step 검증 시 **모든 패키지 dist 빌드 결과** 명시 의무 (backend + frontend + admin-frontend + pos-agent). "dist 288 files" 같은 단일 수치만으로는 미완 감지 안 됨.

## 5. ★ nginx config 사고 4건 (D153 Phase 7)

### 5-1. `$proxy_scheme` 무효 변수 → `$scheme`

`proxy_set_header X-Forwarded-Proto $proxy_scheme;` ← `$proxy_scheme`는 nginx 표준 변수 아님. nginx -t 에러:
```
unknown "proxy_scheme" variable
```

**정답:** `$scheme` (표준 변수).

### 5-2. `listen 443 ssl http2` conflict

`/etc/nginx/sites-enabled/targetup`(한줄AI nginx) 이미 `listen 443 ssl http2` 정의 + 신규 hanjuldm 파일도 동일 → `protocol options redefined for 0.0.0.0:443` warn.

**정답:** 신규 hanjuldm config는 `listen 443 ssl` (http2 옵션 제거, targetup 파일에서 정의됨).

### 5-3. `sys.hanjuldm.kr` 임시 server block 잔존

Phase 4에서 임시 acme 응답용 server block 추가 후 D153 정정 시 `sys.hanjul-flyer.co.kr`로 sed 치환. 잘못 수정 시 잔존 위험.

**정답:** sed로 정확한 패턴 치환 + grep으로 잔존 0건 확인.

### 5-4. SSL SAN 재사용 (D153 시간 절약)

기존 `/etc/letsencrypt/live/hanjul-flyer.com/` 인증서 SAN에 6 도메인 모두 포함 — `openssl x509 -in ... -noout -text | grep -A2 "Subject Alternative"`로 확인. **SSL 신규 발급 작업 0건** (매장 사장님 도메인 4 모두 재사용). sys.hanjul-flyer.co.kr 단일만 신규 발급.

## 6. ★ CORS_ORIGIN 정합 필수 (D153 fix)

### 6-1. 사고

브라우저 https://sys.hanjul-flyer.co.kr 접속 → ceo/qwer1234 로그인 시도 → "서버 오류가 발생했습니다." 응답. curl은 정상이지만 브라우저 fetch 실패.

pm2 error.log 확인:
```
서버 에러: Error: CORS blocked: https://sys.hanjul-flyer.co.kr
at origin (app.ts:69:8)
```

`.env` `CORS_ORIGIN`:
```
CORS_ORIGIN=http://localhost:5173,...,https://hanjul-flyer.co.kr,https://www.hanjul-flyer.co.kr,https://admin.hanjuldm.kr,https://sys.hanjuldm.kr
```

→ 폐기 도메인 `admin.hanjuldm.kr` + `sys.hanjuldm.kr`만 있고 **신규 subdomain `sys.hanjul-flyer.co.kr` 누락**.

### 6-2. 정답

```bash
sed -i 's|https://www.hanjul-flyer.co.kr,|https://www.hanjul-flyer.co.kr,https://sys.hanjul-flyer.co.kr,|' /home/administrator/hanjuldm-app/packages/backend/.env
pm2 restart hanjuldm-api
```

### 6-3. 교훈

신규 도메인 추가 시 `.env` `CORS_ORIGIN` 정합 의무. production 모드 + CORS_ORIGIN 명시 환경에서 누락 도메인은 500 응답. curl은 ORIGIN 헤더 안 보내서 통과하지만 브라우저는 차단.

## 7. ★ otplib named export 사고 (D153 작업 #2)

### 7-1. 사고

`npm install otplib --save`로 최신 버전 설치 시:
```
src/utils/totp.ts:10:10 - error TS2305: Module '"otplib"' has no exported member 'authenticator'.
```

otplib 최신(ESM) named export 패턴 변경.

### 7-2. 정답

한줄AI 본진 package.json 확인 → `otplib: ^12.0.1` 명시. hanjulDM도 동일:
```bash
npm uninstall otplib
npm install otplib@12 --save
```

### 7-3. 교훈

한줄AI 본진 코드 패턴 미러 시 **정확한 npm 패키지 버전 확인 의무**. `^12.0.1`처럼 major version 명시. `npm install <pkg>` 최신 latest는 ESM 전환 등으로 호환성 깨질 수 있음.

## 8. atomic safe-build 안전망 D145 정합 적중 (D153 검증)

D153 작업 #2 fix1 시점:
- otplib named export 에러 + seed-super-admin.js dotenv path 사고 발생
- backend `[atomic-build] tsc 에러` 발생 → **옛 dist 그대로 유지**
- pm2 restart도 옛 dist 그대로 로드 → 운영 영향 0
- curl 검증 시 404 응답 = "옛 dist에는 super 라우트 없음" 정확한 신호

D145 atomic safe-build (옛 dist 유지) 안전망 정상 작동 — 빌드 실패 = 운영 영향 0 보장 사례 추가 검증.

## 9. ★ 한줄AI 본진과 공유하는 사고 패턴

한줄AI(targetup) LESSONS_LEARNED와 SCHEMA를 직접 import하지 않지만, 다음 사고 패턴은 hanjulDM에도 적용:

- 백틱 사고 (template literal 안 raw 백틱 X — 큰따옴표 사용)
- 옵션 A/B/C 추천 금지 (정답 1개만)
- 추측 금지 (SQL/grep 검증 후 수정안)
- 컨트롤타워 우선 (라우트 인라인 로직 금지)
- 동일 패턴 grep 전수 (1곳만 수정 후 "완료" 보고 X)
- `$proxy_scheme` 같은 무효 변수 추측 X (nginx 표준 변수 정확히 확인)
- npm 패키지 latest 추측 X (한줄AI 본진 package.json 정확한 버전 명시 미러)

상세는 한줄AI LESSONS_LEARNED 참조 (단, hanjulDM 코드 수정 시 hanjulDM 자체 LESSONS_LEARNED만 의무 로드).

## 10. 향후 누적될 영역

- PHASE 0 트랙 A·B 진행 중 사고
- POS Agent 직접연결 고도화 사고
- CT-F10 RFM 실구현 사고
- POS 매출 귀속 알고리즘 사고
- 정부 스마트상점 결제 모듈 사고
- 슈퍼관리자 Dashboard 정식 기능 점진 확장 (총판/매장 매트릭스, 발송 통계 상세, 정산, 환불 등)
