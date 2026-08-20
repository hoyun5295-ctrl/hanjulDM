/**
 * ★ CT-F17 — 전단AI 네이버 이미지 후보 검색 (2026-08-20 슈퍼버전업 1단계 전면 개정 — 13번 설계 §3)
 *
 * ⛔ 정책 (13번 설계 §0-2·§3 — 어길 수 없는 것)
 *   1. 네이버 유래 이미지는 **자동 확정 금지** — 이 모듈은 후보만 반환한다. 확정은 언제나 사람 탭 1회
 *      (카탈로그 select-image → downloadAndSaveImage 경로가 유일한 확정 통로).
 *   2. 자동(무인) 경로에서 부를 수 있는 것은 **쇼핑 API 후보 검색뿐**. 이미지 검색 API(블로그·기사 등
 *      제3자 저작물 혼입)는 사장님이 눈으로 보고 고르는 수동 선택 UI에서만 쓴다(opts.includeImageSearch).
 *   3. 인쇄물 경로는 이 모듈을 부르지 않는다(로컬 파일만 — image-pipeline이 차단).
 *
 * 개정 전 결함(12번 검수·회의론자 실측): items[0] 무검증 확정 · 이미지 검색 상시 선호출 ·
 * ' 식품' 강제 접미 · 429/401을 빈 결과로 삼킴 · process.cwd() 저장 경로.
 *
 * API: https://openapi.naver.com/v1/search/shop.json (무료: 일 25,000건 — 키는 전 매장 공유)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';
const SHOP_API_URL = 'https://openapi.naver.com/v1/search/shop.json';
const IMAGE_API_URL = 'https://openapi.naver.com/v1/search/image';

// 이미지 저장 경로 — flyers.ts의 업로드 경로 패턴과 같은 기준(env 우선 + path.resolve).
// 옛 process.cwd() 직결은 실행 위치에 따라 저장·서빙 경로가 갈라지는 사고 계열(인쇄 10번 문서 §208)이라 폐기.
const IMAGE_DIR = process.env.CATALOG_IMAGE_PATH || path.resolve('./uploads/catalog-images');

export interface NaverShopItem {
  title: string;       // 상품명 (HTML 제거됨)
  link: string;        // 상품 페이지 URL
  image: string;       // 상품 이미지 URL (외부 CDN — 확정 전에는 저장하지 않는다)
  lprice: string;
  hprice: string;
  mallName: string;
  maker: string;
  brand: string;
  category1: string;
  category2: string;
  category3: string;
  /** ★ v10 신뢰도 — 정제 쿼리 토큰이 상품명에 얼마나 들어있는가 (0~1). 후보 정렬·게이트 판정용 */
  match_score: number;
  /** ★ 후보 출처 — shop(쇼핑 API) / image(이미지 검색 — 수동 UI 전용) */
  source: 'shop' | 'image';
}

export interface ImageSearchResult {
  query: string;
  items: NaverShopItem[];
  total: number;
  /** ★ API 실패 표면화 — 429(쿼터)·401(키) 등. 정상 = null. 빈 결과와 실패를 구분한다 */
  api_error: number | null;
}

/** 마지막 API 오류 상태(관제용) — 조용한 실패 금지(회의론자 파열점 3) */
let lastApiError: { status: number; at: string } | null = null;
export function getNaverApiState(): { lastError: { status: number; at: string } | null } {
  return { lastError: lastApiError };
}

/**
 * ★ 상품명 정규화 — POS 축약·프로모 토큰·규격을 걷어 핵심 품명만 남긴다.
 * 신뢰도 게이트보다 먼저다(회의론자 최종 검증 파열점 2 — 쿼리가 더러우면 무엇을 비교해도 기준선이 흔들린다).
 * "삼겹100g" → "삼겹" / "홈런볼*2" → "홈런볼" / "1+1 해태 홈런볼 46g×2" → "해태 홈런볼"
 */
export function cleanProductName(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/\d+\s*\+\s*\d+/g, ' ')                 // 프로모 토큰 1+1, 2+1
    .replace(/[*xX×]\s*\d+/g, ' ')                   // 수량 곱 *2, x2, ×2
    .replace(/\d+\s*%/g, ' ')                        // 할인율 표기
    .replace(/\d+([.,]\d+)?\s*(송이|개입|개|캔|병|팩|박스|봉지|봉|입|매|kg|g|ml|l|리터|줄|세트|인분|포기|단|묶음|통|ea|미|마리|판|모|근|되|말|호)\b/gi, ' ')
    .replace(/\d+([.,]\d+)?\s*(kg|g|ml|l)(?=\s|$|[^a-z가-힣])/gi, ' ') // 공백 없이 붙은 규격(삼겹100g)
    .replace(/\([^)]*\)/g, ' ')                      // 괄호 내용
    .replace(/\[[^\]]*\]/g, ' ')                     // 대괄호 내용
    .replace(/[/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || String(raw || '').trim();
}

/**
 * ★ 신뢰도 — 정제 쿼리 토큰(2자 이상) 중 상품명(title)에 포함된 비율(0~1).
 * 게이트 기준 = 전 토큰 포함(1.0). 토큰이 하나도 없으면 0(게이트 불통과 — 억지 매칭 금지).
 */
export function imageMatchConfidence(query: string, title: string): number {
  const t = String(title || '').toLowerCase().replace(/\s+/g, '');
  const tokens = cleanProductName(query).toLowerCase().split(' ').filter(w => w.length >= 2);
  if (tokens.length === 0 || !t) return 0;
  const hit = tokens.filter(w => t.includes(w)).length;
  return hit / tokens.length;
}

/** 게이트 통과 = 정제 토큰 전부가 상품명에 있다. 미달 후보는 자동 노출 목록에서 뺀다 */
export const MATCH_GATE_THRESHOLD = 1.0;
export function passesMatchGate(score: number): boolean {
  return score >= MATCH_GATE_THRESHOLD;
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}

function recordApiError(status: number, api: string) {
  lastApiError = { status, at: new Date().toISOString() };
  console.error(`[naver-search] ${api} API 오류: ${status}${status === 429 ? ' (일일 쿼터 소진 가능 — 키 전 매장 공유)' : status === 401 ? ' (키 인증 실패)' : ''}`);
}

/**
 * ★ 쇼핑 API 검색 — 자동(무인) 경로가 부를 수 있는 유일한 검색.
 * 실패(429/401 등)는 api_error로 표면화한다 — 빈 결과로 위장하지 않는다.
 */
async function searchShopApi(rawQuery: string, display: number): Promise<{ items: NaverShopItem[]; apiError: number | null }> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return { items: [], apiError: null };
  const cleanQuery = cleanProductName(rawQuery);
  try {
    const params = new URLSearchParams({
      query: cleanQuery,
      display: String(Math.min(display, 100)),
      sort: 'sim',
    });
    const res = await fetch(`${SHOP_API_URL}?${params}`, {
      headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET },
    });
    if (!res.ok) {
      recordApiError(res.status, 'shop');
      return { items: [], apiError: res.status };
    }
    const data = await res.json() as any;
    const items = (data.items || [])
      .filter((item: any) => {
        const img = item.image || '';
        return img && !img.includes('noimage') && !img.includes('no_img');
      })
      .map((item: any) => {
        const title = stripHtml(item.title || '');
        return {
          title,
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
          match_score: imageMatchConfidence(rawQuery, title),
          source: 'shop' as const,
        };
      });
    return { items, apiError: null };
  } catch (err: any) {
    console.error('[naver-search] shop 검색 실패:', err?.message || err);
    return { items: [], apiError: null };
  }
}

/**
 * ★ 이미지 검색 API — **수동 선택 UI 전용**(사장님이 눈으로 보고 고른다).
 * 결과에 블로그·기사 등 제3자 저작물이 섞이므로 자동 경로 호출 금지·인쇄 매체 진입 금지.
 */
async function searchImageApi(rawQuery: string, display: number): Promise<{ items: NaverShopItem[]; apiError: number | null }> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return { items: [], apiError: null };
  try {
    const params = new URLSearchParams({
      query: cleanProductName(rawQuery),        // 옛 ' 식품' 강제 접미 폐기 — 비식품(세제·생활용품) 오매칭 축
      display: String(Math.min(display, 100)),
      sort: 'sim',
      filter: 'large',
    });
    const res = await fetch(`${IMAGE_API_URL}?${params}`, {
      headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET },
    });
    if (!res.ok) {
      recordApiError(res.status, 'image');
      return { items: [], apiError: res.status };
    }
    const data = await res.json() as any;
    const items = (data.items || [])
      .filter((item: any) => {
        const img = item.thumbnail || item.link || '';
        return img && !img.includes('noimage') && !img.includes('no_img');
      })
      .map((item: any) => {
        const title = stripHtml(item.title || '');
        return {
          title,
          link: item.link || '',
          image: item.thumbnail || item.link || '',
          lprice: '0', hprice: '0', mallName: '', maker: '', brand: '',
          category1: '', category2: '', category3: '',
          match_score: imageMatchConfidence(rawQuery, title),
          source: 'image' as const,
        };
      });
    return { items, apiError: null };
  } catch (err: any) {
    console.error('[naver-search] image 검색 실패:', err?.message || err);
    return { items: [], apiError: null };
  }
}

/**
 * ★ 후보 검색 — 기본은 쇼핑 API만. 이미지 검색 병합은 수동 UI가 명시 요청할 때만.
 * 반환 후보는 match_score 내림차순 — 프론트는 그대로 상위부터 보여주면 된다.
 */
export async function searchNaverShopping(
  query: string,
  display: number = 5,
  opts?: { includeImageSearch?: boolean },
): Promise<ImageSearchResult> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    console.warn('[naver-search] NAVER_CLIENT_ID/SECRET 미설정');
    return { query, items: [], total: 0, api_error: null };
  }

  const shop = await searchShopApi(query, display);
  let merged: NaverShopItem[] = [...shop.items];
  let apiError = shop.apiError;

  if (opts?.includeImageSearch === true && merged.length < display) {
    const img = await searchImageApi(query, display);
    apiError = apiError ?? img.apiError;
    const seen = new Set(merged.map(i => i.image));
    for (const item of img.items) {
      if (seen.has(item.image)) continue;
      seen.add(item.image);
      merged.push(item);
    }
  }

  merged.sort((a, b) => b.match_score - a.match_score);
  merged = merged.slice(0, display);

  return { query, items: merged, total: merged.length, api_error: apiError };
}

/**
 * ★ 이미지 URL → 로컬 저장 — **사람 확정 후에만 부른다**(카탈로그 select-image 라우트).
 * 자동 경로에서 부르면 정책 위반이다(§0-2).
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

    return `/api/flyer/catalog-images/${companyId}/${filename}`;
  } catch (err: any) {
    console.error('[naver-search] 이미지 다운로드 실패:', err.message);
    return null;
  }
}

/**
 * ★ 상품명 → 후보 목록 (2026-08-20 의미 변경 — 자동 확정 폐지).
 *
 * 옛 동작: 1순위를 무검증 다운로드·확정(imageUrl 반환). → 상시 오매칭 + 제3자 저작물 유입 구조라 폐기.
 * 새 동작: 쇼핑 API 후보 + 신뢰도 점수만 반환한다. imageUrl은 항상 null —
 *          확정은 화면에서 사람이 고른 뒤 select-image(downloadAndSaveImage)로만.
 * 응답 형태(imageUrl·source·candidates)는 유지 — 기존 화면은 "자동 매칭 없음 + 후보 표시"로 동작한다.
 */
export async function autoMatchImage(
  productName: string,
  _companyId: string
): Promise<{ imageUrl: null; source: 'candidates' | 'none'; candidates: NaverShopItem[]; api_error: number | null }> {
  const result = await searchNaverShopping(productName, 5);
  if (result.items.length === 0) {
    return { imageUrl: null, source: 'none', candidates: [], api_error: result.api_error };
  }
  return {
    imageUrl: null,
    source: 'candidates',
    candidates: result.items,
    api_error: result.api_error,
  };
}

/**
 * ★ 배치 후보 검색 — CSV 업로드용. 확정 0건(후보만) · 429 감지 시 즉시 중단(조용한 소진 금지).
 */
export async function batchAutoMatchImages(
  products: Array<{ name: string; index: number }>,
  companyId: string
): Promise<Array<{ index: number; name: string; imageUrl: null; candidates: NaverShopItem[] }>> {
  const results: Array<{ index: number; name: string; imageUrl: null; candidates: NaverShopItem[] }> = [];

  for (const product of products) {
    const match = await autoMatchImage(product.name, companyId);
    results.push({
      index: product.index,
      name: product.name,
      imageUrl: null,
      candidates: match.candidates,
    });
    if (match.api_error === 429) {
      console.error('[naver-search] 배치 중단 — 일일 쿼터 소진(429). 남은 상품은 후보 없이 반환');
      for (const rest of products.slice(results.length)) {
        results.push({ index: rest.index, name: rest.name, imageUrl: null, candidates: [] });
      }
      break;
    }
    // API 호출 간격 (100ms) — rate limit 방지
    await new Promise(r => setTimeout(r, 100));
  }

  return results;
}

// ⛔ enrichCategoriesWithImages는 2026-08-20 삭제 — 소비처 0(12번 검수 미배선 4종째)이었고,
//    남겨두면 "카테고리 전체 무검증 자동 확정"이라는 정책 위반 경로가 부활 대기 상태가 된다.
//    필요해지는 날이 오면 후보 제시 + 사람 확정 구조로 새로 설계한다(13번 설계 §3).
