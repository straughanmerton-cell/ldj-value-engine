# 项目上下文

## 项目目标
- 项目：龙德记 AI 高价值锚点与强成交话术系统 V2（LDJ Value Engine V2）。
- 唯一需求基线：`C:/Users/Administrator/Downloads/龙德记_AI高价值锚点与强成交话术系统_V2_成交增强版_开发规格.md`（§0–§64 / 2382 行，已完整阅读）。
- 解决的问题：把茶叶产品的原料、工艺、感官、研发参考等事实，转化为「后台像分析师一样严谨、前台像顶级主播一样有压迫感」的高价值锚点与成交话术。
- 目标用户：品牌方运营 / 主播 / 经销商 / 研究员。
- 核心交付物：事实与价值研究流水线 + 相似度与锚点引擎 + Price Engine + 自建高端标准模式（Category Creator）+ 高价值话术生成（含 Level 5）+ 产品结构叙事 + 配方哲学 +「牛逼化」强化按钮 + 人工事实审核。
- 当前交付状态：**Phase 1–15 已全部交付并验证**（Phase 8 = Category Creator Mode，Phase 9 = Value Codes / Value Mapping，
  Phase 10 = 产品结构叙事 Product Architecture，Phase 11 = 配方哲学 Formula Philosophy，
  Phase 12 = 强成交话术 Strong Sales Copy（含 Level 5 王者话术），
  Phase 13 = 牛逼化强化器「再狠一点」Intensify，Phase 14 = 事实审核与人工审批（§24 / §49 / §53），
  Phase 15 = 主播中心 / 经销商中心 / 导出 / 历史版本（§31 / §51 / §52 / §53 / §57 / §60，只读派生视图））；
  §60 的 Phase 清单到此结束，阶段号以基线 §60 为准，无顺延。全仓已无 `501 + details.phase` 占位接口。
- **AI 对话工作台（2026-09-24 用户追加需求，非基线 Phase）**：默认首页改为 **`/chat`** —— 用户只在一个对话框里说需求，
  系统回「可直接念的话 + 哪几句有事实撑着 + 还缺哪些硬事实」；`/` 重定向 `/chat`，原首页改 `/dashboard`（工作台总览）；
  15 个专业模块收进侧栏「专业模式」折叠区（`localStorage["ldj.nav.professional"]`，切到专业路径自动展开）。
  **六大核心功能与全部路由一个没删**，专业模式可随时展开回到 Benchmark Mode / Category Creator / 产品结构 /
  配方哲学 / 牛逼化按钮 / Level 5 王者话术。真实 DeepSeek 已接入并实测出稿（口径见「当前约定」）。

## 关键约束
- 技术栈：TypeScript monorepo（pnpm workspace）；API = Fastify 5 + Drizzle ORM + PostgreSQL 16；Web = Vite 6 + React + TypeScript；AI/Search 走 Provider Adapter（无 Key 时回退 Mock）。
- 运行环境：Node ≥ 20（当前 v24.17.0）、pnpm 10、Docker（PostgreSQL 容器 `ldj-value-engine-postgres`，宿主端口 **55433**，库 `ldj_dev` / `ldj_test`）。
- 六大核心功能不得裁剪：Benchmark Mode、Category Creator Mode、产品结构叙事、配方哲学、牛逼化按钮、Level 5 王者话术。锁定实现见 `packages/schemas/src/core-features.ts` 与 `packages/schemas/src/thresholds.ts`。
- 15 条铁律（规格 §62）：不用模型记忆替代搜索、挂牌价≠成交价、整件价≠单饼价、价格不参与相似度、竞品事实不自动移植、不虚构研发关系/配方比例/树龄山头年份获奖大师、允许极强修辞、无对标自动进 Category Creator、「前台文案不得变成说明书」、Prompt 可版本管理、AI 输出必须 schema 校验、RED claim 禁止发布、所有版本必须保留。
- 未确认即不编造：未提供的产品字段一律存 NULL，禁止自动补全（`packages/schemas` 已强制）。
- 前台强表达与后台事实分离：FACT / INTERPRETATION / RHETORIC（规格 §24）；修辞可极限，事实不可造假。

## 重要路径
- 产品录入与阈值：`packages/schemas/src/{product,enums,thresholds,core-features,forbidden-claims}.ts`
- 产品记录层（Phase 2）：`packages/schemas/src/{product-fields,fact,tasting,rnd}.ts`（事实键目录、六态治理、§10.4 感官字段、§35.2 研发参考与 §25 语言规则）
- Value DNA 与 Prompt（Phase 3）：`packages/schemas/src/{value-dna,fact-normalizer,prompt}.ts`；`services/api/src/modules/{value-dna,prompts}/`；`services/api/src/lib/value-dna.ts`
- 研究流水线（Phase 4）：`packages/schemas/src/{search,source,extraction,research}.ts`；`services/api/src/modules/research/{routes,search-plan.service,research.service,source.service,crawler.service}.ts`
- 候选池与相似度（Phase 5）：`packages/schemas/src/{comparable,similarity}.ts`；`services/api/src/modules/candidates/{routes,similarity.service,candidates.service}.ts`；前端 `lib/candidates.ts`、`pages/HighValueDbPage.tsx`
- 价格证据（Phase 6）：`packages/schemas/src/price.ts`；`services/api/src/modules/prices/{routes,market-prices.service}.ts`；前端 `lib/market-offers.ts`、`pages/MarketPricesPage.tsx`、`components/prices/*`；产品详情「价格证据」Tab
- 高价值锚点与对标模式（Phase 7）：`packages/schemas/src/anchor.ts`；`services/api/src/modules/anchors/{routes,anchors.service}.ts`；前端 `lib/anchors.ts`、`components/anchors/*`、产品详情「高价值锚点」Tab
- 自建高端标准（Phase 8）：`packages/schemas/src/category-creator.ts`（两触发条件 / 六标准轴 / 就绪度 / 风格身份证 / 价值逻辑 / 合同 / `buildCategoryCreatorDraft`）；`packages/database/src/schema/category-creator-profiles.ts`；`services/api/src/modules/category-creator/{routes,category-creator.service}.ts`（7 条路由：contract / labels / 产品级总览 / versions / generate / 单版 / PATCH 人工确认）；前端 `lib/category-creator.ts`、`components/category-creator/*`，挂在产品详情「高价值锚点」Tab 内（非独立 Tab）
- 价值密码 / 价值映射（Phase 9）：`packages/schemas/src/value-codes.ts`（16 个 Code / §43 十二维度 / 五态判定 / §19 句式 / 六类价值故事 / 合同 / `buildValueMapping`）；`packages/database/src/schema/value-codes.ts`（`value_codes` 字典 + `product_value_codes` 版本表）；`services/api/src/modules/value-codes/{routes,value-codes.service}.ts`（8 条路由：contract / labels / 跨产品价值密码库 / 产品级总览 / versions / generate / 单版 / PATCH 人工确认）；前端 `lib/value-codes.ts`、`components/value-codes/*`（9 个组件）、`pages/ValueCodesPage.tsx`（`/value-codes`）、产品详情「价值映射」+「价值密码」两个 Tab
- 产品结构叙事（Phase 10）：`packages/schemas/src/product-architecture.ts`（九角色顺序 / §45 八问 / §57 验收五项 / 6 条红线 / `PRODUCT_ARCHITECTURE_DOWNSTREAM` / 纯函数 `buildProductArchitecture`、`productArchitectureCitations`、`productArchitectureSummary`、`productArchitectureGapReason`、`productArchitectureFactValue`）；`packages/database/src/schema/product-architectures.ts`；`services/api/src/modules/product-architecture/{routes,product-architecture.service}.ts`（8 条路由：contract / labels / 跨产品结构库 / 产品级总览 / versions / generate / 单版 / PATCH 人工确认）；前端 `lib/product-architecture.ts`、`components/product-architecture/*`（8 个组件）、`pages/ProductArchitecturePage.tsx`（`/architecture`）、产品详情「产品结构」Tab；单测 `packages/schemas/tests/product-architecture.test.ts`（17 个）
- 配方哲学（Phase 11）：`packages/schemas/src/formula-philosophy.ts`（五分量顺序 backbone / aroma / sweetness / body / finish、§46 Agent 8 五项输出、§6.1 比例口径 `resolveFormulaRatio` / `extractRatioFromBlendDescription` / `validateRatioEvidence`、`FORMULA_PHILOSOPHY_CONTRACT`、`FORMULA_PHILOSOPHY_DOWNSTREAM`（Phase 15 交付后为空数组）、纯函数 `buildFormulaPhilosophy`、`formulaPhilosophyEvidenceGaps`（生成侧与回看侧同一实现）、`formulaPhilosophySummary`、`formulaPhilosophyAcceptance`、`formulaPhilosophyCitations`、`containsRatioExpression`、`formulaPhilosophyRoles`）；`packages/database/src/schema/formula-philosophies.ts`；`services/api/src/modules/formula-philosophy/{routes,formula-philosophy.service}.ts`（8 条路由：contract / labels / 跨产品配方哲学库 / 产品级总览 / versions / generate / 单版 / PATCH 人工确认）；前端 `lib/formula-philosophy.ts`、`components/formula-philosophy/*`（8 个组件）、`pages/FormulaPhilosophyPage.tsx`（`/formula-philosophy`）、产品详情「配方哲学」Tab；单测 `packages/schemas/tests/formula-philosophy.test.ts`（19 个）
- 强成交话术（Phase 12）+ 牛逼化强化器（Phase 13）：两者共用同一个文件与同一张表。`packages/schemas/src/sales-copy.ts`（≈4123 行：十三格骨架 / §21 五档强度 `COPY_INTENSITY_META` / §23 八项 `IMPACT_SCORE_META` 与四档 `IMPACT_SCORE_BAND_META` / §22 七项 `LEVEL5_REQUIREMENT_META` / §26 九种输出 `SALES_COPY_OUTPUT_META` / §47 十五项 `SALES_COPY_AGENT9_OUTPUTS` / §27 八段 `MIN3_TIMELINE` / §33 八项 `VALUE_FOCUS_META` / §34 `INTENSIFY_BUTTON_META` + `INTENSIFY_ACTIONS_BY_LEVEL` + 四档按钮文案 `INTENSIFY_BUTTON_LABELS` + `INTENSIFY_FACT_RULE`（强化只能是源版本子集）/ `SALES_COPY_LIMITS` / `SALES_COPY_DOWNSTREAM`（Phase 15 交付后为空数组）/ `SALES_COPY_CONTRACT` / `SALES_COPY_ENGINE_INFO`（`ai_wired: false`）/ §48 `INTENSIFY_SELF_CHECK_META` + `intensifySelfCheckSchema` / 纯函数 `buildSalesCopy`、`salesCopyReviewOf`、`salesCopyCitations`、`salesCopyEvidenceGaps`、`salesCopyOutputStatuses`、`intensifySalesCopy`、`intensifyFactDiff`、`intensifySelfCheckOf`、`intensifyTargetIntensity`、`intensifyGuardReason`、`changedElementsOf`、`salesCopyBodyOf`）；`packages/database/src/schema/copy-outputs.ts`（`copy_outputs` 21 列，唯一约束 `(product_id, version)`，迁移 `0013_misty_plazm.sql`，`intensify_rounds` 默认 0、Phase 13 无需新迁移）；`services/api/src/modules/sales-copy/{routes,sales-copy.service}.ts`（9 条路由：contract / labels / 跨产品强成交话术库 / 产品级总览 / versions / generate / **intensify（201）** / 单版 / PATCH 人工确认）；前端 `lib/sales-copy.ts`、`components/sales-copy/*`（9 个组件，含「再狠一点」四档按钮组与 §48 自检）、`pages/SalesCopyPage.tsx`（`/copy` 强成交话术库）、产品详情「强成交话术」Tab；单测 `packages/schemas/tests/sales-copy.test.ts`（40 个）
- 事实审核与人工审批（Phase 14）：`packages/schemas/src/fact-review.ts`（871 行：`FACT_REVIEW_SPEC_REF = "§24 / §25 / §49 / §53"`、`FACT_REVIEW_FOCUS_LABELS` 13 项 §49 焦点 / `CLAIM_TYPE_LABELS·HINTS` 三层 FACT·INTERPRETATION·RHETORIC / `RISK_LEVEL_LABELS·HINTS` 三档 GREEN·YELLOW·RED / `FACT_REVIEW_SENTENCE_COLUMNS` §53 五列 / `FACT_REVIEW_CONTRACT`（10 规则 + 5 条红线布尔 + `ai_can_only_tighten`）/ `FACT_REVIEW_LIMITS.maxVersionsPerCopy = 20` / `FACT_REVIEW_ENGINE_INFO`（`ai_wired: true` 但 `rule_engine_authoritative: true`）/ `FACT_REVIEW_DOWNSTREAM = []`（Phase 15 交付后清空）/ 纯函数 `buildFactReview`、`mergeFactReviewAi`（AI 只能加严；句数或文本不匹配则**整份回落纯规则**）、`factReviewSentences`、`factReviewEvidenceOf`、`factReviewRecord`）+ `fact-review-evidence.ts`（证据行口径，与 `claim_evidence` 表同源）；`packages/database/src/schema/{generated-claims,claim-evidence}.ts`（迁移 `0014_slow_nightmare.sql`，一句一行 + 逐句证据）；`services/api/src/modules/fact-review/{routes,fact-review.service}.ts`（8 条路由：contract / labels / 产品级总览 / versions / generate / approve / reject / 单版；基线 §37 未列事实审核路由，按既有模块范式自建）；前端 `lib/fact-review.ts`、`components/fact-review/*`（6 个组件）、产品详情「事实审核」Tab
- 主播中心 / 经销商中心 / 导出 / 历史版本（Phase 15，只读交付层）：`packages/schemas/src/delivery.ts`（§51 十项
  `HOST_CENTER_SLOT_META` / §52 十项 `DEALER_CENTER_SLOT_META` / 六态发布闸门 / 导出渲染 `renderDeliveryExport` /
  `DELIVERY_LIMITS` / `DELIVERY_DOWNSTREAM = []`）；`services/api/src/modules/delivery/{routes,delivery.service}.ts`
  （6 条只读路由：delivery/contract、delivery/labels、host-center 列表、产品级 host-center / dealer-center /
  delivery/export）；**不新增表**（派生视图，现算 `copy_outputs` + `generated_claims`，历史版本复用既有
  `copy/versions` 与 `fact-review/versions`）；前端 `lib/delivery.ts`、`components/host-center/*`（7 个）、
  `components/dealer-center/DealerCenterPanel.tsx`、`components/delivery/*`（3 个）、
  `pages/{HostCenterPage,DealerCenterPage,VersionsPage}.tsx`（`/hosts` / `/dealers` / `/versions`）、
  产品详情「历史版本」+「最终交付」两个 Tab；单测 `packages/schemas/tests/delivery.test.ts`（33 个）+ `services/api/tests/delivery.test.ts`（21 个）、冒烟 `scripts/smoke/phase15.mjs`（125 项）
- AI 对话工作台（2026-09-24，默认首页；Prompt 走 `packages/schemas` 纯函数，**不新增 Prompt Key**，`prompts/` 仍是 11 个 md）：
  `packages/schemas/src/chat.ts`（`CHAT_SPEC_REF` / `CHAT_LIMITS` / `CHAT_IRON_RULES` / 6 条 `CHAT_PRESETS` /
  5 条 `CHAT_ONBOARDING_QUESTIONS` / `CHAT_CONTRACT` / `buildChatSystemPrompt`）；`packages/database/src/schema/chat.ts`
  + 迁移 `0015_right_hercules.sql`（`chat_sessions` / `chat_messages`）；`services/api/src/modules/chat/{routes,chat.service}.ts`
  （8 条路由：contract / labels / 会话列表 / 建会话 / 会话详情 / 发消息 / 重命名 / 删除）；前端
  `apps/web/src/pages/ChatPage.tsx` + `apps/web/src/lib/chat.ts`（样式在 `styles.css` 末尾 + 两个既有媒体查询内）；
  `apps/web/src/App.tsx` 的 `PRIMARY_NAV = { label: "AI 对话", path: "/chat" }` / `PRO_NAV_STORAGE_KEY` / `PRO_PATHS`（15 条）；
  单测 `packages/schemas/tests/chat.test.ts`（27 个）+ `services/api/tests/chat.test.ts`（19 个）
- 前端登录态（2026-09-24 修复 401 卡死时引入）：`apps/web/src/lib/session-store.ts` 是登录态的**唯一存储层**
  （`getSession` / `setSession` / `subscribeSession`，localStorage key `ldj.session`），`lib/auth.tsx`
  用 `useSyncExternalStore` 订阅它，`lib/api.ts` 的 `apiRequest` 在 401 时用 `refresh_token` 换新令牌并重试一次
  （并发去重；`/api/auth/*` 不参与，避免递归）。**access token 只有 30 分钟，刷新逻辑不能再删**。
- API：`services/api/src/{server,routes}.ts`，模块在 `services/api/src/modules/*`（Phase 2 记录类接口在 `modules/product-records/`），集成测试在 `services/api/tests/*`
- Agent Prompt 正文（11 个）：`prompts/*.md`，注册表 `packages/prompts/src/registry.ts`
- 前端：`apps/web/src/**`；路由与导航在 `App.tsx`；产品详情 `pages/ProductDetailPage.tsx` 按 §32 拆 15 Tab（记录类面板在 `components/product-records/`）；
  研究相关页面 `pages/{ResearchPage,HighValueDbPage,EvidencePage,ValueCodesPage}.tsx`、数据层 `lib/research.ts`、组件 `components/research/*`；
  候选池数据层 `lib/candidates.ts`＋组件 `components/research/CandidatesPanel.tsx`（`/high-value-db`）；价格数据层 `lib/market-offers.ts`＋组件 `components/prices/*`（`/market-prices`）；
  锚点数据层 `lib/anchors.ts`＋组件 `components/anchors/*`（产品详情「高价值锚点」Tab；跨产品锚点列表目前只有 API `GET /api/anchors`，尚未建独立页面）；
  自建标准数据层 `lib/category-creator.ts`＋组件 `components/category-creator/*`（同样挂「高价值锚点」Tab）；
  产品结构数据层 `lib/product-architecture.ts`＋组件 `components/product-architecture/*`＋`pages/ProductArchitecturePage.tsx`（`/architecture`，与 Phase 10 同时建的唯一独立一级页面）；未实现模块显示 Phase 占位
  配方哲学数据层 `lib/formula-philosophy.ts`＋组件 `components/formula-philosophy/*`（8 个）＋`pages/FormulaPhilosophyPage.tsx`（`/formula-philosophy` 跨产品配方哲学库）＋产品详情「配方哲学」Tab；未实现模块显示 Phase 占位
  强成交话术数据层 `lib/sales-copy.ts`＋组件 `components/sales-copy/*`（9 个）＋`pages/SalesCopyPage.tsx`（`/copy` 跨产品强成交话术库）＋产品详情「强成交话术」Tab；未实现模块显示 Phase 占位
  事实审核数据层 `lib/fact-review.ts`＋组件 `components/fact-review/*`（6 个：合同卡 / 总览卡 / 逐句表 / 缺口卡 / 版本列表 / Panel）＋产品详情「事实审核」Tab
  交付中心数据层 `lib/delivery.ts`＋组件 `components/host-center/*`（7 个：GateBanner / Slots / Min3Timeline / ObjectionCards / QuickCopy / ExportCard / Panel）、`components/dealer-center/DealerCenterPanel.tsx`、`components/delivery/*`（3 个：ContractCard / HostCenterMatrixTable / VersionHistoryPanel）＋页面 `pages/{HostCenterPage,DealerCenterPage,VersionsPage}.tsx`（`/hosts` 跨产品排产 / `/dealers` 经销商资料 / `/versions` 历史版本）＋产品详情「历史版本」与「最终交付」（§51 / §52 分段切换 + 导出卡）两个 Tab；`App.tsx` 现只剩 `/knowledge` 一个业务占位模块（§60 之外的知识库，尚未落地）
- 冒烟脚本：`scripts/smoke/phase{3,4,5,6,7,8,9,10,11,12,13,14,15}.mjs`（先 `pnpm dev:api`，脚本自建数据并在结束时清理；
  phase4 = 64 / phase5 = 105 / phase6 = 163 / phase7 = 155 / phase8 = 122（Phase 14 前为 123，`*_DOWNSTREAM` 清空后改断言）/
  phase9 = 138 / phase10 = 134 / phase11 = 165 / phase12 = 167 / phase13 = 99 / phase14 = 94 / **phase15 = 125** 项断言）
- 文档：`docs/{PRD,architecture,scoring,api,prompts,roadmap}.md`；入口说明 `README.md`
- 环境变量：`.env.example`（样板）/ `.env`（本地实际值，不提交）

## 当前约定
- 默认使用中文记录。
- 只保留当前有效信息，过期内容归档到 `agent_memory/archive/`。
- 端口占用规避：455xx 段被其他项目占用，本项目 PostgreSQL 使用 55433，API 4400，Web 4401。
- `.env` 由仓库根目录加载（`packages/database/src/env.ts` 的 `loadRepoEnv()`），dotenv 不覆盖已有变量，测试环境优先 `TEST_DATABASE_URL`。
- 开发库只保留 seed 数据（默认品牌「龙德记」+ 管理员）：联调、冒烟、截图用的业务数据用完即删，不留样本产品。
- 当前管理员账号（开发库实际值）：`949412546@qq.com` / `shi123456`；seed 默认邮箱已同步为该邮箱
- 前端 UI 端到端验证手段（Computer Use 不可用时用这个）：本机 Chrome 路径
  `C:\Program Files\Google\Chrome\Application\chrome.exe`，用 `--headless=new --remote-debugging-port=<端口> --user-data-dir=<临时目录>`
  启动后通过 CDP（Node 24 自带 `WebSocket` + `fetch` 探测 `/json/list`）驱动，能真实点击 React 受控表单
  （`HTMLInputElement.prototype.value` 的 setter + `input` 事件）并读取 `location.pathname` / DOM 与 4xx 请求，
  已验证登录跳转链路；不要再声称「无法做 UI 复核」。
  （`.env` / `.env.example` 的 `BOOTSTRAP_ADMIN_EMAIL` 与 `seed.ts` 兜底值），因该邮箱已存在，重跑 `pnpm db:seed` 只会跳过、不会再造第二个管理员。
- 冒烟管理员账号：脚本内兜底值仍是 `admin@longdeji.local` / `ChangeMe_123456`（旧账号已失效），
  跑冒烟前必须用 `SMOKE_ADMIN_EMAIL=949412546@qq.com` / `SMOKE_ADMIN_PASSWORD=shi123456`（可用 `SMOKE_API_BASE` 覆盖接口地址）。
- 已交付阶段一律从 `*_DOWNSTREAM` 交接清单里删除（§60 口径）：Phase 15 交付后
  `CATEGORY_CREATOR_DOWNSTREAM` / `VALUE_CODES_DOWNSTREAM` / `PRODUCT_ARCHITECTURE_DOWNSTREAM` /
  `FORMULA_PHILOSOPHY_DOWNSTREAM` / `SALES_COPY_DOWNSTREAM` / `FACT_REVIEW_DOWNSTREAM` / `DELIVERY_DOWNSTREAM`
  **全仓均为空数组**。跨阶段的交接关系写在各合同的 `rules` 里，不再用 `PENDING` 条目冒充「未交付」。
- AI Provider 口径（2026-09-24 起）：`.env` / `.env.example` 为 `AI_PROVIDER=deepseek` /
  `DEEPSEEK_API_KEY=sk-****（明文只允许在 .env 与部署平台环境变量里，任何 md / 源码 / 截图都不得抄写）` /
  `DEEPSEEK_BASE_URL=https://api.deepseek.com/v1` /
  `DEEPSEEK_MODEL=deepseek-v4-pro`（V4-Pro，100 万上下文）；实现是 `packages/ai/src/deepseek.ts` 的
  `DeepSeekProvider extends OpenAiProvider`（OpenAI 兼容协议，只换 baseURL / 模型名）。
  前端判断「真模型还是 mock」的**唯一来源**是 `GET /api/chat/labels` 的 `ai_provider`（`deepseek` = 真模型）。
  真实单次出稿 **80–143 秒**（实测 81 / 83 / 84 秒成功），前端必须有等待态。
- 密钥纪律（2026-09-24 立）：真实 `DEEPSEEK_API_KEY` 只存在于 `.env`（已被 `.gitignore` 忽略）与部署平台的环境变量；
  建仓推送前扫描发现 `context.md` 曾写入明文，已改占位符。**提交前必跑一次明文密钥扫描**。
- 部署形态（2026-09-24，运维新增需求，**不在需求基线 §0–§64 内**）：**单服务** = Render 免费 Web Service（Node 22）
  同一进程既出 `/api/**` 又托管 `apps/web/dist`（`services/api/src/plugins/web-static.ts`，只在 `NODE_ENV=production`
  或显式 `SERVE_WEB=true` 时开启，本地开发与单测行为零变化）+ 外部 **Neon** 免费 Postgres
  （Render 免费库创建 30 天后会被删除，故不用）。仓库 `https://github.com/straughanmerton-cell/ldj-value-engine`（私有），
  配置见 `render.yaml` / `docs/deploy.md`。前端与 API 同源 → 免 CORS、不必构建期写死 API 地址；
  `CORS_ORIGINS` / `API_PUBLIC_URL` 里硬编码了 `ldj-value-engine.onrender.com`（服务名被占时这两个变量要同步改，
  同源前端不受影响，且 `API_PUBLIC_URL` 目前全仓仅被 env schema 引用、无运行时使用点）。
- 部署命令口径：`startCommand` = `db:migrate` → `db:seed` → `@ldj/api start`，三步都幂等（seed 只在品牌 / 管理员
  不存在时插入）；线上管理员邮箱由 `BOOTSTRAP_ADMIN_EMAIL`（已是 `949412546@qq.com`）决定，密码由平台变量
  `BOOTSTRAP_ADMIN_PASSWORD` 在**首次 seed** 时写成散列，之后改该变量不会改已存在的账号。
- 平台账号边界：Neon / Render 的「用 GitHub 登录」OAuth 授权**只能账号本人点**；本机 `gh` 已登录
  `straughanmerton-cell`，建私有仓库与 `git push` 可自动化，平台登录与 GitHub App 仓库授权不行。
