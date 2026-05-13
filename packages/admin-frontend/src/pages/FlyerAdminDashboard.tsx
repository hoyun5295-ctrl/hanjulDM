/**
 * 한줄전단 AI 슈퍼관리자 — 메인 대시보드 (탭 라우팅 6+)
 *
 * 통계 카드 6 + 6 탭(회사/회원/매장/POS Agent/결제/감사로그).
 * backend: GET /api/admin/flyer/dashboard (확장 통계)
 * D155 확장: 매장 관리 + POS Agent + 결제 + 회사/회원 신규·수정 모달 통합
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { StatCard, TabBar } from '../components/ui';
import CompanyListPage from './CompanyListPage';
import UserListPage from './UserListPage';
import StoreListPage from './StoreListPage';
import PosAgentListPage from './PosAgentListPage';
import BillingPage from './BillingPage';
import AuditLogPage from './AuditLogPage';
import SenderRegistrationListPage from './SenderRegistrationListPage';

interface Props { token: string; user: any; }

interface DashboardStats {
  activeCompanies?: number;
  totalUsers?: number;
  totalCampaigns?: number;
  totalSent?: number;
  totalSuccess?: number;
  totalCustomers?: number;
  totalStores?: number;
  posAgentsTotal?: number;
  posAgentsActive?: number;
  monthlyBilling?: number;
  unpaidCount?: number;
  senderRegPending?: number;
}

type Tab = 'companies' | 'users' | 'stores' | 'pos' | 'senders' | 'billing' | 'audit';

export default function FlyerAdminDashboard({ token: _token, user: _user }: Props) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tab, setTab] = useState<Tab>('companies');

  const loadStats = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/dashboard`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // 통계 실패는 무시 (탭 화면 별도 로드)
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const fmtNum = (n: number | undefined) => n === undefined ? '-' : n.toLocaleString();
  const fmtMoney = (n: number | undefined) => n === undefined ? '-' : `₩${n.toLocaleString()}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">한줄전단 AI 슈퍼관리자</h1>
        <p className="text-sm text-text-secondary mt-1">회사·회원·매장·POS·결제·감사로그 통합 관리</p>
      </div>

      {/* 통계 카드 7 (D156 확장 — 발신번호 신청 대기 추가) */}
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
        <StatCard label="총판" value={fmtNum(stats?.activeCompanies)} />
        <StatCard label="회원" value={fmtNum(stats?.totalUsers)} />
        <StatCard label="매장" value={fmtNum(stats?.totalStores)} />
        <StatCard
          label="POS Agent"
          value={`${stats?.posAgentsActive ?? '-'} / ${stats?.posAgentsTotal ?? '-'}`}
          sub="활성/전체"
        />
        <StatCard
          label="발신번호 대기"
          value={fmtNum(stats?.senderRegPending)}
          sub="등록 신청"
        />
        <StatCard
          label="총 발송량"
          value={fmtNum(stats?.totalSent)}
          sub={stats?.totalSuccess !== undefined ? `성공 ${stats.totalSuccess.toLocaleString()}` : undefined}
        />
        <StatCard
          label="이달 청구액"
          value={fmtMoney(stats?.monthlyBilling)}
          sub={stats?.unpaidCount !== undefined && stats.unpaidCount > 0 ? `미결제 ${stats.unpaidCount}건` : undefined}
        />
      </div>

      <TabBar<Tab>
        tabs={[
          { key: 'companies', label: '회사(총판)' },
          { key: 'users', label: '회원' },
          { key: 'stores', label: '매장' },
          { key: 'pos', label: 'POS Agent' },
          { key: 'senders', label: `발신번호${stats?.senderRegPending ? ` (${stats.senderRegPending})` : ''}` },
          { key: 'billing', label: '결제' },
          { key: 'audit', label: '감사 로그' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'companies' && <CompanyListPage />}
      {tab === 'users' && <UserListPage />}
      {tab === 'stores' && <StoreListPage />}
      {tab === 'pos' && <PosAgentListPage />}
      {tab === 'senders' && <SenderRegistrationListPage />}
      {tab === 'billing' && <BillingPage />}
      {tab === 'audit' && <AuditLogPage />}
    </div>
  );
}
