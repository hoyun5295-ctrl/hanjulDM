/**
 * 한줄전단 AI 슈퍼관리자 — 메인 대시보드 (탭 라우팅)
 *
 * 통계 카드 + 3 탭(회사 관리 / 회원 관리 / 감사 로그).
 * backend: GET /api/admin/flyer/dashboard (통계)
 * D155: 단순 placeholder → 3 화면 분리 (소프트 삭제 + 감사 로그 통합)
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { StatCard, TabBar } from '../components/ui';
import CompanyListPage from './CompanyListPage';
import UserListPage from './UserListPage';
import AuditLogPage from './AuditLogPage';

interface Props { token: string; user: any; }

interface DashboardStats {
  activeCompanies?: number;
  totalUsers?: number;
  totalCampaigns?: number;
  totalSent?: number;
  totalSuccess?: number;
  totalCustomers?: number;
}

type Tab = 'companies' | 'users' | 'audit';

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">한줄전단 AI 슈퍼관리자</h1>
        <p className="text-sm text-text-secondary mt-1">매장 회사 관리 · 회원 관리 · 감사 로그</p>
      </div>

      {/* 통계 카드 (backend camelCase 응답) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="활성 매장" value={stats?.activeCompanies ?? '-'} />
        <StatCard label="전체 사용자" value={stats?.totalUsers ?? '-'} />
        <StatCard label="총 발송량" value={stats?.totalSent ?? '-'} />
        <StatCard label="총 매장 고객" value={stats?.totalCustomers ?? '-'} />
      </div>

      <TabBar<Tab>
        tabs={[
          { key: 'companies', label: '회사 관리' },
          { key: 'users', label: '회원 관리' },
          { key: 'audit', label: '감사 로그' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'companies' && <CompanyListPage />}
      {tab === 'users' && <UserListPage />}
      {tab === 'audit' && <AuditLogPage />}
    </div>
  );
}
