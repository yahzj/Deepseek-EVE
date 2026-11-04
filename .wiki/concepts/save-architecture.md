---
id: save-architecture
title: 存档结构与迁移边界
category: concepts
tags: [concept, architecture, data]
summary: 存档只收运行时快照并受 v31 结构门禁；静态内容以 git 为准，读写走清洗白名单与 FIFO 事务；迁移、往返与网页文件由 save:* 工具取证；船长真档与 server/data 不入库，云存档尚未启动。
tier: supporting
source: docs-distill:save-architecture
confidence: extracted
created: 2026-11-02T13:59:59.753Z
updated: 2026-11-02T13:59:59.753Z
---

> 知识地图摘要页：权威原文以 Sources 为准。

## 结论先行

- 存档只装**运行时状态**；舰船、装备、物品、市场等静态数字住在 `packages/data` 的 JSON 里，以 git 为唯一来源，不进存档、也不随档复制。
- 存档是结构版本化对象：`{ format: "whale-idle-save", version, savedAtWallMs, state }`；结构版本与读取下限均为 v31，低版本拒读、未来版本提示升级。
- 版本指**结构**，不是保存日期；数据格式版本与玩家存档版本彼此独立。
- 旧版本编号迁移与全部历史补偿已退役：未兑现补偿停止，已到手资产不回收；启动拒读时保留旧文件并暂停覆盖，未经玩家放行不能自动另写新档。
- 桌面主档、恢复与备份共用同一保存域队列；网页侧靠 Web Locks 保证单写者，第二页只读。
- 船长真档 `docs/test-saves/save-*.json` 一律不入库、只读；`apps/server/data/` 同样不入库，云存档尚未启动。

## 什么进存档，什么不进

| 对象 | 是否进存档 | 依据 |
|---|---|---|
| `state` 运行时快照（进度、库存、活动、虫洞账等） | 进 | 存档外层 `state` 字段即运行快照 |
| 静态数字 JSON（ships/modules/items/market、敌舰与编队等） | 不进，以 git 为准 | 数据随构建发布，不热换正在运行的战斗或订单 |
| 名称绑定、公式、引用、顺序、缺省与派生（TypeScript） | 不进 | 字段契约不等于数值副本 |
| 内存日志 `state.logs` | 不落盘 | 写盘剥离日志，内存上限不等于存档容量 |
| 构建产物（`dist/`、`dist-web/`、`release/`、`content-csv/`、`foe-csv/`） | 不进库、更不进存档 | 均可重建，源数据以 git 为准 |
| 船长真档 `docs/test-saves/save-*.json`（含双层 `.json.json`） | 不入库 | 真档只读，只在本机用于迁移取证 |
| `apps/server/data/`（SQLite 与本地运行产物） | 不入库 | 云存档服务器数据不随仓库分发 |

## 读档与写档顺序

- 读档四步：解析 → 格式与版本校验 → 当前字段清洗及默认值 → 可用状态。
- 新增随档字段必须同时维护写入与清洗白名单，并验证往返；下一次结构变更须另行确定兼容方案。
- 保存事务在同一保存域按 FIFO 处理：入队固定快照、唯一临时文件、成功后覆盖、失败不毒化后续请求。
- 桌面主档、恢复与备份共用该队列；铁人账本有独立串行读写，主档回执需等待账本处理。
- 手动备份绑定本次已保存的快照，不重新抓取当前内存状态。

## 桌面、网页与云存档的边界

- 桌面：渲染层 `game` 目录负责读写存档，文件能力由 main/preload 的受控接口提供。
- 网页文件重连：先暂停写入并失效旧请求，等在途写完再严格读文件；权限不等于数据一致，进度不同时由玩家选择。取消保持暂停；部分介质成功要明确报告，不能回滚已成功介质；导入、恢复与重连不新增自动备份。
- 同源网页：通过 Web Locks 取得单写者，第二页只读，失锁或异常转保护性只读；不用本地存储租约冒充互斥。页面锁不能阻止外部编辑器修改文件。
- 云存档：`docs/architecture.md` 明确「云存档与服务器权威演算尚未启动」，运行时/界面与 core 分离只是预留条件，不代表已有账号、云同步或在线反作弊服务；`apps/server` 目录仅以 `data/` 忽略规则出现。

## 迁移与检查工具

| 脚本 | 用途（按脚本名与文档推断） | 位置 |
|---|---|---|
| `save:migrate` | 迁移检查；真档只在本机跑此取证 | `package.json:35` |
| `save:roundtrip-audit` | 存档往返审计（写入/清洗白名单一致性） | `package.json:36` |
| `save:guard-check` | 存档护栏检查 | `package.json:89` |
| `save:webfile-check` | 网页文件读写检查 | `package.json:94` |
| `save:reconnect-check` | 浏览器重连场景检查 | `package.json:95` |
| `save:diff` | 存档差异对比 | `package.json:110` |
| `ironman:check` | 铁人账本一致性 | `package.json:48` |
| `save:whfullhold` / `save:whexpedition` | 合成虫洞测试档生成器 | `package.json:37-38` |

## 船长真档只读保护（.gitignore 兜底）

- 规则本体：`docs/test-saves/save-*.json` 与 `docs/test-saves/save-*.json.json` 一律不进库（`.gitignore:45-46`）。
- 背景：`docs/test-saves/` 里除仓库自带门槛档 `test-save-*.json` 外，还有船长从游戏导出的真档 `save-<时间戳>.json`；迁移检查跑过会多一层 `.json`。
- 纪律：真档只读、只在本机用于 `save:migrate` 取证；此前的 `git add -A docs` 误带真档进过提交，已在同一提交撤回，故加规则兜底。
- 开发默认用独立合成档，不拿个人真档当可丢弃夹具；读写位置与恢复说明见 `docs/test-saves/README.md`。

## 已知缺口与风险

- 文档只给出「下一次结构变更须另行确定兼容方案」，没有写具体兼容策略；改动存档结构前必须走确认闸门（`AGENTS.md` §2：存档结构属于必确认项）。
- `apps/server` 与「云存档尚未启动」并存的解释未在文档中说明，源码不在本页取证范围内，需船长确认其状态。
- 页面锁只覆盖同源网页内部，不阻止外部编辑器改文件；跨端一致性仍靠玩家选择与显式重连流程。

## 相关页

- [[data-content-editing]]：静态内容与字段契约的编辑与导出流程
- [[project-overview]]：仓库分层、依赖方向与根脚本入口

## Sources

- `docs/architecture.md:47-61`（存档与保存）
- `docs/architecture.md:39-45`（静态数据）
- `docs/architecture.md:72-74`（预留方向）
- `docs/catalog.md:13-32`（按任务查阅）
- `.gitignore:19-35`（构建与内容产物不入库）
- `.gitignore:41-46`（船长的真档）
- `.gitignore:54-55`（云存档服务器数据目录不入库）
- `package.json:9-22`（workspaces、test 与 typecheck）
- `package.json:35-38`（save:migrate / save:roundtrip-audit / 合成档）
- `package.json:48`（ironman:check）
- `package.json:89`（save:guard-check）
- `package.json:94-95`（save:webfile-check / save:reconnect-check）
- `package.json:110`（save:diff）

