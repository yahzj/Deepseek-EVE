# 任务板：快递任务周期（2026-09-24）＋ 战斗伤害飘字（待落）

状态：**进行中**（快递：第一段已落；飘字：规格已确认、未落码）

> 船长原话（照抄）：
> 「**快递任务和资源任务的刷新周期延长到 120 分钟。**」→（澄清）「**那只改快递任务。**」→
> 「**1 快递任务的周期和持续时间都为 120 分钟，资源任务不变。2甲。**」（2甲 = 每批条数**不动**、不做 ×6 补偿）
> 「**战斗界面，我希望添加战斗伤害的数值动画（包括 MISS）**」＋四答：**①甲** 命中目标旁向上飘 ·
> **②甲** 同一拍对同一目标**累加成一个数字** · **③甲** 类型色数字 + 灰色 MISS · **④甲** 只在战斗画面且**跟随倍速/暂停**。

## 一、快递任务（已落第一段）

| 口径 | 值 |
|---|---|
| 快递任务刷新周期 | **120 分钟** |
| 快递任务存活时间 | **120 分钟**（到点即换下一批 ⇒ 整齐一批） |
| 资源任务 | **不变**（20 分钟，市场「补给刷新」整点对齐） |
| 每批条数 | **不动** |
| 市场影响 | **零**：快递是**虚拟货物**（只有体积，`sideTasks.ts:488-490`），不绑商品 ⇒ 不抽 `npcSell`、不动 `pool.q`/`shock`。抽市场的是**资源任务**（`SPAWN_SUPPLY_CUT = 0.25` + `SPAWN_SHOCK_STEP`，完成时 `refundSpawnShock` 回退） |

**已落**（`packages/core/src/sideTasks.ts` + 用例 `packages/core/tests/courier-board-period.test.ts`，已推送）：
- `COURIER_BOARD_PERIOD_MS = 120 * 60_000`
- `courierDueAtWindow(windowMs)`：窗界为 120 分钟整数倍 ⇒ 到点（未开盘/非法值不到点）；因为 120 = 20 × 6 ⇒ 每第 6 窗一次。

**待落（下一步，行为接线）**：
1. `refreshBoard`（`sideTasks.ts` 约 460-500 生成、700-740 翻页）按 `courierDueAtWindow(board.window)` 分支：
   **每窗都重掷资源任务**；**只有到点的窗才重掷快递任务**（其余窗保持原样）。
2. **快递条目存活 120 分钟**：给快递条目记自己的到期时刻（或直接以"下一次 120 分钟窗界"为到期），
   两处过期判据（`sideTasks.ts:1032`、`:1189` 现在都用 `board.window + boardPeriodMs(ctx)`）要按种类分别取。
3. `SideTasksState` 若需新增字段（如 `courierWindow`）⇒ **可选字段、零迁移**。
4. 用例：`sideTasks.test.ts` 补一条"资源每 20 分钟换、快递每 120 分钟换且存活 120 分钟"的行为断言；
   注意该文件顶部 `const PERIOD = DEFAULT_BALANCE.market.orderLifeMs.common` 是**资源侧**口径，不必改。

## 二、战斗伤害飘字（规格已确认，未落码）

- **数据侧**（`panels/battleViewCore.tsx`）：在既有逐发数据（`meShots` / `foeShots` / `meDmg`，每发带
  `type: DamageType`，命中判定给出 miss）之后，产出一段**短生命周期打击事件**：
  `{ 目标标识（我方第 N 艘 / 敌方第 M 艘）, 累加伤害, 类型或 'miss', 出生时刻 }` —— **同一拍对同一目标先累加**再产出。
- **渲染侧**（`panels/BattleScreen.tsx`）：战斗画布上叠**飘字层**（绝对定位、`pointer-events:none`）：
  位置 = 命中目标图标的**当前锚点**（随船位动画跟随）；动画 = 上浮 + 淡出，**生命期用战斗时钟推进**
  （`battle.startedAtGameMs`，不是墙钟）⇒ **倍速下跟着快、暂停即冻结**。
- **配色**：数字吃既有 `DMG_COLOR[type]`（与弹点同色）；**MISS 用 `--wui-dim`（灰）**。
  **不新造色**（并受 `ui:token-check` 契约保护）。
- **边界**：只在战斗画面渲染；AI 副船 / 自动清剿（无战斗画面）不播；不改战斗数值与战报；不改存档（纯视图内存态）。
- 涉及：`battleViewCore.tsx` · `BattleScreen.tsx` · `styles.css`（上浮淡出动画）· `l10n/table.ts`（**MISS** 文案 id）。

## 三、验证口径（两件共用）

typecheck 四包 0 错 · `npm run test -w @whale/core` 全绿 · `content:check` · `ui:rot-check`（动画类必跑）·
**`ui:theme-check`（含 `tools/ui-token-check.ts` 的色板 token 契约）** · `l10n:check` · `build`；
飘字的"不出界 / 不挡点击 / 倍速下生命期正确"属读数，观感交船长审。
