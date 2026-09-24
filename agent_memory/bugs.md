# 问题与风险

## 已知问题
- 与基线 §59 推荐目录的差距（尚未到实现阶段，勿当成功能裁剪）：缺少 `packages/scoring/`（Phase 5 相似度时创建）、`services/crawler/`（Phase 4）、`services/research-worker/`（Phase 4/5 研究流水线）、`database/seeds/`（当前种子在 `packages/database/src/seed.ts`）。补齐时同步更新 `docs/architecture.md` 与 `README.md` 目录树。
- 基线 §58 的 10 条自动校验覆盖率：1–5 已覆盖（第 3、4 条「复刻 X」「同款配方」由 `services/api/tests/product-records.test.ts` 的 §25 拦截用例覆盖）；
  **第 6 条「产品结构」已由 Phase 10 覆盖**（`packages/schemas/tests/product-architecture.test.ts` + `scripts/smoke/phase10.mjs`）；
  **第 7 条「配方哲学」已由 Phase 11 覆盖**（`packages/schemas/tests/formula-philosophy.test.ts` + `scripts/smoke/phase11.mjs`）；
  **第 8 条「高度修辞」与第 10 条「Level 5 ≥ 3 金句」已由 Phase 12 覆盖**（`packages/schemas/tests/sales-copy.test.ts` +
  `scripts/smoke/phase12.mjs`）；第 9 条「无锚点不降级」由 Phase 8 覆盖、Phase 12 追加标准句与「只压分不降级」口径。
  10 条全部有归属，后续阶段若要改这些口径必须同步更新对应断言。固定 fixture「龙德记六星孔雀」已固化在 `services/api/tests/helpers/app.ts`。
- 规格 §10.4 感官字段的**双处存在**是刻意设计，不是遗漏：`products` 保留主感官档案字段（§10 录入用），`tasting_profiles` 存可版本化的多次品饮记录。两者**不自动同步**——`tasting_profiles` 的更新不会回写 `products`，反之亦然。若产品方后续要求「以某份品饮档案为准」，需要显式设计同步规则与迁移，勿在实现中隐式同步。
- **全仓已无 `501 + details.phase` 占位**（Phase 14 交付后彻底清零）：architecture（Phase 10）、formula-philosophy（Phase 11）、
  sales-copy（Phase 12）、intensify（Phase 13）均按既有模块范式接线；Phase 14 事实审核的 8 条路由**基线 §37 未列**，
  同样按既有模块范式自建（`services/api/src/modules/fact-review/`），不是在 501 占位上补的。后续阶段不要再引入 501 占位口径。
- 迁移目录 `database/migrations/` 现有 **0000–0014 共 15 个**迁移文件（0000 基础表、0001 产品事实/品饮/研发参考、0002 Value DNA + Prompt 版本、0003 搜索策略/来源/抽取/研究任务、0004 候选池、0005 价格证据 + 归属/分档枚举、0006 `market_offers.quote_traceable`、0007 `value_anchors` 高价值锚点、0008 `0008_wide_xavin`、0009 `0009_tidy_blazing_skull`、0010 `value_codes` + `product_value_codes`、0011 `product_architectures`、0012 `formula_philosophies` 配方哲学、0013 `copy_outputs` 强成交话术、**0014 `0014_slow_nightmare` = `generated_claims` + `claim_evidence` 事实审核两表**）；后续每次改 schema 必须 `pnpm db:generate` 并把新迁移一并提交。
- **`0008_wide_xavin.sql` 是 `db:generate` 的废产物，不是「空迁移」也不是漏提交**：它只创建 Phase 8 需要的两个枚举类型（无表、无列），`meta/0008_snapshot.json` 与之对应；`category_creator_profiles` 表实际落在 **`0009_tidy_blazing_skull.sql`**（journal idx8 = `0008_wide_xavin`，idx9 = `0009_tidy_blazing_skull`）。删掉 0008 会导致 journal 与已应用迁移号错位，**不要回收**；后续新增迁移从 **0014** 继续（0010 = Phase 9 价值密码、0011 = Phase 10 产品结构、0012 = Phase 11 配方哲学、0013 = Phase 12 强成交话术；Phase 13 强化器复用 `copy_outputs`，**不需要**新迁移）。
- 新增表必须同步进 `services/api/tests/helpers/app.ts` 的 truncate 清单，否则测试之间会互相污染（Phase 4 四张新表 + Phase 5 `comparable_candidates` + Phase 6 `market_offers` + Phase 7 `value_anchors` + Phase 8 `category_creator_profiles` + Phase 9 `value_codes` / `product_value_codes` + Phase 10 `product_architectures` + Phase 11 `formula_philosophies` + Phase 12 `copy_outputs` + Phase 14 `generated_claims` / `claim_evidence` 均已登记；`value_codes` 是 16 行字典 seed，冒烟后保留属正常）。
- 冒烟收尾的「清零业务表」清单随阶段增长，Phase 14 后为 `products` / `sources` / `market_offers` / `comparable_candidates` /
  `value_anchors` / `category_creator_profiles` / `product_value_codes` / `product_architectures` / `formula_philosophies` /
  `copy_outputs` / `generated_claims` / `claim_evidence` 全部为 0，`value_codes` 保留 16 行字典；新增表后要同时更新 truncate 与清零脚本。
- Phase 15 **不新增表、不新增迁移**（迁移目录仍为 **0000–0014 共 15 个**）：交付层是派生视图，历史版本复用既有
  `GET .../copy/versions` 与 `GET .../fact-review/versions`。若日后要给交付层加表，先当作需求变更确认（§62-15），
  不要顺手加缓存表。
- Phase 15 冒烟 `scripts/smoke/phase15.mjs` 收尾同样把业务表清零（含 `generated_claims` / `claim_evidence`），
  `value_codes` 保留 16 行字典；交付层不新增表，**truncate 清单与清零清单无需改动**。
- `sources` 表没有 `price_count` 列：价格条数记在 `source_extractions.price_count`，查询来源时不要去找 `sources.price_count`。
- Phase 3–7 前端页面已接线；`/high-value-db` 是跨产品候选池（相似度分档），`/market-prices` 是跨产品价格证据与分档，二者都不参与彼此打分（价格 ≠ 相似度）。
- Phase 7 锚点层**显式排除 `SOURCE_UNATTRIBUTED` 价格证据**（`isReliableOffer`：非 `isExcluded`、非 `isOutlier`、非 `SOURCE_UNATTRIBUTED`、
  `evidenceScore >= 75`），即「没写产品身份」的价格再高也不能把产品推成对标模式；这是对 Phase 6 压线风险的正面缓解，不要再放宽。
- Phase 7 技术债（可接受，暂不优化）：`anchors.service.ts` 的 `reliablePriceCount()` 与 `snapshotFor()` 对每个候选各发一次价格查询（N+1）。
  单产品锚点上限 60 条、价格行数有限，实测无性能问题；若未来放宽 `ANCHOR_LIMITS.maxPerProduct` 或接入大批量真实价格，再改批量查询。
- 前端跨产品「高价值锚点库」只有 API（`GET /api/anchors`），**暂无独立页面**（`pages/` 下无 `ValueAnchorsPage`，`App.tsx` 无 `/anchors` 路由）；
  锚点 UI 目前在产品详情「高价值锚点」Tab。要做跨产品库需新增页面 + 导航项，并复用 `components/anchors/AnchorTable`。
- **空 Value DNA ≠ 未生成 Value DNA**：产品创建时会自动跑规则引擎写入 `products.value_dna`，所以「11 个维度全空」是一种正常存在的状态。
  `packages/schemas/src/category-creator.ts` 的 `usableValueDna()` 把「11 维全空」视同未生成（不产生 `value_dna_refs`），
  这是刻意的归一，不是 bug；冒烟 / 测试若要验证这条路径，必须先 `update products set value_dna = '{}'::jsonb` 造数据。
- Phase 8 的自建标准**不是独立 Tab**：基线 §32 的 13 个 Tab 里没有 Category Creator，它是「高价值锚点」Tab 的模式分支，
  组件挂在 `components/anchors/AnchorsPanel.tsx` 内、紧跟 `AnchorModeCard`。不要为了「看起来像一级功能」而新增 Tab 或导航项。
- **`*_DOWNSTREAM` 清单一律只写「尚未交付」的阶段**（§60 口径）：Phase 15 交付后
  `CATEGORY_CREATOR_DOWNSTREAM` / `VALUE_CODES_DOWNSTREAM` / `PRODUCT_ARCHITECTURE_DOWNSTREAM` /
  `FORMULA_PHILOSOPHY_DOWNSTREAM` / `SALES_COPY_DOWNSTREAM` / `FACT_REVIEW_DOWNSTREAM` / `DELIVERY_DOWNSTREAM`
  全部为 **空数组**，跨阶段交接关系改由各合同自带的 `rules` 文案表达。Phase 15 是 §60 的最后一个 Phase，
  它的 `DELIVERY_DOWNSTREAM = []` 就是「到此为止」的正式表达。
  **每交付一个下游 Phase 都要回填 `*_DOWNSTREAM`**，`status` 只有 `PENDING` 一种取值（`categoryDownstreamItemSchema.status` 是 `z.literal("PENDING")`，
  所以已交付条目只能删除、不能改成 `DONE`）；清空后前端（如 `CategoryCreatorContractCard`）显示「下游交接已全部交付」的空态，
  不得把自己编的条目当成未交付来渲染。
- Phase 9 的「价值密码库」（`/value-codes`）是**跨产品只读总览**：生成与人工确认一律回到产品详情
  （「价值映射」/「价值密码」两个 Tab 用同一个 `ValueCodesPanel`），与 Phase 6 `/market-prices`、Phase 5 `/high-value-db` 的分工一致。
  不要为了「方便」在跨产品页加写操作按钮。
- Phase 9 的实现坑（已修，勿重犯）：① Drizzle 的 join 子查询别名**不能与被 join 表的列名同名**（`version` 撞 `product_value_codes.version`
  → Postgres 42702），必须 `max(...).as("latest_version")` 之类另起名字；② 整表 left join 在没有匹配行时会返回
  「所有字段为 null 的对象」而不是 `undefined`，判断「有没有这条记录」必须用主键（`profile.id`）判空，不能靠字段是否存在。
- `/api/health` 的 `phase` 文案是**手工维护**的，不随 `DELIVERED_PHASES` 自动变；每交付一个 Phase 记得同步
  （Phase 9 收口时才发现它仍写着 Phase 8）。`scripts/smoke/phase10.mjs` 已把健康检查断言放宽为「phase 数字 ≥ 10 且含『已交付』」，
  所以不必每交付一个 Phase 都回去改历史冒烟脚本；但**仍要记得改这条文案本身**
  （当前为 `Phase 15｜主播中心 / 经销商中心与导出（Phase 1–15 已交付）`，已用 `/api/health` 实测生效）。
- **Phase 15 交付层是只读派生视图（§62-15）**：`services/api/src/modules/delivery/` 的 6 条路由全部只 `requireAuth`，
  不写库、不改写任何一句正文、不调用 AI、不新增 Prompt Key；两个中心与导出都由 `copy_outputs` + `generated_claims` **现算**，
  历史版本复用既有 `copy/versions` 与 `fact-review/versions`。**不要为了「性能」给交付层加缓存表或快照表**，
  那会立刻违反「派生视图」口径。
- **交付层只有一份发布闸门**（主播中心 / 经销商中心 / 跨产品排产列表 / 导出读同一个 `ready`）：
  判据是**最新一版成稿 + 这一版自己的最新审核**（上一版审批通过、当前版刚生成还没审 → **不算通过**，杜绝假绿灯）。
  闸门未通过时两个中心与列表**仍返回 200**（十格全空：`present=false` / `tone="outline"` / `chars=0` / `text=null` /
  `lines=[]` / `items=[]`，并在 `gate` 给出 `reason` 与 `next_action`），**只有导出返回 409** `CONFLICT` +
  `details.{gate,gate_label,blocking_sentences,next_action}`。改闸门判据时四条链路必须一起改，不能只改其中一条。
- Phase 15 导出参数**大小写敏感**：`format = markdown`（默认，`.md`）| `text`（`.txt`，去符号适合提词器 / 打印手卡），
  `scope = host` | `dealer` | `all`（默认 `all`）；写成 `Markdown` / `HOST` 一律 400。正文超过
  `DELIVERY_LIMITS.maxExportChars = 120000` → 400 + `details.chars` / `details.max_export_chars`（不产半成品文件）。
  跨产品排产列表 `GET /api/host-center` 的 query 是 strict（`page` / `pageSize` ≤ 100 / `q` ≤ 200 / `ready` 三态
  `z.stringbool()`），排序固定 `ready desc, product_name, id`，**分页字段是 camelCase**。
- Phase 10 的证据口径（**生成侧与 API 侧必须同源**）：角色正文写进哪个字段，就只能把那个字段算作证据——
  `packages/schemas/src/product-architecture.ts` 的 `usedHits()` 会逐字回查正文，API `serialize()` 由 citations 反推 `evidence_refs`。
  证据只允许来自 `PRODUCT_FACT_FIELDS`（`product.*` 白名单）与 Value DNA，且每个角色最多 3 条 DNA 引用（`maxDnaRefsPerRole`）；
  不要再按「单个 DNA 维度各取 3」累计（那会让一个角色挂满 15 条）。
- `productArchitectureSchema` 定义在 `packages/schemas/src/product.ts`，九字段全 `.default("")` 且**非 strict**：缺键会被补成空串、多余字段被 strip（不是 400）。
  需要「多余字段必须 400」时用别的 strict schema（如 `productArchitectureListQuerySchema`）；写测试时不要指望它拒绝多余字段。
- Phase 10 的 `/architecture` 是本轮唯一新增的一级页面与导航项（跨产品结构库），产品级生成 / 确认全在产品详情「产品结构」Tab；
  「高价值锚点」（Phase 7/8）仍只有产品详情 Tab、跨产品库仅 API，两处分工不要混。
- `PRODUCT_ARCHITECTURE_DOWNSTREAM` 与 `FORMULA_PHILOSOPHY_DOWNSTREAM` 现均为**空数组**（Phase 11 / 12 / 14 均已交付并回填）；
  Phase 9 的 `product_architecture_story` / `formula_philosophy_story` 已由 Phase 10 / 11 正文正面提供（`READY` / `PARTIAL` / `GAP`，
  `VALUE_STORY_HANDOFF_PHASES` 清空），六类价值故事不再有 `HANDOFF` 占位。前端对仍未交付的下游必须按「未交付」渲染，不得显示为已完成。
- Phase 12 的**价格回查正则** `SALES_COPY_PRICE_PATTERN = /\d+(?:\.\d+)?\s*(?:万元|万|元|块)/g` 会扫正文里任何「数字 + 元 / 万」组合，
  用来判定「凭空价格」红线；写 fixture 或调试文案时不要随手写「38 元」「999 万」这类字样（即使上下文无关也会被记为价格命中），
  否则会得到意料之外的 RED。真实价格锚点走 `value_anchors`，与文本回查是两套口径。
- Phase 12 只落 `copy_outputs`；§36 只给出表名，字段按本阶段输出清单（§21–§26）落定。**`generated_claims` / `claim_evidence`
  已由 Phase 14 落地**（迁移 0014，一句一行：逐句 Claim Type / Risk / Evidence / 修改建议 + 审批状态）。Phase 12 已有的合规判定
  （`GREEN` / `YELLOW` / `RED`）是**文案侧规则判定**，Phase 14 的逐句证据链审核是**独立第二道闸门**，两者同源但不要互相替代：
  成稿可发布 = 两次判定都非 RED。
- **强化结果响应体里没有 `lost_facts` 字段**（`salesCopyIntensifyResultSchema` 只有 `added_facts`）：被写弱的引用只写进
  新版本的自动备注（`copy_outputs.notes`），`intensifySalesCopy()` 内部的 outcome 才有 `lost_facts`。写前端或断言时不要在
  响应体里找这个字段，也不要因为「响应里看不到失去的事实」就以为丢了——去版本备注里查。
- **极简产品也能强化到 94 分并满足 Level 5，这是实测行为，不是 bug**：单一身份规格的产品在 §23 八项里本来就容易拿高分
  （开场 + 身份 + 记忆点都是短句强项），事实不足只按「逐字回查到的事实条数」压分（84 / 74 / 68 / 55），
  而它引用的 1 条事实确实逐字在正文里，所以拿到 94 分并 `level5.required === false` + 七项全过。Phase 13 冒烟首轮
  就是按「强化到爆款后自检必然不过」写的断言，属**断言预期错**，改成验证「`passed` 由 `score_passed` 与 `missing`
  互相推导、`missing` = 未通过项」后才对。后续阶段不要反过来去「修」这个分数。
- Phase 13 的**分数下降不阻断**是刻意的：更高档画像重讲一遍可能让某一项掉分（例如为了更强开场牺牲收口），
  此时仍写新版本并在 `self_check` 里如实 `passed: false`，不做静默回滚、不改旧版本（§62-15 所有版本必须保留）。
 若产品方要求「分数不许下降」，那是新的口径变更，需先确认再改。
- **AI 对话工作台的两条硬口径**：① `GET /api/chat/labels` 的 `ai_provider` 是前端判断「真模型 / mock」的**唯一来源**
  （`deepseek` = 真模型），不要用响应快慢或有没有 Key 去猜；② 真实单次出稿 **80–143 秒**（实测 81 / 83 / 84 秒成功），
  前端必须有等待态（进度条 + 秒表 + 禁止重复提交），否则在真实 Provider 下交互看起来就是「点了没反应」。
- **`buildChatSystemPrompt` 必须显式给出 `value_focus` 的 8 个英文键白名单**
  （`identity / market_price / material / mountain / formula_philosophy / style / time / collection`）：
  漏掉白名单时模型会写中文 `"山头"` 之类的值，整份按 schema 判废稿（不是「差一点」而是全废）。
- **`chat_sessions` / `chat_messages`（迁移 `0015_right_hercules.sql`）已登记进
  `services/api/tests/helpers/app.ts` 的 truncate 清单**，冒烟 / 联调后的清零清单也要带上
  （`chat_sessions` / `chat_messages` 应为 0；草稿不落库，只有会话与消息两表）。
- **测试助手里 `createTestContext` 另开一个 App 时不能直接 `bootstrapAdmin`**（已有用户时返回 403）：
  必须由外层管理员 token 代办 `POST /api/auth/register` 建角色账号。

## 风险记录
- **已修复（2026-09-24）：登录超过 30 分钟后整个工作台全是 401**（用户截图：会话列表 / 工作台合同 / 发消息
  全部报「访问令牌无效或已过期」，右下角连弹 3 个 toast，页面却不会退回登录页）。根因：access token 只有
  30 分钟有效期（`ACCESS_TOKEN_TTL_MINUTES=30`），而前端**从来没有刷新逻辑** —— `lib/api.ts` 收到 401 直接抛错，
  `lib/auth.tsx` 也从不使用 `refresh_token`；同时 `RequireAuth` 只看 `user` 是否存在，所以登录态过期后仍放行。
  修法：新增 `apps/web/src/lib/session-store.ts`（登录态唯一存储：`getSession` / `setSession` / `subscribeSession`），
  `lib/api.ts` 的 `apiRequest` 遇到 401 且非 `/api/auth/*` 时自动刷新并**重试一次**，刷新也失败才 `setSession(null)`
  让 `RequireAuth` 把用户送回登录页；`lib/auth.tsx` 改用 `useSyncExternalStore(subscribeSession, getSession)`。
  **回归时不要**：① 把 401 自动刷新去掉（会重演整页 401）；② 让 `/api/auth/*` 也参与自动刷新（会无限递归）；
  ③ 把并发刷新拆成「每个请求各刷一次」——refresh token 是**一次一换的轮换令牌**，并发刷新会让先到的那张立即作废，
  必须共用同一个 `refreshInFlight` promise。
- **已修复（2026-09-24）：真实 DeepSeek 长稿被 `max_tokens` 截断 → 502 `AI_UNAVAILABLE`**。
  `services/api/src/modules/chat/chat.service.ts` 原为 `maxTokens: 3200`，绑定产品 + Level 4 的长 JSON 写不完，
  `generateValidatedJson` 判定「AI 输出的 JSON 载荷不完整」，实测 128 / 143 秒后返回 502（用户那条需求已保存）。
  已改为 **8000** 并在 `packages/ai/src/json.ts` 按错误类型分流重试提示（含「不完整」→「上一次输出被截断（JSON 没写完）…
  请压缩正文长度、少写几条可选项，确保 JSON 完整闭合」）。**回归时不要把 3200 改回去**。
- **已修复（2026-09-24）：新会话第一条消息重复渲染 + React 重复 key 报错**。
  `activeSession` 从 null 变为新会话时 `loadMessages()` 会拉回刚写入的那条，而 `handleSend()` 的
  `setMessages([...current, user_message, assistant_message])` 又追加一次 → 同一 id 两条（控制台
  `Encountered two children with the same key` 4 次）。已在 `apps/web/src/pages/ChatPage.tsx` 新增按 id 去重的
  `appendUnique()` 纯函数并改用它。修后 headless Chrome 实测**零 error / 零异常**，**不要退回到裸数组拼接**。
- **已修复（2026-09-24）：登录成功却不跳转，表现为「点击登录没反应」**。`/login` 在 `RequireAuth` 之外，
  `LoginPage` 成功后无跳转；已在 `LoginPage.tsx` 加 `user` 守卫 + `App.tsx` 的 `RequireAuth` 传 `state.from`。
  回归时不要再把 `/login` 挪进 `RequireAuth`（会造成登录页重定向死循环），也不要去掉 `LoginPage` 的守卫
  （会造成「已登录还能停在登录页」）。同类缺陷（成功回调缺少视图切换）建议按此范式检查其它表单页。
- `favicon.ico` 404（无害）：`apps/web/index.html` 未声明 favicon，浏览器默认请求 404，控制台有噪音；
  要清掉需新增图标资源并在 `index.html` 声明，属可选优化，未做。
- **冒烟脚本默认管理员账号已过期（2026-09-24 账号迁移的后果，尚未修）**：`scripts/smoke/phase{3..15}.mjs` 的
  `SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local"` / `SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456"` 指向已失效旧账号，
  不带环境变量直接跑冒烟会在登录步就失败。现状：跑冒烟前 `$env:SMOKE_ADMIN_EMAIL="949412546@qq.com"`、
  `$env:SMOKE_ADMIN_PASSWORD="shi123456"`。是否把兜底值改成新账号（12 个脚本）待产品方确认，未改。
- **登录页错误信息被压缩（Phase 1 遗留 UI 缺陷，尚未修）**：`apps/web/src/pages/LoginPage.tsx` 只渲染 `caught.message`，
  `ApiError.details`（`apps/web/src/lib/api.ts` 已解析）中的字段级原因被丢弃，用户只看到「请求参数不合法」；
  且库中已有用户时登录页仍显示「注册首个管理员」入口、密码框无规则提示。修法已知（按 details 展开 + 前端预校验
  + 已有用户时改为「请联系管理员开通账号」），等确认后再动。
- 端口冲突：宿主 55432 被 `tea-packaging-inspiration-postgres-1` 占用，本项目改用 **55433**；若再改端口，需同步 `.env`、`.env.example`、`docker-compose.yml`、`packages/database/drizzle.config.ts`、`services/api/tests/test-env.ts`、`README.md`。
- 中文目录名：工作区路径含中文，`docker compose` 无法从目录名推导 project name，已在 `docker-compose.yml` 顶部固定 `name: ldj-value-engine`（删除该行会导致 `project name must not be empty`）。
- 产品更新语义：`createProductSchema` 带默认值（AUTO / 4 / false），`updateProductSchema` 刻意不带默认值。若日后给 update schema 加默认值，会导致 PATCH 未提交字段被静默重置（已加回归测试覆盖）。
- 事实性风险（违反铁律）：任何自动补全树龄/山头/年份/获奖/大师/研发关系/配方比例的行为都属违规；当前靠 schema 与 NULL 存储保证，AI 生成阶段需继续在 prompt + fact-reviewer 层拦截。
- 第三方 Key 缺失（`OPENAI_API_KEY` / `TAVILY_API_KEY`）时系统回退 Mock，可开发但不可作为内容质量验证；真实质量必须用真实 Provider 复验。
- **价格证据分边界（Phase 6 实测，非缺陷但需盯住）**：来源没写产品身份、但写明了规格重量（如 357g）时，
  「产品身份确定」项仍得 4 分，五项合计可达 **75（STRONG 压线）**，若未被人工排除会进入 `price-summary.reliable_count`。
  当前缓解：`SOURCE_UNATTRIBUTED` 的 `identity_key = null` 且没有候选，Phase 7 锚点除价格分外还要求候选相似度 ≥ 70；
  **Phase 7 已按此进一步显式排除 `SOURCE_UNATTRIBUTED`**（冒烟里专门用「未写身份 + 写明 357g → 75 分压线」验证过）。
  该价格仍会进入 `price-summary.reliable_count`（那是价格层的口径，不是锚点层），故若产品方要求价格层也排除，需要单独确认。
  是否给「只有规格、没有产品名」的身份项设上限属 §15 权重口径调整，须由产品方确认后再改，不要顺手改打分代码。
- **Phase 12 起的全局 404 口径**：`services/api/src/server.ts` 把 pg `22P02`（非 UUID 路径参数）统一映射为 404。
  好处是调用方拿到「资源不存在」而不是 500；代价是**任何依赖 500 的历史断言或前端兜底逻辑都可能失效**。
  新增路由无需额外处理，但改错误处理链时不要把这个映射弄丢；只处理 `22P02`，其它 pg code 仍按原样冒泡。

## 失败尝试
- （登录态）前端**只有 access token 没有刷新机制**这件事在看板上无提示：`RequireAuth` 以「本地有 user」为放行条件，
  token 过期后页面照常进入工作台，但每个接口都 401 —— 表现与「页面坏了」无法区分。后续任何「本地存了令牌就放行」
  的写法都要配一条 401 自愈路径，否则用户只会看到一片红字。
- （登录态）refresh token 是**轮换令牌**（`AuthService.refresh()` 换新后立刻 revoke 旧 session），
  所以前端刷新必须**串行去重**；首轮如果按「每个 401 各自刷新」实现，多请求并发时后到的那次会把先换出的令牌作废，
  表现为「刷新一次能用、刷新两次就掉登录」。已用模块级 `refreshInFlight` 解决。
- （AI 对话工作台）`packages/ai/src/json.ts` 曾用 `lastIndexOf("}")` 截取 JSON 载荷：模型在 JSON 之后再写一句解释时
  会截错位置；已改为逐字扫描配对。同期 `generateJson` 也曾对同一请求双调用模型（重试逻辑重复发请求）。两者均已修，
  **不要再改回字符串截取或双调用**。
- （AI 对话工作台）窄屏（≤1200px）媒体查询曾把侧栏 `nav` 折成横排，导致「专业模式」折叠区失去层次、
  一级项与专业模块混在一起；已在既有 `@media` 块里改回纵向 + `.nav-pro-body` 网格。**改动侧栏布局时两个媒体查询要一起看**。
- `docker compose up -d postgres` 直接失败：报 `project name must not be empty`（中文目录名导致）；通过固定 `name:` 解决，不要再尝试靠环境变量 `COMPOSE_PROJECT_NAME` 临时绕过。
- 宿主端口 55432 启动失败：`Bind for 127.0.0.1:55432 failed: port is already allocated`；移植到 55433 解决。
- `pnpm test` 曾因 `packages/shared` 无测试文件而失败（vitest 默认退出码 1）；已改为 `vitest run --passWithNoTests`，新增无测试包时应沿用。
- Zod v4 的 `.refine()` 不能通过泛型包装函数复用（类型推断会丢），必须内联或写成独立 predicate 函数（参见 `packages/schemas/src/fact.ts` 的 `evidenceRule`、`rnd.ts` 的 `rndEvidenceRule`）。
- `interface X extends Record<string, string>` 无法容纳 `string | null` 字段（TS2411 索引签名冲突）；前端表单类型（如 `apps/web/src/components/product-records/TastingProfilesPanel.tsx` 的 `TastingProfileApi`）必须用交叉类型 `SensoryValues & { ... }`。
- PowerShell 中 `$pid` 是只读自动变量，冒烟脚本里改用 `$productId`；同类保留变量还有 `$host`、`$error`。
- `apps/web` 的 tsconfig 开启了 `noUncheckedIndexedAccess`：数组 / 对象下标取值必须判空（如 `items[0]?.id`），否则 `pnpm --filter @ldj/web build` 失败；`exactOptionalPropertyTypes` 为 false，可继续传 `undefined`。
- 前端 import 必须带 `.js` 后缀且 `moduleResolution: Bundler`；`apiRequest` 仅在带 body 时设置 `content-type`，204 返回 `undefined`。
- 错误响应外层是 `error`：断言错误信息要读 `error.details.*`（如 `error.details.candidate_id`），不要在顶层找字段。
- `market_offers` 的 PATCH 只允许 `unit_scope / weight_g / pieces_per_case / manual_note / is_excluded`（strict schema）；
  早期实现漏了「改规格 / 改单位后重算 `identity_key` 与证据分」，已修：改规格必须重算身份键，否则跨来源印证会算错。
- `market_offers` 落库时曾漏带 `quote_traceable` 出参（列存在但响应缺字段），导致前端无法判断「引文是否可回溯」；已补。
- 前端样式类名踩坑：`.row-active` 不存在（高亮行用 `.is-active` 之类的既有类），`.link-button` 无样式定义；
  新增交互样式先在同文件或 `styles.css` 里确认类名已定义，别用不存在的类名假装有交互态。
- （Phase 7）`anchors.service.ts` 的 `rebuild()` 曾把 `kept_manual` 写成既有 `is_manual` 条数，导致 `keep_manual=false`
  的响应谎报「保留了 N 条人工锚点」，而数据实际已被删除。已修为 `keptManual = keepManual ? existing.filter(r => r.isManual).length : 0`。
  教训：**「报告的数量」必须与破坏性操作的真实结果同源计算**，不要从操作前的快照里抄。
- （Phase 7 冒烟）建 fixture 时拿日志用的 label 当 `product_name` 落库，导致 §13 十维相似度里「命名体系」维度归零、
  总分掉到 70 以下、锚点一条都不生成，白排查一轮。教训：**来源页/测试里写的产品名必须与产品名称对得上**，
  否则相似度不是「差一点」而是整维归零。
- （Phase 7 冒烟）把研究进度接口写成 `GET /api/research/progress`（该路由不存在，404）。正确路由是产品级
  `GET /api/products/{id}/research/progress`；且它只返回 `progress[]`，**没有 `implemented_phases` 汇总字段**，
  要断言「已交付阶段」需自己从 `progress[].implemented` 推导。
- （Phase 8）预期 `implemented_phases` 的测试与冒烟脚本会随交付阶段变化而失效：`packages/schemas/src/core-features.ts` 的
  `DELIVERED_PHASES` 已更新为 `[1..8]`，因此 `services/api/tests/{research,prices,candidates}.test.ts` 与
  `scripts/smoke/phase5.mjs` 的期望值都要同步改；`scripts/smoke/phase7.mjs` 只断言 `[3,4,5,6,7]`（Phase 8 是模式分支、无新流水线阶段），
  `packages/schemas/src/research.ts` 的 22 阶段**不含** Category Creator 阶段——不要往流水线里硬加阶段来「体现」Phase 8。
  教训：每交付一个 Phase，先全局搜 `DELIVERED_PHASES` / `implemented_phases` 的期望值再跑测试。
- （Phase 8 冒烟首轮）想验证「11 维 Value DNA 全空视同未生成」，直接建极简产品却拿到 `value_dna_refs` 非空（1 项断言失败）。
  原因：产品创建会自动跑规则引擎生成 Value DNA。修法是在建产品后先 `update products set value_dna = '{}'::jsonb` 再断言，
  **不要去改产品创建逻辑**（自动生成 DNA 是 Phase 3 的既定行为）。
- （Phase 8）文档与阶段号要对齐基线 §60：Phase 8 = Category Creator Mode，Phase 9 = Value Codes / Value Mapping，
  **没有**「Phase 8 新增后把原 Phase 8–15 顺延」这回事；README / `docs/roadmap.md` / `docs/api.md` 的阶段号一律以 §60 为准。
- （Phase 9 冒烟）两条断言写得太死，属脚本预期错误（非产品缺陷）：① 时间故事正文写成「逐字等于 §19 句式」，
  实际正文是「§19 句式 + 已经具备的底子（各 Code 的首条已录证据）」——§19 的逐字要求只作用于 Code 层的
  `statement` / `safe_expression`（schema 已强制），故事正文只要求引用该句式且不出现禁止句；
  ② 价值密码库行内 `time_dependent_codes` 写成「固定三个码」，但时间依赖型 Code 只有在**底子已录入**时才是
  `TIME_DEPENDENT`，一点事实都没有的只能算 `UNKNOWN`——断言要与 `code_counts` 同源，并用事实齐备产品验证「三个都齐」。
- （Phase 10 单测）`product-architecture.test.ts` 首轮 5 处失败中**只有 1 处是真缺陷**，其余 4 处是断言口径错，别再照着改产品逻辑：
  ① `value_role` 的缺口文案是「写实的结构角色只有 N 个，不足 3 个…」，与其它角色的缺口文案不同，GAP 断言要把它排除；
  ② 价值位成立后 `value_role` 自身也算一个写实角色（事实齐备产品是三个结构角色 + `role_counts.written === 4`）；
  ③ `productArchitectureSchema` 缺键有 `.default("")`、多余字段被 strip（不是拒绝），断言只能写「键顺序 + 类型错误 + 多余字段不落库」；
  ④ 「事实齐备仍判定未写实」属真缺陷，由 `usedHits()` 修复。
- （Phase 10）`toRoleView()` 曾直接用 `draft.hits` 生成 citations，导致 citations 里出现正文根本没写的字段
  （identity 用 `series_name` 作主语却引用 `product_name`），`value_role` 更是一次挂满 15 条 DNA。修法是新增 `usedHits()`
  逐字回查正文并统一按角色限 3 条 DNA，与 API `serialize()` 同源。教训：**「写了才引用」这条红线要靠逐字回查实现，不能靠生成时自觉**。
- （Phase 10）Postgres 里拼接求和表达式必须自带括号：`writtenRolesExpr()` 少一层括号时 `((9-a)+b)+…` 会被解析成
  「按缺口数倒序」静默失效（接口仍 200，只是顺序不对）。凡是要在 SQL 里拼聚合运算，先单独括号包住整体再参与比较 / 排序。
- （Phase 11）列表查询布尔筛选用 `z.coerce.boolean()` 会把字符串 `"false"` 解析成 `true`（`Boolean("false") === true`），
  导致「只看未确认比例」返回相反结果。修法：用 `z.stringbool()`。**凡是从 query string 接布尔值一律用 `z.stringbool()`**，不要用 `z.coerce.boolean()`。
- （Phase 11 冒烟首轮）API `collectEvidenceGaps()` 复制了生成侧缺口逻辑却**漏了「拼配描述里出现比例字样但不足以构成完整配比」一条**，
  导致同一版本缺口清单「生成时」与「回看时」不一致。修法：抽成 schema 层 `formulaPhilosophyEvidenceGaps({ formula, product, dna, architecture })` 单一实现，
  `buildFormulaPhilosophy` 与 API `serialize()` 共用。教训：**同一条判定口径只能有一份实现**，复制一份出来迟早漂移；抽公共函数时注意 `product` 形参在 API 侧传的是 `input`（`FormulaPhilosophyProductInput`）不是 DB row。
- （Phase 11 收口）`formulaPhilosophyEvidenceGaps()` 的 `architecture` 形参最初写成 `FormulaPhilosophyArchitectureRef | null`（非可选），
  而 `FormulaPhilosophyBuildInput.architecture` 是 `?: ... | null`，`tsc` 报 TS2322。修法：形参改 `architecture?: FormulaPhilosophyArchitectureRef | null`。
  教训：**改 schema 层导出后必跑 `pnpm typecheck`**，`vitest` 不做类型检查，单测全绿不代表类型没问题。
- （Phase 12）列表查询的 `missing` 三态最初写成 `if (query.missing)`，于是 `?missing=false` 走了「没有筛选」的分支**静默返回全量**，
  前端以为筛过了。修法：与 `level5` / `has_anchor` 同一套口径显式判三态（`true → copy_outputs.id is null`、
  `false → copy_outputs.id is not null`、未传 → 不筛）。教训：**布尔筛选是三态而不是两态**，`undefined`（不筛）与 `false`（筛反面）
  必须分开处理，用 truthy 判断会把 `false` 静默降级成「不筛」。
- （Phase 12）路径参数不是 UUID 时 Postgres 抛 `22P02`（invalid input syntax for type uuid），被全局错误处理器兜成 **500**。
  修法：`services/api/src/server.ts` 新增 `postgresCodeOf(error)`，沿 `cause` 链最多 5 层找 `^[0-9A-Z]{5}$`
  的 pg code（drizzle 会包成 `DrizzleQueryError`，原错误在 `cause`），`22P02 → 404 NOT_FOUND「未找到目标资源」`。
  **这是全局行为变化**：所有路由的非 UUID 路径参数现在返回 404 而非 500，写新断言时按 404 写；
  实测 `/api/products/not-a-uuid`、`/api/products/not-a-uuid/copy`、`/api/products/not-a-uuid/architecture` 均为 404。
- （Phase 12 回归首轮）`phase7.mjs` 报 154/1、`phase8.mjs` 报 122/1，两条都是**断言口径随交付过时**（不是产品缺陷）：
  ① `deliveredPhases` 期望值停在 `[3,4,5,6,7,9,10,11]`，Phase 12 交付后应为 `[3,4,5,6,7,9,10,11,12]`；
  ② `phase8.mjs` 断言「本版下游交接登记 4 条 PENDING」，但 Phase 12 交付后 `CATEGORY_CREATOR_DOWNSTREAM` 只剩 3 条。
  教训：**每交付一个 Phase 先全局搜 `DELIVERED_PHASES` 期望值与 `*_DOWNSTREAM` 长度断言**，再判断是真缺陷还是口径过时，
  不要照着失败断言去改产品逻辑。
- （Phase 13 冒烟首轮）`phase13.mjs` 的失败**全部出在脚本自身**，三次都是同一类错：拿「已经强化过 3 轮的产品」去验
  「同档 / 降档 400」，结果先撞到轮次上限（400 + `max_auto_rounds`），断言看错了原因；对已升到 Level 5 的产品点 `STRONG`
  （降档）也一样。修法：**边界用例必须从干净起点造数据**（本轮新增一个 Level 5 起点的 `flatProductId` 专验「只升不降」）。
  另有一处是直接用了未定义的 helper（`intensifyResultOf(...)`），改成直接保存第二次强化的响应体。
  教训：**一条断言只能验一件事**——先满足前置条件（轮次 / 档位 / 版本数），再去验目标行为，否则失败信息会指向错误的原因。
- （Phase 13 回归首轮）`phase5.mjs` / `phase7.mjs` / `phase11.mjs` / `phase12.mjs` 的失败同样是**口径过时**：
  `implemented_phases` 期望 `[1..12]`、`deliveredPhases` 期望停在 `[3,4,5,6,7,9,10,11,12]`、
  健康检查断言 `Phase ≥ 12`、合同 `spec_ref` 不含 `/ §48`、`intensify_rounds` 还写着「生成侧恒 0 / 占位」。
  已同步这些断言与头注释；Phase 12 冒烟里「生成侧不自动增强、强化是 Phase 13 独立动作」的说法保持不变（它本来就是对的）。
- （Phase 14 收口）`*_DOWNSTREAM` 全量清空后，`packages/schemas/tests/{category-creator,value-codes,product-architecture}.test.ts`、
  `services/api/tests/{category-creator,value-codes}.test.ts`、`scripts/smoke/phase5,7,8,9,10.mjs` 里「下游登记 N 条 PENDING」的断言全部过时，
  必须同步改为「空数组」。教训与 Phase 12/13 同款：**每改一个全局口径常量，先全局 `rg` 它的断言与文案**，别等回归失败再逐个猜。
- （Phase 14 收口）`services/api/tests/fact-review.test.ts` 自建的 `ReviewBody.claim_counts` 曾写成 `Record<string, number>`：
  vitest **不做类型检查**所以 158 个用例全绿，但 `pnpm typecheck` 在 `noUncheckedIndexedAccess` 下报 3 处 TS18048
  （`possibly undefined`）。修法：把该字段写成精确对象类型 `{ FACT: number; INTERPRETATION: number; RHETORIC: number }`。
  教训：**测试文件里手写的响应类型也要经得起 tsc**，单测全绿不代表类型没问题（同 Phase 11 的教训）。
- （Phase 15 回归）修的两处**都在冒烟脚本自身，不是产品缺陷**：① `scripts/smoke/phase13.mjs`（:345–350）把 `/api/health`
  文案锁死成「Phase 13」，已按 `phase10.mjs` 口径放宽为「phase 数字 ≥ 13 且含『已交付』」；
  ② `scripts/smoke/phase8.mjs`（:227–235）断言「本版下游交接登记 N 条 PENDING」，`*_DOWNSTREAM` 全量清空后改为断言空数组
  （断言数 123 → 122）。**Phase 15 本轮未发现产品缺陷**：`FACT_REVIEW_DOWNSTREAM` 的 `[]` 与
  `packages/schemas/tests/fact-review.test.ts`（:386）和 `scripts/smoke/phase14.mjs`（:337）的空数组断言一致，
  **不要反过来去改这些断言、也不要把 `PENDING` 占位加回去**（§60 口径是「已交付阶段一律清空」）。
- （Phase 15）视觉核对本轮**未做像素级截图复核**：Computer Use 失败（`Codex auth token is unavailable`，无可用浏览器），
  改用 Vite 模块编译（`/`、`/hosts`、`/dealers`、`/versions`、`HostCenterPanel`、`VersionHistoryPanel`、`styles.css` 均 200）
  + `tsc` + `pnpm --filter @ldj/web build` + 冒烟 + API 实测替代。要补像素级复核需要能登录的浏览器环境。
- `apply_patch` 的同一个文件**一次只能出现一个 `*** Update File` 段**，否则整包报 `multiple operations target ...` 全部不生效；
  同一文件多处改动要拆成多次调用（或写成一个 hunk）。同理，新增 >150 行的大文件容易报 `invalid hunks`，需拆成「建头 + 追加」。
- PowerShell 下 `rg <pattern> docs/*.md` 会报错（通配符不展开给 rg），要写成 `rg <pattern> docs` 或 `rg -g "*.md" <pattern> docs`。

## 待确认
- 生产部署形态（单机 Docker Compose / 云数据库 / 对象存储）与真实 Provider 供应商，需产品方确认后再进入 Phase 4 网络与合规设计。
- 真实业务数据接入范围：品牌方是否提供历史成交价与经销商价目，直接决定 Price Engine（Phase 6）的可用性与口径。
- 用户与权限模型是否需要细分到「主播 / 经销商 / 研究员」独立账号体系（规格 §15 提及主播中心与经销商中心）。
