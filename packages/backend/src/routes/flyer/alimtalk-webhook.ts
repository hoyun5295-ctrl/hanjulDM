/**
 * /api/flyer/alimtalk-webhook — 휴머스온 IMC 웹훅 수신 (공개, 인증 X)
 *
 * 한줄AI 본진 routes/alimtalk.ts의 /webhook 패턴 미러 + hanjulDM 격리.
 * HMAC + IP 화이트리스트 + idempotent INSERT (flyer_kakao_webhook_events).
 *
 * IMC 콘솔에서 웹훅 URL 등록 필요:
 *   https://hanjul-flyer.kr/api/flyer/alimtalk-webhook (또는 운영 도메인)
 *
 * env 설정:
 *   - IMC_WEBHOOK_HMAC_SECRET (HMAC-SHA256, 미설정 시 검증 skip)
 *   - IMC_WEBHOOK_ALLOWED_IPS (쉼표 구분, 미설정 시 전체 허용)
 */

import { raw, Request, Response, Router } from 'express';
import {
  processKakaoWebhook,
  verifyWebhookSignature,
  isAllowedWebhookIp,
} from '../../utils/flyer/alimtalk/alimtalk-webhook-handler';

const router = Router();

router.post(
  '/',
  raw({ type: '*/*', limit: '10mb' }),
  async (req: Request, res: Response) => {
    try {
      const clientIp = (req.ip || req.socket?.remoteAddress || '').trim();
      if (!isAllowedWebhookIp(clientIp)) {
        console.warn('[flyer-alimtalk-webhook] IP 거부', clientIp);
        return res.status(403).json({ code: '403', message: 'FORBIDDEN_IP' });
      }

      const headerSig =
        (req.headers['x-imc-signature'] as string | undefined) ||
        (req.headers['x-signature'] as string | undefined) ||
        (req.headers['x-humuson-signature'] as string | undefined);

      const rawBuf: Buffer = req.body instanceof Buffer ? req.body : Buffer.from('');
      const rawStr = rawBuf.toString('utf8');

      const secret = process.env.IMC_WEBHOOK_HMAC_SECRET;
      // HMAC은 secret 설정된 경우에만 강제 (Phase 0 미수령 시 통과)
      if (secret) {
        const ok = verifyWebhookSignature(rawStr, headerSig, secret);
        if (!ok) {
          console.warn('[flyer-alimtalk-webhook] HMAC 불일치', clientIp);
          return res.status(401).json({ code: '401', message: 'INVALID_SIGNATURE' });
        }
      }

      const payload = JSON.parse(rawStr);
      const result = await processKakaoWebhook(payload);
      return res.json({ code: '0000', message: 'OK', ...result });
    } catch (err: any) {
      console.error('[flyer-alimtalk-webhook] 예외', err);
      return res.status(400).json({
        code: '400',
        message: err?.message || 'BAD_REQUEST',
      });
    }
  },
);

export default router;
