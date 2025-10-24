# 架构概览

AI Travel Planner 采用「前后端一体的 Next.js 应用 + Supabase 后端服务」模式，配合第三方 AI/地图能力快速实现旅行规划、预算管理与语音交互。本文件对核心组件、数据流、部署方式以及安全控制进行说明。

## 总体拓扑

```
[Browser] ──HTTPS──> [Next.js App (apps/web)] ──HTTPS──> [Supabase REST / RPC]
		│                               │
		│                               ├─> [阿里云百炼 LLM]
		│                               ├─> [高德地图 Web 服务]
		│                               └─> [讯飞语音识别 WebSocket]
		│
		└─WebSocket──> [Supabase Realtime]
```

- **前端 (App Router)**：负责页面渲染、行程编辑、地图展示、语音录制。通过 `@supabase/auth-helpers-nextjs` 维护会话，借助 TanStack Query 调度 API。
- **Route Handlers**：充当 BFF 层，聚合外部服务、执行业务校验、写入数据库。关键逻辑位于 `apps/web/app/api/*`。
- **Supabase**：提供认证、Postgres、存储及 Realtime 渠道，用于持久化行程、费用、偏好。
- **第三方服务**：阿里云百炼 (LLM)、高德地图（地点 & 路径）、讯飞语音识别（实时听写）。

## 核心模块说明

### 1. 行程规划服务
- 入口：`POST /api/itineraries`
- 逻辑：
	1. 使用 Zod 校验用户偏好。
	2. 读取运行时环境变量 `LLM_ENDPOINT`、`LLM_API_KEY`、`LLM_MODEL_NAME`；组织提示词调用阿里云百炼。
	3. 对响应进行冗余解析（内置多种 JSON 解析策略 + fallback）。
	4. 可选持久化行程到 `itineraries` 表，需使用 Service Role Key。
- 特点：Route Handler 既可部署在 Node.js（默认）也可迁移到 Edge Runtime；上游异常会附带 traceId 写入日志与前端 toast。

### 2. 预算管理
- 入口：`POST /api/budget`
- 逻辑：调用 `packages/core` 算法库，根据行程和偏好拆分预算；支持自定义汇率来源。
- 数据持久化：预算结果暂存于行程对象；重复调用时使用缓存（待实现）。

### 3. 地图与定位
- 前端：`PlannerMap` 组件使用高德 JS SDK，在浏览器渲染坐标点、路线。
- 后端：`POST /api/location` 通过高德 REST 接口进行逆地理编码、模糊搜索，避免在前端暴露 REST key。
- 安全：REST key 仅在服务端使用，地图 JS key 作为 `NEXT_PUBLIC_AMAP_KEY` 注入，可配合 referer 白名单。

### 4. 语音识别链路
- 录音：前端使用 Web Audio/MediaRecorder 采集 16kHz PCM，分片上传。
- 代理：`POST /api/speech/xfyun` 与讯飞 WebSocket 握手，负责 HMAC 鉴权、心跳与重试。
- 回传：识别结果实时推送给前端；若启用 `XFYUN_DEBUG=1` 会在日志中输出原始分片。

### 5. 数据模型
- `itineraries`：存储行程 JSON、目的地、各日安排。
- `expense_records`：关联行程的消费明细，支撑预算对比。
- 关联：通过 Supabase RLS 确保用户只能访问自己的数据；Service Role Key 用于后台任务（如批处理）需谨慎管理。

## 环境与部署

### 本地开发
- `pnpm --filter web dev` 启动 Next.js；`supabase start` 启动本地 Postgres & Realtime。
- `.env.local` 管理前端开发密钥，严禁提交到仓库。

### Docker 构建
- 多阶段 Dockerfile：`builder` 安装依赖并 `pnpm --filter web build`，`runner` 仅保留产物与依赖。
- 推荐做法：
	1. 公开变量（`NEXT_PUBLIC_*`）仍通过 `--build-arg` 注入；
	2. 私密变量使用 Docker BuildKit Secret：`RUN --mount=type=secret,id=runtime_env ... source /run/secrets/runtime_env`；
	3. 运行镜像时，使用 `docker run --env-file docker/runtime.env` 注入最终环境变量；
	4. 若在 Kubernetes/Serverless，利用平台 Secret Manager（例如 AWS Secrets Manager、阿里云 KMS）。
- 构建产物推送至 GHCR，tag 按照语义化版本（例如 `v2.2.1`）。

### CI/CD 流程
1. **Lint/Test**：GitHub Actions `pnpm lint`、`pnpm --filter web build` 确保质量。
2. **Docker 构建**：使用 `docker buildx build` 并挂载 Secret；完成后推送至 `ghcr.io/<org>/ai-travel-planner`。
3. **发布**：创建 Release Tag 触发工作流，产出镜像与 tar 包 Artifact。
4. **部署**：
	 - 轻量：直接 `docker run` + `--env-file`；
	 - 云原生：Helm Chart / Kustomize，挂载 Secrets ConfigMap；
	 - Serverless：可将 Route Handler 拆分至 Supabase Edge Functions 或 Cloudflare Workers。

### 安全要点
- **密钥管理**：Supabase Service Role、LLM API Key、AMAP REST Key、讯飞 Secret 都属于高敏级别，不得写入镜像或 git 历史。
- **日志脱敏**：后端日志避免输出关键信息，可使用 `console.warn` + 白名单字段。
- **RLS**：确保存取行程和费用的请求带有 `auth.uid()`；后台任务使用 Service Role 时需额外校验。
- **限流与重试**：对 LLM、地图、语音接口设置重试与熔断策略，避免外部服务突发失败导致连锁异常。

## 后续规划
- 绘制详细的时序图（语音 → LLM → 行程保存）、部署图（多区域容灾）。
- 引入消息队列（例如 Supabase Queue 或 RabbitMQ）用于处理长耗时任务、行程提醒。
- 结合 Observability（OpenTelemetry + Sentry）实现端到端跟踪。

> 若对架构有新的设计或替换方案，更新本文档以保持团队同步。
