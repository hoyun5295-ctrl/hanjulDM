/**
 * 한줄전단 슈퍼관리자 — 비밀번호 강제 변경 페이지
 * must_change_password=TRUE 시 진입. 변경 완료 시 onChanged 콜백.
 */
import { useState } from 'react';
import { API_BASE, apiFetch } from '../App';
import { Button, Input } from '../components/ui';

interface Props {
  onChanged: () => void;
}

export default function ChangePasswordPage({ onChanged }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('새 비밀번호는 8자 이상이어야 합니다.'); return; }
    if (newPassword !== confirmPassword) { setError('새 비밀번호가 일치하지 않습니다.'); return; }
    if (currentPassword === newPassword) { setError('기존 비밀번호와 다른 비밀번호를 입력하세요.'); return; }

    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/super/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        // localStorage user 갱신 (mustChangePassword=false)
        const stored = localStorage.getItem('admin_user');
        if (stored) {
          const u = JSON.parse(stored);
          u.mustChangePassword = false;
          localStorage.setItem('admin_user', JSON.stringify(u));
        }
        onChanged();
      } else {
        setError(data.error || '비밀번호 변경에 실패했습니다.');
      }
    } catch {
      setError('서버 연결에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-card p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-warn-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-warn-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-text">비밀번호 변경 필요</h2>
          <p className="text-sm text-text-secondary mt-1">보안을 위해 비밀번호를 변경해주세요.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="현재 비밀번호"
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            placeholder="현재 비밀번호 입력"
            autoFocus
          />
          <Input
            label="새 비밀번호 (8자 이상)"
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="새 비밀번호 입력"
          />
          <Input
            label="새 비밀번호 확인"
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="새 비밀번호 재입력"
          />

          {error && (
            <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2">
              <p className="text-sm text-error-600">{error}</p>
            </div>
          )}

          <Button size="lg" className="w-full" disabled={loading || !currentPassword || !newPassword || !confirmPassword}>
            {loading ? '변경 중...' : '비밀번호 변경'}
          </Button>
        </form>
      </div>
    </div>
  );
}
