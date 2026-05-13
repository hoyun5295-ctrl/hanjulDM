/**
 * ★ D156: 매장 사장님 발신번호 등록 신청 화면
 * backend: /api/flyer/companies/sender-registration
 *   GET /my (numbers + requests)
 *   POST /request (multer 통신가입증명원 업로드)
 *   DELETE /:id (pending 취소)
 *
 * 한줄로AI는 회사 관리자 영역인데, 한줄전단은 매장 사장님이 직접 신청.
 * 통신가입증명원(PDF/이미지) 업로드 → 슈퍼관리자 승인 → flyer_callback_numbers 자동 INSERT.
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';

interface CallbackNumber {
  id: string;
  phone: string;
  label?: string;
  is_default: boolean;
  created_at: string;
}

interface SenderRequest {
  id: string;
  phone: string;
  label?: string;
  certificate_filename?: string;
  carrier?: string;
  business_name?: string;
  business_number?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string;
  requested_at: string;
  processed_at?: string;
}

interface Props { token: string; }

export default function SenderRegistrationPage({ token: _token }: Props) {
  const [numbers, setNumbers] = useState<CallbackNumber[]>([]);
  const [requests, setRequests] = useState<SenderRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [openForm, setOpenForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/companies/sender-registration/my`);
      if (res.ok) {
        const data = await res.json();
        setNumbers(data.numbers || []);
        setRequests(data.requests || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '발신번호 정보 로드 실패');
      }
    } catch (err: any) {
      setError(err.message || '발신번호 정보 로드 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCancel = async (id: string) => {
    if (!confirm('신청을 취소하시겠습니까?')) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/companies/sender-registration/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setToast('신청이 취소되었습니다');
        setTimeout(() => setToast(''), 2500);
        load();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '취소 실패');
      }
    } catch (err: any) {
      setError(err.message || '취소 실패');
    }
  };

  const showSuccess = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2800);
    setOpenForm(false);
    load();
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { cls: string; text: string }> = {
      pending: { cls: 'bg-warn-50 text-warn-600', text: '심사 중' },
      approved: { cls: 'bg-success-50 text-success-600', text: '승인됨' },
      rejected: { cls: 'bg-error-50 text-error-600', text: '반려됨' },
    };
    const v = map[status] || { cls: 'bg-bg text-text-secondary', text: status };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${v.cls}`}>{v.text}</span>;
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">발신번호 관리</h1>
          <p className="text-sm text-text-secondary mt-1">매장 전화번호 → 고객 메시지 발신용으로 등록. 통신가입증명원 업로드 후 슈퍼관리자 승인.</p>
        </div>
        <button
          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold"
          onClick={() => setOpenForm(true)}
        >
          + 신청
        </button>
      </div>

      {error && (
        <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2">
          <p className="text-sm text-error-600">{error}</p>
        </div>
      )}

      {/* 등록된 발신번호 */}
      <section className="bg-surface border border-border rounded-xl shadow-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text">등록된 발신번호 ({numbers.length})</h3>
        </div>
        <div className="p-5">
          {loading ? (
            <p className="text-sm text-text-muted text-center py-4">로딩 중...</p>
          ) : numbers.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">아직 등록된 발신번호가 없습니다. 신청 후 슈퍼관리자 승인을 기다려주세요.</p>
          ) : (
            <div className="space-y-2">
              {numbers.map(n => (
                <div key={n.id} className="flex items-center justify-between p-3 bg-bg rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold text-text">{n.phone}</span>
                    {n.label && <span className="text-sm text-text-secondary">{n.label}</span>}
                    {n.is_default && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-50 text-primary-600">기본</span>
                    )}
                  </div>
                  <span className="text-xs text-text-muted">{new Date(n.created_at).toLocaleDateString('ko-KR')} 등록</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 신청 이력 */}
      <section className="bg-surface border border-border rounded-xl shadow-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text">신청 이력 ({requests.length})</h3>
        </div>
        <div className="p-5">
          {loading ? (
            <p className="text-sm text-text-muted text-center py-4">로딩 중...</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">신청 내역이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {requests.map(r => (
                <div key={r.id} className="p-4 bg-bg rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-base font-bold text-text">{r.phone}</span>
                      {r.label && <span className="text-sm text-text-secondary">{r.label}</span>}
                      {statusBadge(r.status)}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-text-muted">{new Date(r.requested_at).toLocaleString('ko-KR')}</span>
                      {r.status === 'pending' && (
                        <button
                          onClick={() => handleCancel(r.id)}
                          className="text-xs text-error-500 hover:text-error-600 font-medium"
                        >
                          취소
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-text-secondary space-y-0.5">
                    {r.carrier && <p>통신사: {r.carrier}</p>}
                    {r.business_name && <p>가입자명: {r.business_name}</p>}
                    {r.business_number && <p>사업자번호: {r.business_number}</p>}
                    {r.certificate_filename && <p>증명원: {r.certificate_filename}</p>}
                    {r.status === 'rejected' && r.rejection_reason && (
                      <p className="text-error-600 mt-2 p-2 bg-error-50 rounded">반려 사유: {r.rejection_reason}</p>
                    )}
                    {r.processed_at && (
                      <p className="text-text-muted mt-1">처리일: {new Date(r.processed_at).toLocaleString('ko-KR')}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {openForm && (
        <RequestFormModal
          onClose={() => setOpenForm(false)}
          onSuccess={showSuccess}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-text text-white px-5 py-2.5 rounded-xl text-sm shadow-elevated z-50 font-medium">
          {toast}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 신청 폼 모달 (multer 파일 업로드)
// ============================================================
function RequestFormModal({ onClose, onSuccess }: {
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [carrier, setCarrier] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!phone) { setError('발신번호 필수'); return; }
    if (!file) { setError('통신가입증명원 파일 필수'); return; }

    setSaving(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('phone', phone);
      if (label) formData.append('label', label);
      if (carrier) formData.append('carrier', carrier);
      if (businessName) formData.append('business_name', businessName);
      if (businessNumber) formData.append('business_number', businessNumber);
      if (notes) formData.append('notes', notes);
      formData.append('certificate', file);

      const token = localStorage.getItem('token') || '';
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // ★ multipart/form-data — Content-Type 헤더 박힘 X (브라우저 자동 boundary)
      const res = await fetch(`${API_BASE}/api/flyer/companies/sender-registration/request`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (res.ok) {
        onSuccess('발신번호 등록 신청 완료. 슈퍼관리자 검토 후 승인 처리됩니다.');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '신청 실패');
      }
    } catch (err: any) {
      setError(err.message || '신청 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4 overflow-y-auto">
      <div className="bg-surface rounded-2xl shadow-modal max-w-lg w-full p-6 my-8">
        <h3 className="text-base font-bold text-text mb-2">발신번호 등록 신청</h3>
        <p className="text-sm text-text-secondary mb-4">매장 전화번호 등록 후 통신가입증명원(PDF 또는 이미지)을 업로드해주세요. 슈퍼관리자가 검토 후 승인 처리합니다.</p>

        {error && (
          <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-3">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        )}

        <div className="space-y-3 mb-5">
          <Field label="발신번호 *">
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="02-1234-5678 또는 010-1234-5678"
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </Field>
          <Field label="라벨 (선택)">
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="예: 본점 대표번호"
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="통신사">
              <select
                value={carrier}
                onChange={e => setCarrier(e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">선택</option>
                <option value="SKT">SKT</option>
                <option value="KT">KT</option>
                <option value="LGU+">LGU+</option>
                <option value="기타">기타(알뜰폰 등)</option>
              </select>
            </Field>
            <Field label="가입자명">
              <input
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                placeholder="통신가입자명"
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </Field>
          </div>
          <Field label="사업자번호 (선택)">
            <input
              value={businessNumber}
              onChange={e => setBusinessNumber(e.target.value)}
              placeholder="000-00-00000"
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </Field>
          <Field label="통신가입증명원 * (PDF/이미지, 10MB 이하)">
            <input
              type="file"
              accept=".pdf,image/*"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-text file:mr-3 file:px-3 file:py-1.5 file:bg-primary-50 file:text-primary-600 file:border-0 file:rounded-lg file:font-medium hover:file:bg-primary-100 cursor-pointer"
            />
            {file && <p className="text-xs text-text-secondary mt-1">{file.name} · {(file.size / 1024 / 1024).toFixed(2)}MB</p>}
          </Field>
          <Field label="메모 (선택)">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="추가 안내 사항이 있으면 작성"
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </Field>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-surface border border-border hover:bg-bg text-text rounded-xl text-sm font-semibold"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold disabled:opacity-40"
          >
            {saving ? '신청 중...' : '신청'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>
      {children}
    </div>
  );
}
