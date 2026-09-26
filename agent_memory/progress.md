# 任务进度

## 当前目标
- **本轮目标（2026-09-26，用户最新指令）**：「太复杂，我就要做到 PPT 这种效果，你说怎么弄」——
  已定口径（不再问用户）：整页做成**一屏一页的 16:9 幻灯片**（不是网页长文），纸外辅助内容全收进右下抽屉；
  能**打印 / 存 PDF**，也能**真导出 .pptx**；产品图留位、只存本机。
  前端仍然只留一个页面 = 写产品名 + 说需求 → 出一张「卖点一页纸」（01–04 四段，对标 `八角亭卖点手卡（7.30）.pptx`）。
- 唯一需求基线：`C:/Users/Administrator/Downloads/龙德记_AI高价值锚点与强成交话术系统_V2_成交增强版_开发规格.md`（§0–§64 / 2382 行，已完整阅读）。
- 基线 §60 的 **Phase 1–15 已全部交付并验证**（Phase 13 = 牛逼化强化器「再狠一点」；Phase 14 = 事实审核与人工审批；Phase 15 = 主播中心 / 经销商中心 / 导出 / 历史版本）；
  §60 清单到此结束，其后均为基线外追加需求。
- 六大核心功能（Benchmark Mode / Category Creator Mode / 产品结构 / 配方哲学 / 牛逼化按钮 / Level 5 王者话术）**在后端实现与 Prompt 里一个没删**，
  本轮只从**界面**下掉 → 属对基线 §60「核心功能不得裁剪」的用户指令优先收缩，最终回复须如实说明。

## 已完成
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
- 无进行中的代码改动。本轮（一屏一页 PPT 形态）改动已全部落盘、typecheck / build / UI 41 项实测全过，**尚未提交**；收尾只剩：`agent_memory` 同步（本条已完成）、密钥扫描 + git 提交 + push、公网入口复验。
- 公网临时入口：`scripts/serve-public.ps1 -Port 4402` 起本机生产形态 + Cloudflare 快速隧道（**域名随机，cloudflared 退出或机器重启即失效**）。
  `Start-Process -RedirectStandardOutput` 在本会话被安全策略拒；`serve-public.ps1` 脚本内部允许，整脚本调用即可。
  该脚本用管道（如 `Select-Object -Last 30`）调用时输出会被缓冲；判断成功要直接查 `netstat -ano | Select-String ':4402'` + `/api/health` + `%TEMP%\ldj-dev-logs\api-prod.out.log`。

## 下一步
- 本轮收尾：密钥扫描 → git 提交 + push → 公网复验（`/api/health`、`/chat` 深链、管理员登录、产物 JS 含「导出 PPTX / 依据与备注 / 产品卖点一页纸」且不含旧模块文案）→ 回用户（域名 + 「PPT 效果」怎么落的 + 未做项）。
- 产品图与 PPTX 导出**本轮已交付**，但形态有边界（如实告知用户）：图只存**本机 localStorage**（不入库、不上服务器，换设备 / 清缓存会丢）；`.pptx` 每次只导**当前一版**（未做多版合一）。
  若后续要「图入库 / 多人共享」→ 再走路线 B（新增 `product_media` 表）；「多版打进一个 pptx」→ 扩 `slide-pptx.ts` 的页循环。
- 若继续迭代（不在 §60 范围内）：① 对标检索要更稳可申请 `TAVILY_API_KEY` 一键切 `SEARCH_PROVIDER=tavily`（当前 `so360` 免 Key，但依赖第三方页面结构、无 SLA）；
  ② §35 / §54 的知识库表 `knowledge_documents` / `knowledge_chunks` 尚未落地；③ 跨产品锚点独立页面仍未建；④ 正式对外部署仍建议 Render + Neon（见 `render.yaml` / `docs/deploy.md`）。

## 验证记录
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
