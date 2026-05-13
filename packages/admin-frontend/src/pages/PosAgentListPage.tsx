/**
 * ★ D155: 슈퍼관리자 POS Agent 모니터링 + 키 발급 (D113 본진 매트릭스 hanjulDM 미러)
 * backend: GET /api/admin/flyer/pos-agents — flyer_pos_agents 목록(last_heartbeat/sync_status)
 *          POST /api/admin/flyer/pos-agents/generate-key — {company_id, pos_type} → agent_key 생성
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Input, Select, DataTable, Badge, Toast } from '../components/ui';

interface PosAgent {
  id: string;
  company_id: string;
  agent_key: string;
  pos_type?: string;
  sync_status?: string;
  last_heartbeat?: string;
  created_at?: string;
  company_name?: string;
}

interface Company { id: string; company_name?: string; }

export default function PosAgentListPage() {
  const [agents, setAgents] = useState<PosAgent[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [genOpen, setGenOpen] = useState(false);
  const [keyResult, setKeyResult] = useState<{ agent_key: string } | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/pos-agents`);
      if (res.ok) {
        const data = await res.json();
        setAgents(Array.isArray(data) ? data : []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'POS Agent 목록 로드 실패');
      }
    } catch (err: any) {
      setError(err.message || 'POS Agent 목록 로드 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCompanies = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/companies`);
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.items || data || []);
      }
    } catch {}
  }, []);

  useEffect(() => { loadAgents(); loadCompanies(); }, [loadAgents, loadCompanies]);

  const heartbeatBadge = (lastHeartbeat: string | undefined, _syncStatus: string | undefined) => {
    if (!lastHeartbeat) return <Badge variant="neutral">미연결</Badge>;
    const diff = (Date.now() - new Date(lastHeartbeat).getTime()) / 1000;
    if (diff < 300) return <Badge variant="success">실시간 ({Math.floor(diff)}s)</Badge>;
    if (diff < 3600) return <Badge variant="warn">{Math.floor(diff / 60)}분 전</Badge>;
    return <Badge variant="error">{Math.floor(diff / 3600)}시간 전</Badge>;
  };

  return (
    <>
      <SectionCard
        title={`POS Agent 모니터링 (${agents.length})`}
        action={<Button size="sm" onClick={() => setGenOpen(true)}>+ 키 발급</Button>}
      >
        {error && (
          <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-4">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        )}
        {loading ? (
          <p className="text-sm text-text-muted text-center py-8">로딩 중...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'company_name', label: '회사' },
              { key: 'pos_type', label: 'POS 종류', render: (v) => v || '미설정' },
              { key: 'agent_key', label: 'Agent Key', render: (v) => (
                <code className="text-xs bg-bg px-2 py-0.5 rounded">{v ? `${String(v).slice(0, 14)}...` : '-'}</code>
              ) },
              { key: 'sync_status', label: '동기화 상태', render: (v) => (
                <Badge variant={v === 'connected' ? 'success' : v === 'syncing' ? 'warn' : 'neutral'}>{v || '-'}</Badge>
              ) },
              { key: 'last_heartbeat', label: '마지막 통신', render: (_, row) => heartbeatBadge(row.last_heartbeat, row.sync_status) },
              { key: 'created_at', label: '발급일', render: (v) => v ? new Date(v).toLocaleDateString('ko-KR') : '-' },
            ]}
            rows={agents}
            emptyMessage="등록된 POS Agent가 없습니다"
          />
        )}
      </SectionCard>

      {genOpen && (
        <KeyGenModal
          companies={companies}
          onClose={() => setGenOpen(false)}
          onSuccess={(agentKey) => {
            setGenOpen(false);
            setKeyResult({ agent_key: agentKey });
            loadAgents();
          }}
        />
      )}

      {keyResult && (
        <KeyResultModal
          agentKey={keyResult.agent_key}
          onClose={() => { setKeyResult(null); setToast('POS Agent 키 발급 완료'); setTimeout(() => setToast(''), 2500); }}
        />
      )}

      <Toast show={!!toast} message={toast} />
    </>
  );
}

function KeyGenModal({ companies, onClose, onSuccess }: {
  companies: Company[];
  onClose: () => void;
  onSuccess: (agentKey: string) => void;
}) {
  const [companyId, setCompanyId] = useState('');
  const [posType, setPosType] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!companyId) { setError('회사를 선택해주세요'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/pos-agents/generate-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, pos_type: posType || null }),
      });
      if (res.ok) {
        const data = await res.json();
        onSuccess(data.agent_key);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '키 발급 실패');
      }
    } catch (err: any) {
      setError(err.message || '키 발급 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4">
      <div className="bg-surface rounded-2xl shadow-modal max-w-md w-full p-6">
        <h3 className="text-base font-bold text-text mb-4">POS Agent 키 발급</h3>
        {error && (
          <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-3">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        )}
        <div className="space-y-3 mb-5">
          <Select label="회사 *" value={companyId} onChange={e => setCompanyId(e.target.value)}>
            <option value="">선택</option>
            {companies.map(c => (<option key={c.id} value={c.id}>{c.company_name || c.id}</option>))}
          </Select>
          <Input label="POS 종류 (선택)" value={posType} onChange={e => setPosType(e.target.value)} placeholder="예: ASP, MS-SQL, 자체 POS" />
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>취소</Button>
          <Button className="flex-1" onClick={handleGenerate} disabled={saving}>{saving ? '발급 중...' : '발급'}</Button>
        </div>
      </div>
    </div>
  );
}

function KeyResultModal({ agentKey, onClose }: { agentKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(agentKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4">
      <div className="bg-surface rounded-2xl shadow-modal max-w-md w-full p-6">
        <h3 className="text-base font-bold text-text mb-2">키 발급 완료</h3>
        <p className="text-sm text-text-secondary mb-4">아래 키를 매장 POS Agent 설치 시 입력하세요. 이 화면을 닫으면 다시 표시되지 않습니다.</p>
        <div className="bg-bg border border-border rounded-lg p-3 mb-4">
          <code className="text-sm font-bold text-text break-all">{agentKey}</code>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={handleCopy}>{copied ? '복사됨' : '복사'}</Button>
          <Button className="flex-1" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </div>
  );
}
