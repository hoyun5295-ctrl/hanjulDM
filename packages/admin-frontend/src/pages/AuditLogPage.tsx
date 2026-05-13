/**
 * ★ D155: 슈퍼관리자 감사 로그 조회 + 필터 + 페이징
 * backend: GET /api/admin/flyer/audit-logs?action=&from_date=&to_date=&page=&limit=
 * 응답: { logs, total, page, totalPages, actions, actionLabels }
 * 슈퍼관리자 액션은 details.actorType='super_admin' + superAdminLoginId 박힘
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Input, Select, DataTable, Badge } from '../components/ui';

interface AuditLog {
  id: string;
  userId: string | null;
  companyId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, any> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  loginId?: string;
  userName?: string;
  storeName?: string;
  companyName?: string;
}

interface AuditLogResult {
  logs: AuditLog[];
  total: number;
  page: number;
  totalPages: number;
  actions: string[];
  actionLabels: Record<string, string>;
}

export default function AuditLogPage() {
  const [result, setResult] = useState<AuditLogResult | null>(null);
  const [action, setAction] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (fromDate) params.set('from_date', fromDate);
      if (toDate) params.set('to_date', toDate);
      params.set('page', String(page));
      params.set('limit', '50');
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/audit-logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setResult(data);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '감사로그 로드 실패');
      }
    } catch (err: any) {
      setError(err.message || '감사로그 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [action, fromDate, toDate, page]);

  useEffect(() => { load(); }, [load]);

  const actor = (log: AuditLog): string => {
    const d = (log.details || {}) as any;
    if (d && d.actorType === 'super_admin') {
      const sa = d.superAdminLoginId || (d.superAdminId ? String(d.superAdminId).slice(0, 8) : '');
      return `슈퍼관리자 ${sa}`.trim();
    }
    return log.loginId || log.userName || '-';
  };

  const target = (log: AuditLog): string => {
    if (!log.targetType) return '-';
    const d = (log.details || {}) as any;
    if (log.targetType === 'company') {
      return d.companyName || (log.targetId ? String(log.targetId).slice(0, 8) : '-');
    }
    if (log.targetType === 'user') {
      return d.name || d.loginId || (log.targetId ? String(log.targetId).slice(0, 8) : '-');
    }
    return log.targetId ? String(log.targetId).slice(0, 8) : '-';
  };

  const actionVariant = (a: string): 'error' | 'warn' | 'success' | 'neutral' => {
    if (a.includes('delete')) return 'error';
    if (a.includes('restore') || a.includes('create')) return 'success';
    if (a.includes('update') || a.includes('settings')) return 'warn';
    return 'neutral';
  };

  return (
    <SectionCard
      title={`감사 로그 (${result?.total ?? 0})`}
      action={
        <div className="flex gap-2 items-end">
          <Select value={action} onChange={e => { setAction(e.target.value); setPage(1); }} className="w-36">
            <option value="">전체 액션</option>
            {(result?.actions || []).map(a => (
              <option key={a} value={a}>{(result?.actionLabels || {})[a] || a}</option>
            ))}
          </Select>
          <Input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }} className="w-36" />
          <Input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1); }} className="w-36" />
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
              { key: 'createdAt', label: '일시', render: (v) => new Date(v).toLocaleString('ko-KR') },
              { key: 'action', label: '액션', render: (v) => (
                <Badge variant={actionVariant(v)}>{(result?.actionLabels || {})[v] || v}</Badge>
              ) },
              { key: 'actor', label: '수행자', render: (_, row) => actor(row) },
              { key: 'target', label: '대상', render: (_, row) => target(row) },
              { key: 'companyName', label: '회사', render: (v) => v || '-' },
              { key: 'ipAddress', label: 'IP', render: (v) => v || '-' },
            ]}
            rows={result?.logs || []}
            emptyMessage="감사 로그가 없습니다"
          />
          {result && result.totalPages > 1 && (
            <div className="flex justify-center items-center gap-3 mt-5">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>이전</Button>
              <span className="text-sm text-text-secondary">{page} / {result.totalPages}</span>
              <Button variant="secondary" size="sm" disabled={page >= result.totalPages} onClick={() => setPage(p => p + 1)}>다음</Button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
