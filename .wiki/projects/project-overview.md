---
id: project-overview
title: 项目架构与模块边界
category: projects
tags: [concept, architecture]
summary: 仓库分 apps 与 packages（core、data、ui）：core 不依赖 DOM 与界面，data 持静态内容，ui 持共享组件，renderer 管存档；四目标 typecheck 见 package.json。
tier: supporting
source: docs-distill:project-overview
confidence: extracted
created: 2026-11-02T13:58:39.726Z
updated: 2026-11-02T13:58:39.726Z
---

> 知识地图摘要页：权威原文以 Sources 为准。

## 结论先行

- 游戏由确定性状态与时间演算驱动，界面只负责展示与发送命令；规则单点写在 `packages/core`。
- 依赖方向是 **apps → packages**；`core` 不依赖 DOM、Node 或界面框架，界面不得反向读数据表另算规则。
- 静态数字在 `packages/data/src/static/*.json`，随构建发布、不热换；存档格式与数据格式版本彼此独立。
- 根工作区注册 `packages/*` 与 `apps/*`；`typecheck` 依次覆盖 core、data、ui、desktop 四个目标。
- 云存档与服务器权威演算尚未启动，分层只是预留条件，不代表已有账号、云同步或在线反作弊。
- 文档入口是 `docs/catalog.md`：先读 `AGENTS.md`，再按任务查表；`docs/INDEX.md` 由 `npm run docs:index` 生成，不手改。

## 仓库分层与依赖方向

目录结构核实：`packages/` 下只有 `core`、`data`、`ui`；`apps/` 下只有 `desktop`、`server`。

| 位置 | 职责（原文口径） | 依赖方向 |
|---|---|---|
| `packages/core` | 状态、命令、时间推进、战斗、经济与种子随机 | 不依赖 DOM、Node 或界面框架；无上层依赖 |
| `packages/data` | 内容目录、静态参数、文本与派生定义 | 类型来自 core，不复制最终运行快照 |
| `packages/ui` | 共享界面组件与样式 | 被界面侧消费 |
| `apps/desktop/src/renderer/src/game` | 引擎封装、订阅、读写存档、离线结算、心跳与命令桥接 | 调 core 公开接口 |
| 桌面 main/preload | Electron 运行时和受控文件接口 | 承接渲染层文件请求 |
| `web` | 独立网页构建，复用 renderer 和源码包 | 不是独立目录，产物不入库 |
| `tools` | 检查、仿真、内容编辑与合成测试档 | 不作为玩家运行依赖 |
| `apps/server` | 云存档服务器目录；`apps/server/data/` 不入库 | 文档分层表未收录，见「文档缺口」 |

依赖链条要点：内部包通过工作区与构建别名直接消费 TypeScript 源码；界面调用 core 公开接口，不反向读取数据表另算规则。`web` 与桌面共用同一份 renderer，差异只在构建与文件接口。

## 根 package.json：工作区与关键脚本

- `workspaces`：`packages/*`、`apps/*`（见 `package.json:9-12`）。
- `typecheck`：`@whale/core` → `@whale/data` → `@whale/ui` → `@whale/desktop` 四个目标按序执行（`package.json:22`）。
- `test`：固定跑 `@whale/core`（`package.json:21`）；专项测试按改动范围另跑。
- 构建产物：`dev` / `build` / `pack` 均指向 `@whale/desktop`（`package.json:14-18`）；网页产物在 `dist-web/` 与 `apps/desktop/dist-web/`，Electron 绿色包与安装包在 `apps/desktop/release/`，三者都不入库（`.gitignore:19-25`）。
- 边界检查脚本：`content:check`（静态内容）、`arch:guard`（架构护栏）、`scope:check`（功能域范围）、`docs:index`（文档清册）。

## 确定性与功能目录

- `advanceGame` 按流逝时间推进，需要日历语义的功能显式传墙钟。
- 随机通过存档种子与计数推进，核心规则不用裸 `Math.random()`；在线推进与离线结算共用同一套规则。
- 核心规则只实现一份，页面与工具读导出单点；定位见 `docs/single-source.md`。
- 已分出功能目录：core 有 `combat/`、`expedition/`、`encounters/`、`invasion/`、`wormhole/`、`ai/`、`ships/fitting/`、`persistence/`；data 有 `combat/ships/`、`combat/anomalies/`、`invasion/cards/`、`wormhole/`；renderer 有 `features/combat/`、`features/ships/`、`features/expedition/`、`features/transport/`、`features/stations/`。
- 迁移未完成：共享 `state.ts`、`types.ts`、`save.ts` 与 renderer 引擎仍混合职责；未审的超 800 行文件先出拆分方案，不直接改代码。

## 静态数据与发布

- 舰船、装备、插件、物品、商品数字在 `packages/data/src/static/{ships,modules,plugs,items,market}.json`；敌舰、敌机、悬赏、入侵与探索编队数字在同目录其余 JSON，挂载参数在 `packages/core/src/static/foeMounts.json`。
- TypeScript 继续持有名称绑定、公式、引用、顺序、缺省与派生；字段契约不等于数值副本。
- 数据随游戏构建发布，不热换正在运行的战斗或订单；独立编辑器在游戏 Git 之外，游戏侧只保留共享字段契约与预览工具。

## 存档与网络边界（一句话）

存档是受结构版本门禁的运行时快照，静态内容以 git 为准；云存档与服务器权威演算未启动，桌面、网页与未来云端之间目前只有本地文件接口与同源网页单写者约束。

## 文档入口

`docs/catalog.md` 是任务指路页：工作入口（先读 `AGENTS.md`，默认 `rg` 排除 `**/archive/**`）、按任务查阅表（协作、待办、架构、单点、术语、静态参数、数值、文案、测试档、B 类审批）、维护规则（常用文档只留现行规则与未决事项）。旧记录集中在 `docs/archive/` 与 `docs/design/archive/`，没有船长明确的查阅要求时禁读，也不得转查 Git 历史绕过。

## 文档缺口

- `apps/server` 目录存在且 `.gitignore` 已有云存档 `data/` 规则，但 `docs/architecture.md` 分层表未收录它，并在「预留方向」写云存档尚未启动；需船长裁定是脚手架占位还是已启动服务。
- `web` 在分层表中单列，但仓库没有对应目录，实际是 desktop 的网页构建；引用时应写「desktop 的 web 构建」以免误解为独立应用。

## 相关页

- [[collab-gates]]：确认闸门（风险分档）与提交审批的触发条件
- [[docs-system]]：文档目录、索引生成与旧记录禁读边界
- [[roadmap-open-items]]：当前待办与未决事项的入口

## Sources

- `docs/architecture.md:6-20`（核心与分层）
- `docs/architecture.md:22-27`（确定性）
- `docs/architecture.md:29-37`（功能目录）
- `docs/architecture.md:39-45`（静态数据）
- `docs/architecture.md:47-61`（存档与保存）
- `docs/architecture.md:72-74`（预留方向）
- `docs/catalog.md:1-11`（文档目录 / 工作入口）
- `docs/catalog.md:13-32`（按任务查阅）
- `docs/catalog.md:34-40`（维护）
- `package.json:9-22`（workspaces 与 dev/build/test/typecheck 脚本）
- `.gitignore:19-25`（网页与 Electron 构建产物）
- `.gitignore:54-55`（云存档服务器数据目录不入库）

