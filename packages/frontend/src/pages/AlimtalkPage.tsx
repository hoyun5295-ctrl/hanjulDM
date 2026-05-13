/**
 * 매장 사장님 알림톡 자산 조회 페이지
 *
 * 정책 (Harold 명시):
 *   - 매장 사장님은 직접 등록·수정 X. 슈퍼관리자가 100% 대행.
 *   - 본 페이지는 본인 회사 발신프로필 + 템플릿 자산 + 검수 진행상황 조회만.
 *   - 발송은 SendPage 알림톡 dropdown 통합 (PHASE 0 통과 후 별건).
 *
 * 호출 라우트: GET /api/flyer/alimtalk/senders + /templates/all
 */

import { useEffect, useState } from 'react';
import { API_BASE, apiFetch } from '../App';

interface Sender {
  id: string;
  profile_key: string;
  profile_name: string;
  yellow_id: string | null;
  admin_phone_number: string | null;
  category_code: string | null;
  category_name_cache: string | null;
  status: string;
  registered_at: string | null;
}

interface Template {
  id: string;
  template_code: string;
  template_key: string;
  template_name: string;
  content: string;
  status: string;
  reject_reason: string | null;
  message_type: string;
  requested_at: string | null;
  approved_at: string | null;
  updated_at: string;
  profile_name: string | null;
  yellow_id: string | null;
}

interface Props { token: string; }

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  DRAFT:      { label: '초안',        cls: 'bg-gray-100 text-gray-600' },
  REG:        { label: '등록',        cls: 'bg-gray-100 text-gray-700' },
  REQ:        { label: '검수요청',    cls: 'bg-blue-100 text-blue-700' },
  REV:        { label: '검수중',      cls: 'bg-blue-100 text-blue-700' },
  KREQ:       { label: '카카오 검수중', cls: 'bg-indigo-100 text-indigo-700' },
  HREJ:       { label: '내부 반려',   cls: 'bg-orange-100 text-orange-700' },
  KREJ:       { label: '카카오 반려', cls: 'bg-red-100 text-red-700' },
  APR:        { label: '승인',        cls: 'bg-green-100 text-green-700' },
  REQUESTED:  { label: '검수요청',    cls: 'bg-blue-100 text-blue-700' },
  REVIEWING:  { label: '검수중',      cls: 'bg-blue-100 text-blue-700' },
  APPROVED:   { label: '승인',        cls: 'bg-green-100 text-green-700' },
  REJECTED:   { label: '반려',        cls: 'bg-red-100 text-red-700' },
  DELETED:    { label: '삭제됨',      cls: 'bg-gray-200 text-gray-500' },
};

const PROFILE_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING:  { label: '대기',   cls: 'bg-gray-100 text-gray-600' },
  NORMAL:   { label: '정상',   cls: 'bg-emerald-100 text-emerald-700' },
  DORMANT:  { label: '휴면',   cls: 'bg-amber-100 text-amber-700' },
  BLOCKED:  { label: '차단',   cls: 'bg-red-100 text-red-700' },
  DELETED:  { label: '삭제됨', cls: 'bg-gray-200 text-gray-500' },
};

export default function AlimtalkPage({ token: _token }: Props) {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [sRes, tRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/flyer/alimtalk/senders`),
        apiFetch(`${API_BASE}/api/flyer/alimtalk/templates/all`),
      ]);
      const sData = await sRes.json();
      if (sData.success) setSenders(sData.profiles || []);
      const tData = await tRes.json();
      if (tData.success) setTemplates(tData.templates || []);
    } catch (e: any) {
      console.error('[AlimtalkPage] 로딩 실패', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">알림톡</h1>
        <p className="text-sm text-text-secondary mt-1">
          발신프로필 등록과 템플릿 검수 신청은 한줄전단 운영팀이 대행합니다. 본 화면은 등록된 자산과 검수 진행 상황을 보여줍니다.
        </p>
      </div>

      {/* 안내 박스 */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-900">
          <strong>알림톡 신청 절차:</strong> 운영팀에 카카오 채널 ID + 채널 관리자 휴대폰을 알려주시면 발신프로필을 대행 등록해드립니다.
          템플릿도 운영팀이 직접 작성하여 카카오 검수까지 일괄 진행합니다. 검수 통과 시 본 페이지에 "승인" 상태로 표시되고 발송에 사용할 수 있습니다.
        </p>
      </div>

      {/* 발신프로필 */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">발신프로필 ({senders.length})</h2>
          <p className="text-xs text-gray-500 mt-1">알림톡을 보낼 카카오톡 채널</p>
        </div>
        <div className="px-6 py-4">
          {loading ? (
            <div className="py-8 text-center text-gray-400">로딩 중...</div>
          ) : senders.length === 0 ? (
            <div className="py-8 text-center text-gray-400">
              등록된 발신프로필이 없습니다. 운영팀에 신청해주세요.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left">프로필명</th>
                    <th className="px-3 py-2 text-left">채널 ID</th>
                    <th className="px-3 py-2 text-left">관리자 휴대폰</th>
                    <th className="px-3 py-2 text-left">카테고리</th>
                    <th className="px-3 py-2 text-left">상태</th>
                    <th className="px-3 py-2 text-left">등록일</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {senders.map((s) => {
                    const ps = PROFILE_STATUS_LABELS[s.status] || { label: s.status, cls: 'bg-gray-100 text-gray-600' };
                    return (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{s.profile_name}</td>
                        <td className="px-3 py-2 text-gray-600">{s.yellow_id || '-'}</td>
                        <td className="px-3 py-2 text-gray-600">{s.admin_phone_number || '-'}</td>
                        <td className="px-3 py-2 text-gray-600">{s.category_name_cache || s.category_code || '-'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${ps.cls}`}>{ps.label}</span>
                        </td>
                        <td className="px-3 py-2 text-gray-500">
                          {s.registered_at ? new Date(s.registered_at).toLocaleDateString('ko-KR') : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 템플릿 */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">알림톡 템플릿 ({templates.length})</h2>
          <p className="text-xs text-gray-500 mt-1">검수 진행 상태 + 승인된 템플릿은 발송 화면에서 선택 가능</p>
        </div>
        <div className="px-6 py-4">
          {loading ? (
            <div className="py-8 text-center text-gray-400">로딩 중...</div>
          ) : templates.length === 0 ? (
            <div className="py-8 text-center text-gray-400">
              등록된 템플릿이 없습니다. 운영팀에 작성을 요청해주세요.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left">템플릿명</th>
                    <th className="px-3 py-2 text-left">발신프로필</th>
                    <th className="px-3 py-2 text-left">상태</th>
                    <th className="px-3 py-2 text-left">반려 사유</th>
                    <th className="px-3 py-2 text-left">최근 갱신</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {templates.map((t) => {
                    const st = STATUS_LABELS[t.status] || { label: t.status, cls: 'bg-gray-100 text-gray-600' };
                    return (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">
                          <div>{t.template_name}</div>
                          <div className="text-xs text-gray-500 max-w-md truncate">{t.content}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{t.profile_name || '-'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-red-600 max-w-xs truncate" title={t.reject_reason || ''}>
                          {t.reject_reason || '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-500">
                          {new Date(t.updated_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
