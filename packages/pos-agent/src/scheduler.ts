/**
 * POS Agent 주기적 작업 스케줄러 (V2)
 *
 * 기존:
 *  - 판매/회원/재고: config 동적 (5/30/60분)
 *  - 하트비트: 1분
 *  - 설정 갱신: 10분
 *  - 에러 카운트 리셋: KST 자정
 *
 * V2 추가:
 *  - cache-pusher (30초 주기) — local-cache 큐 → push
 *  - auto-updater (1시간 주기) — 새 버전 체크 → 자동 업데이트
 *  - cleanup (1일 1회, KST 04:00) — local-cache 7일 보존 cleanup
 *  - triggerForceSync() — 트레이/remote-command에서 즉시 강제 싱크
 */

import cron from 'node-cron';
import { getConfig } from './config';
import { sendHeartbeat, fetchConfig, pushData } from './server-client';
import { extractAndPushSales, extractAndPushMembers, extractAndPushInventory } from './data-extractor';
import { isConnected, connect } from './db-connector';
import { logger } from './logger';
import {
  dequeueSales,
  dequeueMembers,
  dequeueInventory,
  markSalesPushed,
  markMembersPushed,
  markInventoryPushed,
  markSalesFailed,
  markMembersFailed,
  markInventoryFailed,
  cleanupOldEntries,
  getCacheStats,
  recordSyncLog,
} from './local-cache';
import { checkForUpdate, performUpdate } from './auto-updater';

let heartbeatTask: cron.ScheduledTask | null = null;
let salesTask: cron.ScheduledTask | null = null;
let membersTask: cron.ScheduledTask | null = null;
let inventoryTask: cron.ScheduledTask | null = null;
let configTask: cron.ScheduledTask | null = null;
let resetTask: cron.ScheduledTask | null = null;
let cachePusherTask: cron.ScheduledTask | null = null;
let updaterTask: cron.ScheduledTask | null = null;
let cleanupTask: cron.ScheduledTask | null = null;

let schemaMapping: any = null;
let errorCount24h = 0;
let heartbeatFailCount = 0;
let cachePusherBusy = false;
let updaterBusy = false;

export function setSchemaMapping(mapping: any) {
  schemaMapping = mapping;
}

// ============================================================
// 강제 싱크 (트레이/remote-command 트리거)
// ============================================================

export async function triggerForceSync(): Promise<{ acceptedSales: number; acceptedMembers: number; acceptedInventory: number }> {
  if (!schemaMapping) {
    return { acceptedSales: 0, acceptedMembers: 0, acceptedInventory: 0 };
  }
  if (!isConnected()) {
    await tryReconnect();
    if (!isConnected()) {
      throw new Error('DB 연결 실패');
    }
  }

  logger.info('★ 강제 싱크 시작 (트리거)');

  let salesCount = 0;
  let membersCount = 0;
  let inventoryCount = 0;

  try {
    salesCount = await extractAndPushSales(schemaMapping);
  } catch (err: any) {
    logger.error(`강제 판매 추출 실패: ${err.message}`);
    errorCount24h++;
  }
  try {
    membersCount = await extractAndPushMembers(schemaMapping);
  } catch (err: any) {
    logger.error(`강제 회원 추출 실패: ${err.message}`);
    errorCount24h++;
  }
  try {
    inventoryCount = await extractAndPushInventory(schemaMapping);
  } catch (err: any) {
    logger.error(`강제 재고 추출 실패: ${err.message}`);
    errorCount24h++;
  }

  // 즉시 cache-pusher 1회 실행
  await runCachePusher();

  logger.info(`강제 싱크 완료: sales=${salesCount}, members=${membersCount}, inventory=${inventoryCount}`);

  return { acceptedSales: salesCount, acceptedMembers: membersCount, acceptedInventory: inventoryCount };
}

// ============================================================
// 스케줄러 시작
// ============================================================

export function startScheduler(): void {
  const config = getConfig();
  logger.info('스케줄러 V2 시작');

  // 하트비트: 매 1분
  heartbeatTask = cron.schedule('* * * * *', async () => {
    try {
      const stats = getCacheStats();
      await sendHeartbeat({
        last_sync_at: config.lastSalesSync || new Date().toISOString(),
        pending_count: stats.totalPending,
        error_count_24h: errorCount24h,
      });
      if (heartbeatFailCount > 0) {
        logger.info(`서버 연결 복구 (연속 ${heartbeatFailCount}회 실패 후)`);
        heartbeatFailCount = 0;
      }
    } catch (err: any) {
      heartbeatFailCount++;
      if (heartbeatFailCount <= 3 || heartbeatFailCount % 10 === 0) {
        logger.error(`하트비트 실패 (연속 ${heartbeatFailCount}회): ${err.message}`);
      }
      if (heartbeatFailCount === 10) {
        logger.warn('서버 연결 10분 이상 끊김 — 인터넷 연결을 확인하세요.');
      }
    }
  });

  // 판매/회원/재고: config 동적 — 재등록 가능한 함수로 뺀다(서버가 주기를 바꾸면 다시 건다)
  scheduleDataTasks();

  // 서버 설정 갱신: 매 10분. 주기가 바뀌면 데이터 태스크를 재등록한다(옛 코드는 재기동 전까지 반영 0).
  configTask = cron.schedule('*/10 * * * *', async () => {
    try {
      const before = intervalSignature(getConfig());
      const res = await fetchConfig(); // 내부에서 saveConfig({sync}) — getConfig()에 새 주기 반영됨
      if (res.ok && res.data?.schemaMapping) {
        schemaMapping = res.data.schemaMapping;
      }
      const after = intervalSignature(getConfig());
      if (before !== after) {
        logger.info(`싱크 주기 변경 감지 — 데이터 스케줄 재등록 (${before} → ${after})`);
        scheduleDataTasks();
      }
    } catch (err: any) {
      logger.warn('설정 갱신 실패:', err.message);
    }
  });

  // 24시간마다 에러 카운트 리셋 — KST 자정. timezone을 못 박아 매장 PC 로케일과 무관하게 정확히 돈다.
  resetTask = cron.schedule('0 0 * * *', () => {
    logger.info(`에러 카운트 리셋 (오늘 ${errorCount24h}건)`);
    errorCount24h = 0;
  }, { timezone: 'Asia/Seoul' });

  // ★ V2: cache-pusher (30초 주기) — local-cache 큐 → push
  cachePusherTask = cron.schedule('*/30 * * * * *', async () => {
    await runCachePusher();
  });

  // ★ V2: auto-updater (1시간 주기)
  updaterTask = cron.schedule('0 * * * *', async () => {
    await runAutoUpdate();
  });

  // ★ V2: cleanup (KST 04:00) — local-cache 7일 보존. timezone 못 박음.
  cleanupTask = cron.schedule('0 4 * * *', () => {
    try {
      cleanupOldEntries();
    } catch (err: any) {
      logger.warn(`cleanup 실패: ${err.message}`);
    }
  }, { timezone: 'Asia/Seoul' });

  logger.info(`스케줄: 판매=${config.sync.salesIntervalMinutes}분, 회원=${config.sync.membersIntervalMinutes}분, 재고=${config.sync.inventoryIntervalMinutes}분, cache-pusher=30초, auto-updater=1시간`);
}

// ============================================================
// 데이터 태스크 (재)등록 — 판매/회원/재고. 서버 주기 변경 시 다시 건다.
// ============================================================

function intervalSignature(config: ReturnType<typeof getConfig>): string {
  return `${config.sync.salesIntervalMinutes}/${config.sync.membersIntervalMinutes}/${config.sync.inventoryIntervalMinutes}`;
}

function scheduleDataTasks(): void {
  const config = getConfig();

  // 기존 것이 있으면 먼저 내린다(중복 가동 방지)
  salesTask?.stop();
  membersTask?.stop();
  inventoryTask?.stop();

  salesTask = cron.schedule(`*/${config.sync.salesIntervalMinutes} * * * *`, async () => {
    if (!schemaMapping) return;
    if (!isConnected()) { await tryReconnect(); if (!isConnected()) return; }
    try {
      await extractAndPushSales(schemaMapping);
    } catch (err: any) {
      errorCount24h++;
      logger.error('판매 추출 스케줄 실패:', err.message);
    }
  });

  membersTask = cron.schedule(`*/${config.sync.membersIntervalMinutes} * * * *`, async () => {
    if (!schemaMapping) return;
    if (!isConnected()) { await tryReconnect(); if (!isConnected()) return; }
    try {
      await extractAndPushMembers(schemaMapping);
    } catch (err: any) {
      errorCount24h++;
      logger.error('회원 추출 스케줄 실패:', err.message);
    }
  });

  inventoryTask = cron.schedule(`*/${config.sync.inventoryIntervalMinutes} * * * *`, async () => {
    if (!schemaMapping) return;
    if (!isConnected()) { await tryReconnect(); if (!isConnected()) return; }
    try {
      await extractAndPushInventory(schemaMapping);
    } catch (err: any) {
      errorCount24h++;
      logger.error('재고 추출 스케줄 실패:', err.message);
    }
  });
}

// ============================================================
// cache-pusher — local-cache 큐 → push
// ============================================================

async function runCachePusher(): Promise<void> {
  if (cachePusherBusy) return;
  cachePusherBusy = true;

  try {
    const config = getConfig();
    const batchSize = config.sync.batchSize || 500;

    // 공통: 전송 실패분(서버에 닿지 못한 것)만 큐에 남기고 재전송. 나머지는 pushed 처리.
    //   서버가 받아 반려한 잘못된 데이터(rejected)는 재전송해도 안 되므로 큐에서 뺀다(sync_log에 남는다).
    const splitByTransport = <T extends { id: number }>(items: T[], failedIdx: number[]) => {
      const failed = new Set(failedIdx);
      const pushedIds = items.filter((_, i) => !failed.has(i)).map(x => x.id);
      const failedIds = items.filter((_, i) => failed.has(i)).map(x => x.id);
      return { pushedIds, failedIds };
    };

    // 1. sales
    const salesItems = dequeueSales(batchSize);
    if (salesItems.length > 0) {
      const result = await pushData('sales', salesItems.map(i => i.payload));
      const { pushedIds, failedIds } = splitByTransport(salesItems, result.transportFailedIndices);
      if (pushedIds.length > 0) markSalesPushed(pushedIds);
      if (failedIds.length > 0) markSalesFailed(failedIds, result.error || 'transport failed');
      recordSyncLog('sales', failedIds.length > 0 ? 'failure' : 'success', salesItems.length, result.data.accepted, result.data.rejected, result.error);
      logger.info(`cache-pusher [sales]: pushed=${pushedIds.length}, 재전송대기=${failedIds.length} (accepted=${result.data.accepted})`);
    }

    // 2. members
    const memberItems = dequeueMembers(batchSize);
    if (memberItems.length > 0) {
      const result = await pushData('members', memberItems.map(i => i.payload));
      const { pushedIds, failedIds } = splitByTransport(memberItems, result.transportFailedIndices);
      if (pushedIds.length > 0) markMembersPushed(pushedIds);
      if (failedIds.length > 0) markMembersFailed(failedIds, result.error || 'transport failed');
      recordSyncLog('members', failedIds.length > 0 ? 'failure' : 'success', memberItems.length, result.data.accepted, result.data.rejected, result.error);
      logger.info(`cache-pusher [members]: pushed=${pushedIds.length}, 재전송대기=${failedIds.length} (accepted=${result.data.accepted})`);
    }

    // 3. inventory
    const inventoryItems = dequeueInventory(batchSize);
    if (inventoryItems.length > 0) {
      const result = await pushData('inventory', inventoryItems.map(i => i.payload));
      const { pushedIds, failedIds } = splitByTransport(inventoryItems, result.transportFailedIndices);
      if (pushedIds.length > 0) markInventoryPushed(pushedIds);
      if (failedIds.length > 0) markInventoryFailed(failedIds, result.error || 'transport failed');
      recordSyncLog('inventory', failedIds.length > 0 ? 'failure' : 'success', inventoryItems.length, result.data.accepted, result.data.rejected, result.error);
      logger.info(`cache-pusher [inventory]: pushed=${pushedIds.length}, 재전송대기=${failedIds.length} (accepted=${result.data.accepted})`);
    }
  } catch (err: any) {
    logger.error(`cache-pusher 예외: ${err.message}`);
  } finally {
    cachePusherBusy = false;
  }
}

// ============================================================
// auto-updater (1시간 주기)
// ============================================================

async function runAutoUpdate(): Promise<void> {
  if (updaterBusy) return;
  updaterBusy = true;

  try {
    const info = await checkForUpdate();
    if (!info.available) {
      logger.debug('auto-updater: 새 버전 없음');
      return;
    }

    // mandatory가 아니면 새벽 2~5시만 업데이트 (매장 영업 시간 회피)
    const hour = new Date().getHours();
    if (!info.mandatory && (hour < 2 || hour >= 5)) {
      logger.info(`auto-updater: 새 버전 v${info.latestVersion} 발견 — 새벽 시간대 대기 (현재 ${hour}시)`);
      return;
    }

    logger.info(`★ auto-updater 시작: v${info.latestVersion}${info.mandatory ? ' (필수)' : ''}`);
    const result = await performUpdate(info);
    if (!result.ok) {
      logger.error(`auto-updater 실패: ${result.error}`);
    }
  } catch (err: any) {
    logger.error(`auto-updater 예외: ${err.message}`);
  } finally {
    updaterBusy = false;
  }
}

// ============================================================
// DB 재연결
// ============================================================

async function tryReconnect(): Promise<void> {
  logger.warn('DB 연결 끊김 — 재연결 시도');
  try {
    await connect();
  } catch (err: any) {
    logger.error('DB 재연결 실패:', err.message);
  }
}

// ============================================================
// 스케줄러 중지
// ============================================================

export function stopScheduler(): void {
  heartbeatTask?.stop();
  salesTask?.stop();
  membersTask?.stop();
  inventoryTask?.stop();
  configTask?.stop();
  resetTask?.stop();
  cachePusherTask?.stop();
  updaterTask?.stop();
  cleanupTask?.stop();
  logger.info('스케줄러 중지');
}
