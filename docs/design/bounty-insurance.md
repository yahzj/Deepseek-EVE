# 连续作战保险：带伤预警 + 战内自动撤退（已确认 2026-09-08）

> 状态：**已确认并落地**（船长 2026-09-08 拍板：①预览保留满耐久基准 + 损伤预警扣分；
> ②战内自动撤退（全局结构 <50%）且撤退即终止连续出击，仅作用于玩家选择的连续战斗；
> ③巡回自动再出发门槛提前到"装甲损失 50%"；④动力随损伤按船长条件判定 = 维持现状）。
> 背景：玩家连续战斗（巡回讨伐）时偶发带伤下场 → 失利累积 → 弃船损失；既有的"保险"
> 只覆盖开战前（结构 <50% 修补 / ≤30% 自动维修），战斗进行中没有止损点。

## 一、带伤预警（只改展示，引擎结算与 AI/模拟一律不变）

- 悬赏展示胜率 = 原显示胜率（满耐久基准 + logit 扩散）**− 预计装甲损耗 × 0.10 − 预计结构损耗 × 0.25**，
  下限 2%（参数 balance.battle：`winPenaltyArmorPerFull` / `winPenaltyHullPerFull`）；
- 预计损耗来自与 battleWinPreview 同源的稳态模型（`steadyPreview` 抽出共用）：
  预计承伤 = 敌 DPS × min(我被击毁秒数, 我击毁敌秒数)，按 盾→装甲→结构 顺序分摊；
- 新增导出：`bountyDamageForecast`（armorLoss/hullLoss/rawWin）、`bountyWinPercentGuarded`（展示口径）；
  原 `battleWinPreview` 语义不变（AI favor/接单门槛/模拟工具全部照旧 = "实际胜率不变"）；
- 生效面：远征视图 view.winPercent 与悬赏卡胜率（含悬停说明：预计装甲/结构损耗与"结算仍按实时战斗"）。

## 二、战内自动撤退（仅巡回连续出击场次）

- BattleState 新增 `hullEscapeFrac?`（巡回场开战由 beginBattleAt 挂 0.5）与 `autoEscaped?`（请求标记）；
- `advanceBattleFor` 每 100ms 步进后检查：本船结构剩余 < 满值结构 × 0.5 → 中止步进并置
  autoEscaped（结构保留当前值，绝不拖到结构归零 → 弃船）；
- `advanceExpedition` 见 autoEscaped → `settleBattleRetreat(state, ctx, 'auto')`：
  承伤写回 → 半损惩罚骰（最低 1%）→ 下限 5% 保护（绝不弃船）→ 按比例维修费 →
  **终止连续出击**（autoLoopAnomalyId 置空）→ 转返航（returnReason='retreat'，可召回）；
- 玩家手动撤退 `retreatBattle` 重构为共用 `settleBattleRetreat(state, ctx, 'manual')`，
  文案/停环说明按模式区分（自动 = "结构损失过半，自动撤退/连续出击已停止（…自动撤退）"）；
- 作用域：仅巡回场次（battle.hullEscapeFrac 只在巡回自动再出发路径挂载）——玩家实时观看的
  手动战斗与低安遭遇战不挂载，不抢操作权；离线补时同链自动生效；
- AI 副船远征已停用：隐藏/备注另立任务（本批不动 AI 代码，仅登记挂起）。

## 三、巡回"自动再出发"门槛（提前到装甲）

- 原逻辑：结构（耐久）<50% 才修补——太晚（结构是最后防线）；
- 现逻辑：**装甲或结构 <50%** 即自动用货仓修理组件修补，**目标提高到 60%**（为战内 50%
  撤退阈值留缓冲，避免"开局恰 50% 一交火即触退"的噪音）；修补后仍不足 → 停环（文案更新）。

## 四、动力随损伤（船长条件判定 = 维持现状）

- 引擎中动力（agility）只参与命中回避 / 弃船逃生率 / 跃迁充能展示，**不参与战斗承伤与脱离判定**；
- 因此不存在"动力不足 → 额外承伤"的路径，更不可能造成超过 50% 的结构损失（船长设的
  条件阈值）；带伤风险已由"实战血池按残余打折 + 弃船率耐久惩罚"双通道体现 → 不引入动力衰减。

## 五、代码落点

- `types.ts`（BattleBalance +2 参数；BattleState.hullEscapeFrac/autoEscaped）、`balance.ts`（0.1/0.25）；
- `combat.ts`（steadyPreview 提取共用；bountyDamageForecast/bountyWinPercentGuarded；
  advanceBattleFor 步进后保险检查）；
- `expedition.ts`（beginBattleAt 巡回挂载 0.5；advanceExpedition autoEscaped 结算；
  retreatBattle → settleBattleRetreat 重构；advanceAutoLoopBounty 装甲门槛 + 修补目标 0.6；
  view.winPercent 展示口径）；
- `index.ts` 导出；UI Expedition.tsx 悬赏卡胜率改展示口径 + 悬停说明；
- 测试：expedition.test +4（预警自洽与 ≤ 原口径、装甲门槛无组件停环、有组件修补至 60%
  再出发且战斗挂 0.5、巡回场结构损失过半自动撤退保船停环返航）；
- core 486 绿 + typecheck ×4 + desktop build 绿。

## 六、已知取舍

- 预警为稳态近似（非逐发模拟），定位是风险提示；扣分不改变任何真实结算；
- 撤退沿用轻损代价（少量耐久 + 维修费）= 保船保险金；玩家可能偶发"少打一场"回港
  （该场已结构损失过半，本就该收手）；
- 全局 50% 阈值 + 60% 出战修补下限：满耐久出战允许被打掉一半结构才触发，带伤（60%）出战
  则打掉 10% 即触发——语义自洽（残血不该再深陷战局）。
