# 10. 인쇄 전단 5종 PNG/PDF 백지 사고 — 미해결 (D160 인계)

> **작성:** 2026-05-14 (D160 후반, Harold 김포공항 시간 한계 + 비토 가설 반복으로 진척 0)
> **상태:** 🔴 **미해결, 다음 세션 최우선 해결 의무**
> **선행 자료:** `09_print_template_v3_integration_handoff.md` (D159 인계, V3 시스템 5종 박은 직후)

---

## 0. 사고 한 줄 요약

신규 print 5종 (`print_classic_v1` / `print_deal_focus_v1` / `print_magazine_grid_v1` / `print_gazette_v1` / `print_bento_v1`) 발행 시 **PDF 848 bytes + PNG 21~44KB 모두 완전 백지** (배경색도 없음). Paged.js가 `page count 1`만 만들고 양면 분할 못 함.

**미해결**. 진짜 root cause 모름.

---

## 1. 검증된 사실 (전부 직접 확인됨, 추측 0)

### 1-1. 코드 + 빌드 + 적용 모두 정상

| 항목 | 검증 결과 |
|---|---|
| backend src 5종 manifest/template.html/template.css | 정상 작성 (15 파일) |
| backend dist/utils/flyer/product/print/templates/ | 9 폴더 정상 (mart 4 + print 5) |
| `safe-build.sh` 정적 파일 copy 단계 | 추가됨, dist에 templates/assets/design-tokens.json 정상 박힘 |
| `slot-filler.ts` FILL_RUNTIME 자동 감지 (`Array.isArray(value.items)`) | dist에 2회 매칭 (적용 확인) |
| pm2 restart | 적용됨 (운영 발행 200 응답) |
| backend tsc --noEmit | 4 패키지 EXIT=0 |

### 1-2. test-render.ts 실행 결과 (D160 14:08 기준)

```
[paged-pdf] template loaded { id: 'print_deal_focus_v1', paper: 'B4', orientation: 'portrait', format: 'pdf' }
[paged-pdf] slot data resolved [
  'masthead', 'hero_title', 'hero_product', 'sub_products',
  'footer_info', 'footer_notice', 'footer_qr',
  'pb_mini_header', 'pairing_grid', 'store_map',
  'back_footer_info', 'back_footer_notice'
]
[page] warn A parser-blocking, cross site script https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js ...
[paged-pdf] content set
[paged-pdf] slots filled
[paged-pdf] paged.js done
[paged-pdf] page count 1     ← ★ 핵심: pages: 2 manifest인데 1 page만
[paged-pdf] pdf generated 848    ← 빈 PDF
[paged-pdf] debug screenshot captured 21880    ← 빈 PNG
   PDF: 0.8 KB / PNG: 21.4 KB / 용지: B4 (portrait) / 페이지: 1 / 소요시간: 467 ms
```

### 1-3. debug HTML 직접 정독 (test-render가 박은 setContent 직전 HTML)

`/home/administrator/hanjuldm-app/packages/backend/packages/backend/pdfs/print_deal_focus_v1_test.html` 정독:

```html
<style>
  ...
  .page-front { page-break-after: always; }
  .page-back { page-break-before: always; }
  ...
</style>

<body>
  <section class="page-front">
    <article class="print-canvas" data-template="print_deal_focus" data-paper="B4" data-page="1">
      ...
    </article>
  </section>

  <section class="page-back">
    <article class="print-canvas" data-template="print_deal_focus" data-paper="B4" data-page="2">
      ...
    </article>
  </section>
</body>
```

**즉 두 section + 두 article + page-break-after/before CSS 모두 정상 박힘.** Paged.js가 그걸 1 page로 만든 게 사고.

---

## 2. 비토가 시도한 fix (전부 효과 0, 가설로 박은 거 인정)

| # | fix 시도 | 가설 | 실제 결과 |
|---|---|---|---|
| 1 | `paged-pdf.ts` `preferCSSPageSize: true` 제거 + 명시적 width/height | preferCSSPageSize와 .pagedjs_pages 충돌 | commit X (Harold 일부러 안 박음, 옳은 판단) |
| 2 | 5종 template.html `<article class="print-canvas page-front">` → `<section class="page-front"><article class="print-canvas">` 분리 | `display: grid + overflow: hidden` 박힌 article을 Paged.js fragmenter가 분할 못 함 | **page count 1 그대로, 효과 0** |

**즉 시도한 fix 2개 모두 root cause 아님 확정.**

---

## 3. 현재 박혀있는 코드 상태 (commit `ee82c5b` 이후 + 추가 변경)

### 3-1. commit 박힌 변경 (`ee82c5b`)
- `safe-build.sh` 정적 파일 copy 단계 추가 (이건 정합)

### 3-2. **commit 안 된 로컬 변경** (시도 #2, 효과 0)
- `templates/print_classic_v1/template.html`
- `templates/print_deal_focus_v1/template.html`
- `templates/print_magazine_grid_v1/template.html`
- `templates/print_gazette_v1/template.html`
- `templates/print_bento_v1/template.html`

위 5개 파일에 article → section wrapper 박은 변경 들어감. **이 변경은 root cause 아님이 검증됨**. 다음 세션에서 정리 필요:
- (a) 이 변경을 그대로 두고 진짜 root cause만 추가 fix
- (b) 또는 git checkout으로 시도 #2 revert 후 처음부터

판단은 다음 세션 비토가 직접 코드 정독 후 결정.

### 3-3. 정정 안 된 잠재 의심 영역 (직접 정독 필요)

**`paged-pdf.ts` L62-148 `assembleHtml`** — Paged.js polyfill 박힌 영역:
- L75-78: `generateMediaCssBlock('print_a3', seasonToken) + generateAllSeasonsCssBlock('print_a3')` — print_a3 키 박은 게 신규 5종 영향?
- L92-107: `PagedConfig.auto: false + after callback` — body 자식 hide 박은 게 영향?
- L122: `await window.PagedPolyfill.preview()` — input 안 넘김, default `document.body`. 박은 spec 확정 필요
- L218-228: `page.pdf({preferCSSPageSize: true, ...})` — Paged.js .pagedjs_pages와 충돌 가능성

**`paged-pdf.ts` L24** — `PAGED_POLYFILL_CDN = 'https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js'`:
- Paged.js 0.4.3이 양면 분할 정상 동작 버전인지 확인 필요
- `<script src="...">` 박은 게 `document.write` 경고 (test-render 출력에 박힘) — 이게 실제 동작 영향?

---

## 4. 다음 세션 진단 방향 (절대 가설 X, 직접 검증만)

### 4-1. 절대 금지

- ❌ "이게 root cause 같다" 가설로 5종 코드 또 박지 말 것
- ❌ 임시 디버그라며 paged-pdf.ts에 console.log 추가도 금지 (Harold 명시)
- ❌ 시도 #1 (preferCSSPageSize) / 시도 #2 (wrapper section) 다시 박지 말 것 — 이미 효과 0 확인

### 4-2. 의무 진단 순서 (직접 검증)

1. **Paged.js 0.4.3 spec 정독 (외부)**
   - WebFetch: `https://pagedjs.org/documentation/`
   - WebFetch: `https://gitlab.coko.foundation/pagedjs/pagedjs/-/blob/main/docs/intro/index.md`
   - 핵심 확인:
     - `PagedPolyfill.preview(content, stylesheets, renderTo)` 박은 default 동작
     - `PagedConfig.auto: false` 박은 의미
     - `<section>` + `page-break-after` 박힌 게 양면 분할되는 표준 패턴인지
     - 0.4.3 박은 게 양면 양립 버전인지 / 사고 박힌 버전인지

2. **mart_spring_v1로 동일 test-render 비교** (옛 종은 어떻게 박는지)
   ```bash
   cd /home/administrator/hanjuldm-app/packages/backend
   timeout 90 npx -y tsx src/utils/flyer/product/print/test-render.ts mart_spring_v1 2>&1 | tail -20
   ```
   - 옛 mart_spring_v1 = `pages: 1` (단면). 정상 박히면 단면은 정상 동작 확인.
   - 즉 옛 종 자체 검증 = 5종 사고는 양면 처리에 한정.

3. **운영 옛 발행 PDF가 실제 운영에서 정상 박혔는지 확인** (memory grep)
   - D129~D158 사이에 print-flyer 운영 호출 시 빈 PDF 신고 박혔는지
   - 박힌 적 없으면 = D129 시점부터 잠재된 사고 (한 번도 호출 X)
   - 박힌 적 있으면 = 옛 fix 박힌 곳 정독

4. **Puppeteer + Paged.js 양면 표준 패턴 외부 검증**
   - WebFetch: `https://github.com/pagedjs/pagedjs/issues?q=puppeteer+two+pages`
   - 비슷한 사고 박힌 issue 박혀있는지

### 4-3. root cause 확정된 후에만 fix

- 위 1~4 박은 결과로 진짜 root cause 100% 확정 후
- Harold 컨펌 받고 정확한 fix 1건만 박음
- fix 후 test-render → page count 2 + PDF/PNG 정상 사이즈 확인 후에만 commit/push

---

## 5. 운영 영향 정리

- 5종 신규 박힘 (D159+D160), **운영에서 발행 시 빈 PDF/PNG 박힘**
- Harold가 매장 사장님께 5종 노출 0 = 운영 영향 0 가능 (확인 필요)
- 옛 mart_*_v1 4종은 영향 0 추정 (옛 종 발행 시도 안 함, 검증 의무)
- frontend `PrintFlyerPage.tsx`는 9종 노출 박힘 (D160) — 사장님이 5종 클릭 시 빈 결과 사고

---

## 6. 다음 세션 비토 진입 첫 문장 (Harold 명령)

"hanjulDM 인쇄 전단 5종 백지 사고 미해결 인계. `status/hanjul-flyer-revamp/10_print_5jong_blank_page_unresolved.md` 정독 + Paged.js spec WebFetch + 옛 mart_spring_v1 비교 검증 → 진짜 root cause 100% 확정 후에만 fix. 가설 X, 임시 디버그 X."

---

## 7. 진입 시 의식할 점

1. **이미 두 번의 가설 fix가 효과 0** — 시도 #1/#2 박은 채로 두지 말고 정확한 진단 후 정정
2. **Harold = 김포공항 시간 한계로 D160 종료** — 다음 세션은 제주에서 박음
3. **외부 spec 직접 정독 의무** — 추측으로 "Paged.js는 ~할 것" 박는 거 절대 X
4. **mart_spring_v1 비교 우선** — 옛 종 동작 확인이 신규 종 사고 좁힘에 직접 단서
5. **CLAUDE.md no_guess_strict 절대 준수** — 1) 차이 변수 grep 2) Harold 박을 명령어 3) 실 데이터 검증 후에만 fix

---

## 8. 관련 파일 (다음 세션 우선 정독)

| 파일 | 용도 |
|---|---|
| `packages/backend/src/utils/flyer/product/print/renderer/paged-pdf.ts` | Paged.js 호출 + assembleHtml + Puppeteer 박은 핵심 |
| `packages/backend/src/utils/flyer/product/print/renderer/slot-filler.ts` | FILL_RUNTIME (이미 자동 감지 정정 박힘, 검증 OK) |
| `packages/backend/src/utils/flyer/product/print/templates/print_*_v1/template.html` | 5종, 현재 wrapper section 박힘 (commit X) |
| `packages/backend/src/utils/flyer/product/print/templates/mart_spring_v1/template.html` | 옛 종 비교 기준 |
| `packages/backend/src/utils/flyer/product/print/test-render.ts` | 로컬 진단용, npx -y tsx 박음 (-y 옵션 필수) |
| 직전 운영 발행 PDF 위치 | `find / -name "ba5d317f*" 2>/dev/null` 박아서 확인 (uploads/print-flyers/ 폴더 박지 X) |

---

## 9. 진단 박을 때 D160에서 확인된 부수 정보

- **process.cwd 사고**: `routes/flyer/flyers.ts L1158` `path.join(process.cwd(), 'uploads', 'print-flyers')` — pm2 cwd 박은 위치에 따라 박은 위치 다름. 직전 운영 발행 PDF 위치 박지 X (find 박음). 별건 잠재.
- **test-render 박은 cwd 사고**: `/home/administrator/hanjuldm-app/packages/backend/packages/backend/pdfs/` (이중 packages/backend) — 박은 게 박힘 위치 사고. 별건 잠재.
- **uploads/print-flyers/ 폴더 자체 박지 X**: 운영 발행 시 박힘. 별건.

---

> **본 문서 = 다음 세션 비토 의무 정독.**
> 가설 X. 직접 검증 + 외부 spec 정독 + 옛 종 비교 = 진짜 root cause 100% 확정 후에만 박음.
