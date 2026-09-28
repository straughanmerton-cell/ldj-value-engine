# 问题与风险

## 已知问题
- **「勾了卖点方向」不等于「事实成立」（2026-09-28，本轮最大口径风险）**：`tea-knowledge.ts` 里的选项全是**品类 / 产区通识**
  （「易武 = 香扬水柔」是行业共识），勾选只代表「我想往这个方向讲」，**不能**当成「这饼茶就是易武 / 就是蜜香 / 就是古树」。
  所以 `teaPicksPhrase()` 的第一行固定写「只是方向：没有录入的硬事实仍然写【待补充：xxx】」，选项里**不写价格、不承诺收益**。
  要改成「勾了就当已确认事实」= 推翻 §62-5 / §62-8，必须先找产品方确认，**不要**顺手放开。
- **卖点知识库只活在请求正文里**：它是**前端常量**（`tea-knowledge.ts`），既没进数据库（§35 / §54 的 `knowledge_documents` / `knowledge_chunks` 仍未落地），
  也没进后端 Prompt 白名单 / 检索链路 —— 生效路径只有「拼进用户这条消息，模型读需求时读到」。换页面 / 换客户端写需求就不会带上这些方向。
  想让它「后端也能自动引用」属新的范围变更（要建表 + 进 Prompt），别把它说成已入库。
- **成交强度没删，只是不占了**：`CopyIntensity` / `COPY_INTENSITY_*` / 后端五档强度与 Level 5 全在，界面上两处下拉已移除；
  新会话固定发默认 **Level 4**，打开历史会话读它自己的 `session.intensity`。**别把「界面没有」当成「后端没有」**——这是对基线 §60「六大核心功能不得裁剪」的刻意保留。
- **pptxgenjs 的箭头形状名是个坑（2026-09-26 踩过）**：Office 那个「右侧收尖的五边形」在 OOXML 里是 `prst="homePlate"`，
  但 `pptxgenjs` 的 TS 枚举里 `ShapeType.PENTAGON` **不存在**（`ShapeType.pentagon` 是正五边形，另一个东西）。
  只能用字符串 `slide.addShape("homePlate", …)`（`SHAPE_NAME` 联合类型里有 `'homePlate'`）。别再写 `ShapeType.PENTAGON`。
- **纸面大标题的回退链路是刻意的**：`SellpointPage.paperTitle` = `sheet.product_name` → 输入框里的产品名 → **这条会话的 title** → 「产品卖点」。
  历史会话（2026-09-24 前后建的）常常没有 `product_name`，退到会话标题比退成一句「产品卖点」像样得多；
  **不要**为了「统一口径」把中间那层删掉。
- **左栏产品图硬上限 2 张**（`MAX_SLIDE_IMAGES`，对齐参考手卡「包装 + 实物」两栏）：再多是静默截断，不是报错。
  `writeSlideImages()` **吞掉 localStorage 配额异常**（配额满 → 退化成「这一页不放图」），这是刻意行为，不要改成抛错。
- **界面收敛带来的口径冲突（本轮，需如实告知用户）**：用户要求「把其他功能全部去除」，与基线 §60「六大核心功能不得裁剪」直接冲突。
  本轮取用户指令优先：**只从界面下掉**，`apps/web/src/pages/**` 与后端模块、Prompt、路由处理函数**一行未删**，随时可恢复；
  代价是「界面显示的模块数」不再等于「已交付能力数」。若产品方要求彻底删除，属新的范围变更，需先确认。
- **迁移目录现为 0000–0015 共 16 个**（0015 = `chat_sessions` / `chat_messages`）：后续每次改 schema 必须 `pnpm db:generate` 并把新迁移一并提交。
  `0008_wide_xavin.sql` 是 `db:generate` 废产物（只创建 Phase 8 两个枚举类型），**不要回收**（删掉会让 journal 与已应用迁移号错位）。
- **新增表必须同步进 `services/api/tests/helpers/app.ts` 的 truncate 清单**，否则测试互相污染；冒烟收尾的清零清单也要同步（含 `chat_sessions` / `chat_messages`；`value_codes` 是 16 行字典，保留属正常）。
- 与基线 §59 推荐目录的差距（非功能裁剪）：缺 `packages/scoring/`、`services/crawler/`、`services/research-worker/`、`database/seeds/`（种子现于 `packages/database/src/seed.ts`）。补齐时同步 `docs/architecture.md` / `README.md`。
- §58 的 10 条自动校验已全部有归属（第 6/7 条 = Phase 10/11，第 8/10 条 = Phase 12，第 9 条 = Phase 8 + Phase 12 追加标准句）；改这些口径必须同步对应断言。固定 fixture「龙德记六星孔雀」固化在 `services/api/tests/helpers/app.ts`。
- §10.4 感官字段**双处存在是刻意设计**：`products` 存主感官档案（录入用），`tasting_profiles` 存可版本化品饮记录，**两者不自动同步**；若产品方要求「以某份品饮档案为准」需显式设计同步规则。
- **空 Value DNA ≠ 未生成**：产品创建会自动跑规则引擎写 `value_dna`，所以「11 维全空」是正常状态；`category-creator.ts` 的 `usableValueDna()` 把「11 维全空」视同未生成是刻意归一。造这条路径的数据要先 `update products set value_dna = '{}'::jsonb`，**不要改产品创建逻辑**。
- `/api/health` 的 `phase` 文案是**手工维护**的，不随 `DELIVERED_PHASES` 自动变；每交付一个 Phase 记得同步（现为「Phase 15｜…（Phase 1–15 已交付）」）。
- `sources` 表没有 `price_count` 列（价格条数记在 `source_extractions.price_count`）。跨产品「高价值锚点库」仍只有 API（`GET /api/anchors`），无独立页面。
- Phase 7 锚点层**显式排除 `SOURCE_UNATTRIBUTED` 价格证据**（`isReliableOffer`），即「没写产品身份」的价格再高也不能推成对标模式；**不要再放宽**。已知技术债（可接受）：`anchors.service.ts` 对每个候选各发一次价格查询（N+1），单产品上限 60 条、实测无性能问题。
- Phase 8 自建标准**不是独立 Tab**（挂在产品详情「高价值锚点」Tab 内，紧跟 `AnchorModeCard`）。Phase 9「价值密码库」`/value-codes`、Phase 6 `/market-prices`、Phase 5 `/high-value-db` 都是**跨产品只读总览**，写操作回产品详情。
- Phase 15 交付层是**只读派生视图**：6 条路由只 `requireAuth`，不写库、不改写正文、不调 AI、不加表；两个中心与导出由 `copy_outputs` + `generated_claims` **现算**。**不要为「性能」给交付层加缓存表 / 快照表**。
- **交付层只有一份发布闸门**（主播中心 / 经销商中心 / 列表 / 导出读同一个 `ready`）：判据是「最新一版成稿 + 这一版自己的最新审核」（上一版通过、当前版未审 → **不算通过**）。闸门未过时两个中心与列表仍 **200**（十格全空 + `gate.reason` / `next_action`），**只有导出 409** `CONFLICT`。改闸门判据四条链路必须一起改。
- Phase 15 导出参数**大小写敏感**：`format = markdown|text`、`scope = host|dealer|all`（写成 `Markdown` / `HOST` 一律 400）；正文超 `DELIVERY_LIMITS.maxExportChars = 120000` → 400（不产半成品文件）；`GET /api/host-center` 的 query 是 strict、分页字段是 camelCase。
- `productArchitectureSchema` 定义在 `packages/schemas/src/product.ts`，九字段全 `.default("")` 且**非 strict**（缺键补空串、多余字段被 strip，不是 400）；要严格拒绝请用 `productArchitectureListQuerySchema` 之类的 strict schema。
- Phase 12 的**价格回查正则** `SALES_COPY_PRICE_PATTERN = /\d+(?:\.\d+)?\s*(?:万元|万|元|块)/g` 会扫正文里任何「数字 + 元 / 万」组合（写 fixture / 调试文案时别随手写「38 元」这类字样，会得到意料之外的 RED）。
- Phase 12 的 `copy_outputs` 合规判定（GREEN / YELLOW / RED）是**文案侧规则判定**，Phase 14 的逐句证据链审核是**独立第二道闸门**，两者同源但不可互相替代：可发布 = 两次判定都非 RED。
- **强化结果响应体里没有 `lost_facts`**（只有 `added_facts`）：被写弱的引用只写进新版本备注（`copy_outputs.notes`）。不要在响应里找这个字段。
- **极简产品也能强化到 94 分并满足 Level 5 是实测行为，不是 bug**；Phase 13 的**分数下降不阻断**也是刻意的（仍写新版本并如实 `passed: false`，不静默回滚）。不要反过来去「修」这个分数。
- **AI 对话工作台两条硬口径**：① `GET /api/chat/labels` 的 `ai_provider` 是判断「真模型 / mock」的唯一来源；② 真实单次出稿 42–143 秒，前端必须有等待态，否则看起来就是「点了没反应」。
- **`buildChatSystemPrompt` 必须显式给出 `value_focus` 的 8 个英文键白名单**（`identity / market_price / material / mountain / formula_philosophy / style / time / collection`）：漏掉时模型会写中文 `"山头"`，整份按 schema 判废稿。
- **测试助手里 `createTestContext` 另开一个 App 时不能直接 `bootstrapAdmin`**（已有用户返回 403），必须由外层管理员 token 代办 `POST /api/auth/register`。

## 风险记录
- **产品图只存在用户本机（本轮）**：`localStorage["ldj.slide.image.<sessionId>"]`，不入库、不上服务器、不同步到别的设备，清浏览器缓存 / 换电脑就没了 —— 这是刻意的最小改动（避免新增 `product_media` 表与上传链路）。
  若产品方要求「多人共享 / 换设备也在」，属新的范围变更（路线 B：新增 `product_media` 表 + 上传接口），需先确认。
- **`.pptx` 导出未做版式回看**：本轮只验了字节与包结构（zip 头 `PK`、含 `ppt/slides/slide1.xml`、77 KB），**没有用 PowerPoint / WPS 真正打开检查版面**；
  中文长文本用 `fit: "shrink"` 兜底，若实际打开有溢出，优先调 `slide-pptx.ts` 的字号 / 段落高度，不要改纸面 DOM。
- **已修复：登录超过 30 分钟后整个工作台全是 401**（根因：access token 30 分钟有效，前端从来没有刷新逻辑；`RequireAuth` 只看本地有没有 user）。
  修法：`apps/web/src/lib/session-store.ts`（登录态唯一存储 `getSession` / `setSession` / `subscribeSession`）+ `lib/api.ts` 401 → 刷新 → **重试一次**（非 `/api/auth/*`）+ `lib/auth.tsx` 改 `useSyncExternalStore`。
  **回归时不要**：① 去掉 401 自动刷新；② 让 `/api/auth/*` 参与刷新（无限递归）；③ 把并发刷新拆成「每个请求各刷一次」——refresh token 是**一次一换的轮换令牌**，必须共用同一个 `refreshInFlight` promise。
- **已修复：真实 DeepSeek 长稿被 `max_tokens` 截断 → 502**。`chat.service.ts` 原 `maxTokens: 3200` 改 **8000**（勿改回），`packages/ai/src/json.ts` 按错误类型分流重试提示。
- **已修复：新会话第一条消息重复渲染 + React 重复 key**。`ChatPage.tsx` 新增按 id 去重的 `appendUnique()`（**不要退回裸数组拼接**）。
- **已修复：登录成功却不跳转（用户看到的「点击登录没反应」）**。`LoginPage.tsx` 加 `user` 守卫 `return <Navigate to={from} replace />`，`App.tsx` 的 `RequireAuth` 跳登录时带 `state={{ from }}`（`from` 仅在 `/` 开头且非 `//` 时接受）。
- **360 免 Key 检索存在外部限流风险（本轮实测过）**：连续多发查询会 6/6 返回「访问异常」页或验证码页 → 该轮 `benchmarks = 0`。这**不是代码缺陷**，是外部依赖无 SLA；已加 5 分钟结果缓存 + 限流页指数退避缓解，前端如实显示「本次无对标 · 按自建高端标准讲」（§62-10 合法降级）。正式对外要稳，建议申请 `TAVILY_API_KEY` 切 `SEARCH_PROVIDER=tavily`。**任何时候都不许用模型记忆替代检索**（§62-1）。
- 生产部署形态已定（Render 免费 Web Service 单服务 + Neon 免费 Postgres），**仍待实测**：免费平台网关是否容忍 42–143 秒的同步出稿请求（隧道链路下已证不掐断；若 Render 掐断则出稿需改「异步任务 + 轮询」）。
- 真实业务数据接入范围（品牌方是否给历史成交价与经销商价目）直接决定 Price Engine（Phase 6）的可用性与口径 —— **未确认**。
- 用户与权限模型是否需要细分「主播 / 经销商 / 研究员」独立账号体系（§15 提及），**未确认**。

## 失败尝试
- （一屏一页 PPT）**`.slide` 这个类绝不能套两层**：`SlideStage` 的缩放壳最初也叫 `.slide`，外层 flex 容器的尺寸规则把纸本体压矮 70px，右栏四段溢出 179px 被裁掉（肉眼看着像「文案丢了」）；
  修法 = 缩放壳单独用 `.slide-scaler`（`1280×720` + `transform-origin: top left`），只让纸本体带 `.slide`。**回归自查一行命令：数 `.slide` 节点数必须 = 1。**
- （登录态）「本地存了令牌就放行」的写法必须配一条 401 自愈路径，否则用户只会看到一片红字；refresh token 轮换要求前端刷新**串行去重**（否则「刷新一次能用、刷新两次掉登录」）。
- （AI 对话工作台）`packages/ai/src/json.ts` 曾用 `lastIndexOf("}")` 截 JSON：模型在 JSON 后写解释就会截错位置；`generateJson` 也曾对同一请求双调用模型。两者已修，**不要再改回字符串截取或双调用**。
- 窄屏（≤1200px）媒体查询曾把侧栏 `nav` 折成横排，导致「专业模式」折叠区失去层次；**改侧栏布局时两个媒体查询要一起看**。
- `docker compose up -d postgres` 报 `project name must not be empty`（中文目录名导致），已用固定 `name:` 解决；宿主端口 55432 被占，改 55433。
- `pnpm test` 曾因 `packages/shared` 无测试文件而失败，已改 `vitest run --passWithNoTests`。
- Zod v4 的 `.refine()` 不能通过泛型包装函数复用（类型推断会丢），必须内联或写成独立 predicate。**query string 里的布尔值一律用 `z.stringbool()`**，不要用 `z.coerce.boolean()`（`Boolean("false") === true`）。**布尔筛选是三态不是两态**：`undefined`（不筛）与 `false`（筛反面）必须分开，用 truthy 判断会把 `false` 静默降级成「不筛」（Phase 12 踩过）。
- `interface X extends Record<string, string>` 装不下 `string | null`（TS2411），前端表单类型要用交叉类型 `SensoryValues & { ... }`。
- PowerShell：`$pid` / `$host` / `$error` 是只读自动变量（冒烟脚本改用 `$productId` 之类）；`rg pattern docs/*.md` 会报错，要写 `rg pattern docs` 或 `rg -g "*.md"`。
- `apps/web` 的 tsconfig 开了 `noUncheckedIndexedAccess`（数组下标要判空，用 `items[0]?.id`）与 `moduleResolution: Bundler`（import 必须带 `.js` 后缀）；`exactOptionalPropertyTypes` 为 false。
- 错误响应外层是 `error`（断言要读 `error.details.*`）；`apiRequest` 仅在带 body 时设 `content-type`，204 返回 `undefined`。
- `market_offers` 的 PATCH 只允许 `unit_scope / weight_g / pieces_per_case / manual_note / is_excluded`（strict）；**改规格必须重算 `identity_key` 与证据分**，否则跨来源印证算错；落库时曾漏带 `quote_traceable` 出参。
- 前端样式别用不存在的类名假装有交互态（`.row-active` 不存在、`.link-button` 无样式定义）。
- **「报告的数量」必须与破坏性操作的真实结果同源计算**（Phase 7 `rebuild()` 曾把 `kept_manual` 写成操作前的快照 → 谎报保留了 N 条人工锚点）。
- 建 fixture 时**产品名必须与产品名称对得上**（Phase 7 曾把日志用的 label 当 `product_name`，导致「命名体系」维度归零、总分掉到 70 以下、锚点一条不生成，白排查一轮）。
- **同一条判定口径只能有一份实现**（Phase 11 的 API 侧复制了生成侧缺口逻辑且漂移）→ 已抽 `formulaPhilosophyEvidenceGaps()` 单实现。
- **「写了才引用」要靠逐字回查实现，不能靠生成时自觉**（Phase 10 `toRoleView()` 曾挂出正文没写的字段、`value_role` 一次挂满 15 条 DNA）→ 已加 `usedHits()` 与「每角色最多 3 条 DNA」。
- Postgres 里拼接求和表达式**必须自带括号**（Phase 10 `writtenRolesExpr()` 少一层括号 → 括号优先级导致排序静默失效）。
- Drizzle 的 join 子查询**别名不能与被 join 表的列名同名**（Phase 9 `version` 撞列名 → 42702）；整表 left join 无匹配行时返回「全 null 对象」而不是 `undefined`，判「有没有这条记录」要用主键。
- **每改一个全局口径常量，先全局 `rg` 它的断言与文案**（Phase 8/12/13/14/15 反复踩：`DELIVERED_PHASES` / `implemented_phases` / `*_DOWNSTREAM` 长度 / `/api/health` 的 phase 文案）。**每交付一个下游 Phase 都要回填 `*_DOWNSTREAM`**；`status` 只有 `PENDING` 一种取值，已交付条目只能删除、不能改成 `DONE`。
- **vitest 不做类型检查，单测全绿不代表类型没问题**：改完 schema 层导出**必跑 `pnpm typecheck`**（Phase 11 的 TS2322、Phase 14 的测试文件 TS18048 都是这么发现的）。
- **边界用例必须从干净起点造数据，一条断言只验一件事**（Phase 13 首轮三次失败都是拿「已强化 3 轮」的产品去验「同档 / 降档 400」，先撞轮次上限 → 断言指向错误原因）。
- **先判断「真缺陷」还是「断言口径过时」再动手**：Phase 10 首轮 5 处失败只有 1 处是真缺陷；Phase 12/13/14/15 的回归失败绝大多数是期望值随交付过时。写 API 断言前先用真实请求确认状态码与可空性（`chatReplySchema` 允许 `headline` 为 `null`；`z.uuid()` 会拒「版本 / 变体位不合法」的串 → 400 而不是 404）。
- **非 UUID 路径参数由 500 改 404**（`services/api/src/server.ts` 的 `postgresCodeOf()` 沿 `cause` 链找 `22P02`）。这是全局行为变化，新断言按 404 写；改错误处理链时不要把映射弄丢。
- `apply_patch` 的同一个文件**一次只能出现一个 `*** Update File` 段**（否则整包不生效）；新增 >150 行的大文件容易报 `invalid hunks`，需拆成「建头 + 追加」。
- 本轮新增：`Start-Process -RedirectStandardOutput` 在本会话被安全策略拒（`serve-public.ps1` 内部可用）；`serve-public.ps1` 用管道调用时输出被缓冲，判断成功要靠 `netstat` + `/api/health` + 日志文件。

## 待确认
- 本机 UI 自动化通道的准确结论（2026-09-24 实测，勿重复踩坑）：**桌面自动化可用**（`@oai/sky` 必须走 `node_repl` 通道；`cua_repl` 报 `Trusted RPC service is not configured: sky`）；**浏览器自动化被安全层拦住**（无法确定 Chrome 当前网址，根因推断为 API key 模式 + 扩展桥取不到 Codex 认证令牌）。绕开办法 = 无 UI 依赖的 `scripts/serve-public.ps1`，或走 headless Chrome + CDP 自建脚本。
- 跨产品锚点独立页面、`knowledge_documents` / `knowledge_chunks` 知识库表（§35 / §54）尚未落地。
- 卖点一页纸带产品图（需新增 `product_media` 表）与 PPTX 直出（模板引擎）本轮**明确不做**，属新需求。
