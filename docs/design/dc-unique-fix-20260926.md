# 报障修复：玩家可以装多个损管（2026-09-26）

状态：**已修复 · 待船长验收**

## 玩家报障（船长转述）

「**发现BUG，玩家可以装多个损管**」

## 根因（一句话）

「同舰唯一」的检查**只挂在一条写路径上**：装配页的「装上」走 `equipment.fitModule`（有检查 ✓），
而**「换装」走 `equipment.swapModuleAt`**（`apps/.../game/engine.ts` 的 `swapModuleTo`，注释写明
"最终态合法、中间态非法的换装卡住 ⇒ 改走本命令"）——它**直接写 `bays[index] = moduleId`**，
从头到尾没查 `unique` ⇒ 玩家只要把第二件损管**换装**到另一个低槽就装上了（低槽多格的船都能复现）。

## 修复（三处）

1. **抽单点判据** `equipment.uniqueConflictOf(fitted, ctx, moduleId, ignore?)`：
   同舰至多一件带 `unique` 标记的件（判据按标记、不看型号 ⇒ MK1/MK2/MK3 互斥）；
   `ignore` = 正在被替换掉的那一位。
2. **两条写路径共用它**：`fitModule`（原有口径不变：`core.equipment.028`）＋ **`swapModuleAt`（本次补上）**。
   ⚠ **同槽换款仍然合法**（把损管 MK1 换成 MK3 不是"多装一件"）——这正是 `ignore` 的用途。
   装配方案套用（`applyFitPreset` 逐件走 `fitModule`）本来就在链上，无需另改。
3. **已有存档归正**（`repairDeprecatedModules`，载入修复链）：报障期间产生的**重复件**按
   「**保留靠前那一件**」（高→中→低、位序小者优先）归正，多余的**退回装备库**（不销毁资产），
   并写一条日志（新 id `core.equipment.029`，中英双语）。
   ⚠ **在洞编队跳过**（与"进洞船只所有行为锁定（含改装）"同口径）⇒ 出洞后载入即归正。

## 验证

- `packages/core/tests/damage-control.test.ts` 新增两条回归用例（10 用例全过）：
  ①「换装路径也必须拦住第二件损管」——低槽 4 格的船装 MK1 后，`swapModuleAt` 塞 MK2 ⇒ 被拒
  （`core.equipment.028`，低槽仍只 1 件）；**同槽换款放行**；②「存档归正」——白盒造出"两件损管"的档
  ⇒ 跑 `repairDeprecatedModules` 后只剩靠前的 MK1、MK2 回到装备库、写出归正日志。
- `npm run typecheck` ✅ · `npm run test -w @whale/core` ✅ **233 文件 / 2547 用例** ·
  `content:check` ✅ · `l10n:check` ✅。

## 待裁决点

「损管只能装备一件」现行口径 = **每舰一件**（多艘船各带一件是允许的）。若你要的是
**整个账号只许一件**（跨船也互斥），说一声——那是另一条判据（全局扫描 `state.fleet` 全部船）。
