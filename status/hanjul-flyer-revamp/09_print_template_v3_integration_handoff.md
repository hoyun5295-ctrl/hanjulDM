# 09. 인쇄 전단 V3 시스템 통합 — 다음 세션 인계 (D159 컨텍 한계)

> **작성:** 2026-05-14 (D159 후반, 컨텍 23% 시점)
> **목적:** 다음 세션 비토가 이 문서 1건 정독 + jundantemplet/ 정독으로 즉시 박음 가능
> **선행 자료:**
> - `06_template_redesign_master.md` (V4 동적 디자인 기본)
> - `07_print_template_redesign_master.md` (인쇄 5종 앞면 마스터 프롬프트)
> - `08_print_back_template_master.md` (인쇄 5종 뒷면 마스터 프롬프트)
> - `jundantemplet/` 폴더 = 끌로드 디자인 박은 5종 결과 (앞면 .html + .md, 뒷면 .html, 통합 index.html, design-canvas.jsx, image-slot.js)
> - `packages/backend/src/utils/flyer/product/print/` = V3 시스템 박힘 (D129)

---

## 0. 인계 컨텍스트 한 줄

매장 사장님이 엑셀/POS 업로드 → AI 자동 매핑 → 5종 중 선택 → **양면 인쇄용 PDF 즉시 출력** 시스템. 끌로드 디자인 박은 결과를 V3 시스템(D129 박힘)에 정합 박는 작업. 1종(print_classic_v1) 앞면 박힘, 나머지 4종 + 뒷면 미박힘.

## 1. D159 박힘 상태 (정확)

### 박힘 완료
- `PAPER-SIZES.ts` B3 키 추가 (374×524mm, 한국 인쇄 실무)
- `templates/print_classic_v1/manifest.json` (15 슬롯 박힘 — masthead/hero_title/hero_subline/hero_grid/section_meat/meat_grid/section_fresh/fresh_grid/section_grocery/grocery_grid/footer_notice/footer_qr/back_extra_grid/coupon_grid/back_footer_notice)
- `templates/print_classic_v1/template.html` (앞면만)
- `templates/print_classic_v1/template.css` (앞면 CSS만)

### 박힘 미완 (다음 세션 첫 박음)
- `templates/print_classic_v1/template.html` 뒷면 `<article class="page-back">` 추가
- `templates/print_classic_v1/template.css` 뒷면 CSS 추가 (`.page-back` + `.back-extra-grid` + `.coupon-grid` + `.coupon` + `.pb-footer`)

### 박힘 0건
- `templates/print_deal_focus_v1/` 전체 (manifest + template.html 앞뒤 + template.css)
- `templates/print_magazine_grid_v1/` 전체 (B3, 33 상품)
- `templates/print_gazette_v1/` 전체 (B3, 신문지 무드 + 본명조)
- `templates/print_bento_v1/` 전체 (비대칭 모자이크)
- `renderer/template-registry.ts` 검증 (LoadedTemplate에 back 필드 박혀있는지)
- `renderer/paged-pdf.ts` 양면 검증 (Paged.js page-break-after 박힘 영역)
- `packages/frontend/src/pages/PrintFlyerPage.tsx` 5종 선택 UI
- 4 패키지 tsc 빌드 검증
- atomic safe-build 실 실행

## 2. 다음 세션 비토 진입 즉시 박을 순서 (Step-by-Step)

### Step A. print_classic_v1 정합 정정 (5분)

**A-1. template.html 뒷면 추가**

`<article class="print-canvas page-front">...</article>` 직후 박음:

```html
  <article class="print-canvas page-back" data-template="print_classic" data-paper="B4" data-page="2">

    <!-- ═══ MINI HEADER ═══ -->
    <header class="pb-mini-header">
      <div class="left">
        <strong data-bind="store.name">파인마트</strong>
        <span>WEEKLY · ISSUE 026</span>
      </div>
      <span class="page-num">PAGE 2 / 2</span>
    </header>

    <!-- ═══ SECTION 04 · 추가 카테고리 ═══ -->
    <section class="cat-sec">
      <div class="cat-head">
        <span class="num">04</span>
        <h3>주류 · 베이커리 · 생활</h3>
        <span class="en">BEVERAGE · BAKERY · LIVING</span>
      </div>
      <div class="cat-grid back-extra-grid" data-slot="back_extra_grid">
        <template data-role="card">
          <article class="item">
            <span class="badge" data-bind="badge"></span>
            <div class="ph" data-bind-bg="imageUrl"></div>
            <h4 class="name" data-bind="productName"></h4>
            <span class="unit" data-bind="unit"></span>
            <div class="price-row">
              <span class="original" data-bind="originalPriceFormatted"></span>
              <span class="price"><span data-bind="salePriceFormatted"></span><span class="won">원</span></span>
            </div>
          </article>
        </template>
      </div>
    </section>

    <!-- ═══ COUPON STRIP ═══ -->
    <section class="coupon-sec">
      <div class="cat-head">
        <span class="num">✂</span>
        <h3>절취 쿠폰</h3>
        <span class="en">CUT HERE</span>
        <span class="meta">매장 방문 시 제시</span>
      </div>
      <div class="coupon-grid" data-slot="coupon_grid">
        <template data-role="card">
          <article class="coupon">
            <span class="value" data-bind="discountRate">30%</span>
            <h4 class="title" data-bind="productName"></h4>
            <span class="expiry" data-bind="periodEnd">~05.20</span>
          </article>
        </template>
      </div>
    </section>

    <!-- ═══ BACK FOOTER ═══ -->
    <footer class="pb-footer">
      <p class="notice" data-slot="back_footer_notice">
        * 쿠폰은 1인 1매 한정. 절취 후 매장 방문 시 제시. 사진은 실제와 다를 수 있습니다.
      </p>
    </footer>

  </article>
```

**A-2. template.css 뒷면 CSS 추가** (template.css 맨 끝에 박음):

```css
/* ═══ BACK PAGE ═══ */
.page-back .pb-mini-header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  padding-bottom: 2.4mm;
  border-bottom: 0.3mm solid var(--color-ink);
}
.page-back .pb-mini-header .left {
  display: flex;
  align-items: baseline;
  gap: 3.2mm;
  font-size: 3.5mm;
}
.page-back .pb-mini-header .left strong {
  font-weight: 800;
  font-size: 4.7mm;
  letter-spacing: -0.02em;
}
.page-back .pb-mini-header .left span {
  color: var(--color-mute);
  font-family: var(--f-mon);
  font-size: 2.7mm;
  letter-spacing: 0.1em;
}
.page-back .pb-mini-header .page-num {
  font-family: var(--f-mon);
  font-size: 2.7mm;
  letter-spacing: 0.14em;
  color: var(--color-paper);
  background: var(--color-ink);
  padding: 0.8mm 2.4mm 0.4mm;
}

/* ═══ COUPON ═══ */
.coupon-sec {
  margin-top: 1.6mm;
  padding: 3.9mm 0 3.2mm;
  border-top: 0.5mm dashed var(--color-ink);
  border-bottom: 0.5mm dashed var(--color-ink);
}
.coupon-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3.2mm;
  margin-top: 2.4mm;
}
.coupon {
  border: 0.5mm dashed var(--color-ink);
  padding: 3.2mm;
  display: flex;
  flex-direction: column;
  gap: 1.6mm;
  background: var(--color-paper);
  text-align: center;
}
.coupon .value {
  font-family: var(--f-dis);
  font-weight: 900;
  font-size: 11mm;
  color: var(--color-accent);
  letter-spacing: -0.04em;
  line-height: 0.9;
}
.coupon .title {
  margin: 0;
  font-size: 3.5mm;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.2;
}
.coupon .expiry {
  font-family: var(--f-mon);
  font-size: 2.7mm;
  color: var(--color-mute);
  letter-spacing: 0.08em;
}

/* ═══ BACK FOOTER ═══ */
.pb-footer {
  margin-top: auto;
  border-top: 0.5mm solid var(--color-ink);
  padding-top: 2.4mm;
}
.pb-footer .notice {
  font-size: 2.7mm;
  color: var(--color-mute);
  line-height: 1.5;
}

/* 페이지 분할 */
.page-front { page-break-after: always; }
.page-back { page-break-before: always; }
```

### Step B. 4 신규 종 박음 (각 = manifest + template.html 통합 앞뒤 + template.css)

**모든 종 통합 패턴 (V3 표준):**
- 한 `template.html` 안에 `<article class="page-front">` + `<article class="page-back">` 박음
- manifest `pages: 2`
- assets.back 필드 박지 않음 (template.html 한 파일에 통합)
- CSS = 앞뒤 공통 토큰 + `.page-front` / `.page-back` 분할

**각 종 끌로드 원본 + 슬롯 매핑:**

#### B-1. print_deal_focus_v1 (B4, POP 폭격)

- 원본 = `jundantemplet/print-deal-focus.html` + `print-deal-focus-back.html` + `.md`
- 슬롯 (manifest):
  - `masthead` (store_header) — 얇은 스트립
  - `hero_title` (typography, em 강조 1단어) — "딱 한 가지, 40% 더 좋게"
  - `hero_product` (product_card, variant=hero) — 영웅 1개, 가격 96px
  - `sub_products` (product_grid 3 cols, 서브 3개)
  - `footer_qr` (qr)
  - 뒷면 = `recipe_steps` (rich_text 4단계) + `pairing_grid` (product_grid 6-10) + `store_map` (map) + `back_footer_notice`
- 디자인 토큰: --color-accent #E63946 + --color-paper #F4F1EA (베이지)
- 핵심 = 가격 96px (300dpi 변환 시 36mm) + 할인 스탬프 (transform: rotate(4deg))

#### B-2. print_magazine_grid_v1 (B3, 33 상품 + 다크 헤로)

- 원본 = `jundantemplet/print-magazine-grid.html` + `-back.html` + `.md`
- 슬롯 (manifest):
  - `masthead` (store_header)
  - `hero_title` (typography, em 강조)
  - `hero_grid` (product_grid 3 영웅) — 다크 헤로 밴드 안
  - `cat_meat_grid` (category_grid prefer=["정육","축산"], 6 items)
  - `cat_seafood_grid` (prefer=["수산","활어"], 6)
  - `cat_produce_grid` (prefer=["농산","청과"], 6)
  - `cat_grocery_grid` (prefer=["가공","델리"], 6)
  - `cat_beverage_grid` (prefer=["주류","음료"], 6)
  - `footer_qr` + `footer_member` (text)
  - 뒷면 = 추가 5 카테고리 × 6 (베이커리/냉동/생활/뷰티/유아) + `member_tier` (rich_text 3 등급) + `calendar_grid` (4주 행사)
- paper.size = "B3"
- 디자인 토큰: --c-accent #E63946 + --c-green #1B4332 + --c-ink #1A1A1A (다크 헤로 = C40 M30 Y30 K85)

#### B-3. print_gazette_v1 (B3, 신문지 무드)

- 원본 = `jundantemplet/print-gazette.html` + `-back.html` + `.md`
- 슬롯 (manifest):
  - `masthead` (store_header) — 마스트헤드 "<em>&</em> GAZETTE" 신문 제호화
  - `editor_letter` (rich_text 60자) — deck text
  - `hero_product` (product_card variant=feature) — 1:1.05 누끼
  - `col_grid_1` (product_grid 4 cols × 2 rows = 8) — SEC.01 오늘의 식탁
  - `col_grid_2` (product_grid 4 × 2 = 8) — SEC.02 고기 그리고 일상
  - `editorial_quote` (rich_text + 드롭캡) — 매장 인터뷰
  - `footer_colophon` (text)
  - 뒷면 = `col_grid_3/4` + `editor_interview` (rich_text) + `next_issue_preview` (text)
- paper.size = "B3"
- 디자인 토큰: --c-ink #1A1812 (따뜻한 검정) + --c-paper #F1ECDF (신문 베이지) + --c-accent #B83B2E (빈티지 빨강 = C0 M85 Y75 K15)
- 폰트: Noto Serif KR 본문 (신문지 무드 핵심) + Pretendard 보조

#### B-4. print_bento_v1 (B4, 비대칭 모자이크)

- 원본 = `jundantemplet/print-bento.html` + `-back.html` + `.md`
- 슬롯 (manifest):
  - `masthead` (store_header)
  - `hero_title` (typography, T 머스타드 배너 안)
  - `hero_product` (product_card 3×3 풀블리드)
  - `small_grid` (product_grid 3 cols × 1 row = 3) — s1/s2/s3 미니
  - `std_grid_1` (product_grid 2 cols × 1 row = 2) — B 타일 2×2
  - `std_grid_2` (product_grid 2 × 1 = 2) — C
  - `std_grid_3` (product_grid 2 × 1 = 2) — D
  - `wide_product` (product_card, variant=wide) — E 3×2 분할
  - `dark_quote` (rich_text) — G 1×2 다크 인용
  - `std_grid_4/5/6` (각 product_grid 2 × 1)
  - `footer_qr`
  - 뒷면 = 다른 grid-template-areas + `store_map` + `store_hours` (text) + `store_parking` (text) + `member_benefit` (rich_text)
- paper.size = "B4"
- 디자인 토큰: --c-mustard #D4A93B (T 배너) + --c-dark #1A1A1A (G 다크) + --c-cream #F2EBD8 (이미지 underlay)
- CSS = `grid-template-areas` 비대칭 6×9 (앞면), 다른 패턴 (뒷면)

### Step C. paged-pdf.ts 양면 검증 (3분)

```bash
# 정독해서 박힘 여부 확인
grep -n "page-break\|pages\|skipPagedJs" packages/backend/src/utils/flyer/product/print/renderer/paged-pdf.ts
```

- `assembleHtml`에 page-break-after 박혀있는지 확인
- `pages: 2` manifest 박힌 템플릿 → Paged.js가 자동 분할
- 만약 미박힘 시 = `assembleHtml`에 `@media print { .page-front { page-break-after: always; } }` 추가

### Step D. template-registry.ts 검증 (3분)

```bash
grep -n "TemplateManifest\|LoadedTemplate\|assets" packages/backend/src/utils/flyer/product/print/renderer/template-registry.ts
```

- `TemplateManifest.assets` 타입에 `back?: string` 박혀있는지 (박혀있으면 무관, 없으면 정합)
- `loadTemplate()` 자동 폴더 스캔 = 신규 5종 박은 후 자동 등록 (Edit 불필요)
- 단, 검증 함수가 `back` 필드 미허용 시 Edit (`back?: string` 추가)

### Step E. frontend PrintFlyerPage 5종 선택 UI

`packages/frontend/src/pages/PrintFlyerPage.tsx` 박혀있는지 확인:
```bash
ls packages/frontend/src/pages/PrintFlyerPage.tsx
```

- 박혀있으면 = 5종 선택 영역 확장 (기존 4종 + 신규 5종 = 9종)
- 박혀있지 않으면 = 신규 박음

박을 영역:
- 5종 카드 그리드 (각 = preview.png + 이름 + 설명 + 상품 수)
- 선택 후 = 엑셀 업로드 → POST `/api/flyer/print/render` → PDF 다운로드
- 미리보기 = puppeteer PNG (format='png' + pngScale=2)
- 사이드바 = 매장 정보 입력 (store.name/branch/period/phone/address) + AI 카피 추천

### Step F. tsc 빌드 + atomic safe-build

```bash
# pos-agent
cd packages/pos-agent && npx tsc --noEmit

# backend
cd packages/backend && npx tsc --noEmit

# frontend
cd packages/frontend && npx tsc --noEmit

# admin-frontend
cd packages/admin-frontend && npx tsc --noEmit

# 4 패키지 모두 0 errors 확인 후
cd C:/Users/ceo/projects/hanjulDM && bash scripts/safe-build.sh
```

## 3. V3 시스템 호환 규약 (절대 준수)

### 슬롯 13 타입
- `text` / `rich_text` / `typography` / `image` / `qr` / `map` / `product_card` / `product_grid` / `category_grid` / `section_banner` / `store_header` / `footer_notice` / `decoration`

### HTML 연결 패턴
- 컨테이너 = `data-slot="slot_id"` (manifest의 slot.id 매칭)
- 값 바인딩 = `data-bind="field.name"` (slot-filler가 dot notation 처리)
- 배경 이미지 = `data-bind-bg="imageUrl"` (background-image url 자동)
- 그리드 카드 = `<template data-role="card">` + 내부 `data-bind`

### manifest 표준
```json
{
  "id": "print_xxx_v1",
  "version": "1.0.0",
  "name": "한글 이름",
  "description": "설명",
  "industry": "mart",
  "season": "general",
  "paper": { "size": "B4" | "B3", "orientation": "portrait" },
  "pages": 2,
  "assets": { "html": "template.html", "css": "template.css", "preview": "preview.png" },
  "slots": [...]
}
```

### 양면 패턴
- manifest `pages: 2`
- `template.html` 한 파일 안에 `<article class="print-canvas page-front">` + `<article class="print-canvas page-back">`
- CSS `.page-front { page-break-after: always; }` + `.page-back { page-break-before: always; }`
- `@page { size: WIDTHmm HEIGHTmm; margin: 0; bleed: 2mm; marks: crop cross; }`

## 4. CSS 표준 패턴 (전 종 동일)

### 디자인 토큰 (5종 공통)
```css
:root {
  --color-accent: #E63946;
  --color-accent-2: #1B4332;
  --color-paper: #FAF8F4;
  --color-ink: #1A1A1A;
  --color-mute: #6B7280;
  --color-rule: #D9D7D2;
  --f-dis: 'Pretendard Variable', sans-serif;
  --f-ser: 'Noto Serif KR', serif;
  --f-mon: 'JetBrains Mono', ui-monospace, monospace;
}
```

### 종별 차별 토큰
- `print_deal_focus_v1`: --color-paper #F4F1EA (베이지)
- `print_gazette_v1`: --color-ink #1A1812 + --color-paper #F1ECDF + --color-accent #B83B2E
- `print_bento_v1`: --c-mustard #D4A93B 추가 + --c-cream #F2EBD8

### 폰트 import (전 종 동일)
```css
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css');
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;700;900&family=JetBrains+Mono:wght@400;500&display=swap');
```

### 인쇄 안전 (전 종 동일)
```css
* {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
@page {
  size: 260mm 374mm; /* B4 — B3는 374mm 524mm */
  margin: 0;
  marks: crop cross;
  bleed: 2mm;
}
```

### mm 단위 변환표 (300dpi 정합)
- 1mm = 11.811 px @ 300dpi
- 끌로드 px → mm 변환: px / 11.811 ≈ mm
- 예: 끌로드 30px = ~2.5mm / 끌로드 96px = ~8.1mm / 끌로드 240px = ~20mm

## 5. 끌로드 디자인 원본 위치 (jundantemplet/)

| 종 | 앞면 HTML | 뒷면 HTML | 명세 .md |
|---|----------|----------|---------|
| classic | `print-classic.html` | `print-classic-back.html` | `print-classic.md` |
| deal-focus | `print-deal-focus.html` | `print-deal-focus-back.html` | `print-deal-focus.md` |
| magazine-grid | `print-magazine-grid.html` | `print-magazine-grid-back.html` | `print-magazine-grid.md` |
| gazette | `print-gazette.html` | `print-gazette-back.html` | `print-gazette.md` |
| bento | `print-bento.html` | `print-bento-back.html` | `print-bento.md` |

**제외 (V3 시스템에 박지 않음):**
- `jundantemplet/index.html` (Figma 캔버스 통합 미리보기, omelette runtime 의존)
- `jundantemplet/design-canvas.jsx` (omelette runtime 컴포넌트)
- `jundantemplet/image-slot.js` (omelette runtime 의존, V3 시스템과 별도)
- `jundantemplet/uploads/` (참고 자료)

## 6. 끌로드 → V3 변환 규칙

| 끌로드 패턴 | V3 패턴 |
|-----------|---------|
| `data-slot="store.name"` | 컨테이너 `data-slot="masthead"` + 내부 `data-bind="store.name"` |
| `data-slot="product[0].price"` | `data-slot="hero_grid"` 컨테이너 + `<template data-role="card">` + `data-bind="salePriceFormatted"` |
| `data-slot-group="product[0]"` | `<template data-role="card">` 자식 박음 |
| px 단위 (660×945) | mm 단위 (260×374) — px / 11.811 = mm |
| `<link rel="stylesheet">` 외부 폰트 | `@import url(...)` template.css 안 |
| `<style>` 인라인 | `<style>{{INLINE_CSS}}</style>` 박음 (paged-pdf가 치환) |
| body 박힘 | `<article class="print-canvas page-front">` 1개 / 양면 시 page-back 추가 |

## 7. RawProduct 필드 (slot-filler가 박는 값)

`slot-filler.ts`의 `toCardViewModel` 박는 필드 = `<template data-role="card">` 안에서 `data-bind`로 참조:

| 필드 | 의미 |
|------|------|
| `productName` | 상품명 |
| `imageUrl` | 이미지 URL (data-bind-bg) |
| `salePriceFormatted` | 할인가 (콤마 박힘) |
| `originalPriceFormatted` | 원가 (취소선, 빈 값 시 빈 문자열) |
| `unit` | 단위 |
| `category` | 카테고리 |
| `badge` | 자동 박힘 ("BEST"/"PICK"/"HOT"/"추천") |
| `ribbon` | 자동 박힘 (할인율 기반) |
| `discountRate` | 할인율 (숫자) |
| `aiCopy` | AI 카피 (선택) |
| `origin` | 원산지 (선택) |

## 8. 박힘 후 검증 명령

```bash
# 5종 폴더 박힘 확인
ls packages/backend/src/utils/flyer/product/print/templates/
# 박힘 = mart_hot_v1, mart_premium_v1, mart_spring_v1, mart_weekend_v1,
#       print_classic_v1, print_deal_focus_v1, print_magazine_grid_v1, print_gazette_v1, print_bento_v1

# manifest 검증 (각 종별)
for tpl in print_classic_v1 print_deal_focus_v1 print_magazine_grid_v1 print_gazette_v1 print_bento_v1; do
  echo "=== $tpl ==="
  cat packages/backend/src/utils/flyer/product/print/templates/$tpl/manifest.json | head -20
done

# tsc 빌드 4 패키지 (각각 0 errors)
cd packages/pos-agent && npx tsc --noEmit && cd ../..
cd packages/backend && npx tsc --noEmit && cd ../..
cd packages/frontend && npx tsc --noEmit && cd ../..
cd packages/admin-frontend && npx tsc --noEmit && cd ../..

# atomic safe-build
bash scripts/safe-build.sh

# 테스트 렌더 (1종 PDF 출력 검증)
cd packages/backend && npx ts-node src/utils/flyer/product/print/test-render.ts
```

## 9. 다음 세션 비토 진입 첫 문장 (주인님 명령)

"hanjulDM 인쇄 전단 V3 시스템 박음 마무리. `status/hanjul-flyer-revamp/09_print_template_v3_integration_handoff.md` 정독 + Step A부터 F까지 순차 박음. 단 추측 X, 헛소리 X, 끌로드 원본(jundantemplet/) + V3 시스템 정독해서 정확 박음."

## 10. 비토 진입 시 의식할 점

1. **CLAUDE.md 원칙 정독** = no_option_recommend / answer_format_strict / 매 Edit 직전 체크리스트 박음
2. **무리하지 말 것** = 5종 모두 한 turn에 박지 말 것. 한 종 = 1~2 turn 분할
3. **V3 시스템 호환 절대** = data-slot/data-bind/template card 패턴 그대로
4. **mm 단위** = px / 11.811 변환 (300dpi 정합)
5. **양면 = 통합 1 HTML** = page-break-after, assets.back 박지 말 것
6. **manifest 슬롯 검증** = `position.css` 셀렉터가 template.html에 실재해야
7. **끌로드 원본 그대로 디자인 토큰 + 색상** = 변형 X (디자인 완성도 95% 유지)

## 11. 묶음 B/C 인계 (인쇄 마무리 후)

인쇄 5종 박힘 + 빌드 검증 통과 후 진입:

### 묶음 B — 드래그 + 잠금 + 카테고리 swap
- @dnd-kit/core 의존성 박음
- DraggableProductSlot 컴포넌트
- 슬롯 swap 로직 (`product[0]` ↔ `product[3]`)
- Lock 토글 UI + state
- 카테고리 그룹 swap (정육 ↔ 수산 그룹 전체)

### 묶음 C — 이력 학습 + A/B 비교
- DB `flyer_drag_history` 테이블 신설
- 매주 사장님 패턴 분석
- AI 추천판 vs 사장님 편집판 양쪽 PDF 생성
- 성과 비교 UI

---

> **본 문서 = 다음 세션 비토 즉시 박음 가능한 단일 인계.**
> 이 문서 1건 + jundantemplet/ 정독 + CLAUDE.md 원칙 정독 = 5종 인쇄 전단 시스템 마무리 가능.
