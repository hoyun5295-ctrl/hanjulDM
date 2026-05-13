/**
 * ★ 매장 사장님 POS Agent 페이지 (D159 V2)
 *
 * 기능:
 *  - Agent 미박힘 = 슈퍼관리자에게 Agent Key 요청 안내
 *  - Agent 박힘   = 현재 상태 모니터링 (heartbeat / sync_status / agent_version)
 *  - 인스톨러 다운로드 (Setup-X.X.X.exe)
 *  - 설치 단계별 가이드 (5단계)
 *  - Agent Key 복사 버튼
 *  - 10초마다 자동 새로고침 (실시간 모니터링)
 */

import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';

interface PosAgentInfo {
  id: string;
  agentKey: string;
  posType?: string;
  posVersion?: string;
  syncStatus?: string;
  lastHeartbeat?: string;
  agentVersion?: string;
  lastUpdateAt?: string;
  hostname?: string;
  ipAddress?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface PosAgentResponse {
  exists: boolean;
  agent?: PosAgentInfo;
}

interface Props {
  token: string;
}

const INSTALLER_DOWNLOAD_URL = 'https://hanjul-flyer.kr/downloads/Setup-latest.exe';

export default function PosAgentPage({ token: _token }: Props) {
  const [data, setData] = useState<PosAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const loadAgent = useCallback(async () => {
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/pos/my-agent`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error || 'Agent 정보 로드 실패');
      }
    } catch (err: any) {
      setError(err.message || 'Agent 정보 로드 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgent();
    // 10초마다 자동 새로고침
    const timer = setInterval(loadAgent, 10000);
    return () => clearInterval(timer);
  }, [loadAgent]);

  const handleCopyKey = () => {
    if (!data?.agent?.agentKey) return;
    navigator.clipboard.writeText(data.agent.agentKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownload = () => {
    window.open(INSTALLER_DOWNLOAD_URL, '_blank');
  };

  if (loading && !data) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-8 text-center">
        <p className="text-sm text-text-muted">POS Agent 정보 로드 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error-50 border border-error-500/20 rounded-2xl p-6">
        <p className="text-sm text-error-600">{error}</p>
        <button onClick={loadAgent} className="mt-3 text-xs text-primary-600 hover:underline">다시 시도</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── 헤더 ── */}
      <div>
        <h1 className="text-2xl font-bold text-text mb-2">POS Agent</h1>
        <p className="text-sm text-text-secondary">
          매장 POS 데이터를 자동으로 수집해서 전단 발송에 활용합니다. POS 업체 협조 없이 사장님 동의 하나로 즉시 연결됩니다.
        </p>
      </div>

      {/* ── 상태 카드 ── */}
      {data?.exists && data.agent ? (
        <AgentStatusCard agent={data.agent} onCopyKey={handleCopyKey} copied={copied} />
      ) : (
        <NoAgentCard />
      )}

      {/* ── 다운로드 + 가이드 ── */}
      <InstallGuideCard onDownload={handleDownload} hasAgent={!!data?.exists} agentKey={data?.agent?.agentKey} />

      {/* ── 마스킹 우회 안내 ── */}
      <MaskBypassInfoCard />

      {/* ── 데이터 처리 약관 ── */}
      <DataPolicyCard />
    </div>
  );
}

// ============================================================
// Agent 박힘 시 상태 카드
// ============================================================

function AgentStatusCard({ agent, onCopyKey, copied }: { agent: PosAgentInfo; onCopyKey: () => void; copied: boolean }) {
  const heartbeatStatus = computeHeartbeatStatus(agent.lastHeartbeat);
  const lastSyncText = agent.lastHeartbeat ? formatRelativeTime(agent.lastHeartbeat) : '미연결';

  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-base font-bold text-text mb-1">Agent 상태</h2>
          <p className="text-xs text-text-muted">10초마다 자동 새로고침</p>
        </div>
        <StatusBadge variant={heartbeatStatus.variant}>{heartbeatStatus.label}</StatusBadge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <StatItem label="POS 종류" value={agent.posType?.toUpperCase() || '감지 중'} />
        <StatItem label="마지막 통신" value={lastSyncText} />
        <StatItem label="Agent 버전" value={agent.agentVersion || '1.0.0'} />
        <StatItem label="호스트" value={agent.hostname || '-'} mono />
      </div>

      <div className="bg-bg border border-border rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-text-secondary">Agent Key</span>
          <button onClick={onCopyKey} className="text-xs text-primary-600 hover:underline">
            {copied ? '복사됨' : '복사'}
          </button>
        </div>
        <code className="text-xs text-text break-all font-mono">{agent.agentKey}</code>
      </div>

      {agent.lastUpdateAt && (
        <p className="text-xs text-text-muted mt-3">
          마지막 업데이트: {new Date(agent.lastUpdateAt).toLocaleString('ko-KR')}
        </p>
      )}
    </div>
  );
}

// ============================================================
// Agent 미박힘 시 안내 카드
// ============================================================

function NoAgentCard() {
  return (
    <div className="bg-warn-50 border border-warn-500/30 rounded-2xl p-6">
      <h2 className="text-base font-bold text-text mb-2">POS Agent 미등록</h2>
      <p className="text-sm text-text-secondary mb-4">
        POS Agent를 설치하면 매장 POS 데이터(고객/매출/재고)가 자동 수집되어 전단 발송에 활용됩니다.
        먼저 한줄전단AI 슈퍼관리자에게 <strong>Agent Key 발급</strong>을 요청해주세요.
      </p>
      <a
        href="mailto:support@hanjul-flyer.kr?subject=POS Agent 키 발급 요청"
        className="inline-block text-sm text-primary-600 hover:underline"
      >
        지원 문의 (이메일)
      </a>
    </div>
  );
}

// ============================================================
// 설치 가이드
// ============================================================

function InstallGuideCard({ onDownload, hasAgent, agentKey }: { onDownload: () => void; hasAgent: boolean; agentKey?: string }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-base font-bold text-text mb-1">설치 가이드</h2>
          <p className="text-xs text-text-muted">매장 사무실 PC (MySQL 서버 PC)에 1회 설치하면 끝</p>
        </div>
        <button
          onClick={onDownload}
          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          인스톨러 다운로드
        </button>
      </div>

      <ol className="space-y-4">
        <Step num={1} title="인스톨러 다운로드">
          위 [인스톨러 다운로드] 버튼 클릭 → <code className="text-xs bg-bg px-1.5 py-0.5 rounded">Setup-1.0.0.exe</code> 받기
        </Step>
        <Step num={2} title="설치 실행 (매장 사무실 PC)">
          매장 사무실 PC(POS 서버 PC)에 설치 파일 복사 → 더블클릭 → 약관 동의 → 설치 위치 기본값 확인 → [Next]
        </Step>
        <Step num={3} title="컴포넌트 선택">
          기본값(✓ Agent 본체 + ✓ 자동 가동 + ✓ 시작 메뉴) 유지 권장. Windows 서비스 등록은 관리자 권한 필요(선택)
        </Step>
        <Step num={4} title="Agent 첫 실행 + Agent Key 입력">
          설치 완료 → "POS Agent 즉시 시작" 체크 → CLI 마법사 가동 →
          {hasAgent && agentKey ? (
            <>
              <strong> 위 카드의 Agent Key 복사 후 입력</strong> ({agentKey.slice(0, 12)}...)
            </>
          ) : (
            <strong> 슈퍼관리자에게 받은 Agent Key 입력</strong>
          )}
        </Step>
        <Step num={5} title="DB 정보 입력 (또는 자동 감지)">
          POS DB 종류 선택 (MS-SQL / MySQL / SQLite) + 호스트/포트/계정/비번 입력.
          <strong className="text-primary-600"> 비번을 비우면 Agent가 자동으로 찾아냅니다 (Credential Discovery 7 어댑터)</strong>
        </Step>
      </ol>
    </div>
  );
}

function Step({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex-shrink-0 w-7 h-7 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-xs font-bold">
        {num}
      </span>
      <div className="flex-1 pt-0.5">
        <p className="text-sm font-semibold text-text mb-1">{title}</p>
        <p className="text-sm text-text-secondary">{children}</p>
      </div>
    </li>
  );
}

// ============================================================
// 마스킹 우회 안내
// ============================================================

function MaskBypassInfoCard() {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <h2 className="text-base font-bold text-text mb-3">마스킹된 전화번호 처리</h2>
      <p className="text-sm text-text-secondary mb-4">
        일부 POS는 전체 다운로드 시 <code className="text-xs bg-bg px-1.5 py-0.5 rounded">010-**95-8517</code> 같이 강제 마스킹을 적용합니다.
        하지만 DB에는 원본이 저장되어 있으며, Agent는 다음 3단 fallback으로 자동 우회합니다:
      </p>
      <div className="space-y-2">
        <FallbackRow num="1차" label="DB 직접 SELECT" desc="MySQL/MSSQL 직접 접근 (대부분 99% 매장 = 이 경로로 끝)" />
        <FallbackRow num="2차" label="백업 파일 자동 스캔" desc=".sql/.bak 정기 생성 파일에서 원본 추출 (24h 지연)" />
        <FallbackRow num="3차" label="UI 자동화 (새벽 무인)" desc="새벽 2~5시 POS 클라이언트 UI 자동 실행 → 회원 1명씩 클릭 (매장 영업 방해 0)" />
      </div>
    </div>
  );
}

function FallbackRow({ num, label, desc }: { num: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 bg-bg rounded-lg px-3 py-2.5">
      <span className="flex-shrink-0 text-xs font-bold text-primary-600">{num}</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-text">{label}</p>
        <p className="text-xs text-text-secondary">{desc}</p>
      </div>
    </div>
  );
}

// ============================================================
// 약관 안내
// ============================================================

function DataPolicyCard() {
  return (
    <div className="bg-bg border border-border rounded-2xl p-5">
      <h3 className="text-sm font-bold text-text mb-2">데이터 처리 정책 (요약)</h3>
      <ul className="space-y-1 text-xs text-text-secondary">
        <li>• 매장에서 발생한 모든 데이터의 <strong>소유권은 사장님</strong>께 있습니다.</li>
        <li>• Agent는 <strong>SELECT 권한만 사용</strong>합니다. 원본 데이터 변경/삭제 절대 없음.</li>
        <li>• 주민번호/카드번호는 자동 마스킹되어 전송됩니다.</li>
        <li>• 서비스 해지 시 30일 내 전체 데이터 삭제됩니다.</li>
      </ul>
      <a
        href="https://hanjul-flyer.kr/legal/pos-agent"
        target="_blank"
        rel="noopener"
        className="text-xs text-primary-600 hover:underline mt-2 inline-block"
      >
        전체 약관 보기 →
      </a>
    </div>
  );
}

// ============================================================
// 헬퍼
// ============================================================

function StatItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className={`text-sm font-semibold text-text ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ variant, children }: { variant: 'success' | 'warn' | 'error' | 'neutral'; children: React.ReactNode }) {
  const styles = {
    success: 'bg-success-50 text-success-600 border-success-500/30',
    warn: 'bg-warn-50 text-warn-600 border-warn-500/30',
    error: 'bg-error-50 text-error-600 border-error-500/30',
    neutral: 'bg-bg text-text-muted border-border',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${styles[variant]}`}>
      {children}
    </span>
  );
}

function computeHeartbeatStatus(lastHeartbeat?: string): { variant: 'success' | 'warn' | 'error' | 'neutral'; label: string } {
  if (!lastHeartbeat) return { variant: 'neutral', label: '미연결' };
  const diffSec = (Date.now() - new Date(lastHeartbeat).getTime()) / 1000;
  if (diffSec < 300) return { variant: 'success', label: '정상 가동' };
  if (diffSec < 1800) return { variant: 'warn', label: '연결 지연' };
  return { variant: 'error', label: '연결 끊김' };
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}초 전`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${Math.floor(diffHour / 24)}일 전`;
}
