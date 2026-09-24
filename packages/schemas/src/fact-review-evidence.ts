import { z } from "zod";

/**
 * Phase 14｜证据行（规格 §24 / §46 / §53）。
 *
 * §53 要求逐句给出 `Evidence` 列。这条 Evidence 只能是**机械逐字回查**的结果：
 * 本产品已录入字段 / Value DNA / 上游成稿正文 / 研发记录里逐字命中，才允许登记为一条证据。
 * AI（Agent 11）不得新增、改写或删除证据行——它只能加严风险等级（§62-14）。
 *
 * 这一份口径被两处复用，因此单独成文件：
 * 1. `packages/schemas/src/fact-review.ts` 的 `factReviewEvidenceOf()`（从 citations 拆行）；
 * 2. 数据库 `claim_evidence` 表（一行一条证据，与 `generated_claims` 的句子行一一挂接）。
 */
export const factEvidenceKinds = ["PRODUCT_FACT", "VALUE_DNA", "UPSTREAM_COPY", "RND_REFERENCE"] as const;
export const factEvidenceKindSchema = z.enum(factEvidenceKinds);
export type FactEvidenceKind = z.infer<typeof factEvidenceKindSchema>;

/** 落库后的证据行视图（`claim_evidence` 表）。 */
export const factEvidenceSchema = z
  .object({
    id: z.string().uuid(),
    /** 挂在哪一句审核结论上（`generated_claims.id`） */
    claim_id: z.string().uuid(),
    /** 来源字段路径，例如 `product.mountain` / `dna.origin` */
    source_ref: z.string().trim().min(1),
    /** 可选的上游记录 id（产品事实行 / 成稿行）；产品字段本身没有独立行时为 null */
    source_id: z.string().uuid().nullable(),
    /** 逐字出处 */
    excerpt: z.string().trim().min(1),
    evidence_kind: factEvidenceKindSchema,
    /** 是否能在本产品自己的资料里逐字点回（false 的证据不得用来支撑 FACT 句） */
    traceable: z.boolean(),
    created_at: z.string()
  })
  .strict();
export type FactEvidence = z.infer<typeof factEvidenceSchema>;
