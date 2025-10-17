# Supabase Notes

- `migrations/`: 用于存放 Supabase SQL 迁移脚本（通过 `supabase db diff`/`db push` 生成）。
- `functions/`: Supabase Edge Functions 与定时任务代码。
- 建议通过 `supabase/config.toml` 配置项目参数，后续初始化时可添加。

## 运行迁移并修复 `PGRST205`

若调用接口时出现 `PGRST205: Could not find the table 'public.itineraries' in the schema cache`，说明数据库尚未创建 `itineraries` / `expense_records` 表。解决步骤：

1. 安装并登录 Supabase CLI。
2. 在项目根目录执行：
	```bash
	supabase db push
	```
	或者在 Supabase 控制台的 SQL Editor 中运行 `migrations/20241016000000_create_itinerary_tables.sql`。
3. 确认两张表已在 Supabase Dashboard 的 Database → Tables 中创建，再次调用接口即可持久化行程与消费记录。

> 表结构说明：`itineraries` 保存模型生成的行程与偏好 JSON，`expense_records` 用于记录对应行程的消费流水。
