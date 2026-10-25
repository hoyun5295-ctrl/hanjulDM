# 17. 한줄전단 1차 강화 — 파일 등록형 제작 · 템플릿 20종 목업 미리보기 · 한줄로 완전 분리 (설계)

> 작성 2026-10-25 · 5역할 브레인스토밍(기획·프론트·백엔드·디자이너·회의론자) 2라운드 + 회의론자 최종 검증 수렴
> 상태 = **승인(1025) · 구현 완료 · Codex 적대 approve(hanjulDM 3R · targetup 1R) · 배포 대기** — 구현 중 바뀐 점 = §11 · 리뷰 = §12
> 범위 밖(이번에 안 함) = POS-Agent 일체 · 인쇄/POP 템플릿 품질 보강(2차) · DB/QTmsg/키/서버 분리(별도 단계 §6-3)

## 0. 원래 안건 (Harold 원문 요지)
1. Excel/CSV **예시 양식**을 주고, 그 양식으로 파일을 올리면 AI가 데이터를 정형화해 우리 양식에 맞춰 **기초 전단**을 만들어 준다.
2. 템플릿 **최소 20개**, 고르기 전에 **예시를 미리 보여 준다**. 예시는 목업(카테고리별 5~10개 상품), 이미지는 **그림으로 대체**.
3. 한줄로와 **완전히 별도 프로젝트로 분리**하는 것을 감안해 진행한다.

### 축 대조표 (이 축이 없으면 접수가 닫히는가)
| 접수 | 닫는 축 | 없으면 |
|---|---|---|
| 1 예시 양식 | §2-1 양식 파일 + 모달 링크 | 양식 없음(현재 grep 0) |
| 1 파싱·정형화 | §2-2 파서 · §2-3 값 규칙 · §2-4 매핑 | 한글 CSV 깨짐 · 묶음가 2원(실측) |
| 1 기초 전단 | §1 F2 칸 승계 · §2-5 확인 화면 | 엑셀 카테고리·뱃지가 렌더까지 못 감 |
| 2 템플릿 20 | §3-1 새 엔진 3 + §3-2 판 7 | 현재 모바일 10 |
| 2 목업 미리보기 | §3-3 목업 · §3-4 PNG · §3-5 갤러리 · §1 F1 | 현재 색 견본뿐, 3엔진은 그림 자체가 안 나옴 |
| 3 분리 | §6-1 hanjulDM 안 · §6-2 targetup 안 | 복사 코드가 한줄로 표를 조회 · targetup에 전단 잔재 |

## 1. 선행 결함 (1차 첫 단계 — 이것 없이 목업 갤러리가 서지 않는다)
- **F1 3엔진 무이미지 그림 결함 (실측 확인)** — deal_bento·grid_muji·poster_pop이 SVG 문자열(큰따옴표 포함, `flyer-render-prep.ts:170~`)을 `style="..."` 속성과 CSS `content` 변수에 넣는다(`flyer-templates.ts:2998, 3347, 3541, 3897`). 속성이 끊기고 CSS content는 SVG를 그리지 못한다.
  - 처방: 나머지 7엔진처럼 `<span class="picto">${svg}</span>` 요소로 그린다. 해당 `.ph::after { content: var(--ph-emoji) }`(:3446, :4005) 삭제.
  - 같은 뿌리 전수: `categoryPictogram(` 호출 17곳 중 style/CSS 변수로 들어가는 곳 = 위 4곳뿐(grep 확인). 게이트 = 「렌더 HTML에서 `style="` 속성 값 안에 `<svg` 0건」 전 엔진 검사.
  - 픽토그램 선 색 `stroke="#fff"` 고정 → `currentColor`(밝은 바탕에서 안 보임, 16번 :178). 각 엔진의 picto 컨테이너에 color 지정.
- **F2 엑셀 칸이 렌더까지 못 감** — 같은 뿌리 3곳, 같은 날 수정.
  - `FlyerComposerPage.tsx:277-297` addFromExcel이 category·badge·cardDiscount 미승계.
  - `flyers.ts:898-916` auto-build가 items의 category를 버리고 이름만으로 재분류.
  - `flyers.ts:918` `new Map(name→item)` — 같은 이름 행이 하나만 남음.
  - 처방: addFromExcel이 칸을 모두 넘기고, auto-build는 **유효한 카테고리(분류기 카테고리 목록 안)가 오면 그대로 쓰고 없을 때만 분류**. Map 키 = 원래 순서 인덱스.
  - 게이트: 「엑셀 행(카테고리·뱃지·카드할인·묶음) → auto-build → renderTemplate HTML에 그 값이 보인다」 1건.

## 2. 파일 등록형 제작
### 2-1. 예시 양식 (정적 xlsx 1개)
- 위치: `packages/frontend/public/samples/hanjul-flyer-sample.xlsx` (openpyxl로 1회 만들어 파일만 저장소에 둔다 · 생성 스크립트는 저장소에 넣지 않는다).
- 시트1 「상품 입력」: 1행 한글 헤더(필수 열 진한 칠) + 빈 행 300. 안내 = 헤더 셀 메모.
- 시트2 「작성 예시」: 예시 8행(1+1 · 묶음 · 카드할인 · 한정 · 원가 없음 · 100g 규격 · 긴 상품명 · 수입 원산지).
- 시트3 「목록」(숨김): 카테고리·행사 뱃지 드롭다운 원천. 시트1의 해당 열 = 데이터 유효성(목록 참조).
- 열(순서 고정): `카테고리 · 상품명* · 규격 · 정상가 · 행사가* · 묶음 수량 · 묶음가 · 행사 뱃지 · 카드할인 · 한정 수량 · 원산지 · 대표 상품`
  - 행사기간·매장명은 양식에 없다(제작 화면 칸에서 받음 — 두 곳 진실 금지).
  - 행사 뱃지 값 = `1+1 / 2+1 / 한정 / 카드할인 / 오늘만 / 신상품`.
  - 카테고리 값 = 픽토그램 카테고리 매핑 키와 같은 목록(§3-3).
- 다운로드 = `ExcelUploadModal` 드롭존 안 링크 1개(제작·POP·인쇄 3소비처 공통). CSV 양식은 배포하지 않는다(사장님이 올린 CSV는 받는다).

### 2-2. 파서 (CT-F 신규 `utils/flyer/product/flyer-sheet-reader.ts`)
- multer `memoryStorage`(현 `/tmp/flyer-excel/` 실패 경로 잔존 제거, `flyers.ts:1395`).
- CSV(확장자·바이트 판정): `TextDecoder('utf-8',{fatal:true})` → 예외 시 `TextDecoder('euc-kr')` → `xlsx.read(string,{type:'string'})`. 새 의존성 0(백엔드 역할 Node 실측).
- 시트 선택: 이름이 「작성 예시」「목록」인 시트 제외 → 「상품 입력」 있으면 그것 → 없으면 헤더 점수 최고 시트. 응답에 시트 목록을 내려 화면에서 바꿀 수 있게(바꾸면 같은 파일로 재요청).
- 제목행 탐지: `sheet_to_json({header:1})` 앞 10행 중 동의어 표에 맞는 칸이 2개 이상인 첫 행 = 헤더. 못 찾으면 「헤더 행을 찾지 못했습니다」 400.
- 출력: `{ sheets, sheetName, headerRow, headers, rows: string[][] }` (값은 문자열 그대로 — 해석은 §2-3만).

### 2-3. 값 규칙 (CT-F 신규 `utils/flyer/product/flyer-value-normalizer.ts`)
- 원칙: **값은 규칙만 만든다. AI가 값을 쓰는 경로 0.** 못 읽으면 `null + 사유`(0 금지).
- 가격: `1,980원`·`₩1980`·`1980` → 1980. `2개 5000원`이 가격 칸에 오면 = 묶음(수량 2, 묶음가 5000)으로 해석. 숫자 2개 이상 섞인 그 밖의 문자열 = null + 「가격을 읽지 못했습니다」.
- 묶음: 수량·묶음가 칸 또는 가격 칸 해석 결과 → 렌더 값은 `salePrice = 묶음가`, `unit = "N개"`(규격이 있으면 `"N개 · 규격"`). **새 렌더 필드 없이** 기존 가격·단위 표시를 그대로 쓴다.
- 행사 뱃지: 허용 목록 값만 badge로. `한정` + 한정 수량 N → badge `한정 N`(기존 정규식 `flyer-templates.ts:1036`이 읽는 형태).
- 카드할인: 문자열 그대로 `cardDiscount`(이미 렌더 필드 있음).
- 100g당: 칸 없음 — 규격에서 기존 계산(`flyer-templates.ts:1779-1797`)이 한다.
- 행 판정: `ok | needsReview | dropped`, 사유 배열. 상품명 없음 = dropped(사유 「상품명 없음」). 가격 null·0 = needsReview(사유 「가격 확인 필요」 — **인쇄 차단 대상**). 단위·원산지 이상 = needsReview(표시만).
- needsReview 행은 할인율 자동 승격(`flyer-excel-mapper.ts:193-197`) 끔.

### 2-4. 헤더 매핑 (CT-F24 `flyer-excel-mapper.ts` 개정)
- 헤더가 우리 양식과 정확히 같으면 **AI 0회**.
- 아니면 AI 헤더 매핑만. 직접 fetch(:88-127) 삭제 → `callAIWithFallback`(§6-1에서 떼어 낸 파일).
- AI 응답·클라이언트가 보낸 mapping 모두: 값 = 필드 키 허용 목록, 키 = 실존 헤더. 한 필드에 헤더 2개 = 해당 행 전부 needsReview(가격 필드면 인쇄 차단).
- 매핑 필드 8 → 12(bundle_qty, bundle_price, badge, card_discount, limit_qty, featured 추가 · image_url 유지).

### 2-5. 라우트 · 확인 화면
- `POST /upload-excel` → `{ mapping, mappingSource: 'template'|'ai', headers, sheets, sheetName, rows:[{index, status, reasons, raw, product}], summary:{ok, review, dropped} }`. 
- `POST /apply-excel-mapping` → 같은 파일 + 사장님이 고친 mapping/sheet로 같은 형태 재계산(memoryStorage).
- `MappedProduct`: 기존 8키 이름·뜻 불변 + optional `badge, cardDiscount, review?: string[]`.
- 화면(ExcelUploadModal) 3단계 → **2단계**(올리기 → 결과). 열 연결은 결과 화면의 접힌 줄 「열 연결 바꾸기」 안.
  - needsReview 행 맨 위 · 원문 병기 · 그 칸만 그 자리 수정(확인 필요 행에만 수정 칸).
  - dropped 수·사유 늘 표시. 20행 절단은 ok 행에만(확인 필요 행은 전부).
  - 모바일 폭 = 행 카드.
  - 확인 필요 0건 = 「N개 담기」 1클릭.
- 인쇄 관문(Composer): 담긴 상품 중 `review`에 가격 사유가 남아 있으면 인쇄 뽑기 차단(이유 한 줄 표시). 모바일 발행은 허용. POP·인쇄 화면은 새 키를 무시해도 지금처럼 동작.

## 3. 템플릿 20종 + 목업 미리보기
### 3-1. 새 엔진 3 (현 10종이 못 덮는 상품 수 축)
| 코드 | 이름 | 장면 | 상품 수 |
|---|---|---|---|
| `price_board` | 빼곡 가격표 | 무사진 고밀도 · 품목명·규격·가격 줄표 · 카테고리 띠 | 30+ |
| `single_hero` | 단일 상품 폭탄 | 영웅 1 + 보조 0~2 · 초대형 가격 | 1~3 |
| `gift_set` | 명절 선물세트 | 세트 카드 · 가격대 묶음(3만/5만/10만) · 구성품 한 줄 | 6~20 |
- 기존 엔진과 같은 계약: `FlyerRenderData` → HTML · 밴드 3단 · `data-product` · 무이미지 슬랩 · 픽토그램 요소 · 시즌 토큰 · variant 주입.
- 자동 선정(template-recommender): 상품 1~3 → single_hero, 30+ & 사진 비율 낮음 → price_board, 시즌 설·추석 & 선물/세트 비율 높음 → gift_set. 그 밖은 지금 규칙 그대로.

### 3-2. 판 7 (기존 엔진 + 구조 차이 · 정직 표기)
- **판 = 독립 템플릿 코드.** `flyers.template`에 판 코드가 저장되므로 다시 열어도 같은 판(회의론자 최종 검증의 「variant coerce 왕복에서 판이 사라짐」을 variant를 거치지 않는 구조로 막는다).
- 구조: `PAN_TABLE[code] = { engine, layout:{ hero: 0|1|2, cols: 2|3, band: 'auto'|'dense' }, season?, mockSet }`. `renderTemplate`이 판 코드면 engine으로 풀고 `data.layout`을 넣는다. 엔진은 layout을 **DOM으로** 따른다(히어로 섹션 수 · `data-cols` · 밴드 강제).
- layout을 따르게 고치는 엔진 = grid_hero · fresh_daily · deal_feed · poster_pop · market_board (5종). layout 미지정 = 지금과 같은 출력(기존 발행 전단 불변 — 게이트로 고정).

| 판 코드 | 이름 | 엔진 | layout | 시즌 | 목업 |
|---|---|---|---|---|---|
| `gh_dense3` | 위클리 빼곡 3열 | grid_hero | hero 0 · cols 3 · dense | — | 공산 |
| `gh_opening` | 개점 축하판 | grid_hero | hero 2 · cols 2 | opening | 혼합 |
| `fd_produce` | 청과 산지판 | fresh_daily | hero 1 · cols 3 | summer | 청과 |
| `fd_seafood` | 수산 새벽판 | fresh_daily | hero 2 · cols 2 | — | 수산 |
| `df_weekend` | 주말 타임세일판 | deal_feed | hero 0 · cols 2 · dense | clearance | 혼합 |
| `pp_chuseok` | 추석 대목판 | poster_pop | hero 1 · cols 2 | chuseok | 선물 |
| `mb_seol` | 설 장터판 | market_board | hero 0 · cols 3 | seol | 정육 |
- 갤러리 표기: 이름 뒤에 「· ○○ 판」 칩(기반 디자인 이름).

### 3-3. 목업 (CT-F 신규 `utils/flyer/product/template-mocks.ts`)
- 세트: 정육 · 수산 · 청과 · 공산 · 유제품 · 생활 · 선물 · 혼합(앞 6세트에서 섞음). 세트당 5~10개.
- 세트마다 의무 1개씩: 1+1 · 묶음 · 카드할인 · 한정 · 원가 없음. `imageUrl` 전부 비움 → 픽토그램이 그림 대체.
- 엔진별 목업: 새 엔진은 상품 수 축에 맞춘 전용 세트(price_board 32개 · single_hero 2개 · gift_set 12개). 기존 10엔진은 레지스트리의 대표 장면 세트.
- 픽토그램 추가(기존 화풍 24격자·1.6선·둥근 끝): `egg · rice · kimchi · ramen · tissue · gift` 6종 → 카테고리 매핑에 계란·쌀/잡곡·김치/반찬·라면/면·휴지/생활·선물세트 추가. 품목 단위 30종 + 상품명 키워드 매핑은 2차.
- 렌더 seed 고정(재현성).

### 3-4. 미리보기 PNG (요청 시 렌더 + 디스크 캐시)
- `GET /api/flyer/business-types/templates/:code/sample.png` (flyerAuthenticate · 코드 허용 목록).
- `renderTemplate(code, mock)` → og-image puppeteer 싱글톤(`og-image.ts:28-42` 재사용 · 같은 브라우저 공유) → 393px 폭, 머리+첫 상품 줄 크롭(높이 720) → PNG.
- 캐시: `uploads/template-samples/{renderHash}/{code}.png`. `renderHash` = 부팅 시 렌더 관여 dist 파일(flyer-templates · flyer-render-prep · template-mocks · flyer-business-types · season 토큰) 내용 sha1 앞 12자. 템플릿을 고치면 해시가 바뀌어 자동 재생성 — 낡은 견본 0.
- 예열: 부팅 후 30초 뒤 20종 순차 렌더(배포 단계 추가 없음). 실패는 로그만, 요청 시 재시도.

### 3-5. 갤러리 (FlyerComposerPage 갤러리 시트)
- 색 견본(:1064-1075) → `<img loading="lazy">` 썸네일. 2열(모바일)/3열(sm 이상).
- 카드 = 이름 · 장면 한 줄 · 칩(상품 수 범위 · 「사진 없어도 됨」/「사진 있으면 좋음」 · 판이면 「○○ 판」).
- 머리 = 행사 성격 걸러보기(전체 · 주간 · 특가 · 신선 · 명절 · 프리미엄).
- 썸네일 아래 한 줄 「예시 상품으로 그린 모습」.
- **카드 누르면 즉시 적용(1클릭 유지)** — 적용 직후 실데이터 미리보기가 「크게 보기」. 상세 창 없음.
- 레지스트리에 `scene`, `itemRange`, `needsPhoto`, `baseOf?` 필드 추가(갤러리·자동 선정 공용).

### 3-6. 게이트(시험) 개정
- `super-versionup-gates.test.ts:350` REGISTRY 정확 일치 → 엔진 13 + 판 7 명시 목록.
- 판 게이트: 판 → 실존 엔진 · 목업 렌더 스모크 · **같은 엔진 기본 렌더와 DOM 개수(히어로 섹션 수 · data-cols · 밴드) 2개 이상 다름** · layout 미지정 렌더 = 개정 전 스냅샷과 동일.
- 전 20종: 목업 렌더 스모크(밴드 3단 · data-product · 무이미지 픽토그램 요소 존재 · style 안 `<svg` 0).

## 4. 시험 (seam)
| seam | 시험 |
|---|---|
| 파서 | CP949 CSV · UTF-8 BOM CSV · 제목행 2줄 xlsx · 「작성 예시」 시트 건너뜀 · 헤더 없음 400 |
| 값 규칙 | `1,980원`·`2개 5000원`·`3+1`·`카드 10%`·`한정 30` · 못 읽음 → null+사유 · 상품명 없음 dropped |
| 매핑 | 양식 일치 → AI 0회(호출 스파이) · AI가 없는 헤더/없는 필드 반환 → 버림 · 중복 매핑 → needsReview |
| 양식 파일 | 저장소 xlsx를 읽어 시트1 헤더 = 파서 양식 헤더 · 「목록」 시트 카테고리 = 픽토그램 매핑 키 |
| F2 | 엑셀 행 → auto-build → HTML에 카테고리·뱃지·카드할인·묶음 표시 |
| 템플릿 | §3-6 |
| 분리 | §6 게이트 |
- 실행: hanjulDM `npx vitest run`(패키지 전체) · backend `tsc` 0 · frontend·admin-frontend `npm run build` · targetup backend `tsc` 0 + 전체 시험.

## 5. 영향표 (소비처 전수)
| 대상 | 소비처 | 영향 |
|---|---|---|
| ExcelUploadModal 응답 형태 | FlyerComposerPage:1092 · PopPage:523 · PrintFlyerPage:855 | MappedProduct 8키 불변 · 새 키 optional → POP·인쇄 무수정 동작. 모달 내부만 2단계로 |
| /upload-excel · /apply-excel-mapping | 모달 1곳(grep) | 같은 커밋 |
| auto-build 카테고리 유지 | FlyerComposerPage requestBuild 1곳 | 카테고리 없는 소스(POS·카탈로그·지난 전단)는 지금처럼 분류 |
| TEMPLATE_REGISTRY 10→20 | business-types GET · flyers.ts:936 화이트리스트 · 게이트 · 화면은 FlyerComposerPage 1곳 | admin-frontend·frontend 다른 소비 0건(grep 확인) |
| renderTemplate 판 해석 | short-urls(발행·미리보기) · og-image · flyers preview | 기존 코드 = 그대로 해석. 새 코드만 PAN_TABLE |
| 5엔진 layout | 그 엔진의 모든 렌더 | layout 미지정 = 개정 전 HTML과 동일(스냅샷 게이트) |
| 3엔진 F1 | 그 엔진 무이미지 렌더 | 그림이 보이게 바뀜(의도) |
| 픽토그램 currentColor | 픽토그램 쓰는 17곳 | 컨테이너 color 지정 — 전 엔진 육안 + 스모크 |
| template-recommender 신규 3 | auto-build · 발행 추천 | 기존 저장 전단 불변(템플릿 코드 저장) |
| flyers.template 컬럼 | 판 코드 저장 | **길이 미검증 — 아래 SQL**(판 코드 최대 10자) |

## 6. 한줄로 분리
### 6-1. hanjulDM 저장소 안 (1차)
- `callAIWithFallback` + anthropic/openai 클라이언트 초기화를 `utils/flyer/ai/flyer-ai-call.ts`로 원본 복사 이동 → 소비처 2곳(`flyer-ai-copy.ts:8`, `flyer-category-classifier.ts:13`) + 매퍼가 여기를 import.
- 닫힌 섬 7파일 삭제(주재자 import 전수 확인): `services/ai.ts · utils/messageUtils.ts · utils/customer-filter.ts · utils/normalize.ts · utils/standard-field-map.ts · utils/format-number.ts · utils/safe-field-name.ts`. (`normalize-phone.ts`는 섬 아님 — 유지)
- `middlewares/auth.ts` 삭제(import 0 · 한줄로 `user_sessions` 갱신 코드).
- `utils/sms-queue.ts`: 한줄로 users·companies 조인 = `getCompanySmsTables`(:47-109) + 그것만 부르는 `hasCompanyLineGroup`(:116) · `getCampaignSmsTables`(:470) · `getCompanySmsTablesWithLogs`(:492) · `lineGroupCache` 삭제(외부 소비 0 — 구현 시 재grep).
- `sms_line_groups`: 읽기 유지. 게이트 = hanjulDM 전체에서 `sms_line_groups` 대상 INSERT/UPDATE/DELETE 0건. 공유 env `SMS_TABLES` 폴백 발생 시 `console.warn('[flyer] 회선 폴백 — 회사 라인그룹 없음', companyId)`(`flyer-sms-queue.ts:38-40`).
- 게이트: hanjulDM 소스에 `services/ai` import 0 · 삭제 파일 부활 0.

### 6-2. targetup 저장소 안 (1차)
- 삭제: `packages/flyer-frontend/` · `packages/pos-agent/` · `flyer-templates/` · `flyer_image/` · `packages/backend/src/utils/product-images.ts`(import 0 — 회의론자 확인).
- `scripts/monitor-dist.sh:80` `check_and_recover "flyer-frontend"` 삭제(같은 커밋 — 안 지우면 매 분 「자동 복구 실패」 경보).
- `session-manager.ts:449` 허용 목록에서 `'flyer'` 제거. 단 `'flyer'`가 들어오면 `'hanjul'`로 바꾸지 않고 **로그인 400 거절**(조용히 한줄로 세션을 밀어내는 경로 차단 · 소비처 `auth.ts:66, 610, 754`).
- `tools/gen-super-admin-permission-matrix.js:145` 문서 행 정리.
- targetup은 이 변경만. 한줄로 발송·정산 경로 무접촉.

### 6-3. 별도 단계 (1차 밖 · 결정 필요)
`sms_line_groups` 회선 이전 · DB 분리 · QTmsg 회선 · IMC/Toss 키 · 서버 분리 여부 · LESSONS 1-1 「코드 복제 · 인스턴스 공유」 결정문 개정 · flyer 표 → 한줄로 표 FK 실측(pg_constraint).

## 7. 구현 순서 (주재자 단독 · 순차)
1. F1 3엔진 그림 + currentColor → 게이트
2. 분리 6-1(AI 파일 이동 · 섬 삭제 · sms-queue 정리 · 게이트) — 이후 작업이 새 AI 파일을 쓰므로 먼저
3. 파서 · 값 규칙 · 매핑 · 라우트(§2-2~2-5 백엔드) → 시험
4. F2 칸 승계(auto-build · addFromExcel) → 게이트
5. 확인 화면 2단계 · 인쇄 관문 · 예시 양식 파일
6. 픽토그램 6종 · 목업 · 새 엔진 3 · 판 7(5엔진 layout) · 추천기 → 게이트
7. 미리보기 PNG 라우트 · 예열 · 갤러리
8. targetup 6-2
9. 전체: tsc 0 · vitest 전체 · 프론트 빌드 · 모델명 grep 0 · native dialog 0 → 내 적대 검토 → **Codex 적대 리뷰(hanjulDM · targetup 각각) 지적 0까지**
10. STATUS 갱신 · 배포 명령 보고

## 8. 배포 전 Harold 확인 (명령은 배포 단계에서 하나씩)
- `flyers.template` 컬럼 형식·길이 — 판 코드(최대 10자) 저장 가능 여부:
  `SELECT data_type, character_maximum_length FROM information_schema.columns WHERE table_name='flyers' AND column_name='template';`
- targetup `user_sessions`에 최근 `app_source='flyer'` 행 0건(400 거절 전환 전).
- 서버 nginx가 targetup `packages/flyer-frontend/dist`를 서빙하는 블록이 남아 있지 않은지.
- DDL 0 · 두 저장소 배포(hanjulDM: hdm-push → build:safe → pm2 restart hanjuldm-api / targetup: 별도).

## 9. 축 밖 발견 (기록 — 착수는 Harold 판단)
- **쿠폰 문자 await 누락** `routes/flyer/coupons.ts:104` — `getAuthSmsTable()`(async, `sms-queue.ts:179`)을 await 없이 써서 `INSERT INTO [object Promise]` → catch가 로그만(:118). 코드로 확인 · 운영 실패 여부는 로그 미확인. 처방 = `await` 1줄. §6-1에서 sms-queue를 만지므로 **같은 배포에 넣기를 추천**(승인 시 포함).

## 10. 회의 기록 — 갈렸던 곳과 택한 근거
| 쟁점 | 갈린 안 | 택한 것 · 근거 |
|---|---|---|
| 20종 구성 | 색 프리셋 20(회의론자 1R) · 새 엔진 10(기획 1R) · 새 엔진 6+시즌 4(디자이너 1R) | 엔진 13 + 판 7. 색만 다른 판은 16번 통합 원칙 위반(전원 합의). 판 구조 = 템플릿 코드(회의론자 최종 검증의 variant 왕복 결함을 회피) |
| 미리보기 | 배포 시 사전 PNG(프론트 1R) · iframe 20(디자이너 1R) | 요청 시 PNG + 렌더 해시 캐시(백엔드) — 낡은 견본 0, iframe 20 = POST·DB 20 회피. 전원 동의 |
| 상세 창 | 카드→상세→이걸로(디자이너) | 1클릭 즉시 적용(프론트·회의론자) — 적용 직후 실미리보기가 크게 보기 |
| 인쇄 차단 | 확인 필요 1건이면 차단(기획·프론트) | 가격 사유만 차단(회의론자 2R) — 전 경고 차단은 칸 비우기 우회 유발 |
| 분리 범위 | sms_line_groups 이번에 끊기(백엔드 1R) | 읽기 유지 + 쓰기 0 게이트(전원 2R) — 회선 이전 중 공유 폴백 흔들림 위험 |
| 그림 | 품목 30종(디자이너·프론트) | 6종 추가 · 30종+키워드 매핑은 2차 — 오매칭 그림이 인쇄까지 가는 게이트 미설계 |
| 묶음가 표시 | 새 렌더 필드(기획 우려) | salePrice=묶음가 · unit="N개" — 엔진 무수정 표시 |

## 11. 구현 반영 — 설계와 달라진 점 (2026-10-26)
| 항목 | 설계 | 구현 | 이유 |
|---|---|---|---|
| F2 카테고리 | 분류기 목록 안 카테고리만 유지 | 매장이 적은 값 그대로(20자 · 「기타」 제외) | 「정육」처럼 분류기 밖 매장 표기가 버려진다(고객 문안 불변) |
| F2 범위 | addFromExcel · auto-build | + **엔진 6종 카드에서 뱃지·카드할인 누락**(fresh_daily·market_board·deal_bento·poster_pop·magazine·catalog_dark 실측) · catalog_dark 스포트라이트 상품 목록 중복(객체 비교 결함) · fresh_daily 대표 제외가 이름 비교 | 같은 뿌리(칸이 렌더까지 못 감) — 전 엔진 게이트 |
| F1 범위 | 3엔진 | + story 엔진 클라이언트 폴백 `textContent`(SVG 글자 노출) | 같은 뿌리 |
| 무이미지 | — | fresh_daily 사진 없음 = 빈 회색 칸(이모지 글자 무스타일) → 카테고리 색 + 픽토그램 | 썸네일 실측에서 발견 |
| 판 기반 엔진 | grid_hero·fresh_daily·deal_feed·poster_pop·market_board | **fresh_daily 2 · market_board 2 · poster_pop 3** | grid_hero·deal_feed는 브라우저 스크립트가 그려 서버 HTML로 구조 차이를 검증할 수 없다 |
| 판 코드 | gh_dense3 등 | fd_produce · fd_seafood · mb_seol · mb_dense · pp_opening · pp_chuseok · pp_weekend | 위 |
| 미리보기 캐시 키 | 렌더 관여 dist 파일 해시 | **렌더 HTML 자체의 해시** | 파일 목록 관리 0 · 목업·템플릿 변경 자동 반영 |
| 미리보기 라우트 | flyerAuthenticate | 인증 없음(목업만 · 코드 허용 목록) | `<img>`는 인증 헤더를 못 싣는다 |
| 인쇄 관문 | 제작 화면 | + POP·인쇄 화면 모달 `requirePrice`(가격 미확인 상품을 넘기지 않음) · 제작 화면은 0원 상품도 차단(소스 무관) | 오가격 인쇄 경로 3소비처 전부 |
| 추천기 | 새 엔진 3 규칙 | + 폐기 2코드(magazine_zine·catalog_swipe)를 후보에서 뺌 | 16번 통합 뒤에도 폐기 코드를 추천·저장하던 결함(같은 뿌리 = 레지스트리 단일 기준) |
| getAvailableTemplates | — | 손 등재 목록(폐기 코드 포함 8종) → 레지스트리 전체 | 같은 뿌리 |
| 섬 삭제 | 6파일 | 7파일(+safe-field-name) + `middlewares/super-service-guard.ts`(import 0 · 지운 auth.ts 의 req.user 에 기대던 한줄로 모드 전환 복사본) | import 전수 |
| sms-queue | :47-109 + 3함수 + 캐시 | 캐시는 유지(getTestSmsTables 가 씀) | 실측 |
| AI 클라이언트 | 원본 복사 | 첫 호출 때 생성 | OpenAI SDK 가 키 없으면 생성자에서 throw — 엑셀 라우트까지 부팅 실패 |
| 목업 | 이름 매칭 로컬 사진 | `noAutoImage` — 목업은 그림만 | 미리보기 PNG 에서 상대경로 사진이 깨져 회색 칸 |
| targetup | 폴더·함수 삭제 | + 권한표 도구의 전단 분류 8행·서비스 전환 행(API 0) · OPS.md 2-2-B 폐기 표시 | 잔재 전수 |

### 축 밖 기록(착수 안 함)
- `POST /flyers/classify-products` 화면 소비처 0(죽은 라우트).
- deal_bento 대표 타일은 상품 사진이 있어도 픽토그램만 그린다(`.pic` 이미지 미사용).

## 12. Codex 적대 리뷰 (2026-10-26)
| 저장소 | 라운드 | 결과 | 정정 |
|---|---|---|---|
| hanjulDM | 1R | 7건 | 1·2·4 = 한 뿌리(화면이 사유 문구로 판정을 추측 · 타이핑마다 재판정) → 서버 사유 키(reasonKeys) + 확인 목록 고정 + 가격 초안·행별 「확인」 구조로 교체 · 3 묶음 해석 실패 = 가격 키 · 5 price_board 좁은 화면 규격 유지 · 6 시트 변경 = 새 시트 자동 매핑 · 7 미리보기 inflight 정리 |
| hanjulDM | 2R | 2건 | 미확인 가격 초안 = 어느 행이든 인쇄 차단 · 가격 키 → 판매 조건 키(dup:bundle_qty · dup:unit) · 서버·화면 키 목록 대조 시험 |
| hanjulDM | 3R | **approve** | — |
| targetup | 1R | **approve** | — |
