import { useState, useEffect } from 'react';
import './index.css';
import LoginPage from './pages/LoginPage';
// ★ 2026-08-20 슈퍼버전업 4단계 — 제작 화면 1개(FlyerComposerPage)가 옛 FlyerPage(목록+폼)를 대체(13번 설계 §1)
import FlyerComposerPage from './pages/FlyerComposerPage';
import SendPage from './pages/SendPage';
import ResultsPage from './pages/ResultsPage';
import BalancePage from './pages/BalancePage';
import UnsubscribesPage from './pages/UnsubscribesPage';
import SettingsPage from './pages/SettingsPage';
import CustomerPage from './pages/CustomerPage';
import CatalogPage from './pages/CatalogPage';
import CouponPage from './pages/CouponPage';
import PopPage from './pages/PopPage';
import OrdersPage from './pages/OrdersPage';
import PrintFlyerPage from './pages/PrintFlyerPage';
import SenderRegistrationPage from './pages/SenderRegistrationPage';
import AlimtalkPage from './pages/AlimtalkPage';
import PosAgentPage from './pages/PosAgentPage';
import { useSessionTimeout } from './hooks/useSessionTimeout';
import SessionTimer from './components/SessionTimer';
import SessionTimeoutModal from './components/SessionTimeoutModal';

export const API_BASE = import.meta.env.VITE_API_URL || '';
export function getToken(): string { return localStorage.getItem('flyer_token') || ''; }
export type Page = 'flyer' | 'send' | 'pop' | 'customers' | 'catalog' | 'coupons' | 'orders' | 'print-flyer' | 'results' | 'balance' | 'unsubscribes' | 'settings' | 'senders' | 'alimtalk' | 'pos-agent';

/** 서버(CT-F25)가 내려주는 접근 차단 코드 */
export type FlyerAccessCode =
  | 'COMPANY_SUSPENDED' | 'COMPANY_EXPIRED' | 'STORE_SUSPENDED'
  | 'STORE_PENDING' | 'STORE_STATUS_UNKNOWN' | 'PLAN_EXPIRED';

const ACCESS_CODES: string[] = [
  'COMPANY_SUSPENDED', 'COMPANY_EXPIRED', 'STORE_SUSPENDED',
  'STORE_PENDING', 'STORE_STATUS_UNKNOWN', 'PLAN_EXPIRED',
];

/** 결제로 해소 가능한 차단 = 충전관리로 유도 */
export const PAYABLE_ACCESS_CODES: string[] = ['STORE_PENDING', 'STORE_STATUS_UNKNOWN', 'PLAN_EXPIRED'];

/** 공통 fetch — 401 시 자동 로그아웃, 403(이용 차단)은 사유를 화면에 알린다 */
export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('flyer_token');
    localStorage.removeItem('flyer_user');
    window.dispatchEvent(new Event('flyer-auth-expired'));
    throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
  }
  // ★ 403 이용 차단 — 예전에는 화면이 조용히 비어 원인을 알 수 없었다.
  if (res.status === 403) {
    try {
      const data = await res.clone().json();
      if (data?.code && ACCESS_CODES.includes(data.code)) {
        window.dispatchEvent(new CustomEvent('flyer-access-blocked', {
          detail: { code: data.code, message: data.error || '이용이 제한되었습니다' },
        }));
      }
    } catch { /* 본문 없는 403은 각 화면이 처리 */ }
  }
  return res;
}

const MAIN_MENUS: { key: Page; label: string }[] = [
  { key: 'flyer', label: '전단제작' },
  { key: 'pop', label: 'POP제작' },
  { key: 'print-flyer', label: '인쇄전단' },
  { key: 'send', label: '발송' },
  { key: 'coupons', label: '쿠폰' },
  { key: 'orders', label: '주문' },
  { key: 'results', label: '결과' },
];

const MORE_MENUS: { key: Page; label: string; icon: string }[] = [
  { key: 'customers', label: '고객DB', icon: '👥' },
  { key: 'catalog', label: '상품관리', icon: '📦' },
  { key: 'balance', label: '충전관리', icon: '💳' },
  { key: 'senders', label: '발신번호', icon: '📞' },
  { key: 'alimtalk', label: '알림톡', icon: '💬' },
  { key: 'pos-agent', label: 'POS Agent', icon: '🖥️' },
  { key: 'unsubscribes', label: '수신거부', icon: '🚫' },
  { key: 'settings', label: '설정', icon: '⚙️' },
];

function App() {
  const [token, setToken] = useState<string>(getToken());
  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem('flyer_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [currentPage, setCurrentPage] = useState<Page>('flyer');
  const [showMore, setShowMore] = useState(false);

  const handleLogin = (t: string, u: any) => { setToken(t); setUser(u); };
  const handleLogout = () => {
    localStorage.removeItem('flyer_token');
    localStorage.removeItem('flyer_user');
    setToken(''); setUser(null); setCurrentPage('flyer');
  };

  const [blocked, setBlocked] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    const handler = () => handleLogout();
    window.addEventListener('flyer-auth-expired', handler);
    return () => window.removeEventListener('flyer-auth-expired', handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => setBlocked((e as CustomEvent).detail);
    window.addEventListener('flyer-access-blocked', handler);
    return () => window.removeEventListener('flyer-access-blocked', handler);
  }, []);

  // ★ 세션 30분 자동 로그아웃 (전단AI 전용 — 한줄로와 완전 분리)
  const session = useSessionTimeout({ onLogout: handleLogout });

  if (!token || !user) return <LoginPage onLogin={handleLogin} />;

  const isMoreActive = MORE_MENUS.some(m => m.key === currentPage);

  return (
    <div className="min-h-screen bg-bg">
      {/* ── 헤더 ── */}
      <header className="bg-surface border-b border-border sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-14">
          {/* 좌측: 로고 + 메인 메뉴 */}
          <div className="flex items-center">
            <button onClick={() => setCurrentPage('flyer')} className="mr-8 group">
              <span className="text-sm font-bold text-text group-hover:text-primary-600 transition-colors">{user?.storeName || user?.name || '한줄전단'}</span>
            </button>

            <nav className="flex">
              {MAIN_MENUS.map(m => (
                <button key={m.key} onClick={() => setCurrentPage(m.key)}
                  className={`px-5 h-14 text-[13px] font-semibold border-b-2 transition-all ${
                    currentPage === m.key
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-text-secondary hover:text-text hover:border-border-strong'
                  }`}
                >
                  {m.label}
                </button>
              ))}

              {/* 더보기 드롭다운 */}
              <div className="relative">
                <button
                  onClick={() => setShowMore(!showMore)}
                  className={`px-5 h-14 text-[13px] font-semibold border-b-2 transition-all flex items-center gap-1 ${
                    isMoreActive
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-text-secondary hover:text-text hover:border-border-strong'
                  }`}
                >
                  {isMoreActive ? MORE_MENUS.find(m => m.key === currentPage)?.label : '더보기'}
                  <span className={`text-[10px] transition-transform ${showMore ? 'rotate-180' : ''}`}>▼</span>
                </button>
                {showMore && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMore(false)} />
                    <div className="absolute top-full right-0 mt-0.5 bg-surface border border-border rounded-xl shadow-lg py-1.5 min-w-[160px] z-50">
                      {MORE_MENUS.map(m => (
                        <button key={m.key}
                          onClick={() => { setCurrentPage(m.key); setShowMore(false); }}
                          className={`w-full text-left px-4 py-2.5 text-[13px] flex items-center gap-2.5 transition-colors ${
                            currentPage === m.key ? 'bg-primary-50 text-primary-600 font-semibold' : 'text-text-secondary hover:bg-bg hover:text-text'
                          }`}
                        >
                          <span>{m.icon}</span>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </nav>
          </div>

          {/* 우측: 세션 타이머 + 사용자 */}
          <div className="flex items-center gap-3">
            <SessionTimer remainingSeconds={session.remainingSeconds} totalSeconds={session.totalSeconds} onExtend={session.extendSession} />
            <div className="pl-3 border-l border-border flex items-center gap-2">
              <div className="w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center">
                <span className="text-[10px] font-bold text-primary-600">{(user.loginId || '?')[0].toUpperCase()}</span>
              </div>
              <span className="text-xs text-text-secondary">{user.loginId}</span>
              <button onClick={handleLogout} className="text-xs text-text-muted hover:text-error-500 transition-colors ml-1">로그아웃</button>
            </div>
          </div>
        </div>
      </header>

      {/* ── 페이지 ── */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* ★ 이용 차단 안내 — 화면이 비어 보이는 이유를 사장님에게 알린다 */}
        {blocked && (
          <div className="mb-5 rounded-xl border border-warn-500/30 bg-warn-50 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-text">{blocked.message}</p>
              <p className="text-xs text-text-secondary mt-0.5">
                {PAYABLE_ACCESS_CODES.includes(blocked.code)
                  ? '충전관리에서 이용료를 결제하시면 바로 이용하실 수 있습니다.'
                  : '관리자 확인이 필요한 상태입니다.'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {PAYABLE_ACCESS_CODES.includes(blocked.code) && currentPage !== 'balance' && (
                <button
                  onClick={() => { setCurrentPage('balance'); setBlocked(null); }}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                >
                  충전관리로 이동
                </button>
              )}
              <button onClick={() => setBlocked(null)} className="text-xs text-text-muted hover:text-text transition-colors">닫기</button>
            </div>
          </div>
        )}
        {currentPage === 'flyer' && <FlyerComposerPage token={token} businessType={user?.businessType || 'mart'} />}
        {currentPage === 'pop' && <PopPage token={token} />}
        {currentPage === 'send' && <SendPage token={token} />}
        {currentPage === 'customers' && <CustomerPage token={token} />}
        {currentPage === 'catalog' && <CatalogPage token={token} />}
        {currentPage === 'coupons' && <CouponPage token={token} />}
        {currentPage === 'orders' && <OrdersPage token={token} />}
        {currentPage === 'print-flyer' && <PrintFlyerPage token={token} />}
        {currentPage === 'results' && <ResultsPage token={token} />}
        {currentPage === 'balance' && <BalancePage token={token} />}
        {currentPage === 'senders' && <SenderRegistrationPage token={token} />}
        {currentPage === 'alimtalk' && <AlimtalkPage token={token} />}
        {currentPage === 'pos-agent' && <PosAgentPage token={token} />}
        {currentPage === 'unsubscribes' && <UnsubscribesPage token={token} />}
        {currentPage === 'settings' && <SettingsPage token={token} />}
      </main>

      {/* ★ 세션 만료 경고 모달 */}
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
