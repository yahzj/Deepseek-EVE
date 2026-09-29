# 扩槽插件上的装备"存不住"（2026-09-28 玩家报障）

- **状态：已修复（自测全绿，待船长验收）**
- **玩家报障原话（船长转述）**：「**船插增加的中槽和低槽上的装备无法保存进配置，重启游戏后会丢失。**」

## 一、根因（两处同源，都是"槽位数只按船型基础布局算"）

2026-09-27 那次「扩槽插件生效」改造**只改了两处**——装配校验 `equipment.wantedBaysOf` 与装配页格数
（`FitPage` 读 `shipSlotsWithPlugsOf`）——**漏了两处**，于是插件扩出来的格子"能装、存不住"：

| # | 位置 | 旧口径 | 后果 |
|---|---|---|---|
| ① | `equipment.ts` 的 `repairDeprecatedModules`「2) V18 槽位数对齐」 | `target = { high: shipDef.slots.high, … }`（**船型基础布局**） | **每次读档**把 `fitted.mid/low` 截回基础长度，**扩出来的那一格连同里面的装备一起退回装备库** ⇒「**重启就丢**」 |
| ② | `fitPresets.ts` 的 `applyFitPreset` | `slots = shipSlotsOf(shipDef)`，再 `Math.min(src.length, slots[rack])` | 套用方案时**扩出来的那几位直接不装**（静默丢弃）⇒「**存不进配置**」 |
| ③ | `fitPresets.ts` 的 `fitPresetDetailOf`（明细显示） | 铺行数按基础布局 | 把扩出来的那一格**当 `overflow` 报出去**（显示与实装不一致） |

**修法**：①②③ 全部改走**槽位单点** `plugs.shipSlotsWithPlugsOf`（= 船型布局 ＋ 插件扩槽），
与 `wantedBaysOf`、装配页格数、`ensureRackBays` 同一把尺。

## 二、实证（不是"看着像"）

- **复现玩家报障**：装了「中层舱段插件」+ 在中槽第 2 位装上装备 ⇒ 跑读档修复链（旧口径）：
  `fitted.mid` 从 `[null, 'mid-thing']` **被砍成 `[null]`**、装备退回装备库。
- 修后同一条路径：`fitted.mid` 保持 `[null, 'mid-thing']`，装备库不多不少。
- 用例 4 条（`packages/core/tests/plug-slot-add-20260927.test.ts` 新增一组）：
  ① 修复链不再砍扩槽位（含幂等）· ② **存档往返端到端**（存 → 读 → 跑修复链 ⇒ 装备仍在）·
  ③ 套用方案把扩槽位那件装回来（小结如实报「装上 2 件」）· ④ 明细按实际槽位铺、不报 overflow。
- 把 ① 那一行临时改回旧口径 ⇒ 用例 ①② 立刻红在「`expected [ null ] to deeply equal [ null, 'mid-thing' ]`」
  （**证明用例真能抓住这个 bug**，不是摆设）。

## 三、顺带做的一次审计：全仓 `shipSlotsOf` 调用点逐个过

| 调用点 | 结论 |
|---|---|
| `plugs.ts`（槽位单点内部） | 应取基础布局 ✓ 不改 |
| `equipment.ts`（本次修） | 已改单点 ✓ |
| `fitPresets.ts` 套用 / 明细（本次修） | 已改单点 ✓（明细走可选参数，缺省仍兼容基础布局） |
| `FitPage.tsx` 装配页格数 | 2026-09-27 已改单点 ✓ |
| `shipInfo.slotListText(ship?: ShipDef)` | 收的是**船型**、显示"船型布局" ⇒ **语义正确**，插件扩槽是**实例**属性，不改 ✓ |

## 四、闸门
`npm run typecheck` ✅ · `npm run test -w @whale/core` **262 文件 / 2794 用例**全绿 ·
`content:check` ✅ · `l10n:check` ✅ · `ui:rot-check` ✅（动了 `FitPage.tsx`）。

## 五、不涉及
- 不改存档结构（`fitted` 读档本来就是逐位照抄，问题只在读档**之后**的修复链）；
- 不改插件数值/扩槽数量；不改自动装配与装配校验的既有口径。
