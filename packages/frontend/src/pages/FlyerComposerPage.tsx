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
  imageSource?: '카탈로그' | 'POS' | '기본 자산' | '없음';
}
interface AutoBuild {
  template: string;
  season_token: string;
  reasons: string[];
  design_variant: any;
  categories: Array<{ name: string; items: NormItem[] }>;
}
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

  // 손질
  const [pricePop, setPricePop] = useState<{ idx: number; value: string } | null>(null);
  const [namePop, setNamePop] = useState<{ idx: number; value: string } | null>(null);

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

  // ── 자동 완성: 담긴 상품이 바뀌면 서버가 구성한다(분류·엔진·변형 판정 전부 서버 — 화면 판정 0) ──
  const requestBuild = useCallback((nextItems: NormItem[], nextSeed: number | null) => {
    if (buildTimer.current) window.clearTimeout(buildTimer.current);
    if (nextItems.length === 0) { setBuild(null); return; }
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
  }, [title, storeName, periodStart, periodEnd, businessType]);

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
    const next = [...items];
    for (const p of products) {
      const nm = String((p as any).name || '').trim();
      if (!nm || next.some(x => x.name === nm)) continue;
      next.push({
        name: nm,
        originalPrice: Number((p as any).originalPrice) || 0,
        salePrice: Number((p as any).salePrice) || 0,
        sourcePrice: Number((p as any).salePrice) || 0,
        unit: (p as any).unit || undefined,
        origin: (p as any).origin || undefined,
        badge: (p as any).badge || undefined,
        imageSource: '없음',
      });
    }
    setSheet(null); setItemsAndBuild(next);
  };

  // ── 손질 4종 ──
  const removeItem = (idx: number) => setItemsAndBuild(items.filter((_, i) => i !== idx));
  const applyPrice = () => {
    if (!pricePop) return;
    const v = Math.max(0, Math.floor(Number(pricePop.value) || 0));
    const next = items.map((it, i) => (i === pricePop.idx ? { ...it, salePrice: v } : it));
    setPricePop(null); setItemsAndBuild(next);
  };
  const applyName = () => {
    if (!namePop) return;
    const nm = namePop.value.trim();
    if (!nm) { setNamePop(null); return; }
    const next = items.map((it, i) => (i === namePop.idx ? { ...it, name: nm } : it));
    setNamePop(null); setItemsAndBuild(next);
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
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-extrabold text-text">오늘 뭐 하실래요?</h2>
          <p className="text-sm text-text-muted mt-1">상품만 담으면 전단이 완성됩니다. 편집은 필요 없어요.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button onClick={() => startPreset('weekly')} className="text-left rounded-2xl p-5 bg-gradient-to-br from-orange-500/90 to-rose-500/90 text-white shadow-lg hover:shadow-xl transition-all">
            <p className="text-lg font-extrabold">이번 주 행사</p>
            <p className="text-xs mt-1 opacity-90">{recent.length > 0 ? '지난 전단 그대로, 가격만 바꿔서' : '이번 주 상품으로 새로 만들기'}</p>
          </button>
          <button onClick={() => startPreset('clearance')} className="text-left rounded-2xl p-5 bg-gradient-to-br from-slate-800 to-slate-900 text-white shadow-lg hover:shadow-xl transition-all">
            <p className="text-lg font-extrabold">오늘 급처분</p>
            <p className="text-xs mt-1 opacity-80">상품 1개 + 가격 하나면 끝. POP과 전단이 같이 나와요</p>
          </button>
          <button onClick={() => startPreset('seasonal')} className="text-left rounded-2xl p-5 bg-gradient-to-br from-red-700 to-amber-600 text-white shadow-lg hover:shadow-xl transition-all">
            <p className="text-lg font-extrabold">명절 대목</p>
            <p className="text-xs mt-1 opacity-90">명절 분위기로, 인쇄 전단까지 한 번에</p>
          </button>
        </div>

        {recent.length > 0 && (
          <div className="bg-surface rounded-2xl border border-border p-4">
            <p className="text-sm font-bold text-text mb-3">최근 전단</p>
            <div className="space-y-2">
              {recent.map(f => (
                <div key={f.id} className="flex items-center gap-3 bg-bg rounded-xl px-3 py-2.5">
                  <button onClick={() => openAsBase(f)} className="flex-1 text-left min-w-0">
                    <p className="text-sm font-semibold text-text truncate">{f.title}</p>
                    <p className="text-[11px] text-text-muted">{f.status === 'published' ? '발행됨' : '초안'} · {String(f.created_at).slice(0, 10)}</p>
                  </button>
                  {f.short_code && (
                    <button onClick={() => copyUrl(f.short_code!)} className="text-[11px] px-2.5 py-1.5 rounded-lg bg-surface border border-border text-text-secondary hover:text-text">URL 복사</button>
                  )}
                  <button onClick={() => openAsBase(f)} className="text-[11px] px-2.5 py-1.5 rounded-lg bg-surface border border-border text-text-secondary hover:text-text">{f.status === 'published' ? '이걸로 새로' : '이어 만들기'}</button>
                  <button onClick={() => setDeleteModal({ show: true, id: f.id, title: f.title })} className="text-[11px] px-2 py-1.5 rounded-lg text-text-muted hover:text-rose-500">삭제</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <ConfirmModal show={deleteModal.show} icon="🗑️" title="전단지 삭제" message={`"${deleteModal.title}"을(를) 삭제하시겠습니까?`} danger confirmLabel="삭제" onConfirm={() => removeFlyer(deleteModal.id)} onCancel={() => setDeleteModal({ show: false, id: '', title: '' })} />
        <Toast show={copyToast} message="URL이 복사되었습니다" />
        <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
      </div>
    );
  }

  // ── compose ──
  const previewCategories = build?.categories?.length ? build.categories : (items.length ? [{ name: '상품', items }] : []);
  return (
    <div className="max-w-5xl mx-auto pb-24">
      {/* 상단: 돌아가기 + 소스 4칩 */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <button onClick={() => setView('home')} className="px-3 py-2 rounded-xl bg-surface border border-border text-text-secondary text-sm hover:text-text">← 처음</button>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => openSheet('pos')} className="px-3 py-2 rounded-full bg-surface border border-border text-sm text-text hover:border-primary-400">POS 인기 상품</button>
          <button onClick={() => openSheet('last')} className="px-3 py-2 rounded-full bg-surface border border-border text-sm text-text hover:border-primary-400">지난 전단</button>
          <button onClick={() => openSheet('catalog')} className="px-3 py-2 rounded-full bg-surface border border-border text-sm text-text hover:border-primary-400">카탈로그</button>
          <button onClick={() => openSheet('excel')} className="px-3 py-2 rounded-full bg-surface border border-border text-sm text-text hover:border-primary-400">엑셀 올리기</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {build && (
            <button onClick={reroll} disabled={building} className="px-3 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold shadow disabled:opacity-60">
              {building ? '만드는 중...' : '다른 느낌으로'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* 좌: 미리보기(완성본이 곧 화면) */}
        <div className="bg-surface rounded-2xl border border-border p-3">
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-xs text-text-muted">
              {build ? `자동 구성 완료 · ${build.reasons?.[0] || ''}` : items.length > 0 ? '구성 중...' : '상품을 담으면 완성본이 나타납니다'}
            </p>
            {building && <span className="text-[11px] text-primary-600">업데이트 중</span>}
          </div>
          <div className="h-[560px] rounded-xl overflow-hidden bg-bg border border-border">
            <FlyerPreview
              title={title} storeName={storeName}
              periodStart={periodStart} periodEnd={periodEnd}
              categories={previewCategories as any}
              template={build?.template || 'grid_hero'}
              designVariant={build?.design_variant || null}
            />
          </div>
        </div>

        {/* 우: 담긴 상품(손질 4종만) + 행사 정보 최소 */}
        <div className="space-y-3">
          <div className="bg-surface rounded-2xl border border-border p-4 space-y-2">
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="행사 이름 (예: 이번 주 행사)" />
            <Input value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="매장 이름 (전단에 표시)" />
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          <div className="bg-surface rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-text">담긴 상품 <span className="text-text-muted">{items.length}</span></p>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-text-muted py-6 text-center">위의 칩에서 상품을 담아 주세요.<br />담는 순간 전단이 만들어집니다.</p>
            ) : (
              <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
                {items.map((it, i) => (
                  <div key={`${it.name}-${i}`} className="flex items-center gap-2 bg-bg rounded-lg px-2.5 py-2">
                    <button onClick={() => setNamePop({ idx: i, value: it.name })} className="flex-1 text-left text-[13px] text-text truncate hover:text-primary-600" title="이름 수정">{it.name}</button>
                    <button onClick={() => setPricePop({ idx: i, value: String(it.salePrice || '') })} className="text-[13px] font-bold text-primary-600 tabular-nums hover:text-primary-500" title="가격 수정">
                      {it.salePrice > 0 ? `${it.salePrice.toLocaleString()}원` : '가격 입력'}
                    </button>
                    <button onClick={() => removeItem(i)} className="text-text-muted hover:text-rose-500 px-1" aria-label="빼기">×</button>
                  </div>
                ))}
              </div>
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
                    <span className="text-[13px] font-bold text-primary-600 tabular-nums">{(Number(p.avg_price) || 0).toLocaleString()}원</span>
                  </label>
                ))
              ) : sheet === 'catalog' ? (
                catalogItems.length === 0 ? <p className="text-sm text-text-muted text-center py-10">카탈로그가 비어 있어요.<br />상품관리에서 등록하거나 엑셀로 올려 주세요.</p> :
                catalogItems.map((c, i) => (
                  <label key={i} className="flex items-center gap-3 bg-bg rounded-xl px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={!!sheetChecked[`cat-${i}`]} onChange={e => setSheetChecked({ ...sheetChecked, [`cat-${i}`]: e.target.checked })} className="w-4 h-4 accent-primary-600" />
                    <span className="flex-1 text-sm text-text truncate">{c.product_name || c.name}</span>
                    <span className="text-[13px] font-bold text-primary-600 tabular-nums">{(Number(c.sale_price ?? c.price) || 0).toLocaleString()}원</span>
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

      {/* ── 가격 키패드 팝오버(손질 ①) ── */}
      {pricePop && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) setPricePop(null); }}>
          <div className="bg-surface rounded-2xl border border-border p-5 w-[280px] space-y-3">
            <p className="text-sm font-bold text-text truncate">{items[pricePop.idx]?.name}</p>
            <Input type="number" inputMode="numeric" autoFocus value={pricePop.value}
              onChange={e => setPricePop({ ...pricePop, value: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') applyPrice(); }}
              placeholder="판매가 (원)" />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setPricePop(null)}>취소</Button>
              <Button className="flex-1" onClick={applyPrice}>확인</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── 상품명 수정 팝오버(손질 ③ — POS 축약어 정정 통로) ── */}
      {namePop && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) setNamePop(null); }}>
          <div className="bg-surface rounded-2xl border border-border p-5 w-[320px] space-y-3">
            <p className="text-xs text-text-muted">전단에 보일 이름으로 고쳐 주세요</p>
            <Input autoFocus value={namePop.value}
              onChange={e => setNamePop({ ...namePop, value: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') applyName(); }} />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setNamePop(null)}>취소</Button>
              <Button className="flex-1" onClick={applyName}>확인</Button>
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
