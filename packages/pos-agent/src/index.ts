/**
 * ★ 한줄전단 POS Agent — 메인 엔트리포인트 (V2)
 *
 * V2 흐름 (D159):
 *  1. 설치 마법사 (첫 실행 또는 --setup)
 *  2. 설정 로드
 *  3. 로컬 캐시 초기화 (SQLite)
 *  4. 서버 등록
 *  5. POS DB 자동 감지 (db-detector) — opt-in
 *  6. Credential Discovery 7 어댑터 시도 (자격증명 자동 발견) — opt-in
 *  7. POS DB 연결 (설정 + Credential Discovery 결과 통합)
 *  8. 스키마 매핑 결정:
 *      - adapter-registry.resolveAdapter() — 알려진 POS 어댑터 우선
 *      - 미매치 시 ai-fallback (기존 schema-reader + requestSchemaAnalysis)
 *  9. Mask Bypass 사전 진단
 *  10. 스케줄러 시작 (extract + cache-pusher + auto-updater)
 *  11. Windows 트레이 UI 가동
 *  12. 양방향 통신 (remote-command long polling) 시작
 *  13. 자동 업데이트 설치 완료 보고
 *
 * 호환성: 기존 V1 흐름 (setup-wizard + schema-reader 직접 호출)은 fallback으로 유지.
 */

import os from 'os';
import { loadConfig, getConfig, saveConfig } from './config';
import { logger } from './logger';
import { registerAgent, requestSchemaAnalysis, fetchConfig as fetchServerConfig } from './server-client';
import { connect, disconnect, isConnected } from './db-connector';
import { readSchema, collectSamples } from './schema-reader';
import { startScheduler, stopScheduler, setSchemaMapping, triggerForceSync } from './scheduler';
import { needsSetup, runSetupWizard } from './setup-wizard';
import { initLocalCache, closeLocalCache } from './local-cache';
import { detectPosDb } from './db-detector';
import { runCredentialDiscovery, registerDefaultAdapters as registerCredentialAdapters } from './credential-discovery';
import { registerDefaultAdapters as registerPosAdapters, resolveAdapter } from './adapter-registry';
import { diagnoseMaskBypass } from './mask-bypass';
import { startTray, stopTray, updateConnectionStatus, updatePosInfo, updateLastSync } from './tray';
import { startRemoteCommandPolling, stopRemoteCommandPolling } from './remote-command';
import { AGENT_VERSION, checkForUpdate, performUpdate, reportInstalled } from './auto-updater';

async function main() {
  logger.info('=========================================');
  logger.info(`한줄전단 POS Agent v${AGENT_VERSION} 시작`);
  logger.info(`호스트: ${os.hostname()}`);
  logger.info('=========================================');

  // 0. 설치 마법사 (첫 실행 또는 --setup 옵션)
  const forceSetup = process.argv.includes('--setup');
  if (forceSetup || needsSetup()) {
    logger.info('설치 마법사를 시작합니다...');
    const setupOk = await runSetupWizard();
    if (!setupOk) {
      logger.error('설치 마법사가 완료되지 않았습니다.');
      process.exit(1);
    }
  }

  // 1. 설정 로드
  const config = loadConfig();
  if (!config.agentKey) {
    logger.error('agent_key가 설정되지 않았습니다. --setup 옵션으로 다시 실행하세요.');
    process.exit(1);
  }

  // 2. 로컬 캐시 초기화 (큐/멱등/통계)
  try {
    initLocalCache();
  } catch (err: any) {
    logger.error(`로컬 캐시 초기화 실패: ${err.message}`);
    process.exit(1);
  }

  // 3. 서버 등록
  logger.info('서버 등록 중...');
  const regResult = await registerAgent({
    hostname: os.hostname(),
    pos_type: config.db.type,
  });

  if (!regResult.ok) {
    logger.error(`서버 등록 실패: ${regResult.error}`);
    logger.error('agent_key를 확인하세요.');
    process.exit(1);
  }

  let schemaMapping = regResult.data?.schemaMapping;
  logger.info('서버 등록 완료');

  // 4. POS DB 자동 감지 (V2) — 기존 config.db가 우선, detection은 보조 정보
  let detection: any = null;
  try {
    detection = await detectPosDb();
    logger.info(`POS 자동 감지: type=${detection.posType}, confidence=${detection.confidence}%`);
  } catch (err: any) {
    logger.warn(`POS 자동 감지 실패 (기존 config.db 사용): ${err.message}`);
  }

  // 5. Credential Discovery 7 어댑터 시도 (V2) — 설정 비번 비어있을 때만 자동 사용
  if (detection && (!config.db.password || config.db.password === '')) {
    try {
      registerCredentialAdapters();
      const candidates = await runCredentialDiscovery({
        posType: detection.posType,
        posInstallPaths: detection.posInstallPaths,
        runningProcesses: detection.runningProcesses,
        listeningPorts: detection.listeningPorts,
      });

      if (candidates.length > 0 && candidates[0].confidence >= 70) {
        const top = candidates[0];
        logger.info(`Credential Discovery 성공: source=${top.source}, confidence=${top.confidence}%`);
        // 자격증명 자동 적용
        saveConfig({
          db: {
            type: top.dbType,
            host: top.host,
            port: top.port,
            database: top.database || config.db.database,
            username: top.username || config.db.username,
            password: top.password || config.db.password,
            charset: config.db.charset,
            filePath: top.filePath || config.db.filePath,
          },
        });
        loadConfig(); // reload
      } else {
        logger.info('Credential Discovery: confidence 70% 미만 — 기존 config 유지');
      }
    } catch (err: any) {
      logger.warn(`Credential Discovery 실패: ${err.message}`);
    }
  }

  // 6. POS DB 연결
  const currentDbConfig = getConfig().db;
  logger.info(`POS DB 연결 중... (${currentDbConfig.type} ${currentDbConfig.host}:${currentDbConfig.port}/${currentDbConfig.database})`);
  const connected = await connect();

  if (!connected) {
    logger.error('POS DB 연결 실패 — DB 설정을 확인하세요.');
    logger.error('agent-config.json의 db 섹션을 수정하고 다시 실행하세요.');
    process.exit(1);
  }

  updateConnectionStatus('connected');

  // 7. 어댑터 매핑 결정 (V2) — 알려진 POS 어댑터 우선, 미매치 시 ai-fallback
  let adapterUsed = 'none';
  if (!schemaMapping && detection) {
    try {
      registerPosAdapters();
      const resolution = await resolveAdapter(detection, {
        dbType: currentDbConfig.type,
        host: currentDbConfig.host,
        port: currentDbConfig.port,
        database: currentDbConfig.database,
        confidence: 100,
        source: 'configFile',
      });

      if (resolution && resolution.mapping.confidence >= 50) {
        schemaMapping = resolution.mapping;
        adapterUsed = resolution.adapter.name;
        logger.info(`어댑터 매핑 사용: ${resolution.adapter.name} (source=${resolution.source}, confidence=${resolution.mapping.confidence}%)`);
      } else {
        logger.warn('어댑터 매핑 confidence 부족 — 기존 schema-reader fallback');
      }
    } catch (err: any) {
      logger.warn(`어댑터 매핑 실패: ${err.message}`);
    }
  }

  // 8. V1 fallback — schema-reader + requestSchemaAnalysis (어댑터 미매치 또는 매핑 부재 시)
  if (!schemaMapping) {
    logger.info('V1 fallback: 스키마 매핑 없음 — AI 자동 분석 시작');

    const tables = await readSchema();
    if (tables.length === 0) {
      logger.error('POS DB에 테이블이 없습니다.');
      process.exit(1);
    }

    const samples = await collectSamples(tables);
    logger.info('서버에 AI 스키마 분석 요청 중... (30초 이상 소요될 수 있습니다)');
    const analysisResult = await requestSchemaAnalysis({
      dbType: currentDbConfig.type,
      tables,
      samples,
    });

    if (!analysisResult.ok || !analysisResult.data?.mapping) {
      logger.error(`AI 분석 실패: ${analysisResult.error}`);
      logger.error('스키마를 수동으로 확인해주세요.');
      process.exit(1);
    }

    schemaMapping = analysisResult.data.mapping;
    adapterUsed = 'ai-fallback';
    logger.info(`AI 분석 완료 — confidence: ${schemaMapping.confidence}%`);

    if (schemaMapping.confidence < 50) {
      logger.warn('AI 확신도가 낮습니다 (50% 미만). 매핑 결과를 확인해주세요.');
      logger.warn(`회원: ${schemaMapping.memberTable}, 판매: ${schemaMapping.salesTable}`);
      if (schemaMapping.notes?.length) {
        schemaMapping.notes.forEach((n: string) => logger.warn(`  - ${n}`));
      }
    }

    if (schemaMapping.phoneFormat === 'masked') {
      logger.warn('전화번호가 마스킹되어 있습니다. Mask Bypass 3단 fallback 가동.');
    } else if (schemaMapping.phoneFormat === 'encrypted') {
      logger.warn('전화번호가 암호화되어 있습니다. 복호화 키가 필요합니다.');
    }
  }

  // 9. Mask Bypass 사전 진단 (선택)
  try {
    const adapterPlaceholder: any = { name: adapterUsed, version: '1.0', priority: 0, description: '', matches: () => true, getStaticMapping: () => null };
    const credentialPlaceholder: any = { dbType: currentDbConfig.type, host: currentDbConfig.host, port: currentDbConfig.port, confidence: 100, source: 'configFile' };
    const diagnosis = await diagnoseMaskBypass(adapterPlaceholder, schemaMapping, credentialPlaceholder);
    logger.info(`Mask Bypass 진단: 권장 전략 = ${diagnosis.recommendedStrategy}`);
  } catch (err: any) {
    logger.debug(`Mask Bypass 진단 스킵: ${err.message}`);
  }

  // 10. 스키마 매핑 박음 + 스케줄러 시작
  setSchemaMapping(schemaMapping);
  startScheduler();

  // 11. Windows 트레이 UI
  if (process.platform === 'win32') {
    try {
      await startTray({
        onForceSync: async () => {
          await triggerForceSync();
        },
        onReconfigure: () => {
          logger.info('트레이에서 재설정 요청 — 별도 turn에서 박힘');
        },
        onQuit: async () => {
          await gracefulShutdown();
        },
      });
      updatePosInfo(
        detection?.posType || schemaMapping.posType || 'unknown',
        regResult.data?.companyName || '',
        schemaMapping.confidence || 0
      );
    } catch (err: any) {
      logger.warn(`트레이 시작 실패 (CLI 모드로 가동): ${err.message}`);
    }
  }

  // 12. 양방향 통신 (remote-command long polling)
  startRemoteCommandPolling({
    onForceSync: async () => {
      const result = await triggerForceSync();
      updateLastSync(new Date().toISOString());
      return result;
    },
    onResendSchema: async () => {
      const tables = await readSchema();
      const samples = await collectSamples(tables);
      const r = await requestSchemaAnalysis({
        dbType: currentDbConfig.type,
        tables,
        samples,
      });
      const newMapping = r.data?.mapping;
      if (newMapping) {
        setSchemaMapping(newMapping);
        return { confidence: newMapping.confidence, memberTable: newMapping.memberTable };
      }
      return { confidence: 0, memberTable: null };
    },
    onUpdateTrigger: async () => {
      const info = await checkForUpdate();
      if (info.available) {
        await performUpdate(info);
      }
    },
    onDiagnoseMaskBypass: async () => {
      const adapterPlaceholder: any = { name: adapterUsed, version: '1.0', priority: 0, description: '', matches: () => true, getStaticMapping: () => null };
      const credentialPlaceholder: any = { dbType: currentDbConfig.type, host: currentDbConfig.host, port: currentDbConfig.port, confidence: 100, source: 'configFile' };
      return await diagnoseMaskBypass(adapterPlaceholder, schemaMapping, credentialPlaceholder);
    },
  });

  // 13. 자동 업데이트 설치 완료 보고 (이번 가동이 업데이트 직후일 수 있음)
  await reportInstalled();

  logger.info('POS Agent 정상 가동 중');
  logger.info('Ctrl+C로 종료');

  // 종료 핸들러
  process.on('SIGINT', async () => {
    logger.info('SIGINT 수신 — graceful shutdown');
    await gracefulShutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM 수신 — graceful shutdown');
    await gracefulShutdown();
    process.exit(0);
  });

  // 프로세스 유지
  process.stdin.resume();
}

async function gracefulShutdown(): Promise<void> {
  try {
    stopRemoteCommandPolling();
    stopScheduler();
    await stopTray();
    disconnect();
    closeLocalCache();
    logger.info('POS Agent 종료');
  } catch (err: any) {
    logger.error(`graceful shutdown 에러: ${err.message}`);
  }
}

main().catch(err => {
  logger.error('치명적 오류:', err.message);
  process.exit(1);
});
