/**
 * ★ CT-F25 — DB 마이그레이션 부재 판정 (2026-08-20 슈퍼버전업 3단계 신설 — 13번 설계 §2-1)
 *
 * 신규 컬럼·테이블을 쓰는 endpoint가 마이그레이션 전 서버에서 500으로 터지지 않게,
 * SQLSTATE(42P01 relation / 42703 column) + 메시지로 판정해 503 DB_MIGRATION_PENDING을 돌려준다.
 * 사람이 고칠 수 있는 안내(실행할 ALTER 대상)를 함께 낸다 — 조용한 실패 금지.
 *
 * hanjulDM 자체 구현 — 본진(targetup) 코드 import 0 (isolation 룰).
 */
import type { Response } from 'express';

export function isDbMigrationError(err: any): boolean {
  const code = String(err?.code || '');
  if (code === '42P01' || code === '42703') return true;
  const msg = String(err?.message || '');
  return msg.includes('does not exist') && (msg.includes('column') || msg.includes('relation'));
}

/** true 반환 = 이미 503 응답을 보냈다(호출부는 즉시 return). */
export function handleDbMigrationError(err: any, res: Response, target: string): boolean {
  if (!isDbMigrationError(err)) return false;
  console.error(`[flyer][DB_MIGRATION_PENDING] ${target}:`, err?.message || err);
  res.status(503).json({
    success: false,
    code: 'DB_MIGRATION_PENDING',
    error: `DB 마이그레이션 필요 — ${target} ALTER 실행 요청`,
  });
  return true;
}
