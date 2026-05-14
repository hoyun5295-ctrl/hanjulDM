# 07. 인쇄전단 템플릿 3종 — 끌로드 디자인 마스터 프롬프트

> **작성:** 2026-05-14 (D159)
> **목적:** 매장 사장님 엑셀/POS 업로드 → AI 자동 매핑 → 모던/세련 인쇄용 PDF 출력
> **기준 자료:**
>  - `마트전단지_인쇄용_PDF_가이드.pdf` (해상도/색상/PDF/X 규격/사이즈/도련/폰트/TAC)
>  - master plan §1-2 트랙 B (Claude Design + Opus 4.7 동적 생성)
>  - D154 V4 6 엔진 + D155 5 신규 엔진 ProductSlot 패턴
>  - 첨부 스샷 예시 (주인님 별도 전달)
> **출력:** 3종 인쇄 전용 HTML/CSS 템플릿 + 디자인 토큰 + 매핑 슬롯 명세

---

## 끌로드 디자인 마스터 프롬프트 (그대로 박음)

```
당신은 한국 마트 인쇄 전단지 전문 디자이너입니다. 기존 한줄전단AI 디지털 6 엔진
(STORY/MAGAZINE/DEAL FEED/GRID HERO/CATALOG SWIPE/POSTER PROMO)의 모던 감각을
유지하면서, 한국 마트 인쇄 표준 규격(B4 264×378mm, 300dpi CMYK, PDF/X-1a)에
정합한 인쇄 전용 템플릿 3종을 박아주세요.

[목표]
매장 사장님이 엑셀/POS 데이터를 업로드하면 한줄전단AI가 자동 매핑하여
인쇄소에 즉시 발주 가능한 PDF로 출력하는 시스템의 HTML/CSS 템플릿.

[디자인 톤 — 모던 + 세련]
- 전통 마트 전단지 = "정보 폭격형, 빈티지 디자인"
- 우리 목표 = "외주 디자이너보다 압도적으로 세련된 인쇄물, 매장 벽에 붙여도
  멋있는 결과물"
- 첨부 스샷 예시의 디자인 감각 참조 (Magazine Zine / Deal Bento / Grid Muji 무드)
- 색상 = 1차 컬러 1개 + 강조 컬러 1개 + 중립 그레이 3톤 (총 5색 한정)
- 폰트 = Pretendard Variable (제목 800/본문 500/가격 900) + 본명조 (강조용)
- 여백 = 충분히 (전단지 답지 않게, 매거진 무드)
- 그리드 = CSS Grid 8 또는 12 column
- 가격 표현 = 큰 숫자 단순 강조 + 천 단위 콤마 + ₩ 또는 "원" 작게


[인쇄 사양 — 절대 준수]

| 항목 | 값 |
|------|---|
| 사이즈 (편집) | B4 264×378mm (재단 260×374 + 도련 2mm) |
| 사이즈 (B3 옵션) | 378×528mm (재단 374×524 + 도련 2mm) |
| 해상도 | 300dpi (CMYK 픽셀 환산: B4 = 3,071×4,417px) |
| 색상 모드 | CMYK 전제, RGB 0건 |
| 검정 텍스트 | C0 M0 Y0 K100 (4도 혼합 금지) |
| 잉크 총량(TAC) | 240~280% 이하 |
| 도련(Bleed) | 사방 2mm — 배경은 도련 끝까지 |
| 안전영역 | 재단선 안쪽 3mm 이상 — 가격/로고/매장명 5mm 안쪽 |
| 색상 농도 | 10% 이상 (10% 미만 = 인쇄 누락 위험) |
| PDF 규격 | PDF/X-1a:2001 호환 (HTML→PDF 변환은 puppeteer가 처리, 디자인은 인쇄 호환만 보장) |


[3종 인쇄 전용 템플릿 — 박을 영역]

### 1. PRINT_CLASSIC (B4 단면)
"가장 흔한 동네 마트 / 식자재 전단지"의 모던 재해석.
- 상단 = 매장 로고 (좌) + 매장명 큰 글자 (중) + 행사 기간 (우)
- 메인 카피 1줄 (예: "12월 첫째주 특가") — 큰 글자, 1차 컬러
- 메인 그리드 = 상품 8~12개 (3×3 또는 4×3)
  - 각 상품 = 이미지(누끼) + 상품명 + 원가(취소선) + 할인가(강조) + 단위
  - 강조 상품 1~2개 = 더 큰 슬롯 + "BEST"/"NEW" 배지
- 하단 = 매장 주소 + 전화번호 + QR 코드 (단축 URL) + 푸터 안내
- 여백 = 매거진 무드, 빈 공간 30% 이상

### 2. PRINT_DEAL_FOCUS (B4 단면, POP 스타일)
"1~2개 메인 상품 폭풍 강조" — 정육/수산/계절 과일 같은 단일 카테고리 폭탄 행사.
- 화면 70% = 메인 상품 1개의 풀스크린 비주얼 + 가격 폭격
  - 가격 = 화면 1/3 차지하는 큰 숫자
  - 원가 취소선 + 할인율 배지 (예: "50% OFF")
- 화면 20% = 서브 상품 2~3개 작은 슬롯
- 화면 10% = 매장 정보 + QR 코드
- 시각 우선순위 = 가격 > 상품 이미지 > 매장명
- POP 무드 (POSTER_PROMO 인쇄 버전)

### 3. PRINT_MAGAZINE_GRID (B3 단면, 대형마트 타블로이드)
"대형마트 주말 전단" — 카테고리별 분류 + 상품 12~20개 + 시즌감.
- 좌측 30% = 매장 브랜드 영역 (로고 + 매장명 큰 글자 + 메인 카피 + 행사 기간 + 매장 사진 또는 시즌 비주얼)
- 우측 70% = 카테고리 그리드 (4~6 카테고리)
  - 각 카테고리 = 상위 헤더 (예: "정육", "수산", "농산", "주류")
  - 카테고리 안 상품 = 2~4개 슬롯 (이름 + 가격만)
- 하단 = 매장 주소 + 전화번호 + QR + 회원 혜택 안내
- 매거진 zine 무드 (MAGAZINE_ZINE 인쇄 버전)


[매핑 슬롯 명세 — 엑셀/POS 자동 매핑 필수]

각 템플릿은 다음 슬롯을 정확히 박아주세요. HTML에 `data-slot="..."` 속성으로 명시:

매장 영역 (공통):
- data-slot="store.name"          (매장명, 최대 20자)
- data-slot="store.logo"           (img src 또는 SVG)
- data-slot="store.address"        (주소 1줄)
- data-slot="store.phone"          (전화번호)
- data-slot="store.qrcode"          (QR 코드 이미지)
- data-slot="store.period"          (예: "12.18 ~ 12.24")

카피 영역:
- data-slot="copy.headline"        (메인 카피 1줄, 최대 30자)
- data-slot="copy.subline"          (서브 카피 1줄, 최대 40자, 선택)

상품 슬롯 (반복):
- data-slot="product[N].name"      (상품명, 최대 20자)
- data-slot="product[N].image"     (이미지 누끼 PNG)
- data-slot="product[N].price"      (할인가, 숫자만)
- data-slot="product[N].original"   (원가, 숫자만, 선택)
- data-slot="product[N].discount"   (할인율 %, 숫자만, 선택)
- data-slot="product[N].unit"        (단위, 예: "100g", "1팩", "1L")
- data-slot="product[N].badge"      (배지 라벨, 예: "BEST", "NEW", "30% OFF")
- data-slot="product[N].category"   (카테고리, MAGAZINE_GRID 전용)

푸터 영역 (공통):
- data-slot="footer.notice"         (주의사항/조건, 최대 60자)
- data-slot="footer.member"          (회원 혜택 안내, 선택)


[색상 + 폰트 디자인 토큰 (CSS 변수로 박음)]

:root {
  /* 1차 컬러 — 매장별 커스텀 가능 */
  --color-primary: #1A1A1A;     /* 짙은 차콜 (기본) */
  --color-accent: #E63946;      /* 강조 빨강 (가격 강조) */
  --color-neutral-100: #F7F7F7; /* 배경 화이트 */
  --color-neutral-500: #6B7280; /* 본문 그레이 */
  --color-neutral-900: #1A1A1A; /* 진한 텍스트 = K100 호환 */

  /* 폰트 */
  --font-display: 'Pretendard Variable', 'Pretendard', sans-serif;
  --font-body: 'Pretendard Variable', 'Pretendard', sans-serif;
  --font-serif: 'Noto Serif KR', '본명조', serif;  /* 강조용 */

  /* 사이즈 (B4 기준 mm → px @ 300dpi) */
  --canvas-width: 3120px;   /* 264mm */
  --canvas-height: 4465px;  /* 378mm */
  --bleed: 24px;            /* 2mm */
  --safe-margin: 36px;      /* 3mm */
  --priority-margin: 60px;  /* 5mm — 핵심 정보용 */

  /* 가격 표현 */
  --price-display-size: 240px;   /* 큰 가격 (PRINT_DEAL_FOCUS) */
  --price-grid-size: 96px;       /* 그리드 가격 (PRINT_CLASSIC) */
}


[HTML 구조 예시 (PRINT_CLASSIC)]

<article class="print-canvas print-classic" data-template="print_classic" data-paper="B4">
  <header class="print-header">
    <img data-slot="store.logo" />
    <h1 data-slot="store.name">매장명</h1>
    <span data-slot="store.period">12.18 ~ 12.24</span>
  </header>

  <section class="print-headline">
    <h2 data-slot="copy.headline">12월 첫째주 특가</h2>
  </section>

  <section class="print-product-grid">
    <article class="print-product" data-slot-group="product[0]">
      <img data-slot="product[0].image" />
      <h3 data-slot="product[0].name">삼겹살</h3>
      <span class="badge" data-slot="product[0].badge">BEST</span>
      <span class="original" data-slot="product[0].original">15,000</span>
      <strong class="price" data-slot="product[0].price">9,900</strong>
      <span class="unit" data-slot="product[0].unit">100g</span>
    </article>
    <!-- product[1] ~ product[N] 반복 -->
  </section>

  <footer class="print-footer">
    <span data-slot="store.address">서울시 ...</span>
    <span data-slot="store.phone">02-...</span>
    <img class="qr" data-slot="store.qrcode" />
    <small data-slot="footer.notice">* 한정 수량, 조기 품절될 수 있습니다.</small>
  </footer>
</article>


[CSS — 인쇄 안전 영역 박음 의무]

.print-canvas {
  width: var(--canvas-width);
  height: var(--canvas-height);
  padding: var(--priority-margin);  /* 핵심 정보는 5mm 안쪽 */
  box-sizing: border-box;
  background: var(--color-neutral-100);
  position: relative;
}

.print-canvas::before {
  /* 도련 가이드 — 인쇄 시 제거 */
  content: "";
  position: absolute;
  top: var(--bleed);
  left: var(--bleed);
  right: var(--bleed);
  bottom: var(--bleed);
  border: 1px dashed transparent; /* 디버그 시 표시 */
  pointer-events: none;
}

.print-product .price {
  font-family: var(--font-display);
  font-weight: 900;
  font-size: var(--price-grid-size);
  color: var(--color-accent);  /* 가격만 강조색, 나머지 텍스트는 K100 */
  letter-spacing: -0.02em;
}

.print-product .original {
  text-decoration: line-through;
  color: var(--color-neutral-500);
  font-size: calc(var(--price-grid-size) * 0.4);
}


[출력 영역 — 박아주실 영역 3종]

각 템플릿마다 다음 4건 박아주세요:

1. **HTML** = `print-{template}.html` (slot data 속성 박힘, 샘플 더미 데이터 포함)
2. **CSS** = `print-{template}.css` (디자인 토큰 + 인쇄 안전 영역 박힘)
3. **디자인 명세** = `print-{template}.md` (
     - 슬롯 매핑표 (data-slot 이름 + 의미 + 최대 글자/픽셀)
     - 색상 + 폰트 토큰 일람
     - 인쇄 사양 체크리스트 (300dpi/CMYK/K100/TAC/도련)
     - 변형 가능 영역 (사장님이 커스텀 가능한 컬러 변수)
   )
4. **샘플 미리보기** = `print-{template}-preview.png` (1000px 너비, 실제 인쇄물 시뮬레이션)


[제약 — 절대 준수]

- 모든 텍스트 색상은 var(--color-neutral-900) 기본 (K100 = CMYK 검정)
- 색상 농도 10% 미만 안 사용 (예: rgba(0,0,0,0.05) 금지)
- 그라데이션 사용 시 = 단순 2색 + 큰 영역 (작은 영역 그라데이션 인쇄 시 깨짐)
- 폰트 크기 = 본문 18pt 이상, 작은 안내문 12pt 이상 (인쇄 가독성)
- 이미지는 누끼 PNG 권장 (배경 있으면 흰 종이와 충돌)
- box-shadow 같은 효과는 최소화 (인쇄 시 깨짐 위험, 사용해도 단순 그림자 1단)
- transform: rotate() 같은 회전 효과는 신중 (인쇄 정렬 위험)


[참조 — 기존 한줄전단AI V4 디지털 6 엔진 (디자인 무드 정합용)]

- STORY = 세로 스크롤 매거진형
- MAGAZINE_ZINE = 매거진 zine 무드, 빈 공간 + 타이포 강조
- DEAL_FEED / DEAL_BENTO = 가격 폭격 그리드
- GRID_HERO / GRID_MUJI = 미니멀 무지 무드 그리드
- CATALOG_SWIPE / CATALOG_DARK = 카탈로그 카드 스와이프
- POSTER_PROMO / POSTER_POP = 포스터 폭격 단일 비주얼

위 6+5 엔진 중 인쇄 정합 가능한 3종 (MAGAZINE_ZINE + DEAL_FEED/BENTO + GRID_MUJI 또는 POSTER_PROMO)의 인쇄 버전이라 생각하고 박아주세요.


[종료]

3종 박힘 + 첨부 PDF 가이드 호환 + 한줄전단AI 매핑 슬롯 정합 = 한 번에 박을 수 있도록 정확하게 부탁드립니다.
```

---

## 비토 추가 안내 (주인님이 끌로드 디자인에 함께 박을 자료)

**박을 첨부 자료 3건:**
1. **이 .md 파일** = 위 마스터 프롬프트
2. **`마트전단지_인쇄용_PDF_가이드.pdf`** = 인쇄 사양 정확 자료 (PDF 그대로)
3. **첨부 스샷 예시** = 주인님이 직접 가지신 디자인 무드 참조 이미지

**박힘 후 비토 작업 (다음 세션):**
- 끌로드 디자인이 박은 3종 HTML/CSS → 비토가 `hanjulDM/packages/backend/src/utils/flyer/product/print/` 영역에 박음:
  - `print-classic-template.tsx` (PRINT_CLASSIC)
  - `print-deal-focus-template.tsx` (PRINT_DEAL_FOCUS)
  - `print-magazine-grid-template.tsx` (PRINT_MAGAZINE_GRID)
- `template-registry.ts` 확장 = 3종 추가 (인쇄 전용 카테고리)
- `paged-pdf.ts` 정합 = 인쇄용 CMYK 변환 + PDF/X-1a 호환
- 매장 사장님 frontend `PrintFlyerPage` 확장 = 인쇄 전용 3종 선택 UI

**비토 결론:** 끌로드 디자인이 박은 HTML/CSS 결과를 받으시면 비토가 V4 ProductSlot 패턴으로 미러해서 hanjulDM에 박을 수 있습니다. 매핑 슬롯 명세가 정확히 박혀있어서 엑셀/POS 자동 매핑도 즉시 동작합니다.
