/**
 * ★ 슈퍼관리자 POS Agent 모니터링 + 양방향 명령 (D155 + D159 V2)
 *
 * 기본 기능 (D155):
 *  - 목록 + 키 발급 + heartbeat 자동 계산
 *
 * V2 추가 (D159):
 *  - 양방향 명령 발행 (FORCE_SYNC/RESEND_SCHEMA/FETCH_LOGS/REVOKE/UPDATE/DIAGNOSE_MASK_BYPASS)
 *  - 명령 이력 모달 (최근 50건 + 결과/에러 표시)
 *  - 5초 자동 새로고침 (실시간 heartbeat 모니터링)
 *
 * Backend:
 *   GET /api/admin/flyer/pos-agents — 목록
 *   POST /api/admin/flyer/pos-agents/generate-key — 키 발급
 *   POST /api/flyer/pos/remote-command/issue — 명령 발행
 *   GET /api/flyer/pos/remote-command/history?agentId=... — 이력 조회
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
  agent_version?: string;
  last_update_at?: string;
  created_at?: string;
  company_name?: string;
}

interface Company { id: string; company_name?: string; }

type RemoteCommandType = 'FORCE_SYNC' | 'RESEND_SCHEMA' | 'FETCH_LOGS' | 'REVOKE' | 'UPDATE' | 'DIAGNOSE_MASK_BYPASS';

interface CommandRecord {
  id: string;
  agent_id: string;
  type: RemoteCommandType;
  payload?: any;
  issued_by: string;
  status: string;
  issued_at: string;
  polled_at?: string;
  responded_at?: string;
  result?: any;
  error_message?: string;
  duration_ms?: number;
}

const COMMAND_DESCRIPTIONS: Record<RemoteCommandType, string> = {
  FORCE_SYNC: '강제 싱크 — 판매/회원/재고 데이터 즉시 추출 + 푸시',
  RESEND_SCHEMA: '스키마 재읽기 — POS DB 스키마 재분석 트리거',
  FETCH_LOGS: '로그 가져오기 — 최근 200줄',
  REVOKE: 'Agent 자살 — agent_key wipe + 프로세스 종료 (복구 불가)',
  UPDATE: '자동 업데이트 — 새 .exe 즉시 다운로드 + 재시작',
  DIAGNOSE_MASK_BYPASS: '마스킹 우회 진단 — DIRECT_SQL/BACKUP_FILE/UI_AUTOMATION 가능 여부',
};

export default function PosAgentListPage() {
  const [agents, setAgents] = useState<PosAgent[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [genOpen, setGenOpen] = useState(false);
  const [keyResult, setKeyResult] = useState<{ agent_key: string } | null>(null);
  const [commandTarget, setCommandTarget] = useState<PosAgent | null>(null);
  const [historyTarget, setHistoryTarget] = useState<PosAgent | null>(null);

  const loadAgents = useCallback(async () => {
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

  useEffect(() => {
    loadAgents();
    loadCompanies();
    // 5초 자동 새로고침
    const timer = setInterval(loadAgents, 5000);
    return () => clearInterval(timer);
  }, [loadAgents, loadCompanies]);

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
              { key: 'agent_version', label: '버전', render: (v) => v || '-' },
              { key: 'agent_key', label: 'Agent Key', render: (v) => (
                <code className="text-xs bg-bg px-2 py-0.5 rounded">{v ? `${String(v).slice(0, 14)}...` : '-'}</code>
              ) },
              { key: 'sync_status', label: '상태', render: (v) => (
                <Badge variant={v === 'connected' ? 'success' : v === 'syncing' ? 'warn' : 'neutral'}>{v || '-'}</Badge>
              ) },
              { key: 'last_heartbeat', label: '마지막 통신', render: (_, row) => heartbeatBadge(row.last_heartbeat, row.sync_status) },
              { key: 'created_at', label: '발급일', render: (v) => v ? new Date(v).toLocaleDateString('ko-KR') : '-' },
              { key: 'actions', label: '명령', render: (_, row) => (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setCommandTarget(row)}
                    className="text-xs px-2 py-1 bg-primary-50 text-primary-600 rounded hover:bg-primary-100"
                  >
                    명령
                  </button>
                  <button
                    onClick={() => setHistoryTarget(row)}
                    className="text-xs px-2 py-1 bg-bg text-text-secondary rounded hover:bg-border"
                  >
                    이력
                  </button>
                </div>
              ) },
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

      {commandTarget && (
        <RemoteCommandModal
          agent={commandTarget}
          onClose={() => setCommandTarget(null)}
          onSuccess={(type) => {
            setCommandTarget(null);
            setToast(`${type} 명령 발행 완료 — Agent 응답 대기`);
            setTimeout(() => setToast(''), 3000);
          }}
        />
      )}

      {historyTarget && (
        <CommandHistoryModal
          agent={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      <Toast show={!!toast} message={toast} />
    </>
  );
}

// ============================================================
// 키 발급 모달
// ============================================================

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
          <Input label="POS 종류 (선택)" value={posType} onChange={e => setPosType(e.target.value)} placeholder="예: okpos, posbank, togethers" />
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

// ============================================================
// ★ V2: 원격 명령 발행 모달
// ============================================================

function RemoteCommandModal({ agent, onClose, onSuccess }: {
  agent: PosAgent;
  onClose: () => void;
  onSuccess: (type: RemoteCommandType) => void;
}) {
  const [type, setType] = useState<RemoteCommandType>('FORCE_SYNC');
  const [payload, setPayload] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const requiresConfirmation = type === 'REVOKE';

  const handleIssue = async () => {
    if (requiresConfirmation) {
      const confirmed = window.confirm(
        `⚠️ ${agent.company_name}의 POS Agent를 영구 무효화합니다. 복구 불가. 진행하시겠습니까?`
      );
      if (!confirmed) return;
    }

    setSaving(true);
    setError('');
    try {
      let parsedPayload: any = null;
      if (payload.trim()) {
        try {
          parsedPayload = JSON.parse(payload);
        } catch {
          setError('payload는 유효한 JSON이어야 합니다');
          setSaving(false);
          return;
        }
      }

      const res = await apiFetch(`${API_BASE}/api/flyer/pos/remote-command/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          type,
          payload: parsedPayload,
          issuedBy: 'super_admin',
        }),
      });
      if (res.ok) {
        onSuccess(type);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '명령 발행 실패');
      }
    } catch (err: any) {
      setError(err.message || '명령 발행 실패');
    } finally {
      setSaving(false);
    }
  };

  const payloadPlaceholder = type === 'FETCH_LOGS'
    ? '{"lines": 200}'
    : '(선택사항, JSON)';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4">
      <div className="bg-surface rounded-2xl shadow-modal max-w-lg w-full p-6">
        <h3 className="text-base font-bold text-text mb-2">원격 명령 발행</h3>
        <p className="text-sm text-text-secondary mb-4">
          대상: <strong>{agent.company_name}</strong> ({String(agent.agent_key).slice(0, 18)}...)
        </p>

        {error && (
          <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-3">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        )}

        <div className="space-y-3 mb-5">
          <div>
            <label className="block text-sm font-semibold text-text mb-1.5">명령 종류</label>
            <select
              value={type}
              onChange={e => setType(e.target.value as RemoteCommandType)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-300 focus:border-primary-500"
            >
              {(Object.keys(COMMAND_DESCRIPTIONS) as RemoteCommandType[]).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <p className="text-xs text-text-muted mt-1.5">{COMMAND_DESCRIPTIONS[type]}</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-text mb-1.5">Payload (선택)</label>
            <textarea
              value={payload}
              onChange={e => setPayload(e.target.value)}
              placeholder={payloadPlaceholder}
              rows={3}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary-300 focus:border-primary-500"
            />
          </div>

          {requiresConfirmation && (
            <div className="bg-error-50 border border-error-500/30 rounded-lg p-3">
              <p className="text-xs text-error-600 font-semibold">
                ⚠️ REVOKE 명령은 영구 복구 불가. Agent가 자살하고 agent_key가 wipe됩니다.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>취소</Button>
          <Button
            className="flex-1"
            onClick={handleIssue}
            disabled={saving}
          >
            {saving ? '발행 중...' : '명령 발행'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ★ V2: 명령 이력 모달
// ============================================================

function CommandHistoryModal({ agent, onClose }: { agent: PosAgent; onClose: () => void }) {
  const [history, setHistory] = useState<CommandRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/pos/remote-command/history?agentId=${agent.id}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setHistory(Array.isArray(data) ? data : []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '이력 로드 실패');
      }
    } catch (err: any) {
      setError(err.message || '이력 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px] p-4">
      <div className="bg-surface rounded-2xl shadow-modal max-w-3xl w-full p-6 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-text">명령 이력 — {agent.company_name}</h3>
          <button onClick={loadHistory} className="text-xs text-primary-600 hover:underline">새로고침</button>
        </div>

        {error && (
          <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2 mb-3">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-text-muted text-center py-8">로딩 중...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">명령 이력 없음</p>
          ) : (
            <div className="space-y-2">
              {history.map(cmd => (
                <CommandHistoryRow key={cmd.id} cmd={cmd} />
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <Button variant="secondary" className="w-full" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </div>
  );
}

function CommandHistoryRow({ cmd }: { cmd: CommandRecord }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = {
    completed: 'success',
    failed: 'error',
    expired: 'neutral',
    pending: 'warn',
    polled: 'warn',
  }[cmd.status] || 'neutral';

  return (
    <div className="bg-bg border border-border rounded-lg p-3">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Badge variant={statusColor as any}>{cmd.status}</Badge>
          <code className="text-xs font-semibold text-text">{cmd.type}</code>
          <span className="text-xs text-text-muted">
            {new Date(cmd.issued_at).toLocaleString('ko-KR')}
          </span>
          {cmd.duration_ms != null && (
            <span className="text-xs text-text-muted">({cmd.duration_ms}ms)</span>
          )}
        </div>
        <span className="text-xs text-text-muted">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-2 text-xs">
          <Row label="ID" value={cmd.id} mono />
          <Row label="발행자" value={cmd.issued_by} />
          {cmd.payload && <Row label="Payload" value={JSON.stringify(cmd.payload)} mono />}
          {cmd.polled_at && <Row label="수신 시각" value={new Date(cmd.polled_at).toLocaleString('ko-KR')} />}
          {cmd.responded_at && <Row label="응답 시각" value={new Date(cmd.responded_at).toLocaleString('ko-KR')} />}
          {cmd.result && (
            <div>
              <p className="font-semibold text-text mb-1">결과</p>
              <pre className="bg-surface border border-border rounded p-2 overflow-x-auto text-[10px] font-mono">{JSON.stringify(cmd.result, null, 2)}</pre>
            </div>
          )}
          {cmd.error_message && (
            <div>
              <p className="font-semibold text-error-600 mb-1">에러</p>
              <p className="bg-error-50 border border-error-500/20 rounded p-2 text-error-600">{cmd.error_message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="font-semibold text-text-secondary min-w-[80px]">{label}</span>
      <span className={`text-text break-all ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</span>
    </div>
  );
}
