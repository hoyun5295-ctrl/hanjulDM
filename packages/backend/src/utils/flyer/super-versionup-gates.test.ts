/**
 * ★ 슈퍼버전업 재발 방지 게이트 (2026-08-20 · 13번 설계 §8)
 *
 * 이 트랙의 뿌리 사고 = "tsc 통과 = 완료"로 잘못 판정해 부품만 만들고 배선 없이 방치(미배선 5종).
 * 게이트:
 *   1. 소비처 검증 — WIRED 목록의 export는 자기 파일 밖 소비처가 1곳 이상이어야 한다.
 *      KNOWN_UNWIRED(2차 대기 — W4 결과 폐회로 선행)만 예외이고, 새 미배선은 여기서 잡힌다.
 *   2. 렌더 재현성·실렌더 스모크 — 같은 입력 = 같은 HTML, 변형 주입이 실제로 결과를 바꾼다,
 *      밴드 3단·무이미지 슬랩·프로모 badge 분리·계급 클래스가 실 HTML에 나온다.
 *   3. 미리보기 = 발행 — 프론트 미러 렌더러 부활 차단(FlyerPage 죽은 미러 280줄 사고 재발 방지).
 *   4. 이미지 정책 — 웹 전단만 1클릭 자동 부착(게이트+로컬저장+출처표기) · 인쇄 파이프라인의 네이버 소싱 0 · 인쇄는 동의 필수.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import { renderTemplate, type FlyerRenderData } from '../flyer/product/flyer-templates';
import { recommendDesign } from '../flyer/product/claude-design-renderer';
import {
  extractPromoToken, itemCountBand, nameSizeClass, priceScaleClass, categoryPictogram,
} from '../flyer/product/flyer-render-prep';
import { cleanProductName, imageMatchConfidence, autoMatchImage } from '../flyer/product/flyer-naver-search';
import { TEMPLATE_REGISTRY } from '../flyer/config/flyer-business-types';

// ★ 16번 설계 §3 — 베스트 10 확정 라인업
const BEST10 = ['grid_hero', 'fresh_daily', 'market_board', 'deal_feed', 'deal_bento', 'grid_muji', 'poster_promo', 'poster_pop', 'magazine', 'catalog_dark'];

const BACKEND_SRC = path.resolve(__dirname, '..', '..');
const FRONTEND_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'frontend', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== 'dist') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f.name)) out.push(p);
  }
  return out;
}
function readAll(files: string[]): Array<{ file: string; text: string }> {
  return files.map(file => ({ file, text: fs.readFileSync(file, 'utf-8') }));
}

// ────────────────────────────────────────────────────
// 1. 소비처 검증 (§8-1) — 소비처 0 = 완료 아님
// ────────────────────────────────────────────────────
describe('게이트 1 — 소비처 검증(미배선 재발 차단)', () => {
  const backendFiles = readAll(walk(BACKEND_SRC).filter(f => !f.endsWith('.test.ts')));

  const WIRED: Array<{ name: string; ownFile: string }> = [
    { name: 'recommendDesign', ownFile: 'claude-design-renderer.ts' },
    { name: 'recommendTemplateAndSeason', ownFile: 'template-recommender.ts' },
    { name: 'variantToStyleBlock', ownFile: 'claude-design-renderer.ts' },
    { name: 'coerceDesignVariant', ownFile: 'claude-design-renderer.ts' },
    { name: 'bandStyleBlock', ownFile: 'flyer-render-prep.ts' },
    { name: 'prepareFlyerData', ownFile: 'flyer-render-prep.ts' },
    { name: 'categoryPictogram', ownFile: 'flyer-render-prep.ts' },
    { name: 'normalizePopSeason', ownFile: 'flyer-pop-templates.ts' },
    { name: 'renderStripPop', ownFile: 'flyer-pop-templates.ts' },
    { name: 'handleDbMigrationError', ownFile: 'db-migration-error.ts' },
    // ensureDesignSnapshotForPublish는 라우트 내부 조립 함수(같은 파일 소비가 설계) — 외부 소비처 기준 부적합이라 제외.
  ];

  for (const w of WIRED) {
    it(`${w.name} — 자기 파일 밖 소비처 1곳 이상`, () => {
      const consumers = backendFiles.filter(
        f => !f.file.endsWith(w.ownFile) && f.text.includes(w.name),
      );
      expect(consumers.length, `${w.name}의 외부 소비처가 0 — 배선 없이 두지 마라(13번 설계 §0-5)`).toBeGreaterThan(0);
    });
  }

  it('enrichCategoriesWithImages는 삭제됐다(정책 위반 경로 부활 금지)', () => {
    const hits = backendFiles.filter(f => f.text.includes('export async function enrichCategoriesWithImages'));
    expect(hits.length).toBe(0);
  });

  it('KNOWN_UNWIRED(2차 대기)는 정확히 media-images 렌더러 2본뿐이다', () => {
    // 이 목록이 늘어나면 새 미배선이 생긴 것 — 늘리기 전에 배선하거나 삭제하라.
    const KNOWN_UNWIRED = ['renderMmsImageHtml', 'renderAlimtalkImageHtml'];
    for (const name of KNOWN_UNWIRED) {
      const consumers = backendFiles.filter(
        f => !f.file.endsWith('media-images.ts') && f.text.includes(name),
      );
      // 배선되면(소비처 생기면) 이 목록에서 빼라 — 테스트가 알려준다.
      expect(consumers.length, `${name}이 배선됐다 — KNOWN_UNWIRED에서 제거하라`).toBe(0);
    }
  });
});

// ────────────────────────────────────────────────────
// 2. 렌더 재현성 + 실렌더 스모크 (§8-2)
// ────────────────────────────────────────────────────
function makeData(count: number, withImage: boolean): FlyerRenderData {
  const items = Array.from({ length: count }, (_, i) => ({
    name: i === 0 ? '1+1 해태 홈런볼 46g×2' : `테스트상품 ${i + 1}`,
    originalPrice: 2000 + i * 100,
    salePrice: i === 1 ? 129000 : 1290 + i * 10,
    unit: '1봉', origin: i % 2 === 0 ? '국내산' : undefined,
    ...(withImage ? { imageUrl: '/api/flyer/flyers/product-images/x.png' } : {}),
  }));
  return {
    storeName: '실측마트', title: '이번 주 행사', period: '8/20 ~ 8/26',
    categories: [{ name: '공산', items: items.slice(0, Math.ceil(count / 2)) }, { name: '청과/야채', items: items.slice(Math.ceil(count / 2)) }].filter(c => c.items.length > 0),
    periodStart: '2026-08-20', periodEnd: '2026-08-26',
  };
}

describe('게이트 2 — 렌더 재현성·실렌더 스모크', () => {
  // ★ 16번 설계 §3 — 베스트 10 확정 라인업(폐기 2코드는 게이트 6에서 폴백 검증)
  const ENGINES = BEST10;

  it('전 엔진 × 수량 밴드(1·6·21) × 이미지 유무 — 예외 없이 렌더되고 밴드 속성이 붙는다', () => {
    for (const engine of ENGINES) {
      for (const count of [1, 6, 21]) {
        for (const withImage of [true, false]) {
          const html = renderTemplate(engine, makeData(count, withImage));
          expect(html.length).toBeGreaterThan(1000);
          const band = count <= 6 ? 'small' : count <= 20 ? 'mid' : 'large';
          expect(html, `${engine} count=${count}`).toContain(`data-band="${band}"`);
          expect(html).toContain('data-media-css'); // URL 매체 토큰 주입(§5)
        }
      }
    }
  });

  it('같은 입력 + 같은 variant = 같은 HTML (재열람 재현성 — 스냅샷 계약의 전제)', () => {
    const data = makeData(6, false);
    const variant = recommendDesign(data, 'default', { fixedTemplateCode: 'grid_hero', fixedSeed: 42 });
    const a = renderTemplate('grid_hero', data, { variant });
    const b = renderTemplate('grid_hero', data, { variant });
    expect(a).toBe(b);
  });

  it('variant 주입이 실제로 HTML을 바꾼다(죽은 배선 아님)', () => {
    const data = makeData(6, false);
    const v1 = recommendDesign(data, 'default', { fixedTemplateCode: 'grid_hero', fixedSeed: 1 });
    const plain = renderTemplate('grid_hero', data);
    const varied = renderTemplate('grid_hero', data, { variant: v1 });
    expect(varied).toContain('data-variant-css');
    expect(plain).not.toContain('data-variant-css');
  });

  it('프로모 토큰이 badge로 분리되어 이름에서 빠진다(전 엔진 데이터 공통 — prepareFlyerData)', () => {
    const html = renderTemplate('poster_promo', makeData(3, false));
    expect(html).not.toContain('1+1 해태 홈런볼');
    expect(html).toContain('해태 홈런볼');
  });

  it('poster_promo 무이미지 = 스펙 조판 슬랩(이모지 폴백 폐기)', () => {
    const html = renderTemplate('poster_promo', makeData(3, false));
    expect(html).toContain('slab-typo');
    expect(html).toContain('<svg'); // 픽토그램
  });

  it('grid_hero — 이름·가격 계급 클래스가 데이터로 내려간다(판정 = 서버 한 곳)', () => {
    const html = renderTemplate('grid_hero', makeData(3, false));
    expect(html).toContain('"nmc"');
    expect(html).toContain('"prc"');
  });
});

// ────────────────────────────────────────────────────
// 3. 미리보기 = 발행 (§8-3) — 프론트 미러 부활 차단
// ────────────────────────────────────────────────────
describe('게이트 3 — 미리보기=발행(프론트 미러 금지)', () => {
  it('옛 FlyerPage(죽은 미러 소유 파일)는 존재하지 않는다', () => {
    expect(fs.existsSync(path.join(FRONTEND_SRC, 'pages', 'FlyerPage.tsx'))).toBe(false);
  });

  it('프론트에 엔진 미러(ENGINE_MAP·renderXxxEngine)가 없다 — 미리보기는 preview-html 한 경로', () => {
    const files = readAll(walk(FRONTEND_SRC));
    const mirrors = files.filter(f => /ENGINE_MAP|renderStoryEngine|renderGridHeroEngine/.test(f.text));
    expect(mirrors.map(m => m.file)).toEqual([]);
    const preview = files.find(f => f.file.endsWith('FlyerPreview.tsx'));
    expect(preview?.text).toContain('preview-html');
  });
});

// ────────────────────────────────────────────────────
// 4. 이미지 정책 (§3) — 자동 확정 금지·인쇄 네이버 0
// ────────────────────────────────────────────────────
describe('게이트 4 — 이미지 정책', () => {
  it('autoMatchImage는 어떤 경우에도 imageUrl을 확정하지 않는다(후보만)', async () => {
    const r = await autoMatchImage('테스트상품', 'test-company');
    expect(r.imageUrl).toBeNull();
  });

  // ★ 2026-08-20 정책 변경(Harold 지시) — 웹 전단 한정으로 1클릭 자동 부착을 연다.
  //   막았던 이유가 "인쇄물로 나가는 구조"였으므로, 그 조건 3개를 코드에 남긴 채로만 연다.
  it('자동 부착 경로(/auto-images)는 게이트 통과분만 붙이고 받아서 저장한다', () => {
    const route = fs.readFileSync(path.join(BACKEND_SRC, 'routes', 'flyer', 'flyers.ts'), 'utf-8');
    const block = route.slice(route.indexOf("router.post('/auto-images'"), route.indexOf("router.post('/classify-products'"));
    expect(block).toContain('passesMatchGate(imageMatchConfidence');  // 오매칭 차단
    expect(block).toContain('downloadAndSaveImage');                  // 핫링크 금지
    expect(block).toContain("source: 'naver'");                       // 출처 표기
  });

  it('자동 부착분은 화면에서 출처가 네이버로 남아 인쇄 동의 게이트에 걸린다', () => {
    const page = fs.readFileSync(path.join(FRONTEND_SRC, 'pages', 'FlyerComposerPage.tsx'), 'utf-8');
    expect(page).toContain("imageSource: '네이버'");
    // 인쇄 관문의 자동 이미지 판정이 '카탈로그'만 통과시키는 구조여야 네이버분이 동의 대상이 된다
    expect(page).toContain("r.src !== '없음' && r.src !== '카탈로그'");
  });

  it('인쇄 이미지 파이프라인에 네이버 소싱이 없다(제3자 저작물 인쇄 차단 — §0-3)', () => {
    const pipeline = fs.readFileSync(
      path.join(BACKEND_SRC, 'utils', 'flyer', 'product', 'print', 'pipeline', 'image-pipeline.ts'), 'utf-8');
    expect(pipeline).not.toContain('searchNaverShopping');
    expect(pipeline).not.toContain('flyer-naver-search');
  });

  it('쿼리 정규화 — POS 축약·프로모 토큰이 걷힌다(게이트보다 먼저 — 회의론자 파열점 2)', () => {
    expect(cleanProductName('삼겹100g')).toBe('삼겹');
    expect(cleanProductName('홈런볼*2')).toBe('홈런볼');
    expect(cleanProductName('1+1 해태 홈런볼 46g×2')).toBe('해태 홈런볼');
  });

  it('신뢰도 게이트 — 토큰 전부 포함일 때만 1.0', () => {
    expect(imageMatchConfidence('청송사과 20kg', '경북 청송사과 부사 5kg')).toBe(1);
    expect(imageMatchConfidence('한우 등심', '호주산 소고기 등심')).toBeLessThan(1);
  });
});

// ────────────────────────────────────────────────────
// 5. prep CT 단위 계약
// ────────────────────────────────────────────────────
describe('렌더 준비 CT — 계급·밴드·토큰 분리', () => {
  it('프로모 토큰 분리', () => {
    expect(extractPromoToken('1+1 해태 홈런볼 46g×2')).toEqual({ name: '해태 홈런볼 46g×2', promo: '1+1' });
    expect(extractPromoToken('신라면 5입').promo).toBeNull();
  });
  it('수량 밴드 경계(6/7·20/21)', () => {
    expect(itemCountBand(6)).toBe('small');
    expect(itemCountBand(7)).toBe('mid');
    expect(itemCountBand(20)).toBe('mid');
    expect(itemCountBand(21)).toBe('large');
  });
  it('이름 계급(8/16 경계)', () => {
    expect(nameSizeClass('사과')).toBe('nm-s');
    expect(nameSizeClass('해태 홈런볼 46g 두배')).toBe('nm-m');
    expect(nameSizeClass('아주아주 길고 긴 상품명 예시 문자열')).toBe('nm-l');
  });
  it('가격 자릿수 계급(4/5/6자리)', () => {
    expect(priceScaleClass(1290)).toBe('pr-s');
    expect(priceScaleClass(12900)).toBe('pr-m');
    expect(priceScaleClass(129000)).toBe('pr-l');
  });
  it('픽토그램 — 전 카테고리 SVG 반환(이모지 0)', () => {
    for (const cat of ['청과/야채', '축산', '수산', '공산', '냉동', '유제품', '음료', '주류', '생활용품', '베이커리', '간식', '없는카테고리']) {
      const svg = categoryPictogram(cat);
      expect(svg).toContain('<svg');
      expect(/[\u{1F300}-\u{1FAFF}]/u.test(svg)).toBe(false);
    }
  });
});

// ────────────────────────────────────────────────────
// 5. 제작 화면 경계 계약 (2026-08-20 실사고 2건 고정)
// ────────────────────────────────────────────────────
describe('게이트 5 — 제작 화면 경계 계약', () => {
  const FE = (rel: string) => fs.readFileSync(path.resolve(FRONTEND_SRC, rel), 'utf-8');

  it('엑셀 담기 — 모달이 주는 상품명 필드(productName)를 읽는다', () => {
    // name 으로 읽으면 전 행이 걸러져 조용히 0건이 된다(0820 "엑셀 추가해도 변화 없음")
    const page = FE('pages/FlyerComposerPage.tsx');
    const modal = FE('components/ExcelUploadModal.tsx');
    expect(modal).toContain('productName: string;');
    expect(page).toContain('p.productName');
  });

  it('엑셀 담기 — 0건이면 조용히 넘어가지 않는다', () => {
    const page = FE('pages/FlyerComposerPage.tsx');
    expect(page).toContain('담긴 상품이 없습니다');
  });

  it('미리보기 — 1배를 넘겨 확대하지 않는다(넓은 컬럼에서 겹침·잘림)', () => {
    const prev = FE('components/FlyerPreview.tsx');
    expect(prev).toContain('Math.min(1, w / TARGET_VIEWPORT_WIDTH)');
  });

  it('미리보기 — blob iframe 상대경로 해소용 base 주입', () => {
    const route = fs.readFileSync(path.resolve(BACKEND_SRC, 'routes/flyer/short-urls.ts'), 'utf-8');
    expect(route).toContain('<base href=');
  });

  it('신규 엔진 2종 — 계급 클래스는 CT가 실제로 돌려주는 이름을 쓴다', () => {
    const tpl = fs.readFileSync(path.resolve(BACKEND_SRC, 'utils/flyer/product/flyer-templates.ts'), 'utf-8');
    const marketBoard = tpl.slice(tpl.indexOf('renderMarketBoardEngine'), tpl.indexOf('renderFreshDailyEngine'));
    for (const ghost of ['.long{', '.xlong{', '.p-lg{', '.p-xl{']) {
      expect(marketBoard.includes(ghost), `유령 클래스 ${ghost}`).toBe(false);
    }
    expect(marketBoard).toContain('nm-m');
    expect(marketBoard).toContain('pr-m');
  });
});

// ────────────────────────────────────────────────────
// 6. 베스트10 골격 계약 (16번 설계 §4 — 10종 전부의 하한)
// ────────────────────────────────────────────────────
describe('게이트 6 — 베스트10 골격 계약(16번 §4)', () => {
  const data = makeData(6, false); // 이미지 0 — 슬랩 계약까지 한 렌더로 검증
  const rendered = new Map(BEST10.map(e => [e, renderTemplate(e, data)]));

  for (const eng of BEST10) {
    const html = rendered.get(eng)!;

    it(`${eng} — 헤더 3요소(매장·행사·기간)가 렌더에 있다`, () => {
      expect(html).toContain('실측마트');
      expect(html).toContain('이번 주 행사');
      const hasPeriod = ['8/20', '08.20', '8.20', '08/20'].some(f => html.includes(f));
      expect(hasPeriod, `${eng} 기간 표기 없음`).toBe(true);
    });

    it(`${eng} — 무이미지 렌더에 시각 폴백(svg)이 있다(빈 회색 박스 금지)`, () => {
      expect(html).toContain('<svg');
    });

    it(`${eng} — 매장명 푸터 재노출(≥2회)`, () => {
      expect(html.split('실측마트').length - 1).toBeGreaterThanOrEqual(2);
    });

    it(`${eng} — 더보기 패턴 금지(§1-1 시대성)`, () => {
      expect(html.includes('더 보기')).toBe(false);
      expect(html.includes('더보기')).toBe(false);
    });

    it(`${eng} — keyframes 가 있으면 reduced-motion 무력화가 있다`, () => {
      if (html.includes('@keyframes')) {
        expect(html).toContain('prefers-reduced-motion');
      }
    });

    it(`${eng} — 장바구니 계약(data-product) 유지`, () => {
      // 서버 렌더 속성 또는 런타임 조립(setAttribute) 어느 쪽이든 카트 스크립트가 읽는다
      const ok = html.includes('data-product=') || html.includes("setAttribute('data-product'");
      expect(ok, `${eng} 카드에 data-product 계약 없음`).toBe(true);
    });
  }

  it('REGISTRY = 정확히 베스트 10', () => {
    expect(Object.keys(TEMPLATE_REGISTRY).sort()).toEqual([...BEST10].sort());
  });

  it('폐기 2코드(magazine_zine·catalog_swipe)는 새 본체로 폴백 렌더된다', () => {
    for (const dead of ['magazine_zine', 'catalog_swipe']) {
      const html = renderTemplate(dead, data);
      expect(html.length).toBeGreaterThan(1000);
      expect(html).toContain('data-band');
    }
  });

  it('전화·길찾기 액션(externalLinks)이 dyn 섹션으로 렌더된다', () => {
    const withLinks = { ...makeData(4, false), externalLinks: [
      { label: '전화', url: 'tel:0000000000', icon: 'phone' },
      { label: '길찾기', url: 'https://map.example', icon: 'map' },
    ]};
    const html = renderTemplate('grid_hero', withLinks);
    expect(html).toContain('dyn-link');
    expect(html).toContain('tel:0000000000');
  });
});
