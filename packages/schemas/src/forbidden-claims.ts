/**
 * 规格 §3 / §49 / §62 的红线：禁止虚构的事实类型与禁止承诺。
 * Phase 1 固化清单，Phase 14 的事实审核员基于此判定 RED。
 */
export const FORBIDDEN_FABRICATION_CATEGORIES = [
  "year",
  "tree_age",
  "mountain",
  "raw_material",
  "formula_ratio",
  "rnd_relationship",
  "brand_history",
  "transaction_price",
  "award",
  "output_volume",
  "master",
  "celebrity",
  "secret_recipe",
  "scarcity_quantity"
] as const;
export type ForbiddenFabricationCategory = (typeof FORBIDDEN_FABRICATION_CATEGORIES)[number];

export const FORBIDDEN_PROMISES = [
  "必涨",
  "稳赚",
  "保值",
  "固定投资回报",
  "未来达到某价格"
] as const;

/** 无 RND_CONFIRMED 证据时禁止的研发/对标表述（规格 §25） */
export const RND_RESTRICTED_PHRASES = [
  "复刻",
  "按照某款配方做",
  "同款配方",
  "原配方再现",
  "某大师配方",
  "经典秘方"
] as const;

/** 有 RND_CONFIRMED 证据时才允许的表述（规格 §25） */
export const RND_ALLOWED_PHRASES = [
  "研发阶段曾参考",
  "团队拆解过",
  "以……作为风格参考之一"
] as const;
