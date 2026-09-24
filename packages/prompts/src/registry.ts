import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promptKeys, type PromptKey } from "@ldj/schemas";

export interface PromptDescriptor {
  key: PromptKey;
  /** 对应的 markdown 文件（相对仓库 prompts/ 目录） */
  file: string;
  /** 所属 Agent（规格 §38 的 11 个 Agent） */
  agent: string;
  version: string;
}

/**
 * Prompt 注册表（规格 §50）。Phase 1 使用文件版本；
 * Phase 3 引入 prompt_versions 表后，这里作为默认版本与回滚兜底。
 */
export const PROMPT_REGISTRY: Record<PromptKey, PromptDescriptor> = {
  FACT_NORMALIZER: { key: "FACT_NORMALIZER", file: "fact-normalizer.md", agent: "Agent 1｜产品事实整理器", version: "v1" },
  SEARCH_PLANNER: { key: "SEARCH_PLANNER", file: "search-planner.md", agent: "Agent 2｜搜索策略专家", version: "v1" },
  WEB_EXTRACTOR: { key: "WEB_EXTRACTOR", file: "webpage-extractor.md", agent: "Agent 3｜网页事实抽取器", version: "v1" },
  COMPARABLE_REVIEWER: { key: "COMPARABLE_REVIEWER", file: "comparable-reviewer.md", agent: "Agent 4｜对标产品评审员", version: "v1" },
  VALUE_ANALYZER: { key: "VALUE_ANALYZER", file: "value-analyzer.md", agent: "Agent 5｜高价值原因分析师", version: "v1" },
  VALUE_MAPPER: { key: "VALUE_MAPPER", file: "value-mapper.md", agent: "Agent 6｜龙德记价值映射专家", version: "v1" },
  PRODUCT_ARCHITECT: { key: "PRODUCT_ARCHITECT", file: "product-architect.md", agent: "Agent 7｜产品结构设计师", version: "v1" },
  FORMULA_PHILOSOPHY: { key: "FORMULA_PHILOSOPHY", file: "formula-philosophy.md", agent: "Agent 8｜配方哲学文案师", version: "v1" },
  SALES_COPYWRITER: { key: "SALES_COPYWRITER", file: "sales-copywriter.md", agent: "Agent 9｜首席成交文案总监", version: "v1" },
  COPY_INTENSIFIER: { key: "COPY_INTENSIFIER", file: "copy-intensifier.md", agent: "Agent 10｜牛逼化强化器", version: "v1" },
  FACT_REVIEWER: { key: "FACT_REVIEWER", file: "fact-reviewer.md", agent: "Agent 11｜事实审核员", version: "v1" }
};

export function promptsRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../prompts");
}

export function resolvePromptPath(key: PromptKey, root = promptsRoot()): string {
  return path.join(root, PROMPT_REGISTRY[key].file);
}

const cache = new Map<string, string>();

export function loadPrompt(key: PromptKey, root = promptsRoot()): string {
  const filePath = resolvePromptPath(key, root);
  const cached = cache.get(filePath);
  if (cached) {
    return cached;
  }
  const content = fs.readFileSync(filePath, "utf8");
  cache.set(filePath, content);
  return content;
}

export function listPrompts(): PromptDescriptor[] {
  return promptKeys.map((key) => PROMPT_REGISTRY[key]);
}
