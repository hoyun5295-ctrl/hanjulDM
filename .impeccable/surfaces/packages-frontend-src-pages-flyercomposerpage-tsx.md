---
version: 1
slug: "packages-frontend-src-pages-flyercomposerpage-tsx"
primary_target: "packages/frontend/src/pages/FlyerComposerPage.tsx"
related_targets: ["packages/backend/src/utils/flyer/product/flyer-templates.ts"]
---

# 제작 화면(사장님) + 모바일 전단 카드 — surface brief

Scope: 제작 메인(FlyerComposerPage 홈·제작) = Operate · 모바일 전단 상품 카드 규칙(전 템플릿 공용) = 판매 열람(주부).
Audience: 사장님 50~60대(제작) · 주부 40~60대(문자·알림톡 링크로 휴대폰 열람).
Task: 사장님 = 상품 담기 → 완성 전단 확인 → 발송. 주부 = 무엇이 얼마나 싼지 즉시 이해 → 방문·주문.
Constraints: 라이트 테마 토큰(src/index.css) · 모델명·브라우저 대화상자 금지 · 사진 없는 상품 다수 · 고객 문안 불변.
Roll: degraded(챌린저 없음) · seed fad8fcf5 · 배정 = 장보기 장부(4) · 사용자 선택 = 매대 가격표(내 1순위 · pick).

## Direction contract
THESIS: 한국 마트 매대의 노란 가격표가 이 서비스의 얼굴이다 — 가격이 주인공이고 할인은 계산하지 않게 보인다. 거절하는 기본형 = 그라디언트 카드와 빈 히어로 문구가 첫 화면을 차지하는 SaaS 홈, 장식 표지가 상품을 밀어내는 화려한 전단.
OWN-WORLD: 쇼카드 노랑(#FFE14D 계열) 바탕 판 + 빨강(할인·행사가) + 먹 검정(상품명·숫자) + 흰 종이 작업면. 가격 숫자는 굵은 고딕 대형, 할인율은 빨간 사각 딱지, 정상가는 취소선. 테두리는 두꺼운 먹선 1.5~2px, 모서리 작게(4~6px). 장식 없음.
STORY: 사장님은 첫 화면에서 「내가 담은 상품이 이런 전단이 된다」를 실물로 보고, 엑셀 양식으로 한 번에 담고, 발송한다. 주부는 열자마자 상품·행사가·할인율을 읽고 아끼는 금액을 안다.
FIRST VIEWPORT: (제작 홈 데스크톱) 상단 가는 메뉴 바 · 왼쪽 60% = 「이번 주 전단」 작업대(담은 상품 수 · 손님이 아끼는 돈 합계 · 상품 담기 3경로 큰 버튼 = 엑셀 양식 · POS 인기 · 지난 전단) · 오른쪽 40% = 휴대폰 프레임 안 실제 전단 미리보기(첫 화면에 상품 4개+). 아래 = 내 전단 현황(발행 중 · 조회 · 마감 임박). 주 행동 = 「엑셀로 상품 담기」 노란 쇼카드 버튼. (전단) 매장명·행사·기간 한 줄 띠 → 곧바로 상품 카드.
FORM: 매대 가격표(쇼카드) · 내 목록 1순위 · seed fad8fcf5. 대표 움직임 = 상품을 담을 때 「손님이 아끼는 돈」 합계가 가격표 숫자처럼 갱신.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
