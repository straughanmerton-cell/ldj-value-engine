# 任务进度

## 当前目标
- **本轮目标（2026-09-28，用户最新指令）**：「不要这个选项（成交强度），改成一个卖点选择，例如普洱茶里面的每个香型…
  每一个茶区的卖点、香型直接弄成知识库，做成一个选项卡；**包括生茶的卖点、熟茶的卖点**；目的就一个：如何把产品的卖点介绍写得更好」。
  已定口径（不再问用户）：把原先占在空白页与底部输入条的「成交强度」下拉**换掉**，改成「卖点知识库」五个页签
  （产区风格 / 香型倾向 / 生茶卖点 / 熟茶卖点 / 价值角度）的快捷勾选；勾中的项只当**方向**随需求一起发出去，硬事实仍写【待补充】。
  **强度档保留在代码与后端，界面上不再占位**（新会话按默认 Level 4 出稿，历史会话仍读自己的强度）。
  前端仍然只留一个页面 = 写产品名 + 说需求（或只勾卖点方向）→ 出一张「卖点一页纸」。
- 唯一需求基线：`C:/Users/Administrator/Downloads/龙德记_AI高价值锚点与强成交话术系统_V2_成交增强版_开发规格.md`（§0–§64 / 2382 行，已完整阅读）。
- 基线 §60 的 **Phase 1–15 已全部交付并验证**（Phase 13 = 牛逼化强化器「再狠一点」；Phase 14 = 事实审核与人工审批；Phase 15 = 主播中心 / 经销商中心 / 导出 / 历史版本）；
  §60 清单到此结束，其后均为基线外追加需求。
- 六大核心功能（Benchmark Mode / Category Creator Mode / 产品结构 / 配方哲学 / 牛逼化按钮 / Level 5 王者话术）**在后端实现与 Prompt 里一个没删**，
  本轮只从**界面**下掉 → 属对基线 §60「核心功能不得裁剪」的用户指令优先收缩，最终回复须如实说明。

## 已完成
### Render + Neon 正式部署（2026-09-28，本轮收尾）
- 对外固定网址：**https://ldj-value-engine.onrender.com**（Render Blueprint，区域 Singapore，`plan: free`）+ Neon 免费 Postgres，迁移与 seed 均已完成。
- 修复核心卡点：Render Node 22 自带 `corepack` 签名校验报错 `Cannot find matching keyid` → `render.yaml` 的 `buildCommand` 改为
  `npm i -g pnpm@10.0.0 && pnpm install --frozen-lockfile --prod=false && pnpm --filter @ldj/web build`，并加环境变量 `COREPACK_INTEGRITY_KEYS=0` 兜底；
  commit `b30adc3` 已 push，Blueprint Manual sync + Approve 后 `Build successful 🎉`，migrate / seed / api 全部启动成功。
- 端到端公网实测（2026-09-28，真实执行）：`GET /api/health` = `status:ok / database:up`；`POST /api/auth/login`（管理员 `949412546@qq.com`）返回 access/refresh token；
  `POST /api/chat/sessions` 建会话；`POST /api/chat/sessions/{id}/messages` 发「六星孔雀」真实出稿成功 —— `provider=deepseek / model=deepseek-v4-pro / schema_valid=true`，耗时约 66 秒，
  返回 headline + 四段 copy_blocks + quotes + objections + missing_facts + benchmarks；`GET /` 返回前端 `index.html`（标题「龙德记 · 产品卖点一页纸」，200）。
- 结论：同步出稿在 Render 网关下**未被掐断**（约 66 秒成功），无需再改「异步任务 + 轮询」；`deepseek-v4-pro` 型号**实测可用**。
- 环境变量（仅 Render/本机，不入仓库）：`DATABASE_URL`（Neon）、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL=deepseek-v4-pro`、`DEEPSEEK_BASE_URL`、`AI_PROVIDER=deepseek`、
  `SEARCH_PROVIDER=so360`、`BOOTSTRAP_ADMIN_EMAIL=949412546@qq.com`、`BOOTSTRAP_ADMIN_PASSWORD=shi123456`。
- **后续部署关键事实（务必照做）**：本 Blueprint 是**公开仓库 + 手动同步**接的，`git push` **不会自动触发部署**。
  每次改完 push 后，必须进 Render 服务页 → `Manual Deploy` → `Deploy latest commit`（或 Blueprint 页点 Sync）才会拉最新 commit 重新构建。
  2026-09-28 已用此方式把 `239a97a`（年份/克数规格输入）推上线，前端产物由 `index-CjodEkwY.js` 换成 `index-pH5vbSaG.js`。

### 卖点页年份/克数规格输入（2026-09-28，本轮）
- 客户追加：「再做一个卖点页面选项可以输入年份，克数的选项」。
- `apps/web/src/lib/tea-knowledge.ts`：新增 `TeaSpecInput`（`year` / `weight`）与 `teaSpecPhrase()`——把用户自报的年份/克数拼成
  `【产品方本次自报的规格（仅使用下面明确给出的数字与单位，其余硬事实仍写【待补充：xxx】）】` 段落；`composeRequirement(draft, picks, spec)` 增加可选第三参。
- `apps/web/src/pages/SellpointPage.tsx`：新增 `productYear` / `productWeight` 两个状态；左栏产品名下方加 `.slide-spec-row`（年份 + 克数/规格两个输入框）；
  发送与 `canSend` 计算都带上 `spec`；切会话 / 换一款时随输入态一起清空。
- `apps/web/src/styles.css`：新增 `.slide-spec-row`（两列 grid）。typecheck 9/9、`@ldj/web build` 通过，`teaSpecPhrase` 用 tsx 实测拼文正确。

### 卖点知识库五页签（2026-09-28，本轮）
- 新增 `apps/web/src/lib/tea-knowledge.ts`（**纯数据 + 纯函数，不动后端 / 不动 Prompt / 不改写一个字**）：五组共 **82 条**选项 —
  产区风格 20（易武 = 香扬水柔 · 细腻回甘、冰岛 = 冰糖甜韵、老班章 = 霸气山韵、昔归 = 岩骨花香…）/ 香型倾向 18（蜜香、兰花香、花果香、陈香、药香、樟香、枣香、烟香…）/
  生茶卖点 15（回甘生津、茶气足、山野气韵、水含香、汤水稠厚、冷杯香显、喉韵深长…）/ 熟茶卖点 15（醇厚顺滑、甜润不苦、无堆味、米汤感稠滑、耐煮耐泡…）/ 价值角度 14（古树纯料、单株、头春、干仓储存、稀缺限量…）；
  导出 `toggleTeaPick` / `teaPickedKeys` / `teaPicksPhrase` / `composeRequirement`（**一条没勾时返回空串**，调用方不拼空段落）。
- 新增 `apps/web/src/components/sellpoint/SellpointPicks.tsx`：五页签（角标显示该组已选数）+ 组提示语 + 双列卡片（`aria-pressed` 选中态）+ 清空；
  空白页与「继续改一版」复用同一组件（后者带 `compact`）。选项之间**不设上限**（茶可以同时是「易武 + 蜜香 + 回甘生津 + 干仓」）。
- `apps/web/src/pages/SellpointPage.tsx`：**删掉「成交强度」下拉两处**（空白页 `.slide-start-actions` 与底部 `.deck-intensity`），换成 `<SellpointPicks>`；
  `handleSend()` 改 `composeRequirement(draft, picks)`（**只勾选项、一个字不写也能发**；拼接后超 `maxChars` 4000 字提示「少勾几项或写短一点」并中止）；
  发送成功后清空勾选，方向不重复拼；换会话时勾选与展开态一并复位。
- `apps/web/src/styles.css`：新增 `.slide-picks*` / `.slide-pick`（双列、固定 46px、选中态用 `--ldj-brand*` 令牌）+ `button.ghost.is-on` + `.deck-composer-stack/-row`；
  删掉 `.deck-intensity` 两条规则；`@media print` 隐藏清单加 `.slide-picks`。
- 口径（不许违反）：选项是**品类 / 产区通识**，不等于「这一饼茶就是易武 / 是蜜香」——拼出的正文第一行已写明「只是方向：没有录入的硬事实仍然写【待补充：xxx】」，
  选项里**不写价格、不承诺收益**（§62-8 / §62-9）。`CopyIntensity` 类型、`COPY_INTENSITY_*` 常量、后端五档强度与 Level 5 **一行未删**。

### 纸面对齐「八角亭手卡」（2026-09-26，本轮）
- 参考文件的硬参数是**解包 PPTX 拿到的**，不是猜的：`<a:prstGeom prst="homePlate">`（Office「五边形」= 右侧收尖的箭头）、
  主题色 `accent1 #4472C4` / `accent2 #ED7D31` / `accent3 #A5A5A5` / `accent6 #70AD47`，
  正文用同色系深一档（`lumMod 75`）≈ `#2F5597 / #C55A11 / #595959 / #548235`，编号白字 24pt Arial。
- `apps/web/src/lib/slide.ts`：单图 → **多图**。`MAX_SLIDE_IMAGES = 2`；key 改 `ldj.slide.images.<sessionId>`（存 JSON 数组），
  旧 key `ldj.slide.image.<id>` 只读兜底并在写入时清掉；`readSlideImages / writeSlideImages / clearSlideImage` 三个出口。
- `components/sellpoint/SlideCard.tsx`：props 改 `images: string[]` + `onPickImage(slot) / onDropImages(files) / onRemoveImage(slot)`；
  左栏改 `.slide-media-grid` + 多个 `.slide-media-slot`（有图 / `is-empty` 占位两态），拖入 / 粘贴支持**一次两张**；
  顶部去掉品牌行（参考手卡没有），只留大标题 + 右侧 meta。
- `pages/SellpointPage.tsx`：`imageDataUrl` → `images: string[]`；`pickSlotRef` 决定「换第 N 张 / 往后追加」；
  新增 `paperTitle`（产品名 → 输入框名字 → **会话标题** → 「产品卖点」），纸面与导出共用同一个标题，
  修掉历史会话（没有 `product_name`）时纸面大标题退成一句「产品卖点」的问题。
- `styles.css`：`.slide-no` 改成 `clip-path` 箭头（`4.1em × 1.8em`，与导出的 homePlate 同比例）；
  四段各带 `--sec / --sec-ink / --sec-bg`；`.slide-closing` 从品牌棕改 `#1f2329`，脚注降到 `--ink-400`。
- `lib/slide-pptx.ts`：`images: string[]`（最多两张并排）+ 编号块换 `addShape("homePlate")` 四色 + 正文改同色系深色；
  几何常量全部由 `styles.css` 的 px 按 1in = 96px 换算（`PAD_X` / `MEDIA_W` / `COL_X` / `ROW_H` 等），与屏幕逐块对齐。
- 验证：`pnpm -r typecheck` 9/9、`pnpm --filter @ldj/web build` 通过；
  全量 UI 实测 **40 项通过 / 0 失败**（含「导出真的落下 .pptx」71 KB）；
  解包导出的 pptx 断言 `homePlate × 4` + `4472C4 / ED7D31 / A5A5A5 / 70AD47` 四色齐全。
- 产品图仍只进本机 `localStorage`（按卖点页 id 分开存），不入库、不上服务器。

### 卖点一页纸升级为「一屏一页 PPT」形态（2026-09-26，本轮）
- 新增渲染/工具层：`apps/web/src/lib/slide.ts`（`SLIDE_W=1280` / `SLIDE_H=720`、产品图本机存取 `readSlideImage` / `writeSlideImage` / `clearSlideImage`、`fileToSlideImage()` 压到长边 1400px 存 localStorage）、
  `apps/web/src/lib/slide-pptx.ts`（`exportSellpointPptx()` 动态 `await import("pptxgenjs")`，`defineLayout` 13.333×7.5in，金色顶条 / 产品名 / 右侧 meta / 左侧产品图 / 右侧 01–04 四段 + 草稿声明，`writeFile` 落盘）。
- 新增组件：`components/sellpoint/{SlideStage,SlideCard,EvidenceDrawer}.tsx`。
  `SlideStage` 用 `ResizeObserver` 取 `min(w/1280, h/720)`（下限 0.32）算缩放；`SlideCard` 是纸本体（含**自适应字号**：17px 起步、塞不下就降到 8.5px 为止，保证纸面永不出现滚动条、不吃掉最后一条卖点）；
  `EvidenceDrawer` = 纸背面（待补硬事实 / 全网对标来源（含「复制 N 条来源」）/ 可继续改的追问 / 已录事实 / 凭什么可信 + provider 说明），默认收起，Esc / 点遮罩关闭。
- `pages/SellpointPage.tsx` 整页重写为「一条动作条 + 一块放映纸 + 一条『再改一版』输入」：动作条 = provider Pill / 版本翻页器（第 N 版 共 M 版）/ 复制整页 / 打印·存 PDF / 导出 PPTX / 依据与备注（带「待补 N」）/ ＋ 换一款；
  没出稿时动作条只剩「＋ 换一款」，纸面是空白页（产品名 + 需求 + 强度 + 生成卖点）。
- `styles.css`：删掉旧 `.sellpoint*` / `.sheet*` 与旧 `@media print`，新增 `.deck*` / `.slide*` / `.drawer*` 全套 + `@media 1200/720` + `@media print`（`@page 13.333in × 7.5in`，打印时隐藏侧栏 / 动作条 / 输入 / 抽屉，纸面按原生 1280×720 输出）。
- 新增依赖 `pptxgenjs@4.0.1`（构建产物里是**独立动态 chunk** 373 kB，不进首屏包）。
- **修掉一个真缺陷**：`SlideStage` 的缩放壳原先也带 `.slide` 类 → 纸本体成了外层 flex 容器的子项，被压矮 70px（右栏文字溢出 179px 并被裁）；改成 `.slide-scaler` 后纸面恢复原生 1280×720，实测溢出 0px、纸面与放映框像素级对齐。

### 界面收敛为单页卖点（2026-09-26，上一轮，已提交 `87387c6`）
- `apps/web/src/App.tsx`：路由表只留 `/login` + `/chat`，`*` 与 `/` 一律 `Navigate` 回 `/chat`（**旧 URL 不 404**）；
  侧栏 = 品牌「龙德记 · 卖点手册」+「＋ 新建卖点页」+「我的卖点页」列表（每项带删除 `×`）+ 底部账号与退出。15 个专业模块从界面下掉，**页面文件不删**。
- `apps/web/src/pages/SellpointPage.tsx`（新，约 600 行）：输入卡（产品名 + 需求，Enter 发送 / Shift+Enter 换行）→ 等待态（进度条 + 秒表 + `AI_UNAVAILABLE` 可重发）
  → 纸面（01–04 四段）+ 版本 chip + 复制整页 / 复制对标来源 / 打印 / 存 PDF + 待补硬事实**常驻** Alert（不许折叠）+ 对标来源条 + 追问 chip + 已录事实 `<details>`。
- `apps/web/src/lib/sellpoint.ts`（新）：**纯排版层，不改写一字**。`SELLPOINT_SECTIONS` / `SELLPOINT_BLOCK_LABELS` / `classifySellpointBlock` / `buildSellpointSheet` / `sellpointSheetCopyText`；
  01 前 unshift `headline`、02 前 unshift `value_height`（`highlight: true` 金色行）、04 追加 `objections` + `quotes.slice(1)`、`closing = quotes[0]`。
- `apps/web/src/lib/chat.ts`：新增模块级会话列表广播 `bumpSessionRevision()` + `useSessionRevision()`（`useSyncExternalStore`），侧栏列表即时刷新。
- `packages/schemas/src/chat.ts`：`CHAT_SELLPOINT_FORM.rules` 由 3 条改 4 条，第 4 条 = 一页纸排版（`copy_blocks` 固定四块，`label` 依次「产品介绍 / 核心卖点 / 口感特点 / 补充清单」）；七段骨架 `outline` 未动。
- `apps/web/src/styles.css`：末尾追加侧栏 `.side-*` / 页面 `.sellpoint*` / 纸面 `.sheet*` 全套样式 + `@media 1200/720` 响应式 + `@media print`。
- 文案：`LoginPage.tsx` 品牌名改「龙德记 · 卖点手册」、副标「说产品名 · 出一页产品卖点」；`index.html` `<title>` 改「龙德记 · 产品卖点一页纸」。
- 冒烟 `scripts/smoke/sellpoints.mjs` 断言同步为 4 条（`sellpointRules[3]` 必须含「产品介绍」「补充清单」）。

### 360 检索抗限流（2026-09-26，本轮）
- `packages/search/src/so360.ts`：新增 `cacheTtlMs`（默认 5 分钟，**只缓存有结果的查询**，上限 64 条，超限丢最旧）→「再改一版」的三条逐字相同查询不再重复打 360；
  新增 `ACCESS_ANOMALY_MARKERS`（访问异常 / 访问过于频繁 / 请输入验证码 / qcaptcha / antispider）+ `isAccessAnomalyPage()`，命中限流或验证码页改**指数退避**（最多 5 秒），普通兜底页仍按 400ms 重试；**查空结果不入缓存**。
- `packages/search/tests/so360.test.ts` 新增 3 个用例（缓存命中不再发请求 / 查空不进缓存 / `cacheTtlMs: 0` 关缓存），现 13 个用例。

### 产品卖点工作台 V2（2026-09-26，上一轮，已提交 `4c74e32`）
- 用户原话：「整个网页重新设计，不需要直播话术…卖点一定要根据我提供的产品名，尽可能去全网搜索高价值的对标产品，把卖点吹大」。
- 后端对标链路：`createSearchProvider()` 支持 `mock|tavily|bing|so360`（`.env` / `.env.example` / `render.yaml` 均为 `so360`）；
  `services/api/src/modules/chat/chat.service.ts` 新增第 4 参 `search`：`benchmarkQueries()`（两条必发含「茶」+ 一条品牌 / 年份 / 茶类 / 山头拼接）/
  `normalizeBenchmarkUrl()` / `filterBenchmarks()`（先要求「茶叶价格语境 + 命中产品名令牌」，一条都不命中退化为只要求茶语境）/ `benchmarkTokens()`；
  全部 `Promise.allSettled`，失败 / 超时 / 0 条一律降级 `[]`，绝不阻塞出稿。
- HANDCARD 卖点一页纸（路线 A，用户选定）：`packages/schemas/src/delivery.ts` 加 `"HANDCARD"` 导出格式 + `HANDCARD_SECTION_META`（01–04）+ `buildHandcardView()` + `renderHandcardHtml()`（单文件、无脚本、无外链、打印友好）；
  `delivery.service.ts` 的 `buildHandcard()` 读产品主档案原文，**没录入的项整行不出现**；前端 `DeliveryExportCard.tsx` 加「卖点一页纸」+ `<iframe sandbox srcDoc>` 预览。
- 冒烟：`scripts/smoke/sellpoints.mjs`（50 项）、`scripts/smoke/handcard.mjs`（33 项）。

### AI 对话工作台 + DeepSeek 接入（2026-09-24）
- 需求「界面太复杂，要一个 AI 对话窗口 + 接入 deepseek-v4-pro」→ `/` 重定向 `/chat`，15 个专业模块收进侧栏「专业模式」折叠区（`localStorage["ldj.nav.professional"]`）；
  **六大核心功能与全部路由一个没删**。后端 `packages/schemas/src/chat.ts` + 表 `chat_sessions` / `chat_messages`（迁移 `0015_right_hercules.sql`）+ `modules/chat/` 8 条路由。
- 草稿不落库；只喂「已录入事实」；AI 失败时用户那条需求已保存、assistant 不落库、返回 502 `AI_UNAVAILABLE`（`details.session_id` / `user_message_id` / `ai_provider`），前端提示直接重发。
- 本轮修复 2 条真缺陷（见 `bugs.md`）：`max_tokens 3200 → 8000`（长 JSON 被截断会 502）、新会话首条消息重复渲染（`appendUnique()` 按 id 去重）。

### 更早（Phase 1–15，均已归档）
- 逐阶段清单见 `docs/roadmap.md`（权威）与 `agent_memory/archive/`：`progress-2026-09-23-phase1-4.md`（基础架构 / 事实层 / Value DNA / 研究流水线）、
  `progress-2026-09-23-phase5-9.md`（候选池 / 价格证据 / 高价值锚点 / 自建标准 / 价值密码）、
  `progress-2026-09-24-phase10-14-detail.md`、`progress-2026-09-24-phase14-15-detail.md`、
  `progress-2026-09-26-sellpoint-v2-detail.md`（本轮之前那份完整版）。
- 管理员账号迁移（2026-09-24）：开发库唯一管理员改 `949412546@qq.com`（scrypt 散列直接 UPDATE），seed 默认邮箱同步，登录页脚文案同步。

## 正在进行
- 无进行中代码改动。**Render 正式部署已完成并端到端验证通过**（本轮 2026-09-28 收尾）。

## 下一步
- 本轮已收尾：Render + Neon 正式部署上线，管理员登录、真实 DeepSeek 出稿均已通过公网实测。
- 待用户确认的后续（非阻塞）：① 仓库当前 public（Render 自动部署所需），若在意源码隐私需改 private，但会自动部署失效；
  ② 免费档闲置约 50 秒冷启动；③ DeepSeek 型号 `deepseek-v4-pro` 已实测可用；④ 如需更稳对标可切 `SEARCH_PROVIDER=tavily`（当前 so360 免 Key）。

## 验证记录
### 卖点知识库五页签（2026-09-28，本轮全部真实执行过）
- `pnpm -r typecheck`：**9/9 全通过**。
- `pnpm --filter @ldj/web build`：通过；`dist/assets/index-CjodEkwY.js` 311.96 kB + `index-CWlBwGej.css` 48.86 kB + `pptxgen.es-D-J1tbZL.js` 373.14 kB（仍为懒加载 chunk）。
- 生产形态重启：停掉占用 4402 的进程 → `NODE_ENV=production / SERVE_WEB=true / API_PORT=4402` 重启 → `GET /` 的 `index.html` 指向新产物 `index-CjodEkwY.js`，
  `GET /api/health` = `{"status":"ok","database":"up",...}`。
- **headless Chrome 探针（CDP，脚本跑完即删）22 项通过 / 0 项失败**：五个页签齐全（产区风格 / 香型倾向 / 生茶卖点 / 熟茶卖点 / 价值角度）→ 空白页 `.slide-start-actions select` = **0**、
  界面**无「成交强度」字样**、底部 `.deck-intensity` = **0** → 纸面溢出 **0px** → 勾「易武 / 蜜香 / 醇厚顺滑」后页签角标 1/1/1、计数「已选 3 项」→
  **只勾选项、一个字不写也能点「生成卖点」** → 拦截真实 `POST /messages` 正文验证首行是「【我勾的卖点方向（只是方向：没有录入的硬事实仍然写【待补充：xxx】）】」+「产区风格：易武（香扬水柔 · 细腻回甘）」+「香型倾向：蜜香」+「熟茶要突出的点：醇厚顺滑」+ 产品名在 → 控制台零错误 → 探针会话 DELETE 204。
- **全量 UI 实测 41 项通过 / 0 项失败**（真实 DeepSeek 出稿）：登录 → 侧栏只剩卖点入口 → 空白页两栏 → **真实出稿** → 纸 16:9 一屏一页（比例 1.778、`--slide-fit` 10.25px、右栏溢出 0px）→
  四段标签 = 产品介绍 / 核心卖点 / 口感特点 / 补充清单（正文 267/338/180/593 字）→ 抽屉数值与后端 payload 一致（对标 8 条 / 待补 5 条）→ **点「导出 PPTX」真的落下 `.pptx`（72 KB、zip 头 PK、内含 `ppt/slides`）** → 控制台零错误 → 冒烟会话清理 204。
- 截图（本机）：`%TEMP%\ldj-picks-region.png`（产区风格页签 / 易武选中）、`%TEMP%\ldj-picks-ripe.png`（熟茶卖点页签）。
- 未验证：勾选项**没有**进后端 Prompt 白名单与知识库表；模型面对「勾了方向但没录事实」时是否 100% 写【待补充】只做了正文抽样（探针拦截的是请求正文，不是最终稿）。
### 一屏一页 PPT 形态（2026-09-26，本轮全部真实执行过）
- `pnpm -r typecheck`：**9/9 全通过**。
- `pnpm --filter @ldj/web build`：通过；`dist/assets/index-1G0MqEqp.js` 303.91 kB + `index-BPobxwvQ.css` + **`pptxgen.es-B-RbVxxI.js` 373.14 kB（pptxgenjs 独立动态 chunk，`await import()` 懒加载，不进首屏包）**。
- **headless Chrome UI 实测（CDP，脚本本体不入库）41 项通过 / 0 项失败**：管理员登录 → 落 `/chat` → 侧栏无 13 个旧模块名 → 空白页两栏（产品名 + 已建档产品 / 需求 + 强度）→
  没出稿时不摆导出按钮 → 旧链接 `/value-codes` 回 `/chat` → **真实 DeepSeek 出稿** → 纸面比例 1.778（16:9）→ 纸本体只有一层 → 纸与放映框像素级对齐（框 (281,102) = 纸 (281,102)）→
  右栏四段**溢出 0px** → 四段标签 = 产品介绍 / 核心卖点 / 口感特点 / 补充清单 → 正文 331 / 421 / 202 / 575 字 → 左栏留出产品图位 → 草稿声明在 → 动作条按钮齐（复制整页 / 打印·存 PDF / 导出 PPTX / 依据与备注）→
  抽屉默认不出现 → 抽屉里的「价值高度 / 对标条数 / 待补条数」与后端 payload 一致 → 抽屉含「复制 N 条来源」→ Esc 关抽屉 → **点「导出 PPTX」真的落下 `.pptx`（77 KB、zip 头 `PK`、内含 `ppt/slides/slide1.xml`）** → 控制台零错误 → 冒烟会话清理 204。
- 辅助探针（不在 UI 脚本内）：修 `.slide-scaler` 后 `slideClassCount = 1`、右栏 `clientWidth = scrollWidth = 494`。
- 未验证：「导出 PPTX」只在本机 Chrome 下载路径验过字节（未用 PowerPoint / WPS 打开回看版式）；打印 / 存 PDF 只验了 `@media print` 生效与分页尺寸，未做实际 PDF 渲染比对；产品图自适应压图只测过 1 张 JPEG。
### 界面收敛为单页卖点（2026-09-26，上一轮，已提交 `87387c6`）
- `pnpm -r typecheck`：**9/9 全通过**。
- `pnpm --filter @ldj/api test`：**15 文件 / 206 用例全通过**（≈270s）。
- `pnpm --filter @ldj/search test`：**2 文件 / 23 用例全通过**（`so360.test.ts` 13 + `bing.test.ts` 10）；`pnpm --filter @ldj/schemas test` 13 文件 / 293 用例全通过。
- `pnpm --filter @ldj/web build`：通过（`dist/assets/index-CLZIIvVn.js` 292.64 kB + `index-D9D7-nfn.css` 41.67 kB）。
- 冒烟：`scripts/smoke/sellpoints.mjs` **50/50**、`scripts/smoke/handcard.mjs` **33/33**。
- **headless Chrome UI 实测（CDP，脚本本体不入库）25 项通过 / 0 项失败**：登录页换口径 → 落 `/chat` → 侧栏只剩卖点入口（15 个旧模块名 0 命中）→ 旧链接 `/products` 回 `/chat`
  → 等待态 → 出稿后 URL 带 `?s=` → 纸面 01–04 四段标签与正文都有（330/260/151/587 字）→ 价值高度与后端 payload 一致（本次 1 行）
  → 草稿脚注在 → 纸上「全网对标 5 条」与纸下 5 条链接都等于后端 payload → 待补硬事实常驻 → 复制 / 打印动作在 → **控制台零错误** → 冒烟会话已清理。
- 未验证：真实 DeepSeek 出稿质量只做抽样（未做多产品批量对比）；跨浏览器像素级复核未做；360 免 Key 抓取的长期稳定性（改版会解析到 0 条并如实降级，不伪造）。
### 更早的验证记录
- 详见 `agent_memory/archive/progress-2026-09-26-sellpoint-v2-detail.md`（含临时公网部署实测、登录态 401 自愈 13/13、AI 对话工作台 UI 端到端、Phase 1–15 各阶段验证数字）。
- 关键历史结论：隧道链路下**2 分钟级同步出稿不被网关掐断**（真实出稿 59–94.7 秒成功，`provider=deepseek` / `model=deepseek-v4-pro` / `schema_valid=true`）；
  Render + Neon 正式部署的网关超时仍待实测，若被掐断则出稿需改「异步任务 + 轮询」。
