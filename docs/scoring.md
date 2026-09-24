# 评分与阈值（基线 §13、§15、§16、§23）

实现位置：常量在 `packages/schemas/src/thresholds.ts`；
§1 相似度已由 `packages/schemas/src/{comparable,similarity}.ts#scoreSimilarity`（纯函数）+
`services/api/src/modules/candidates/similarity.service.ts`（facet 构建与候选归并）实现，
接口自检见 `GET /api/candidates/contract`；
§2 Price Evidence Score 已由 `packages/schemas/src/price.ts#scorePriceEvidence`（纯函数）+
`services/api/src/modules/prices/market-prices.service.ts`（来源重建 / 归属 / 异常值 / 汇总）实现，
接口自检见 `GET /api/prices/contract`；
§3 三种锚点已由 `packages/schemas/src/anchor.ts#scoreSalesAnchor`（纯函数）+ 
`services/api/src/modules/anchors/anchors.service.ts`（锚点重建 / 模式判定 / 人工维护）实现，Phase 7 交付，
接口自检见 `GET /api/anchors/contract`；§4 冲击力评分在 Phase 12 实现。

## 1. 可比性评分（总分 100）

| 维度 | 权重 |
|---|---:|
| 生熟茶一致 | 18 |
| 产品概念 / 命名体系 | 18 |
| 茶区 / 山头 | 15 |
| 原料 | 13 |
| 香气风格 | 10 |
| 滋味骨架 | 8 |
| 市场定位 | 7 |
| 工艺 | 5 |
| 规格形态 | 3 |
| 年代关系 | 3 |

分档：`<55 拒绝`｜`55–69 外围参考`｜`70–84 有效对标`｜`85–100 核心对标`

**价格不参与相似度评分。**

实现口径（Phase 5）：

- 维度权重只在 `SIMILARITY_DIMENSION_WEIGHTS` 定义一次，映射自 `SIMILARITY_WEIGHTS`，合计 100；
- 每维给出 `ratio`（0–1 命中度）、`score`（权重 × ratio，四舍五入到 0.1）、`matched` 与中文 `note`；
- 任一侧缺少该维度信息时该维度按 0 分计并进入 `unknown_dimensions`——**未知 ≠ 相似**，不做任何补齐；
- 分档函数 `similarityBandForScore`；候选状态 `PENDING_REVIEW` / `APPROVED` / `REJECTED` / `ARCHIVED` 与分档解耦；
- 候选上的 `observed_prices` 只保留来源原话供 §2/§3 与 Phase 6 使用，不出现在 facet 类型里（类型层面拒绝价格进入评分）。

## 2. Price Evidence Score

| 指标 | 权重 |
|---|---:|
| 成交/挂牌性质明确 | 25 |
| 来源可信度 | 25 |
| 产品身份确定 | 20 |
| 时间新鲜度 | 15 |
| 多来源印证 | 15 |

`>=75 强证据`｜`60–74 可用但谨慎`｜`<60 弱`

实现口径（Phase 6）：

- 权限：读需登录；人工登记 / 修正限 `ADMIN` / `RESEARCHER`，删除限 `ADMIN`；
- **挂牌价 ≠ 成交价**：`price_type` 只按来源原话判定，挂牌证据带「不得表述为成交」提醒，`price-summary` 分开计数；
- **整件价 ≠ 单饼价**：只有这条价格自己写明的重量（或同页同名的单饼规格）才能算等价，缺规格一律 NULL，不做 357g / kg 反推；
- 价格不参与相似度（`price_in_similarity: false`）：价格证据与候选相似度物理分离，价格只进 `observed_prices`；
- 归属三态：`CANDIDATE`（挂身份键相同的候选）/ `SOURCE_UNATTRIBUTED`（来源未写产品身份，身份键为 null、不互相印证）/ `MANUAL`（重建不覆盖）；
- 异常值只标记不删除：同组 `<4` 条不判，阈值 `max(MAD × 3, 中位数 × 0.35)`，写明样本量与中位数以便复核；
- 未提供字段一律 NULL、未知维度按 0 分；来源事实不移植（§62 铁律）；
- 已知边界：来源未写产品身份但写明规格重量时，「产品身份确定」可得 4 分，总分可达 75 的 STRONG 压线（详见 `agent_memory/bugs.md` 风险记录）。

## 3. 锚点

```text
Highest Value Anchor            Similarity >= 70 AND PriceEvidence >= 75
Similarity High Value Anchor    相似度优先，价格处于前 20%
Sales Anchor Score = Similarity*0.30 + PriceLevel*0.25 + MarketRecognition*0.15
                   + StoryValue*0.15 + ConceptRelevance*0.10 + Evidence*0.05
```

无候选满足 `Similarity >= 70 AND PriceEvidence >= 75` 时，必须 `mode = CATEGORY_CREATOR`，禁止硬凑竞品。

实现口径（Phase 7）：

- `ANCHOR_REQUIREMENTS = { minSimilarity: 70, minPriceEvidence: 75 }` 定义在 `thresholds.ts`，
  `SIMILARITY_ANCHOR_PRICE_PERCENTILE = 80` 与 `ANCHOR_LIMITS = { maxPerProduct: 60, maxPerType: 10, defaultPageSize: 20, maxPageSize: 100 }`
  定义在 `anchor.ts`，两处都只定义一次，`GET /api/anchors/contract` 对外回传同一口径；
- `HIGHEST_VALUE`：候选相似度 ≥ 70 且该候选有可靠价格证据分 ≥ 75（取该候选可靠价格里的最高分），
  排序「成交价优先 → 金额降序」（1kg 等价 → 357g 等价 → 原始金额，缺规格不换算）；
- `SIMILARITY_HIGH_VALUE`：候选相似度 ≥ 70 且价格百分位 ≥ 80（= 同产品可靠价格带前 20%），按相似度降序；
- `SALES_ANCHOR`：候选相似度 ≥ 拒绝档 55 即参与，六项得分各自给出 `score` 与中文 `note`（含公式），
  合计等于加权总分（前端不再重复计算）；缺可靠价格时 `PriceLevel` 记 0，`Evidence` 退化为「来源原话条数 × 15，上限 60」并写明打折原因；
- 价格准入口径 `isReliableOffer`：非排除、非异常值、**归属不是 `SOURCE_UNATTRIBUTED`**、证据分 ≥ 75，四条同时成立；
- 主锚点全产品唯一：`ensurePrimary` 顺序为 最高价值 → 高相似度 → 强成交，已有主锚点则不动；
- 模式判定 `resolveMode`：显式 `CATEGORY_CREATOR` → `MANUAL_PREFERENCE`；无达标候选 → `CATEGORY_CREATOR` + `NO_RELIABLE_ANCHOR`；
  否则 `BENCHMARK`（偏好为 `BENCHMARK` 时 `MANUAL_PREFERENCE`，否则 `AUTO_ANCHOR`）。

## 4. 成交冲击力评分（总分 100）

| 指标 | 权重 |
|---|---:|
| 开场抓人 | 15 |
| 产品身份 | 15 |
| 高价值感 | 20 |
| 价格 / 标准锚定 | 15 |
| 产品差异 | 10 |
| 画面感 | 10 |
| 记忆点 | 10 |
| 成交推进 | 5 |

`<70 自动重写`｜`70–79 可用`｜`80–89 优秀`｜`90+ 核心主播稿`
Level 4 ≥ 85；Level 5 ≥ 90。

## 5. 价格等价计算

统一计算 357g 等价与 1kg 等价（`normalizePriceEquivalents`），但**不得**把整件稀缺溢价简单线性拆分为精确单饼价值：
缺规格重量时不给任何等价价（NULL），整件 / 提价绝不用别处的重量倒算。
