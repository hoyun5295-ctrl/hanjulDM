import dotenv from 'dotenv';
// ★ 보안: dotenv를 최우선 로딩 — 이후 모듈들이 환경변수에 의존하므로 반드시 첫 줄
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';

// ★ hanjulDM 전단AI 라우트 (한줄AI 본진과 완전 분리, 2026-05-12)
import flyerAuthRoutes from './routes/flyer/auth';
import flyerCompaniesRoutes from './routes/flyer/companies';
import flyerCustomersRoutes from './routes/flyer/customers';
import flyerCampaignsRoutes from './routes/flyer/campaigns';
import flyerUnsubscribesRoutes from './routes/flyer/unsubscribes';
import flyerBalanceRoutes from './routes/flyer/balance';
import flyerStatsRoutes from './routes/flyer/stats';
import flyerCatalogRoutes from './routes/flyer/catalog';
import flyerAddressBooksRoutes from './routes/flyer/address-books';
import flyerSenderRegistrationRoutes from './routes/flyer/sender-registration';
import flyerPosRoutes from './routes/flyer/pos';
import flyerBusinessTypesRoutes from './routes/flyer/business-types';
import flyerCouponsRoutes, { publicRouter as flyerCouponPublicRoutes } from './routes/flyer/coupons';
import flyerCartPublicRoutes from './routes/flyer/carts';
import flyerOrdersRoutes from './routes/flyer/orders';
import flyerRoutes from './routes/flyer/flyers';
import flyerPublicRoutes from './routes/flyer/short-urls';
import flyerOgImageRoutes from './routes/flyer/og-image';

// ★ hanjulDM 슈퍼관리자 라우트
import flyerAdminRoutes from './routes/admin/flyer-admin';
import flyerAdminAlimtalkRoutes from './routes/admin/alimtalk';
import flyerSuperRoutes from './routes/flyer/super';

// ★ hanjulDM 알림톡 (매장 조회 + 공개 웹훅)
import flyerAlimtalkRoutes from './routes/flyer/alimtalk';
import flyerAlimtalkWebhookRoutes from './routes/flyer/alimtalk-webhook';

// ★ POS 자동 전단 생성 워커
import { startAutoFlyerWorker } from './utils/flyer/pos/flyer-pos-auto';

// ★ 알림톡 검수 스케줄러 (카테고리 일일 + 검수 5분 polling + 발신프로필 1시간)
import { startFlyerAlimtalkScheduler } from './utils/flyer/alimtalk/alimtalk-jobs';

// DB 연결
import './config/database';
import { LIMITS } from './config/defaults';

const app = express();
// ★ trust proxy: 'loopback'(127.0.0.1)만 신뢰 → Nginx가 앞단에 있어 여기만 허용
app.set('trust proxy', 'loopback');
const PORT = process.env.PORT || 3001; // ★ hanjulDM 전용 포트 (한줄AI 3000과 분리)

// ★ 전단AI 공개 페이지 — helmet(CSP) 전에 마운트 (인라인 스크립트 필요)
app.use('/api/flyer/p', flyerPublicRoutes);
app.use('/api/flyer/q', flyerCouponPublicRoutes);
// ★ Phase 3: 장바구니 공개 API (인증 불필요 — phone 기반)
app.use('/api/flyer/cart', flyerCartPublicRoutes);
// ★ D154 PHASE 0 트랙 A: og:image 동적 라우트 (카톡 인박스 미리보기, 인증 불필요)
app.use('/api/flyer', flyerOgImageRoutes);

// ★ 휴머스온 IMC 알림톡 웹훅 (공개, raw body parser — helmet 전 마운트 의무)
app.use('/api/flyer/alimtalk-webhook', flyerAlimtalkWebhookRoutes);

// 미들웨어
app.use(helmet());

// ★ CORS 화이트리스트 — hanjulDM 도메인만 (hanjul-flyer.kr 매장 사장님 + admin.hanjuldm.kr 슈퍼관리자)
const corsAllowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
if (corsAllowedOrigins.length === 0) {
  console.warn('[CORS] CORS_ORIGIN 미설정 — 전 origin 허용 중. 운영 배포 시 .env에 hanjul-flyer.kr / admin.hanjuldm.kr 명시 필수');
}
app.use(cors({
  origin: (origin, cb) => {
    if (corsAllowedOrigins.length === 0) return cb(null, true);
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    if (!origin) return cb(null, true);
    if (corsAllowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(morgan('dev'));
app.use(express.json({ limit: LIMITS.requestBodySize }));

// 헬스체크
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'hanjulDM', timestamp: new Date().toISOString() });
});

// API 라우트 안내
app.get('/api', (req, res) => {
  res.json({
    message: 'hanjulDM API Server (한줄전단AI)',
    version: '1.0.0',
    endpoints: {
      auth: '/api/flyer/auth',
      companies: '/api/flyer/companies',
      customers: '/api/flyer/customers',
      campaigns: '/api/flyer/campaigns',
      flyers: '/api/flyer/flyers',
      stats: '/api/flyer/stats',
      admin: '/api/admin/flyer',
    },
  });
});

// ★ hanjulDM 슈퍼관리자 인증 (admin.hanjuldm.kr 로그인)
app.use('/api/flyer/super', flyerSuperRoutes);

// ★ hanjulDM 슈퍼관리자 데이터 API (admin.hanjuldm.kr)
app.use('/api/admin/flyer', flyerAdminRoutes);
// ★ hanjulDM 슈퍼관리자 알림톡 대행 API
app.use('/api/admin/alimtalk', flyerAdminAlimtalkRoutes);

// ★ hanjulDM 전단AI 라우트
app.use('/api/flyer/auth', flyerAuthRoutes);
app.use('/api/flyer/companies', flyerCompaniesRoutes);
app.use('/api/flyer/customers', flyerCustomersRoutes);
app.use('/api/flyer/campaigns', flyerCampaignsRoutes);
app.use('/api/flyer/unsubscribes', flyerUnsubscribesRoutes);
app.use('/api/flyer/balance', flyerBalanceRoutes);
app.use('/api/flyer/stats', flyerStatsRoutes);
app.use('/api/flyer/catalog', flyerCatalogRoutes);
app.use('/api/flyer/address-books', flyerAddressBooksRoutes);
app.use('/api/flyer/companies/sender-registration', flyerSenderRegistrationRoutes);
app.use('/api/flyer/pos', flyerPosRoutes);
app.use('/api/flyer/business-types', flyerBusinessTypesRoutes);
app.use('/api/flyer/coupons', flyerCouponsRoutes);
app.use('/api/flyer/orders', flyerOrdersRoutes);
// ★ 알림톡 매장 조회 (발송 화면 dropdown용 + 신청 이력)
app.use('/api/flyer/alimtalk', flyerAlimtalkRoutes);

// ★ 카탈로그 이미지 공개 서빙
app.use('/api/flyer/catalog-images', express.static(path.join(process.cwd(), 'uploads', 'catalog-images')));

// 전단지 CRUD + 공개 페이지
app.use('/api/flyer/flyers', flyerRoutes);
// ★ /api/flyer/p, /api/flyer/q는 helmet 전에 마운트됨 (상단 참조)

// 404 처리
app.use((req, res) => {
  res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
});

// 에러 핸들러
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('서버 에러:', err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// ============================================================
// 프로세스 레벨 에러 핸들러 (PM2 자동 재시작 연계)
// ============================================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

// 서버 시작
app.listen(PORT, () => {
  console.log('');
  console.log('================================');
  console.log(`  hanjulDM API Server (한줄전단AI)`);
  console.log(`  Port: ${PORT}`);
  console.log(`  http://localhost:${PORT}`);
  console.log('================================');
  console.log('');

  // ★ POS 자동 전단 생성 워커 시작 (5분 간격)
  startAutoFlyerWorker();

  // ★ 알림톡 검수 스케줄러 시작 (카테고리 03:00 KST 일일 + 검수 5분 polling + 발신프로필 1시간)
  startFlyerAlimtalkScheduler();
});

export default app;
