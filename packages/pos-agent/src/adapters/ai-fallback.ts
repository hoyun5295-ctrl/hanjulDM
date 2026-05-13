/**
 * ★ AI Fallback Adapter — 모르는 POS 처리
 *
 * 알려진 8종 어댑터가 모두 미스매치일 때 마지막으로 호출.
 * 기존 schema-reader + server-client requestSchemaAnalysis 흐름을 어댑터 패턴으로 재포장.
 *
 * 흐름:
 *  1. schema-reader.readSchema() — INFORMATION_SCHEMA 읽기
 *  2. schema-reader.collectSamples() — 테이블별 샘플 10건
 *  3. server-client.requestSchemaAnalysis() — 서버 LLM에 분석 요청
 *  4. 응답의 mapping을 PosTableMapping으로 반환
 *
 * confidence 95%+ 성공 시 adapter-registry가 학습 후보로 승격 (Harold가 슈퍼관리자에서 1회 검수 → 정식 어댑터).
 */

import { readSchema, collectSamples } from '../schema-reader';
import { requestSchemaAnalysis } from '../server-client';
import { getConfig } from '../config';
import { logger } from '../logger';
import type { PosAdapter, PosTableMapping } from './base';
import type { DiscoveredCredential } from '../credential-discovery';

export const aiFallbackAdapter: PosAdapter = {
  name: 'ai-fallback',
  version: '1.0.0',
  priority: 999, // 마지막 수단
  description: '알려진 8종 미매치 시 AI 스키마 분석으로 동적 매핑',

  /** 항상 매치 (마지막 수단이므로 다른 어댑터 미스매치 시에만 호출) */
  matches(_posType: string, _candidate?: DiscoveredCredential): boolean {
    return true;
  },

  /** 정적 매핑 없음 — validateMapping에서 동적 생성 */
  getStaticMapping(): PosTableMapping | null {
    return null;
  },

  /** 실 DB 접근 + 서버 LLM 분석 */
  async validateMapping(_credential: DiscoveredCredential): Promise<PosTableMapping | null> {
    try {
      const tables = await readSchema();
      if (tables.length === 0) {
        logger.error('AI fallback: 테이블 0개 — 매핑 불가');
        return null;
      }

      const samples = await collectSamples(tables);

      logger.info(`AI fallback: 서버에 스키마 분석 요청 (${tables.length}개 테이블, 샘플 ${Object.keys(samples).length}개)`);

      const result = await requestSchemaAnalysis({
        dbType: getConfig().db.type,
        tables,
        samples,
      });

      if (!result.ok || !result.data?.mapping) {
        logger.error(`AI fallback 분석 실패: ${result.error}`);
        return null;
      }

      const aiMapping = result.data.mapping;

      return {
        memberTable: aiMapping.memberTable,
        salesTable: aiMapping.salesTable,
        inventoryTable: aiMapping.inventoryTable,
        memberColumns: aiMapping.memberColumns,
        salesColumns: aiMapping.salesColumns,
        inventoryColumns: aiMapping.inventoryColumns,
        extractQueries: aiMapping.extractQueries,
        phoneFormat: aiMapping.phoneFormat || 'raw',
        confidence: aiMapping.confidence || 0,
      };
    } catch (err: any) {
      logger.error(`AI fallback 예외: ${err.message}`);
      return null;
    }
  },
};
