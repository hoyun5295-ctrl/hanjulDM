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
 *   4. 이미지 정책 — 네이버 자동 확정 금지(autoMatchImage는 항상 후보만) · 인쇄 파이프라인의 네이버 소싱 0.
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
  const ENGINES = ['grid_hero', 'poster_promo', 'deal_feed', 'magazine', 'catalog_swipe', 'grid_muji', 'deal_bento', 'poster_pop', 'magazine_zine', 'catalog_dark', 'market_board', 'fresh_daily'];

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
