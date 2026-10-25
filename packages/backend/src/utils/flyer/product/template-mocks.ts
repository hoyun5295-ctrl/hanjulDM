/**
 * ★ CT-F 1025 — 템플릿 갤러리 목업 (17번 설계 §3-3)
 *
 * 갤러리 미리보기는 사장님 데이터가 아니라 이 목업으로 그린다(renderTemplate 실렌더 — 미리보기=발행 같은 길).
 *   - 세트 = 카테고리 장면 하나 · 5~10개 · imageUrl 비움 → 픽토그램이 그림을 대신한다.
 *   - 세트마다 의무 1개씩: 1+1 · 묶음 · 카드할인 · 한정 · 원가 없음(시험이 검사).
 *   - 날짜·문구 고정(재현성) — 같은 코드 = 같은 그림.
 */
import type { FlyerRenderData, FlyerRenderItem } from './flyer-templates';
import { PAN_TABLE, TEMPLATE_REGISTRY } from '../config/flyer-business-types';

type MockItem = FlyerRenderItem;
const it = (name: string, salePrice: number, originalPrice: number, extra: Partial<MockItem> = {}): MockItem =>
  ({ name, salePrice, originalPrice, ...extra });

export const MOCK_SETS: Record<string, { category: string; items: MockItem[] }> = {
  meat: { category: '정육', items: [
    it('한돈 삼겹살', 1980, 2980, { unit: '100g', origin: '국내산', badge: '1+1' }),
    it('한우 1등급 등심', 8900, 12900, { unit: '100g', origin: '국내산', cardDiscount: 'KB카드 10%' }),
    it('미국산 척아이롤', 1290, 2580, { unit: '100g', origin: '미국산', badge: '한정 50' }),
    it('양념 돼지갈비', 9900, 0, { unit: '1kg', origin: '국내산' }),
    it('닭가슴살', 5000, 6400, { unit: '2개 · 500g', origin: '국내산' }),
    it('한돈 앞다리 불고기용', 1180, 1680, { unit: '100g', origin: '국내산' }),
    it('호주산 소 불고기', 1490, 2290, { unit: '100g', origin: '호주산' }),
  ] },
  seafood: { category: '수산', items: [
    it('노르웨이 고등어', 5000, 6900, { unit: '2개 · 1손', origin: '노르웨이' }),
    it('생물 갈치', 9900, 14900, { unit: '1마리', origin: '국내산', badge: '한정 30' }),
    it('손질 오징어', 3990, 0, { unit: '1마리', origin: '원양산', badge: '1+1' }),
    it('제철 꽃게', 12900, 17900, { unit: '1kg', origin: '국내산', cardDiscount: '농협카드 5%' }),
    it('냉동 새우', 8900, 11900, { unit: '500g', origin: '베트남' }),
    it('국산 바지락', 3480, 4980, { unit: '1kg', origin: '국내산' }),
  ] },
  produce: { category: '청과', items: [
    it('샤인머스캣', 9900, 12900, { unit: '1송이', origin: '국내산', cardDiscount: 'KB카드 10%' }),
    it('부사 사과', 9900, 0, { unit: '1.5kg', origin: '국내산' }),
    it('제주 감귤', 6900, 8900, { unit: '2kg', origin: '제주', badge: '1+1' }),
    it('흙대파', 3000, 3980, { unit: '2개 · 1단', origin: '국내산' }),
    it('친환경 양파', 2980, 3980, { unit: '1.5kg', origin: '국내산', badge: '한정 40' }),
    it('바나나', 2980, 3480, { unit: '1송이', origin: '필리핀' }),
    it('방울토마토', 4980, 6980, { unit: '750g', origin: '국내산' }),
    it('국산 브로콜리', 1980, 2480, { unit: '1개', origin: '국내산' }),
    it('청양고추', 1990, 2490, { unit: '200g', origin: '국내산' }),
  ] },
  grocery: { category: '공산품', items: [
    it('봉지 라면 5입', 3980, 4980, { unit: '5입', badge: '1+1' }),
    it('국산 콩두부', 2000, 2600, { unit: '2개 · 300g' }),
    it('참기름', 7900, 9900, { unit: '320ml', cardDiscount: '삼성카드 7%' }),
    it('초코 쿠키 과자', 1500, 1800, { unit: '46g', badge: '한정 100' }),
    it('즉석밥 12입', 11900, 0, { unit: '210g×12' }),
    it('고추장', 8900, 10900, { unit: '1kg' }),
    it('참치 캔 4입', 6980, 8980, { unit: '100g×4' }),
    it('식용유', 4980, 5980, { unit: '900ml' }),
    it('포기김치', 15900, 19900, { unit: '3kg', origin: '국내산' }),
    it('스파게티 면', 2480, 2980, { unit: '500g' }),
  ] },
  dairy: { category: '유제품', items: [
    it('1등급 우유', 4980, 5980, { unit: '900ml×2', badge: '1+1' }),
    it('무항생제 특란', 5990, 8990, { unit: '30구', origin: '국내산', badge: '한정 50' }),
    it('플레인 요거트', 3000, 3800, { unit: '2개 · 450g' }),
    it('슬라이스 치즈', 5980, 0, { unit: '20매' }),
    it('가염 버터', 6980, 8480, { unit: '450g', cardDiscount: '롯데카드 5%' }),
  ] },
  living: { category: '생활용품', items: [
    it('3겹 롤화장지 30롤', 11900, 15900, { unit: '30롤', badge: '1+1' }),
    it('주방세제 리필', 5000, 6900, { unit: '2개 · 1.2L' }),
    it('섬유유연제', 8900, 12900, { unit: '2.5L', cardDiscount: '신한카드 10%' }),
    it('물티슈 10팩', 9900, 0, { unit: '100매×10', badge: '한정 60' }),
    it('대용량 세탁세제', 16900, 21900, { unit: '3L' }),
  ] },
  gift: { category: '선물세트', items: [
    it('한우 정육 선물세트', 129000, 159000, { unit: '불고기·국거리 1.2kg', origin: '국내산', badge: '한정 20' }),
    it('사과·배 혼합 세트', 49900, 59900, { unit: '사과6·배4', origin: '국내산', cardDiscount: 'KB카드 10%' }),
    it('참치·햄 혼합 세트', 29900, 0, { unit: '12종', badge: '1+1' }),
    it('명품 굴비 세트', 89000, 119000, { unit: '10미', origin: '영광' }),
    it('홍삼 정과 세트', 59000, 79000, { unit: '6입' }),
    it('식용유·참기름 세트', 25000, 32000, { unit: '2개 · 3종' }),
    it('제주 한라봉 세트', 39900, 49900, { unit: '3kg', origin: '제주' }),
    it('수제 한과 세트', 33000, 39000, { unit: '1.2kg' }),
    it('한돈 구이 세트', 69000, 89000, { unit: '1.5kg', origin: '국내산' }),
    it('곶감 세트', 45000, 55000, { unit: '20입', origin: '상주' }),
  ] },
};

function cats(...keys: string[]): Array<{ name: string; items: MockItem[] }> {
  return keys.map(k => ({ name: MOCK_SETS[k].category, items: MOCK_SETS[k].items.map(x => ({ ...x })) }));
}

/** mockSet 이름 → 카테고리 묶음 */
const SET_RECIPES: Record<string, () => Array<{ name: string; items: MockItem[] }>> = {
  meat: () => cats('meat'),
  seafood: () => cats('seafood'),
  produce: () => cats('produce'),
  grocery: () => cats('grocery', 'dairy'),
  gift: () => cats('gift'),
  mixed: () => cats('meat', 'produce').map(c => ({ ...c, items: c.items.slice(0, 5) })),
  dairy: () => cats('dairy', 'living'),
  priceBoard: () => cats('grocery', 'dairy', 'living', 'produce', 'meat').map(c => ({ ...c, items: c.items.slice(0, 7) })),
  single: () => [{ name: '정육', items: [MOCK_SETS.meat.items[1], MOCK_SETS.meat.items[0]].map(x => ({ ...x })) }],
};

/** 엔진 코드 → 대표 장면 목업 세트(판은 PAN_TABLE.mockSet) */
const ENGINE_MOCK: Record<string, string> = {
  grid_hero: 'mixed', fresh_daily: 'produce', market_board: 'grocery', deal_feed: 'mixed', deal_bento: 'dairy',
  grid_muji: 'gift', poster_promo: 'meat', poster_pop: 'mixed', magazine: 'seafood', catalog_dark: 'meat',
  price_board: 'priceBoard', single_hero: 'single', gift_set: 'gift',
};

const TITLES: Record<string, string> = {
  gift: '명절 선물 대전', single: '오늘 딱 하나', priceBoard: '이번 주 알뜰 가격표', seafood: '오늘 들어온 바다',
  produce: '제철 산지 직송', meat: '정육 특가 주간', grocery: '생필품 장보기', dairy: '아침 식탁 특가', mixed: '이번 주 행사',
};

/** 판은 장면을 제목이 말한다 — 같은 기반 디자인끼리 썸네일 머리가 똑같아 보이지 않게 */
const PAN_TITLES: Record<string, string> = {
  fd_produce: '산지에서 온 과일·채소', fd_seafood: '새벽 수산 입고', mb_seol: '설 장보기 한마당', mb_dense: '생필품 빼곡 장터',
  pp_opening: '그랜드 오픈 축하', pp_chuseok: '추석 선물 대목', pp_weekend: '주말 타임세일',
};

export function mockSetOf(code: string): string {
  return PAN_TABLE[code]?.mockSet || ENGINE_MOCK[code] || 'mixed';
}

/** 갤러리 미리보기 렌더 데이터 — 레지스트리에 없는 코드는 null */
export function buildMockRenderData(code: string): FlyerRenderData | null {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATE_REGISTRY, code)) return null;
  const set = mockSetOf(code);
  return {
    storeName: '한줄마트',
    title: PAN_TITLES[code] || TITLES[set] || '이번 주 행사',
    period: '',
    periodStart: '2026-11-02',
    periodEnd: '2026-11-08',
    categories: (SET_RECIPES[set] || SET_RECIPES.mixed)(),
    noAutoImage: true,
  };
}
