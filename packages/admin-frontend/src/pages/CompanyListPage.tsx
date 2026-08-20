/**
 * ★ D155: 슈퍼관리자 회사 목록 + 삭제(회원 cascade) + 검색
 * backend: GET /api/admin/flyer/companies?search=&page= + DELETE /companies/:id
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Input, DataTable, Badge, ConfirmModal, Toast } from '../components/ui';
import CompanyFormModal from '../components/CompanyFormModal';
import { companyPaymentLabel, companyPaymentTone } from '../lib/payment-status';

interface Company {
  id: string;
  company_name?: string;
  business_type?: string;
  owner_name?: string;
  owner_phone?: string;
  plan_type?: string;
  payment_status?: string;
  created_at?: string;
}

export default function CompanyListPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [formTargetId, setFormTargetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/companies${qs}`);
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.items || data || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '회사 목록 로드 실패');
      }
    } catch (err: any) {
      setError(err.message || '회사 목록 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/companies/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        setToast(`삭제 완료 (소속 회원 ${data.cascadeUserCount ?? 0}명 함께 삭제)`);
        setTimeout(() => setToast(''), 2800);
        setDeleteTarget(null);
        load();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '삭제 실패');
        setDeleteTarget(null);
      }
    } catch (err: any) {
      setError(err.message || '삭제 실패');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <SectionCard
        title={`매장 회사 목록 (${companies.length})`}
        action={
          <div className="flex gap-2 items-end">
            <Input
              placeholder="회사명 검색"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-48"
            />
            <Button size="sm" onClick={() => { setFormTargetId(null); setFormMode('create'); }}>+ 신규 회사</Button>
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
          <DataTable
            columns={[
              { key: 'company_name', label: '회사명' },
              { key: 'business_type', label: '업종' },
              { key: 'owner_name', label: '대표자' },
              { key: 'owner_phone', label: '연락처' },
              { key: 'plan_type', label: '요금제' },
              { key: 'payment_status', label: '상태', render: (v) => <Badge variant={companyPaymentTone(v)}>{companyPaymentLabel(v)}</Badge> },
              { key: 'created_at', label: '등록일', render: (v) => v ? new Date(v).toLocaleDateString('ko-KR') : '-' },
              { key: 'action', label: '액션', align: 'right', render: (_, row) => (
                <div className="flex gap-1 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => { setFormTargetId(row.id); setFormMode('edit'); }}>수정</Button>
                  <Button variant="danger" size="sm" onClick={() => setDeleteTarget(row)}>삭제</Button>
                </div>
              ) },
            ]}
            rows={companies}
            emptyMessage="등록된 매장이 없습니다"
          />
        )}
      </SectionCard>

      <ConfirmModal
        show={!!deleteTarget}
        title="회사 삭제"
        message={`${deleteTarget?.company_name || ''} 회사를 삭제하시겠습니까? 소속 회원도 함께 삭제됩니다. (복원 가능)`}
        confirmLabel={deleting ? '삭제 중...' : '삭제'}
        cancelLabel="취소"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      {formMode && (
        <CompanyFormModal
          mode={formMode}
          targetId={formTargetId}
          onClose={() => { setFormMode(null); setFormTargetId(null); }}
          onSuccess={(msg) => {
            setToast(msg);
            setTimeout(() => setToast(''), 2500);
            setFormMode(null);
            setFormTargetId(null);
            load();
          }}
        />
      )}

      <Toast show={!!toast} message={toast} />
    </>
  );
}
