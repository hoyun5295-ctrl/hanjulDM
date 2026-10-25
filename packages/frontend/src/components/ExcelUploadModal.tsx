/**
 * ★ 전단AI 공용 파일 등록 모달 (17번 설계 §2-5 · 2026-10-25 2단계 개편)
 *
 * 사용처: FlyerComposerPage, PopPage, PrintFlyerPage
 * 흐름: 올리기 → 결과(확인 필요 행 맨 위 · 그 칸만 고침) → 담기 1클릭
 *   - 판정(ok / 확인 필요 / 빠짐)은 서버가 한다(CT-F24 · 화면 판정 0).
 *   - 열 연결 바꾸기는 결과 화면의 접힌 줄 안 — 기본 흐름에 단계가 없다.
 *   - requirePrice(인쇄·POP): 가격을 읽지 못한 상품은 넘기지 않는다(인쇄 오가격 차단).
 */

import { useState, useRef, useMemo } from 'react';
import { API_BASE, apiFetch } from '../App';
import { Button } from './ui';

export interface MappedProduct {
  productName: string;
  salePrice: number;
  originalPrice: number;
  unit: string;
  category: string;
  promoType: 'main' | 'sub' | 'general';
  origin: string;
  imageUrl: string;
  /** ★ 1025 신규(optional) — 기존 8키는 이름·뜻 불변 */
  badge?: string;
  cardDiscount?: string;
  review?: string[];
  /** 가격을 읽지 못함 — 인쇄 관문 차단 대상 */
  reviewPrice?: boolean;
}

interface MappingField {
  fieldKey: string;
  displayName: string;
  description: string;
  required: boolean;
}

interface JudgedRow {
  index: number;
  status: 'ok' | 'needsReview' | 'dropped';
  reasons: string[];
  /** reasons 와 같은 순서의 기계 키(서버 CT-F24 소유) — 화면은 문구가 아니라 키로 판단한다 */
  reasonKeys: string[];
  raw: Record<string, string>;
  product: MappedProduct | null;
}

interface ReadResult {
  mapping: Record<string, string | null>;
  mappingSource: 'template' | 'ai';
  message: string;
  hasProductName: boolean;
  hasSalePrice: boolean;
  headers: string[];
  sheets: string[];
  sheetName: string;
  rows: JudgedRow[];
  summary: { ok: number; review: number; dropped: number };
  fields: MappingField[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (products: MappedProduct[]) => void;
  /** 인쇄·POP처럼 곧바로 인쇄되는 화면 — 가격 미확인 상품은 넘기지 않는다 */
  requirePrice?: boolean;
}

/** 가격을 확정하지 못한 사유 키(서버 PRICE_REASON_KEYS 와 같은 목록) — 사장님이 「확인」해야 걷힌다 */
const PRICE_KEYS = ['price', 'bundle', 'dup:sale_price', 'dup:bundle_price', 'dup:bundle_qty', 'dup:unit'];
const SAMPLE_URL = '/samples/hanjul-flyer-sample.xlsx';

export default function ExcelUploadModal({ isOpen, onClose, onComplete, requirePrice = false }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<ReadResult | null>(null);
  const [mappingDraft, setMappingDraft] = useState<Record<string, string | null>>({});
  const [showMapping, setShowMapping] = useState(false);
  const [showAllOk, setShowAllOk] = useState(false);
  /** 행 번호 → 사장님이 고친 값. 가격은 초안(priceDraft)으로만 두고 「확인」을 눌러야 판정에 들어간다
   *  (★1025 Codex 1R: 첫 숫자를 누르는 순간 행이 정상으로 바뀌어 편집칸이 사라지고 1원이 통과하던 결함) */
  const [edits, setEdits] = useState<Record<number, { productName?: string; priceDraft?: string; confirmed?: boolean }>>({});
  const setEdit = (index: number, patch: { productName?: string; priceDraft?: string; confirmed?: boolean }) =>
    setEdits(prev => ({ ...prev, [index]: { ...prev[index], ...patch } }));

  const reset = () => {
    setFile(null); setData(null); setMappingDraft({}); setEdits({});
    setShowMapping(false); setShowAllOk(false); setError(''); setBusy(false);
  };
  const close = () => { reset(); onClose(); };

  const send = async (url: string, f: File, extra: Record<string, string>) => {
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      for (const [k, v] of Object.entries(extra)) fd.append(k, v);
      const res = await apiFetch(url, { method: 'POST', body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error || '파일을 읽지 못했습니다');
      setData(body as ReadResult);
      setMappingDraft((body as ReadResult).mapping || {});
      setEdits({});
    } catch (err: any) {
      setError(err.message || '파일을 읽지 못했습니다');
    } finally {
      setBusy(false);
    }
  };

  const handleFileSelect = (f: File) => {
    setFile(f);
    send(`${API_BASE}/api/flyer/flyers/upload-excel`, f, {});
  };
  // 시트를 바꾸면 그 시트 기준으로 처음부터 읽는다(옛 시트의 열 연결을 보내면 새 시트 열이 전부 지워진다 — Codex 1R)
  const changeSheet = (sheet: string) => {
    if (!file || !data || sheet === data.sheetName) return;
    send(`${API_BASE}/api/flyer/flyers/upload-excel`, file, { sheet });
  };
  // 같은 시트에서 열 연결만 바꿔 다시 읽기
  const reread = () => {
    if (!file || !data) return;
    send(`${API_BASE}/api/flyer/flyers/apply-excel-mapping`, file, {
      mapping: JSON.stringify(mappingDraft),
      sheet: data.sheetName,
    });
  };

  const draftPrice = (s?: string) => Number(String(s ?? '').replace(/[^0-9]/g, '')) || 0;

  // ── 고친 값 반영 — 「확인」한 행만 가격 사유 키가 걷힌다(다른 사유는 표시 유지 · 판정은 키로만) ──
  const rows = useMemo(() => (data?.rows || []).map(r => {
    if (!r.product) return r;
    const e = edits[r.index] || {};
    const p: MappedProduct = { ...r.product };
    if (e.productName !== undefined) p.productName = e.productName;
    let reasons = r.reasons;
    let keys = r.reasonKeys;
    if (e.confirmed) {
      if (e.priceDraft !== undefined) p.salePrice = draftPrice(e.priceDraft);
      const keep = keys.map(k => !PRICE_KEYS.includes(k));
      reasons = reasons.filter((_, i) => keep[i]);
      keys = keys.filter((_, i) => keep[i]);
    }
    p.review = reasons.length ? reasons : undefined;
    // 확인하지 않은 가격 초안(원래 값과 다름)은 어느 행이든 미확정 — 화면에 보이는 값과 넘기는 값이 갈리지 않게(★Codex 2R)
    const unconfirmedDraft = !e.confirmed && e.priceDraft !== undefined && draftPrice(e.priceDraft) !== r.product.salePrice;
    // 가격 사유가 남았거나 · 미확인 초안이 있거나 · 가격이 양수가 아니면 인쇄 차단
    p.reviewPrice = keys.some(k => PRICE_KEYS.includes(k)) || unconfirmedDraft || !(p.salePrice > 0) || undefined;
    return { ...r, reasons, reasonKeys: keys, product: p };
  }), [data, edits]);

  // 확인 목록은 서버 판정 그대로 고정 — 고치는 중에 행이 목록 사이를 오가지 않는다
  const reviewRows = rows.filter(r => r.status === 'needsReview');
  const okRows = rows.filter(r => r.status === 'ok');
  const droppedRows = rows.filter(r => r.status === 'dropped');
  const priceBlocked = rows.filter(r => r.product?.reviewPrice);
  const handOver = rows
    .filter(r => r.product && r.product.productName.trim())
    .filter(r => !(requirePrice && (r.product!.reviewPrice || !(r.product!.salePrice > 0))))
    .map(r => r.product!);

  const complete = () => {
    onComplete(handOver);
    close();
  };

  if (!isOpen) return null;

  const fieldLabel = (key: string | null) => data?.fields.find(f => f.fieldKey === key)?.displayName || '';
  const firstRawPrice = (r: JudgedRow) => {
    const h = Object.entries(data?.mapping || {}).find(([, f]) => f === 'sale_price' || f === 'bundle_price')?.[0];
    return h ? r.raw[h] : '';
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50" onClick={close}>
      <div className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl sm:mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* 머리 */}
        <div className="px-5 sm:px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-text">{data ? '읽은 상품 확인' : '파일로 상품 담기'}</h3>
            <p className="text-xs text-text-secondary mt-0.5 truncate">
              {data
                ? `${data.message} · ${data.sheetName}`
                : '엑셀(xlsx) 또는 CSV 파일을 올리면 상품을 정리해 담습니다'}
            </p>
          </div>
          <button onClick={close} className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg" aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 p-3 bg-error-50 border border-error-200 rounded-xl text-sm text-error-600">{error}</div>
          )}

          {/* ── 1. 올리기 ── */}
          {!data && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={busy ? undefined : (e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); })}
              onClick={busy ? undefined : () => fileRef.current?.click()}
              className={`relative border-2 border-dashed rounded-2xl text-center transition min-h-[260px] flex items-center justify-center ${
                busy ? 'border-primary-300 bg-primary-50/40 cursor-default'
                  : dragOver ? 'border-primary-400 bg-primary-50/30 cursor-pointer'
                  : 'border-border hover:border-primary-300 cursor-pointer'
              }`}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); if (fileRef.current) fileRef.current.value = ''; }} />
              {busy ? (
                <div className="px-8 py-4 flex flex-col items-center gap-4">
                  <div className="w-10 h-10 rounded-full border-[3px] border-primary-100 border-t-primary-500 animate-spin" aria-label="읽는 중" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-text">파일을 읽고 상품을 정리하고 있습니다</p>
                    <p className="text-xs text-text-secondary">가격·묶음·행사 표시를 하나씩 확인하는 중이에요</p>
                  </div>
                </div>
              ) : (
                <div className="px-6 py-4">
                  <div className="mx-auto w-14 h-14 mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-primary-500">
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-text mb-1">파일을 끌어 놓거나 눌러서 고르세요</p>
                  <p className="text-xs text-text-secondary">.xlsx · .xls · .csv · 최대 10MB · 2,000행</p>
                  <a href={SAMPLE_URL} download onClick={e => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 mt-5 h-9 px-4 rounded-full border border-border bg-surface text-xs font-semibold text-text hover:border-primary-300">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" /></svg>
                    예시 양식 받기(.xlsx)
                  </a>
                  <p className="text-[11px] text-text-muted mt-2">양식 그대로 채워 올리면 가장 정확하게 읽습니다</p>
                </div>
              )}
            </div>
          )}

          {/* ── 2. 결과 ── */}
          {data && (
            <div className="space-y-5">
              {/* 요약 */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { n: okRows.length, l: '바로 담김', c: 'text-text' },
                  { n: reviewRows.length, l: '확인 필요', c: reviewRows.length ? 'text-amber-600' : 'text-text-muted' },
                  { n: droppedRows.length, l: '빠진 행', c: droppedRows.length ? 'text-error-600' : 'text-text-muted' },
                ].map(s => (
                  <div key={s.l} className="rounded-xl bg-bg px-3 py-2.5 text-center">
                    <p className={`text-lg font-bold ${s.c}`}>{s.n}</p>
                    <p className="text-[11px] text-text-secondary">{s.l}</p>
                  </div>
                ))}
              </div>

              {data.sheets.length > 1 && (
                <label className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className="shrink-0">읽은 시트</span>
                  <select value={data.sheetName} disabled={busy} onChange={e => changeSheet(e.target.value)}
                    className="flex-1 h-9 px-2 border border-border rounded-lg text-sm bg-surface text-text">
                    {data.sheets.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              )}

              {/* 확인 필요 — 맨 위, 전부 */}
              {reviewRows.length > 0 && (
                <section>
                  <p className="text-xs font-bold text-amber-700 mb-2">
                    확인이 필요한 상품 {reviewRows.length}개
                    {requirePrice && priceBlocked.length > 0 ? ' · 가격을 채우지 않은 상품은 인쇄에 넣지 않습니다' : ''}
                  </p>
                  <ul className="space-y-2">
                    {reviewRows.map(r => {
                      const p = r.product!;
                      const e = edits[r.index] || {};
                      // 서버가 가격 사유를 붙인 행만 가격 확인이 필요하다(키 기준 · 문구 비교 없음)
                      const server = data.rows.find(x => x.index === r.index);
                      const needsPrice = !!server?.reasonKeys.some(k => PRICE_KEYS.includes(k));
                      const draft = e.priceDraft ?? (p.salePrice ? String(p.salePrice) : '');
                      const canConfirm = draftPrice(draft) > 0;
                      // 가격 확인이 필요한 행이거나, 원래 값과 다르게 고친 행이면 「확인」을 받는다
                      const askConfirm = needsPrice || (e.priceDraft !== undefined && draftPrice(e.priceDraft) !== (server?.product?.salePrice ?? 0));
                      return (
                        <li key={r.index} className={`rounded-xl border p-3 ${e.confirmed ? 'border-border bg-surface' : 'border-amber-200 bg-amber-50/50'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <input value={e.productName ?? p.productName}
                                onChange={ev => setEdit(r.index, { productName: ev.target.value })}
                                className="w-full bg-transparent text-sm font-semibold text-text border-b border-transparent focus:border-primary-300 outline-none" />
                              <p className="text-[11px] text-text-muted mt-0.5">{r.index}행 · 원문 가격 「{firstRawPrice(r) || '비어 있음'}」</p>
                            </div>
                            <label className="shrink-0 flex items-center gap-1">
                              <input inputMode="numeric" placeholder="가격" value={draft}
                                onChange={ev => setEdit(r.index, { priceDraft: ev.target.value.replace(/[^0-9]/g, ''), confirmed: false })}
                                className={`w-24 h-9 px-2 text-right rounded-lg border text-sm bg-surface ${askConfirm && !e.confirmed ? 'border-amber-400' : 'border-border'}`} />
                              <span className="text-xs text-text-secondary">원</span>
                            </label>
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-2">
                            {r.reasons.map((x, i) => (
                              <span key={x} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${PRICE_KEYS.includes(r.reasonKeys[i]) ? 'bg-amber-200 text-amber-900' : 'bg-surface text-text-secondary border border-border'}`}>{x}</span>
                            ))}
                            {askConfirm && (e.confirmed
                              ? <span className="ml-auto px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700">가격 확인함 · {draftPrice(draft).toLocaleString()}원</span>
                              : <button type="button" disabled={!canConfirm} onClick={() => setEdit(r.index, { priceDraft: draft, confirmed: true })}
                                  className="ml-auto h-7 px-3 rounded-full bg-slate-900 text-white text-[11px] font-bold disabled:opacity-40">
                                  {canConfirm ? `${draftPrice(draft).toLocaleString()}원으로 확인` : '가격을 적어 주세요'}
                                </button>)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* 바로 담기는 상품 */}
              {okRows.length > 0 && (
                <section>
                  <p className="text-xs font-bold text-text-secondary mb-2">바로 담기는 상품 {okRows.length}개</p>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {(showAllOk ? okRows : okRows.slice(0, 20)).map(r => {
                      const p = r.product!;
                      return (
                        <li key={r.index} className="flex items-center gap-3 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-text truncate">{p.productName}</p>
                            <p className="text-[11px] text-text-muted truncate">
                              {[p.category !== '기타' ? p.category : '', p.unit, p.badge, p.cardDiscount, p.origin].filter(Boolean).join(' · ') || ' '}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-primary-600">{p.salePrice.toLocaleString()}원</p>
                            {p.originalPrice > 0 && <p className="text-[11px] text-text-muted line-through">{p.originalPrice.toLocaleString()}원</p>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {!showAllOk && okRows.length > 20 && (
                    <button onClick={() => setShowAllOk(true)} className="w-full mt-2 text-xs text-text-secondary hover:text-text">나머지 {okRows.length - 20}개 펼치기</button>
                  )}
                </section>
              )}

              {/* 빠진 행 — 늘 사유와 함께 */}
              {droppedRows.length > 0 && (
                <section className="rounded-xl bg-bg px-3 py-2.5">
                  <p className="text-xs font-bold text-text-secondary">빠진 행 {droppedRows.length}개</p>
                  <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                    {droppedRows.slice(0, 12).map(r => `${r.index}행(${r.reasons.join(', ')})`).join(' · ')}
                    {droppedRows.length > 12 ? ` 외 ${droppedRows.length - 12}행` : ''}
                  </p>
                </section>
              )}

              {/* 열 연결 바꾸기 — 접힌 줄 */}
              <section className="rounded-xl border border-border">
                <button onClick={() => setShowMapping(v => !v)} className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-text-secondary">
                  <span>열 연결 바꾸기 {data.mappingSource === 'template' ? '· 예시 양식으로 읽음' : '· AI가 연결함'}</span>
                  <span>{showMapping ? '접기' : '펼치기'}</span>
                </button>
                {showMapping && (
                  <div className="px-3 pb-3 space-y-2">
                    {data.headers.map(h => (
                      <div key={h} className="flex items-center gap-2">
                        <span className="w-2/5 text-xs text-text truncate" title={h}>{h}</span>
                        <select value={mappingDraft[h] || ''} onChange={e => setMappingDraft(prev => ({ ...prev, [h]: e.target.value || null }))}
                          className="flex-1 h-8 px-2 border border-border rounded-lg text-xs bg-surface text-text">
                          <option value="">쓰지 않음</option>
                          {data.fields.map(f => <option key={f.fieldKey} value={f.fieldKey}>{f.displayName}{f.required ? ' (필수)' : ''}</option>)}
                        </select>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-text-muted">
                        {Object.values(mappingDraft).includes('product_name') ? '' : '상품명 열을 골라 주세요 · '}
                        {Object.values(mappingDraft).some(v => v === 'sale_price' || v === 'bundle_price') ? '' : '가격 열을 골라 주세요'}
                      </span>
                      <Button size="sm" onClick={() => reread()} disabled={busy}>{busy ? '읽는 중...' : '이 연결로 다시 읽기'}</Button>
                    </div>
                    {data.mappingSource === 'ai' && <p className="text-[11px] text-text-muted">지금 연결: {Object.entries(data.mapping).filter(([, f]) => f).map(([h, f]) => `${h} → ${fieldLabel(f)}`).join(' · ') || '없음'}</p>}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        {/* 바닥 */}
        <div className="px-5 sm:px-6 py-4 border-t border-border flex justify-between items-center gap-2 shrink-0">
          <div>
            {data && <Button variant="ghost" onClick={reset} disabled={busy}>다른 파일</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={close}>취소</Button>
            {data && (
              <Button onClick={complete} disabled={busy || handOver.length === 0}>
                {handOver.length}개 담기
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
