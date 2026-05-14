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

## 11. ★ D159 POS Agent V2 박힘 패턴 (2026-05-14)

POS Agent V2 (Credential Discovery + Mask Bypass + 양방향 통신 + NSIS 인스톨러) 박힘. 빌드 검증 + 운영 배포 과정 중 박힌 5 fix + 메타 사고 1건.

### 11-1. pkg pushData 반환 타입 정합 (ok=false case 박음)

- **사고**: pos-agent `server-client.ts pushData`가 항상 `ok=true` 반환 → scheduler.ts cache-pusher의 `if (result.ok && result.data)` 분기에서 `markFailed` case 도달 0건 + tsc 에러 6건 (`result.error` 미존재).
- **정답**: pushData 반환 타입에 `ok: boolean, data: ..., error?: string` 명시. 전 배치 실패 시 `allFailed = totalAccepted === 0 && totalRejected > 0`로 ok=false 박음.
- **How to apply**: Agent ↔ 서버 통신 함수에서 batch 전체 실패 case = ok=false + error 명시. scheduler에서 markFailed 분기 활성화 보장.

### 11-2. NSIS Unicode + UTF-8 BOM 필수 (한글 인코딩)

- **사고**: installer.nsi 빌드 시 `Bad text encoding: line 2/4` 에러. 한글 주석/스트링 박힌 .nsi 파일 처리 실패.
- **정답**: (a) `.nsi` 첫 줄에 `Unicode true` 박음 + (b) 파일 자체를 UTF-8 BOM으로 박음 (`[System.Text.UTF8Encoding $true]`).
- **How to apply**: NSIS 3.x Unicode 빌드 시 두 가지 모두 박혀야 한글 인식. Write 도구는 BOM 없이 박으므로 PowerShell로 변환 박음:
  ```powershell
  $utf8Bom = New-Object System.Text.UTF8Encoding $true
  [System.IO.File]::WriteAllText($path, $content, $utf8Bom)
  ```

### 11-3. ★ nginx sed/awk 박힘 시 server block 매칭 주의 (D159 핵심 메타 사고)

- **사고**: nginx config에 `location /downloads/` 박을 때 sed `0,/location \/ {$/`가 **HTTP 80 server block의 redirect-only `location /` 매칭** → HTTPS 443 server block에 박히지 않음 → 매장 사장님 HTTPS 요청 시 SPA fallback (`index.html` 3,737 bytes 반환). 7회 시행착오.
- **정답 1개**: nginx location 박힘 = (a) `^~` 접두사 사용 (정규식 우선순위 우회) + (b) HTTPS 443 server block의 `location /api/` 직전에 박음 (server block 정확 매칭 보장). awk 패턴:
  ```bash
  sudo awk '/^    location \/api\/ \{$/ && !done {
      print "    location ^~ /downloads/ {"
      print "        alias /var/www/...;"
      print "        autoindex off;"
      print "    }"; print ""; done=1
  } {print}' /etc/nginx/sites-enabled/<config> > /tmp/new
  sudo mv /tmp/new /etc/nginx/sites-enabled/<config>
  ```
- **How to apply**: nginx config 자동화 박을 때 (1) HTTP server block + HTTPS server block 둘 다 동일 location 박혀있는 경우 첫번째 매칭이 의도와 다를 수 있음 (2) 정규식 location이 위쪽에 박혀있으면 일반 prefix보다 우선 매칭 → `^~` 접두사 필수 (3) 박힘 후 `nginx -T | grep -B20 "추가된 location"`로 어느 server_name 아래 박혔는지 확인 의무.
- **Why**: HTTP 80 server block은 보통 `return 301 https://...` redirect 영역 = 매장 사장님 실 요청 안 닿음. HTTPS 443에 박혀야 정상 동작.

### 11-4. SPA fallback 정확 진단 (Content-Length 3,737 bytes = frontend index.html)

- **사고**: `curl -I /downloads/Setup-1.0.0.exe` 응답이 `Content-Type: text/html, Content-Length: 3737` = SPA index.html. 처음엔 권한 문제로 의심 → 진단 결과 권한 OK + nginx 200 + 그러나 매칭 X.
- **정답 진단**: Content-Length 정확히 3,737 = frontend `index.html` 박힘 (atomic safe-build 출력에 `[flyer] swap 완료 (3737 bytes)` 박힘). 이게 박히면 SPA `location / { try_files $uri $uri/ /index.html }` 처리 = 의도한 location 매칭 실패 신호.
- **How to apply**: nginx에서 `Content-Type: text/html + Content-Length 3,737` 응답이면 SPA fallback 박힘 = location 매칭 실패. `nginx -T | grep -B25 "박은 location"`로 어느 server block에 박혔는지 즉시 확인.

### 11-5. systray2 native binary 위치 변경 (v2.1.4+)

- **사고**: `copy-native.js`가 `tray_windows.exe` 파일 찾기 실패 ("⚠ systray2 native (Windows) 파일 없음"). systray2 v2.1.4부터 native binary 파일명을 `tray_windows_release.exe`로 변경.
- **정답**: copy-native.js에서 두 파일명 모두 시도 (Windows = `tray_windows_release.exe`가 정합).
- **How to apply**: npm 라이브러리 native binary 의존 시 라이브러리 버전 별 파일명 변경 가능성 항상 확인. `node_modules/<lib>/traybin/` 직접 정독.

D157(슈퍼관리자 대행) + D158(매장 발송) 작업에서 박힌 사고 + 운영 fix 5건. 향후 admin-frontend/frontend 컴포넌트 박을 때 동일 패턴 차단.

### 10-1. admin-frontend localStorage 토큰 키 = `admin_token` 정합

- **사고**: 신규 알림톡 컴포넌트가 `localStorage.getItem('flyerSuperToken')` 사용 → 토큰 미발견 → "No token provided" 토스트 + 모든 API 401 → 회사 dropdown 0건.
- **정답**: App.tsx L11 `getToken(): return localStorage.getItem('admin_token')` 정합. 모든 admin-frontend 컴포넌트가 동일 키 사용 의무.
- **How to apply**: admin-frontend 신규 컴포넌트 박을 때 `apiFetch` (App.tsx L14) 사용 권장 — 자동 토큰 + 401 자동 로그아웃 통합. 직접 `fetch + Authorization` 박을 때 토큰 키 = `admin_token` 확정.

### 10-2. Backend 응답 키 정합 (items vs companies vs rows)

- **사고**: AlimtalkManagementPage `loadCompanies` 응답 파싱 시 `data.companies || data.rows || data` fallback만 박힘 → 실제 응답 `{ items, total, page, pageSize }` 키 누락 → 회사 0건.
- **정답**: GET `/api/admin/flyer/companies` 응답 구조 확정 = `{ items, total, page, pageSize }`. fallback에 `items` 첫 순위 박기.
- **How to apply**: 새 admin-frontend 컴포넌트가 admin 라우트 호출 시 응답 키 직접 확인(routes/admin/flyer-admin.ts 정독) — fallback 체인 박는 것보다 정확 키 1순위 사용이 안전.

### 10-3. TypeScript Interface 중복 정의 TS2719

- **사고**: AlimtalkManagementPage Template interface와 AlimtalkTemplateModal Template interface가 동일 이름 + 다른 필드 → "Two different types with this name exist, but they are unrelated".
- **정답**: 누락 8 필드(buttons/variables/emphasize_title/emphasize_subtitle/extra_content/template_header/category/preview_message) 추가하여 구조 매칭.
- **How to apply**: 공용 type은 별도 export 파일에서 정의 (예: alimtalk-types.ts) + 양쪽 컴포넌트가 import. 컴포넌트 내부 interface 중복 정의 피하기.

### 10-4. axios `res.headers` 유니온 타입 좁히기

- **사고**: hanjulDM tsconfig + axios 1.7.2 조합에서 `res.headers['content-type']` 타입 = `string | number | true | string[] | AxiosHeaders` → string 직접 할당 차단(TS2322).
- **정답**: `typeof ct === 'string' && ct ? ct : 'application/octet-stream'` 타입 좁히기.
- **How to apply**: axios response headers 접근 시 항상 typeof 체크 + fallback. 본진 한줄AI는 통과하나 hanjulDM strict 모드에서 차단되는 패턴.

### 10-5. frontend safe-build.sh devDependencies 자동 복구

- **사고**: D158 빌드 시 frontend(2/3) 단계에서 "This is not the tsc command you are looking for" — typescript 부분 설치 또는 빈 디렉토리.
- **원인**: D152 분리 시 frontend/scripts/safe-build.sh에 D151-6 자동 복구(typescript 누락 감지 → npm install --include=dev) 박지 X. backend + admin-frontend는 박힘.
- **정답**: frontend safe-build.sh L12-17에 자동 복구 박음(typescript + vite 둘 다 체크) — 영구 차단.
- **How to apply**: hanjulDM 신규 패키지 추가 시 scripts/safe-build.sh에 D151-6 자동 복구 패턴 의무 포함. devDependencies 누락 = NODE_ENV=production로 npm install이 skip하는 사고 영구 차단.

### 10-6. git pull 누락 HEAD SHA 비교 검증

- **사고**: 로컬 git push 완료(`up to date with origin/main`) + 서버 빌드 통과인데도 알림톡 스케줄러 startup 로그 미박힘 → 검증 결과 서버 HEAD `e5911fb`(D156) ≠ 로컬 HEAD `ed5cb76`(D157) = 서버 git pull 누락.
- **정답**: 빌드 후 `git log --oneline -1` 또는 `git rev-parse HEAD` 비교. 로컬 = 서버 SHA 정합 의무.
- **How to apply**: 배포 후 pm2 restart 전 서버 git log 확인 절차. 빌드 통과 ≠ 코드 적용 (옛 코드도 컴파일 통과 가능). startup 로그(예: `startFlyerAlimtalkScheduler`) 검증으로 신규 코드 실 적용 확정.

## 12. ★ D161 인쇄전단 전 종 PDF/PNG 백지 root cause (2026-05-14)

### 12-1. 사고

hanjulDM 인쇄전단 전 종(mart_*_v1 4종 + print_*_v1 5종) PDF 848~858B / PNG 21~85KB **완전 백지**. handoff `10_print_5jong_blank_page_unresolved.md`에서 "5종 한정" 가설 + 2건 fix 시도(preferCSSPageSize 제거 / section wrapper) 효과 0건. 미해결 인계.

### 12-2. Root cause (Paged.js 폴리필 0.4.3 소스 직접 정독으로 100% 확정)

`unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js` auto-init 블록:
```js
ready.then(async function () {
  if (config.before) await config.before();
  if(config.auto !== false) done = await previewer.preview(...);  // auto:false면 SKIP
  if (config.after) await config.after(done);                      // ★ 발화 무조건
});
```

`config.auto: false`는 **preview() 호출만 skip**, `config.after` 콜백은 **page-ready 시점 무조건 발화**.

paged-pdf.ts 기존 PagedConfig.after 정의:
```js
window.PagedConfig = {
  auto: false,
  after: function(flow) {
    // body 자식 display:none
    var nodes = document.querySelectorAll('body > :not(.pagedjs_pages):not(script):not(style):not(link)');
    for (var i = 0; i < nodes.length; i++) nodes[i].style.display = 'none';
    window.__PAGED_DONE = true;
  }
};
```

→ polyfill auto-init이 manual `await PagedPolyfill.preview()` 호출 **전에** after 발화 → body 원본 전부 `display:none` + `__PAGED_DONE=true` 설정 → Puppeteer `waitForFunction('__PAGED_DONE===true')` 즉시 통과 → 빈 body 스크린샷/PDF 캡처.

### 12-3. 정답

**Fix 1 — paged-pdf.ts L92-130:**

`PagedConfig.after` 완전 제거. `PagedConfig = { auto: false }` 단일. cleanup + `__PAGED_DONE=true` 설정 위치 = `pagedStart` async 래퍼 안 manual `PagedPolyfill.preview()` 반환 **직후**.

Paged.js `wrapContent()`가 body innerHTML을 `<template data-ref='pagedjs-content'>` 안에 넣어 inert 자동 처리하므로 추가 hide cleanup 불요.

**Fix 2 — PAPER-SIZES.ts B4 entry:**

257×364mm(ISO 표준 오기재) → 260×374mm(한국 마트 전단지 8절). labelKo + note 추가. frontend PrintFlyerPage.tsx L101 `B4: 'B4 (260×374mm)'` Harold 의도 정합.

### 12-4. 검증

PDF MediaBox 실측 (시장조사 가이드 편집 사이즈 정합):
- mart_spring_v1 (j2): 557.02×800.10mm, page 1, PDF 1,667 KB
- print_deal_focus_v1 (B4): **263.91×377.87mm**, page 2, PDF 994 KB (가이드 264×378 정합 ✓)
- print_magazine_grid_v1 (B3): **377.87×528.15mm**, page 2, PDF 2,308 KB (가이드 378×528 정합 ✓)

### 12-5. handoff 가설 폐기

- 인계 fix #1 (preferCSSPageSize 제거 + 명시적 width/height) — 효과 0. `preferCSSPageSize: true` 유지가 정답 (CSS @page bleed 2mm 포함 출력 = 가이드 편집 사이즈).
- 인계 fix #2 (article → section wrapper, commit 6d62c30) — 효과 0. root cause와 무관. 그대로 두기 (revert 시 추가 변경 위험).
- "display: grid + overflow: hidden" / "page-break-after 분할 실패" 모두 가설 — 사실 무관.

### 12-6. How to apply

- Paged.js 폴리필 0.4.3+ 사용 시 `PagedConfig.after` 콜백에 **절대 cleanup 로직 추가하지 않을 것**. manual preview() 호출 패턴에서는 after 콜백 자체 불요 (`wrapContent`이 원본 isolation 자동 처리).
- 한국 마트 전단지 사이즈는 ISO 규격과 다름. PAPER-SIZES.ts B4=260×374 / B3=374×524 / B2=524×752 (재단). 도련 사방 2mm = 편집 사이즈 +4mm. CSS @page `bleed: 2mm`로 자동 처리. 시장조사 가이드 `C:\Users\ceo\Downloads\마트전단지_인쇄용_PDF_가이드.pdf` 정독 필수.
- 외부 라이브러리 의심 사고 발생 시 unpkg/CDN으로 소스 직접 정독 절차 의무 — 가설 X.

## 13. ★ D162 5종 print template 안전망 — 사장님 자유 입력 + 자동 숨김 (2026-05-14)

### 13-1. 사고

D161 백지 fix 후 print_magazine_grid_v1 운영 발행 시 추가 사고 다수 노출:
- hero_title "가정의달 특가" 6자 한 줄 입력 → 폰트 22mm + 컨테이너 너비 96mm 충돌 → 한국어 한 줄이 잘림 (word-break 미정의)
- fillTextSlot textContent 평문화 → manifest fallback `<br/>`/`<em>` 마크업이 사장님 입력 시 사라짐 + 사장님 \n 줄바꿈 미반영
- "다음 4주 행사 캘린더" + "매장 멤버 혜택" 등 정적 영역 — 사장님 입력 무관 항상 노출 (dummy data 그대로 인쇄 발주 사고 위험)
- 5종 manifest fallback 7건 "사장님이 (직접) 박는..." 안내 텍스트 — 사장님 미입력 시 인쇄 발주 시 그대로 노출
- 상품 이미지 placeholder 표시 안 됨 (실제로는 표시되는데 grid row auto 압축으로 작아짐)

### 13-2. Root cause

1. **CSS 한국어 텍스트 줄바꿈 미정의** — 한국어는 단어 사이 공백 없으면 `word-break: normal` 동작 X → 한 줄 텍스트가 컨테이너 넘침
2. **fillTextSlot textContent 한정** — innerHTML 분기 없음 → 마크업 평문화. 사장님 \n 입력 시 줄바꿈 사라짐
3. **정적 fallback HTML 다수** — slot 데이터 미입력 시 template.html의 정적 HTML 그대로 표시 (자동 숨김 메커니즘 부재)

### 13-3. 정답

**slot-filler.ts CT 확장 (FILL_RUNTIME 신규 헬퍼):**

```ts
// server-side
function sanitizeMarkup(raw: string, allowedTags: string[]): string {
  // 1. \n → 임시 sentinel + 허용 태그 임시 보존 + 외 entity escape + sentinel 복원
}
function resolveTextSlot(slot, input) {
  // allowedTags 정의 시 {value, html} 반환, 미정의 시 {value} (기존)
}

// browser-side (FILL_RUNTIME)
function fillTextSlot(slotEl, value) {
  // value.html 박혀 있으면 innerHTML, 없으면 textContent
}
function isSlotEmpty(value) { /* value/html/text/items 4 필드 검사 */ }
// data-empty-hide + isSlotEmpty 시 data-optional-wrapper 부모 또는 자기 자신 display:none
```

**5종 manifest 정정:**
- typography/text slot에 `allowedTags: ["br","em","strong"]` 추가 (5종)
- fallback "사장님이 박는..." 7건 → 깨끗한 더미 안내로 정정 (5종)

**5종 template.html 정정:**
- 정적 영역 wrapper에 `data-optional-wrapper` 추가
- slot element에 `data-empty-hide` 추가 (사장님 미입력 시 영역 자동 숨김)
- print_classic_v1 hero `data-bind="copy.headline"` 오기재 → `data-slot="hero_title"` 정정

**5종 template.css 정정 (4종 set 의무):**
```css
.hero-title h2 {
  font-size: clamp(MIN, VW, MAX);  /* 동적 사이즈 */
  word-break: keep-all;              /* 한국어 어절 단위 줄바꿈 */
  overflow-wrap: anywhere;           /* 긴 단어 강제 줄바꿈 */
  line-height: 1.0;                  /* 줄간격 조정 */
}
```

### 13-4. 검증

- tsc 0 errors
- test-render 5종 PDF 모드: page count 2 + PDF 597KB~2,279KB 정상
- test-render PNG 모드 print_magazine_grid_v1: heroTitle "가정의달\n특가" → 자동 2줄 표시 정합 / 헤더 안 잘림 / 멤버 혜택/캘린더 영역 자동 숨김 / 상품 placeholder 표시

### 13-5. How to apply

1. 신규 print template 추가 시 typography/text slot에 `allowedTags: ["br","em","strong"]` 정의 의무
2. fallback에 "사장님이 작성하는..." 같은 안내 텍스트 금지 — 깨끗한 더미 또는 공백 (사장님 미입력 시 인쇄 발주 시 그대로 노출 차단)
3. 정적 영역(레시피/캘린더/인터뷰 등) → `data-slot` 전환 + `data-empty-hide` + 부모 wrapper `data-optional-wrapper` 의무
4. 큰 폰트(>10mm) 텍스트 slot은 CSS 4종 set(clamp + word-break: keep-all + overflow-wrap: anywhere + line-height 1.0) 의무 — 한국어 자동 줄바꿈 보장
5. 매장 사장님 입력 시 `\n` → `<br/>` 자동 변환 (resolveTextSlot의 sanitizeMarkup 처리). allowedTags 외 태그 entity escape

### 13-6. 미해결 잠재 사고 (별 단계 fix)

| # | 영역 | 우선순위 |
|---|---|---|
| 6 | 폰트 외부 CDN 의존 (Pretendard / Noto Serif KR / JetBrains Mono) — self-host 인프라 변경 | MED |
| 7 | sRGB → CMYK 변환 미적용 (시장조사 가이드 PDF/X-1a 권장 비정합) | MED |
| 9 | maxLength 정의 누락 슬롯 — 사장님 긴 입력 시 디자인 깨짐 가능 | MED |
| 10 | minItems 미달 시 grid 빈 영역 — 사장님 데이터 부족 시 dummy 자동 채움 또는 빈 영역 처리 | MED |

## 11. 향후 누적될 영역

- PHASE 0 트랙 A·B 진행 중 사고
- POS Agent 직접연결 고도화 사고
- CT-F10 RFM 실구현 사고
- POS 매출 귀속 알고리즘 사고
- 정부 스마트상점 결제 모듈 사고
- 슈퍼관리자 Dashboard 정식 기능 점진 확장 (총판/매장 매트릭스, 발송 통계 상세, 정산, 환불 등)
