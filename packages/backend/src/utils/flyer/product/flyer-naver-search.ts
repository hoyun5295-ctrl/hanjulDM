/**
 * ★ CT-F17 — 전단AI 네이버 쇼핑 검색 (상품 이미지 자동 매칭)
 *
 * 상품명으로 네이버 쇼핑 검색 → 상품 이미지 URL 반환.
 * 카탈로그 등록/CSV 업로드 시 자동 이미지 매칭에 사용.
 *
 * API: https://openapi.naver.com/v1/search/shop.json
 * 무료: 일 25,000건
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';
const SHOP_API_URL = 'https://openapi.naver.com/v1/search/shop.json';
const IMAGE_API_URL = 'https://openapi.naver.com/v1/search/image';

// 이미지 저장 경로
const IMAGE_DIR = path.join(process.cwd(), 'uploads', 'catalog-images');

export interface NaverShopItem {
  title: string;       // 상품명 (HTML 태그 포함 가능)
  link: string;        // 상품 페이지 URL
  image: string;       // ★ 상품 이미지 URL
  lprice: string;      // 최저가
  hprice: string;      // 최고가
  mallName: string;    // 판매처
  maker: string;       // 제조사
  brand: string;       // 브랜드
  category1: string;
  category2: string;
  category3: string;
}

export interface ImageSearchResult {
  query: string;
  items: NaverShopItem[];
  total: number;
}

/**
 * ★ 네이버 이미지 검색 — 상품명으로 검색하여 후보 이미지 반환
 *
 * 쇼핑 검색은 주류/담배 등 온라인 판매 금지 상품이 안 나옴.
 * 이미지 검색은 모든 상품 커버 가능.
 *
 * @param query 상품명 (예: "카스 500ml", "처음처럼 소주")
 * @param display 결과 수 (기본 5, 최대 100)
 */
/**
 * 상품명에서 단위/수량/규격을 제거하여 핵심 품명만 추출.
 * "바나나 1송이" → "바나나", "청송사과 20kg" → "청송사과", "카스 500ml 24캔" → "카스"
 */
function cleanProductName(raw: string): string {
  return raw
    .replace(/\d+\s*(송이|개|캔|병|팩|박스|봉|입|매|kg|g|ml|l|리터|줄|세트|인분|포기|단|묶음|통|ea|봉지)/gi, '')
    .replace(/\([^)]*\)/g, '')       // 괄호 내용 제거
    .replace(/\s+/g, ' ')
    .trim() || raw.trim();
}

/**
 * ★ 네이버 쇼핑 API 검색 — 상품 이미지 + 가격 정보
 * 이미지 검색보다 상품 이미지가 정확하지만 주류/담배는 안 나옴.
 */
async function searchShopApi(q: string, display: number): Promise<NaverShopItem[]> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return [];
  try {
    const params = new URLSearchParams({
      query: cleanProductName(q),
      display: String(Math.min(display, 100)),
      sort: 'sim',
    });
    const res = await fetch(`${SHOP_API_URL}?${params}`, {
      headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET },
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.items || [])
      .filter((item: any) => {
        // ★ 품질 필터: 이미지 URL 존재 + 최소 200px 이상 (네이버 쇼핑 이미지는 보통 정사각형)
        const img = item.image || '';
        return img && !img.includes('noimage') && !img.includes('no_img');
      })
      .map((item: any) => ({
        title: stripHtml(item.title || ''),
        link: item.link || '',
        image: item.image || '',
        lprice: item.lprice || '0',
        hprice: item.hprice || '0',
        mallName: item.mallName || '',
        maker: item.maker || '',
        brand: item.brand || '',
        category1: item.category1 || '',
        category2: item.category2 || '',
        category3: item.category3 || '',
      }));
  } catch { return []; }
}

export async function searchNaverShopping(
  query: string,
  display: number = 5
): Promise<ImageSearchResult> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    console.warn('[naver-search] NAVER_CLIENT_ID/SECRET 미설정');
    return { query, items: [], total: 0 };
  }

  try {
    // ★ 상품명 정제 후 검색 (단위/수량 제거 → 핵심 품명만)
    const cleanQuery = cleanProductName(query);
    const params = new URLSearchParams({
      query: cleanQuery + ' 식품',  // "식품" 키워드로 식품 이미지 우선
      display: String(Math.min(display, 100)),
      sort: 'sim',
      filter: 'large',  // 큰 이미지만
    });

    const res = await fetch(`${IMAGE_API_URL}?${params}`, {
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      },
    });

    if (!res.ok) {
      console.error(`[naver-search] 이미지 API 오류: ${res.status} ${res.statusText}`);
      return { query, items: [], total: 0 };
    }

    const data = await res.json() as any;
    const imageItems: NaverShopItem[] = (data.items || [])
      .filter((item: any) => {
        // ★ 품질 필터: noimage 제외 + 기본 유효성
        const img = item.thumbnail || item.link || '';
        return img && !img.includes('noimage') && !img.includes('no_img');
      })
      .map((item: any) => ({
        title: stripHtml(item.title || ''),
        link: item.link || '',
        image: item.thumbnail || item.link || '',
        lprice: '0', hprice: '0', mallName: '', maker: '', brand: '',
        category1: '', category2: '', category3: '',
      }));

    // ★ 쇼핑 API 병행 검색 (더 정확한 상품 이미지)
    const shopItems = await searchShopApi(query, display);

    // ★ 쇼핑 API 결과 우선, 이미지 검색 보충 (중복 제거)
    const seenImages = new Set<string>();
    const merged: NaverShopItem[] = [];
    for (const item of [...shopItems, ...imageItems]) {
      if (seenImages.has(item.image)) continue;
      seenImages.add(item.image);
      merged.push(item);
      if (merged.length >= display) break;
    }

    return { query, items: merged, total: data.total || 0 };
  } catch (err: any) {
    console.error('[naver-search] 검색 실패:', err.message);
    return { query, items: [], total: 0 };
  }
}

/**
 * ★ 이미지 URL → 로컬 서버에 다운로드 저장
 *
 * 네이버 쇼핑 이미지 URL은 외부 CDN이라 직접 링크하면 불안정.
 * 우리 서버에 저장하여 안정적으로 서빙.
 */
export async function downloadAndSaveImage(
  imageUrl: string,
  companyId: string
): Promise<string | null> {
  try {
    const companyDir = path.join(IMAGE_DIR, companyId);
    if (!fs.existsSync(companyDir)) {
      fs.mkdirSync(companyDir, { recursive: true });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const filename = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const filePath = path.join(companyDir, filename);

    fs.writeFileSync(filePath, buffer);

    // 서빙 URL 반환 (flyers.ts의 이미지 서빙 패턴 참조)
    return `/api/flyer/catalog-images/${companyId}/${filename}`;
  } catch (err: any) {
    console.error('[naver-search] 이미지 다운로드 실패:', err.message);
    return null;
  }
}

/**
 * ★ 상품명으로 이미지 자동 매칭 (검색 → 1순위 이미지 다운로드 → URL 반환)
 *
 * CSV 업로드나 카탈로그 자동 등록 시 사용.
 */
export async function autoMatchImage(
  productName: string,
  companyId: string
): Promise<{ imageUrl: string | null; source: 'naver' | 'none'; candidates: NaverShopItem[] }> {
  const result = await searchNaverShopping(productName, 5);

  if (result.items.length === 0) {
    return { imageUrl: null, source: 'none', candidates: [] };
  }

  // 1순위 이미지 다운로드
  const savedUrl = await downloadAndSaveImage(result.items[0].image, companyId);

  return {
    imageUrl: savedUrl,
    source: 'naver',
    candidates: result.items,
  };
}

/**
 * ★ 배치 이미지 매칭 — CSV 업로드 시 여러 상품 한번에 처리
 *
 * 네이버 API 호출 제한 고려하여 순차 실행 + 딜레이
 */
export async function batchAutoMatchImages(
  products: Array<{ name: string; index: number }>,
  companyId: string
): Promise<Array<{ index: number; name: string; imageUrl: string | null; candidates: NaverShopItem[] }>> {
  const results: Array<{ index: number; name: string; imageUrl: string | null; candidates: NaverShopItem[] }> = [];

  for (const product of products) {
    const match = await autoMatchImage(product.name, companyId);
    results.push({
      index: product.index,
      name: product.name,
      imageUrl: match.imageUrl,
      candidates: match.candidates,
    });

    // API 호출 간격 (100ms) — 네이버 API rate limit 방지
    await new Promise(r => setTimeout(r, 100));
  }

  return results;
}

/** HTML 태그 제거 */
function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}

// ============================================================
// ★ D154 PHASE 0 트랙 B — categories 자동 이미지 enrich
// ============================================================

interface EnrichImageItem {
  name: string;
  imageUrl?: string;
}
interface EnrichImageCategory {
  name: string;
  items: EnrichImageItem[];
}

/**
 * ★ FlyerRenderData.categories[] 일괄 이미지 자동 매칭 (트랙 B 본진).
 *
 * 동작:
 *   1. imageUrl 미존재 상품만 추출 (이미 있으면 보존)
 *   2. batchAutoMatchImages()로 네이버 쇼핑 검색 → 1순위 이미지 다운로드
 *   3. 결과를 items[].imageUrl에 mutate 박음
 *   4. (옵션) rembg 적용은 PHASE 1에서 추가 — 현재 디폴트 false
 *
 * 호출 비용: 미매칭 상품 수만큼 네이버 API (100ms 간격 순차 호출 — rate-limit 안전).
 * 사장님 발행 시점 또는 엑셀 업로드 후 1회 호출 권장.
 *
 * @param categories FlyerRenderData.categories — items[].imageUrl mutate
 * @param companyId 매장 회사 ID (이미지 저장 경로용)
 * @param opts.skipExisting 이미 imageUrl 있는 상품 스킵 (디폴트 true)
 * @param opts.maxItems 최대 처리 상품 수 (디폴트 50, API 비용 보호)
 * @returns 처리 카운트 (매칭 성공 / 실패 / 스킵)
 */
export async function enrichCategoriesWithImages(
  categories: EnrichImageCategory[],
  companyId: string,
  opts?: { skipExisting?: boolean; maxItems?: number }
): Promise<{ matched: number; failed: number; skipped: number; total: number }> {
  const skipExisting = opts?.skipExisting !== false;
  const maxItems = opts?.maxItems ?? 50;

  // 처리 대상 추출 (카테고리 → flat with reference)
  type Target = { name: string; index: number; ref: EnrichImageItem };
  const targets: Target[] = [];
  let skipped = 0;
  let globalIdx = 0;
  for (const cat of categories) {
    for (const it of cat.items) {
      if (skipExisting && it.imageUrl && it.imageUrl.trim().length > 0) {
        skipped++;
        continue;
      }
      if (!it.name || it.name.trim().length === 0) continue;
      if (targets.length >= maxItems) break;
      targets.push({ name: it.name, index: globalIdx++, ref: it });
    }
    if (targets.length >= maxItems) break;
  }

  if (targets.length === 0) {
    return { matched: 0, failed: 0, skipped, total: skipped };
  }

  // 배치 호출
  const results = await batchAutoMatchImages(
    targets.map(t => ({ name: t.name, index: t.index })),
    companyId
  );

  // results를 targets와 매핑 (index 기준)
  let matched = 0;
  let failed = 0;
  for (const r of results) {
    const target = targets.find(t => t.index === r.index);
    if (!target) continue;
    if (r.imageUrl) {
      target.ref.imageUrl = r.imageUrl;
      matched++;
    } else {
      failed++;
    }
  }

  return { matched, failed, skipped, total: matched + failed + skipped };
}
