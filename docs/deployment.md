# Portal 生产部署

无限画板以私有 GHCR 镜像部署到 Portal Gateway 后方。浏览器访问入口是：

```text
https://www.semetaloa.com/apps/infinite-canvas/canvas
```

应用容器不公开宿主机端口；Portal Gateway 负责登录、应用访问权限和身份头注入。

## 一次性生产初始化

1. 启动 Portal，并确认外部 Docker 网络 `portal_gateway`、`internal_tools_database` 与 `portal_directory` 已存在。
2. 创建应用目录和持久化数据目录：

   ```bash
   mkdir -p /program/apps/infinite-canvas /program/data/infinite-canvas/media
   ```

3. 在 `/program/apps/infinite-canvas/.env` 写入生产配置。文件不得提交到 Git，至少包含专属 PostgreSQL schema 的 `DATABASE_DSN`、OSS 配置、`PORTAL_DIRECTORY_SECRET`、`APP_RBAC_INITIAL_ADMIN_UIDS` 和 AI 供应商配置所需的运行变量。
4. 在 Portal 后台登记应用：
   - 应用键：`infinite-canvas`
   - 上游端口：`3000`
   - 启用应用，并向需要使用的角色授予 `app:infinite-canvas:access`。
5. 按以下顺序完成应用内 RBAC 首次发布（新建数据库和升级部署均适用）：
   1. 在 Portal 中确认目标初始管理员已启用且具有 `app:infinite-canvas:access`；`APP_RBAC_INITIAL_ADMIN_UIDS` 必须只包含这些准确的 Portal UID（多个 UID 用逗号分隔）。
   2. 设置 `APP_RBAC_INITIAL_ADMIN_UIDS` 并部署。首次成功启动会在引导前同步 Portal 目录，确认这些 UID 已同步且启用后，一次性引导为 Infinite Canvas 本地管理员。目录同步或校验失败会使启动失败，不会写入完成标记。
   3. 验证其中一位用户能够进入 `/admin/members`。
   4. 在变更初始管理员前，先在“成员管理”中至少再授予一位用户本地管理员角色。
   5. 引导完成标记已写入后，从部署环境移除 `APP_RBAC_INITIAL_ADMIN_UIDS`。
   6. 此后所有 Infinite Canvas 角色都在“成员管理”中维护；不要为本应用分配 Portal 管理员或公共素材管理角色，也不要自动导入既有 Portal 公共素材管理员成员。

完成标记存在后，后续启动不会再自动同步 Portal 目录；管理员可在成员管理中按需发起同步。Portal 仍负责可信身份和 `app:infinite-canvas:access` 应用入口。Gateway 注入的 Portal 角色只保留为展示和审计元数据，绝不参与 Infinite Canvas 授权。
6. 在 GitHub 仓库的 `production` Environment 配置 Secrets：
   - `DEPLOY_HOST`
   - `DEPLOY_USER`
   - `DEPLOY_SSH_PRIVATE_KEY`
   - `DEPLOY_KNOWN_HOSTS`
   - `GHCR_READ_TOKEN`：可读取私有 `ghcr.io/dijia1/infinite-canvas` 包的最小权限 Token。

## 首次发布基线

首次 GitHub Actions 会将当前 release 配置上传到
`/program/apps/infinite-canvas/releases/<SHA>/`，但在没有健康基线时停止，不覆盖正在运行的服务。

在服务器完成一次受控启动后建立基线：

```bash
export DEPLOY_SHA=<40 位 Git SHA>
export INFINITE_CANVAS_IMAGE=ghcr.io/dijia1/infinite-canvas:sha-$DEPLOY_SHA
export RELEASE_DIR=/program/apps/infinite-canvas/releases/$DEPLOY_SHA

docker login ghcr.io
docker pull "$INFINITE_CANVAS_IMAGE"
INFINITE_CANVAS_ENV_FILE=/program/apps/infinite-canvas/.env \
INFINITE_CANVAS_MEDIA_DIR=/program/data/infinite-canvas/media \
docker compose --project-name infinite-canvas \
  --env-file /program/apps/infinite-canvas/.env \
  -f "$RELEASE_DIR/docker-compose.yml" up -d --no-build --force-recreate app
"$RELEASE_DIR/scripts/initialize-release-state.sh" "$DEPLOY_SHA" "$INFINITE_CANVAS_IMAGE" "$RELEASE_DIR"
docker logout ghcr.io
```

初始化脚本只会在容器 healthcheck 通过后记录最后健康版本。

## 常规发布与回滚

推送到 `main` 后，GitHub Actions 会先运行 Go 与前端测试、构建 `linux/amd64` 镜像并发布：

```text
ghcr.io/dijia1/infinite-canvas:sha-<GITHUB_SHA>
```

随后部署 Job 通过严格 known-host 校验连接服务器，上传该 SHA 对应的 Compose 与部署脚本，临时登录 GHCR、拉取指定镜像并重建唯一的 `app` 服务。

部署在 60 秒内未达到健康状态时，会用最后健康 release 的 Compose 和镜像自动恢复。数据库仍沿用应用启动时的 GORM 自动迁移；回滚不会回退数据库 schema 或数据。

Portal 验收应分别验证：未登录用户跳转登录页、无权限用户显示禁止页，以及被授权用户可进入 `/apps/infinite-canvas/canvas`。目录同步回调通过 `portal_directory` 网络访问 `infinite-canvas-directory:3000`。
