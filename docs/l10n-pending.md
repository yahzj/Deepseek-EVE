# 待英文本地化记录

## 守墓入侵调参与装备（2026-10-17归档）

现行中文结论见`docs/design/weekend-invasion.md`§十二；船长未授权开始英文。`ui.gravekeeperRetune.001`为陵寝重构的已确认定性说明与读取参数的复活间隔/范围，`FOE_MOUNTS.foe-mount-d-reconstruction`为新挂载名「陵寝重构协议」；两处均待本地化，英文回退中文，不修改旧英文。

| ID / 范围 | 中文依据 | 状态 |
|---|---|---|
| `ui.gravekeeperRetune.001` | 陵寝重构协议说明与复活间隔/范围 | 待本地化 |
| 挂载目录名称 foe-mount-d-reconstruction | 陵寝重构协议 | 待本地化 |

## 守墓入侵掉落装备（2026-10-17）

船长逐条裁定三件效果并要求「开始实现」，未授权准备英文。现行中文结论见`docs/design/weekend-invasion.md`§十二；`mod.gravekeeperGear.001`至`.006`为三件名称/定性说明，`ui.gravekeeperGear.001`至`.009`为苏生、危机炮台/无人机分支与磁轨叠层规格/当前层数，均登记待本地化、唯一表使用`enDeferred`，英文覆盖走中文回退，不修改旧英文。

| ID | 中文依据 | 状态 |
|---|---|---|
| `mod.gravekeeperGear.001` | 苏生损管装置 | 待本地化 |
| `mod.gravekeeperGear.002` | 苏生定性说明 | 待本地化 |
| `mod.gravekeeperGear.003` | 危机超载协议 | 待本地化 |
| `mod.gravekeeperGear.004` | 危机定性说明 | 待本地化 |
| `mod.gravekeeperGear.005` | 磁轨蓄能炮 | 待本地化 |
| `mod.gravekeeperGear.006` | 磁轨定性说明 | 待本地化 |
| `ui.gravekeeperGear.001` | 苏生维修标签 | 待本地化 |
| `ui.gravekeeperGear.002` | 苏生维修规格 | 待本地化 |
| `ui.gravekeeperGear.003` | 危机超载标签 | 待本地化 |
| `ui.gravekeeperGear.004` | 空盾/炮台/速度规格 | 待本地化 |
| `ui.gravekeeperGear.005` | 无人机超载标签 | 待本地化 |
| `ui.gravekeeperGear.006` | 无人机时间规格 | 待本地化 |
| `ui.gravekeeperGear.007` | 磁轨蓄能标签 | 待本地化 |
| `ui.gravekeeperGear.008` | 附伤与装填叠层规格 | 待本地化 |
| `ui.gravekeeperGear.009` | 当前蓄能层与附伤比例 | 待本地化 |

## 守墓者入侵（2026-10-17归档）

来源：船长确认守墓者入侵方案并要求「开始实现」，2026-10-17完成归档合入。现行结论见`docs/design/weekend-invasion.md`§十二；过程由实现提交历史保留。未授权准备英文，以下新增条目仅登记待译；内容覆盖调用共享中文回退，不写新英文。

| id / 范围 | 中文依据 | 状态 |
|---|---|---|
| `ship.gravekeeper.001` | 巡陵级 | 待本地化 |
| `ship.gravekeeper.002` | 碑卫级 | 待本地化 |
| `ship.gravekeeper.003` | 守誓级 | 待本地化 |
| `ship.gravekeeper.004` | 永陵级 | 待本地化 |
| `ano.gravekeeper.001` | 巡哨舰队 | 待本地化 |
| `ano.gravekeeper.002` | 碑卫舰队 | 待本地化 |
| `ano.gravekeeper.003` | 守誓舰队 | 待本地化 |
| `ano.gravekeeper.004` | 永陵舰队 | 待本地化 |
| `ano.gravekeeper.005` | 入侵卡说明 | 待本地化 |
| `item.gravekeeper.001` | 旗舰黑匣名称 | 待本地化 |
| `item.gravekeeper.002` | 旗舰黑匣说明 | 待本地化 |
| `ui.gravekeeper.001` | 苏生协议规格 | 待本地化 |
| `ui.gravekeeper.002` | 陵墓装甲规格 | 待本地化 |
| `ui.gravekeeper.003` | 守墓镀层装甲规格 | 待本地化 |
| `ui.gravekeeper.004` | 护盾蓄能装置规格 | 待本地化 |
| `ui.gravekeeper.005` | 苏生就绪/使用与两段剩余时间 | 待本地化 |
| `ui.gravekeeper.006` | 镀层层数 | 待本地化 |
| `ui.gravekeeper.007` | 蓄能主炮累计攻击与倍率 | 待本地化 |
| `ui.gravekeeper.008` | 已启动状态 | 待本地化 |
| `ui.gravekeeper.009` | 协议已使用状态 | 待本地化 |
| `core.weekend.026` | 入侵族名守墓者 | 待本地化 |
| `FOE_MOUNTS`四件新挂载名称、`d-inv`残骸说明 | 采用船长指定件名与现有族称，英文暂回退中文 | 待本地化 |

## 舰船血量与作业优化公告（2026-10-13确认）

来源：船长确认五条公告并要求合入；公告`ann-ship-hp-station-20261013`。英文未获准备授权，条目`enDeferred: true`，英文界面按共享规则回退批准中文，已有英文不改。

| id | 改动点 | 状态 |
|---|---|---|
| `ano.hpStation.001` | 标题：舰船血量提升与作业优化 | 待本地化 |
| `ano.hpStation.002` | 分类：数值 | 待本地化 |
| `ano.hpStation.003` | 全舰与固定插件加血，普通护盾比例下调；无人机血量、固定维修及特殊回满保持（2026-10-13首条改稿获准） | 待本地化 |
| `ano.hpStation.004` | 新旗舰共享血池30万，旧锁池与贡献保持 | 待本地化 |
| `ano.hpStation.005` | 高槽禁基础炮与近盲伤害30% | 待本地化 |
| `ano.hpStation.006` | 远程管理与目标舰停靠操作 | 待本地化 |
| `ano.hpStation.007` | 真实返航后自动启动，随档待办与取消 | 待本地化 |

## 停靠统一提示（2026-10-13待中文审定）

来源：已确认的停靠/远程管理统一方案，现行与提示草稿归入`docs/design/activity-gate-registry-20261001.md`；公告已经另获批准并写入，其他提示尚未实施。未准备英文，不修改既有英文。

| id | 改动点 | 状态 |
|---|---|---|
| `ui.fragmentRedeem.004` | 可用碎片来源：仓库可远程取用，货仓仅停靠后合并；中文草稿待审 | 待中文审定后登记译文 |
| 尚未分配 | 装卸/船上出售停靠拒因及到港接续提示，先等中文和接续方案裁定 | 未准备 |

## 高槽占用基础炮日志（2026-10-13确认）

来源：船长确认「高槽已装配装备，基础舰炮已禁用；未装配攻击武器。」只用于抵达悬赏目标、进入交火的事件日志；空高槽仍保留基础炮。现行记录`docs/design/v12-combat.md`加血小节。未授权英文准备，英文界面按共享规则回退中文，既有词条和历史日志不改。

| id | 改动点 | 状态 |
|---|---|---|
| `core.expedition.062` | 高槽占用且无攻击武器的抵达日志，目标名和窝点尾注参数保留 | 待本地化 |

## 货柜拆解产物记录（2026-10-13确认）

来源：船长确认货柜卡增加上一批产物入口、名称和数量逐行显示及现有富文本悬停；本批工作记录`docs/design/unbox-result-ledger-20261013.md`。只登记中文，未准备英文，英文界面按共享规则回退中文。

| id | 改动点 | 状态 |
|---|---|---|
| `ui.IndustryPage.148` | 上一批拆解产物标题 | 待本地化 |
| `ui.IndustryPage.149` | 记录入口悬停与无障碍名称 | 待本地化 |
| `ui.IndustryPage.150` | 本批尚无产物记录空态 | 待本地化 |
| `ui.IndustryPage.151` | 收起拆解记录提示 | 待本地化 |

## 黑市开放通讯（2026-10-12确认）

来源：船长确认累计协会声望100时由黑市商人告知市场页入口；批准中文稿及现行规则归入`docs/design/comms-20260911.md`§20。消息`msg-black-market-unlock`使用下列ID，未授权英文准备，英文界面回退批准中文；旧通讯及英文保持。

| id | 改动点 | 状态 |
|---|---|---|
| `ui.commsBlackMarket.001` | 标题：有些货，该给你看看了 | 待本地化 |
| `ui.commsBlackMarket.002` | 商人认可玩家在协会的名声 | 待本地化 |
| `ui.commsBlackMarket.003` | 告知从市场页的黑市入口看货 | 待本地化 |
| `ui.commsBlackMarket.004` | 商人口吻提示先看货再看价 | 待本地化 |
| `ui.commsBlackMarket.005` | 前往市场跳转提示 | 待本地化 |

## 星系动态试作（2026-10-09）

| id | 改动点 | 状态 |
|---|---|---|
| `ui.stellarMotion.001` | 显卡动态着色不可用的静态降级提示 | 待本地化 |

> 状态：仅登记，未开始准备；2026-10-09。
> 船长原话：「之后的所有英文本地化，除非我强调开始准备，否则只加入待本地化的文档记录里」。
> 中文确认、实现、合入、发布许可均不视为英文准备授权；明确要求开始准备后才起草、审核、写入英文及结清记录。

## 酸液仅装甲减抗（2026-10-09确认）

来源：船长确认爆虫与玩家酸液投射器都仅减少装甲抗性。中文依据归入 `docs/design/weekend-invasion.md` 现行机制及 `docs/design/alien-invasion-loot-20261009.md` 后续裁定，过程稿由`2cf5339d`历史保留；未授权英文准备，旧英文及历史公告保持，敌方现行提示另取待译ID。

| id | 改动点 | 状态 |
|---|---|---|
| `ui.alienArmor.001` | 爆虫机制说明：全队装甲三系减抗，触发、叠加与负抗性规则不变 | 待本地化 |
| `ui.alienArmor.002` | 战场腐蚀累计提示：仅装甲全抗性 | 待本地化 |

既有待译 `mod.alienLoot.002` / `ui.alienLoot.002` 中文同步仅装甲减抗，继续待译，不生成英文。

## 无人机启动时间与靶场（2026-10-09确认）

船长确认启动时间改名及靶场，英文只登记待译，不起草新译文。`mod.launchCalibration.006`、`ui.launchCalibration.001/.004`采用新中文；已有`ui.shipInfo.074/.167`英文保持，中文改为无人机启动时间，待后续授权统一英文术语。

`mod.copy.070`机库说明也改用无人机启动时间，已有英文保留，待后续授权统一。

| id | 改动点 | 状态 |
|---|---|---|
| `ui.fittingRange.001` | 进入靶场 | 待本地化 |
| `ui.fittingRange.002` | 靶机 | 待本地化 |
| `ui.fittingRange.003` | 交战距离 | 待本地化 |
| `ui.fittingRange.004` | 测试层 | 待本地化 |
| `ui.fittingRange.005` | 累计伤害 | 待本地化 |
| `ui.fittingRange.006` | 平均DPS | 待本地化 |
| `ui.fittingRange.007` | 命中/发射 | 待本地化 |
| `ui.fittingRange.008` | 虚拟供给 | 待本地化 |
| `ui.fittingRange.010` | 重置测试 | 待本地化 |

## 星系星图HUD（2026-10-09确认）

船长确认探索指挥台布局，复用已有标签，仅以下三项新增中文、英文未获准备授权：

| id | 改动点 | 状态 |
|---|---|---|
| `ui.stellarHud.001` | 探索任务区标签 | 待本地化 |
| `ui.stellarHud.002` | 目标详情区标签 | 待本地化 |
| `ui.stellarHud.003` | 探测机生产区标签 | 待本地化 |

## 异形入侵掉落装备

2026-10-09船长确认颚钳改为战斗机，`item.jawclaw.002`中文说明改为「动能战斗无人机，适合中距离交战与持续攻击。」；既有ID继续待译，不准备新英文。

船长确认中文方案（2026-10-09），英文尚未获准备授权。以下内容仅登记待译：

| id | 改动点 | 状态 |
|---|---|---|
| `mod.alienLoot.001` | 酸蚀弹射器名称 | 待本地化 |
| `mod.alienLoot.002` | 酸蚀弹射器说明 | 待本地化 |
| `mod.alienLoot.003` | 增压加速腔名称 | 待本地化 |
| `mod.alienLoot.004` | 增压加速腔说明 | 待本地化 |
| `ui.alienLoot.001` | 酸蚀标签 | 待本地化 |
| `ui.alienLoot.002` | 酸蚀规格 | 待本地化 |
| `ui.alienLoot.003` | 渐增机动标签 | 待本地化 |
| `ui.alienLoot.004` | 渐增机动规格 | 待本地化 |
| `ui.alienLoot.005` | 酸蚀层数与剩余时长 | 待本地化 |

已有 `item.jawclaw.001/.002` 和 `bp.factionDrone.005/.010` 待译记录同步采用玩家机新名，数值和敌方名称不变。

## 综合机制公告短句

目标：`ann-balance-mechanics-summary-20261008`的38个短句，仅正文待译，原英文标题/类别保留。
中文权威：`packages/data/src/l10n/table.ts`；批准依据：船长确认本轮短稿，实现`d581aef8`；原讨论稿从该提交Git历史读取。早先草稿中的英文不采用、不完善、不写入；新增英文工作尚未启动。

| id | 改动点 | 状态 |
|---|---|---|
| `ano.mechanicsBrief.001` | 沉船整船回收 | 待本地化 |
| `ano.mechanicsBrief.002` | 工程技能 | 待本地化 |
| `ano.mechanicsBrief.003` | 装备保全率 | 待本地化 |
| `ano.mechanicsBrief.004` | 战损插件 | 待本地化 |
| `ano.mechanicsBrief.005` | 重复插件与扩槽限装 | 待本地化 |
| `ano.mechanicsBrief.006` | 免费退库 | 待本地化 |
| `ano.mechanicsBrief.007` | 沉船装配方案 | 待本地化 |
| `ano.mechanicsBrief.008` | 主动拆船回收 | 待本地化 |
| `ano.mechanicsBrief.009` | 逐门命中 | 待本地化 |
| `ano.mechanicsBrief.010` | 开场装填 | 待本地化 |
| `ano.mechanicsBrief.011` | 近防读档修复 | 待本地化 |
| `ano.mechanicsBrief.012` | 捕获网减速修复 | 待本地化 |
| `ano.mechanicsBrief.013` | 护盾充能力场 | 待本地化 |
| `ano.mechanicsBrief.014` | 巨构协处理器代价 | 待本地化 |
| `ano.mechanicsBrief.015` | 装备代价叠加 | 待本地化 |
| `ano.mechanicsBrief.016` | 负面收益递减 | 待本地化 |
| `ano.mechanicsBrief.017` | 无人机储备甲板 | 待本地化 |
| `ano.mechanicsBrief.018` | 无人机护盾投射仪 | 待本地化 |
| `ano.mechanicsBrief.019` | 鲸王级数值 | 待本地化 |
| `ano.mechanicsBrief.020` | 黑市门槛与刷新 | 待本地化 |
| `ano.mechanicsBrief.021` | 黑市报价 | 待本地化 |
| `ano.mechanicsBrief.022` | 无人机组货 | 待本地化 |
| `ano.mechanicsBrief.023` | MK3弹药永久图纸 | 待本地化 |
| `ano.mechanicsBrief.024` | MK3图纸与制造限制 | 待本地化 |
| `ano.mechanicsBrief.025` | 一次性舰船图纸价格 | 待本地化 |
| `ano.mechanicsBrief.026` | 皇带鱼图纸只收不卖 | 待本地化 |
| `ano.mechanicsBrief.027` | 专属装备收购价 | 待本地化 |
| `ano.mechanicsBrief.028` | 护盾力场收购价 | 待本地化 |
| `ano.mechanicsBrief.029` | 三件MK3装备收购价 | 待本地化 |
| `ano.mechanicsBrief.030` | 完好舰体装备抽取 | 待本地化 |
| `ano.mechanicsBrief.031` | 稀有残骸通用装备池 | 待本地化 |
| `ano.mechanicsBrief.032` | 信号空间MK2/MK3装备组 | 待本地化 |
| `ano.mechanicsBrief.033` | 挂售持有量 | 待本地化 |
| `ano.mechanicsBrief.034` | 虚空晶慢补货 | 待本地化 |
| `ano.mechanicsBrief.035` | 信号空间改名 | 待本地化 |
| `ano.mechanicsBrief.036` | 入侵自动收复路线 | 待本地化 |
| `ano.mechanicsBrief.037` | 普通残骸库存扣量 | 待本地化 |
| `ano.mechanicsBrief.038` | 自动探索主控误拦 | 待本地化 |

## 异形族格与导控腔

来源：2026-10-09船长授权「然后在实现之前单独的调整」，实现`4b13816b`已合入，中文依据保留在`docs/design/weekend-invasion.md`§11.8和本地化唯一表；过程稿从Git历史读取，中文确认/合入/归档不授权英文准备。

| id | 中文依据 | 状态 |
|---|---|---|
| `ui.alien.008` | 巢群导控腔只说明无人机伤害与射程加成，取消炮台惩罚说明 | 待本地化 |
| `ui.alien.009` | C族最终血量增加30%，入侵旗舰共享血量例外 | 待本地化 |

旧`ui.alien.002`及其英文不改；新调用用待译ID回退中文，孵化等待用原说明参数显示20/15秒，不新增英文草稿。

2026-10-09船长确认「C族并未上线，不用公告改动」，本轮独立公告取消，待审稿及对应英文待办已删除；上表两条界面说明仍保留待本地化。

## 技能续时与战前弹药预警

来源：船长2026-10-09「修正突触加速剂说明与提示更新，然后合入未合入的内容」，过程`docs/design/boost-copy-ammo-warning-20261009.md`。沿用已列中文草稿，新ID保留旧英文，未获英文准备授权。

| id | 中文依据 | 状态 |
|---|---|---|
| `item.synaptic.001` | 每枚增加24小时，可重复续时，速度倍率不叠加 | 待本地化 |
| `ui.boost.012` | 使用悬停：有效时间增加24小时，倍率不叠加 | 待本地化 |
| `ui.boost.013` | 使用成功：有效时间增加24小时 | 待本地化 |
| `core.consumable.017` | 使用日志：有效时间增加{p1}小时 | 待本地化 |
| `ui.battleAmmo.001` | 弹药预载不足，二次点击仍可出战 | 待本地化 |
| `ui.battleAmmo.002` | 逐舰弹药可装/需量/缺额 | 待本地化 |
| `ui.battleAmmo.003` | 预警取用来源：物品仓库 | 待本地化 |
| `ui.battleAmmo.004` | 预警取用来源：舰队货仓 | 待本地化 |
| `ui.battleAmmo.005` | 预警取用来源：本趟物资 | 待本地化 |

## 异形公告概述与酸液破盾腔

来源：2026-10-09船长要求精简「异形虫群入侵」敌人介绍，指定酸液爆虫原文并确认爆虫护盾额外乘区与「酸液破盾腔」名称。中文稿确认及修改完毕推送不授权英文准备；旧`ano.incursionRelease.004/005/006`中英文逐字保留，新公告调用下列待译ID，英文回退新中文。

| id | 中文依据 | 状态 |
|---|---|---|
| `ano.incursionBrief.001` | 酸液爆虫近距自爆、大量护盾伤害与装甲/结构腐蚀，使用船长原文 | 待本地化 |
| `ano.incursionBrief.002` | 工虫修复、背巢/巢母依靠虫群作战并补充战损 | 待本地化 |
| `ano.incursionBrief.003` | 巢母召唤与加速、击毁后支援停止 | 待本地化 |
| `ano.incursionLoot.001` | C族入侵稀有残骸新三件与原旗舰黑匣说明 | 待本地化 |
| `ui.acidShield.001` | 自爆对护盾造成的伤害翻倍 | 待本地化 |

敌方挂载件内容名`foe-mount-c-acid-shield`「酸液破盾腔」沿用`FoeMountDef.name/en`接口，`en`未准备、不伪填中文，英文名暂按既有接口回退中文。无英文草稿。

## 势力无人机永久蓝图与颚钳玩家版

来源：2026-10-09船长「添加目前几种势力无人机的永久蓝图，其只会在黑市内售卖」并确认价格、50架批次；追加本次入侵新机型后确认颚钳玩家版和墨潮料单/工期。中文名称/说明按获批方案落地，英文只登记待译，未生成或改写已有英文。

| id | 中文依据 | 状态 |
|---|---|---|
| `item.jawclaw.001` | 玩家物品名称：颚钳无人机 | 待本地化 |
| `item.jawclaw.002` | 动能战斗无人机，适合中距离交战与持续攻击 | 待本地化 |
| `bp.factionDrone.001` | 鱿蜂无人机永久蓝图名称 | 待本地化 |
| `bp.factionDrone.002` | 巢卫攻坚无人机永久蓝图名称 | 待本地化 |
| `bp.factionDrone.003` | 构件哨戒无人机永久蓝图名称 | 待本地化 |
| `bp.factionDrone.004` | 墨潮重袭无人机永久蓝图名称 | 待本地化 |
| `bp.factionDrone.005` | 颚钳无人机永久蓝图名称 | 待本地化 |
| `bp.factionDrone.006` | 学习后可持续制造鱿蜂无人机 | 待本地化 |
| `bp.factionDrone.007` | 学习后可持续制造巢卫攻坚无人机 | 待本地化 |
| `bp.factionDrone.008` | 学习后可持续制造构件哨戒无人机 | 待本地化 |
| `bp.factionDrone.009` | 学习后可持续制造墨潮重袭无人机 | 待本地化 |
| `bp.factionDrone.010` | 学习后可持续制造颚钳无人机 | 待本地化 |

现有敌方`item.alien.001`名称和全部已有英文保持，玩家版使用独立条目；覆盖层在英文界面回退新中文，不自动拼英文永久蓝图名。

## 出击加速器与激光校准仪

来源：2026-10-09船长确认完整补充方案，包含新装备、价格/蓝图、巨构航母特性与协处理器代价5%。新增英文未授权，表项空英文并标记待译，覆盖接口回退获批中文；全部旧英文保持。

| id | 中文依据 | 状态 |
|---|---|---|
| `mod.launchCalibration.001` | 无人机出击加速器MK1名称 | 待本地化 |
| `mod.launchCalibration.002` | 无人机出击加速器MK2名称 | 待本地化 |
| `mod.launchCalibration.003` | 无人机出击加速器MK3名称 | 待本地化 |
| `mod.launchCalibration.004` | 激光校准仪MK2名称 | 待本地化 |
| `mod.launchCalibration.005` | 激光校准仪MK3名称 | 待本地化 |
| `mod.launchCalibration.006` | 缩短首次出击等待，多装递减 | 待本地化 |
| `mod.launchCalibration.007` | 改善激光远距离威力保留，多装递减 | 待本地化 |
| `bp.launchCalibration.001` | 出击加速器MK1蓝图名称 | 待本地化 |
| `bp.launchCalibration.002` | 出击加速器MK2蓝图名称 | 待本地化 |
| `bp.launchCalibration.003` | 出击加速器MK3蓝图名称 | 待本地化 |
| `bp.launchCalibration.004` | 激光校准仪MK2蓝图名称 | 待本地化 |
| `bp.launchCalibration.005` | 激光校准仪MK3蓝图名称 | 待本地化 |
| `ui.launchCalibration.001` | 参数/舰体特性：首次等待削减百分比 | 待本地化 |
| `ui.launchCalibration.002` | 激光远端威力保留增量参数 | 待本地化 |
| `ui.launchCalibration.003` | 新高槽装备家族名 | 待本地化 |
| `ui.launchCalibration.004` | 有效参数：首次等待削减 | 待本地化 |
| `ui.launchCalibration.005` | 有效参数：激光远端保留增量 | 待本地化 |

## 既有搁置项

- 成就卡名/说明、舰种类名、通讯势力简介的早先英文缺口保持原搁置状态，入口见`docs/roadmap.md`，不因建立本记录自动启动。
- 后续按明确范围追加，只记任务和中文依据，不自动扫描全仓起译或批量填英文；已有英文及外部技能文件不作无关修改。
