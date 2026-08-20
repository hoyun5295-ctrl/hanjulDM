/**
 * ★ CT-F (신규) — MMS + 알림톡 첨부 이미지 동적 HTML 생성 (D154 PHASE 0 §1-3)
 *
 * master plan §1-3 6매체 중 4·5번:
 *   4. MMS 이미지 (1080x1920 세로)
 *   5. 카카오 알림톡 첨부 이미지 (1000x1000 정사각)
 *
 * 6매체 통합 디자인 토큰(design-tokens.ts) + 시즌 토큰(season-resolver.ts) 적용.
 * URL 페이지(6 엔진) + 인쇄 A3(paged-pdf.ts) + POP(flyer-pop-templates.ts)와 동일 컬러 정합.
 *
 * 본 모듈은 HTML 생성만 담당. 실제 PNG 변환은 외부 호출자(puppeteer screenshot):
 *   - MMS: SMS 발송 워커에서 발송 직전 1회 생성 + S3/로컬 저장
 *   - 알림톡: 알림톡 발송 모듈에서 발송 직전 1회 생성 + IMC 첨부 업로드
 *
 * og-image.ts의 puppeteer 싱글톤 재사용 가능 (옵션 — 동시 사용 시 newPage()로 격리).
 */

import type { FlyerRenderData, FlyerRenderItem } from './flyer-templates';
import { categoryPictogram } from './flyer-render-prep';
import {
  esc, fmtPrice, calcDisc, toAbsUrl,
  storeInitial, flattenItems,
  categoryBg,
} from './flyer-templates';
import { SEASON_TOKENS, type SeasonToken } from './season-resolver';
import { generateMediaCssBlock, generateAllSeasonsCssBlock } from './design-tokens';

// ============================================================
// Hero 상품 자동 선정 (max 할인율 우선)
// ============================================================

function pickHero(items: Array<FlyerRenderItem & { category: string }>): (FlyerRenderItem & { category: string }) | null {
  if (items.length === 0) return null;
  let hero = items[0];
  let maxDisc = calcDisc(hero.originalPrice, hero.salePrice);
  for (let i = 1; i < items.length; i++) {
    const d = calcDisc(items[i].originalPrice, items[i].salePrice);
    if (d > maxDisc) { maxDisc = d; hero = items[i]; }
  }
  return hero;
}

function renderHeroBlock(hero: FlyerRenderItem & { category: string }, emojiSize: number): string {
  if (hero.imageUrl) {
    return `<img class="hero-img" src="${esc(toAbsUrl(hero.imageUrl) || '')}" alt="${esc(hero.name)}">`;
  }
  return `<div class="hero-ph" style="background:${categoryBg(hero.category)}"><span class="hero-emoji" style="font-size:${emojiSize}px">${categoryPictogram(hero.category)}</span></div>`;
}

// ============================================================
// MMS 이미지 HTML (1080x1920 세로)
// ============================================================

/**
 * ★ MMS 이미지 HTML 생성 (1080x1920 세로 — KISA MMS 표준).
 *
 * 레이아웃:
 *   상단 (0~480px): 매장 헤더 + 슬로건
 *   가운데 (480~1280px): Hero 상품 이미지
 *   하단 (1280~1920px): 가격 슬랩 + CTA + 행사 기간
 *
 * 6매체 통합: generateMediaCssBlock('mms', token) — typeScale 2.6 / spacingScale 2.4.
 */
export function renderMmsImageHtml(d: FlyerRenderData, token: SeasonToken): string {
  const tokenInfo = SEASON_TOKENS[token];
  const items = flattenItems(d);
  const hero = pickHero(items);
  const disc = hero ? calcDisc(hero.originalPrice, hero.salePrice) : 0;

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
${generateMediaCssBlock('mms', token)}
${generateAllSeasonsCssBlock('mms')}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1920px; overflow: hidden; }
body {
  font-family: 'Pretendard Variable', sans-serif;
  background: linear-gradient(180deg, ${tokenInfo.primary} 0%, ${tokenInfo.accent} 100%);
  color: ${tokenInfo.onPrimary};
  -webkit-font-smoothing: antialiased;
  padding: 100px 80px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 60px;
  position: relative;
}
body::before {
  content: ""; position: absolute; inset: 0;
  background: radial-gradient(60% 50% at 0% 0%, rgba(255,255,255,0.18), transparent 60%),
              radial-gradient(70% 60% at 100% 100%, rgba(0,0,0,0.18), transparent 60%);
  pointer-events: none;
}
.header { position: relative; z-index: 1; text-align: left; }
.brand { display: flex; align-items: center; gap: 24px; font-size: 32px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.95; }
.brand .crest { display: inline-grid; place-items: center; width: 80px; height: 80px; border-radius: 50%; background: rgba(0,0,0,0.22); font-size: 38px; font-weight: 900; }
.title { font-size: 130px; font-weight: 900; line-height: 0.95; letter-spacing: -0.04em; margin-top: 60px; word-break: keep-all; text-shadow: 0 4px 24px rgba(0,0,0,0.25); }
.store { font-size: 48px; font-weight: 800; margin-top: 40px; opacity: 0.98; }
.period { font-size: 32px; font-weight: 600; margin-top: 12px; opacity: 0.88; letter-spacing: 0.05em; }
.hero { position: relative; z-index: 1; display: grid; place-items: center; }
.hero-frame { width: 760px; height: 760px; border-radius: 56px; overflow: hidden; box-shadow: 0 32px 80px rgba(0,0,0,0.35); background: rgba(255,255,255,0.12); }
.hero-img { width: 100%; height: 100%; object-fit: cover; }
.hero-ph { width: 100%; height: 100%; display: grid; place-items: center; }
.hero-emoji { line-height: 1; filter: drop-shadow(0 20px 40px rgba(0,0,0,0.35)); }
.priceBlock { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: flex-start; }
.product-name { font-size: 56px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; opacity: 0.98; }
.product-meta { font-size: 28px; font-weight: 600; opacity: 0.8; margin-top: 12px; }
.priceRow { display: flex; align-items: baseline; gap: 20px; margin-top: 36px; font-variant-numeric: tabular-nums; }
.priceOrig { font-size: 36px; font-weight: 600; opacity: 0.65; text-decoration: line-through; }
.priceSale { font-size: 110px; font-weight: 900; letter-spacing: -0.03em; line-height: 1; }
.priceSale .won { font-size: 56px; font-weight: 800; margin-left: 4px; }
.priceBadge { display: inline-flex; align-items: center; padding: 14px 28px; background: rgba(0,0,0,0.4); border-radius: 999px; margin-top: 28px; font-size: 32px; font-weight: 800; letter-spacing: -0.01em; }
</style>
</head>
<body>
<div class="header">
  <div class="brand"><span class="crest">${esc(storeInitial(d.storeName))}</span>HANJUL · WEEKLY</div>
  <div class="title">${esc(d.title || '이번 주 행사')}</div>
  <div class="store">${esc(d.storeName)}</div>
  <div class="period">${esc(d.period)}</div>
</div>
<div class="hero">
  <div class="hero-frame">${hero ? renderHeroBlock(hero, 360) : ''}</div>
</div>
<div class="priceBlock">
  ${hero ? `
    <div class="product-name">${esc(hero.name)}${hero.unit ? ' · ' + esc(hero.unit) : ''}</div>
    <div class="product-meta">${esc(hero.origin || '')}${hero.cardDiscount ? ' · ' + esc(hero.cardDiscount) : ''}</div>
    <div class="priceRow">
      ${hero.originalPrice > 0 ? `<span class="priceOrig">${fmtPrice(hero.originalPrice)}원</span>` : ''}
      <span class="priceSale">${fmtPrice(hero.salePrice)}<span class="won">원</span></span>
    </div>
    ${hero.badge ? `<span class="priceBadge">${esc(hero.badge)}</span>` : (disc > 0 ? `<span class="priceBadge">${disc}% 할인</span>` : '')}
  ` : ''}
</div>
</body>
</html>`;
}

// ============================================================
// 알림톡 첨부 이미지 HTML (1000x1000 정사각)
// ============================================================

/**
 * ★ 카카오 알림톡 첨부 이미지 HTML 생성 (1000x1000 정사각 — 카카오 비즈톡 표준).
 *
 * 레이아웃 (정사각이라 컴팩트):
 *   상단 (0~200px): 매장 + 행사명
 *   가운데 (200~720px): Hero 상품 이미지
 *   하단 (720~1000px): 가격 + 행사 기간
 *
 * 6매체 통합: generateMediaCssBlock('alimtalk', token) — typeScale 2.4 / spacingScale 2.0.
 */
export function renderAlimtalkImageHtml(d: FlyerRenderData, token: SeasonToken): string {
  const tokenInfo = SEASON_TOKENS[token];
  const items = flattenItems(d);
  const hero = pickHero(items);
  const disc = hero ? calcDisc(hero.originalPrice, hero.salePrice) : 0;

  return `<!DOCTYPE html>
<html lang="ko" data-season="${esc(token)}">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>
${generateMediaCssBlock('alimtalk', token)}
${generateAllSeasonsCssBlock('alimtalk')}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1000px; height: 1000px; overflow: hidden; }
body {
  font-family: 'Pretendard Variable', sans-serif;
  background: linear-gradient(135deg, ${tokenInfo.primary} 0%, ${tokenInfo.accent} 100%);
  color: ${tokenInfo.onPrimary};
  -webkit-font-smoothing: antialiased;
  display: grid; grid-template-rows: auto 1fr auto;
  padding: 60px 60px;
  position: relative;
}
body::before {
  content: ""; position: absolute; inset: 0;
  background: radial-gradient(70% 60% at 0% 100%, rgba(255,255,255,0.16), transparent 60%);
  pointer-events: none;
}
.header { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 12px; }
.brand { display: flex; align-items: center; gap: 16px; font-size: 22px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; opacity: 0.92; }
.brand .crest { display: inline-grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: rgba(0,0,0,0.22); font-size: 28px; font-weight: 900; }
.title { font-size: 80px; font-weight: 900; line-height: 0.95; letter-spacing: -0.04em; word-break: keep-all; text-shadow: 0 4px 16px rgba(0,0,0,0.20); }
.store { font-size: 30px; font-weight: 800; opacity: 0.98; margin-top: 8px; }
.hero { position: relative; z-index: 1; display: grid; place-items: center; padding: 24px 0; }
.hero-frame { width: 440px; height: 440px; border-radius: 36px; overflow: hidden; box-shadow: 0 24px 56px rgba(0,0,0,0.32); background: rgba(255,255,255,0.12); }
.hero-img { width: 100%; height: 100%; object-fit: cover; }
.hero-ph { width: 100%; height: 100%; display: grid; place-items: center; }
.hero-emoji { line-height: 1; filter: drop-shadow(0 16px 32px rgba(0,0,0,0.35)); }
.priceBlock { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.product-name { font-size: 32px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; opacity: 0.98; }
.priceRow { display: flex; align-items: baseline; gap: 12px; margin-top: 6px; font-variant-numeric: tabular-nums; }
.priceOrig { font-size: 22px; font-weight: 600; opacity: 0.65; text-decoration: line-through; }
.priceSale { font-size: 64px; font-weight: 900; letter-spacing: -0.03em; line-height: 1; }
.priceSale .won { font-size: 32px; font-weight: 800; margin-left: 2px; }
.period { font-size: 22px; font-weight: 600; opacity: 0.88; margin-top: 4px; letter-spacing: 0.04em; }
</style>
</head>
<body>
<div class="header">
  <div class="brand"><span class="crest">${esc(storeInitial(d.storeName))}</span>HANJUL · WEEKLY</div>
  <div class="title">${esc(d.title || '이번 주 행사')}</div>
  <div class="store">${esc(d.storeName)}</div>
</div>
<div class="hero">
  <div class="hero-frame">${hero ? renderHeroBlock(hero, 220) : ''}</div>
</div>
<div class="priceBlock">
  ${hero ? `
    <div class="product-name">${esc(hero.name)}${hero.unit ? ' · ' + esc(hero.unit) : ''}${hero.badge ? ' · ' + esc(hero.badge) : (disc > 0 ? ' · ' + disc + '% 할인' : '')}</div>
    <div class="priceRow">
      ${hero.originalPrice > 0 ? `<span class="priceOrig">${fmtPrice(hero.originalPrice)}원</span>` : ''}
      <span class="priceSale">${fmtPrice(hero.salePrice)}<span class="won">원</span></span>
    </div>
  ` : ''}
  <div class="period">${esc(d.period)}</div>
</div>
</body>
</html>`;
}
