# 待英文本地化记录

## 编队支援装备与离线简报（2026-11-01）

船长确认名称、目标数、概率、共享增伤及单份离线简报。英文未授权，新条目均延期、旧英文保留不回改公告。

| ID | 内容 | 状态 |
|---|---|---|
| `mod.fleetSupport.001` | 投送力场MK2名称 | 待本地化 |
| `mod.fleetSupport.002` | 投送力场MK3名称 | 待本地化 |
| `mod.fleetSupport.003` | 定向投送说明 | 待本地化 |
| `mod.fleetSupport.004` | 概率锁定说明 | 待本地化 |
| `bp.fleetSupport.001` | MK2图纸名称 | 待本地化 |
| `bp.fleetSupport.002` | MK3图纸名称 | 待本地化 |
| `ui.fleetSupport.001` | 周期与恢复/代价p1～p3 | 待本地化 |
| `ui.fleetSupport.002` | 概率/本舰/共享p1～p3 | 待本地化 |
| `ui.fleetSupport.003` | 叠加规则 | 待本地化 |
| `ui.offlineCombat.001` | 遇袭结果p1～p5 | 待本地化 |
| `ui.offlineCombat.002` | 补给与沉船p1～p3 | 待本地化 |
| `ui.offlineCombat.003` | 运输交付与收入p1～p3 | 待本地化 |
| `ui.offlineCombat.004` | 状态p1 | 待本地化 |
| `ui.offlineCombat.005` | 运输中 | 待本地化 |
| `ui.offlineCombat.006` | 折返 | 待本地化 |
| `ui.offlineCombat.007` | 到站停运 | 待本地化 |
| `ui.offlineCombat.008` | 中断停运 | 待本地化 |
| `ui.offlineCombat.009` | 运力航线变化 | 待本地化 |
| `ui.offlineCombat.010` | 败退停运 | 待本地化 |
| `ui.offlineCombat.011` | 维修不足停运 | 待本地化 |
| `ui.offlineCombat.012` | 损失停运 | 待本地化 |
| `ui.offlineCombat.013` | 非运输 | 待本地化 |
| `ui.offlineCombat.014` | 交战暂停 | 待本地化 |

## 后勤舰与修理无人机（2026-11-01）

船长确认后勤舰改维修量加成并新增40m³修理无人机。英文未授权，新增条目均留空延期，已有英文不改。

| ID | 内容 | 状态 |
|---|---|---|
| `item.repairDrone.001` | 军用修理无人机名称 | 待本地化 |
| `item.repairDrone.002` | 无人机修理说明 | 待本地化 |
| `ui.repairDrone.001` | 修理机分类 | 待本地化 |
| `ui.repairDrone.002` | 后勤输出加成，p1 | 待本地化 |
| `ui.repairDrone.003` | 周期、装甲、结构、组件，p1～p4 | 待本地化 |

## 运输承运弹窗（2026-11-01）

船长确认先选航线再输入货量、卡片收益去重与模糊威胁系数。新增`ui.haulLoad.001`至`.022`，用于承运确认、满载与单位费率、输入校验、毛收益、下一趟调整及粗略威胁区间；英文未授权，均`en: ''`、`enDeferred: true`。`.002/.011`含`{p1}`，`.018`含`{p1}/{p2}`。原有英文保留。

| ID | 内容 | 状态 |
|---|---|---|
| `ui.haulLoad.001` | 运输确认标题 | 待本地化 |
| `ui.haulLoad.002` | 舰队承运上限 | 待本地化 |
| `ui.haulLoad.003` | 最大承运量 | 待本地化 |
| `ui.haulLoad.004` | 满载单程收益 | 待本地化 |
| `ui.haulLoad.005` | 单位体积收益 | 待本地化 |
| `ui.haulLoad.006` | 满载时薪 | 待本地化 |
| `ui.haulLoad.007` | 所填货量单程收益 | 待本地化 |
| `ui.haulLoad.008` | 所填货量时薪 | 待本地化 |
| `ui.haulLoad.009` | 威胁系数 | 待本地化 |
| `ui.haulLoad.010` | 调整承运量 | 待本地化 |
| `ui.haulLoad.011` | 整数范围校验 | 待本地化 |
| `ui.haulLoad.012` | 取消 | 待本地化 |
| `ui.haulLoad.013` | 运输确认操作 | 待本地化 |
| `ui.haulLoad.014` | 满载快捷选择 | 待本地化 |
| `ui.haulLoad.015` | 无海盗威胁 | 待本地化 |
| `ui.haulLoad.016` | 威胁未知 | 待本地化 |
| `ui.haulLoad.017` | 系数参照提示 | 待本地化 |
| `ui.haulLoad.018` | 粗略倍数区间 | 待本地化 |
| `ui.haulLoad.019` | 毛收益提示 | 待本地化 |
| `ui.haulLoad.020` | 下一趟生效 | 待本地化 |
| `ui.haulLoad.021` | 调整确认操作 | 待本地化 |
| `ui.haulLoad.022` | 单位费率单位 | 待本地化 |

## 运输编队与普通海盗遇袭（2026-11-01）

本批新增`core.industrial.001`至`.009`及`ui.industrial.001`至`.015`，覆盖装载、出港/折返/交付、普通遇袭、货量输入、风险预览和到站停运状态；英文未授权，均`en: ''`、`enDeferred: true`。参数按各条中文模板登记并由`l10n:params`复核，既有英文保留。

| ID | 内容 | 状态 |
|---|---|---|
| `core.industrial.001` | 承运量校验 | 待本地化 |
| `core.industrial.002` | 编队运输开始 | 待本地化 |
| `core.industrial.003` | 中断折返 | 待本地化 |
| `core.industrial.004` | 到站结算 | 待本地化 |
| `core.industrial.005` | 运力变化停运 | 待本地化 |
| `core.industrial.006` | 在途换船限制 | 待本地化 |
| `core.industrial.007` | 普通海盗战斗开始 | 待本地化 |
| `core.industrial.008` | 遇袭终止返港 | 待本地化 |
| `core.industrial.009` | 遭遇胜利 | 待本地化 |
| `ui.industrial.001` | 装载输入标签 | 待本地化 |
| `ui.industrial.002` | 全队空间 | 待本地化 |
| `ui.industrial.003` | 到站停运 | 待本地化 |
| `ui.industrial.004` | 停运已安排 | 待本地化 |
| `ui.industrial.005` | 当前与目标货量 | 待本地化 |
| `ui.industrial.006` | 空载就位 | 待本地化 |
| `ui.industrial.007` | 折返状态 | 待本地化 |
| `ui.industrial.008` | 遇袭暂停 | 待本地化 |
| `ui.industrial.009` | 风险预览 | 待本地化 |
| `ui.industrial.010` | 基准数据缺口 | 待本地化 |
| `ui.industrial.011` | 运输规则 | 待本地化 |
| `ui.industrial.012` | 危险航段说明 | 待本地化 |
| `ui.industrial.013` | 提前中断说明 | 待本地化 |
| `ui.industrial.014` | 虚拟货占用说明 | 待本地化 |
| `ui.industrial.015` | 编队收益 | 待本地化 |
| `ui.commsIndustrialRisk.001` | 首次多矿船通讯标题 | 待本地化 |
| `ui.commsIndustrialRisk.002` | 首次多矿船通讯提醒 | 待本地化 |
| `ui.commsIndustrialRisk.003` | 工业质量与护航说明 | 待本地化 |
| `ui.commsIndustrialRisk.004` | 检查编队跳转 | 待本地化 |

## 射程电子战（2026-10-31）

船长确认强度制和战内/战外显示，未授权英文。`ui.rangeEw.001`至`ui.rangeEw.018`为电子战标题、双方强度、净优势、压制系数、基础/船体/装备拆分、电子舱倍率及实际/预计射程、未知敌情；均中文回退、`enDeferred: true`。`ui.rangeEw.004/005/007/008/011/012`含`{p1}`，`.013`含`{p1}`至`{p5}`。

| ID | 内容 | 状态 |
|---|---|---|
| `ui.rangeEw.001` | 电子战 | 待本地化 |
| `ui.rangeEw.002` | 我方强度 | 待本地化 |
| `ui.rangeEw.003` | 敌方强度 | 待本地化 |
| `ui.rangeEw.004` | 我方优势 | 待本地化 |
| `ui.rangeEw.005` | 敌方优势 | 待本地化 |
| `ui.rangeEw.006` | 势均力敌 | 待本地化 |
| `ui.rangeEw.007` | 敌方受压与系数 | 待本地化 |
| `ui.rangeEw.008` | 我方受压与系数 | 待本地化 |
| `ui.rangeEw.009` | 无射程压制 | 待本地化 |
| `ui.rangeEw.010` | 射程电子战强度 | 待本地化 |
| `ui.rangeEw.011` | 船体额外强度 | 待本地化 |
| `ui.rangeEw.012` | 本舰电子舱强度加成 | 待本地化 |
| `ui.rangeEw.013` | 基础、船体、装备与倍率明细 | 待本地化 |
| `ui.rangeEw.014` | 电子战前 | 待本地化 |
| `ui.rangeEw.015` | 当前射程 | 待本地化 |
| `ui.rangeEw.016` | 预计射程 | 待本地化 |
| `ui.rangeEw.017` | 电子战预览 | 待本地化 |
| `ui.rangeEw.018` | 敌方未知时不可预计 | 待本地化 |
| `ui.rangeEw.019` | 强度相加与净优势换算 | 待本地化 |
| `ui.rangeEw.020` | 实际射程受下限限制 | 待本地化 |
| `ui.rangeEw.021` | 开场预览阶段 | 待本地化 |
| `ui.rangeEw.022` | 已公开近距支援条件情形 | 待本地化 |
| `ui.rangeEw.023` | 已公开远距支援条件情形 | 待本地化 |

## 统一指挥预算（2026-10-30）

船长已授权中文实现，未启动英文；以下条目`en: ''`、`enDeferred: true`，英文界面回退中文。三个技能的覆盖同样读取这些条目，不伪填英文。

| ID | 中文依据与范围 | 状态 |
| --- | --- | --- |
| `skill.command.001` | 编队指挥基础 | 待本地化 |
| `skill.command.002` | 每级5点容量 | 待本地化 |
| `skill.command.003` | 编队协同指挥 | 待本地化 |
| `skill.command.004` | 每级7点容量 | 待本地化 |
| `skill.command.005` | 编队统合指挥 | 待本地化 |
| `skill.command.006` | 每级8点容量 | 待本地化 |
| `ui.command.001` | 常驻战斗编队入口 | 待本地化 |
| `ui.command.002` | 成本/容量和舰数/上限，`{p1}`至`{p4}` | 待本地化 |
| `ui.command.003` | 每舰成本属性名 | 待本地化 |
| `ui.command.004` | 出勤期间不可调整 | 待本地化 |
| `ui.command.005` | 技能书名 | 待本地化 |
| `ui.command.006` | 我的舰队卡牌取消编入操作（2026-10-31船长确认融合） | 待本地化 |
| `ui.commsFleetUnlock.001` | 多舰编队解锁通讯主题；中文稿经船长批准（2026-10-31） | 待本地化 |
| `ui.commsFleetUnlock.002` | 声望20达到后多舰编队权限开放通讯正文；中文稿经船长批准（2026-10-31） | 待本地化 |
| `ui.commsFleetUnlock.003` | 编队指挥技能归入舰船训练科目的通讯正文；中文稿经船长批准（2026-10-31） | 待本地化 |
| `ui.commsFleetUnlock.004` | 通讯跳转按钮「前往舰船技能」；中文稿经船长批准（2026-10-31） | 待本地化 |
| `core.command.001` | 空编队拒绝 | 待本地化 |
| `core.command.002` | 重复或缺失舰拒绝 | 待本地化 |
| `core.command.003` | 超舰数拒绝，`{p1}` | 待本地化 |
| `core.command.004` | 累计声望解锁，`{p1}` | 待本地化 |
| `core.command.005` | 超预算拒绝，`{p1}`、`{p2}` | 待本地化 |

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
