import { useState } from 'react';
import { API_BASE } from '../App';
import { Button, Input } from '../components/ui';

interface Props { onLogin: (token: string, user: any) => void; }

export default function LoginPage({ onLogin }: Props) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ★ TOTP state (한줄AI 미러)
  const [showTotp, setShowTotp] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [enrollmentData, setEnrollmentData] = useState<{
    enrollToken: string;
    qrDataUrl: string;
    backupCodes: string[];
    loginId: string;
  } | null>(null);
  const [enrollStep, setEnrollStep] = useState<'backup' | 'verify'>('backup');
  const [enrollCode, setEnrollCode] = useState('');
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollError, setEnrollError] = useState('');
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/flyer/super/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login_id: loginId.trim(),
          password,
          totpCode: showTotp ? totpCode.trim() : undefined,
        }),
      });
      const data = await res.json();

      // ★ enrollment 분기 (totp_enabled=false 첫 로그인)
      if (data.enrollmentRequired) {
        setEnrollmentData({
          enrollToken: data.enrollToken,
          qrDataUrl: data.qrDataUrl,
          backupCodes: data.backupCodes,
          loginId: data.loginId,
        });
        setEnrollStep('backup');
        setBackupAcknowledged(false);
        setEnrollCode('');
        setEnrollError('');
        setLoading(false);
        return;
      }

      // ★ needTotp 분기 (totp_enabled=true 두 번째 단계)
      if (!res.ok && data.needTotp) {
        setShowTotp(true);
        setTotpCode('');
        setError(data.error || 'OTP 코드를 입력하세요.');
        setLoading(false);
        return;
      }

      if (res.ok && data.token) {
        localStorage.setItem('admin_token', data.token);
        localStorage.setItem('admin_user', JSON.stringify(data.user));
        onLogin(data.token, data.user);
      } else {
        setError(data.error || '로그인에 실패했습니다.');
      }
    } catch {
      setError('서버 연결에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmEnrollment = async () => {
    if (!enrollmentData) return;
    setEnrollError('');
    if (!/^\d{6}$/.test(enrollCode)) {
      setEnrollError('6자리 숫자 코드를 입력하세요.');
      return;
    }
    setEnrollLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/flyer/super/confirm-totp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollToken: enrollmentData.enrollToken, code: enrollCode }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setEnrollError(errData.error || 'OTP 검증에 실패했습니다.');
        return;
      }
      const result = await res.json();
      localStorage.setItem('admin_token', result.token);
      localStorage.setItem('admin_user', JSON.stringify(result.user));
      onLogin(result.token, result.user);
    } catch {
      setEnrollError('등록 중 오류가 발생했습니다.');
    } finally {
      setEnrollLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex">
      {/* 좌측: 브랜드 패널 */}
      <div className="hidden lg:flex w-[480px] bg-gradient-to-br from-slate-800 via-slate-900 to-gray-900 flex-col justify-between p-12 relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-3xl font-bold text-white leading-snug">
            <span className="font-black">한줄전단 AI</span><br/>슈퍼관리자 콘솔
          </h1>
          <p className="text-white/60 mt-4 text-sm leading-relaxed">
            매장 회사 관리 · 통계 · 정산<br/>
            한줄전단 운영 전반 관리
          </p>
        </div>

        <div className="relative z-10 space-y-3">
          <div className="text-white/30 text-xs leading-relaxed">
            <p><span className="font-semibold">주식회사 인비토</span> | 대표이사 유호윤</p>
            <p>사업자등록번호 667-86-00578 | 통신판매신고 제 2017-서울송파-0160호</p>
            <p>서울시 송파구 오금로36길 46, 신승빌딩 4F | 문의전화 1800-8125</p>
            <p className="mt-1">&copy; {new Date().getFullYear()} INVITO. All rights reserved.</p>
          </div>
        </div>

        <div className="absolute top-[-60px] right-[-60px] w-[200px] h-[200px] bg-white/5 rounded-full" />
        <div className="absolute bottom-[-40px] left-[-40px] w-[160px] h-[160px] bg-white/5 rounded-full" />
        <div className="absolute top-1/2 right-[-20px] w-[100px] h-[100px] bg-white/5 rounded-full" />
      </div>

      {/* 우측: 로그인 폼 */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-sm">
            <h2 className="text-xl font-bold text-text mb-1">슈퍼관리자 로그인</h2>
            <p className="text-sm text-text-secondary mb-8">
              <span className="font-semibold">한줄전단 AI 슈퍼관리자</span> 계정으로 로그인하세요
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input label="아이디" type="text" value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="아이디를 입력하세요" autoFocus />
              <Input label="비밀번호" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호를 입력하세요" />

              {showTotp && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">OTP 코드 (6자리)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-3 py-2.5 border border-border rounded-lg text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-center text-2xl font-mono tracking-widest"
                    placeholder="000000"
                    autoFocus
                  />
                  <p className="text-xs text-text-muted mt-1.5">Google Authenticator 앱의 6자리 코드. 폰 분실 시 백업 코드(8자 hex)도 사용 가능.</p>
                </div>
              )}

              {error && (
                <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2">
                  <p className="text-sm text-error-600">{error}</p>
                </div>
              )}

              <Button size="lg" className="w-full" disabled={loading || !loginId || !password}>
                {loading ? '로그인 중...' : '로그인'}
              </Button>
            </form>

            <p className="text-center text-xs text-text-muted mt-6">문의전화 1800-8125</p>
          </div>
        </div>

        <footer className="lg:hidden bg-bg text-text-muted py-4 px-4">
          <div className="text-center text-xs leading-relaxed">
            <p>주식회사 인비토 | 667-86-00578</p>
            <p className="mt-1">&copy; {new Date().getFullYear()} INVITO. All rights reserved.</p>
          </div>
        </footer>
      </div>

      {/* ★ TOTP enrollment 모달 (2단계: backup → verify) */}
      {enrollmentData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-2xl shadow-modal w-full max-w-md overflow-hidden">
            {enrollStep === 'backup' ? (
              <>
                <div className="px-6 pt-8 pb-2 text-center">
                  <div className="w-14 h-14 bg-bg rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-text" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-text">2단계 인증(OTP) 등록</h3>
                  <p className="text-sm text-text-secondary mt-2">Google Authenticator 앱으로 QR 스캔 후 6자리 코드 입력</p>
                </div>
                <div className="px-6 pb-6 pt-2 space-y-4">
                  <div className="flex justify-center bg-bg rounded-xl p-4">
                    <img src={enrollmentData.qrDataUrl} alt="OTP QR" className="w-48 h-48" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-text mb-2">백업 코드 (폰 분실 대비, 1회용 · 안전 보관)</p>
                    <div className="bg-warn-50 border border-warn-500/30 rounded-xl p-3 grid grid-cols-2 gap-1.5 font-mono text-xs">
                      {enrollmentData.backupCodes.map((c, i) => (
                        <div key={i} className="px-2 py-1 bg-surface rounded border border-warn-500/20 text-center">{c}</div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(enrollmentData.backupCodes.join('\n'))}
                      className="mt-2 text-xs text-text-secondary hover:text-text underline"
                    >
                      전체 복사
                    </button>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={backupAcknowledged}
                      onChange={(e) => setBackupAcknowledged(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-border text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-xs text-text-secondary">백업 코드를 안전한 곳에 저장했습니다 (이 화면을 떠나면 다시 볼 수 없음)</span>
                  </label>
                  <Button
                    onClick={() => setEnrollStep('verify')}
                    disabled={!backupAcknowledged}
                    className="w-full"
                  >
                    다음 (6자리 코드 입력)
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="px-6 pt-8 pb-2 text-center">
                  <div className="w-14 h-14 bg-bg rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-text" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-text">등록 확인</h3>
                  <p className="text-sm text-text-secondary mt-2">{enrollmentData.loginId} · 앱에 표시된 6자리 코드</p>
                </div>
                <div className="px-6 pb-6 pt-4 space-y-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={enrollCode}
                    onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-4 py-3 rounded-xl border border-border focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-center text-2xl font-mono tracking-widest"
                    placeholder="000000"
                    autoFocus
                  />
                  {enrollError && (
                    <div className="bg-error-50 border border-error-500/20 rounded-xl px-4 py-2.5 text-sm text-error-600">
                      {enrollError}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setEnrollStep('backup')} disabled={enrollLoading} className="flex-1">
                      이전
                    </Button>
                    <Button onClick={handleConfirmEnrollment} disabled={enrollLoading || enrollCode.length !== 6} className="flex-1">
                      {enrollLoading ? '확인 중...' : '등록 확인'}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
