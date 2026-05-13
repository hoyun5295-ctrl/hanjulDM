-- ============================================================
-- POS Agent V2 — DB 마이그레이션 (D159)
-- ============================================================
-- 주인님이 psql 직접 실행. 비토는 SQL 안내만.
--
-- 신규 테이블 3종:
--   1. flyer_pos_commands              — 양방향 명령 큐 (CT-F23)
--   2. flyer_pos_adapter_candidates    — AI fallback 학습 후보
--   3. flyer_credential_discovery_log  — Credential Discovery 시도 이력 (학습 데이터)
--
-- 기존 테이블 ALTER 2건:
--   - flyer_pos_agents.agent_version 추가
--   - flyer_pos_agents.last_update_at 추가
--
-- 신규 settings 1건:
--   - latest_pos_agent_version (슈퍼관리자가 새 .exe 배포 시 박음)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. flyer_pos_commands (CT-F23)
-- ============================================================

CREATE TABLE IF NOT EXISTS flyer_pos_commands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES flyer_pos_agents(id) ON DELETE CASCADE,
  type            VARCHAR(50) NOT NULL,
  payload         JSONB,
  issued_by       VARCHAR(100) NOT NULL,         -- 슈퍼관리자 ID 또는 'system'
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
                  -- pending | polled | completed | failed | expired
  issued_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  polled_at       TIMESTAMP WITH TIME ZONE,
  responded_at    TIMESTAMP WITH TIME ZONE,
  result          JSONB,
  error_message   TEXT,
  duration_ms     INTEGER,
  CONSTRAINT chk_pos_commands_type CHECK (
    type IN ('FORCE_SYNC', 'RESEND_SCHEMA', 'FETCH_LOGS', 'REVOKE', 'UPDATE', 'DIAGNOSE_MASK_BYPASS')
  ),
  CONSTRAINT chk_pos_commands_status CHECK (
    status IN ('pending', 'polled', 'completed', 'failed', 'expired')
  )
);

CREATE INDEX IF NOT EXISTS idx_flyer_pos_commands_polling
  ON flyer_pos_commands(agent_id, status, issued_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_flyer_pos_commands_history
  ON flyer_pos_commands(agent_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_flyer_pos_commands_expire
  ON flyer_pos_commands(issued_at)
  WHERE status IN ('pending', 'polled');

COMMENT ON TABLE flyer_pos_commands IS 'POS Agent 양방향 통신 명령 큐 (CT-F23)';
COMMENT ON COLUMN flyer_pos_commands.type IS '명령 종류: FORCE_SYNC/RESEND_SCHEMA/FETCH_LOGS/REVOKE/UPDATE/DIAGNOSE_MASK_BYPASS';
COMMENT ON COLUMN flyer_pos_commands.status IS 'pending → polled → completed/failed/expired';

-- ============================================================
-- 2. flyer_pos_adapter_candidates (학습 루프)
-- ============================================================

CREATE TABLE IF NOT EXISTS flyer_pos_adapter_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES flyer_pos_agents(id) ON DELETE SET NULL,
  pos_type        VARCHAR(100) NOT NULL,
  mapping         JSONB NOT NULL,
  detection       JSONB,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
                  -- pending | approved | rejected
  reported_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMP WITH TIME ZONE,
  reviewed_by     VARCHAR(100),
  reviewer_notes  TEXT,
  CONSTRAINT chk_adapter_candidate_status CHECK (
    status IN ('pending', 'approved', 'rejected')
  )
);

CREATE INDEX IF NOT EXISTS idx_flyer_pos_adapter_candidates_pending
  ON flyer_pos_adapter_candidates(status, reported_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_flyer_pos_adapter_candidates_pos_type
  ON flyer_pos_adapter_candidates(pos_type, status);

COMMENT ON TABLE flyer_pos_adapter_candidates IS 'AI fallback 95%+ 성공 시 어댑터 학습 후보 (슈퍼관리자 검수 → 정식 어댑터 박음)';

-- ============================================================
-- 3. flyer_credential_discovery_log (학습 데이터)
-- ============================================================

CREATE TABLE IF NOT EXISTS flyer_credential_discovery_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             UUID NOT NULL REFERENCES flyer_pos_agents(id) ON DELETE CASCADE,
  pos_type             VARCHAR(100) NOT NULL,
  attempted_adapters   JSONB NOT NULL,          -- ['configFile', 'odbcDsn', ...]
  succeeded_adapter    VARCHAR(50),             -- 성공한 어댑터명 (null = 모두 실패)
  highest_confidence   INTEGER NOT NULL DEFAULT 0,
  reported_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credential_discovery_log_pos_type
  ON flyer_credential_discovery_log(pos_type, reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_credential_discovery_log_succeeded
  ON flyer_credential_discovery_log(succeeded_adapter, reported_at DESC)
  WHERE succeeded_adapter IS NOT NULL;

COMMENT ON TABLE flyer_credential_discovery_log IS 'Credential Discovery 7 어댑터 시도 이력 (POS별 어댑터 성공률 학습)';

-- ============================================================
-- 4. flyer_pos_agents ALTER (자동 업데이트 필드)
-- ============================================================

ALTER TABLE flyer_pos_agents
  ADD COLUMN IF NOT EXISTS agent_version  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS last_update_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN flyer_pos_agents.agent_version IS '현재 가동 중인 Agent .exe 버전';
COMMENT ON COLUMN flyer_pos_agents.last_update_at IS '마지막 자동 업데이트 설치 완료 시점';

-- ============================================================
-- 5. flyer_settings — 최신 Agent 버전 저장 (슈퍼관리자가 박음)
-- ============================================================
-- ⚠️ flyer_settings 테이블이 없으면 먼저 생성:
--    CREATE TABLE IF NOT EXISTS flyer_settings (
--      setting_key   VARCHAR(100) PRIMARY KEY,
--      setting_value TEXT NOT NULL,
--      updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
--    );

-- 슈퍼관리자가 새 .exe 배포 시 다음 SQL로 박음:
-- INSERT INTO flyer_settings (setting_key, setting_value)
-- VALUES ('latest_pos_agent_version', '{
--   "latestVersion": "1.1.0",
--   "downloadUrl": "https://hanjul-flyer.kr/downloads/hanjul-pos-agent-v1.1.0.exe",
--   "checksum": "sha256-hex-value-here",
--   "fileSize": 25600000,
--   "releaseNotes": "v1.1.0 — Credential Discovery 강화",
--   "mandatory": false
-- }')
-- ON CONFLICT (setting_key) DO UPDATE SET
--   setting_value = EXCLUDED.setting_value,
--   updated_at = NOW();

-- ============================================================
-- 6. expire 워커용 인덱스 (옵션)
-- ============================================================
-- 매 5분 cron으로 expireOldCommands() 호출 시 인덱스 가속

-- 이미 idx_flyer_pos_commands_expire에서 박힘.

COMMIT;

-- ============================================================
-- 검증 쿼리 (주인님 psql 실행 후 확인)
-- ============================================================
-- SELECT COUNT(*) FROM flyer_pos_commands;
-- SELECT COUNT(*) FROM flyer_pos_adapter_candidates;
-- SELECT COUNT(*) FROM flyer_credential_discovery_log;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'flyer_pos_agents' AND column_name IN ('agent_version', 'last_update_at');
