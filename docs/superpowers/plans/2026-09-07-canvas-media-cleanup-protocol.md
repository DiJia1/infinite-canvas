# Canvas 媒体删除并发协议实施计划

依据：本任务中用户确认的方案 B 与九项确定性交错测试要求。

目标：Canvas Create / Import / Update 的媒体校验、引用状态与画布写入原子提交；清理认领后媒体不可恢复引用，对象删除失败可重试。

范围：model/media.go、repository/media.go、repository/canvas_project.go、repository/canvas_media.go、service/canvas_projects.go、service/canvas_media_retention.go，以及直接相关测试和媒体访问状态校验。保留工作区已有修改，不调整其他媒体架构。

- [x] 先增加保存拒绝失效媒体、清理失败关闭的回归测试，并观察失败。
- [x] 增加 cleanup_status（active/deleting）、cleanup_started_at、cleanup_claim_id、cleanup_lease_until。默认 active；deleting 不可因租约到期恢复。
- [x] 仓库层将所有 Canvas 写入纳入事务。Canvas 行按固定顺序处理，再锁定实际变更涉及的媒体 ID（稳定排序）；检查目标文档全部引用。仅实际插入/更新时协调引用；失败回滚幂等回执。
- [x] 清理短事务锁定并重新校验候选，持久化 deleting 与带期限认领；事务外删除对象；以 status + claim_id 条件删除记录。租约过期可以换新 claim 重试，旧 claim 不得完成新 claim 的数据库删除。
- [x] 用真实 PostgreSQL、channel/barrier、有限 GORM 故障注入与可控 imageStore 覆盖用户列出的全部交错及失败重试。
- [x] 更新既有用假 mediaId 的 fixture，保留原有业务断言；运行相关测试、全套 go test ./...、必要的 race 验证及 diff 检查。

测试环境：独立 Compose 项目 infinite-canvas-retention-test，专用 infinite_canvas_test 数据库，各测试使用隔离 schema。不得改动正在运行的应用数据库。

完成审查重点：没有绕过事务的旧 reconcile 路径；JSON 解析失败不认领；保存不能清除 deleting；旧扫描和旧 claim 不生效；对象已删除而 DB 失败时记录仍不可引用；批量和重放不引入锁顺序反转。


## 完成验证

- 已观察旧清理在对象删除后 DB 删除失败的回归失败：媒体仍为 active；改为三阶段清理后通过。
- 已观察 deleting 媒体仍可访问/分享的回归失败；加入既有访问入口的状态校验后通过。
- 相关 service / repository / router 测试通过。
- `go test ./...` 全套通过（专用 PostgreSQL）。
- `go test -race ./repository ./service ./router -run 'Test(Canvas|UpdateCanvasProject|DeletingCanvas|MediaCleanup)' -count=1 -timeout=120s` 通过。
- gofmt 检查和 git diff --check 通过；独立代码审查无阻塞发现。
- 测试使用 GOCACHE=/private/tmp/infinite-canvas-go-cache，专用数据库端口 5433，未使用应用数据库。

认领租约为两分钟，对象删除请求超时为三十秒。cleanup_started_at 保留首次认领时间；接管时更新 claim ID 和 lease，旧 claim 不能删除新认领的数据库记录。超时请求可能在对象服务端已经完成，重试依赖对象删除幂等性，不将 deleting 恢复为 active。

发布边界：需要所有 Canvas 写入和 retention 实例统一切换到新协议；旧实例和绕过仓库的直接 SQL 不受协议保护。本次不改变用户显式删除私人/公共素材的业务规则，不修复历史上已丢失的对象；既有失效引用会被新保存校验拒绝，用户可移除失效节点后保存。OSS 错误由 imageStore 边界注入测试，未进行真实 OSS 网络联调。
