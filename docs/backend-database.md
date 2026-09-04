# 后端数据库说明

后端只支持 PostgreSQL。应用启动时必须提供非空的 `DATABASE_DSN`，并使用 Portal 之外的专属应用账号和 schema；没有数据库类型选择项，也不会回退到本地数据库文件。

GORM 在每次启动时先执行必要的 PostgreSQL 兼容升级，再执行 `AutoMigrate`。连接池由 `DB_MAX_OPEN_CONNS`、`DB_MAX_IDLE_CONNS` 和 `DB_CONN_MAX_LIFETIME` 控制。

## 当前表结构

| 表 | 用途 |
| --- | --- |
| `canvas_projects` | 按 Portal 用户隔离的画布标题、完整 document 和 revision。 |
| `canvas_save_requests` | 短期保存已接受画布写入的幂等回执，供浏览器在结果未知时安全重试。 |
| `media` | 私人图片媒体的对象 Key、MIME、尺寸、字节数、所属用户和来源。 |
| `media_upload_intents` | 浏览器直传媒体存储前的短期上传意图，以及确认后的媒体引用。 |
| `image_generation_tasks` | 异步图片生成任务、供应商请求快照、状态、进度、结果媒体和计费记录。 |
| `private_folders` | 按用户隔离的私人素材文件夹。 |
| `public_folders` | 全体用户可读取的公共素材文件夹。 |
| `public_images` | 对公共素材的媒体引用、目录、标题和上传者。 |
| `settings` | 管理员维护的 AI 供应商与默认模型配置 JSON。 |
| `portal_members` | 从 Portal 同步的用户目录快照和启用状态。 |
| `app_member_roles` | 应用内显式角色分配；无记录即为普通成员。 |
| `app_rbac_state` | 应用内 RBAC 的一次性管理员引导状态和角色写入协调状态。 |
| `operation_logs` | 服务端业务操作、执行状态与审计上下文。 |

私人媒体和画布始终按 Portal 用户 UUID 隔离。公共图片和公共文件夹可由本地 `admin` 或 `public_assets_manager` 管理，所有已获应用入口权限的 Portal 用户可读取。公共素材管理权限不会授予管理后台的其他权限。

`app_member_roles` 只保存显式的 `admin` 和 `public_assets_manager` 分配；`portal_members` 中对应成员必须已同步且处于启用状态，角色才会生效。首次部署使用 `APP_RBAC_INITIAL_ADMIN_UIDS` 完成一次性应用内管理员引导；完成后角色只在“成员管理”中维护。Portal 继续提供可信身份和应用入口，其角色仅用于展示和审计元数据，不参与本地授权。

## 兼容升级与数据维护

早期 PostgreSQL 版本的 `canvas_projects` 主键只有 `id`。启动时如果检测到该旧主键，会在事务中将其升级为复合主键 `(id, owner_uid)`；新库直接以复合主键创建。此升级保留既有行，用于保证不同用户的画布写入和 revision 乐观锁按所有者隔离。

`AutoMigrate` 只补充当前模型所需的表、列和索引，不会清理停用的表或列，也不能用来迁移其他数据库引擎的数据。生产数据库变更前应先完成备份及隔离恢复验证，具体流程见 [生产部署](deployment.md)。
