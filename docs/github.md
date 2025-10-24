# GitHub 操作指南

本文档侧重在 GitHub 侧的操作，包括 Releases、Actions Secrets、GHCR 权限与常见问题的处理流程（配合 `docs/release.md`）。

## Releases（发布）

```
镜像：ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
Pull: docker pull ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
Run: docker run --rm -p 3000:3000 ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
```

## GitHub Actions Secrets
- 在仓库 Settings -> Secrets -> Actions 中添加下列 secrets：
  - `GHCR_PAT`（如果需要在 workflow 中登录 ghcr，或使用 `GITHUB_TOKEN` 视可见性而定）
  - `NEXT_PUBLIC_AMAP_KEY`（Web-JS key，用于静态构建时内联）
  - `AMAP_REST_KEY`（后端 REST key，注意不应被用作 `NEXT_PUBLIC_*`）
  - 其它服务密钥（Supabase、LLM、讯飞等）

校验建议：在构建前的 workflow 步骤中比较 `NEXT_PUBLIC_AMAP_KEY` 与 `AMAP_REST_KEY`，若相同则终止构建并告警，避免把 REST Key 内联进前端 bundle。

## GHCR（GitHub Container Registry）权限
- 若仓库为公开，则镜像可被匿名 pull；若为私有，请确认目标用户已被授予 read:packages 权限或使用 PAT 登录。
- 若使用 `GITHUB_TOKEN` 推送镜像，可在 Actions 中直接执行 `docker/login-action` 与 `docker/build-push-action`。

## 常见问题与排查
- 问：前端加载 AMap 报 `USERKEY_PLAT_NOMATCH`，为什么？
  - 答：通常是前端使用了 REST key。请检查：
    1. Actions 与 Docker 构建时传入的 `NEXT_PUBLIC_AMAP_KEY` 是否正确；
    2. 仓库 Secrets 中是否有误把 REST key 写到了 `NEXT_PUBLIC_AMAP_KEY`；
    3. 数据库中 `amapWebKey` 是否被误写入 REST key（检查并清理）。

- 问：如何在 Release 中保证不泄露密钥？
  - 答：Release 描述只放镜像引用与运行示例，切勿 paste 任何 secrets；若需要向测试人员共享 key，请使用私有渠道（Vault、临时 PAT、临时 env 文件等）。

## 自动化建议
- 在 workflow 中加入以下关键步骤：
  1. 构建前校验 `NEXT_PUBLIC_AMAP_KEY` 与 `AMAP_REST_KEY` 不相同；
  2. 使用 `docker/build-push-action` 推送 GHCR；
  3. 使用 `actions/create-release` 或 `gh release` 在 GitHub 上生成 Release 并把镜像引用写入 notes。
