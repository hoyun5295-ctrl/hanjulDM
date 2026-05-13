/**
 * ★ CT-F (신규) — 시즌 토큰 자동 매핑 (한줄전단AI 모바일 6 엔진 전용)
 *
 * period_start + title 기반으로 SeasonToken 8종 중 1개 자동 선택.
 * matchingPriority: 키워드 매치 우선 → 날짜 매치 차순 → 모두 미매치 시 default.
 *
 * 사용:
 *   import { resolveSeasonToken, SEASON_TOKENS } from './season-resolver';
 *   const token = resolveSeasonToken(data.title, data.period);  // 'newyear' | 'chuseok' | ...
 *   renderXxxEngine(data, token);
 *
 * 음력 환산:
 *   설날/추석은 음력 기념일이라 양력 변환이 매년 다름.
 *   라이브러리 의존 0건 유지 위해 "양력 안전 범위 윈도우"로 처리.
 *   - newyear: 양력 1월 25일 ~ 2월 20일 (음력 1월 1일은 매년 양력 1.21~2.21 사이 변동, ±2일 안전 마진)
 *   - chuseok: 양력 9월 1일 ~ 10월 15일 (음력 8월 15일은 매년 양력 9.8~10.8 사이 변동)
 */

import seasonTokensJson from './season-tokens.json';

// ============================================================
// 타입
// ============================================================

export type SeasonToken =
  | 'default'
  | 'newyear'
  | 'chuseok'
  | 'christmas'
  | 'summer'
  | 'winter'
  | 'grand_open'
  | 'urgent';

export interface SeasonTokenInfo {
  label: string;
  primary: string;
  accent: string;
  onPrimary: string;
  note: string;
}

export const SEASON_TOKENS: Record<SeasonToken, SeasonTokenInfo> =
  seasonTokensJson.tokens as Record<SeasonToken, SeasonTokenInfo>;

// ============================================================
// 키워드 매핑 (위에서 아래로 우선순위)
// ============================================================

const KEYWORD_MAP: Array<{ token: SeasonToken; keywords: string[] }> = [
  // grand_open + urgent가 시즌보다 우선 (사장님이 명시한 행사 유형)
  { token: 'grand_open', keywords: ['개점', '오픈', '그랜드 오픈', '그랜드오픈', '재오픈', '1주년', '리뉴얼', '리뉴얼 오픈', '신장개업'] },
  { token: 'urgent',     keywords: ['타임세일', '타임 세일', '창고대방출', '창고 대방출', '마감 임박', '마감임박', '한정', '오늘만', '폭탄세일', '폭탄 세일', '깜짝 세일', '깜짝세일'] },
  // 명절 (음력)
  { token: 'newyear',    keywords: ['설날', '설 특선', '설 명절', '구정', '설맞이', '설 선물', '새해'] },
  { token: 'chuseok',    keywords: ['추석', '한가위', '추석 명절', '추석맞이', '추석 선물'] },
  // 시즌
  { token: 'christmas',  keywords: ['크리스마스', '성탄', 'x-mas', 'xmas', '산타', '메리 크리스마스', '연말', '송년'] },
  { token: 'summer',     keywords: ['여름', '시원', '쿨', '더위', '삼복', '복날', '여름 특가', '바캉스', '휴가'] },
  { token: 'winter',     keywords: ['겨울', '따뜻', '동지', '한파', '겨울 특가', '월동', '김장'] },
];

/**
 * title 또는 임의 텍스트에서 키워드 매칭.
 * 첫 번째 매치 토큰 반환. 미매치 시 null.
 * 대소문자 무관 + 공백 정규화.
 */
function matchKeyword(text: string | null | undefined): SeasonToken | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const { token, keywords } of KEYWORD_MAP) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return token;
    }
  }
  return null;
}

// ============================================================
// 날짜 매칭 (양력 안전 범위 윈도우)
// ============================================================

/**
 * period_start (YYYY-MM-DD) 기반 양력 날짜 매칭.
 * 음력 기념일은 양력 안전 범위로 근사.
 * 우선순위: christmas → newyear → chuseok → summer → winter → null.
 */
function matchDate(periodStart: string | null | undefined): SeasonToken | null {
  if (!periodStart) return null;
  const date = new Date(periodStart);
  if (isNaN(date.getTime())) return null;

  const month = date.getMonth() + 1; // 1~12
  const day = date.getDate();

  // christmas: 12월 1~31일 (연말 전체)
  if (month === 12) return 'christmas';

  // newyear: 양력 1월 25일 ~ 2월 20일 (음력 1월 1일 안전 범위)
  if (month === 1 && day >= 25) return 'newyear';
  if (month === 2 && day <= 20) return 'newyear';

  // chuseok: 양력 9월 1일 ~ 10월 15일 (음력 8월 15일 안전 범위)
  if (month === 9) return 'chuseok';
  if (month === 10 && day <= 15) return 'chuseok';

  // summer: 6~8월
  if (month >= 6 && month <= 8) return 'summer';

  // winter: 11월 전체 + 1월 1~24일 + 2월 21일 이후
  if (month === 11) return 'winter';
  if (month === 1 && day < 25) return 'winter';
  if (month === 2 && day > 20) return 'winter';

  // 3~5월, 10월 16~31일은 매치 없음 → default
  return null;
}

// ============================================================
// 진입점
// ============================================================

/**
 * ★ 단일 진입점. title + period_start로 SeasonToken 자동 매핑.
 *
 * 매칭 순서:
 *   1. title 키워드 매치 (KEYWORD_MAP 위에서 아래)
 *   2. period_start 양력 날짜 매치
 *   3. 모두 미매치 → 'default'
 *
 * @param title - 사장님이 입력한 행사명 (예: "5월 둘째 주 진짜 싸요", "추석 한가위 특선")
 * @param periodStart - 행사 시작일 YYYY-MM-DD 또는 null
 * @returns SeasonToken 8종 중 1개
 */
export function resolveSeasonToken(
  title: string | null | undefined,
  periodStart: string | null | undefined,
): SeasonToken {
  // 1. 키워드 매칭 (title 우선)
  const titleMatch = matchKeyword(title);
  if (titleMatch) return titleMatch;

  // 2. 날짜 매칭 (period_start)
  const dateMatch = matchDate(periodStart);
  if (dateMatch) return dateMatch;

  // 3. 디폴트
  return 'default';
}

/**
 * SeasonToken으로 토큰 정보 조회. 미존재 시 default 폴백.
 */
export function getSeasonTokenInfo(token: SeasonToken): SeasonTokenInfo {
  return SEASON_TOKENS[token] || SEASON_TOKENS.default;
}

/**
 * 토큰 키 유효성 검증.
 */
export function isValidSeasonToken(token: string): token is SeasonToken {
  return token in SEASON_TOKENS;
}
