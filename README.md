# 龙德记 AI 高价值锚点与强成交话术系统 V2

> 项目代号：**LDJ Value Engine V2**

需求基线（唯一 Source of Truth）：

```
C:/Users/Administrator/Downloads/龙德记_AI高价值锚点与强成交话术系统_V2_成交增强版_开发规格.md
```

核心理念：

> **后台研究要像分析师一样严谨，前台表达要像顶级主播一样有压迫感。**
> **事实不造假，价值表达尽可能做到极致。**

## 1. 核心功能锁定（不得裁剪）

| 核心功能 | 基线条款 | 当前状态 |
|---|---|---|
| Benchmark Mode｜高价值对标模式 | §4.1 / §16 / §28 | 已交付（Phase 7：三种锚点 + 模式判定） |
| Category Creator Mode｜自建高端标准模式 | §4.2 / §17 / §29 | 已交付（Phase 8：两触发条件 + 六标准轴 + 自建标准 / 风格身份证 / 价值逻辑） |
| 产品结构叙事 Product Architecture | §5 / §45 / §57 | 已交付（Phase 10：九角色结构叙事 + §57 验收 + 版本与人工确认） |
| 配方哲学 Formula Philosophy | §6 / §46 | 已交付（Phase 11：五分量设计逻辑 + 比例红线 + §57 验收 + 版本与人工确认） |
| “牛逼化”强化按钮 | §7 / §34 / §48 | 已交付（Phase 13：四档按钮 + 只升不降 + 只新增版本 + 不得新增任何事实 + §48 八项自检） |
| Level 5 王者话术 | §21 / §22 / §30 | 已交付（Phase 12 成稿 + Phase 13 可再强化到王者档） |

锁定机制（防止实现过程中被悄悄裁掉）：

1. `packages/schemas/src/core-features.ts` 定义 `CORE_FEATURES` 常量；
2. `packages/schemas/src/thresholds.ts` 固化相似度权重、锚点触发线、Price Evidence 权重、冲击力权重与 Level 4 ≥ 85 / Level 5 ≥ 90；
3. `/api/meta/core-features` 对外暴露核心功能与 15 个页面模块；
4. 规格 §37 的成交增强接口在 Phase 1 先以 `501 NOT_IMPLEMENTED + phase` 占位，至 Phase 13 全部接线、
   Phase 14 的事实审核按既有模块范式自建路由，**全仓已无 501 占位**；
5. `prompts/` 下 11 个 Agent Prompt 已按基线写入真实规则。

## 2. 技术栈与目录

```text
longdeji-value-engine/
├── apps/web/                     # Vite + React 前端（产品 CRUD / 产品详情 15 Tab / 研究工作台 / 证据中心 / 候选池 / 市场价格中心 / 高价值锚点 + 自建高端标准 / 产品结构库 / 配方哲学库 / 强成交话术库 / 主播中心 / 经销商中心 / 历史版本）
├── services/api/                 # Fastify 5 + TypeScript API（Auth / RBAC / CRUD / Value DNA / Prompt 管理 / 研究与抽取 / 候选池 / 价格证据 / 锚点与对标模式 / 自建高端标准 / 产品结构叙事 / 配方哲学 / 强成交话术与牛逼化强化 / 事实审核与人工审批 / 交付中心（主播中心 / 经销商中心 / 导出））
├── packages/schemas/             # Zod 校验、领域枚举、阈值常量（含核心功能锁定、锚点合同、自建标准轴、Value Codes / 价值故事、产品结构九角色、配方哲学五分量、强成交话术 / 强化引擎与事实审核三层标记）
├── packages/database/            # Drizzle ORM + PostgreSQL schema / 迁移 / 种子（含 value-anchors、category-creator-profiles、value-codes、product-architectures、copy-outputs、generated-claims / claim-evidence 表定义）
├── packages/ai/                  # AI Provider Adapter（OpenAI + Mock）与 JSON schema 校验
├── packages/search/              # SearchProvider Adapter（Tavily + Mock）
├── packages/prompts/             # 11 个 Prompt Key 注册表（与 prompt_versions 表联动：版本 / 生效 / 回滚）
├── packages/shared/              # 环境变量、统一错误、分页
├── prompts/                      # Agent 1–11 的 Prompt 正文（md）
├── database/                     # migrations / seeds
├── docs/                         # PRD、architecture、scoring、api、prompts、roadmap
├── docker/                       # PostgreSQL 初始化脚本
├── scripts/smoke/                # 各阶段端到端冒烟脚本（phase1…phase15）
└── agent_memory/                 # 项目上下文、进度、问题与风险
```

Phase 8（Category Creator Mode）关键文件：

```text
packages/schemas/src/category-creator.ts                    # 触发条件 / 六标准轴 / 风格身份证 / 价值逻辑 / 合同与纯函数构建器
packages/database/src/schema/category-creator-profiles.ts   # category_creator_profiles 表定义
services/api/src/modules/category-creator/                  # routes.ts + category-creator.service.ts（7 条路由）
apps/web/src/lib/category-creator.ts                        # 前端数据层与兜底标签
apps/web/src/components/category-creator/                   # 7 个面板组件（合同 / 总览 / 自建标准 / 风格身份证 / 价值逻辑 / 版本列表 / 面板壳）
scripts/smoke/phase8.mjs                                    # Phase 8 端到端冒烟（123 项断言）
```

Phase 9（Value Codes / Value Mapping）关键文件：

```text
packages/schemas/src/value-codes.ts                         # 16 个 Value Code / 五态判定 / 六类价值故事 / 合同与纯函数构建器
packages/schemas/src/core-features.ts                       # DELIVERED_PHASES 推进（Phase 10 → [1..10]，Phase 11 → [1..11]），阶段 implemented 同步
packages/database/src/schema/value-codes.ts                 # value_codes（字典）+ product_value_codes（按产品版本化）表定义
services/api/src/modules/value-codes/                       # routes.ts + value-codes.service.ts（8 条路由）
apps/web/src/lib/value-codes.ts                             # 前端数据层与兜底标签
apps/web/src/components/value-codes/                        # 9 个面板 / 表格组件（合同 / 总览 / 矩阵 / 六故事 / 缺口 / 版本 / 字典 / 跨产品库 / 面板壳）
apps/web/src/pages/ValueCodesPage.tsx                       # /value-codes 价值密码库（跨产品总览 + 筛选排序分页）
scripts/smoke/phase9.mjs                                    # Phase 9 端到端冒烟（132 项断言）
```

Phase 10（产品结构叙事 Product Architecture）关键文件：

```text
packages/schemas/src/product-architecture.ts                # 九角色引擎 / §45 八问 / §57 验收 / 合同 / 纯函数 buildProductArchitecture
packages/schemas/src/product.ts                             # productArchitectureSchema（九角色正文 + §10 录入侧字段）
packages/database/src/schema/product-architectures.ts       # product_architectures 表（按产品版本化 + 人工确认）
services/api/src/modules/product-architecture/              # routes.ts + product-architecture.service.ts（8 条路由）
apps/web/src/lib/product-architecture.ts                    # 前端数据层与兜底标签
apps/web/src/components/product-architecture/               # 8 个面板组件（合同 / 总览 / 九角色 / §57 验收 / 缺口 / 版本 / 面板壳）
apps/web/src/pages/ProductArchitecturePage.tsx              # /architecture 产品结构库（跨产品总览 + 筛选排序分页）
scripts/smoke/phase10.mjs                                   # Phase 10 端到端冒烟（134 项断言）
```

Phase 11（配方哲学 Formula Philosophy）关键文件：

```text
packages/schemas/src/formula-philosophy.ts                  # 五分量引擎 / §6.1 比例红线 / §57 验收 / 合同 / 纯函数 buildFormulaPhilosophy
packages/schemas/src/value-codes.ts                         # 配方哲学故事改取设计逻辑正文（Phase 11 交付后不再 HANDOFF）
packages/database/src/schema/formula-philosophies.ts        # formula_philosophies 表（按产品版本化 + 人工确认）
services/api/src/modules/formula-philosophy/                # routes.ts + formula-philosophy.service.ts（8 条路由）
apps/web/src/lib/formula-philosophy.ts                      # 前端数据层与兜底标签
apps/web/src/components/formula-philosophy/                 # 8 个面板组件（合同 / 总览 / 五分量 / §57 验收 / 缺口 / 版本 / 跨产品库 / 面板壳）
apps/web/src/pages/FormulaPhilosophyPage.tsx                # /formula-philosophy 配方哲学库（跨产品总览 + 筛选排序分页）
scripts/smoke/phase11.mjs                                   # Phase 11 端到端冒烟（165 项断言）
```

Phase 12（强成交话术 Strong Sales Copy）关键文件：

```text
packages/schemas/src/sales-copy.ts                          # 十三格骨架 / §26 九种输出 / §23 八项评分 / §22 Level 5 七项 / §24 合规 / 合同与纯函数 buildSalesCopy
packages/database/src/schema/copy-outputs.ts                # copy_outputs 表定义（版本化 + 人工确认 + 排序冗余键）
services/api/src/modules/sales-copy/                        # routes.ts + sales-copy.service.ts（8 条路由）
apps/web/src/lib/sales-copy.ts                              # 前端数据层与兜底标签
apps/web/src/components/sales-copy/                         # 9 个面板组件（合同 / 总览 / §23 评分 / Level 5 / 九种输出 / 缺口 / 版本 / 矩阵 / 面板壳）
apps/web/src/pages/SalesCopyPage.tsx                        # /copy 强成交话术库（跨产品总览 + 筛选排序分页）
scripts/smoke/phase12.mjs                                   # Phase 12 端到端冒烟（167 项断言）
```

Phase 13（牛逼化强化器 Intensify「再狠一点」）关键文件：

```text
packages/schemas/src/sales-copy.ts                          # 与 Phase 12 同文件：四档强化按钮 / INTENSIFY_FACT_RULE（只能是源版本子集）/ §48 八项自检 / 纯函数 intensifySalesCopy
services/api/src/modules/sales-copy/                        # routes.ts + sales-copy.service.ts（9 条路由，含 POST /api/products/{id}/copy/intensify）
apps/web/src/components/sales-copy/                         # 9 个面板组件；「再狠一点」按钮组在版本列表 / 总览里可用（禁用规则随四道闸门联动）
apps/web/src/pages/SalesCopyPage.tsx                        # /copy 强成交话术库（强化后新版本直接并入矩阵与版本表）
scripts/smoke/phase13.mjs                                   # Phase 13 端到端冒烟（99 项断言）
```

Phase 14（事实审核与人工审批）关键文件：

```text
packages/schemas/src/fact-review.ts                         # FACT / INTERPRETATION / RHETORIC 三层标记 / 三档风险 / 13 项焦点 / 10 条规则 / 合同与纯函数 buildFactReview、mergeFactReviewAi
packages/schemas/src/fact-review-evidence.ts                # 逐句证据与出处口径（四档 evidence_kind / 逐字回查）
packages/database/src/schema/generated-claims.ts            # generated_claims 表定义（逐句台账）
packages/database/src/schema/claim-evidence.ts              # claim_evidence 表定义（逐句证据）
database/migrations/0014_slow_nightmare.sql                 # 两张新表的迁移
services/api/src/modules/fact-review/                       # routes.ts + fact-review.service.ts（8 条路由）
apps/web/src/lib/fact-review.ts                             # 前端数据层与兜底标签
apps/web/src/components/fact-review/                        # 6 个面板组件（合同 / 总览 / 逐句表 / 缺口 / 版本列表 / 面板壳）
scripts/smoke/phase14.mjs                                   # Phase 14 端到端冒烟（94 项断言）
```

Phase 15（主播中心 / 经销商中心 / 导出 / 历史版本）关键文件：

```text
packages/schemas/src/delivery.ts                             # DELIVERY_CONTRACT / 主播中心十项 HOST_CENTER_SLOT_META / 经销商中心十项 DEALER_CENTER_SLOT_META / 导出格式与范围 / 六态闸门 buildDeliveryGate / 两个中心的只读重排 buildHostCenterView / buildDealerCenterView / 导出渲染 renderDeliveryExport
services/api/src/modules/delivery/                           # routes.ts + delivery.service.ts（6 条只读路由）
apps/web/src/lib/delivery.ts                                 # 前端数据层与兜底标签（gateStateOf / slotCopyText / downloadExportFile / 6 个 hooks）
apps/web/src/components/host-center/                         # 7 个面板组件（闸门条 / 十格 / 3 分钟时序 / 异议卡 / 快取 / 导出卡 / 面板壳）
apps/web/src/components/dealer-center/DealerCenterPanel.tsx  # 经销商中心面板（十格 + 锚点口径 + 导出）
apps/web/src/components/delivery/                            # 3 个交付组件（合同卡 / 跨产品排产表 HostCenterMatrixTable / 版本历史 VersionHistoryPanel）
apps/web/src/pages/HostCenterPage.tsx                        # /hosts 跨产品排产页
apps/web/src/pages/DealerCenterPage.tsx                      # /dealers 经销商资料页
apps/web/src/pages/VersionsPage.tsx                          # /versions 历史版本页
scripts/smoke/phase15.mjs                                    # Phase 15 端到端冒烟（125 项断言）
```

## 3. 快速开始

```powershell
pnpm install

# 1) 启动 PostgreSQL（127.0.0.1:55433，库 ldj_dev / ldj_test）
pnpm db:up

# 2) 环境变量
Copy-Item .env.example .env

# 3) 迁移 + 种子（默认品牌「龙德记」+ 管理员账号）
pnpm db:migrate
pnpm db:seed

# 4) 启动
pnpm dev:api      # http://127.0.0.1:4400
pnpm dev:web      # http://127.0.0.1:4401
```

首个注册账号自动成为 `ADMIN`（bootstrap），之后仅 `ADMIN` 可创建用户。

## 4. 常用脚本

| 命令 | 说明 |
|---|---|
| `pnpm typecheck` | 全仓库 TypeScript 检查 |
| `pnpm test` | 全仓库测试 |
| `pnpm db:up` / `pnpm db:down` | 启停 PostgreSQL |
| `pnpm db:generate` | 依据 schema 生成迁移 SQL |
| `pnpm db:migrate` | 执行迁移 |
| `pnpm db:seed` | 写入默认品牌与管理员 |
| `pnpm dev:api` / `pnpm dev:web` | 本地开发 |
| `node scripts/smoke/phase4.mjs` | Phase 4 端到端冒烟（需先 `pnpm dev:api`；脚本自建数据并清理） |
| `node scripts/smoke/phase5.mjs` | Phase 5 端到端冒烟（需先 `pnpm dev:api`；脚本自建数据并清理） |
| `node scripts/smoke/phase6.mjs` | Phase 6 端到端冒烟（需先 `pnpm dev:api`；脚本自建数据并清理） |
| `node scripts/smoke/phase7.mjs` | Phase 7 端到端冒烟（三种锚点 / §17 模式判定 / 权限边界，155 项断言） |
| `node scripts/smoke/phase8.mjs` | Phase 8 端到端冒烟（自建高端标准 / 两触发条件 / 六标准轴 / 事实不足不输出成交表达，123 项断言） |
| `node scripts/smoke/phase9.mjs` | Phase 9 端到端冒烟（16 个 Value Code 落位 / 五态判定 / 六类价值故事 / 缺口与人工确认，138 项断言） |
| `node scripts/smoke/phase10.mjs` | Phase 10 端到端冒烟（九个角色结构叙事 / §57 验收 / 证据逐字回查 / 版本与人工确认，134 项断言） |
| `node scripts/smoke/phase11.mjs` | Phase 11 端到端冒烟（五分量设计逻辑 / §6.1 比例红线 / 拼配描述取比例 / §57 验收 / 跨产品库与权限，165 项断言） |
| `node scripts/smoke/phase12.mjs` | Phase 12 端到端冒烟（五档强度 / §26 九种输出 / Level 5 七项 / §23 评分与事实不足压分 / §24 合规 / 证据逐字回查，167 项断言） |
| `node scripts/smoke/phase13.mjs` | Phase 13 端到端冒烟（四档强化 / 只升不降 / 只新增版本 / 不得新增事实 / §48 八项自检与 85·90 阈值 / 轮次与版本上限，99 项断言） |
| `node scripts/smoke/phase14.mjs` | Phase 14 端到端冒烟（三层标记 / 三档风险 / 13 项焦点 / RED 拦截审批 / 版本只增不删 / 20 版上限，94 项断言） |
| `node scripts/smoke/phase15.mjs` | Phase 15 端到端冒烟（合同自检 / 六态闸门 / §51 主播中心十项 / §52 经销商中心十项 / 跨产品排产分页与 `ready` 三态 / 导出格式与范围 / 409 闸门但书 / 只读权限，125 项断言） |

## 5. 环境变量

见 [.env.example](.env.example)。第三方 Key（`OPENAI_API_KEY`、`TAVILY_API_KEY`）缺失时系统自动回退 `MockAiProvider` / `MockSearchProvider`，不阻塞开发（规格 §63-7）。

## 6. 开发阶段

Phase 1–15 已完成（基线 §60 的全部阶段）；详见 [docs/roadmap.md](docs/roadmap.md)。

```text
Phase 1  基础架构、Auth、DB、Product CRUD          ✅ 已完成
Phase 2  产品事实、品饮、研发参考                  ✅ 已完成
Phase 3  Value DNA、AI Provider、Prompt Manager    ✅ 已完成
Phase 4  Search、Crawler、Source、网页抽取         ✅ 已完成
Phase 5  Candidate、相似度、去重                    ✅ 已完成
Phase 6  Price Engine、价格证据、异常值               ✅ 已完成
Phase 7  Anchor Engine、Benchmark Mode              ✅ 已完成
Phase 8  Category Creator Mode                      ✅ 已完成
Phase 9  Value Codes、Value Mapping                 ✅ 已完成
Phase 10 Product Architecture                      ✅ 已完成
Phase 11 Formula Philosophy                         ✅ 已完成
Phase 12 Strong Sales Copy、Level 5 王者话术         ✅ 已完成
Phase 13 牛逼化强化器「再狠一点」Intensify          ✅ 已完成
Phase 14 事实审核、人工审批                          ✅ 已完成
Phase 15 主播中心、经销商中心、导出                    ✅ 已完成
```

Phase 15 是**只读交付层**（不新增表、不改写正文、不生成第二份话术，§62-15）：把某一版「已人工审批通过、
逐句无 RED」的成稿重排成主播中心 §51 十项与经销商中心 §52 十项，并提供最终资料包导出。
发布闸门只有一份实现（`buildDeliveryGate()`），主播中心、经销商中心、跨产品排产列表、导出四条链路读同一个
`ready`；闸门未通过时页面照常渲染但十格全空，导出返回 **409** 并在 `details` 回阻断句与下一步，
绝不产出半成品文件。六条只读路由见 [docs/api.md](docs/api.md) §23。

## 7. 验证

```powershell
pnpm typecheck
pnpm test                     # 单元测试 + API 集成测试（需要 pnpm db:up）
pnpm --filter @ldj/web build  # 前端构建
```

## 8. 铁律（规格 §62）

1. 不用模型记忆替代搜索；2. 挂牌价 ≠ 成交价；3. 整件价 ≠ 单饼价；4. 价格不参与相似度；
5. 竞品事实不自动移植；6. 不虚构研发关系；7. 不虚构配方比例；8. 不虚构树龄、山头、年份、获奖、大师等硬事实；
9. 允许极强修辞；10. 无对标时自动进入 Category Creator Mode；11. 前台文案不得变成说明书；
12. Prompt 可版本管理；13. AI 输出必须 schema validation；14. RED claim 禁止发布；15. 所有版本必须保留。

## 9. 部署（免费方案）

公网部署形态 = **单服务**（同一进程既出 API 也出 `apps/web/dist`）+ 外部免费 Postgres，
配置见根目录 `render.yaml`，完整步骤与限制见 `docs/deploy.md`。
要点：`NODE_ENV=production` 会自动开启前端静态托管（`services/api/src/plugins/web-static.ts`），
`/api/**` 之外的深链回 `index.html`，`/api/**` 仍保持 JSON 404。
