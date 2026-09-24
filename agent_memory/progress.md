# 任务进度

## 当前目标
- **当前交付形态（2026-09-24 用户追加需求）**：默认首页 = **AI 对话工作台 `/chat`** —— 用户只在一个对话框里说清需求，
  系统回「可直接念的话 + 哪几句有事实撑着 + 还缺哪些硬事实」；深度专业功能（含 Benchmark Mode / Category Creator Mode /
  产品结构 / 配方哲学 / 牛逼化按钮 / Level 5 王者话术）一个没删，全部收进侧栏「专业模式」折叠区。
- 按基线 §60 推进：**Phase 1–15 已全部交付并逐项验证**（Phase 13 = 牛逼化强化器「再狠一点」Intensify；
  Phase 14 = 事实审核与人工审批；Phase 15 = 主播中心 / 经销商中心 / 导出 / 历史版本，
  含 §51 十项、§52 十项、六态发布闸门与 Markdown / 纯文本导出）。
- **§60 的 Phase 清单到此结束，本轮是收尾轮**：Phase 15 是最后一个 Phase，交付后逐条核对六大核心功能与
  §62 十五条铁律，再结束长期目标。
- 六个核心功能（Benchmark Mode / Category Creator Mode / 产品结构 / 配方哲学 / 牛逼化按钮 / Level 5 王者话术）保持锁定，不得裁剪。
- 唯一需求基线：`C:/Users/Administrator/Downloads/龙德记_AI高价值锚点与强成交话术系统_V2_成交增强版_开发规格.md`（§0–§64 / 2382 行，已完整阅读）。

## 已完成
### AI 对话工作台（2026-09-24，默认首页 + 真实 DeepSeek 接入）
- 需求：界面太复杂，要「一个 AI 对话窗口，我把需求告诉它，它就整理出话术」；并把真实 `deepseek-v4-pro` 接进来。
- 交付：`/` → 重定向 `/chat`（`ChatPage` 成为默认首页），原首页改 `/dashboard`（工作台总览）；
  侧栏一级只剩「AI 对话」，其余 15 个专业模块收进「专业模式」折叠区（`localStorage["ldj.nav.professional"]`，
  切到专业路径自动展开并写 `1`）。**六大核心功能与全部路由一个没删**。
- 对话工作台行为：说需求 → 出「可直接念的话」（`.chat-headline` / `.chat-block`）+ 事实支撑（`used_facts`）+
  **缺口常驻醒目**（`missing_facts`，`.chat-missing` 带 warn 样式，不折叠）+ 异议处理 + 引用金句 + 「整版复制」；
  支持绑定产品出稿、续写追问 chip、新对话预设六卡、会话列表与 `?s=<sessionId>` 深链、改名与删除。
- 后端：`packages/schemas/src/chat.ts`（合同 / 铁律 / 预设 / `buildChatSystemPrompt`，**不新增 Prompt Key**）、
  `packages/database/src/schema/chat.ts` + 迁移 `0015_right_hercules.sql`（`chat_sessions` / `chat_messages`）、
  `services/api/src/modules/chat/{routes,chat.service}.ts`（8 条路由）。草稿不落库；只喂「已录入事实」；
  AI 失败时**用户那条需求已保存**、assistant 不落库、返回 502 `AI_UNAVAILABLE`（`details.session_id` /
  `details.user_message_id` / `details.ai_provider`），前端提示直接重发。
- Provider：`AI_PROVIDER=deepseek`，`packages/ai/src/deepseek.ts` 的 `DeepSeekProvider extends OpenAiProvider`；
  真实模型单次出稿 **80–143 秒**，页面有等待态（进度条 + 秒表 + 禁止重复提交）。
- 本轮修复缺陷 2 条（详见 `agent_memory/bugs.md`）：`max_tokens 3200 → 8000`（长 JSON 被截断会 502）、
  新会话首条消息重复渲染（`appendUnique()` 按 id 去重）。
- 文档：`docs/api.md` 标题改为「Phase 1–15 + AI 对话工作台」，错误码补 `AI_UNAVAILABLE`，新增
  `## 24. AI 对话工作台 Chat`（8 条路由 + 定位 / 草稿不落库 / 只喂已录事实 / 502 口径 / provider 口径 /
  会话归属 / 合同自检），原「基线自检」顺延为 `## 25.`。
### 管理员账号迁移（2026-09-24，运维变更，非阶段交付）
- 开发库 `ldj_dev` 的唯一管理员由 `admin@longdeji.local` 改为 **`949412546@qq.com` / `shi123456`**（scrypt 散列直接 UPDATE，
  与 `packages/database/src/password.ts` 同格式）；旧账号实测 401，新账号实测登录成功且 `role=ADMIN`。
- seed 默认邮箱同步到位：`.env` / `.env.example` 的 `BOOTSTRAP_ADMIN_EMAIL` 与 `packages/database/src/seed.ts` 兜底值
  均为 `949412546@qq.com`；实测 `pnpm db:seed` 输出 `created=false`，`users` 仍为 1 行，不再产生第二个管理员。
- 登录页脚「默认管理员」文案同步为新邮箱（`apps/web/src/pages/LoginPage.tsx`）。
- 未同步项：`scripts/smoke/phase{3..15}.mjs` 的 `SMOKE_ADMIN_EMAIL` 兜底值仍是旧账号（跑冒烟需自行覆盖环境变量，见 `context.md`）。
### 登录页「点登录没反应」修复（2026-09-24，Phase 1 遗留缺陷）
- 根因：`/login` 路由在 `RequireAuth` 之外，`LoginPage` 登录/注册成功后**没有任何跳转**，session 虽写入
  `localStorage`，页面却一直停在登录页 → 用户看到的现象就是「按钮点了没反应」。API 侧日志显示同一时段的
  `POST /api/auth/login` 全部 200，且之后没有任何后续数据请求，可证前端拿到 token 却没离开 `/login`。
- 修复（2 处，最小改动）：`pages/LoginPage.tsx` 在 `user` 有值时 `return <Navigate to={from} replace />`
  （`from` 取自 `location.state`，仅接受 `/` 开头且非 `//` 的相对路径）；`App.tsx` 的 `RequireAuth`
  跳登录时带上 `state={{ from }}`，登录后回到用户原本要打开的页面。
- 验证：headless Chrome（CDP）实跑「打开 `/` → 填账号密码 → 点登录」→ path 变为 `/`、侧边栏渲染、登录页消失；
  「已登录再访问 `/login`」→ 自动回 `/`；`pnpm --filter @ldj/web build`（tsc + vite）通过；全流程仅剩 `favicon.ico` 404。
### Phase 15（主播中心 / 经销商中心 / 导出 / 历史版本，§31 / §51 / §52 / §53 / §57 / §60）
- `packages/schemas/src/delivery.ts`（≈1100 行）：`DELIVERY_CONTRACT`（§51 十项 `HOST_CENTER_SLOT_META` /
  §52 十项 `DEALER_CENTER_SLOT_META` / 导出格式与范围 / 发布闸门 / 七条铁律 `rules`）、`DELIVERY_LIMITS`
  （`defaultPageSize 20` / `maxPageSize 100` / `maxExportChars 120000` / `maxQueryLength 200`）、
  `DELIVERY_DOWNSTREAM = []`（§60 到此为止）、六态闸门 `buildDeliveryGate()` / `deliveryGateLabel()` /
  `deliveryGateTone()`（还没有成稿 `outline` / 待事实审核 `info` / 被 RED 阻断 `danger` / 已被否决 `danger` /
  待人工审批 `warn` / 可交付 `ok`）、两个中心的只读重排 `buildHostCenterView()` / `buildDealerCenterView()`、
  导出渲染 `renderDeliveryExport()`、`hostCenterRowSchema` / `deliveryReviewSummarySchema` / `copyIntensitySchema`、
  列表查询 `hostCenterListQuerySchema`（strict + `ready` 用 `z.stringbool()` 三态）与导出查询 `deliveryExportQuerySchema`。
- 数据库：**不新增表、无迁移**（§62-15 派生视图）——两个中心与导出直接由 `copy_outputs` + `generated_claims` 现算，
  历史版本复用既有 `GET .../copy/versions` 与 `GET .../fact-review/versions`。
- API `services/api/src/modules/delivery/{routes,delivery.service}.ts`（6 条只读路由，全部只 `requireAuth`）：
  `GET /api/delivery/contract`、`GET /api/delivery/labels`、`GET /api/host-center`、`GET /api/products/{id}/host-center`、
  `GET /api/products/{id}/dealer-center`、`GET /api/products/{id}/delivery/export`；注册顺序
  `/api/delivery/*` 在 `/api/products/:id/*` 之前（静态段优先）。
- **唯一一份发布闸门**：主播中心、经销商中心、跨产品排产列表、导出四条链路读同一个 `ready`；
  判据是**最新一版成稿 + 这一版自己的最新审核**（上一版审批通过、当前版刚生成还没审 → 不算通过，杜绝假绿灯）；
  闸门未通过时两个中心与列表**仍返回 200**（十格全空：`present=false` / `tone="outline"` / `chars=0` / `text=null` /
  `lines=[]` / `items=[]`，并在 `gate` 给出 `reason` 与 `next_action`），导出返回 **409** `CONFLICT` +
  `details = { gate, gate_label, blocking_sentences, next_action }`，绝不产出半成品文件。
- 跨产品排产列表 `GET /api/host-center`：query strict（`page` / `pageSize`(≤100) / `q`(≤200，匹配产品名与品牌名) /
  `ready` 三态），排序固定 `ready desc, product_name, id`，分页字段 **camelCase**。
- 导出 `GET /api/products/{id}/delivery/export`：`format = markdown`（默认，`.md`）| `text`（`.txt`，去符号适合提词器 /
  打印手卡），`scope = host` | `dealer` | `all`（默认 `all`），三个取值**大小写敏感**；正文超过 `maxExportChars`
  → **400** + `details.chars` / `details.max_export_chars`。
- Web：`apps/web/src/lib/delivery.ts`（类型 + `gateStateOf` / `gateStateMetaOf` / `gateLabelTone` / `gateOfRow` /
  `slotCopyText` / `copyText` / `downloadExportFile` / `requestDeliveryExport` / `deliveryExportBlockedOf` + 6 个 hooks）、
  `components/host-center/*` 7 个组件（GateBanner / Slots / Min3Timeline / ObjectionCards / QuickCopy / ExportCard / Panel）、
  `components/dealer-center/DealerCenterPanel.tsx`、`components/delivery/*` 3 个组件（ContractCard /
  HostCenterMatrixTable / VersionHistoryPanel）；新增一级页面 `/hosts`（跨产品排产：筛选 `q` / `ready` 三态 / 分页，
  条件进 URL）、`/dealers`（经销商资料）、`/versions`（历史版本）；产品详情新增「历史版本」与「最终交付」两个 Tab
  （后者是 §51 主播中心十项与 §52 经销商中心十项的分段切换 + 导出卡），`IMPLEMENTED_TABS` 收到 15 个；
  `App.tsx` 把 `/hosts` `/dealers` `/versions` 的 `ModulePlaceholder` 换成真实页面并去掉 Phase 角标。
- 样式：`apps/web/src/styles.css` 新增「交付中心（Phase 15）」整段（`.gate-banner[data-state=...]` /
  `.slot-grid` / `.slot-card` / `.timeline*` / `.obj-*` / `.quick-*` / `.export-preview` / `.rule-list` 等），
  并在 `@media (max-width:1200px)` 把 `.slot-grid` / `.quick-grid` / `.obj-grid` 折叠为单列。
- 跨阶段回填：`DELIVERED_PHASES = [1..15]`；`/api/health` 的 `phase` 文案同步为
  `Phase 15｜主播中心 / 经销商中心与导出（Phase 1–15 已交付）`；`FACT_REVIEW_DOWNSTREAM` 清空为 `[]`
  （`packages/schemas/src/fact-review.ts` 注释同步）。
- 纯只读：交付层不调用任何 AI、不新增 Prompt Key（仍是 11 个）、不改写任何一句正文，导出用的也是现成正文。

### Phase 14（事实审核与人工审批，§24 / §25 / §49 / §53 / §57 / §62-14 / §62-15）
- `packages/schemas/src/fact-review.ts`（871 行）+ `fact-review-evidence.ts`：
  **§24 三层标记** `CLAIM_TYPE_LABELS` / `CLAIM_TYPE_HINTS`（FACT 事实 / INTERPRETATION 解释 / RHETORIC 修辞）、
  **§49 三档风险** `RISK_LEVEL_LABELS` / `RISK_LEVEL_HINTS`（GREEN 可发布 / YELLOW 需人工确认 / RED 禁止发布）、
  **§49 十三项焦点** `FACT_REVIEW_FOCUS_LABELS`（对标关系 / 研发关系 / 配方 / 原料 / 树龄 / 山头 / 年份 / 历史 /
  价格 / 市场第一 / 最贵 / 唯一 / 投资回报）、**§53 五列** `FACT_REVIEW_SENTENCE_COLUMNS`
  （句子 / Claim Type / Risk / Evidence / 修改建议）、`FACT_REVIEW_ENGINE_INFO`（`FACT_REVIEWER` /
  `ai_wired: true` / `rule_engine_authoritative: true`）、`FACT_REVIEW_LIMITS`（单成稿 20 个审核版本）、
  `FACT_REVIEW_DOWNSTREAM`（**现为 `[]`**：Phase 15 交付后不再登记下游交接）、`FACT_REVIEW_CONTRACT`
  （13 项 focus_items + 10 条 rules + 五个红线布尔 `rhetoric_not_fraud` / `red_blocks_approval` / `rhetoric_kept` /
  `keep_all_versions` / `rnd_requires_confirmation` + `ai_can_only_tighten`）、请求体 strict
  `factReviewGenerateSchema`（`record_id` / `use_ai` / `notes`）与 `factReviewDecisionSchema`（`version` / `note`）、
  纯函数 `factReviewSentences` / `factReviewEvidenceOf` / `buildFactReview` / `factReviewRecord` / `mergeFactReviewAi`。
- 数据库：`generated_claims`（**一句一行**：`copy_output_id` / `copy_version` / `review_version` / `engine` /
  评审级冻结结论 `overall_risk` · `publishable` · `rnd_confirmed` · `has_reliable_price_anchor` ·
  `price_high_story_ready` · `facts_used` · `compliance` · `evidence_gaps` · `warnings` /
  逐句行 `sentence_index` · `text` · `claim_type` · `risk` · `issue` · `suggestion` · `is_blocking` /
  人工审批 `approval_status` · `approval_note` · `reviewed_by` · `reviewed_at`，唯一约束
  `(copy_output_id, review_version, sentence_index)`）+ `claim_evidence`（逐句证据：`claim_id` / `source_ref` /
  `source_id` / `excerpt` / `evidence_kind` / `traceable`），均随产品与成稿级联删除；
  迁移 **`0014_slow_nightmare.sql`**（§36 只给表名，字段按 §24 / §49 / §53 落定），两表已登记进
  `services/api/tests/helpers/app.ts` 的 truncate 清单。
- API `services/api/src/modules/fact-review/{routes,fact-review.service}.ts`（717 行，8 条路由）：
  `GET /api/fact-review/contract`、`GET /api/fact-review/labels`、`GET /api/products/{id}/fact-review`、
  `GET /api/products/{id}/fact-review/versions`、`POST /api/products/{id}/fact-review/generate`（201）、
  `POST /api/products/{id}/fact-review/approve`、`POST /api/products/{id}/fact-review/reject`、
  `GET /api/products/{id}/fact-review/{reviewId}`；读需登录、写限 `ADMIN` / `RESEARCHER`；
  注册顺序把 `/versions` `/generate` `/approve` `/reject` 放在 `/:reviewId` 之前（否则被通配段吃掉）。
- 红线落地：**修辞不是事实造假**（身份句 / 画面句 / 反问句按 `RHETORIC` / `GREEN` 处理）；
  §49 十三项逐句带回命中；FACT 句必须有可逐字回查的出处（`claim_evidence` 的 `traceable` 行）；
  必涨 / 稳赚 / 保值 / 未来达到某价格 / 固定投资回报、无 `RND_CONFIRMED` 却暗示研发关系、
  无可靠价格锚点却写具体价格高度故事 → RED；**存在任何一条 RED 就禁止审批**：`approve` 返回 400 +
  `error.details.{ reviewed_version, blocking_sentences, publishable: false }`，`reject` 任何时候可用；
  审批只改状态与备注，**不改逐句判定与原文**。
- AI 接线：`FACT_REVIEWER` 是第一个真正接线的生成型 Agent（`ai_wired: true`），但**规则引擎权威、AI 只能加严**
  （`ai_can_only_tighten`）：AI 判出的 RED 一律保留、规则判出的 RED 不会被洗白；句数 / 文本对不上整份回落纯规则；
  Mock / AI 失败时回落纯规则并在 `warnings` 写明。其余四个生成型 Agent（产品结构 / 配方哲学 / 成稿 / 强化器）
  至今仍是纯规则、`ai_wired: false`。
- 版本与上限：每次 `generate` 新增一个审核版本（`review_version` 从 1 递增），旧审核逐句原样保留（§62-15）；
  单产品单一成稿 20 版封顶，第 21 次 400；`record_id` 指向不存在 / 跨产品的成稿返回 **400**
  （与既有模块范式一致，不是 404），`{reviewId}` 非 UUID 或不存在返回 404。
- 跨阶段回填：`DELIVERED_PHASES = [1..14]`；`packages/schemas/src/research.ts` 的 `FACT_REVIEW: 14` /
  `HUMAN_APPROVAL: 14` 随之标记为已交付；`/api/health` 的 `phase` 文案同步为
  `Phase 14｜事实审核与人工审批（Phase 1–14 已交付）`；`CATEGORY_CREATOR_DOWNSTREAM` / `VALUE_CODES_DOWNSTREAM` /
  `PRODUCT_ARCHITECTURE_DOWNSTREAM` / `FORMULA_PHILOSOPHY_DOWNSTREAM` / `SALES_COPY_DOWNSTREAM` **全部清空**
  （已交付阶段不再登记 `PENDING` 占位条目，交接关系写在合同 `rules` 里）。
- Web：产品详情「事实审核」Tab（合同卡 + 总览 + §53 逐句表 + 缺口 + 版本列表 + 审批 / 否决），
  `apps/web/src/components/fact-review/*` 6 个组件 + `lib/fact-review.ts`；`IMPLEMENTED_TABS` 加 `fact-review`；
  「证据中心」文案同步为 Phase 14 已交付；`CategoryCreatorContractCard` 在下游清单为空时渲染
  「下游交接已全部交付」的空状态，避免出现空表格。

### Phase 13（牛逼化强化器 Intensify「再狠一点」，§7 / §34 / §48）
（详见 `docs/roadmap.md` 的 Phase 13 小节，本文件不再重复逐项清单。）
- 四档按钮（普通 / 强势 / 爆款 / 王者，文案独立于 §21 强度短标签）、`INTENSIFY_FACT_RULE`（产出必须是源版本子集）、
  §48 八项自检（Level 4 ≥ 85 / Level 5 ≥ 90，未达标不阻断）；**不是改写，是用更高档画像把同一份事实重讲一遍**，
  只升不降、只新增版本（§62-15）；四道闸门（模式一致 / 只升不降 / 轮次 < 3 / 20 版封顶）；
  新增 `POST /api/products/{id}/copy/intensify`（201），不新增表与迁移；纯规则、`ai_wired: false`。

### Phase 12（强成交话术 Strong Sales Copy，§21 / §22 / §23 / §26 / §27 / §33 / §47 / §57）
（详见 `docs/roadmap.md` 的 Phase 12 小节，本文件不再重复逐项清单。）
- 十三格骨架 + §26 九种输出（核心 5 句 / 备用 20 句 / 15·30·60 秒 / 3 分钟 / Level 5 发布 / 经销商版 / 异议处理）、
  §47 七大卖点、§21 五档强度（默认 Level 4）、§23 八项评分（15/15/20/15/10/10/10/5 = 100）+ 四档分带、
  §22 七项 Level 5 要求（含 ≥ 3 句可独立传播金句）、§27 八段时序、§33 八项价值聚焦；
  表 `copy_outputs`（迁移 `0013_misty_plazm.sql`），8 条路由（contract / labels / 跨产品库 / 总览 / versions /
  generate / 单版 / PATCH）；**落库即冻结**，`PATCH` 只改确认与备注（§62-15）；
  事实不足只压分不降级（无锚点逐字用 §22 标准句）；纯规则 `ai_wired: false`。
- 本轮修复的真实缺陷 2 条：① 列表 `?missing=false` 被当成「没有筛选」静默返回全量；② 非 UUID 路径参数由 500 改 404。
  详见 `agent_memory/bugs.md`。

### Phase 11（配方哲学 Formula Philosophy，§6 / §6.1 / §46 / §57）
（详见 `docs/roadmap.md` 的 Phase 11 小节，本文件不再重复逐项清单。）
- 五分量顺序固定（backbone / aroma / sweetness / body / finish）、§46 Agent 8 五项输出、
  §6.1 比例口径（`known_ratio=false` 时带比例字样的已录入事实一律不进正文与 citations）、§57 验收；
  表 `formula_philosophies`（迁移 `0012_clean_blacklash.sql`），8 条路由（contract / labels / 跨产品库 /
  产品级总览 / versions / generate / 单版 / PATCH）；`formulaPhilosophyEvidenceGaps()` 是生成侧与回看侧
  **唯一实现**（Phase 11 的教训）。
- 本轮修复的真实缺陷 2 条：① `known_ratio=false` 被 `z.coerce.boolean()` 解析成 `true`（已改 `z.stringbool()`）；
  ② API 复制生成侧缺口逻辑时漏了「拼配描述比例字样不足以构成配比」一条（已抽公共实现）。详见 `agent_memory/bugs.md`。

### Phase 10（产品结构叙事 Product Architecture，§5 / §45 / §57）
（详见 `docs/roadmap.md` 的 Phase 10 小节，本文件不再重复逐项清单。）
- 九角色顺序固定（backbone / identity / aroma_role / body_role / front_stage_role / middle_stage_role /
  finish_role / memory_point / value_role）、§45 Agent 7 八问、§57 验收五问；
  表 `product_architectures`（迁移 `0011_smart_lord_tyger.sql`），8 条路由（contract / labels / 跨产品库 /
  产品级总览 / versions / generate / 单版 / PATCH）；事实不足的角色 `text = null` 并写明缺口（`GAP`），
  至少 3 个写实角色才允许 `value_role` 成立。
- 本轮修复的真实缺陷 5 条：① `value_role` 生成时永远 0 条引用；② 11 维全空 Value DNA 被当作已生成；
  ③ `writtenRolesExpr()` 缺括号导致排序静默失效；④ DNA 引用上限按单维度各取 3 导致一个角色可挂 15 条；
  ⑤ `toRoleView()` 未逐字回查正文。详见 `agent_memory/bugs.md`。

### Phase 5–9（候选池 / 价格证据 / 高价值锚点 / 自建标准 / 价值密码）
- 详细记录已归档到 `agent_memory/archive/progress-2026-09-23-phase5-9.md`，本文件只留索引。
- Phase 5：Candidate 候选池 + 十维相似度（权重 18/18/15/13/10/8/7/5/3/3 = 100，分档 55/70/85，价格不参与相似度）。
- Phase 6：Price Engine（五项 25/25/20/15/15 = 100，中位数 + MAD 异常值只标记不删除、357g / 1kg 等价、来源重建不覆盖人工登记）。
- Phase 7：Benchmark Mode / 高价值锚点（三种锚点、Sales Anchor 六项 30/25/15/15/10/5、显式排除 `SOURCE_UNATTRIBUTED` 价格证据、无达标候选强制进 Category Creator）。
- Phase 8：Category Creator Mode（两触发条件、六标准轴、`min_supported_axes = 2`、就绪度 READY/PARTIAL/INSUFFICIENT、风格身份证、价值逻辑）。
- Phase 9：Value Codes / Value Mapping（16 个 Code、§43 十二维度、五态判定、§19 固定句式、六类价值故事；`product_architecture_story` 已由 Phase 10 回填）。

### Phase 1–4（基础架构 / 事实层 / Value DNA / 研究流水线）
- 详细记录已归档到 `agent_memory/archive/progress-2026-09-23-phase1-4.md`。
- 要点：Phase 1 基础架构 + Auth/RBAC + 产品 CRUD + 核心功能锁定常量；Phase 2 事实 / 品饮 / 研发参考 + §25 语言拦截；
  Phase 3 Value DNA 与 Prompt 版本治理；Phase 4 搜索策略 / 来源台账 / 抓取 / 网页抽取（只落证据，绝不写产品事实）。

## 正在进行
- 部署调研（2026-09-24，「部署到免费的服务器上面去」）：**本项目不在规格基线内**——需求基线全文无「部署 / 服务器 /
  域名 / 托管」条款，属于运维新增需求，与 `agent_memory/bugs.md` 里已登记的「生产部署形态需产品方确认」同一条。
  - 可部署性（只读核对）：Web 是 Vite 静态产物（`vite build`，API 地址由 `VITE_API_BASE_URL` 在构建期注入）；
    API 是 Fastify + `tsx src/index.ts` **直跑 TypeScript**（全仓无 Dockerfile，部署必须带整个 pnpm workspace，
    因为 `@ldj/database` 等的 `main` 指向 `src/index.ts`）；DB 是 PostgreSQL 16，`pnpm db:migrate` / `db:seed`
    可直接对远程库执行，`.env` 已被 `.gitignore` 忽略，第三方 Key 不会进仓库。
  - 三个卡点：① 免费平台都要用户本人注册并授权（本机 GitHub CLI 已登录 `straughanmerton-cell`，可直接建私有仓库，
    但平台账号仍需本人点授权）；② `POST /api/chat/sessions/:id/messages` 是**同步出稿**，实测 80–143 秒，
    免费平台的网关/代理超时只能实测确认，若被掐断就得把出稿改成「异步任务 + 轮询」；③ 免费平台多在境外，
    国内访问不稳（Vercel / Cloudflare 域名常打不开），给国内团队/客户长期用要换国内轻量服务器。
  - 状态：等用户拍板平台与授权，**本轮未改任何代码、未建仓库**。
- 本轮（AI 对话工作台 + DeepSeek 接入）**已完成并收尾**：联调临时脚本已删（`scripts/` 只剩 `smoke/`）、
  `ldj_dev` 残留（1 款联调产品 + 5 个 chat 会话 + 12 条消息）已清零、`docs/api.md` 与 `agent_memory/` 已同步。
- 追加修复（同日）：登录态 401 自愈（前端 401 → 刷新 → 重试一次），已实测 13/13 通过并删掉临时脚本；
  用户侧只需刷新一次页面即可恢复（旧的过期令牌会被自动换新）。
- 无进行中的代码改动；**Phase 1–15 全部交付完毕**（源码 / 单测 / API 测试 / typecheck / web build / 冒烟 phase15 /
  回归 phase3–14 全绿，`ldj_dev` 业务表已清零），`docs/`（api / architecture / roadmap / prompts）与 `README.md`、
  `agent_memory/` 已同步到 Phase 15。
- 收尾清理已完成：临时文件 `.tmp_token.txt` / `.tmp_labels.json` / `.tmp_contract.json` 已删除；
  本轮临时启动的 Vite dev server（4401）已停止（4400 的 API 仍由 `tsx watch` 常驻，未动）。
- 全局口径（Phase 14 起确立，Phase 15 沿用）：**已交付**阶段的 `*_DOWNSTREAM` 交接清单一律清空
  （§60 口径，不用 `PENDING` 条目冒充「未交付」），交接关系由各合同的 `rules` 表达；
  Phase 15 交付后 `FACT_REVIEW_DOWNSTREAM` 也已清空 → 全仓 `*_DOWNSTREAM` 均为空数组。

## 下一步
- §60 的 Phase 清单已全部交付，长期目标可收口（已逐条核对六大核心功能与 §62 十五条铁律，见下）。
- 后续若继续迭代（不在 §60 范围内、需重新确认需求）：§35 / §54 的龙德记知识库表
  `knowledge_documents` / `knowledge_chunks` 尚未落地；`/api/meta/core-features` 之外的跨产品锚点独立页面仍未建。

## 验证记录
### 登录态 401 自愈修复（2026-09-24）
- 现象（用户截图）：登录超过 30 分钟后整个工作台全是 401（会话列表 / 工作台合同 / 发消息都报
  「访问令牌无效或已过期」），页面又不退回登录页。根因是前端从来没有刷新逻辑（详见 `agent_memory/bugs.md`）。
- 改法：新增 `apps/web/src/lib/session-store.ts`；`lib/api.ts` 401 → 刷新 → 重试一次（并发共用同一个
  `refreshInFlight`）；`lib/auth.tsx` 改 `useSyncExternalStore` 订阅同一份存储。
- 验证（临时 CDP 脚本，跑完已删）：**13 项断言全通过**。含前置校验「伪造的过期 token 确实被判 401、
  文案与截图一致」；场景 1（过期 token + 有效 refresh）→ 仍停在 `/chat`、旧令牌被自动换新、
  无「读取会话列表失败」/「读取对话工作台文案失败」、Console 零异常；场景 2（refresh 也无效）→ 回 `/login`
  且本地登录态被清；场景 3（正常表单登录回归）→ 点登录进 `/chat`。`pnpm -r typecheck` 9/9、
  `pnpm --filter @ldj/web build` 通过。
- 未验证：真实等待 30 分钟的自然过期路径未实跑（用伪造过期令牌等价覆盖）；移动端浏览器未覆盖。
### AI 对话工作台 + DeepSeek 接入（2026-09-24）
- **真实 DeepSeek 出稿实测 PASS**（临时脚本 `scripts/tmp-chat-e2e.mjs`，已删）：`provider === deepseek` /
  `model === deepseek-v4-pro` / `schema_valid === true`，单次 83 秒；`copy_blocks 1` / `quotes 5` / `objections 3`，
  `missing_facts` 与 `used_facts` 均如实；`session.message_count === 2`。修复 `max_tokens` 后连续三次成功
  （81 / 84 / 83 秒；修复前 143 秒时 502 截断）。
- **UI 端到端 PASS**（临时脚本 `scripts/tmp-chat-ui-e2e.mjs`，headless Chrome + CDP，已删）：未登录落 `/login` →
  登录落 `/chat`（「点击登录没反应」不再复现）→ 侧栏默认只有「AI 对话」+「专业模式」折叠区 → 展开后 15 个模块全在 →
  切 `/products` 自动展开并写 `localStorage` → 新对话预设六卡 → 发送出现等待气泡（进度条 + 秒表）→ 81 秒出稿
  （非空 headline / 有内容 block / 「整版复制」在 / 等待气泡消失 / URL 带 `?s=`）→ `missing_facts` 常驻醒目 →
  继续追问 chip 可填入 → 「整版复制」出 toast → `Page.reload` 会话与消息仍在；**控制台零 error / 零异常**。
  截图：`%TEMP%\ldj-ui-shots\{01-chat-default,02-pro-expanded,03-products,04-waiting,05-reply,06-reloaded}.png`（已人工看过 01/02/04/05）。
- 回归（本轮改了 `services/api/src/modules/chat/chat.service.ts` 与 `packages/ai/src/json.ts` 后重跑）：
  `pnpm --filter @ldj/schemas test` **13 文件 / 288 用例全通过**（含 `chat.test.ts` 27 个）；
  `pnpm --filter @ldj/api test` **15 文件 / 198 用例全通过**（≈245s，含 `chat.test.ts` 19 个）；
  `pnpm --filter @ldj/web build` 通过（286 modules，仅 zod 注释与 chunk > 500 kB 的无害告警）；`pnpm -r typecheck` 8/8。
- 数据清理：`ldj_dev` 现为 `products 0 / copy_outputs 0 / chat_sessions 0 / chat_messages 0 / value_codes 16 / users 1 / brands 1`。
- 未验证部分：**未做**跨浏览器的像素级复核（只有 headless Chrome 一条链路）；真实 DeepSeek 侧的出稿质量只做了
  一次绑定产品的抽样复验（83 秒那版），未做多产品批量质量对比；聊天工作台未接任何自动化回归脚本（临时脚本已删），
  后续若要长期守护需要把它固化成 `scripts/smoke/` 下常驻用例。
### Phase 15（2026-09-24）
- `pnpm --filter @ldj/schemas test`：**12 个文件 / 261 个用例**全通过（`delivery.test.ts` 新增 **33 个**：
  合同自检 / 六态闸门 / §51 与 §52 十项顺序与出处 / 两个中心的只读重排与缺口 / 导出渲染两格式三范围 /
  空成稿不出资料 / 请求体 strict）。
- `pnpm --filter @ldj/api test`：**14 个文件 / 179 个用例**全通过（≈191s，`delivery.test.ts` 新增 21 个）。
- `pnpm typecheck`：9 个 workspace 全通过；`pnpm --filter @ldj/web exec tsc -p tsconfig.json --noEmit` 0 错误；
  `pnpm --filter @ldj/web build` 通过（283 modules，仅 zod 注释与 chunk > 500 kB 的无害告警）。
- 端到端冒烟 `node scripts/smoke/phase15.mjs`：**125 项断言通过 / 0 失败**，覆盖合同自检（十项 × 2 / 两格式 /
  三范围 / 六态闸门顺序与标签 / 七条铁律 / `limits`）、无成稿时两中心 200 + 十格全空、跨产品排产列表
  （筛选 / `ready` 三态 / 排序 / 分页 camelCase）、事实齐备产品生成 Level 5 成稿 → 审核 → 人工 approve 后
  `ready=true` 且 `present=10/10`、导出 Markdown 与纯文本 × host / dealer / all、闸门未通过导出 409 +
  `details.blocking_sentences`、格式 / 范围大小写敏感 400、非 UUID 路径 404、只读权限（未登录 401，
  VIEWER 可读且无写权限要求）；结束后全部业务表清零（`value_codes` 保留 16 行字典属正常）。
- 回归（各自清理成功）：`phase3.mjs` 47/47、`phase4.mjs` 64/64、`phase5.mjs` 105/105、`phase6.mjs` 163/163、
  `phase7.mjs` 155/155、`phase8.mjs` 122/122、`phase9.mjs` 138/138、`phase10.mjs` 134/134、
  `phase11.mjs` 165/165、`phase12.mjs` 167/167、`phase13.mjs` 99/99、`phase14.mjs` 94/94。
- 回归修的 2 处都在**冒烟脚本自身**（非产品缺陷）：① `phase13.mjs` 把健康检查文案锁死成「Phase 13」，
  已按 `phase10.mjs` 的口径放宽为「phase 数字 ≥ 13 且含『已交付』」；② `phase8.mjs` 断言下游 `PENDING`
  条数，在 `*_DOWNSTREAM` 清空后改为断言空数组。**本轮未发现产品缺陷。**
- 视觉核对方式说明：本轮**未做像素级截图复核**（Computer Use 因 `Codex auth token is unavailable` 且无可用
  浏览器而失败），改用 Vite 模块编译（`/`、`/hosts`、`/dealers`、`/versions`、`HostCenterPanel`、
  `VersionHistoryPanel`、`styles.css` 均 200）+ `tsc` + `web build` + 冒烟 + API 实测替代。
### Phase 14（2026-09-24）
- `pnpm --filter @ldj/schemas test`：**11 个文件 / 228 个用例**全通过（`fact-review.test.ts` 新增 **36 个**：三层标记 / 三档风险 /
  §49 十三条焦点 / §53 五列 / 证据逐字回查 / AI 只能加严与整份回落 / 20 版上限 / 审批闸门 refine）。
- `pnpm --filter @ldj/api test`：**13 个文件 / 158 个用例**全通过（≈183s，`fact-review.test.ts` 新增 19 个）。
- `pnpm typecheck`：9 个 workspace 全通过；`pnpm --filter @ldj/web build` 通过。
  收口时抓到一处**测试文件类型问题**：`fact-review.test.ts` 手写的 `ReviewBody.claim_counts` 用了 `Record<string, number>`，
  vitest 不做类型检查所以用例全绿，但 `tsc` 在 `noUncheckedIndexedAccess` 下报 3 处 TS18048；已改为精确对象类型后复跑全绿。
- 端到端冒烟 `node scripts/smoke/phase14.mjs`：**94 项断言通过 / 0 失败**，覆盖合同自检（13 焦点 / 10 规则 / 5 条红线 + `ai_can_only_tighten`）、
  无成稿 400、事实齐备产品生成 Level 5 成稿后首次审核 201、证据逐字回查（`evidence_refs` 与 `claim_evidence` 排序后一致）、
  reject + approve 状态流、`use_ai` 重审升 v2 且 Mock 回落纯规则、循环到 20 版封顶（第 21 次 400）、
  红线文本注入后 RED 阻断审批（400 + `error.details.blocking_sentences` / `publishable: false`）、
  权限边界（VIEWER 可读不可写 / RESEARCHER 可生成但 RED 照样 `publishable: false` / strict 400 / 非 UUID 404）；
  结束后全部业务表清零（`generated_claims` / `claim_evidence` 一并清零，`value_codes` 保留 16 行字典）。
- 回归（各自清理成功）：`phase3.mjs` 47/47、`phase4.mjs` 64/64、`phase5.mjs` 105/105、`phase6.mjs` 163/163、
  `phase7.mjs` 155/155、`phase8.mjs` 122/122、`phase9.mjs` 138/138、`phase10.mjs` 134/134、`phase11.mjs` 165/165、
  `phase12.mjs` 167/167、`phase13.mjs` 99/99。
- 回归修的两处都是**脚本自身**（非产品缺陷）：① `phase13.mjs` 把健康检查文案锁死成「Phase 13」，Phase 14 交付后必然失败，
  已按 `phase10.mjs` 的口径放宽为「phase 数字 ≥ 13 且含『已交付』」；② `phase8.mjs` 断言「本版下游交接登记 N 条 PENDING」，
  在 `*_DOWNSTREAM` 清空后改为断言空数组（断言数 123 → 122）。
- 口径修正：已交付阶段的 `*_DOWNSTREAM` 一律清空（不再用 `PENDING` 占位冒充「未交付」），`DELIVERED_PHASES = [1..14]`，
  `/api/health` 文案为 `Phase 14｜事实审核与人工审批（Phase 1–14 已交付）`（已 curl 实测）。
### Phase 13（2026-09-23）
（详细记录见 `agent_memory/archive/progress-2026-09-24-phase10-14-detail.md`。）
- `pnpm --filter @ldj/schemas test` 10 文件 / **192 用例**、`pnpm --filter @ldj/api test` 12 文件 / **139 用例**、
  `pnpm typecheck` 9/9、`web build` 全通过；冒烟 `phase13.mjs` **99/99**；
  回归 phase3–12 全绿（phase8 口径当时为 123）。产品逻辑未被本阶段验证改动（所修问题都在冒烟脚本自身）。
- 口径修正：按钮文案独立于 §21 强度短标签（NORMAL = 「普通」）；`INTENSIFY_FACT_RULE` 改为「必须是源版本的子集」。
### Phase 12（2026-09-23）
（详细记录见 `agent_memory/archive/progress-2026-09-24-phase10-14-detail.md`。）
- `pnpm --filter @ldj/schemas test` 10 文件 / **178 用例**、`pnpm --filter @ldj/api test` 12 文件 / **139 用例**、
  `pnpm typecheck` 9/9、`web build` 全通过；冒烟 `phase12.mjs` **167/167**（含「事实不足 ≠ 平庸版」证明：
  fixture 实测 `facts_used = 5` / 总分 94 / `GREEN` / `acceptance.passed = true`）。
- 本轮修复的真实缺陷 2 条（详见 `agent_memory/bugs.md`）：`?missing=false` 静默返回全量；非 UUID 路径参数由 500 改 404。
### Phase 11（2026-09-23）
（详细记录见 `agent_memory/archive/progress-2026-09-24-phase10-14-detail.md`。）
- `pnpm --filter @ldj/schemas test` 9 文件 / **152 用例**、`pnpm --filter @ldj/api test` 12 文件 / **139 用例**、
  `pnpm typecheck` 9/9、`web build` 全通过；冒烟 `phase11.mjs` **165/165**。
- 首轮 164/1 的唯一失败是**真缺陷**（API 侧缺口清单漏一条），已抽公共实现修复。
### Phase 10（2026-09-23）
（详细记录见 `agent_memory/archive/progress-2026-09-24-phase10-14-detail.md`。）
- `pnpm --filter @ldj/schemas test` 8 文件 / **132 用例**、`pnpm --filter @ldj/api test` 12 文件 / **138 用例**、
  冒烟 `phase10.mjs` **134/134**；本轮 5 处单测失败中 4 处是断言口径错，只有「事实齐备仍判定未写实」是真缺陷。
### Phase 5–9
- 详细验证记录见 `agent_memory/archive/progress-2026-09-23-phase5-9.md`（Phase 9 冒烟 132、Phase 8 123、Phase 7 153、Phase 6 163、Phase 5 103；
  Phase 4/5/7/9 的期望值已随 Phase 10 追加断言上调到 64/105/155/138）。
### Phase 1–4
- 详见 `agent_memory/archive/progress-2026-09-23-phase1-4.md`（Phase 4 冒烟 62 项、Phase 2 冒烟 27 项、Phase 1 冒烟全通过，均已清理数据）。
