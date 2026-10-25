/**
 * ★ CT-F 1025 — 전단 AI 호출(Claude → GPT 폴백) 단일 소유.
 * 17번 설계 §6-1: services/ai.ts(한줄로 복사본 · 한줄로 customers 등 조회 포함)에서 이 함수만 원본 복사로 떼어 냈다.
 * 전단 코드의 AI 호출은 전부 여기를 쓴다(직접 fetch 금지).
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AI_MODELS } from '../../../config/defaults';

if (!process.env.ANTHROPIC_API_KEY) console.warn('[AI] ANTHROPIC_API_KEY not configured — Claude AI 기능 비활성 상태');
if (!process.env.OPENAI_API_KEY) console.warn('[AI] OPENAI_API_KEY not configured — OpenAI 기능 비활성 상태');

// ★ 1025: 클라이언트는 첫 호출 때 만든다 — OpenAI SDK는 키가 비면 생성자에서 throw 해
//   이 파일을 import 하는 라우트(엑셀 업로드)까지 부팅 시 함께 죽는다.
let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;
const anthropicClient = () => (_anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' }));
const openaiClient = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' }));

// ============================================================
// AI 호출 (Claude → gpt-5.1 자동 fallback)
// ============================================================
export async function callAIWithFallback(params: {
  system: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  // 1차: Claude Sonnet
  try {
    const response = await anthropicClient().messages.create({
      model: AI_MODELS.claude,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      system: params.system,
      messages: [{ role: 'user', content: params.userMessage }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    console.log('[AI] Claude 호출 성공');
    return text;
  } catch (claudeError: any) {
    console.warn(`[AI] Claude 실패 (${claudeError.status || claudeError.message}) → gpt-5.1 fallback`);
  }

  // 2차: gpt-5.1 fallback
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Claude 실패 + OPENAI_API_KEY 미설정');
  }

  try {
    const gptResponse = await openaiClient().chat.completions.create({
      model: AI_MODELS.gpt,
      max_completion_tokens: params.maxTokens,
      temperature: params.temperature,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.userMessage },
      ],
    });
    const text = gptResponse.choices[0]?.message?.content || '';
    console.log('[AI] gpt-5.1 fallback 성공');
    return text;
  } catch (gptError: any) {
    console.error(`[AI] gpt-5.1도 실패 (${gptError.message})`);
    throw new Error('AI 서비스 일시 장애 (Claude + GPT 모두 실패)');
  }
}
