/**
 * ★ FlyerComposerPage — 전단 제작 화면 1개 (2026-08-20 슈퍼버전업 4단계 · 13번 설계 §1)
 *
 * 철학: 마트 사장님은 편집하지 않는다 — 상품만 담으면 완성본이 서 있다.
 *   - 화면 1개 · 1상태머신. 홈 3카드(이번 주 행사·오늘 급처분·명절)는 초기 상태 프리셋일 뿐.
 *   - 소스 4칩(POS 인기·지난 전단·카탈로그·엑셀) — 바텀시트에서 체크만, 입력칸 0.
 *   - 담는 즉시 서버 auto-build(분류→엔진→변형) → preview-html 미리보기(미리보기 = 발행 SSOT).
 *   - 손질 4종만: 가격 키패드 · 상품 빼기 · 상품명 1줄 수정 · 「다른 느낌」(seed 재추첨).
 *   - 발행 1버튼(+쿠폰 토글). 인쇄만 분리 관문(가격·이름·이미지 출처 3열 확인 시트 — §1-5).
 *
 * 옛 FlyerPage(목록+폼 1,310줄)를 대체한다 — 이력 관리는 홈의 「최근 전단」 조각이 잇는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, apiFetch } from '../App';
import AlertModal from '../components/AlertModal';
import { Input, ConfirmModal, Toast } from '../components/ui';
import ExcelUploadModal, { type MappedProduct } from '../components/ExcelUploadModal';
import FlyerPreview from '../components/FlyerPreview';

// ── 타입 ──────────────────────────────────────────────
interface NormItem {
  name: string;
  originalPrice: number;
  salePrice: number;
  badge?: string;
  unit?: string;
  origin?: string;
  cardDiscount?: string;
  aiCopy?: string;
  imageUrl?: string;
  /** 담을 때의 원본가(가격 확인 시트 diff 근거 — POS·카탈로그 값) */
  sourcePrice?: number;
  /** 이미지 출처 — 인쇄 확인 시트 3열(§1-5). manual = 사장님 업로드/카탈로그 저장분 */
  /** 이미지 출처 — 인쇄 확인 시트 3열(§1-5). '네이버'는 자동 매칭분이라 인쇄 시 별도 동의를 받는다 */
  imageSource?: '카탈로그' | 'POS' | '기본 자산' | '네이버' | '없음';
  /** ★ 1025 F2: 파일에 적힌 카테고리(서버 auto-build가 그대로 쓴다 · 없으면 자동 분류) */
  category?: string;
  /** ★ 1025 §2-5: 파일에서 가격을 읽지 못함 — 가격을 고치기 전엔 인쇄 관문 차단 */
  priceCheck?: boolean;
}
interface AutoBuild {
  template: string;
  season_token: string;
  reasons: string[];
  design_variant: any;
  categories: Array<{ name: string; items: NormItem[] }>;
  /** AI가 스스로 골랐을 값 — 사장님이 고른 것과 구분해 표시한다 */
  recommended_template?: string;
  picked?: boolean;
}
/** 템플릿 레지스트리(backend TEMPLATE_REGISTRY) — label/desc/color 그대로 화면 카드가 된다 */
interface TemplateInfo {
  value: string; label: string; desc: string; color: string;
  /** ★ 1025 17번 §3-5 갤러리 메타 */
  scene?: string; itemRange?: string; needsPhoto?: boolean; filter?: GalleryFilter;
}
type GalleryFilter = 'weekly' | 'deal' | 'fresh' | 'holiday' | 'premium';
const GALLERY_FILTERS: Array<{ key: GalleryFilter | 'all'; label: string }> = [
  { key: 'all', label: '전체' }, { key: 'weekly', label: '주간' }, { key: 'deal', label: '특가' },
  { key: 'fresh', label: '신선' }, { key: 'holiday', label: '명절' }, { key: 'premium', label: '프리미엄' },
];
/** 사진 후보(catalog/search-image 응답) — 확정은 select-image에서 사람 탭 1회 */
interface PickCand { title: string; image: string; match_score: number; }
interface RecentFlyer {
  id: string; title: string; status: string; short_code: string | null;
  period_start: string | null; period_end: string | null;
  categories: any; template: string; created_at: string;
  click_count?: number | string;
}
type Preset = 'weekly' | 'clearance' | 'seasonal';
type SheetKind = null | 'pos' | 'last' | 'catalog' | 'excel' | 'pop' | 'print' | 'add';

// ── 날짜 헬퍼: 이번 주 월~일 ──────────────────────────
function thisWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay() || 7; // 월=1 … 일=7
  const mon = new Date(now); mon.setDate(now.getDate() - day + 1);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: f(now), end: f(sun) };
}

// 접힘 칸 · 큰 선택 버튼 = 모듈 범위(페이지 함수 안에 두면 렌더마다 타입이 바뀌어 안의 입력이 재마운트된다)
function Fold({ k, openFold, onToggle, title, badge, children }: { k: string; openFold: string | null; onToggle: (k: string) => void; title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border-[1.5px] border-[#141210] bg-surface">
      <button type="button" onClick={() => onToggle(k)}
        className="w-full min-h-[60px] px-5 flex items-center justify-between gap-3 text-left text-[18px] font-extrabold text-text">
        <span>{title}{badge ? <span className="ml-2 text-[15px] font-bold text-text-secondary">{badge}</span> : null}</span>
        <span className="text-[16px] font-bold text-text-secondary">{openFold === k ? '접기' : '펼치기'}</span>
      </button>
      {openFold === k && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}
function BigChoice({ main, title, hint, onClick, icon }: { main?: boolean; title: string; hint: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-4 sm:gap-5 text-left px-5 sm:px-6 rounded-xl border-[#141210] transition-colors ${
        main ? 'min-h-[96px] border-[2.5px] bg-[#FFE14D] hover:bg-[#FFE866]' : 'min-h-[84px] border-[1.5px] bg-surface hover:bg-[#FFFBE3]'}`}>
      <span className="shrink-0 text-text" aria-hidden="true">{icon}</span>
      <span className="flex flex-col gap-0.5 min-w-0">
        <strong className="text-[19px] sm:text-[22px] font-black tracking-[-0.02em] text-text kr">{title}</strong>
        <span className="text-[15px] sm:text-[17px] text-text-secondary kr">{hint}</span>
      </span>
      <span className="ml-auto text-[32px] font-light leading-none text-text" aria-hidden="true">›</span>
    </button>
  );
}

export default function FlyerComposerPage({ token: _token, businessType = 'mart', onGoSend }: { token: string; businessType?: string; onGoSend?: (flyerId: string) => void }) {
  // ── 상태머신 ──
  const [view, setView] = useState<'home' | 'compose'>('home');
  const [items, setItems] = useState<NormItem[]>([]);
  const [build, setBuild] = useState<AutoBuild | null>(null);
  const [building, setBuilding] = useState(false);
  const [seed, setSeed] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [title, setTitle] = useState('');
  const [storeName, setStoreName] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // 발행
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ id: string; short_url: string; short_code: string } | null>(null);
  const [couponEnabled, setCouponEnabled] = useState(false);
  const [couponForm, setCouponForm] = useState({ coupon_name: '', coupon_type: 'fixed', discount_value: '', max_issues: '', expires_at: '' });

  // 홈 최근 전단
  const [recent, setRecent] = useState<RecentFlyer[]>([]);
  const [deleteModal, setDeleteModal] = useState({ show: false, id: '', title: '' });

  // 소스 시트 데이터
  const [posProducts, setPosProducts] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [sheetChecked, setSheetChecked] = useState<Record<string, boolean>>({});
  const [sheetLoading, setSheetLoading] = useState(false);

  // 템플릿 갤러리 (AI 추천 + 사장님 선택)
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [openFold, setOpenFold] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter | 'all'>('all');

  // 손질 — 상품 편집 시트 하나로(이름·판매가·원가·단위·원산지·뱃지·이미지)
  const [editPop, setEditPop] = useState<{ idx: number; draft: NormItem } | null>(null);

  // 사진 고르기 — 후보 제시 + 사람 탭 1회 확정(무인 자동 부착은 네이버 쇼핑 API 종료로 폐지 — 15번 §8)
  const [picker, setPicker] = useState<{ queue: number[]; pos: number; fromSheet: boolean } | null>(null);
  const [pickerCands, setPickerCands] = useState<PickCand[] | null>(null); // null = 불러오는 중
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  // 인쇄 관문
  const [printAgree, setPrintAgree] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [popBusy, setPopBusy] = useState(false);

  const [alert, setAlert] = useState({ show: false, title: '', message: '', type: 'success' as 'success' | 'error' });
  const [copyToast, setCopyToast] = useState(false);
  const buildTimer = useRef<number | null>(null);
  const buildSeq = useRef(0);

  // ── 최근 전단 로드(홈 조각 + 복제 소스) ──
  const loadRecent = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers`);
      if (res.ok) {
        const d = await res.json();
        const list = Array.isArray(d) ? d : (d.flyers || d.items || []);
        setRecent(list.slice(0, 8));
      }
    } catch { /* 홈 조각은 없어도 제작은 된다 */ }
  }, []);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  // ── 템플릿 레지스트리 로드 — 엔진에 살아 있는 10종을 화면에 그대로 편다 ──
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/flyer/business-types/templates`);
        if (!res.ok) return;
        const reg = await res.json();
        setTemplates(Object.values(reg || {}) as TemplateInfo[]);
      } catch { /* 갤러리는 없어도 자동 구성은 된다 */ }
    })();
  }, []);

  // ── 자동 완성: 담긴 상품이 바뀌면 서버가 구성한다(분류·엔진·변형 판정 전부 서버 — 화면 판정 0) ──
  const requestBuild = useCallback((nextItems: NormItem[], nextSeed: number | null, forceTemplate?: string | null) => {
    if (buildTimer.current) window.clearTimeout(buildTimer.current);
    if (nextItems.length === 0) { setBuild(null); return; }
    const tpl = forceTemplate !== undefined ? forceTemplate : pickedTemplate;
    buildTimer.current = window.setTimeout(async () => {
      const seq = ++buildSeq.current;
      setBuilding(true);
      try {
        const res = await apiFetch(`${API_BASE}/api/flyer/flyers/auto-build`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title, store_name: storeName, period_start: periodStart || null, period_end: periodEnd || null,
            business_type: businessType,
            products: nextItems,
            ...(tpl ? { template: tpl } : {}),
            ...(nextSeed !== null ? { seed: nextSeed } : {}),
          }),
        });
        if (seq !== buildSeq.current) return; // 늦게 온 응답이 최신을 덮지 않게
        if (res.ok) {
          const d = await res.json();
          setBuild(d);
        } else if (res.status === 503) {
          const e = await res.json().catch(() => null);
          setAlert({ show: true, title: '준비 중', message: e?.error || '서버 준비 중입니다. 잠시 후 다시 시도해 주세요.', type: 'error' });
        }
      } catch { /* 다음 변경에서 재시도 */ }
      finally { if (seq === buildSeq.current) setBuilding(false); }
    }, 600);
  }, [title, storeName, periodStart, periodEnd, businessType, pickedTemplate]);

  const setItemsAndBuild = useCallback((next: NormItem[]) => {
    setItems(next);
    setPublished(null); // 내용이 바뀌면 발행 결과는 과거다
    requestBuild(next, seed);
  }, [requestBuild, seed]);

  // ── 프리셋 카드 → compose 초기 상태 ──
  const startPreset = async (p: Preset) => {
    const wk = thisWeekRange();
    setPublished(null); setEditingId(null); setSeed(null); setBuild(null);
    setPeriodStart(wk.start); setPeriodEnd(wk.end);
    if (p === 'weekly') {
      setTitle('이번 주 행사');
      // 지난 전단이 있으면 그대로 복제해 연다(빈 폼 금지 — §1-1). 없으면 소스 시트 유도.
      const src = recent.find(r => Array.isArray(parseCats(r.categories)) && parseCats(r.categories).length > 0);
      if (src) {
        const flat = flattenCats(parseCats(src.categories));
        setItems(flat); setView('compose'); requestBuild(flat, null);
      } else {
        setItems([]); setView('compose'); setSheet('pos'); openSheet('pos');
      }
    } else if (p === 'clearance') {
      setTitle('오늘만 특가');
      const today = wk.start; setPeriodStart(today); setPeriodEnd(today);
      setItems([]); setView('compose');
    } else {
      setTitle('명절 대목 특선');
      setItems([]); setView('compose'); setSheet('catalog'); openSheet('catalog');
    }
  };

  // ── 소스 시트 ──
  const openSheet = async (kind: SheetKind) => {
    setSheet(kind); setSheetChecked({});
    if (kind === 'pos') {
      setSheetLoading(true);
      try {
        const res = await apiFetch(`${API_BASE}/api/flyer/pos/top-selling?limit=30&period=30`);
        setPosProducts(res.ok ? await res.json() : []);
      } catch { setPosProducts([]); }
      finally { setSheetLoading(false); }
    } else if (kind === 'catalog') {
      setSheetLoading(true);
      try {
        const res = await apiFetch(`${API_BASE}/api/flyer/catalog`);
        const d = res.ok ? await res.json() : { items: [] };
        setCatalogItems(d.items || []);
      } catch { setCatalogItems([]); }
      finally { setSheetLoading(false); }
    }
  };

  const addFromPos = () => {
    const picked = posProducts.filter((_, i) => sheetChecked[`pos-${i}`]);
    const next = [...items];
    for (const p of picked) {
      if (next.some(x => x.name === p.product_name)) continue;
      next.push({
        name: String(p.product_name || ''),
        originalPrice: 0,
        salePrice: Number(p.avg_price) || 0,
        sourcePrice: Number(p.avg_price) || 0,
        imageUrl: p.image_url || undefined,
        imageSource: p.image_url ? 'POS' : '없음',
      });
    }
    setSheet(null); setItemsAndBuild(next);
  };

  const addFromCatalog = () => {
    const picked = catalogItems.filter((_, i) => sheetChecked[`cat-${i}`]);
    const next = [...items];
    for (const c of picked) {
      const nm = String(c.product_name || c.name || '');
      if (!nm || next.some(x => x.name === nm)) continue;
      next.push({
        name: nm,
        originalPrice: Number(c.original_price) || 0,
        salePrice: Number(c.sale_price ?? c.price) || 0,
        sourcePrice: Number(c.sale_price ?? c.price) || 0,
        unit: c.unit || undefined,
        origin: c.origin || undefined,
        imageUrl: c.image_url || undefined,
        imageSource: c.image_url ? '카탈로그' : '없음',
      });
    }
    setSheet(null); setItemsAndBuild(next);
  };

  const addFromLast = (f: RecentFlyer) => {
    const flat = flattenCats(parseCats(f.categories));
    const next = [...items];
    for (const it of flat) if (!next.some(x => x.name === it.name)) next.push(it);
    setSheet(null); setItemsAndBuild(next);
  };

  const addFromExcel = (products: MappedProduct[]) => {
    // ⚠ 이 모달이 주는 상품명 필드는 productName 이다(POP·인쇄 화면도 같은 이름을 읽는다).
    //   name 으로 읽으면 전 행이 "이름 없음"으로 걸러져 조용히 0건이 된다 — 0820 실사고.
    const next = [...items];
    let added = 0, skipped = 0;
    // ★ 1025 F2: 같은 상품 = 이름 + 규격(규격만 다른 두 행이 하나로 사라지던 결함)
    const sameItem = (x: NormItem, nm: string, unit?: string) => x.name === nm && (x.unit || '') === (unit || '');
    for (const p of products) {
      const nm = String(p.productName || (p as any).name || '').trim();
      if (!nm) { skipped++; continue; }
      if (next.some(x => sameItem(x, nm, p.unit))) { skipped++; continue; }
      const img = String(p.imageUrl || '').trim();
      const cat = String(p.category || '').trim();
      next.push({
        name: nm,
        originalPrice: Number(p.originalPrice) || 0,
        salePrice: Number(p.salePrice) || 0,
        sourcePrice: Number(p.salePrice) || 0,
        unit: p.unit || undefined,
        origin: p.origin || undefined,
        badge: p.badge || undefined,
        cardDiscount: p.cardDiscount || undefined,
        category: cat && cat !== '기타' ? cat : undefined,
        priceCheck: p.reviewPrice ? true : undefined,
        imageUrl: img || undefined,
        imageSource: img ? '카탈로그' : '없음',
      });
      added++;
    }
    setSheet(null);
    // 아무것도 안 담겼으면 조용히 넘어가지 않는다 — "변하는 게 없다"의 재발 차단
    if (added === 0) {
      setAlert({
        show: true, title: '담긴 상품이 없습니다', type: 'error',
        message: products.length === 0
          ? '엑셀에서 읽어온 상품이 없습니다. 상품명 열이 매핑됐는지 확인해 주세요.'
          : `${products.length}개 중 담을 수 있는 상품이 없었습니다. (이미 담긴 상품이거나 상품명이 비어 있음 — 건너뜀 ${skipped}건)`,
      });
      return;
    }
    setItemsAndBuild(next);
  };

  // ── 사진 고르기 — catalog/search-image(후보) + catalog/select-image(사람 확정·로컬 저장) 재사용 ──
  const pickerApiNotice = (apiError: number | null | undefined, count: number): string | null => {
    if (apiError === 429) return '오늘 이미지 검색 한도를 다 썼습니다. 내일 다시 시도해 주세요.';
    if (apiError === 401) return '이미지 검색 인증에 문제가 있습니다. 관리자에게 알려 주세요.';
    if (apiError) return '이미지 검색 연결에 문제가 있습니다. 잠시 후 다시 시도해 주세요.';
    if (count === 0) return '후보를 찾지 못했습니다. 상품명을 조금 단순하게 고치면 잘 나옵니다.';
    return null;
  };

  const loadPickerCands = async (idx: number, fromSheet: boolean) => {
    setPickerCands(null); setPickerNotice(null);
    const nm = (fromSheet ? editPop?.draft.name : items[idx]?.name)?.trim();
    if (!nm) { setPickerCands([]); setPickerNotice('상품명이 비어 있습니다.'); return; }
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog/search-image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_name: nm }),
      });
      const d = await res.json();
      const list: PickCand[] = res.ok ? (d.items || []) : [];
      setPickerCands(list);
      setPickerNotice(res.ok ? pickerApiNotice(d.api_error, list.length) : (d.error || '이미지 검색에 실패했습니다.'));
    } catch {
      setPickerCands([]); setPickerNotice('네트워크 오류가 있었습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  const openPicker = (indices: number[], fromSheet: boolean) => {
    if (indices.length === 0) return;
    setPicker({ queue: indices, pos: 0, fromSheet });
    loadPickerCands(indices[0], fromSheet);
  };

  const advancePicker = () => {
    if (!picker) return;
    const nextPos = picker.pos + 1;
    if (nextPos >= picker.queue.length) { setPicker(null); return; }
    setPicker({ ...picker, pos: nextPos });
    loadPickerCands(picker.queue[nextPos], picker.fromSheet);
  };

  const pickCandidate = async (c: PickCand) => {
    if (!picker || pickerBusy) return;
    setPickerBusy(true); setPickerNotice(null);
    try {
      // 확정 = 사람 탭 1회 → 서버가 받아서 자체 저장(핫링크 0)한 URL만 쓴다
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog/select-image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: c.image }),
      });
      const d = await res.json();
      if (!res.ok || !d.image_url) {
        setPickerNotice(d?.error || '이미지 저장에 실패했습니다. 다른 사진으로 시도해 주세요.');
        return;
      }
      const idx = picker.queue[picker.pos];
      if (picker.fromSheet) {
        // 편집 시트 계약 유지 — 반영은 시트의 저장 버튼이 확정한다
        setDraft({ imageUrl: d.image_url, imageSource: '네이버' });
        setPicker(null);
      } else {
        setItemsAndBuild(items.map((it, i) => (i === idx ? { ...it, imageUrl: d.image_url, imageSource: '네이버' } : it)));
        advancePicker();
      }
    } catch {
      setPickerNotice('네트워크 오류가 있었습니다. 잠시 후 다시 시도해 주세요.');
    } finally { setPickerBusy(false); }
  };

  // ── 손질: 빼기 + 상품 편집 시트 ──
  const removeItem = (idx: number) => setItemsAndBuild(items.filter((_, i) => i !== idx));
  const openEdit = (idx: number) => setEditPop({ idx, draft: { ...items[idx] } });
  const setDraft = (patch: Partial<NormItem>) =>
    setEditPop(p => (p ? { ...p, draft: { ...p.draft, ...patch } } : p));
  const applyEdit = () => {
    if (!editPop) return;
    const d = editPop.draft;
    const nm = d.name.trim();
    if (!nm) return;
    const next = items.map((it, i) => (i === editPop.idx ? {
      ...it,
      ...d,
      name: nm,
      salePrice: Math.max(0, Math.floor(Number(d.salePrice) || 0)),
      originalPrice: Math.max(0, Math.floor(Number(d.originalPrice) || 0)),
      unit: (d.unit || '').trim() || undefined,
      origin: (d.origin || '').trim() || undefined,
      badge: (d.badge || '').trim() || undefined,
      // 사장님이 가격을 직접 확인·입력했으면 파일 가격 확인 표시를 걷는다
      priceCheck: Math.floor(Number(d.salePrice) || 0) > 0 ? undefined : it.priceCheck,
    } : it));
    setEditPop(null); setItemsAndBuild(next);
  };

  // ── 발행(1버튼 + 쿠폰 토글) ──
  const publish = async (): Promise<string | null> => {
    if (!build || items.length === 0 || publishing) return null;
    setPublishing(true);
    try {
      const body = {
        title: title.trim() || '이번 주 행사',
        store_name: storeName.trim(),
        period_start: periodStart || null,
        period_end: periodEnd || null,
        categories: build.categories,
        template: build.template,
        extra_data: {},
        design_variant: build.design_variant,
        recommended_engine: { templateCode: build.template, reasons: build.reasons },
      };
      let flyerId = editingId;
      if (flyerId) {
        const up = await apiFetch(`${API_BASE}/api/flyer/flyers/${flyerId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!up.ok) throw new Error('수정 저장 실패');
      } else {
        const res = await apiFetch(`${API_BASE}/api/flyer/flyers`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.status === 503) {
          const e = await res.json().catch(() => null);
          setAlert({ show: true, title: '준비 중', message: e?.error || '서버 마이그레이션 대기 중입니다.', type: 'error' });
          return null;
        }
        if (!res.ok) throw new Error('저장 실패');
        const created = await res.json();
        flyerId = created.id;
      }
      const pub = await apiFetch(`${API_BASE}/api/flyer/flyers/${flyerId}/publish`, { method: 'POST' });
      if (!pub.ok) throw new Error('발행 실패');
      const d = await pub.json();
      if (couponEnabled && couponForm.coupon_name && couponForm.discount_value) {
        await apiFetch(`${API_BASE}/api/flyer/coupons`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coupon_name: couponForm.coupon_name,
            coupon_type: couponForm.coupon_type,
            discount_value: Number(couponForm.discount_value),
            max_issues: couponForm.max_issues ? Number(couponForm.max_issues) : undefined,
            expires_at: couponForm.expires_at || undefined,
            flyer_id: flyerId,
          }),
        }).catch(() => { /* 쿠폰 실패해도 발행은 성립 — 아래 안내로 표면화 */ });
      }
      setPublished({ id: String(flyerId), short_url: d.short_url, short_code: d.short_code });
      setEditingId(String(flyerId));
      loadRecent();
      return String(flyerId);
    } catch (e: any) {
      setAlert({ show: true, title: '오류', message: e?.message || '전단 주소를 만들지 못했습니다.', type: 'error' });
      return null;
    } finally { setPublishing(false); }
  };

  // ── POP 뽑기(같은 완성본 승계 — §1-5) ──
  const downloadBlob = async (res: Response, filename: string) => {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const popPreset = async (kind: 'single' | 'split8' | 'pricecard' | 'strip') => {
    if (items.length === 0 || popBusy) return;
    setPopBusy(true);
    try {
      const season = build?.season_token || 'default';
      if (kind === 'single') {
        const res = await apiFetch(`${API_BASE}/api/flyer/flyers/pop-pdf`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: items[0], storeName, popTemplate: 'hot', season }),
        });
        if (!res.ok) throw new Error('POP 생성 실패');
        await downloadBlob(res, 'POP.pdf');
      } else if (kind === 'strip') {
        const res = await apiFetch(`${API_BASE}/api/flyer/flyers/strip-pop`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, storeName, season }),
        });
        if (!res.ok) throw new Error('띠지 생성 실패');
        await downloadBlob(res, '매대띠지.pdf');
      } else {
        const splits = kind === 'split8' ? 8 : 35;
        const res = await apiFetch(`${API_BASE}/api/flyer/flyers/multi-pop`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, splits, storeName, paperSize: 'A4', season }),
        });
        if (!res.ok) throw new Error('POP 생성 실패');
        await downloadBlob(res, kind === 'split8' ? 'POP_8분할.pdf' : '프라이스카드.pdf');
      }
      setSheet(null);
    } catch (e: any) {
      setAlert({ show: true, title: '오류', message: e?.message || 'POP 생성에 실패했습니다.', type: 'error' });
    } finally { setPopBusy(false); }
  };

  // ── 인쇄 관문(§1-5): 3열 확인 + 자동 이미지 동의 → PDF ──
  const printRows = useMemo(() => items.map(it => ({
    name: it.name,
    price: it.salePrice,
    src: it.imageUrl ? (it.imageSource || '기본 자산') : '없음',
    diff: it.sourcePrice !== undefined && it.sourcePrice > 0 && it.sourcePrice !== it.salePrice,
  })), [items]);
  const hasAutoImage = printRows.some(r => r.src !== '없음' && r.src !== '카탈로그');
  // ★ 1025 §2-5 인쇄 관문: 가격 미확인(파일에서 못 읽음) · 0원 상품은 인쇄하지 않는다 — 소스 무관
  const priceBlocked = items.filter(it => it.priceCheck || !(it.salePrice > 0));
  const doPrint = async () => {
    if (printBusy) return;
    if (hasAutoImage && !printAgree) return;
    if (priceBlocked.length > 0) return;
    setPrintBusy(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/print-flyer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || '이번 주 행사',
          period: periodStart && periodEnd ? `${periodStart} ~ ${periodEnd}` : '',
          period_start: periodStart || null,
          storeName,
          products: items.map(it => ({ productName: it.name, price: it.salePrice, originalPrice: it.originalPrice, unit: it.unit, origin: it.origin, imageUrl: it.imageUrl })),
          format: 'pdf',
        }),
      });
      if (!res.ok) throw new Error('인쇄 PDF 생성 실패');
      await downloadBlob(res, '인쇄전단.pdf');
      setSheet(null); setPrintAgree(false);
    } catch (e: any) {
      setAlert({ show: true, title: '오류', message: e?.message || '인쇄 PDF 생성에 실패했습니다.', type: 'error' });
    } finally { setPrintBusy(false); }
  };

  // ── 홈 조각 액션 ──
  const copyUrl = (code: string) => { navigator.clipboard.writeText(`https://hanjul-flyer.kr/${code}`); setCopyToast(true); setTimeout(() => setCopyToast(false), 2000); };
  const openAsBase = (f: RecentFlyer) => {
    const wk = thisWeekRange();
    setTitle(f.title || '이번 주 행사'); setPeriodStart(wk.start); setPeriodEnd(wk.end);
    setEditingId(f.status === 'published' ? null : f.id); // 발행본은 복제(새 장), 초안은 이어 만들기
    setPublished(null); setSeed(null);
    const flat = flattenCats(parseCats(f.categories));
    setItems(flat); setView('compose'); requestBuild(flat, null);
  };
  const removeFlyer = async (id: string) => {
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/${id}`, { method: 'DELETE' });
      if (res.ok) { setDeleteModal({ show: false, id: '', title: '' }); loadRecent(); }
    } catch { /* 다음 로드에서 상태 확인 */ }
  };

  // ══════════════════ 렌더 ══════════════════
  // ★ 1026 18번 — 「한 화면 한 일」(PRODUCT.md 원칙 6 · 사장님 PC 미숙): 처음 = 상품 담기 하나 · 담은 뒤 = 보내기 하나.
  //   부가 기능(상품 고치기 · 행사 정보 · 쿠폰 · POP·인쇄)은 접힌 줄 안 — 필요할 때만 연다.
  const showHome = view === 'home' || items.length === 0;
  const totalSave = items.reduce((s, it) => s + (it.originalPrice > it.salePrice && it.salePrice > 0 ? it.originalPrice - it.salePrice : 0), 0);
  const liveFlyer = recent.find(r => r.status === 'published');
  const previewCategories = build?.categories?.length ? build.categories : (items.length ? [{ name: '상품', items }] : []);
  const noImageIdxs = items.map((it, i) => (!it.imageUrl ? i : -1)).filter(i => i >= 0);
  const templateLabel = (code?: string) => templates.find(t => t.value === code)?.label || code || '자동';
  const applyTemplate = (code: string | null) => {
    setPickedTemplate(code);
    setGalleryOpen(false);
    setPublished(null); // 디자인이 바뀌면 앞서 발행한 결과는 과거다
    if (items.length > 0) requestBuild(items, seed, code);
  };
  const goSource = (kind: SheetKind) => { setView('compose'); if (kind === 'excel') setSheet('excel'); else openSheet(kind); };
  // 보내기 = 발행(주소 만들기) → 발송 화면으로. 이미 발행했으면 바로 발송 화면.
  // 발행 응답이 오기 전에 화면을 떠났으면(언마운트) 이동하지 않는다. 늦은 응답이 다른 화면의 작업을 덮지 않게.
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const sendToCustomers = async () => {
    if (published) { onGoSend?.(published.id); return; }
    const id = await publish();
    if (id && mountedRef.current) onGoSend?.(id);
  };
  const toggleFold = (k: string) => setOpenFold(o => (o === k ? null : k));
  const ico = (d: string) => <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
  const ICON_EXCEL = ico('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 18v-6m0 0-3 3m3-3 3 3');
  const ICON_AGAIN = ico('M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5');
  const ICON_POS = ico('M3 20h18M6 16V9M11 16V5M16 16v-5M21 16v-8');
  const ICON_LIST = ico('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01');

  return (
    <div className="max-w-6xl mx-auto pb-16">
      {showHome ? (
        /* ══ 처음 — 할 일 하나: 상품 담기 ══ */
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px] rounded-2xl border-2 border-[#141210] bg-surface overflow-hidden rise">
          <section className="p-6 sm:p-10 lg:border-r-2 border-b-2 lg:border-b-0 border-[#141210] min-w-0">
            <h1 className="text-[30px] sm:text-[40px] font-black tracking-[-0.035em] leading-[1.15] text-text kr">이번 주 전단을 만들어요</h1>
            <p className="mt-2.5 text-[17px] sm:text-[19px] text-text-secondary kr">상품만 담으면 전단이 바로 완성됩니다. 아래에서 <b className="text-text">하나만</b> 고르세요.</p>
            <div className="mt-7 flex flex-col gap-3 max-w-[680px]">
              <BigChoice main title="엑셀 파일 올리기" hint="상품 목록 파일이 있으면 이걸 누르세요" onClick={() => goSource('excel')} icon={ICON_EXCEL} />
              <BigChoice title="지난주 전단 그대로 쓰기" hint={recent.length > 0 ? '가격만 바꾸면 됩니다' : '아직 만든 전단이 없어요. 잘 팔리는 상품부터 보여 드려요'} onClick={() => startPreset('weekly')} icon={ICON_AGAIN} />
              <BigChoice title="잘 팔리는 상품에서 고르기" hint="계산대 판매 순위에서 체크만" onClick={() => goSource('pos')} icon={ICON_POS} />
            </div>
            <a href="/samples/hanjul-flyer-sample.xlsx" download
              className="mt-4 inline-flex items-center gap-2 text-[17px] sm:text-[18px] font-extrabold text-text underline underline-offset-4">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>
              엑셀 파일이 없으면 → 예시 양식 받기
            </a>
            <button type="button" onClick={() => goSource('catalog')}
              className="mt-3 flex items-center gap-2 min-h-[44px] text-[17px] sm:text-[18px] font-extrabold text-text underline underline-offset-4">
              등록해 둔 상품 목록에서 고르기
            </button>
            {liveFlyer && (
              <div className="mt-9 max-w-[680px] flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-bg px-5 py-4 text-[16px] sm:text-[17px] text-text">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 shrink-0" />
                <span className="flex-1 min-w-0 kr">지금 손님에게 나가 있는 전단 <b>「{liveFlyer.title}」</b>{typeof liveFlyer.click_count !== 'undefined' ? <> · <b>{Number(liveFlyer.click_count || 0).toLocaleString()}명</b>이 봤어요</> : null}</span>
                {liveFlyer.short_code && <button type="button" onClick={() => copyUrl(liveFlyer.short_code!)} className="font-extrabold underline underline-offset-4 whitespace-nowrap">주소 복사</button>}
              </div>
            )}
            {recent.length > 0 && (
              <div className="mt-4 max-w-[680px]">
                <button type="button" onClick={() => setShowRecent(v => !v)} className="text-[16px] font-bold text-text-secondary underline underline-offset-4">
                  {showRecent ? '내 전단 접기' : `내 전단 ${recent.length}개 보기`}
                </button>
                {showRecent && (
                  <ul className="mt-3 divide-y divide-border rounded-xl border-[1.5px] border-[#141210] bg-surface">
                    {recent.map(f => (
                      <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-[160px]">
                          <p className="text-[16px] font-extrabold text-text truncate">{f.title}</p>
                          <p className="text-[14px] text-text-secondary">{String(f.created_at).slice(0, 10)} · {f.status === 'published' ? '보낸 전단' : '만드는 중'}</p>
                        </div>
                        <button type="button" onClick={() => openAsBase(f)} className="h-11 px-4 rounded-lg bg-[#141210] text-white text-[15px] font-extrabold">{f.status === 'published' ? '이걸로 새로' : '이어 만들기'}</button>
                        <button type="button" onClick={() => setDeleteModal({ show: true, id: f.id, title: f.title })} className="h-11 px-3 rounded-lg border-[1.5px] border-border text-[15px] font-bold text-text-secondary">삭제</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
          <aside className="bg-bg px-5 py-7 flex flex-col items-center gap-3" aria-label="전단 예시">
            <p className="text-[15px] font-bold text-text-secondary">상품을 담으면 이런 전단이 됩니다</p>
            <div className="relative w-full max-w-[360px] rounded-[26px] border-[1.5px] border-[#141210] overflow-hidden bg-surface shadow-elevated">
              <img src={`${API_BASE}/api/flyer/business-types/templates/grid_hero/sample.png`} alt="전단 예시" className="w-full block opacity-60"
                onError={e => { const a = e.currentTarget.closest('aside'); if (a) a.hidden = true; }} />
              <span className="absolute left-1/2 -translate-x-1/2 bottom-5 px-4 py-1 rounded-full bg-[#141210] text-white text-[15px] font-extrabold">예시</span>
            </div>
          </aside>
        </div>
      ) : (
        /* ══ 담은 뒤 — 할 일 하나: 보내기 ══ */
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px] rounded-2xl border-2 border-[#141210] bg-surface overflow-hidden rise">
          <section className="p-6 sm:p-10 lg:border-r-2 border-b-2 lg:border-b-0 border-[#141210] min-w-0">
            <button type="button" onClick={() => setView('home')} className="inline-flex items-center gap-1.5 text-[16px] font-bold text-text-secondary mb-4">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>처음으로
            </button>
            <h1 className="text-[30px] sm:text-[40px] font-black tracking-[-0.035em] leading-[1.15] text-text kr">
              {published ? '전단 주소가 만들어졌어요' : building || !build ? '전단을 만드는 중이에요' : '전단이 완성됐어요'}
            </h1>
            <p className="mt-2.5 text-[17px] sm:text-[19px] text-text-secondary kr">
              {published ? '아래 버튼을 누르면 손님에게 문자로 보내는 화면으로 넘어갑니다.' : <>오른쪽이 손님 휴대폰에 보이는 모습입니다. 맞으면 <b className="text-text">보내기</b>를 누르세요.</>}
            </p>

            <div className="mt-7 max-w-[680px] grid grid-cols-1 sm:grid-cols-[1fr_1.6fr] rounded-xl border-2 border-[#141210] overflow-hidden bg-[#FFE14D]">
              <div className="px-5 py-4 sm:border-r-2 border-b-2 sm:border-b-0 border-[#141210]">
                <p className="text-[16px] font-bold text-text-secondary">담은 상품</p>
                <p className="font-poster text-[40px] leading-tight text-text tabular-nums">{items.length}개</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[16px] font-bold text-text-secondary">손님이 아끼는 돈</p>
                <p className="font-poster text-[40px] leading-tight text-[#D7191C] tabular-nums">{totalSave.toLocaleString()}원</p>
              </div>
            </div>

            {priceBlocked.length > 0 && (
              <div className="mt-4 max-w-[680px] rounded-xl border-[1.5px] border-amber-500 bg-amber-50 px-5 py-4">
                <p className="text-[17px] font-extrabold text-amber-900 kr">가격을 확인할 상품이 {priceBlocked.length}개 있어요</p>
                <p className="mt-1 text-[15px] text-amber-900 kr">「{priceBlocked[0].name}」{priceBlocked.length > 1 ? ` 외 ${priceBlocked.length - 1}개` : ''}의 가격을 고치기 전엔 인쇄할 수 없습니다.</p>
                <button type="button" onClick={() => setOpenFold('items')} className="mt-3 h-11 px-4 rounded-lg bg-[#141210] text-white text-[15px] font-extrabold">가격 고치러 가기</button>
              </div>
            )}

            <button type="button" onClick={sendToCustomers} disabled={publishing || building || !build}
              className="mt-7 w-full max-w-[680px] h-[76px] rounded-xl border-2 border-[#141210] bg-[#141210] text-white text-[22px] sm:text-[24px] font-black hover:bg-[#2a2622] disabled:opacity-40 disabled:cursor-not-allowed">
              {publishing ? '전단 주소를 만드는 중...' : '손님에게 보내기'}
            </button>
            {published && (
              <p className="mt-3 max-w-[680px] text-[16px] text-text-secondary kr">
                전단 주소 <b className="text-text">{published.short_url.replace('https://', '')}</b>
                <button type="button" onClick={() => copyUrl(published.short_code)} className="ml-2 font-extrabold text-text underline underline-offset-4">복사</button>
              </p>
            )}
            <div className="mt-3 max-w-[680px] grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => setSheet('add')} className="h-[60px] rounded-xl border-[1.5px] border-[#141210] bg-surface text-[18px] sm:text-[19px] font-extrabold text-text hover:bg-[#FFFBE3]">상품 더 담기</button>
              <button type="button" onClick={() => setGalleryOpen(true)} className="h-[60px] rounded-xl border-[1.5px] border-[#141210] bg-surface text-[18px] sm:text-[19px] font-extrabold text-text hover:bg-[#FFFBE3]">디자인 바꾸기</button>
            </div>

            <div className="mt-9 max-w-[680px] space-y-2.5">
              <Fold k="items" openFold={openFold} onToggle={toggleFold} title="담은 상품 고치기" badge={`${items.length}개`}>
                {noImageIdxs.length > 0 && (
                  <button type="button" onClick={() => openPicker(noImageIdxs, false)} className="mb-3 h-11 px-4 rounded-lg border-[1.5px] border-[#141210] text-[15px] font-extrabold text-text">사진 고르기 ({noImageIdxs.length})</button>
                )}
                <p className="text-[15px] text-text-secondary mb-2 kr">상품을 누르면 이름·가격·원산지·사진을 고칠 수 있습니다</p>
                <ul className="space-y-2">
                  {items.map((it, i) => (
                    <li key={`${it.name}-${i}`} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${it.priceCheck || !(it.salePrice > 0) ? 'border-amber-500 bg-amber-50' : 'border-border bg-bg'}`}>
                      <button type="button" onClick={() => openEdit(i)} className="flex-1 min-w-0 text-left">
                        <p className="text-[16px] font-extrabold text-text truncate">{it.name}</p>
                        <p className="text-[14px] text-text-secondary truncate">{[it.unit, it.origin, it.badge].filter(Boolean).join(' · ') || '정보 추가하기'}</p>
                      </button>
                      <button type="button" onClick={() => openEdit(i)} className="text-right shrink-0 tabular-nums">
                        {it.originalPrice > it.salePrice && <p className="text-[13px] text-text-secondary line-through leading-tight">{it.originalPrice.toLocaleString()}원</p>}
                        <p className={`text-[17px] font-black leading-tight ${it.salePrice > 0 ? 'text-text' : 'text-amber-800'}`}>{it.salePrice > 0 ? `${it.salePrice.toLocaleString()}원` : '가격 입력'}</p>
                      </button>
                      <button type="button" onClick={() => removeItem(i)} className="h-10 px-3 rounded-lg text-[14px] font-bold text-text-secondary hover:text-rose-600" aria-label={`${it.name} 빼기`}>빼기</button>
                    </li>
                  ))}
                </ul>
              </Fold>
              <Fold k="info" openFold={openFold} onToggle={toggleFold} title="행사 이름·기간 바꾸기">
                <div className="space-y-2.5 field-quiet">
                  <Input label="행사 이름" value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 이번 주 행사" />
                  <Input label="매장 이름" value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="전단에 표시됩니다" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="시작일" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                    <Input label="종료일" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                  </div>
                  <button type="button" onClick={() => requestBuild(items, seed)} className="h-11 px-4 rounded-lg bg-[#141210] text-white text-[15px] font-extrabold">전단에 반영하기</button>
                </div>
              </Fold>
              <Fold k="coupon" openFold={openFold} onToggle={toggleFold} title="QR 쿠폰 넣기" badge={couponEnabled ? '넣음' : undefined}>
                <label className="flex items-center gap-3 text-[16px] font-bold text-text">
                  <input type="checkbox" checked={couponEnabled} onChange={e => setCouponEnabled(e.target.checked)} className="w-5 h-5 accent-slate-900" />
                  보낼 때 쿠폰도 같이 만들기
                </label>
                {couponEnabled && (
                  <div className="mt-3 space-y-2 field-quiet">
                    <Input value={couponForm.coupon_name} onChange={e => setCouponForm({ ...couponForm, coupon_name: e.target.value })} placeholder="쿠폰 이름 (예: 5,000원 할인)" />
                    <div className="grid grid-cols-2 gap-2">
                      <select className="bg-surface border border-border rounded-lg px-3 py-2 text-[16px] text-text" value={couponForm.coupon_type} onChange={e => setCouponForm({ ...couponForm, coupon_type: e.target.value })}>
                        <option value="fixed">원 할인</option>
                        <option value="percent">% 할인</option>
                      </select>
                      <Input type="number" value={couponForm.discount_value} onChange={e => setCouponForm({ ...couponForm, discount_value: e.target.value })} placeholder="할인 금액" />
                    </div>
                  </div>
                )}
              </Fold>
              <Fold k="print" openFold={openFold} onToggle={toggleFold} title="POP·인쇄 전단도 뽑기">
                <div className="grid grid-cols-2 gap-2.5">
                  <button type="button" onClick={() => setSheet('pop')} className="h-14 rounded-xl border-[1.5px] border-[#141210] text-[17px] font-extrabold text-text">POP 뽑기</button>
                  <button type="button" onClick={() => { setSheet('print'); setPrintAgree(false); }} className="h-14 rounded-xl border-[1.5px] border-[#141210] text-[17px] font-extrabold text-text">인쇄 전단 뽑기</button>
                </div>
              </Fold>
            </div>
          </section>

          <aside className="bg-bg px-4 sm:px-6 py-7 flex flex-col items-center gap-3" aria-label="전단 미리보기">
            <p className="text-[15px] font-bold text-text-secondary">손님 휴대폰에 이렇게 보입니다</p>
            <div className="relative w-full max-w-[393px] h-[680px] rounded-[26px] overflow-hidden bg-surface border-[1.5px] border-[#141210] shadow-elevated">
              <FlyerPreview
                title={title} storeName={storeName}
                periodStart={periodStart} periodEnd={periodEnd}
                categories={previewCategories as any}
                template={build?.template || 'grid_hero'}
                designVariant={build?.design_variant || null}
              />
              {building && <div className="absolute inset-x-0 top-0 h-1 sheen bg-border" />}
            </div>
          </aside>
        </div>
      )}

      {/* ── 상품 더 담기 — 어디서 담을지 하나만 고른다 ── */}
      {sheet === 'add' && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="bg-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl border border-border p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[20px] font-black text-text">어디서 상품을 담을까요?</p>
              <button onClick={() => setSheet(null)} className="w-10 h-10 rounded-full flex items-center justify-center text-text-secondary hover:bg-bg" aria-label="닫기">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <BigChoice main title="엑셀 파일 올리기" hint="상품 목록 파일로 한 번에" onClick={() => setSheet('excel')} icon={ICON_EXCEL} />
            <BigChoice title="잘 팔리는 상품" hint="계산대 판매 순위에서 체크만" onClick={() => openSheet('pos')} icon={ICON_POS} />
            <BigChoice title="지난 전단에서" hint="예전 전단의 상품 가져오기" onClick={() => openSheet('last')} icon={ICON_AGAIN} />
            <BigChoice title="상품 목록(카탈로그)에서" hint="등록해 둔 상품에서 체크만" onClick={() => openSheet('catalog')} icon={ICON_LIST} />
          </div>
        </div>
      )}

      {/* ── 바텀시트: 소스 선택(체크만) ── */}
      {(sheet === 'pos' || sheet === 'catalog' || sheet === 'last') && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="bg-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl border border-border max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <p className="text-base font-bold text-text">
                {sheet === 'pos' ? '요즘 잘 팔리는 상품' : sheet === 'catalog' ? '카탈로그에서 담기' : '지난 전단에서 가져오기'}
              </p>
              <button onClick={() => setSheet(null)} className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg transition-colors" aria-label="닫기">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {sheetLoading ? (
                <p className="text-sm text-text-muted text-center py-10">불러오는 중...</p>
              ) : sheet === 'pos' ? (
                posProducts.length === 0 ? <p className="text-sm text-text-muted text-center py-10">POS 판매 데이터가 아직 없어요.<br />POS Agent를 연결하면 여기에 인기 상품이 뜹니다.</p> :
                posProducts.map((p, i) => (
                  <label key={i} className="flex items-center gap-3 bg-bg rounded-xl px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={!!sheetChecked[`pos-${i}`]} onChange={e => setSheetChecked({ ...sheetChecked, [`pos-${i}`]: e.target.checked })} className="w-4 h-4 accent-slate-900" />
                    <span className="flex-1 text-sm text-text truncate">{p.product_name}</span>
                    <span className="text-[11px] text-text-muted">{Number(p.total_qty) || 0}개 판매</span>
                    <span className="text-[13px] font-extrabold text-text tabular-nums">{(Number(p.avg_price) || 0).toLocaleString()}원</span>
                  </label>
                ))
              ) : sheet === 'catalog' ? (
                catalogItems.length === 0 ? <p className="text-sm text-text-muted text-center py-10">카탈로그가 비어 있어요.<br />상품관리에서 등록하거나 엑셀로 올려 주세요.</p> :
                catalogItems.map((c, i) => (
                  <label key={i} className="flex items-center gap-3 bg-bg rounded-xl px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={!!sheetChecked[`cat-${i}`]} onChange={e => setSheetChecked({ ...sheetChecked, [`cat-${i}`]: e.target.checked })} className="w-4 h-4 accent-slate-900" />
                    <span className="flex-1 text-sm text-text truncate">{c.product_name || c.name}</span>
                    <span className="text-[13px] font-extrabold text-text tabular-nums">{(Number(c.sale_price ?? c.price) || 0).toLocaleString()}원</span>
                  </label>
                ))
              ) : (
                recent.length === 0 ? <p className="text-sm text-text-muted text-center py-10">지난 전단이 아직 없어요.</p> :
                recent.map(f => (
                  <button key={f.id} onClick={() => addFromLast(f)} className="w-full flex items-center gap-3 bg-bg rounded-xl px-3 py-2.5 text-left hover:border-border-strong border border-transparent">
                    <span className="flex-1 text-sm text-text truncate">{f.title}</span>
                    <span className="text-[11px] text-text-muted">{String(f.created_at).slice(0, 10)}</span>
                    <span className="text-[12px] font-bold text-text">상품 가져오기 →</span>
                  </button>
                ))
              )}
            </div>
            {(sheet === 'pos' || sheet === 'catalog') && (
              <div className="px-4 py-3 border-t border-border">
                <button className="w-full h-12 rounded-xl btn-ink text-sm" onClick={sheet === 'pos' ? addFromPos : addFromCatalog}
                  disabled={!Object.values(sheetChecked).some(Boolean)}>
                  {(() => { const n = Object.values(sheetChecked).filter(Boolean).length; return n > 0 ? `${n}개 담기` : '담기'; })()}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ 디자인 갤러리 — 엔진에 살아 있는 전 템플릿을 눈으로 고른다 ══ */}
      {galleryOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onMouseDown={e => { if (e.target === e.currentTarget) setGalleryOpen(false); }}>
          <div className="bg-bg w-full sm:max-w-4xl sm:rounded-3xl rounded-t-3xl border border-border max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-5 bg-surface border-b border-border">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-poster text-2xl text-text leading-tight">디자인 고르기</p>
                  <p className="text-[15px] text-text-muted mt-1 kr">
                    누르면 바로 그 디자인으로 다시 섭니다. 담긴 상품은 그대로예요.
                  </p>
                </div>
                <button onClick={() => setGalleryOpen(false)} className="w-9 h-9 rounded-full btn-quiet shrink-0 !text-text-muted hover:!text-text" aria-label="닫기">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* AI 자동 */}
              <button onClick={() => applyTemplate(null)}
                className={`w-full text-left rounded-2xl p-4 mb-3 border-2 transition-all ${
                  pickedTemplate === null ? 'border-slate-900 bg-surface shadow-card' : 'border-border bg-surface hover:border-border-strong'
                }`}>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center bg-slate-900">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[16px] font-bold text-text">알아서 고르기</p>
                      {pickedTemplate === null && <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white text-[13px] font-bold">사용 중</span>}
                    </div>
                    <p className="text-[15px] text-text-muted kr mt-0.5">
                      담긴 상품 수·카테고리·시즌을 보고 매번 가장 어울리는 디자인을 고릅니다
                      {build?.recommended_template ? ` — 지금은 「${templateLabel(build.recommended_template)}」` : ''}
                    </p>
                  </div>
                </div>
              </button>

              <div className="flex items-center justify-between gap-2 px-1 mb-2">
                <p className="text-[14px] font-bold text-text-muted tracking-wider shrink-0">직접 고르기 · {templates.length}종</p>
                <p className="text-[14px] text-text-muted kr truncate">예시 상품으로 그린 모습이에요</p>
              </div>
              {/* 행사 성격 걸러보기 */}
              <div className="flex gap-1.5 overflow-x-auto pb-2 mb-1 -mx-1 px-1">
                {GALLERY_FILTERS.map(f => {
                  const n = f.key === 'all' ? templates.length : templates.filter(t => t.filter === f.key).length;
                  if (n === 0) return null;
                  const on = galleryFilter === f.key;
                  return (
                    <button key={f.key} onClick={() => setGalleryFilter(f.key)}
                      className={`h-8 px-3 rounded-full text-[15px] font-semibold whitespace-nowrap border transition-colors ${
                        on ? 'bg-slate-900 text-white border-slate-900' : 'bg-surface text-text-secondary border-border hover:border-border-strong'
                      }`}>
                      {f.label} <span className={on ? 'text-white/70' : 'text-text-muted'}>{n}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {templates.filter(t => galleryFilter === 'all' || t.filter === galleryFilter).map((t, i) => {
                  const active = pickedTemplate === t.value;
                  const isAiPick = !pickedTemplate && build?.template === t.value;
                  return (
                    <button key={t.value} onClick={() => applyTemplate(t.value)}
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                      className={`rise text-left rounded-2xl overflow-hidden border-2 bg-surface transition-all hover:-translate-y-0.5 ${
                        active ? 'border-slate-900 shadow-elevated' : 'border-border hover:border-border-strong'
                      }`}>
                      {/* ★ 1025 §3-5: 목업으로 실제 그린 썸네일(서버 PNG · 템플릿이 바뀌면 자동 재생성) — 색 견본은 불러오기 전 바탕 */}
                      <div className="relative aspect-[393/560] overflow-hidden" style={{ backgroundImage: t.color }}>
                        <img src={`${API_BASE}/api/flyer/business-types/templates/${t.value}/sample.png`} alt={`${t.label} 예시`}
                          loading="lazy" className="absolute inset-0 w-full h-full object-cover object-top" />
                        {(active || isAiPick) && (
                          <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-[13px] font-bold shadow ${
                            active ? 'bg-slate-900 text-white' : 'bg-emerald-500 text-white'
                          }`}>
                            {active ? '사용 중' : '추천'}
                          </span>
                        )}
                      </div>
                      <div className="px-3 py-2.5 border-t border-border">
                        <p className="text-[16px] font-extrabold text-text truncate">{t.label}</p>
                        {t.scene && <p className="text-[14px] text-text-secondary kr truncate mt-0.5">{t.scene}</p>}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {t.itemRange && <span className="px-1.5 py-0.5 rounded bg-bg text-[13px] font-semibold text-text-secondary">상품 {t.itemRange}</span>}
                          {t.needsPhoto === false && <span className="px-1.5 py-0.5 rounded bg-bg text-[13px] font-semibold text-text-secondary">사진 없어도 됨</span>}
                          {t.needsPhoto && <span className="px-1.5 py-0.5 rounded bg-bg text-[13px] font-semibold text-text-secondary">사진 있으면 좋음</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {templates.length === 0 && (
                <p className="text-[16px] text-text-muted text-center py-10">디자인 목록을 불러오는 중입니다...</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 엑셀 모달(기존 컴포넌트 재사용) ── */}
      <ExcelUploadModal isOpen={sheet === 'excel'} onClose={() => setSheet(null)} onComplete={addFromExcel} />

      {/* ── POP 뽑기 시트 ── */}
      {sheet === 'pop' && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="bg-surface w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl border border-border p-5 space-y-3">
            <p className="text-base font-bold text-text">POP 뽑기</p>
            <p className="text-xs text-text-muted">담긴 상품 그대로 나갑니다. 용도만 고르세요.</p>
            <button onClick={() => popPreset('single')} disabled={popBusy} className="w-full text-left bg-bg rounded-xl px-4 py-3 hover:border-border-strong border border-transparent disabled:opacity-60">
              <p className="text-sm font-bold text-text">대표 상품 A4 한 장</p>
              <p className="text-[11px] text-text-muted mt-0.5">첫 번째 상품이 큼직하게</p>
            </button>
            <button onClick={() => popPreset('split8')} disabled={popBusy} className="w-full text-left bg-bg rounded-xl px-4 py-3 hover:border-border-strong border border-transparent disabled:opacity-60">
              <p className="text-sm font-bold text-text">A4 8분할 세트</p>
              <p className="text-[11px] text-text-muted mt-0.5">담긴 상품 전부, 잘라 쓰는 매대용</p>
            </button>
            <button onClick={() => popPreset('pricecard')} disabled={popBusy} className="w-full text-left bg-bg rounded-xl px-4 py-3 hover:border-border-strong border border-transparent disabled:opacity-60">
              <p className="text-sm font-bold text-text">프라이스카드 (90×55)</p>
              <p className="text-[11px] text-text-muted mt-0.5">가격표 낱장 — A4 한 장에 35칸</p>
            </button>
            <button onClick={() => popPreset('strip')} disabled={popBusy} className="w-full text-left bg-bg rounded-xl px-4 py-3 hover:border-border-strong border border-transparent disabled:opacity-60">
              <p className="text-sm font-bold text-text">매대 띠지</p>
              <p className="text-[11px] text-text-muted mt-0.5">매대 모서리에 붙이는 가로 띠 — A4 한 장에 4줄</p>
            </button>
            {popBusy && <p className="text-xs text-text-secondary text-center">PDF 만드는 중...</p>}
          </div>
        </div>
      )}

      {/* ── 인쇄 관문(§1-5) — 편집이 아니라 발주 확인 ── */}
      {sheet === 'print' && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="bg-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl border border-border max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-border">
              <p className="text-base font-bold text-text">인쇄 전 마지막 확인</p>
              <p className="text-xs text-text-muted mt-0.5">인쇄물은 되돌릴 수 없어요. 이름과 가격만 훑어 주세요.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="grid grid-cols-[1fr_90px_84px] gap-2 px-2 pb-2 text-[11px] font-bold text-text-muted">
                <span>상품명</span><span className="text-right">가격</span><span className="text-right">이미지</span>
              </div>
              {printRows.map((r, i) => (
                <div key={i} className={`grid grid-cols-[1fr_90px_84px] gap-2 items-center px-2 py-2 rounded-lg ${r.diff || items[i]?.priceCheck || !(r.price > 0) ? 'bg-amber-50 border border-amber-300' : ''}`}>
                  <span className="text-[13px] text-text truncate">{r.name}</span>
                  <span className="text-[13px] font-bold text-right tabular-nums text-text">{r.price.toLocaleString()}원{r.diff && <span className="block text-[10px] text-amber-600 font-semibold">원래값과 다름</span>}</span>
                  <span className="text-[11px] text-right text-text-muted">{r.src}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-border space-y-2">
              {priceBlocked.length > 0 && (
                <p className="text-[12px] text-amber-700 font-semibold kr">
                  가격을 확인하지 않은 상품 {priceBlocked.length}개가 있어 인쇄할 수 없어요 — 「{priceBlocked[0].name}」{priceBlocked.length > 1 ? ` 외 ${priceBlocked.length - 1}개` : ''}의 가격을 눌러 고쳐 주세요.
                </p>
              )}
              {hasAutoImage && (
                <label className="flex items-start gap-2 text-[12px] text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={printAgree} onChange={e => setPrintAgree(e.target.checked)} className="mt-0.5 w-4 h-4 accent-slate-900" />
                  자동으로 붙은 이미지가 포함되어 있습니다. 인쇄 전에 위 목록에서 확인했습니다.
                </label>
              )}
              <button className="w-full h-12 rounded-xl btn-ink text-sm" onClick={doPrint} disabled={printBusy || (hasAutoImage && !printAgree) || priceBlocked.length > 0}>
                {printBusy ? '인쇄 PDF 만드는 중...' : '인쇄 PDF 받기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 상품 편집 시트 — 전단에 실리는 정보 전부 한 곳에서 ── */}
      {editPop && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) setEditPop(null); }}>
          <div className="bg-surface w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl border border-border max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <p className="text-base font-bold text-text">상품 정보 수정</p>
              <button onClick={() => setEditPop(null)} className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg transition-colors" aria-label="닫기">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {/* 이미지 */}
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-xl bg-bg border border-border overflow-hidden shrink-0 flex items-center justify-center">
                  {editPop.draft.imageUrl
                    ? <img src={editPop.draft.imageUrl} alt="" className="w-full h-full object-cover" />
                    : <span className="text-[10px] font-bold text-text-muted text-center">사진<br />없음</span>}
                </div>
                <div className="flex-1 space-y-1.5">
                  <div className="flex gap-1.5">
                    <button onClick={() => openPicker([editPop.idx], true)}
                      className="h-8 px-3 rounded-lg btn-ink text-[11px]">
                      사진 고르기
                    </button>
                    {editPop.draft.imageUrl && (
                      <button onClick={() => setDraft({ imageUrl: undefined, imageSource: '없음' })}
                        className="h-8 px-3 rounded-lg btn-quiet text-[11px] !text-text-secondary hover:!text-rose-500">
                        사진 빼기
                      </button>
                    )}
                  </div>
                  {editPop.draft.imageSource && editPop.draft.imageSource !== '없음' && (
                    <p className="text-[10px] text-text-muted">출처: {editPop.draft.imageSource}</p>
                  )}
                </div>
              </div>

              <Input label="상품명" autoFocus value={editPop.draft.name}
                onChange={e => setDraft({ name: e.target.value })}
                placeholder="전단에 보일 이름" />
              <div className="grid grid-cols-2 gap-2">
                <Input label="판매가 (원)" type="number" inputMode="numeric"
                  value={editPop.draft.salePrice > 0 ? String(editPop.draft.salePrice) : ''}
                  onChange={e => setDraft({ salePrice: Number(e.target.value) || 0 })}
                  placeholder="9,900" />
                <Input label="원가 (할인 전, 선택)" type="number" inputMode="numeric"
                  value={editPop.draft.originalPrice > 0 ? String(editPop.draft.originalPrice) : ''}
                  onChange={e => setDraft({ originalPrice: Number(e.target.value) || 0 })}
                  placeholder="원가에 취소선" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input label="규격·단위 (선택)" value={editPop.draft.unit || ''}
                  onChange={e => setDraft({ unit: e.target.value })}
                  placeholder="예: 3kg/박스" />
                <Input label="원산지 (선택)" value={editPop.draft.origin || ''}
                  onChange={e => setDraft({ origin: e.target.value })}
                  placeholder="예: 국내산(청송)" />
              </div>
              <div>
                <Input label="뱃지 (선택)" value={editPop.draft.badge || ''}
                  onChange={e => setDraft({ badge: e.target.value })}
                  placeholder="예: 1+1" />
                <div className="flex gap-1.5 mt-1.5">
                  {['특가', '1+1', '한정수량', '오늘만'].map(b => (
                    <button key={b} onClick={() => setDraft({ badge: editPop.draft.badge === b ? '' : b })}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                        editPop.draft.badge === b
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-surface text-text-secondary border-border hover:border-border-strong'
                      }`}>
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-border flex items-center gap-2">
              <button onClick={() => { removeItem(editPop.idx); setEditPop(null); }}
                className="px-3 py-2 rounded-xl text-[12px] font-semibold text-text-muted hover:text-rose-500">
                이 상품 빼기
              </button>
              <div className="ml-auto flex gap-2">
                <button onClick={() => setEditPop(null)} className="h-10 px-4 rounded-xl btn-quiet text-sm">취소</button>
                <button onClick={applyEdit} disabled={!editPop.draft.name.trim()} className="h-10 px-6 rounded-xl btn-ink text-sm">저장</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 사진 고르기 시트 — 후보 제시 + 사람 탭 1회 확정(자동 부착 아님) ── */}
      {picker && (() => {
        const curIdx = picker.queue[picker.pos];
        const curName = picker.fromSheet ? (editPop?.draft.name || '') : (items[curIdx]?.name || '');
        return (
          <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center"
            onMouseDown={e => { if (e.target === e.currentTarget && !pickerBusy) setPicker(null); }}>
            <div className="bg-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl border border-border max-h-[85vh] flex flex-col">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-bold text-text truncate">사진 고르기 — {curName}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    마음에 드는 사진을 누르면 바로 붙습니다{picker.queue.length > 1 ? ` · ${picker.pos + 1}/${picker.queue.length}` : ''}
                  </p>
                </div>
                <button onClick={() => setPicker(null)} disabled={pickerBusy}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg transition-colors shrink-0" aria-label="닫기">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {pickerNotice && (
                  <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 leading-relaxed kr mb-3">{pickerNotice}</p>
                )}
                {pickerCands === null ? (
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-square rounded-xl bg-bg sheen" />)}
                  </div>
                ) : pickerCands.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {pickerCands.map((c, i) => (
                      <button key={i} onClick={() => pickCandidate(c)} disabled={pickerBusy} title={c.title}
                        className="relative aspect-square rounded-xl overflow-hidden border border-border hover:border-slate-900 transition-colors disabled:opacity-60 bg-bg">
                        <img src={c.image} alt={c.title} className="w-full h-full object-cover" loading="lazy" />
                        {c.match_score >= 1 && (
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-slate-900/85 text-white text-[9px] font-bold">이름 일치</span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-text-muted text-center py-8">보여드릴 후보가 없습니다.</p>
                )}
                {pickerBusy && <p className="text-xs text-text-secondary text-center mt-3">사진을 붙이는 중...</p>}
              </div>

              {picker.queue.length > 1 && (
                <div className="px-4 py-3 border-t border-border flex items-center justify-between">
                  <span className="text-[11px] text-text-muted">마음에 드는 게 없으면 넘어가세요</span>
                  <button onClick={advancePicker} disabled={pickerBusy} className="h-10 px-4 rounded-xl btn-quiet text-sm">
                    {picker.pos + 1 >= picker.queue.length ? '끝내기' : '건너뛰기'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <ConfirmModal show={deleteModal.show}
        title="전단 삭제" message={`"${deleteModal.title}"을(를) 삭제할까요?`} danger confirmLabel="삭제" onConfirm={() => removeFlyer(deleteModal.id)} onCancel={() => setDeleteModal({ show: false, id: '', title: '' })} />
      <Toast show={copyToast} message="주소가 복사되었습니다" />
      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </div>
  );
}

// ── 데이터 헬퍼 ──
function parseCats(raw: any): Array<{ name: string; items: NormItem[] }> {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function flattenCats(cats: Array<{ name: string; items: NormItem[] }>): NormItem[] {
  const out: NormItem[] = [];
  for (const c of cats || []) {
    for (const it of c.items || []) {
      if (!it?.name) continue;
      out.push({
        name: it.name,
        originalPrice: Number(it.originalPrice) || 0,
        salePrice: Number(it.salePrice) || 0,
        badge: it.badge, unit: it.unit, origin: it.origin,
        cardDiscount: it.cardDiscount, aiCopy: it.aiCopy, imageUrl: it.imageUrl,
        sourcePrice: Number(it.salePrice) || 0,
        imageSource: it.imageUrl ? '카탈로그' : '없음',
      });
    }
  }
  return out;
}
