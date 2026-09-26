# 项目上下文

## 项目目标
- 项目：龙德记 AI 高价值锚点与强成交话术系统 V2（LDJ Value Engine V2），TypeScript monorepo。
- 唯一需求基线：`C:/Users/Administrator/Downloads/龙德记_AI高价值锚点与强成交话术系统_V2_成交增强版_开发规格.md`（§0–§64 / 2382 行，已完整阅读）。
- 解决的问题：把茶叶产品的原料 / 工艺 / 感官 / 研发参考等事实，转成「后台像分析师一样严谨、前台像顶级主播一样有压迫感」的高价值锚点与成交话术。
- 目标用户：品牌方运营 / 主播 / 经销商 / 研究员。
- **当前交付形态（2026-09-26 用户指令，最高优先级）**：界面收敛为**单页「产品卖点一页纸」**，且这一页就是**一屏一页的 16:9 幻灯片**（`SLIDE_W=1280` × `SLIDE_H=720`，不是网页长文）——
  打开就是「写产品名 + 说需求 → 出一页纸」，纸外辅助内容（待补硬事实 / 对标来源 / 已录事实 / 依据与可信度）全收进**右侧抽屉**，默认收起；
  纸面固定四段（01 产品介绍 / 02 核心卖点 / 03 口感特点 / 04 补充清单），**版式逐块对齐 `八角亭卖点手卡（7.30）.pptx` 第 1 页**：
  左上大标题（产品名）+ 左栏**并排两张**产品图 + 右栏四条同色箭头块（`homePlate` 箭头 + 主题色 `#4472C4 / #ED7D31 / #A5A5A5 / #70AD47`，正文用同色系深一档），无金色压条、无分隔线；
  可**打印 / 存 PDF**（`@page 13.333in × 7.5in` 一页一张）也可**真导出 `.pptx`**；
  左栏产品图最多两张（**图只存本机 localStorage，不入库、不上服务器**）。
  卖点按用户给的产品名**尽可能全网检索高价值对标产品**再「吹大」（修辞放开，事实不动）。
  **这是对基线 §60「核心功能不得裁剪」的收缩，是用户指令优先的结果**：15 个专业模块从**界面**下掉，
  页面文件与后端模块**全部保留**，可随时恢复（六大核心能力仍在后端 Prompt / 接口里）。
- 阶段状态：基线 §60 的 **Phase 1–15 已全部交付并验证**；此后均为基线外追加需求（2026-09-24 AI 对话工作台、2026-09-26 产品卖点工作台 V2）。
  全仓已无 `501 + details.phase` 占位接口。

## 关键约束
- 技术栈：TypeScript monorepo（pnpm workspace）；API = Fastify 5 + Drizzle ORM + PostgreSQL 16；Web = Vite 6 + React + TypeScript；AI / Search 走 Provider Adapter。
- 运行环境：Node ≥ 20（当前 v24.17.0）、pnpm 10、Docker（PostgreSQL 容器 `ldj-value-engine-postgres`，宿主端口 **55433**，库 `ldj_dev` / `ldj_test`）。
- 六大核心功能**代码层**不得裁剪：Benchmark Mode、Category Creator Mode、产品结构叙事、配方哲学、牛逼化按钮（Intensify）、Level 5 王者话术。
  锁定实现见 `packages/schemas/src/core-features.ts` 与 `packages/schemas/src/thresholds.ts`。**本轮只从界面下掉，不动实现**。
- 15 条铁律（规格 §62，最常被违反的几条）：不用模型记忆替代检索、挂牌价≠成交价、整件价≠单饼价、价格不参与相似度、竞品事实不自动移植（§62-5）、
  不虚构研配方比例 / 树龄 / 山头 / 年份 / 获奖 / 大师（§62-8）、**允许极强修辞**（§62-9）、无对标自动进 Category Creator Mode（§62-10）、
  前台文案不得变成说明书（§62-11）、AI 输出必须过 schema（§62-13）、RED claim 禁止发布、所有版本必须保留（§62-15）。
- FACT / INTERPRETATION / RHETORIC 三层分离（规格 §24）：修辞可极限，事实不可造假；未提供的字段一律存 NULL，禁止自动补全。

## 重要路径
- 产品录入与阈值：`packages/schemas/src/{product,enums,thresholds,core-features,forbidden-claims}.ts`；事实 / 品饮 / 研发参考：`packages/schemas/src/{product-fields,fact,tasting,rnd}.ts`
- Value DNA 与 Prompt：`packages/schemas/src/{value-dna,fact-normalizer,prompt}.ts`；`services/api/src/modules/{value-dna,prompts}/`；Prompt 正文 `prompts/*.md`（11 个）+ 注册表 `packages/prompts/src/registry.ts`
- 研究流水线 / 候选池 / 价格 / 锚点 / 自建标准 / 价值密码：`packages/schemas/src/{search,source,extraction,research,comparable,similarity,price,anchor,category-creator,value-codes}.ts`；
  对应 API 模块 `services/api/src/modules/{research,candidates,prices,anchors,category-creator,value-codes}/`
- 产品结构 / 配方哲学 / 强成交话术（含强化器）/ 事实审核 / 交付层：`packages/schemas/src/{product-architecture,formula-philosophy,sales-copy,fact-review,delivery}.ts`；
  对应 API 模块 `services/api/src/modules/{product-architecture,formula-philosophy,sales-copy,fact-review,delivery}/`；逐阶段清单见 `docs/roadmap.md`
- 数据库：`packages/database/src/schema/*`，迁移 `database/migrations/0000–0015`（**0015 = `chat_sessions` / `chat_messages`**）；seed `packages/database/src/seed.ts`
- AI Provider：`packages/ai/src/{deepseek,openai,json}.ts`；搜索 Provider：`packages/search/src/{so360,bing,html}.ts` + `createSearchProvider()`
- 当前唯一被使用的页面：`apps/web/src/pages/SellpointPage.tsx`（卖点一页纸 = 动作条 + 放映纸 + 「再改一版」输入）+ `apps/web/src/App.tsx`（只留 `/login` + `/chat`）
  + `apps/web/src/components/sellpoint/{SlideStage,SlideCard,EvidenceDrawer}.tsx`（放映框缩放 / 纸本体与自适应字号 / 右侧抽屉）
  + `apps/web/src/lib/{sellpoint.ts,slide.ts,slide-pptx.ts}`（排版映射不改写一字 / 16:9 常量 + 产品图本机存取 + 压缩 / pptxgenjs 导出）
- 保留但已从界面下掉：`apps/web/src/pages/{ChatPage,DashboardPage,ProductsPage,...,HostCenterPage,DealerCenterPage,VersionsPage}.tsx` 与 `components/**`（15 个专业模块 UI 全在，可恢复）
- 冒烟：`scripts/smoke/phase{3..15}.mjs`、`scripts/smoke/{sellpoints,handcard}.mjs`；部署：`scripts/serve-public.ps1`、`render.yaml`、`docs/deploy.md`；文档：`docs/{PRD,architecture,scoring,api,prompts,roadmap,deploy}.md`

## 当前约定
- 默认使用中文记录。
- **前端只留一页（2026-09-26）**：路由表只有 `/login` 与 `/chat`，其余路径一律 `Navigate` 回 `/chat`（**不 404**）；
  侧栏 = 品牌「龙德记 · 卖点手册」+「＋ 新建卖点页」+「我的卖点页」列表（每项带删除）+ 底部账号与退出。
  卖点页打印样式已做（`@media print` 隐藏侧栏 / 动作条 / 输入 / 抽屉，`.deck-frame` 与纸面都强制原生 1280×720、`transform: none`，`@page size: 13.333in 7.5in`），一页打印 = 一张纸；
  动作条给「复制整页 / 打印·存 PDF / 导出 PPTX / 依据与备注 · 待补 N / ＋ 换一款」，版本翻页器可回溯历史版本（所有版本保留，§62-15）。
- **「导出 PPTX」实现口径**：`apps/web/src/lib/slide-pptx.ts` 里 `await import("pptxgenjs")`（**懒加载 chunk，不进首屏**），`defineLayout("LDJ_16x9", 13.333×7.5in)`，
  几何常量（`PAD_X / BODY_TOP / MEDIA_W / COL_X / ROW_H`…）全部按 `styles.css` 的 px 以 1in = 96px 换算，屏幕与导出逐块对齐；
  版式 = 产品名大标题 + 右侧 meta / 左侧产品图（最多两张并排，无图给占位框）/ 右侧 01–04 四段（`addShape("homePlate")` 四色箭头 + `fit: "shrink"`）/ 底部收口 + 草稿声明；**每次只导当前这一版**。
  产品图走 `slide.ts` 的 `fileToSlideImage()`（12MB 上限、长边压到 1400px、白底铺满、JPEG 0.86）存 `localStorage["ldj.slide.images.<sessionId>"]`（JSON 数组，上限 `MAX_SLIDE_IMAGES = 2`；旧单图 key 只读兜底），删除会话时 `clearSlideImage()` 一并清。
- **对话工作台交付形态 = 产品卖点介绍**：`CHAT_SELLPOINT_FORM` 七段骨架固定（一句话定位 / 核心卖点 / 价值高度 / 口感与产品结构 / 配方哲学 / 异议接住 / 收口），
  再加**一页纸排版规则**：`copy_blocks` 固定四块，`label` 依次写「产品介绍 / 核心卖点 / 口感特点 / 补充清单」（`CHAT_SELLPOINT_FORM.rules` 共 4 条，前端只做排版映射，不另写文案）。
  三条硬要求：不写成参数说明书、不出现直播场景词、没有对标就走 Category Creator Mode。
- **全网对标策略**：`product_name`（≤80 字，**只当检索词**）由用户给；单轮最多 3 条查询、回前端最多 8 条；
  **`benchmarks` 一律由服务端真实检索回写**，模型自己写的同名字段整体覆盖（防死链）；检索失败 / 超时 / 0 条降级为空并进 Category Creator Mode，**绝不阻塞出稿**。
  只允许讲价格高度与市场认知，事实一律逐字来自已录记录。
- **`/api/chat/labels` 的 `ai_provider` 是前端判断「真模型 / mock」的唯一来源**（`deepseek` = 真模型），不要用响应快慢或有没有 Key 去猜。
- 真实 DeepSeek 单次出稿 **42–143 秒**，前端必须有等待态（进度条 + 秒表 + 禁止重复提交），调用方超时要给足（PowerShell `-TimeoutSec 300`、UI 脚本默认 260s）。
- 管理员账号：`949412546@qq.com`，口令见 `.env` 的 `BOOTSTRAP_ADMIN_PASSWORD`（明文只落 `.env` 与部署平台变量，**不写文档 / 源码 / 截图**）；
  seed 默认邮箱（`.env` / `.env.example` / `seed.ts` 兜底值）已同步为该邮箱，重跑 `pnpm db:seed` 只会跳过、不会造第二个管理员。
- 冒烟管理员：脚本内兜底值仍是旧账号 `admin@longdeji.local`，跑冒烟前必须用 `SMOKE_ADMIN_EMAIL=949412546@qq.com` / `SMOKE_ADMIN_PASSWORD=<见 .env>`（可用 `SMOKE_API_BASE` 覆盖接口地址）。
- AI / 搜索 Provider 口径：`.env` 为 `AI_PROVIDER=deepseek` / `DEEPSEEK_BASE_URL=https://api.deepseek.com/v1` / `DEEPSEEK_MODEL=deepseek-v4-pro` /
  `SEARCH_PROVIDER=so360`（360 免 Key）；`DeepSeekProvider extends OpenAiProvider`（OpenAI 兼容协议，只换 baseURL / 模型名）。
  **密钥纪律：真实 `DEEPSEEK_API_KEY` 只存在于 `.env`（已被 `.gitignore` 忽略）与部署平台环境变量，提交前必跑一次明文密钥扫描。**
- 端口口径：PostgreSQL 55433（455xx 段被其他项目占用）、**4400 = `tsx watch` dev API**（`SERVE_WEB=false`）、**4401 = Vite dev（仅本机）**、
  **4402 = 生产形态（同端口兼出前端，公网隧道挂在它上面）**。重启前先停掉占用 4402 的 node 进程，否则复用旧进程 → 页面是旧构建。
- 开发库只保留 seed 数据（品牌「龙德记」+ 管理员 1 行）：联调 / 冒烟 / UI 检查用的业务数据用完即删；
  冒烟收尾要把 `products` / `sources` / `market_offers` / `comparable_candidates` / `value_anchors` / `category_creator_profiles` /
  `product_value_codes` / `product_architectures` / `formula_philosophies` / `copy_outputs` / `generated_claims` / `claim_evidence` /
  `chat_sessions` / `chat_messages` 全部清零（`value_codes` 保留 16 行字典）。
- 已交付阶段的 `*_DOWNSTREAM` 交接清单一律**空数组**（§60 口径，不用 `PENDING` 条目冒充「未交付」）；跨阶段关系写在各合同 `rules` 里。
- 部署形态（基线外运维需求）：**单服务** = 同一 Node 进程既出 `/api/**` 又托管 `apps/web/dist`（`services/api/src/plugins/web-static.ts`，只在 `NODE_ENV=production` 或 `SERVE_WEB=true` 时开）
  + 外部 Neon 免费 Postgres；仓库 `https://github.com/straughanmerton-cell/ldj-value-engine`（私有），配置 `render.yaml` / `docs/deploy.md`。
  零注册临时公网路：`scripts/serve-public.ps1 -Port 4402`（本机生产形态 + Cloudflare 快速隧道，**域名随机、进程退出即失效**）；隧道日志 `%TEMP%\ldj-tunnel\tunnel.err.log`。
- 前端 UI 端到端验证手段（Computer Use 不可用时用这个）：本机 Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`，
  `--headless=new --remote-debugging-port=<端口> --user-data-dir=<临时目录>` 后用 CDP（Node 24 自带 `WebSocket` + `fetch` 探测 `/json/list`）驱动，
  能真实点击 React 受控表单（`HTMLInputElement.prototype.value` setter + `input` 事件）并读 `location.pathname` / DOM / 4xx。**不要声称「无法做 UI 复核」。**
- 只保留当前有效信息，过期内容归档到 `agent_memory/archive/`；本轮归档见 `archive/{context-2026-09-26-phase1-15-detail,progress-2026-09-26-sellpoint-v2-detail,bugs-2026-09-26-detail}.md`。
