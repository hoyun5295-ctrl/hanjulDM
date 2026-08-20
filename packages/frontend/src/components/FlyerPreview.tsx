/**
 * ★ D154 PHASE 0 — 전단 미리보기 iframe
 *
 * backend POST /api/flyer/p/preview-html에 FlyerRenderData 전송 →
 * V4 6 엔진 HTML 응답 → Blob URL + iframe으로 표시.
 * 350ms 디바운스로 사장님 타이핑 매번 호출 차단.
 *
 * V3 React 미러 (FlyerPage.tsx 안 약 280줄)는 backend 6 엔진 V4로 통합 → backend SSOT.
 * 옛 미러는 unused 코드로 그대로 두고 cleanup은 PHASE 1로 미룸.
 */

import { useState, useEffect, useRef } from 'react';
import { API_BASE, apiFetch } from '../App';

// ★ 신규 6 엔진은 모바일 393px viewport 기준 작성.
// 미리보기 폰 프레임 콘텐츠 영역(약 248px)에 맞추기 위해 CSS transform scale 적용.
const TARGET_VIEWPORT_WIDTH = 393;

interface FlyerItem {
  name: string;
  originalPrice: number;
  salePrice: number;
  badge?: string;
  imageUrl?: string;
  unit?: string;
  origin?: string;
  cardDiscount?: string;
  aiCopy?: string;
}

interface FlyerCategory {
  name: string;
  items: FlyerItem[];
}

interface Props {
  title: string;
  storeName: string;
  periodStart: string;
  periodEnd: string;
  categories: FlyerCategory[];
  template: string;
  /** ★ 2026-08-20 디자인 변형(auto-build 결과) — 미리보기 = 발행 동일 주입 경로(13번 설계 §1-3) */
  designVariant?: any;
}

function fmtDate(d: string): string {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export default function FlyerPreview({ title, storeName, periodStart, periodEnd, categories, template, designVariant = null }: Props) {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [hasContent, setHasContent] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.63);
  const [containerSize, setContainerSize] = useState({ width: 248, height: 460 });

  // 컨테이너 width 자동 측정 → scale 계산 (폰 프레임 사이즈 변경 시 자동 fit)
  useEffect(() => {
    if (!wrapRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0) {
          setScale(w / TARGET_VIEWPORT_WIDTH);
          setContainerSize({ width: w, height: h });
        }
      }
    });
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cleanCats = categories
      .map(c => ({ ...c, items: c.items.filter(i => i.name.trim()) }))
      .filter(c => c.items.length > 0);
    const contentPresent = !!(title.trim() || cleanCats.length > 0);
    setHasContent(contentPresent);
    if (!contentPresent) {
      setBlobUrl('');
      return;
    }

    let cancelled = false;
    let prevBlobUrl: string | null = null;
    const period = (periodStart || periodEnd) ? `${fmtDate(periodStart)} ~ ${fmtDate(periodEnd)}` : '';

    const debounce = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/flyer/p/preview-html`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            store_name: storeName,
            title,
            period,
            period_start: periodStart || null,
            period_end: periodEnd || null,
            categories: cleanCats,
            template,
            design_variant: designVariant || undefined,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setBlobUrl('');
          return;
        }
        const html = await res.text();
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        if (prevBlobUrl) URL.revokeObjectURL(prevBlobUrl);
        prevBlobUrl = url;
        if (!cancelled) setBlobUrl(url);
      } catch {
        if (!cancelled) setBlobUrl('');
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      if (prevBlobUrl) URL.revokeObjectURL(prevBlobUrl);
    };
  }, [title, storeName, periodStart, periodEnd, JSON.stringify(categories), template, JSON.stringify(designVariant)]);

  // iframe 안 viewport = 393px 모바일. 컨테이너 width 자동 측정 후 scale로 fit.
  const iframeHeight = containerSize.height / scale;

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {!hasContent ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: 11, marginTop: 80 }}>
          <p style={{ fontSize: 10, color: '#999' }}>상품을 입력하면<br />미리보기가 표시됩니다</p>
        </div>
      ) : !blobUrl ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 10, marginTop: 80 }}>
          미리보기 생성 중...
        </div>
      ) : (
        <iframe
          src={blobUrl}
          style={{
            width: TARGET_VIEWPORT_WIDTH + 'px',
            height: iframeHeight + 'px',
            border: 'none',
            display: 'block',
            transform: 'scale(' + scale + ')',
            transformOrigin: 'top left',
          }}
          title="전단지 미리보기"
          sandbox="allow-same-origin allow-scripts"
        />
      )}
    </div>
  );
}
