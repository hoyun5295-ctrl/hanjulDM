/**
 * ★ POS Adapter Registry — 8 어댑터 슬롯 + AI fallback + 학습 루프
 *
 * 흐름:
 *  1. db-detector.detectPosDb() → posType 식별
 *  2. selectAdapter(posType) → 매칭 어댑터 반환
 *  3. 매칭 어댑터의 getStaticMapping() 또는 validateMapping() 호출
 *  4. 어댑터 미매치 시 ai-fallback 호출
 *
 * 학습 루프:
 *  - AI fallback이 confidence 95%+로 성공 시
 *  - reportAdapterCandidate() 호출 → 서버로 학습 데이터 전송
 *  - 슈퍼관리자가 1회 검수 → 정식 어댑터로 등록
 *
 * ⚠️ OKPOS/POSBank/Togethers 어댑터 본체는 묶음 5 (매장 검증 캡처 후) 박힘.
 *    현재는 슬롯만 박힘 (placeholder).
 */

import { logger } from './logger';
import { aiFallbackAdapter } from './adapters/ai-fallback';
import type { PosAdapter, PosTableMapping } from './adapters/base';
import type { DiscoveredCredential } from './credential-discovery';
import type { PosDetectionResult } from './db-detector';

// ============================================================
// Registry 상태
// ============================================================

const adapters: PosAdapter[] = [];
let aiFallbackRegistered = false;

// ============================================================
// 등록
// ============================================================

export function registerAdapter(adapter: PosAdapter): void {
  if (adapters.some(a => a.name === adapter.name)) {
    logger.warn(`POS 어댑터 중복 등록 무시: ${adapter.name}`);
    return;
  }
  adapters.push(adapter);
  adapters.sort((a, b) => a.priority - b.priority);
  logger.info(`POS 어댑터 등록: ${adapter.name} v${adapter.version} (priority ${adapter.priority})`);
}

export function listAdapters(): Array<{ name: string; version: string; priority: number; description: string }> {
  return adapters.map(a => ({
    name: a.name,
    version: a.version,
    priority: a.priority,
    description: a.description,
  }));
}

/** 기본 어댑터 자동 등록 (ai-fallback만 + 묶음 5 이후 OKPOS 등 추가) */
export function registerDefaultAdapters(): void {
  if (!aiFallbackRegistered) {
    registerAdapter(aiFallbackAdapter);
    aiFallbackRegistered = true;
  }

  // ⚠️ OKPOS/POSBank/Togethers 어댑터는 매장 검증 캡처 후 묶음 5에서 등록.
  // import { okposAdapter } from './adapters/okpos';
  // registerAdapter(okposAdapter);
}

// ============================================================
// 어댑터 선택
// ============================================================

export function selectAdapter(posType: string, credential?: DiscoveredCredential): PosAdapter | null {
  // 알려진 어댑터 매칭 시도
  for (const adapter of adapters) {
    if (adapter.name === 'ai-fallback') continue; // ai-fallback은 마지막
    if (adapter.matches(posType, credential)) {
      logger.info(`POS 어댑터 매칭: ${adapter.name} (posType=${posType})`);
      return adapter;
    }
  }

  // 모두 미매치 → ai-fallback
  if (aiFallbackRegistered) {
    logger.info(`POS 어댑터 미매치 — ai-fallback 사용 (posType=${posType})`);
    return aiFallbackAdapter;
  }

  logger.error(`POS 어댑터 선택 실패: posType=${posType}, ai-fallback 미등록`);
  return null;
}

// ============================================================
// 통합 진입점
// ============================================================

export interface AdapterResolutionResult {
  adapter: PosAdapter;
  mapping: PosTableMapping;
  source: 'static' | 'validated' | 'ai-fallback';
}

/**
 * 감지된 POS 종류 + 자격증명을 받아서 최종 매핑 결정.
 *
 * 1. 알려진 어댑터 매칭 → getStaticMapping()
 * 2. 정적 매핑 confidence 부족 시 → validateMapping() (실 DB 접근)
 * 3. 어댑터 모두 미매치 → ai-fallback
 */
export async function resolveAdapter(
  detection: PosDetectionResult,
  credential: DiscoveredCredential
): Promise<AdapterResolutionResult | null> {
  if (adapters.length === 0) {
    registerDefaultAdapters();
  }

  const adapter = selectAdapter(detection.posType, credential);
  if (!adapter) return null;

  // 1차: 정적 매핑
  const staticMapping = adapter.getStaticMapping();
  if (staticMapping && staticMapping.confidence >= 90) {
    logger.info(`[${adapter.name}] 정적 매핑 사용 (confidence ${staticMapping.confidence}%)`);
    return { adapter, mapping: staticMapping, source: 'static' };
  }

  // 2차: 실 DB 검증
  if (adapter.validateMapping) {
    const validated = await adapter.validateMapping(credential);
    if (validated && validated.confidence >= 70) {
      logger.info(`[${adapter.name}] 검증 매핑 사용 (confidence ${validated.confidence}%)`);

      // ★ 학습 루프 후크: ai-fallback이 95%+로 성공하면 어댑터 후보로 보고
      if (adapter.name === 'ai-fallback' && validated.confidence >= 95) {
        await reportAdapterCandidate(detection.posType, validated, detection);
      }

      return { adapter, mapping: validated, source: adapter.name === 'ai-fallback' ? 'ai-fallback' : 'validated' };
    }
  }

  // 3차: 정적 매핑이라도 반환 (confidence 낮아도)
  if (staticMapping) {
    logger.warn(`[${adapter.name}] 매핑 confidence 낮음 (${staticMapping.confidence}%) — 슈퍼관리자 검토 필요`);
    return { adapter, mapping: staticMapping, source: 'static' };
  }

  logger.error(`[${adapter.name}] 매핑 실패`);
  return null;
}

// ============================================================
// 학습 루프
// ============================================================

/**
 * AI fallback이 confidence 95%+ 성공 시 서버에 어댑터 후보 보고.
 * 슈퍼관리자가 검수 후 정식 어댑터로 박을 수 있음.
 *
 * ⚠️ 서버 라우트 POST /api/flyer/pos/adapter-candidate-report
 *    백엔드 측은 묶음 3 (양방향 통신)에서 박힘.
 */
async function reportAdapterCandidate(
  posType: string,
  mapping: PosTableMapping,
  detection: PosDetectionResult
): Promise<void> {
  try {
    // ⚠️ server-client.ts에 reportAdapterCandidate 함수 박힌 후 활성화.
    logger.info(`어댑터 학습 후보 보고: posType=${posType}, confidence=${mapping.confidence}%`);
    logger.debug(`(서버 라우트 박힌 후 실제 전송. 묶음 3 진입 시 활성화)`);
    void mapping; void detection;
  } catch (err: any) {
    logger.warn(`어댑터 학습 후보 보고 실패: ${err.message}`);
  }
}
