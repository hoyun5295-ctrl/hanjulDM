/**
 * 알림톡 검수 결과 담당자 알림 메시지 빌더 (hanjulDM 전용 발췌)
 *
 * 한줄AI 본진 utils/auto-notify-message.ts에서 알림톡 검수 영역 2 함수만 발췌.
 * hanjulDM isolation 룰 준수 — 본진 import X, 자체 박힘.
 *
 * 한줄AI 본진 자동 캠페인 빌더(buildAiGeneratedNotifyMessage/buildPreNotifyMessage/
 * buildSpamTestResultNotifyMessage)는 PHASE 0 정성 평가 이후 필요 시 별도 박기 (Phase B 영역 외).
 *
 * 정책:
 *   1) 본문에 EUC-KR 안전 문자만 사용 — ASCII 기호(=, -, [, ]) + 한글
 *   2) sanitizeSmsText()로 위험 문자(▼ ▲ ▶ ◀ ※ ★ ☆ ◆ ◇ → ← ↑ ↓ + 모든 이모지) 강제 치환
 *   3) IMC createAlarmUser 4032 권한 이슈 회피 — hanjulDM이 직접 SMS 발송
 */

// ════════════════════════════════════════════════════════════
// 알림톡 템플릿 검수 결과 알림 (한줄AI D135+ 패턴 미러)
// ════════════════════════════════════════════════════════════

export interface TemplateInspectionNotifyContext {
  templateName: string;
  profileName?: string | null;
  status: 'APPROVED' | 'REJECTED';
  rejectReason?: string | null;
}

/**
 * 알림톡 템플릿 검수 결과 알림 메시지 빌더.
 *
 * 배경:
 *   휴머스온 IMC `createAlarmUser` API가 인비토 API 키에 활성화되어 있지 않아 4032 에러로 거부됨.
 *   hanjulDM은 자체 SMS로 담당자에게 알림 발송.
 *
 * 출력 예시 (승인):
 *   [알림톡 템플릿 승인]
 *
 *   템플릿: 주문 완료 안내
 *   발신프로필: ABC마트
 *
 *   검수가 승인되었습니다. 이제 발송에 사용할 수 있습니다.
 *
 * 출력 예시 (반려):
 *   [알림톡 템플릿 반려]
 *
 *   템플릿: 주문 완료 안내
 *   발신프로필: ABC마트
 *
 *   반려 사유: 변수명 #{주문번호}에 공백 포함됨
 *
 *   관리자 페이지에서 내용을 수정한 뒤 재검수요청 해주세요.
 */
export function buildTemplateInspectionNotifyMessage(
  ctx: TemplateInspectionNotifyContext,
): string {
  const lines: string[] = [];
  const approved = ctx.status === 'APPROVED';
  lines.push(approved ? '[알림톡 템플릿 승인]' : '[알림톡 템플릿 반려]');
  lines.push('');
  lines.push(`템플릿: ${sanitizeSmsText(ctx.templateName)}`);
  if (ctx.profileName) {
    lines.push(`발신프로필: ${sanitizeSmsText(ctx.profileName)}`);
  }
  lines.push('');
  if (approved) {
    lines.push('검수가 승인되었습니다. 이제 발송에 사용할 수 있습니다.');
  } else {
    if (ctx.rejectReason) {
      lines.push(`반려 사유: ${sanitizeSmsText(ctx.rejectReason)}`);
      lines.push('');
    }
    lines.push('관리자 페이지에서 내용을 수정한 뒤 재검수요청 해주세요.');
  }
  return lines.join('\n');
}

/**
 * 위험 문자(dingbats/이모지)를 안전 문자로 치환한다.
 *
 * 차단 대상:
 *   - dingbats: ▼ ▲ ▶ ◀ ◇ ◆ ◈ ▣ ▤ ▥ ▦ ▧ ▨ ▩
 *   - 별표류: ★ ☆ ✦ ✧ ✩ ✪ ✫ ✬ ✭ ✮ ✯ ✰
 *   - 화살표: → ← ↑ ↓ ↔ ↕ ⇒ ⇐ ⇑ ⇓
 *   - 기타: ※ ⚠ ⚡ ⓘ ⓒ ⓡ ™
 *   - 이모지: U+1F300 ~ U+1FAFF, U+2600 ~ U+27BF
 *
 * 배경: 일부 단말에서 EUC-KR/KS5601 변환 시 '?'로 표시되는 문제 차단.
 */
export function sanitizeSmsText(text: string): string {
  if (!text) return '';
  return text
    // dingbats 사각/원형 도형
    .replace(/[▼▲▶◀◇◆◈▣▤▥▦▧▨▩□■◯●○◎◉]/g, '')
    // 별표류
    .replace(/[★☆✦✧✩✪✫✬✭✮✯✰]/g, '')
    // 화살표
    .replace(/[→←↑↓↔↕⇒⇐⇑⇓]/g, '')
    // 안내 기호
    .replace(/[※⚠⚡ⓘⓒⓡ™℃℉]/g, '')
    // 이모지 (Unicode 범위)
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')
    // 연속된 공백 정리
    .replace(/[ \t]+/g, ' ')
    .trim();
}
