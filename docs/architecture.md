# 架构文档

> 现行架构与兼容边界。工作纪律见`AGENTS.md`和`docs/development-conventions.md`。
> 版本沿革、里程碑、旧验收与迁移过程已封存；没有船长查阅要求，禁止读取或检索旧记录。

## 核心与分层

游戏由确定性状态与时间演算驱动，界面负责展示和发送命令。

| 层 | 职责与约束 |
|---|---|
| `packages/core` | 状态、命令、时间推进、战斗、经济与种子随机；不依赖DOM、Node或界面框架 |
| `packages/data` | 内容目录、静态参数、文本与派生定义；类型来自core，不复制最终运行快照 |
| `packages/ui` | 共享界面组件与样式 |
| `apps/desktop/src/renderer/src/game` | 引擎封装、订阅、读写存档、离线结算、心跳与命令桥接 |
| 桌面main/preload | Electron运行时和受控文件接口 |
| `web` | 独立网页构建，复用renderer和源码包 |
| `tools` | 检查、仿真、内容编辑与合成测试档；不作为玩家运行依赖 |

内部包通过工作区与构建别名消费TypeScript源码。界面调用core公开接口，不反向读取数据表另算规则。

## 确定性

- `advanceGame`按流逝时间推进；需要日历语义的功能显式传墙钟。
- 随机通过存档种子与计数推进；核心规则不用裸`Math.random()`。
- 在线推进与离线结算共用规则；步骤顺序、随机消费和独立随机子流属于行为契约。
- 核心规则只实现一份，页面和工具读导出单点。实现定位见`docs/single-source.md`。

## 功能目录

| 层 | 已分出的目录 |
|---|---|
| core | `combat/`、`expedition/`、`encounters/`、`invasion/`、`wormhole/`、`ai/`、`ships/fitting/`、`persistence/` |
| data | `combat/ships/`、`combat/anomalies/`、`invasion/cards/`、`wormhole/` |
| renderer | `features/combat/`、`features/ships/`、`features/expedition/`、`features/transport/`、`features/stations/` |

部分旧路径保留具名兼容出口，实际实现归功能目录；源码取证须定位实现。其余模块迁移尚未完成，共享`state.ts`、`types.ts`、`save.ts`和renderer引擎仍有混合职责。未审的超800行文件先出拆分方案，不直接改代码。

## 静态数据

- 舰船、装备、插件、物品和商品静态数字在`packages/data/src/static/{ships,modules,plugs,items,market}.json`。
- 敌舰、敌机、悬赏、入侵和探索编队数字在同目录的`foeShips/foeDrones/bounties/invasionFleets/wormholeFleets.json`；挂载参数在`packages/core/src/static/foeMounts.json`。
- TypeScript继续持有名称绑定、公式、引用、顺序、缺省与派生。字段契约不等于数值副本，格式版本与玩家存档版本独立。
- 数据随游戏构建发布，不热换正在运行的战斗或订单。
- 独立编辑器在`H:\大鲸鱼\数据编辑器`，不属于游戏Git；游戏侧保留共享字段契约、事务与引擎预览工具。操作见`docs/data-editor.md`。

## 存档与保存

存档格式为`{ format: "whale-idle-save", version, savedAtWallMs, state }`。结构版本和读取下限均为v31，以`CURRENT_STATE_VERSION`和`MIN_SUPPORTED_SAVE_VERSION`为准；低版本拒读，未来版本提示升级。版本指结构，不是保存日期。

读档顺序为解析、格式与版本校验、当前字段清洗及默认值、可用状态。新增随档字段同时维护写入和清洗白名单，并验证往返；下一次结构变更须另行确定兼容方案。

旧版本编号迁移与全部历史补偿已退役。未兑现补偿停止，已到手资产不回收；当前字段清洗、资产归位和正常战斗、任务、成就奖励继续生效。启动拒读保留旧文件并暂停覆盖，未经玩家明确放行不能自动另写新档替代。

保存事务在同一保存域按FIFO处理：入队固定快照、唯一临时文件、成功后覆盖、失败不毒化后续请求。桌面主档、恢复与备份共用队列；铁人账本有独立串行读写，主档回执等待账本处理。手动备份绑定本次已保存快照。

网页文件重连先暂停写入并失效旧请求，等在途写完再严格读文件。权限不等于数据已一致；进度不同时由玩家选择。取消保持暂停，部分介质成功要明确报告，不能回滚已成功介质。导入、恢复和重连不新增自动备份。

同源网页通过Web Locks取得单写者；第二页只读，失锁或异常保护性只读，不用本地存储租约冒充互斥。页面锁不能阻止外部编辑器修改文件。

个人真档不作可丢弃夹具。默认使用独立合成档；读写位置及恢复说明见`docs/test-saves/README.md`。日志只在本局内存滚动，写盘剥离`state.logs`，不把内存日志上限当成存档容量。

## 活动与探索

- 作业状态和互斥由core判定。主控、AI副船和产业线分别记账，界面不从动画倒推忙态。
- 航行路径、耗时、停靠、返航及到港待办走对应core单点；换驾驶和停止动作不得丢失原船在途货物。
- 星系扫描是独立扫描艇任务，不占主控活动；完成待查看与在途进度分别保存。
- 公开玩法称「信号空间」；未来虫洞使用独立实验规则和入口标记。二者不能通过普通debug开关互换，不因共用底层而混改规则。
- 虫洞整备、有限物资、地点实物、撤离、巡逻及事件账有独立状态与清洗；页面只读视图和发命令。
- 离线上限读取`simulation.ts`和相关技能、模式加成，不使用旧里程碑中的固定读数。时钟回拨不补负时间。

## 服务端与仓库

（2026-11-05 更新）服务端拆成两部分，都不在游戏主树内：

| 仓库 | 本地路径 | 远端 | 职责 |
|---|---|---|---|
| 游戏主仓 | `D:\Documents\GitHub\Deepseek-EVE` | `https://github.com/yahzj/Deepseek-EVE.git` | Electron 客户端 + core/data/ui |
| 云端服务（Node） | `D:\Documents\GitHub\deepseek-EVE-Background` | `https://github.com/yahzj/deepseek-EVE-Background.git` | 云存档、聊天、账号、现货订单簿、双分录账本（端口 8787） |
| 股市引擎（Go） | `D:\Documents\GitHub\deepseek-EVE-Background\exchange-server-go` | 随 Background 父仓一起推送（`bd367e1`） | 回合制撮合、行情引擎、事件、AI 人格、债券/基金（端口 8788） |

权威模型仍是**混合权威**：存档由客户端演算，物品与信用点的进出走服务器账本；证券交易所由 Go 服务按真实墙钟 7×24 运行，资金侧 `EXCHANGE_LOCAL_SAVE_MODE=1`（存档币本地为准）。旧版 `apps/server/` 仅历史快照，见该目录 README。
