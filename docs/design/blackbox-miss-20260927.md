# 旗舰黑匣漏发（玩家亲手击沉却不爆）— 工作文档

- **状态**：进行中（2026-09-27 · 一号 · 主树 `main`）
- **来源**：船长转述玩家报障（附结算面板截图 `QQ图片20260927215604.png`）＋ 船长本地导入的玩家存档。

## 船长原话（照抄）

> 玩家反应还是没收到黑匣，图在根目录QQ图片20260927215604.png
>
> 玩家BOSS是刚刚打的，游戏也是刚刚更新的
>
> 你先修复下，然后给这个存档修复下黑匣

## 证据（只读玩家存档，未改动原档）

```
flagshipHpDone      = 148676 / flagshipHpMax = 150000   ⇒ 占比 99.1%
flagshipBlackBox    = false        ← 掷骰结果：不爆（且已固化）
flagshipDown        = "octopus"    ← 归属写成章鱼人得手
flagshipPlayerKill  = { atWallMs: …895306, runId: 801050448 }   ← 却有"玩家亲手击沉"留档
warehouse['blackbox-h'] = 无
```
面板之所以写「旗舰被你击沉」，是因为判据 `weekendFlagshipOutcomeOf` 是**留档优先** ⇒ **显示侧对了、写入侧错了**。

## 根因

`weekendClaimOctopus`（章鱼人把血削到 0）里有这一句：

```ts
weekendRollBlackBox(state, ev, false)   // 按"25% × 输出占比"掷，结果写 ev.flagshipBlackBox
```

而 `weekendRollBlackBox` 原先**无条件幂等**（有值就永不重掷）。章鱼人先按**低占比 + 没抢到最后一下**
掷出 `false` 并固化 ⇒ 玩家随后真把它打沉时，`weekendApplyBattleOutcome` 那一支的"占比 > 50% 且抢到最后
一下 ⇒ 必爆"读到的却是这个固化的 `false` ⇒ **本该必爆的黑匣永久不爆**。

## 修法

1. **幂等改为"同情境幂等"**：新增 `WeekendEventState.flagshipBlackBoxByPlayer`（记这次结果按哪种情境掷的），
   **情境变了必须重掷** ⇒ "章鱼人先掷、玩家后击沉"这一场也能拿到本该必爆的黑匣。该字段随档（`save.ts`）。
2. **存档补发**（船长令「给这个存档修复下黑匣」）：一次性修补器**只读原档**，判据 = 「有玩家亲手击沉留档
   **且** 占比 > 50%」⇒ 写 `flagshipBlackBox = true`、`flagshipBlackBoxByPlayer = true`、
   `flagshipDown = 'player'`（与留档优先的读数口径对齐）、仓库 `blackbox-h +1`、结算快照 `blackBox = 1`，
   **输出到新文件**（原档一字未动，时间戳与大小已核）。

⚠ **仍待查（本次未动）**：玩家已击沉却让 `weekendClaimOctopus` 抢先写归属，说明"玩家击沉"那一刻
`weekendNoteFlagshipKilled` 没走到（或其核心门禁返回 false）；这条链路下次单独查。

## 待办

- [ ] 归档（§8 三步）
- [ ] 追查 `weekendNoteFlagshipKilled` 未生效的原因
## 补发工具（船长令「更新之前的补发工具」）

**实现**：`reconcileWeekendBlackBox(state, ctx)`（`weekendBattle.ts`），**逐 tick 幂等对账**，
接在引擎 tick 里（与 `reconcileWormholePromoGift` 同款模式）⇒ 玩家**进游戏自动补，不需要导入任何文件**
（铁人档也能用）。

**判定（三条同时成立才补）**：
1. `flagshipPlayerKill !== undefined`（有"玩家亲手击沉"的留档 ⇒ 排除章鱼人得手/没打）；
2. `flagshipHpDone ÷ flagshipHpMax > 0.5`（按爆率表这一档是**必爆**；占比不过半的一律不碰）；
3. `flagshipBlackBox !== true` **且** `rewardLedger.blackBox === 0`（这一场确实没发过）。

**补什么**：`blackbox-h` ×1 进物品仓库（走 `weekendGrantRewards`）＋ 打标记
（`flagshipBlackBox` / `flagshipBlackBoxByPlayer`）＋ 归属字段**仅在为空时**对齐成 `player`
（不覆盖已有值）＋ 已结束的场次重建战果快照 ＋ 一条日志（`core.weekend.039`）。

**✅ 实测在玩家那份档上生效**（22:17:17 游戏自存档时写入）：
```
warehouse['blackbox-h'] = 1 · flagshipBlackBox = true · flagshipBlackBoxByPlayer = true
flagshipDown = octopus（**未被覆盖** —— 与实现里"仅在为空时对齐"一致）
```
⚠ `flagshipBlackBoxByPlayer` 这个字段是本次修复**新引入**的，除 `reconcileWeekendBlackBox` 外无任何代码会写它
⇒ 它的出现即"补发真的跑过"的铁证。（原档一次都没被我写过：我只另写过一份新文件并已删除。）
