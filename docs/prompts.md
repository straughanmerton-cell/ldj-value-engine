# Prompt 管理说明

Prompt 正文位于仓库 `prompts/`，注册表位于 `packages/prompts`。

| Prompt Key | 文件 | Agent |
|---|---|---|
| `FACT_NORMALIZER` | `prompts/fact-normalizer.md` | Agent 1 产品事实整理器 |
| `SEARCH_PLANNER` | `prompts/search-planner.md` | Agent 2 搜索策略专家 |
| `WEB_EXTRACTOR` | `prompts/webpage-extractor.md` | Agent 3 网页事实抽取器 |
| `COMPARABLE_REVIEWER` | `prompts/comparable-reviewer.md` | Agent 4 对标产品评审员 |
| `VALUE_ANALYZER` | `prompts/value-analyzer.md` | Agent 5 高价值原因分析师 |
| `VALUE_MAPPER` | `prompts/value-mapper.md` | Agent 6 龙德记价值映射专家 |
| `PRODUCT_ARCHITECT` | `prompts/product-architect.md` | Agent 7 产品结构设计师 |
| `FORMULA_PHILOSOPHY` | `prompts/formula-philosophy.md` | Agent 8 配方哲学文案师 |
| `SALES_COPYWRITER` | `prompts/sales-copywriter.md` | Agent 9 首席成交文案总监 |
| `COPY_INTENSIFIER` | `prompts/copy-intensifier.md` | Agent 10 牛逼化强化器 |
| `FACT_REVIEWER` | `prompts/fact-reviewer.md` | Agent 11 事实审核员 |

## 版本管理

- Phase 1：文件版本（`PROMPT_REGISTRY.version = v1`），只读加载 + 缓存；
- Phase 3（已完成）：接入 `prompt_versions` 表，支持 version / active / rollback / edit / test run：
  `GET /api/prompts`、`GET /api/prompts/{key}`、`GET /api/prompts/{key}/versions`、
  `POST /api/prompts/{key}/versions`（ADMIN 派生新版本）、`POST /api/prompts/{key}/activate`（ADMIN 切换生效 / 回滚）、
  `POST /api/prompts/{key}/test-run`（ADMIN / RESEARCHER / COPYWRITER 试跑）。首次访问时 `prompts/*.md` 自动落库为 v1，
  历史版本只增不删（§62-12 / §62-15）；
- 所有 AI 输出必须经过 Zod schema 校验，校验失败自动重试一次后报错（`packages/ai/src/json.ts`）。

## 已接线的 Agent

| Prompt Key | 接线阶段 | 调用位置 | 说明 |
|---|---|---|---|
| `FACT_NORMALIZER` | Phase 3 | `modules/value-dna/service.ts` → `POST /api/products/{id}/facts/normalize` | 只返回候选与丢弃原因，不写库 |
| `SEARCH_PLANNER` | Phase 4 | `modules/research/search-plan.service.ts` → `POST /api/products/{id}/search-plan/generate` | 规则引擎先跑，AI 仅在开启 `use_ai` 时补充（仍受字段白名单约束） |
| `WEB_EXTRACTOR` | Phase 4 | `modules/research/source.service.ts` → `POST /api/products/{id}/sources/{sourceId}/extract` | 只产出证据与候选，价格证据单独标注类型 |
| `FACT_REVIEWER` | Phase 14 | `modules/fact-review/fact-review.service.ts` → `POST /api/products/{id}/fact-review/generate` | 规则引擎是权威判定，Agent 11 仅在 `use_ai: true` 时叠加标注，**AI 只能加严**（§62-14） |

`PRODUCT_ARCHITECT`（Phase 10）、`FORMULA_PHILOSOPHY`（Phase 11）、`SALES_COPYWRITER`（Phase 12）与
`COPY_INTENSIFIER`（Phase 13「再狠一点」）已交付，但四者都采用**纯函数规则引擎**
（`buildProductArchitecture` / `buildFormulaPhilosophy` / `buildSalesCopy` / `intensifySalesCopy`，
只读库里已录入字段、Value DNA 与上游成稿，不调用 AI Provider），因此没有新增 AI 调用入口：
Prompt 正文与 `PROMPT_REGISTRY` 注册项保留，作为后续接入 AI 时的既有基线
（`SALES_COPY_CONTRACT.engine.ai_wired = false`，前端不显示 AI 标识）。

强化器尤其如此：§34 要求「强化不得新增任何事实」，落地方式是拿更高档画像把**同一份事实**重讲一遍，
再做引用集合差（`added_facts` 非空直接 400），这比让模型自由发挥更可靠。

第五个生成型 Agent `FACT_REVIEWER`（Phase 14 事实审核 / 人工审批）**已经接线，且口径与上面四个不同**：
它带可选 AI（`FACT_REVIEW_ENGINE_INFO.ai_wired = true`），但 **`rule_engine_authoritative = true`**——
纯规则引擎是权威判定，AI 只能加严（`ai_can_only_tighten`）：AI 判出的 RED 一律保留，规则判出的 RED 不会被洗白，
AI 标注的句数与文本对不上整份回落纯规则；Mock / AI 失败时同样回落纯规则并在 `warnings` 写明。
接线前该入口返回 `501 + details.phase`，Phase 14 交付后**全仓再没有任何 501 占位接口**。

Phase 15（主播中心 / 经销商中心 / 导出 / 历史版本）是**只读交付层**（§62-15 派生视图）——它把某一版
已审批成稿按 §51 / §52 十项重排成能直接用的资料，**不调用任何 AI、不新增 Prompt Key、不改写任何一句正文**，
因此 `packages/prompts` 仍是 11 个 Key；导出用的也是现成正文，不做模型改写。

## 校验测试

`packages/prompts/tests/registry.test.ts` 断言：

1. 11 个 Prompt 文件全部存在且非空；
2. `SALES_COPYWRITER` 含 `BENCHMARK` / `CATEGORY_CREATOR` / `Level 5`；
3. `COPY_INTENSIFIER` 含“不能增加任何新事实”、`>= 85`、`>= 90`；
4. `PRODUCT_ARCHITECT` 含 `backbone` / `memory_point`；
5. `FORMULA_PHILOSOPHY` 含 `formula_strategy` / `known_ratio`；
6. `FACT_REVIEWER` 含 `FACT` / `INTERPRETATION` / `RHETORIC`。
