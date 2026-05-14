/**
 * ★ 인쇄전단 V2 (D129) — 슬롯 필러
 *
 * 역할 1(서버): manifest + 입력 데이터 → 정규화된 SlotData 반환
 *   - fallback 적용
 *   - selection 규칙 적용 (highest_discount, manual, featured 등)
 *   - category.mode='auto' + prefer 순서로 카테고리 할당
 *
 * 역할 2(브라우저 런타임): FILL_RUNTIME 상수로 JS 문자열 export
 *   - Puppeteer 페이지에 injectScript로 주입
 *   - window.__SLOT_DATA 를 읽어 DOM 바인딩 수행
 *   - 완료 시 window.__SLOTS_FILLED = true 신호
 *
 * 의존성: cheerio/jsdom 없음 (브라우저가 DOM 엔진 담당)
 */

import type { TemplateManifest, SlotDefinition } from './template-registry';

// ============================================================
// 타입
// ============================================================

export interface RawProduct {
  productName: string;
  originalPrice?: number;
  salePrice: number;
  unit?: string;
  category?: string;
  imageUrl?: string;
  promoType?: 'main' | 'sub' | 'general';
  featured?: boolean;
  aiCopy?: string;
  origin?: string;
}

export interface RawStoreInfo {
  name?: string;
  address?: string;
  phone?: string;
  hours?: string;
  deliveryHours?: string;
  logoUrl?: string;
  mapUrl?: string;
}

export interface RawQrInfo {
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  targetUrl?: string;
}

export interface RawFlyerInput {
  store?: RawStoreInfo;
  qr?: RawQrInfo;
  heroTitle?: string;
  heroSubcopy?: string;
  products: RawProduct[];
  /** 슬롯별 직접 오버라이드 (텍스트/배너 라벨 등) */
  slotOverrides?: Record<string, any>;
}

/** 슬롯 ID → 해당 슬롯의 resolved 값 */
export type SlotData = Record<string, any>;

// ============================================================
// 유틸
// ============================================================

function formatNumber(n: number | undefined | null): string {
  if (n === null || n === undefined || isNaN(n as number)) return '';
  return Number(n).toLocaleString('ko-KR');
}

function discountRate(p: RawProduct): number {
  if (!p.originalPrice || p.originalPrice <= 0) return 0;
  if (p.salePrice >= p.originalPrice) return 0;
  return Math.round((1 - p.salePrice / p.originalPrice) * 100);
}

function matchCategory(p: RawProduct, prefer: string[] | undefined): boolean {
  if (!prefer || prefer.length === 0) return false;
  const cat = (p.category || '').trim();
  if (!cat) return false;
  return prefer.some(k => cat.includes(k) || k.includes(cat));
}

/**
 * 할인율 → 리본 텍스트 자동 선택 (메인 카드용)
 */
function ribbonTextByRate(rate: number, isTopItem: boolean): string {
  if (isTopItem && rate >= 40) return '한정특가';
  if (rate >= 50) return '파격세일';
  if (rate >= 40) return 'BEST특가';
  if (rate >= 30) return '오늘특가';
  if (rate >= 20) return '알뜰세일';
  if (rate > 0) return '할인';
  return '';
}

/**
 * 할인율 → 서브 카드 뱃지 (색상 분기용 kind + text)
 */
function badgeByRate(rate: number, index: number): { kind: string; text: string } {
  if (rate >= 45) return { kind: 'hot', text: 'HOT' };
  if (rate >= 35) return { kind: 'best', text: 'BEST' };
  if (rate >= 25) return { kind: 'pick', text: 'PICK' };
  if (rate >= 15) return { kind: 'new', text: '추천' };
  return { kind: '', text: ['BEST', 'PICK', 'HOT', '추천'][index % 4] };
}

/**
 * 상품을 카드용 뷰모델로 변환
 * (브라우저 runtime에서 data-bind 키로 참조)
 */
function toCardViewModel(p: RawProduct, index = 0) {
  const hasOriginal = typeof p.originalPrice === 'number' && p.originalPrice > 0 && p.originalPrice !== p.salePrice;
  const rate = discountRate(p);
  const isTop = index === 0;
  const badge = badgeByRate(rate, index);
  const salePriceFormatted = formatNumber(p.salePrice);
  const originalPriceFormatted = hasOriginal ? formatNumber(p.originalPrice) + '원' : '';
  return {
    productName: p.productName || '',
    unit: p.unit || '',
    imageUrl: p.imageUrl || '',
    category: p.category || '',
    // 가격 — 옛 종(salePriceNumber/originalPrice) + 신규 종(salePriceFormatted/originalPriceFormatted) alias
    salePriceNumber: salePriceFormatted,
    salePriceFormatted: salePriceFormatted,
    originalPrice: originalPriceFormatted,
    originalPriceFormatted: originalPriceFormatted,
    discountRate: rate > 0 ? rate : '',
    ribbonText: ribbonTextByRate(rate, isTop),
    // 배지 — 옛 종(badgeText/badgeKind) + 신규 종(badge) alias
    badgeKind: badge.kind,
    badgeText: badge.text,
    badge: badge.text,
    aiCopy: p.aiCopy || '',
    origin: p.origin || '',
  };
}

// ============================================================
// 슬롯 타입별 resolver
// ============================================================

/**
 * ★ D162: 사장님 입력 마크업 sanitize
 *   - \n → <br/> 변환 (사장님이 줄바꿈 직접 입력 가능)
 *   - allowedTags 외 < > 문자는 entity escape (XSS 차단)
 *   - allowedTags 내 태그(<br>, <em>, <strong> 등)는 보존
 */
function sanitizeMarkup(raw: string, allowedTags: string[]): string {
  let s = String(raw);
  // 1. \n → 임시 sentinel (entity escape 전 보존)
  s = s.replace(/\r\n/g, '\n').replace(/\n/g, '\x00BR\x00');
  // 2. 허용 태그를 임시 sentinel로 보존
  const tagMap: Record<string, string> = {};
  let tagIdx = 0;
  for (const tag of allowedTags) {
    const re = new RegExp('<(' + tag + ')\\s*/?>|<(' + tag + ')>([\\s\\S]*?)</' + tag + '>', 'gi');
    s = s.replace(re, (m) => {
      const key = '\x00T' + (tagIdx++) + '\x00';
      tagMap[key] = m;
      return key;
    });
  }
  // 3. 남은 < > & escape
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 4. sentinel 복원
  s = s.replace(/\x00BR\x00/g, '<br/>');
  for (const [key, val] of Object.entries(tagMap)) {
    s = s.split(key).join(val);
  }
  return s;
}

function resolveTextSlot(slot: SlotDefinition, input: RawFlyerInput): any {
  const ov = input.slotOverrides?.[slot.id];
  let raw: string | undefined;
  if (ov && typeof ov === 'object' && typeof ov.value === 'string') raw = ov.value;
  else if (typeof ov === 'string' && ov.length > 0) raw = ov;
  else if (slot.id === 'hero_title' && input.heroTitle) raw = input.heroTitle;
  else if (slot.id === 'hero_subcopy' && input.heroSubcopy) raw = input.heroSubcopy;

  if (raw === undefined) {
    // 입력 없음 = SLOT_DATA에 데이터 미포함 → FILL_RUNTIME continue → 자식 fallback HTML 보존
    // (단 data-empty-hide 정의 시 FILL_RUNTIME가 영역 자동 숨김)
    return undefined;
  }

  // ★ D162 사고 #2/#8 fix: typography/rich_text slot의 allowedTags 정의 시 마크업 처리
  //   기존 fillTextSlot textContent 평문화 → 사장님 입력 \n 줄바꿈 사라짐 사고 영구 차단.
  //   manifest의 allowedTags: ["br","em","strong"] 정의 시 활성화.
  const allowedTags = (slot as any).allowedTags;
  if (Array.isArray(allowedTags) && allowedTags.length > 0) {
    return { value: raw, html: sanitizeMarkup(raw, allowedTags) };
  }
  return { value: raw };
}

function resolveSectionBanner(slot: SlotDefinition, input: RawFlyerInput): any {
  const ov = input.slotOverrides?.[slot.id];
  return {
    label: (ov && ov.label) || slot.label || slot.fallback || '',
    sublabel: (ov && ov.sublabel) || slot.sublabel || '',
  };
}

function resolveStoreHeader(slot: SlotDefinition, input: RawFlyerInput): any {
  const s = input.store || {};
  const q = input.qr || {};
  return {
    store: {
      name: s.name || '',
      address: s.address || '',
      phone: s.phone || '',
      hours: s.hours || '',
      deliveryHours: s.deliveryHours || '',
      logoUrl: s.logoUrl || '',
      mapUrl: s.mapUrl || '',
    },
    qr: {
      title: q.title || '',
      subtitle: q.subtitle || '',
      imageUrl: q.imageUrl || '',
    },
  };
}

function resolveProductGrid(slot: SlotDefinition, input: RawFlyerInput): any {
  const selection = (slot as any).selection || { mode: 'highest_discount' };
  const minItems = (slot as any).minItems || 0;
  const maxItems = (slot as any).maxItems || (slot as any).cols * (slot as any).rows || 99;
  const filterPromo = selection.filter?.promoType;

  let pool = input.products.slice();

  if (filterPromo) {
    pool = pool.filter(p => p.promoType === filterPromo);
  }

  switch (selection.mode) {
    case 'highest_discount':
      pool.sort((a, b) => discountRate(b) - discountRate(a));
      break;
    case 'featured':
      pool = pool.filter(p => p.featured);
      break;
    case 'manual':
      // 사용자 수동 선택 — 입력 순서 유지
      break;
    case 'random':
      pool.sort(() => Math.random() - 0.5);
      break;
  }

  const items = pool.slice(0, maxItems).map((p, i) => toCardViewModel(p, i));

  return {
    items,
    minItems,
    maxItems,
    underfilled: items.length < minItems,
  };
}

function resolveCategoryGrid(slot: SlotDefinition, input: RawFlyerInput, usedCategories: Set<string>): any {
  const cfg = (slot as any).category || { mode: 'auto' };
  const cols = (slot as any).cols || 3;
  const rows = (slot as any).rows || 3;
  const maxItems = cols * rows;

  let pool: RawProduct[] = [];
  let categoryLabel = '';

  if (cfg.mode === 'fixed' && cfg.name) {
    categoryLabel = cfg.name;
    pool = input.products.filter(p => (p.category || '') === cfg.name);
  } else {
    // auto — prefer 순서대로 시도
    for (const cat of cfg.prefer || []) {
      if (usedCategories.has(cat)) continue;
      const matched = input.products.filter(p => matchCategory(p, [cat]));
      if (matched.length > 0) {
        pool = matched;
        categoryLabel = cat;
        usedCategories.add(cat);
        break;
      }
    }
    // prefer에서 못 찾았으면 나머지 카테고리 중 사용 안 한 것 첫 번째
    if (!categoryLabel) {
      const seen = new Set<string>();
      for (const p of input.products) {
        const c = (p.category || '').trim();
        if (!c || seen.has(c) || usedCategories.has(c)) continue;
        seen.add(c);
      }
      for (const c of seen) {
        const matched = input.products.filter(p => (p.category || '') === c);
        if (matched.length > 0) {
          pool = matched;
          categoryLabel = c;
          usedCategories.add(c);
          break;
        }
      }
    }
  }

  pool.sort((a, b) => discountRate(b) - discountRate(a));
  const items = pool.slice(0, maxItems).map((p, i) => toCardViewModel(p, i));

  return {
    items,
    categoryLabel: categoryLabel || (slot.fallback || ''),
    cols,
    rows,
  };
}

function resolveFooterNotice(slot: SlotDefinition, input: RawFlyerInput): any {
  const ov = input.slotOverrides?.[slot.id];
  const text = (ov && ov.text) || slot.fallback || '';
  return { text };
}

function resolveProductCard(slot: SlotDefinition, input: RawFlyerInput): any {
  const selection = (slot as any).selection || { mode: 'highest_discount' };
  const filterPromo = selection.filter?.promoType;
  const filterCategory = selection.filter?.category;
  // selection.index: bento 모자이크처럼 같은 정렬 풀에서 N번째 카드 박을 때 사용
  const index = typeof selection.index === 'number' ? selection.index : 0;
  let pool = input.products.slice();
  if (filterPromo) pool = pool.filter(p => p.promoType === filterPromo);
  if (filterCategory && Array.isArray(filterCategory)) {
    pool = pool.filter(p => matchCategory(p, filterCategory));
  }
  switch (selection.mode) {
    case 'highest_discount':
      pool.sort((a, b) => discountRate(b) - discountRate(a));
      break;
    case 'featured':
      pool = pool.filter(p => p.featured);
      break;
    case 'random':
      pool.sort(() => Math.random() - 0.5);
      break;
  }
  if (pool.length === 0) return {};
  const safeIndex = Math.min(index, pool.length - 1);
  return toCardViewModel(pool[safeIndex], safeIndex);
}

// ============================================================
// Public API: 서버측 resolve
// ============================================================

export function resolveSlotData(manifest: TemplateManifest, input: RawFlyerInput): SlotData {
  const out: SlotData = {};
  const usedCategories = new Set<string>();

  for (const slot of manifest.slots) {
    switch (slot.type) {
      case 'text':
      case 'rich_text':
      case 'typography': {
        const v = resolveTextSlot(slot, input);
        if (v !== undefined) out[slot.id] = v;
        break;
      }
      case 'section_banner':
        out[slot.id] = resolveSectionBanner(slot, input);
        break;
      case 'store_header':
        out[slot.id] = resolveStoreHeader(slot, input);
        break;
      case 'product_grid':
        out[slot.id] = resolveProductGrid(slot, input);
        break;
      case 'category_grid':
        out[slot.id] = resolveCategoryGrid(slot, input, usedCategories);
        break;
      case 'product_card':
        out[slot.id] = resolveProductCard(slot, input);
        break;
      case 'footer_notice':
        out[slot.id] = resolveFooterNotice(slot, input);
        break;
      case 'qr':
        // qr 타입 슬롯 = SLOT_DATA에 input.qr 박음 → fillBindings의 data-bind-bg="qr.imageUrl" 매칭
        out[slot.id] = { qr: input.qr || {}, store: input.store || {} };
        break;
      case 'image':
      case 'map':
      case 'decoration':
      default:
        out[slot.id] = {};
        break;
    }
  }

  return out;
}

// ============================================================
// 브라우저 런타임 (문자열로 export) — Puppeteer.evaluate()로 주입
// ============================================================

/**
 * 브라우저에서 실행될 슬롯 바인딩 스크립트.
 * - window.__SLOT_DATA 를 읽어 DOM 조작.
 * - data-slot / data-bind / data-bind-src / data-bind-bg / data-slot-meta 속성 인식.
 * - 그리드 슬롯은 <template data-role="card">를 복제하여 자식 삽입.
 * - 완료 시 window.__SLOTS_FILLED = true.
 */
export const FILL_RUNTIME = String.raw`
(function(){
  var data = window.__SLOT_DATA || {};

  function setByPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function fillBindings(root, context) {
    // data-bind-show="field" → 값이 비어 있으면 숨김 (먼저 처리)
    var showEls = root.querySelectorAll('[data-bind-show]');
    for (var i = 0; i < showEls.length; i++) {
      var el = showEls[i];
      var v = setByPath(context, el.getAttribute('data-bind-show'));
      if (v === undefined || v === null || v === '' || v === 0 || v === '0') {
        el.style.display = 'none';
      }
    }
    // data-bind-class-suffix="field" → field 값을 클래스 접미사로 추가
    var clsEls = root.querySelectorAll('[data-bind-class-suffix]');
    for (var i = 0; i < clsEls.length; i++) {
      var el = clsEls[i];
      var v = setByPath(context, el.getAttribute('data-bind-class-suffix'));
      if (v) el.classList.add(String(v));
    }
    // data-bind="field" → textContent
    var textEls = root.querySelectorAll('[data-bind]');
    for (var i = 0; i < textEls.length; i++) {
      var el = textEls[i];
      var v = setByPath(context, el.getAttribute('data-bind'));
      if (v !== undefined && v !== null && v !== '') {
        el.textContent = String(v);
      }
    }
    // data-bind-src="field" → img.src
    var srcEls = root.querySelectorAll('[data-bind-src]');
    for (var i = 0; i < srcEls.length; i++) {
      var el = srcEls[i];
      var v = setByPath(context, el.getAttribute('data-bind-src'));
      if (v) el.setAttribute('src', String(v));
      else el.classList.add('empty');
    }
    // data-bind-bg="field" → background-image
    var bgEls = root.querySelectorAll('[data-bind-bg]');
    for (var i = 0; i < bgEls.length; i++) {
      var el = bgEls[i];
      var v = setByPath(context, el.getAttribute('data-bind-bg'));
      if (v) {
        el.style.backgroundImage = "url('" + String(v).replace(/'/g, "\\'") + "')";
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      }
    }
  }

  function fillTextSlot(slotEl, value) {
    if (!value) return;
    if (typeof value === 'string') {
      slotEl.textContent = value;
    } else if (typeof value === 'object') {
      // ★ D162 사고 #2/#8 fix: sanitize된 html 박혀 있으면 innerHTML 사용 (마크업 보존)
      //   resolveTextSlot에서 allowedTags 정의 시 value.html 박힘 → 사장님 \n 줄바꿈 + <em>/<strong> 보존
      if (value.html != null) {
        slotEl.innerHTML = String(value.html);
      } else if (value.value != null) {
        slotEl.textContent = String(value.value);
      }
    }
  }

  // ★ D162 사고 #4 fix: data-empty-hide 박혀 있으면 사장님 미입력 시 영역 자체 숨김
  //   정적 영역(예: "다음 4주 행사 캘린더") → data-slot 전환 + 자동 숨김 패턴.
  //   data-optional-wrapper 부모 정의 시 wrapper 자체 숨김 (영역 통째로 사라짐).
  function isSlotEmpty(value) {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value === '';
    if (typeof value !== 'object') return false;
    var hasValue = value.value !== undefined && value.value !== '' && value.value !== null;
    var hasHtml = value.html !== undefined && value.html !== '' && value.html !== null;
    var hasText = value.text !== undefined && value.text !== '' && value.text !== null;
    var hasItems = Array.isArray(value.items) && value.items.length > 0;
    return !hasValue && !hasHtml && !hasText && !hasItems;
  }

  function fillSectionBanner(slotEl, value) {
    if (!value) return;
    fillBindings(slotEl, value);
  }

  function fillStoreHeader(slotEl, value) {
    if (!value) return;
    fillBindings(slotEl, value);
  }

  function fillFooterNotice(slotEl, value) {
    if (!value) return;
    if (value.text) slotEl.textContent = value.text;
  }

  function fillGrid(slotEl, value) {
    if (!value || !Array.isArray(value.items)) return;
    // <template data-role="card"> 추출
    var tmpl = slotEl.querySelector('template[data-role="card"]');
    if (!tmpl) return;
    // 기존 자식(템플릿 + data-keep 박힌 것 제외) 제거
    // data-keep = 정적 셀 (예: editorial article, mid-rule divider) 보존
    var clones = slotEl.querySelectorAll(':scope > :not(template):not([data-keep])');
    for (var c = 0; c < clones.length; c++) clones[c].remove();
    // 각 아이템별 복제 삽입
    for (var i = 0; i < value.items.length; i++) {
      var item = value.items[i];
      var frag = tmpl.content.cloneNode(true);
      // 복제된 조각 안에서 data-bind* 처리
      var wrapper = document.createElement('div');
      wrapper.appendChild(frag);
      fillBindings(wrapper, item);
      // wrapper 내용을 slotEl에 이동
      while (wrapper.firstChild) slotEl.appendChild(wrapper.firstChild);
    }
    // ★ 복제 완료 후 template 엘리먼트 제거 — nth-child 레이아웃 계산 방해 방지
    if (tmpl.parentNode === slotEl) {
      slotEl.removeChild(tmpl);
    }
  }

  function fillCategoryGrid(slotEl, value) {
    fillGrid(slotEl, value);
    // data-slot-meta="slotId.categoryLabel" 요소가 있으면 카테고리 라벨 주입
  }

  // 카테고리 라벨을 data-slot-meta 기반으로 처리
  var metaEls = document.querySelectorAll('[data-slot-meta]');
  for (var m = 0; m < metaEls.length; m++) {
    var metaEl = metaEls[m];
    var spec = metaEl.getAttribute('data-slot-meta');
    if (!spec) continue;
    var dot = spec.indexOf('.');
    if (dot < 0) continue;
    var slotId = spec.slice(0, dot);
    var field = spec.slice(dot + 1);
    var slotValue = data[slotId];
    if (slotValue && slotValue[field]) {
      metaEl.textContent = String(slotValue[field]);
    }
  }

  // 각 슬롯 ID별로 채우기 (v3 — D159 자동 감지. 클래스명 hard-coding 폐기.
  // 옛 종(mart_*) 회귀 0 + 신규 종(print_*) 끌로드 원본 클래스명 그대로 사용 가능)
  var slotEls = document.querySelectorAll('[data-slot]');
  for (var i = 0; i < slotEls.length; i++) {
    var el = slotEls[i];
    var id = el.getAttribute('data-slot');
    var value = data[id];

    // ★ D162 사고 #4 fix: data-empty-hide 슬롯 — 사장님 미입력 시 영역 자동 숨김
    //   data-optional-wrapper 부모 정의 시 wrapper 전체 숨김 (디자인 영역 통째로 사라짐).
    if (el.hasAttribute('data-empty-hide') && isSlotEmpty(value)) {
      var wrapper = el.closest('[data-optional-wrapper]');
      (wrapper || el).style.display = 'none';
      continue;
    }

    if (value === undefined) continue;

    // 1) 그리드 — items 배열 + template[data-role="card"] 자식 존재
    if (value && typeof value === 'object' && Array.isArray(value.items)
        && el.querySelector('template[data-role="card"]')) {
      fillGrid(el, value);
    }
    // 2) 푸터 유의사항 — {text: "..."}
    else if (value && typeof value === 'object' && 'text' in value
             && !('items' in value) && !('store' in value)) {
      fillFooterNotice(el, value);
    }
    // 3) 단순 텍스트 — string 또는 {value: "..."}
    else if (typeof value === 'string') {
      fillTextSlot(el, value);
    }
    else if (value && typeof value === 'object' && 'value' in value
             && !('items' in value) && !('store' in value) && !('label' in value)) {
      fillTextSlot(el, value);
    }
    // 4) 복합 객체 — store_header / section_banner / 그 외
    //    자식의 data-bind* 모든 처리. root 자체 data-bind는 fallback HTML 보존.
    else if (value && typeof value === 'object') {
      fillBindings(el, value);
    }
  }

  window.__SLOTS_FILLED = true;
})();
`;
