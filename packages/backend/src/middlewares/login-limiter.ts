/**
 * ★ 2026-10-27 로그인 · 비밀번호 확인 요청 제한 (매장 로그인 · 슈퍼관리자 로그인 · OTP 확인 · 비밀번호 변경)
 *
 * 옛 = 비밀번호를 맞히는 요청을 몇 번이든 받았다(무차별 대입 문이 열려 있음).
 * 같은 IP(req.ip = nginx 가 넘긴 X-Forwarded-For · app.ts trust proxy 'loopback') 기준 = 처리 중인 요청 + 1분 안 실패가 10을 넘으면 429.
 * 들어올 때 먼저 세고 성공(400 미만)으로 끝나면 뺀다 — 응답 전에 몰아 보내는 추측도 10건에서 막는다(끝난 실패만 세면 동시 요청은 한도 없이 통과).
 * 정상 사용자 영향 = 같은 IP 동시 11건째 하나가 429 · 처리 중 요청이 끝나면 바로 다시 통과. hanjuldm-api = fork 1개라 메모리 저장소로 충분하다.
 */
import rateLimit from 'express-rate-limit';

export const LOGIN_LIMIT_WINDOW_MS = 60_000;
export const LOGIN_LIMIT_MAX = 10;

export const loginLimiter = rateLimit({
  windowMs: LOGIN_LIMIT_WINDOW_MS,
  limit: LOGIN_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});
