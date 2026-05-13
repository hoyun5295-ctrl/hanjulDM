# 06 한줄전단 디자인 템플릿 6종 재설계 마스터 프롬프트 (Claude Design 입력용)

> **작성일:** 2026-05-13 (D153)
> **작성자:** 비토 (Opus 4.7) + Harold
> **목적:** 한줄전단AI(hanjulDM)의 모바일 전단 6종을 Claude Design으로 생성하기 위한 단일 진실 원천
> **선행 문서:** `04_master_plan.md` §1 PHASE 0 트랙 A "Claude Design 통합 디자인 시스템"
> **후행 작업:** Harold가 본 .md 통째로 Claude Design에 입력 → 6종 HTML 수령 → 비토가 `flyer-templates.ts` CT-F14 엔진에 통합

---

## 0. 본 문서 사용법 (Claude Design 입력 가이드)

Harold가 Claude Design 새 프로젝트를 만들고 본 .md 전체를 입력으로 붙여넣는다. Claude Design은 본 문서의 §2 6종 사양 + §3 공통 요건 + §4 데이터 스키마 + §5 시즌 토큰 + §6 출력 사양을 모두 만족하는 6개의 self-contained HTML 파일을 생성한다.

각 HTML은 단독으로 브라우저에 열어 모바일 뷰포트(393x852, iPhone 15 Pro)에서 즉시 작동해야 한다. 외부 CSS/JS 의존 0개. 데이터는 §4-2 mock 6상품 그대로 사용.

---

## 1. 프로젝트 맥락

### 1-1. 서비스 본질
- **서비스명**: 한줄전단AI (hanjulDM)
- **사용자**: 마트·정육·식자재·과일·수산 매장 사장님 (1차) + 매장 고객 (2차)
- **사장님 흐름**: 상품 정보 엑셀/사진/POS 업로드 → AI 자동 전단 생성 → 카톡/문자로 고객에게 발송 → 매장 방문/주문/쿠폰
- **고객 흐름**: 카톡 알림 수신 → og:image 미리보기 → 단축 URL 클릭 → 모바일 풀스크린 전단 페이지 → 상품 탐색 → 매장 행동
- **URL**: `hanjul-flyer.kr/{short_code}` (6자 단축 코드)
- **첫 0.5초**: 고객이 카톡 alert + og:image를 보는 순간이 매출 전환의 본질. 외주 디자이너 결과물보다 압도적이어야 함.

### 1-2. 현재 문제 (재설계 이유)
- 현 22종 템플릿이 모두 "카드 그리드에 상품 슬롯 채우기 + 색 변형"
- 사용자 인식 = "외주 디자이너가 만든 거보다 못함"
- master plan §1-1 진단: "1차원적 슬롯 채움"

### 1-3. 재설계 본질
- 6종 각자 명확히 다른 **모바일 네이티브 UI 패턴 DNA**
- 색·계절은 **시즌 컬러 토큰**으로 분리해서 무한 조합
- 사장님 의사결정 = 레이아웃 1개 선택만, 시즌은 발행 날짜 + 행사명에서 AI 자동 매핑
- Claude Design 동적 생성 + 6매체 통합 디자인 토큰 + 매번 다른 디자이너급 결과물

---

## 2. 6종 템플릿 상세 사양

### 2-1. STORY (스토리형) — 인스타 스토리 패턴

**컨셉**
1상품 1슬라이드 풀스크린 100vh. 자동 5초 진행, 탭으로 좌우 이동, 위로 스와이프 시 상품 상세 시트.

**벤치마크**
- 인스타그램 스토리 (자동 진행 + 진행바)
- 쿠팡 라이브 (풀스크린 상품 강조)
- 무신사 매거진 스토리

**레이아웃 (모바일 393x852 기준)**
```
┌─────────────────────────────┐ 0
│ ▓▓▓░░░░░ ░░░░░░ ░░░░░░ ░░  │ 8  진행바 (상품 개수만큼 분할)
├─────────────────────────────┤ 24
│  [매장로고]  매장명      X  │ 40  헤더 (좌: 로고+매장명, 우: 닫기)
├─────────────────────────────┤ 80
│                             │
│                             │
│      [전면 상품 이미지]      │     Hero 풀블리드 이미지 (60vh)
│      그라데이션 마스크        │     이미지 위 어둠 그라데이션 (위→아래)
│                             │
│                             │
├─────────────────────────────┤ 580
│   카테고리 칩              │ 600  ex: "오늘의 핫딜"
│                             │
│   상품명 (대형 32px Bold)   │ 640
│   100g · 국산              │ 670  (단위·원산지)
│                             │
│   ~~9,900원~~  6,900원     │ 720  (취소선 정가 + 세일가 대형)
│   30% 할인                  │ 760  (할인율 sticker)
├─────────────────────────────┤ 800
│   [장보기 담기] sticky     │ 852  (하단 sticky 200px 도달영역)
└─────────────────────────────┘
```

**핵심 인터랙션**
- 자동 진행: 5초 후 다음 슬라이드 (CSS animation으로 진행바 진행)
- 탭 좌: 이전 / 탭 우: 다음 / 탭 가운데: 일시정지
- 위 스와이프: 상품 상세 bottom sheet (slide-up 60vh, 영양정보·후기·길찾기)
- 길게 누름: 일시정지 + 다크 마스크
- 마지막 슬라이드: "전체 보기" CTA로 GRID HERO 모드 전환

**색 적용**
- 배경: Hero 이미지에서 지배색 자동 추출 (CSS `backdrop-filter: blur(60px)` + 80% darken)
- 가격 슬랩: 시즌 토큰 primary
- 진행바: 시즌 토큰 accent 60% opacity

**모션 사양**
- 슬라이드 전환: transform: translateX 300ms cubic-bezier(0.4, 0, 0.2, 1)
- 진행바: width 0→100% 5000ms linear (CSS animation)
- 가격 sticker: 첫 1초 spring-pop scale 0.8→1.0
- 탭 피드백: 0.95 scale 100ms

**접근성**
- 자동 진행 일시정지 버튼 명시 (`role="button" aria-label="일시정지"`)
- 스크린리더용 슬라이드 카운트 alert ("3 of 6")
- 진행바 `aria-valuenow` 동적 갱신

---

### 2-2. MAGAZINE (매거진 스크롤) — Apple/NYT 스크롤텔링 패턴

**컨셉**
매장 브랜드 무드보드. 사장님이 큐레이션한 이번 주 상품을 매거진 컬럼처럼 스크롤 페어 애니메이션으로 펼친다.

**벤치마크**
- Apple 제품 페이지 (스크롤 트리거 fade-in)
- NYT The Daily (긴 스토리 + 풀블리드 이미지)
- 마켓컬리 컨텐츠 페이지
- 일본 무인양품(MUJI) 컬렉션

**레이아웃**
```
[챕터 0: 매장 인트로 — 100vh]
- 매장 로고 (대형 중앙)
- 매장명 + 이번 주 슬로건 ("이번 주, 우리 동네 정육의 진심")
- 행사 기간 (2026.05.13 ~ 2026.05.19)
- 아래로 스크롤 화살표 hint (bounce animation)

[챕터 1: 카테고리 헤드 — 청과/야채 — 50vh]
- 풀블리드 카테고리 무드 이미지 + 카테고리명 대형 (60px Bold)
- 카테고리 카피 (AI 자동 생성, 예: "햇과일이 도착했습니다")

[챕터 1-N: 상품 카드 — 각 100vh]
- 좌: 상품 정보 (이름·단위·원산지·가격·badge·aiCopy)
- 우: 상품 이미지 (parallax: 스크롤 진행률 0→1에 따라 translateY -50px → 0px)
- 텍스트 fade-in: 카드 진입 시 opacity 0→1, translateY 30px→0
- 가격 강조: 스크롤 30% 지점에서 scale 1→1.1 spring-pop

[챕터 N+1: 마무리 CTA — 100vh]
- 매장 정보 (영업시간·전화·길찾기)
- "이번 주 행사 매장 방문하기" 대형 CTA
- og:image 카드 (공유 버튼)
```

**핵심 인터랙션**
- 스크롤 페어 (IntersectionObserver로 카드 진입 감지)
- parallax 이미지 (transform translateY scroll-linked)
- 카테고리 챕터 헤드 sticky (헤더로 변환)
- 가격 강조 모션 (카드 진입 후 500ms 지연)

**모션 사양**
- fade-in: opacity 0→1, translateY 30px→0, 600ms ease-out
- parallax: transform translateY scroll-progress * -80px
- 가격 spring: scale 1→1.12→1.0 800ms cubic-bezier(0.34, 1.56, 0.64, 1)
- 챕터 헤드 sticky: position sticky top 0, 스크롤 후 헤더로 collapse

**색 적용**
- 배경: 본지(本紙) 무지 베이지 (#F5F1EB)
- 카테고리별 액센트: 청과 #22C55E / 정육 #DC2626 / 수산 #1D4ED8 등
- 시즌 토큰은 챕터 0 hero + 가격 강조에만 적용

**타이포**
- 슬로건: Pretendard Bold 72px
- 카테고리 헤드: Pretendard Bold 60px
- 상품명: Pretendard SemiBold 28px
- 가격: Pretendard Black 48px, tabular-nums

---

### 2-3. DEAL FEED (오늘의 핫딜) — 무신사/29CM 피드 패턴

**컨셉**
무한 스크롤 핫딜 카드 피드. 카드마다 실시간 카운트다운 + 잔여수량 progress + 좋아요·카톡공유 버튼.

**벤치마크**
- 무신사 스니커즈 드롭 (카운트다운 + 핫딜)
- 29CM 핫딜 (카드 피드 + 좋아요)
- 쿠팡 골드박스 (마감 임박 빨강 강조)
- 토스 송금 카드형 UX

**레이아웃**
```
┌─────────────────────────────┐
│ [상단 띠배너 — 60px]        │  배경: 시즌 토큰 grad
│ 오늘의 핫딜 · 23:59:42 종료 │  실시간 카운트다운 (JS setInterval)
├─────────────────────────────┤
│ [카드 1]                    │
│ ┌─────────────────────┐    │
│ │ [상품 정사각 이미지]│    │  좌: 이미지 (160x160)
│ │                     │    │
│ │  badge: 한정 30개   │    │  우상: badge sticker
│ │                     │    │
│ │  ※ 마감 02:14:33    │    │  우하: 카운트다운
│ └─────────────────────┘    │
│ 삼겹살 600g · 국산           │  상품명·단위·원산지
│ ~~14,900~~  9,900원         │  가격 (취소선 + 세일가)
│ 카드할인 5% 추가             │  cardDiscount
│                             │
│ ▓▓▓▓▓▓░░░░ 60% 판매         │  잔여수량 progress bar
│                             │
│ ♡ 142  💬 공유  🛒 담기    │  액션 행 (좋아요·카톡공유·담기)
├─────────────────────────────┤
│ [카드 2] [카드 3] ...        │  무한 스크롤 (스켈레톤 로딩)
└─────────────────────────────┘
```

**핵심 인터랙션**
- 실시간 카운트다운: setInterval 1000ms, 9시간/1시간/10분 단위로 색 단계 (default→amber→red)
- 좋아요 토글: 탭 시 spring-pop scale 1→1.3→1, localStorage 저장
- 카톡공유: Kakao SDK 또는 navigator.share 실제 공유
- progress bar: CSS variable로 판매율 동적 (`--sold: 60%`)
- 카드 등장: 무한 스크롤 + skeleton shimmer + IntersectionObserver fade-in
- 마감 임박 (1시간 미만): 카드 테두리 pulsate (border-color animation)

**색 적용**
- 카드 배경: white
- 카운트다운 단계:
  - default: #171717
  - 1시간 미만: #F59E0B (amber)
  - 10분 미만: #EF4444 (red) + pulsate
- 시즌 토큰 primary: 띠배너 배경 + sticky filter

**모션 사양**
- 좋아요 spring: scale 1→1.3→1.0 + 하트 입자 4개 분출 (translateY -40px + opacity 1→0)
- 카드 진입 shimmer: linear-gradient 90deg translateX -100%→100% 1500ms infinite
- 카드 fade-in: opacity 0→1 + translateY 20px→0 400ms
- 마감 임박 pulsate: border-color cycle 800ms

**필터·정렬 칩 (상단 sticky)**
- 카테고리 칩 (가로 스크롤): 청과 / 정육 / 수산 / 공산 / 음료
- 정렬: 마감순 / 할인율순 / 가격순

---

### 2-4. GRID HERO (위클리 메인) — 마켓컬리 메인 패턴

**컨셉**
위클리 행사 메인 페이지. 이번 주 키 상품 Hero 배너 + 카테고리 점프 칩 + 2x2 상품 그리드 + 단가 표시 + 카드 long-press 미리보기.

**벤치마크**
- 마켓컬리 메인 (Hero + 카테고리 + 그리드)
- 오늘의집 위클리 픽
- SSG 추천 (카드 long-press)
- 일본 라쿠텐 슈퍼 마트 메인

**레이아웃**
```
┌─────────────────────────────┐ 0
│ [매장 헤더 — 56px sticky]   │
│ ☰ 매장명         🔍 ♡       │
├─────────────────────────────┤
│ [Hero 배너 — 60vh]          │
│ ┌─────────────────────┐    │
│ │ 풀블리드 키 상품    │    │  이번 주 1순위 상품 풀폭
│ │                     │    │
│ │ "이번 주 진짜 싸요" │    │  슬로건 (대형 한글)
│ │ 삼겹살 600g         │    │  상품명
│ │ ~~14,900~~ 9,900원  │    │  가격 (대형)
│ │ 행사 5/13 ~ 5/19    │    │  기간
│ │  [지금 보러가기 →]   │    │  CTA
│ └─────────────────────┘    │
├─────────────────────────────┤
│ [카테고리 칩 sticky — 56px] │
│ 전체│청과│정육│수산│공산▶  │  가로 스크롤 + 점프 네비
├─────────────────────────────┤
│ [카테고리 1: 청과/야채]      │
│ ┌──────┬──────┐            │
│ │ 카드 │ 카드 │            │  2x2 그리드
│ ├──────┼──────┤            │
│ │ 카드 │ 카드 │            │
│ └──────┴──────┘            │
│                             │
│ 각 카드:                    │
│ - 정사각 이미지              │
│ - 상품명 (15px)             │
│ - 단가 "1kg당 9,900원" (10px)│  단가 자동 계산 (salePrice / unit g/ml/개)
│ - 가격 (대형 18px)          │
│ - badge (할인율)            │
│ - [담기 +] 버튼             │
├─────────────────────────────┤
│ [카테고리 2: 정육] ...       │
├─────────────────────────────┤
│ [하단 sticky bar]            │
│ "장바구니 (3) → 매장 방문"  │  담은 상품 카운트 + CTA
└─────────────────────────────┘
```

**핵심 인터랙션**
- 카테고리 칩 sticky + 점프 (anchor scroll smooth)
- 카드 long-press 500ms: 미리보기 모달 (영양정보·후기·다른 사이즈)
- 담기 버튼: spring-pop + 하단 장바구니 카운트 증가 + 토스트 "삼겹살 담음"
- Hero 배너 자동 캐러셀 (3초마다 다음 키 상품, 4개 인디케이터)
- pull-to-refresh: 매장 데이터 새로고침

**단가 자동 계산**
- unit 정규화: "600g" → 600, "1.8L" → 1800, "5kg" → 5000
- 단가 = salePrice / (unit * 1g/ml 기준 normalized) * 100 (100g당) 또는 1000 (1kg당)
- 표시: "100g당 1,650원" / "1kg당 9,900원" / "개당 798원"

**색 적용**
- 배경: white
- Hero: 시즌 토큰 grad
- 카드 hover: shadow lift + 시즌 토큰 border-glow
- 담기 버튼: 시즌 토큰 primary

**모션 사양**
- 카테고리 점프: scroll-behavior smooth + 진입 시 카테고리 헤드 spring-pop
- 카드 long-press: scale 0.96 + opacity 0.9 200ms, 500ms 후 모달 fade-in
- Hero 캐러셀: opacity crossfade 600ms
- 담기 spring: scale 1→1.2→1.0 + 장바구니 아이콘 shake

---

### 2-5. CATALOG SWIPE (카탈로그 가로) — 넷플릭스 카테고리 패턴

**컨셉**
카테고리별 가로 스와이프 행. 정육/청과/수산 각자 독립된 한 줄. 카드 hold로 확대 미리보기. 매장 정보 상단 sticky.

**벤치마크**
- 넷플릭스 카테고리 행 (가로 스와이프)
- 배민 카테고리 (가로 카드)
- 카카오톡 선물하기 (테마별 가로 캐러셀)
- Spotify 플레이리스트

**레이아웃**
```
┌─────────────────────────────┐
│ [매장 카드 — 200px]          │
│ ┌─────────────────────┐    │
│ │ [매장 외관 이미지]  │    │  매장 사진 (배경)
│ │ 동네마트 (대형)      │    │  매장명
│ │ ★ 4.7 · 도보 3분    │    │  평점 + 거리
│ │ 영업 09:00 ~ 22:00  │    │  영업시간
│ │ [전화] [길찾기]      │    │  CTA 2개
│ └─────────────────────┘    │
├─────────────────────────────┤
│ 청과/야채                    │  카테고리 헤드 (Bold 24px)
│   "햇과일 도착"  더 보기 ▶  │  카피 + 더보기
│ ┌──┐┌──┐┌──┐┌──┐┌──┐ →   │  가로 스와이프 카드
│ │상품││상품││상품││상품││... │  스와이프 인디케이터
│ └──┘└──┘└──┘└──┘└──┘      │
├─────────────────────────────┤
│ 정육                         │
│ ┌──┐┌──┐┌──┐ →             │
│ └──┘└──┘└──┘                │
├─────────────────────────────┤
│ 수산                         │
│ ...                          │
└─────────────────────────────┘
```

**카드 사양**
- 크기: 140x200 (정사각 이미지 140 + 정보 60)
- 이미지: 140x140 정사각
- 상품명: 14px SemiBold (2줄 ellipsis)
- 가격: 16px Black + 취소선 정가 12px
- badge: 좌상단 absolute (할인율 또는 한정)
- 우드 결 무드 배경 (진열대 느낌)

**핵심 인터랙션**
- 가로 스와이프: scroll-snap-type x mandatory
- 카드 hold 500ms: scale 1.15 + 다른 카드 blur + 정보 확장 (단위·원산지·aiCopy)
- 매장 카드 [전화] 탭: tel: 링크 / [길찾기] 탭: 카카오맵 deeplink
- 카테고리 헤드 [더 보기]: GRID HERO 모드로 카테고리 진입
- 좌우 화살표 (데스크탑) + 스와이프 인디케이터 (모바일)

**색 적용**
- 배경: 베이지 + 우드 텍스처 (`background: linear-gradient(...) + url(wood-pattern.svg)`)
- 카드 배경: white + 그림자 (진열대 부유 느낌)
- 시즌 토큰: 카테고리 헤드 액센트 + 매장 카드 액센트

**모션 사양**
- 스와이프: scroll-snap + momentum
- hold 확대: scale 1→1.15 200ms + sibling cards blur(8px) opacity 0.4
- 카테고리 진입 fade-in: IntersectionObserver
- 매장 카드 parallax: 스크롤 진행률 * 30px

---

### 2-6. POSTER PROMO (포스터 임팩트) — 인쇄 전단 + 모션 패턴

**컨셉**
종이 전단지의 강한 활자/임팩트를 디지털 모션과 결합. 6매체 정합의 본진 — 이 디자인이 인쇄 A3 PDF / POP / MMS 이미지에 그대로 변환된다.

**벤치마크**
- 일본 슈퍼마켓 전단지 (이마트/세븐일레븐 일본)
- 한국 농협 하나로마트 주말 전단
- 명동/홍대 가두 포스터
- 이마트24 모바일 전단 (인쇄 풍 + 모션)

**레이아웃**
```
┌─────────────────────────────┐
│ [Hero 영역 — 50vh]          │
│ ┌─────────────────────┐    │
│ │ 종이결 텍스처 배경  │    │  paper grain (CSS noise + 베이지)
│ │                     │    │
│ │   이번 주            │    │  Display 100px Bold (모션 진입)
│ │   진짜 싸요!         │    │  대형 한글 슬로건
│ │                     │    │
│ │   [빨강 스티커]      │    │  회전 sticker "오늘만!"
│ │    오늘만!           │    │  (transform: rotate(-12deg))
│ │                     │    │
│ │   동네마트          │    │  매장명 (스크립트 폰트)
│ │   5/13 ~ 5/19       │    │  기간
│ └─────────────────────┘    │
├─────────────────────────────┤
│ [상품 슬랩 영역]             │
│ ╔═════════════════════╗    │
│ ║ 삼겹살 600g         ║    │  검정 두꺼운 테두리 (인쇄 느낌)
│ ║ ┌─────┐             ║    │
│ ║ │이미지│ 14,900원   ║    │  이미지 + 정가 (취소선)
│ ║ │     │  ↓ 30% OFF  ║    │
│ ║ └─────┘ 9,900원!!!  ║    │  세일가 (대형 빨강 80px)
│ ║         (100g 1,650)║    │  단가 (작게)
│ ╚═════════════════════╝    │
│ ╔═════════════════════╗    │
│ ║ 청양고추 200g · ... ║    │  슬랩 반복 (6개)
│ ╚═════════════════════╝    │
├─────────────────────────────┤
│ [매장 정보 푸터 — 인쇄풍]    │
│ ━━━━━━━━━━━━━━━━━━━━━     │  점선 절취선
│ 동네마트                     │
│ 영업 09:00 ~ 22:00          │
│ ☎ 02-1234-5678              │
│ 서울 강남구 ...              │
│ ━━━━━━━━━━━━━━━━━━━━━     │
│ [길찾기] [전화]             │
└─────────────────────────────┘
```

**타이포 (인쇄풍 핵심)**
- 슬로건: Pretendard Black 100px, letter-spacing -0.04em, line-height 0.9
- 가격: Pretendard Black 80px, color #DC2626 (인쇄 빨강), tabular-nums
- 상품명: Pretendard ExtraBold 28px
- 푸터: Pretendard Medium 14px, letter-spacing 0.05em
- (옵션) 스크립트 폰트 (매장명): "Nanum Pen Script" 또는 "Gowun Dodum"

**핵심 인터랙션**
- 슬로건 모션 진입: 글자 단위 stagger fade-in + translateY 40px→0 (각 글자 50ms 지연)
- 빨강 sticker: 회전 spring (rotate -12deg → -8deg loop, 1500ms ease-in-out alternate)
- 가격 등장: scale 0.7→1.0 spring-pop + 사운드 ("탕!" 도장 효과음 옵션)
- 슬랩 입장: IntersectionObserver + translateY 30px→0 + opacity 0→1
- 종이결 텍스처: CSS noise filter (또는 `background-image: url(grain.svg)` low opacity)

**색 적용 (인쇄 빨강 본진)**
- 배경: 베이지 본지 #F5F1EB
- 슬랩 테두리: 검정 #171717 3px solid
- 가격: 인쇄 빨강 #DC2626
- sticker: 빨강 배경 + 흰 글씨
- 시즌 토큰: 빨강 sticker grad + 슬로건 액센트

**6매체 변환 사양 (POSTER PROMO 본진)**
- **인쇄 A3 PDF**: 동일 레이아웃 1:1 변환 (단위만 mm로) → CT-F14 paged-pdf
- **POP A4**: Hero 1개 + 슬랩 3개 (한 페이지) → CT-F14 pop-templates
- **MMS 이미지**: 1080x1920 세로, Hero + 슬랩 2개 → 동일 토큰
- **알림톡 첨부**: 1000x1000 정사각, Hero + 슬랩 1개
- **브랜드메시지 랜딩**: 본 URL 페이지 그대로

---

## 3. 공통 디자인 요건

### 3-1. 모바일 뷰포트
- 기본: iPhone 15 Pro (393x852)
- 대응: 360x640 ~ 430x932 (Android/iPhone 폭 전체)
- 데스크탑: 중앙 정렬 max-width 430px + 양옆 회색 배경

### 3-2. 폰트
```html
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
  * { font-family: 'Pretendard Variable', sans-serif; }
  .price-num { font-variant-numeric: tabular-nums; }
</style>
```

### 3-3. og:image (카톡 인박스 미리보기)
각 템플릿마다 og:image 1200x630 JPG 생성 가이드 명시:
- 안전 영역 1040x520 (카톡 inbox crop 고려)
- 상단: 매장 로고 + 매장명 (140px)
- 가운데: hero 상품 1개 또는 슬로건 (350px)
- 하단: 가격 + CTA (140px)
- 시즌 토큰 grad 배경 + WCAG AA 명도비

### 3-4. 6매체 디자인 토큰 (master plan §1-3)
CSS variables로 단일 토큰 정의 → 6매체에 동일 적용:
```css
:root {
  --color-primary: #F97316;      /* 시즌 토큰 primary */
  --color-accent: #EF4444;       /* 시즌 토큰 accent */
  --color-text-strong: #171717;
  --color-text-weak: #6B7280;
  --color-paper: #F5F1EB;        /* 종이 본지 */
  --color-discount: #DC2626;     /* 인쇄 빨강 */

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 40px;
  --space-6: 64px;

  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 24px;

  --font-display: 800;
  --font-body: 400;
  --font-bold: 700;

  --shadow-card: 0 4px 12px rgba(0,0,0,0.06);
  --shadow-lift: 0 8px 24px rgba(0,0,0,0.12);

  --motion-fast: 200ms;
  --motion-medium: 400ms;
  --motion-slow: 800ms;
  --motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

### 3-5. 모션 원칙
- 60fps: `transform` + `opacity`만 사용 (width/top/left 금지)
- 진입 모션 400ms 이내, 마이크로 인터랙션 200ms 이내
- 사용자 prefers-reduced-motion 존중 (`@media (prefers-reduced-motion: reduce)`)
- 자동 진행 (STORY): 일시정지 버튼 명시

### 3-6. 접근성
- WCAG AA 명도비 (텍스트 4.5:1, 큰 글씨 3:1)
- 모든 CTA `role="button"` + `aria-label`
- 자동 진행 콘텐츠 일시정지 버튼
- 스크린리더 슬라이드 카운트
- 키보드 네비 (Tab + Enter)

### 3-7. 1손 엄지 도달
- 주요 CTA 하단 200px sticky
- 헤더 X 버튼 우상단 (양손 가능)
- 카테고리 칩 가로 스크롤 (엄지 좌우 스와이프)

---

## 4. 데이터 스키마 + Mock

### 4-1. 실제 hanjulDM 인터페이스
```ts
interface FlyerRenderData {
  title: string;                  // "5월 둘째 주 행사"
  store_name: string;             // "동네마트"
  period_start: string | null;    // "2026-05-13"
  period_end: string | null;      // "2026-05-19"
  categories: FlyerCategory[];
}

interface FlyerCategory {
  name: string;                   // "청과/야채"
  items: FlyerRenderItem[];
}

interface FlyerRenderItem {
  name: string;                   // "삼겹살"
  originalPrice: number;          // 14900
  salePrice: number;              // 9900
  badge?: string;                 // "30% 할인" / "1+1" / "한정"
  imageUrl?: string;              // 절대 URL 또는 placeholder
  unit?: string;                  // "600g" / "1kg" / "1개"
  origin?: string;                // "국산" / "수입산"
  cardDiscount?: string;          // "삼성카드 5% 추가"
  aiCopy?: string;                // AI 생성 한 줄 카피
}
```

### 4-2. Mock 데이터 (Claude Design용)
```json
{
  "title": "5월 둘째 주 진짜 싸요",
  "store_name": "동네마트 강남점",
  "period_start": "2026-05-13",
  "period_end": "2026-05-19",
  "categories": [
    {
      "name": "축산",
      "items": [
        {
          "name": "삼겹살",
          "originalPrice": 14900,
          "salePrice": 9900,
          "badge": "30% 할인",
          "imageUrl": "https://placehold.co/400x400/E5E7EB/171717?text=삼겹살",
          "unit": "600g",
          "origin": "국산",
          "cardDiscount": "삼성카드 5% 추가",
          "aiCopy": "주말 바베큐엔 역시 두툼한 삼겹살"
        },
        {
          "name": "한우 등심",
          "originalPrice": 49900,
          "salePrice": 39900,
          "badge": "한정 20개",
          "imageUrl": "https://placehold.co/400x400/FEE2E2/991B1B?text=한우",
          "unit": "300g",
          "origin": "국산 1++",
          "aiCopy": "가족 모임용 프리미엄 한우"
        }
      ]
    },
    {
      "name": "청과/야채",
      "items": [
        {
          "name": "청양고추",
          "originalPrice": 2990,
          "salePrice": 1990,
          "badge": "33% 할인",
          "imageUrl": "https://placehold.co/400x400/DCFCE7/166534?text=고추",
          "unit": "200g",
          "origin": "국산",
          "aiCopy": "매운맛 진한 청양고추"
        },
        {
          "name": "한라봉",
          "originalPrice": 24900,
          "salePrice": 19900,
          "badge": "20% 할인",
          "imageUrl": "https://placehold.co/400x400/FED7AA/9A3412?text=한라봉",
          "unit": "5kg",
          "origin": "제주산",
          "aiCopy": "달콤 새콤 제철 한라봉"
        }
      ]
    },
    {
      "name": "수산",
      "items": [
        {
          "name": "활전복",
          "originalPrice": 49900,
          "salePrice": 39900,
          "badge": "20% 할인",
          "imageUrl": "https://placehold.co/400x400/DBEAFE/1E40AF?text=전복",
          "unit": "10미",
          "origin": "완도산",
          "aiCopy": "싱싱한 완도 활전복 10미 한 박스"
        }
      ]
    },
    {
      "name": "공산",
      "items": [
        {
          "name": "우유",
          "originalPrice": 5290,
          "salePrice": 4290,
          "badge": "1+1",
          "imageUrl": "https://placehold.co/400x400/F3F4F6/374151?text=우유",
          "unit": "1.8L",
          "aiCopy": "아침 식탁의 든든한 한 잔"
        }
      ]
    }
  ]
}
```

---

## 5. 시즌·행사 컬러 토큰 (8종 동적 주입)

각 템플릿은 시즌 토큰을 CSS variable로 받아 색만 교체. 레이아웃·인터랙션은 동일.

| 토큰 | primary | accent | text on primary | 적용 조건 |
|------|---------|--------|---------------|---------|
| default | #F97316 | #EF4444 | #FFFFFF | 주간 행사 (디폴트) |
| newyear | #DC2626 | #CA8A04 | #FFFFFF | 설날 (음력 1월) |
| chuseok | #1E40AF | #F59E0B | #FFFFFF | 추석 (음력 8월) |
| christmas | #15803D | #DC2626 | #FFFFFF | 12월 |
| summer | #06B6D4 | #0891B2 | #FFFFFF | 6~8월 |
| winter | #BE123C | #FB7185 | #FFFFFF | 11~2월 |
| grand_open | #1C1917 | #FBBF24 | #FFFFFF | 개점·재오픈·그랜드 오픈 키워드 |
| urgent | #171717 | #EF4444 | #FFFFFF | 타임세일·창고대방출·마감 임박 |

**AI 자동 매핑 규칙** (백엔드 분기):
1. `period_start` 음력 변환 → 설날/추석 매칭
2. `title` 키워드 매칭: "크리스마스"·"성탄" → christmas / "오픈"·"개점" → grand_open / "타임세일"·"창고대방출" → urgent
3. `period_start` 월 매칭: 6-8월 → summer / 11-2월 → winter (위 매칭 미적용 시)
4. 그 외 → default

---

## 6. Claude Design 출력 사양

각 템플릿마다 다음 형식의 self-contained HTML 1개씩, 총 6개:

### 6-1. 파일명 (Claude Design에서 생성 시 명시)
- `01-story.html`
- `02-magazine.html`
- `03-deal-feed.html`
- `04-grid-hero.html`
- `05-catalog-swipe.html`
- `06-poster-promo.html`

### 6-2. 각 HTML 구조
```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>{store_name} - {title}</title>
  <meta property="og:title" content="...">
  <meta property="og:description" content="...">
  <meta property="og:image" content="...">

  <!-- Pretendard CDN -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">

  <!-- Inline CSS (외부 0개) -->
  <style>
    :root {
      /* §3-4 디자인 토큰 + §5 시즌 토큰 default */
    }
    /* 컴포넌트 CSS */
  </style>
</head>
<body>
  <!-- §4-2 mock 데이터 기준 마크업 -->

  <!-- Inline JS (필요 시 — 카운트다운/스토리 자동 진행 등) -->
  <script>
    // mock data를 const DATA = {...} 로 박아 렌더링
    const DATA = { /* §4-2 mock 그대로 */ };
    // 카운트다운/인터랙션 JS
  </script>
</body>
</html>
```

### 6-3. 출력 후 비토 검증 항목
- [ ] 단독 브라우저 오픈 시 즉시 작동
- [ ] 모바일 393x852 + 360x640 + 430x932 모두 정상
- [ ] §3-5 모션 60fps (Chrome DevTools Performance)
- [ ] §3-6 접근성 (axe DevTools 0 critical)
- [ ] §5 시즌 토큰 CSS variable 변경만으로 8종 색 전환 가능
- [ ] §3-4 디자인 토큰이 6매체 변환 가능한 단일 SSOT

---

## 7. 6매체 정합 검증 (master plan §1-3)

각 템플릿이 다음 6매체에 동일 토큰으로 변환 가능한지 확인:

| 매체 | 변환 방식 | 검증 기준 |
|------|---------|---------|
| URL 페이지 | 본 HTML 그대로 | 모바일 풀스크린 |
| 인쇄 A3 PDF | CT-F14 paged-pdf (Puppeteer) | A3 297x420mm 1:1 |
| POP A4 3종 | flyer-pop-templates 분기 | A4 210x297mm |
| MMS 이미지 | 1080x1920 세로 캡처 | 이미지 1개 |
| 알림톡 첨부 | 1000x1000 정사각 | 이미지 1개 |
| 브랜드메시지 랜딩 | URL 페이지 + IMC 메타 | 카카오 챗 미리보기 |

**6종별 6매체 변환 우선순위** (정합 점수):
- STORY: URL ★★★★★ / 인쇄 ★★ / POP ★★ (디지털 본진)
- MAGAZINE: URL ★★★★★ / 인쇄 ★★★ / POP ★★ (디지털 본진)
- DEAL FEED: URL ★★★★★ / MMS ★★★★ (디지털 본진, 카운트다운 디지털 전용)
- GRID HERO: URL ★★★★★ / 인쇄 ★★★★ / POP ★★★★ (균형)
- CATALOG SWIPE: URL ★★★★★ / 인쇄 ★★ (디지털 본진, 가로 스와이프)
- POSTER PROMO: URL ★★★★ / 인쇄 ★★★★★ / POP ★★★★★ / MMS ★★★★★ (인쇄 본진)

→ **POSTER PROMO**가 6매체 정합 본진. 인쇄·POP·MMS·알림톡까지 1:1 변환. 사장님이 매장 벽에 붙이고 카톡으로도 발송하는 시나리오.

---

## 8. 비토 통합 작업 (Claude Design 출력 수령 후)

### 8-1. 코드 수정 범위
1. **`flyer-templates.ts` CT-F14** — 8 엔진 함수 → 6 엔진 함수로 재작성
   - `renderStoryEngine(data, token)` 신규
   - `renderMagazineEngine(data, token)` 재작성 (Claude Design 출력 기반)
   - `renderDealFeedEngine(data, token)` 신규
   - `renderGridHeroEngine(data, token)` 신규 (구 grid 확장)
   - `renderCatalogSwipeEngine(data, token)` 신규
   - `renderPosterPromoEngine(data, token)` 신규 (구 editorial/showcase 확장)
   - `RENDERER_MAP` 22 → 6 + 폴백 16

2. **`flyer-business-types.ts` CT-F13** — `TEMPLATE_REGISTRY` 22 → 6
   - 신규 라벨: `story` / `magazine` / `deal_feed` / `grid_hero` / `catalog_swipe` / `poster_promo`
   - `getAvailableTemplates` commonCodes 축소 + 폴백 매핑 박음
   - DB `flyer_business_types.available_templates` JSON 업데이트 안내

3. **`design-tokens.json`** — §5 시즌 토큰 8종 신규 (현재 design-tokens.json에 토큰 키 추가)

4. **신규 `season-resolver.ts`** — period_start/title 기반 시즌 토큰 자동 매핑 함수
   ```ts
   export function resolveSeasonToken(data: FlyerRenderData): SeasonToken
   ```

5. **`FlyerPage.tsx` frontend** — `DEFAULT_TEMPLATES` 6→6 (코드/라벨/desc/color 신규)

6. **DB 마이그레이션 X** — 기존 발행 전단 deprecated templateCode는 CT-F14 `renderTemplate` 폴백 분기로 안전 렌더

### 8-2. 작업 순서
1. Harold가 Claude Design에 본 .md 입력 → 6 HTML 수령
2. 비토가 각 HTML을 `renderXxxEngine` 함수로 분해 + CSS variable 토큰화
3. mock 데이터 → 실제 FlyerRenderData 인터페이스 바인딩
4. season-resolver 작성 + 시즌 토큰 8종 주입 분기
5. RENDERER_MAP 폴백 매핑 (deprecated 16종 → 6종 매핑)
6. frontend DEFAULT_TEMPLATES + business-types DB 업데이트
7. 로컬 빌드 → atomic safe-build → hdm-push
8. 6매체 변환 검증 (URL/PDF/POP/MMS/알림톡/브랜드메시지)
9. PHASE 0 검증 5건 (Harold/비토/직원 3인/마트 사장/고객 5인)

---

## 9. PHASE 0 검증 기준 (master plan §1-4)

각 템플릿이 다음 5점 척도 모두 4.0 이상 통과 시 PHASE 0 완료:

| 검증자 | 검증 항목 | 통과 기준 |
|--------|---------|---------|
| Harold | 첫 0.5초 임팩트 | 4.0/5.0 이상 |
| 비토 | 6매체 일관성 | 4.0/5.0 이상 |
| 인비토 직원 3인 | 디자이너급 인식도 | 평균 4.0/5.0 이상 |
| 실제 마트 사장 1인 (블라인드) | "외주보다 낫다" 인식 | "그렇다" 명시 |
| 실제 마트 고객 5인 (블라인드) | "전단지 클릭해서 보고 싶다" | 5인 중 4인 이상 "예" |

---

## 10. 본 문서 다음 단계

1. **즉시**: Harold가 본 .md 통째로 Claude Design 새 프로젝트에 붙여넣기
2. **Claude Design 작업**: 6개 HTML 생성 (`01-story.html` ~ `06-poster-promo.html`)
3. **수령 위치**: `C:\Users\ceo\projects\hanjulDM\status\hanjul-flyer-revamp\claude-design-output\` 폴더에 6개 HTML 저장
4. **비토 통합**: §8 코드 수정 범위 따라 CT-F14/CT-F13/design-tokens/season-resolver/FlyerPage 일괄 작업
5. **빌드·배포**: atomic safe-build + hdm-push + 6매체 검증
6. **PHASE 0 검증**: §9 5건 통과 후 PHASE 1 진입

---

> **본 문서는 한줄전단AI 디자인 템플릿 6종 재설계의 단일 진실 원천(SSOT)이다.**
> **업데이트 시점:** Claude Design 출력 수령 시 / 비토 통합 완료 시 / PHASE 0 검증 통과 시
