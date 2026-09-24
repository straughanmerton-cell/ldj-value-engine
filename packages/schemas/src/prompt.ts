import { z } from "zod";
import { promptKeySchema } from "./enums.js";

/**
 * Prompt 管理后台契约（规格 §50）。
 *
 * §50 明确要求 11 个 Prompt Key 支持：version / active / rollback / edit / test run。
 * 这里的常量把五项能力锁定为可自检清单，任何一项被裁剪都会在测试中暴露。
 * 另按 §62-15「所有版本必须保留」，编辑不会改写历史版本，
 * 而是从选定版本派生出一个新版本（based_on_version）。
 */

export const PROMPT_MANAGEMENT_CAPABILITIES = ["version", "active", "rollback", "edit", "test_run"] as const;
export type PromptManagementCapability = (typeof PROMPT_MANAGEMENT_CAPABILITIES)[number];

export const PROMPT_CONTENT_MAX_LENGTH = 40_000;

/** 新建版本 / 编辑（派生新版本）。 */
export const createPromptVersionSchema = z
  .object({
    content: z.string().min(1, "Prompt 内容必填").max(PROMPT_CONTENT_MAX_LENGTH),
    /** 从哪个历史版本派生（edit 能力）；不传表示基于当前启用版本。 */
    based_on_version: z.number().int().positive().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    /** 创建后是否立即启用该版本（active 能力），默认启用。 */
    activate: z.boolean().default(true)
  })
  .strict();
export type CreatePromptVersionInput = z.infer<typeof createPromptVersionSchema>;

/** 启用 / 回滚到指定版本。 */
export const activatePromptVersionSchema = z
  .object({
    version: z.number().int().positive()
  })
  .strict();
export type ActivatePromptVersionInput = z.infer<typeof activatePromptVersionSchema>;

/** 试跑：只读取当前启用版本，不写任何业务数据。 */
export const promptTestRunSchema = z
  .object({
    input: z.string().trim().min(1, "试跑输入必填").max(8000),
    variables: z.record(z.string(), z.string()).default({}),
    temperature: z.number().min(0).max(2).optional()
  })
  .strict();
export type PromptTestRunInput = z.infer<typeof promptTestRunSchema>;

export const promptKeyParamSchema = z.object({ key: promptKeySchema });

export const PROMPT_MANAGEMENT_SPEC_REF = "§50" as const;
