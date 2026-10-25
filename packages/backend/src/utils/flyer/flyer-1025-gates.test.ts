/**
 * ★ 17번 설계 게이트 (2026-10-25 · 파일 등록형 제작 · 템플릿 20 · 한줄로 분리)
 *
 * F1  무이미지 그림 — SVG 픽토그램은 요소로 그린다(속성 값·CSS 변수 안 0건).
 *     기존 게이트 6은 「HTML에 svg 문자열이 있다」만 봐서 속성 안에 갇힌 깨진 SVG를 통과시켰다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import { renderTemplate, type FlyerRenderData } from '../flyer/product/flyer-templates';

const BACKEND_SRC = path.resolve(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== 'dist') walk(p, out); }
    else if (/\.ts$/.test(f.name) && !f.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const SRC = walk(BACKEND_SRC).map(file => ({ file: path.relative(BACKEND_SRC, file).replace(/\\/g, '/'), text: fs.readFileSync(file, 'utf-8') }));

// ────────────────────────────────────────────────────
// §6-1 한줄로 분리 — hanjulDM 저장소 안
// ────────────────────────────────────────────────────
describe('§6-1 한줄로 분리 게이트', () => {
  const REMOVED = [
    'services/ai.ts', 'utils/messageUtils.ts', 'utils/customer-filter.ts', 'utils/normalize.ts',
    'utils/standard-field-map.ts', 'utils/format-number.ts', 'utils/safe-field-name.ts',
    'middlewares/auth.ts', 'middlewares/super-service-guard.ts',
  ];
  it('한줄로 복사본(닫힌 섬)은 부활하지 않는다', () => {
    for (const f of REMOVED) expect(fs.existsSync(path.join(BACKEND_SRC, f)), f).toBe(false);
  });

  it('한줄로 표(users·companies·customers·unsubscribes·user_sessions)를 조회·변경하는 SQL 0건', () => {
    const hits = SRC.filter(s => /\b(FROM|JOIN|INTO|UPDATE)\s+"?(users|companies|customers|unsubscribes|user_sessions|customer_field_definitions)\b/.test(s.text));
    expect(hits.map(h => h.file)).toEqual([]);
  });

  it('공유 sms_line_groups 는 읽기만 한다(쓰기 0건)', () => {
    const hits = SRC.filter(s => /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?sms_line_groups\b/i.test(s.text));
    expect(hits.map(h => h.file)).toEqual([]);
  });

  it('전단 AI 호출은 flyer-ai-call 한 곳 — 직접 fetch(api.anthropic.com·api.openai.com) 0건', () => {
    const hits = SRC.filter(s => !s.file.endsWith('flyer-ai-call.ts') && /api\.anthropic\.com|api\.openai\.com/.test(s.text));
    expect(hits.map(h => h.file)).toEqual([]);
  });

  it('회선 조회 async 함수는 전부 await 로 부른다(쿠폰 [object Promise] 재발 차단)', () => {
    const bad: string[] = [];
    for (const s of SRC) {
      s.text.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/(getAuthSmsTable|getTestSmsTables|getFlyerCompanySmsTables|getAllSmsTablesWithLogs)\(/.test(line)
          && !/await\s+(\w+\.)?(getAuthSmsTable|getTestSmsTables|getFlyerCompanySmsTables|getAllSmsTablesWithLogs)\(|async function/.test(line)) {
          bad.push(`${s.file}:${i + 1}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});

// ────────────────────────────────────────────────────
// §2 파일 등록형 제작 — 시트 읽기 · 값 규칙 · 매핑 · 행 판정
// ────────────────────────────────────────────────────
import * as XLSX from 'xlsx';
import { readProductSheet, SheetReadError } from '../flyer/product/flyer-sheet-reader';
import { parseWon, parseQty, normalizeBadge } from '../flyer/product/flyer-value-normalizer';
import {
  applyFlyerMapping, templateMapping, sanitizeMapping, mapFlyerExcelHeaders, TEMPLATE_HEADERS, REASON_PRICE, PRICE_REASON_KEYS,
} from '../flyer/product/flyer-excel-mapper';

function xlsxBuf(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const TPL = TEMPLATE_HEADERS.map(([h]) => h);

describe('§2-2 시트 읽기', () => {
  it('CP949(엑셀 CSV 저장본) 한글이 깨지지 않는다', () => {
    const buf = Buffer.from('bbf3c7b0b8ed2cc7e0bbe7b0a12cb1d4b0dd0d0abbe7b0fa2c22312c393830bff8222c31bac00d0abbefb0e3bbec2c32b0b32035303030bff82c313030670d0a', 'hex');
    const r = readProductSheet(buf, 'x.csv');
    expect(r.headers).toEqual(['상품명', '행사가', '규격']);
    expect(r.rows[0]).toEqual(['사과', '1,980원', '1봉']);
  });
  it('UTF-8 BOM CSV', () => {
    const r = readProductSheet(Buffer.from('﻿상품명,행사가\n두부,1500\n', 'utf-8'), 'x.csv');
    expect(r.headers).toEqual(['상품명', '행사가']);
  });
  it('제목행 2줄이 있어도 헤더를 찾는다 · 「작성 예시」 시트는 고르지 않는다', () => {
    const buf = xlsxBuf({
      '작성 예시': [TPL, ['정육', '예시상품', '', '', '9900']],
      '이번주': [['○○마트 주간 행사'], ['2026.10.25 ~ 10.31'], ['품명', '판매가'], ['한우 등심', '19,900']],
    });
    const r = readProductSheet(buf, 'x.xlsx');
    expect(r.sheetName).toBe('이번주');
    expect(r.headerRow).toBe(3);
    expect(r.rows[0]).toEqual(['한우 등심', '19,900']);
    expect(r.sheets).toEqual(['이번주']);
  });
  it('헤더를 못 찾으면 SheetReadError', () => {
    expect(() => readProductSheet(xlsxBuf({ a: [['x', 'y'], ['1', '2']] }), 'x.xlsx')).toThrow(SheetReadError);
  });
});

describe('§2-3 값 규칙 — 못 읽으면 null(0 금지)', () => {
  it.each([
    ['1,980원', 1980], ['₩1980', 1980], ['1980', 1980], [' 12,900 ', 12900],
  ])('%s → %d', (raw, v) => expect(parseWon(raw).value).toBe(v));
  it('묶음가: 「2개 5000원」 = 2개 · 5000원 (2원 결함 차단)', () => {
    expect(parseWon('2개 5000원')).toMatchObject({ value: 5000, bundle: { qty: 2, price: 5000 } });
    expect(parseWon('3봉에 10,000')).toMatchObject({ value: 10000, bundle: { qty: 3, price: 10000 } });
  });
  it('못 읽는 값 = null', () => {
    for (const raw of ['가격문의', '1+1', '1,9,80', '약 2000']) expect(parseWon(raw).value, raw).toBeNull();
    expect(parseWon('').empty).toBe(true);
  });
  it('수량·뱃지', () => {
    expect(parseQty('30개 한정').value).toBe(30);
    expect(parseQty('많이').value).toBeNull();
    expect(normalizeBadge('1 + 1').value).toBe('1+1');
    expect(normalizeBadge('3+1').value).toBe('3+1');
    expect(normalizeBadge('대박').value).toBeNull();
  });
});

describe('§2-4 매핑 — 양식이면 AI 0회 · 외부 매핑은 허용 목록', () => {
  it('예시 양식 헤더 → 규칙 매핑(AI 호출 없이)', async () => {
    const r = await mapFlyerExcelHeaders(TPL);
    expect(r.source).toBe('template');
    expect(r.mapping['상품명']).toBe('product_name');
    expect(r.mapping['묶음가']).toBe('bundle_price');
  });
  it('양식 헤더에 「*」·공백이 붙어도 양식으로 본다', () => {
    expect(templateMapping(['상품명*', ' 행사가 *', '규격'])).not.toBeNull();
  });
  it('모르는 헤더가 하나라도 있으면 양식이 아니다', () => {
    expect(templateMapping(['상품명', '행사가', '바코드'])).toBeNull();
  });
  it('없는 헤더·없는 필드는 버린다', () => {
    const m = sanitizeMapping({ 상품명: 'product_name', 가격: 'price_typo', 유령: 'sale_price' }, ['상품명', '가격']);
    expect(m).toEqual({ 상품명: 'product_name', 가격: null });
  });
});

import { SAMPLE_CATEGORIES, hasCategoryPictogram } from '../flyer/product/flyer-render-prep';
import { BADGE_VALUES } from '../flyer/product/flyer-value-normalizer';

describe('§2-1 예시 양식 파일 = 파서 기준과 같다', () => {
  const SAMPLE = path.resolve(BACKEND_SRC, '..', '..', 'frontend', 'public', 'samples', 'hanjul-flyer-sample.xlsx');
  const wb = XLSX.read(fs.readFileSync(SAMPLE), { type: 'buffer' });
  const aoa = (n: string) => XLSX.utils.sheet_to_json<string[]>(wb.Sheets[n], { header: 1, raw: false, defval: '' });

  it('시트 = 상품 입력 · 작성 예시 · 목록(숨김)', () => {
    expect(wb.SheetNames).toEqual(['상품 입력', '작성 예시', '목록']);
  });
  it('「상품 입력」 1행 = TEMPLATE_HEADERS (순서까지)', () => {
    expect(aoa('상품 입력')[0]).toEqual(TPL);
  });
  it('드롭다운 카테고리 = SAMPLE_CATEGORIES 이고 전부 픽토그램이 있다 · 뱃지 = BADGE_VALUES', () => {
    const rows = aoa('목록').slice(1);
    expect(rows.map(r => r[0]).filter(Boolean)).toEqual(SAMPLE_CATEGORIES);
    for (const c of SAMPLE_CATEGORIES) expect(hasCategoryPictogram(c), c).toBe(true);
    expect(rows.map(r => r[1]).filter(Boolean)).toEqual([...BADGE_VALUES]);
  });
  it('빈 양식 그대로 올리면 상품 0행(빈 칸 300줄을 행으로 치지 않는다)', () => {
    const r = readProductSheet(fs.readFileSync(SAMPLE), 'hanjul-flyer-sample.xlsx');
    expect(r.sheetName).toBe('상품 입력');
    expect(applyFlyerMapping(r.headers, r.rows, templateMapping(r.headers)!)).toEqual([]);
  });
  it('「작성 예시」 8행을 입력 시트에 옮겨 올리면 8행 전부 ok', () => {
    const buf = xlsxBuf({ '상품 입력': aoa('작성 예시').filter(r => r.some(Boolean) && !String(r[1]).startsWith('이 시트는')) });
    const r = readProductSheet(buf, 'x.xlsx');
    const judged = applyFlyerMapping(r.headers, r.rows, templateMapping(r.headers)!);
    expect(judged.map(j => [j.status, j.reasons])).toEqual(Array(8).fill(['ok', []]));
    expect(judged[1].product).toMatchObject({ productName: '노르웨이 고등어', salePrice: 5000, unit: '2개 · 1손(2마리)' });
  });
});

describe('§2-3 행 판정', () => {
  const H = ['상품명', '행사가', '정상가', '묶음 수량', '묶음가', '행사 뱃지', '한정 수량', '카드할인', '대표 상품', '규격'];
  const M = templateMapping(H)!;
  const judge = (rows: string[][]) => applyFlyerMapping(H, rows, M);

  it('정상 행 = ok', () => {
    const [r] = judge([['사과', '3,980', '5,980', '', '', '', '', '', '', '1봉']]);
    expect(r.status).toBe('ok');
    expect(r.product).toMatchObject({ productName: '사과', salePrice: 3980, originalPrice: 5980, promoType: 'main' });
  });
  it('묶음 칸 → salePrice=묶음가 · unit 앞에 「N개」', () => {
    const [r] = judge([['두부', '', '', '2', '5000', '', '', '', '', '300g']]);
    expect(r.status).toBe('ok');
    expect(r.product).toMatchObject({ salePrice: 5000, unit: '2개 · 300g' });
  });
  it('가격을 못 읽으면 needsReview + reviewPrice(인쇄 차단) · 0원으로 승격 금지', () => {
    const [r] = judge([['한우', '시가', '50,000', '', '', '', '', '', '', '']]);
    expect(r.status).toBe('needsReview');
    expect(r.reasons).toContain(REASON_PRICE);
    expect(r.product?.reviewPrice).toBe(true);
    expect(r.product?.promoType).toBe('general');
  });
  it('상품명 없는 행 = dropped(사유) · 완전히 빈 행은 행으로 치지 않는다', () => {
    const rows = judge([['', '1000', '', '', '', '', '', '', '', ''], Array(10).fill('')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'dropped', reasons: ['상품명 없음'] });
  });
  it('한정 수량 → badge 「한정 N」 · 카드할인 → cardDiscount', () => {
    const [r] = judge([['계란', '5,990', '', '', '', '한정', '30', 'KB카드 10%', '○', '30구']]);
    expect(r.product).toMatchObject({ badge: '한정 30', cardDiscount: 'KB카드 10%', promoType: 'main' });
  });
  it('묶음 칸을 못 읽으면 가격 미확정(인쇄 차단) — 행사가가 따로 있어도 (Codex 1R)', () => {
    const [r] = judge([['두부', '3,000', '', '2', '가격문의', '', '', '', '', '']]);
    expect(r.status).toBe('needsReview');
    expect(r.reasonKeys).toContain('bundle');
    expect(r.product?.reviewPrice).toBe(true);
  });
  it('사유와 사유 키는 같은 순서 · 상품명 열 중복은 가격 키가 아니다 (Codex 1R)', () => {
    const rows = applyFlyerMapping(['상품명', '품명', '가격'], [['우유', '우유2', '대박']], { 상품명: 'product_name', 품명: 'product_name', 가격: 'sale_price' });
    expect(rows[0].reasons).toHaveLength(rows[0].reasonKeys.length);
    expect(rows[0].reasonKeys).toEqual(['dup:product_name', 'price']);
    const ok = applyFlyerMapping(['상품명', '품명', '가격'], [['우유', '우유2', '2000']], { 상품명: 'product_name', 품명: 'product_name', 가격: 'sale_price' });
    expect(ok[0].reasonKeys).toEqual(['dup:product_name']);
    expect(ok[0].product?.reviewPrice).toBeUndefined();
  });
  it('묶음 수량·규격 열 중복도 판매 조건 미확정(인쇄 차단) (Codex 2R)', () => {
    const H2 = ['상품명', '묶음가', '수량A', '수량B'];
    const [r] = applyFlyerMapping(H2, [['두부', '5000', '2', '3']], { 상품명: 'product_name', 묶음가: 'bundle_price', 수량A: 'bundle_qty', 수량B: 'bundle_qty' });
    expect(r.reasonKeys).toContain('dup:bundle_qty');
    expect(r.product?.reviewPrice).toBe(true);
    const [u] = applyFlyerMapping(['상품명', '가격', '규격A', '규격B'], [['한우', '9900', '100g', '1kg']], { 상품명: 'product_name', 가격: 'sale_price', 규격A: 'unit', 규격B: 'unit' });
    expect(u.product?.reviewPrice).toBe(true);
  });
  it('화면 PRICE_KEYS = 서버 PRICE_REASON_KEYS (어긋나면 가격 확인이 안 걷히거나 엉뚱하게 걷힌다)', () => {
    const modal = fs.readFileSync(path.resolve(BACKEND_SRC, '..', '..', 'frontend', 'src', 'components', 'ExcelUploadModal.tsx'), 'utf-8');
    const m = modal.match(/const PRICE_KEYS = \[([^\]]*)\]/);
    expect(m, 'ExcelUploadModal PRICE_KEYS').toBeTruthy();
    const keys = [...m![1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    expect(keys).toEqual(PRICE_REASON_KEYS);
  });
  it('같은 필드에 열 두 개 = 전 행 확인 필요(가격이면 인쇄 차단)', () => {
    const rows = applyFlyerMapping(['상품명', '가격A', '가격B'], [['우유', '2000', '2500']], { 상품명: 'product_name', 가격A: 'sale_price', 가격B: 'sale_price' });
    expect(rows[0].status).toBe('needsReview');
    expect(rows[0].product?.reviewPrice).toBe(true);
  });
});

// ────────────────────────────────────────────────────
// §1 F2 — 엑셀 칸이 렌더까지 살아 간다
// ────────────────────────────────────────────────────
import { groupItemsByCategory } from '../flyer/product/flyer-category-classifier';

describe('F2 — 파일 칸 → 묶기 → 렌더', () => {
  const stubClassify = async (names: Array<{ name: string }>) => ({ '자동분류': names.map(n => n.name) });

  it('같은 이름 두 행(규격만 다름)이 하나로 합쳐지지 않는다', async () => {
    const groups = await groupItemsByCategory(
      [{ name: '우유', unit: '900ml' }, { name: '우유', unit: '2.3L' }, { name: '두부' }], stubClassify);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(i => (i as any).unit)).toEqual(['900ml', '2.3L', undefined]);
  });

  it('매장이 적은 카테고리는 분류기를 거치지 않는다', async () => {
    let called = 0;
    const groups = await groupItemsByCategory([{ name: '한우 등심', category: '정육' }], async n => { called += n.length; return {}; });
    expect(called).toBe(0);
    expect(groups[0].name).toBe('정육');
  });

  // 1025 실측: 6엔진이 뱃지·카드할인을 카드에서 버리고 있었다(fresh_daily 뱃지 0/6 · magazine·catalog_dark 둘 다 0/6 …)
  for (const eng of ['grid_hero', 'fresh_daily', 'market_board', 'deal_feed', 'deal_bento', 'grid_muji', 'poster_promo', 'poster_pop', 'magazine', 'catalog_dark']) {
    it(`${eng} — 상품마다 규격·행사 뱃지·카드할인·원산지가 렌더된다`, () => {
      const items = Array.from({ length: 6 }, (_, i) => ({
        name: `시험상품${i + 1}`, originalPrice: 5000, salePrice: 3001 + i,
        unit: `규격${i + 1}`, badge: `뱃지${i + 1}`, cardDiscount: `카드${i + 1}`, origin: `산지${i + 1}`,
      }));
      const html = renderTemplate(eng, { storeName: 'M', title: 'T', period: '', categories: [{ name: '정육', items }] });
      for (const f of ['규격', '뱃지', '카드', '산지']) {
        const miss = items.filter((_, i) => !html.includes(`${f}${i + 1}`)).map(it => it.name);
        expect(miss, `${eng} ${f}`).toEqual([]);
      }
    });
  }

  it('엑셀 행 → 판정 → 묶기 → 렌더 HTML 에 카테고리·뱃지·카드할인·묶음 단위가 보인다', async () => {
    const headers = ['카테고리', '상품명', '행사가', '묶음 수량', '묶음가', '행사 뱃지', '카드할인', '규격'];
    const rows = [
      ['정육', '한돈 삼겹살', '12,900', '', '', '1+1', '', '500g'],
      ['수산', '고등어', '', '2', '5000', '', 'KB카드 10%', ''],
    ];
    const judged = applyFlyerMapping(headers, rows, templateMapping(headers)!);
    // 제작 화면 addFromExcel 과 같은 필드 이름으로 넘긴다(FlyerComposerPage NormItem)
    const items = judged.map(r => ({
      name: r.product!.productName, salePrice: r.product!.salePrice, originalPrice: r.product!.originalPrice,
      unit: r.product!.unit || undefined, badge: r.product!.badge, cardDiscount: r.product!.cardDiscount,
      category: r.product!.category,
    }));
    const categories = await groupItemsByCategory(items, stubClassify);
    expect(categories.map(c => c.name)).toEqual(['정육', '수산']);
    for (const eng of ['grid_hero', 'fresh_daily', 'poster_promo']) {
      const html = renderTemplate(eng, { storeName: '실측마트', title: '주간', period: '', categories: categories as any });
      expect(html, eng).toContain('정육');
      expect(html, eng).toContain('2개');
      expect(html, eng).toContain('1+1');
    }
  });
});

const ENGINES_ALL = ['grid_hero', 'fresh_daily', 'market_board', 'deal_feed', 'deal_bento', 'grid_muji', 'poster_promo', 'poster_pop', 'magazine', 'catalog_dark', 'story'];

function noImageData(count: number): FlyerRenderData {
  const items = Array.from({ length: count }, (_, i) => ({
    name: `상품 ${i + 1}`, originalPrice: 3000, salePrice: 1990 + i, unit: '1팩',
  }));
  return {
    storeName: '실측마트', title: '이번 주 행사', period: '',
    categories: [{ name: '정육', items: items.slice(0, Math.ceil(count / 2)) }, { name: '청과', items: items.slice(Math.ceil(count / 2)) }],
    periodStart: '2026-10-25', periodEnd: '2026-10-31',
  };
}

describe('F1 — 무이미지 픽토그램은 요소로 그린다', () => {
  for (const eng of ENGINES_ALL) {
    for (const count of [1, 6, 21]) {
      it(`${eng} × ${count} — 속성 값·CSS 변수 안에 <svg 0건 · 요소 svg 1건 이상`, () => {
        const html = renderTemplate(eng, noImageData(count));
        expect(html, '속성 값 안 svg — 큰따옴표에 속성이 끊긴다').not.toMatch(/="[^"]*<svg/);
        expect(html, 'CSS 변수 안 svg — content 는 마크업을 그리지 못한다').not.toMatch(/--[\w-]+\s*:\s*'<svg/);
      });
    }
  }

  // 그림을 정적 요소로 그리는 3엔진(1025 정정 대상) — 요소 svg가 실제로 나온다.
  //   (나머지는 클라이언트 스크립트 데이터·스펙 슬랩으로 그린다 — 게이트 6 소유)
  for (const eng of ['deal_bento', 'grid_muji', 'poster_pop']) {
    it(`${eng} — 요소 <span class="em"><svg 가 렌더된다`, () => {
      expect(renderTemplate(eng, noImageData(6))).toMatch(/<span class="em"><svg width="1em"/);
    });
  }

  it('클라이언트 폴백 스크립트가 픽토그램을 글자로 넣지 않는다(textContent 금지)', () => {
    const html = renderTemplate('story', noImageData(6));
    expect(html).not.toMatch(/\.textContent\s*=\s*it\.emoji/);
  });
});

// ────────────────────────────────────────────────────
// §3 템플릿 20 · 목업 · 판 구조 · 추천기
// ────────────────────────────────────────────────────
import { TEMPLATE_REGISTRY, PAN_TABLE } from '../flyer/config/flyer-business-types';
import { MOCK_SETS, buildMockRenderData } from '../flyer/product/template-mocks';
import { recommendTemplate } from '../flyer/product/template-recommender';

/** 판 구조 표지 — DOM 요소·속성 값(문자열 수가 아니라 엔진이 그린 대표 요소 수 · 열 값 · 밴드) */
function markers(html: string) {
  return {
    hero: (html.match(/\sdata-hero[\s>]/g) || []).length,
    cols: [...new Set((html.match(/data-cols="(\d)"/g) || []))].sort().join(','),
    band: (html.match(/data-band="(\w+)"/) || [])[1],
  };
}

describe('§3-3 목업 세트', () => {
  for (const [key, set] of Object.entries(MOCK_SETS)) {
    it(`${key} — 5~10개 · 의무(1+1·묶음·카드할인·한정·원가 없음) · 사진 없음 · 픽토그램 있는 카테고리`, () => {
      expect(set.items.length).toBeGreaterThanOrEqual(5);
      expect(set.items.length).toBeLessThanOrEqual(10);
      expect(set.items.some(i => i.badge === '1+1'), '1+1').toBe(true);
      expect(set.items.some(i => /^\d+개 · /.test(i.unit || '')), '묶음').toBe(true);
      expect(set.items.some(i => i.cardDiscount), '카드할인').toBe(true);
      expect(set.items.some(i => /^한정 \d+$/.test(i.badge || '')), '한정').toBe(true);
      expect(set.items.some(i => i.originalPrice === 0), '원가 없음').toBe(true);
      expect(set.items.every(i => !i.imageUrl)).toBe(true);
      expect(hasCategoryPictogram(set.category), set.category).toBe(true);
    });
  }
});

describe('§3-6 전 20종 — 목업 실렌더 스모크', () => {
  const codes = Object.keys(TEMPLATE_REGISTRY);
  it('레지스트리 20종', () => expect(codes).toHaveLength(20));
  for (const code of codes) {
    it(`${code} — 렌더 · 상품 수만큼 data-product · 머리 3요소 · 픽토그램 · 속성 안 svg 0 · 갤러리 메타`, () => {
      const data = buildMockRenderData(code)!;
      const html = renderTemplate(code, data);
      const n = data.categories.reduce((s, c) => s + c.items.length, 0);
      expect(html.length).toBeGreaterThan(2000);
      expect(html).toContain('data-media-css');
      expect(html).toMatch(/data-band="(small|mid|large)"/);
      const products = html.includes("setAttribute('data-product'") ? n : (html.match(/\sdata-product=/g) || []).length;
      expect(products, '상품 누락').toBe(n);
      expect(html).toContain(data.storeName);
      expect(html).toContain(data.title);
      expect(html).not.toMatch(/="[^"]*<svg/);
      expect(html, '픽토그램(정적 요소 또는 스크립트 데이터)').toMatch(/<svg width="1em"|\\u003csvg width=\\"1em\\"/); // 스크립트 데이터는 < 를 < 로 이스케이프
      const meta = TEMPLATE_REGISTRY[code];
      expect(meta.scene && meta.itemRange && meta.filter, '갤러리 메타').toBeTruthy();
    });
  }
  it('같은 코드 = 같은 그림(재현성)', () => {
    for (const code of codes) expect(renderTemplate(code, buildMockRenderData(code)!)).toBe(renderTemplate(code, buildMockRenderData(code)!));
  });
});

describe('§3-1 새 엔진 3 — 베스트10 골격 계약', () => {
  const data: FlyerRenderData = { storeName: '실측마트', title: '이번 주 행사', period: '', periodStart: '2026-11-02', periodEnd: '2026-11-08',
    categories: [{ name: '선물세트', items: [{ name: '한우 세트', salePrice: 99000, originalPrice: 129000, badge: '한정 5' }, { name: '김 세트', salePrice: 19900, originalPrice: 0 }] }] };
  for (const eng of ['price_board', 'single_hero', 'gift_set']) {
    const html = renderTemplate(eng, data);
    it(`${eng} — 매장·행사·기간 · 매장명 재노출 · 무이미지 픽토그램 · data-product`, () => {
      expect(html).toContain('실측마트');
      expect(html).toContain('이번 주 행사');
      expect(html).toContain('11.02');
      expect(html.split('실측마트').length - 1).toBeGreaterThanOrEqual(2);
      expect(html).toMatch(/<svg width="1em"/);
      expect((html.match(/\sdata-product=/g) || []).length).toBe(2);
      expect(html).not.toMatch(/더\s*보기/);
    });
  }
  it('gift_set — 가격대 묶음(판매가 기준)', () => {
    const html = renderTemplate('gift_set', data);
    expect(html).toContain('3만원 이하');
    expect(html).toContain('10만원 이하');
    expect(html).not.toContain('5만원 이하'); // 빈 가격대는 그리지 않는다
  });
});

describe('§3-2 판 7 — 구조 차이 · 저장 코드 재현', () => {
  it('판 = 레지스트리 코드 · 기반 엔진은 살아 있는 엔진', () => {
    for (const [code, pan] of Object.entries(PAN_TABLE)) {
      expect(TEMPLATE_REGISTRY[code], code).toBeTruthy();
      expect(TEMPLATE_REGISTRY[code].baseOf, code).toBeTruthy();
      const html = renderTemplate(code, buildMockRenderData(code)!);
      expect(html, code).toContain(`data-engine="${pan.engine}"`);
      expect(html, code).toContain(`data-template="${code}"`);
    }
  });
  for (const [code, pan] of Object.entries(PAN_TABLE)) {
    it(`${code} — 같은 목업의 기반 엔진 렌더와 구조 표지 2개 이상 다르다`, () => {
      const data = buildMockRenderData(code)!;
      const a = markers(renderTemplate(code, data));
      const b = markers(renderTemplate(pan.engine, data));
      const diff = (['hero', 'cols', 'band'] as const).filter(k => a[k] !== b[k]);
      expect(diff.length, `${code} ${JSON.stringify(a)} vs ${pan.engine} ${JSON.stringify(b)}`).toBeGreaterThanOrEqual(2);
      expect(a.hero, '대표 수 = 판 정의').toBe(pan.layout.hero * (pan.engine === 'poster_pop' ? data.categories.length : 1));
    });
  }
  it('판 시즌이 시즌 토큰을 정한다', () => {
    for (const [code, pan] of Object.entries(PAN_TABLE)) {
      if (!pan.season) continue;
      expect(renderTemplate(code, buildMockRenderData(code)!), code).toContain(`data-season="${pan.season}"`);
    }
  });
});

describe('§3-1 추천기 — 새 엔진 자리 · 폐기 코드 추천 0', () => {
  const mk = (n: number, extra: (i: number) => any = () => ({})) =>
    Array.from({ length: n }, (_, i) => ({ name: `상품${i}`, salePrice: 1000 + i, originalPrice: 1500, ...extra(i) }));
  const rec = (title: string, catName: string, items: any[]) =>
    recommendTemplate({ storeName: 'M', title, period: '', categories: [{ name: catName, items }] }).templateCode;
  it('상품 1개 → single_hero', () => expect(rec('특가', '정육', mk(1))).toBe('single_hero'));
  it('사진 없는 32개 → price_board', () => expect(rec('주간', '공산품', mk(32))).toBe('price_board'));
  it('추석 + 선물세트 → gift_set', () => expect(rec('추석 선물 대전', '선물세트', mk(8, i => ({ name: `선물세트${i}` })))).toBe('gift_set'));
  it('어떤 입력에도 폐기 코드(magazine_zine·catalog_swipe)를 고르지 않는다', () => {
    for (const n of [1, 3, 6, 12, 25, 40]) for (const t of ['주간', '추석', '타임세일', '개점', '크리스마스', '한우 프리미엄']) {
      const code = rec(t, '정육', mk(n));
      expect(['magazine_zine', 'catalog_swipe']).not.toContain(code);
      expect(TEMPLATE_REGISTRY[code], code).toBeTruthy();
    }
  });
});
