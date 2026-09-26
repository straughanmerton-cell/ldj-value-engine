# 任务进度

## 当前目标
- **当前交付形态（2026-09-26 用户追加需求，最新一轮）**：整个网页重新设计为**产品卖点工作台** —— 默认首页仍是 `/chat`，
  但产出形态从「直播话术」改为**产品卖点介绍**；用户给产品名后，系统**尽可能全网检索高价值对标产品**把卖点「吹大」。
  详见下「产品卖点工作台 V2」。六大核心功能与全部路由一个没删。
- **2026-09-24 需求（已完成）**：默认首页 = **AI 对话工作台 `/chat`** —— 用户只在一个对话框里说清需求，
  系统回「可直接念的话 + 哪几句有事实撑着 + 还缺哪些硬事实」；深度专业功能（含 Benchmark Mode / Category Creator Mode /
  产品结构 / 配方哲学 / 牛逼化按钮 / Level 5 王者话术）一个没删，全部收进侧栏「专业模式」折叠区。
- 按基线 §60 推进：**Phase 1–15 已全部交付并逐项验证**（Phase 13 = 牛逼化强化器「再狠一点」Intensify；
  Phase 14 = 事实审核与人工审批；Phase 15 = 主播中心 / 经销商中心 / 导出 / 历史版本，
  含 §51 十项、§52 十项、六态发布闸门与 Markdown / 纯文本导出）。
- **§60 的 Phase 清单已全部结束**（Phase 15 是最后一个 Phase），后续迭代均属基线外追加需求，需逐轮确认口径。
- 六个核心功能（Benchmark Mode / Category Creator Mode / 产品结构 / 配方哲学 / 牛逼化按钮 / Level 5 王者话术）保持锁定，不得裁剪。
- 唯一需求基线：`C:/Users/Administrator/Downloads/龙德记_AI高价值锚点与强成交话术系统_V2_成交增强版_开发规格.md`（§0–§64 / 2382 行，已完整阅读）。

## 已完成
### 产品卖点工作台 V2（2026-09-26，基线外追加需求：网页重设计 + 全网对标 + 卖点一页纸）
- 用户原话：「整个网页重新设计，不需要直播话术，我的需求是一个产品卖点介绍就可以了，另外这个卖点一定要根据我提供的产品名，
  尽可能去全网搜索高价值的对标产品，把卖点吹大」。
- 执行口径（**合理假设，未逐条向用户确认**，最终回复已注明）：
  ① 默认首页 `/chat` 的产出形态从「直播话术」改为**产品卖点介绍**；
  ② **不删**基线六大核心功能与任何路由（含 Level 5 王者话术），只改默认露出与文案；
  ③ 「吹大」= 修辞与价值高度放开（Level 4/5 + §22 七项 + §33 八项），**事实层仍逐字来自已录记录**；
  ④ 全网对标只贡献「价格高度 / 市场认知」，绝不搬运竞品原料 / 树龄 / 山头 / 年份 / 配方（§62-5）；
  ⑤ 查不到对标就走 Category Creator Mode（§62-10），不硬凑品牌。
- 后端对标链路：`packages/search/src/so360.ts`（360 免 Key 检索，15s 超时）+ `html.ts`（实体解码 / 去标签）+
  `bing.ts`；`createSearchProvider()` 支持 `mock|tavily|bing|so360`，`.env` / `.env.example` / `render.yaml`
  的 `SEARCH_PROVIDER` 均为 `so360`。`services/api/src/modules/chat/chat.service.ts` 新增第 4 参 `search`：
  `benchmarkQueries()`（两条必发含「茶」+ 一条品牌/年份/茶类/山头拼接）、`normalizeBenchmarkUrl()`、
  `filterBenchmarks()`（先要求「茶叶价格语境 + 命中产品名令牌」，一条都不命中退化为只要求「茶叶价格语境」——
  360 抓「六星孔雀」会混进「德龙国六卡车」「延超龙井新闻」，故必须过滤）、`benchmarkTokens()`；
  全部 `Promise.allSettled`，失败 / 超时 / 0 条一律降级 `[]`，**绝不阻塞出稿**。`benchmarks` 由**服务端回写**，
  模型自己编的链接整体覆盖（防死链）。单次检索实测 57–143 秒（真实 DeepSeek 出稿耗时），检索本身 15s 上限。
- 合同与 schema：`packages/schemas/src/chat.ts` 加 `CHAT_LIMITS.benchmarkQueries = 3` / `maxProductNameChars = 80`、
  `CHAT_SELLPOINT_FORM`（七段骨架 + 3 条硬要求）、`chatBenchmarkSchema`、`chatReplySchema.value_height`（≤400，nullable）
  与 `benchmarks`、`sendChatMessageSchema.product_name`（≤80，只当检索词）；`CHAT_CONTRACT` 加 `sellpoint_form` /
  `benchmark_policy`（`queries_per_run 3` / `maxBenchmarks 8` / `degrade`）/ `guarantees.benchmarks_are_real_sources`；
  六张预设卡第一张改「产品卖点介绍」并新增「对标谁、高在哪」；`CHAT_ROLE_LABELS.ASSISTANT = "AI 卖点"`。
- HANDCARD 卖点一页纸（对应竞品参考 `八角亭卖点手卡（7.30）.pptx`，先给三条路线 A/B/C，**用户选 A 后实现**）：
  `packages/schemas/src/delivery.ts` 的 `deliveryExportFormats` 加 `"HANDCARD"`（`.html` / `text/html; charset=utf-8`）
  + `HANDCARD_SECTION_META` 四段（01 产品介绍 / 02 核心卖点 / 03 口感特点 / 04 补充清单）+ `buildHandcardView()` +
  `renderHandcardHtml()`（单文件、无脚本、无外链、打印友好）；`delivery.service.ts` 的 `buildHandcard()` 读产品主档案原文，
  **没录入的项整行不出现**；前端 `DeliveryExportCard.tsx` 加「卖点一页纸」选项 + `text/html` 用 `<iframe sandbox srcDoc>` 预览。
- Web 重设计：`ChatPage.tsx` 的 `ReplyView` 重排为卖点卡（定位 + Pill + 复制整版 → 正文 → 核心卖点 → **价值高度**（金色左框）
  → **全网对标**（可点链接 / 域名 / 检索时间 / snippet / 复制来源，无数据时说明走 §62-10）→ §62-5 声明 → `missing_facts`
  （**移到对标之后**）→ 金句 → 异议 → 已录事实 → 追问 → 下一步）；新增 `productNameHint` 输入（maxLength 80，
  绑了产品时禁用）；标题「AI 产品卖点工作台」；`App.tsx` 副标题「AI 产品卖点与价值锚点」、交付中心组「主播中心」→「卖点交付」
  （**路由 `/hosts` 未动**）；老消息兜底 `payload.benchmarks ?? []` / `payload.value_height ?? null`。
- 冒烟：新增 `scripts/smoke/sellpoints.mjs`（**50/50 通过**）与 `scripts/smoke/handcard.mjs`（**33/33 通过**）；
  临时脚本 `scripts/tmp-ui-check.mjs` 已删。

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
- 开发库 `ldj_dev` 的唯一管理员由 `admin@longdeji.local` 改为 **`949412546@qq.com`**（口令见 `.env` 的 `BOOTSTRAP_ADMIN_PASSWORD`；scrypt 散列直接 UPDATE，
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
（详细记录已归档到 `agent_memory/archive/progress-2026-09-24-phase14-15-detail.md`，本文件只留要点。）
- `packages/schemas/src/delivery.ts`：§51 / §52 各十项、六态发布闸门（唯一一份 `ready`）、两格式（markdown / text）
  × 三范围（host / dealer / all）导出；**不新增表 / 迁移**（派生视图）；`*_DOWNSTREAM` 全空。
- API `services/api/src/modules/delivery/*` 6 条只读路由；闸门未过时两中心仍 200（十格全空），导出 409 + `blocking_sentences`。
- Web：`/hosts`（跨产品排产）/ `/dealers` / `/versions` 三个一级页面 + 产品详情「历史版本」「最终交付」两个 Tab；
  纯只读、不调用 AI、不新增 Prompt Key，不改写正文。

### Phase 14（事实审核与人工审批，§24 / §25 / §49 / §53 / §57 / §62-14 / §62-15）
（详细记录已归档到 `agent_memory/archive/progress-2026-09-24-phase14-15-detail.md`，本文件只留要点。）
- `packages/schemas/src/fact-review.ts`：§24 三层标记（FACT / INTERPRETATION / RHETORIC）、§49 三档风险
  （GREEN / YELLOW / RED）与十三项焦点、§53 五列；`rule_engine_authoritative: true` 且 `ai_can_only_tighten`。
- 表 `generated_claims`（一句一行）+ `claim_evidence`（逐句证据），迁移 `0014_slow_nightmare.sql`；8 条路由；
  **任何一条 RED 即禁止审批**（`approve` 400 + `blocking_sentences` 且 `publishable: false`）。
- Web：产品详情「事实审核」Tab（合同卡 + 总览 + §53 逐句表 + 缺口 + 版本列表 + 审批 / 否决）。

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
  - 进展（2026-09-24 本轮）：用户选定「GitHub CLI 已登录」这条路 → 已 `git init` + 首次提交（`35e638f`）+ 建 GitHub
    **私有**仓库 `https://github.com/straughanmerton-cell/ldj-value-engine` 并推送 `main`。架构定为**单服务**
    （同一个 Node 进程既出 `/api/**`，也托管 `apps/web/dist`）+ 外部 **Neon** 免费 Postgres（Render 免费库
    30 天会删，故不用）。新增 `services/api/src/plugins/web-static.ts`（生产托管 + SPA 深链兜底，非生产行为零变化）、
    `config.resolveServeWeb`、`render.yaml`（Blueprint）、`docs/deploy.md`（含「只做这 6 次点击」清单）。
  - 部署侧已验证：`pnpm -r typecheck` 9/9；`@ldj/api test` **198 passed / 15 files**；`@ldj/web build` 通过；
    生产形态端到端 **13/13**（深链不 404、同源登录落 `/chat`、无 401 文案、`/api/not-exists` 仍 404、
    `index.html` `no-cache` / hash 资源 `immutable`），临时验证脚本已删、临时 10000 端口进程已停。
  - 状态：**卡在平台 OAuth 授权**——Neon / Render 的「用 GitHub 登录」必须账号本人点，脚本无法代劳。用户点完并在
    Blueprint 表单粘 3 个变量（`DATABASE_URL` / `DEEPSEEK_API_KEY` / `BOOTSTRAP_ADMIN_PASSWORD`）后即可部署；
    部署后必做「真实出稿实测一次」，确认免费平台网关不掐断 2 分钟级同步请求（若掐断则出稿需改「异步任务 + 轮询」）。
    （2026-09-24 补充：按 Computer Use 确认策略，「创建账号」「授权 OAuth/API 访问」属动作时强制确认，代理不能代点；
    本机浏览器自动化还被安全层拦住——读不到 Chrome 当前网址，见 `bugs.md`。）
  - **零注册临时公网已上线（2026-09-24 本轮，备用路）**：新增 `scripts/serve-public.ps1` = 构建前端产物 +
    生产形态 API（`NODE_ENV=production` / `SERVE_WEB=true` / `127.0.0.1:4400` 同端口兼出前端）+ Cloudflare 快速隧道。
    实测 PASS（数字见下「验证记录」）：公网 `/api/health` ok、`/chat` 深链 200、hash 资源 `immutable`、
    管理员登录成功、**真实出稿 94.7 秒成功且未编造事实**（`provider=deepseek` / `model=deepseek-v4-pro` /
    `schema_valid=true`）→ 「2 分钟级同步请求被网关掐断」这个风险在隧道链路下不存在，Render 网关待部署后复测。
    局限：域名随机、cloudflared 退出或重启即失效、本机与 Docker 里的 Postgres 必须开着 → 过渡方案。
- 本轮（AI 对话工作台 + DeepSeek 接入）**已完成并收尾**：联调临时脚本已删（`scripts/` 只剩 `smoke/`）、
  `ldj_dev` 残留（1 款联调产品 + 5 个 chat 会话 + 12 条消息）已清零、`docs/api.md` 与 `agent_memory/` 已同步。
- 追加修复（同日）：登录态 401 自愈（前端 401 → 刷新 → 重试一次），已实测 13/13 通过并删掉临时脚本；
  用户侧只需刷新一次页面即可恢复（旧的过期令牌会被自动换新）。
- 无进行中的代码改动；**Phase 1–15 全部交付完毕**（源码 / 单测 / API 测试 / typecheck / web build / 冒烟 phase15 /
  回归 phase3–14 全绿，`ldj_dev` 业务表已清零），`docs/`（api / architecture / roadmap / prompts）与 `README.md`、
  `agent_memory/` 已同步到 Phase 15。
- （已闭环，2026-09-26）「卖点手卡」对照分析曾给三条路线（A 新增一页纸 / HTML 导出、B 增 `product_media` 带图、
  C 模板引擎直出 PPTX），**用户选 A** → 已实现 HANDCARD 卖点一页纸导出（详见「产品卖点工作台 V2」）。
- 本轮（产品卖点工作台 V2，2026-09-26）**已完成并提交**：commit `4c74e32`（Web 重设计 + 全网对标检索 +
  HANDCARD 一页纸，31 文件 / +3576 −312）；两个新冒烟脚本 `sellpoints.mjs`（50/50）与 `handcard.mjs`（33/33）全绿。
- 收尾清理已完成：临时文件 `.tmp_token.txt` / `.tmp_labels.json` / `.tmp_contract.json` 已删除；
  临时 UI 检查脚本 `scripts/tmp-ui-check.mjs` 已删除。
- 本轮（2026-09-26）**公网入口已重新拉起并实测可用**：主地址
  `https://pdas-proteins-catch-analysts.trycloudflare.com`（`scripts/serve-public.ps1 -Port 4402` 起的生产形态 API +
  快速隧道；同端口兼出前端），备用地址 `https://have-directors-require-declared.trycloudflare.com`（同一条后端，
  两条独立隧道）。**端口口径：4402 才是公网入口**，4400 是 `tsx watch` dev 形态（`SERVE_WEB=false`，`GET /` → 404）、
  4401 是 Vite dev（仅本机可用）。实测（全部走公网域名，非本机回环）：`/api/health` → 200 `database=up`；`/` → 200，
  产物为**新构建** `index-CCj0v9fk.js`（含「AI 产品卖点工作台 / 价值高度 / 全网对标 / 卖点一页纸 / 王者话术 /
  配方哲学 / Benchmark / Category Creator」，**不含**「直播话术」）；`/assets/index-*.js`、`/assets/index-*.css` → 200；
  管理员 `949412546@qq.com` 登录 → 200；公网 `/api/chat/contract` 七段 `sellpoint_form` + `benchmark_policy.enabled=true`；
  公网 `/api/delivery/contract` 三档格式含「卖点一页纸」。
- **公网链路真实出稿实测（2026-09-26，对标拿到了）**：走公网域名 `POST /api/chat/sessions` +
  `POST .../messages`（`product_name=六星孔雀` / `intensity=5`）→ **59 秒**返回 201，
  `benchmarks=5`（sohu / 19lou×3 / douyin，全部真实链接）、`value_height` 有值、`copy_blocks=7`；验证完会话已删除，
  `chat_sessions=0`。另：公网 `scripts/smoke/sellpoints.mjs` **50/50 通过**（其中真实出稿 70 秒，本次该产品名检索到 0 条
  → 如实走 §62-10 降级，同样 201）。
- 本轮追加（2026-09-26）**360 兜底页重试**：`So360SearchProvider` 加 `retries=2` / `retryDelayMs=400`（只在响应里
  没有 `res-list` 标记时重试，共用 15s 超时预算）；实测同一批查询由 0 条 → 3–4 条；`@ldj/search` 测试 20/20（+2 个新用例）、
  `@ldj/api` 的 chat 用例 26/26。上一轮的隧道曾在 4400 上因 QUIC 7844 不通 → 退 http2 后掉线，换 4402 重跑即恢复。
- 全局口径（Phase 14 起确立，Phase 15 沿用）：**已交付**阶段的 `*_DOWNSTREAM` 交接清单一律清空
  （§60 口径，不用 `PENDING` 条目冒充「未交付」），交接关系由各合同的 `rules` 表达；
  Phase 15 交付后 `FACT_REVIEW_DOWNSTREAM` 也已清空 → 全仓 `*_DOWNSTREAM` 均为空数组。

## 下一步
- §60 的 Phase 清单已全部交付；本轮（卖点工作台 V2）也已收尾，提交后本轮目标完成。
- 公网临时入口当前为 `https://pdas-proteins-catch-analysts.trycloudflare.com`（备用
  `https://have-directors-require-declared.trycloudflare.com`；随机域名，cloudflared 退出或机器重启即失效；
  重跑 `scripts/serve-public.ps1 -Port 4402` 可再拿一个新域名）；**正式对外仍建议 Render + Neon**（见 `render.yaml`）。
- 后续若继续迭代（不在 §60 范围内、需重新确认需求）：① 对标检索若要更稳，可申请 `TAVILY_API_KEY` 一键切
  `SEARCH_PROVIDER=tavily`（当前 `so360` 免 Key，但依赖第三方页面结构、无 SLA）；② §35 / §54 的龙德记知识库表
  `knowledge_documents` / `knowledge_chunks` 尚未落地；③ `/api/meta/core-features` 之外的跨产品锚点独立页面仍未建；
  ④ HANDCARD 若要带产品图，需走路线 B（新增 `product_media` 表），当前不做。

## 验证记录
### 产品卖点工作台 V2（2026-09-26）
- `pnpm --filter @ldj/web build`：通过（287 modules，`dist/assets/index-*.js` ≈1,021.87 kB；chunk > 500 kB 为既有告警，
  与本轮无关）；`pnpm -r typecheck`：**9/9 全通过**。
- `pnpm --filter @ldj/api test`：**15 文件 / 206 用例全通过**（≈200s，含本轮新增 chat 对标过滤 3 个用例）。
- `pnpm --filter @ldj/search test`：**2 文件 / 18 用例全通过**（`so360.test.ts` 8 + `bing.test.ts` 10）；
  `pnpm --filter @ldj/schemas test`：**13 文件 / 293 用例全通过**。
- 端到端冒烟 `node scripts/smoke/handcard.mjs`（`SMOKE_ADMIN_EMAIL=949412546@qq.com`）：
  **33/33 通过**（合同三档格式 / 四段 / 闸门 409 三态 / 完整审批链 / HTML 无脚本无外链 / §47 七条逐字上纸 /
  §11 没录的不出现 / 与 Markdown 同源 / 只读角色一致）；收尾 `products=0 · copy_outputs=0 · generated_claims=0 ·
  claim_evidence=0 · value_codes=16`。
- 端到端冒烟 `node scripts/smoke/sellpoints.mjs`（同上凭据）：**50/50 通过**。真实 DeepSeek 出稿耗时
  **42–111 秒**（`ai_provider=deepseek`）；未绑定产品 + 只给产品名时对标 0 条 → 走 §62-10 降级且**仍 201**，
  证明「检索失败 / 0 条不阻塞出稿」；早前同一链路实测过滤后 `benchmarks=6`（1688 / 19lou / qqddc / makepolo 等茶叶来源）。
- 修脚本时实测确认（非产品缺陷）：`POST /api/chat/sessions` 传**格式合法但不存在**的 `product_id` → **404**
  （`AppError.notFound`）；传**非法格式** `product_id`（`not-a-uuid`）→ **400**（zod schema 先拒，`z.uuid()` 校验
  RFC 9562 版本与变体位）。两条断言已按真实口径落定。
- `.env` 本地已是 `SEARCH_PROVIDER=so360`；`AI_PROVIDER=deepseek` / `DEEPSEEK_MODEL=deepseek-v4-pro` / `max_tokens=8000`。
- 数据清理：开发库现为 `chat_sessions=0 · chat_messages=0 · products=0 · copy_outputs=0 · value_codes=16`。
- 未验证：360 免 Key 抓取的长期稳定性（改版会解析到 0 条并如实降级，不伪造）；未做跨浏览器像素级截图复核。
### 临时公网部署（零注册路，2026-09-24）
- 手段：`scripts/serve-public.ps1`（本轮新增）→ 本机 4400 生产形态 + Cloudflare 快速隧道；脚本自带公网侧自检
  （先等隧道日志出现 `Registered tunnel connection` 再重试 `/api/health`，否则会撞上边缘还没连上的 `error code: 1033`）。
- 实测结果（全部走公网域名，不是本机回环）：
  - `GET /api/health` → `200 {"status":"ok","database":"up"}`；`/` → 200；深链 `/chat` → 200；
    hash 资源 → 200 且 `Cache-Control: public, max-age=31536000, immutable`。
  - `POST /api/auth/login`（`949412546@qq.com`）→ 200 / `role=ADMIN`；`GET /api/chat/sessions` 能读到既有会话。
  - **真实出稿 94.7 秒成功**：`provider=deepseek` / `model=deepseek-v4-pro` / `schema_valid=true`，
    王者档（`level: 5`）+ 5 条金句 + 异议处理；未录事实（年份 / 树龄 / 产量 / 价格）一律写【待补充】，不编造。
- 未验证：隧道数小时级稳定性；手机 / 4G 网络下的实际访问速度。
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
（详细记录见 `agent_memory/archive/progress-2026-09-24-phase14-15-detail.md`。）
- `schemas` 261 用例（`delivery.test.ts` 新增 33）/ `api` 179 用例（新增 21）/ typecheck 9/9 / web build 通过；
  冒烟 `phase15.mjs` **125/125**；回归 phase3–14 全绿；所修 2 处都在**冒烟脚本自身**，未发现产品缺陷。
### Phase 14（2026-09-24）
（详细记录见 `agent_memory/archive/progress-2026-09-24-phase14-15-detail.md`。）
- `schemas` 228 用例（`fact-review.test.ts` 新增 36）/ `api` 158 用例（新增 19）/ typecheck 9/9 / web build 通过；
  冒烟 `phase14.mjs` **94/94**；回归 phase3–13 全绿。口径修正：已交付阶段 `*_DOWNSTREAM` 一律清空。
### Phase 10–13（2026-09-23）
（详细记录见 `agent_memory/archive/progress-2026-09-24-phase10-14-detail.md` 与
`agent_memory/archive/progress-2026-09-24-phase14-15-detail.md` 的「Phase 10–13 验证记录」摘要。）
- 冒烟：`phase10.mjs` 134/134、`phase11.mjs` 165/165、`phase12.mjs` 167/167、`phase13.mjs` 99/99；回归全绿。
- `schemas` 用例数 132 → 152 → 178 → 192；`api` 用例数 138 / 139；`pnpm typecheck` 9/9、`web build` 全通过。
- 真实缺陷：Phase 10 的 5 处单测失败中 1 处真缺陷（「事实齐备仍判定未写实」）；Phase 11 / 12 各有真实缺陷
  （详见 `agent_memory/bugs.md`）；Phase 10 / 13 所修问题均在冒烟脚本自身。
### Phase 5–9
- 详细验证记录见 `agent_memory/archive/progress-2026-09-23-phase5-9.md`（Phase 9 冒烟 132、Phase 8 123、Phase 7 153、Phase 6 163、Phase 5 103；
  Phase 4/5/7/9 的期望值已随 Phase 10 追加断言上调到 64/105/155/138）。
### Phase 1–4
- 详见 `agent_memory/archive/progress-2026-09-23-phase1-4.md`（Phase 4 冒烟 62 项、Phase 2 冒烟 27 项、Phase 1 冒烟全通过，均已清理数据）。
