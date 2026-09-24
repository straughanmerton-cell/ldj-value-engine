import { z } from "zod";
import { factStatusSchema, type FactStatus } from "./enums.js";
import { productFactGroups, resolveFactGroup } from "./product-fields.js";

// 可选文本统一允许 null：CREATE 时 null 视同未提供，PATCH 时 null 表示显式清空。
const optionalText = z.string().trim().max(2000).nullable().optional();
const optionalShortText = z.string().trim().max(200).nullable().optional();

export const productFactGroupSchema = z.enum(productFactGroups);

/** 全部事实状态（除 UNCONFIRMED 外）都必须在录入时给出证据指向（规格 §11 / §62-15）。 */
const FACT_STATUSES_REQUIRING_EVIDENCE: readonly FactStatus[] = [
  "OFFICIAL_CONFIRMED",
  "INTERNAL_CONFIRMED",
  "TASTING_CONFIRMED",
  "RND_CONFIRMED",
  "SUPPLIER_PROVIDED"
];

/** 官方确认属于品牌对外口径，只有 ADMIN 可以判定（保守假设，可随产品方治理规则调整）。 */
const FACT_STATUSES_ADMIN_ONLY: readonly FactStatus[] = ["OFFICIAL_CONFIRMED"];

export function factStatusRequiresEvidence(status: FactStatus): boolean {
  return FACT_STATUSES_REQUIRING_EVIDENCE.includes(status);
}

export function factStatusRequiresAdmin(status: FactStatus): boolean {
  return FACT_STATUSES_ADMIN_ONLY.includes(status);
}

/**
 * 证据校验（规格 §62-15：未确认即不编造）。
 * 只要状态不是 UNCONFIRMED，就必须有证据说明文字或证据来源 ID 之一。
 */
export function factEvidenceSatisfied(input: {
  factStatus: FactStatus;
  evidenceNote?: string | null;
  evidenceSourceId?: string | null;
}): boolean {
  if (!factStatusRequiresEvidence(input.factStatus)) {
    return true;
  }
  const note = input.evidenceNote?.trim() ?? "";
  return note.length > 0 || Boolean(input.evidenceSourceId);
}

const factCore = {
  fact_key: z.string().trim().min(1, "事实键必填").max(100),
  fact_label: optionalShortText,
  fact_group: productFactGroupSchema.optional(),
  fact_value: z.string().trim().min(1, "事实内容必填").max(4000),
  fact_status: factStatusSchema,
  evidence_note: optionalText,
  evidence_source_id: z.string().uuid().nullable().optional()
};

const EVIDENCE_RULE_MESSAGE = "事实状态不是 UNCONFIRMED 时必须提供证据说明或证据来源";

function evidenceRule(input: {
  fact_status: FactStatus;
  evidence_note?: string | null;
  evidence_source_id?: string | null;
}): boolean {
  return factEvidenceSatisfied({
    factStatus: input.fact_status,
    evidenceNote: input.evidence_note,
    evidenceSourceId: input.evidence_source_id
  });
}

/** 新建事实（未提供状态时按 UNCONFIRMED 存储，不猜测确认状态）。 */
export const createProductFactSchema = z
  .object({
    ...factCore,
    fact_status: factStatusSchema.default("UNCONFIRMED")
  })
  .strict()
  .refine(evidenceRule, { message: EVIDENCE_RULE_MESSAGE, path: ["evidence_note"] });
export type CreateProductFactInput = z.infer<typeof createProductFactSchema>;

/** 更新事实：刻意不带默认值，避免 PATCH 未提交字段被静默重置。 */
export const updateProductFactSchema = z
  .object({
    ...factCore
  })
  .partial()
  .strict();
export type UpdateProductFactInput = z.infer<typeof updateProductFactSchema>;

export const productFactListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  fact_status: factStatusSchema.optional(),
  fact_group: productFactGroupSchema.optional(),
  fact_key: z.string().trim().max(100).optional()
});
export type ProductFactListQuery = z.infer<typeof productFactListQuerySchema>;

/** 由事实键推导分组，供录入界面与 API 复用。 */
export function resolveProductFactGroup(factKeyValue: string): string {
  return resolveFactGroup(factKeyValue);
}
