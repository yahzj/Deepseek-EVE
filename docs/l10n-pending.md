# 待英文本地化记录

> 状态：仅登记，未开始准备；2026-10-09。
> 船长原话：「之后的所有英文本地化，除非我强调开始准备，否则只加入待本地化的文档记录里」。
> 中文确认、实现、合入、发布许可均不视为英文准备授权；明确要求开始准备后才起草、审核、写入英文及结清记录。

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

## 既有搁置项

- 成就卡名/说明、舰种类名、通讯势力简介的早先英文缺口保持原搁置状态，入口见`docs/roadmap.md`，不因建立本记录自动启动。
- 后续按明确范围追加，只记任务和中文依据，不自动扫描全仓起译或批量填英文；已有英文及外部技能文件不作无关修改。
