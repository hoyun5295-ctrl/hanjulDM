/**
 * ★ CT-F 1025 — 템플릿 갤러리 미리보기 PNG (17번 설계 §3-4)
 *
 * 목업(template-mocks) → renderTemplate(발행과 같은 길) → puppeteer PNG(393폭 · 머리+첫 상품 줄 크롭).
 * 캐시 키 = 코드 + 렌더 HTML 해시 — 템플릿·목업이 바뀌면 키가 바뀌어 자동 재생성(낡은 견본 0 · 파일 목록 관리 0).
 * 매장 데이터 0건(목업만) — 공개 이미지 라우트에서 써도 된다.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Browser } from 'puppeteer';
import { renderTemplate } from './flyer-templates';
import { buildMockRenderData } from './template-mocks';
import { TEMPLATE_REGISTRY } from '../config/flyer-business-types';

const SAMPLE_DIR = path.join(process.cwd(), 'uploads', 'template-samples');
const WIDTH = 393;
const HEIGHT = 720;
const inflight = new Map<string, Promise<Buffer>>();

function sampleHtml(code: string): { html: string; key: string } | null {
  const data = buildMockRenderData(code);
  if (!data) return null;
  const html = renderTemplate(code, data);
  const key = code + '-' + crypto.createHash('sha1').update(html).digest('hex').slice(0, 12);
  return { html, key };
}

/** 미리보기 PNG — 레지스트리에 없는 코드는 null */
export async function templateSamplePng(code: string, getBrowser: () => Promise<Browser>): Promise<Buffer | null> {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATE_REGISTRY, code)) return null;
  const s = sampleHtml(code);
  if (!s) return null;
  const file = path.join(SAMPLE_DIR, s.key + '.png');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const running = inflight.get(s.key);
  if (running) return running;

  const job = (async () => {
    // ★ 1025 Codex 1R: 브라우저·페이지 생성 실패도 진행 중 표시를 반드시 지운다(실패한 약속이 남아 영구 500)
    let page: Awaited<ReturnType<Browser['newPage']>> | null = null;
    await Promise.resolve(); // inflight.set 이 먼저 끝나게 한 틱 양보(동기 실패 시 finally 의 delete 가 set 보다 앞서지 않게)
    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.setContent(s.html, { waitUntil: 'load', timeout: 15000 });
      await page.evaluate('document.fonts && document.fonts.ready'); // 웹폰트까지 그린 뒤 찍는다
      const buf = Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } }));
      fs.mkdirSync(SAMPLE_DIR, { recursive: true });
      // 같은 코드의 옛 견본(다른 해시)은 지운다 — 배포마다 쌓이지 않게
      for (const f of fs.readdirSync(SAMPLE_DIR)) {
        if (f.startsWith(code + '-') && f !== s.key + '.png') fs.rmSync(path.join(SAMPLE_DIR, f), { force: true });
      }
      fs.writeFileSync(file, buf);
      return buf;
    } finally {
      if (page) await page.close().catch(() => {});
      inflight.delete(s.key);
    }
  })();
  inflight.set(s.key, job);
  return job;
}

/** 부팅 후 예열 — 20종 순차 렌더(실패는 로그만, 요청 시 재시도) */
export async function warmTemplateSamples(getBrowser: () => Promise<Browser>): Promise<void> {
  let ok = 0;
  for (const code of Object.keys(TEMPLATE_REGISTRY)) {
    try { if (await templateSamplePng(code, getBrowser)) ok++; }
    catch (err: any) { console.warn(`[template-sample] 예열 실패 ${code}:`, err?.message || err); }
  }
  console.log(`[template-sample] 예열 ${ok}/${Object.keys(TEMPLATE_REGISTRY).length}`);
}
