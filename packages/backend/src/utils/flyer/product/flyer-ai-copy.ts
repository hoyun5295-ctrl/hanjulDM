/**
 * ★ 전단AI: AI 마케팅 문구 자동생성
 *
 * 상품별 조리법/효능/보관법/구매포인트 4종을 Claude/GPT로 자동 생성.
 * ai.ts의 callAIWithFallback() 재활용.
 */

import { callAIWithFallback } from '../../../services/ai';

// ============================================================
// 문구 유형 정의
// ============================================================

export type CopyType = 'recipe' | 'benefit' | 'storage' | 'selling_point';

const COPY_TYPE_LABELS: Record<CopyType, string> = {
  recipe: '조리 팁',
  benefit: '건강 효능',
  storage: '보관법',
  selling_point: '구매 포인트',
};

const COPY_PROMPTS: Record<CopyType, string> = {
  recipe: '다음 식품의 간단한 조리 팁을 40자 이내로 한 문장으로 작성해주세요. 마트 전단지에 넣을 용도입니다.',
  benefit: '다음 식품의 건강 효능이나 영양 정보를 40자 이내로 한 문장으로 작성해주세요.',
  storage: '다음 식품의 보관법을 40자 이내로 한 문장으로 작성해주세요.',
  selling_point: '다음 식품의 구매 매력 포인트를 40자 이내로 한 문장으로 작성해주세요. 마트 전단지 홍보 문구입니다.',
};

const SYSTEM_PROMPT = `당신은 마트 전단지 카피라이터입니다.
주부/가정 타겟으로 친근하고 간결하게 작성합니다.
이모지 1개를 문장 앞에 포함합니다.
반말 금지, 존댓말 사용. 40자 이내.
문구만 출력하세요. 따옴표, 설명, JSON 없이 순수 문구만.`;

// ============================================================
// 단일 상품 문구 생성
// ============================================================

export async function generateProductCopy(
  productName: string,
  category: string | null,
  copyType: CopyType
): Promise<string> {
  const prompt = COPY_PROMPTS[copyType];
  const categoryHint = category ? ` (카테고리: ${category})` : '';
  const userMessage = `${prompt}\n\n상품명: ${productName}${categoryHint}`;

  const result = await callAIWithFallback({
    system: SYSTEM_PROMPT,
    userMessage,
    maxTokens: 128,
    temperature: 0.8,
  });

  // 따옴표 제거 + 40자 제한
  let copy = result.trim().replace(/^["']|["']$/g, '');
  if (copy.length > 50) copy = copy.slice(0, 47) + '...';

  return copy;
}

// ============================================================
// 배치 문구 생성 (여러 상품 한번에)
// ============================================================

export async function generateBatchProductCopy(
  items: Array<{ name: string; category?: string }>,
  copyType: CopyType
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  const prompt = COPY_PROMPTS[copyType];
  const itemList = items.map((it, i) => `${i + 1}. ${it.name}${it.category ? ` (${it.category})` : ''}`).join('\n');

  const userMessage = `${prompt}\n\n다음 상품들에 대해 각각 한 줄씩 문구를 작성해주세요.\n번호. 문구 형식으로 출력하세요.\n\n${itemList}`;

  const result = await callAIWithFallback({
    system: SYSTEM_PROMPT,
    userMessage,
    maxTokens: 512,
    temperature: 0.8,
  });

  // 파싱: "1. 🍖 문구" 형식
  const map: Record<string, string> = {};
  const lines = result.trim().split('\n');
  for (const line of lines) {
    const m = line.match(/^(\d+)\.\s*(.+)/);
    if (m) {
      const idx = parseInt(m[1]) - 1;
      if (idx >= 0 && idx < items.length) {
        let copy = m[2].trim().replace(/^["']|["']$/g, '');
        if (copy.length > 50) copy = copy.slice(0, 47) + '...';
        map[items[idx].name] = copy;
      }
    }
  }

  return map;
}

// ============================================================
// ★ D154 PHASE 0 트랙 B — 통합 헬퍼 (categories 자동 enrich)
// ============================================================

/**
 * 카테고리 → 최적 CopyType 자동 매핑 (휴리스틱).
 * 청과/축산/수산 → recipe (조리 팁)
 * 공산/음료/생활용품/베이커리/간식 → selling_point (구매 포인트)
 * 냉동 → storage (보관법)
 * 유제품 → benefit (건강 효능)
 */
export function selectCopyTypeForCategory(category: string | null | undefined): CopyType {
  const c = (category || '').trim();
  const map: Record<string, CopyType> = {
    '청과/야채': 'recipe', '청과': 'recipe', '야채': 'recipe', '과일': 'recipe',
    '축산': 'recipe', '정육': 'recipe', '한우': 'recipe', '돈육': 'recipe',
    '수산': 'recipe',
    '냉동': 'storage',
    '유제품': 'benefit',
    '공산': 'selling_point', '공산품': 'selling_point',
    '음료/주류': 'selling_point', '음료': 'selling_point', '주류': 'selling_point',
    '생활용품': 'selling_point',
    '베이커리': 'selling_point', '빵': 'selling_point',
    '간식': 'selling_point',
  };
  return map[c] || 'selling_point';
}

interface EnrichItemInput {
  name: string;
  category?: string;
  aiCopy?: string;
}

interface EnrichCategoryInput {
  name: string;
  items: EnrichItemInput[];
}

/**
 * ★ FlyerRenderData.categories[] 일괄 AI 카피 자동 생성 (트랙 B 본진).
 *
 * 동작:
 *   1. 카테고리별로 그룹화 (같은 카테고리 = 같은 CopyType)
 *   2. aiCopy 미존재 상품만 추출 (이미 있으면 보존)
 *   3. generateBatchProductCopy()로 카테고리별 일괄 호출
 *   4. 결과를 items[].aiCopy에 mutate 박음
 *
 * 호출 비용: 카테고리 수만큼 callAIWithFallback (병렬 호출 X — rate-limit 안전).
 * 사장님 발행 시점에 1회 호출 권장 (매번 페이지 로드 호출 X).
 *
 * @param categories FlyerRenderData.categories — items에 aiCopy mutate
 * @param opts.skipExisting 이미 aiCopy 있는 상품 스킵 (디폴트 true)
 * @param opts.maxItemsPerBatch 1회 batch 최대 상품 수 (디폴트 10, API rate-limit 보호)
 * @returns enriched 카운트 + 실패 카운트
 */
export async function enrichCategoriesWithAiCopy(
  categories: EnrichCategoryInput[],
  opts?: { skipExisting?: boolean; maxItemsPerBatch?: number }
): Promise<{ enriched: number; failed: number; categoryCount: number }> {
  const skipExisting = opts?.skipExisting !== false;
  const batchSize = opts?.maxItemsPerBatch ?? 10;
  let enriched = 0;
  let failed = 0;

  for (const cat of categories) {
    const copyType = selectCopyTypeForCategory(cat.name);
    const targets = cat.items
      .filter(it => skipExisting ? !it.aiCopy : true)
      .filter(it => it.name && it.name.trim().length > 0);
    if (targets.length === 0) continue;

    // batch 분할 (API rate-limit 보호)
    for (let i = 0; i < targets.length; i += batchSize) {
      const slice = targets.slice(i, i + batchSize);
      try {
        const map = await generateBatchProductCopy(
          slice.map(it => ({ name: it.name, category: cat.name })),
          copyType
        );
        for (const it of slice) {
          const copy = map[it.name];
          if (copy && copy.length > 0) {
            it.aiCopy = copy;
            enriched++;
          } else {
            failed++;
          }
        }
      } catch (err: any) {
        console.error('[flyer-ai-copy] batch enrich 실패:', cat.name, err && err.message);
        failed += slice.length;
      }
    }
  }

  return { enriched, failed, categoryCount: categories.length };
}

export { COPY_TYPE_LABELS };
