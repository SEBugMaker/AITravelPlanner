# 部署说明（补充）

此文档补充了 `README.md` 中的运行/构建示例，聚焦如何使用 GHCR 镜像或在本地构建并部署容器。

## 使用已发布镜像（推荐快速部署）

1. 拉取镜像：

```bash
docker pull ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
```

2. 在项目根创建 `docker/runtime.env`（从 `docker/runtime.env.example` 复制），填写运行时密钥：

```ini
# 示例（不要提交）
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your_anon_key"
SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"

NEXT_PUBLIC_AMAP_KEY="<your-web-js-key>"
AMAP_REST_KEY="<your-rest-key>"
NEXT_PUBLIC_AMAP_SECURITY_JS_CODE="<optional-js-security-code>"
```

3. 以 env-file 运行容器：

```bash
docker run --rm -p 3000:3000 --env-file docker/runtime.env \
  ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
```

注意：运行时修改 `NEXT_PUBLIC_AMAP_KEY` 不会影响镜像中已经内联的前端 bundle；若需替换前端 key，请在构建阶段传入正确的 `NEXT_PUBLIC_AMAP_KEY` 并重新构建镜像。

## 本地构建（当你需要把 NEXT_PUBLIC_* 内联进前端时）

在需要将前端公开变量（`NEXT_PUBLIC_*`）内联到静态 bundle 的情形下，请在构建阶段传入 build-arg：

```bash
docker build \
  --build-arg NEXT_PUBLIC_AMAP_KEY="<your-web-js-key>" \
  --build-arg NEXT_PUBLIC_AMAP_SECURITY_JS_CODE="<optional-js-security-code>" \
  -t ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1 .

docker push ghcr.io/sebugmaker/aitravelplanner/ai-travel-planner:v2.2.1
```

如果 CI 自动化（GitHub Actions）负责构建，请在 workflow 中以 build-arg 或环境变量方式把 `NEXT_PUBLIC_AMAP_KEY` 传入构建步骤，并加入构建前校验（`NEXT_PUBLIC_AMAP_KEY != AMAP_REST_KEY`）以防止 REST Key 被误内联。

## 开发（不构建镜像）

在本地开发时可以直接运行 web 应用以获得热重载，避免频繁构建镜像：

```bash
pnpm install
pnpm --filter web dev
```

这种方式读取 `apps/web/.env.local`（或工作目录的环境变量），适合调试前端与后端 route handlers（部分 server-only 操作仍需 SUPABASE_SERVICE_ROLE_KEY 等密钥）。

## 排查建议

- 若浏览器中出现 `<AMap JSAPI> KEY异常，错误信息：USERKEY_PLAT_NOMATCH`：说明前端实际使用的 key 不是 Web-JS key。排查顺序：
  1. 检查镜像构建时或 CI 中传入的 `NEXT_PUBLIC_AMAP_KEY` 是否为 Web-JS key；
  2. 检查 `docker/runtime.env` 或运行时 env 是否被误设置为 REST Key（建议在运行时不要把 REST Key 写入 `NEXT_PUBLIC_*`）；
  3. 检查数据库（`user_secrets`）中是否存在被误写成 REST Key 的 `amapWebKey`，如有请在设置页覆盖或使用 `scripts/sanitize-amap-keys.mjs` 清理（在可信环境运行并先备份 DB）。

## 其他建议

- 在 CI 中构建并推送镜像后，用 `gh release create` 将 tag 与镜像引用写入 Release notes（不在 Release 中写明密钥）。
- 若需要在多个环境部署（staging/production），请使用不同的 tag（例如 `v2.2.1-staging`）或不同的镜像 repo/namespace 来避免混淆。
