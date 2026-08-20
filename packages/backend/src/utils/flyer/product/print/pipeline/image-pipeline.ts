/**
 * ★ D129 V2 — 인쇄전단 이미지 파이프라인 (기존 자산 재사용 전용)
 *
 * 역할: 상품 리스트의 imageUrl을 인쇄 가능한 품질로 변환
 *
 * ★ 2026-08-20 슈퍼버전업 1단계 개정 (13번 설계 §0-3·§3-5)
 *   - 인쇄물에는 **로컬 확보분만** 들어간다. 네이버 검색 소싱은 인쇄 경로에서 제거(제3자 저작물 인쇄 배포 차단).
 *   - 외부 http(s) URL은 다운로드 성공분만 data URL로 인라인하고, 실패하면 **이미지 없음**으로 내린다
 *     (외부 URL을 렌더에 직주입하던 옛 동작 폐기 — 핫링크 차단·타임아웃이 인쇄 PDF 빈 칸이 되는 사고 계열).
 *
 * 이미지 소싱 순서:
 *   1. product-images.ts getProductDisplay() — PRODUCT_MAP(로컬 서빙 자산) 매칭
 *   (네이버는 후보 제시 전용 — 확정분은 카탈로그에 로컬 저장돼 imageUrl로 들어온다)
 *
 * 배경제거: 기존 flyer-rembg.ts removeBackground() 재사용
 *   - 결과는 data:image/png;base64 data URL 인라인 (Puppeteer 네트워크 의존 제거)
 */

import { removeBackground } from '../../flyer-rembg';
import { getProductDisplay } from '../../../../product-images';

// ============================================================
// 타입
// ============================================================
export interface PipelineProduct {
  productName: string;
  imageUrl?: string;
  category?: string;
  [key: string]: any;
}

export interface PipelineOptions {
  autoRembg?: boolean;
  autoMatchImage?: boolean;
  companyId?: string;
}

// ============================================================
// 이미지 다운로드/디코딩
// ============================================================
async function fetchImageBuffer(src: string): Promise<Buffer | null> {
  if (!src) return null;
  try {
    // data URL
    if (src.startsWith('data:')) {
      const comma = src.indexOf(',');
      if (comma < 0) return null;
      const meta = src.slice(5, comma);
      const data = src.slice(comma + 1);
      if (meta.includes('base64')) return Buffer.from(data, 'base64');
      return Buffer.from(decodeURIComponent(data));
    }
    // http(s)
    if (/^https?:/i.test(src)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(src, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 이미지 버퍼 → data URL (Puppeteer 렌더용, 네트워크 의존 제거)
 */
function bufferToDataUrl(buffer: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// ============================================================
// 개별 상품 처리 — 기존 컨트롤타워만 호출
// ============================================================
async function processOne(
  product: PipelineProduct,
  opts: PipelineOptions,
): Promise<PipelineProduct> {
  let imageUrl = product.imageUrl || '';

  // 1. 이미지 없으면 로컬 자산에서만 찾기 (네이버 소싱 제거 — 13번 설계 §0-3)
  if (!imageUrl && opts.autoMatchImage) {
    const display = getProductDisplay(product.productName || '');
    if (display.imageUrl) {
      imageUrl = display.imageUrl;
    }
  }

  // 2. rembg 배경제거 (기존 flyer-rembg.ts) → data URL 인라인
  if (imageUrl && opts.autoRembg) {
    const buffer = await fetchImageBuffer(imageUrl);
    if (buffer && buffer.length > 0) {
      try {
        const removed = await removeBackground(buffer);
        if (removed && removed.length > 0) {
          imageUrl = bufferToDataUrl(removed, 'image/png');
        }
      } catch {
        // rembg 실패 시 원본 유지 (아래 3에서 외부 URL이면 인라인·차단 판정을 다시 받는다)
      }
    }
  }

  // 3. ★ 외부 URL 차단 — 인쇄 렌더에는 로컬(상대 경로)·data URL만 들어간다.
  //    외부 http(s)는 지금 다운로드해 인라인하고, 실패하면 이미지 없음으로 내린다(빈 칸·깨진 아이콘 금지 —
  //    무이미지 폴백은 렌더러의 스펙 슬랩이 받는다).
  if (imageUrl && /^https?:/i.test(imageUrl)) {
    const buffer = await fetchImageBuffer(imageUrl);
    if (buffer && buffer.length > 0) {
      const mime = imageUrl.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
      imageUrl = bufferToDataUrl(buffer, mime);
    } else {
      console.warn(`[image-pipeline] 외부 이미지 확보 실패 — 무이미지로 강등: ${product.productName}`);
      imageUrl = '';
    }
  }

  return { ...product, imageUrl };
}

// ============================================================
// 공개 API — 상품 배열 일괄 처리
// ============================================================
export async function processProductImages<T extends PipelineProduct>(
  products: T[],
  opts: PipelineOptions = {},
): Promise<T[]> {
  if (!opts.autoRembg && !opts.autoMatchImage) return products;

  // 동시성 제한 (rembg/네이버API 부하 고려) — 최대 3개 병렬
  const MAX_PARALLEL = 3;
  const out: T[] = new Array(products.length);

  for (let i = 0; i < products.length; i += MAX_PARALLEL) {
    const chunk = products.slice(i, i + MAX_PARALLEL);
    const results = await Promise.all(chunk.map(p => processOne(p, opts)));
    for (let j = 0; j < results.length; j++) {
      out[i + j] = results[j] as T;
    }
  }

  return out;
}
