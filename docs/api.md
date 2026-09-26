# API 说明（Phase 1–15 + AI 对话工作台）

Base URL：`http://127.0.0.1:4400`
统一错误结构：

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "请求参数不合法", "details": [] } }
```

错误码：`VALIDATION_ERROR` / `UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND` / `CONFLICT` / `NOT_IMPLEMENTED` /
`INTERNAL_ERROR` / `AI_UNAVAILABLE`（AI 出稿失败，用户那条需求已保存）。

## 1. 健康检查

```http
GET /api/health
```

## 2. 鉴权

```http
POST /api/auth/register     # 无用户时为 bootstrap（自动 ADMIN）；之后需 ADMIN
POST /api/auth/login
POST /api/auth/refresh      # 轮换刷新令牌，旧令牌立即失效
POST /api/auth/logout
GET  /api/auth/me           # 需要 Bearer
```

## 3. 品牌

```http
GET    /api/brands
GET    /api/brands/{id}
POST   /api/brands              # ADMIN / RESEARCHER
PATCH  /api/brands/{id}         # ADMIN / RESEARCHER
DELETE /api/brands/{id}         # ADMIN
```

## 4. 产品

```http
GET    /api/products?page&pageSize&q&tea_type&mountain&brand_id&benchmark_mode_preference&sort
GET    /api/products/{id}
POST   /api/products            # ADMIN / RESEARCHER
PATCH  /api/products/{id}       # ADMIN / RESEARCHER（每次更新 version+1）
DELETE /api/products/{id}       # ADMIN
```

创建产品请求体遵循基线 §10（基础资料 / 原料 / 工艺 / 感官 / 研发关系），必填：`product_name`、`year`、`tea_type`、`weight_g`。
未提供的字段一律存 `null`，系统不会自动补出树龄、山头、配方等信息。

## 5. 已规划接口（Phase 1–15 已接线，全仓无 501 占位）

基线 §37 的能力清单里的接口，从 Phase 1 起以 `501 NOT_IMPLEMENTED + details.phase` 占位，
避免核心功能被静默裁剪；实现随各 Phase 逐个接线，调用方一直可以把 501 当作「未到实现阶段」。
Phase 2 的 `rnd-references`、Phase 7 的 `anchors`、Phase 9 的 `value-codes`、Phase 10 的 `architecture`、
Phase 11 的 `formula-philosophy`、Phase 12 的强成交话术与 Phase 13 的「再狠一点」
（`POST /api/products/{id}/copy/intensify`）都已从该清单移除并正式可用；Phase 14 的事实审核与人工审批、
Phase 15 的交付中心（主播中心 / 经销商中心 / 导出，见 §23）不在 §37 的路由清单里，按既有模块范式自建——
**当前没有任何接口返回 501**。

## 6. 产品事实清单（Phase 2，基线 §11）

```http
GET    /api/products/{id}/facts?page&pageSize&fact_status&fact_group&fact_key
POST   /api/products/{id}/facts                 # ADMIN / RESEARCHER
GET    /api/products/{id}/facts/{factId}
PATCH  /api/products/{id}/facts/{factId}        # ADMIN / RESEARCHER
DELETE /api/products/{id}/facts/{factId}        # ADMIN
```

请求体：`fact_key`、`fact_value` 必填；`fact_label`、`fact_group` 可省略（按 §10 事实键目录自动归类）；
`fact_status` 省略时按 `UNCONFIRMED` 存储（不猜测确认状态）。

状态治理：

- 六态：`OFFICIAL_CONFIRMED` / `INTERNAL_CONFIRMED` / `TASTING_CONFIRMED` / `RND_CONFIRMED` / `SUPPLIER_PROVIDED` / `UNCONFIRMED`；
- 除 `UNCONFIRMED` 外，必须提供 `evidence_note` 或 `evidence_source_id`，否则返回 `VALIDATION_ERROR`；
- `OFFICIAL_CONFIRMED` 仅 `ADMIN` 可判定，其他角色返回 `FORBIDDEN`；
- 确认类状态会记录 `confirmed_by` / `confirmed_at`。

## 7. 品饮档案（Phase 2，基线 §10.4）

```http
GET    /api/products/{id}/tasting-profiles?page&pageSize
POST   /api/products/{id}/tasting-profiles      # ADMIN / RESEARCHER
GET    /api/products/{id}/tasting-profiles/{profileId}
PATCH  /api/products/{id}/tasting-profiles/{profileId}  # ADMIN / RESEARCHER
DELETE /api/products/{id}/tasting-profiles/{profileId}  # ADMIN
```

覆盖 §10.4 二十项感官字段（`dry_leaf_aroma` … `leaf_bottom`），另有 `taster_name`、`tasted_at`、
`conclusion`、`version`。二十项感官与结论全空时视为空档案，返回 `VALIDATION_ERROR`。
一个产品可保留多份品饮档案（不同品饮人 / 不同时间）；档案与 `products` 上的主感官字段互不自动覆盖。

## 8. 研发参考（Phase 2，基线 §35.2 / §25）

```http
GET    /api/products/{id}/rnd-references?page&pageSize&reference_type&verification_status
POST   /api/products/{id}/rnd-references        # ADMIN / RESEARCHER
GET    /api/products/{id}/rnd-references/{referenceId}
PUT    /api/products/{id}/rnd-references/{referenceId}  # ADMIN / RESEARCHER
DELETE /api/products/{id}/rnd-references/{referenceId}  # ADMIN
```

请求体：`reference_product_name`、`reference_type`（`sensory` / `formula_structure` / `positioning` /
`concept` / `other`）、`description`、`verification_status`；可选 `reference_product_id`、
`evidence_note`、`evidence_source_id`。

规则：

- 参考产品不能是本产品自身（`VALIDATION_ERROR`）；
- `verification_status` 非 `UNCONFIRMED` 时必须带证据，否则 `VALIDATION_ERROR`；
- §25 语言拦截：说明文字含「复刻／同款配方／原配方再现／某大师配方／经典秘方／按照某款配方做」等表述时，
  只有 `RND_CONFIRMED` + 证据才允许写入，否则 `VALIDATION_ERROR` 并回传命中的 `restricted_phrases`；
- 响应含 `claims_allowed` 布尔值，标识该条研发参考是否满足对外声明条件（§62-5/6：不自动移植竞品事实、不虚构研发关系）。

## 9. Value DNA（Phase 3，基线 §9）与 Agent 1 事实归一

```http
GET  /api/products/{id}/value-dna                # 需登录：返回 11 维度 DNA + meta（版本 / 过期状态 / 来源计数）
POST /api/products/{id}/value-dna/generate       # ADMIN / RESEARCHER：重新生成（use_ai 可选）
POST /api/products/{id}/facts/normalize          # ADMIN / RESEARCHER：Agent 1 归一试跑，不写库
```

规则：

- 规则引擎先跑：DNA 只能由「已录入字段 / `product_facts` / `tasting_profiles` / `r_and_d_references`」推导，
  库里没有的硬事实（树龄、山头、年份、获奖、大师、研发关系、配方比例）一律不出现；
- AI 只允许补充「源文本可逐字回溯」的条目，回溯失败的条目进入 `dropped` 并记入 `warnings`；
- `value_dna_meta` 记录版本号、生成器（`RULE_BASED` / `AI_ASSISTED`）、来源计数与来源指纹，字段变化即标记为 `stale`；
- `POST /facts/normalize` 只返回候选与丢弃原因，永远不写产品事实（写事实仍需走 §6 的事实接口）。

## 10. Prompt 管理（Phase 3，基线 §50）

```http
GET  /api/prompts                        # 11 个 Prompt Key 概览（当前版本 / 数量 / 是否已落库）
GET  /api/prompts/{key}                  # 单个 Prompt 详情（含当前生效正文）
GET  /api/prompts/{key}/versions         # 版本列表（全部保留，不覆盖）
POST /api/prompts/{key}/versions         # ADMIN：以某历史版本为基底派生新版本
POST /api/prompts/{key}/activate         # ADMIN：切换生效版本（也用于 rollback）
POST /api/prompts/{key}/test-run         # ADMIN / RESEARCHER / COPYWRITER：试跑并按 schema 校验输出
```

文件基线（`prompts/*.md`）在第一次访问时自动落库为 `v1`；此后所有修改都产生新版本，历史版本永不删除（§62-12/13/15）。

## 11. 搜索策略（Phase 4，基线 §12 / §40 Agent 2）

```http
GET  /api/products/{id}/search-plan            # 需登录：已落库策略；未生成时返回 stored=false 预览 + 警告
POST /api/products/{id}/search-plan/generate   # ADMIN / RESEARCHER → 201
```

策略覆盖 9 类检索意图：`exact_queries` / `concept_queries` / `origin_queries` / `flavor_queries` /
`taste_queries` / `positioning_queries` / `price_queries` / `auction_queries` / `transaction_queries`。

规则：

- 查询词只能来自已录入字段与已确认事实，不得凭空出现树龄 / 山头 / 获奖 / 大师等硬事实（§62-1/8）；
- 响应带 `spec_ref`（`§12 / §40`）、`dna_version`、`query_count`、`generator`（规则引擎 / AI 辅助）与 `stale`；
- 重新生成产生新版本记录，历史策略保留（§62-15）。

## 12. 研究流水线（Phase 4，基线 §55 / §56）

```http
GET  /api/products/{id}/research/progress        # 22 个阶段的进度（含中文标签 / 所属 Phase / 是否已交付）
GET  /api/products/{id}/research/runs?limit=     # 历史任务（默认 20，最大 50）
POST /api/products/{id}/research/runs            # ADMIN / RESEARCHER → 201
GET  /api/products/{id}/research/runs/{jobId}
```

`POST /research/runs` 请求体（全部可选）：`use_ai`、`max_queries`、`max_results_per_query`、`max_sources`、
`auto_extract`、`query_types`。本轮实际执行：事实归一 → Value DNA → 搜索策略 → 检索 → 抓取 → 网页抽取；
未交付阶段（候选池及之后）在进度里保持 `PENDING` 且 `implemented=false`，不假装完成。

规则：

- 检索依赖 `SEARCH_PROVIDER`；Mock Provider 无 fixture 时返回 0 条结果，系统**不会**据此编造来源（§62-1）；
- 进度响应含 `mode_notes`，明确 Benchmark Mode 与 Category Creator Mode 的分支条件；
- 每个任务记录状态、阶段明细、耗时与触发人，历史任务保留（§62-15）。

## 13. 来源登记与网页抽取（Phase 4，基线 §41 Agent 3）

```http
GET    /api/products/{id}/sources?q&fetch_status&extraction_status&source_kind&page&pageSize
POST   /api/products/{id}/sources                     # ADMIN / RESEARCHER；新建 201 / 复用已存在 200
GET    /api/products/{id}/sources/{sourceId}
DELETE /api/products/{id}/sources/{sourceId}          # ADMIN → 204
POST   /api/products/{id}/sources/{sourceId}/fetch    # { force? }：抓取正文；失败也返回 200 并如实记录
POST   /api/products/{id}/sources/{sourceId}/extract  # { use_ai?, force? } → 201，产生新抽取版本
GET    /api/products/{id}/sources/{sourceId}/extractions
```

规则：

- URL 去重按规范化地址：同一 URL 重复登记返回 200 并复用同一条来源，不靠重复登记制造证据厚度（§62-5）；
- 抓取失败（超时 / 非 2xx / 正文过大）如实写入 `fetch_status=FAILED` 与 `fetch_error`，不伪造正文；
- 抽取**只落证据**：结果进入 `source_extractions`（价格证据 / 事实候选 / 丢弃项 / 警告），
  绝不自动写入产品事实；产品事实必须走 §6 的事实接口并带状态与证据（§41 / §62-5）；
- 未带 `force` 时复用上一次抽取结果；带 `force` 时产生新版本，旧版本保留（§62-15）；
- 抓取边界（§41）：超时 15s、单页最大 2MB、正文最长 60000 字符（`SOURCE_LIMITS`）。

## 14. 候选池与相似度（Phase 5，基线 §13 / §36 / §42 Agent 4）

```http
GET    /api/candidates/contract                       # §13 合同自检：十维权重 / 分档 / 状态标签 / 「价格不参与相似度」
GET    /api/candidates?product_id&band&status&q&min_score&sort&page&pageSize   # §36 跨产品高价值茶数据库
GET    /api/products/{id}/candidates?band&status&q&min_score&sort&page&pageSize
POST   /api/products/{id}/candidates                  # ADMIN / RESEARCHER → 201，手工登记候选
POST   /api/products/{id}/candidates/rebuild          # ADMIN / RESEARCHER → 201，由来源抽取重建候选池
GET    /api/products/{id}/candidates/{candidateId}
PATCH  /api/products/{id}/candidates/{candidateId}    # ADMIN / RESEARCHER，人工评审
DELETE /api/products/{id}/candidates/{candidateId}    # ADMIN → 204
```

候选字段与评分：

- 十维权重（合计 100）：生熟茶一致 18 / 产品概念与命名体系 18 / 茶区山头 15 / 原料 13 / 香气风格 10 /
  滋味骨架 8 / 市场定位 7 / 工艺 5 / 规格形态 3 / 年代关系 3；
- 分档：`<55 REJECT`、`55–69 PERIPHERAL_REFERENCE`（外围参考）、`70–84 VALID_COMPARABLE`（有效对标）、
  `85–100 CORE_COMPARABLE`（核心对标）；状态：`PENDING_REVIEW` / `APPROVED` / `REJECTED` / `ARCHIVED`；
- **价格不参与相似度**：`observed_prices` 只作为价格证据保留，评分维度里没有价格项（`price_in_similarity: false`）；
- 未提供维度按 0 分计入总分，并进入 `unknown_dimensions`（未知 ≠ 相似），响应同时给出中文说明；
- 候选身份键 = `品牌|产品名|年份|规格|制式`，同一产品内按该键去重（数据库唯一约束），重复登记返回 `CONFLICT`
  并在 `error.details.candidate_id` 给出已存在候选。

`POST /candidates/rebuild` 请求体（全部可选）：`use_ai`、`min_score`、`recompute`、
`keep_reviewed`（默认 `true`，保留已评审结果）。
重建只覆盖「来源派生」候选（来源抽取状态为 `EXTRACTED` / `PARTIAL` 且带产品名）；手工登记的候选不受影响。
单产品候选上限 400 条（`CANDIDATE_LIMITS.maxCandidatesPerProduct`），命中上限时响应 `reached_limit: true`。
`min_score` 只是本次构建的入库门槛：低于阈值的候选照样入库，但分档被标记为 `REJECT`，
**原始总分不被改写**，警告里写明「阈值 X 分：总分 Y 低于阈值（原始分档 …）」，便于审计；
响应同时给出 `below_min_score`、`band_counts`、`stats`（`sources_considered` / `skipped_no_name`）。

`PATCH` 请求体：`status`（`APPROVED` / `REJECTED` / `ARCHIVED`）、`review_note`；`APPROVED` 记录评审人与时间。
研究流水线的 `CANDIDATE_POOL` 与 `SIMILARITY_SCORE` 两个阶段在本轮 `POST /research/runs` 中真实执行，
并在进度里标记 `implemented=true`；`ANCHOR_BUILD` 已在 Phase 7 交付（见第 16 节），
`VALUE_CODES` 及之后仍为 `PENDING` + `implemented=false`。

## 15. 市场价格与价格证据分（Phase 6，基线 §14 / §15 / §16.1）

```http
GET    /api/prices/contract                              # 价格合同自检：三条红线 + 五项权重 + 分档
GET    /api/market-offers?product_id&price_type&attribution&evidence_band&is_outlier&q&sort&page&pageSize
GET    /api/products/{id}/market-offers?price_type&attribution&evidence_band&is_outlier&q&sort&page&pageSize
POST   /api/products/{id}/market-offers                  # ADMIN / RESEARCHER → 201，人工登记价格证据
POST   /api/products/{id}/market-offers/rebuild          # ADMIN / RESEARCHER → 201，由来源抽取重建价格证据
GET    /api/products/{id}/price-summary                  # 价格汇总（Phase 7 锚点据此判断有无可靠价格锚点）
GET    /api/products/{id}/market-offers/{offerId}
PATCH  /api/products/{id}/market-offers/{offerId}        # ADMIN / RESEARCHER，人工修正（补规格 / 改单位 / 排除）
DELETE /api/products/{id}/market-offers/{offerId}        # ADMIN → 204
```

读需登录，写限 `ADMIN` / `RESEARCHER`，删除限 `ADMIN`：价格证据决定对外成交表达，只读与文案账号不得改口径。

口径与红线：

- 五项加权（合计 100）：成交 / 挂牌性质明确 25、来源可信度 25、产品身份确定 20、时间新鲜度 15、多来源印证 15；
  分档 `>=75 STRONG`（强证据）/ `60–74 USABLE`（可用但谨慎）/ `<60 WEAK`（弱）；
- **挂牌价 ≠ 成交价**：`price_type` 按原文判定，挂牌证据带「不得表述为成交」提醒，汇总里成交与挂牌分开计数，绝不混算；
- **整件价 ≠ 单饼价**：`unit_scope` 写明整件 / 提 / 饼，整件价必须自带重量才能算等价，缺规格一律 NULL，不做 357g / kg 反推；
- **价格不参与相似度**：价格证据与候选相似度物理分离（`price_in_similarity: false`），价格只进 `observed_prices`；
- 归属 `attribution`：`CANDIDATE`（挂到身份键相同的候选）/ `SOURCE_UNATTRIBUTED`（来源没写产品身份，身份键为 null，
  不与其他来源互相印证）/ `MANUAL`（人工登记，重建不会覆盖）；
- 异常值只标记不删除：同组样本 `<4` 时不判，阈值 `max(MAD × 3, 中位数 × 0.35)`，清单写明样本量与中位数以便复核；
- 未提供字段一律 NULL，未知维度按 0 分；来源事实不移植（§62 铁律）。

`POST /market-offers` 请求体：`price_type`、`value`、`currency`、`quote`（价格必须带原话）、`unit_scope`、
`weight_g`、`pieces_per_case`、`observed_at`、`source_id`、`subject_name`、`subject_brand`、`subject_year`、`note`。
`PATCH` 只允许 `unit_scope` / `weight_g` / `pieces_per_case` / `manual_note` / `is_excluded`（严格 schema，多余字段 400），
改规格或单位会重算证据分与等价价。
`POST /market-offers/rebuild` 请求体全部可选；响应给出 `created` / `updated` / `kept_manual` / `stats` /
`band_counts` / `reached_limit` / `spec_ref`（`§14 / §15 / §16.1`），单产品价格上限 `MARKET_OFFER_LIMITS`。
`GET /price-summary` 给出 `counted_offers` / `strong_offers` / `usable_offers` / `weak_offers`、
成交与挂牌分计、`reliable_count`（证据分 ≥ 75 且非异常值）、异常值提醒、整件价提醒、按类型 + 单位分组的价格带
（成交优先，绝不用挂牌价冒充成交基准）。研究流水线追加 `PRICE_SEARCH` / `PRICE_EVIDENCE` / `OUTLIER_DETECTION` 三个阶段。

## 16. 高价值锚点与对标模式（Phase 7，基线 §16 / §17 / §55 / §56）

```http
GET    /api/anchors/contract                            # 锚点合同自检：两条硬门槛 + 三种锚点 + 六项权重 + 三条红线
GET    /api/anchors?product_id&anchor_type&is_primary&q&sort&page&pageSize   # 跨产品高价值锚点库
GET    /api/products/{id}/anchors?anchor_type&is_primary&q&sort&page&pageSize
POST   /api/products/{id}/anchors/rebuild               # ADMIN / RESEARCHER → 201，由候选池 + 价格证据重建三种锚点
GET    /api/products/{id}/benchmark-mode                # §56 进度 UI：当前模式判定与理由（只读，不触发重建）
GET    /api/products/{id}/anchors/{anchorId}
PATCH  /api/products/{id}/anchors/{anchorId}            # ADMIN / RESEARCHER，人工选定主锚点 / 追加理由（标记 is_manual）
DELETE /api/products/{id}/anchors/{anchorId}            # ADMIN → 204
```

读需登录，写限 `ADMIN` / `RESEARCHER`，删除限 `ADMIN`：锚点决定对外对标口径，只读与文案账号不得改结论。

三种锚点与门槛（§16）：

- `HIGHEST_VALUE` 最高价值锚点：**相似度 ≥ 70 且价格证据分 ≥ 75**，排序「成交价优先、再按金额降序」；
  取不到同时达标的候选就不写这条锚点（§16.1）；
- `SIMILARITY_HIGH_VALUE` 高相似度锚点：相似度 ≥ 70，且价格处于同产品可靠价格带前 20%（百分位阈值 80，§16.2）；
- `SALES_ANCHOR` 强成交锚点：相似度 ≥ 拒绝档 55 即参与，
  `SalesAnchorScore = Similarity × 0.30 + PriceLevel × 0.25 + MarketRecognition × 0.15 + StoryValue × 0.15 + ConceptRelevance × 0.10 + Evidence × 0.05`（§16.3），
  响应回传六项明细与合计，前端不再重复算一遍。

模式判定（§17 / §56）：

- 有候选同时满足两条门槛 → `mode = BENCHMARK`；人工把偏好设为 `BENCHMARK` 时 `resolved_by = MANUAL_PREFERENCE`，否则 `AUTO_ANCHOR`；
- 无达标候选 → 必须 `mode = CATEGORY_CREATOR`（`resolved_by = NO_RELIABLE_ANCHOR`），
  理由写明「不得硬凑竞品或降低阈值」；**人工偏好 BENCHMARK 也不能覆盖这条强制逻辑**；
- 产品负责人显式指定 `CATEGORY_CREATOR` → `resolved_by = MANUAL_PREFERENCE`，只改结论、不抹掉已算出的锚点证据。

红线与语义：

- 来源没写明产品身份的价格（`SOURCE_UNATTRIBUTED`）**不参与锚点判断**——即使五项加权拿到 75 分压线也不进锚点；
  异常值（`is_outlier`）与被排除（`is_excluded`）的价格同样不参与；
- 重建只覆盖自动锚点：`is_manual = true` 的人工锚点默认保留（`keep_manual = false` 才清除），
  `recompute = false` 时只重算主锚点标记；响应回传 `created` / `removed` / `kept_manual` / `anchor_types` / `stats` / `mode` / `spec_ref`；
- 主锚点全产品唯一，顺序为 最高价值 → 高相似度 → 强成交；
- 单产品最多 60 条锚点、每种最多 10 条（`ANCHOR_LIMITS`），列表单页最大 100 条。
  研究流水线的 `ANCHOR_BUILD` 阶段在本轮标记 `implemented=true`（Phase 7），`VALUE_CODES` 及之后仍为 `PENDING`。

## 17. 自建高端标准模式 Category Creator Mode（Phase 8，基线 §4.2 / §17 / §29）

```http
GET    /api/category-creator/contract                     # 合同自检：两触发条件 + 六标准轴 + 三层标记 + 三条红线 + 六条规则
GET    /api/category-creator/labels                       # 轴名 / 轴状态 / 就绪度 / 触发条件的中文标签（前端不另写口径）
GET    /api/products/{id}/category-creator                # 总览：§17 模式判定 + 最新一版自建标准 + 版本列表 + 能否生成
GET    /api/products/{id}/category-creator/versions       # 版本列表（分页参数 page / pageSize，单页上限 100）
POST   /api/products/{id}/category-creator/generate       # ADMIN / RESEARCHER → 201，生成一版自建标准
GET    /api/products/{id}/category-creator/{profileId}    # 单版自建标准（跨产品调阅返回 404，不串号）
PATCH  /api/products/{id}/category-creator/{profileId}    # ADMIN / RESEARCHER，人工确认 / 备注
```

读需登录，写限 `ADMIN` / `RESEARCHER`：自建标准是后续产品结构、配方哲学与成交话术的输入，
只读与文案账号不得改写「这款茶按什么标准成立」。

两个触发条件（§4.2，缺一不可）：

- `NO_RELIABLE_ANCHOR`｜没有可靠锚点（强制进入）：没有任何候选同时满足 相似度 ≥ 70 且 价格证据分 ≥ 75；
- `USER_OPT_OUT`｜用户选择不使用对标：产品负责人显式选择「不使用对标」，即使存在达标锚点也走自建标准。

`GET /api/products/{id}/category-creator` 直接复用 Phase 7 的 §17 判定，不重复实现：

- 有达标候选且无人工偏好 → `mode = BENCHMARK` / `resolved_by = AUTO_ANCHOR` / `suggested_trigger = USER_OPT_OUT`；
- 无达标候选 → `mode = CATEGORY_CREATOR` / `resolved_by = NO_RELIABLE_ANCHOR` / `suggested_trigger = NO_RELIABLE_ANCHOR`，
  理由写明「不得硬凑竞品或降低阈值」（人工偏好 `BENCHMARK` 也不能覆盖）；此时 `can_generate = true`；
- 产品负责人显式指定 `CATEGORY_CREATOR` → `resolved_by = MANUAL_PREFERENCE` / `suggested_trigger = USER_OPT_OUT`。

生成体（`generate` 严格 schema，多余字段 400）：`trigger`（可选，显式覆盖 `suggested_trigger`，非法枚举 400）、`notes`（可选，≤ 2000 字）。

自建标准的组成（响应结构）：

- `standard.items[]`：六条标准轴 `FRAME`（骨架 / 产区山头）/ `DEPTH`（底气 / 原料）/ `IDENTITY`（身份 / 辨识度）/
  `FIRST_IMPRESSION`（第一口 / 汤感）/ `FINISH`（后半程 / 回甘生津）/ `CRAFT`（工艺控制），顺序固定；
  每条含 `requirement`（这一轴必须成立什么）、`why_it_matters`、`evidence_refs`（`product.*` / `dna.*` 可回查）、
  `evidence_summary`、`statement`、`gap`、`layer`；
- 轴状态：`SUPPORTED`（≥ 2 条事实支撑）/ `PARTIAL`（只有单点事实）/ `UNKNOWN`（未录入）；
- 红线：`UNKNOWN` 轴的 `statement` 必须为 `null` 并写明 `gap`（宁可不讲，不得编），所有轴 `layer = INTERPRETATION`；
- `readiness`：`READY`（≥ 4 轴 `SUPPORTED`，可进入成交表达）/ `PARTIAL`（支撑 + 单点合计 ≥ 2，先补事实再放大）/
  `INSUFFICIENT`（事实不足，**不得输出成交表达**）；
- `standard.summary`、`style_identity`（含 `identity_name` 与三段品饮身份；`time_story` 留 Phase 9 恒为 `null`）、
  `value_logic.stages[]`（`FACT` → `INTERPRETATION` → `VALUE` → `SALES_LINE`；`sales_line_ready = false` 时过滤掉 `SALES_LINE`，
  只剩三段）、`evidence_gaps[]`、`fact_refs[]`、`value_dna_refs[]`；
- `downstream[]`：**空数组**——Phase 10 产品结构 / 11 配方哲学 / 12 强成交话术 / 14 事实审核都已交付，
  已交付阶段不再登记占位条目（§60；交接关系写在合同的 `rules` 里，不得用简化版代替）；
- 版本治理：每次 `generate` 产生新版本（`version` 递增），历史版本全部保留（§62-15）；
  `PATCH` 只改 `is_confirmed` / `notes`，**不产生新版本、不改写正文**，取消确认会清空 `confirmed_by` / `confirmed_at`；
  单产品活跃版本上限 20（`CATEGORY_CREATOR_LIMITS.maxProfilesPerProduct`）。

产物红线（§62）：只引用已录入事实（缺失一律 `UNKNOWN`，禁止补全树龄 / 山头 / 年份 / 获奖 / 大师）、
不硬凑竞品、不下调阈值、不编造对标；`readiness = INSUFFICIENT` 时 `sales_line_ready = false` 且没有 `SALES_LINE` 段，
成交表达不得出现未录入的硬事实。

## 18. 价值密码与价值映射（Phase 9，基线 §18 / §19 / §20 / §30 / §43 / §44）

```http
GET    /api/value-codes/contract                       # 合同自检：16 个 Code + 5 种状态 + 六类故事 + 七条规则 + 下游交接
GET    /api/value-codes/labels                         # 状态 / 维度 / 故事的中文标签与 §19 句式（前端不另写口径）
GET    /api/value-codes                                # 价值密码库（跨产品总览，支持筛选 / 排序 / 分页）
GET    /api/products/{id}/value-codes                  # 总览：§17 模式判定 + 最新一版价值映射 + 版本列表
GET    /api/products/{id}/value-codes/versions         # 版本列表（所有版本必须保留）
POST   /api/products/{id}/value-codes/generate         # ADMIN / RESEARCHER → 201，生成一版价值映射
GET    /api/products/{id}/value-codes/{profileId}      # 单版价值映射（跨产品调阅返回 404，不串号）
PATCH  /api/products/{id}/value-codes/{profileId}      # ADMIN / RESEARCHER，人工确认 / 备注
```

读需登录，写限 `ADMIN` / `RESEARCHER`：价值映射是产品结构、配方哲学与成交话术的输入，
不能让只读账号改写「这款茶的哪些价值点成立、哪些还不成立」。

16 个 Value Code（顺序由 §18 固定，不得增删或重排）：

```text
PEACOCK_IDENTITY     孔雀身份        CORE_ORIGIN           核心产区
PREMIUM_MATERIAL     高端原料        FORMULA_ARCHITECTURE  配方结构
SMOKY_SIGNATURE      烟香签名        STRONG_BODY           浓强茶汤
FAST_HUIGAN          回甘快          STRONG_SALIVATION     生津强
CHA_QI               茶气            SCARCITY              稀缺性
AGE_VALUE            陈化价值        BRAND_PREMIUM         品牌溢价
COLLECTION_RECOGNITION 收藏认知      MARKET_LIQUIDITY      市场流通性
STYLE_RECOGNITION    风格辨识度      CRAFT_VALUE           工艺价值
```

每个 Code 固定给出 `evidence`（只引用本产品已录入事实 `product.*` 与 Value DNA `dna.*`）/ `evidence_refs` /
`requirement`（§44：高价值产品形成之前就必须具备的底层条件）/ `contribution`（§18）/ `status` / `status_reason` /
`statement` / `safe_expression` / `gap` / `layer`（固定 `INTERPRETATION`）。

五态判定（§19）（`ALREADY_HAVE` 已具备 / `PARTIAL` 单点事实 / `TIME_DEPENDENT` 时间依赖 / `NOT_HAVE` 不具备 / `UNKNOWN` 未录入）：

- ≥ 2 条可交叉印证的事实 → `ALREADY_HAVE`；只有 1 条 → `PARTIAL`（先补事实再放大）；一条都没有 → `UNKNOWN`；
- 时间依赖型 Code（`AGE_VALUE` / `COLLECTION_RECOGNITION` / `MARKET_LIQUIDITY`）已录入底子时记 `TIME_DEPENDENT`，
  底子也没录时仍是 `UNKNOWN`——**不能拿「没录」当「将来会有」**；
- 已录入事实明确排除（如原料记为台地小树）→ `NOT_HAVE`，必须写清是哪条事实排除的；
- 红线：`UNKNOWN` 的 `statement` 必须为 `null`，`TIME_DEPENDENT` 的 `statement` 与 `safe_expression` 必须**逐字**等于
  §19 固定句式「今天看的是它有没有把未来需要的底子先做好。」，任何位置都不得出现「以后一定会有。」。

六类价值故事（§20），故事 → Code 的映射固定，防止「先写故事再找证据」：

- `identity_story` 身份故事 / `price_ceiling_story` 价格上限故事 / `flavor_identity_story` 风味身份故事：
  ≥ 2 条已具备的 Code → `READY`（成稿），只有单点事实 → `PARTIAL`，没有事实 → `GAP`（正文为 `null`）；
- `time_story` 时间故事：有 `TIME_DEPENDENT` 的底子才成稿，正文只在 §19 固定句式之上补「已经具备的底子」；
- `product_architecture_story` 产品结构故事：Phase 10 交付后不再 `HANDOFF`，改为取该产品最新一版产品结构叙事正文
  （§57 验收通过 → `READY`；有结构但写实角色不足 → `PARTIAL`；没有结构或价值位不成立 → `GAP` 留空并指回产品结构页）；
  `formula_philosophy_story` 配方哲学故事：Phase 11 交付后同样不再 `HANDOFF`，改为取该产品最新一版配方哲学的设计逻辑正文
  （`acceptance_passed && design_logic_ready` → `READY`；写实分量 ≥ 2 但验收未过 → `PARTIAL`；没有配方哲学 → `GAP` 留空并指回配方哲学页），
  **不得用简化版代替**（§60）；`VALUE_STORY_HANDOFF_PHASES` 已清空，六类故事全部由正文正面提供；
- `downstream[]`：**空数组**——下游 Phase 10 / 11 / 12 / 14 都已交付，不再保留 `PENDING` 占位条目。

价值密码库 `GET /api/value-codes` 查询参数（严格 schema，非法枚举 400）：

`page` / `pageSize`（默认 20，单页上限 100）/ `product_id` / `status` / `mode` / `q`（产品名 / 年份 / 茶类 / 山头模糊匹配）/
`sort`（`-updated_at` / `updated_at` / `product_name` / `-product_name` / `-unknown_count` / `-time_dependent_count`）。
每行直接带回 `code_counts` / `time_dependent_codes` / `unknown_codes` / `already_have_codes` / `time_dependent_expression`
与人工确认状态，前端无需二次请求。

版本治理：每次 `generate` 产生新版本（`version` 递增），历史版本全部保留（§62-15）；
`PATCH` 只改 `is_confirmed` / `notes`，**不产生新版本、不改写正文**，取消确认会清空 `confirmed_by` / `confirmed_at`；
单产品活跃版本上限 20（`VALUE_CODE_LIMITS.maxProfilesPerProduct`）。

产物红线（§62）：16 个 Code 与顺序不得裁剪；事实不足一律 `UNKNOWN` + 写清缺口，
禁止补全树龄 / 山头 / 年份 / 获奖 / 大师；**不得把竞品事实移植到自有产品**（§44 / §62-5）；
价值密码库跨产品页只读，生成与人工确认只在产品内进行。

## 19. 产品结构叙事 Product Architecture（Phase 10，基线 §5 / §45 / §57）

把一款茶解释成一套完整产品结构：九个角色（骨架 `backbone` / 身份 `identity` / 香气 `aroma_role` / 底气 `body_role` /
第一口 `front_stage_role` / 中段 `middle_stage_role` / 后半程 `finish_role` / 记忆点 `memory_point` / 价值位 `value_role`），
顺序固定，**不得增删或重排**。

```http
GET   /api/product-architecture/contract            # 九角色 / §45 八问 / §57 验收 / 6 条红线 / 下游交接（只读，需登录）
GET   /api/product-architecture/labels              # 标签与状态口径（含 role_status_labels / role_status_tones）
GET   /api/product-architecture                     # 跨产品产品结构库（一行 = 一款产品最新一版，未生成的也出现）
GET   /api/products/{id}/architecture               # 产品级总览（最新一版 + 未生成时的缺口提示）
GET   /api/products/{id}/architecture/versions      # 版本列表（历史全部保留，§62-15）
POST  /api/products/{id}/architecture/generate      # 生成新版本（201，ADMIN / RESEARCHER）
GET   /api/products/{id}/architecture/{recordId}    # 单版调阅
PATCH /api/products/{id}/architecture/{recordId}    # 人工确认 / 备注（ADMIN / RESEARCHER）
```

- 角色状态只有两种：`WRITTEN`（已写实）/ `GAP`（事实不足，正文为空串 + 写清缺哪个字段）；
- 角色正文分三层语义：价值位是 `RHETORIC`（允许极限修辞），其余八个是 `INTERPRETATION`（解释，不许变说明书，§24）；
- `citations[]` 形如 `product.mountain=布朗山`：值必须**逐字出现在角色正文里**，证据来源只可能是本产品已录入字段或 Value DNA；
- `evidence_refs[]` 由 `citations` 反推（两者永远同源），GAP 角色两处都为空；
- `evidence_gaps[]` 写清「缺具体事实」还是「写实的结构角色不足」，供研究员补齐，绝不留一句「待补充」；
- `role_counts`（`written` / `gap`）、`acceptance`（§57 必答五项：骨架 / 香气 / 汤感 / 回甘 / 记忆点 + `passed`）、
  `narrative`（§5 的价值位叙事，价值位不成立时为空字符串）、`downstream[]`：**空数组**——Phase 11 / 12 / 14 都已交付，
  已交付阶段不再登记（`status` 只有 `PENDING` 一种取值，不得把已交付阶段显示成未交付）；
- 生成前必须至少有 3 个其它角色写实，价值位才成立（`PRODUCT_ARCHITECTURE_LIMITS.minWrittenRolesForValueRole`）；
- 单角色 Value DNA 引用上限 3 条（`maxDnaRefsPerRole`），避免一个角色被 DNA 刷满；单产品活跃版本上限 20；
- 版本治理：每次 `generate` 产生新版本（`version` 递增），历史版本全部保留（§62-15）；
  `PATCH` 只改 `is_confirmed` / `notes`，**不产生新版本、不改写正文**，取消确认会清空 `confirmed_by` / `confirmed_at`。

产物红线（§62）：不允许增加任何原料或配方事实（只引用本产品已录入字段与 Value DNA）；事实不足一律留空写缺口，
不得用形容词补圆；不得虚构研发关系；不得把竞品事实移植到自有产品；产品结构库跨产品页只读，
生成与人工确认只在产品内进行。

产品结构库 `GET /api/product-architecture` 查询参数（严格 schema，非法枚举 400）：

`page` / `pageSize`（默认 20，单页上限 100）/ `product_id` / `role` / `missing`（只看尚未生成结构的）/ `mode`
（`BENCHMARK` / `CATEGORY_CREATOR`）/ `q`（产品名 / 年份 / 茶类 / 山头模糊匹配）/
`sort`（`-updated_at` / `updated_at` / `product_name` / `-product_name` / `-written_roles` / `-gap_roles`）。

## 20. 配方哲学 Formula Philosophy（Phase 11，基线 §6 / §6.1 / §46 / §57）

把一款茶解释成一套设计逻辑：五个分量（骨架 `backbone` / 香气 `aroma` / 回甘 `sweetness` / 汤感 `body` / 收口 `finish`），
顺序固定，**不得增删或重排**；分量之上写 §46 Agent 8 的五项输出
（`formula_strategy` / `ingredient_roles` / `taste_roles` / `design_goal` / `sales_explanation`）。

```http
GET   /api/formula-philosophy/contract            # 五分量 / §46 五项输出 / §6.1 比例口径 / 7 条红线（只读，需登录）
GET   /api/formula-philosophy/labels              # 标签与状态口径（含 component_status_labels / component_status_tones）
GET   /api/formula-philosophy                     # 跨产品配方哲学库（一行 = 一款产品最新一版，未生成的也出现）
GET   /api/products/{id}/formula-philosophy       # 产品级总览（最新一版 + 未生成时的缺口提示）
GET   /api/products/{id}/formula-philosophy/versions  # 版本列表（历史全部保留，§62-15）
POST  /api/products/{id}/formula-philosophy/generate  # 生成新版本（201，ADMIN / RESEARCHER）
GET   /api/products/{id}/formula-philosophy/{recordId}  # 单版调阅
PATCH /api/products/{id}/formula-philosophy/{recordId}  # 人工确认 / 备注（ADMIN / RESEARCHER）
```

- 分量状态只有两种：`WRITTEN`（已写实）/ `GAP`（事实不足，正文为空数组 + 写清缺哪个字段）；
- `formula_strategy` / `design_goal` / `sales_explanation` 三层：前两者是 `INTERPRETATION`，`sales_explanation` 是 `RHETORIC`（§24 允许极强修辞）；
- **比例红线（§6.1）**：没有确认比例时，正文 / 设计逻辑 / 成交层解释里一个比例字样都不能出现（`60%`、`百分之六十`、`占比` 都算），
  这类已录入事实直接不进正文与 `citations`；`known_ratio = true` 时 `ratio_data` 每个原料名都必须能逐字回查到本产品原料类字段，
  否则 `generate` 直接 400（`no_new_ingredient`），绝不自动编比例（`no_fabricated_ratio`）；
- 比例来源只有两条：人工登记 `ratio_data`，或拼配描述里写明**完整**配比（`ratio_source = BLEND_DESCRIPTION`，
  至少两个原料才成立，来源字段逐字进 `ratio_evidence`）；只写一处比例按「未知比例」处理并写进 `evidence_gaps[]`；
- `citations[]` 形如 `product.mountain=布朗山`：值必须**逐字出现在分量正文里**，来源只可能是本产品已录入字段或 Value DNA；
- `ingredient_roles` / `taste_roles` 只允许对**已录入的原料与滋味**做角色指派（`rhetoric_allowed_for_roles_only`）；
- `acceptance`（§57：五分量齐不齐 + 设计逻辑成不成稿 + 一个比例字样都没有）与 `component_counts`（`written` / `gap`）；
- 写实分量不足 2 个（`minWrittenComponentsForStrategy`）时设计逻辑不成稿，三层正文全空并写清缺口；
- 单产品活跃版本上限 20；`PATCH` 只改 `is_confirmed` / `notes`，**不产生新版本、不改写正文**，取消确认会清空 `confirmed_by` / `confirmed_at`；
- `downstream[]`：**空数组**——Phase 12 / 14 都已交付，不再保留 `PENDING` 占位条目。

配方哲学库 `GET /api/formula-philosophy` 查询参数（严格 schema，非法枚举 400）：

`page` / `pageSize`（默认 20，单页上限 100）/ `product_id` / `component`（五个分量之一）/ `known_ratio`（`true` / `false`，按字符串解析）/
`missing`（只看尚未生成配方哲学的）/ `mode`（`BENCHMARK` / `CATEGORY_CREATOR`）/ `q`（产品名 / 年份 / 茶类 / 山头模糊匹配）/
`sort`（`-updated_at` / `updated_at` / `product_name` / `-product_name` / `-written_components` / `-gap_components`）。
每行直接带回 `component_counts` / `known_ratio` / `design_logic_ready` / `acceptance_passed` 与人工确认状态。

产物红线（§62）：不允许增加任何原料或配方事实（只引用本产品已录入字段与 Value DNA）；不虚构研发关系；
事实不足一律留空写缺口，不得用形容词补圆；不得把竞品事实移植到自有产品；配方哲学库跨产品页只读，
生成与人工确认只在产品内进行。

## 21. 强成交话术 Strong Sales Copy（Phase 12–13，基线 §21 / §22 / §23 / §26 / §27 / §33 / §34 / §47 / §48）

把上游已经确认的东西组装成主播与经销商**拿起来就能讲**的成稿：§26 九种输出
（5 句核心金句 / 20 句备用金句 / 15 秒 / 30 秒 / 60 秒 / 3 分钟 / Level 5 新品发布 / 经销商版 / 异议处理）、
§47 七大卖点、§22 Level 5 王者七项、§23 成交冲击力八项评分与 §24 / §25 合规风险分级；
Phase 13 再补上 §7 / §34「再狠一点」牛逼化强化器与 §48 Agent 10 八项自检。

```http
GET   /api/sales-copy/contract                        # 五档强度 / 九种输出 / 八项评分 / Level 5 七项 / 红线（只读，需登录）
GET   /api/sales-copy/labels                          # 标签与口径（含 intensity_short_labels / impact_score_band_meta / level5_requirement_meta）
GET   /api/sales-copy                                 # 跨产品「强成交话术库」（一行 = 一款产品最新一版，未生成的也出现）
GET   /api/products/{id}/copy                         # 产品级总览（模式 + 最新一版 + 版本列表 + 上游到位情况）
GET   /api/products/{id}/copy/versions                # 版本列表（历史全部保留，§62-15）
POST  /api/products/{id}/copy/generate                # 生成新版本（201，ADMIN / RESEARCHER）
POST  /api/products/{id}/copy/intensify               # §7 / §34「再狠一点」四档强化（201，ADMIN / RESEARCHER）
GET   /api/products/{id}/copy/{recordId}              # 单版调阅
PATCH /api/products/{id}/copy/{recordId}              # 人工确认 / 备注（ADMIN / RESEARCHER）
```

- 五档成交强度 `intensity`（§21）：`1 研究 / 2 专业 / 3 强销售 / 4 直播爆款（默认）/ 5 王者`；
  生成请求可传 `intensity` / `value_focus`（§33 八项价值重点）/ `mode` / `notes`；
- **§17 模式不可被请求覆盖**：`mode` 与锚点引擎判定冲突时直接 400（没有可靠价格锚点就绝不能写成 Benchmark Mode，§62-10）；
- **无锚点标准句**：`anchor.has_reliable_price_anchor = false` 时 `headline.price_or_standard_story` 必须逐字使用
  §22 标准句（「这款茶不是用别人现成的价格给自己撑腰，而是先把自己的产品标准立起来。」），且不得挂 `primary_anchor_id`；
- **§23 成交冲击力八项**：开场抓人 15 / 产品身份 15 / 高价值感 20 / 价格或标准锚定 15 / 差异化 10 / 画面感 10 / 记忆点 10 / 收口 5；
  分档 `REWRITE < 70` / `USABLE 70–79` / `EXCELLENT 80–89` / `CORE ≥ 90`；
- **事实不足压分（不是降级成平庸文案）**：正文逐字回查到的事实 < 4 条时，总分按引用条数分别压到 84 / 74 / 68 / 55；
  总分 = min(八项机械分之和, 该上限)；`required_score` 只在强度 4 / 5 非空（4 → 85，5 → 90）；
- **§22 Level 5 王者七项**：七项全部满足才算 `level5.satisfied`（含至少 3 句可独立传播金句，§58-10），缺哪项逐条列出；
- **§24 / §25 合规**：修辞本身不判 RED；命中禁止承诺（必涨 / 稳赚 / 保值 / 未来达到某价格…）、受限措辞（复刻 X / 同款配方…）、
  虚构硬事实（年份 / 树龄 / 山头 / 原料…）、凭空价格、无 `RND_CONFIRMED` 却暗示研发关系 → RED（禁止发布）；
  已录入事实 < 4 条 → YELLOW（需人工确认）；`acceptance.compliance_passed = risk !== "RED"`；
- **§26 九种输出逐项状态**：`output_statuses[]` 写清每种输出是否交付，未交付的进 `acceptance.missing_outputs`；
- **落库即冻结**：正文与全部派生结论（评分 / Level 5 / 合规 / 验收 / 引用）一起写入 `copy_outputs`，
  日后产品事实或锚点变化不会改写已交付成稿——要改就生成下一版（§62-15）；
- **生成侧与回看侧同源**：回看历史版本走 `salesCopyReviewOf()` / `salesCopyEvidenceGaps()` / `salesCopyCitations()` /
  `salesCopyOutputStatuses()` 同一份实现，`citations`（形如 `product.mountain=布朗山`）必须逐字出现在正文里；
- 版本治理：单产品上限 20 版；`PATCH` 只改 `is_confirmed` / `notes`，**不产生新版本、不改写正文**，取消确认会清空 `confirmed_by` / `confirmed_at`；
- **§7 / §34「再狠一点」（Phase 13 已接线）**：请求体只有 `level`（`NORMAL` / `STRONG` / `VIRAL` / `KING`，
  映射 §21 强度 2 / 3 / 4 / 5）、可选 `record_id`（不传就强化最新版）与 `notes`——
  **强化器不接受任何事实输入**（多余字段 400，§34）；
- 强化 = **只新增版本**：`version = 最大版本 + 1`、`intensify_rounds = 源版本 + 1`，
  源版本原封不动保留（§62-15）；同一档或更低档一律 400（「写弱一点」不是一个动作，§7），
  已自动强化 3 轮后必须人工处理（400 + `details.max_auto_rounds = 3`，§48），单产品 20 版封顶；
- **不增加新事实是机械结论**：新版本正文逐字回查出的引用清单必须是源版本的子集，
  多出任何一条已录入事实就 400（`added_facts` 恒为空数组）；
  被改写写弱的引用会写进新版本的自动备注，供人工抽查；
- 响应体 `salesCopyIntensifyResult`：`level` / `intensity` / `source_intensity` / `round` /
  `previous`（源版本号 / 强度 / 分数 / 分档 / 是否达线）/ `changed_elements`（逐格列出改了哪些位置）/
  `added_facts` / `self_check` / `record`（新版本完整成稿）/ `spec_ref = "§7 / §34 / §48"`；
- **§48 Agent 10 八项自检**：开场 3 秒是否抓人 / 是否有身份 / 是否有价值高度 / 是否有产品结构 /
  是否有金句 / 是否有记忆点 / 是否有成交推进 / 是否说明书味太重（负向检查），
  每一项都复用 §23 已有的机械判定并带回判定依据；`passed = 八项全过 且 分数达档`
  （Level 4 ≥ 85、Level 5 ≥ 90），达不到时如实 `passed = false` 并列出 `missing`，
  不做假、不压分；分数与本版 `impact_score.total` 同源；
- 强化同样是纯规则引擎（合同 `engine.ai_wired = false`，`COPY_INTENSIFIER` Prompt 已固化但未接线）：
  它用**同一份事实、更高一档的机械画像**重跑总装，因此不会凭空补事实；
- `intensify_rounds` 在版本列表与单版调阅里都会带回：生成稿恒为 0，强化版本逐轮递增（上限 3）。

强成交话术库 `GET /api/sales-copy` 查询参数（严格 schema，非法枚举 400）：

`page` / `pageSize`（默认 20，单页上限 100）/ `product_id` / `intensity`（1–5）/
`level5`（`true` / `false`，按字符串解析）/ `has_anchor`（`true` / `false`）/ `missing`（`true` 只看尚未生成，`false` 只看已生成）/
`mode`（`BENCHMARK` / `CATEGORY_CREATOR`）/ `q`（产品名 / 品牌名模糊匹配）/
`sort`（`-updated_at` / `updated_at` / `product_name` / `-product_name` / `-impact_score` / `-version`）。
每行直接带回强度、成交冲击力、Level 5 结论、合规风险与人工确认状态，未生成的产品也会出现（一行 null）。

产物红线（§62）：一个字都不能编（只用本产品已录入事实与 Value DNA）；事实不足宁可压分也不编；
不得把竞品事实移植到自有产品；不得承诺收益或保值；话术库跨产品页只读，生成与人工确认只在产品内进行。

## 22. 事实审核与人工审批（Phase 14，基线 §24 / §25 / §49 / §53 / §62-15）

把已经冻结的强成交话术成稿**逐句**过一遍事实审核：每一句先标三层语义（FACT 事实 / INTERPRETATION 解释 /
RHETORIC 修辞，§24），再判三档风险（GREEN 可发布 / YELLOW 需人工确认 / RED 禁止发布，§49），
给出逐字回查到的 Evidence 与修改建议（§53 五列），最后由人工审批或否决（§57）。

```http
GET  /api/fact-review/contract                          # 合同自检：三层 / 三档 / 五列 / 13 项焦点 / 10 条规则 / 引擎（只读，需登录）
GET  /api/fact-review/labels                            # 标签与口径（claim_type / risk / status / focus / evidence_kind）
GET  /api/products/{id}/fact-review                     # 总览：最新审核版本 + 版本列表 + 成稿对齐状态
GET  /api/products/{id}/fact-review/versions            # 版本列表（历史全部保留，§62-15）
POST /api/products/{id}/fact-review/generate            # 生成一次审核（201，ADMIN / RESEARCHER）
POST /api/products/{id}/fact-review/approve             # 人工审批通过（ADMIN / RESEARCHER）
POST /api/products/{id}/fact-review/reject              # 人工否决（ADMIN / RESEARCHER）
GET  /api/products/{id}/fact-review/{reviewId}          # 单次审核调阅（跨产品调阅 404，不串号）
```

读需登录，写限 `ADMIN` / `RESEARCHER`：审批不是「看一眼」，它决定这版话术能不能发布。

事实审核不在基线 §37 的路由清单里，按既有模块范式（`contract` / `labels` / 总览 / `versions` /
`generate` / 单版 / 人工动作）自建，路由注册顺序固定为 `/versions` / `/generate` / `/approve` / `/reject`
在 `/:reviewId` 之前，避免被通配段吃掉。

- **三层标记（§24）**：`FACT`（可直接核验的事实）/ `INTERPRETATION`（解释与判断）/ `RHETORIC`（修辞与画面）。
  修辞不是事实造假——身份句、画面句、反问句按 `RHETORIC` 处理，**不因为「不是字面事实」就一律判 RED**；
  关键检查只有一条：会不会让消费者误以为存在一个并不存在的可核验事实；
- **三档风险（§49）**：`GREEN` 可发布 / `YELLOW` 需人工确认 / `RED` 禁止发布；整版风险取逐句最高档；
- **13 项焦点（§49）**：对标关系 / 研发关系 / 配方 / 原料 / 树龄 / 山头 / 年份 / 历史 / 价格 / 市场第一 /
  最贵 / 唯一 / 投资回报——逐句表直接带回命中项，前端不另写口径；
- **五列逐句表（§53）**：`句子` / `Claim Type` / `Risk` / `Evidence` / `修改建议`；
  `Evidence` 一律是**机械逐字回查**结果（形如 `product.mountain=布朗山`），不是模型印象；
- **10 条规则**（`FACT_REVIEW_CONTRACT.rules`）：涵盖 §24 三层口径、§25 研发 / 配方措辞边界、
  §49 十三项与 RED 触发条件（必涨 / 稳赚 / 保值 / 未来达到某价格 / 固定投资回报 → RED；
  无可靠价格锚点却写出具体价格高度故事 → RED）、§53 五列、§53 / §57 RED 阻断审批、
  §57 修辞可保留、§58 自动测试口径与 §62-15 全版本保留；
- **落库即冻结**：审核结果逐句写入 `generated_claims`（一句一行：`sentence_index` / `text` / `claim_type` /
  `risk` / `issue` / `suggestion` / `is_blocking` / `approval_status` / `approval_note` / `reviewed_by` / `reviewed_at`）
  与 `claim_evidence`（`evidence_kind` / `source_ref` / `source_id` / `excerpt` / `traceable`）；
  重新审核只**新增审核版本**，旧审核逐句原样保留（§62-15）；
- **审批闸门（§57）**：存在任何一条 `RED` 阻断句时 `approve` 直接 **400**，并把
  `error.details.{ reviewed_version, blocking_sentences, publishable: false }` 回给前端；
  `reject` 任何时候可用，`approve` / `reject` 都只改审批状态（逐句文本与风险判定不变）并留痕；
- **引擎口径（`FACT_REVIEW_ENGINE_INFO`）**：`rule_engine_authoritative = true`——纯规则引擎是权威判定；
  `ai_wired = true` 表示 `FACT_REVIEWER` Prompt 已接线，可选叠加 AI（`use_ai: true`），
  但 **AI 只能加严不能放松**（`ai_can_only_tighten`）：AI 判出的 RED 一律保留，规则判出的 RED 不会被 AI 洗白；
  Mock / AI 失败时回落纯规则引擎并在 `warnings` 里写明；
- **字段口径**：`has_reliable_price_anchor` / `price_high_story_ready` / `rnd_confirmed` 由成稿与上游
  冻结结论带回，`publishable = 无 RED`，`facts_used` / `evidence_gaps` / `warnings` 随版本冻结；
- **上限**：单产品单一成稿最多 20 个审核版本（`FACT_REVIEW_LIMITS.maxVersionsPerCopy`），
  第 21 次 `generate` 返回 400；已达上限时旧版本仍可逐条调阅；
- **输入 strict**：`generate` 只接受 `record_id`（可选，指定成稿版本）/ `use_ai` / `notes`，
  `approve` / `reject` 只接受 `version` + `note`，多余字段一律 400；
  `record_id` 指向不存在或跨产品的成稿时返回 **400 VALIDATION_ERROR**（与既有模块范式一致），
  `{reviewId}` 不是 UUID 或不存在时返回 404。

产物红线（§62）：RED 禁止发布；修辞可以保留；所有审核版本必须保留；AI 不能把 RED 洗白；
人工审批只做放行 / 否决，不允许就地改写文案（要改就回强成交话术页生成下一版）。

## 23. 交付中心 Delivery（Phase 15，基线 §31 / §51 / §52 / §53 / §57 / §60）

```http
GET /api/delivery/contract                          # 合同自检
GET /api/delivery/labels                            # 前端标签文案（格子 / 格式 / 范围 / 六态闸门）
GET /api/host-center?page&pageSize&q&ready          # 跨产品排产列表（ready 三态）
GET /api/products/{id}/host-center                  # §51 主播中心十项
GET /api/products/{id}/dealer-center                # §52 经销商中心十项
GET /api/products/{id}/delivery/export?format&scope  # 导出最终资料包
```

- **只读**：交付层是**派生视图**——不新增表、不改写正文、不生成第二份话术（§62-15），因此六条路由
  全部只 `requireAuth`、不要求写权限；任何登录用户都可以看，导出的闸门由 §53 / §57 决定，与角色无关；
- **唯一一份发布闸门**（`buildDeliveryGate()`）：主播中心、经销商中心、跨产品排产列表、导出四条链路读同一个
  `ready`，不存在「页面能看、导出能出、列表却说不合格」的分叉。判据是**最新一版成稿 + 这一版自己的
  最新审核**：上一版审批通过、当前版刚生成还没审，是最容易出假绿灯的场景，因此历史审批不参与当前判断；
- **六态闸门**（`GET /api/delivery/labels` 的 `gate_states[]`，顺序固定）：

  | 状态 | tone | ready | next_action |
  |---|---|---|---|
  | 还没有成稿 | `outline` | false | 去生成强成交话术 |
  | 待事实审核 | `info` | false | 去事实审核 |
  | 被 RED 阻断 | `danger` | false | 去事实审核改稿 |
  | 已被否决 | `danger` | false | 去事实审核 |
  | 待人工审批 | `warn` | false | 去事实审核 |
  | 可交付 | `ok` | true | — |

- **§51 主播中心十项**（`HOST_CENTER_SLOT_META`，`GET /api/products/{id}/host-center`）：
  产品身份 / 一句话定位 / 今天必讲 3 点 / 价值赛道（产品标准）/ 产品结构 / 配方哲学 / 5 句金句 /
  60 秒稿 / 3 分钟稿 / 异议回答。每一格都带回可直接念的原文与出处（`source` 形如
  `headline.identity_definition` / `scripts.min3` / `objections`），主播不用自己再琢磨（§64）；
- **§52 经销商中心十项**（`DEALER_CENTER_SLOT_META`，`GET /api/products/{id}/dealer-center`）：
  产品定位 / 核心卖点 / 为什么值这个价 / 同赛道市场认知 / 主要锚点 / 产品结构 / 配方哲学 / 消费人群 /
  如何介绍 / 常见问题。市场认知与主要锚点只引用价格高度标准，**不引用对标产品的原料 / 树龄 / 山头 / 配方**
  （§62-5）；
- **闸门未通过时中央与列表都返回 200**（不是 400 / 409）：页面照常渲染，十格全空
  （`present=false` / `tone="outline"` / `chars=0` / `text=null` / `lines=[]` / `items=[]`），
  并在 `gate` 里给出原因与 `next_action`——「暂无资料」与「接口出错」必须能分清；
- **跨产品排产列表**（`GET /api/host-center`）：query strict，`page` / `pageSize`（≤100）/ `q`（≤200，匹配产品名与品牌名）/
  `ready`（`z.stringbool()` 三态：不传 = 全部、`true` = 只出可交付、`false` = 只出卡住的）。
  排序固定 `ready desc, product_name, id`（主播每天问的是「今天哪几款能上播、哪几款卡在审核」），
  分页字段 **camelCase**（`page` / `pageSize` / `total` / `totalPages`）；
- **导出**（`GET /api/products/{id}/delivery/export`）：`format` = `markdown`（默认，`.md`）|
  `text`（`.txt`，去掉符号适合进提词器或打印成手卡）| `handcard`（`.html`，**卖点一页纸**：
  01 介绍 / 02 卖点 / 03 口感特点 / 04 补充清单排成一页，浏览器打开即可打印或另存 PDF），
  `scope` = `host` | `dealer` | `all`（默认 `all`），取值都**大小写敏感**；
  - `handcard` 与两个中心同源（同一份 `deliveryInput` 与发布闸门），03 取 §10.4 已录入感官值、
    04 取 §10.1–10.3 已录入字段：**没录入的项整行不出现**，不由系统补「待补充」占位（§11 / §24）；
    正文不含 `<script>` 与任何外链，前端放进 `sandbox=""` 的 iframe 里预览；
  - 闸门未通过 → **409** `error.code === "CONFLICT"`，
    `details = { gate, gate_label, blocking_sentences, next_action }`（`blocking_sentences` 是 RED 逐句原文），
    绝不产出半成品文件；
  - 正文超过 `limits.maxExportChars`（120000 字符）→ **400**，`details.chars` / `details.max_export_chars`；
- **闸门合同**（`publish_gate`）：`requires_approved = true`、`requires_latest_copy = true`、
  `red_blocks_publish = true`、`no_copy_no_material = true`，`blocking_states` 列出五种不能出最终资料的
  情形（无成稿 / 未审核 / 有 RED / 已否决 / 待人工审批）；
- **历史版本**不新增接口：复用既有 `GET /api/products/{id}/copy/versions`（成稿版本）与
  `GET /api/products/{id}/fact-review/versions`（审核版本），两者都返回 `{ items: [...] }`；
  版本只增不删（§62-15）；
- **七条铁律**（`DELIVERY_CONTRACT.rules`）：§51 十项、§52 十项、§53 / §62-14 发布闸门、
  §53 上一版通过不算当前版通过、§62-15 派生视图不落库、§62-5 不移植竞品事实、§64 主播不用自己琢磨。
  合同自检 `GET /api/delivery/contract` 返回 `contract` / `downstream`（**空数组**：§60 是最后一个阶段）/
  `limits`。

产物红线（§62）：交付层只读、绝不落库；RED 禁止发布；所有版本必须保留；导出不使用模型改写正文。

## 24. AI 对话工作台 Chat（默认首页，基线 §0 / §21–§27 / §31 / §33 / §62 / §64）

```http
GET    /api/chat/contract                     # 合同自检（输入 / 输出 / 上限 / 15 条铁律）
GET    /api/chat/labels                       # 前端标签文案（五档强度 / 九种输出 / 禁用事实 / 当前 Provider）
GET    /api/chat/sessions?page&pageSize&q&product&archived
POST   /api/chat/sessions                     # 新建会话（201）
PATCH  /api/chat/sessions/{id}                # 改标题 / 换产品 / 改强度
DELETE /api/chat/sessions/{id}                # 删除会话（消息级联，204）
GET    /api/chat/sessions/{id}/messages?page&pageSize
POST   /api/chat/sessions/{id}/messages       # 发一条需求，返回结构化话术（201）
```

- **定位**：这是老板 / 运营的**日常入口**（`/chat`，站点根路径 `/` 也重定向到这里）。一句话说清需求，
  系统回一版**产品卖点介绍** + 哪几句有已录事实撑着 + 还缺哪些硬事实；15 个专业模块退到侧栏「专业模式」，
  能力一个没少，只是不再占着主界面（§64）。默认交付形态是 `CHAT_SELLPOINT_FORM`（产品卖点介绍），
  §26 的 15 秒 / 30 秒 / 60 秒 / 3 分钟 / 直播稿仍保留为**专业模式下的可选输出**；
- **全网对标**（客户 2026-09-26 追加需求 / §12 Adapter / §62-1）：服务端按产品名并发跑
  `limits.benchmarkQueries`（3）条检索查询，去重、截断到 `limits.maxBenchmarks` 后**回写**
  `payload.benchmarks`——模型输出里的同名字段一律被覆盖，链接绝不可能是模型凭记忆编的；
  对标只允许用来讲「同类卖到什么价、这款站在什么高度」，**不许**把对标的原料 / 树龄 / 山头 / 年份 /
  配方写成龙德记的事实（§62-5）；检索失败 / 超时 / 0 条时降级为 `benchmarks: []` 并走
  Category Creator Mode（§62-10），**绝不阻塞出稿**；
- **未绑定产品也能出稿**：`POST .../messages` 支持可选 `product_name`（≤80 字）。它**只当检索词**
  用来找对标，不作为事实来源——产品没绑定或没录入的年份 / 山头 / 原料一律仍视为未录入（§62-8）；
- **产出是草稿**：工作台**不写 `copy_outputs`**、不改任何既有表，正式发布仍然只能走
  「强成交话术 → 逐句事实审核 → 人工审批 → 交付中心」（§53 / §57 / §62-14 / §62-15）；
- **只喂已录事实**：绑定产品后，System Prompt 由 `packages/schemas` 的 `buildChatSystemPrompt()` 组装，
  只带 `products` 已录入字段与 `product_facts` 行；没录入的树龄 / 山头 / 年份 / 获奖 / 大师 / 配方比例 /
  成交价一律不许写进话术，缺口原样列进 `payload.missing_facts`（前端用警示色常驻展示，不允许折叠）；
- **强制 schema 校验后落库**（§62-13）：模型只能回 `chatReplySchema` 的 JSON；
  解析 / 校验失败**不写半成品**，直接 **502** `AI_UNAVAILABLE`，
  `details = { session_id, user_message_id, ai_provider }`——用户那条需求**保留**，直接重发即可；
- **Provider 口径**：`GET /api/chat/labels` 的 `ai_provider` 是前端判断「真模型还是 mock」的唯一来源；
  当前为 `deepseek`（`AI_PROVIDER=deepseek` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`，
  实测真模型单次 80–130 秒，因此前端必须有等待态：进度条 + 已等待时长 + 禁止重复提交）；
- **会话只属于创建者**：所有读写都带 `user_id = 当前用户`，越权一律 **404**（不泄露会话是否存在）。
  写操作要求 `ADMIN` / `RESEARCHER` / `COPYWRITER`（草稿不落库，所以文案与研究员也能用），
  `VIEWER` 只能看；
- **输出字段**（`contract.output.fields`）：`headline` / `copy_blocks` / `quotes` / `objections` /
  `missing_facts` / `used_facts` / `value_focus` / `intensity` / **`value_height`**（本次价值高度总纲，
  没有对标支撑时为 `null`）/ **`benchmarks`**（本次真实检索到的对标来源，服务端回写）/ `next_actions`。
  老消息（改版前落库的）没有后两个字段，前端读的时候按 `null` / `[]` 兜底；
- **合同自检**（`GET /api/chat/contract`）：`purpose` / `sellpoint_form` / `benchmark_policy` / `rules` /
  §62 十五条铁律 / `forbidden_facts`（14 条）/ `limits.maxMessageChars` / 6 条预设需求 / 5 条开聊问题，
  前端「这个工作台凭什么可信」面板直接读这里，不另写一套文案。

产物红线（§62）：不虚构硬事实、不替用户拍价、修辞可以极限、AI 输出必须过 schema、版本只增不删。

## 25. 基线自检

```http
GET /api/meta/core-features   # 六大核心功能、15 个页面模块、11 个 Prompt Key
```
