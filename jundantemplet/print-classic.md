# PRINT_CLASSIC — 디자인 명세

> **무드**: Editorial Mart / Refined Density
> **용도**: 동네·중형마트 주간 대형전단 (정보 밀도는 높이고 디바이더·그리드로 정돈)
> **지면**: B4 단면 · 264 × 378mm
> **편집 캔버스**: 660 × 945px (백엔드 300dpi → 3,120 × 4,465px)

---

## 1. 레이아웃 구성

```
┌──────────────────────────────────────────────────┐
│ [P] 매장명/지점   ISSUE  TEL                      │  HEADER
├──────────────────────────────────────────────────┤
│  ● WEEK'S BIG DEAL                               │
│  식탁에 다가온  │  [HERO 1]      │  [HERO 2]     │  HERO BAND
│  봄.            │  한우 등심      │  연어회        │  (영웅 2)
├──────────────────────────────────────────────────┤
│  01 / 정육 특가 · MEAT              4 ITEMS      │
│  [_][_][_][_]                                    │  SECTION 01
├──────────────────────────────────────────────────┤
│  02 / 신선식품 · PRODUCE·SEAFOOD    8 ITEMS      │
│  [_][_][_][_]                                    │  SECTION 02
│  [_][_][_][_]                                    │
├──────────────────────────────────────────────────┤
│  03 / 가공·델리 · GROCERY            8 ITEMS      │
│  [_][_][_][_]                                    │  SECTION 03
│  [_][_][_][_]                                    │
├──────────────────────────────────────────────────┤
│ ADDR / HOURS / NOTICE                  [ QR ]    │  FOOTER
└──────────────────────────────────────────────────┘
```

**총 22개 상품** (영웅 2 + 정육 4 + 신선 8 + 가공 8)

## 2. 매핑 슬롯 명세

### 매장 / 카피
- `store.logo`, `store.name`, `store.branch`, `store.period`, `store.phone`, `store.address`, `store.qrcode`
- `copy.headline` (em 강조 1단어), `copy.subline`

### 상품 (반복 `product[0]` ~ `product[21]`)
| `data-slot` | 의미 |
|---|---|
| `product[N].image` | 누끼 PNG |
| `product[N].name` | 상품명 (헤로 14자 / 그리드 10자 권장) |
| `product[N].unit` | 단위 ("100g", "1팩") |
| `product[N].price` | 할인가 |
| `product[N].original` | 원가 (선택, 취소선) |
| `product[N].badge` | "BEST"/"NEW"/"1+1"/"30%"/"PB"/"SEASON" |

- `product[0..1]` = **HERO** — 헤로 밴드, 가격 28px
- `product[2..21]` = **GRID** — 4열 컴팩트 그리드, 가격 17px

### 배지 색 룰
- 검정 = 일반/PB (`bg`)
- 빨강 = 가격 강조형/할인율 (`bg r`)
- 딥그린 = 친환경/SEASON (`bg g`)

### 푸터
- `footer.notice`

## 3. 디자인 토큰

```css
--color-primary: #1A1A1A;        /* K100 */
--color-accent:  #E63946;        /* 가격·serif 강조·red 배지 */
--color-accent-2:#1B4332;        /* SEASON 배지 (선택) */
--color-paper:   #FAF8F4;
--color-mute:    #6B7280;
--color-rule:    #D9D7D2;

--font-display:  'Pretendard Variable';
--font-serif:    'Noto Serif KR';
--font-mono:     'JetBrains Mono';
```

## 4. 인쇄 사양 체크리스트

- [x] 264 × 378mm + 도련 2mm
- [x] 본문 K100, 가격만 강조 빨강
- [x] 그라데이션 0건 · 회전 0건
- [x] 색상 농도 10% 이하 사용 없음
- [x] 본문 최소 11px (백엔드 300dpi 스케일 시 18pt 이상)
- [x] 헤로 카드 / 그리드 카드 동일 데이터 스키마 (확장 가능)

## 5. 사장님 커스텀 변수

- `--color-accent` — 매장 컬러로 교체 가능
- 카테고리 헤더 (`<h3>`) — 텍스트 자유 변경
- 각 카테고리 그리드 아이템 수: 4의 배수 권장 (3, 4, 8 모두 가능)
