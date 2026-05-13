/**
 * 알림톡 템플릿 타입/한글 라벨 컨트롤타워 (hanjulDM admin-frontend)
 *
 * 한줄AI 본진 packages/frontend/src/components/alimtalk/alimtalk-types.ts 100% 미러.
 * IMC 매뉴얼 정합 — 인라인 라벨 정의 금지, 본 파일이 유일한 진실의 원천.
 */

export type MsgType = 'BA' | 'EX' | 'AD' | 'MI';
export type EmphType = 'NONE' | 'TEXT' | 'IMAGE' | 'ITEM_LIST';

export const MSG_TYPES: { value: MsgType; label: string; desc: string }[] = [
  { value: 'BA', label: '기본형',       desc: '본문만' },
  { value: 'EX', label: '부가 정보형',  desc: '본문 + 부가정보' },
  { value: 'AD', label: '채널 추가형',  desc: '본문 + 채널 추가 버튼' },
  { value: 'MI', label: '복합형',       desc: '본문 + 부가정보 + 채널 추가' },
];

export const EMPH_TYPES: { value: EmphType; label: string }[] = [
  { value: 'NONE',      label: '사용안함' },
  { value: 'TEXT',      label: '강조 표기형' },
  { value: 'IMAGE',     label: '이미지형' },
  { value: 'ITEM_LIST', label: '아이템리스트형' },
];

export function getMsgTypeLabel(value: string): string {
  return MSG_TYPES.find((t) => t.value === value)?.label || value;
}

export function getEmphTypeLabel(value: string): string {
  return EMPH_TYPES.find((t) => t.value === value)?.label || value;
}

export function formatTemplateType(messageType: string, emphasizeType: string): string {
  const m = getMsgTypeLabel(messageType);
  if (!emphasizeType || emphasizeType === 'NONE') return m;
  const e = getEmphTypeLabel(emphasizeType);
  return `${m}·${e}`;
}

// 검수 상태 라벨 (IMC 6단계 + 한줄AI 풀네임)
export type InspectionStatus =
  | 'DRAFT'
  | 'REG' | 'REQ' | 'REV' | 'KREQ' | 'HREJ' | 'KREJ' | 'APR'
  | 'REQUESTED' | 'REVIEWING' | 'APPROVED' | 'REJECTED'
  | 'BLOCKED' | 'DORMANT' | 'DELETED';

export const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  DRAFT:      { label: '초안',         cls: 'bg-gray-100 text-gray-600' },
  REG:        { label: '등록',         cls: 'bg-gray-100 text-gray-700' },
  REQ:        { label: '검수요청',     cls: 'bg-blue-100 text-blue-700' },
  REV:        { label: '검수중',       cls: 'bg-blue-100 text-blue-700' },
  KREQ:       { label: '카카오 검수중', cls: 'bg-indigo-100 text-indigo-700' },
  HREJ:       { label: '내부 반려',    cls: 'bg-orange-100 text-orange-700' },
  KREJ:       { label: '카카오 반려',  cls: 'bg-red-100 text-red-700' },
  APR:        { label: '승인',         cls: 'bg-green-100 text-green-700' },
  REQUESTED:  { label: '검수요청',     cls: 'bg-blue-100 text-blue-700' },
  REVIEWING:  { label: '검수중',       cls: 'bg-blue-100 text-blue-700' },
  APPROVED:   { label: '승인',         cls: 'bg-green-100 text-green-700' },
  REJECTED:   { label: '반려',         cls: 'bg-red-100 text-red-700' },
  BLOCKED:    { label: '차단',         cls: 'bg-red-100 text-red-700' },
  DORMANT:    { label: '휴면',         cls: 'bg-amber-100 text-amber-700' },
  DELETED:    { label: '삭제됨',       cls: 'bg-gray-200 text-gray-500' },
};

export function getStatusLabel(status: string): { label: string; cls: string } {
  return STATUS_LABELS[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
}

// 발신프로필 상태 라벨
export const PROFILE_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING:  { label: '대기',     cls: 'bg-gray-100 text-gray-600' },
  NORMAL:   { label: '정상',     cls: 'bg-emerald-100 text-emerald-700' },
  DORMANT:  { label: '휴면',     cls: 'bg-amber-100 text-amber-700' },
  BLOCKED:  { label: '차단',     cls: 'bg-red-100 text-red-700' },
  DELETED:  { label: '삭제됨',   cls: 'bg-gray-200 text-gray-500' },
};

export function getProfileStatusLabel(status: string): { label: string; cls: string } {
  return PROFILE_STATUS_LABELS[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
}

// 버튼 타입
export type ButtonType = 'WL' | 'AL' | 'DS' | 'BK' | 'MD' | 'BF' | 'BC' | 'AC' | 'PD';

export const BUTTON_TYPE_LABELS: Record<ButtonType, string> = {
  WL: '웹링크',
  AL: '앱링크',
  DS: '배송조회',
  BK: '봇키워드',
  MD: '메시지전달',
  BF: '비즈폼',
  BC: '상담톡전환',
  AC: '채널추가',
  PD: '상품링크',
};
