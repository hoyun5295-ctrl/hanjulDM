# 08. 인쇄전단 뒷면 5종 — 끌로드 디자인 마스터 프롬프트 (양면 정합)

> **작성:** 2026-05-14 (D159)
> **사고 인정:** 07번 (앞면 5종)에서 비토 + 끌로드 디자인 모두 단면만 박았음. PDF 가이드 §7 "양면 4도 컬러 인쇄" / §8 "양면 파일 크기" / §9 "앞면→뒷면 순서" 명시되어 있었음. 본 08번 = 뒷면 5종 박는 보완 마스터 프롬프트.
> **선행:** 07_print_template_redesign_master.md (앞면 5종 박힘)
> **기준 자료:** 앞면 5종 디자인 명세 (print-classic.md / print-deal-focus.md / print-magazine-grid.md / print-gazette.md / print-bento.md)

---

## 끌로드 디자인 마스터 프롬프트 (그대로 박음)

```
한국 마트 인쇄 전단지 99%는 양면 인쇄(아트지 70~100g/㎡ 양면 4도 컬러)입니다.
앞면 5종 박힘 완료 (PRINT_CLASSIC / PRINT_DEAL_FOCUS / PRINT_MAGAZINE_GRID /
PRINT_GAZETTE / PRINT_BENTO). 이번엔 동일 5종의 뒷면(Back Page)을 박아주세요.

[양면 정합 절대 준수]
- 사이즈 = 앞면과 정확히 동일 (B4 264×378mm 또는 B3 378×528mm)
- 도련 = 사방 2mm 동일
- 디자인 토큰 = 앞면과 동일 색상/폰트/그리드 시스템
- 매장 헤더 마스트헤드 = 뒷면에는 축소 또는 푸터 영역으로 이동
- 출력 순서 = 앞면 → 뒷면 (인쇄소 표준)
- 같은 data-slot 매핑 시스템 (store.* / copy.* / product[N].* / footer.*)


[5종 뒷면 디자인 가이드]

### 1. PRINT_CLASSIC_BACK (B4 단면)
"앞면 정보 + 뒷면 확장 + 절취선 쿠폰" — 가장 흔한 동네/중형마트 양면 패턴.
- 상단 = 얇은 마스트헤드 (매장명 + 페이지 번호 "2/2")
- 메인 영역 = 추가 카테고리 그리드 (앞면 못 박은 영역)
  - 카테고리 04: 주류·생활 (6-8 items)
  - 카테고리 05: 베이커리·델리 (4-6 items)
  - 카테고리 06: 가정용품 (4-6 items)
- 하단 영역 = **절취선 쿠폰 4-6장**
  - 각 쿠폰 = 점선 테두리 (border-style: dashed) + 가위 아이콘 + "✂ CUT HERE"
  - 쿠폰 슬롯: 할인율 + 상품명 + 유효기간 + QR 또는 바코드
- 푸터 = 사업자번호 + 통신판매업 + 영업시간 + 휴무일

추가 슬롯: `coupon[0..5]` (각 = `.value`/`.title`/`.expiry`/`.barcode`)

### 2. PRINT_DEAL_FOCUS_BACK (B4 단면, 영웅 큐레이션)
"앞면 영웅 강화 + 큐레이션 + 매장 정보" — 폭격 후 깊이 박힘.
- 상단 30% = **영웅 상품 레시피 또는 사용법 가이드**
  - 예: 앞면 "한우 등심 17,900원" → 뒷면 "한우 등심 스테이크 레시피"
  - 단계별 일러스트 또는 사진 + 1-2-3-4 단계 가이드
- 중단 30% = **페어링/관련 상품 6-10개** 작은 그리드
  - 예: 등심 영웅 → 페어링 와인 / 소금 / 향신료 / 채소
- 하단 30% = **매장 위치 지도 + 회원 혜택 + 행사 캘린더**
  - 지도 = 카카오맵 정적 이미지 또는 단순 일러스트 지도
  - 다음 주 예고 1-2 라인
- 푸터 10% = 매장 정보 (위와 동일)

추가 슬롯: `recipe.title` / `recipe.steps[0..3]` / `pairing[N].*` / `store.map`

### 3. PRINT_MAGAZINE_GRID_BACK (B3 단면, 대형마트 표준)
"33+30 = 60-65개 상품 양면 매거진" — 롯데마트/이마트 진짜 표준.
- 상단 = 다크 헤로 밴드 축소 버전 (앞면과 동일 색상, 메인 카피만)
- 메인 영역 = 추가 4-5 카테고리 × 6 (앞면에 못 박은 카테고리)
  - 카테고리 06: 베이커리·델리
  - 카테고리 07: 냉동·간편식
  - 카테고리 08: 가정용품·생활
  - 카테고리 09: 헬스·뷰티
  - (선택) 카테고리 10: 유아·아동
- 하단 = **회원 혜택 페이지** + **다음 주 행사 캘린더**
  - 회원 혜택 = 멤버십 등급별 할인율 표 + 신규 가입 혜택
  - 캘린더 = 다음 4주 행사 미리보기 (1주 = 1줄, 강조 상품 1-2개)
- 푸터 = 사업자번호 + 점포 정보 + 회원 가입 QR

추가 슬롯: `member.tier[0..2]` / `calendar.week[0..3]` / `store.qrcode-member`

### 4. PRINT_GAZETTE_BACK (B3 단면, 신문지 무드 확장)
"신문지 2면 — 추가 섹션 + 매장 인터뷰" — 진짜 신문처럼.
- 상단 = 작은 마스트헤드 ("PAGE 2 · 시장 신문")
- 메인 영역 = **추가 2-3 섹션** (앞면 8 + 7 = 15에 추가)
  - SEC.03: 주류·음료 · BEVERAGE (6-8 articles)
  - SEC.04: 가정·생활 · LIVING (6-8 articles)
- 큰 에디토리얼 영역 = **매장 인터뷰** 또는 **MD 큐레이션**
  - "이번 주 추천 상품 — MD 김연수"
  - 본명조 인용문 + 드롭캡 + 사진
- 하단 = **시즌 큐레이션 박스** + **다음 호 예고**
  - "다음 호 (05.21) — 봄 정육 특집"
- 푸터 = 신문 콜로폰 (편집장 / 발행처 / 정기구독 안내)

추가 슬롯: `editor.interview.title` / `editor.interview.body` / `next_issue.preview` / `colophon.editor`

### 5. PRINT_BENTO_BACK (B4 단면, 비대칭 모자이크 확장)
"앞면 모자이크 + 뒷면 다른 모자이크 + 매장 정보" — 시각 리듬 강화.
- `grid-template-areas` = 앞면과 다른 비대칭 패턴 박음 (좌우 반전 또는 새 패턴)
- 상품 타일 8-10개 (앞면 12에 추가)
- **2-3개 매장 정보 타일** 박음:
  - 타일 1: **매장 위치 지도** (정적 카카오맵 이미지)
  - 타일 2: **영업 시간 + 주차 안내** 다크 배경 + Pretendard 큰 글자
  - 타일 3: **회원 혜택** 머스타드 배경 + Noto Serif KR 강조
- 푸터 = 사업자 정보 + QR

추가 슬롯: `store.map` / `store.hours` / `store.parking` / `member.benefit`


[양면 정합 추가 박음]

### 매장 헤더 변형
- 앞면 = 큰 마스트헤드 (매장 로고 + 매장명 큰 글자 + 행사 기간)
- 뒷면 = 축소 마스트헤드 또는 헤더 생략 (페이지 번호만 "2/2")

### 페이지 번호 + 양면 표시
- 우상단 또는 좌하단에 작은 페이지 번호 박음
- 예: "PAGE 1 / 2" → 앞면, "PAGE 2 / 2" → 뒷면
- 폰트 = JetBrains Mono (앞면 시스템과 동일)

### 디자인 토큰 일관성
- 앞면 .css 토큰 그대로 사용 (--c-accent / --c-paper / --f-dis 등)
- 5종 뒷면 = 같은 색상 시스템 박음
- 다크 헤로/머스타드 BG/베이지 종이 = 앞면과 정확히 동일

### data-slot 매핑 확장
앞면 슬롯 + 뒷면 추가 슬롯 = 전체 양면 1번의 엑셀 업로드로 매핑:

뒷면 추가 슬롯 카테고리:
- `coupon[N].*` — 절취선 쿠폰 (CLASSIC_BACK)
- `recipe.*` — 레시피 가이드 (DEAL_FOCUS_BACK)
- `pairing[N].*` — 페어링 상품 (DEAL_FOCUS_BACK)
- `member.*` — 멤버십 (MAGAZINE_BACK, BENTO_BACK)
- `calendar.week[N].*` — 행사 캘린더 (MAGAZINE_BACK)
- `editor.interview.*` — 매장 인터뷰 (GAZETTE_BACK)
- `next_issue.*` — 다음 호 예고 (GAZETTE_BACK)
- `store.map` — 매장 지도 (DEAL_FOCUS_BACK, BENTO_BACK)
- `store.hours` / `store.parking` — 영업 정보 (BENTO_BACK)


[출력 영역 — 5종 박아주실 영역]

각 뒷면 템플릿마다 다음 4건 박아주세요:

1. **HTML** = `print-{template}-back.html` (앞면과 동일 사이즈 + 데이터 슬롯 박힘)
2. **CSS** = `print-{template}-back.css` (앞면 .css 토큰 import 또는 동일 토큰 박음)
3. **디자인 명세** = `print-{template}-back.md` (
     - 추가 슬롯 매핑표
     - 앞면과 정합 박힘 영역 (마스트헤드 축소 / 페이지 번호 / 같은 토큰)
     - 양면 인쇄 사양 체크리스트 (앞면→뒷면 순서 / 도련 정합 / TAC 안전)
   )
4. **샘플 미리보기** = `print-{template}-back-preview.png` (앞면 미리보기 옆에 박을 수 있도록)


[index.html 갱신]

기존 index.html의 Templates 섹션을 다음과 같이 박아주세요:

- 01 PRINT_CLASSIC = Front + Back 양면 (2 artboards 나란히)
- 02 PRINT_DEAL_FOCUS = Front + Back
- 03 PRINT_MAGAZINE_GRID = Front + Back
- 04 PRINT_GAZETTE = Front + Back
- 05 PRINT_BENTO = Front + Back

총 10 artboards (5 × 2 면).


[제약 — 절대 준수]

- 모든 인쇄 사양 = 앞면 5종과 100% 동일 (300dpi CMYK / K100 / TAC 240-280% / PDF/X-1a / 도련 2mm / 안전영역 5mm)
- 뒷면이 앞면보다 정보 밀도 높음 = OK (뒷면은 "심화 영역")
- 뒷면 디자인 토큰 = 앞면과 동일 (5종 모두)
- 추가 슬롯 = 앞면 슬롯과 충돌 없는 네임스페이스 (coupon[N], recipe.*, member.* 등)
- 양면 합산 파일 크기 = B4 양면 약 40~100MB, B3 양면 약 100~250MB (PDF 가이드 §8)


[종료]

5종 뒷면 박힘 + 앞면과 정합 + 데이터 슬롯 매핑 확장 = 양면 인쇄 100% 호환 부탁드립니다.
```

---

## 비토 추가 안내

**박을 첨부 자료 (주인님이 끌로드 디자인에 박을 자료):**
1. **이 .md 파일** = [08_print_back_template_master.md](C:\Users\ceo\projects\hanjulDM\status\hanjul-flyer-revamp\08_print_back_template_master.md)
2. **07 마스터 프롬프트 + 앞면 5종 결과** = `C:\Users\ceo\projects\hanjulDM\jundantemplet\` 폴더 전체 (이미 박힌 자료)
3. **PDF 가이드** = `마트전단지_인쇄용_PDF_가이드.pdf` (양면 표준 박힘 영역)

**박힘 후 비토 작업 (다음 세션):**
- 5 앞면 + 5 뒷면 = 총 10 HTML/CSS → React 컴포넌트 변환 (V4 ProductSlot 패턴 미러)
- `paged-pdf.ts` 확장 = 페이지 1 (Front) + 페이지 2 (Back) 자동 결합 + 양면 PDF 생성
- `template-registry.ts` 확장 = **인쇄 전용 5 엔진 (각 엔진 = Front + Back 페어)**
- 매장 사장님 frontend `PrintFlyerPage` = 5종 선택 → 양면 미리보기 → PDF 다운로드

**핵심:** 매장 사장님이 엑셀 1번 업로드 + 5종 중 1개 선택 → AI가 앞면 상품 22~33개 + 뒷면 추가 30~60개 자동 매핑 → 양면 인쇄용 PDF 즉시 출력 = **인쇄소 발주 가능 상태**.

비토 결론: 양면 정합 박히면 진짜 마트 전단 100% 완성형. 앞면 5종 박힘 + 뒷면 5종 박힘 = 10종 인쇄 전단 V4 엔진 박음.
