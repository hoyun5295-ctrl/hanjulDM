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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, apiFetch } from '../App';
import AlertModal from '../components/AlertModal';
import { Button, Input, ConfirmModal, Toast } from '../components/ui';
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
interface TemplateInfo { value: string; label: string; desc: string; color: string; }
interface RecentFlyer {
  id: string; title: string; status: string; short_code: string | null;
  period_start: string | null; period_end: string | null;
  categories: any; template: string; created_at: string;
}
type Preset = 'weekly' | 'clearance' | 'seasonal';
type SheetKind = null | 'pos' | 'last' | 'catalog' | 'excel' | 'pop' | 'print';

// ── 날짜 헬퍼: 이번 주 월~일 ──────────────────────────
function thisWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay() || 7; // 월=1 … 일=7
  const mon = new Date(now); mon.setDate(now.getDate() - day + 1);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: f(now), end: f(sun) };
}

export default function FlyerComposerPage({ token: _token, businessType = 'mart' }: { token: string; businessType?: string }) {
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
  const [imageFilling, setImageFilling] = useState(false);

  // 손질 — 상품 편집 시트 하나로(이름·판매가·원가·단위·원산지·뱃지·이미지)
  const [editPop, setEditPop] = useState<{ idx: number; draft: NormItem } | null>(null);
  const [editImageBusy, setEditImageBusy] = useState(false);

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
    for (const p of products) {
      const nm = String(p.productName || (p as any).name || '').trim();
      if (!nm) { skipped++; continue; }
      if (next.some(x => x.name === nm)) { skipped++; continue; }
      const img = String(p.imageUrl || '').trim();
      next.push({
        name: nm,
        originalPrice: Number(p.originalPrice) || 0,
        salePrice: Number(p.salePrice) || 0,
        sourcePrice: Number(p.salePrice) || 0,
        unit: p.unit || undefined,
        origin: p.origin || undefined,
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

  // ── 상품 이미지 한 번에 채우기 (네이버 쇼핑 · 게이트 통과분만 · 로컬 저장본) ──
  const fillImages = async () => {
    const targets = items.map((it, i) => ({ index: i, name: it.name })).filter((t, i) => !items[i].imageUrl && t.name);
    if (targets.length === 0) return;
    setImageFilling(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/auto-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: targets }),
      });
      const d = await res.json();
      if (!res.ok) {
        setAlert({ show: true, title: '이미지 채우기 실패', message: d.error || '잠시 후 다시 시도해 주세요.', type: 'error' });
        return;
      }
      const next = [...items];
      for (const f of (d.filled || [])) {
        // 출처를 '네이버'로 남긴다 — 인쇄 관문의 자동 이미지 동의 체크가 이 값으로 걸린다
        if (next[f.index]) next[f.index] = { ...next[f.index], imageUrl: f.imageUrl, imageSource: '네이버' };
      }
      setItemsAndBuild(next);

      const filledN = (d.filled || []).length;
      const quota = d.quota_exhausted;
      setAlert({
        show: true,
        title: filledN > 0 ? `이미지 ${filledN}건 채웠습니다` : '채운 이미지가 없습니다',
        type: filledN > 0 ? 'success' : 'error',
        message: [
          filledN > 0 ? `상품 ${targets.length}개 중 ${filledN}개에 이미지를 붙였습니다.` : `상품 ${targets.length}개에서 확실한 이미지를 찾지 못했습니다.`,
          (d.missed || []).length > 0 && !quota ? '못 찾은 상품은 이름이 짧거나 규격이 특이한 경우입니다. 카탈로그에 직접 올리면 다음부터 자동으로 붙습니다.' : '',
          quota ? '오늘 이미지 검색 한도를 다 써서 나머지는 건너뛰었습니다. 내일 다시 시도해 주세요.' : '',
        ].filter(Boolean).join('\n'),
      });
    } catch {
      setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' });
    } finally {
      setImageFilling(false);
    }
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
    } : it));
    setEditPop(null); setItemsAndBuild(next);
  };
  // 편집 시트 안 단건 이미지 찾기 — auto-images 재사용(신뢰도 게이트·로컬 저장·네이버 출처 표기 그대로)
  const findOneImage = async () => {
    if (!editPop || editImageBusy) return;
    const nm = editPop.draft.name.trim();
    if (!nm) return;
    setEditImageBusy(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/auto-images`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: [{ index: 0, name: nm }] }),
      });
      const d = await res.json();
      const hit = res.ok ? (d.filled || [])[0] : null;
      if (hit) {
        setDraft({ imageUrl: hit.imageUrl, imageSource: '네이버' });
      } else {
        setAlert({
          show: true, title: '이미지를 찾지 못했습니다', type: 'error',
          message: d?.quota_exhausted
            ? '오늘 이미지 검색 한도를 다 썼습니다. 내일 다시 시도해 주세요.'
            : '확실히 일치하는 이미지가 없습니다. 카탈로그에 직접 올리면 다음부터 자동으로 붙습니다.',
        });
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' });
    } finally { setEditImageBusy(false); }
  };
  const reroll = () => {
    const nextSeed = (seed ?? (build?.design_variant?.variantSeed ?? 0)) + 1;
    setSeed(nextSeed);
    requestBuild(items, nextSeed);
  };

  // ── 발행(1버튼 + 쿠폰 토글) ──
  const publish = async () => {
    if (!build || items.length === 0 || publishing) return;
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
          return;
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
    } catch (e: any) {
      setAlert({ show: true, title: '오류', message: e?.message || '발행에 실패했습니다.', type: 'error' });
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
  const doPrint = async () => {
    if (printBusy) return;
    if (hasAutoImage && !printAgree) return;
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
  if (view === 'home') {
    const publishedCount = recent.filter(r => r.status === 'published').length;
    return (
      <div className="max-w-5xl mx-auto space-y-7">

        {/* ══ 히어로 ══ */}
        <section className="relative overflow-hidden rounded-3xl border border-border bg-surface rise">
          <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-brand-500/15 blur-3xl" />
          <div className="absolute -bottom-28 -left-10 w-64 h-64 rounded-full bg-primary-500/10 blur-3xl" />
          <div className="relative px-6 sm:px-9 py-8 sm:py-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 text-white text-[11px] font-bold tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
                자동 완성
              </span>
              <span className="text-[11px] text-text-muted">담는 순간 완성본이 섭니다</span>
            </div>

            <h1 className="font-poster text-[38px] sm:text-[52px] leading-[1.05] kr text-text">
              오늘 뭐 파실래요?
            </h1>
            <p className="mt-3 text-[15px] text-text-secondary kr max-w-lg">
              상품만 담으면 전단·POP·인쇄물이 한 번에 나옵니다. 편집은 필요 없습니다.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button onClick={() => startPreset('weekly')}
                className="px-6 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold shadow-elevated hover:bg-slate-800 transition-colors">
                바로 시작하기
              </button>
              <button onClick={() => { setView('compose'); openSheet('pos'); }}
                className="px-4 py-3 rounded-2xl bg-surface border border-border text-sm font-semibold text-text hover:border-brand-500 transition-colors">
                POS 인기 상품으로
              </button>
              <button onClick={() => { setView('compose'); openSheet('excel'); }}
                className="px-4 py-3 rounded-2xl bg-surface border border-border text-sm font-semibold text-text hover:border-brand-500 transition-colors">
                엑셀 올리기
              </button>
            </div>

            <div className="mt-7 flex flex-wrap gap-x-7 gap-y-2">
              {[
                { n: String(templates.length || 10), u: '종', l: '전단 디자인' },
                { n: '4', u: '종', l: 'POP·가격표' },
                { n: '5', u: '종', l: '인쇄 전단' },
                { n: String(recent.length), u: '건', l: publishedCount ? `만든 전단 · 발행 ${publishedCount}` : '만든 전단' },
              ].map(m => (
                <div key={m.l}>
                  <p className="font-poster text-2xl text-text leading-none">
                    {m.n}<span className="text-sm text-text-muted ml-0.5">{m.u}</span>
                  </p>
                  <p className="text-[11px] text-text-muted mt-1">{m.l}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ 3 프리셋 ══ */}
        <section>
          <div className="flex items-end justify-between mb-3">
            <h2 className="text-base font-extrabold text-text">무엇부터 만들까요</h2>
            <span className="text-[11px] text-text-muted">클릭 한 번이면 상품 담기로 넘어갑니다</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              { key: 'weekly' as Preset, tag: '주간', title: '이번 주 행사',
                hint: recent.length > 0 ? '지난 전단 그대로, 가격만 새로' : '이번 주 상품으로 새로 만들기',
                meta: '가장 많이 쓰는 방식', bg: 'linear-gradient(135deg,#F97316,#E11D48)' },
              { key: 'clearance' as Preset, tag: '오늘', title: '오늘 급처분',
                hint: '상품 하나면 끝. POP까지 같이',
                meta: '30초 컷', bg: 'linear-gradient(135deg,#0F172A,#334155)' },
              { key: 'seasonal' as Preset, tag: '대목', title: '명절 대목',
                hint: '명절 톤으로, 인쇄까지 한 번에',
                meta: '인쇄 발주 연결', bg: 'linear-gradient(135deg,#B91C1C,#D97706)' },
            ]).map((c, i) => (
              <button key={c.key} onClick={() => startPreset(c.key)}
                style={{ backgroundImage: c.bg, animationDelay: `${i * 70}ms` }}
                className="rise group relative overflow-hidden text-left rounded-2xl p-5 min-h-[168px] flex flex-col justify-between text-white shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all">
                <span className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/10 group-hover:scale-125 transition-transform" />
                <span className="relative inline-flex self-start px-2 py-0.5 rounded-md bg-white/20 text-[10px] font-bold tracking-wider">{c.tag}</span>
                <span className="relative block">
                  <span className="block font-poster text-2xl leading-tight">{c.title}</span>
                  <span className="block text-[12px] mt-1.5 text-white/85 kr leading-snug">{c.hint}</span>
                </span>
                <span className="relative flex items-center gap-1.5 text-[11px] text-white/70">
                  <span className="w-1 h-1 rounded-full bg-white/70" />{c.meta}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ══ 만들어지는 방식 ══ */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          {/* 화살표를 칸 안에 absolute 로 띄우면 글줄을 덮는다 — 제 칸을 가진 flex 아이템으로 둔다 */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-0">
            {[
              { n: '01', t: '상품을 담는다', d: 'POS 인기·지난 전단·카탈로그·엑셀에서 체크만' },
              { n: '02', t: '알아서 구성된다', d: '분류·디자인·시즌 톤까지 자동 구성' },
              { n: '03', t: '뽑아 쓴다', d: '전단 URL·POP·인쇄물·문자 발송까지' },
            ].map((st, i) => (
              <Fragment key={st.n}>
                <div className="flex-1 min-w-0 flex gap-3">
                  <span className="font-poster text-2xl text-brand-500/70 leading-none shrink-0">{st.n}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-text">{st.t}</p>
                    <p className="text-[12px] text-text-muted kr mt-0.5 leading-snug">{st.d}</p>
                  </div>
                </div>
                {i < 2 && (
                  <div className="hidden sm:flex items-center justify-center w-10 shrink-0" aria-hidden="true">
                    <svg width="18" height="8" viewBox="0 0 18 8" fill="none" className="text-border-strong">
                      <path d="M0 4h15M12 1l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </section>

        {/* ══ 최근 전단 ══ */}
        <section>
          <div className="flex items-end justify-between mb-3">
            <h2 className="text-base font-extrabold text-text">최근 전단</h2>
            {recent.length > 0 && <span className="text-[11px] text-text-muted">누르면 그대로 이어서 만듭니다</span>}
          </div>
          {recent.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-8 text-center">
              <p className="font-poster text-xl text-text-muted">아직 만든 전단이 없습니다</p>
              <p className="text-[12px] text-text-muted mt-1.5 kr">위에서 하나 고르면 몇 분 안에 첫 전단이 나옵니다.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {recent.map(f => (
                <div key={f.id} className="group rounded-2xl border border-border bg-surface p-4 hover:border-brand-500/60 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-14 rounded-lg bg-bg border border-border flex items-center justify-center shrink-0">
                      <span className="font-poster text-[11px] text-text-muted leading-none">전단</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-text truncate">{f.title}</p>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${f.status === 'published' ? 'bg-success-50 text-success-600' : 'bg-bg text-text-muted'}`}>
                          {f.status === 'published' ? '발행됨' : '초안'}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-muted mt-0.5">{String(f.created_at).slice(0, 10)}</p>
                      <div className="flex items-center gap-1.5 mt-2.5">
                        <button onClick={() => openAsBase(f)} className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 transition-colors">
                          {f.status === 'published' ? '이걸로 새로' : '이어 만들기'}
                        </button>
                        {f.short_code && (
                          <button onClick={() => copyUrl(f.short_code!)} className="px-2.5 py-1.5 rounded-lg bg-surface border border-border text-[11px] text-text-secondary hover:text-text">URL 복사</button>
                        )}
                        <button onClick={() => setDeleteModal({ show: true, id: f.id, title: f.title })} className="ml-auto px-2 py-1.5 rounded-lg text-[11px] text-text-muted hover:text-error-500">삭제</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <ConfirmModal show={deleteModal.show} icon="🗑️" title="전단지 삭제" message={`"${deleteModal.title}"을(를) 삭제하시겠습니까?`} danger confirmLabel="삭제" onConfirm={() => removeFlyer(deleteModal.id)} onCancel={() => setDeleteModal({ show: false, id: '', title: '' })} />
        <Toast show={copyToast} message="URL이 복사되었습니다" />
        <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
      </div>
    );
  }

  // ── compose ──
  const previewCategories = build?.categories?.length ? build.categories : (items.length ? [{ name: '상품', items }] : []);
  const templateLabel = (code?: string) =>
    templates.find(t => t.value === code)?.label || code || '자동';
  const noImageCount = items.filter(it => !it.imageUrl).length;
  const applyTemplate = (code: string | null) => {
    setPickedTemplate(code);
    setGalleryOpen(false);
    setPublished(null); // 디자인이 바뀌면 앞서 발행한 결과는 과거다
    if (items.length > 0) requestBuild(items, seed, code);
  };
  return (
    <div className="max-w-5xl mx-auto pb-24">
      {/* ══ 상단 툴바 — 돌아가기 + 상품 담기 4소스 ══ */}
      <div className="sticky top-14 z-30 -mx-4 px-4 py-3 mb-4 bg-bg/90 backdrop-blur border-b border-border">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setView('home')} className="w-9 h-9 rounded-xl bg-surface border border-border text-text-secondary hover:text-text hover:border-border-strong transition-colors" aria-label="처음으로">←</button>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-text-muted mr-0.5">상품 담기</span>
            {([
              { k: 'pos' as SheetKind, label: 'POS 인기' },
              { k: 'last' as SheetKind, label: '지난 전단' },
              { k: 'catalog' as SheetKind, label: '카탈로그' },
              { k: 'excel' as SheetKind, label: '엑셀' },
            ]).map(c => (
              <button key={String(c.k)} onClick={() => openSheet(c.k)}
                className="px-3 py-2 rounded-full bg-surface border border-border text-[13px] font-semibold text-text hover:border-brand-500 hover:text-brand-600 transition-colors">
                {c.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {items.length > 0 && (
              <span className="text-[12px] text-text-muted tabular-nums">담긴 상품 <b className="text-text">{items.length}</b></span>
            )}
            {build && (
              <button onClick={reroll} disabled={building}
                className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-[13px] font-bold hover:bg-slate-800 disabled:opacity-60 transition-colors">
                {building ? '만드는 중...' : '다른 느낌으로'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* 좌: 미리보기 = 발행본 */}
        <div>
          {/* 상태 바 — 결과물이 주인공, 상태는 한 줄로 조용히 */}
          <div className="rounded-t-2xl border border-b-0 border-border bg-surface px-4 py-2.5 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-text">
              <span className={`w-1.5 h-1.5 rounded-full ${building ? 'bg-amber-500 pulse-dot' : build ? 'bg-emerald-500' : 'bg-border-strong'}`} />
              {building ? '전단을 만드는 중' : build ? '전단 완성' : '상품을 기다리는 중'}
            </span>
            {build && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg border border-border text-[11px] font-bold text-text">
                {templateLabel(build.template)}
                <span className="text-[10px] font-semibold text-text-muted">{build.picked ? '직접 고름' : '추천'}</span>
              </span>
            )}
            <button onClick={() => setGalleryOpen(true)}
              className="ml-auto px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 transition-colors">
              디자인 바꾸기 {templates.length > 0 ? `(${templates.length})` : ''}
            </button>
          </div>

          {/* 종이 — 전단은 모바일 393px 기준이라 그 폭 그대로 세우고 바닥을 깐다 */}
          <div className="rounded-b-2xl border border-border bg-bg p-4 paper">
            <div className="relative h-[560px] w-full max-w-[393px] mx-auto rounded-xl overflow-hidden bg-surface border border-border shadow-elevated">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <div className="w-16 h-20 rounded-lg border-2 border-dashed border-border-strong flex items-center justify-center">
                    <span className="font-poster text-[11px] text-text-muted">전단</span>
                  </div>
                  <p className="font-poster text-lg text-text">상품을 담아 주세요</p>
                  <p className="text-[12px] text-text-muted kr max-w-[240px]">담는 순간 분류·디자인·시즌 톤까지 정해진 완성본이 섭니다.</p>
                  <button onClick={() => openSheet('pos')} className="mt-1 px-4 py-2 rounded-xl bg-slate-900 text-white text-[12px] font-bold">POS 인기 상품에서 담기</button>
                </div>
              ) : (
                <>
                  <FlyerPreview
                    title={title} storeName={storeName}
                    periodStart={periodStart} periodEnd={periodEnd}
                    categories={previewCategories as any}
                    template={build?.template || 'grid_hero'}
                    designVariant={build?.design_variant || null}
                  />
                  {building && (
                    <div className="absolute inset-x-0 top-0 h-1 sheen bg-border" />
                  )}
                </>
              )}
            </div>
            <p className="text-[10px] text-text-muted italic mt-2 text-center">
              이 미리보기가 그대로 발행됩니다 — 발행본과 동일한 서버 렌더
            </p>
          </div>
        </div>

        {/* 우: 행사 정보 + 담긴 상품 + 발행 */}
        <div className="space-y-3">
          <div className="bg-surface rounded-2xl border border-border p-4 space-y-2.5">
            <p className="text-[11px] font-bold text-text-muted tracking-wider">행사 정보</p>
            <Input label="행사 이름" value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 이번 주 행사" />
            <Input label="매장 이름" value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="전단에 표시됩니다" />
            <div className="grid grid-cols-2 gap-2">
              <Input label="시작일" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              <Input label="종료일" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          <div className="bg-surface rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between mb-2 gap-2">
              <p className="text-sm font-bold text-text">담긴 상품 <span className="text-text-muted">{items.length}</span></p>
              {noImageCount > 0 && (
                <button onClick={fillImages} disabled={imageFilling}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 disabled:opacity-60 transition-colors shrink-0">
                  {imageFilling ? '이미지 찾는 중...' : `이미지 한 번에 채우기 (${noImageCount})`}
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-text-muted py-6 text-center">위의 칩에서 상품을 담아 주세요.<br />담는 순간 전단이 만들어집니다.</p>
            ) : (
              <>
                <p className="text-[11px] text-text-muted mb-2">상품을 누르면 이름·가격·원산지·이미지를 고칠 수 있습니다</p>
                <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
                  {items.map((it, i) => (
                    <div key={`${it.name}-${i}`} className="flex items-center gap-2.5 bg-bg rounded-xl px-2 py-1.5 border border-transparent hover:border-border-strong transition-colors">
                      <button onClick={() => openEdit(i)} className="w-10 h-10 rounded-lg bg-surface border border-border overflow-hidden shrink-0 flex items-center justify-center" aria-label="상품 수정">
                        {it.imageUrl
                          ? <img src={it.imageUrl} alt="" className="w-full h-full object-cover" />
                          : <span className="text-[9px] font-bold text-text-muted">사진<br />없음</span>}
                      </button>
                      <button onClick={() => openEdit(i)} className="flex-1 min-w-0 text-left">
                        <p className="text-[13px] font-semibold text-text truncate">{it.name}</p>
                        <p className="text-[11px] text-text-muted truncate">
                          {[it.origin, it.unit, it.badge].filter(Boolean).join(' · ') || '정보 추가하기'}
                        </p>
                      </button>
                      <button onClick={() => openEdit(i)} className="text-right shrink-0 tabular-nums" aria-label="가격 수정">
                        {it.originalPrice > it.salePrice && (
                          <p className="text-[10px] text-text-muted line-through leading-tight">{it.originalPrice.toLocaleString()}원</p>
                        )}
                        <p className={`text-[13px] font-extrabold leading-tight ${it.salePrice > 0 ? 'text-text' : 'text-brand-600'}`}>
                          {it.salePrice > 0 ? `${it.salePrice.toLocaleString()}원` : '가격 입력'}
                        </p>
                      </button>
                      <button onClick={() => openEdit(i)} className="p-1 text-text-muted hover:text-text shrink-0" aria-label="정보 수정">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
                      </button>
                      <button onClick={() => removeItem(i)} className="text-text-muted hover:text-rose-500 px-1 shrink-0" aria-label="빼기">×</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 발행 카드 */}
          <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-text">QR 쿠폰 넣기</p>
              <button onClick={() => setCouponEnabled(!couponEnabled)} className={`w-11 h-6 rounded-full transition-colors relative ${couponEnabled ? 'bg-primary-600' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${couponEnabled ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
            {couponEnabled && (
              <div className="space-y-2">
                <Input value={couponForm.coupon_name} onChange={e => setCouponForm({ ...couponForm, coupon_name: e.target.value })} placeholder="쿠폰명 (예: 5,000원 할인)" />
                <div className="grid grid-cols-2 gap-2">
                  <select className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text" value={couponForm.coupon_type} onChange={e => setCouponForm({ ...couponForm, coupon_type: e.target.value })}>
                    <option value="fixed">정액 (원)</option>
                    <option value="percent">퍼센트 (%)</option>
                  </select>
                  <Input type="number" value={couponForm.discount_value} onChange={e => setCouponForm({ ...couponForm, discount_value: e.target.value })} placeholder="할인값" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 하단 고정 바 — 발행 1버튼 + POP·인쇄 뽑기 */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur border-t border-border shadow-card">
        <div className="max-w-5xl mx-auto flex items-center gap-2 px-4 py-3">
          {published ? (
            <>
              <button onClick={() => copyUrl(published.short_code)} className="flex-1 min-h-[46px] rounded-xl bg-emerald-600 text-white text-sm font-bold">
                발행 완료 · URL 복사 ({published.short_url.replace('https://', '')})
              </button>
              <Button variant="secondary" onClick={() => setSheet('pop')}>POP 뽑기</Button>
              <Button variant="secondary" onClick={() => { setSheet('print'); setPrintAgree(false); }}>인쇄 뽑기</Button>
            </>
          ) : (
            <>
              <Button className="flex-1 min-h-[46px]" onClick={publish} disabled={publishing || !build || items.length === 0}>
                {publishing ? '발행 중...' : couponEnabled ? '발행하기 (쿠폰 포함)' : '발행하기'}
              </Button>
              <Button variant="secondary" onClick={() => setSheet('pop')} disabled={items.length === 0}>POP 뽑기</Button>
              <Button variant="secondary" onClick={() => { setSheet('print'); setPrintAgree(false); }} disabled={items.length === 0}>인쇄 뽑기</Button>
            </>
          )}
        </div>
      </div>

      {/* ── 바텀시트: 소스 선택(체크만) ── */}
      {(sheet === 'pos' || sheet === 'catalog' || sheet === 'last') && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="bg-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl border border-border max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <p className="text-base font-bold text-text">
                {sheet === 'pos' ? '요즘 잘 팔리는 상품' : sheet === 'catalog' ? '카탈로그에서 담기' : '지난 전단에서 가져오기'}
              </p>
              <button onClick={() => setSheet(null)} className="text-text-muted hover:text-text px-2">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {sheetLoading ? (
                <p className="text-sm text-text-muted text-center py-10">불러오는 중...</p>
              ) : sheet === 'pos' ? (
                posProducts.length === 0 ? <p className="text-sm text-text-muted text-center py-10">POS 판매 데이터가 아직 없어요.<br />POS Agent를 연결하면 여기에 인기 상품이 뜹니다.</p> :
                posProducts.map((p, i) => (
                  <label key={i} className="flex items-center gap-3 bg-bg rounded-xl px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={!!sheetChecked[`pos-${i}`]} onChange={e => setSheetChecked({ ...sheetChecked, [`pos-${i}`]: e.target.checked })} className="w-4 h-4 accent-primary-600" />
                    <span className="flex-1 text-sm text-text truncate">{p.product_name}</span>
                    <span className="text-[11px] text-text-muted">{Number(p.total_qty) || 0}개 판매</span>
                    <span className="text-[13px] font-extrabold text-text tabular-nums">{(Number(p.avg_price) || 0).toLocaleString()}원</span>
                  </label>
                ))
              ) : sheet === 'catalog' ? (
                catalogItems.length === 0 ? <p className="text-sm text-text-muted text-center py-10">카탈로그가 비어 있어요.<br />상품관리에서 등록하거나 엑셀로 올려 주세요.</p> :
                catalogItems.map((c, i) => (
                  <label key={i} className="flex items-center gap-3 bg-bg rounded-xl px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={!!sheetChecked[`cat-${i}`]} onChange={e => setSheetChecked({ ...sheetChecked, [`cat-${i}`]: e.target.checked })} className="w-4 h-4 accent-primary-600" />
                    <span className="flex-1 text-sm text-text truncate">{c.product_name || c.name}</span>
                    <span className="text-[13px] font-extrabold text-text tabular-nums">{(Number(c.sale_price ?? c.price) || 0).toLocaleString()}원</span>
                  </label>
                ))
              ) : (
                recent.length === 0 ? <p className="text-sm text-text-muted text-center py-10">지난 전단이 아직 없어요.</p> :
                recent.map(f => (
                  <button key={f.id} onClick={() => addFromLast(f)} className="w-full flex items-center gap-3 bg-bg rounded-xl px-3 py-2.5 text-left hover:border-primary-300 border border-transparent">
                    <span className="flex-1 text-sm text-text truncate">{f.title}</span>
                    <span className="text-[11px] text-text-muted">{String(f.created_at).slice(0, 10)}</span>
                    <span className="text-[12px] text-primary-600 font-semibold">상품 가져오기</span>
                  </button>
                ))
              )}
            </div>
            {(sheet === 'pos' || sheet === 'catalog') && (
              <div className="px-4 py-3 border-t border-border">
                <Button className="w-full min-h-[46px]" onClick={sheet === 'pos' ? addFromPos : addFromCatalog}
                  disabled={!Object.values(sheetChecked).some(Boolean)}>
                  담기
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ 디자인 갤러리 — 엔진에 살아 있는 전 템플릿을 눈으로 고른다 ══ */}
      {galleryOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onMouseDown={e => { if (e.target === e.currentTarget) setGalleryOpen(false); }}>
          <div className="bg-bg w-full sm:max-w-3xl sm:rounded-3xl rounded-t-3xl border border-border max-h-[86vh] flex flex-col overflow-hidden">
            <div className="px-6 py-5 bg-surface border-b border-border">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-poster text-2xl text-text leading-tight">디자인 고르기</p>
                  <p className="text-[12px] text-text-muted mt-1 kr">
                    누르면 바로 그 디자인으로 다시 섭니다. 담긴 상품은 그대로예요.
                  </p>
                </div>
                <button onClick={() => setGalleryOpen(false)} className="w-9 h-9 rounded-xl bg-bg border border-border text-text-muted hover:text-text shrink-0" aria-label="닫기">✕</button>
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
                      <p className="text-sm font-bold text-text">알아서 고르기</p>
                      {pickedTemplate === null && <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-bold">사용 중</span>}
                    </div>
                    <p className="text-[12px] text-text-muted kr mt-0.5">
                      담긴 상품 수·카테고리·시즌을 보고 매번 가장 어울리는 디자인을 고릅니다
                      {build?.recommended_template ? ` — 지금은 「${templateLabel(build.recommended_template)}」` : ''}
                    </p>
                  </div>
                </div>
              </button>

              <p className="text-[11px] font-bold text-text-muted tracking-wider px-1 mb-2">직접 고르기 · {templates.length}종</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {templates.map((t, i) => {
                  const active = pickedTemplate === t.value;
                  const isAiPick = !pickedTemplate && build?.template === t.value;
                  return (
                    <button key={t.value} onClick={() => applyTemplate(t.value)}
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                      className={`rise text-left rounded-2xl overflow-hidden border-2 transition-all hover:-translate-y-0.5 ${
                        active ? 'border-slate-900 shadow-elevated' : 'border-border hover:border-border-strong'
                      }`}>
                      {/* 색 견본 — 레지스트리 gradient 그대로 */}
                      <div className="h-20 relative" style={{ backgroundImage: t.color }}>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="font-poster text-white/95 text-lg drop-shadow">{t.label}</span>
                        </div>
                        {(active || isAiPick) && (
                          <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            active ? 'bg-white text-slate-900' : 'bg-emerald-500 text-white'
                          }`}>
                            {active ? '사용 중' : '추천'}
                          </span>
                        )}
                      </div>
                      <div className="px-3.5 py-3 bg-surface">
                        <p className="text-[12px] text-text-secondary kr leading-snug">{t.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {templates.length === 0 && (
                <p className="text-sm text-text-muted text-center py-10">디자인 목록을 불러오는 중입니다...</p>
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
            <button onClick={() => popPreset('single')} disabled={popBusy} className="w-full text-left bg-bg rounded-xl px-4 py-3 hover:border-primary-300 border border-transparent disabled:opacity-60">
              <p className="text-sm font-bold text-text">대표 상품 A4 한 장</p>
              <p className="text-[11px] text-text-muted mt-0.5">첫 번째 상품이 큼직하게</p>
            </button>
            <button onClick={() => popPreset('split8')} disabled={popBusy} className="w-full text-left bg-bg rounded-xl px-4 py-3 hover:border-primary-300 border border-transparent disabled:opacity-60">
              <p className="text-sm font-bold text-text">A4 8분할 세트</p>
              <p className="text-[11px] text-text-muted mt-0.5">담긴 상품 전부, 잘라 쓰는 매대용</p>
            </button>
            <button onClick={() => popPreset('pricecard')} disabled={popBusy} className="w-full text-left bg-bg rounded-xl px-4 py-3 hover:border-primary-300 border border-transparent disabled:opacity-60">
              <p className="text-sm font-bold text-text">프라이스카드 (90×55)</p>
              <p className="text-[11px] text-text-muted mt-0.5">가격표 낱장 — A4 한 장에 35칸</p>
            </button>
            <button onClick={() => popPreset('strip')} disabled={popBusy} className="w-full text-left bg-bg rounded-xl px-4 py-3 hover:border-primary-300 border border-transparent disabled:opacity-60">
              <p className="text-sm font-bold text-text">매대 띠지</p>
              <p className="text-[11px] text-text-muted mt-0.5">매대 모서리에 붙이는 가로 띠 — A4 한 장에 4줄</p>
            </button>
            {popBusy && <p className="text-xs text-primary-600 text-center">PDF 만드는 중...</p>}
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
                <div key={i} className={`grid grid-cols-[1fr_90px_84px] gap-2 items-center px-2 py-2 rounded-lg ${r.diff ? 'bg-amber-50 border border-amber-300' : ''}`}>
                  <span className="text-[13px] text-text truncate">{r.name}</span>
                  <span className="text-[13px] font-bold text-right tabular-nums text-text">{r.price.toLocaleString()}원{r.diff && <span className="block text-[10px] text-amber-600 font-semibold">원래값과 다름</span>}</span>
                  <span className="text-[11px] text-right text-text-muted">{r.src}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-border space-y-2">
              {hasAutoImage && (
                <label className="flex items-start gap-2 text-[12px] text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={printAgree} onChange={e => setPrintAgree(e.target.checked)} className="mt-0.5 w-4 h-4 accent-primary-600" />
                  자동으로 붙은 이미지가 포함되어 있습니다. 인쇄 전에 위 목록에서 확인했습니다.
                </label>
              )}
              <Button className="w-full min-h-[46px]" onClick={doPrint} disabled={printBusy || (hasAutoImage && !printAgree)}>
                {printBusy ? '인쇄 PDF 만드는 중...' : '인쇄 PDF 받기'}
              </Button>
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
              <button onClick={() => setEditPop(null)} className="text-text-muted hover:text-text px-2" aria-label="닫기">✕</button>
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
                    <button onClick={findOneImage} disabled={editImageBusy}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 disabled:opacity-60 transition-colors">
                      {editImageBusy ? '찾는 중...' : '이미지 자동 찾기'}
                    </button>
                    {editPop.draft.imageUrl && (
                      <button onClick={() => setDraft({ imageUrl: undefined, imageSource: '없음' })}
                        className="px-3 py-1.5 rounded-lg bg-surface border border-border text-[11px] font-semibold text-text-secondary hover:text-rose-500">
                        이미지 빼기
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
                <Button variant="secondary" onClick={() => setEditPop(null)}>취소</Button>
                <Button onClick={applyEdit} disabled={!editPop.draft.name.trim()}>저장</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Toast show={copyToast} message="URL이 복사되었습니다" />
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
