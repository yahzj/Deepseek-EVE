# 待英文本地化记录

## 射程确认提示（2026-10-23）

- 来源：船长确认的`docs/design/battle-range-confirm-clarity-20261023.md`，未授权准备英文。
- `ui.battleRangeConfirm.001`：射程变化且能确认舰船名单不同时，提示本次参战舰队与上次不同。
- `ui.battleRangeConfirm.002`：提示上次与本次最大射程，含 `{p1}`、`{p2}`。
- 两项均以`en: ''`、`enDeferred: true`登记；英文界面按本地化规则回退中文。

| ID | 中文依据与范围 | 状态 |
| --- | --- | --- |
| `ui.battleRangeConfirm.001` | 本次参战舰队与上次不同 | 待本地化 |
| `ui.battleRangeConfirm.002` | 最大射程变化：`{p1}` m → `{p2}` m | 待本地化 |

## 信号空间自动探索科技（2026-10-22）

- 来源：船长已确认的`docs/design/signal-auto-tech-20261022.md`，未授权准备英文。
- `ui.signalAuto.001`：T3科技名称「信号空间探索」；`ui.signalAuto.002`：解锁与60%/70%/80%收益说明。
- `ui.signalAuto.003`：不带AI占用的参与舰数；`ui.signalAuto.004`：自动探索入口悬停，移除核心占用说明。
- `core.signalAuto.001`：0级点击提示前往谜质科技研究；`core.signalAuto.002`、`core.signalAuto.003`：新派队/返航日志删除AI占用与释放表述，保留原有事件与列表槽。
- 上述条目均以`en: ''`、`enDeferred: true`登记，英文界面回退中文；旧英文与历史日志保持，不自动起译。

| ID | 中文依据与范围 | 状态 |
| --- | --- | --- |
| `ui.signalAuto.001` | T3科技名「信号空间探索」 | 待本地化 |
| `ui.signalAuto.002` | 科技解锁与60/70/80%收益说明 | 待本地化 |
| `ui.signalAuto.003` | 自动队参与舰数 | 待本地化 |
| `ui.signalAuto.004` | 自动探索入口悬停 | 待本地化 |
| `core.signalAuto.001` | 未研究时点击提示研究去处 | 待本地化 |
| `core.signalAuto.002` | 新派队日志不再占核心 | 待本地化 |
| `core.signalAuto.003` | 新返航日志不再释放核心 | 待本地化 |

## 停靠统一提示（2026-10-13待中文审定）

来源：停靠/远程管理统一方案的其他中文提示仍归入`docs/design/activity-gate-registry-20261001.md`等待中文审定；不属于英文待译清单。`ui.fragmentRedeem.004`已有英文覆盖，已从本清单移除。装卸、船上出售和到港接续提示尚未分配ID，中文和接续方案确定后再登记。

## 既有搁置项

- 成就卡名/说明、舰种类名、通讯势力简介的早先英文缺口保持原搁置状态，入口见`docs/roadmap.md`，不因建立本记录自动启动。
- 后续按明确范围追加，只记任务和中文依据，不自动扫描全仓起译或批量填英文；已有英文及外部技能文件不作无关修改。
