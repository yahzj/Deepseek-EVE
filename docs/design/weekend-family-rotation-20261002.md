# 入侵族的选择：本期设为 R ＋ 下周起循环敌对势力（2026-10-02 · 二号 · **待验收**）

> **本文件是本次工作的临时文档**（§八）：工作期间只改它 ＋ 代码/数据/测试；船长验收并合入后按归档三步办。
> **状态**：**船长 2026-10-02 令**（原话照抄）：「**一会8点开启入侵，设置为R族，下周如果没有特意设置，
> 就采用循环敌对势力。**」⇒ 已落码、待验收。⏰ 时段敏感：**今晚 20:00** 那一期就必须是 R。

## 一、口径（落码后一句话说清）

| 项 | 口径 |
|---|---|
| **本期（2026-10-02 20:00 那期）** | **R 族（光环科技）** —— 与船长令一致 |
| **以后各期（无特意设置时）** | **循环**：`WEEKEND_FAMILY_ROTATION = ['R','H']` 按**期号**顺延 ⇒ 10-09 那期 H、10-16 那期 R …… |
| **循环队进谁** | **只有做完了的族**（R 光环 · H 墨潮）——A/C/G 仍是占位口径，**不进队**（免得玩家抽到打不到真舰队的场） |
| **期号怎么算** | `weekendPeriodIndexOf(窗口 T0)` = `⌊(T0 − 锚点) ÷ 7 天⌋`，**锚点 = 2026-10-02 20:00 那一期 = 第 0 期**（与船长令那一期重合 ⇒ 指定与循环不打架） |
| **特意设置某一期** | `WEEKEND_FAMILY_OVERRIDE = { family, periodIndex }`（只对那**一期**生效，过完自动回落到循环）——本期已显式写成 `{ family: 'R', periodIndex: 0 }` |
| **全线硬锁（逃生门）** | `WEEKEND_LOCKED_FAMILY`（平时 `null`；要"所有档一律某族"才填它，优先级最高） |
| **调试档** | 不变：`WEEKEND_DEBUG_FAMILY = 'R'` ⇒ **调试档仍必出 R**（船长 2026-10-01 令，本地实测用） |

**优先级**：`WEEKEND_LOCKED_FAMILY`（全线硬锁）→ `WEEKEND_FAMILY_OVERRIDE`（本期特意设置）→ **循环**。
单点在 `weekendEvent.weekendFamilyForWindow(t0)`；玩家线开局面（每周五 20:00 那一路）**每期现算**。

## 二、逐条改动（✅ 已落码）

1. `packages/core/src/weekendEvent.ts` ——
   - 新增 `WEEKEND_FAMILY_ROTATION = ['R','H']` · `WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS = 1790971200000`
     （2026-10-02 20:00 本地）· `WEEKEND_FAMILY_OVERRIDE = { family: 'R', periodIndex: 0 }`
     · `weekendPeriodIndexOf(t0)` · `weekendFamilyForWindow(t0)`（含三级优先级）
   - `WEEKEND_LOCKED_FAMILY`：`'H'` → **`null`**（改由循环决定；常量保留为"全线硬锁"逃生门）
   - `weekendRollOccupation(state, ctx, seq, familyOfWindow?)`：加第四个可选参数（**引擎按本期 T0 传**；
     不传 ⇒ 退回旧口径，既有调用面零改动）
   - `ensureWeekendEvent` 的玩家线开局那一处：传 `weekendFamilyForWindow(t0)`
2. `packages/core/src/index.ts` —— 导出上列新符号（UI/工具可用）
3. 用例订正两处（判据随口径改，**都不是放宽**）：
   - `weekend-event.test.ts`：原「玩家线一律 H」改为「玩家线走循环：锚点那期 = 队首(R)、下一期 = 次位(H)、
     再下一期转回队首」＋「全线硬锁平时 null」
   - `weekend-debug-family-20261001.test.ts`：调试档仍必出 R；**玩家线对照改为按本期循环判族**
     （调用处补上引擎实际会传的 `familyOfWindow`）

## 三、边界与自报

- **落域**：**入侵/活动域**（`weekendEvent.ts` ＋ 其用例）——本批只碰"族的选择"这一件事，**单域、无跨模块**。
- **零行为变化**：调试档逐字不变（仍 R）；`weekendRollOccupation` 不传第四参的既有调用面逐字不变；
  随机数消费次序不变（族那一次 `rng()` 照旧消费，只是判成循环给的那族）。
- **没有动**：公告稿 · 族锁之外的开局条件（声望 ≥40 / 每周五 20:00 / 96h 窗口 / 一窗一场）·
  旗舰池与黑匣那一套 · A/C/G 三个占位族的任何内容。

## 四、验证

- `typecheck` 四包 ✅ · `test -w @whale/core`（见 §五）· `content:check` / `l10n:check` / `ui:rot-check` /
  `arch:guard` / 构建（见 §五）
- **本期族读数**（用例内 console 读数）：锚点那期 = `R`（循环第 0 位）· 下一期 = `H` · 再下一期 = `R`；
  调试档 = `R`。

## 五、收尾

- 合入 main ＋ 主树重建（**今晚 20:00 前**要落到船长机器上的本地构建）。
- ⚠ 若主树当时仍有他人在途改动 ⇒ 按 §4 **停手报告**，由船长协调（本批只碰 `weekendEvent.ts` ＋ 两个用例 ＋
  `index.ts` 导出 ＋ 本文件，与战斗/远征那批**文件不重叠**）。
