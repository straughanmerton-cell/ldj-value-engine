import { z } from "zod";
import { SENSORY_FIELDS } from "./product-fields.js";

// 可选文本统一允许 null：CREATE 时 null 视同未提供，PATCH 时 null 表示显式清空。
const optionalShortText = z.string().trim().max(200).nullable().optional();
const optionalText = z.string().trim().max(2000).nullable().optional();

/** §10.4 二十项感官字段（可版本化的品饮记录逐项填写，未品饮到的项留空）。 */
const sensoryCore = Object.fromEntries(
  SENSORY_FIELDS.map((field) => [field.key, optionalShortText])
) as Record<(typeof SENSORY_FIELDS)[number]["key"], typeof optionalShortText>;

const tastingCore = {
  ...sensoryCore,
  taster_name: optionalShortText,
  tasted_at: z.coerce.date().nullable().optional(),
  conclusion: optionalText,
  evidence_source_id: z.string().uuid().nullable().optional()
};

const EMPTY_PROFILE_MESSAGE = "品饮档案至少需要一项感官记录或结论，避免产生空档案";

/** 是否存在任何实际品饮内容（防止空档案被当成「已品饮」）。 */
export function tastingProfileHasContent(input: Record<string, unknown>): boolean {
  return SENSORY_FIELDS.some((field) => {
    const value = input[field.key];
    return typeof value === "string" && value.trim().length > 0;
  }) || (typeof input.conclusion === "string" && input.conclusion.trim().length > 0);
}

export function tastingProfileHasTaster(input: Record<string, unknown>): boolean {
  return typeof input.taster_name === "string" && input.taster_name.trim().length > 0;
}

export const createTastingProfileSchema = z
  .object(tastingCore)
  .strict()
  .refine(tastingProfileHasContent, { message: EMPTY_PROFILE_MESSAGE, path: ["conclusion"] });
export type CreateTastingProfileInput = z.infer<typeof createTastingProfileSchema>;

/** 更新品饮档案：刻意不带默认值，避免 PATCH 未提交字段被静默重置。 */
export const updateTastingProfileSchema = z.object(tastingCore).partial().strict();
export type UpdateTastingProfileInput = z.infer<typeof updateTastingProfileSchema>;

export const tastingProfileListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  taster_name: z.string().trim().max(200).optional()
});
export type TastingProfileListQuery = z.infer<typeof tastingProfileListQuerySchema>;
