import { and, desc, eq } from "drizzle-orm";
import type { Database, PromptVersion } from "@ldj/database";
import { promptVersions } from "@ldj/database";
import { loadPrompt, PROMPT_REGISTRY, listPrompts } from "@ldj/prompts";
import { extractJsonPayload, type AiProvider } from "@ldj/ai";
import {
  factNormalizerAiOutputSchema,
  PROMPT_MANAGEMENT_CAPABILITIES,
  PROMPT_MANAGEMENT_SPEC_REF,
  promptKeys,
  type CreatePromptVersionInput,
  type PromptKey,
  type PromptTestRunInput
} from "@ldj/schemas";
import { AppError } from "@ldj/shared";

/**
 * Prompt 管理后台（规格 §50）。
 *
 * 五项能力逐项落地：
 * - version：每次编辑都派生新版本，历史版本整行保留（§62-15）；
 * - active：启用某个版本；
 * - rollback：把 is_active 指回任一历史版本（与 active 同一动作）；
 * - edit：基于指定历史版本派生新内容；
 * - test run：只读当前启用版本试跑，不写任何业务数据。
 */

export interface PromptVersionShape {
  key: PromptKey;
  version: number;
  content: string;
  notes: string | null;
  is_active: boolean;
  based_on_version: number | null;
  created_by: string | null;
  created_at: string;
}

export interface PromptSummary {
  key: PromptKey;
  agent: string;
  file: string;
  spec_version: string;
  active_version: number | null;
  version_count: number;
  updated_at: string | null;
}

export interface PromptDetail extends PromptSummary {
  versions: PromptVersionShape[];
}

export interface ActivePromptContent {
  content: string;
  version: number | null;
  source: "DB" | "FILE";
}

/** Value DNA / 事实归一使用的 Prompt 取用接口（由本服务实现）。 */
export interface ActivePromptSource {
  getActiveContent(key: PromptKey): Promise<ActivePromptContent>;
}

export interface PromptTestRunResult {
  key: PromptKey;
  prompt_version: number | null;
  prompt_source: "DB" | "FILE";
  provider: string;
  model: string;
  output: string;
  schema_valid: boolean | null;
  test_run: true;
  persisted: false;
}

export class PromptManagerService implements ActivePromptSource {
  constructor(
    private readonly db: Database,
    private readonly ai: AiProvider
  ) {}

  async list(): Promise<{
    capabilities: typeof PROMPT_MANAGEMENT_CAPABILITIES;
    spec_ref: string;
    items: PromptSummary[];
  }> {
    await this.ensureSeeded();
    const rows = await this.db.select().from(promptVersions);
    const items = listPrompts().map((descriptor) => {
      const versions = rows.filter((row) => row.promptKey === descriptor.key);
      return summarize(descriptor.key, versions);
    });
    return {
      capabilities: PROMPT_MANAGEMENT_CAPABILITIES,
      spec_ref: PROMPT_MANAGEMENT_SPEC_REF,
      items
    };
  }

  async getByKey(key: PromptKey): Promise<PromptDetail> {
    await this.ensureSeeded([key]);
    const rows = await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptKey, key))
      .orderBy(desc(promptVersions.version));
    return {
      ...summarize(key, rows),
      versions: rows.map((row) => serializeVersion(row))
    };
  }

  async listVersions(key: PromptKey): Promise<PromptVersionShape[]> {
    return (await this.getByKey(key)).versions;
  }

  async createVersion(
    key: PromptKey,
    input: CreatePromptVersionInput,
    actorId: string
  ): Promise<PromptVersionShape> {
    await this.ensureSeeded([key]);
    const versions = await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptKey, key))
      .orderBy(desc(promptVersions.version));
    const active = versions.find((row) => row.isActive) ?? null;
    const basedOnVersion = input.based_on_version ?? active?.version ?? null;
    if (basedOnVersion !== null && !versions.some((row) => row.version === basedOnVersion)) {
      throw AppError.validation(`版本 ${basedOnVersion} 不存在，无法作为派生来源`, {
        prompt_key: key,
        based_on_version: basedOnVersion
      });
    }
    const nextVersion = (versions[0]?.version ?? 0) + 1;

    const inserted = await this.db
      .insert(promptVersions)
      .values({
        promptKey: key,
        version: nextVersion,
        content: input.content,
        notes: input.notes ?? null,
        isActive: false,
        basedOnVersion,
        createdBy: actorId
      })
      .returning();
    const row = inserted[0]!;

    if (input.activate) {
      await this.activate(key, { version: nextVersion });
      return { ...serializeVersion(row), is_active: true };
    }
    return serializeVersion(row);
  }

  async activate(key: PromptKey, input: { version: number }): Promise<PromptVersionShape> {
    await this.ensureSeeded([key]);
    const rows = await this.db
      .select()
      .from(promptVersions)
      .where(and(eq(promptVersions.promptKey, key), eq(promptVersions.version, input.version)))
      .limit(1);
    const target = rows[0];
    if (!target) {
      throw AppError.validation(`版本 ${input.version} 不存在，无法启用 / 回滚`, {
        prompt_key: key,
        version: input.version
      });
    }
    await this.db
      .update(promptVersions)
      .set({ isActive: false })
      .where(eq(promptVersions.promptKey, key));
    const updated = await this.db
      .update(promptVersions)
      .set({ isActive: true })
      .where(and(eq(promptVersions.promptKey, key), eq(promptVersions.version, input.version)))
      .returning();
    return serializeVersion(updated[0]!);
  }

  async getActiveContent(key: PromptKey): Promise<ActivePromptContent> {
    await this.ensureSeeded([key]);
    const rows = await this.db
      .select()
      .from(promptVersions)
      .where(and(eq(promptVersions.promptKey, key), eq(promptVersions.isActive, true)))
      .orderBy(desc(promptVersions.version))
      .limit(1);
    const active = rows[0];
    if (active) {
      return { content: active.content, version: active.version, source: "DB" };
    }
    // 兜底：库里没有任何启用版本时回退到仓库内文件版本（规格 §50 的种子版本）。
    return { content: loadPrompt(key), version: null, source: "FILE" };
  }

  async testRun(key: PromptKey, input: PromptTestRunInput): Promise<PromptTestRunResult> {
    const active = await this.getActiveContent(key);
    const system = applyVariables(active.content, input.variables);
    const result = await this.ai.generateText({
      messages: [
        { role: "system", content: system },
        { role: "user", content: input.input }
      ],
      temperature: input.temperature
    });

    let schemaValid: boolean | null = null;
    if (key === "FACT_NORMALIZER") {
      // 规格 §62-13：AI 输出必须经过 schema 校验；试跑时把校验结果一并返回，便于人工评估。
      try {
        schemaValid = factNormalizerAiOutputSchema.safeParse(extractJsonPayload(result.text)).success;
      } catch {
        schemaValid = false;
      }
    }

    return {
      key,
      prompt_version: active.version,
      prompt_source: active.source,
      provider: result.provider,
      model: result.model,
      output: result.text,
      schema_valid: schemaValid,
      test_run: true,
      persisted: false
    };
  }

  /** 首次访问时把 prompts/*.md 落成 version 1，保证「所有版本必须保留」有起点。 */
  private async ensureSeeded(keys: readonly PromptKey[] = promptKeys): Promise<void> {
    const existing = await this.db
      .select({ key: promptVersions.promptKey })
      .from(promptVersions);
    const seeded = new Set(existing.map((row) => row.key));
    const missing = keys.filter((key) => !seeded.has(key));
    if (missing.length === 0) {
      return;
    }
    await this.db
      .insert(promptVersions)
      .values(
        missing.map((key) => ({
          promptKey: key,
          version: 1,
          content: loadPrompt(key),
          notes: `初始版本：来自 prompts/${PROMPT_REGISTRY[key].file}（规格 §50）`,
          isActive: true,
          basedOnVersion: null,
          createdBy: null
        }))
      )
      .onConflictDoNothing();
  }
}

function summarize(key: PromptKey, rows: readonly PromptVersion[]): PromptSummary {
  const descriptor = PROMPT_REGISTRY[key];
  const active = rows.find((row) => row.isActive) ?? null;
  const latest = rows.reduce<PromptVersion | null>(
    (acc, row) => (acc === null || row.createdAt > acc.createdAt ? row : acc),
    null
  );
  return {
    key,
    agent: descriptor.agent,
    file: descriptor.file,
    spec_version: descriptor.version,
    active_version: active?.version ?? null,
    version_count: rows.length,
    updated_at: latest ? latest.createdAt.toISOString() : null
  };
}

function serializeVersion(row: PromptVersion): PromptVersionShape {
  return {
    key: row.promptKey,
    version: row.version,
    content: row.content,
    notes: row.notes,
    is_active: row.isActive,
    based_on_version: row.basedOnVersion,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString()
  };
}

function applyVariables(content: string, variables: Record<string, string>): string {
  let output = content;
  for (const [name, value] of Object.entries(variables)) {
    output = output.split(`{{${name}}}`).join(value);
  }
  return output;
}
