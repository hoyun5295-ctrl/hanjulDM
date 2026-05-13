/**
 * ★ D155: 회원 신규 + 비밀번호 리셋 모달 (D113 본진 매트릭스 hanjulDM 미러)
 * backend: POST /api/admin/flyer/users (회사+아이디+비밀번호+이름+이메일+role)
 *          POST /api/admin/flyer/users/:id/reset-password (newPassword, 8자 이상)
 */
import { useState, useEffect } from 'react';
import { API_BASE, apiFetch } from '../App';
import { Button, Input, Select } from './ui';

interface UserFormProps {
  mode: 'create' | 'reset-password';
  target?: { id: string; name?: string; email?: string; login_id?: string; company_name?: string } | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

interface Company { id: string; company_name?: string; }

export default function UserFormModal({ mode, target, onClose, onSuccess }: UserFormProps) {
  const [form, setForm] = useState<any>({ role: 'flyer_staff' });
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: any) => setForm((prev: any) => ({ ...prev, [k]: v }));

  // create 모드: 회사 목록 로드
  useEffect(() => {
    if (mode !== 'create') return;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/admin/flyer/companies`);
        if (res.ok) {
          const data = await res.json();
          setCompanies(data.items || data || []);
        }
      } catch {}
    })();
  }, [mode]);

  const handleCreate = async () => {
    if (!form.company_id || !form.login_id || !form.password) {
      setError('회사, 아이디, 비밀번호는 필수');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        onSuccess('회원 등록 완료');
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

  const handleReset = async () => {
    if (!target) return;
    if (newPassword.length < 8) { setError('비밀번호는 8자 이상'); return; }
    if (newPassword !== newPasswordConfirm) { setError('비밀번호 확인이 일치하지 않습니다'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/users/${target.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      if (res.ok) {
        onSuccess(`${target.name || target.login_id || target.email} 비밀번호 초기화 완료`);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '비밀번호 초기화 실패');
      }
    } catch (err: any) {
      setError(err.message || '비밀번호 초기화 실패');
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'reset-password' && target) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4">
        <div className="bg-surface rounded-2xl shadow-modal max-w-md w-full p-6">
          <h3 className="text-base font-bold text-text mb-2">비밀번호 초기화</h3>
          <p className="text-sm text-text-secondary mb-4">
            대상: <b className="text-text">{target.name || target.email || target.login_id}</b>
            {target.company_name && <span className="text-text-muted"> · {target.company_name}</span>}
          </p>
          {error && (
            <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-3">
              <p className="text-sm text-error-600">{error}</p>
            </div>
          )}
          <div className="space-y-3 mb-5">
            <Input
              label="새 비밀번호 (8자 이상)"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="새 비밀번호"
              autoComplete="new-password"
            />
            <Input
              label="비밀번호 확인"
              type="password"
              value={newPasswordConfirm}
              onChange={e => setNewPasswordConfirm(e.target.value)}
              placeholder="다시 입력"
              autoComplete="new-password"
            />
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose}>취소</Button>
            <Button className="flex-1" onClick={handleReset} disabled={saving}>{saving ? '처리 중...' : '초기화'}</Button>
          </div>
        </div>
      </div>
    );
  }

  // create 모드
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4">
      <div className="bg-surface rounded-2xl shadow-modal max-w-md w-full p-6">
        <h3 className="text-base font-bold text-text mb-4">신규 회원 등록</h3>
        {error && (
          <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-3">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        )}
        <div className="space-y-3 mb-5">
          <Select label="회사 *" value={form.company_id || ''} onChange={e => set('company_id', e.target.value)}>
            <option value="">선택</option>
            {companies.map(c => (<option key={c.id} value={c.id}>{c.company_name || c.id}</option>))}
          </Select>
          <Input label="아이디 *" value={form.login_id || ''} onChange={e => set('login_id', e.target.value)} />
          <Input label="비밀번호 *" type="password" value={form.password || ''} onChange={e => set('password', e.target.value)} autoComplete="new-password" />
          <Input label="이름" value={form.name || ''} onChange={e => set('name', e.target.value)} />
          <Input label="이메일" value={form.email || ''} onChange={e => set('email', e.target.value)} />
          <Select label="권한" value={form.role || 'flyer_staff'} onChange={e => set('role', e.target.value)}>
            <option value="flyer_admin">flyer_admin (매장 사장님)</option>
            <option value="flyer_staff">flyer_staff (매장 직원)</option>
          </Select>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>취소</Button>
          <Button className="flex-1" onClick={handleCreate} disabled={saving}>{saving ? '저장 중...' : '등록'}</Button>
        </div>
      </div>
    </div>
  );
}
