/**
 * ★ D155: 슈퍼관리자 결제/과금 내역 (D113 본진 매트릭스 hanjulDM 미러)
 * backend: GET /api/admin/flyer/billing?companyId= — flyer_billing_history 100건
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Select, DataTable, Badge } from '../components/ui';

interface BillingHistory {
  id: string;
  company_id: string;
  billing_month?: string;
  amount?: number;
  sms_count?: number;
  lms_count?: number;
  mms_count?: number;
  status?: string;
  paid_at?: string;
  created_at?: string;
  company_name?: string;
  memo?: string;
}

interface Company { id: string; company_name?: string; }

export default function BillingPage() {
  const [records, setRecords] = useState<BillingHistory[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCompanies = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/companies`);
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.items || data || []);
      }
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = companyFilter ? `?companyId=${encodeURIComponent(companyFilter)}` : '';
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/billing${qs}`);
      if (res.ok) {
        const data = await res.json();
        setRecords(Array.isArray(data) ? data : []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '결제 내역 로드 실패');
      }
    } catch (err: any) {
      setError(err.message || '결제 내역 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [companyFilter]);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => { load(); }, [load]);

  const totalAmount = records.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const paidCount = records.filter(r => r.status === 'paid').length;

  return (
    <SectionCard
      title={`결제 내역 (${records.length})`}
      action={
        <Select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} className="w-48">
          <option value="">전체 회사</option>
          {companies.map(c => (<option key={c.id} value={c.id}>{c.company_name || c.id}</option>))}
        </Select>
      }
    >
      {error && (
        <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-4">
          <p className="text-sm text-error-600">{error}</p>
        </div>
      )}

      {!loading && records.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-bg border border-border rounded-lg p-3">
            <p className="text-xs text-text-secondary">총 청구액</p>
            <p className="text-lg font-bold text-text">₩{totalAmount.toLocaleString()}</p>
          </div>
          <div className="bg-bg border border-border rounded-lg p-3">
            <p className="text-xs text-text-secondary">결제 완료</p>
            <p className="text-lg font-bold text-success-600">{paidCount}건</p>
          </div>
          <div className="bg-bg border border-border rounded-lg p-3">
            <p className="text-xs text-text-secondary">미결제</p>
            <p className="text-lg font-bold text-warn-500">{records.length - paidCount}건</p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-text-muted text-center py-8">로딩 중...</p>
      ) : (
        <DataTable
          columns={[
            { key: 'billing_month', label: '청구월', render: (v) => v ? String(v).slice(0, 7) : '-' },
            { key: 'company_name', label: '회사' },
            { key: 'sms_count', label: 'SMS', render: (v) => Number(v || 0).toLocaleString() },
            { key: 'lms_count', label: 'LMS', render: (v) => Number(v || 0).toLocaleString() },
            { key: 'mms_count', label: 'MMS', render: (v) => Number(v || 0).toLocaleString() },
            { key: 'amount', label: '금액', render: (v) => `₩${Number(v || 0).toLocaleString()}` },
            { key: 'status', label: '상태', render: (v) => (
              <Badge variant={v === 'paid' ? 'success' : v === 'pending' ? 'warn' : 'neutral'}>{v || '-'}</Badge>
            ) },
            { key: 'paid_at', label: '결제일', render: (v) => v ? new Date(v).toLocaleDateString('ko-KR') : '-' },
          ]}
          rows={records}
          emptyMessage="결제 내역이 없습니다"
        />
      )}
    </SectionCard>
  );
}
