# API 合同文档

本文档记录 `apps/web` 中暴露的 Next.js Route Handlers 接口，包括用途、请求/响应示例以及外部依赖，便于前后端协作与第三方集成。

## 认证与通用约定

## 🚀 快速开始 — 使用预构建 Docker 镜像进行 API 测试

欲快速在本地测试 API，可以直接拉取并运行项目的预构建镜像。更多完整步骤见仓库根目录 `README.md`。

示例：

```bash
# 如果仓库为私有，请先登录 GHCR
echo "YOUR_GH_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

docker pull ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.0.2

docker run -d --name ai-travel-api -p 3000:3000 \
	-e NEXT_PUBLIC_SUPABASE_URL="https://your-supabase-url.supabase.co" \
	-e NEXT_PUBLIC_SUPABASE_ANON_KEY="your_anon_key_here" \
	ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.0.2

# 然后通过 curl/postman 调用 API
curl http://localhost:3000/api/health
```


| 项目 | 约定 |
| --- | --- |
| 认证方式 | 采用 Supabase Auth，前端携带 `supabase.auth.session()` 返回的 `access_token` 写入 `Authorization: Bearer <token>`；部分内部接口允许服务端凭证调用。 |
| 数据格式 | 默认 `application/json`，响应也为 JSON；文件/音频上传使用 `multipart/form-data`。 |
| 时区 | 全部以 `UTC+8` 处理，前端显示时再根据用户设置转换。 |
| 错误响应 | 统一结构 `{ "error": { "code": string, "message": string, "details"?: unknown } }`，HTTP Status 与 `code` 保持一致。 |

## 接口总览

| Method | Path | 权限 | 描述 |
| --- | --- | --- | --- |
| GET | `/api/health` | 公共 | 健康检查，返回服务状态和时间戳。 |
| POST | `/api/itineraries` | 需要登录（可选持久化） | 根据旅行偏好调用 LLM 生成行程；可将结果写入 Supabase。 |
| POST | `/api/itineraries/save` | 登录用户 | 将行程草案保存至数据库，供多人协作和后续编辑。 |
| POST | `/api/itineraries/from-text` | 登录用户 | 将用户提供的游记/文本解析为结构化行程。 |
| POST | `/api/itineraries/from-transcript` | 登录用户 | 上传语音转文字结果，生成行程。 |
| POST | `/api/budget` | 登录用户 | 根据行程及偏好计算预算拆分，输出住宿/交通/餐饮等明细。 |
| POST | `/api/expenses` | 登录用户 | 记录实际支出，并写入 `expense_records` 表。 |
| POST | `/api/location` | 登录用户 | 通过高德 REST API 进行地点检索与地理编码。 |
| POST | `/api/speech/xfyun` | 登录用户 | 代理讯飞实时语音识别 API，处理音频分片并返回识别文本。 |

以下为关键接口的请求/响应示例，其他接口可参照同类结构（详见 `apps/web/app/api` 目录）。

### `GET /api/health`

```jsonc
// Response 200
{
	"status": "ok",
	"timestamp": "2024-10-01T12:00:00.000Z",
	"commit": "<git sha>",
	"env": "production"
}
```

### `POST /api/itineraries`

```jsonc
// Request
{
	"destination": "东京",
	"days": 5,
	"budgetCNY": 10000,
	"companions": 3,
	"interests": ["美食", "亲子"],
	"persist": true,
	"userId": "00000000-0000-0000-0000-000000000001"
}

// Response 200
{
	"plan": {
		"overview": "三口之家东京 5 日文化与美食深度游",
		"estimatedTotal": 9800,
		"dayPlans": [
			{
				"day": 1,
				"summary": "抵达东京，入住浅草酒店，夜游晴空塔",
				"highlights": ["晴空塔", "浅草寺"],
				"locations": [
					{ "name": "东京晴空塔", "longitude": 139.8107, "latitude": 35.7100 }
				]
			}
		]
	},
	"source": "llm",
	"note": null
}
```

> 如果 `persist` 为 `true` 且当前会话携带有效 access token，接口会使用 `SUPABASE_SERVICE_ROLE_KEY` 写入 `itineraries` 表，并返回 `itineraryId`。

### `POST /api/budget`

```jsonc
// Request
{
	"plan": { "overview": "东京五日游", "estimatedTotal": 9800, "dayPlans": [] },
	"preferences": {
		"destination": "东京",
		"days": 5,
		"budgetCNY": 10000,
		"companions": 3,
		"interests": []
	}
}

// Response 200
{
	"currency": "CNY",
	"total": 9680,
	"breakdown": {
		"accommodation": 4200,
		"transportation": 1800,
		"dining": 2200,
		"activities": 1200,
		"buffer": 280
	}
}
```

### `POST /api/expenses`

```jsonc
// Request
{
	"itineraryId": "00000000-0000-0000-0000-000000000001",
	"amount": 320,
	"currency": "CNY",
	"category": "dining",
	"note": "筑地市场早餐"
}

// Response 200
{
	"id": "00000000-0000-0000-0000-0000000000aa",
	"itineraryId": "00000000-0000-0000-0000-000000000001",
	"amount": 320,
	"currency": "CNY",
	"category": "dining",
	"note": "筑地市场早餐",
	"createdAt": "2024-10-01T13:05:00.000Z"
}
```

### `POST /api/speech/xfyun`

```http
POST /api/speech/xfyun
Content-Type: multipart/form-data; boundary=---

---form
Content-Disposition: form-data; name="chunk"; filename="speech.pcm"
Content-Type: audio/L16

<binary>
---form--

// Response 200
{
	"text": "请为明天的东京迪士尼安排交通和餐饮",
	"confidence": 0.92
}
```

当讯飞接口返回错误时，API 会透传提示信息，并附带 `traceId` 便于日志查询。

## 依赖的环境变量

| 名称 | 说明 | 使用位置 |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端写入/查询 `itineraries`、`expense_records` | `apps/web/lib/supabaseAdmin.ts`、`/api/itineraries`、`/api/expenses` |
| `LLM_ENDPOINT` / `LLM_API_KEY` / `LLM_MODEL_NAME` | 调用阿里云百炼 API 生成行程 | `/api/itineraries`、`/api/itineraries/from-text` |
| `AMAP_REST_KEY` | 高德地点检索和路线规划 | `/api/location`、`planner-map` 组件回退逻辑 |
| `XFYUN_APP_ID` / `XFYUN_API_KEY` / `XFYUN_API_SECRET` / `XFYUN_DOMAIN` | 讯飞实时语音识别 | `/api/speech/xfyun` |
| `NEXT_PUBLIC_*` | 前端公开变量 | `planner-map`, Supabase Browser Client |

确保上述变量在部署环境中正确注入，并遵循 README 中的安全建议：密钥只在运行阶段以环境变量方式提供，不要写入仓库或公开镜像。

## Supabase 表结构（简化）

```sql
create table public.itineraries (
	id uuid primary key default gen_random_uuid(),
	user_id uuid references auth.users(id),
	destination text,
	plan jsonb,
	created_at timestamptz default now()
);

create table public.expense_records (
	id uuid primary key default gen_random_uuid(),
	itinerary_id uuid references public.itineraries(id) on delete cascade,
	amount numeric(12,2),
	currency text default 'CNY',
	category text,
	note text,
	created_at timestamptz default now()
);

alter table public.itineraries enable row level security;
alter table public.expense_records enable row level security;
```

> RLS 策略建议：仅允许 `auth.uid() = user_id` 的用户访问对应数据；对于 Service Role Key 调用可附带 `supabaseAdmin` 模式绕过限制但仅用于受信任务。

## 错误码约定

| code | http | 描述 |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | 未携带或携带失效的 Supabase JWT。 |
| `VALIDATION_ERROR` | 422 | 请求体未通过 Zod 校验，`details` 包含具体字段。 |
| `LLM_UPSTREAM_ERROR` | 502 | 调用 LLM 上游失败，日志中会包含 `traceId`。 |
| `MAP_QUOTA_EXCEEDED` | 429 | 高德接口配额耗尽或被限流。 |
| `SPEECH_RECOGNITION_ERROR` | 502 | 讯飞 WebSocket 返回异常。 |
| `DATABASE_ERROR` | 500 | Supabase 服务端错误。 |

如需扩展接口，请保持上述响应格式，并在此文档补充说明。
