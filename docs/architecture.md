# 架构说明

## 1. 分层

```text
apps/web           前端（Phase 1：登录、产品 CRUD；Phase 2：产品详情 15 个 Tab；Phase 3：Value DNA；
                   Phase 4：研究工作台 / 证据中心；Phase 5：候选池与相似度面板、高价值茶数据库；
                   Phase 6：市场价格中心、产品价格证据面板与价格汇总；
                   Phase 7：产品锚点面板（模式判定 / 三种锚点 / 重建 / 人工选定主锚点）、跨产品高价值锚点库；
                   Phase 8：自建高端标准面板（挂在产品详情「高价值锚点」Tab 内，紧跟模式判定卡：
                   合同卡 + 总览与模式判定 + 自建标准六轴 + 风格身份证 + 价值逻辑 + 版本列表与人工确认）；
                   Phase 9：价值密码库 `/value-codes`（跨产品总览 + 筛选排序分页 + Code 字典）、产品详情
                   「价值映射」/「价值密码」Tab（合同卡 + 总览 + 16 Code 落位矩阵 + 六类价值故事 + 缺口 + 版本表）；
                   Phase 10：产品结构库 `/architecture`（跨产品总览 + 筛选排序分页）、产品详情「产品结构」Tab
                   （合同卡 + 总览 + 九角色板 + §57 验收 + 缺口 + 版本表）；
                   Phase 11：配方哲学库 `/formula-philosophy`（跨产品总览 + 筛选排序分页 + 五分量字典）、产品详情
                   「配方哲学」Tab（合同卡 + 总览 + 五分量板 + §57 验收 + 缺口 + 版本表）；
                   Phase 12 / 13：强成交话术库 `/copy`、产品详情「强成交话术」Tab（合同卡 + 总览 + §23 评分 +
                   §22 Level 5 板 + §26 九种输出 + 缺口 + 版本表 + 四档「再狠一点」按钮组与 §48 自检）；
                   Phase 14：产品详情「事实审核」Tab（合同卡 + 总览 + §53 逐句表 + 缺口 + 版本表 + 审批 / 否决）；
                   Phase 15：交付中心——主播中心 `/hosts`（跨产品排产表 + 筛选 / 分页）、经销商资料 `/dealers`、
                   历史版本 `/versions`，产品详情「历史版本」/「最终交付」Tab（§51 主播中心十项与 §52 经销商中心
                   十项切换 + 导出卡））
services/api       HTTP API（Fastify + Zod + JWT）；模块目录：
                   modules/{auth,brands,products,product-records,value-dna,prompts,research,candidates,prices,anchors,
                   category-creator,value-codes,product-architecture,formula-philosophy,sales-copy,fact-review,delivery}
                   + lib/{value-dna}.ts，research 内为 search-plan / research / source / crawler 四个 service，
                   candidates 内为 similarity（评分与去重）与 candidates（列表 / 重建 / 评审）两个 service，
                   prices 内为 market-prices（来源重建 / 人工登记 / 异常值 / 汇总）service，
                   anchors 内为 anchors.service（三种锚点重建 / 模式判定 / 列表 / 人工维护）service，
                   category-creator 内为 category-creator.service（§17 判定复用 / 自建标准生成 / 版本与人工确认）service
                   value-codes 内为 value-codes.service（16 Code 落位 / 六类价值故事 / 缺口 / 跨产品总览 / 版本与人工确认）service
                   product-architecture 内为 product-architecture.service（九角色结构叙事 / §57 验收 / 版本与人工确认）service
                   formula-philosophy 内为 formula-philosophy.service（五分量设计逻辑 / §6.1 比例口径 / §57 验收 / 版本与人工确认）service
                   sales-copy 内为 sales-copy.service（十三格成稿 / §23 评分 / §22 Level 5 / §24 合规 / §34「再狠一点」/ §48 自检）service
                   fact-review 内为 fact-review.service（逐句三层标记 / §49 三档风险与 13 项焦点 / 证据落库 / RED 阻断审批 / 版本与人工审批）service
                   delivery 内为 delivery.service（唯一一份发布闸门 / §51 主播中心十项 / §52 经销商中心十项 / 跨产品排产列表 / Markdown 与纯文本导出）service
packages/schemas   领域类型、枚举、阈值常量（核心功能锁定）
packages/database  Drizzle schema、迁移、种子（PostgreSQL）
packages/ai        AI Provider Adapter（OpenAI / Mock）+ 输出 schema 校验
packages/search    SearchProvider Adapter（Tavily / Mock）
packages/prompts   11 个 Prompt Key 注册表（Phase 3 起与 `prompt_versions` 表联动：文件为 v1 基线，DB 负责版本 / 生效 / 回滚）
packages/shared    环境变量、错误模型、分页
database/          迁移 SQL 与种子数据
prompts/           Agent 1–11 Prompt 正文
```

目录差异说明（与基线 §59 推荐目录的对照，属实现落位选择，不是功能裁剪）：

```text
services/crawler/        未单独建服务：抓取逻辑落在 services/api/src/modules/research/crawler.service.ts
                         并在 routes.ts 以依赖注入方式替换（测试用 config.crawler 注入假实现）
services/research-worker/ 未单独建服务：研究流水线落在 modules/research/research.service.ts，按阶段同步执行
packages/scoring/        未单独创建：相似度评分落在 packages/schemas/src/similarity.ts（纯函数）+ 
                         services/api/src/modules/candidates/similarity.service.ts（facets 与候选归并）
database/seeds/          未单独建目录：种子在 packages/database/src/seed.ts
```

## 2. 请求链路

```text
Fastify 路由 → Zod 校验 → Service（业务规则）→ Drizzle → PostgreSQL
                      ↘ AppError → 统一错误结构 { error: { code, message, details } }
```

## 3. 鉴权与权限

- 访问令牌：HS256 JWT（`jose`），默认 30 分钟；
- 刷新令牌：随机串，仅存 SHA-256 哈希，默认 30 天，刷新即轮换，旧令牌立即失效；
- 密码：`scrypt`（`node:crypto`），避免 Windows 上原生模块编译依赖；
- 角色：`ADMIN` / `RESEARCHER` / `COPYWRITER` / `VIEWER`；`internal_cost` 仅 ADMIN 与 RESEARCHER 可见；
- bootstrap：系统内无用户时，首个注册账号自动成为 ADMIN。

## 4. 数据模型（Phase 1–15）

```text
users(id, email, password_hash, name, role, status, last_login_at, created_at, updated_at)
sessions(id, user_id, refresh_token_hash, user_agent, ip, expires_at, revoked_at, created_at)
brands(id, name, description, created_at, updated_at)
products( §10 全套录入字段 + §35.1 成交增强字段 )
product_facts( §11 事实清单：fact_key / fact_label / fact_group / fact_value / fact_status / 证据 / 确认人 )
tasting_profiles( §10.4 二十项感官 + taster_name / tasted_at / conclusion / version )
r_and_d_references( §35.2 研发参考：参考名称 / 类型 / 说明 / 证据 / 验证状态 )
prompt_versions( §50 Prompt 版本：prompt_key / version / content / is_active / based_on_version )
search_plans( §12 搜索策略：plan(jsonb) / query_count / generator / dna_version / dropped / warnings )
sources( §41 来源：url / canonical_url / domain / source_kind / 抓取状态与正文 / 抽取状态与最近一次抽取 )
source_extractions( §41 抽取版本：extraction(jsonb) / dropped / warnings / has_content / price_count / provider )
research_jobs( §55 研究任务：status / stages(jsonb) / summary(jsonb) / 触发人与时间 )
comparable_candidates( §13/§36 候选：身份键 / 十维相似度(jsonb) / 分档 / 评审状态 / 来源与价格证据 )
market_offers( §14/§15 价格证据：价格性质 / 数值与原话 / 单位与规格 / 归属 / 证据分与分档明细(jsonb) / 异常值与排除 )
value_anchors( §16/§55 高价值锚点：类型(最高价值/高相似度/强成交) / 候选与价格引用 / 相似度与价格证据分 /
               价格百分位 / 强成交六项明细(jsonb) / 名次 / 是否主锚点 / 是否人工 / 对标理由 / 快照 )
category_creator_profiles( §4.2/§17/§29 自建高端标准：版本(唯一约束 (product_id, version)) / 触发条件 /
               生成时模式与就绪度 / 支撑轴计数 / 自建标准(jsonb，六标准轴) / 风格身份证(jsonb) /
               价值逻辑(jsonb) / 缺口清单 / 事实与 DNA 引用 / 下游交接(jsonb) / 人工确认 )
value_codes( §18 Value Code 字典：16 行，code / label / definition / dimensions / requirement /
               contribution / evidence_refs / time_dependent / spec_ref，由 syncDictionary 幂等写入 )
product_value_codes( §18/§19/§20/§30 价值映射：版本(唯一约束 (product_id, version)) / 生成时模式与解析来源 /
              16 个 Code 落位(jsonb，含 evidence / contribution / status / statement / gap) / 状态分布(jsonb) /
              六类价值故事(jsonb) / 缺口清单 / 事实与 DNA 引用 / 下游交接(jsonb) / 人工确认 )
product_architectures( §5/§45/§57 产品结构叙事：版本(唯一约束 (product_id, version)) / 九个角色正文 /
               value_role 叙事 / 各版事实引用(evidence_ids jsonb) / 人工确认与备注 )
formula_philosophies( §6/§6.1/§46 配方哲学：版本(唯一约束 (product_id, version)) / 五个分量正文 /
               设计逻辑(formula_strategy) / 原料与滋味角色(jsonb) / 设计目标 / 成交层解释 /
               比例四件套(known_ratio / ratio_data / ratio_evidence / ratio_source) / 各版事实引用(evidence_ids jsonb) /
               人工确认与备注 )
copy_outputs( §21/§22/§23/§26/§27 强成交话术：版本(唯一约束 (product_id, version)) / 生成时模式与强度 /
               价值重点八项(jsonb) / 一版完整成稿 record(jsonb：十三格骨架 + 九种输出 + §23 评分 +
               §22 七项 + §24 合规 + §57 验收 + 引用清单) / 冗余键(impact_score_total / impact_score_band /
               level5_passed) / 强化轮次 / 人工确认与备注 )
generated_claims( §24/§49/§53 事实审核逐句台账：一句一行 —— 成稿引用(copy_output_id) 与成稿版本 /
               审核版本(review_version，只增不删) / 引擎(RULE · RULE_AI) / 评审级冻结结论(overall_risk /
               publishable / rnd_confirmed / has_reliable_price_anchor / price_high_story_ready / facts_used /
               compliance / evidence_gaps / warnings) / 逐句行(sentence_index / text / claim_type / risk /
               issue / suggestion / is_blocking) / 人工审批(approval_status / approval_note /
               reviewed_by / reviewed_at) | 唯一约束 (copy_output_id, review_version, sentence_index) )
claim_evidence( §53 逐句证据：句子归属(claim_id) / 证据类型(evidence_kind) / 来源引用(source_ref) /
               来源 id(source_id) / 逐字摘录(excerpt) / 是否可回溯(traceable) )
```

`products` 已包含基线 §35.1 的全部新增字段：

```text
benchmark_mode_preference, copy_intensity_default,
r_and_d_reference_enabled, r_and_d_reference_notes,
formula_philosophy (jsonb), product_architecture (jsonb)
```

数据库枚举已预留：`research_mode`、`resolved_research_mode`、`claim_type`、`risk_level`、`fact_status`（含 `RND_CONFIRMED`）、`price_type`、`anchor_type`、`value_code_key`、`value_code_status`、`rnd_reference_type`、`research_job_status`；
Phase 2 新增 `product_fact_group`；Phase 3 新增 `prompt_key`；Phase 4 新增 `source_kind`、`source_fetch_status`、`source_extraction_status`（研究阶段状态与阶段码以文本存储，便于后续 Phase 追加阶段而无需迁移枚举）。

Phase 2 的产品记录三层数据职责：

```text
product_facts       后台事实底座：任何进入话术的事实都必须在这里有状态与证据（§11 / §62-15）
tasting_profiles    品饮证据：同一产品可保留多份、多品饮人、多时间点的感官档案
r_and_d_references  研发关系声明：只记录「参考了谁、以什么方式、证据是否成立」，禁止移植竞品事实（§25 / §62-5）
```

`claims_allowed` 由 API 依据「`verification_status = RND_CONFIRMED` + 证据」计算，Phase 12 话术生成必须以此为前置条件。

Phase 3–4 的研究侧职责：

```text
products.value_dna / value_dna_meta   11 维度价值 DNA 与其版本指纹（字段或事实变化即 stale）
prompt_versions                        Prompt 版本治理：文件 v1 落库、派生新版本、切换生效、回滚，历史不删
search_plans                           检索策略快照：只由已录入事实推导，可重新生成、可追溯 DNA 版本
sources                                来源台账：去重按规范化 URL，抓取成功/失败都如实记录正文与错误
source_extractions                     抽取版本：只产出证据与候选，绝不写产品事实，未 force 时复用
research_jobs                          研究流水线任务与阶段明细，未交付阶段标 implemented=false
```

Phase 5 的候选侧职责：

```text
comparable_candidates   候选池单一事实源：唯一约束 (product_id, identity_key) 保证「同款茶只存一条候选」；
                        similarity 存十维明细与 unknown_dimensions（未知维度按 0 分，不猜）；
                        observed_prices 只存来源原话，绝不参与打分（§62-4）
```

Phase 6 的价格侧职责：

```text
market_offers   价格证据台账：price_type 只按原文判定（挂牌 ≠ 成交）；unit_scope 写明整件 / 提 / 饼，
                weight_g 缺失一律 NULL、不做 357g / kg 反推（整件 ≠ 单饼）；evidence(jsonb) 存五项加权明细，
                attribution 区分 CANDIDATE / SOURCE_UNATTRIBUTED / MANUAL；异常值只标记不删除
```

价格与相似度物理分离：价格证据写在 `market_offers`，候选相似度分档只看 `comparable_candidates.similarity`，
`price_in_similarity` 恒为 `false`（§62-6）；Phase 7 锚点同时要求候选相似度 ≥ 70 且可靠价格证据分 ≥ 75。

Phase 7 的锚点侧职责：

```text
value_anchors   锚点台账：一条锚点 = 「一个候选 + 一条（可空）价格证据 + 判定依据」，
                三种锚点各有门槛（§16.1 相似度 ≥ 70 且价格证据 ≥ 75 / §16.2 价格前 20% / §16.3 六项加权），
                主锚点全产品唯一（ensurePrimary 顺序：最高价值 → 高相似度 → 强成交）；
                人工锚点（is_manual）在重建时默认保留，人工判断永远优先于自动排序；
                SOURCE_UNATTRIBUTED / 异常值 / 被排除的价格一律不进锚点（§62-2 / §62-7）
```

Phase 8 的自建标准侧职责与数据流：

```text
category_creator_profiles   自建高端标准台账：一条记录 = 「一个版本 + 一套标准 + 一份价值逻辑 + 一份缺口清单」。
                            version 在同一产品内唯一且只增不减，历史版本全部保留（§62-15）；
                            standard.items 固定六轴顺序 FRAME → DEPTH → IDENTITY → FIRST_IMPRESSION → FINISH → CRAFT，
                            UNKNOWN 轴的 statement 必须为 null 并写明 gap（宁可不讲，不得编，§62-7）；
                            is_confirmed 只做人工确认标记，不改写正文、不产生新版本

数据流（Phase 8 不新增流水线阶段，是 Phase 7 模式判定之后的分支）：
  GET /api/products/{id}/benchmark-mode   §17 判定（只读，不触发重建）
        ↓  mode / resolved_by / mode_reason
  inferCategoryTrigger(resolved_by)       仅 NO_RELIABLE_ANCHOR → 同名触发；其余 → USER_OPT_OUT
        ↓  调用方可在 generate 时显式覆盖 trigger
  buildCategoryCreatorDraft(已录入事实 + Value DNA + 六标准轴定义)   纯函数，只读库里已有字段
        ↓  standard / style_identity / value_logic / evidence_gaps / fact_refs / value_dna_refs
  category_creator_profiles 落库（版本递增，历史保留）
        ↓  downstream：空数组（Phase 10 / 11 / 12 / 14 均已交付，交接关系写在合同 rules 里）

为什么不做成独立 Tab：基线 §32 的 13 个 Tab 里没有 Category Creator，它是「高价值锚点」Tab 的模式分支
（无对标时进入的路径），因此挂在 AnchorsPanel 内、紧跟 AnchorModeCard，而不是新增导航项。
```

Phase 9 的价值映射侧职责与数据流：

```text
value_codes           Code 字典：16 个 Code 的顺序与定义来自 §18，落库只为前端展示与版本可追溯；
                      代码里的唯一事实来源是 packages/schemas/src/value-codes.ts 的 VALUE_CODE_META

product_value_codes   价值映射台账：一条记录 = 「一个版本 + 16 个 Code 的落位 + 六类价值故事 + 一份缺口清单」。
                      version 在同一产品内唯一且只增不减，历史版本全部保留（§62-15）；
                      UNKNOWN 的 Code 不得带前台表达（statement = null），只能写 gap（§62-7）；
                      TIME_DEPENDENT 的 statement / safe_expression 必须逐字等于 §19 固定句式；
                      NOT_HAVE 必须指到具体已录入事实（negation 规则命中），不能把「没录」写成「不具备」；
                      is_confirmed 只做人工确认标记，不改写正文、不产生新版本

数据流（Phase 9 不新增流水线阶段，是在 Phase 7 / 8 的模式判定之后做价值拆解）：
  GET /api/products/{id}/benchmark-mode   复用 §17 判定（只读，不重复实现）
        ↓  mode / resolved_by / mode_reason
  buildValueMapping(已录入事实 + Value DNA + 16 Code 定义 + 六故事定义)   纯函数，只读库里已有字段
        ↓  codes（16 条落位）/ code_counts / stories / evidence_gaps / fact_refs / value_dna_refs
product_value_codes 落库（版本递增，历史保留）
        ↓  stories：产品结构故事取 Phase 10 的产品结构正文，配方哲学故事取 Phase 11 的配方哲学设计逻辑正文
           （两者都没有则 GAP 留空，不写简化版）；下游 Phase 10 / 11 / 12 / 14 已全部交付，downstream 为空数组

跨产品只读：`GET /api/value-codes` 只做总览矩阵（筛选 / 排序 / 分页），生成与人工确认一律回到产品内
（与 Phase 6 `/market-prices`、Phase 5 `/high-value-db` 的分工一致）。
```

Phase 10 的产品结构侧职责与数据流：

```text
product_architectures   产品结构台账：一条记录 = 「一个版本 + 九个角色正文 + 价值位叙事 + 各版事实引用」。
                        version 在同一产品内唯一且只增不减，历史版本全部保留（§62-15）；
                        九个角色顺序固定（骨架 / 身份 / 香气 / 底气 / 第一口 / 中段 / 后半程 / 记忆点 / 价值位），
                        不得增删或重排（§5 / §45）；
                        GAP 角色正文为空字符串并写清缺哪个字段——事实不足宁可留空，不得用形容词补圆（§62-7）；
                        价值位是 RHETORIC（允许极限修辞），其余八个是 INTERPRETATION（解释，不是说明书，§24）；
                        is_confirmed 只做人工确认标记，不改写正文、不产生新版本

数据流（Phase 10 不新增流水线阶段，是在 Phase 9 的价值映射之后把事实摆正成产品结构）：
  buildProductArchitecture(已录入事实 + Value DNA)   纯函数，只读库里已有字段，不读数据库、不调用 AI
        ↓  roles（9 个：text / status / citations / evidence_refs / gap）
           + architecture（九个角色正文）+ narrative（价值位叙事）+ role_counts + acceptance（§57）
           + evidence_gaps + fact_refs / value_dna_refs
  product_architectures 落库（版本递增，历史保留）+ products.product_architecture 只作最新快照
        ↓  Phase 9 的 product_architecture_story 取这里的正文（§57 通过 → READY / 角色不足 → PARTIAL / 无结构 → GAP）；
           下游 Phase 11 / 12 / 14 已全部交付，downstream 为空数组

证据口径：`citations` 形如 `product.mountain=布朗山`，值必须逐字出现在角色正文里，
生成与回查共用 productArchitectureCitations()；单角色 Value DNA 引用 ≤ 3 条。

跨产品只读：`GET /api/product-architecture` 只做总览矩阵（筛选 / 排序 / 分页），生成与人工确认一律回到产品内
（与 Phase 9 `/value-codes`、Phase 6 `/market-prices` 的分工一致）。
```

Phase 11 的配方哲学侧职责与数据流：

```text
formula_philosophies   配方哲学台账：一条记录 = 「一个版本 + 五个分量正文 + 设计逻辑 + 比例口径 + 各版事实引用」。
                       version 在同一产品内唯一且只增不减，历史版本全部保留（§62-15）；
                       五个分量顺序固定（骨架 / 香气 / 回甘 / 汤感 / 收口），不得增删或重排（§6 / §46）；
                       GAP 分量正文为空数组并写清缺哪个字段——事实不足宁可留空，不得用形容词补圆（§62-7）；
                       sales_explanation 是 RHETORIC（允许极强修辞），formula_strategy / design_goal 是 INTERPRETATION；
                       **没有确认比例时正文里一个比例字样都不能出现**（§6.1，含从已录入事实里剔除带比例的原话）；
                       is_confirmed 只做人工确认标记，不改写正文、不产生新版本

数据流（Phase 11 不新增流水线阶段，是在 Phase 10 的产品结构之后讲「这款茶是怎么设计的」）：
  resolveFormulaRatio(人工登记 ratio_data / 拼配描述里的完整配比)   纯函数，原料名必须逐字回查到本产品原料类字段
        ↓  known_ratio / ratio_data / ratio_evidence / ratio_source（problems 非空直接 400，不落库）
  buildFormulaPhilosophy(已录入事实 + Value DNA + 产品结构最新一版 + 比例)   纯函数，只读库里已有字段，不调用 AI
        ↓  components（5 个：texts / citations / evidence_refs / gap）+ formula（五分量正文 + 设计逻辑）
           + ingredient_roles / taste_roles / design_goal / sales_explanation + acceptance（§57）
           + formulaPhilosophyEvidenceGaps（生成侧与回看侧同一实现）
  formula_philosophies 落库（版本递增，历史保留）+ products.formula_philosophy 只作最新快照
        ↓  Phase 9 的 formula_philosophy_story 取这里的正文（验收通过 → READY / 分量不足 → PARTIAL / 无正文 → GAP）；
           下游 Phase 12 / 14 已全部交付，downstream 为空数组

证据口径：`citations` 形如 `product.mountain=布朗山`，值必须逐字出现在分量正文里，
生成与回查共用 formulaPhilosophyCitations()；比例证据（ratio_evidence）指向具体来源字段原文。

跨产品只读：`GET /api/formula-philosophy` 只做总览矩阵（筛选 / 排序 / 分页），生成与人工确认一律回到产品内
（与 Phase 10 `/architecture`、Phase 9 `/value-codes` 的分工一致）。
```

Phase 12 的强成交话术侧职责与数据流：

```text
copy_outputs   强成交话术台账：一条记录 = 「一个版本 + 一版完整成稿（正文 + 全部派生结论）」。 
               version 在同一产品内唯一且只增不减，历史版本全部保留（§62-15）；
               正文与 §23 评分 / §22 七项 / §24 合规 / §57 验收 / 引用清单**一起落库冻结**，
               日后产品事实或锚点变化不会把已交付的王者稿「改差」——要改就生成下一版；
               intensity 是本版属性（§21 五档，默认 Level 4，强化时只升不降）；intensify_rounds 由 Phase 13 推进
               （生成稿恒 0，强化版本逐轮 +1，上限 3）；
               is_confirmed 只做人工确认标记，不改写正文、不产生新版本

数据流（Phase 12 不新增流水线阶段，是把上游成稿组装成能直接讲的话）：
  loadContext（产品已录入事实 + Value DNA + §17 锚点结论 + 产品结构 + 配方哲学 + 自建标准 + 价值映射 + 研发证据）
        ↓  assertModeRequest：请求里的 mode 与 §17 判定冲突直接 400（没有可靠锚点就不能写成 Benchmark，§62-10）
  buildSalesCopy(上述上下文 + 强度 + §33 价值重点)   纯函数，只读库里已有字段，**不调用 AI Provider**
        ↓  headline（一句话定位 / 身份定义 / 价值故事 / 价格或标准叙事）
           + quotes（核心 5 句 + 备用 20 句）+ 七大卖点 + scripts（15 秒 / 30 秒 / 60 秒 / 3 分钟）
           + level5_release / dealer_copy / objections + output_statuses（§26 九种输出逐项状态）
           + impact_score（§23 八项 → 分档）+ level5（§22 七项）+ compliance（§24 / §25 风险分级）
           + acceptance（§57）+ evidence_gaps + fact_refs / value_dna_refs / upstream_refs
  copy_outputs 落库（版本递增，历史保留）

无锚点口径：`anchor.has_reliable_price_anchor = false` 时价格高度叙事必须逐字换成 §22 标准句
（「不是用别人现成的价格给自己撑腰」），且不得挂主锚点 id——没有对标不等于文案变弱（§4.2 / §17 / §62-10）。
事实不足压分而不编：正文逐字回查到的事实 < 4 条时总分按引用条数压到 84 / 74 / 68 / 55，缺口清单写清先补哪条事实。

证据口径：`citations` 形如 `product.mountain=布朗山`，值必须逐字出现在正文里；
回看历史版本走 salesCopyReviewOf() / salesCopyEvidenceGaps() / salesCopyCitations() / salesCopyOutputStatuses()
同一份实现（生成侧与回看侧同源，不会出现「生成时 6 条事实、回看时 4 条」）。

跨产品只读：`GET /api/sales-copy` 只做总览矩阵（筛选 / 排序 / 分页），生成与人工确认一律回到产品内
（与 Phase 11 `/formula-philosophy`、Phase 10 `/architecture` 的分工一致）。
```

Phase 13 的「再狠一点」牛逼化强化侧职责与数据流：

```text
copy_outputs   同一个台账，不新增表：一次强化 = 一条**新版本**（version = 最大版本 + 1、
               intensify_rounds = 源版本 + 1，上限 3）。强化不是「就地改写」——旧版本原样冻结保留（§62-15）；
               intensity 只升不降：同档 / 降档直接 400（§34 的按钮是「再狠一点」，不是「换个语气」）；
               轮到第 4 次必须先人工处理（400 + details.max_auto_rounds = 3，§48），单产品 20 版封顶

数据流（Phase 13 不新增流水线阶段，是在 Phase 12 的成稿上「再狠一点」）：
  POST /api/products/{id}/copy/intensify   请求体只有 level（NORMAL / STRONG / VIRAL / KING）；
        ↓  **不接受任何事实输入**（多余字段按 Zod v4 strict 直接 400，§34）；先过四道闸门（顺序不计）：
           模式一致（不得跨 Benchmark / Category Creator 改写）· 只升不降 · 轮次 < 3 · 版本数 < 20
  buildSalesCopy(同一份上下文, targetIntensity = max(按钮映射档, 源强度))   纯函数：
        同一份事实、同一锚点冻结结论，只是用更高档画像重讲一遍
        ↓  新正文 + §23 评分 / §22 Level 5 七项 / §24 合规 / §57 验收 + §33 价值重点
  intensifyFactDiff（源正文与新正文各跑一次 salesCopyCitations()，做集合差）
        ↓  added_facts 非空 → 400「强化不得新增任何事实」（§34）；
           被写弱的引用写进新版本自动备注（少讲了哪几条，旧版本仍可回查）
  intensifySelfCheckOf（§48 Agent 10 八项）→ copy_outputs 落库（新版本，历史版本全部保留）

§48 阈值：Level 4 ≥ 85 / Level 5 ≥ 90（MIN_IMPACT_SCORE_BY_INTENSITY）；未达标**不阻断**，
如实 `passed: false` 并逐项写清缺什么；分数下降同样保留版本，不静默回滚（§62-15）。
强化结果 `spec_ref = "§7 / §34 / §48"`，与生成侧的 `§21 / … / §47` 分开记账。

纯规则：强化同样是 `RULE_BASED`（`COPY_INTENSIFIER` Prompt 已登记未接线，与 Phase 12 同一口径）。
```

Phase 14 的事实审核与人工审批侧职责与数据流：

```text
generated_claims    逐句审核台账：一句一行，sentence_index 只在本版内递增；评审级结论（overall_risk /
                    publishable / rnd_confirmed / has_reliable_price_anchor / price_high_story_ready /
                    facts_used / compliance / evidence_gaps / warnings）每行同值，
                    逐句行（text / claim_type / risk / issue / suggestion / is_blocking）各写各的；
                    审批只改 approval_status / approval_note / reviewed_by / reviewed_at，**不改逐句判定与原文**；
                    唯一约束 (copy_output_id, review_version, sentence_index)，review_version 只增不删（§62-15）

claim_evidence      逐句证据：一行 = 一条机械逐字回查出来的出处（source_ref 形如 product.mountain / dna.origin，
                    excerpt 是逐字摘录，traceable 表示能否在本产品自己的资料里点回）；
                    不存「AI 补充的证据」——证据只能来自已录入事实 / Value DNA / 上游成稿正文 / 研发记录（§24 / §49）

数据流（Phase 14 不新增流水线阶段，是在 Phase 13 冻结成稿之后的最后一道闸门）：
  POST /api/products/{id}/fact-review/generate   请求体只有 record_id（可选）/ use_ai / notes
        ↓  取一版已冻结成稿（copy_outputs.record），不动产品事实、不改成稿
  buildFactReview(成稿逐句 + 已录入事实 + Value DNA + 研发记录 + 锚点冻结结论)   纯函数，规则引擎权威
        ↓  逐句 claim_type（§24 三层）/ risk（§49 三档）/ issue / suggestion / is_blocking
           + 逐句 evidence（§53 五列里的 Evidence 列）+ evidence_gaps / warnings
  mergeFactReviewAi(规则结果, Agent 11 标注)   **AI 只能加严**（§62-14）：
        句数 / 文本对不上整份回落纯规则；AI 判出的 RED 一律保留，规则判出的 RED 不会被洗白
        ↓  Mock / AI 失败 → 回落纯规则并在 warnings 写清
  generated_claims + claim_evidence 落库（新 review_version，旧版本逐句原样保留）
        ↓  人工审批：POST /approve（有 RED 直接 400 + details.blocking_sentences）/ POST /reject
           审批不改写任何一句文案——要改就回强成交话术页生成下一版
```

单产品单一成稿最多 20 个审核版本（`FACT_REVIEW_LIMITS.maxVersionsPerCopy`），第 21 次 `generate` 返回 400；
`FACT_REVIEW_DOWNSTREAM` 为空数组——Phase 15（主播中心 / 经销商中心 / 导出）已交付，下游交接写在合同 `rules` 里。

Phase 15 的交付中心侧职责与数据流：

```text
交付层是**只读派生视图**（§62-15）：不新增表、不改写正文、不生成第二份话术。
唯一一份发布闸门在 @ldj/schemas 的 buildDeliveryGate()——六态（无成稿 / 待审核 / RED 阻断 / 已否决 /
待人工审批 / 可交付），判据是**最新一版成稿 + 这一版自己的最新审核**（历史审批不参与当前判断，避免假绿灯）。

数据流（Phase 15 不新增流水线阶段，是在 Phase 14 审批通过之后把成稿重排成能直接用的资料）：
  copy_outputs（最新一版成稿）+ generated_claims（这一版的最新审核）
        ↓  buildHostCenterView / buildDealerCenterView   纯函数，按 §51 / §52 十项逐格取正文
  主播中心十项 / 经销商中心十项（每一格带回原文与出处；缺口如实留空并指向上游补齐，§64）
        ↓  renderDeliveryExport（MARKDOWN / TEXT × host / dealer / all）
  最终资料包（闸门未通过直接 409 + blocking_sentences，绝不产出半成品文件）

跨产品排产列表（GET /api/host-center）读同一个 ready：排序 ready desc, product_name, id，
六条路由全部只 requireAuth（交付层只读，导出闸门由 §53 / §57 决定，与角色无关）。
```

## 5. 后续阶段将新增的表（基线 §35、§54）

`knowledge_documents`、`knowledge_chunks`（§60 阶段清单之后的龙德记知识库）。
（`sources` / `source_extractions` / `research_jobs` / `prompt_versions` 在 Phase 3–4 落地，
`comparable_candidates` 在 Phase 5 落地，`market_offers` 在 Phase 6 落地，`value_anchors` 在 Phase 7 落地，见上表。）
另：自建高端标准表 `category_creator_profiles` 已在 Phase 8 落地（见上表与 Phase 8 小节）；
Value Code 字典 `value_codes` 与价值映射表 `product_value_codes` 已在 Phase 9 落地（见上表与 Phase 9 小节）；
产品结构表 `product_architectures` 已在 Phase 10 落地（见上表与 Phase 10 小节）；
配方哲学表 `formula_philosophies` 已在 Phase 11 落地（见上表与 Phase 11 小节）；
强成交话术表 `copy_outputs` 已在 Phase 12 落地（见上表与 Phase 12 小节，字段按 §21–§26 输出清单落定，
§36 只给出表名）；事实审核表 `generated_claims` / `claim_evidence` 已在 Phase 14 落地
（见上表与 Phase 14 小节，迁移 `0014_slow_nightmare.sql`，§36 只给表名的部分到此全部落定）。
Phase 15 的交付中心（主播中心 / 经销商中心 / 导出 / 历史版本）是**只读派生视图**，
**不新增任何表**：直接由 `copy_outputs` + `generated_claims` 现算，历史版本复用既有成稿与审核版本接口
（§62-15）；知识库表属于 §60 阶段清单之外的后续工作，尚未落地。

## 6. 研究流水线（基线 §55）

```text
Create Product → Normalize Facts → Value DNA → Architecture Seeds → Search Plan
→ Search Web → Fetch Sources → Extract Entities → Dedupe → Candidate Pool
→ Similarity Score → Search Prices → Price Evidence → Outlier Detection → Build Anchors
→ IF reliable anchor: BENCHMARK MODE ELSE: CATEGORY CREATOR MODE
→ Value Codes → Value Mapping → Product Architecture → Formula Philosophy
→ Strong Sales Copy → Impact Score → Intensify → Fact Review → Human Approval
→ Delivery（只读派生：主播中心 / 经销商中心 / 导出，不落库）
```

已交付并在流水线里标记 `implemented=true` 的阶段：Phase 3–14 的 Normalize Facts / Value DNA / Search Plan /
Search Web / Fetch Sources / Extract Entities / Dedupe / Candidate Pool / Similarity Score / Search Prices /
Price Evidence / Outlier Detection / Build Anchors / Value Codes / Value Mapping / Product Architecture /
Formula Philosophy / Strong Sales Copy / Intensify / Fact Review / Human Approval；
`Impact Score` 与 `Strong Sales Copy` 的阶段码同属 Phase 12（评分与成稿同源，见 Phase 12 小节），
`Intensify` 属 Phase 13（见 Phase 13 小节，强化复用 buildSalesCopy 重讲一遍）；
`Fact Review` / `Human Approval` 属 Phase 14（见 Phase 14 小节，逐句三层标记 + RED 阻断审批）
（未交付阶段必须显式标注 Phase，不得显示为已完成）。`Delivery`（主播中心 / 经销商中心 / 导出）属 Phase 15
（见 Phase 15 小节），它不推进 `research_jobs.progress`（交付层只读派生，不新增流水线阶段）。

## 7. 缺失第三方 Key 的处理

`packages/ai` 与 `packages/search` 均提供 Adapter + Mock：

```text
AI_PROVIDER=mock|openai        OPENAI_API_KEY 为空时自动回退 Mock
SEARCH_PROVIDER=mock|tavily    TAVILY_API_KEY 为空时自动回退 Mock
```

Mock 输出始终带 `[MOCK]` 标记，避免被误当作真实研究结论。
