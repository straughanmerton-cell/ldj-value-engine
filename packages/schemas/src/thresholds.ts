/**
 * 规格 §13 / §15 / §16 / §23 的核心阈值与权重。
 * Phase 1 只固化常量与规则（防止后续实现被“降阈值”“让价格参与相似度”等做法改写），
 * 具体计算在 Phase 5–8 实现，并按这些常量编写测试。
 */

/** §13 可比性评分权重（合计 100，价格不参与） */
export const SIMILARITY_WEIGHTS = {
  teaCategory: 18,
  concept: 18,
  origin: 15,
  material: 13,
  aroma: 10,
  taste: 8,
  positioning: 7,
  craft: 5,
  specification: 3,
  era: 3
} as const;

export const SIMILARITY_WEIGHT_TOTAL = Object.values(SIMILARITY_WEIGHTS).reduce((a, b) => a + b, 0);

/** §13 相似度分档 */
export const SIMILARITY_BANDS = {
  REJECT: 55,
  PERIPHERAL: 70,
  VALID_COMPARABLE: 85,
  CORE_COMPARABLE: 100
} as const;

/** §16.1 高价值锚点触发条件 */
export const ANCHOR_REQUIREMENTS = {
  minSimilarity: 70,
  minPriceEvidence: 75
} as const;

/** §15 Price Evidence Score 权重 */
export const PRICE_EVIDENCE_WEIGHTS = {
  natureClarity: 25,
  sourceCredibility: 25,
  productIdentity: 20,
  freshness: 15,
  crossSource: 15
} as const;

export const PRICE_EVIDENCE_BANDS = {
  WEAK: 60,
  USABLE: 75,
  STRONG: 100
} as const;

/** §16.3 Sales Anchor Score 权重 */
export const SALES_ANCHOR_WEIGHTS = {
  similarity: 0.3,
  priceLevel: 0.25,
  marketRecognition: 0.15,
  storyValue: 0.15,
  conceptRelevance: 0.1,
  evidence: 0.05
} as const;

/** §23 成交冲击力评分权重 */
export const IMPACT_SCORE_WEIGHTS = {
  hook: 15,
  productIdentity: 15,
  highValueSense: 20,
  priceOrStandardAnchor: 15,
  differentiation: 10,
  imagery: 10,
  memoryPoint: 10,
  closing: 5
} as const;

export const IMPACT_SCORE_TOTAL = Object.values(IMPACT_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

export const IMPACT_SCORE_BANDS = {
  REWRITE_BELOW: 70,
  USABLE: 80,
  EXCELLENT: 90
} as const;

/** §23 / §22 各强度等级的最低冲击力要求 */
export const MIN_IMPACT_SCORE_BY_INTENSITY: Record<number, number> = {
  4: 85,
  5: 90
};

/** §22 Level 5 强制写作要求 */
export const LEVEL5_REQUIREMENTS = {
  minQuotableLines: 3,
  requiresRhetoricalQuestion: true,
  requiresIdentityDefinition: true,
  requiresProductArchitectureStory: true,
  requiresStyleIdentity: true,
  requiresClosing: true,
  allowPriceStoryOnlyWithEvidence: true
} as const;

/** §34 “再狠一点”自动增强上限 */
export const MAX_AUTO_INTENSIFY_ROUNDS = 3;
