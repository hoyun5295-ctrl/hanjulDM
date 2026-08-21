/**
 * ★ 전단AI 컨트롤타워 인덱스
 *
 * 도메인별 분리 구조 (D118):
 *   send/     — 발송 도메인 (CT-F01~F08)
 *   product/  — 상품/전단 도메인 (CT-F11, CT-F14, CT-F17 + 보조)
 *   pos/      — POS 도메인 (CT-F12, CT-F16)
 *   coupon/   — 쿠폰 도메인 (CT-F15)
 *   billing/  — 과금 도메인 (CT-F03)
 *   analytics/ — 분석 도메인 (CT-F09, CT-F10)
 *   config/   — 설정 도메인 (CT-F13)
 *
 * 라우트에서 import 시:
 *   import { sendFlyerCampaign, getFlyerDashboardStats } from '../../utils/flyer';
 *
 * ⚠️ 전단AI 라우트는 이 CT를 통해야 한다. 인라인 로직 금지.
 * ⚠️ 한줄로 코드(utils/ 루트) 절대 건드리지 않음.
 */

// ═══════════════════════════════════════════
// send/ — 발송 도메인
// ═══════════════════════════════════════════

// CT-F01: SMS 큐
export {
  getFlyerCompanySmsTables,
  invalidateFlyerLineGroupCache,
  toQtmsgType,
  bulkInsertSmsQueue,
  insertTestSmsQueue,
  getTestSmsTables,
  getAuthSmsTable,
} from './send/flyer-sms-queue';

// CT-F02: 수신거부
export {
  buildFlyerUnsubscribeFilter,
  registerFlyerUnsubscribe,
  isFlyerUnsubscribed,
  getFlyerUnsubscribes,
  deleteFlyerUnsubscribes,
  filterOutFlyerUnsubscribed,
} from './send/flyer-unsubscribe-helper';

// CT-F04: 고객 필터
export {
  buildFlyerCustomerFilter,
  countFlyerCustomers,
  selectFlyerCustomers,
} from './send/flyer-customer-filter';
export type { FlyerFilterInput } from './send/flyer-customer-filter';

// CT-F05: 메시지 치환 + 광고
export {
  replaceFlyerVariables,
  buildFlyerAdMessage,
  stripFlyerAdParts,
  prepareFlyerSendMessage,
  replaceFlyerAlimtalkVariables,
} from './send/flyer-message';

// CT-F06: 회신번호
export {
  getFlyerCallbackNumbers,
  resolveFlyerCallback,
} from './send/flyer-callback-filter';

// CT-F07: 중복제거
export {
  deduplicateFlyerRecipients,
  deduplicateWithStats,
} from './send/flyer-deduplicate';

// CT-F08: 발송 오케스트레이터 (★ 발송 도메인 유일한 외부 진입점)
export { sendFlyerCampaign } from './send/flyer-send';
export type { FlyerSendParams, FlyerSendResult } from './send/flyer-send';

// ═══════════════════════════════════════════
// billing/ — 과금 도메인
// ═══════════════════════════════════════════

// CT-F03: 과금/결제
export {
  aggregateFlyerMonthlyUsage,
  recordFlyerMonthlyBilling,
  canFlyerCompanySend,
  canFlyerStoreSend,
  deductFlyerPrepaid,
  refundFlyerPrepaid,
} from './billing/flyer-billing';

// CT-F26: 결제 상태 판정 (값 축 + 접근 판정의 유일 기준)
export {
  STORE_PAYMENT_STATUSES,
  COMPANY_PAYMENT_STATUSES,
  BILLING_PAYMENT_STATUSES,
  STORE_PAYMENT_STATUS_LABELS,
  COMPANY_PAYMENT_STATUS_LABELS,
  isValidStorePaymentStatus,
  isValidCompanyPaymentStatus,
  isPlanExpired,
  resolveFlyerStoreAccess,
  isFlyerBillingOpenPath,
} from './billing/flyer-payment-status';
export type {
  StorePaymentStatus,
  CompanyPaymentStatus,
  BillingPaymentStatus,
  FlyerAccessCode,
  FlyerAccessInput,
  FlyerAccessResult,
} from './billing/flyer-payment-status';

// CT-F27: 잔액 원장 (prepaid_balance 이동의 유일 경로)
export {
  FLYER_BALANCE_TX_LABELS,
  withFlyerTx,
  changeFlyerBalance,
  queryFlyerBalanceTransactions,
} from './billing/flyer-balance-ledger';
export type {
  FlyerBalanceTxType,
  FlyerBalanceChangeParams,
  FlyerBalanceChangeResult,
} from './billing/flyer-balance-ledger';

// ═══════════════════════════════════════════
// product/ — 상품/전단 도메인
// ═══════════════════════════════════════════

// CT-F11: 카탈로그
export {
  getCatalogItems,
  touchCatalogUsage,
  upsertCatalogItem,
} from './product/flyer-catalog';

// CT-F14: 템플릿 렌더링 엔진
export { renderTemplate } from './product/flyer-templates';
export type { FlyerRenderData, FlyerRenderItem } from './product/flyer-templates';

// CT-F17: 네이버 이미지 후보 검색 (쇼핑 API 2026-07-31 종료 — 이미지 검색 단일 소스)
export {
  searchNaverImageCandidates,
  downloadAndSaveImage,
  autoMatchImage,
  batchAutoMatchImages,
} from './product/flyer-naver-search';
export type { NaverShopItem, ImageSearchResult } from './product/flyer-naver-search';

// ═══════════════════════════════════════════
// pos/ — POS 도메인
// ═══════════════════════════════════════════

// CT-F12: POS 데이터 수신
export {
  verifyPosAgent,
  ingestSales,
  ingestInventory,
  ingestMembers,
  ingestPromotions,
  updateAgentHeartbeat,
  getTopSellingProducts,
  getPosAgentStatusList,
} from './pos/flyer-pos-ingest';

// CT-F16: POS AI 스키마 분석
export {
  analyzeSchema,
  saveSchemaMapping,
  getSchemaMapping,
  detectPhoneFormat,
} from './pos/flyer-pos-ai';
export type { PosRawSchema, SchemaMapping, PosTableInfo, PosColumnInfo } from './pos/flyer-pos-ai';

// CT-F23: POS Agent 양방향 통신
export {
  issueRemoteCommand,
  pollPendingCommand,
  recordCommandResult,
  listCommandHistory,
  getCommandById,
  expireOldCommands,
  recordAdapterCandidate,
  listAdapterCandidates,
  recordCredentialDiscoveryLog,
  getLatestAgentInfo,
  recordAgentInstalled,
} from './pos/flyer-pos-remote';
export type { RemoteCommandType, RemoteCommandStatus, RemoteCommandRecord, AgentUpdateInfo, AdapterCandidate } from './pos/flyer-pos-remote';

// ═══════════════════════════════════════════
// coupon/ — 쿠폰 도메인
// ═══════════════════════════════════════════

// CT-F15: QR 쿠폰
export {
  createCouponCampaign,
  listCouponCampaigns,
  getCouponCampaign,
  updateCouponCampaign,
  disableCouponCampaign,
  getCampaignByQrCode,
  claimCoupon,
  redeemCoupon,
  lookupCouponsByPhone,
  getCouponStats,
  listCoupons,
  generateQrDataUrl,
  renderCouponPage,
  buildCouponSmsMessage,
} from './coupon/flyer-coupons';
export type { CouponCampaign, CouponStats, ClaimResult, RedeemResult, CouponDashboardData } from './coupon/flyer-coupons';
export { getCouponDashboard } from './coupon/flyer-coupons';

// ═══════════════════════════════════════════
// analytics/ — 분석 도메인
// ═══════════════════════════════════════════

// CT-F09: 통계
export {
  getFlyerDashboardStats,
  getFlyerCampaignResults,
} from './analytics/flyer-stats';

// CT-F10: RFM (Phase B)
export {
  calculateCustomerRfm,
  recalculateAllRfm,
  getRfmSegmentCounts,
} from './analytics/flyer-rfm';

// ═══════════════════════════════════════════
// config/ — 설정 도메인
// ═══════════════════════════════════════════

// CT-F13: 업종 레지스트리
export {
  getBusinessTypes,
  getBusinessType,
  getCategoryPresets,
  getAvailableTemplates,
  getAllBusinessTypes,
  TEMPLATE_REGISTRY,
  invalidateBusinessTypeCache,
} from './config/flyer-business-types';
export type { BusinessType, TemplateInfo } from './config/flyer-business-types';
