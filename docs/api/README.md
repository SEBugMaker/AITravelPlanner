# API 合同文档

- `GET /api/health`：系统健康检查，返回运行状态与时间戳。
- `POST /api/itineraries`：根据旅行偏好生成行程计划，支持可选持久化到 Supabase。
	- Request
		```json
		{
			"destination": "东京",
			"days": 5,
			"budgetCNY": 10000,
			"companions": 3,
			"interests": ["美食", "亲子"],
			"persist": true,
			"userId": "uuid"
		}
		```
	- Response
		```json
		{
			"plan": { "overview": "...", "dayPlans": [ { "day": 1, "summary": "..." } ], "estimatedTotal": 10000 },
			"source": "llm",
			"note": null
		}
		```
- `POST /api/budget`：输入行程和偏好，输出预算拆分。
	- Request
		```json
		{
			"plan": { "overview": "...", "estimatedTotal": 9800, "dayPlans": [] },
			"preferences": { "destination": "东京", "days": 5, "budgetCNY": 10000, "companions": 3, "interests": [] }
		}
		```
- `POST /api/expenses`：记录实际消费，写入 `expense_records` 表。
	- Request
		```json
		{
			"itineraryId": "uuid",
			"amount": 320,
			"currency": "CNY",
			"category": "dining",
			"note": "筑地市场早餐"
		}
		```

> 如需正式运行，需要在 Supabase 中创建 `itineraries` 与 `expense_records` 表结构。后续会补充表结构迁移脚本。
