/**
 * ★ D155: 슈퍼관리자 매장 관리 (D113 본진 매트릭스 hanjulDM 미러)
 * backend: GET /api/admin/flyer/stores?companyId=&businessType=&paymentStatus=&search=&page=
 *          POST /api/admin/flyer/stores (사업자등록증 + 세금계산서 + 담당자 + 과금)
 *          PUT /api/admin/flyer/stores/:id
 *          POST /api/admin/flyer/stores/:id/charge (선불 잔액 충전)
 *          POST /api/admin/flyer/stores/:id/activate (입금 확인 = 잔액 충전)
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Input, Select, DataTable, Badge, Toast } from '../components/ui';

interface Store {
  id: string;
  login_id?: string;
  name?: string;
  store_name?: string;
  business_type?: string;
  business_number?: string;
  payment_status?: string;
  prepaid_balance?: number;
  monthly_fee?: number;
  plan_started_at?: string;
  plan_expires_at?: string;
  contact_name?: string;
  contact_phone?: string;
  last_login_at?: string;
  created_at?: string;
  company_name?: string;
}

interface Company { id: string; company_name?: string; }
interface BusinessType { type_code: string; type_name: string; }

export default function StoreListPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [companyFilter, setCompanyFilter] = useState('');
  const [businessFilter, setBusinessFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [formTarget, setFormTarget] = useState<Store | null>(null);
  const [chargeTarget, setChargeTarget] = useState<Store | null>(null);

  const loadCompanies = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/companies`);
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.items || data || []);
      }
    } catch {}
  }, []);

  const loadBusinessTypes = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/business-types`);
      if (res.ok) {
        const data = await res.json();
        setBusinessTypes(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (companyFilter) params.set('companyId', companyFilter);
      if (businessFilter) params.set('businessType', businessFilter);
      if (statusFilter) params.set('paymentStatus', statusFilter);
      if (search) params.set('search', search);
      params.set('page', String(page));
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/stores?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setStores(data.items || []);
        setTotal(data.total || 0);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '매장 목록 로드 실패');
      }
    } catch (err: any) {
      setError(err.message || '매장 목록 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [companyFilter, businessFilter, statusFilter, search, page]);

  useEffect(() => { loadCompanies(); loadBusinessTypes(); }, [loadCompanies, loadBusinessTypes]);
  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <>
      <SectionCard
        title={`매장 목록 (${total})`}
        action={
          <div className="flex gap-2 items-end flex-wrap">
            <Select value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setPage(1); }} className="w-36">
              <option value="">전체 총판</option>
              {companies.map(c => (<option key={c.id} value={c.id}>{c.company_name || c.id}</option>))}
            </Select>
            <Select value={businessFilter} onChange={e => { setBusinessFilter(e.target.value); setPage(1); }} className="w-32">
              <option value="">전체 업종</option>
              {businessTypes.map(b => (<option key={b.type_code} value={b.type_code}>{b.type_name}</option>))}
            </Select>
            <Select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="w-28">
              <option value="">전체 상태</option>
              <option value="paid">paid</option>
              <option value="pending">pending</option>
              <option value="suspended">suspended</option>
            </Select>
            <Input placeholder="매장명/아이디 검색" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="w-44" />
            <Button size="sm" onClick={() => { setFormTarget(null); setFormMode('create'); }}>+ 신규 매장</Button>
          </div>
        }
      >
        {error && (
          <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-4">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        )}
        {loading ? (
          <p className="text-sm text-text-muted text-center py-8">로딩 중...</p>
        ) : (
          <>
            <DataTable
              columns={[
                { key: 'company_name', label: '총판' },
                { key: 'store_name', label: '매장명' },
                { key: 'login_id', label: '아이디' },
                { key: 'business_type', label: '업종' },
                { key: 'contact_name', label: '담당자' },
                { key: 'monthly_fee', label: '월요금', render: (v) => v ? `₩${Number(v).toLocaleString()}` : '-' },
                { key: 'prepaid_balance', label: '잔액', render: (v) => `₩${Number(v || 0).toLocaleString()}` },
                { key: 'payment_status', label: '상태', render: (v) => <Badge variant={v === 'paid' ? 'success' : v === 'pending' ? 'warn' : 'neutral'}>{v || '-'}</Badge> },
                { key: 'action', label: '액션', align: 'right', render: (_, row) => (
                  <div className="flex gap-1 justify-end">
                    <Button variant="secondary" size="sm" onClick={() => setChargeTarget(row)}>충전</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setFormTarget(row); setFormMode('edit'); }}>수정</Button>
                  </div>
                ) },
              ]}
              rows={stores}
              emptyMessage="등록된 매장이 없습니다"
            />
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-3 mt-5">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>이전</Button>
                <span className="text-sm text-text-secondary">{page} / {totalPages}</span>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>다음</Button>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {formMode && (
        <StoreFormModal
          mode={formMode}
          target={formTarget}
          companies={companies}
          businessTypes={businessTypes}
          onClose={() => { setFormMode(null); setFormTarget(null); }}
          onSuccess={(msg) => {
            setToast(msg);
            setTimeout(() => setToast(''), 2500);
            setFormMode(null);
            setFormTarget(null);
            load();
          }}
        />
      )}

      {chargeTarget && (
        <ChargeModal
          store={chargeTarget}
          onClose={() => setChargeTarget(null)}
          onSuccess={(msg) => {
            setToast(msg);
            setTimeout(() => setToast(''), 2500);
            setChargeTarget(null);
            load();
          }}
        />
      )}

      <Toast show={!!toast} message={toast} />
    </>
  );
}

// ============================================================
// 매장 신규/수정 모달 (사업자등록증 + 세금계산서 + 담당자 + 과금)
// ============================================================
function StoreFormModal({ mode, target, companies, businessTypes, onClose, onSuccess }: {
  mode: 'create' | 'edit';
  target: Store | null;
  companies: Company[];
  businessTypes: BusinessType[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [form, setForm] = useState<Partial<Store> & { company_id?: string; password?: string }>(
    target ? { ...target } : { monthly_fee: 150000 }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const url = mode === 'create'
        ? `${API_BASE}/api/admin/flyer/stores`
        : `${API_BASE}/api/admin/flyer/stores/${target?.id}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        onSuccess(mode === 'create' ? '매장 등록 완료' : '매장 수정 완료');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '저장 실패');
      }
    } catch (err: any) {
      setError(err.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4 overflow-y-auto">
      <div className="bg-surface rounded-2xl shadow-modal max-w-2xl w-full p-6 my-8">
        <h3 className="text-base font-bold text-text mb-4">{mode === 'create' ? '신규 매장 등록' : '매장 정보 수정'}</h3>
        {error && (
          <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-3">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        )}

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          <Section title="기본 정보">
            <Grid2>
              {mode === 'create' && (
                <Select label="총판 (회사) *" value={form.company_id || ''} onChange={e => set('company_id', e.target.value)}>
                  <option value="">선택</option>
                  {companies.map(c => (<option key={c.id} value={c.id}>{c.company_name}</option>))}
                </Select>
              )}
              <Select label="업종 *" value={form.business_type || ''} onChange={e => set('business_type', e.target.value)}>
                <option value="">선택</option>
                {businessTypes.map(b => (<option key={b.type_code} value={b.type_code}>{b.type_name}</option>))}
              </Select>
              <Input label="매장명" value={form.store_name || ''} onChange={e => set('store_name', e.target.value)} />
              {mode === 'create' && (
                <Input label="아이디 *" value={(form as any).login_id || ''} onChange={e => set('login_id', e.target.value)} />
              )}
              {mode === 'create' && (
                <Input label="비밀번호 *" type="password" value={form.password || ''} onChange={e => set('password', e.target.value)} />
              )}
              <Input label="대표자 이름" value={form.name || ''} onChange={e => set('name', e.target.value)} />
            </Grid2>
          </Section>

          <Section title="사업자등록증">
            <Grid2>
              <Input label="사업자번호" value={form.business_number || ''} onChange={e => set('business_number', e.target.value)} />
              <Input label="상호" value={(form as any).business_reg_name || ''} onChange={e => set('business_reg_name', e.target.value)} />
              <Input label="대표자명" value={(form as any).business_reg_owner || ''} onChange={e => set('business_reg_owner', e.target.value)} />
              <Input label="업태" value={(form as any).business_category || ''} onChange={e => set('business_category', e.target.value)} />
              <Input label="종목" value={(form as any).business_item || ''} onChange={e => set('business_item', e.target.value)} />
              <Input label="사업장 주소" value={(form as any).business_address || ''} onChange={e => set('business_address', e.target.value)} />
            </Grid2>
          </Section>

          <Section title="세금계산서">
            <Grid2>
              <Input label="이메일" value={(form as any).tax_email || ''} onChange={e => set('tax_email', e.target.value)} />
              <Input label="담당자명" value={(form as any).tax_manager_name || ''} onChange={e => set('tax_manager_name', e.target.value)} />
              <Input label="담당자 연락처" value={(form as any).tax_manager_phone || ''} onChange={e => set('tax_manager_phone', e.target.value)} />
            </Grid2>
          </Section>

          <Section title="담당자 (운영)">
            <Grid2>
              <Input label="담당자명" value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} />
              <Input label="연락처" value={form.contact_phone || ''} onChange={e => set('contact_phone', e.target.value)} />
              <Input label="이메일" value={(form as any).contact_email || ''} onChange={e => set('contact_email', e.target.value)} />
            </Grid2>
          </Section>

          <Section title="과금">
            <Grid2>
              <Input label="월 요금 (원)" type="number" value={String(form.monthly_fee ?? '')} onChange={e => set('monthly_fee', Number(e.target.value))} />
              <Input label="시작일" type="date" value={form.plan_started_at?.slice(0, 10) || ''} onChange={e => set('plan_started_at', e.target.value || null)} />
              {mode === 'edit' && (
                <Input label="만료일" type="date" value={form.plan_expires_at?.slice(0, 10) || ''} onChange={e => set('plan_expires_at', e.target.value || null)} />
              )}
              {mode === 'edit' && (
                <Select label="결제 상태" value={form.payment_status || ''} onChange={e => set('payment_status', e.target.value)}>
                  <option value="pending">pending</option>
                  <option value="paid">paid</option>
                  <option value="suspended">suspended</option>
                </Select>
              )}
            </Grid2>
          </Section>

          <Section title="메모">
            <Input label="관리자 메모" value={(form as any).memo || ''} onChange={e => set('memo', e.target.value)} />
          </Section>
        </div>

        <div className="flex gap-3 mt-5">
          <Button variant="secondary" className="flex-1" onClick={onClose}>취소</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : (mode === 'create' ? '등록' : '저장')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 매장 충전 모달
// ============================================================
function ChargeModal({ store, onClose, onSuccess }: {
  store: Store;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [activate, setActivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCharge = async () => {
    const amt = parseInt(amount, 10);
    if (!amt || amt <= 0) { setError('충전 금액은 1원 이상'); return; }
    setSaving(true);
    setError('');
    try {
      const endpoint = activate
        ? `/api/admin/flyer/stores/${store.id}/activate`
        : `/api/admin/flyer/stores/${store.id}/charge`;
      const res = await apiFetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      });
      if (res.ok) {
        const data = await res.json();
        onSuccess(data.message || `₩${amt.toLocaleString()} 충전 완료`);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '충전 실패');
      }
    } catch (err: any) {
      setError(err.message || '충전 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4">
      <div className="bg-surface rounded-2xl shadow-modal max-w-sm w-full p-6">
        <div className="text-center mb-4">
          <h3 className="text-base font-bold text-text">매장 충전 — {store.store_name || store.login_id}</h3>
          <p className="text-sm text-text-secondary mt-1.5">현재 잔액: ₩{Number(store.prepaid_balance || 0).toLocaleString()}</p>
        </div>
        <div className="space-y-3 mb-5">
          <Input label="충전 금액 (원)" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="예: 100000" />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={activate} onChange={e => setActivate(e.target.checked)} className="w-4 h-4" />
            입금 확인(activate) — D114 정책: 충전 + 매장 사장님 결제 시 활성화
          </label>
          {error && <p className="text-sm text-error-600">{error}</p>}
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>취소</Button>
          <Button className="flex-1" onClick={handleCharge} disabled={saving}>{saving ? '처리 중...' : '충전'}</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 헬퍼 컴포넌트
// ============================================================
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">{title}</h4>
      {children}
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
