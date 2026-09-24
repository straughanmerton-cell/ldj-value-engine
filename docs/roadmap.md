# 开发路线图与验收标准

## Phase 1（已完成）

基础架构、Auth、DB、Product CRUD。

- [x] pnpm monorepo（apps / services / packages / prompts / database / docs）
- [x] PostgreSQL schema（users、sessions、brands、products）与迁移、种子
- [x] Fastify API：健康检查、Auth（注册 / 登录 / 刷新轮换 / 登出 / me）、RBAC、品牌与产品 CRUD
- [x] Zod 输入校验，统一错误结构
- [x] AI / Search Provider Adapter + Mock Provider + `.env.example`
- [x] 11 个 Prompt Key 注册与正文
- [x] 核心功能锁定常量与 `/api/meta/core-features`
- [x] 单元测试 + API 集成测试（真实 PostgreSQL）
- [x] 前端骨架：登录、产品列表 / 新建 / 详情、15 个模块导航

## Phase 2（已完成）

产品事实、品饮档案、研发参考（基线 §60 Phase 2）。

- [x] `packages/schemas`：§10.1–10.5 事实键目录与分组（`fact_key` / `fact_group`）、`SENSORY_FIELDS`（§10.4 二十项）、事实六态与证据校验、品饮档案、研发参考 schema（§35.2）
- [x] §25 语言规则固化：`RND_RESTRICTED_PHRASES` / `RND_ALLOWED_PHRASES`，无 `RND_CONFIRMED` + 证据时禁止「复刻／同款配方／原配方再现／某大师配方／经典秘方／按照某款配方做」
- [x] 数据库：`product_facts` / `tasting_profiles` / `r_and_d_references` 三张新表 + 迁移 `0001_flippant_jigsaw.sql`
- [x] API：事实清单 CRUD（含状态治理与证据强制）、品饮档案 CRUD、研发参考资料 CRUD（含 §25 拦截与 `claims_allowed`）；`rnd-references` 从 501 占位转为正式实现
- [x] Web：产品详情按基线 §32 拆成 15 个 Tab（顺序与基线一致），「品饮档案 / 事实清单 / 研发资料」三个 Tab 可用，其余 Tab 显示明确 Phase 占位而非简化替代
- [x] 测试：`packages/schemas` 26 个 + `services/api` 36 个（含 Phase 2 专项 17 个）全部通过
- [x] 端到端冒烟：真实进程 + HTTP（事实状态治理、证据强制、§25 拦截、claims_allowed、非 501）全部符合预期；冒烟数据已清理

## Phase 3（已完成）

Value DNA、AI Provider 接线、Prompt Manager（基线 §9 / §39 / §50）。

- [x] `packages/schemas/src/value-dna.ts`：11 维度价值 DNA 结构、AI 输出 schema、逐字回溯过滤（`filterValueDnaTraceability`）、`isValueDnaStale`、`mergeValueDna`
- [x] `packages/schemas/src/fact-normalizer.ts`：Agent 1 事实归一候选与丢弃原因（`sanitizeFactNormalization`）
- [x] 数据库：`products.value_dna` / `value_dna_meta` 两列 + `prompt_versions` 表 + `prompt_key` 枚举（迁移 `0002_spotty_talkback.sql`）
- [x] API：`GET/POST /api/products/{id}/value-dna[/generate]`、`POST /api/products/{id}/facts/normalize`、`/api/prompts/*` 六条 Prompt 管理接口（列表 / 详情 / 版本 / 派生 / 生效 / 试跑）
- [x] Prompt 治理：`prompts/*.md` 首次访问自动落库为 v1，派生新版本只增不删，激活即生效（§62-12/15）
- [x] 红线：规则引擎先跑，DNA 只用已录入字段与已确认事实；AI 补充项必须源文本可逐字回溯，否则丢弃并记 warnings
- [x] 测试：`packages/schemas`（`value-dna.test.ts` 17 个用例，全包 60 个）+ `services/api`（`value-dna.test.ts` 8 个、`prompt-manager.test.ts` 5 个）全部通过

## Phase 4（已完成）

Search、Crawler、Source、网页抽取（基线 §12 / §40 Agent 2 / §41 Agent 3 / §55 / §56）。

- [x] `packages/schemas`：`search.ts`（9 类检索意图 + 查询词生成规则）、`source.ts`（来源 / 抓取 / 抽取边界 `SOURCE_LIMITS`）、`extraction.ts`（Agent 3 输出：价格证据 / 事实候选 / 丢弃 / 警告）、`research.ts`（22 阶段流水线定义与进度结构）
- [x] 数据库：`search_plans` / `sources` / `source_extractions` / `research_jobs` 四张表 + 三个来源枚举（迁移 `0003_glossy_boom_boom.sql`），全部对 `products` 级联删除
- [x] API：搜索策略读写与生成、研究任务启动 / 进度 / 历史、来源登记 / 去重 / 详情 / 删除、抓取（15s / 2MB / 60000 字符边界）、抽取（含版本保留与复用）
- [x] 红线落地：Mock 检索 0 结果时不编造来源（§62-1）；抓取失败如实记录 `fetch_error` 不伪造正文；抽取只落证据，绝不自动写产品事实（§41 / §62-5）；未交付阶段在进度中 `implemented=false`
- [x] Web：研究工作台 `/research`、高价值茶数据库 `/high-value-db`、证据中心 `/evidence` 三个页面；产品详情新增「AI 研究」Tab（研究任务 + 搜索策略 + 来源证据）
- [x] 测试：`packages/schemas`（`search.test.ts` 17 个）+ `services/api`（`research.test.ts` 12 个，全包 61 个）通过；端到端冒烟 `scripts/smoke/phase4.mjs` 62 项断言全通过，冒烟数据已清理

## Phase 5（已完成）

候选池、去重与相似度评分（基线 §13 可比性评分 / §36 高价值茶数据库 / §42 Agent 4 / §55 / §56）。

- [x] `packages/schemas`：`comparable.ts`（十维权重 18/18/15/13/10/8/7/5/3/3 = 100、分档 55/70/85、候选状态与中文标签、身份键 `candidateIdentityKey`、`COMPARABLE_CONTRACT` 含 `price_in_similarity: false`）、`similarity.ts`（`scoreSimilarity` 十维打分与 `unknown_dimensions`、facet / 证据 / 价格证据构建）
- [x] 数据库：`comparable_candidates` 表（唯一约束 `(product_id, identity_key)`，`similarity` / `evidence` / `observed_prices` / `source_ids` / `merged_sources` / 评审字段）迁移 `0004_lively_may_parker.sql`
- [x] API：`modules/candidates/`（合同自检、跨产品与产品级候选列表、手工登记、来源重建、单条详情、人工评审、删除），研究流水线追加 `CANDIDATE_POOL` / `SIMILARITY_SCORE` 两个真实阶段
- [x] 红线落地：价格不参与相似度（facet 类型与 `COMPARABLE_CONTRACT` 双重约束，来自 Value DNA 的「价格带已知」项在评分侧显式剔除）；未知维度按 0 分并记录；低于阈值仍入库但标记 `REJECT` 且保留原始总分；同款茶按身份键合并，不因来源多而多算证据（§62-4/5）
- [x] Web：`/high-value-db` 升级为跨产品候选池（分档统计 + 筛选 + 排序 + 分页 + 评审），产品详情「AI 研究」Tab 与 `/research` 增加产品级候选面板；未交付阶段仍以 Phase 占位显示
- [x] 测试：`services/api` 74 个用例通过（含候选 13 个）；端到端冒烟 `scripts/smoke/phase5.mjs` **103 项断言全通过**，冒烟数据已清理

## Phase 6（已完成）

市场价格系统与 Price Evidence Score（基线 §14 价格体系 / §15 Price Evidence Score / §16.1 锚点价格条件）。

- [x] `packages/schemas/src/price.ts`：`scorePriceEvidence` 五项加权（25/25/20/15/15，合计 100）、分档 60/75、`normalizePriceEquivalents`（357g / 1kg 等价）、`detectPriceOutliers`（中位数 + MAD，样本 <4 不判）、`marketOfferSchema` 与 `MARKET_OFFER_LIMITS`、`priceSummarySchema`、`PRICE_CONTRACT`
- [x] 数据库：`market_offers` 表（价格性质 / 数值与原话 / 单位与规格 / 归属 / 证据分明细 / 异常值 / 排除标记）迁移 `0005_abandoned_sprite.sql`（表 + 归属与分档枚举）+ `0006_remarkable_micromax.sql`（`quote_traceable`）
- [x] API `modules/prices/`：价格合同自检、跨产品与产品级价格列表、人工登记、来源重建（沿 §14 / §62-3 取重量）、单条详情、人工修正（补规格 / 改单位 / 排除）、价格汇总、删除（仅 ADMIN）
- [x] 红线落地：**挂牌价 ≠ 成交价**（按原文判定性质，挂牌证据带「不得表述为成交」提醒，汇总分开计数）、**整件价 ≠ 单饼价**（缺规格一律 NULL，不做 357g / kg 反推）、**价格不参与相似度**（与候选相似度物理分离）、未写身份的来源单独标 `SOURCE_UNATTRIBUTED` 且不互相印证、异常值只标记不删除、人工登记不被重建覆盖
- [x] 研究流水线追加 `PRICE_SEARCH` / `PRICE_EVIDENCE` / `OUTLIER_DETECTION` 三个阶段（`implemented=true`）
- [x] Web：市场价格中心 `/market-prices`（分档统计 + 筛选 + 排序 + 分页 + 人工修正）、产品详情「价格证据」Tab（价格证据面板 + 价格汇总）
- [x] 测试：`services/api` 91 个用例通过（含 Phase 6 专项 17 个）；端到端冒烟 `scripts/smoke/phase6.mjs` **163 项断言全通过**，冒烟数据已清理

## Phase 7（已完成）

Anchor Engine 与 Benchmark Mode（基线 §16 三种锚点 / §17 无锚点强制逻辑 / §55 Build Anchors / §56 研究进度）。

- [x] `packages/schemas/src/anchor.ts`：三种锚点类型（`HIGHEST_VALUE` / `SIMILARITY_HIGH_VALUE` / `SALES_ANCHOR`）、
  `scoreSalesAnchor` 六项加权（30/25/15/15/10/5，合计 100）、锚点 / 快照 / 列表查询 / 重建请求 schema、
  `ANCHOR_CONTRACT`（含 `excludes_source_unattributed` / `no_fake_benchmark` / `price_in_similarity: false` 三条红线与 6 条规则）、
  `ANCHOR_ENGINE_INFO`、模式标签与三种锚点中文标签
- [x] 数据库：`value_anchors` 表（类型 / 候选与价格引用 / 相似度与价格证据分 / 价格百分位 / 强成交六项明细 jsonb /
  名次 / 主锚点 / 人工标记 / 对标理由 / 冻结快照）迁移 `0007_robust_sphinx.sql`，随 `products` 级联删除
- [x] API `modules/anchors/`：合同自检、跨产品高价值锚点库、产品级列表（筛选 / 搜索 / 排序 / 分页）、
  重建（`POST /anchors/rebuild`，ADMIN / RESEARCHER）、模式判定 `GET /benchmark-mode`（只读）、
  单条详情、人工选定主锚点与补理由、删除（仅 ADMIN）
- [x] 红线落地：可靠价格必须「非排除 + 非异常值 + 非 `SOURCE_UNATTRIBUTED` + 证据分 ≥ 75」；
  无达标候选必须 `mode = CATEGORY_CREATOR`，禁止硬凑竞品、降阈值或编造对标（§17 / §62-10）；
  人工锚点在重建时默认保留，人工判断永远优先于自动排序；主锚点全产品唯一
- [x] 研究流水线 `ANCHOR_BUILD` 阶段标记 `implemented=true`（Phase 7），`VALUE_CODES` 及之后仍为 `PENDING`
- [x] Web：产品详情「高价值锚点」Tab（模式判定卡 + 重建卡 + 锚点表 + 锚点详情 / 人工选定主锚点）、
  跨产品锚点列表接口 `GET /api/anchors`（暂无独立页面），`components/anchors/*` + `lib/anchors.ts`
- [x] 测试：`services/api` 104 个用例通过（含 `anchors.test.ts` 13 个）；端到端冒烟 `scripts/smoke/phase7.mjs`
  **153 项断言全通过**，冒烟数据已清理

## Phase 8（已完成）

Category Creator Mode 自建高端标准模式（基线 §4.2 两个触发条件 / §17 无锚点强制逻辑 / §29 成交表达口径 / §60）。

- [x] `packages/schemas/src/category-creator.ts`：两个触发条件（`NO_RELIABLE_ANCHOR` / `USER_OPT_OUT`）、
  六标准轴 `FRAME`（骨架）/ `DEPTH`（底气）/ `IDENTITY`（身份）/ `FIRST_IMPRESSION`（第一口）/ `FINISH`（后半程）/ `CRAFT`（工艺）、
  轴状态（`SUPPORTED` / `PARTIAL` / `UNKNOWN`）与就绪度（`READY` / `PARTIAL` / `INSUFFICIENT`）、
  `categoryStyleIdentitySchema`、`valueLogicSchema`（`FACT → INTERPRETATION → VALUE → SALES_LINE`）、
  `CATEGORY_CREATOR_DOWNSTREAM`（**空数组**：Phase 10 / 11 / 12 / 14 均已交付，交接写在合同 `rules` 里）、
  `CATEGORY_CREATOR_CONTRACT`（6 条规则 + 三条红线）、
  `usableValueDna`、`inferCategoryTrigger`、纯函数 `buildCategoryCreatorDraft`
- [x] 数据库：`category_creator_profiles` 表（21 列，唯一约束 `(product_id, version)`），随 `products` 级联删除
- [x] API `modules/category-creator/`：合同自检、标签表、产品级总览（复用 §17 判定，不重复实现）、版本列表、
  生成（201）、单版调阅、人工确认 / 备注
- [x] 红线落地：`UNKNOWN` 轴 `statement` 必须为 `null` 并写明 `gap`（宁可不讲，不得编）；所有轴 `layer = INTERPRETATION`；
  `INSUFFICIENT` 时 `sales_line_ready = false` 且过滤掉 `SALES_LINE` 段（**不得输出成交表达**）；
  11 维 Value DNA 全空视同未生成（`usableValueDna`）；下游 Phase 10 / 11 / 12 / 14 只登记交接，固定 `PENDING`
- [x] Web：产品详情「高价值锚点」Tab 内新增自建高端标准面板（合同卡 + 总览 + 自建标准六轴 + 风格身份证 +
  价值逻辑 + 版本列表 + 人工确认），`components/category-creator/*` 7 个组件 + `lib/category-creator.ts`
- [x] 测试：`services/api` 11 个文件 / 118 个用例全部通过；`pnpm typecheck` 8 个 workspace 全通过；
  `pnpm --filter @ldj/web build` 通过
- [x] 端到端冒烟 `scripts/smoke/phase8.mjs` **123 项断言全通过**，冒烟数据已清理

## Phase 9（已完成）

Value Codes 与价值映射 Value Mapping（基线 §18 建议 Code 清单 / §19 状态与表达规范 / §20 六类价值故事 /
§30 价值拆解 / §43 Agent 5 十二维度 / §44 Agent 6 不移植竞品事实）。

- [x] `packages/schemas/src/value-codes.ts`：16 个 Value Code（顺序由 §18 固定，每个 Code 带
  `evidence` / `evidence_refs` / `requirement` / `contribution` / `status`）、§43 十二个分析维度、
  五态判定（`ALREADY_HAVE` / `PARTIAL` / `TIME_DEPENDENT` / `NOT_HAVE` / `UNKNOWN`）、
  §19 固定安全句式常量与禁止句常量、六类价值故事（产品结构故事由 Phase 10、配方哲学故事由 Phase 11 的正文接管，
  本阶段不写简化版）、
  `VALUE_CODES_CONTRACT`（7 条规则 + 4 条红线）、`VALUE_CODES_DOWNSTREAM`（**空数组**）、纯函数 `buildValueMapping`
- [x] 数据库：`value_codes`（16 行字典，由 `syncDictionary()` 持久化）+ `product_value_codes`
  （按产品版本化，唯一约束 `(product_id, version)`，随 `products` 级联删除）迁移 `0010_*.sql`
- [x] API `modules/value-codes/`：合同自检、标签表、跨产品价值密码库（筛选 / 排序 / 分页）、产品级总览、
  版本列表、生成（201）、单版调阅、人工确认 / 备注（8 条路由，读需登录、写限 ADMIN / RESEARCHER）
- [x] 红线落地：事实不足一律 `UNKNOWN` + 写清缺口（`statement` 必须为 `null`）；
  `TIME_DEPENDENT` 的成交层表达逐字等于 §19 固定句式、不得出现「以后一定会有。」；
  `NOT_HAVE` 必须指到具体已录入事实；证据只引用本产品事实与 Value DNA（不含竞品事实）；
  配方哲学故事与产品结构故事都取各自 Phase 的正文（无正文则 `GAP`），
  下游 Phase 10 / 11 / 12 / 14 登记为 `PENDING`
- [x] Web：`/value-codes` 价值密码库页面（合同卡 + 筛选 + 排序 + 分页 + Code 字典）、产品详情
  「价值映射」/「价值密码」Tab（总览 + 矩阵 + 六故事 + 缺口 + 版本表），`components/value-codes/*` 9 个组件 + `lib/value-codes.ts`
- [x] 测试：`services/api` 12 个文件 / 137 个用例全部通过；`pnpm typecheck` 全通过；
  `pnpm --filter @ldj/web build` 通过
- [x] 端到端冒烟 `scripts/smoke/phase9.mjs` **132 项断言全通过**，冒烟数据已清理

## Phase 10（已完成）

产品结构叙事 Product Architecture（基线 §5 结构叙事 / §45 Agent 7 八问 / §57 验收 / §62-6·§62-7 红线）。

- [x] `packages/schemas/src/product-architecture.ts`：九个角色（骨架 / 身份 / 香气 / 底气 / 第一口 / 中段 / 后半程 /
  记忆点 / 价值位，顺序固定不得增删重排）、§45 八个问题的固定映射（第 6 问「什么负责尾韵」不单独设字段）、
  §57 验收必答五项（骨架 / 香气 / 汤感 / 回甘 / 记忆点）、`PRODUCT_ARCHITECTURE_CONTRACT`（7 条规则 + 6 条红线）、
  `PRODUCT_ARCHITECTURE_DOWNSTREAM`（**空数组**：Phase 11 / 12 / 14 均已交付，不再保留 `PENDING` 占位）、
  纯函数 `buildProductArchitecture` / `productArchitectureCitations` / `productArchitectureSummary` /
  `productArchitectureGapReason` / `productArchitectureFactValue`
- [x] 数据库：`product_architectures`（九角色正文 + `narrative` + `evidence_ids`，唯一约束 `(product_id, version)`，
  随 `products` 级联删除）迁移 `0011_*.sql`
- [x] API `modules/product-architecture/`：合同自检、标签表、跨产品产品结构库（筛选 / 排序 / 分页）、产品级总览、
  版本列表、生成（201）、单版调阅、人工确认 / 备注（8 条路由，读需登录、写限 ADMIN / RESEARCHER）
- [x] 红线落地：只引用本产品已录入字段与 Value DNA（禁止新增任何原料或配方事实）；事实不足一律留空写缺口
  （GAP），不得用形容词补圆，也不得虚构研发关系；写实角色不足 3 个时价值位不成立、正文为空；
  证据可逐字回查（`citations` 的值必须原样出现在角色正文里）；单角色 Value DNA 引用 ≤ 3 条
- [x] Web：`/architecture` 产品结构库（跨产品总览 + 筛选 + 排序 + 分页）、产品详情「产品结构」Tab
  （合同卡 + 总览 + 九角色板 + §57 验收 + 缺口 + 版本表 + 人工确认），`components/product-architecture/*` 8 个组件 +
  `lib/product-architecture.ts`
- [x] 跨阶段回填：Phase 9 的 `product_architecture_story` 不再 `HANDOFF`，改为按 Phase 10 结构取正文
  （`READY` / `PARTIAL` / `GAP`）；`DELIVERED_PHASES` 推进到 `[1..10]`，研究阶段 `PRODUCT_ARCHITECTURE` 标记为已交付
- [x] 测试：`packages/schemas` 8 个文件 / 132 个用例（含 `product-architecture.test.ts` 17 个）、
  `services/api` 12 个文件 / 138 个用例、`pnpm typecheck` 8 个 workspace、`pnpm --filter @ldj/web build` 全通过
- [x] 端到端冒烟 `scripts/smoke/phase10.mjs` **134 项断言全通过**，冒烟数据已清理（含 `product_architectures` 清零）

## Phase 11（已完成）

配方哲学 Formula Philosophy（基线 §6 配方哲学 / §6.1 比例红线 / §46 Agent 8 / §57 验收 / §62-7 红线）。

- [x] `packages/schemas/src/formula-philosophy.ts`：五个分量（骨架 / 香气 / 回甘 / 汤感 / 收口，顺序固定）、
  §46 Agent 8 五个输出（`formula_strategy` / `ingredient_roles` / `taste_roles` / `design_goal` / `sales_explanation`）、
  §6.1 比例口径（`known_ratio` / `ratio_data` / `ratio_evidence` / `ratio_source`，`resolveFormulaRatio` +
  `extractRatioFromBlendDescription` + `validateRatioEvidence`）、`FORMULA_PHILOSOPHY_CONTRACT`（8 条规则 + 7 条红线）、
  `FORMULA_PHILOSOPHY_DOWNSTREAM`（**空数组**：Phase 12 / 14 均已交付，不再保留 `PENDING` 占位）、
  纯函数 `buildFormulaPhilosophy` / `formulaPhilosophyEvidenceGaps` / `formulaPhilosophySummary` /
  `formulaPhilosophyAcceptance` / `formulaPhilosophyCitations` / `containsRatioExpression`
- [x] 数据库：`formula_philosophies`（五分量正文 + `formula_strategy` + 角色 / 设计目标 / 成交层解释 + 比例四件套 +
  `evidence_ids`，唯一约束 `(product_id, version)`，随 `products` 级联删除）迁移 `0012_*.sql`
- [x] API `modules/formula-philosophy/`：合同自检、标签表、跨产品配方哲学库（筛选 / 排序 / 分页）、产品级总览、
  版本列表、生成（201）、单版调阅、人工确认 / 备注（8 条路由，读需登录、写限 ADMIN / RESEARCHER）
- [x] 红线落地：**没有确认比例时正文 / 设计目标 / 成交层解释里一个比例字样都不出现**（`60%`、`百分之六十`、`占比` 都算）；
  比例只能来自人工登记或已录入的拼配描述（需至少两个原料才成立），原料必须逐字回查到本产品原料类字段，否则 400 拒绝；
  事实不足的分量一律留空写缺口（GAP）；写实分量不足 2 个时设计逻辑不成稿；证据可逐字回查（`citations`）；
  生成时与回看时的缺口清单逐条一致（`formulaPhilosophyEvidenceGaps` 单一实现）
- [x] 跨阶段回填：Phase 9 的 `formula_philosophy_story` 不再 `HANDOFF`，改为取配方哲学设计逻辑正文
  （`READY` / `PARTIAL` / `GAP`，`VALUE_STORY_HANDOFF_PHASES` 清空）；`DELIVERED_PHASES` 推进到 `[1..11]`，
  研究阶段 `FORMULA_PHILOSOPHY` 标记为已交付
- [x] Web：`/formula-philosophy` 配方哲学库（跨产品总览 + 筛选 + 排序 + 分页 + 五分量字典）、
  产品详情「配方哲学」Tab（合同卡 + 总览 + 五分量板 + §57 验收 + 缺口 + 版本表 + 人工确认），
  `components/formula-philosophy/*` 8 个组件 + `lib/formula-philosophy.ts`
- [x] 测试：`packages/schemas` 9 个文件 / 152 个用例（含 `formula-philosophy.test.ts` 19 个）、
  `services/api` 12 个文件 / 139 个用例、`pnpm typecheck` 9 个 workspace、`pnpm --filter @ldj/web build` 全通过
- [x] 端到端冒烟 `scripts/smoke/phase11.mjs` **165 项断言全通过**，冒烟数据已清理（含 `formula_philosophies` 清零）

## Phase 12（已完成）

强成交话术 Strong Sales Copy（基线 §21 强成交话术 / §22 Level 5 王者话术 / §23 成交冲击力 /
§26 九种输出 / §27 三分钟八段 / §33 强度与价值重点 / §47 Agent 9 / §57 验收 / §62-11 红线）。

- [x] `packages/schemas/src/sales-copy.ts`（Phase 12 时 3435 行，Phase 13 并入强化器后 ≈4100 行）：
  五档成交强度 `COPY_INTENSITY_META`（研究 / 专业 / 强销售 /
  直播爆款 / 王者）、`IMPACT_SCORE_META`（八项：开场抓人 15 / 产品身份 15 / 高价值感 20 / 价格或标准锚定 15 /
  差异化 10 / 画面感 10 / 记忆点 10 / 收口 5）、`IMPACT_SCORE_BAND_META`（`REWRITE < 70` / `USABLE 70–79` /
  `EXCELLENT 80–89` / `CORE ≥ 90`）、`LEVEL5_REQUIREMENT_META`（§22 七项）、`SALES_COPY_OUTPUT_META`（§26 九种输出）、
  `SALES_COPY_AGENT9_OUTPUTS`（§47 十五项）、`MIN3_TIMELINE`（§27 八段）、`VALUE_FOCUS_META`（§33 八项）、
  `INTENSIFY_BUTTON_META`（§34 四档按钮，Phase 13 接线时复用）、`SALES_COPY_LIMITS`、
  `SALES_COPY_DOWNSTREAM`（**空数组**：Phase 13 / 14 均已交付，不再保留 `PENDING` 占位）、
  `SALES_COPY_CONTRACT`（8 条红线 + 10 条规则），纯函数 `buildSalesCopy` / `salesCopyReviewOf` / `salesCopyCitations` /
  `salesCopyEvidenceGaps` / `salesCopyOutputStatuses`
- [x] 数据库：`copy_outputs`（21 列：版本(唯一约束 `(product_id, version)`) / 生成时模式与强度 / §33 价值重点 /
  一版完整成稿 `record`(jsonb) / 排序冗余键 `impact_score_total` / `impact_score_band` / `level5_passed` /
  强化轮次 / 人工确认与备注），随 `products` 级联删除；迁移 **`0013_misty_plazm.sql`**
  （§36 只给出表名，字段按 §21–§26 输出清单落定）
- [x] API `modules/sales-copy/`：合同自检、标签表、跨产品「强成交话术库」（筛选 / 排序 / 分页）、产品级总览、
  版本列表、生成（201）、单版调阅、人工确认 / 备注（8 条路由，读需登录、写限 ADMIN / RESEARCHER）
- [x] 红线落地：**一个字都不能编**（只引用本产品已录入事实与 Value DNA，竞品事实不移植）；
  没有可靠价格锚点时不得写成 Benchmark Mode（`mode` 请求冲突直接 400）且价格高度叙事逐字改用 §22 标准句；
  无 `RND_CONFIRMED` 却暗示研发关系、凭空价格、虚构硬事实、禁止承诺（必涨 / 稳赚 / 保值）与受限措辞
  （复刻 X / 同款配方）一律判 RED；修辞本身不判 RED；已录入事实 < 4 条判 YELLOW 并在缺口清单写清先补哪条事实；
  **事实不足只压分不降级**（按逐字回查到的引用条数压到 84 / 74 / 68 / 55，总分 = min(八项之和, 上限)）
- [x] 落库即冻结：正文与 §23 评分 / §22 七项 / §24 合规 / §57 验收 / 引用清单一起写进 `copy_outputs`，
  日后事实或锚点变化不会把已交付的王者稿「改差」（要改就生成下一版，§62-15）；
  回看历史版本与生成侧同源（`salesCopyReviewOf()` 单一份实现）
- [x] Web：`/copy` 强成交话术库（跨产品总览 + 筛选 + 排序 + 分页，URL 同步 q / intensity / level5 / has_anchor / mode / sort / missing / page）、
  产品详情「强成交话术」Tab（合同卡 + 总览 + §23 评分 + §22 Level 5 板 + §26 九种输出 + 缺口 + 版本表 + 人工确认），
  `components/sales-copy/*` 9 个组件 + `lib/sales-copy.ts`
- [x] 跨阶段回填：`DELIVERED_PHASES` 推进到 `[1..12]`，研究阶段 `SALES_COPY` / `IMPACT_SCORE` 标记为已交付
  （`/api/health` 的 `phase` 文案同步为 Phase 12）；上游自建标准 / 价值映射 / 产品结构 / 配方哲学的 `downstream[]`
  不再登记已交付的 Phase 12（`status` 只有 `PENDING` 一种取值，不得把已交付阶段显示成未交付）
- [x] 测试：`packages/schemas` 10 个文件 / 178 个用例（含 `sales-copy.test.ts` 26 个，Phase 13 补到 40 个 →
  全仓 192 个）、`services/api` 12 个文件 / 139 个用例、`pnpm typecheck`、`pnpm --filter @ldj/web build` 全通过
- [x] 端到端冒烟 `scripts/smoke/phase12.mjs` **167 项断言全通过**，冒烟数据已清理（含 `copy_outputs` 清零）
- [x] 本阶段为**纯规则引擎**（合同 `engine.ai_wired = false`）：`SALES_COPYWRITER` 已登记未接线，
  生成侧不自动增强（`intensify_rounds` 恒为 0）；§34「再狠一点」是 Phase 13 的独立动作，不在生成时触发

## Phase 13（已完成）

牛逼化强化器「再狠一点」Intensify（基线 §7 牛逼化机制 / §34 牛逼化按钮 / §48 强化自检与阈值）。

- [x] `packages/schemas/src/sales-copy.ts`（≈4100 行，与 Phase 12 同一个文件、同一份画像）：
  `INTENSIFY_BUTTON_META` + `INTENSIFY_BUTTON_LABELS`（四档按钮：普通 / 强势 / 爆款 / 王者，
  按钮文案与 §21 强度短标签解耦）、`INTENSIFY_ACTION_META`（九个机械强化动作，**只换说法、不换事实**）、
  `INTENSIFY_ACTIONS_BY_LEVEL`（四档 → 累计动作清单：NORMAL 2 项 → KING 9 项）、
  `INTENSIFY_FACT_RULE`（强化只能是源版本的**子集**，多一条就拒绝落库）、
  `INTENSIFY_SELF_CHECK_META` + `intensifySelfCheckSchema`（§48 八项：开头 3 秒抓人 / 身份拉满 / 价值高度拉满 /
  产品结构讲清楚 / 短视频金句密度 / 记忆点立得住 / 成交推进收口 / 说明书味太重（负向项））、
  `salesCopyIntensifySchema`（请求体只有 `level` +
  可选 `record_id` / `notes`，**不接受任何事实字段**，strict 多余字段 400）、`salesCopyIntensifyResultSchema`
  （`level` / `intensity` / `source_intensity` / `round` / `previous` / `changed_elements` / `added_facts` /
  `self_check` / `record`，三条 refine 保证口径自洽；被写弱的引用只写进新版本自动备注，不进响应体）、
  纯函数 `intensifySalesCopy` / `intensifyFactDiff` / `intensifySelfCheckOf` / `intensifyTargetIntensity` /
  `intensifyGuardReason` / `changedElementsOf` / `salesCopyBodyOf`
- [x] 数据库：**不新增表**，复用 Phase 12 的 `copy_outputs`（`intensify_rounds` 列 Phase 12 已建、默认 0，无迁移）
- [x] API `modules/sales-copy/`：`POST /api/products/{id}/copy/intensify`（201，`requireAuth + requireRole(WRITE_ROLES)`），
  路由总数 8 → 9；四道闸门（`intensifyGuardReason()` + 服务层模式校验，顺序不计）：模式一致
  （不得跨 Benchmark / Category Creator 改写）、只升不降（同档 / 降档 400）、轮次 < 3
  （超出 400 + `details.max_auto_rounds = 3`）、单产品 20 版封顶
- [x] 强化算法：**用更高档画像把同一份事实重讲一遍**（`buildSalesCopy` 同一实现，`targetIntensity = max(按钮映射档, 源强度)`），
  同一锚点冻结结论；每次强化 = **新增一个版本**（`version = 最大版本 + 1`、`intensify_rounds = 源版本 + 1`），
  旧版本原样保留（§62-15）
- [x] 不增事实的机械保障：源正文与新正文各跑一次 `salesCopyCitations()` 做集合差，`added_facts` 非空直接 400
  「强化不得新增任何事实」（§34）；被写弱的引用写进新版本自动备注，旧版本仍可回查
- [x] §48 阈值与自检：Level 4 ≥ 85 / Level 5 ≥ 90（`MIN_IMPACT_SCORE_BY_INTENSITY`）；未达标**不阻断**，
  如实 `passed: false` 并逐项写清缺什么；分数下降同样保留版本，不静默回滚
- [x] Web：产品详情「强成交话术」Tab 的「再狠一点」按钮组真正可用（四档，禁用规则与 `intensifyGuardReason()` 同源：
  源版本未生成、同档 / 降档、已达 3 轮、已达 20 版时 disabled，理由写在按钮 `title` 上）；
  强化结论以信息卡呈现「v 源 → v 新（分数变化）+ 按钮档位 + 第 N / 3 轮 + 改写几处 + 新增事实 0 条（§34）
  + §48 八项自检逐条」，并列出这一轮**被改写的位置**（响应体没有「失去的事实」字段，少讲的引用在新版本备注里）；
  版本表显示「第 N 轮 / 3 轮」并标出生成稿（未强化）
- [x] 跨阶段回填：`DELIVERED_PHASES` 推进到 `[1..13]`，研究阶段 `INTENSIFY` 标记为已交付（phase 13）；
  `/api/health` 的 `phase` 文案同步为 Phase 13；`SALES_COPY_DOWNSTREAM` 只剩 14（Phase 14 交付后清空）；
  `services/api/src/modules/products/routes.ts` 的 501 占位清单清空（规格 §37 接口已全部接线）
- [x] 测试：`packages/schemas` 10 个文件 / **192 个用例**（含 `sales-copy.test.ts` 40 个，Phase 13 新增 14 个）、
  `services/api` 12 个文件 / 139 个用例、`pnpm typecheck` 9 个 workspace、`pnpm --filter @ldj/web build` 全通过
- [x] 端到端冒烟 `scripts/smoke/phase13.mjs` **99 项断言全通过**，冒烟数据已清理（含 `copy_outputs` 清零）；
  回归 phase3–phase12 全部 0 失败（phase5 / 7 / 11 / 12 的期望值已随交付同步）
- [x] 本阶段同样为**纯规则引擎**（`ai_wired: false`）：`COPY_INTENSIFIER` Prompt 已登记未接线，
  强化不调用 AI、不接受任何事实输入

## Phase 14（已完成）

事实审核与人工审批 Fact Review / Human Approval（基线 §24 三层标记 / §25 研发与配方措辞边界 / §49 十三项重点与三档风险 /
§53 逐句审核表 / §57 验收与阻断 / §62-14 RED 禁止发布 / §62-15 所有版本必须保留）。

- [x] `packages/schemas/src/fact-review.ts`（871 行）+ `fact-review-evidence.ts`：
  `FACT_REVIEW_SPEC_REF = "§24 / §25 / §49 / §53"`、`CLAIM_TYPE_LABELS` / `CLAIM_TYPE_HINTS`（FACT 事实 /
  INTERPRETATION 解释 / RHETORIC 修辞）、`RISK_LEVEL_LABELS` / `RISK_LEVEL_HINTS`（GREEN 可发布 / YELLOW 需人工确认 /
  RED 禁止发布）、`FACT_REVIEW_FOCUS_LABELS`（§49 十三项：对标关系 / 研发关系 / 配方 / 原料 / 树龄 / 山头 / 年份 /
  历史 / 价格 / 市场第一 / 最贵 / 唯一 / 投资回报）、`FACT_REVIEW_SENTENCE_COLUMNS`（§53 五列：
  句子 / Claim Type / Risk / Evidence / 修改建议）、`FACT_REVIEW_ENGINE_INFO`（`FACT_REVIEWER` / `ai_wired: true` /
  `rule_engine_authoritative: true`）、`FACT_REVIEW_LIMITS`（单成稿 20 个审核版本）、`FACT_REVIEW_CONTRACT`
  （13 项焦点 + 10 条规则 + `rhetoric_not_fraud` / `red_blocks_approval` / `rhetoric_kept` / `keep_all_versions` /
  `rnd_requires_confirmation` / `ai_can_only_tighten`）、请求体 strict `factReviewGenerateSchema`（`record_id` /
  `use_ai` / `notes`）与 `factReviewDecisionSchema`（`version` / `note`）、纯函数 `factReviewSentences` /
  `factReviewEvidenceOf` / `buildFactReview` / `factReviewRecord` / `mergeFactReviewAi`
- [x] 数据库：`generated_claims`（一句一行：成稿版本 / 审核版本 / 引擎 / 评审级冻结结论 / 逐句三层标记与风险 /
  问题与修改建议 / 是否阻断 / 审批状态与留痕，唯一约束 `(copy_output_id, review_version, sentence_index)`）+
  `claim_evidence`（逐句证据：`evidence_kind` / `source_ref` / `source_id` / `excerpt` / `traceable`），
  随产品与成稿级联删除；迁移 **`0014_slow_nightmare.sql`**（§36 只给表名，字段按 §24 / §49 / §53 落定）
- [x] API `modules/fact-review/`：`GET /api/fact-review/contract`、`GET /api/fact-review/labels`、
  `GET /api/products/{id}/fact-review`、`GET /api/products/{id}/fact-review/versions`、
  `POST /api/products/{id}/fact-review/generate`（201）、`POST /api/products/{id}/fact-review/approve`、
  `POST /api/products/{id}/fact-review/reject`、`GET /api/products/{id}/fact-review/{reviewId}`（8 条路由，
  读需登录、写限 ADMIN / RESEARCHER）；注册顺序把 `/versions` `/generate` `/approve` `/reject` 放在
  `/:reviewId` 之前，避免被通配段吃掉。§37 未列事实审核路由，按既有模块范式自建（详见 `docs/api.md` §22）
- [x] 红线落地：**修辞不是事实造假**（身份句 / 画面句 / 反问句按 `RHETORIC` / `GREEN` 处理，不因为不是字面事实就判 RED）；
  §49 十三项重点逐句带回命中；`FACT` 句必须有可逐字回查的出处；必涨 / 稳赚 / 保值 / 未来达到某价格 / 固定投资回报、
  无 `RND_CONFIRMED` 却暗示研发关系、无可靠价格锚点却写具体价格高度故事 → RED；
  **存在任何一条 RED 就禁止审批**（`approve` 返回 400 + `error.details.blocking_sentences`），
  `reject` 任何时候可用；审批只改状态、不改逐句判定与原文
- [x] AI 接线（Phase 14 起 `FACT_REVIEWER` 不再返回 501）：`ai_wired = true`，`use_ai: true` 时叠加 Agent 11 标注，
  但**规则引擎权威、AI 只能加严**（`ai_can_only_tighten`）：AI 判出的 RED 一律保留、规则判出的 RED 不会被洗白，
  句数 / 文本对不上整份回落纯规则；Mock / AI 失败时回落纯规则并在 `warnings` 写明
- [x] 版本与上限：每次 `generate` 新增一个审核版本（`review_version` 递增），旧审核逐句原样保留（§62-15）；
  单产品单一成稿 20 版封顶，第 21 次 400；`record_id` 指向不存在 / 跨产品的成稿返回 400（与既有模块范式一致）
- [x] 跨阶段回填：`DELIVERED_PHASES` 推进到 `[1..14]`，研究阶段 `FACT_REVIEW` / `HUMAN_APPROVAL` 标记为已交付（phase 14）；
  `/api/health` 的 `phase` 文案同步为 Phase 14；自建标准 / 价值映射 / 产品结构 / 配方哲学 / 强成交话术的 `*_DOWNSTREAM`
  **全部清空**（已交付阶段不再登记 `PENDING` 占位条目）；`FACT_REVIEW_DOWNSTREAM` 当时只留 Phase 15，
  Phase 15 交付后也已清空为 `[]`
- [x] Web：产品详情「事实审核」Tab（合同卡 + 总览 + §53 逐句表 + 缺口 + 版本列表 + 审批 / 否决），
  `components/fact-review/*` 6 个组件 + `lib/fact-review.ts`；证据中心文案同步为 Phase 14 已交付
- [x] 测试：`packages/schemas` 11 个文件 / **228 个用例**（含 `fact-review.test.ts` 36 个）、
  `services/api` **13 个文件 / 158 个用例**、`pnpm typecheck` 9 个 workspace、`pnpm --filter @ldj/web build` 全通过
- [x] 端到端冒烟 `scripts/smoke/phase14.mjs` **94 项断言全通过**，冒烟数据已清理
  （含 `generated_claims` / `claim_evidence` 清零）
- [x] 本阶段是**规则引擎为权威 + AI 只加严**的特例（其余四个生成型 Agent 至今仍是纯规则、`ai_wired: false`）；
  `FACT_REVIEWER` 是第一个真正接线的 AI 入口，接线前它一直返回 `501 + details.phase`

## Phase 15（已完成）

主播中心 / 经销商中心与导出（基线 §31 一级导航 / §51 / §52 / §53 / §57 / §60）。**已完成**。

基线 §60 对 Phase 15 只给了一行，导出细节按既有模块范式自建；§51 / §52 的十项清单逐字落地。

- [x] `packages/schemas/src/delivery.ts`（≈1100 行）：`DELIVERY_CONTRACT`（含 §51 十项 `HOST_CENTER_SLOT_META` /
  §52 十项 `DEALER_CENTER_SLOT_META` / 导出格式与范围 / 发布闸门 / 七条铁律）、`DELIVERY_LIMITS`、
  `DELIVERY_DOWNSTREAM`（**空数组**：§60 到此为止）、六态闸门 `buildDeliveryGate()` / `deliveryGateLabel()` /
  `deliveryGateTone()`、两个中心的只读重排 `buildHostCenterView()` / `buildDealerCenterView()`、
  导出渲染 `renderDeliveryExport()`、`hostCenterRowSchema` / `deliveryReviewSummarySchema` / `copyIntensitySchema`
- [x] `services/api/src/modules/delivery/`：`routes.ts`（6 条路由）+ `delivery.service.ts`；
  全部只 `requireAuth`（交付层只读、派生视图，不需要写权限，§62-15），
  路由注册顺序 `/api/delivery/*` 在 `/api/products/:id/*` 之前（静态段优先）
- [x] 数据库：**不新增表**（§62-15 派生视图）——直接由 `copy_outputs` + `generated_claims` 现算，
  历史版本复用既有 `copy/versions` 与 `fact-review/versions`
- [x] 唯一一份发布闸门：主播中心、经销商中心、跨产品排产列表、导出读同一个 `ready`；
  判据是**最新一版成稿 + 这一版自己的最新审核**（上一版审批通过不算当前版通过，杜绝假绿灯）；
  闸门未通过时两个中心与列表仍返回 200（十格全空 + `gate.reason` / `next_action`），导出返回 409
- [x] 六条只读路由：`GET /api/delivery/contract`、`GET /api/delivery/labels`、`GET /api/host-center`
  （query strict：`page` / `pageSize`(≤100) / `q`(≤200) / `ready`(`z.stringbool()` 三态)，排序
  `ready desc, product_name, id`）、`GET /api/products/{id}/host-center`、`GET /api/products/{id}/dealer-center`、
  `GET /api/products/{id}/delivery/export`（`format=markdown|text` × `scope=host|dealer|all`，大小写敏感；
  闸门未通过 → 409 `CONFLICT` + `details.blocking_sentences`；超 `maxExportChars` → 400）
- [x] 前端：`lib/delivery.ts`（6 个 hooks + `gateStateOf` / `slotCopyText` / `downloadExportFile` / 兜底标签）、
  `components/host-center/*` 7 个组件、`components/dealer-center/DealerCenterPanel.tsx`、
  `components/delivery/*` 3 个组件（合同卡 / 跨产品排产表 / 版本历史）；
  新增页面 `/hosts`（跨产品排产：筛选 `q` / `ready` 三态 / 分页，条件进 URL）、`/dealers`（经销商资料）、
  `/versions`（历史版本）；产品详情新增「历史版本」与「最终交付」两个 Tab
  （后者是 §51 主播中心十项与 §52 经销商中心十项的分段切换 + 导出卡），`IMPLEMENTED_TABS` 收到 15 个
- [x] 跨阶段回填：`DELIVERED_PHASES` 推进到 `[1..15]`；`/api/health` 的 `phase` 文案同步为
  `Phase 15｜主播中心 / 经销商中心与导出（Phase 1–15 已交付）`；`FACT_REVIEW_DOWNSTREAM` 清空为 `[]`
- [x] 测试：`packages/schemas` 12 个文件 / **261 个用例**（含 `delivery.test.ts` 33 个）、
  `services/api` **14 个文件 / 179 个用例**（含 `delivery.test.ts` 21 个）、`pnpm typecheck` 9 个 workspace、
  `pnpm --filter @ldj/web build` 全通过
- [x] 端到端冒烟 `scripts/smoke/phase15.mjs` **125 项断言全通过**，冒烟数据已清理（业务表清零，
  `value_codes` 保留 16 行字典属正常）
- [x] 本阶段是**只读交付层**：不新增表、不改写正文、不生成第二份话术；导出不使用模型改写正文（§62-15）

## MVP 验收（基线 §57、§58）

固定 fixture：`龙德记六星孔雀 / 2026 / 生茶 / 布朗山 / 大树春茶 / 烟香 / 浓强 / 回甘快 / 生津强`。

自动测试必须保证：

1. 不自动生成 300 年古树；
2. 不自动生成班章（除非输入有）；
3. 不自动生成“复刻 2003 六星孔雀”；
4. 不自动说“同款配方”；
5. 不自动编研发关系；
6. 可以生成产品结构；
7. 可以生成配方哲学；
8. 可以用高度修辞；
9. 没有锚点时不降级成平庸文案；
10. Level 5 至少含 3 个可独立传播金句。

覆盖率：第 1、2、5 条在 Phase 1 已通过「无输入即 null」的实现与测试覆盖（`services/api/tests/products.test.ts`）；
第 3、4 条在 Phase 2 由研发参考写入拦截覆盖（`services/api/tests/product-records.test.ts` 的 §25 用例：
无 `RND_CONFIRMED` 证据时「复刻 X」「同款配方」等表述直接拒绝写入）；
第 1、2、5、8 条在 Phase 3 由 Value DNA 逐字回溯过滤与 `facts/normalize` 试跑覆盖；
Phase 4 追加两条延伸红线（不编造来源、抽取不写产品事实，`scripts/smoke/phase4.mjs`）；
第 9 条在 Phase 8 由 `scripts/smoke/phase8.mjs` 覆盖（无达标锚点时强制 `CATEGORY_CREATOR` 并输出自建标准 / 风格身份证 /
价值逻辑，事实不足时明确 `INSUFFICIENT` 且不输出成交表达，而不是降级成平庸文案）。
Phase 12 进一步强化第 9 条：无可靠价格锚点时价格叙事逐字改用 §22 标准句（`NO_ANCHOR_STANDARD_SENTENCE`）且不挂主锚点 id，
事实不足只按逐字回查到的引用条数压分（84 / 74 / 68 / 55）而不降级成平庸文案——事实齐备的 fixture 实测 `facts_used = 5`、
总分 94、`GREEN`、`acceptance.passed = true`（`scripts/smoke/phase12.mjs`）。
第 6 条（可以生成产品结构）在 Phase 10 由 `packages/schemas/tests/product-architecture.test.ts` 与 `scripts/smoke/phase10.mjs` 覆盖
（九角色只引用已录入事实、事实不足留空写缺口、§57 验收按写实角色数判定）；
第 7 条（可以生成配方哲学）在 Phase 11 由 `packages/schemas/tests/formula-philosophy.test.ts` 与
`scripts/smoke/phase11.mjs` 覆盖（五分量只引用已录入事实、不确认比例就不出现比例字样、§57 验收按写实分量数判定）；
第 8 条（可以用高度修辞）在 Phase 12 由 `packages/schemas/tests/sales-copy.test.ts` 覆盖
（价值位 / 成交层允许极强修辞、修辞本身不判 RED，但命中禁止承诺 / 虚构硬事实 / 凭空价格仍判 RED）；
第 10 条（Level 5 至少含 3 个可独立传播金句）在 Phase 12 由 `LEVEL5_REQUIREMENT_META` 的
`minQuotableLines` 与 `scripts/smoke/phase12.mjs` 覆盖（七项缺一即 `level5.satisfied = false`）。
第 1–5 条（不编硬事实、不虚构研发关系与配方）在 Phase 14 追加一层**发布前闸门**：事实审核逐句把成稿标成
FACT / INTERPRETATION / RHETORIC 并判 GREEN / YELLOW / RED，§49 十三项重点逐句带回命中，
命中 RED 的成稿**禁止审批与发布**（`packages/schemas/tests/fact-review.test.ts` + `scripts/smoke/phase14.mjs`），
与 Phase 1–12 的「生成侧不编」形成前后两道防线。
Phase 15 把这道闸门做成**唯一一份对外发布闸门**：主播中心 / 经销商中心 / 跨产品排产列表 / 导出读同一个
`ready`，闸门要求「最新一版成稿 + 这一版人工审批通过 + 逐句无 RED」，§62-14（RED 禁止发布）在交付侧
再兜一次底（`packages/schemas/tests/delivery.test.ts` + `scripts/smoke/phase15.mjs`：
无成稿 / 未审核 / 有 RED / 已否决 / 待审批五种状态都出不了最终资料，导出返回 409 且不产出半成品文件）。
