# 后端数据库说明

后端使用 GORM 管理数据库连接和表结构迁移，支持 SQLite、MySQL 和 PostgreSQL。

当前启动时执行 `AutoMigrate`，维护以下表：

- `users`
- `prompts`
- `assets`
- `settings`

## users

仅保存管理员账号，用于管理后台登录。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键 |
| `username` | string | 管理员用户名，唯一索引 |
| `password` | string | 密码哈希 |
| `role` | string | 固定为 `admin` |
| `status` | string | 固定为 `active` |
| `last_login_at` | string | 最近登录时间 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

## prompts

保存管理员手工维护的公开提示词、分类和预览内容。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键 |
| `title` | string | 标题 |
| `cover_url` | string | 封面图 |
| `prompt` | string | 提示词内容 |
| `tags` | json | 标签列表 |
| `category` | string | 分类标识 |
| `preview` | text | Markdown 展示内容 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

## media 与 public_images

图片媒体记录保存 OSS 或本地存储对象 Key、MIME、尺寸、字节数、所属 Portal 用户 UUID 与来源。`public_images` 关联媒体记录，并保存上传者和公共素材标题。

私人媒体按 Portal 用户 UUID 隔离；公共图片和公共文件夹由本地 `admin` 或 `public_assets_manager` 写入，所有已通过 Portal 进入应用的用户可读取。公共素材管理权限只覆盖公共图片和文件夹接口，不授予管理后台其他功能。旧 `assets` 表不会被迁移程序删除，但应用不再读取或写入它。

## app_member_roles 与 app_rbac_state

`app_member_roles` 以 Portal 用户 UUID 为主键，只保存显式的 `admin` 和 `public_assets_manager` 分配；没有记录即为默认 `member`。`app_rbac_state` 保存一次性引导完成标记并序列化角色变更，避免最后一位本地管理员被并发撤销。权限解析同时要求对应 `portal_members` 记录已同步且启用。

首次部署时，将已启用且具有应用入口的初始管理员准确 UID 配置到 `APP_RBAC_INITIAL_ADMIN_UIDS`。首次启动会在引导前同步目录，并要求这些成员在同步后保持启用；目录同步失败时引导不会完成。完成引导后角色仅在“成员管理”中维护，后续启动不再自动同步目录；Portal 继续提供身份和应用入口，其角色只保留为展示和审计元数据，绝不参与本地授权，也不会自动导入旧公共素材管理员成员。

## settings

系统设置固定保存 `public` 和 `private` 两行，配置值为 JSON。公开配置包含可用模型和默认模型；私有配置包含模型渠道和 API Key。完整结构见 [系统配置数据结构](system-settings.md)。

项目不为旧数据库编写字段兼容或清理迁移；已有数据库中停止使用的旧列和旧表不会由 `AutoMigrate` 自动删除。
