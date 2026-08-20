# 12 슈퍼버전업 검수 — 무기 3: 전단·POP 제작 축 (W3)

> **작성일:** 2026-08-20 · 비토 정밀 검수 1차 (소스 실측 — 추측 0)
> **범위:** URL 전단(flyer-templates 6엔진 4,601줄) · POP 3종 · 인쇄 5종 V3 · 부속 CT 14본(product/) · FlyerPage·PopPage·PrintFlyerPage.
> **핵심 판정:** 부품 수준은 마스터플랜(04)의 가정보다 훨씬 앞서 있다. 문제는 품질이 아니라 **배선이다 — 만들어 둔 무기 3개가 꺼져 있다.**

---

## 1. 자산 실측 (문서에 없던 수준)

| 축 | 상태 |
|---|---|
| URL 전단 | **6엔진 체계로 전면 재작성돼 있음** — STORY(풀스크린 스토리)·MAGAZINE(스크롤텔링)·DEAL FEED(카운트다운 핫딜)·GRID HERO(컬리형)·CATALOG SWIPE(가로 카탈로그)·POSTER PROMO(인쇄풍). placeholder 호출 0 = 전부 실구현. 시즌 토큰 8종 |
| 6매체 토큰 | `design-tokens.ts` SSOT 존재(url/print_a3/pop/mms/alimtalk/brand_landing 6매체 정의) |
| POP | 3종(price/multi/promo) — `generateMediaCssBlock('pop')` 경유(토큰 정합) |
| 인쇄 | 5종 V3 + 양면 + 한국 실무 규격(8절 260×374·B3) — D160~162에서 백지 사고까지 해소·PDF/PNG 발행 검증 |
| MMS·알림톡 이미지 | `media-images.ts` 226줄 — MMS 1080×1920·알림톡 1000×1000 렌더러 **구현돼 있음** |
| 디자인 변형 | `claude-design-renderer.ts` — 시드 기반 6변형(팔레트·타입스케일·데코 강도), AI 호출 0원 구조 |
| 엔진 자동 추천 | `template-recommender.ts` 306줄 |
| 부속 | AI 카피(배선됨 — catalog·flyers) · 네이버 이미지 매칭 346줄 · 카테고리 분류기 · 엑셀 매퍼 · rembg 클라이언트(15초 타임아웃 + 원본 fallback) · og-image |

## 2. 빈틈 (심각도순)

- **A (치명 · 뿌리 하나 = 미배선) 만든 무기 3개의 소비처가 0이다.**
  ① `claude-design-renderer` recommendDesign — 소비처 0 → **매번 같은 디자인**(마스터플랜 트랙 B의 목표 기능이 코드로 있는데 꺼짐)
  ② `template-recommender` — 소비처 0 → 엔진 선택은 수동뿐, 기본값 grid_hero 고정(`short-urls.ts:62`)
  ③ `media-images`(MMS·알림톡 이미지) — 소비처 0 → 발송에 전단 이미지 자동 생성이 안 붙음
  처방 방향 = 생성·발행 경로에 배선 + 발행 시점 variant 스냅샷 저장(재열람 재현성). [[feedback_new_control_must_be_wired_at_every_boundary]] 그대로.
- **B (높음 · 실측 필요) rembg 인프라 가동 여부.** 클라이언트만 있고 서비스(REMBG_URL, 127.0.0.1:5100 도커)가 서버에 떠 있는지 미확인 — 안 떠 있으면 누끼가 전부 원본 fallback = 인쇄·POP 품질 하락. ⚠ 도커 바인딩은 127.0.0.1 원칙.
- **C (높음) 6매체 토큰 정합 반쪽.** POP·MMS·알림톡만 `generateMediaCssBlock` 경유. URL 6엔진과 인쇄 5종은 시즌 토큰 직접 소비 — 매체 간 표류 가능. SSOT 취지 완성 필요.
- **D (중간 · 슈퍼버전업 본체) AI 동적 생성 미착수.** 현 변형은 시드 휴리스틱. 한줄로에서 검증된 원스텝 생성·이미지 스튜디오 패턴(코드 import 금지 — 재구현)이 여기 이식 후보. 상품 사진 → 누끼 → AI 카피 → 엔진 자동 선정 → 6매체 동시 산출이 목표 그림.
- **E (중간) 생성 UX.** FlyerPage는 단일 폼(제목·기간·카테고리·템플릿 선택). 업종별 템플릿 목록은 있으나 자동 추천·1클릭 자동 생성 흐름 없음 — 1클릭 UX 원칙 대비 2차 검수(화면 실측) 필요.
- **F (실측) 전수 실렌더 검수 미실시.** 6엔진 × 시즌 토큰 · POP 3종 · 인쇄 5종 양면을 실제 발행해 눈으로 보는 검수는 서버에서 Harold와 함께(2차).

## 3. W3 마감 순서 제안 (구현은 승인 후)

A 배선 3종(즉효 — 코드 대부분 완성) → C 토큰 정합 → B rembg 가동 → E 1클릭 생성 흐름 → D AI 동적 생성(슈퍼버전업 설계와 함께). F 전수 실렌더는 A 배선 후에 해야 변형까지 한 번에 본다.

## 4. Harold 실측 대기

- rembg 컨테이너 가동 여부: `docker ps | grep -i rembg`
