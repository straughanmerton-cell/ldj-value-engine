import { z } from "zod";

export const createBrandSchema = z
  .object({
    name: z.string().trim().min(1, "品牌名称必填").max(120),
    description: z.string().trim().max(2000).optional()
  })
  .strict();

export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const updateBrandSchema = createBrandSchema.partial().strict();
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
