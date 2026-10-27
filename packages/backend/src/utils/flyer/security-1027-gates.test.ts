/**
 * ★ 2026-10-27 보안 게이트 (의존성 보안판 · W2 로그인 요청 제한 · W3 렌더 크롬 샌드박스)
 *
 * W3  렌더 크롬은 CT-F render-browser 한 곳에서만 띄운다 · 샌드박스를 끄는 인자 0.
 *     옛 = og-image · flyer-pdf 두 곳이 `--no-sandbox` 로 따로 띄웠다.
 * W2  비밀(비밀번호 · OTP · 등록 토큰)을 맞혀 보는 라우트는 전부 loginLimiter 를 먼저 거친다.
 *     대상 = 라우트 본문에 확인 함수가 있는 것(소스에서 기계로 뽑는다 · 손 등재 표 아님).
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';

import { resolveRenderChrome, RENDER_BROWSER_ARGS } from './product/render-browser';
import { loginLimiter } from '../../middlewares/login-limiter';

const BACKEND_SRC = path.resolve(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== 'dist') walk(p, out); }
    else if (/\.ts$/.test(f.name) && !f.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const SRC = walk(BACKEND_SRC).map(file => ({ file: path.relative(BACKEND_SRC, file).replace(/\\/g, '/'), text: fs.readFileSync(file, 'utf-8') }));
const CT = 'utils/flyer/product/render-browser.ts';

// ────────────────────────────────────────────────────
// W3 렌더 크롬 샌드박스
// ────────────────────────────────────────────────────
describe('W3 렌더 크롬 = 샌드박스 켠 채 한 곳에서만', () => {
  const SANDBOX_OFF = /no-sandbox|disable-setuid-sandbox|no-zygote|single-process|disable-namespace-sandbox|disable-seccomp/;

  it('샌드박스를 끄는 인자가 소스 어디에도 없다', () => {
    expect(SRC.filter(s => SANDBOX_OFF.test(s.text.replace(/^\s*(\*|\/\/).*$/gm, ''))).map(s => s.file)).toEqual([]);
    for (const a of RENDER_BROWSER_ARGS) expect(SANDBOX_OFF.test(a), a).toBe(false);
  });

  it('puppeteer 값 import · require 는 CT 한 곳뿐(나머지는 import type)', () => {
    const valueImport = /import\s+(?!type\b)[^;]*from\s+['"]puppeteer(-core)?['"]|require\(\s*['"]puppeteer(-core)?['"]\s*\)|import\(\s*['"]puppeteer(-core)?['"]\s*\)/;
    expect(SRC.filter(s => valueImport.test(s.text)).map(s => s.file)).toEqual([CT]);
  });

  it('CT 의 기동은 허용 인자 목록만 넘기고 기본 인자를 빼지 않는다', () => {
    const ct = SRC.find(s => s.file === CT)!.text;
    expect(ct.match(/puppeteer\.launch\(/g)).toHaveLength(1);
    expect(ct).toMatch(/puppeteer\.launch\(\{[^}]*args:\s*\[\.\.\.RENDER_BROWSER_ARGS\]/);
    expect(ct).not.toMatch(/ignoreDefaultArgs|pipe:|puppeteer\.connect/);
  });

  describe('크롬 경로 = root 전용 /opt/hanjul-chrome 우선', () => {
    const EXPECTED = async () => '/home/administrator/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome';
    const EXACT = '/opt/hanjul-chrome/156.0.8078.47/chrome-linux64/chrome';
    const CURRENT = '/opt/hanjul-chrome/current/chrome-linux64/chrome';

    it('환경값이 있으면 그것', async () => {
      expect(await resolveRenderChrome(' /x/chrome ', () => true, EXPECTED)).toBe('/x/chrome');
    });
    it('puppeteer 가 기대하는 판이 /opt 에 있으면 그 판', async () => {
      expect(await resolveRenderChrome(undefined, p => p === EXACT || p === CURRENT, EXPECTED)).toBe(EXACT);
    });
    it('그 판이 없으면 current', async () => {
      expect(await resolveRenderChrome(undefined, p => p === CURRENT, EXPECTED)).toBe(CURRENT);
    });
    it('기대 경로를 못 구해도 current', async () => {
      expect(await resolveRenderChrome('', p => p === CURRENT, async () => { throw new Error('x'); })).toBe(CURRENT);
    });
    it('/opt 에 아무것도 없으면(로컬 개발) puppeteer 기본', async () => {
      expect(await resolveRenderChrome(undefined, () => false, EXPECTED)).toBeUndefined();
    });
  });
});

// ────────────────────────────────────────────────────
// W2 로그인 요청 제한
// ────────────────────────────────────────────────────
describe('W2 비밀을 맞혀 보는 라우트 = loginLimiter 먼저', () => {
  const VERIFY = /bcrypt\.compare|verifyTotpCode|verifyBackupCode|verifyEnrollToken/;
  const routes = SRC.filter(s => s.file.startsWith('routes/')).flatMap(s => {
    const parts = s.text.split(/(?=\brouter\.(?:get|post|put|patch|delete|all|use)\()/);
    return parts.filter(p => /^router\./.test(p) && VERIFY.test(p)).map(p => ({ file: s.file, head: p.slice(0, p.indexOf('async') >= 0 ? p.indexOf('async') : 120) }));
  });

  it('대상이 기계로 뽑힌다(매장 로그인 · 비밀번호 변경 · 슈퍼 로그인 · OTP 확인 · 비밀번호 변경)', () => {
    expect(routes.map(r => `${r.file} ${r.head.match(/\(\s*'([^']+)'/)?.[1]}`).sort()).toEqual([
      'routes/flyer/auth.ts /change-password',
      'routes/flyer/auth.ts /login',
      'routes/flyer/super.ts /change-password',
      'routes/flyer/super.ts /confirm-totp',
      'routes/flyer/super.ts /login',
    ]);
  });

  it('각 라우트의 첫 미들웨어가 loginLimiter', () => {
    for (const r of routes) expect(r.head, `${r.file} ${r.head}`).toMatch(/^router\.\w+\(\s*'[^']+',\s*loginLimiter,/);
  });

  describe('동작 — 들어올 때 세고 성공으로 끝나면 뺀다(같은 IP · 처리 중 + 1분 안 실패 > 10 = 429)', () => {
    let release: () => void = () => {};
    let gate = Promise.resolve();
    let arrived = 0;
    const app = express();
    app.use(express.json());
    const answer = (req: express.Request, res: express.Response) =>
      req.body?.pw === 'right' ? res.json({ ok: true }) : res.status(401).json({ error: 'wrong' });
    app.post('/login', loginLimiter, answer);
    app.post('/held', loginLimiter, async (req, res) => { arrived++; await gate; answer(req, res); });
    const server = http.createServer(app);
    const base = new Promise<string>(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
    afterAll(() => new Promise<void>(r => server.close(() => r())));
    const post = async (route: string, pw: string) =>
      (await fetch(`${await base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pw }) })).status;
    const hold = () => { arrived = 0; gate = new Promise<void>(r => { release = r; }); };
    const untilArrived = async (n: number) => { for (let i = 0; i < 200 && arrived < n; i++) await new Promise(r => setTimeout(r, 10)); };
    const count = (xs: number[]) => xs.reduce<Record<number, number>>((m, s) => ({ ...m, [s]: (m[s] || 0) + 1 }), {});

    it('차례로: 성공 12번 → 실패 10번(401) → 11번째 실패 · 맞는 비밀번호도 429', async () => {
      await loginLimiter.resetKey('127.0.0.1');
      for (let i = 0; i < 12; i++) expect(await post('/login', 'right')).toBe(200);
      for (let i = 0; i < 10; i++) expect(await post('/login', 'wrong'), `실패 ${i + 1}`).toBe(401);
      expect(await post('/login', 'wrong')).toBe(429);
      expect(await post('/login', 'right')).toBe(429);
    });

    it('몰아 보낸 추측 15건 = 10건만 처리 · 5건 429 · 끝난 뒤 맞는 비밀번호도 429', async () => {
      await loginLimiter.resetKey('127.0.0.1');
      hold();
      const all = Array.from({ length: 15 }, () => post('/held', 'wrong'));
      await untilArrived(10);
      await new Promise(r => setTimeout(r, 100));
      expect(arrived).toBe(10);
      release();
      expect(count(await Promise.all(all))).toEqual({ 401: 10, 429: 5 });
      expect(await post('/login', 'right')).toBe(429);
    });

    it('정상 동시 11건 = 1건 429 · 처리 중 요청이 끝나면 바로 다시 통과', async () => {
      await loginLimiter.resetKey('127.0.0.1');
      hold();
      const all = Array.from({ length: 11 }, () => post('/held', 'right'));
      await untilArrived(10);
      await new Promise(r => setTimeout(r, 100));
      release();
      expect(count(await Promise.all(all))).toEqual({ 200: 10, 429: 1 });
      expect(await post('/login', 'right')).toBe(200);
    });
  });
});
