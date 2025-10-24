# 贡献指南（CONTRIBUTING）

感谢你愿意为 AI Travel Planner 贡献代码、文档或测试！请在开始前阅读下面的流程与规范，能帮助我们更快速地审查你的变更。

## 基本流程
1. Fork 本仓库并创建 feature 分支（基于 `main`）：
   - 分支命名示例：`feat/itinerary-generator`、`fix/secrets-sanitize`。
2. 本地运行测试与 lint：
   - `pnpm install`
   - `pnpm --filter web dev`（开发）
   - `pnpm lint`、`pnpm test`
3. 提交遵循 Conventional Commits：
   - 示例：`feat: add geocoding proxy`、`fix(secrets): sanitize amapWebKey before returning to client`。
4. 提交 PR 至 `main`，并在 PR 描述中提供复现步骤与测试说明。

## 代码风格与质量
- 使用 TypeScript 严格模式（项目已配置 `tsconfig.base.json`）。
- 前端样式使用 Tailwind；提交样式相关改动时请尽量复用现有类。
- 代码需包含单元测试或说明为何不需要；重要逻辑变更要求添加对应集成测试。

## 安全与密钥
- 任何涉及 Key 的变更不得把真实密钥写入代码或示例配置（使用占位符或 `.env.example`）。
- 若需要对 `AMAP_REST_KEY` / `NEXT_PUBLIC_AMAP_KEY` 做操作，请在 PR 中说明你做了哪些 sanitize/防护措施。

## PR 合并规则
- 所有 PR 至少需要一名 reviewer 批准，且 CI (lint/test/build) 需通过。
- 对关键安全修复或发布相关更改建议先在 issue 中讨论并 @maintainers 标记。

## 联系维护者
- 在 GitHub Issues 中创建 Issue，或在 PR 中 @ 指定维护者团队。
