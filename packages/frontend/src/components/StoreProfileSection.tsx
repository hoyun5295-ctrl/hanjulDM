/**
 * ★ D154 PHASE 0 §7 — 매장 프로필 입력 섹션
 *
 * 사장님이 1회 입력 → flyer_companies 신규 7 컬럼에 저장.
 * 전단 발행 시점에 short-urls.ts가 자동 join → 6 엔진 footer에 표시.
 * 미리보기(POST /preview-html)도 동일 패턴.
 *
 * Phase 7E에서 backend side 자동 merge 박힘.
 */

import { useState, useEffect } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Input } from './ui';
import AlertModal from './AlertModal';

interface CompanyProfile {
  company_name?: string;
  address?: string;
  store_hours?: string;
  store_phone?: string;
  owner_phone?: string;
  map_url?: string;
  kakao_channel_url?: string;
  instagram_url?: string;
  band_url?: string;
  blog_url?: string;
  shop_url?: string;
}

export default function StoreProfileSection() {
  const [form, setForm] = useState<CompanyProfile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  useEffect(() => {
    apiFetch(`${API_BASE}/api/flyer/companies`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setForm(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/companies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: form.company_name,
          address: form.address,
          store_hours: form.store_hours,
          store_phone: form.store_phone,
          map_url: form.map_url,
          kakao_channel_url: form.kakao_channel_url,
          instagram_url: form.instagram_url,
          band_url: form.band_url,
          blog_url: form.blog_url,
          shop_url: form.shop_url,
        }),
      });
      if (res.ok) {
        setAlert({ show: true, title: '저장 완료', message: '매장 프로필이 저장되었습니다. 이제 새 전단을 만들 때 매장 정보가 자동으로 불러와집니다.', type: 'success' });
      } else {
        setAlert({ show: true, title: '저장 실패', message: '저장에 실패했습니다.', type: 'error' });
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof CompanyProfile, value: string) => {
    setForm({ ...form, [key]: value });
  };

  return (
    <>
      <SectionCard title="매장 프로필" className="lg:col-span-2" action={
        <Button size="sm" onClick={handleSave} disabled={loading || saving}>{saving ? '저장 중...' : '저장'}</Button>
      }>
        <p className="text-xs text-text-muted mb-4">
          한 번 입력하면 전단 만들 때마다 자동으로 불러옵니다.<br />
          매장 전화·주소·영업시간·외부 링크가 전단 footer + 미리보기에 자동 표시됩니다.
        </p>

        <div className="text-xs font-semibold text-text-secondary mb-2 mt-1">기본 정보</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <Input label="매장명" value={form.company_name || ''} onChange={e => update('company_name', e.target.value)} placeholder="예: 동네마트 강남점" />
          <Input label="매장 대표 전화" value={form.store_phone || ''} onChange={e => update('store_phone', e.target.value)} placeholder="예: 02-1234-5678" />
          <Input label="매장 주소" value={form.address || ''} onChange={e => update('address', e.target.value)} placeholder="예: 서울 강남구 역삼로 14길 8" />
          <Input label="영업시간" value={form.store_hours || ''} onChange={e => update('store_hours', e.target.value)} placeholder="예: 09:00 ~ 22:00 (연중무휴)" />
        </div>

        <div className="text-xs font-semibold text-text-secondary mb-2 mt-2">외부 링크 (선택)</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input label="길찾기 URL" value={form.map_url || ''} onChange={e => update('map_url', e.target.value)} placeholder="https://map.kakao.com/... 또는 https://map.naver.com/..." />
          <Input label="카카오 채널" value={form.kakao_channel_url || ''} onChange={e => update('kakao_channel_url', e.target.value)} placeholder="https://pf.kakao.com/_..." />
          <Input label="인스타그램" value={form.instagram_url || ''} onChange={e => update('instagram_url', e.target.value)} placeholder="https://instagram.com/..." />
          <Input label="네이버 밴드" value={form.band_url || ''} onChange={e => update('band_url', e.target.value)} placeholder="https://band.us/..." />
          <Input label="블로그" value={form.blog_url || ''} onChange={e => update('blog_url', e.target.value)} placeholder="https://blog.naver.com/..." />
          <Input label="쇼핑몰" value={form.shop_url || ''} onChange={e => update('shop_url', e.target.value)} placeholder="https://..." />
        </div>
      </SectionCard>
      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </>
  );
}
