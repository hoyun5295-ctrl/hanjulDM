/**
 * 발신프로필 대행 등록 모달
 *
 * 2-Step Wizard:
 *  1) 회사 선택 + yellow_id + 사장님 휴대폰 + 카테고리 → IMC 토큰 발급 ("인증 요청")
 *  2) 사장님 휴대폰에 SMS 인증 코드 도착 → 사장님이 슈퍼관리자에게 전달 →
 *     슈퍼관리자가 token + 코드 + 프로필명 입력 → createSender → DB INSERT (즉시 APPROVED)
 *
 * 한줄AI 본진 SenderRegistrationWizard 패턴 미러 + 대행 흐름 단순화 (승인 단계 제거).
 */

import { useEffect, useState } from 'react';

interface CategoryNode {
  category_code: string;
  parent_code: string | null;
  level: number;
  name: string;
}

interface Company {
  id: string;
  company_name: string;
}

interface Props {
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}

function getToken() {
  return localStorage.getItem('flyerSuperToken') || '';
}

export default function AlimtalkSenderModal({ companies, onClose, onSaved }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [targetCompanyId, setTargetCompanyId] = useState('');
  const [yellowId, setYellowId] = useState('@');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [profileName, setProfileName] = useState('');
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [l1Code, setL1Code] = useState('');
  const [l2Code, setL2Code] = useState('');
  const [categoryCode, setCategoryCode] = useState('');

  // Step 2
  const [token, setToken] = useState('');

  const authHeader = () => ({
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => {
    // 카테고리 로딩
    (async () => {
      try {
        const res = await fetch('/api/admin/alimtalk/categories/sender', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        const data = await res.json();
        if (data.success) setCategories(data.categories || []);
      } catch {
        /* noop */
      }
    })();
  }, []);

  const l1Options = categories.filter((c) => c.level === 1);
  const l2Options = categories.filter((c) => c.level === 2 && c.parent_code === l1Code);
  const l3Options = categories.filter((c) => c.level === 3 && c.parent_code === l2Code);

  const requestToken = async () => {
    setError(null);
    if (!targetCompanyId) { setError('회사를 선택하세요'); return; }
    if (!yellowId || yellowId.length < 2) { setError('카카오 채널 ID(@시작)를 입력하세요'); return; }
    if (!phoneNumber || !/^01\d{8,9}$/.test(phoneNumber.replace(/\D/g, ''))) {
      setError('사장님 카카오 채널 관리자 휴대폰을 정확히 입력하세요 (010-xxxx-xxxx)');
      return;
    }
    if (!categoryCode) { setError('카테고리(소분류)를 선택하세요'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/alimtalk/senders/token', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ yellowId, phoneNumber: phoneNumber.replace(/\D/g, '') }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data?.error || data?.imc?.message || '토큰 발급 실패');
        return;
      }
      const tk = data.imc?.data?.token || data.imc?.token || '';
      if (!tk) {
        setError('토큰 발급 응답에서 token을 찾을 수 없습니다');
        return;
      }
      setToken(tk);
      setStep(2);
    } catch (e: any) {
      setError(e?.message || '토큰 발급 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!token) { setError('토큰이 없습니다. Step 1을 다시 진행하세요'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/alimtalk/senders', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({
          token,
          yellowId,
          phoneNumber: phoneNumber.replace(/\D/g, ''),
          categoryCode,
          targetCompanyId,
          profileName: profileName || yellowId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data?.error || '발신프로필 등록 실패');
        return;
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message || '발신프로필 등록 실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex justify-between items-center">
          <h3 className="text-lg font-semibold">발신프로필 대행 등록</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="px-6 py-4">
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className={`px-2 py-1 rounded ${step >= 1 ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
              1. 정보 입력
            </span>
            <span className="text-gray-300">→</span>
            <span className={`px-2 py-1 rounded ${step >= 2 ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
              2. 사장님 인증코드 입력
            </span>
          </div>

          {step === 1 && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">대상 회사 *</label>
                <select
                  value={targetCompanyId}
                  onChange={(e) => setTargetCompanyId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">회사를 선택하세요</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">카카오 채널 ID *</label>
                <input
                  type="text"
                  value={yellowId}
                  onChange={(e) => setYellowId(e.target.value.startsWith('@') ? e.target.value : `@${e.target.value}`)}
                  placeholder="@yourchannel"
                  className="w-full px-3 py-2 border rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">사장님의 카카오톡 채널 검색 ID (@로 시작)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사장님 카카오 채널 관리자 휴대폰 *</label>
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="010-1234-5678"
                  className="w-full px-3 py-2 border rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">
                  이 번호로 IMC가 인증 코드 SMS를 발송합니다 (사장님이 코드를 슈퍼관리자에게 전달)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">프로필 관리명</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="(비워두면 채널 ID 사용)"
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">대분류 *</label>
                  <select
                    value={l1Code}
                    onChange={(e) => { setL1Code(e.target.value); setL2Code(''); setCategoryCode(''); }}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">선택</option>
                    {l1Options.map((c) => (
                      <option key={c.category_code} value={c.category_code}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">중분류 *</label>
                  <select
                    value={l2Code}
                    onChange={(e) => { setL2Code(e.target.value); setCategoryCode(''); }}
                    disabled={!l1Code}
                    className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
                  >
                    <option value="">선택</option>
                    {l2Options.map((c) => (
                      <option key={c.category_code} value={c.category_code}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">소분류 *</label>
                  <select
                    value={categoryCode}
                    onChange={(e) => setCategoryCode(e.target.value)}
                    disabled={!l2Code}
                    className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
                  >
                    <option value="">선택</option>
                    {l3Options.map((c) => (
                      <option key={c.category_code} value={c.category_code}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  📱 사장님 휴대폰({phoneNumber})에 IMC가 인증 SMS를 발송했습니다.
                  <br />
                  사장님으로부터 인증 코드를 받아 입력해주세요.
                </p>
                <p className="text-xs text-blue-600 mt-2">
                  (현재 시스템은 IMC token 기반 — 토큰이 발급되어 자동으로 인증 처리됩니다)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">발급된 토큰</label>
                <input
                  type="text"
                  value={token}
                  readOnly
                  className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-xs"
                />
              </div>

              <div className="p-3 bg-gray-50 rounded-lg text-sm space-y-1">
                <div><span className="text-gray-500">대상 회사:</span> {companies.find((c) => c.id === targetCompanyId)?.company_name || '-'}</div>
                <div><span className="text-gray-500">채널 ID:</span> {yellowId}</div>
                <div><span className="text-gray-500">관리자 폰:</span> {phoneNumber}</div>
                <div><span className="text-gray-500">카테고리:</span> {categories.find((c) => c.category_code === categoryCode)?.name || categoryCode}</div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
          >
            취소
          </button>
          {step === 1 ? (
            <button
              type="button"
              onClick={requestToken}
              disabled={submitting}
              className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
            >
              {submitting ? '발급 중...' : '인증 요청'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={submitting}
                className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
              >
                이전
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
              >
                {submitting ? '등록 중...' : '발신프로필 등록'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
