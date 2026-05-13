/**
 * 알림톡 템플릿 대행 등록/수정 모달
 *
 * 한줄AI 본진 AlimtalkTemplateFormV2 핵심 발췌 + 슈퍼관리자 대행 단순화.
 * IMC 매뉴얼 정합 — messageType(BA/EX/AD/MI) × emphasizeType(NONE/TEXT/IMAGE/ITEM_LIST).
 *
 * 슈퍼관리자가 회사/사용자 선택 → 발신프로필 선택 → 본문 + 버튼 입력 → 등록 (DRAFT).
 * 검수 요청은 AlimtalkManagementPage 목록에서 별도 호출.
 *
 * PHASE 0 정성 평가 진입용 단순 버전 — IMC 검수 통과 가능 최소 입력.
 * 이미지 강조형(IMAGE)/아이템리스트형(ITEM_LIST) UI는 PHASE 1+에서 본진 FormV2 100% 미러로 확장.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  MSG_TYPES,
  EMPH_TYPES,
  BUTTON_TYPE_LABELS,
  type MsgType,
  type EmphType,
  type ButtonType,
} from './alimtalk-types';

interface Company { id: string; company_name: string; }

interface SenderProfile {
  id: string;
  profile_name: string;
  yellow_id: string | null;
  approval_status: string | null;
}

interface CategoryItem {
  category_code: string;
  name: string;
  group_name: string | null;
}

interface CompanyUser {
  id: string;
  name: string;
  login_id: string;
}

interface TemplateButton {
  name: string;
  type: ButtonType;
  urlMobile?: string;
  urlPc?: string;
}

interface Template {
  id: string;
  company_id: string;
  profile_id: string;
  template_code: string;
  template_name: string;
  content: string;
  buttons: TemplateButton[];
  variables: string[];
  message_type: string;
  emphasize_type: string;
  emphasize_title: string | null;
  emphasize_subtitle: string | null;
  extra_content: string | null;
  template_header: string | null;
  category: string | null;
  preview_message: string | null;
}

interface Props {
  companies: Company[];
  editingTemplate: Template | null;
  onClose: () => void;
  onSaved: () => void;
}

function getToken() {
  return localStorage.getItem('flyerSuperToken') || '';
}

// 본문에서 #{변수명} 패턴 추출
function extractVariables(content: string): string[] {
  const re = /#\{([^}]+)\}/g;
  const set = new Set<string>();
  let m;
  while ((m = re.exec(content)) !== null) {
    const v = m[1].trim();
    if (v) set.add(v);
  }
  return Array.from(set);
}

export default function AlimtalkTemplateModal({ companies, editingTemplate, onClose, onSaved }: Props) {
  const isEdit = !!editingTemplate;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [targetCompanyId, setTargetCompanyId] = useState(editingTemplate?.company_id || '');
  const [targetUserId, setTargetUserId] = useState('');
  const [profileId, setProfileId] = useState(editingTemplate?.profile_id || '');
  const [manageName, setManageName] = useState(editingTemplate?.template_name || '');
  const [messageType, setMessageType] = useState<MsgType>((editingTemplate?.message_type as MsgType) || 'BA');
  const [emphasizeType, setEmphasizeType] = useState<EmphType>((editingTemplate?.emphasize_type as EmphType) || 'NONE');
  const [content, setContent] = useState(editingTemplate?.content || '');
  const [extraContent, setExtraContent] = useState(editingTemplate?.extra_content || '');
  const [emphasizeTitle, setEmphasizeTitle] = useState(editingTemplate?.emphasize_title || '');
  const [emphasizeSubtitle, setEmphasizeSubtitle] = useState(editingTemplate?.emphasize_subtitle || '');
  const [templateHeader, setTemplateHeader] = useState(editingTemplate?.template_header || '');
  const [previewMessage, setPreviewMessage] = useState(editingTemplate?.preview_message || '');
  const [categoryCode, setCategoryCode] = useState(editingTemplate?.category || '');
  const [buttons, setButtons] = useState<TemplateButton[]>(editingTemplate?.buttons || []);

  const [profiles, setProfiles] = useState<SenderProfile[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);

  const authHeader = () => ({
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json',
  });

  // 회사 변경 시 발신프로필 + 회원 목록 + 카테고리 로딩
  useEffect(() => {
    if (!targetCompanyId) {
      setProfiles([]); setUsers([]);
      return;
    }
    (async () => {
      try {
        const [pRes, uRes] = await Promise.all([
          fetch(`/api/admin/alimtalk/senders?companyId=${targetCompanyId}`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          fetch(`/api/admin/flyer/companies/${targetCompanyId}/users`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        ]);
        const pData = await pRes.json();
        if (pData.success) {
          setProfiles((pData.profiles || []).filter((p: SenderProfile) => p.approval_status === 'APPROVED'));
        }
        const uData = await uRes.json();
        const userList = uData.users || uData.rows || uData || [];
        setUsers(Array.isArray(userList) ? userList : []);
      } catch {
        /* noop */
      }
    })();
  }, [targetCompanyId]);

  // 카테고리 일회 로딩
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/alimtalk/categories/template', { headers: { Authorization: `Bearer ${getToken()}` } });
        const data = await res.json();
        if (data.success) setCategories(data.categories || []);
      } catch {
        /* noop */
      }
    })();
  }, []);

  // messageType 변경 시 AC 버튼 자동 처리 (D152-1 fix 정합)
  useEffect(() => {
    const hasAc = buttons.some((b) => b.type === 'AC');
    if ((messageType === 'AD' || messageType === 'MI') && !hasAc) {
      // 채널 추가 버튼 자동 추가 (맨 앞)
      setButtons([{ name: '채널 추가', type: 'AC' }, ...buttons]);
    } else if ((messageType === 'BA' || messageType === 'EX') && hasAc) {
      // AC 버튼 자동 제거
      setButtons(buttons.filter((b) => b.type !== 'AC'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageType]);

  const variables = useMemo(() => extractVariables(content), [content]);
  const contentLen = content.length;
  const maxLen = messageType === 'EX' || messageType === 'MI' ? 800 : 1000;

  const addButton = () => {
    if (buttons.length >= 5) {
      setError('버튼은 최대 5개까지 추가 가능합니다');
      return;
    }
    setButtons([...buttons, { name: '', type: 'WL', urlMobile: '' }]);
  };

  const updateButton = (idx: number, patch: Partial<TemplateButton>) => {
    const next = [...buttons];
    next[idx] = { ...next[idx], ...patch };
    setButtons(next);
  };

  const removeButton = (idx: number) => {
    setButtons(buttons.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    setError(null);
    if (!isEdit && !targetCompanyId) { setError('대상 회사를 선택하세요'); return; }
    if (!profileId) { setError('발신프로필을 선택하세요'); return; }
    if (!manageName || manageName.length < 1) { setError('관리명을 입력하세요'); return; }
    if (!content || content.length < 5) { setError('본문은 5자 이상 입력하세요'); return; }
    if (content.length > maxLen) { setError(`본문이 ${maxLen}자를 초과합니다`); return; }
    if (!categoryCode) { setError('템플릿 카테고리를 선택하세요'); return; }

    setSubmitting(true);
    try {
      const body = {
        targetCompanyId,
        targetUserId: targetUserId || null,
        profileId,
        manageName,
        templateMessageType: messageType,
        templateEmphasizeType: emphasizeType,
        templateContent: content,
        templateExtra: (messageType === 'EX' || messageType === 'MI') ? extraContent : null,
        templateTitle: emphasizeType === 'TEXT' ? emphasizeTitle : null,
        templateSubtitle: emphasizeType === 'TEXT' ? emphasizeSubtitle : null,
        templateHeader: templateHeader || null,
        templatePreviewMessage: previewMessage || null,
        categoryCode,
        variables,
        buttonList: buttons.map((b) => ({
          name: b.name,
          type: b.type,
          urlMobile: b.urlMobile || undefined,
          urlPc: b.urlPc || undefined,
        })),
      };

      const url = isEdit
        ? `/api/admin/alimtalk/templates/${editingTemplate!.template_code}`
        : '/api/admin/alimtalk/templates';
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: authHeader(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data?.error || '저장 실패');
        return;
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex justify-between items-center">
          <h3 className="text-lg font-semibold">
            {isEdit ? '알림톡 템플릿 수정' : '알림톡 템플릿 대행 등록'}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* 회사/사용자/발신프로필 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">대상 회사 *</label>
              <select
                value={targetCompanyId}
                onChange={(e) => { setTargetCompanyId(e.target.value); setProfileId(''); setTargetUserId(''); }}
                disabled={isEdit}
                className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
              >
                <option value="">선택</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">소유 사용자 (created_by)</label>
              <select
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                disabled={!targetCompanyId || isEdit}
                className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
              >
                <option value="">(미지정)</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.login_id})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">발신프로필 *</label>
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                disabled={!targetCompanyId || isEdit}
                className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
              >
                <option value="">선택</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.profile_name} ({p.yellow_id})</option>
                ))}
              </select>
            </div>
          </div>

          {/* 관리명 + 카테고리 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">관리명 *</label>
              <input
                type="text"
                value={manageName}
                onChange={(e) => setManageName(e.target.value)}
                maxLength={30}
                placeholder="(예: 주문 완료 안내)"
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">템플릿 카테고리 *</label>
              <select
                value={categoryCode}
                onChange={(e) => setCategoryCode(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">선택</option>
                {categories.map((c) => (
                  <option key={c.category_code} value={c.category_code}>
                    {c.group_name ? `[${c.group_name}] ` : ''}{c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* messageType + emphasizeType */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">메시지 유형 *</label>
              <div className="flex flex-wrap gap-2">
                {MSG_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setMessageType(t.value)}
                    className={`px-3 py-1.5 text-sm rounded-lg border ${
                      messageType === t.value
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                    title={t.desc}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">강조 유형</label>
              <div className="flex flex-wrap gap-2">
                {EMPH_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setEmphasizeType(t.value)}
                    className={`px-3 py-1.5 text-sm rounded-lg border ${
                      emphasizeType === t.value
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 헤더 (10자) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">헤더 (선택, 최대 10자)</label>
            <input
              type="text"
              value={templateHeader}
              onChange={(e) => setTemplateHeader(e.target.value)}
              maxLength={10}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>

          {/* TEXT 강조: title + subtitle */}
          {emphasizeType === 'TEXT' && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-emerald-50 rounded-lg">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">강조 표기 제목 *</label>
                <input
                  type="text"
                  value={emphasizeTitle}
                  onChange={(e) => setEmphasizeTitle(e.target.value)}
                  maxLength={30}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">강조 표기 서브타이틀</label>
                <input
                  type="text"
                  value={emphasizeSubtitle}
                  onChange={(e) => setEmphasizeSubtitle(e.target.value)}
                  maxLength={50}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>
          )}

          {/* 본문 */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-gray-700">본문 *</label>
              <span className={`text-xs ${contentLen > maxLen ? 'text-red-600' : 'text-gray-500'}`}>
                {contentLen} / {maxLen}자
              </span>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
              placeholder="안녕하세요 #{고객명}님&#10;..."
            />
            {variables.length > 0 && (
              <div className="mt-2 flex gap-1 flex-wrap">
                <span className="text-xs text-gray-500">변수:</span>
                {variables.map((v) => (
                  <span key={v} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">#{`{${v}}`}</span>
                ))}
              </div>
            )}
          </div>

          {/* EX/MI: 부가내용 */}
          {(messageType === 'EX' || messageType === 'MI') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">부가 정보</label>
              <textarea
                value={extraContent}
                onChange={(e) => setExtraContent(e.target.value)}
                rows={3}
                maxLength={500}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          )}

          {/* 미리보기 메시지 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">미리보기 메시지 (선택, 40자)</label>
            <input
              type="text"
              value={previewMessage}
              onChange={(e) => setPreviewMessage(e.target.value)}
              maxLength={40}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="(미입력 시 본문 앞부분 자동 사용)"
            />
          </div>

          {/* 버튼 */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">버튼 (최대 5개)</label>
              <button
                type="button"
                onClick={addButton}
                className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded"
              >
                + 버튼 추가
              </button>
            </div>
            <div className="space-y-2">
              {buttons.map((b, idx) => (
                <div key={idx} className="flex gap-2 items-start p-2 bg-gray-50 rounded">
                  <select
                    value={b.type}
                    onChange={(e) => updateButton(idx, { type: e.target.value as ButtonType })}
                    disabled={b.type === 'AC'}
                    className="px-2 py-1 border rounded text-sm w-32 disabled:bg-gray-100"
                  >
                    {Object.entries(BUTTON_TYPE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={b.name}
                    onChange={(e) => updateButton(idx, { name: e.target.value })}
                    maxLength={14}
                    placeholder="버튼명 (14자)"
                    disabled={b.type === 'AC'}
                    className="flex-1 px-2 py-1 border rounded text-sm disabled:bg-gray-100"
                  />
                  {(b.type === 'WL' || b.type === 'AL') && (
                    <input
                      type="text"
                      value={b.urlMobile || ''}
                      onChange={(e) => updateButton(idx, { urlMobile: e.target.value })}
                      placeholder="모바일 URL"
                      className="flex-1 px-2 py-1 border rounded text-sm"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeButton(idx)}
                    disabled={b.type === 'AC'}
                    className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded disabled:opacity-30"
                    title={b.type === 'AC' ? 'AC 버튼은 메시지유형으로 제어됩니다' : '버튼 삭제'}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
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
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
          >
            {submitting ? '저장 중...' : isEdit ? '수정 저장' : '템플릿 등록 (DRAFT)'}
          </button>
        </div>
      </div>
    </div>
  );
}
