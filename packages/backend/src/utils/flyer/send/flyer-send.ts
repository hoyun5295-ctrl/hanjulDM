/**
 * ★ CT-F08 — 전단AI 발송 오케스트레이터 (발송 경로의 유일한 진입점)
 *
 * 한줄로 campaigns.ts 5경로 → CT-F08 1경로로 단순화.
 * 모든 전단AI 발송(AI/직접/자동/테스트)은 이 함수를 통해야 한다.
 *
 * 흐름:
 *   1. 발송 가능 여부 확인 (CT-F03 canFlyerCompanySend)
 *   2. 회신번호 결정 (CT-F06 resolveFlyerCallback)
 *   3. 수신자 중복제거 (CT-F07 deduplicateFlyerRecipients)
 *   4. 수신거부 제외 (CT-F02 filterOutFlyerUnsubscribed)
 *   5. 변수 치환 + (광고)+080 부착 (CT-F05 prepareFlyerSendMessage)
 *   6. MySQL 큐 bulk INSERT (CT-F01 bulkInsertSmsQueue)
 *   7. flyer_campaigns 레코드 생성/업데이트
 */

import { query } from '../../../config/database';
import {
  getFlyerCompanySmsTables,
  bulkInsertSmsQueue,
  toQtmsgType,
} from './flyer-sms-queue';
import { insertAlimtalkQueue } from '../../sms-queue';
import { canFlyerStoreSend, deductFlyerPrepaid } from '../billing/flyer-billing';
import { resolveFlyerCallback } from './flyer-callback-filter';
import { deduplicateWithStats, FlyerRecipient } from './flyer-deduplicate';
import { filterOutFlyerUnsubscribed } from './flyer-unsubscribe-helper';
import { prepareFlyerSendMessage, replaceFlyerAlimtalkVariables, FlyerCustomerVars } from './flyer-message';
import { generateTrackingUrls } from './flyer-short-code';

export type FlyerMessageType = 'SMS' | 'LMS' | 'MMS' | 'ALIMTALK';

export type FlyerSendRecipient = FlyerRecipient & Omit<FlyerCustomerVars, 'phone'> & {
  customer_id?: string | null;
};

export interface FlyerSendParams {
  companyId: string;
  userId: string;
  messageType: FlyerMessageType;
  messageTemplate: string;
  isAd: boolean;
  requestedCallback?: string | null;
  mmsImagePaths?: string[]; // 최대 3개
  subject?: string; // LMS/MMS 제목
  recipients: FlyerSendRecipient[];
  flyerId?: string | null;
  shortUrlId?: string | null;
  scheduleAt?: Date | null;
  skipUnsubscribeFilter?: boolean;
  skipDeduplicate?: boolean;
  // ★ D158 알림톡 발송 (messageType='ALIMTALK' 시 필수)
  templateId?: string | null;    // flyer_kakao_templates.id (DB FK)
  templateCode?: string | null;  // IMC templateCode (insertAlimtalkQueue 전달)
  profileId?: string | null;     // flyer_kakao_sender_profiles.id (DB FK)
  senderKey?: string | null;     // IMC senderKey (캐시, etcJson 빌드용)
  kakaoButtons?: any[] | null;   // 버튼 배열 → k_button_json 빌드
  nextType?: string | null;      // 실패 시 폴백 'N'/'S'/'L'/'A'/'B' (기본 'L')
  nextContents?: string | null;  // A/B 폴백 시 대체 문구
  emphasizeTitle?: string | null; // etcJson 강조표기 title
  customVars?: Record<string, string>; // 사용자 직접 입력 변수 (#{주문번호} 등 DB 미존재 변수)
}

export interface FlyerSendResult {
  ok: boolean;
  campaignId?: string;
  totalRequested: number;
  deduplicated: number;
  unsubscribedRemoved: number;
  enqueued: number;
  callbackUsed: string | null;
  error?: string;
}

export async function sendFlyerCampaign(params: FlyerSendParams): Promise<FlyerSendResult> {
  const {
    companyId, userId, messageType, messageTemplate, isAd,
    requestedCallback, mmsImagePaths, subject, recipients,
    flyerId, shortUrlId, scheduleAt,
    skipUnsubscribeFilter = false,
    skipDeduplicate = false,
    // ★ D158 알림톡 발송 파라미터
    templateId, templateCode, profileId, senderKey,
    kakaoButtons, nextType, nextContents, emphasizeTitle, customVars,
  } = params;

  // ★ D158 알림톡 필수 파라미터 검증
  if (messageType === 'ALIMTALK') {
    if (!templateCode || !profileId) {
      return {
        ok: false,
        totalRequested: recipients.length,
        deduplicated: 0,
        unsubscribedRemoved: 0,
        enqueued: 0,
        callbackUsed: null,
        error: 'ALIMTALK 발송은 templateCode + profileId 필수입니다',
      };
    }
  }

  // 1. 발송 가능 여부 (매장 + 총판 레벨)
  const canSend = await canFlyerStoreSend(userId);
  if (!canSend.ok) {
    return {
      ok: false,
      totalRequested: recipients.length,
      deduplicated: 0,
      unsubscribedRemoved: 0,
      enqueued: 0,
      callbackUsed: null,
      error: canSend.reason,
    };
  }

  // 2. 회신번호 결정
  const cb = await resolveFlyerCallback(companyId, requestedCallback);
  if (!cb.callback) {
    return {
      ok: false,
      totalRequested: recipients.length,
      deduplicated: 0,
      unsubscribedRemoved: 0,
      enqueued: 0,
      callbackUsed: null,
      error: cb.error || '회신번호를 결정할 수 없습니다',
    };
  }

  // 3. 중복제거
  let working: FlyerSendRecipient[] = recipients;
  let dedupRemoved = 0;
  if (!skipDeduplicate) {
    const r = deduplicateWithStats(recipients);
    working = r.deduplicated as FlyerSendRecipient[];
    dedupRemoved = r.removedCount;
  }

  // 4. 수신거부 제외
  let unsubRemoved = 0;
  if (!skipUnsubscribeFilter && working.length > 0) {
    const phones = working.map(r => r.phone);
    const allowed = await filterOutFlyerUnsubscribed(userId, phones);
    const allowedSet = new Set(allowed);
    const filtered = working.filter(r => allowedSet.has(r.phone));
    unsubRemoved = working.length - filtered.length;
    working = filtered;
  }

  if (working.length === 0) {
    return {
      ok: false,
      totalRequested: recipients.length,
      deduplicated: dedupRemoved,
      unsubscribedRemoved: unsubRemoved,
      enqueued: 0,
      callbackUsed: cb.callback,
      error: '발송 가능한 수신자가 없습니다',
    };
  }

  // 5. 080 번호 조회 (광고 부착용)
  const opt080Result = await query(
    `SELECT opt_out_080_number FROM flyer_companies WHERE id = $1`,
    [companyId]
  );
  const opt080: string | null = opt080Result.rows[0]?.opt_out_080_number || null;

  // 6. 변수 치환 + (광고) 부착 → 메시지 최종본 생성
  // bulkInsertSmsQueue rows 형식: [dest_no, call_back, msg_contents, msg_type, title_str, sendTime, app_etc1(campaignId), app_etc2(companyId), file_name1, file_name2, file_name3]
  const mmsImages = mmsImagePaths || [];

  // ★ Phase 1: 수신자별 메시지 생성 (추적 URL 치환은 campaignId 확보 후 진행)
  // 먼저 공통 메시지 생성 → 추적 URL 삽입은 9.5단계에서 처리
  // ★ D158 알림톡: #{변수명} IMC 표준 치환 / SMS: %변수% + (광고) 부착
  const baseMessages = working.map(r => {
    if (messageType === 'ALIMTALK') {
      return replaceFlyerAlimtalkVariables(messageTemplate, r as FlyerCustomerVars, customVars);
    }
    return prepareFlyerSendMessage(messageTemplate, r as FlyerCustomerVars, isAd, opt080);
  });

  // 7. flyer_campaigns 레코드 생성 (★ D158 kakao_* 컬럼 박기 — ALIMTALK일 때만)
  const campaignResult = await query(
    `INSERT INTO flyer_campaigns
       (id, company_id, created_by, flyer_id, short_url_id,
        message_type, message_content, message_template, is_ad, callback_number, mms_image_path,
        total_recipients, sent_count, success_count, fail_count,
        status, scheduled_at, sent_at, created_at,
        kakao_profile_id, kakao_template_id, kakao_sender_key)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0, 0,
             $12, $13, $14, NOW(),
             $15, $16, $17)
     RETURNING id`,
    [
      companyId, userId, flyerId || null, shortUrlId || null,
      messageType, messageTemplate, messageTemplate, isAd, cb.callback,
      mmsImagePaths?.[0] || null,
      working.length,
      scheduleAt ? 'queued' : 'sending',
      scheduleAt || null,
      scheduleAt ? null : new Date(),
      messageType === 'ALIMTALK' ? (profileId || null) : null,
      messageType === 'ALIMTALK' ? (templateId || null) : null,
      messageType === 'ALIMTALK' ? (senderKey || null) : null,
    ]
  );
  const campaignId = campaignResult.rows[0].id;

  // 8. 선불 잔액 차감 (100% 선불 — 후불 없음)
  const deductResult = await deductFlyerPrepaid(userId, working.length, messageType);
  if (!deductResult.ok) {
    // 잔액 부족 → 캠페인 취소 처리
    await query(`UPDATE flyer_campaigns SET status = 'cancelled' WHERE id = $1`, [campaignId]);
    return {
      ok: false,
      campaignId,
      totalRequested: recipients.length,
      deduplicated: dedupRemoved,
      unsubscribedRemoved: unsubRemoved,
      enqueued: 0,
      callbackUsed: cb.callback,
      error: deductResult.reason,
    };
  }

  // 9. 예약이면 지금 INSERT 안 하고 완료 (자동발송 워커가 처리 — 향후)
  if (scheduleAt) {
    return {
      ok: true,
      campaignId,
      totalRequested: recipients.length,
      deduplicated: dedupRemoved,
      unsubscribedRemoved: unsubRemoved,
      enqueued: 0,
      callbackUsed: cb.callback,
    };
  }

  // 9.5 ★ Phase 1: 수신자별 추적 URL 생성 + 메시지에 삽입
  //   flyerId가 있으면 개인별 추적 URL 생성, 없으면 공통 메시지 그대로 사용
  let finalMessages = baseMessages;
  if (flyerId) {
    try {
      const phones = working.map(r => r.phone);
      const urlMap = await generateTrackingUrls(flyerId, companyId, campaignId, phones);

      // 메시지 내 {url} 플레이스홀더를 개인별 URL로 치환
      // {url} 없으면 메시지 끝에 URL 추가
      finalMessages = baseMessages.map((msg, idx) => {
        const phone = working[idx].phone;
        const personalUrl = urlMap.get(phone);
        if (!personalUrl) return msg;

        if (msg.includes('{url}')) {
          return msg.replace('{url}', personalUrl);
        }
        // {url} 플레이스홀더가 없으면 그대로 유지 (URL 미삽입)
        return msg;
      });
    } catch (err: any) {
      // ★ 추적 URL 생성 실패해도 발송 자체는 진행 (기간계 안정성)
      console.error('[CT-F18] 추적 URL 생성 실패 (발송은 계속):', err.message);
    }
  }

  // 10. MySQL 큐 INSERT — 채널별 분기
  const tables = await getFlyerCompanySmsTables(companyId);

  if (messageType === 'ALIMTALK') {
    // ★ D158 알림톡 발송: insertAlimtalkQueue (msg_type='K' + k_template_code + k_button_json + k_etc_json)
    const buttonJson = (kakaoButtons && kakaoButtons.length > 0) ? JSON.stringify(kakaoButtons) : null;
    const etcObj: any = {};
    if (senderKey) etcObj.senderkey = senderKey;
    if (emphasizeTitle) etcObj.title = emphasizeTitle;
    const etcJson = Object.keys(etcObj).length > 0 ? JSON.stringify(etcObj) : undefined;

    const alimtalkRows = working.map((r, idx) => ({
      phone: r.phone,
      callback: cb.callback!,
      message: finalMessages[idx],
      templateCode: templateCode!,
      nextType: nextType || 'L',
      nextContents: (nextType === 'A' || nextType === 'B') ? (nextContents || '') : undefined,
      buttonJson: buttonJson || undefined,
      etcJson,
      titleStr: subject || undefined,
      companyId,
    }));
    await insertAlimtalkQueue(tables, alimtalkRows);
  } else {
    // SMS/LMS/MMS 발송 (기존 흐름)
    const rowsForQueue: any[][] = working.map((r, idx) => [
      r.phone,                     // dest_no
      cb.callback!,                // call_back
      finalMessages[idx],          // msg_contents (개인별 URL 포함 가능)
      toQtmsgType(messageType),    // msg_type
      subject || '',               // title_str
      '',                          // sendTime
      campaignId,                  // app_etc1
      companyId,                   // app_etc2
      mmsImages[0] || '',          // file_name1
      mmsImages[1] || '',          // file_name2
      mmsImages[2] || '',          // file_name3
    ]);
    await bulkInsertSmsQueue(tables, rowsForQueue, true); // useNow=true 즉시발송
  }

  // 11. 발송 상태 업데이트
  await query(
    `UPDATE flyer_campaigns SET sent_count = $1, status = 'sending', sent_at = NOW() WHERE id = $2`,
    [working.length, campaignId]
  );

  return {
    ok: true,
    campaignId,
    totalRequested: recipients.length,
    deduplicated: dedupRemoved,
    unsubscribedRemoved: unsubRemoved,
    enqueued: working.length,
    callbackUsed: cb.callback,
  };
}
