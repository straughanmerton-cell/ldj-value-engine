import { z } from "zod";
import { factStatusSchema, rndReferenceTypeSchema, type FactStatus } from "./enums.js";
import { RND_ALLOWED_PHRASES, RND_RESTRICTED_PHRASES } from "./forbidden-claims.js";

// 可选文本统一允许 null：CREATE 时 null 视同未提供，PATCH 时 null 表示显式清空。
const optionalText = z.string().trim().max(2000).nullable().optional();
const optionalShortText = z.string().trim().max(200).nullable().optional();

/**
 * 研发 / 对标声明规则（规格 §25）。
 * 只有 RND_CONFIRMED（研发记录 / 评审记录 / 配方实验 / 对标品饮）才允许
 * 「研发时曾参考 X」「团队拆解过 X」这类表述；其余状态一律不得声明研发关系。
 */
export const RND_CLAIM_EVIDENCE_STATUS: FactStatus = "RND_CONFIRMED";

export const RND_CLAIM_RULES = {
  evidence_status: RND_CLAIM_EVIDENCE_STATUS,
  allowed_phrases: RND_ALLOWED_PHRASES,
  restricted_phrases: RND_RESTRICTED_PHRASES
} as const;

export function rndReferenceAllowsClaims(verificationStatus: FactStatus): boolean {
  return verificationStatus === RND_CLAIM_EVIDENCE_STATUS;
}

/** 除 UNCONFIRMED 外，研发参考必须给出证据说明或证据来源（规格 §10.5「是否有内部研发证据」）。 */
export function rndReferenceEvidenceSatisfied(input: {
  verificationStatus: FactStatus;
  evidenceNote?: string | null;
  evidenceSourceId?: string | null;
}): boolean {
  if (input.verificationStatus === "UNCONFIRMED") {
    return true;
  }
  const note = input.evidenceNote?.trim() ?? "";
  return note.length > 0 || Boolean(input.evidenceSourceId);
}

/** 在文本中查找 §25 禁止的研发 / 对标表述，供 Phase 12/14 的文案生成与事实审核复用。 */
export function findRestrictedRndPhrases(text: string): string[] {
  return RND_RESTRICTED_PHRASES.filter((phrase) => text.includes(phrase));
}

/**
 * 判断一段文案能否声明研发 / 对标关系。
 * hasRndEvidence 为 false 时，只要出现 §25 禁止表述即判定不允许发布。
 */
export function checkRndClaimPermission(
  text: string,
  options: { hasRndEvidence: boolean }
): { allowed: boolean; blocked_phrases: string[] } {
  const blocked = findRestrictedRndPhrases(text);
  if (options.hasRndEvidence && blocked.length === 0) {
    return { allowed: true, blocked_phrases: [] };
  }
  return { allowed: false, blocked_phrases: blocked };
}

const RND_EVIDENCE_MESSAGE = "研发参考状态不是 UNCONFIRMED 时必须提供证据说明或证据来源";

const rndCore = {
  reference_product_id: z.string().uuid().nullable().optional(),
  reference_product_name: z.string().trim().min(1, "参考产品名称必填").max(200),
  reference_type: rndReferenceTypeSchema,
  description: z.string().trim().min(1, "参考说明必填").max(4000),
  verification_status: factStatusSchema,
  evidence_note: optionalText,
  evidence_source_id: z.string().uuid().nullable().optional()
};

function rndEvidenceRule(input: {
  verification_status: FactStatus;
  evidence_note?: string | null;
  evidence_source_id?: string | null;
}): boolean {
  return rndReferenceEvidenceSatisfied({
    verificationStatus: input.verification_status,
    evidenceNote: input.evidence_note,
    evidenceSourceId: input.evidence_source_id
  });
}

/** 新建研发参考（规格 §35.2）。未提供状态时按 UNCONFIRMED 存储。 */
export const createRndReferenceSchema = z
  .object({
    ...rndCore,
    verification_status: factStatusSchema.default("UNCONFIRMED")
  })
  .strict()
  .refine(rndEvidenceRule, { message: RND_EVIDENCE_MESSAGE, path: ["evidence_note"] });
export type CreateRndReferenceInput = z.infer<typeof createRndReferenceSchema>;

/** 更新研发参考：刻意不带默认值。 */
export const updateRndReferenceSchema = z.object(rndCore).partial().strict();
export type UpdateRndReferenceInput = z.infer<typeof updateRndReferenceSchema>;

export const rndReferenceListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  reference_type: rndReferenceTypeSchema.optional(),
  verification_status: factStatusSchema.optional()
});
export type RndReferenceListQuery = z.infer<typeof rndReferenceListQuerySchema>;

/** 研发参考只允许参考「名称」，不允许把参考产品的规格/价格等事实写进自有产品（规格 §62-5）。 */
export const RND_REFERENCE_FORBIDDEN_PAYLOAD_NOTE =
  "研发参考仅记录参考名称、参考类型与说明，参考产品的原料/价格/年份事实不得移植到本产品";
