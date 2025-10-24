# AI Travel Planner

> 借助大语言模型、语音交互与地图服务，帮助用户快速制定个性化旅行计划并实时管理行程与预算。

## � 快速开始 — 拉取并运行预构建 Docker 镜像

以下步骤可帮助你在本地快速拉取并运行项目的预构建镜像（例如：GHCR 上的 v2.2.1）。这些命令可直接复制到 macOS/zsh 终端执行。

1) 登录 GitHub Container Registry（如果仓库或包为私有，需要认证）

```bash
# 使用 GitHub Personal Access Token（需包含 read:packages 权限）
echo "YOUR_GH_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

2) 拉取镜像

```bash
docker pull ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
```

3) 以后台容器运行（示例：映射到本地 3000 端口）

镜像通常需要运行时环境变量（Supabase、LLM、地图与语音服务等）。推荐把运行时密钥放到 `docker/runtime.env`（仓库中提供 `docker/runtime.env.example`），然后通过 `--env-file` 注入：

```bash
cp docker/runtime.env.example docker/runtime.env
# 编辑 docker/runtime.env，填写实际密钥（不要提交到 Git）

docker run -d --name ai-travel-v2.2.1 -p 3000:3000 --env-file docker/runtime.env \
   ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
```

示例 `docker/runtime.env` 应至少包含（示例占位符）：

```ini
# Supabase
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your_anon_key"
SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"

# 高德地图
# NOTE: `NEXT_PUBLIC_AMAP_KEY` 会在构建时内联到前端（若使用预构建镜像请确保镜像已使用正确的前端 key 构建）
NEXT_PUBLIC_AMAP_KEY="<your-web-js-key>"
AMAP_REST_KEY="<your-rest-key>"
NEXT_PUBLIC_AMAP_SECURITY_JS_CODE="<optional-js-security-code>"

# LLM / 语音等
LLM_API_KEY="..."
XFYUN_APP_ID="..."
XFYUN_API_KEY="..."
XFYUN_API_SECRET="..."
```

重要说明：

- `NEXT_PUBLIC_AMAP_KEY` 是前端用的 Web（JS API）Key，会在构建阶段内联到前端 bundle；如果你仅运行已拉取的镜像并在运行时修改 `NEXT_PUBLIC_AMAP_KEY`，不会改变已内联的前端 bundle。若需要更改前端 key，必须在构建阶段传入正确值并重新构建镜像。
- `AMAP_REST_KEY` 应仅在后端使用，切勿把 REST Key 写入前端公开变量或 Release 描述。

本仓库为 pnpm monorepo，开发时可在源码运行前端（热重载）而无需构建镜像：

```bash
# 安装依赖
pnpm install

# 在开发模式下仅运行 web 应用（本地调试前端）
pnpm --filter web dev
```

若要本地构建镜像（在需要把 NEXT_PUBLIC_* 内联到前端时）：

```bash
# 在根目录使用 Docker 构建镜像并传入前端需要的 build-args
docker build \
   --build-arg NEXT_PUBLIC_AMAP_KEY="<your-web-js-key>" \
   --build-arg NEXT_PUBLIC_AMAP_SECURITY_JS_CODE="<optional-js-security-code>" \
   -t ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1 .

# 然后推送到 GHCR（需登录）
docker push ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
```

如果你在 Apple Silicon 上看到平台不匹配警告，可以在运行时指定平台：

```bash
docker run -d --platform linux/amd64 --name ai-travel-v2.2.1 -p 3000:3000 \
   --env-file docker/runtime.env \
   ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
```

4) 查看容器日志

```bash
docker logs -f ai-travel-v2.2.1
```

快速故障排查
- 拉取失败（EOF / authentication required）：请先执行 `docker login ghcr.io`，确保 PAT 拥有 `read:packages` 权限并使用正确的用户名。
- 平台不匹配警告（arm64 vs amd64）：在 Apple Silicon 上可能看到警告，若需要可加 `--platform linux/amd64`（会用到 QEMU，性能较慢）：

```bash
docker run -d --platform linux/amd64 --name ai-travel-v2.2.1 -p 3000:3000 \
   ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
```

- 容器启动但提示 Supabase Key 缺失：按上面示例注入 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 环境变量。
- Node/undici TLS 错误（DEPTH_ZERO_SELF_SIGNED_CERT）：表示访问的服务使用自签名证书，需要在宿主机信任对应 CA，或在开发环境短期使用 `NODE_TLS_REJECT_UNAUTHORIZED=0`（不推荐用于生产）。

---


## �🔍 项目概览
AI Travel Planner 针对“难以快速做出行程决策、缺乏实时调整能力、预算管理困难”等痛点，提供从需求采集、行程生成到费用跟踪的一体化体验。用户能够通过语音或文字描述旅行偏好，系统自动生成包含交通、住宿、景点、美食的详细行程，并结合预算分析和云端同步，实现跨设备、多人协作的旅行规划。

## ✨ 核心功能
- **智能行程规划**：语音/文字输入旅行要求，LLM 输出包含每日安排、交通建议、餐饮与活动推荐的行程。
- **费用预算与追踪**：结合行程自动估算预算，并允许用户通过语音快速记录支出，实时对比预算与实际花费。
- **用户账户与云端同步**：支持注册登录、偏好保存、行程多版本管理，数据存储在云端并支持多人协作或家庭账户。
- **实时旅行辅助**：整合地图导航（步行/驾车/公共交通）、天气与突发通知，为在途用户提供提醒与替补方案。

## 🧱 系统架构与技术栈
| 模块 | 技术选择 | 说明 |
| --- | --- | --- |
| 前端框架 | **Next.js 14 (App Router) + TypeScript** | 提供 SSR/静态生成能力和灵活的路由。 |
| UI 方案 | Tailwind CSS、Headless UI、Radix UI、Mapbox GL 风格组件 | 快速构建一致的响应式界面；地图容器与自定义标记。 |
| 状态管理 | TanStack Query + Zustand | 处理服务端数据缓存、全局状态及离线场景。 |
| 语音识别 | 阿里云智能语音识别（实时流式）或科大讯飞开放平台 | 提供语音转文字能力；WebRTC/Recorder.js 采集音频。 |
| 语音播报（可选） | 阿里云智能语音合成 | 为行程播报与提醒提供 TTS。 |
| 地图导航 | 高德地图 JS API + Web 服务 API | 获取地点搜索、路线规划、实时导航信息。 |
| 身份认证 | Supabase Auth（邮箱/手机号/第三方） | 即开即用、无后台即可完成用户体系。 |
| 数据存储 | Supabase Postgres + Row Level Security | 存储用户、行程、预算、语音记录；细粒度权限控制。 |
| 实时能力 | Supabase Realtime Channel / Edge Functions | 行程协作、费用同步、通知推送。 |
| 行程规划 LLM | 阿里云百炼平台通义千问 API（或自有 LLM 服务） | 进行行程规划、预算估算、补充说明。 |
| 后端 API | Next.js Route Handlers + Edge Functions | 负责 LLM 调用、地图代理、费用计算等；可扩展成独立微服务。 |
| 任务编排 | Temporal（可选）或基于 Supabase Edge Function 的 Cron | 处理行程提醒、预算监控等计划任务。 |
| 监控日志 | Logto + Sentry（前后端） | 请求追踪、错误报警。 |
| 部署与容器 | Docker + GitHub Actions + 阿里云容器镜像服务 (ACR) | 自动构建镜像并推送到阿里云；支持 ECS/ACK/EasyOps 部署。 |

### 关键外部服务与准备
- **阿里云账号**：百炼大模型、语音识别、语音合成、容器镜像服务。
- **高德开放平台账号**：Web JS API、Web 服务 API、地理编码/路径规划。
- **Supabase 项目**：Auth、Database、Storage、Edge Functions。
- **对象存储（可选）**：阿里云 OSS，用于存放音频、导出的行程 PDF。

## 🗂️ 当前仓库结构
```
AITravelPlanner/
├── apps/
│   └── web/                  # Next.js App Router + API routes + Tailwind
│       ├── app/
│       │   ├── api/          # Route Handlers（示例 health check）
│       │   ├── layout.tsx
│       │   └── page.tsx
│       ├── lib/              # Supabase/LLM 等客户端封装
│       ├── types/
│       ├── public/
│       └── tailwind.config.ts
├── packages/
│   ├── core/                 # 行程规划与预算算法骨架（TypeScript lib）
│   └── ui/                   # 共享 UI 组件（Button 等）
├── supabase/                 # 迁移脚本、Edge Functions 占位
├── infra/
│   ├── docker/               # Dockerfile、docker-compose 样板
│   └── github/               # GitHub Actions 工作流样板
├── docs/
│   ├── architecture/
│   ├── api/
│   └── submissions/
├── package.json              # pnpm workspace 根配置
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

## 🧩 后端 API 概览
- `GET /api/health`：健康检查。
- `POST /api/itineraries`：根据旅行偏好调用 LLM（或内建回退策略）生成行程，可选保存到 Supabase `itineraries` 表。
- `POST /api/budget`：结合行程与偏好输出预算拆分，适用于预算面板。
- `POST /api/expenses`：记录实际支出，写入 Supabase `expense_records` 表。
- `POST /api/speech/xfyun`：代理科大讯飞语音识别 API（HMAC 鉴权），接收 Base64 编码的 PCM 音频并返回识别文本。

> 若需启用持久化，请在 Supabase 中创建 `itineraries` 与 `expense_records` 表（字段参考 `docs/api/README.md` 示例），并在 `.env` 中配置 `SUPABASE_SERVICE_ROLE_KEY`。

## 🚀 开发里程碑与后续步骤
1. **基础设施搭建（Week 1）**
   - 初始化 Monorepo（pnpm workspace），配置 lint/format/test pipeline。
   - 搭建 Next.js + Tailwind + Supabase Auth 最小可运行版本，完成登录/初始化表结构。
   - 完成基础 UI 骨架：导航栏、仪表盘、行程时间线、地图容器。
2. **核心功能迭代（Week 2-3）**
   - 接入语音识别与文字输入共用的需求采集表单。
   - 封装 LLM 规划服务：提示词模板、函数调用、行程结构化输出。
   - 设计预算数据模型，完成自动预算估算与费用记录接口。
   - 地图联动：将行程日程与地图位置串联，支持路线可视化和导航跳转。
3. **增强与协作（Week 4）**
   - 引入实时协作（Supabase Realtime）实现多人共享行程与同步更新。
   - 实现行程提醒/异常天气通知（定时任务 + 推送策略）。
   - 完善移动端适配、离线缓存与行程导出（PDF/日历订阅）。
4. **部署与交付（Week 5）**
   - 编写 Dockerfile、docker-compose、环境变量模板。
   - 配置 GitHub Actions：CI（lint/test/build）、CD（打包镜像推送至 ACR）。
   - 输出 README、架构文档、API 文档，并生成含仓库链接与 README 的 PDF。
   - 提交演示视频/截图，准备演示账户与测试环境。

## 🛠️ 本地开发环境准备
- Node.js 20.x、pnpm 9.x。
- Supabase CLI（用于本地仿真数据库、迁移). 
- 阿里云/高德平台的测试 API Key（本地通过 `.env.local` 注入）。
- 推荐安装 ffmpeg（语音处理、音频格式转换）。

### 环境变量约定
在项目根目录创建 `.env`（用于 Docker）与 `apps/web/.env.local`（用于本地开发）。Docker 运行时可直接复制 `docker/runtime.env.example`，填入实际值后通过 `--env-file` 注入。示例如下：

```dotenv
# Supabase
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="supabase-anon-key"
SUPABASE_SERVICE_ROLE_KEY="service-role-key"

# 阿里云百炼
LLM_ENDPOINT="https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
LLM_API_KEY="${AILIYUN_BAILIAN_KEY}"
LLM_MODEL_NAME="qwen-plus"

# 语音识别/合成
ALIYUN_SPEECH_APP_ID=""
ALIYUN_SPEECH_ACCESS_KEY_ID=""
ALIYUN_SPEECH_ACCESS_KEY_SECRET=""
ALIYUN_TTS_VOICE="xiaoyun"
XFYUN_APP_ID=""
XFYUN_API_KEY=""
XFYUN_API_SECRET=""
XFYUN_DOMAIN="iat"
XFYUN_DEBUG="0"

# 高德地图
NEXT_PUBLIC_AMAP_KEY=""
AMAP_REST_KEY=""

# 费用管理配置
DEFAULT_CURRENCY="CNY"
EXCHANGE_RATE_API="https://open.er-api.com/v6/latest"

# 运行配置
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

> ⚠️ 所有 API Key 必须存放在环境变量或运行时输入界面，严禁提交到 Git 历史。

### 科大讯飞语音识别调试指南
1. **确认已开通服务**：登录讯飞开放平台 →「控制台」→「实时语音听写（流式版）」确认应用状态为启用，并记下页面展示的领域 `domain`（默认 `iat`）。如看到 “no category route found” 日志，通常意味着账户未开通对应模型或 `domain` 填写错误。
2. **配置环境变量**：在 `.env.local` 中填写 `XFYUN_APP_ID`、`XFYUN_API_KEY`、`XFYUN_API_SECRET` 以及 `XFYUN_DOMAIN`。若使用官方默认模型可保留 `iat`，否则需改为控制台显示的字符串。
3. **启用调试日志**：本地排查时可执行 `XFYUN_DEBUG=1 pnpm --filter web dev`，后端会输出 `收到识别片段`、`WebSocket 关闭` 等详细日志。部署环境记得将 `XFYUN_DEBUG` 还原为 `0` 避免产生冗余日志。
4. **校验请求参数**：本项目已自动使用官方 WebSocket 入口 `wss://iat-api.xfyun.cn/v2/iat` 并发送 16kHz 单声道 PCM (`audio/L16;rate=16000`)。如需更高采样率或自定义编码，可在 `apps/web/hooks/useSpeechRecognition.ts` 与 `apps/web/app/api/speech/xfyun/route.ts` 中同步调整。
5. **常见错误指引**：
   - `INVALID_REQUEST`：前端未获取到有效音频，请检查浏览器录音权限。
   - `no category route found`：确认服务已开通，并核对 `XFYUN_DOMAIN`。
   - WebSocket 超时或 4xx：通常是鉴权签名错误，重新核对 key、secret 是否匹配同一控制台应用。

## ▶️ 运行与调试
```bash
pnpm install
pnpm --filter web dev
```
- 若本地未安装 pnpm，可执行 `corepack enable` 后重试。
- 首次运行前执行 `supabase start` 以启动本地数据库与 Edge Functions 仿真。
- 通过 `pnpm lint`、`pnpm test`（规划使用 Vitest + Testing Library）确保代码质量。
- 可使用 `curl`/`Postman` 调用 `POST /api/itineraries` 与 `POST /api/budget` 调试后端逻辑（详见 `docs/api/README.md`）。

## 🧪 测试策略
- **单元测试**：核心算法（行程规划结果解析、预算计算）使用 Vitest 覆盖。
- **集成测试**：使用 Playwright 对主要用户流程（创建行程、记录支出、地图查看）进行端到端测试。
- **可观测性**：Sentry 捕获异常，Vercel Analytics/阿里云 ARMS 用于性能监控。

## 🐳 Docker 支持
- 根目录 `Dockerfile`：GitHub Actions 使用该文件构建并推送镜像到 GHCR。
- `docker/runtime.env.example`：运行容器时的环境变量模板（不含引号，复制为 `docker/runtime.env` 后填写）。

运行预构建镜像：
```bash
cp docker/runtime.env.example docker/runtime.env
# 修改 docker/runtime.env，填入 Supabase、LLM、AMap、讯飞等密钥

docker pull ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
docker run --env-file docker/runtime.env -p 3000:3000 ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
```

如需本地构建，可显式指定构建时的公开环境变量：
```bash
docker build \
   --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
   --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
   --build-arg NEXT_PUBLIC_AMAP_KEY=... \
   --build-arg NEXT_PUBLIC_AMAP_SECURITY_JS_CODE=... \
   -t aitravelplanner:local .
```
服务器端密钥（Supabase Service Role、LLM、AMap REST、讯飞等）必须在运行阶段通过 `--env-file` 或 `-e` 注入，镜像层中不要保存这些值。若 CI 过程中需要使用密钥，可在 Docker BuildKit 下使用 `RUN --mount=type=secret` 暂时读取，避免写入镜像层。详细示例见 `docs/architecture/overview.md` 的部署章节。

## 🔄 CI/CD 与部署
- **CI**：GitHub Actions 执行 `pnpm lint`、`pnpm test`、`pnpm build`，缓存 pnpm store。
- **CD**：当推送 `main` 时自动构建 Docker 镜像，推送至阿里云容器镜像服务（ACR）。
- **部署**：推荐在阿里云 ECS/ACK 上运行容器，或使用 Vercel + Supabase（考虑语音/地图域名限制）。
- **密钥管理**：使用 GitHub Actions Encrypted Secrets 注入阿里云/地图/Supabase 密钥。

## 🔐 安全与合规
- 前端提供“API Key 管理”页面，允许助教在演示环境中输入/更新 key。
- 使用 Supabase RLS 保护用户数据，所有行程、费用记录与用户关联。
- 加强日志脱敏，避免在日志中输出 key、敏感旅程信息。
- 对外 API 调用增加速率限制与错误回退策略，保证稳定性。
- CI/CD 及容器构建阶段不得长久保存敏感密钥，推荐使用 Docker BuildKit Secret 或部署平台的 Secret Manager 在运行时注入。

## 📄 提交与验收说明
1. 代码托管在 GitHub，保持细粒度提交记录。
2. README 与相关文档打包成 PDF（`docs/submissions/AITravelPlanner.pdf`），内含仓库链接与关键说明。
3. 提供可运行的 Docker 镜像：
   - 可选：在 GitHub Releases 或阿里云镜像仓库提供 `latest` 标签。
   - README 中列出镜像拉取与运行命令。
4. 若未使用阿里云 key，请在 README 中写明第三方 key（确保 3 个月有效）。

## 🤝 贡献指南
- 使用 Conventional Commits，示例：`feat: add itinerary generator`。
- 提交前执行 `pnpm lint` 与 `pnpm test`。
- 对核心功能变更补充文档与测试。

## 📜 License
本项目采用 [MIT License](./LICENSE)。

## GitHub 与贡献

GitHub 仓库： https://github.com/SEBugMaker/AITravelPlanner

欢迎在仓库中提交 Issue、PR 或在 Releases 下留下反馈。贡献前请阅读 `CONTRIBUTING.md`，其中包含分支、提交信息规范与 PR 模板说明。
