# 部署手册（免费方案）

> 部署形态不属于需求基线 §0–§64 的内容，是运维层新增需求；本文件只描述「怎么把它跑在公网上」，
> 不改动任何产品行为与六大核心功能。

## 1. 形态与选型

```text
浏览器 ──https──▶ Render 免费 Web Service（Node 22）
                  ├── /api/**   Fastify API（鉴权 / 业务 / AI 出稿）
                  └── 其余路径   apps/web/dist 静态产物（SPA，深链回 index.html）
                                   │
                                   └──▶ Neon 免费 PostgreSQL（外部库，不随服务重启丢数据）
```

为什么是**单服务**：Render 免费档一台实例就够用，前端与 API 同源 → 只有一个网址、免 CORS、
前端不必在构建期写死 API 地址；也少注册一个平台。静态托管由 `services/api/src/plugins/web-static.ts`
提供，**只在 `NODE_ENV=production`（或显式 `SERVE_WEB=true`）时开启**，本地开发与单测行为零变化。

为什么数据库不放 Render：**Render 免费 Postgres 创建 30 天后会被删除**；Neon 免费档不会到期，
闲置自动挂起、下次连接自动唤醒。

## 2. 需要的外部账号

| 用途 | 平台 | 免费额度要点 |
|---|---|---|
| 代码仓库 | GitHub | 私有仓库 |
| 运行服务 | Render | 750 实例小时/月；闲置 15 分钟休眠；超额只暂停不扣费（**别绑支付方式**） |
| 数据库 | Neon | 免费档 0.5 GB，不设到期 |

## 3. 一次性准备

代码仓库已推好：`https://github.com/straughanmerton-cell/ldj-value-engine`（私有，含根目录 `render.yaml`）。
剩下只有浏览器里的授权动作，**OAuth 授权必须账号本人点**，无法由脚本代劳。

### 3.1 只做这几次点击

| # | 在哪 | 点什么 | 得到什么 |
|---|---|---|---|
| 1 | [neon.com](https://neon.com) → Sign up | **Continue with GitHub** → Create project，Region 选 **Singapore** | 建好免费库，页面给出 Connection string |
| 2 | Neon 项目页 | 复制 **Connection string**（`postgresql://...?sslmode=require`） | 下一步要粘 |
| 3 | [render.com](https://render.com) → Sign up | **GitHub** 登录 | 进入控制台 |
| 4 | Render 安装 GitHub App 时 | 授权 `ldj-value-engine` 这一个仓库（选 Only select repositories） | Render 能读私有仓库 |
| 5 | Render → New → **Blueprint** | 选中 `ldj-value-engine` → Apply | 按 `render.yaml` 建服务，并列出 3 个待填变量 |
| 6 | Blueprint 表单里的 3 个待填变量 | `DATABASE_URL` = 第 2 步的串；`DEEPSEEK_API_KEY` = 本机 `.env` 第 33 行；`BOOTSTRAP_ADMIN_PASSWORD` = 你指定的管理员密码 | 点 Create，开始首次构建（约 5–10 分钟） |

> 密码/密钥只粘贴到平台表单里，**不写进本仓库任何文件**（见第 7 节）。

### 3.2 若 Render 拒绝 `region: singapore`

免费档不支持该区域时，构建会直接报 region 相关错误：把 `render.yaml` 的 `singapore`
改成 `frankfurt`（离国内第二近），重新 push 即可。

### 3.3 Neon 连接串的坑

Neon 有时会给成 `...?sslmode=require&channel_binding=require`；`pg` 不认后半个参数，
若启动日志出现连接错误，把 `&channel_binding=require` 删掉再粘。

### 3.4 零注册的临时公网（备用路）

上面第 1–3 步都需要账号本人在浏览器里点授权。如果只是**先让别人看到 / 先用上**，
或者等授权期间需要一个能打开的网址，可以不注册任何平台：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/serve-public.ps1
```

脚本做三件事：构建前端产物 → 以生产形态在本机 `127.0.0.1:4400` 起 API（同端口兼出前端）→
用 Cloudflare 快速隧道把它映射成一个 `https://<随机名>.trycloudflare.com` 公网地址并打印出来。
cloudflared 不在本机时会自动下载（约 55 MB，仅首次）。

| 差异 | Render + Neon | 临时公网（本节） |
|---|---|---|
| 需不需要注册 / 授权 | 需要 | **不需要** |
| 网址是否固定 | 固定 | 每次重跑都变 |
| 机器要不要开着 | 不用 | **要**（本机就是服务器） |
| 数据库 | Neon | 本机 PostgreSQL 容器（`pnpm db:up` 得先起着） |
| 适合 | 长期给客户用 | 演示 / 内测 / 过渡 |

局限也很直白：cloudflared 进程退出或电脑重启，网址就失效；本机 Docker 里的 Postgres 没起，
接口会报数据库不可用。所以这条路是**过渡**，正式对外仍建议按第 1–3 节走。

## 4. 启动时自动做的事

`startCommand` 串了三步，都是幂等的：

```bash
pnpm --filter @ldj/database db:migrate   # 16 条迁移，已应用过的会跳过
pnpm --filter @ldj/database db:seed      # 建默认品牌 + bootstrap 管理员（已存在则 created=false）
pnpm --filter @ldj/api start             # tsx 直跑 TS 源码
```

所以换库、重建服务都不需要人工补数据。

## 5. 部署后必做的验证

1. `GET /api/health` 返回 `{"status":"ok","database":"up"}`。
2. 用管理员账号登录 → 落到 `/chat`（默认首页）。
3. **真实出稿实测一次**：发一条需求，确认 80–143 秒后能出结构化话术。
   - 这一步必须做：免费平台的网关/代理是否容忍 2 分钟以上的同步请求，只能实测。
   - 若被掐断（504 / 连接被重置），则出稿要改成「异步任务 + 轮询」后再重试部署。
4. 直接打开 `https://<服务名>.onrender.com/chat`（深链）应正常出页面，不是 JSON 404。

## 6. 已知限制与取舍

| 现象 | 原因 | 处置 |
|---|---|---|
| 闲置 15 分钟后首次打开要等约 50 秒 | Render 免费档休眠 + 冷启动 | 可接受；或用外部监控定时 ping 保活（会额外消耗实例小时） |
| 单次出稿要等 1–2.5 分钟 | `deepseek-v4-pro` 真实生成耗时，非缺陷 | 前端已有等待态与禁止重复提交 |
| 国内访问偶发慢 | 境外机房 | 长期给国内客户用应换国内轻量服务器 |
| 免费实例每月 750 小时 | Render 免费档 | 单服务约 730 小时/月，刚好够；两个免费服务会超 |

## 7. 密钥纪律（重要）

1. 真实 `DEEPSEEK_API_KEY` 只允许存在于 `.env`（已 gitignore）与部署平台的环境变量里。
2. 提交前扫描：`git grep -nE "sk-[A-Za-z0-9]{16,}"` 应为空（`.env` 除外）。
3. 密码同理：`BOOTSTRAP_ADMIN_PASSWORD` 走平台环境变量，不写进任何 md 或源码。
4. `JWT_SECRET` 用 `generateValue: true` 由平台随机生成；**换掉它会让所有已登录会话立即失效**。

## 8. 日常操作

```bash
git push                # 推 main 即自动重新部署（autoDeploy: true）
```

- 回滚：Render 控制台 → 该服务 → Deploys → 选上一个成功的 Deploy → Rollback。
- 改环境变量：Render 控制台 → Environment → 保存后会自动重启（不需要重新构建）。
- 导出线上数据：在本地用 Neon 的 Connection string 跑 `pnpm db:migrate` 之外的操作前，
  先确认连的是哪套库（`DATABASE_URL` 指向 Neon 而不是本机 55433）。
