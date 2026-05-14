# PRINT_DEAL_FOCUS — 디자인 명세

> **무드**: Poster POP / Single-Hero
> **용도**: 정육·수산·계절과일 등 단일 카테고리 폭탄 행사
> **지면**: B4 단면 · 264 × 378mm
> **편집 캔버스**: 660 × 945px (백엔드 300dpi → 3,120 × 4,465px)

---

## 1. 레이아웃 구성

```
┌─────────────────────────────────────────┐
│ 파인마트 · FINEMART        ISSUE 026     │  ← HEADER (얇은 스트립)
├═════════════════════════════════════════┤
│ ● WEEK'S BIGGEST DEAL                    │
│                                          │
│  딱 한 가지,                             │  ← HEADLINE
│  40% 더 좋게.                            │     (serif 강조 숫자)
│                                          │
│  ┌──────────────┐  카테고리              │
│  │   HERO       │  상품명 (22px)         │
│  │   visual     │  ─────                 │  ← HERO ZONE
│  │   [40% OFF]  │  29,800  ← 원가        │     화면 70%
│  │   stamp      │  17,900원   ← 96px     │
│  └──────────────┘  / 100g 기준           │
├─────────────────────────────────────────┤
│  함께 사면 좋은              03 ITEMS    │  ← SUB STRIP
│  [sub1]   [sub2]   [sub3]                │     화면 20%
├─────────────────────────────────────────┤
│  파인마트 합정점          [ QR ]         │  ← FOOTER
└─────────────────────────────────────────┘
```

## 2. 매핑 슬롯 명세

### 매장 / 카피
| `data-slot` | 의미 |
|---|---|
| `store.name` | 매장명 (헤더 + 푸터 양쪽) |
| `store.address` | 주소 |
| `store.phone` | 전화 |
| `store.period` | 행사 기간 |
| `store.qrcode` | QR 70 × 70px |
| `copy.headline` | 메인 카피 (숫자 1개를 `<em>` 으로 → 빨간 serif 자동 강조) |

### 영웅 상품 슬롯 `product[0]`
| `data-slot` | 의미 |
|---|---|
| `product[0].category` | 카테고리 라벨 ("MEAT · 정육") |
| `product[0].name` | 상품명 (22px, 최대 16자) |
| `product[0].image` | 풀스크린 누끼 PNG |
| `product[0].original` | 원가 (취소선) |
| `product[0].price` | 할인가 (96px) |
| `product[0].discount` | 할인율 숫자만 (40 → "40% OFF" 스탬프) |
| `product[0].unit` | 단위·기준 |

### 서브 상품 슬롯 `product[1..3]`
| `data-slot` | 의미 |
|---|---|
| `product[N].image` | 56 × 56px 누끼 |
| `product[N].name` | 상품명 (최대 12자) |
| `product[N].unit` | 단위 |
| `product[N].price` | 가격 (18px) |

### 푸터
- `footer.notice` — 한정 수량·회원가 안내 등

## 3. 디자인 토큰

```css
--color-accent:  #E63946;       /* 가격 96px + 할인 스탬프 + serif emphasis */
--color-paper:   #F4F1EA;       /* 종이 톤 (조금 더 따뜻한 베이지) */
--font-serif:    'Noto Serif KR';
```

가격 디스플레이 사이즈:
```css
--price-display-size: 96px;   /* 메인 96px (= 백엔드 300dpi 시 약 240px) */
--price-sub-size:     18px;    /* 서브 아이템 */
```

## 4. 인쇄 사양 체크리스트

- [x] B4 264 × 378mm + 도련 2mm
- [x] 300dpi CMYK 변환 호환
- [x] 본문/매장명 = K100 검정
- [x] 강조 빨강 = 가격/스탬프/serif 단어 한정 (최대 15% 면적)
- [x] 할인 스탬프 `transform: rotate(4deg)` — 안전영역 내부에서 회전
- [x] 그라데이션 0건
- [x] 시각 우선순위 = 가격 > 상품 > 매장명 (의도된 위계)

## 5. 사장님 커스텀 변수

- `--color-accent` — 매장 컬러로 교체 가능 (스탬프·가격 동시 적용)
- `copy.headline` 의 `<em>` 안에 다른 강조 단어 가능 (숫자/형용사)
- 할인 스탬프 자체를 숨기려면 `.discount-stamp { display: none }`
