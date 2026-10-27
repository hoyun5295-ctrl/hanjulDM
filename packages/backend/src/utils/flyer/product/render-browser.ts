/**
 * ★ 2026-10-27 CT-F 렌더 크롬 기동 한 곳 — 샌드박스 필수
 *
 * 옛 = OG 이미지(og-image.ts) · 전단 PDF(flyer-pdf.ts) 두 곳이 따로 `--no-sandbox` 로 띄웠다.
 * 매장이 넣은 글자(상품명 · 매장명)가 섞인 HTML 을 그리는 크롬이라 샌드박스가 크롬 취약점과 서버 권한 사이의 벽이다.
 *
 * 크롬 = root 만 쓸 수 있는 /opt/hanjul-chrome 아래(서버 공용 · AppArmor 예외가 그 경로에만 걸려 샌드박스가 뜬다).
 *   찾는 순서 = HANJULDM_RENDER_CHROME → 이 puppeteer 가 기대하는 판과 같은 /opt/hanjul-chrome/<판> → /opt/hanjul-chrome/current
 *   → 그것도 없으면(로컬 개발) puppeteer 기본 경로. 서버에서 샌드박스가 안 뜨면 기동이 실패한다(닫힌 쪽 · 샌드박스 없이 다시 띄우지 않는다).
 * 크롬을 /opt 에 옮기는 것 = 서버 root 절차(한줄AI 저장소 scripts/install-render-chrome.sh · 같은 판 Chrome 156 · status/OPS.md).
 */
import fs from 'fs';
import puppeteer, { type Browser } from 'puppeteer';

export const RENDER_CHROME_BASE = '/opt/hanjul-chrome';
const CHROME_IN_DIR = 'chrome-linux64/chrome';

/** 기동 인자 — 이 목록 밖 인자는 넣지 않는다(샌드박스를 끄는 인자 0 · 계약 시험이 단정) */
export const RENDER_BROWSER_ARGS: readonly string[] = ['--disable-gpu', '--disable-dev-shm-usage'];

/** 쓸 크롬 실행 파일 — 없으면 undefined(= puppeteer 기본) */
export async function resolveRenderChrome(
  env: string | undefined = process.env.HANJULDM_RENDER_CHROME,
  exists: (p: string) => boolean = fs.existsSync,
  expectedPath: () => Promise<string> = async () => String(await puppeteer.executablePath()),
): Promise<string | undefined> {
  if (env && env.trim()) return env.trim();
  let ver = '';
  try { ver = ((await expectedPath()).match(/linux-([0-9.]+)/) || [])[1] || ''; } catch { ver = ''; }
  const exact = ver ? `${RENDER_CHROME_BASE}/${ver}/${CHROME_IN_DIR}` : '';
  if (exact && exists(exact)) return exact;
  const current = `${RENDER_CHROME_BASE}/current/${CHROME_IN_DIR}`;
  if (exists(current)) return current;
  return undefined;
}

/** 렌더 크롬 기동(샌드박스 켠 채) — 실패하면 그대로 던진다 */
export async function launchRenderBrowser(): Promise<Browser> {
  return puppeteer.launch({ headless: true, executablePath: await resolveRenderChrome(), args: [...RENDER_BROWSER_ARGS] });
}
