import { useState, useEffect } from 'react';
import './index.css';
import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import FlyerAdminDashboard from './pages/FlyerAdminDashboard';
import { useSessionTimeout } from './hooks/useSessionTimeout';
import SessionTimer from './components/SessionTimer';
import SessionTimeoutModal from './components/SessionTimeoutModal';

export const API_BASE = import.meta.env.VITE_API_URL || '';
export function getToken(): string { return localStorage.getItem('admin_token') || ''; }

/** 공통 fetch — 401 시 자동 로그아웃 */
export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.dispatchEvent(new Event('admin-auth-expired'));
    throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
  }
  return res;
}

function App() {
  const [token, setToken] = useState<string>(getToken());
  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem('admin_user');
    return saved ? JSON.parse(saved) : null;
  });

  const handleLogin = (t: string, u: any) => { setToken(t); setUser(u); };
  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    setToken(''); setUser(null);
  };
  const handlePasswordChanged = () => {
    // localStorage user mustChangePassword=false 갱신은 ChangePasswordPage에서 함
    const stored = localStorage.getItem('admin_user');
    if (stored) setUser(JSON.parse(stored));
  };

  useEffect(() => {
    const handler = () => handleLogout();
    window.addEventListener('admin-auth-expired', handler);
    return () => window.removeEventListener('admin-auth-expired', handler);
  }, []);

  const session = useSessionTimeout({ onLogout: handleLogout });

  if (!token || !user) return <LoginPage onLogin={handleLogin} />;

  // ★ 비밀번호 강제 변경 (must_change_password=TRUE)
  if (user.mustChangePassword) return <ChangePasswordPage onChanged={handlePasswordChanged} />;

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-surface border-b border-border sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-14">
          <div className="flex items-center">
            <span className="text-sm font-bold text-text">한줄전단 AI 슈퍼관리자</span>
          </div>
          <div className="flex items-center gap-3">
            <SessionTimer
              remainingSeconds={session.remainingSeconds}
              totalSeconds={session.totalSeconds}
              onExtend={session.extendSession}
            />
            <div className="pl-3 border-l border-border flex items-center gap-2">
              <div className="w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center">
                <span className="text-[10px] font-bold text-primary-600">
                  {(user.login_id || user.loginId || '?')[0].toUpperCase()}
                </span>
              </div>
              <span className="text-xs text-text-secondary">{user.login_id || user.loginId}</span>
              <button
                onClick={handleLogout}
                className="text-xs text-text-muted hover:text-error-500 transition-colors ml-1"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <FlyerAdminDashboard token={token} user={user} />
      </main>

      <SessionTimeoutModal
        isOpen={session.showWarningModal}
        remainingSeconds={session.remainingSeconds}
        onExtend={session.extendSession}
        onLogout={session.handleLogout}
      />
    </div>
  );
}

export default App;
