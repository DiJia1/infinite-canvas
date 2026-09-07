# infinite-canvas 代码简化检查报告

日期：2026-09-07。依据：project-simplification 技能及项目现有实现。范围：当前工作区，包括未提交修改；前端、Go 后端、测试和依赖配置。三名子代理分别检查前端、后端及测试，主代理复核关键调用链和证据。

本次仅检查并新增本报告，没有修改业务代码、测试或配置。以下 P1 表示应优先修复的数据安全问题，P2 表示有实际收益的优化或可靠性问题，P3 表示低风险清理或可选整理。性能收益尚未通过基准测试量化；并发风险来自代码路径与时序分析，不代表已在生产复现。

总体判断：项目已经有较明确的 hooks、controller、资源管理和同步边界，不适合整体重构。优先解决媒体清理的一致性、重复目录请求，再删除确认无用的代码和测试。前端组件化有局部机会，但不是当前收益最大的方向。

## 1. P1：媒体清理与画布恢复引用之间存在删除竞态

证据：[canvas_media_retention.go:103](/Users/Admin/codexprogram/infinite-canvas/service/canvas_media_retention.go:103)、[canvas_projects.go:164](/Users/Admin/codexprogram/infinite-canvas/service/canvas_projects.go:164)、[media.go:32](/Users/Admin/codexprogram/infinite-canvas/repository/media.go:32)。前两个文件属于当前未提交变更，其中 retention 文件为新增文件。

清理先检查图片未被引用，然后删除对象，再按 ID 无条件删除数据库记录。中间另一个保存请求可以恢复画布中的图片引用，并清空过期时间，但清理仍会按旧结果继续删除。

可成立的时序：清理检查“无引用” → 用户撤销删除并保存成功 → 保存清空 expires_at → 清理删除对象和记录。最终画布仍引用一个已经被删除的媒体。

建议：将保存引用和清理认领纳入共同的数据库并发协调协议，例如一致的锁顺序和条件状态迁移；对象删除只能在清理取得有效认领后执行，后续保存也必须遵守该协议。仅增加一次查询或仅在删除记录时检查 expires_at 不够，因为对象可能已经被删除。这项应单独修复，并验证清理检查后恢复引用的并发场景。

## 2. P2：媒体清理对每张图片重复全量读取画布

证据：[canvas_media_retention.go:43](/Users/Admin/codexprogram/infinite-canvas/service/canvas_media_retention.go:43)、[canvas_project.go:86](/Users/Admin/codexprogram/infinite-canvas/repository/canvas_project.go:86)、[media.go:63](/Users/Admin/codexprogram/infinite-canvas/repository/media.go:63)。

每次引用检查都读取该用户全部画布并解析 document；保存时对每张被移除图片重复执行，定时清理又逐张重复执行。移除 M 张图片、用户有 P 个画布时，最坏进行 M 次全量查询、M×P 次文档解析。过期媒体查询本身也没有批量上限。

建议：一次保存集中处理全部移除 ID，公共引用批量查询，同一用户的画布在本轮处理里只扫描一次；清理按有限批次读取。先满足第 1 项的一致性要求，再减少查询，不使用跨周期缓存代替引用安全检查。

## 3. P2：批量导入重复刷新素材目录，旧响应可能覆盖新结果

证据：[canvas-client-page.tsx:387](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/[id]/canvas-client-page.tsx:387)、[canvas-client-page.tsx:1964](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/[id]/canvas-client-page.tsx:1964)、[use-asset-store.ts:261](/Users/Admin/codexprogram/infinite-canvas/web/src/stores/use-asset-store.ts:261)。

每张图片远端上传完成刷新一次，批量本地建节点结束又刷新一次；每轮并发获取图片和文件夹。因此 20 张成功上传可产生 21 轮、42 个目录请求（不含其他入口的请求）。本地建节点完成不等于远端上传完成，批次刷新还可能过早。

refreshFromServer 每次直接 set(next)，没有过期响应保护；先发出的旧请求晚返回时，可覆盖更新的目录，随后还会执行缺失媒体缓存清理。

建议：删除仅因本地建节点完成而触发的刷新；在现有 store 内合并上传完成刷新，并使用请求版本或串行刷新防止旧结果落地。刷新进行中再次发生变更时，完成后应补一次刷新，不能仅用 loading 标志跳过。处理时同时检查请求所属用户作用域。

## 4. P2：普通媒体缓存删除后未释放 Object URL

证据：[file-storage.ts:9](/Users/Admin/codexprogram/infinite-canvas/web/src/services/file-storage.ts:9)、[file-storage.ts:32](/Users/Admin/codexprogram/infinite-canvas/web/src/services/file-storage.ts:32)、[use-asset-store.ts:242](/Users/Admin/codexprogram/infinite-canvas/web/src/stores/use-asset-store.ts:242)。

上传和读取视频等媒体会向模块级 objectUrls 写入 URL；cleanupUnusedMedia 只删除 IndexedDB 项，没有 revokeObjectURL 或删除 Map 项。页面长时间打开并反复新增、删除媒体时，这部分内存资源不会随清理释放，resolveMediaUrl 仍可命中已清理项的旧 URL。

建议：确认媒体不再被使用并完成持久化删除后，释放相应 URL、删除 Map 项，补上针对该生命周期的验证。可参照 image-storage 已有释放方式，不必合并两个存储模块或引入通用资源框架；实现时需考虑清理期间的新写入。

## 5. P2：初始化会话绕开已有 Query 缓存

证据：[client-root-init.tsx:29](/Users/Admin/codexprogram/infinite-canvas/web/src/components/layout/client-root-init.tsx:29)、[app-top-nav.tsx:29](/Users/Admin/codexprogram/infinite-canvas/web/src/components/layout/app-top-nav.tsx:29)、[session.ts:10](/Users/Admin/codexprogram/infinite-canvas/web/src/services/api/session.ts:10)。

初始化直接 fetch /api/session 并手工解析；顶栏对同一接口使用 portal-session Query。普通用户页首次挂载时，两条路径不能共享进行中的请求，响应处理也重复。

建议：初始化复用现有 API helper、QueryClient 和相同 query key，保留先取得 UID 再 hydrate、失败回退 guest 的语义。不必新增 session store 或仅转发调用的 hook。公共素材抽屉每次打开重新确认权限有独立用途，不应顺手取消。

## 6. P2：统计查询读取了不需要的完整任务数据

证据：[image_generation_task.go:198](/Users/Admin/codexprogram/infinite-canvas/repository/image_generation_task.go:198)、[admin_statistics.go:71](/Users/Admin/codexprogram/infinite-canvas/service/admin_statistics.go:71)。

统计查询加载完整 ImageGenerationTask，包括统计不需要的提示词、供应商配置、引用 JSON 等快照，并先执行数据库排序，服务随后又聚合并排序。

建议：先将查询裁剪为统计实际使用的 OwnerUID、ProviderID、ProviderName、Resolution、ResultMediaIDsJSON、Amount、AmountRecorded 字段；确认最终排序完全由聚合函数决定后去掉前置排序。实际数据量有压力时再分批聚合，不提前新增统计框架。金额精度、未计价计数和最终排序须保持不变。

## 7. P3：可删除的死代码与多余参数

| 位置 | 证据与最小建议 |
| --- | --- |
| [canvas-image-data.ts:28](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/utils/canvas-image-data.ts:28) | transformAngleDataUrl 全仓仅有定义；其专属 ImageAngleTransform 类型也无其他使用，可一起删除。实际角度处理走 AI 编辑流程。保留同文件仍使用的裁剪和 loadImage。 |
| [image-utils.ts:26](/Users/Admin/codexprogram/infinite-canvas/web/src/lib/image-utils.ts:26) | readFileAsDataUrl 全仓仅有定义，可删除；其他图片工具仍在使用。 |
| [canvas-client-page.tsx:256](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/[id]/canvas-client-page.tsx:256) | config 变量未读取，下一行 useEffectiveConfig 已订阅配置，可删除额外订阅。 |
| [canvas-config-node-panel.tsx:277](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/components/canvas-config-node-panel.tsx:277) | TextSortCard 和 ImageSortCard 接收 inputs 但不读取，可同时清理形参、类型及调用处传值。 |
| [canvas-generation-utils.ts:4](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/utils/canvas-generation-utils.ts:4) | normalizeImageMask 导入未使用。 |
| [use-canvas-store.ts:728](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/stores/use-canvas-store.ts:728) | metadata 局部变量未使用，可删除，不改删除项目流程。 |

这是最适合先做的小批量清理。未发现足够证据支持大规模删除依赖。特别是 shadcn 虽无组件 JS import，globals.css 仍导入 shadcn/tailwind.css，不能按 JS 引用搜索结果直接卸载。

## 8. P3：后端旧任务创建入口仅由测试使用

证据：[image_generation_task.go:11](/Users/Admin/codexprogram/infinite-canvas/repository/image_generation_task.go:11)。全仓调用只有测试；生产使用同文件的 CreateImageGenerationTaskWithOperationLog，旧入口重复幂等插入逻辑，并独占 firstImageTaskLookupError 辅助函数。

建议：将幂等性测试迁移到真实事务创建入口；确实只需造数据的测试使用 fixture，然后删除旧入口及专属函数。不能把相关租约、幂等测试一并删除。本结论限定于当前仓库内调用，未评估外部 Go 使用者。

## 9. 测试精简：区分可删除、应替换和必须保留

前端共 82 个测试文件，其中 16 个读取源码，13 个为纯源码断言、3 个混合行为和源码断言；后端共 41 个测试文件。源码检查并非一律无用，但当前部分断言只验证写法，无法证明目标行为。

**可直接删除的重复：**

- [app-top-nav.test.ts:18](/Users/Admin/codexprogram/infinite-canvas/web/src/components/layout/app-top-nav.test.ts:18) 与 [admin-navigation.test.ts:9](/Users/Admin/codexprogram/infinite-canvas/web/src/components/layout/admin-navigation.test.ts:9) 对同一导航导出、同一预期数组重复断言。保留后一处即可。
- [public-image-drawer.test.ts:60](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/components/public-image-drawer.test.ts:60) 与上一行输入完全相同，说明文字分别称 admin、manager，却没有角色参数；删除重复这一行即可。

**优先删除仅冻结实现写法的断言：**

- [statistics-report-tabs.test.ts:13](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(admin)/admin/statistics/statistics-report-tabs.test.ts:13) 锁定内部组件函数名。
- [canvas-config-node-panel.test.ts:17](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/components/canvas-config-node-panel.test.ts:17) 锁定 w-full 类名、import 和函数调用拼写。事件传播隔离是实际交互要求，相关检查应以行为测试替换，不能随整文件删除。

**应先替换再删除的低质量测试：**

- [public-image-drawer.test.ts:15](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/components/public-image-drawer.test.ts:15)：宽泛正则寻找权限 guard、计数表达式，不能证明操作入口受到保护。改为权限允许/拒绝时调用实际入口，断言是否发出 mutation。
- [settings/page.test.ts:18](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(admin)/admin/settings/page.test.ts:18)：复制生产筛选表达式验证源码。应验证真实选择逻辑在无价格、空价格、非图片供应商等输入下的结果。
- [admin-statistics.test.ts:7](/Users/Admin/codexprogram/infinite-canvas/web/src/services/api/admin-statistics.test.ts:7)：搜索 amount: string 和 apiGet 拼写不能保证高精度金额原样返回。使用模拟 HTTP 响应调用真实 API helper，验证日期参数及字符串金额；静态字段类型交给 TypeScript。
- [deployment_config_test.go:122](/Users/Admin/codexprogram/infinite-canvas/deployment_config_test.go:122)：脚本包含 rollback、flock、健康检查名称不等于实际执行保护。保留部署约束，将关键部分改为配置结构校验与受控假命令下的失败回滚验证；暂未替换前不建议整文件删除。

**保留行为，但改进时间控制：**[use-canvas-store.test.ts:524](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(user)/canvas/stores/use-canvas-store.test.ts:524) 使用 50ms 防抖和 55/15/50ms 实际等待，负载高时容易跨越计时边界。可替换为可控时钟，保留“保存进行中又收到拖拽更新”的断言。

**不应删除：**

- canvas-image-hydration.test.ts 第 12、14 行 Assert<Equal<...>> 是编译期类型契约，虽被 noUnused 标记，仍有真实作用。
- image-storage-cache.test.ts 的账号隔离、下载与删除并发、旧写覆盖等测试保护不同故障路径，不能因为文件长或共用 fixture 就当作重复。
- use-canvas-store、图片任务租约、生成 controller 的并发测试调用真实逻辑；mock 依赖不等于“镜像实现”。
- 新增 canvas_media_retention_test.go 的撤销恢复、幂等保存和冲突保护测试有价值，但不能据此认为第 1 项交错时序已经被覆盖。

## 10. 前端组件化建议与停止边界

**可选的明确边界：供应商编辑抽屉。**[settings/page.tsx:43](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(admin)/admin/settings/page.tsx:43) 的表单初始化、参数转换、价格校验，与 [settings/page.tsx:171](/Users/Admin/codexprogram/infinite-canvas/web/src/app/(admin)/admin/settings/page.tsx:171) 的 Drawer/Form 构成完整编辑职责。如果后续继续增加供应商字段，可提取一个 ProviderEditorDrawer，让它拥有表单状态与校验，通过当前供应商、类型列表、open、确认/关闭回调交互。父页面仍负责设置集合和整体保存；避免把每个输入框拆成新组件。这是低优先级维护建议，当前不拆也合理。

**不建议整体拆画布主页面。**canvas-client-page.tsx 虽有 2390 行，但其中大量代码负责历史、恢复、上传、资源生命周期和同步状态的编排。已有 generation hook、interactions hook、上传 controller、资源 controller、同步 lease 等边界。机械切块会传递大量 setter/ref，未必降低复杂度。先执行死代码和重复请求清理，再判断是否还有可独立拥有状态的职责。

**不建议合并所有配置面板。**现有 ImageSettingsPanel 已承担共享设置；配置节点面板另有输入排序、文本编辑和预览职责，保留差异比引入更多模式开关更直接。

**不建议合并全部存储/请求模块。**图片缓存有作用域、过期写入和资源保活等语义；同步与媒体清理也各有生命周期。部分表面重复是必要边界，不能仅按函数长度或相似命名判断。

## 验证结果与实施顺序

- 已读取项目说明、package.json、go.mod、tsconfig、Next 配置、CI，以及相关调用链和当前 diff；使用全仓符号搜索核对无调用项。
- `tsc --noEmit --incremental false`：通过。禁用增量以避免更新 tsbuildinfo。
- 额外执行 `tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters`：报告 10 处诊断。已区分真实未使用项、回调参数，以及应保留的两处编译期类型断言；这不是项目常规类型检查失败。
- `git diff --check`：通过。没有执行批量格式化、前端构建、Go 全套测试、数据库测试或浏览器验证；本次没有业务实现变更，不把静态检查结果表述为运行时验证通过。

建议顺序：先单独解决媒体删除一致性；再处理重复目录刷新与 Object URL 释放；低风险死代码和确切重复测试可以独立清理；最后处理查询裁剪和选择性的测试替换。组件提取放在实际维护需求出现时进行，不启动全项目重构。

限制：当前未提交改动较多，报告描述的是本次读取时的工作区；后续代码变更可能使行号或结论过时。未量化生产数据规模、网络请求耗时或内存占用，也未声称所有文件均经过逐行安全审计。
