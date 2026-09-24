import { pgEnum } from "drizzle-orm/pg-core";
import {
  factStatuses,
  priceTypes,
  productFactGroups,
  researchModes,
  researchJobStatuses,
  rndReferenceTypes,
  sourceFetchStatuses,
  sourceExtractionStatuses,
  sourceKinds,
  userRoles,
  userStatuses,
  valueCodeKeys,
  valueCodeStatuses,
  claimTypes,
  riskLevels,
  anchorTypes,
  promptKeys,
  similarityBands,
  candidateStatuses,
  priceEvidenceBands,
  marketOfferAttributions
} from "@ldj/schemas";
import { categoryCreatorTriggers, categoryReadinesses } from "@ldj/schemas";

export const userRoleEnum = pgEnum("user_role", userRoles);
export const userStatusEnum = pgEnum("user_status", userStatuses);

/** 产品上的成交模式偏好：AUTO / BENCHMARK / CATEGORY_CREATOR（规格 §4、§33） */
export const researchModeEnum = pgEnum("research_mode", researchModes);
/** 研究结果落库时的已判定模式 */
export const resolvedResearchModeEnum = pgEnum("resolved_research_mode", ["BENCHMARK", "CATEGORY_CREATOR"]);

export const claimTypeEnum = pgEnum("claim_type", claimTypes);
export const riskLevelEnum = pgEnum("risk_level", riskLevels);
export const factStatusEnum = pgEnum("fact_status", factStatuses);
export const productFactGroupEnum = pgEnum("product_fact_group", productFactGroups);
export const priceTypeEnum = pgEnum("price_type", priceTypes);
export const anchorTypeEnum = pgEnum("anchor_type", anchorTypes);
export const valueCodeKeyEnum = pgEnum("value_code_key", valueCodeKeys);
export const valueCodeStatusEnum = pgEnum("value_code_status", valueCodeStatuses);
export const rndReferenceTypeEnum = pgEnum("rnd_reference_type", rndReferenceTypes);
export const researchJobStatusEnum = pgEnum("research_job_status", researchJobStatuses);
/** Prompt 管理后台的 11 个 Prompt Key（规格 §50） */
export const promptKeyEnum = pgEnum("prompt_key", promptKeys);

/** 来源分类 / 抓取状态 / 抽取状态（规格 §41、§54 sources 表） */
export const sourceKindEnum = pgEnum("source_kind", sourceKinds);
export const sourceFetchStatusEnum = pgEnum("source_fetch_status", sourceFetchStatuses);
export const sourceExtractionStatusEnum = pgEnum("source_extraction_status", sourceExtractionStatuses);

/** 可比性分档（规格 §13）与候选池评审状态（规格 §36 comparable_candidates 表） */
export const similarityBandEnum = pgEnum("similarity_band", similarityBands);
export const candidateStatusEnum = pgEnum("candidate_status", candidateStatuses);

/** 价格证据分档（规格 §15）与价格归属（规格 §14 market_offers 表） */
export const priceEvidenceBandEnum = pgEnum("price_evidence_band", priceEvidenceBands);
export const marketOfferAttributionEnum = pgEnum("market_offer_attribution", marketOfferAttributions);

/** 自建高端标准模式（规格 §4.2 / §17 / §29） */
export const categoryCreatorTriggerEnum = pgEnum("category_creator_trigger", categoryCreatorTriggers);
export const categoryReadinessEnum = pgEnum("category_readiness", categoryReadinesses);

export const COPY_INTENSITY_MIN = 1;
export const COPY_INTENSITY_MAX = 5;
export type CopyIntensityValue = 1 | 2 | 3 | 4 | 5;
