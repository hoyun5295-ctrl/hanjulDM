# hanjulDM 프로젝트 현황

> **업데이트:** 2026-05-13 (D156)
> **상태:** ★ D155+D156 슈퍼관리자 고도화 + 발신번호 등록 신청 승인 플로우 + 5 신규 V4 엔진(10 엔진 매트릭스) 종결. D157+ POS Agent 연구 + 슈퍼관리자 잔여 9 영역.

## 현재 단계 (CURRENT_TASK)

**D154 종결 (2026-05-13)** — PHASE 0 본격 진입. master plan §1-1 (트랙 A URL 페이지) + §1-2 (트랙 B AI 자동 생성) + §1-3 (6매체 통합 디자인 토큰) + §7 (매장 프로필 자동 merge) 모두 코드 완성 + 배포 검증. 6 엔진(STORY/MAGAZINE/DEAL FEED/GRID HERO/CATALOG SWIPE/POSTER PROMO) 본체 동적 변환 + 시즌 토큰 8종 + og:image 동적 라우트(puppeteer LRU) + 6매체 통합 design-tokens.ts + V4 미리보기 iframe(POST /preview-html) + 회사 프로필 자동 join(externalLinks/announcements 자동 박음, address fallback 카카오맵). 옛 V3 22 templateCode는 DEPRECATED_FALLBACK_MAP으로 안전 폴백 — 옛 발행 전단 흔들림 0건. DB 마이그레이션 = `flyer_companies` 7 컬럼 추가만(store_phone/map_url/kakao_channel_url/instagram_url/band_url/blog_url/shop_url). 자세한 작업 매트릭스는 비토 메모리 `project_d154_phase0_trackA_trackB_media_tokens.md` 참조.

**D154 종합 매트릭스**:

| Phase | 작업 | 결과 |
|-------|------|------|
| **1A~1D** 인프라 | season-tokens.json 8종 / season-resolver.ts CT-F / TEMPLATE_REGISTRY 22→6 + DEPRECATED_FALLBACK_MAP 22 / FlyerPage DEFAULT_TEMPLATES 6 | tsc 0 |
| **2A~2G** 6 엔진 본체 | flyer-templates.ts V3 1643줄 → V4 약 4500줄(6 엔진 본체 동적 변환) / flyer-page-injections.ts 분리(cart-script + qr) | tsc 0 |
| **3A** 라우트 정합 | short-urls.ts periodEnd 주입 + 디폴트 'grid_hero' | tsc 0 |
| **4A** og:image | renderOgImageHtml + buildOgImageUrl + FlyerRenderData.shortCode + og-image.ts 신규 라우트(puppeteer 싱글톤 + LRU 1h) + app.ts mount | curl 200 OK 검증 |
| **4B~4E** 트랙 B | claude-design-renderer.ts(시드 휴리스틱 6 변형) / template-recommender.ts(점수 매트릭스 6 엔진 자동 선정) / flyer-ai-copy.ts enrichCategoriesWithAiCopy / flyer-naver-search.ts enrichCategoriesWithImages | tsc 0 |
| **4F~4K** 6매체 토큰 | design-tokens.ts(MEDIA_SPECS 6 + generateMediaCssBlock + generateAllSeasonsCssBlock) / paged-pdf.ts seasonToken 옵션 / flyer-pop-templates pageCss 토큰 prepend / media-images.ts(MMS 1080x1920 + 알림톡 1000x1000) / 브랜드메시지=URL 활용 | tsc 0 |
| **5B** 1차 배포 | hdm-push + 4 패키지 atomic safe-build + DB SQL(default_template 정합) + 외부 검증 | https://hanjul-flyer.kr 정상, og:image 364KB/320KB PNG 정상 |
| **6** 미리보기 V4 | POST /api/flyer/p/preview-html 라우트 신규 + FlyerPreview.tsx iframe(ResizeObserver scale 자동) + 옛 V3 React 미러 export 처리(unused 회피) | hdm-push 재배포 검증 |
| **7A~7E** 매장 프로필 자동 merge | flyer_companies 7 컬럼 ALTER TABLE / GET-PUT /api/flyer/companies/ 7 컬럼 SELECT-UPDATE / StoreProfileSection.tsx 신규(SettingsPage 최상단) / short-urls.ts mergeCompanyProfileToExtraData 헬퍼(전단 발행 자동 join, address fallback 카카오맵) / preview-html flyerAuthenticate 추가(인증 토큰 → companyId 자동 식별) | hdm-push 재배포 검증 |

## D155+D156 종결 매트릭스 (2026-05-13 오전~저녁)

자세한 비토 메모리 = `project_d156_super_admin_고도화.md` 참조.

| Phase | 작업 | 결과 |
|-------|------|------|
| **D155-1** POSTER PROMO h1 fix | `.hero h1 padding-right:140px` (sticker 132+8 gap reserve) | 제목 가림 차단 ✓ |
| **D155-2** AI 카피 자동 enrich 비동기 | POST/PUT /flyers `setImmediate` 백그라운드 + skipExisting:true | 사장님 응답 즉시 + ~5초 후 자동 채움 ✓ |
| **D155-3** 회원/회사 soft delete + 감사로그 | flyer-audit-log.ts FlyerAuditAction 4 추가 + logFlyerSuperAdminAudit 신규(user_id NULL FK 회피) + 회사 DELETE cascade + 회원 DELETE 신규 | audit 통합 ✓ |
| **D155-4** 5 신규 V4 엔진 | magazine_zine/deal_bento/grid_muji/catalog_dark/poster_pop — 각 ~700~900줄 + RENDERERS 11키(story 폴백 유지) | tsc 0 ✓ |
| **D155-5** REGISTRY 6→10 | TEMPLATE_REGISTRY/DEFAULT_TEMPLATES/template-recommender b-variant 점수 매트릭스 | tsc 0 ✓ |
| **D155-6** safe-build.sh 누락 fix | root scripts/safe-build.sh 3 패키지 atomic + admin-frontend/scripts/safe-build.sh 신규 | 빌드 통과 ✓ |
| **D155-7** 자동 이미지 매핑 | **Harold 보류** (저작권 침해 명확 + 정확도 부족) | 대안 = AI 생성/공공 저작물/자체 촬영 별건 |
| **D155-8** 슈퍼관리자 고도화 | StoreListPage/PosAgentListPage/BillingPage/CompanyFormModal/UserFormModal 신규 + Dashboard 통계 4→11 + 탭 3→6 | admin-frontend 9 화면 신규 ✓ |
| **D156-1** DB 신규 테이블 | `flyer_sender_registrations` + 2 인덱스 (Harold psql 직접 실행) | 마이그레이션 ✓ |
| **D156-2** sender-registration.ts 재작성 | 즉시 등록 → 승인 플로우 + multer 10MB(PDF/이미지) + 본인 GET/POST/cert/DELETE | 승인 플로우 박힘 ✓ |
| **D156-3** flyer-admin.ts 슈퍼관리자 라우트 4 | list/cert 다운/approve(flyer_callback_numbers 자동 INSERT)/reject + audit-log sender_registration_* | 슈퍼관리자 처리 ✓ |
| **D156-4** frontend SenderRegistrationPage | 신청 폼 + 증명원 업로드 + 신청 이력 + 본인 취소 + App.tsx 📞 발신번호 메뉴 | 매장 사장님 화면 ✓ |
| **D156-5** admin-frontend SenderRegistrationListPage | 상태 필터 + 상세 모달(인증서 다운로드) + 반려 사유 모달 + Dashboard 탭 6→7 + 카드 6→7(senderRegPending) | 슈퍼관리자 화면 ✓ |

## 현재 슈퍼관리자 매트릭스 (sys.hanjul-flyer.co.kr)

- **통계 카드 7**: 총판/회원/매장/POS Agent(활성/전체)/발신번호 대기/총 발송량/이달 청구액
- **탭 7**: 회사(총판)/회원/매장/POS Agent/발신번호/결제/감사 로그
- **회사 탭**: 검색+신규 등록(사업자등록증+세금계산서+관리자 통합 5 섹션)+수정+소프트 삭제(cascade)
- **회원 탭**: 회사 필터+신규 등록+비번 리셋+소프트 삭제
- **매장 탭**: 다중 필터+페이징+신규+수정+충전(잔액/activate 분기, 0~20만원 monthly_fee)
- **POS Agent 탭**: heartbeat 자동 계산+키 발급+결과 복사
- **발신번호 탭**: 상태 필터+상세 모달(인증서 다운로드)+승인/반려
- **결제 탭**: 회사 필터+요약 카드 3+청구월별
- **감사 로그 탭**: 액션/날짜 필터+페이징+actor 슈퍼관리자/회원 구분

## D157+ 인계 — POS Agent 연구 + 슈퍼관리자 잔여 영역

**Harold 명시 우선순위**:

1. **POS Agent 연구** (master plan §3 PHASE 1 1번 무기) — `packages/pos-agent/` 폴더 D152 이관 후 미점검. CT-F16 AI 스키마 자동 매핑 + 어떤 POS여도 점주 동의 하나로 즉시 연결. 비토 메모리 = `project_next_pos_agent_research.md`

2. **슈퍼관리자 잔여 누락 9 영역**:
   - alimtalk_senders(알림톡 발신프로필 등록 신청 + 대행 처리 IMC API) — 우선
   - deposits(무통장입금 확인 + 잔액 변동 이력) — 우선
   - allCampaigns(flyer 캠페인 통합 모니터링)
   - stats(발송 통계 상세 + 월별 사용금액 자동 표시)
   - templates(알림톡 IMC 검수 결과 모니터링)
   - scheduled(예약 캠페인 모니터링)
   - loginBlocks(로그인 차단)
   - 본인 계정 관리(비번/TOTP 재설정/백업코드 재발급)
   - 사이드바 nav 도입 (탭 7 → 영역 15+ 가로 공간 부족)

3. **PHASE 0 정성 평가** (master plan §1-4): Harold 4.0/5.0 + 비토 4.0/5.0 + 인비토 직원 3인 + 마트 사장 1인 블라인드 + 고객 5인 중 4인

4. **PHASE 1 7대 무기** (D158~ PHASE 0 통과 후): POS Agent 직접연결 + CT-F10 RFM 실구현 + Campaign Autopilot + ROI Closed Loop + Outside DB + 정부 결제 모듈

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
