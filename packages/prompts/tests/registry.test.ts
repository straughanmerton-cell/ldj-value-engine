import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { listPrompts, loadPrompt, promptsRoot, resolvePromptPath } from "../src/index.js";

describe("Prompt 注册表（规格 §50）", () => {
  it("11 个 Prompt Key 全部注册且文件存在", () => {
    const prompts = listPrompts();
    expect(prompts).toHaveLength(11);
    for (const prompt of prompts) {
      const filePath = resolvePromptPath(prompt.key);
      expect(fs.existsSync(filePath), `${prompt.file} 不存在`).toBe(true);
      expect(loadPrompt(prompt.key).length).toBeGreaterThan(200);
    }
  });

  it("Prompt 目录位于仓库 prompts/ 下", () => {
    expect(promptsRoot().replace(/\\/g, "/")).toMatch(/\/prompts$/);
  });

  it("核心功能 Prompt 保留关键规则（Benchmark / Category Creator / 牛逼化 / 三层标记）", () => {
    const copywriter = loadPrompt("SALES_COPYWRITER");
    expect(copywriter).toContain("BENCHMARK");
    expect(copywriter).toContain("CATEGORY_CREATOR");
    expect(copywriter).toContain("Level 5");

    const intensifier = loadPrompt("COPY_INTENSIFIER");
    expect(intensifier).toContain("不能增加任何新事实");
    expect(intensifier).toContain(">= 85");
    expect(intensifier).toContain(">= 90");

    const architect = loadPrompt("PRODUCT_ARCHITECT");
    expect(architect).toContain("backbone");
    expect(architect).toContain("memory_point");

    const philosophy = loadPrompt("FORMULA_PHILOSOPHY");
    expect(philosophy).toContain("formula_strategy");
    expect(philosophy).toContain("known_ratio");

    const reviewer = loadPrompt("FACT_REVIEWER");
    expect(reviewer).toContain("FACT");
    expect(reviewer).toContain("INTERPRETATION");
    expect(reviewer).toContain("RHETORIC");
  });
});
