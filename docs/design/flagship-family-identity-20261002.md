# 旗舰身份「族无关」：R 族母舰认不出来（2026-10-02 · 一号 · **进行中**）

> **本文件是本次工作的临时文档**（§八）：工作期间只改它 ＋ 代码/数据/测试；船长验收并合入后按归档三步办。
> **状态**：船长转述玩家报障 ⇒ 已落码、闸门见 §五，**待船长验收**。

## 一、船长原话（照抄）

> 「**发现问题，哪怕母舰剩余1%血，进入战斗后母舰都是满血**」

## 二、真因（一号取证 · 用真实函数跑出读数）

core 里的**母舰身份写死成 H 族那一艘**：

- `weekendEvent.ts`：`WEEKEND_FLAGSHIP_SHIP_ID = 'foe-h-ink-flagship'`；`weekendIsFlagshipShipId()` 只认它；
- 消费点三处：`weekendLaunch` 的 `FoeOverride.bossShipId` 与"取 `split` 的那条舰级" ·
  `weekendBattle` 的伤害台账入参（`flagshipBattleLedger` 靠它挑母舰单位）。

而**本期入侵族是 R（光环科技）**，母舰是 **`foe-r-corona-nexus`** ⇒ **一条都对不上** ⇒ 整条"池子覆写"链
对 R 族全部失效（探针读数 · 池子只剩 1% 那一档）：

| 读数 | 改前（R 族） | 改后（R 族） |
|---|---|---|
| `FoeOverride.bossShipId` | `foe-h-ink-flagship`（**匹配不上任何单位**） | **`foe-r-corona-nexus`** ✓ |
| 母舰 `hpMul = bossHp ÷ 舰级血` | **不生效** ⇒ 母舰血量退回卡面值 | 生效 ⇒ 血量 = **池子剩余** ✓ |
| 三层容量（血条分母） | 回落成 **H 族的 split** | **R 卡自己的 split** `{75,000 / 45,000 / 30,000}` ✓ |
| 战斗内血条分母 | 回落成"单位自身满值" ⇒ **永远 100%＝满血** ← 玩家看到的那条 | 池子容量 ⇒ 那 1% 那一档读作 **1.0%** ✓ |
| 伤害台账 `rawDmg` | **恒 0** ⇒ 打出的伤害一点都没进池子 | 真进池子（用例：400 点 ⇒ `flagshipHpDone` +400）✓ |

⇒ 后果不止"血条满"：**R 族的「单场不死 / 跨场累计」整条失灵** —— 池子永远打不空 ⇒ **旗舰永远杀不掉**
（也解释了昨天第一条报障的另一半观感）。

## 三、逐条改动（✅ 已落码）

**入侵与活动域（core）**
1. `packages/core/src/weekendEvent.ts` —— 新增**唯一取数口** **`weekendFlagshipSlotOf(card)`**：
   判据 = **卡自身那艘 `hullClassTier === 5`**（两族旗舰卡都满足：母舰 T5、僚舰 T3/T4）⇒ **加新族不用改 core**；
   认不出时回落遗留常量。`WEEKEND_FLAGSHIP_SHIP_ID` / `weekendIsFlagshipShipId` **保留导出**（兼容老调用方与
   老测试）并把头注改成"**遗留判据，别再用它当母舰唯一判据**"（附本次报障）。
2. `packages/core/src/weekendBattle.ts` —— 伤害台账挑母舰改用 `weekendFlagshipSlotOf(卡)`（改前用写死判据过滤 ⇒ R 族恒 0）。
3. `packages/core/src/weekendLaunch.ts` —— 开战覆写的 `bossShipId` 与"取 `split` 的舰级"同源改用
   `weekendFlagshipSlotOf`（改前 R 族三层容量回落成 H 族的 split）⇒ `bossHp` / `bossHpMax` / `bossHpLayers` /
   `bossMaxLayers` 四件套这才真的落在 R 族母舰上。

**测试**
4. `packages/core/tests/flagship-family-identity-20261002.test.ts`（新增 **4 条**）：① 两族母舰都认得出
   （R 不是写死那艘；遗产判据不认 R 这一点也钉住＝报障的根）＋ 两族旗舰卡**恰有一条 T5**；
   ② R 族开战覆写四件套（含"三层容量 = 本卡 split"）；③ R 族母舰单位血量 = **池子剩余**、
   战斗屏分母 = **池子容量** ⇒ **血条 1.0%（不是满血）**；④ 伤害台账：400 点真的进池子。

## 四、不做 / 边界

- **不动**池子数值（150,000）· 不动 `weekendFlagshipWavesOf`（4 波）· 不动威胁定价与奖励；
- **不动** H 族既有行为（它的母舰本来就是 T5 ⇒ 取数与改前逐字相同）；
- **不做**「族 → 舰级 id」的 core 侧硬表（core 不 import data；**从卡自身认**才是加族不改码的那条路）；
- ⚠ 遗留常量与 `weekendIsFlagshipShipId` **保留**（有老调用方/老测试），只是生产路径不再用它。

## 五、验证与读数

**用例**（`packages/core/tests/flagship-family-identity-20261002.test.ts` · **4 条**全绿 · 关键读数照抄）：

- ② R 族覆写：`bossShipId=foe-r-corona-nexus` · `bossHp=1500/150000` ·
  容量 `{s:75000, a:45000, h:30000}`（**R 卡自己的 split**，改前回落成 H 的 `{30000, 82500, 37500}`）·
  当前 `{s:0, a:0, h:1500}`；
- ③ R 族母舰单位血 `{s:0, a:0, h:1500}` · 分母 `{s:75000, a:45000, h:30000}` ⇒ **血条 1.0%**（改前 = 满血）；
- ④ 台账 `rawDmg=400` ⇒ 池子 `flagshipHpDone` 148,500 → **148,900**（改前恒 0）。

**闸门（全绿）**：typecheck 0 · core **301 文件 / 3112 用例**（+4 = 本批）· content:check 0 · l10n:check 0 ·
ui:rot-check 0 · arch:guard F1~F9 全 0 · scope:check 0 · 桌面构建 ✓。§四 编码自检：改动文件纯 CRLF、无 BOM。

**§十八 自报**：`scope:check` 读数 = **1 个功能域**（入侵与活动）⇒ **无跨域**。

**守卫**：本批**不加**内容契约 —— R 族旗舰卡**本来就有 T5**（契约拦不住"core 认不出"这类错），
真正的守卫 = 上面那四条用例（谁把取数口改回写死判据，②③④ 立刻红）。
