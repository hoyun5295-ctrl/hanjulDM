# hanjulDM 프로젝트 현황

> **업데이트:** 2026-08-20 (결제 상태·잔액 축 정정 / 슈퍼버전업 W3 구현) — 그 아래 D159 절은 당시 기록 원문 보존

## ★ 2026-08-20 제작 화면 재설계 + 템플릿 갤러리 복원 — **코드 완료 · 배포 대기**

**SoT = `status/hanjul-flyer-revamp/15_composer_design_and_template_gallery.md`**.
한 줄 요약 = **템플릿 10종은 엔진에 그대로 살아 있었고 W3이 고르는 UI만 지운 것**이었다. 갤러리로 되살리고 2종을 더해 **12종**.
제작 화면은 인쇄소 톤(Black Han Sans 헤드·종이 질감·한글 keep-all)으로 다시 짰다.
검증 = tsc 0 · 양쪽 build · vitest 65건(실렌더 스모크 72조합).

## ★ 2026-08-20 결제 상태·잔액 축 정정 — **코드 완료 · DDL·배포 대기**

**SoT = `status/hanjul-flyer-revamp/14_payment_status_balance_axis.md`** (접수·실측·설계·구현·잔여·⛔ 전부 그 문서가 소유).
값 축 코드 SoT = `utils/flyer/billing/flyer-payment-status.ts`(CT-F26) · 잔액 이동 = `flyer-balance-ledger.ts`(CT-F27).

한 줄 요약 = **같은 뜻의 결제 상태를 화면마다 다른 값으로 불러 매장이 잠겼고, 잔액은 기록 없이 움직이고 있었다.**
검증 = backend tsc 0 · 양쪽 frontend build 성공 · vitest 56건(기존 29 + 신규 27).
**다음 = 14번 문서 §6 DDL 실행 → 배포 → §7 실측.** 배포 후 현재 `suspended` 인 총판·매장을 화면에서 되돌려야 잠금이 풀린다.

## ★ 2026-08-20 슈퍼버전업 — W3 전단·POP 제작 축 전면 개편 **배포완료**

**SoT = `status/hanjul-flyer-revamp/13_w3_tool_super_versionup_design.md`** (5역할 브레인스토밍 수렴 · Harold 승인).
검수 = 11(W4 알림톡 — 착수 후순위) · 12(W3) 문서. 실사용 0 실측(회사 2·캠페인 0) = 하위호환 제약 없음.

**구현된 것(전부 코드 완료 · tsc 0 · 게이트 테스트 29건 통과):**
- 0단계 잔재 제거: DALL-E 생성 폐기(라우트 410 차단) · 죽은 미러 333줄 삭제 · pos-auto INSERT 컬럼/템플릿 코드 정정
- 이미지 정책(§3): 네이버 = 후보 제시 전용(자동 확정 금지) · 자동 채움 = 카탈로그→로컬 2단 · 인쇄 로컬만(핫링크 차단) · 쿼리 정규화 + 신뢰도 게이트 + 429 표면화 · enrichCategoriesWithImages 삭제
- 렌더 품질(§4): CT-F24 신설(프로모 badge 분리·밴드 3단·이름/가격 계급·SVG 픽토그램 15종) · grid_hero/poster_promo 수술(무이미지 스펙 슬랩) · POP 시즌 토큰 실배선 · 매대 띄지 1종 신규
- 파이프라인(§2): POST /auto-build 신설(분류→엔진 자동 선정→변형) · renderTemplate variant 주입 · 발행 스냅샷(ALTER 4컬럼 + 503 안전망) · /copy 기간 갱신+변형 승계 · 인쇄 seasonToken 전달
- 화면(§1): FlyerComposerPage 신설(화면 1개 · 3카드 프리셋 · 소스 4칩 · 손질 4종 · 발행 1버튼 · POP 뽑기 · 인쇄 관문) — 옛 FlyerPage(1,310줄) 삭제 · PopPage/PrintFlyerPage native dialog 0건 정리
- 게이트(§8): vitest 신설(devDep · 빌드 제외 exclude) · `super-versionup-gates.test.ts` 29건 = 소비처 검증(미배선 재발 차단) + 재현성 + 실렌더 스모크 120조합 + 미러 부활 차단 + 이미지 정책

**배포 이력(0820):** `a8350b8` 본체 → `b3fd740` 빌드 정정(미사용 변수 2 — 서버 tsc가 로컬 `--noEmit`보다 엄격) → `93389e6` **라이트 테마 정정**. 배포는 끝났고 **잔여 = DDL + 실측**이다.

**DDL 실행완료(0820)** — `flyers` 4컬럼 실측 확인: `design_variant` jsonb · `media_assets` jsonb · `recommended_engine` jsonb · `render_schema_version` integer. 배포 축은 여기서 완결됐다.

**⚠ 남은 것 = 실측만** — 13번 §7 6단계(상품 담기 → 자동 완성 → 「다른 느낌」 → 발행 → 재열람 재현성 2회 → POP·인쇄 뽑기). 예시 엑셀 = `한줄전단_상품_예시_30.xlsx`(상품 30 — 밴드 21+·1+1 토큰·긴 이름·6자리 가격·신선 원산지 케이스 포함).
**실측 대기:** POS 이미지 보유율(실매장 확보 시) · rembg 컨테이너 미가동(보조 축) · 전수 실렌더 육안 검수.
**배포 과정에서 잡은 결함 2건(전부 정정됨):**
- 서버 빌드 tsc가 미사용 변수 2건을 잡았다 — **로컬 `tsc --noEmit`은 서버 빌드와 같지 않다**(`--noUnusedLocals` 차이). 프론트 작업 검증은 `npm run build`까지 돌려야 같은 기준이다.
- **라이트 테마 화면에 다크 클래스를 썼다** — 신규 화면을 targetup(다크) 관례로 짜서 글씨가 보이지 않았다. 더불어 옛 코드가 쓰던 `text-text-tertiary`·`bg-surface-secondary`는 **이 프로젝트 토큰에 없는 유령 클래스**였다(스타일 미생성). 상세·재발 방지 = LESSONS_LEARNED.md 상단.

**범위 밖 기록:** SenderRegistrationPage confirm() 1건(W3 밖) · W2 결제 축 = PAY 답 대기 · W4 알림톡 = 11번 문서 대기.

---

> **아래는 2026-05-14 (D159 후반) 시점 기록이다.**
> **상태:** ★ D159 = (1) POS Agent V2 100% 박힘 + (2) OKPOS → 투게더스(MS-SQL) 정정 + (3) **인쇄 전단 5종 박음 진행 중 (1종 80% 박힘, 4종 + 정합 정정 다음 세션)**. 다음 세션 = 09번 인계 .md 정독 + Step A-F 박음 (인쇄 5종 마무리) → 그 후 투게더스 매장 캡처 + PHASE 1 무기 4.

## D159 후반 인쇄 전단 5종 박음 진행 (2026-05-14 후반)

자세한 인계 = `status/hanjul-flyer-revamp/09_print_template_v3_integration_handoff.md` 정독 필수.

**박힘 완료:**
- `07_print_template_redesign_master.md` (앞면 5종 마스터 프롬프트)
- `08_print_back_template_master.md` (뒷면 5종 마스터 프롬프트, 양면 정합)
- 끌로드 디자인 박은 결과 = `jundantemplet/` 폴더 (5 앞면 + 5 뒷면 HTML + 5 앞면 .md + index.html + design-canvas.jsx + image-slot.js)
- `PAPER-SIZES.ts` B3 키 추가 (374×524mm, 한국 인쇄 실무)
- `templates/print_classic_v1/manifest.json` (15 슬롯 = masthead/hero_title/hero_subline/hero_grid/section_meat/meat_grid/section_fresh/fresh_grid/section_grocery/grocery_grid/footer_notice/footer_qr/back_extra_grid/coupon_grid/back_footer_notice)
- `templates/print_classic_v1/template.html` (앞면만)
- `templates/print_classic_v1/template.css` (앞면 CSS만)
- `09_print_template_v3_integration_handoff.md` 인계 박힘 (11 섹션, 다음 세션 즉시 박음 가능)

**박힘 미완 (다음 세션 첫 박음):**
- `print_classic_v1/template.html` 뒷면 article 추가
- `print_classic_v1/template.css` 뒷면 CSS 추가 (coupon-grid + pb-footer)

**박힘 0건 (다음 세션):**
- print_deal_focus_v1 (B4, POP 폭격)
- print_magazine_grid_v1 (B3, 33 상품 + 다크 헤로)
- print_gazette_v1 (B3, 신문지 무드 + 본명조)
- print_bento_v1 (B4, 비대칭 모자이크)
- template-registry.ts 검증 (LoadedTemplate.back 필드 박힘 여부)
- paged-pdf.ts 양면 검증 (Paged.js page-break-after)
- frontend PrintFlyerPage 5종 선택 UI
- 4 패키지 tsc 빌드 검증 + atomic safe-build 실 실행

**다음 세션 비토 진입 명령:** "hanjulDM 인쇄 전단 V3 시스템 박음 마무리. 09_print_template_v3_integration_handoff.md 정독 + Step A-F 순차 박음."

## D159 후반 정정 (OKPOS → 투게더스 / MySQL → MS-SQL Server)

비토 V2 설계 시 박은 우선순위 = OKPOS 1순위로 박았으나 Harold 명시 = **투게더스(Together's) 1순위 + MS-SQL Server 매장 관리 PC 박힘**.

**정정 영역 6건:**
- `db-detector.ts` POS_SIGNATURES 배열 togethers 1순위 (okpos 2순위로 강등) + 비고 "MS-SQL Server + Windows Authentication 박혀있을 가능성 높음 = 자격증명 추출 불필요"
- `FLYER-POS-AGENT-V2.md` §1 + §7 + §10~11 (OKPOS → 투게더스, MySQL → MS-SQL Server, my.ini → SQL Server Configuration Manager)
- 메모리 `project_d159_pos_agent_v2.md` + `project_next_togethers_capture_and_phase1_roi.md` (파일명 변경 포함)
- `MEMORY.md` 인덱스 갱신

**투게더스 매장 캡처 5건 (다음 세션 OKPOS adapter 박을 때 필요):**
1. 투게더스 설치 폴더 = `C:\Together\` 또는 `C:\TogetherPOS\` 하위 `.ini/.xml/.config/.json`
2. **MS-SQL Server 가동 확인** = `sqlservr.exe` + services.msc "SQL Server" + SQL Server Configuration Manager 인스턴스명/인증모드(Windows Auth/Mixed)/1433 포트
3. Windows ODBC 데이터 원본 → 시스템 DSN 탭
4. 작업관리자 → sqlservr.exe + Together*.exe + `netstat -ano | findstr 1433`
5. 투게더스 매뉴얼/SQL Server 계정(sa 비번) 문서

**MS-SQL Windows Authentication 가능성 = 자격증명 추출 영역 자체 불필요** (사장님 PC administrator 권한이면 자동 접속).

## D159 POS Agent V2 종결 매트릭스 (2026-05-14)

자세한 비토 메모리 = `project_d159_pos_agent_v2.md` 참조.
상세 설계 = `status/FLYER-POS-AGENT-V2.md` 참조.

| Phase | 작업 | 결과 |
|-------|------|------|
| A | V2 설계 문서 신설 (FLYER-POS-AGENT-V2.md 472줄) | 5축 차별성 + 14단계 + 약관 4조 |
| B | Agent 본체 신규 8 모듈 | credential-discovery + db-detector + adapter-registry + adapters/{base,ai-fallback} + mask-bypass + local-cache + tray + remote-command + auto-updater (~2,200줄) |
| C | Agent 본체 3 재작성 통합 | index.ts V2 13단계 + scheduler.ts cache-pusher/auto-updater cron + data-extractor.ts enqueue 패턴 (~770줄) |
| D | Backend CT-F23 + 6 라우트 + my-agent | flyer-pos-remote.ts 신규 + utils/flyer/index.ts export 11개 + routes/flyer/pos.ts 6 라우트 (~400줄) |
| E | DB 마이그레이션 (psql 통과 ✓) | flyer_pos_commands + flyer_pos_adapter_candidates + flyer_credential_discovery_log + flyer_pos_agents ALTER (agent_version + last_update_at) + flyer_settings 신설 + latest_pos_agent_version INSERT |
| F | NSIS 인스톨러 + scripts + 약관 + README | installer.nsi (Unicode true + UTF-8 BOM) + LICENSE-DATA-POLICY.txt 10조 + scripts 4종 (~770줄) |
| G | 매장 사장님 frontend PosAgentPage + App.tsx 메뉴 | 435줄 + 10초 자동 새로고침 + 마스킹 우회 3단 안내 + 약관 요약 |
| H | 슈퍼관리자 PosAgentListPage 재작성 | 510줄 + 5초 자동 새로고침 + agent_version 컬럼 + RemoteCommandModal (6 명령 + REVOKE 확인) + CommandHistoryModal (50건 + 확장 펼침) |
| I | 빌드 검증 (4 패키지 atomic safe-build) | tsc 0 errors + frontend 463KB + admin-frontend 308KB + backend dist/app.js + pos-agent hanjul-pos-agent.exe 99MB → NSIS Setup-1.0.0.exe **18.66 MB** (SHA-256 ce6184d150a73a025061205f597fbb95b0132fa341046866a80618b108094fb6) |
| J | 운영 배포 (서버 git pull + atomic safe-build + pm2 restart) | hanjuldm-api 15:38:04 가동 + /api/flyer/pos/my-agent 401 (인증 미통과 정상) |
| K | nginx config `location ^~ /downloads/` 박음 | HTTPS 443 server block 안 + location /api/ 직전 + curl 검증 Content-Type=octet-stream + Content-Length=19564431 |

**D159 fix 5건 (빌드 과정 중 박힘):**
1. pos-agent `server-client.ts pushData` 반환 타입 정합 (ok=false + error case 박음, scheduler.ts cache-pusher markFailed 분기 활성화)
2. pos-agent `server-client.ts registerAgent` 응답 타입 companyName?: string 추가
3. backend `flyer-pos-remote.ts getLatestAgentInfo` spread 순서 정합 (available 중복 회피)
4. installer/installer.nsi `Unicode true` + UTF-8 BOM 박음 (NSIS 한글 인코딩 fix)
5. installer.nsi assets/icon.ico 라인 placeholder 처리 (별도 .ico 디자인 후 활성화)

**D159 메타 사고 fix (배포 과정 중):**
- nginx config sed/awk 박힘 시 첫번째 `location / {` 매칭이 **HTTP 80 server block** (redirect 영역)에 박힘 → HTTPS 443 server block에 박히지 않음 → SPA fallback. fix = `location ^~ /downloads/` 접두사 + location /api/ 직전 박음 (정규식 우선순위 우회 + 정확 server block 매칭).

## D157+D158 종결 매트릭스 (2026-05-13)

자세한 비토 메모리 = `project_d157_d158_alimtalk_humuson_mirror.md` 참조.

**D157 슈퍼관리자 알림톡 대행** (검수·등록·발신프로필):

| Phase | 작업 | 결과 |
|-------|------|------|
| A | DB `flyer_kakao_*` 6 테이블(sender_profiles/templates/alarm_users/sender_categories/template_categories/webhook_events) + 인덱스 22 + FK 5 + CHECK 1 | psql 검증 통과, FK 모두 flyer_kakao_* 만, 한줄AI kakao_* 참조 0건 |
| B | utils CT-F 5 파일 (alimtalk-api 44 API IMC 컨트롤타워 + alimtalk-jobs 스케줄러 3종 + alimtalk-webhook-handler + alimtalk-result-map + auto-notify-message) | 한줄AI 본진 100% 미러 + flyer_kakao_* 변환 + 한줄AI import 0건 |
| C | routes/admin/alimtalk.ts 슈퍼관리자 대행 24 라우트 | flyerSuperAuthenticate + body.targetCompanyId 필수 + D147/D139/D146/D149-#A 누적 fix 미러 |
| D | routes/flyer/alimtalk.ts 매장 본인 조회 5 라우트 | flyerAuthenticate + req.flyerUser.companyId 자동 격리 |
| E | 웹훅(공개) + 스케줄러 startup + app.ts mount | `[flyer-alimtalk-jobs][scheduler] started` 로그 검증 |
| F | admin-frontend 4 신규(alimtalk-types + AlimtalkManagementPage + AlimtalkSenderModal 2-Step + AlimtalkTemplateModal) + Dashboard 탭 7→8 | 슈퍼관리자 회사 선택 → yellow_id + 폰 → IMC 토큰 → SMS 코드 → createSender 즉시 APPROVED |
| G | frontend AlimtalkPage 자산 조회 + App.tsx 메뉴 | 매장 사장님 검수 진행상황 조회만 |
| H | 빌드 + 배포 + pm2 restart + 운영 검증 | 인비토마트 회사 dropdown + 통계 카드 정상 노출 |

**D157 fix 4건**: contentType axios 타입 좁히기 + Template interface 호환 8 필드 + 응답 키 items 파싱 + localStorage admin_token(App.tsx L11 정합).

**D158 매장 알림톡 발송**:

| Phase | 작업 | 결과 |
|-------|------|------|
| A | flyer_campaigns ALTER 9 컬럼 (kakao_profile_id/kakao_template_id FK + message_template + 6 알림톡) + 2 인덱스 | 본진 campaigns 100% 미러 + flyer_kakao_* FK만 |
| B | utils CT-F05 `replaceFlyerAlimtalkVariables` 신규(`#{변수명}` IMC 표준) + CT-F08 sendFlyerCampaign ALIMTALK 분기(insertAlimtalkQueue 호출, sms-queue.ts L719 이미 박힘) + index.ts export | 변수 치환 #{변수명} customVars 우선 + 표준 매핑 + flyer_campaigns INSERT kakao_* |
| D | routes/flyer/campaigns.ts /send 알림톡 파라미터(template_id/template_code/profile_id/sender_key/kakao_buttons/custom_vars) + 필수 검증 | CT-F08 단일 진입점 통합 유지 |
| G | frontend SendPage 1차 분류 "문자/알림톡" + 발신프로필/템플릿 dropdown + 정보 카드 + 변수 추출/입력 + 샘플 미리보기 | 매장 사장님 발송 시점 알림톡 선택 가능 |

**D158 fix 1건**: deductFlyerPrepaid 시그니처 'ALIMTALK' 추가 (단가 임시 SMS 단가, Phase 1+ flyer_users.alimtalk_unit_price ALTER 별건).

**메타 인프라 fix (D158에 영구 차단)**: frontend safe-build.sh devDependencies 자동 복구 박음(D152 분리 시 누락 보완 + typescript/vite 누락 시 npm install --include=dev 자동) + git pull HEAD SHA 비교 검증 절차.

**한줄AI 영향 0건 보장 매트릭스**: DB FK 모두 flyer_* / Backend import 0건 / IMC API senderKey 공간 공유(충돌 0) / QTmsg 11라인 company_id 분리 / pm2 targetup-backend memory 671MB 안정 + restart count 1520 그대로.

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
