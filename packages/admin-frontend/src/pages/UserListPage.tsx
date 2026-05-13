/**
 * ★ D155: 슈퍼관리자 회원 목록 + 회사별 필터 + 삭제
 * backend: GET /api/admin/flyer/users?companyId= + DELETE /users/:id
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Select, DataTable, ConfirmModal, Toast } from '../components/ui';

interface User {
  id: string;
  email?: string;
  name?: string;
  role?: string;
  last_login_at?: string;
  created_at?: string;
  company_name?: string;
  login_id?: string;
  store_name?: string;
}

interface Company { id: string; company_name?: string; }

export default function UserListPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');

  const loadCompanies = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/companies`);
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.items || data || []);
      }
    } catch {
      // 회사 목록 실패는 무시 (필터만 영향, 회원 목록 별도 로드)
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = companyFilter ? `?companyId=${encodeURIComponent(companyFilter)}` : '';
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/users${qs}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : data.items || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '회원 목록 로드 실패');
      }
    } catch (err: any) {
      setError(err.message || '회원 목록 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [companyFilter]);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/users/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.ok) {
        setToast('회원 삭제 완료');
        setTimeout(() => setToast(''), 2500);
        setDeleteTarget(null);
        loadUsers();
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
        title={`회원 목록 (${users.length})`}
        action={
          <Select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} className="w-48">
            <option value="">전체 회사</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.company_name || c.id}</option>
            ))}
          </Select>
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
              { key: 'company_name', label: '회사' },
              { key: 'email', label: '이메일' },
              { key: 'name', label: '이름' },
              { key: 'role', label: '권한' },
              { key: 'last_login_at', label: '최근 로그인', render: (v) => v ? new Date(v).toLocaleString('ko-KR') : '-' },
              { key: 'created_at', label: '가입일', render: (v) => v ? new Date(v).toLocaleDateString('ko-KR') : '-' },
              { key: 'action', label: '액션', align: 'right', render: (_, row) => (
                <Button variant="danger" size="sm" onClick={() => setDeleteTarget(row)}>삭제</Button>
              ) },
            ]}
            rows={users}
            emptyMessage="등록된 회원이 없습니다"
          />
        )}
      </SectionCard>

      <ConfirmModal
        show={!!deleteTarget}
        title="회원 삭제"
        message={`${deleteTarget?.name || deleteTarget?.email || ''} 회원을 삭제하시겠습니까? (복원 가능)`}
        confirmLabel={deleting ? '삭제 중...' : '삭제'}
        cancelLabel="취소"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <Toast show={!!toast} message={toast} />
    </>
  );
}
