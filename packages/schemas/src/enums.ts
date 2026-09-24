import { z } from "zod";

/** 用户角色（Phase 1 Auth / RBAC） */
export const userRoles = ["ADMIN", "RESEARCHER", "COPYWRITER", "VIEWER"] as const;
export const userRoleSchema = z.enum(userRoles);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatuses = ["ACTIVE", "DISABLED"] as const;
export const userStatusSchema = z.enum(userStatuses);
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * 成交模式（规格 §4）。AUTO = 由锚点引擎自动判定（Phase 7），
 * 用户可在强成交页手动指定 BENCHMARK / CATEGORY_CREATOR。
 */
export const researchModes = ["AUTO", "BENCHMARK", "CATEGORY_CREATOR"] as const;
export const researchModeSchema = z.enum(researchModes);
export type ResearchMode = z.infer<typeof researchModeSchema>;

/** 已判定的研究模式（不含 AUTO） */
export const resolvedResearchModes = ["BENCHMARK", "CATEGORY_CREATOR"] as const;
export const resolvedResearchModeSchema = z.enum(resolvedResearchModes);
export type ResolvedResearchMode = z.infer<typeof resolvedResearchModeSchema>;

/** 文案强度（规格 §21） */
export const COPY_INTENSITY_LEVELS = {
  RESEARCH: 1,
  PROFESSIONAL: 2,
  STRONG: 3,
  VIRAL: 4,
  KING: 5
} as const;

export const copyIntensitySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5)
]);
export type CopyIntensity = z.infer<typeof copyIntensitySchema>;

/** “牛逼化”按钮选项（规格 §7）：普通 / 强势 / 爆款 / 王者 */
export const intensifyLevels = ["NORMAL", "STRONG", "VIRAL", "KING"] as const;
export const intensifyLevelSchema = z.enum(intensifyLevels);
export type IntensifyLevel = z.infer<typeof intensifyLevelSchema>;

export const INTENSIFY_LEVEL_TO_COPY_INTENSITY: Record<IntensifyLevel, CopyIntensity> = {
  NORMAL: 2,
  STRONG: 3,
  VIRAL: 4,
  KING: 5
};

export const DEFAULT_COPY_INTENSITY: CopyIntensity = 4;

/** 三层标记（规格 §24） */
export const claimTypes = ["FACT", "INTERPRETATION", "RHETORIC"] as const;
export const claimTypeSchema = z.enum(claimTypes);
export type ClaimType = z.infer<typeof claimTypeSchema>;

export const riskLevels = ["GREEN", "YELLOW", "RED"] as const;
export const riskLevelSchema = z.enum(riskLevels);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

/** 事实状态（规格 §11，含新增 RND_CONFIRMED） */
export const factStatuses = [
  "OFFICIAL_CONFIRMED",
  "INTERNAL_CONFIRMED",
  "TASTING_CONFIRMED",
  "RND_CONFIRMED",
  "SUPPLIER_PROVIDED",
  "UNCONFIRMED"
] as const;
export const factStatusSchema = z.enum(factStatuses);
export type FactStatus = z.infer<typeof factStatusSchema>;

/** 价格类型（规格 §14） */
export const priceTypes = [
  "OFFICIAL_RETAIL",
  "LISTING",
  "VERIFIED_TRANSACTION",
  "AUCTION_HAMMER",
  "HISTORICAL_REFERENCE",
  "UNKNOWN"
] as const;
export const priceTypeSchema = z.enum(priceTypes);
export type PriceType = z.infer<typeof priceTypeSchema>;

/** 三种锚点（规格 §16） */
export const anchorTypes = ["HIGHEST_VALUE", "SIMILARITY_HIGH_VALUE", "SALES_ANCHOR"] as const;
export const anchorTypeSchema = z.enum(anchorTypes);
export type AnchorType = z.infer<typeof anchorTypeSchema>;

/** 龙德记 Value Code 映射状态（规格 §19） */
export const valueCodeStatuses = [
  "ALREADY_HAVE",
  "PARTIAL",
  "TIME_DEPENDENT",
  "NOT_HAVE",
  "UNKNOWN"
] as const;
export const valueCodeStatusSchema = z.enum(valueCodeStatuses);
export type ValueCodeStatus = z.infer<typeof valueCodeStatusSchema>;

/** Value Codes 建议清单（规格 §18） */
export const valueCodeKeys = [
  "PEACOCK_IDENTITY",
  "CORE_ORIGIN",
  "PREMIUM_MATERIAL",
  "FORMULA_ARCHITECTURE",
  "SMOKY_SIGNATURE",
  "STRONG_BODY",
  "FAST_HUIGAN",
  "STRONG_SALIVATION",
  "CHA_QI",
  "SCARCITY",
  "AGE_VALUE",
  "BRAND_PREMIUM",
  "COLLECTION_RECOGNITION",
  "MARKET_LIQUIDITY",
  "STYLE_RECOGNITION",
  "CRAFT_VALUE"
] as const;
export const valueCodeKeySchema = z.enum(valueCodeKeys);
export type ValueCodeKey = z.infer<typeof valueCodeKeySchema>;

/** 研发参考类型（规格 §10.5 / §35.2） */
export const rndReferenceTypes = [
  "sensory",
  "formula_structure",
  "positioning",
  "concept",
  "other"
] as const;
export const rndReferenceTypeSchema = z.enum(rndReferenceTypes);
export type RndReferenceType = z.infer<typeof rndReferenceTypeSchema>;

/** 搜索策略查询类型（规格 §12 / Agent 2） */
export const searchQueryTypes = [
  "exact_queries",
  "concept_queries",
  "origin_queries",
  "flavor_queries",
  "taste_queries",
  "positioning_queries",
  "price_queries",
  "auction_queries",
  "transaction_queries"
] as const;
export const searchQueryTypeSchema = z.enum(searchQueryTypes);
export type SearchQueryType = z.infer<typeof searchQueryTypeSchema>;

/** Prompt Keys（规格 §50） */
export const promptKeys = [
  "FACT_NORMALIZER",
  "SEARCH_PLANNER",
  "WEB_EXTRACTOR",
  "COMPARABLE_REVIEWER",
  "VALUE_ANALYZER",
  "VALUE_MAPPER",
  "PRODUCT_ARCHITECT",
  "FORMULA_PHILOSOPHY",
  "SALES_COPYWRITER",
  "COPY_INTENSIFIER",
  "FACT_REVIEWER"
] as const;
export const promptKeySchema = z.enum(promptKeys);
export type PromptKey = z.infer<typeof promptKeySchema>;

/** 研究流水线阶段（规格 §55 / §56） */
export const researchStages = [
  "FACT_NORMALIZE",
  "VALUE_DNA",
  "PRODUCT_ARCHITECTURE_SEED",
  "SEARCH_PLAN",
  "WEB_SEARCH",
  "SOURCE_FETCH",
  "ENTITY_EXTRACT",
  "CANDIDATE_POOL",
  "SIMILARITY_SCORE",
  "PRICE_SEARCH",
  "PRICE_EVIDENCE",
  "OUTLIER_DETECTION",
  "ANCHOR_BUILD",
  "VALUE_CODES",
  "VALUE_MAPPING",
  "PRODUCT_ARCHITECTURE",
  "FORMULA_PHILOSOPHY",
  "SALES_COPY",
  "IMPACT_SCORE",
  "INTENSIFY",
  "FACT_REVIEW",
  "HUMAN_APPROVAL"
] as const;
export const researchStageSchema = z.enum(researchStages);
export type ResearchStage = z.infer<typeof researchStageSchema>;

export const researchJobStatuses = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "WAITING_APPROVAL"
] as const;
export const researchJobStatusSchema = z.enum(researchJobStatuses);
export type ResearchJobStatus = z.infer<typeof researchJobStatusSchema>;
