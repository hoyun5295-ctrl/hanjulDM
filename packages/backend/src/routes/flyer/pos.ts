/**
 * ★ 전단AI POS Agent 수신 라우트
 * 마운트: /api/flyer/pos
 * CT: CT-F12 flyer-pos-ingest.ts, CT-F16 flyer-pos-ai.ts
 *
 * ⚠️ 이 라우트는 POS Agent(외부 프로세스)에서 호출한다.
 * flyerAuthenticate가 아닌 별도 agent_key 인증을 사용.
 */

import { Request, Response, Router } from 'express';
import {
  verifyPosAgent,
  ingestSales,
  ingestInventory,
  ingestMembers,
  ingestPromotions,
  updateAgentHeartbeat,
  analyzeSchema,
  saveSchemaMapping,
  getSchemaMapping,
  getTopSellingProducts,
  getPosAgentStatusList,
  issueRemoteCommand,
  pollPendingCommand,
  recordCommandResult,
  listCommandHistory,
  recordAdapterCandidate,
  recordCredentialDiscoveryLog,
  getLatestAgentInfo,
  recordAgentInstalled,
} from '../../utils/flyer';
import type { PosRawSchema, RemoteCommandType } from '../../utils/flyer';
import { query } from '../../config/database';
// ★ 슈퍼관리자 라우트 인증 — 이미 있는 미들웨어 사용(옛 코드는 토큰 존재만 확인 = 사실상 무인증이었다)
import { flyerSuperAuthenticate } from '../../middlewares/super-auth';

const router = Router();

// ============================================================
// POS Agent 인증 미들웨어 (agent_key 기반)
// ============================================================
async function agentAuth(req: Request, res: Response, next: Function) {
  const agentKey = req.headers['x-agent-key'] as string || req.body?.agent_key;
  if (!agentKey) return res.status(401).json({ error: 'agent_key required' });

  const agent = await verifyPosAgent(agentKey);
  if (!agent) return res.status(401).json({ error: 'Invalid agent_key' });

  (req as any).agent = agent;
  next();
}

// ============================================================
// POST /register — Agent 최초 등록 + 스키마 분석 요청
// ============================================================
router.post('/register', agentAuth, async (req: Request, res: Response) => {
  try {
    const { companyId, agentId } = (req as any).agent;
    const { hostname, ip_address, pos_type, pos_version } = req.body;

    // Agent 정보 업데이트
    await query(
      `UPDATE flyer_pos_agents SET
         hostname = COALESCE($2, hostname),
         ip_address = COALESCE($3, ip_address),
         pos_type = COALESCE($4, pos_type),
         pos_version = COALESCE($5, pos_version),
         sync_status = 'connected',
         last_heartbeat = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [agentId, hostname, ip_address, pos_type, pos_version]
    );

    // 기존 스키마 매핑이 있으면 반환
    const existing = await getSchemaMapping(agentId);

    return res.json({
      ok: true,
      agentId,
      companyId,
      schemaMapping: existing,
      message: existing ? '기존 스키마 매핑 로드됨' : '스키마 분석 필요 — POST /analyze-schema 호출',
    });
  } catch (error: any) {
    console.error('[flyer/pos] register error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// POST /analyze-schema — ★ AI 스키마 자동 분석
// ============================================================
router.post('/analyze-schema', agentAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = (req as any).agent;
    const rawSchema: PosRawSchema = req.body;

    if (!rawSchema.tables || !Array.isArray(rawSchema.tables) || rawSchema.tables.length === 0) {
      return res.status(400).json({ error: 'tables[] 필수 — INFORMATION_SCHEMA에서 읽어서 전송' });
    }

    console.log(`[flyer/pos] AI 스키마 분석 시작 — Agent ${agentId}, 테이블 ${rawSchema.tables.length}개`);

    // Claude API로 스키마 분석
    const mapping = await analyzeSchema(rawSchema);

    // 결과 저장
    await saveSchemaMapping(agentId, mapping);

    console.log(`[flyer/pos] AI 스키마 분석 완료 — confidence: ${mapping.confidence}%, member: ${mapping.memberTable}, sales: ${mapping.salesTable}`);

    return res.json({
      ok: true,
      mapping,
      message: mapping.confidence >= 70
        ? '스키마 분석 완료 — 자동 매핑 적용 가능'
        : '스키마 분석 완료 — 확신도 낮음, 사장님 확인 필요',
    });
  } catch (error: any) {
    console.error('[flyer/pos] analyze-schema error:', error);
    return res.status(500).json({ error: `AI 분석 실패: ${error.message}` });
  }
});

// ============================================================
// GET /config — Agent 설정 다운로드 (매핑 결과 + 싱크 주기)
// ============================================================
router.get('/config', agentAuth, async (req: Request, res: Response) => {
  try {
    const { agentId, companyId } = (req as any).agent;

    const mapping = await getSchemaMapping(agentId);

    // 회사 설정 조회 (싱크 주기 등)
    const companyResult = await query(
      `SELECT company_name, business_type FROM flyer_companies WHERE id = $1`,
      [companyId]
    );
    const company = companyResult.rows[0] || {};

    return res.json({
      agentId,
      companyId,
      companyName: company.company_name,
      businessType: company.business_type,

      // 스키마 매핑 (없으면 null → Agent가 analyze-schema 호출)
      schemaMapping: mapping,

      // 싱크 설정
      syncConfig: {
        salesIntervalMinutes: 5,      // 판매 데이터 5분 간격
        membersIntervalMinutes: 30,   // 회원 데이터 30분 간격
        inventoryIntervalMinutes: 60, // 재고 스냅샷 1시간 간격
        heartbeatIntervalSeconds: 60, // 하트비트 1분 간격
        batchSize: 500,               // 한 번에 전송할 최대 건수
      },
    });
  } catch (error: any) {
    console.error('[flyer/pos] config error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// POST /push — 데이터 푸시 (sales/members/inventory)
// ============================================================
router.post('/push', agentAuth, async (req: Request, res: Response) => {
  try {
    const { companyId, agentId } = (req as any).agent;
    const { type, items } = req.body;

    if (!type || !Array.isArray(items)) {
      return res.status(400).json({ error: 'type and items[] required' });
    }

    let result;
    switch (type) {
      case 'sales': result = await ingestSales(companyId, agentId, items); break;
      case 'inventory': result = await ingestInventory(companyId, agentId, items); break;
      case 'members': result = await ingestMembers(companyId, agentId, items); break;
      case 'promotions': result = await ingestPromotions(companyId, agentId, items); break;
      default: return res.status(400).json({ error: `Unknown type: ${type}` });
    }
    return res.json(result);
  } catch (error: any) {
    console.error('[flyer/pos] push error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// POST /heartbeat — 하트비트
// ============================================================
router.post('/heartbeat', agentAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = (req as any).agent;
    const { last_sync_at, pending_count = 0, error_count_24h = 0 } = req.body;
    await updateAgentHeartbeat(agentId, last_sync_at || new Date().toISOString(), pending_count, error_count_24h);
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// GET /top-selling — POS 판매 기반 인기 상품 (flyerAuthenticate용)
// ★ 이 엔드포인트는 매장 사용자가 호출 — agentAuth 아닌 flyerAuth 필요
// ============================================================
import { flyerAuthenticate } from '../../middlewares/flyer-auth';

router.get('/top-selling', flyerAuthenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 정보 없음' });

    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const period = Math.min(Number(req.query.period) || 30, 90);

    const products = await getTopSellingProducts(companyId, limit, period);
    return res.json(products);
  } catch (error: any) {
    console.error('[pos] top-selling error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// GET /my-agent — 매장 사장님 본인 회사의 POS Agent 상태 (V2)
// ============================================================
router.get('/my-agent', flyerAuthenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 정보 없음' });

    const result = await query(
      `SELECT id, agent_key, pos_type, pos_version, sync_status, last_heartbeat,
              agent_version, last_update_at, hostname, ip_address, created_at, updated_at
       FROM flyer_pos_agents
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }

    // 대기 큐 통계도 같이 반환 (cache 상태 noisy 회피 — pending_count는 heartbeat에서 받음)
    const agent = result.rows[0];
    return res.json({
      exists: true,
      agent: {
        id: agent.id,
        agentKey: agent.agent_key,
        posType: agent.pos_type,
        posVersion: agent.pos_version,
        syncStatus: agent.sync_status,
        lastHeartbeat: agent.last_heartbeat,
        agentVersion: agent.agent_version,
        lastUpdateAt: agent.last_update_at,
        hostname: agent.hostname,
        ipAddress: agent.ip_address,
        createdAt: agent.created_at,
        updatedAt: agent.updated_at,
      },
    });
  } catch (error: any) {
    console.error('[pos] my-agent error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// GET /agents — POS Agent 상태 목록 (슈퍼관리자 전용)
// ============================================================
router.get('/agents', flyerSuperAuthenticate, async (_req: Request, res: Response) => {
  try {
    const agents = await getPosAgentStatusList();
    return res.json(agents);
  } catch (error: any) {
    console.error('[pos] agents list error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// ★ 양방향 통신 라우트 6종 (CT-F23)
// ============================================================

/**
 * POST /remote-command/issue — 슈퍼관리자가 Agent에 명령 발행
 * Body: { agentId, type: RemoteCommandType, payload? }
 * Header: Authorization: Bearer <super_token>
 */
router.post('/remote-command/issue', flyerSuperAuthenticate, async (req: Request, res: Response) => {
  try {
    const { agentId, type, payload } = req.body;
    if (!agentId || !type) return res.status(400).json({ error: 'agentId, type required' });

    const validTypes: RemoteCommandType[] = ['FORCE_SYNC', 'RESEND_SCHEMA', 'FETCH_LOGS', 'REVOKE', 'UPDATE', 'DIAGNOSE_MASK_BYPASS'];
    if (!validTypes.includes(type)) return res.status(400).json({ error: `Invalid type: ${type}` });

    // 발행자 = 인증된 슈퍼관리자 로그인 ID (클라이언트가 보낸 issuedBy를 믿지 않는다)
    const issuedBy = req.flyerSuperUser?.loginId || 'super_admin';
    const commandId = await issueRemoteCommand(agentId, type, payload, issuedBy);
    return res.json({ ok: true, commandId });
  } catch (error: any) {
    console.error('[pos] remote-command/issue error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /remote-command/poll — Agent long polling
 * Body: { waitMs?: number }
 * Header: x-agent-key
 */
router.post('/remote-command/poll', agentAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = (req as any).agent;
    const waitMs = Math.min(Number(req.body?.waitMs) || 25000, 30000);

    const cmd = await pollPendingCommand(agentId, waitMs);
    if (!cmd) {
      return res.status(204).end(); // 명령 없음
    }

    return res.json({
      command: {
        id: cmd.id,
        type: cmd.type,
        payload: cmd.payload,
        issuedAt: cmd.issued_at,
      },
    });
  } catch (error: any) {
    console.error('[pos] remote-command/poll error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /remote-command/respond — Agent 결과 보고
 * Body: { commandId, ok, output?, error?, durationMs? }
 * Header: x-agent-key
 */
router.post('/remote-command/respond', agentAuth, async (req: Request, res: Response) => {
  try {
    const { commandId, ok, output, error, durationMs } = req.body;
    if (!commandId || typeof ok !== 'boolean') {
      return res.status(400).json({ error: 'commandId, ok required' });
    }
    await recordCommandResult(commandId, ok, output, error, durationMs);
    return res.json({ ok: true });
  } catch (error: any) {
    console.error('[pos] remote-command/respond error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /remote-command/history — 명령 이력 조회 (슈퍼관리자)
 */
router.get('/remote-command/history', flyerSuperAuthenticate, async (req: Request, res: Response) => {
  try {
    const agentId = req.query.agentId as string;
    if (!agentId) return res.status(400).json({ error: 'agentId required' });

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const history = await listCommandHistory(agentId, limit);
    return res.json(history);
  } catch (error: any) {
    console.error('[pos] remote-command/history error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /agent-update/check — Agent 자동 업데이트 체크
 * Query: ?currentVersion=1.0.0
 * Header: x-agent-key
 */
router.get('/agent-update/check', agentAuth, async (req: Request, res: Response) => {
  try {
    const currentVersion = (req.query.currentVersion as string) || '0.0.0';
    const info = await getLatestAgentInfo(currentVersion);
    return res.json(info);
  } catch (error: any) {
    console.error('[pos] agent-update/check error:', error);
    return res.status(500).json({ available: false, error: 'Server error' });
  }
});

/**
 * POST /agent-update/report-installed — Agent 설치 완료 보고
 * Body: { version, installedAt }
 * Header: x-agent-key
 */
router.post('/agent-update/report-installed', agentAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = (req as any).agent;
    const { version, installedAt } = req.body;
    if (!version) return res.status(400).json({ error: 'version required' });
    await recordAgentInstalled(agentId, version, installedAt || new Date().toISOString());
    return res.json({ ok: true });
  } catch (error: any) {
    console.error('[pos] agent-update/report-installed error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /adapter-candidate-report — 어댑터 학습 후보 (AI fallback confidence 95%+ 시 자동)
 * Body: { posType, mapping, detection }
 * Header: x-agent-key
 */
router.post('/adapter-candidate-report', agentAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = (req as any).agent;
    const { posType, mapping, detection } = req.body;
    if (!posType || !mapping) return res.status(400).json({ error: 'posType, mapping required' });
    const candidateId = await recordAdapterCandidate(agentId, posType, mapping, detection || {});
    return res.json({ ok: true, candidateId });
  } catch (error: any) {
    console.error('[pos] adapter-candidate-report error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /credential-discovery/report — Credential Discovery 결과 학습 로그
 * Body: { posType, attemptedAdapters, succeededAdapter, highestConfidence }
 * Header: x-agent-key
 */
router.post('/credential-discovery/report', agentAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = (req as any).agent;
    const { posType, attemptedAdapters, succeededAdapter, highestConfidence } = req.body;
    await recordCredentialDiscoveryLog(
      agentId,
      posType || 'unknown',
      Array.isArray(attemptedAdapters) ? attemptedAdapters : [],
      succeededAdapter || null,
      Number(highestConfidence) || 0
    );
    return res.json({ ok: true });
  } catch (error: any) {
    console.error('[pos] credential-discovery/report error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
