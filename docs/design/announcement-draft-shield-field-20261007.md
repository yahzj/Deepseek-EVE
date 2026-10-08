# 护盾力场、装备代价与一次性舰船蓝图调整公告待审

> **状态：已按船长要求整合，待正文审核，未写入公告表**（三号 · verify · 2026-10-08）
> 船长原话：「将护盾充能力场装置的削弱改动准备一份公告」。
> 后续原话：「行，本次改动以及图纸改动并入护盾充能力场的公告」。
> 范围：整合护盾力场、装备负面和一次性舰船图纸降价的中英文公告；不改历史公告，不推送。
> 待裁决点：公告正文审核；明确批准后再写入游戏内公告。

## 中文稿

- id：`ann-shield-field-20261007`
- title：护盾力场、装备代价与舰船蓝图调整
- date：2026-10-08
- tag：数值

1. 护盾充能力场装置 MK2、MK3 不再恢复装载舰自身的护盾，只恢复玩家编队中其他存活舰船。每次有效充能消耗装载舰最大护盾值的10%，不因恢复的队友数量增加而多扣；不同型号独立触发，分别支付。
2. 装载舰护盾不足最大值的10%，或没有存活队友需要恢复时，力场不发动、不扣盾。恢复量仍按装载舰最大护盾计算，MK2、MK3 的基础周期仍为10秒、8秒，同舰多装恢复量递减。
3. 巨构协处理器的单件装填代价降至8%，多件代价相乘，作用于本舰全部武器及无人机攻击间隔，并延长护盾充能、力场、维修、捕获网和无人机储备甲板的周期。每件仍增加90 CPU。
4. 装备的速度、射程和命中代价改为逐件相乘，抗性代价逐件减去百分点，抗性仍可降至负值。有多装递减的装备，负面效果也随同一件的收益递减，不再只取最重的一份代价。
5. 全部一次性舰船蓝图的基础价格下调至对应舰船基础价格的10%，永久蓝图、装备和无人机图纸价格不变。皇带鱼级一次性蓝图改为只收不卖，已有图纸仍可制造或出售，原有掉落保留。

## 英文稿

Title: Shield Fields, Equipment Penalties and Ship Blueprint Adjustments

Tag: Balance

1. Shield Charge Field MK2 and MK3 no longer restore the carrier's own shield, only shields on other surviving ships in the player's fleet. Each activation that restores an ally consumes 10% of the carrier's maximum shield capacity, regardless of the number of allies restored. Different models activate and pay their costs independently.
2. The field neither activates nor consumes shield when the carrier has less than 10% of its maximum shield capacity, or when no surviving ally needs restoration. Restoration remains based on the carrier's maximum shield capacity. MK2 and MK3 retain base cycles of 10 and 8 seconds, with diminishing restoration from multiple fields on one ship.
3. The Megastructure Coprocessor's reload penalty is reduced to 8% per module and multiplies across modules. It affects all of the carrier's weapons and drone attack intervals, as well as shield recharge, shield field, repair, capture web and Drone Reserve Deck cycles. Each module still adds 90 CPU.
4. Equipment speed, range and accuracy penalties now multiply across modules. Resistance penalties subtract percentage points and can still cause negative resistance. Where a module has diminishing returns, its penalties follow the diminishing benefit of the same module, instead of only applying the largest penalty.
5. Base prices for all single-use ship blueprints are reduced to 10% of the corresponding ship's base price. Permanent, equipment and drone blueprint prices are unchanged. The Oarfish-class single-use blueprint is now buyback-only; existing copies can still be used or sold, and existing drop sources are retained.

## 核对记录

- 同类参照：异形入侵及残骸回收公告待审稿，采用标题、数值分类与5条要点，中英文配对。
- 机制依据：`shield-field-transfer-20261007.md`已确认规则；现场核对`combatRepair.ts`的`pulseShieldFieldFor`、`SHIELD_FIELD_COST_PCT`及逐型号脉冲流。
- 装备英文名称沿用当前覆盖表的Shield Charge Field，区分中槽Shield Recharger；不依据尚未归档更新的词典历史条目判断现行效果。
- 一次扣盾按有效型号脉冲计算，不按队友人数增加；费用不因恢复量的多装递减而降低。新装填代价会影响实际力场/中槽充能周期，因此删掉旧稿「中槽不受影响」的绝对表述，改写为基础周期。
- 本稿按船长要求整合战斗/装配与舰船图纸市场价格，不把整合授权当作正文发布批准；没有第一、第二人称、设计动机或开发验收话术进入公告正文。
- 未改`announcements.ts`，公告正文尚未登记发布词条；装备说明与详情已按实现同步本地化表，公告仍等正文获批后再落表。
