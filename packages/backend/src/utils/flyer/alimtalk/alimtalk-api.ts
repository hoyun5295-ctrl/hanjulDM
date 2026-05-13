/**
 * CT-F16: 휴머스온 IMC 관리 API 호출 컨트롤타워 (hanjulDM 전용)
 *
 * 한줄AI 본진 utils/alimtalk-api.ts (CT-16) 100% 미러.
 * hanjulDM isolation 룰 준수 — 본진 import X, 자체 박힘.
 * DB 의존 0건 (IMC API 호출 + snake_case 정규화 + 이중 래핑 unwrap만).
 *
 * 담당: 관리 API (발신프로필 / 알림톡·브랜드 템플릿 / 알림수신자 / 카테고리 / 이미지 업로드)
 * **발송 API는 담당하지 않는다** — 발송은 utils/flyer/send 영역 + QTmsg Agent 경유.
 *
 * Phase 0 대응:
 *   - 환경변수(IMC_API_KEY / IMC_BASE_URL_*) 미설정 시에도 서버 부팅 가능.
 *   - 최초 API 호출 시점에 Lazy init하면서 env 누락을 명확한 에러로 표출.
 *
 * 한줄AI 본진과의 IMC 키 공간 공유:
 *   - 같은 IMC API 키 사용. senderKey/templateCode는 IMC 서버 단위 공간 = 충돌 0.
 *   - 한줄AI 회사가 등록한 senderKey와 hanjulDM 매장이 등록한 senderKey는 IMC 서버에서 같은 공간.
 *   - DB 영역만 분리 (flyer_kakao_* vs kakao_*).
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';

// ════════════════════════════════════════════════════════════
// 공통 타입
// ════════════════════════════════════════════════════════════

export interface ImcResponse<T = any> {
  code: string;
  message: string;
  data?: T;
}

export class ImcApiError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    public responseBody: any,
    message: string,
  ) {
    super(`[IMC ${code}] ${message}`);
    this.name = 'ImcApiError';
  }
}

// ════════════════════════════════════════════════════════════
// 환경별 클라이언트 (Lazy init)
// ════════════════════════════════════════════════════════════

let _client: AxiosInstance | null = null;
let _apiKey: string | null = null;

function resolveBaseURL(): string {
  const env = process.env.IMC_ENV || 'STG';
  const url =
    env === 'PRD' ? process.env.IMC_BASE_URL_PRD : process.env.IMC_BASE_URL_STG;
  if (!url) {
    throw new Error(
      `[IMC] 환경변수가 설정되지 않았습니다 — IMC_BASE_URL_${env}=? .env 확인 필요`,
    );
  }
  return url.replace(/\/$/, '');
}

function resolveApiKey(): string {
  const env = process.env.IMC_ENV || 'STG';
  const key =
    env === 'PRD' ? process.env.IMC_API_KEY : process.env.IMC_API_KEY_SANDBOX;
  if (!key) {
    throw new Error(
      `[IMC] 환경변수가 설정되지 않았습니다 — IMC_API_KEY${env === 'PRD' ? '' : '_SANDBOX'}=? .env 확인 필요`,
    );
  }
  return key;
}

function getClient(): AxiosInstance {
  if (_client) return _client;

  const baseURL = resolveBaseURL();
  _apiKey = resolveApiKey();

  _client = axios.create({
    baseURL,
    headers: {
      'x-imc-api-key': _apiKey,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });

  _client.interceptors.response.use(
    (res) => res,
    (err: AxiosError<any>) => {
      const code = (err.response?.data as any)?.code || 'UNKNOWN';
      const message = (err.response?.data as any)?.message || err.message;
      throw new ImcApiError(
        String(code),
        err.response?.status || 500,
        err.response?.data,
        message,
      );
    },
  );

  return _client;
}

/** 외부에서 명시적으로 reset하고 싶을 때 (env 교체 후 재초기화용) */
export function resetImcClient(): void {
  _client = null;
  _apiKey = null;
}

function getApiKey(): string {
  if (_apiKey) return _apiKey;
  getClient();
  return _apiKey!;
}

// ════════════════════════════════════════════════════════════
// 발신프로필 (Sender) — 11개
// ════════════════════════════════════════════════════════════

export interface SenderTokenRequest {
  yellowId: string;
  phoneNumber: string;
}

export interface SenderCreateRequest {
  token: string;
  yellowId: string;
  phoneNumber: string;
  categoryCode: string;
  topSenderKeyYn?: 'Y' | 'N';
  // D131: customSenderKey 폐지 — IMC가 자동 발급
}

/**
 * SenderData — IMC 실 응답 필드 (11_04_55, 11_05_12 스펙 대조 완료 D131).
 */
export interface SenderData {
  senderKey: string;
  uuid?: string;                // IMC: 플러스친구 채널 ID (DB yellow_id에 대응)
  name?: string;                // 채널 이름
  status: string;               // 프로필 상태 (A:정상, S, D:삭제)
  profileStatus?: string;       // 플러스친구 상태 (A/C/B/E/D)
  phoneNumber?: string;
  categoryCode?: string;
  category?: string;            // 업종 구분 코드 (0~9자)
  customSenderKey?: string;
  topSenderKey?: string;
  topSenderKeyYn?: 'Y' | 'N';
  alimtalk?: boolean;
  brandMessage?: boolean;
  bizchat?: boolean;
  brandtalk?: boolean;
  block?: boolean;
  dormant?: boolean;
  businessProfile?: boolean;
  businessType?: string | null;
  channelKey?: string | null;
  commitalCompanyName?: string | null;
  unsubscribePhoneNumber?: string;
  unsubscribeAuthNumber?: string;
  marketingAgreeFileUrl?: string;
  registeredAt?: string;
  updatedAt?: string;
  createdAt?: string;
  modifiedAt?: string;
  yellowId?: string;
  [key: string]: any;
}

export async function requestSenderToken(
  body: SenderTokenRequest,
): Promise<ImcResponse> {
  const res = await getClient().post('/kakao-management/api/v1/sender/token', body);
  return res.data;
}

export async function createSender(
  body: SenderCreateRequest,
): Promise<ImcResponse<SenderData>> {
  const res = await getClient().post('/kakao-management/api/v1/sender', body);
  return res.data;
}

/**
 * 발신프로필 목록 조회 — IMC 공식 파라미터 (11_04_55_발신프로필 목록 조회.txt 대조 D131)
 */
export async function listSenders(
  params: {
    name?: string;
    profileStatus?: string;
    senderKey?: string;
    status?: string;
    uuid?: string;
    customSenderKey?: string;
    block?: boolean;
    dormant?: boolean;
    alimtalk?: boolean;
    brandMessage?: boolean;
    category?: string;
    categoryCode?: string;
    page?: number;
    size?: number;
  } = {},
): Promise<ImcResponse<{ list: SenderData[]; total?: number }>> {
  const res = await getClient().get('/kakao-management/api/v1/sender', { params });
  return res.data;
}

export async function getSender(
  senderKey: string,
): Promise<ImcResponse<SenderData>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}`,
  );
  return res.data;
}

export async function updateSenderUnsubscribe(
  senderKey: string,
  body: { unsubscribePhoneNumber: string; unsubscribeAuthNumber: string },
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/unsubscribe`,
    body,
  );
  return res.data;
}

export async function updateCustomSenderKey(
  senderKey: string,
  customSenderKey: string,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/custom-sender-key`,
    { customSenderKey },
  );
  return res.data;
}

export async function releaseSenderDormant(
  senderKey: string,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/release`,
  );
  return res.data;
}

export async function checkBrandTargeting(
  senderKey: string,
): Promise<ImcResponse<{ available: boolean }>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/check`,
  );
  return res.data;
}

export async function applyBrandTargeting(
  senderKey: string,
  body: any,
): Promise<ImcResponse> {
  const res = await getClient().post(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message`,
    body,
  );
  return res.data;
}

// ── 발신프로필 카테고리 (3단 트리)
export interface CategoryNode {
  code: string;
  parentCode?: string;
  level: 1 | 2 | 3;
  name: string;
}

export async function listSenderCategories(): Promise<
  ImcResponse<CategoryNode[]>
> {
  const res = await getClient().get('/kakao-management/api/v1/sender/category');
  return res.data;
}

export async function getSenderCategory(
  categoryCode: string,
): Promise<ImcResponse<CategoryNode>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/category/${categoryCode}`,
  );
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 알림톡 템플릿 — 13개
// ════════════════════════════════════════════════════════════

export type AlimtalkMessageType = 'BA' | 'EX' | 'AD' | 'MI';
export type AlimtalkEmphasizeType = 'NONE' | 'TEXT' | 'IMAGE' | 'ITEM_LIST';

export type AlimtalkButtonType =
  | 'WL'
  | 'AL'
  | 'DS'
  | 'BK'
  | 'MD'
  | 'BF'
  | 'BC'
  | 'AC'
  | 'PD';

export interface AlimtalkButton {
  name: string;
  type: AlimtalkButtonType;
  urlMobile?: string;
  urlPc?: string;
  schemeAndroid?: string;
  schemeIos?: string;
  target?: 'out' | 'in';
  chatExtra?: string;
  chatEvent?: string;
  bizFormId?: number;
  pluginId?: string;
  relayId?: string;
  oneclickId?: string;
  productId?: string;
  telNumber?: string;
  mapAddress?: string;
  mapCoordinates?: string;
}

export type AlimtalkQuickReplyType = 'WL' | 'AL' | 'BK' | 'MD' | 'BF';

export interface AlimtalkQuickReply {
  name: string;
  type: AlimtalkQuickReplyType;
  urlMobile?: string;
  urlPc?: string;
  schemeAndroid?: string;
  schemeIos?: string;
  chatExtra?: string;
  chatEvent?: string;
  bizFormId?: number;
}

export interface AlimtalkItemHighlight {
  title: string;
  description: string;
  imageUrl?: string;
}

export interface AlimtalkItemListEntry {
  title: string;
  description: string;
}

export interface AlimtalkItemSummary {
  title: string;
  description: string;
}

export interface AlimtalkItem {
  list: AlimtalkItemListEntry[];
  summary?: AlimtalkItemSummary;
}

export interface AlimtalkRepresentLink {
  urlMobile?: string;
  urlPc?: string;
  schemeAndroid?: string;
  schemeIos?: string;
}

export interface AlimtalkTemplateCreateRequest {
  templateKey: string;
  manageName: string;
  customTemplateCode?: string;
  serviceMode?: 'PRD' | 'STG';
  templateMessageType: AlimtalkMessageType;
  templateEmphasizeType: AlimtalkEmphasizeType;
  templateContent: string;
  templatePreviewMessage?: string;
  templateExtra?: string;
  templateImageName?: string;
  templateImageUrl?: string;
  templateTitle?: string;
  templateSubtitle?: string;
  templateHeader?: string;
  templateItemHighlight?: AlimtalkItemHighlight;
  templateItem?: AlimtalkItem;
  templateRepresentLink?: AlimtalkRepresentLink;
  categoryCode: string;
  securityFlag?: boolean;
  buttonList?: AlimtalkButton[];
  quickReplyList?: AlimtalkQuickReply[];
  alarmPhoneNumber?: string;
}

export interface AlimtalkTemplateData extends AlimtalkTemplateCreateRequest {
  templateCode: string;
  status: string;
  reviewedAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

/**
 * 버튼/퀵리플라이 필드명 camelCase → snake_case 변환 (IMC 문서 규약).
 * Frontend ButtonEditor/QuickReplyEditor는 camelCase 타입을 쓰므로 IMC 전송 직전에 변환.
 * 이미 snake_case가 세팅된 필드는 그대로 유지(idempotent).
 *
 * IMC 실 스펙 (10_57_49_문자 관리.txt).
 */
function toImcButton(b: any): any {
  if (!b || typeof b !== 'object') return b;
  const pick = <K extends string>(camel: K, snake: string) =>
    b[snake] !== undefined ? b[snake] : b[camel];
  const out: Record<string, any> = {};
  if (b.name !== undefined) out.name = b.name;
  if (b.type !== undefined) out.type = b.type;
  const map: Array<[string, string]> = [
    ['urlMobile', 'url_mobile'],
    ['urlPc', 'url_pc'],
    ['schemeAndroid', 'scheme_android'],
    ['schemeIos', 'scheme_ios'],
    ['chatExtra', 'chat_extra'],
    ['chatEvent', 'chat_event'],
    ['bizFormId', 'biz_form_id'],
    ['pluginId', 'plugin_id'],
    ['relayId', 'relay_id'],
    ['oneclickId', 'oneclick_id'],
    ['productId', 'product_id'],
    ['telNumber', 'tel_number'],
    ['mapAddress', 'map_address'],
    ['mapCoordinates', 'map_coordinates'],
  ];
  for (const [camel, snake] of map) {
    const v = pick(camel, snake);
    if (v !== undefined && v !== null && v !== '') out[snake] = v;
  }
  if (b.target !== undefined) out.target = b.target;
  return out;
}

/** IMC 전송 직전 body 정규화: buttonList/quickReplyList 각 항목을 snake_case 변환 */
function normalizeTemplateBodyForImc<T extends Record<string, any>>(body: T): T {
  const out: any = { ...body };
  if (Array.isArray(body.buttonList)) {
    out.buttonList = body.buttonList.map(toImcButton);
  }
  if (Array.isArray(body.quickReplyList)) {
    out.quickReplyList = body.quickReplyList.map(toImcButton);
  }
  // ★ D148: templateRepresentLink IMC snake_case 변환 (한줄AI D135부터 D148까지 누적 fix).
  if (out.templateRepresentLink && typeof out.templateRepresentLink === 'object') {
    out.templateRepresentLink = toImcRepresentLink(out.templateRepresentLink);
  }
  return out as T;
}

/**
 * ★ D148: templateRepresentLink camelCase → snake_case 변환.
 *   IMC 매뉴얼 응답 명세: { url_mobile, url_pc, scheme_android, scheme_ios }.
 */
function toImcRepresentLink(rl: any): any {
  if (!rl || typeof rl !== 'object') return rl;
  const pick = (camel: string, snake: string) =>
    rl[snake] !== undefined ? rl[snake] : rl[camel];
  const out: any = {};
  const map: Array<[string, string]> = [
    ['urlMobile', 'url_mobile'],
    ['urlPc', 'url_pc'],
    ['schemeAndroid', 'scheme_android'],
    ['schemeIos', 'scheme_ios'],
  ];
  for (const [c, s] of map) {
    const v = pick(c, s);
    if (v !== undefined && v !== null && v !== '') out[s] = v;
  }
  return out;
}

export async function createAlimtalkTemplate(
  senderKey: string,
  body: AlimtalkTemplateCreateRequest,
): Promise<ImcResponse<{ templateCode: string }>> {
  const normalized = normalizeTemplateBodyForImc(body);
  try {
    console.log(
      `[flyer-alimtalk][createTemplate] senderKey=${senderKey} payload=${JSON.stringify(normalized).slice(0, 2000)}`,
    );
    const repLink = (normalized as any).templateRepresentLink;
    if (repLink && typeof repLink === 'object') {
      console.log(
        `[flyer-alimtalk][createTemplate] templateRepresentLink 포함 | ${JSON.stringify(repLink)}`,
      );
    } else {
      console.log(
        `[flyer-alimtalk][createTemplate] templateRepresentLink 없음`,
      );
    }
  } catch {
    /* noop */
  }
  const res = await getClient().post(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template`,
    normalized,
  );
  // D131: IMC 이중 래핑 unwrap.
  const data: any = res.data;
  try {
    console.log(
      `[flyer-alimtalk][createTemplate] response=${JSON.stringify(data).slice(0, 1500)}`,
    );
    const respRepLink = data?.data?.templateRepresentLink ?? data?.templateRepresentLink;
    if (respRepLink) {
      console.log(
        `[flyer-alimtalk][createTemplate] IMC 응답 templateRepresentLink 확인됨 | ${JSON.stringify(respRepLink)}`,
      );
    } else if ((normalized as any).templateRepresentLink) {
      console.warn(
        `[flyer-alimtalk][createTemplate] 페이로드 templateRepresentLink 있으나 응답 누락 — IMC 측 처리 확인 필요`,
      );
    }
  } catch {
    /* noop */
  }
  if (data && data.data && typeof data.data === 'object' && !data.data.templateCode
      && data.data.data && typeof data.data.data === 'object' && data.data.data.templateCode) {
    data.data = data.data.data;
  }
  return data;
}

export async function updateAlimtalkTemplate(
  senderKey: string,
  templateCode: string,
  body: Partial<AlimtalkTemplateCreateRequest>,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`,
    normalizeTemplateBodyForImc(body as any),
  );
  return res.data;
}

export async function getAlimtalkTemplate(
  senderKey: string,
  templateCode: string,
): Promise<ImcResponse<AlimtalkTemplateData>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`,
  );
  return res.data;
}

export async function listAlimtalkTemplates(
  params: {
    page?: number;
    count?: number;
    templateName?: string;
    status?: string;
  } = {},
): Promise<ImcResponse<{ list: AlimtalkTemplateData[]; total?: number }>> {
  const res = await getClient().get(
    '/kakao-management/api/v1/alimtalk/template/list',
    { params },
  );
  return res.data;
}

export async function getRecentlyModifiedAlimtalkTemplates(
  params: { since?: string; page?: number; count?: number } = {},
): Promise<ImcResponse<{ list: AlimtalkTemplateData[] }>> {
  const res = await getClient().get(
    '/kakao-management/api/v1/alimtalk/template/last-modified',
    { params },
  );
  return res.data;
}

export async function deleteAlimtalkTemplate(
  senderKey: string,
  templateCode: string,
): Promise<ImcResponse> {
  const res = await getClient().delete(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`,
  );
  return res.data;
}

export async function requestInspection(
  senderKey: string,
  templateCode: string,
  comment?: string,
): Promise<ImcResponse> {
  const res = await getClient().post(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment`,
    { comment },
  );
  return res.data;
}

export async function requestInspectionWithFile(
  senderKey: string,
  templateCode: string,
  comment: string,
  fileBuffer: Buffer,
  fileName: string,
  mimetype?: string,
): Promise<ImcResponse> {
  // ★ D149-#B: multipart 첨부 + Content-Length 명시.
  const form = new FormData();
  form.append('comment', comment);
  form.append('attachment', fileBuffer, {
    filename: toAsciiSafeFilename(fileName),
    contentType: mimetype || guessMimeFromFilename(fileName),
    knownLength: fileBuffer.length,
  });
  const formLength = await new Promise<number>((resolve, reject) =>
    form.getLength((err, length) => (err ? reject(err) : resolve(length))),
  );
  console.log(
    `[flyer-alimtalk][requestInspectionWithFile] templateKey=${templateCode} fileSize=${fileBuffer.length} formLength=${formLength} mimetype=${mimetype || 'auto'} filename=${fileName} commentLen=${(comment || '').length}`,
  );
  const res = await getClient().post(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment/file`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        'Content-Length': String(formLength),
        'x-imc-api-key': getApiKey(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
  );
  console.log(
    `[flyer-alimtalk][requestInspectionWithFile] IMC response code=${res.data?.code} message=${res.data?.message || ''} dataKeys=${res.data?.data ? Object.keys(res.data.data).join(',') : 'null'}`,
  );
  return res.data;
}

// ★ D149-#B: 파일명 확장자 → MIME type 추정.
function guessMimeFromFilename(filename: string): string {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    pdf: 'application/pdf',
    hwp: 'application/x-hwp',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

// ★ D151+: IMC 전송 시 한글/특수문자 파일명 → ASCII-safe 강제.
function toAsciiSafeFilename(filename: string): string {
  if (/^[A-Za-z0-9._-]+$/.test(filename)) return filename;
  const ext = (filename.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ext && ext.length <= 5 ? ext : 'bin';
  return `evidence_${Date.now()}.${safeExt}`;
}

/**
 * ★ D149-#B: IMC 측에 저장된 검수 코멘트 첨부파일을 binary로 다운로드.
 */
export async function getAlimtalkCommentFile(
  senderKey: string,
  templateCode: string,
): Promise<{ buffer: Buffer; contentType: string; size: number }> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment/file`,
    {
      headers: { 'x-imc-api-key': getApiKey() },
      responseType: 'arraybuffer',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
  );
  const buffer = Buffer.from(res.data);
  // axios 응답 헤더 타입 유니온(string | number | true | string[] | AxiosHeaders) — string 단언으로 안전 좁히기.
  const ct = res.headers['content-type'];
  return {
    buffer,
    contentType: typeof ct === 'string' && ct ? ct : 'application/octet-stream',
    size: buffer.length,
  };
}

export async function cancelInspection(
  senderKey: string,
  templateCode: string,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment/cancel`,
  );
  return res.data;
}

export async function releaseTemplateDormant(
  senderKey: string,
  templateCode: string,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/release`,
  );
  return res.data;
}

export async function updateCustomCode(
  senderKey: string,
  templateCode: string,
  customTemplateCode: string,
): Promise<ImcResponse> {
  const res = await getClient().patch(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/custom-code`,
    { customTemplateCode },
  );
  return res.data;
}

export async function updateExposure(
  senderKey: string,
  templateCode: string,
  showYn: 'Y' | 'N',
): Promise<ImcResponse> {
  const res = await getClient().patch(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/show-yn`,
    { showYn },
  );
  return res.data;
}

export async function updateServiceMode(
  senderKey: string,
  templateCode: string,
  mode: 'PRD' | 'STG',
): Promise<ImcResponse> {
  const res = await getClient().patch(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/service-mode`,
    { serviceMode: mode },
  );
  return res.data;
}

// ────────────────────────────────────────────────────────────
// 알림톡 템플릿 이력 (D150-2)
// ────────────────────────────────────────────────────────────

export interface TemplateHistoryChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
  truncated: boolean;
  complex: boolean;
}

export interface AlimtalkHistoryItem {
  histId: number;
  changeType: 'CREATE' | 'DELETE' | 'INSPECTION' | 'STATUS' | 'UPDATE';
  inspectionStatus?: 'REG' | 'REQ' | 'HREJ' | 'KREQ' | 'KREJ' | 'APR';
  templateStatus?: 'S' | 'A' | 'R';
  modifiedAt: string;
  modifiedBy: string;
  changedCount: number;
  changes: TemplateHistoryChange[];
}

export interface AlimtalkHistoryListData {
  templateKey: string;
  totalCount: number;
  histories: AlimtalkHistoryItem[];
}

export interface AlimtalkHistoryDetailData {
  histId: number;
  changeType: 'CREATE' | 'DELETE' | 'INSPECTION' | 'STATUS' | 'UPDATE';
  changes: TemplateHistoryChange[];
  modifiedAt: string;
  modifiedBy: string;
  [key: string]: any;
}

export async function getAlimtalkTemplateHistory(
  senderKey: string,
  templateCode: string,
): Promise<ImcResponse<AlimtalkHistoryListData>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/history`,
  );
  return res.data;
}

export async function getAlimtalkTemplateHistoryDetail(
  senderKey: string,
  templateCode: string,
  histId: number | string,
): Promise<ImcResponse<AlimtalkHistoryDetailData>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/history/${histId}`,
  );
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 알림톡 검수 알림 수신자 — 4개
// ════════════════════════════════════════════════════════════

export interface AlarmUser {
  alarmUserKey: string;
  name: string;
  phoneNumber: string;
  activeYn: 'Y' | 'N';
}

export async function listAlarmUsers(
  params: {
    name?: string;
    phoneNumber?: string;
    activeYn?: 'Y' | 'N';
    page?: number;
    count?: number;
  } = {},
): Promise<ImcResponse<{ list: AlarmUser[]; total?: number }>> {
  const res = await getClient().get(
    '/kakao-management/api/v1/alimtalk/template/alarm-users',
    { params },
  );
  return res.data;
}

export async function createAlarmUser(
  body: AlarmUser,
): Promise<ImcResponse<AlarmUser>> {
  const res = await getClient().post(
    '/kakao-management/api/v1/alimtalk/template/alarm-users',
    body,
  );
  return res.data;
}

export async function updateAlarmUser(
  alarmUserKey: string,
  body: Omit<Partial<AlarmUser>, 'alarmUserKey'>,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/alimtalk/template/alarm-users/${alarmUserKey}`,
    body,
  );
  return res.data;
}

export async function deleteAlarmUser(
  alarmUserKey: string,
): Promise<ImcResponse> {
  const res = await getClient().delete(
    `/kakao-management/api/v1/alimtalk/template/alarm-users/${alarmUserKey}`,
  );
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 브랜드메시지 템플릿 — 5개 (검수 없음, 즉시 ACTIVE)
// ════════════════════════════════════════════════════════════

export type ChatBubbleType =
  | 'TEXT'
  | 'IMAGE'
  | 'WIDE'
  | 'WIDE_ITEM_LIST'
  | 'CAROUSEL_FEED'
  | 'PREMIUM_VIDEO'
  | 'COMMERCE'
  | 'CAROUSEL_COMMERCE';

export interface BrandAttachmentImage {
  imgUrl: string;
  imgLink?: string;
}

export interface BrandAttachmentVideo {
  videoUrl: string;
  thumbnailUrl?: string;
}

export interface BrandAttachmentCommerce {
  title: string;
  regularPrice?: string;
  discountRate?: string;
  discountPrice?: string;
  [key: string]: any;
}

export interface BrandAttachmentItem {
  list: { title: string; description?: string; imageUrl?: string }[];
}

export interface BrandAttachment {
  image?: BrandAttachmentImage;
  video?: BrandAttachmentVideo;
  commerce?: BrandAttachmentCommerce;
  item?: BrandAttachmentItem;
}

export interface BrandCarouselEntry {
  title: string;
  description?: string;
  imageUrl?: string;
  [key: string]: any;
}

export interface BrandCarousel {
  head?: any;
  list: BrandCarouselEntry[];
  tail?: any;
}

export interface BrandMessageTemplateRequest {
  templateKey: string;
  customTemplateCode?: string;
  manageName: string;
  chatBubbleType: ChatBubbleType;
  adult?: 'Y' | 'N';
  header?: string;
  content?: string;
  additionalContent?: string;
  attachment?: BrandAttachment;
  carousel?: BrandCarousel;
  buttons?: AlimtalkButton[];
  coupon?: any;
}

export async function createBrandTemplate(
  senderKey: string,
  body: BrandMessageTemplateRequest,
): Promise<ImcResponse<{ templateKey: string }>> {
  const res = await getClient().post(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/template`,
    body,
  );
  return res.data;
}

export async function updateBrandBasicTemplate(
  senderKey: string,
  body: Partial<BrandMessageTemplateRequest>,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/template`,
    body,
  );
  return res.data;
}

export async function getBrandTemplate(
  senderKey: string,
  templateKey: string,
): Promise<ImcResponse<any>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/template/${templateKey}`,
  );
  return res.data;
}

export async function listBrandTemplates(
  params: { senderKey?: string; page?: number; count?: number } = {},
): Promise<ImcResponse<{ list: any[] }>> {
  const res = await getClient().get(
    '/kakao-management/api/v1/brand-message/template/list',
    { params },
  );
  return res.data;
}

export async function deleteBrandTemplate(
  senderKey: string,
  templateKey: string,
): Promise<ImcResponse> {
  const res = await getClient().delete(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/template/${templateKey}`,
  );
  return res.data;
}

// ────────────────────────────────────────────────────────────
// 브랜드메시지 템플릿 이력 (D150-2)
// ────────────────────────────────────────────────────────────

export interface BrandHistoryItem {
  histId: number;
  changeType: 'CREATE' | 'DELETE' | 'STATUS' | 'UPDATE';
  status?: 'A' | 'S';
  modifiedAt: string;
  modifiedBy: string;
  changedCount: number;
  changes: TemplateHistoryChange[];
}

export interface BrandHistoryListData {
  templateKey: string;
  totalCount: number;
  histories: BrandHistoryItem[];
}

export interface BrandHistoryDetailData {
  histId: number;
  changeType: 'CREATE' | 'DELETE' | 'STATUS' | 'UPDATE';
  changes: TemplateHistoryChange[];
  modifiedAt: string;
  modifiedBy: string;
  [key: string]: any;
}

export async function getBrandTemplateHistory(
  senderKey: string,
  templateKey: string,
): Promise<ImcResponse<BrandHistoryListData>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/template/${templateKey}/history`,
  );
  return res.data;
}

export async function getBrandTemplateHistoryDetail(
  senderKey: string,
  templateKey: string,
  histId: number | string,
): Promise<ImcResponse<BrandHistoryDetailData>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/template/${templateKey}/history/${histId}`,
  );
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 이미지 업로드 — 9개
// ════════════════════════════════════════════════════════════

export interface ImageUploadResult {
  imageName: string;
  imageUrl: string;
}

async function uploadSingleImage(
  endpoint: string,
  fileBuffer: Buffer,
  fileName: string,
  mimetype?: string,
): Promise<ImcResponse<ImageUploadResult>> {
  // ★ D150: Content-Length 명시 + contentType 명시 (D149-#B 패턴 미러).
  const form = new FormData();
  form.append('image', fileBuffer, {
    filename: toAsciiSafeFilename(fileName),
    contentType: mimetype || guessMimeFromFilename(fileName),
    knownLength: fileBuffer.length,
  });
  const formLength = await new Promise<number>((resolve, reject) =>
    form.getLength((err, length) => (err ? reject(err) : resolve(length))),
  );
  const res = await getClient().post(endpoint, form, {
    headers: {
      ...form.getHeaders(),
      'Content-Length': String(formLength),
      'x-imc-api-key': getApiKey(),
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  const data: any = res.data;
  // ★ D142+ E: IMC 이중 래핑 unwrap.
  if (
    data && data.data && typeof data.data === 'object' && !data.data.imageUrl
    && data.data.data && typeof data.data.data === 'object' && data.data.data.imageUrl
  ) {
    console.log(`[flyer-alimtalk][uploadImage] 이중 래핑 unwrap: ${endpoint}`);
    data.data = data.data.data;
  }
  try {
    console.log(
      `[flyer-alimtalk][uploadImage] ${endpoint} code=${data?.code} hasImageUrl=${!!data?.data?.imageUrl} hasImageName=${!!data?.data?.imageName} rawSnippet=${JSON.stringify(data).slice(0, 500)}`,
    );
  } catch { /* noop */ }
  return data;
}

async function uploadMultipleImages(
  endpoint: string,
  files: { buffer: Buffer; name: string; mimetype?: string }[],
  fieldName = 'images',
): Promise<ImcResponse<{ list: ImageUploadResult[] }>> {
  const form = new FormData();
  for (const f of files) {
    form.append(fieldName, f.buffer, {
      filename: toAsciiSafeFilename(f.name),
      contentType: f.mimetype || guessMimeFromFilename(f.name),
      knownLength: f.buffer.length,
    });
  }
  const formLength = await new Promise<number>((resolve, reject) =>
    form.getLength((err, length) => (err ? reject(err) : resolve(length))),
  );
  const res = await getClient().post(endpoint, form, {
    headers: {
      ...form.getHeaders(),
      'Content-Length': String(formLength),
      'x-imc-api-key': getApiKey(),
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  const data: any = res.data;
  if (
    data && data.data && typeof data.data === 'object' && !Array.isArray(data.data.list)
    && data.data.data && typeof data.data.data === 'object' && Array.isArray(data.data.data.list)
  ) {
    console.log(`[flyer-alimtalk][uploadImage(multi)] 이중 래핑 unwrap: ${endpoint}`);
    data.data = data.data.data;
  }
  try {
    console.log(
      `[flyer-alimtalk][uploadImage(multi)] ${endpoint} code=${data?.code} listCount=${data?.data?.list?.length || 0}`,
    );
  } catch { /* noop */ }
  return data;
}

// 알림톡용 (2개)
export const uploadAlimtalkTemplateImage = (buf: Buffer, name: string) =>
  uploadSingleImage(
    '/kakao-management/api/v1/attach/alimtalk/template',
    buf,
    name,
  );

export const uploadAlimtalkHighlightImage = (buf: Buffer, name: string) =>
  uploadSingleImage(
    '/kakao-management/api/v1/attach/alimtalk/item-highlight',
    buf,
    name,
  );

// 브랜드메시지용 (6개)
export const uploadBrandDefaultImage = (buf: Buffer, name: string) =>
  uploadSingleImage(
    '/kakao-management/api/v1/attach/brand-message/default',
    buf,
    name,
  );

export const uploadBrandWideImage = (buf: Buffer, name: string) =>
  uploadSingleImage(
    '/kakao-management/api/v1/attach/brand-message/wide',
    buf,
    name,
  );

export const uploadBrandWideListFirstImage = (buf: Buffer, name: string) =>
  uploadSingleImage(
    '/kakao-management/api/v1/attach/brand-message/wide-list/first',
    buf,
    name,
  );

export const uploadBrandWideListImages = (
  files: { buffer: Buffer; name: string }[],
) =>
  uploadMultipleImages(
    '/kakao-management/api/v1/attach/brand-message/wide-list',
    files,
  );

export const uploadBrandCarouselFeedImages = (
  files: { buffer: Buffer; name: string }[],
) =>
  uploadMultipleImages(
    '/kakao-management/api/v1/attach/brand-message/carousel-feed',
    files,
  );

export const uploadBrandCarouselCommerceImages = (
  files: { buffer: Buffer; name: string }[],
) =>
  uploadMultipleImages(
    '/kakao-management/api/v1/attach/brand-message/carousel-commerce',
    files,
  );

// 마케팅 동의 증적자료 (발신프로필 단위, 1개)
export const uploadMarketingAgreeFile = (
  senderKey: string,
  buf: Buffer,
  name: string,
) =>
  uploadSingleImage(
    `/kakao-management/api/v1/attach/marketing-agree/${senderKey}`,
    buf,
    name,
  );

// ════════════════════════════════════════════════════════════
// 템플릿 카테고리 — 2개 (알림톡 templateCategoryCode 6자리)
// ════════════════════════════════════════════════════════════

export interface TemplateCategoryItem {
  code: string;
  name: string;
  groupName?: string;
  inclusion?: string;
  exclusion?: string;
}

export async function listTemplateCategories(): Promise<
  ImcResponse<TemplateCategoryItem[]>
> {
  const res = await getClient().get('/kakao-management/api/v1/template/category');
  return res.data;
}

export async function getTemplateCategory(
  categoryCode: string,
): Promise<ImcResponse<TemplateCategoryItem>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/template/category/${categoryCode}`,
  );
  return res.data;
}
