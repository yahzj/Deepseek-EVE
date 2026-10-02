# 本期击杀旗舰 ⇒ 本期封盘（2026-10-02 · 一号 · **进行中**）

> **本文件是本次工作的临时文档**（§八）：工作期间只改它 ＋ 代码/数据/测试；船长验收并合入后按归档三步办。
> **状态**：船长 2026-10-02 裁「**甲**」⇒ 已落码、闸门见 §四，**待船长验收**（另一件"硬守卫"未做，见 §五）。

## 一、船长原话与裁定（照抄）

> 报障（玩家反馈）：「**击败旗舰打空血量后，被弹出战斗，且旗舰血量全满**」
> 一号摆出真因与三档（甲：击杀旗舰 ⇒ 本期封盘／乙：恢复"一期一场"／丙：只改呈现）⇒ 船长裁「**甲**」。

## 二、真因（一号当日取证 · 用真实函数跑完整链路）

**不是**"同一场血量被重置"。全仓池子写入点只有一个（`weekendNoteFlagshipDamage`，**只做加法**），
换场即全新对象 ⇒ 「血量全满」只可能是**另一场**。实测链路：

| 步骤 | 读数 |
|---|---|
| 打之前 | 核心进度 1 · 旗舰已现身 · 池子剩余 **150,000** |
| 打空 ⇒ 结算 | `flagshipKilled = { blackBox: true, wreck: 90 }`（**黑匣 ＋ 稀有残骸 ×3 = 90 m³ 照发**）· 本场 `endedAtWallMs` 落盘 · `flagshipDown = 'player'` |
| **下一拍** | `weekendTick.started = **true**` ⇒ **立刻又开一场**（＝ 2026-10-02「甲」令「只看当前有没有正在进行」那条的**已知后果**：窗口内可连开） |
| 新一场的旗舰 | 池子"待接战"⇒ **首次接战那一刻锁成 150,000/150,000 = 满血** |

⇒ 玩家看到的「旗舰血量全满」＝**新一场入侵的满血旗舰**；「被弹出战斗」＝母舰爆炸那一刻战斗收场（设计如此）。
**战利品没丢**，丢的是观感：刚把入侵打穿，立刻又冒出一场满血旗舰 —— 看起来像"刚才白打了/旗舰复活"。

## 三、逐条改动（✅ 已落码）

**入侵与活动域**
1. `packages/core/src/weekendEvent.ts`
   - 新增 **`weekendPeriodSealedByKill(state, t0WallMs)`**：读**最近一场留档**（`state.weekendLastResult`，
     结算时写）——`flagshipOutcome === 'player'`（＝`weekendFlagshipOutcomeOf` 的"留档优先"口径：
     玩家亲手击沉）**且**它**结束在本期 T0 之后** ⇒ 本期封盘。**不新增任何存档字段**（换期后
     `endedAtWallMs < 新 T0` ⇒ 自动解封，无需回收/迁移）。
   - `ensureWeekendEvent` 的正常路径里加一道门：**放在"上一场未结束"那道门之后**（那条必须先判：
     绝不用新场覆盖未结算的旧场）、**在抽核心 / 定族之前**（封盘了就一步都不做，连随机子流都不消费）。
2. `packages/core/src/index.ts` —— 导出 `weekendPeriodSealedByKill`。

**测试**
3. `packages/core/tests/flagship-kill-seals-period-20261002.test.ts`（新增 **6 条**）：① 真实击杀链
   （`weekendFlagshipSpecOf` → `weekendResolveBattle` → `weekendSettleAndGrant` 写留档）⇒ 封盘不开新场；
   ② 本期内反复调都不开（幂等）；③ 下一期 T0 到 ⇒ 解封、照常开新场（新池"待接战"）；
   ④ 章鱼人得手（`'octopus'`）⇒ **不封盘**；⑤ 到点收场（`'window'`）⇒ 不封盘；
   ⑥ 封盘期间**信号发射器照旧能点火**（主动选择）· **补偿补场照旧能开**（承诺）。

## 四、不做 / 边界（按「甲」的口径）

- **只封"玩家击杀旗舰"这一种结束方式**：章鱼人得手、到点收场**照旧可连开**（那两种不是"玩家打赢了"）；
- **只封本期**：下一期 T0 一到照常开新场；
- **不封玩家召唤场**：信号发射器点火走 `useInvasionBeacon`（不经 `ensureWeekendEvent`）——玩家自己花道具
  点的入侵是**主动选择**，不在"自动连开"的治理范围内；
- **不封补偿补场**：`weekendCompensation.openWeekendMakeupIfDue` 是另一条路（承诺给受影响档的一场光环）；
- **不动**池子数值 / 收场规则 / 族循环 / 夺回奖与进度收入（连开本身仍成立，只是"击杀旗舰"这情形封盘）。

## 五、一件**没做**的（等船长示下 · 一号已报）

结算入口 `weekendResolveBattle` 开头有「**本场入侵已结束 ⇒ 直接返回、不发奖**」。今天"可连开"让
"事件结束"变频繁 ⇒ 万一出现「战斗还没结算、本场已被收场」的时序，玩家会**白打一场**（黑匣/残骸全丢）。
现在的防线只有「到点收场时若有未打完的旗舰战 ⇒ 顺延」这一道（靠 `weekendFlagshipBattleActive` 判），
属单点防线。船长本条只裁了「甲」（封盘），**硬守卫未获批 ⇒ 未做**；要做得请他一句话。

## 六、验证与读数

**用例**（`packages/core/tests/flagship-kill-seals-period-20261002.test.ts` · **6 条**全绿）：① 真实击杀链
（旗舰 spec → `weekendResolveBattle` → `weekendSettleAndGrant` 写留档）⇒ `flagshipOutcome = 'player'`
⇒ 下一拍 `started = false`（改前当拍就开一场）；② 本期内 T0+2h/24h/窗口末都**不开**（幂等）；
③ 下一期 T0 到 ⇒ `started = true`、新场 `startedAtWallMs = 新 T0`、池子"待接战"；
④ 留档 `'octopus'` ⇒ 不封盘、照旧开；⑤ 留档 `'window'` ⇒ 不封盘、照旧开；
⑥ 封盘期间：信号发射器点火**成功**（族 ∈ {R,H}）· 补偿补场**照旧开**（族 = 光环）。

**闸门（全绿）**：typecheck 0 · core **296 文件 / 3099 用例**（+6 = 本批）· content:check 0 · l10n:check 0 ·
l10n:params 0 · ui:rot-check 0 · ui:layout-css:check 0 · arch:guard F1~F9 全 0 · scope:check 0 ·
docs:index 0 · 桌面构建 ✓。§四 编码自检：改动文件纯 CRLF、无 BOM。

**§十八 自报**：`scope:check` 读数 = **1 个功能域**（入侵与活动）⇒ **无跨域**；共享底层 1 个（`index.ts` 导出）。
