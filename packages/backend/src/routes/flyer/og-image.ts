/**
 * ★ og:image 동적 라우트 — D154 PHASE 0 트랙 A
 *
 * GET /api/flyer/og/:short_code.png
 *
 * 카톡 인박스 미리보기용 1200x630 PNG 동적 생성:
 *   1. short_code → flyer 조회
 *   2. resolveSeasonToken으로 시즌 토큰 자동 매핑
 *   3. renderOgImageHtml(data, token)로 HTML 생성 (시즌 grad + Hero 상품)
 *   4. puppeteer로 PNG screenshot (싱글톤 브라우저 재사용)
 *   5. LRU 캐시 (1시간 TTL, 최대 200건)
 *
 * 카톡 미리보기는 첫 요청 후 카톡 자체 캐싱 → 매장 정보 변경 시 OG URL에 ?v=N 쿼리 추가 권장.
 */

import { Router } from 'express';
import puppeteer, { Browser } from 'puppeteer';
import { query } from '../../config/database';
import { renderOgImageHtml, type FlyerRenderData } from '../../utils/flyer/product/flyer-templates';
import { resolveSeasonToken } from '../../utils/flyer/product/season-resolver';

const router = Router();

// ============================================================
// puppeteer 싱글톤 (flyer-pdf.ts와 별도 인스턴스, 격리)
// ============================================================

let _browser: Browser | null = null;
async function getOgBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ],
    });
  }
  return _browser;
}

// 프로세스 종료 시 cleanup
process.on('beforeExit', async () => {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
  }
});

// ============================================================
// LRU 캐시 (1시간 TTL, 최대 200건)
// ============================================================

interface OgCacheEntry { buf: Buffer; ts: number; }
const ogCache = new Map<string, OgCacheEntry>();
const OG_TTL_MS = 60 * 60 * 1000;
const OG_MAX = 200;

function cacheGet(key: string): Buffer | null {
  const entry = ogCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > OG_TTL_MS) {
    ogCache.delete(key);
    return null;
  }
  // LRU: hit 시 재삽입으로 신선도 갱신
  ogCache.delete(key);
  ogCache.set(key, entry);
  return entry.buf;
}

function cacheSet(key: string, buf: Buffer): void {
  if (ogCache.size >= OG_MAX) {
    const firstKey = ogCache.keys().next().value;
    if (firstKey) ogCache.delete(firstKey);
  }
  ogCache.set(key, { buf, ts: Date.now() });
}

// ============================================================
// 헬퍼
// ============================================================

function formatDate(d: string | Date): string {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
    const [, m, day] = d.trim().split('-').map(Number);
    return `${m}/${day}`;
  }
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ============================================================
// 라우트
// ============================================================

router.get('/og/:short_code.png', async (req, res) => {
  try {
    const { short_code } = req.params;
    if (!short_code || !/^[a-zA-Z0-9_-]{1,32}$/.test(short_code)) {
      return res.status(400).send('Invalid short_code');
    }

    // 캐시 hit
    const cached = cacheGet(short_code);
    if (cached) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
      return res.send(cached);
    }

    // flyer 조회 (short-urls.ts 패턴 미러 — short_urls 테이블 + TO_CHAR 날짜 변환)
    const result = await query(
      `SELECT f.id, f.title, f.store_name, f.categories,
              TO_CHAR(f.period_start, 'YYYY-MM-DD') as period_start,
              TO_CHAR(f.period_end, 'YYYY-MM-DD') as period_end
       FROM short_urls su
       INNER JOIN flyers f ON f.id = su.flyer_id
       WHERE su.code = $1
       LIMIT 1`,
      [short_code]
    );
    if (!result.rows.length) {
      return res.status(404).send('Not found');
    }

    const flyer = result.rows[0];
    const categories = typeof flyer.categories === 'string'
      ? JSON.parse(flyer.categories)
      : (flyer.categories || []);
    const periodStart = flyer.period_start ? formatDate(flyer.period_start) : '';
    const periodEnd = flyer.period_end ? formatDate(flyer.period_end) : '';
    const period = periodStart && periodEnd
      ? `${periodStart} ~ ${periodEnd}`
      : (periodStart || periodEnd || '');

    const data: FlyerRenderData = {
      storeName: flyer.store_name || '',
      title: flyer.title || '',
      period,
      categories,
      periodStart: flyer.period_start || null,
      periodEnd: flyer.period_end || null,
      shortCode: short_code,
    };

    const seasonToken = resolveSeasonToken(data.title, data.periodStart);
    const html = renderOgImageHtml(data, seasonToken);

    // puppeteer screenshot
    const browser = await getOgBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load', timeout: 10000 });
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: false,
        omitBackground: false,
        clip: { x: 0, y: 0, width: 1200, height: 630 },
      });
      const buf = Buffer.from(screenshot);
      cacheSet(short_code, buf);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
      return res.send(buf);
    } finally {
      await page.close().catch(() => {});
    }
  } catch (err: any) {
    console.error('[og-image] 생성 실패:', err && err.message ? err.message : err);
    return res.status(500).send('Internal error');
  }
});

export default router;
