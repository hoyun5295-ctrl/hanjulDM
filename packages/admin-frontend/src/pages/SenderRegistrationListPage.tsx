/**
 * ★ D156: 슈퍼관리자 발신번호 등록 신청 처리 화면
 * backend: GET /api/admin/flyer/sender-registrations?status=
 *          GET /api/admin/flyer/sender-registrations/:id/certificate (다운로드)
 *          POST /api/admin/flyer/sender-registrations/:id/approve
 *          POST /api/admin/flyer/sender-registrations/:id/reject (rejection_reason)
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch, getToken } from '../App';
import { SectionCard, Button, Select, DataTable, Badge, Toast } from '../components/ui';

interface SenderRequest {
  id: string;
  company_id: string;
  user_id: string;
  phone: string;
  label?: string;
  certificate_url?: string;
  certificate_filename?: string;
  carrier?: string;
  business_name?: string;
  business_number?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string;
  notes?: string;
  requested_at: string;
  processed_at?: string;
  company_name?: string;
  login_id?: string;
  user_name?: string;
  store_name?: string;
}

export default function SenderRegistrationListPage() {
  const [items, setItems] = useState<SenderRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [detailTarget, setDetailTarget] = useState<SenderRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SenderRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/sender-registrations${qs}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '발신번호 신청 목록 로드 실패');
      }
    } catch (err: any) {
      setError(err.message || '발신번호 신청 목록 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: string) => {
    if (!confirm('이 신청을 승인하시겠습니까? flyer_callback_numbers에 신규 row가 등록됩니다.')) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/sender-registrations/${id}/approve`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setToast(data.message || '승인 완료');
        setTimeout(() => setToast(''), 2500);
        setDetailTarget(null);
        load();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '승인 실패');
      }
    } catch (err: any) {
      setError(err.message || '승인 실패');
    }
  };

  const statusBadge = (s: string) => {
    if (s === 'pending') return <Badge variant="warn">대기</Badge>;
    if (s === 'approved') return <Badge variant="success">승인</Badge>;
    if (s === 'rejected') return <Badge variant="error">반려</Badge>;
    return <Badge variant="neutral">{s}</Badge>;
  };

  const downloadCert = (id: string, filename?: string) => {
    const token = getToken();
    const url = `${API_BASE}/api/admin/flyer/sender-registrations/${id}/certificate`;
    // Authorization 헤더 필요 → fetch + blob + a.download
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.blob() : Promise.reject(new Error('다운로드 실패')))
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || `certificate-${id}`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(err => setError(err.message || '다운로드 실패'));
  };

  return (
    <>
      <SectionCard
        title={`발신번호 등록 신청 (${items.length})`}
        action={
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-36">
            <option value="">전체</option>
            <option value="pending">대기 중</option>
            <option value="approved">승인됨</option>
            <option value="rejected">반려됨</option>
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
              { key: 'requested_at', label: '신청일', render: (v) => new Date(v).toLocaleString('ko-KR') },
              { key: 'company_name', label: '회사' },
              { key: 'store_name', label: '매장' },
              { key: 'phone', label: '발신번호' },
              { key: 'carrier', label: '통신사', render: (v) => v || '-' },
              { key: 'business_name', label: '가입자명', render: (v) => v || '-' },
              { key: 'status', label: '상태', render: (v) => statusBadge(v) },
              { key: 'action', label: '액션', align: 'right', render: (_, row) => (
                <div className="flex gap-1 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setDetailTarget(row)}>상세</Button>
                  {row.status === 'pending' && (
                    <>
                      <Button variant="primary" size="sm" onClick={() => handleApprove(row.id)}>승인</Button>
                      <Button variant="danger" size="sm" onClick={() => setRejectTarget(row)}>반려</Button>
                    </>
                  )}
                </div>
              ) },
            ]}
            rows={items}
            emptyMessage="신청 내역이 없습니다"
          />
        )}
      </SectionCard>

      {detailTarget && (
        <DetailModal
          target={detailTarget}
          onClose={() => setDetailTarget(null)}
          onApprove={() => handleApprove(detailTarget.id)}
          onReject={() => { setRejectTarget(detailTarget); setDetailTarget(null); }}
          onDownloadCert={() => downloadCert(detailTarget.id, detailTarget.certificate_filename)}
        />
      )}

      {rejectTarget && (
        <RejectModal
          target={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onSuccess={(msg) => {
            setToast(msg);
            setTimeout(() => setToast(''), 2500);
            setRejectTarget(null);
            load();
          }}
        />
      )}

      <Toast show={!!toast} message={toast} />
    </>
  );
}

function DetailModal({ target, onClose, onApprove, onReject, onDownloadCert }: {
  target: SenderRequest;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDownloadCert: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4">
      <div className="bg-surface rounded-2xl shadow-modal max-w-lg w-full p-6">
        <h3 className="text-base font-bold text-text mb-4">발신번호 등록 신청 상세</h3>
        <div className="space-y-2 mb-5">
          <Row label="회사" value={target.company_name} />
          <Row label="신청 매장" value={target.store_name || target.user_name || target.login_id} />
          <Row label="발신번호" value={<b className="text-text">{target.phone}</b>} />
          <Row label="라벨" value={target.label || '-'} />
          <Row label="통신사" value={target.carrier || '-'} />
          <Row label="가입자명" value={target.business_name || '-'} />
          <Row label="사업자번호" value={target.business_number || '-'} />
          <Row label="신청일" value={new Date(target.requested_at).toLocaleString('ko-KR')} />
          {target.notes && <Row label="메모" value={target.notes} />}
          {target.certificate_filename && (
            <div className="pt-2 border-t border-border">
              <button
                onClick={onDownloadCert}
                className="text-sm text-primary-600 hover:text-primary-700 font-semibold underline"
              >
                통신가입증명원 다운로드 ({target.certificate_filename})
              </button>
            </div>
          )}
          {target.status === 'rejected' && target.rejection_reason && (
            <div className="pt-2 border-t border-border">
              <p className="text-sm text-error-600">반려 사유: {target.rejection_reason}</p>
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>닫기</Button>
          {target.status === 'pending' && (
            <>
              <Button variant="danger" className="flex-1" onClick={onReject}>반려</Button>
              <Button className="flex-1" onClick={onApprove}>승인</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-24 flex-shrink-0 text-text-secondary">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  );
}

function RejectModal({ target, onClose, onSuccess }: {
  target: SenderRequest;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleReject = async () => {
    if (!reason.trim()) { setError('반려 사유 필수'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/sender-registrations/${target.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejection_reason: reason }),
      });
      if (res.ok) {
        onSuccess('반려 처리 완료');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '반려 실패');
      }
    } catch (err: any) {
      setError(err.message || '반려 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4">
      <div className="bg-surface rounded-2xl shadow-modal max-w-md w-full p-6">
        <h3 className="text-base font-bold text-text mb-2">반려 처리</h3>
        <p className="text-sm text-text-secondary mb-4">
          {target.company_name} · {target.phone}
        </p>
        {error && (
          <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-3">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        )}
        <div className="mb-5">
          <label className="block text-xs font-medium text-text-secondary mb-1.5">반려 사유 *</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={4}
            placeholder="신청자에게 표시될 반려 사유를 작성하세요"
            className="w-full px-3 py-2.5 border border-border rounded-lg text-sm text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          />
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>취소</Button>
          <Button variant="danger" className="flex-1" onClick={handleReject} disabled={saving}>
            {saving ? '처리 중...' : '반려'}
          </Button>
        </div>
      </div>
    </div>
  );
}

