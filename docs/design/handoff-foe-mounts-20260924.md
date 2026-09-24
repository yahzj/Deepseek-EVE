# 交接卡：敌方挂载件「姿态陀螺仪 / 船体修理装置」（2026-09-24 · 交给新一号）

> **一句话**：船长要的两件敌方挂载件，**设计已定稿、定义层已落码、数据挂载与战斗消费端未做**。
> 主树 `main`、工作区干净、`typecheck` 全绿；**本地领先 origin 3 个提交，一律未推送**（船长明令「不要立刻推送」）。

## 一、船长原话（照抄，别再问）

1. 「我调整了A族的闪避，并且希望在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避。给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，会吃威胁的加成。」
2. 「我的改动是A给A族除电子舰外的其他敌人加10%闪避。」（＝**数据侧**提高，已落码）
3. 三条追问答复：**只挂虫洞卡条目**（乙）· 陀螺仪 **加算 +10 个百分点**（甲）· 修理量 **乘层威胁倍率**（甲，归一基准「不改动」= 层 1 为 ×1.00）
4. 「你先提高A族闪避，提高后再挂载，**电子舰也要挂**。」（陀螺仪 A 族全挂，含劫掠电子舰）
5. 「**不要立刻推送。**」＋「做完全部再报告。」

## 二、已做完

| 件 | 状态 |
| --- | --- |
| A 族敌舰闪避 +10pp（海盗快艇 / 劫掠护卫舰 / 劫掠狙击舰 / 海盗头目舰 0.12 → **0.22**；**劫掠电子舰保持 0.30**） | ✅ 已落码**并已推送**（`ce08b7bf`）；敌舰明细表与工作台已重出 |
| 挂载件**定义层** | ✅ 本地提交 `9f270688`（**未推送**） |
| 设计定稿 + 逐文件实现计划 | ✅ 已推送：`docs/design/foe-mounts-20260924.md`（`ba06c24f`）＋推送口径登记（`9ae9a38d`） |

**定义层具体落了什么**（接手直接从这儿往上盖，不要重写）：
- `packages/core/src/types.ts`：`FoeMountId` 加 `'foe-mount-gyro-stabilizer'` · `'foe-mount-hull-repair'`（约 263 行附近）；
  `FoeMountDef` 加两个可选效果字段 `evasionBonus?: { add: number }` · `repairPulse?: { everyMs: number; armor: number; hull: number }`。
- `packages/core/src/foeMounts.ts`：`FOE_MOUNT_IDS.gyroStabilizer` / `hullRepair` 已登记；`FOE_MOUNTS` 两条定义已写
  （名 = 姿态陀螺仪 / 船体修理装置，`note` 里摘了船长原话）；`ResolvedFoeMounts` 加 `foeEvasionBonusAdd?: number` ·
  `foeRepairPulse?: { everyMs; armor; hull }`，`resolveFoeMounts` 已聚合（闪避**累加**、修理**取最后一件**）。
- ⚠ **踩坑记录**：加 `FOE_MOUNTS` 条目时我曾误拿 `supportCall`（支援呼叫装置）那条当锚点把它顶掉，已补回。
  接手第一件事建议先核一遍挂载件清单应为 **12 件**：
  `劫掠冲锋推进器 · 虫群冲锋器 T1~T4 · 机巢增程阵列 · 劫掠捕获网 · 守墓远距观瞄 · 巨构齐射观瞄 · 支援呼叫装置 · 姿态陀螺仪 · 船体修理装置`。

## 三、没做完（下一步就是这些）

1. **数据挂载**（`packages/data/src/wormholeFoes.ts`）：
   - A 族卡 `wh-pirate-scout`（条目约 86 行）· `wh-pirate-hunt`（222 / 231 行）· `wh-pirate-warband`（256 / 262 / 263 行）
     的**全部条目**加 `FOE_MOUNT_IDS.gyroStabilizer`（262 行那条是劫掠电子舰、已有 `mounts` 数组 ⇒ 直接追加；**电子舰也要挂**）；
   - G 族卡 `wh-exile-blockade` · `wh-exile-swarm` · `wh-exile-line` 的**全部条目**加 `FOE_MOUNT_IDS.hullRepair`（无 `mounts` 属性的条目要新增）。
   - 星图悬赏 / 低安遭遇**一律不动**（只改洞内卡）。
2. **战斗消费端**（`packages/core/src/combat.ts`）：
   - 闪避：敌舰建档处（`createFoeSpecsFromShips`，约 2082 行 `speedMps` 那一段）把 `foeEvasionBonusAdd` 加到 `evasion`，夹 `min(0.9, …)`；
   - 回血：战斗步进里给挂了 `foeRepairPulse` 的敌舰按 `everyMs`（5000）回 `armor`/`hull`，实数 = 基数 × **k**，
     `k = 该层威胁 ÷ 45`（层威胁走 `wormholeFoes.ts` 那条曲线口径），**夹 `hpMax`、满血不回超**；
     计时用战斗时钟 `lastTickGameMs`；⚠ **运行态计时字段必须登记进 `save.ts` 清洗器**（逐字段重建 ⇒ 漏登记＝读档重置）。
3. **契约**（`tools/content-check.ts`）：A 族洞内条目必有陀螺仪 · G 族必有修理装置 · 星图侧不得出现这两件。
4. **文案**：两件挂载件的名与说明补中英双语 id（挂载件名会出现在敌舰悬停 / 战报里）。
5. **用例**：闪避 +10pp 真进命中判定 · 每 5 秒回 5/5 **且层越深回得越多** · **满血不再回**。
6. **收尾**：`npm run foe:export`（敌舰明细表加两列读数）· `npm run content:export` · 四闸门
   （`typecheck` / core 用例 / `content:check` / `l10n:check` / `ui:rot-check` / `build`）· **本地提交** · 报告船长 · 再按船长的话决定推不推。

## 四、验收要盯的一处

A 族**洞内**难度 = 数据 +10pp（0.22）＋ 陀螺仪 +10pp = **0.32**（劫掠电子舰 0.30 → **0.40**，它只吃陀螺仪那 10pp）
⇒ 我方面向 A 族的命中率在洞内下降约 10pp，是这次最可能偏硬的一档，验收时请船长特意打一场 A 族卡看手感。

## 五、本会话其他在途口径（一并交接）

- **推送纪律**：开发期间只本地 commit；完成后与报告一起推（§4 推送闸门 · 船长 2026-09-24「不要立刻推送」）。
- **内容工作台已扩到 8 张表**（`content-csv/content-workbench.xlsx`，新增 `foeShips` 敌舰可回写页 · 36 列裸值）；
  回写命令 `npm run content:import foeShips <xlsx或csv>`；**17 处字段只读**（C 族三艘抗性来自族常量 `C_FAMILY_RESISTS`、
  两艘速度倍率是分数表达式），改了不生效、工具会点名。
- **仍待船长定**：敌族数值是否按"我方新基线"调整（对照表见对话记录；三条路 甲 对齐 / 乙 不动 / 丙 只加基线列）。
