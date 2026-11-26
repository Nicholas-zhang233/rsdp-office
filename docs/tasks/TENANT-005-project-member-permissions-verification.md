# TENANT-005 项目成员权限核对与逐权限测试

状态：已验收（单测 + mock e2e 深度；真实后端集成未执行）
更新日期：2026-11-26
负责人：按实际填写
基线/交付版本：工作区（未提交）
关联：[TENANT-004 角色模型](TENANT-004-office-role-model.md)、[QUOTE-001 项目报价](QUOTE-001-project-quotation.md)、[架构契约](../architecture.md)

## 目标与验收

触发：经销商主号在项目设置（ProjectSettingsDialog）的成员权限表格中勾选/取消协作者权限并保存；协作者随后使用项目各功能。
结果：每个用户的权限真实写入 `office_project_member.permission_flags`（位掩码）；每项权限在对应功能位置有后端核验（不只靠 UI 禁用）；每项权限与其功能有自动化测试证据。
范围：7 项权限（READ/EDIT/QUOTE_READ/MARGIN_READ/EXPORT_PROJECT/MANAGE_MEMBERS/EXPORT_QUOTE）的持久化链路与检查点测试，以及调查中发现的 module-recommendations 无校验缺口修复。不含真实后端集成验收（用户已确认本次深度为后端单测 + mock e2e）。

- [x] 验收项 1：`replaceMembers` 把 permissions 编码为位掩码持久化（内存表模拟先删后插 + DTO 解码往返断言），非工作区主号带 permissions 或换负责人被拒，授权对象必须是本项目成员，permissions 缺省时保留既有授权。
- [x] 验收项 2：7 项权限在 `OfficeProjectAccessService` 的授权/拒绝双向用例全部通过，含 MARGIN_READ/EXPORT_QUOTE 对 QUOTE_READ 的级联语义；工作区主号对全部 7 项 `can()` 为 true。
- [x] 验收项 3：报价链路 `latest()` 校验 QUOTE_READ、无 MARGIN_READ 时裁剪 pricingMode/pricingValue/factoryPrice/missingPriceLines、`latestForExport()` 校验 EXPORT_QUOTE，均有用例。
- [x] 验收项 4：`POST /projects/{id}/module-recommendations` 增加 READ 校验（controller 层 `requireFloorAccess`），校验先于业务执行的回归用例通过。
- [x] 验收项 5：前端 `toggleProjectPermission` 纯函数 Node 单测覆盖全部级联规则；新 e2e 覆盖授权保存 payload、READ-only/QUOTE_READ/EDIT+EXPORT_PROJECT 三类协作者的 UI 门控与裁剪数据渲染。

## 现状与依赖

调查结论（2026-11-26，源码证据）：

- 写库链路真实：`PUT /api/v1/office/projects/{id}/members` → `OfficeProjectService.replaceMembers`（事务内先删后插，`OfficeProjectPermission.encode` 位掩码写入 `permission_flags`），读取时 `toMemberDto` 解码。迁移 `20261124_simple_office_permissions.sql` 建列并回填。
- 检查点矩阵：6 项权限前后端双重覆盖；MARGIN_READ 前端无检查属有意设计（后端 `ProjectQuotationService.latest()` 数据裁剪兜底）。
- 缺口（已修复）：`OfficeController.recommendModules`（module-recommendations）原先没有任何 access 校验，已补 `requireFloorAccess`（READ）。
- 测试基建：后端 Mockito 单测（`OfficeProjectAccessServiceTest` 内存表模式）；前端无 vitest，纯函数用 Node strip-types 脚本，UI 用 Playwright mock API 脚本（仿 `e2e-account-center.mjs` 多身份模式）。

### 权限检查点矩阵（2026-11-26 核对）

| 权限 | 前端检查 | 后端核验 |
| --- | --- | --- |
| READ | 无显式（项目列表由后端 accessibleProjectIds 过滤） | requireMember/requireFloorAccess，遍布读接口（含本次补齐的 module-recommendations） |
| EDIT | useProductScheme、stores/office.canEditFloor、proposal、ProjectFloorTree、ProjectSettingsDialog | OfficeProjectService 项目/楼层/需求/参考图写接口、OfficeService 画布/购物车、选品/排版/空间确认等 20+ 处 |
| QUOTE_READ | AppUserSession 报价入口、quotes 页项目过滤 | ProjectQuotationService.latest |
| MARGIN_READ | 无（有意，后端数据裁剪兜底） | ProjectQuotationService.latest 置空 pricingMode/pricingValue/factoryPrice/missingPriceLines |
| EXPORT_PROJECT | proposal 导出按钮 | OfficeController proposal/export |
| EXPORT_QUOTE | quotes 导出按钮与下载守卫 | ProjectQuotationService.latestForExport |
| MANAGE_MEMBERS | ProjectFloorTree 设置入口、ProjectSettingsDialog | OfficeProjectAccessService.requireLeader → replaceMembers；授权本身仅工作区主号 |

## 实施步骤

- [x] 调查写库链路与检查点矩阵（见现状）
- [x] 修复 module-recommendations 缺口并加 `OfficeControllerTest` 回归
- [x] `OfficeProjectAccessServiceTest` 补 7 项权限矩阵用例
- [x] `OfficeProjectServiceTest` 补 replaceMembers 授权持久化用例
- [x] `ProjectQuotationServiceTest` 补报价三权限用例
- [x] 前端抽 `toggleProjectPermission` 纯函数 + Node 单测
- [x] 新增 `e2e-project-member-permissions.mjs` 四段用例
- [x] 执行验证并更新状态表

## 决策与过程

| 日期 | 发现/决定 | 原因或证据 | 对下一步的影响 |
| --- | --- | --- | --- |
| 2026-11-26 | module-recommendations 校验加在 controller 层（`requireFloorAccess`），不进 service | 同控制器 module-products 的既有风格；service 的 select/applyRoomProducts 走自己的锁与校验路径 | 回归测试放 controller 测试（沿用 service 测试包约定） |
| 2026-11-26 | 报价权限测试只验证「调用点 + 裁剪逻辑」，位掩码语义由 AccessService 测试负责 | `ProjectQuotationServiceTest` 的 accessService 整体 mock，两层分工避免重复 mock 内部判定 | 用例用 verify + can() stub |
| 2026-11-26 | MARGIN_READ 前端不加检查 | 后端数据裁剪兜底，符合「后端核验不只靠 UI 禁用」 | e2e 第 3 段按裁剪后数据断言渲染 |
| 2026-11-26 | `encode()` 是校验不是自动补位：MARGIN_READ/EXPORT_QUOTE 必须显式带 QUOTE_READ 位 | `OfficeProjectPermission.encode` 抛 BusinessException；前端 toggle 级联补全 | 后端测试用完整闭包构造 flags |
| 2026-11-26 | 顺带修复 e2e-account-center 的 mock 漂移：商品列表改 `/products/browse`、经销商报价页试算 `/quotation/preview` 未 mock 导致页面崩溃 | 干净树上重跑同样失败（`serverProducts`/`preview.floors` undefined flatMap），与本次改动无关 | 补 browse/browse/facets/quotation preview 三个 mock 后回归通过 |

## 验证记录

| 日期 | 版本/环境/样本 | 命令或操作 | 结果及证据 | 未覆盖项 |
| --- | --- | --- | --- | --- |
| 2026-11-26 | 工作区 | 代码调查（写库链路、检查点矩阵） | 持久化真实；发现 module-recommendations 缺口 | 真实数据库落库未验证 |
| 2026-11-26 | 本机工作区 | `mvn -f backend/pom.xml test` | 459 项、0 失败、0 错误、11 跳过 | 11 项跳过为未配置 `RSDP_TEST_POSTGRES_URL` 的 PostgreSQL 专项，不计数据库验收 |
| 2026-11-26 | 本机工作区 | `pnpm build`（frontend） | 通过 | — |
| 2026-11-26 | dev server 3001，全部 API mock | `pnpm test:project-permissions` | 通过（级联勾选 12 断言） | — |
| 2026-11-26 | dev server 3001，全部 API mock | `pnpm e2e:member-permissions` | 通过 4 段：授权 payload 与回显、READ-only 门控、报价裁剪渲染、编辑/方案导出入口与报价拦截 | 未连真实后端 |
| 2026-11-26 | dev server 3001，全部 API mock | `pnpm e2e:workflows`、`pnpm e2e:account-center`、`pnpm e2e:quotes`、`MOCK_API=1 pnpm e2e:smoke` | 全部通过 | — |
| 2026-11-26 | 工作区 | `git diff --check`、文档相对链接检查 | 通过 | — |

未执行：真实后端集成（docker postgres + `RSDP_AUTH_ENABLED=true` + 真实登录逐项点验），按用户确认的测试深度（后端单测 + mock e2e）从本次范围排除。

## 交付与下一步

变更文件：

- 修复：`OfficeController.recommendModules` 补 `requireFloorAccess`（READ）。
- 后端测试：新增 `OfficeControllerTest`；扩展 `OfficeProjectAccessServiceTest`（7 权限矩阵 + 主号全权限）、`OfficeProjectServiceTest`（授权编码持久化/非主号拒绝/授权对象校验/缺省保留）、`ProjectQuotationServiceTest`（QUOTE_READ/EXPORT_QUOTE 调用点、MARGIN_READ 裁剪）。
- 前端：`toggleProjectPermission` 抽入 `app/utils/projectPermissions.ts`（行为不变），新增 `scripts/test-project-permissions.mjs`、`scripts/e2e-project-member-permissions.mjs`，注册 `test:project-permissions` 与 `e2e:member-permissions`。
- 顺带修复：`e2e-account-center.mjs` 补 `/products/browse`、`/products/browse/facets`、`/quotation/preview` mock（既有漂移，与本次改动无关）。

行为变化：module-recommendations 从「无校验」变为要求项目 READ 成员权限；其余无行为变化。

验收结论：7 项权限的持久化链路与检查点均有单测/mock e2e 证据，达到用户确认的测试深度。剩余限制：真实数据库落库与真实角色端到端未验证，后续如需更强证据可补 opt-in PostgreSQL 用例（仿 `OfficeProjectStatusPostgresTest`）与一次人工真实环境点验。
