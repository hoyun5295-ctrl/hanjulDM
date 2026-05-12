/**
 * 한줄전단 슈퍼관리자 초기 셋업 스크립트
 * - flyer_super_admins 테이블 생성 (TOTP 3컬럼 + must_change_password)
 * - 초기 계정 ceo / qwer1234 + must_change_password=TRUE INSERT
 *
 * 실행: cd /home/administrator/hanjuldm-app && node scripts/seed-super-admin.js
 * (backend/.env의 DATABASE_URL 자동 사용)
 */

const path = require('path');
const backendNodeModules = path.join(__dirname, '..', 'packages', 'backend', 'node_modules');
require(path.join(backendNodeModules, 'dotenv')).config({
  path: path.join(__dirname, '..', 'packages', 'backend', '.env'),
});
const bcrypt = require(path.join(backendNodeModules, 'bcryptjs'));
const { Pool } = require(path.join(backendNodeModules, 'pg'));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 환경변수 미설정 (packages/backend/.env 확인)');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

(async () => {
  try {
    console.log('▶ flyer_super_admins 테이블 생성 중...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flyer_super_admins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        login_id VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100),
        email VARCHAR(255),
        role VARCHAR(20) DEFAULT 'super',
        is_active BOOLEAN DEFAULT TRUE,
        must_change_password BOOLEAN DEFAULT FALSE,
        totp_secret VARCHAR(64),
        totp_enabled BOOLEAN DEFAULT FALSE,
        backup_codes JSONB,
        last_login_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        deleted_at TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_flyer_super_admins_login_id_active
        ON flyer_super_admins(login_id) WHERE deleted_at IS NULL
    `);
    console.log('✅ 테이블 + 인덱스 생성 OK');

    console.log('▶ 초기 ceo 계정 INSERT 중...');
    const hash = await bcrypt.hash('qwer1234', 10);
    const r = await pool.query(
      `INSERT INTO flyer_super_admins (login_id, password_hash, name, must_change_password)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (login_id) DO NOTHING
       RETURNING id, login_id, must_change_password`,
      ['ceo', hash, 'Harold', true]
    );
    if (r.rows.length > 0) {
      console.log('✅ ceo 계정 신규 생성:', r.rows[0]);
    } else {
      console.log('⚠ ceo 계정 이미 존재 (스킵). 비밀번호 초기화 필요 시 별도 UPDATE 진행');
    }
    console.log('✅ 한줄전단 슈퍼관리자 셋업 완료');
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('❌ 셋업 실패:', e.message);
    console.error(e.stack);
    await pool.end();
    process.exit(1);
  }
})();
