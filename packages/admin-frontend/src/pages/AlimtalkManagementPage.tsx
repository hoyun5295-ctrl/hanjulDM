/**
 * hanjulDM 슈퍼관리자 알림톡 대행 관리 페이지
 *
 * 메인 페이지 — 발신프로필 + 템플릿 두 영역 탭 분리.
 * 슈퍼관리자가 회사 선택 → 대행 등록/수정/검수 신청 → 검수 결과 모니터링.
 *
 * 한줄AI 본진 AlimtalkSendersSection + AlimtalkManagementSection 패턴 미러 + 대행 흐름 단순화.
 */

import { useEffect, useMemo, useState } from 'react';
import AlimtalkSenderModal from '../components/AlimtalkSenderModal';
import AlimtalkTemplateModal from '../components/AlimtalkTemplateModal';
import {
  getProfileStatusLabel,
  getStatusLabel,
  formatTemplateType,
} from '../components/alimtalk-types';

interface Sender {
  id: string;
  company_id: string;
  company_name?: string;
  profile_key: string;
  profile_name: string;
  is_active: boolean;
  yellow_id: string | null;
  admin_phone_number: string | null;
  category_code: string | null;
  category_name_cache: string | null;
  status: string;
  approval_status: string | null;
  registered_at: string | null;
  created_at: string;
}

interface Template {
  id: string;
  company_id: string;
  company_name?: string;
  profile_id: string;
  profile_key?: string;
  profile_name?: string;
  template_code: string;
  template_key: string;
  template_name: string;
  content: string;
  status: string;
  reject_reason: string | null;
  message_type: string;
  emphasize_type: string;
  requested_at: string | null;
  approved_at: string | null;
  updated_at: string;
  created_at: string;
}

interface Company {
  id: string;
  company_name: string;
}

type Tab = 'senders' | 'templates';
type SenderFilter = 'all' | 'APPROVED' | 'PENDING_APPROVAL' | 'REJECTED';
type TemplateFilter = 'all' | 'DRAFT' | 'pending' | 'APPROVED' | 'REJECTED';

function getToken() {
  return localStorage.getItem('flyerSuperToken') || '';
}

export default function AlimtalkManagementPage() {
  const [tab, setTab] = useState<Tab>('senders');
  const [senders, setSenders] = useState<Sender[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string>('');
  const [senderFilter, setSenderFilter] = useState<SenderFilter>('all');
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>('all');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showSenderModal, setShowSenderModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

  const loadCompanies = async () => {
    try {
      const res = await fetch('/api/admin/flyer/companies?limit=500', { headers: authHeader() });
      const data = await res.json();
      const list = data.companies || data.rows || data || [];
      setCompanies(
        Array.isArray(list)
          ? list.map((c: any) => ({ id: c.id, company_name: c.company_name || c.name || c.id }))
          : [],
      );
    } catch (e: any) {
      console.error('[AlimtalkManagement] 회사 목록 로딩 실패', e);
    }
  };

  const loadSenders = async () => {
    setLoading(true);
    try {
      const url = companyFilter
        ? `/api/admin/alimtalk/senders?companyId=${companyFilter}`
        : '/api/admin/alimtalk/senders';
      const res = await fetch(url, { headers: authHeader() });
      const data = await res.json();
      if (data.success) setSenders(data.profiles || []);
    } catch (e: any) {
      setToast(e?.message || '발신프로필 로딩 실패');
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const url = companyFilter
        ? `/api/admin/alimtalk/templates?companyId=${companyFilter}`
        : '/api/admin/alimtalk/templates';
      const res = await fetch(url, { headers: authHeader() });
      const data = await res.json();
      if (data.success) setTemplates(data.templates || []);
    } catch (e: any) {
      setToast(e?.message || '템플릿 로딩 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    if (tab === 'senders') loadSenders();
    else loadTemplates();
  }, [tab, companyFilter]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const syncCategories = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/alimtalk/categories/sync', {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await res.json();
      setToast(data.success ? '카테고리 동기화 완료' : data?.error || '실패');
    } catch (e: any) {
      setToast(e?.message || '실패');
    } finally {
      setSyncing(false);
    }
  };

  const syncPendingTemplates = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/alimtalk/jobs/sync-pending-templates', {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await res.json();
      setToast(data.success ? '검수 상태 동기화 완료' : data?.error || '실패');
      if (tab === 'templates') loadTemplates();
    } catch (e: any) {
      setToast(e?.message || '실패');
    } finally {
      setSyncing(false);
    }
  };

  const syncSenderStatus = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/alimtalk/jobs/sync-sender-status', {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await res.json();
      setToast(data.success ? '발신프로필 상태 동기화 완료' : data?.error || '실패');
      if (tab === 'senders') loadSenders();
    } catch (e: any) {
      setToast(e?.message || '실패');
    } finally {
      setSyncing(false);
    }
  };

  const requestInspection = async (t: Template) => {
    if (!confirm(`'${t.template_name}' 템플릿의 검수를 요청하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/admin/alimtalk/templates/${t.template_code}/inspect`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setToast(data.success ? '검수 요청 완료' : data?.error || '검수 요청 실패');
      loadTemplates();
    } catch (e: any) {
      setToast(e?.message || '검수 요청 실패');
    }
  };

  const cancelInspection = async (t: Template) => {
    if (!confirm(`'${t.template_name}' 검수 요청을 취소하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/admin/alimtalk/templates/${t.template_code}/cancel-inspect`, {
        method: 'PUT',
        headers: authHeader(),
      });
      const data = await res.json();
      setToast(data.success ? '검수 취소 완료' : data?.error || '검수 취소 실패');
      loadTemplates();
    } catch (e: any) {
      setToast(e?.message || '실패');
    }
  };

  const deleteTemplate = async (t: Template) => {
    if (!confirm(`'${t.template_name}' 템플릿을 삭제하시겠습니까? (IMC + DB 모두 삭제)`)) return;
    try {
      const res = await fetch(`/api/admin/alimtalk/templates/${t.template_code}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      const data = await res.json();
      setToast(data.success ? '삭제 완료' : data?.error || '삭제 실패');
      loadTemplates();
    } catch (e: any) {
      setToast(e?.message || '실패');
    }
  };

  const filteredSenders = useMemo(() => {
    if (senderFilter === 'all') return senders;
    return senders.filter((s) => (s.approval_status || 'PENDING_APPROVAL') === senderFilter);
  }, [senders, senderFilter]);

  const filteredTemplates = useMemo(() => {
    if (templateFilter === 'all') return templates;
    if (templateFilter === 'pending') {
      return templates.filter((t) =>
        ['REQUESTED', 'REVIEWING', 'REG', 'REQ', 'REV', 'KREQ'].includes(t.status),
      );
    }
    return templates.filter((t) => t.status === templateFilter);
  }, [templates, templateFilter]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold">알림톡 대행 관리</h2>
            <p className="text-xs text-gray-500 mt-1">
              슈퍼관리자 대행 — 발신프로필 등록 + 템플릿 등록/검수 신청 + 결과 모니터링
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={syncCategories}
              disabled={syncing}
              className="px-3 py-1.5 text-sm bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg disabled:opacity-50"
            >
              카테고리 동기화
            </button>
            <button
              type="button"
              onClick={tab === 'senders' ? syncSenderStatus : syncPendingTemplates}
              disabled={syncing}
              className="px-3 py-1.5 text-sm bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg disabled:opacity-50"
            >
              {tab === 'senders' ? '발신프로필 동기화' : '검수 상태 동기화'}
            </button>
            {tab === 'senders' ? (
              <button
                type="button"
                onClick={() => setShowSenderModal(true)}
                className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg"
              >
                + 발신프로필 대행 등록
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingTemplate(null);
                  setShowTemplateModal(true);
                }}
                className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg"
              >
                + 템플릿 대행 등록
              </button>
            )}
          </div>
        </div>

        {/* 탭 + 회사 필터 */}
        <div className="px-6 py-3 border-b flex justify-between items-center">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab('senders')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${
                tab === 'senders'
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              발신프로필 ({senders.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('templates')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${
                tab === 'templates'
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              템플릿 ({templates.length})
            </button>
          </div>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border rounded-lg"
          >
            <option value="">전체 회사</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
        </div>

        {/* 발신프로필 탭 */}
        {tab === 'senders' && (
          <div className="px-6 py-4">
            <div className="mb-4 flex gap-2">
              {[
                { key: 'all', label: '전체' },
                { key: 'APPROVED', label: '승인' },
                { key: 'PENDING_APPROVAL', label: '승인대기' },
                { key: 'REJECTED', label: '반려' },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setSenderFilter(f.key as SenderFilter)}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    senderFilter === f.key
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="py-12 text-center text-gray-400">로딩 중...</div>
            ) : filteredSenders.length === 0 ? (
              <div className="py-12 text-center text-gray-400">등록된 발신프로필이 없습니다.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">회사</th>
                      <th className="px-3 py-2 text-left">프로필명</th>
                      <th className="px-3 py-2 text-left">채널 ID</th>
                      <th className="px-3 py-2 text-left">관리자 휴대폰</th>
                      <th className="px-3 py-2 text-left">카테고리</th>
                      <th className="px-3 py-2 text-left">상태</th>
                      <th className="px-3 py-2 text-left">등록일</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredSenders.map((s) => {
                      const ps = getProfileStatusLabel(s.status);
                      return (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">{s.company_name || s.company_id.slice(0, 8)}</td>
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
        )}

        {/* 템플릿 탭 */}
        {tab === 'templates' && (
          <div className="px-6 py-4">
            <div className="mb-4 flex gap-2">
              {[
                { key: 'all', label: '전체' },
                { key: 'DRAFT', label: '초안' },
                { key: 'pending', label: '검수중' },
                { key: 'APPROVED', label: '승인' },
                { key: 'REJECTED', label: '반려' },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setTemplateFilter(f.key as TemplateFilter)}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    templateFilter === f.key
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="py-12 text-center text-gray-400">로딩 중...</div>
            ) : filteredTemplates.length === 0 ? (
              <div className="py-12 text-center text-gray-400">등록된 템플릿이 없습니다.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">회사</th>
                      <th className="px-3 py-2 text-left">템플릿명</th>
                      <th className="px-3 py-2 text-left">발신프로필</th>
                      <th className="px-3 py-2 text-left">유형</th>
                      <th className="px-3 py-2 text-left">상태</th>
                      <th className="px-3 py-2 text-left">반려사유</th>
                      <th className="px-3 py-2 text-left">갱신일</th>
                      <th className="px-3 py-2 text-left">액션</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredTemplates.map((t) => {
                      const st = getStatusLabel(t.status);
                      const isDraft = t.status === 'DRAFT';
                      const isPending = ['REQUESTED', 'REVIEWING', 'REG', 'REQ', 'REV', 'KREQ'].includes(t.status);
                      return (
                        <tr key={t.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">{t.company_name || t.company_id.slice(0, 8)}</td>
                          <td className="px-3 py-2 font-medium">{t.template_name}</td>
                          <td className="px-3 py-2 text-gray-600">{t.profile_name || '-'}</td>
                          <td className="px-3 py-2 text-gray-600">{formatTemplateType(t.message_type, t.emphasize_type)}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 text-xs rounded-full ${st.cls}`}>{st.label}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-red-600 max-w-xs truncate" title={t.reject_reason || ''}>
                            {t.reject_reason || '-'}
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {new Date(t.updated_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {isDraft && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => { setEditingTemplate(t); setShowTemplateModal(true); }}
                                    className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded"
                                  >
                                    수정
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => requestInspection(t)}
                                    className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded"
                                  >
                                    검수요청
                                  </button>
                                </>
                              )}
                              {isPending && (
                                <button
                                  type="button"
                                  onClick={() => cancelInspection(t)}
                                  className="px-2 py-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 rounded"
                                >
                                  검수취소
                                </button>
                              )}
                              {(t.status === 'REJECTED' || isDraft) && (
                                <button
                                  type="button"
                                  onClick={() => deleteTemplate(t)}
                                  className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded"
                                >
                                  삭제
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 모달 */}
      {showSenderModal && (
        <AlimtalkSenderModal
          companies={companies}
          onClose={() => setShowSenderModal(false)}
          onSaved={() => {
            setShowSenderModal(false);
            setToast('발신프로필 대행 등록 완료');
            loadSenders();
          }}
        />
      )}

      {showTemplateModal && (
        <AlimtalkTemplateModal
          companies={companies}
          editingTemplate={editingTemplate}
          onClose={() => { setShowTemplateModal(false); setEditingTemplate(null); }}
          onSaved={() => {
            setShowTemplateModal(false);
            setEditingTemplate(null);
            setToast(editingTemplate ? '템플릿 수정 완료' : '템플릿 대행 등록 완료');
            loadTemplates();
          }}
        />
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
