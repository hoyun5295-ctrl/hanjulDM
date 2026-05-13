/**
 * ★ D155: 회사(총판) 신규/수정 모달 (D114 본진 매트릭스 hanjulDM 미러)
 * backend: POST /api/admin/flyer/companies (회사+관리자 동시 생성)
 *          GET /api/admin/flyer/companies/:id (회사 상세 + users 리스트 + customerCount)
 *          PUT /api/admin/flyer/companies/:id (22 필드 수정)
 */
import { useState, useEffect } from 'react';
import { API_BASE, apiFetch } from '../App';
import { Button, Input, Select } from './ui';

interface CompanyFormProps {
  mode: 'create' | 'edit';
  targetId: string | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

interface BusinessType { type_code: string; type_name: string; }

export default function CompanyFormModal({ mode, targetId, onClose, onSuccess }: CompanyFormProps) {
  const [form, setForm] = useState<any>({ business_type: 'mart', plan_type: 'flyer_basic', monthly_fee: 150000 });
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: any) => setForm((prev: any) => ({ ...prev, [k]: v }));

  // 업종 목록 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/admin/flyer/business-types`);
        if (res.ok) {
          const data = await res.json();
          setBusinessTypes(Array.isArray(data) ? data : []);
        }
      } catch {}
    })();
  }, []);

  // edit 모드: 기존 회사 정보 로드
  useEffect(() => {
    if (mode !== 'edit' || !targetId) return;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/admin/flyer/companies/${targetId}`);
        if (res.ok) {
          const data = await res.json();
          setForm(data);
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error || '회사 정보 로드 실패');
        }
      } catch (err: any) {
        setError(err.message || '회사 정보 로드 실패');
      } finally {
        setLoading(false);
      }
    })();
  }, [mode, targetId]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const url = mode === 'create'
        ? `${API_BASE}/api/admin/flyer/companies`
        : `${API_BASE}/api/admin/flyer/companies/${targetId}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        onSuccess(mode === 'create' ? '회사(총판) 등록 완료' : '회사 정보 수정 완료');
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
        <h3 className="text-base font-bold text-text mb-4">
          {mode === 'create' ? '신규 회사(총판) 등록' : `회사 정보 수정 — ${form.company_name || ''}`}
        </h3>
        {error && (
          <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-3">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        )}
        {loading ? (
          <p className="text-sm text-text-muted text-center py-8">로딩 중...</p>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            <Section title="기본 정보">
              <Grid2>
                <Input label="회사명 *" value={form.company_name || ''} onChange={e => set('company_name', e.target.value)} />
                <Select label="업종 *" value={form.business_type || 'mart'} onChange={e => set('business_type', e.target.value)}>
                  {businessTypes.map(b => (<option key={b.type_code} value={b.type_code}>{b.type_name}</option>))}
                </Select>
                <Input label="사업자번호" value={form.business_number || ''} onChange={e => set('business_number', e.target.value)} />
                <Input label="대표자명" value={form.owner_name || ''} onChange={e => set('owner_name', e.target.value)} />
                <Input label="대표자 연락처" value={form.owner_phone || ''} onChange={e => set('owner_phone', e.target.value)} />
                <Input label="POS 종류" value={form.pos_type || ''} onChange={e => set('pos_type', e.target.value)} placeholder="예: ASP, MS-SQL" />
                <Input label="주소" value={form.address || ''} onChange={e => set('address', e.target.value)} />
                <Input label="영업시간" value={form.store_hours || ''} onChange={e => set('store_hours', e.target.value)} />
              </Grid2>
            </Section>

            <Section title="사업자등록증">
              <Grid2>
                <Input label="상호" value={form.business_reg_name || ''} onChange={e => set('business_reg_name', e.target.value)} />
                <Input label="대표자명" value={form.business_reg_owner || ''} onChange={e => set('business_reg_owner', e.target.value)} />
                <Input label="업태" value={form.business_category || ''} onChange={e => set('business_category', e.target.value)} />
                <Input label="종목" value={form.business_item || ''} onChange={e => set('business_item', e.target.value)} />
                <Input label="사업장 주소" value={form.business_address || ''} onChange={e => set('business_address', e.target.value)} />
              </Grid2>
            </Section>

            <Section title="세금계산서">
              <Grid2>
                <Input label="이메일" value={form.tax_email || ''} onChange={e => set('tax_email', e.target.value)} />
                <Input label="담당자명" value={form.tax_manager_name || ''} onChange={e => set('tax_manager_name', e.target.value)} />
                <Input label="담당자 연락처" value={form.tax_manager_phone || ''} onChange={e => set('tax_manager_phone', e.target.value)} />
              </Grid2>
            </Section>

            {mode === 'create' && (
              <Section title="관리자 계정 (회사 + 관리자 동시 생성)">
                <Grid2>
                  <Input label="관리자 아이디 *" value={form.admin_login_id || ''} onChange={e => set('admin_login_id', e.target.value)} />
                  <Input label="관리자 비밀번호 *" type="password" value={form.admin_password || ''} onChange={e => set('admin_password', e.target.value)} />
                  <Input label="관리자 이름" value={form.admin_name || ''} onChange={e => set('admin_name', e.target.value)} />
                  <Input label="관리자 이메일" value={form.admin_email || ''} onChange={e => set('admin_email', e.target.value)} />
                </Grid2>
              </Section>
            )}

            {mode === 'edit' && (
              <>
                <Section title="과금 / 결제">
                  <Grid2>
                    <Input label="월 요금 (원)" type="number" value={String(form.monthly_fee || '')} onChange={e => set('monthly_fee', Number(e.target.value))} />
                    <Select label="결제 상태" value={form.payment_status || 'active'} onChange={e => set('payment_status', e.target.value)}>
                      <option value="active">active</option>
                      <option value="suspended">suspended</option>
                      <option value="expired">expired</option>
                    </Select>
                    <Input label="SMS 단가" type="number" value={String(form.sms_unit_price || '')} onChange={e => set('sms_unit_price', Number(e.target.value))} />
                    <Input label="LMS 단가" type="number" value={String(form.lms_unit_price || '')} onChange={e => set('lms_unit_price', Number(e.target.value))} />
                    <Input label="MMS 단가" type="number" value={String(form.mms_unit_price || '')} onChange={e => set('mms_unit_price', Number(e.target.value))} />
                    <Input label="080 수신거부 번호" value={form.opt_out_080_number || ''} onChange={e => set('opt_out_080_number', e.target.value)} />
                  </Grid2>
                </Section>

                {form.users && Array.isArray(form.users) && form.users.length > 0 && (
                  <Section title={`소속 회원 (${form.users.length}명)`}>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {form.users.map((u: any) => (
                        <div key={u.id} className="text-xs bg-bg rounded-lg px-3 py-2 flex justify-between">
                          <span><b className="text-text">{u.name || u.email}</b> · {u.role}</span>
                          <span className="text-text-muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('ko-KR') : '미접속'}</span>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {form.customerCount !== undefined && (
                  <p className="text-xs text-text-secondary">고객 DB: <b className="text-text">{form.customerCount.toLocaleString()}명</b></p>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <Button variant="secondary" className="flex-1" onClick={onClose}>취소</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving || loading}>
            {saving ? '저장 중...' : (mode === 'create' ? '등록' : '저장')}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
