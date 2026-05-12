# 05 다음 세션 인계 — hanjulDM 배포 미완 (D152 → D153)

> 작성일: 2026-05-12 D152 늦은 밤
> 컨텍스트 부담으로 본 세션 종료. 다음 세션에서 본 문서 정독 후 이어 진행.

## D152 완료 매트릭스

- [x] hanjulDM 분리 코드 작업 + 한줄AI 본진 flyer 제거 (tsc 0 errors 양쪽 검증)
- [x] hanjulDM tsc + dist 빌드 (288 files, app.js 8432 bytes)
- [x] PowerShell profile에 `hdm-push` / `hdm-deploy` / `hdm-deploy-full` 3개 함수 추가
- [x] 한줄AI commit `3dff1ec` + push 성공 (D152 hanjulDM 분리)
- [x] hanjulDM git init + push to `https://github.com/hoyun5295-ctrl/hanjulDM` (Private)
- [x] 서버 git clone `/home/administrator/hanjuldm-app/` 완료
- [x] `.env` 작성 완료 (`packages/backend/.env`, PORT=3001, DATABASE_URL 공유, JWT_SECRET-hdm, CORS_ORIGIN, IMC_UPLOAD_TMP_DIR 5건 검증)

## 남은 작업 (D153)

### B-3. backend 빌드

```bash
cd /home/administrator/hanjuldm-app/packages/backend
npm install --include=dev
chmod +x scripts/safe-build.sh
npm run build:safe
ls -la dist/app.js
```

npm install 5~10분. `[atomic-build] SUCCESS` + `dist/app.js` 존재 확인.

### B-4. frontend 빌드

```bash
cd /home/administrator/hanjuldm-app/packages/frontend
npm install
npm run build
ls -la dist/index.html
```

### B-5. PM2 start + 헬스체크

```bash
cd /home/administrator/hanjuldm-app
chmod +x scripts/monitor-dist.sh
pm2 start ecosystem.config.js
pm2 save
pm2 logs hanjuldm-api --lines 30
curl http://127.0.0.1:3001/health
```

응답: `{"status":"ok","service":"hanjulDM",...}`

### B-6. nginx config 적용

먼저 한줄AI nginx에 hanjul-flyer 라우팅 있는지 확인 (충돌 방지):

```bash
grep -n "hanjul-flyer\|admin.hanjuldm\|sys.hanjuldm" /etc/nginx/sites-enabled/* 2>/dev/null
```

결과 있으면 해당 `server { ... }` 블록만 삭제. 없으면 skip.

다음 hanjulDM config 적용:

```bash
cp /home/administrator/hanjuldm-app/nginx-config/hanjuldm /etc/nginx/sites-available/hanjuldm
ln -sf /etc/nginx/sites-available/hanjuldm /etc/nginx/sites-enabled/hanjuldm
nginx -t
```

`syntax is ok` + `test is successful` 확인.

### B-7. DNS + Let's Encrypt (admin.hanjuldm.kr)

DNS 콘솔에서 `admin.hanjuldm.kr` A 레코드를 서버 IP로 설정. 전파 5~30분 대기.

```bash
dig +short admin.hanjuldm.kr
ls /etc/letsencrypt/live/  # hanjul-flyer.kr 폴더 존재 확인
certbot --nginx -d admin.hanjuldm.kr -d sys.hanjuldm.kr
nginx -t
systemctl reload nginx
```

### B-8. crontab 등록

```bash
crontab -e
```

마지막 줄 추가:
```
*/1 * * * * /home/administrator/hanjuldm-app/scripts/monitor-dist.sh
```

### B-9. 외부 검증

```bash
curl https://hanjul-flyer.kr/health
curl https://admin.hanjuldm.kr/health
pm2 logs hanjuldm-api --lines 50
```

브라우저 `https://hanjul-flyer.kr` 매장 사장님 로그인 화면 + 발송 1건 테스트.

### C-1. 한줄AI 최종 배포 (B-9 OK 후만)

로컬 PowerShell:

```powershell
cd C:\Users\ceo\projects\targetup
tp-push
```

### C-2. 한줄AI 검증

```bash
pm2 logs targetup-api --lines 100
curl https://www.hanjul.ai/health
```

브라우저 `https://sys.hanjullo.com` 슈퍼관리자 로그인 → 좌상단 ServiceSwitcher 사라짐 확인 + 67사 무료체험 funnel 정상.

## 위험·주의

- **순서 엄수**: hanjulDM 배포(B-3~B-5) → nginx 적용(B-6~B-7) → 한줄AI 재배포(C-1). 역순이면 hanjul-flyer.kr 다운타임.
- **B-6 충돌 검사**: 한줄AI nginx에 hanjul-flyer 라우팅 있으면 hanjulDM nginx와 충돌. 반드시 grep 후 제거.
- **B-7 DNS 전파**: 안 되면 certbot 발급 실패. dig으로 먼저 확인.
- **atomic safe-build 안전망 의존**: 빌드 실패 시 옛 dist 유지, pm2 restart 시점 안전.
- **한줄AI 영향 0건**: 본 세션 D152에서 한줄AI tsc 0 errors 양쪽 검증 완료.

## 다음 세션 시작 방식

1. Claude Code working directory: `C:\Users\ceo\projects\hanjulDM` 또는 `targetup` 둘 다 OK
2. 본 문서 정독: `status/hanjul-flyer-revamp/05_resume_next_session.md`
3. `STATUS.md` + `04_master_plan.md` 정독 (D152 완료 매트릭스 + PHASE 0 + 7대 무기)
4. B-3부터 순차 진행
5. C-2 완료 후 PHASE 0 트랙 A (Claude Design URL 페이지 퀄리티) 진입

## 분리 후 PHASE 0 진입 시 핵심

- PHASE 0 = 전단 결과물 압도 (모든 무기의 전제)
- 트랙 A: `hanjul-flyer.kr/{code}` URL 페이지 Claude Design 통합 시스템
- 트랙 B: AI 자동 생성 전단 Claude Design + Opus 4.7 동적
- 6매체 통합 디자인 토큰 (디지털·인쇄 A3·POP·MMS·알림톡·랜딩)
- 상세는 `04_master_plan.md` §1 PHASE 0
