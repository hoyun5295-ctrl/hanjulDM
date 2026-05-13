/**
 * ★ Mask Bypass — 마스킹 우회 3단 Fallback
 *
 * Harold 통찰 (D159):
 *  - POS UI에서 "전체 다운로드" 시 010-**95-8517 마스킹
 *  - 회원 1명 클릭 시 원본 010-5295-8517 표시
 *  - → DB엔 원본 100% 저장 확정, UI 레이어만 마스킹
 *  - → POS 업체의 lock-in 의도 ("원본 보고 싶으면 우리 POS 발송기능 써라")
 *
 * 3단 fallback:
 *  1차 DIRECT_SQL    — credential-discovery 성공 시 MySQL/MSSQL SELECT 직접 (99% 매장 = 이 경로로 끝)
 *  2차 BACKUP_FILE   — 백업 파일(.sql/.bak/.dump) 자동 파싱 (24h 지연 허용)
 *  3차 UI_AUTOMATION — POS 클라이언트 UI 자동화로 회원 1명씩 클릭 (새벽 2~5시 무인 가동)
 *  Plan Z            — 사장님이 직접 POS 비번 입력 (정 안 되면)
 *
 * 합법성: 매장 사장님 본인 PC + 본인 데이터 + 명시 동의 + SELECT 권한만.
 */

import fs from 'fs';
import { logger } from './logger';
import { executeQuery, isConnected } from './db-connector';
import { detectPhoneMasking, normalizeKoreanPhone } from './adapters/base';
import type { PosAdapter, PosTableMapping } from './adapters/base';
import type { DiscoveredCredential } from './credential-discovery';

// ============================================================
// 타입
// ============================================================

export enum BypassStrategy {
  DIRECT_SQL = 'DIRECT_SQL',
  BACKUP_FILE = 'BACKUP_FILE',
  UI_AUTOMATION = 'UI_AUTOMATION',
  MANUAL_INPUT = 'MANUAL_INPUT',
}

export interface BypassResult {
  ok: boolean;
  strategy: BypassStrategy;
  recordCount: number;
  records?: any[];
  error?: string;
  metadata?: Record<string, any>;
}

export interface BypassContext {
  adapter: PosAdapter;
  mapping: PosTableMapping;
  credential: DiscoveredCredential;
  /** UI 자동화 강제 가동 (테스트용) */
  forceUiAutomation?: boolean;
  /** 회원 1명 단건 추출 (검증용) */
  singleRecordOnly?: boolean;
}

// ============================================================
// 1차: DIRECT_SQL — DB 직접 SELECT
// ============================================================

async function bypassWithDirectSql(ctx: BypassContext): Promise<BypassResult> {
  const { mapping } = ctx;

  if (!mapping.memberTable || !mapping.memberColumns?.phone) {
    return { ok: false, strategy: BypassStrategy.DIRECT_SQL, recordCount: 0, error: '회원 테이블/phone 컬럼 미매핑' };
  }

  if (!isConnected()) {
    return { ok: false, strategy: BypassStrategy.DIRECT_SQL, recordCount: 0, error: 'DB 미연결' };
  }

  try {
    const sql = mapping.extractQueries?.newMembers
      || `SELECT * FROM ${mapping.memberTable} ${ctx.singleRecordOnly ? 'LIMIT 1' : ''}`;

    const rows = await executeQuery(sql, ctx.singleRecordOnly ? [] : ['2000-01-01T00:00:00']);

    if (rows.length === 0) {
      return { ok: true, strategy: BypassStrategy.DIRECT_SQL, recordCount: 0, records: [] };
    }

    // ★ 마스킹 검증: 첫 row의 phone이 마스킹되어 있으면 DB조차 마스킹 = DIRECT_SQL 실패
    const phoneCol = mapping.memberColumns.phone;
    const firstPhone = rows[0][phoneCol];
    const maskState = detectPhoneMasking(firstPhone);

    if (maskState === 'masked') {
      logger.warn('DIRECT_SQL: DB에서도 phone 마스킹 발견 — 백업파일/UI자동화 fallback 필요');
      return {
        ok: false,
        strategy: BypassStrategy.DIRECT_SQL,
        recordCount: rows.length,
        error: 'DB phone 마스킹',
        metadata: { phoneSample: firstPhone, maskState },
      };
    }

    logger.info(`DIRECT_SQL 성공: ${rows.length}건, phone 원본 ${maskState === 'raw' ? '확인' : '불명'}`);
    return {
      ok: true,
      strategy: BypassStrategy.DIRECT_SQL,
      recordCount: rows.length,
      records: rows,
      metadata: { maskState },
    };
  } catch (err: any) {
    logger.error(`DIRECT_SQL 실패: ${err.message}`);
    return { ok: false, strategy: BypassStrategy.DIRECT_SQL, recordCount: 0, error: err.message };
  }
}

// ============================================================
// 2차: BACKUP_FILE — 백업 파일 자동 파싱
// ============================================================

async function bypassWithBackupFile(ctx: BypassContext): Promise<BypassResult> {
  const { credential } = ctx;
  const backupPath = credential.metadata?.backupPath as string | undefined;

  if (!backupPath) {
    return { ok: false, strategy: BypassStrategy.BACKUP_FILE, recordCount: 0, error: '백업 파일 경로 미발견' };
  }

  try {
    if (!fs.existsSync(backupPath)) {
      return { ok: false, strategy: BypassStrategy.BACKUP_FILE, recordCount: 0, error: `백업 파일 없음: ${backupPath}` };
    }

    const stats = fs.statSync(backupPath);
    const ageMs = Date.now() - stats.mtimeMs;
    const ageHours = ageMs / (1000 * 60 * 60);

    if (ageHours > 48) {
      logger.warn(`BACKUP_FILE: 백업 파일 ${ageHours.toFixed(1)}h 오래됨 — 신뢰성 낮음`);
    }

    // ⚠️ 실제 SQL 덤프 파싱은 묶음 2 이후. 핵심 아이디어:
    //   - .sql 덤프 = mysql_dump 형식 → INSERT INTO {memberTable} VALUES (...) 라인 파싱
    //   - .bak = MSSQL 백업 → RESTORE FILELISTONLY + 별도 LocalDB 인스턴스로 attach
    //   - .dump = pg_dump 형식 → COPY ... FROM stdin 파싱
    logger.info(`BACKUP_FILE: 묶음 2 이후 실제 파싱 활성화 (파일 발견: ${backupPath}, ${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

    return {
      ok: false,
      strategy: BypassStrategy.BACKUP_FILE,
      recordCount: 0,
      error: '백업 파일 파싱 묶음 2 이후',
      metadata: { backupPath, fileSize: stats.size, ageHours },
    };
  } catch (err: any) {
    return { ok: false, strategy: BypassStrategy.BACKUP_FILE, recordCount: 0, error: err.message };
  }
}

// ============================================================
// 3차: UI_AUTOMATION — POS 클라이언트 UI 자동화 (새벽 무인)
// ============================================================

async function bypassWithUiAutomation(ctx: BypassContext): Promise<BypassResult> {
  // ⚠️ 매장 정상 영업 중 가동 절대 금지 — 새벽 2~5시만 허용
  const now = new Date();
  const hour = now.getHours();
  if (!ctx.forceUiAutomation && (hour < 2 || hour >= 5)) {
    return {
      ok: false,
      strategy: BypassStrategy.UI_AUTOMATION,
      recordCount: 0,
      error: `UI 자동화는 새벽 2~5시만 가동 (현재 ${hour}시)`,
    };
  }

  // 어댑터에 uiAutomationFallback 박혀있어야 함
  if (!ctx.adapter.uiAutomationFallback) {
    return {
      ok: false,
      strategy: BypassStrategy.UI_AUTOMATION,
      recordCount: 0,
      error: `${ctx.adapter.name} 어댑터에 UI 자동화 미박힘`,
    };
  }

  try {
    logger.info(`UI_AUTOMATION 시작: ${ctx.adapter.name} (${hour}시)`);
    const result = await ctx.adapter.uiAutomationFallback();
    logger.info(`UI_AUTOMATION 완료: ${result.recordCount}건`);

    return {
      ok: result.ok,
      strategy: BypassStrategy.UI_AUTOMATION,
      recordCount: result.recordCount,
      error: result.error,
    };
  } catch (err: any) {
    logger.error(`UI_AUTOMATION 실패: ${err.message}`);
    return { ok: false, strategy: BypassStrategy.UI_AUTOMATION, recordCount: 0, error: err.message };
  }
}

// ============================================================
// 통합 진입점 — 3단 fallback
// ============================================================

export async function runMaskBypass(ctx: BypassContext): Promise<BypassResult> {
  logger.info(`Mask Bypass 시작: adapter=${ctx.adapter.name}`);

  // 1차: DIRECT_SQL
  if (!ctx.forceUiAutomation) {
    const direct = await bypassWithDirectSql(ctx);
    if (direct.ok && direct.recordCount > 0) {
      // 추가 검증: 회원 전체 추출 시 마스킹 비율 체크
      const records = direct.records || [];
      const phoneCol = ctx.mapping.memberColumns?.phone;
      if (phoneCol && records.length >= 10) {
        const maskedCount = records.filter(r => detectPhoneMasking(r[phoneCol]) === 'masked').length;
        const maskRatio = maskedCount / records.length;
        if (maskRatio > 0.5) {
          logger.warn(`DIRECT_SQL: 전체 ${records.length}건 중 ${maskedCount}건 마스킹 (${(maskRatio * 100).toFixed(0)}%) — fallback 시도`);
        } else {
          logger.info(`DIRECT_SQL 성공 (마스킹 비율 ${(maskRatio * 100).toFixed(0)}%)`);
          return direct;
        }
      } else {
        return direct;
      }
    }
  }

  // 2차: BACKUP_FILE
  const backup = await bypassWithBackupFile(ctx);
  if (backup.ok && backup.recordCount > 0) {
    return backup;
  }

  // 3차: UI_AUTOMATION (새벽만)
  const ui = await bypassWithUiAutomation(ctx);
  if (ui.ok) return ui;

  // 모두 실패 → MANUAL_INPUT 안내
  logger.error('Mask Bypass: 3단 모두 실패 — 사장님 수동 입력 안내 필요');
  return {
    ok: false,
    strategy: BypassStrategy.MANUAL_INPUT,
    recordCount: 0,
    error: `1차 직접SQL 실패 / 2차 백업파일 실패 / 3차 UI자동화 실패 (현재 ${new Date().getHours()}시)`,
  };
}

/** 회원 1명 단건 검증 — 마스킹 우회 가능 여부 사전 진단 */
export async function diagnoseMaskBypass(adapter: PosAdapter, mapping: PosTableMapping, credential: DiscoveredCredential): Promise<{
  canDirectSql: boolean;
  canBackupFile: boolean;
  canUiAutomation: boolean;
  recommendedStrategy: BypassStrategy;
}> {
  const direct = await bypassWithDirectSql({ adapter, mapping, credential, singleRecordOnly: true });
  const canDirect = direct.ok && direct.recordCount > 0;

  const backup = await bypassWithBackupFile({ adapter, mapping, credential, singleRecordOnly: true });
  const canBackup = backup.ok || (backup.metadata?.backupPath !== undefined);

  const canUi = !!adapter.uiAutomationFallback;

  let recommended: BypassStrategy = BypassStrategy.MANUAL_INPUT;
  if (canDirect) recommended = BypassStrategy.DIRECT_SQL;
  else if (canBackup) recommended = BypassStrategy.BACKUP_FILE;
  else if (canUi) recommended = BypassStrategy.UI_AUTOMATION;

  logger.info(`Mask Bypass 진단: direct=${canDirect}, backup=${canBackup}, ui=${canUi}, 권장=${recommended}`);

  return {
    canDirectSql: canDirect,
    canBackupFile: canBackup,
    canUiAutomation: canUi,
    recommendedStrategy: recommended,
  };
}

/** mask-bypass 결과 → 표준화된 회원 데이터 변환 (normalizeKoreanPhone 적용) */
export function normalizeMaskBypassResult(result: BypassResult, mapping: PosTableMapping): any[] {
  if (!result.ok || !result.records) return [];

  const phoneCol = mapping.memberColumns?.phone;
  if (!phoneCol) return result.records;

  return result.records
    .map(row => {
      const normalized = normalizeKoreanPhone(row[phoneCol]);
      if (!normalized) return null;
      return { ...row, [phoneCol]: normalized };
    })
    .filter(r => r !== null);
}
