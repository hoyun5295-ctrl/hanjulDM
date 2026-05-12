// ============================================================
// hanjulDM PM2 Ecosystem
// 분리 시점: 2026-05-12 (한줄AI ecosystem과 완전 독립)
// ============================================================
// 사용:
//   pm2 start ecosystem.config.js
//   pm2 restart hanjuldm-api
//   pm2 logs hanjuldm-api
//
// 한줄AI는 targetup-api 프로세스. hanjulDM은 hanjuldm-api 프로세스.
// 두 프로세스 완전 독립 (포트 3000 / 3001).
// ============================================================

module.exports = {
  apps: [
    {
      name: 'hanjuldm-api',
      script: 'dist/app.js',
      cwd: '/home/administrator/hanjuldm-app/packages/backend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      max_memory_restart: '1G',
      error_file: '/home/administrator/hanjuldm-app/logs/hanjuldm-api-error.log',
      out_file: '/home/administrator/hanjuldm-app/logs/hanjuldm-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      watch: false,
      min_uptime: '10s',
      max_restarts: 10,
    },
  ],
};
