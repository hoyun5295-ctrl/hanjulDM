/**
 * 한줄전단 AI 슈퍼관리자 — 단순 placeholder
 *
 * D153 분리 시 한줄AI 본진 의존성(react-router-dom + zustand + ServiceSwitcher) 모두 폐기,
 * admin-frontend stack(React + Tailwind + apiFetch)으로 단순 재작성.
 *
 * 정식 기능 (총판/매장 매트릭스, 발송 통계 상세, 정산, 환불 등)은 PHASE 1에서 점진 확장.
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { StatCard, SectionCard, DataTable, Button } from '../components/ui';

interface Props { token: string; user: any; }

interface DashboardStats {
  active_companies?: number;
  total_users?: number;
  total_campaigns?: number;
  total_sent?: number;
  total_success?: number;
  total_customers?: number;
}

interface Company {
  id: string;
  company_name?: string;
  business_type?: string;
  owner_name?: string;
  owner_phone?: string;
  created_at?: string;
}

export default function FlyerAdminDashboard({ token: _token, user: _user }: Props) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadStats = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/dashboard`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err: any) {
      setError(err.message || '통계 로드 실패');
    }
  }, []);

  const loadCompanies = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/flyer/companies`);
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.items || data || []);
      }
    } catch (err: any) {
      setError(err.message || '회사 목록 로드 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadCompanies();
  }, [loadStats, loadCompanies]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">한줄전단 AI 슈퍼관리자</h1>
        <p className="text-sm text-text-secondary mt-1">매장 회사 관리 · 통계 · 정산</p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="활성 매장" value={stats?.active_companies ?? '-'} />
        <StatCard label="전체 사용자" value={stats?.total_users ?? '-'} />
        <StatCard label="총 발송량" value={stats?.total_sent ?? '-'} />
        <StatCard label="총 매장 고객" value={stats?.total_customers ?? '-'} />
      </div>

      {/* 회사 목록 */}
      <SectionCard
        title="매장 회사 목록"
        action={<Button size="sm">+ 회사 추가</Button>}
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
              { key: 'company_name', label: '회사명' },
              { key: 'business_type', label: '업종' },
              { key: 'owner_name', label: '대표자' },
              { key: 'owner_phone', label: '연락처' },
              { key: 'created_at', label: '등록일', render: (v) => v ? new Date(v).toLocaleDateString('ko-KR') : '-' },
            ]}
            rows={companies}
            emptyMessage="등록된 매장이 없습니다"
          />
        )}
      </SectionCard>

      <p className="text-xs text-text-muted text-center">
        ※ 추가 기능(총판/매장 매트릭스, 발송 통계 상세, 정산, 환불 등)은 PHASE 1에서 점진 확장 예정
      </p>
    </div>
  );
}
