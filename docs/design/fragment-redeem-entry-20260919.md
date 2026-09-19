# 碎片兑现入口：物品页「逆向解锁」（2026-09-19 · 二号 · 玩家报障修）

> **状态：进行中**（已落码并合入 main，等船长实测验收）
>
> **船长原话（照抄）**：「玩家回收残骸集齐了25个蓝图碎片，但是找不到在哪换成蓝图」
>
> **船长裁定**：入口位置选**甲案**——物品页「蓝图碎片」分组行内兑换。

## 一、复现路径与根因（报障处理四项）

- **复现路径**：纯代码复核（玩家反馈的问题不在本地存档，故不读本地档）——
  ① `packages/core/src/industry.ts` 的 `redeemFragments(state, ctx, moduleId)` 与 6 条 `FRAGMENT_RECIPES` 一直都在，core 用例「集齐 25 片 → 永久解锁蓝图（learnedRecipes）；重复/不足被拒」长期全绿；
  ② 但全仓 grep：`redeemFragments` 在 `apps/desktop` 下 **0 处**、`逆向` 二字在玩家可见 UI 里 **0 处**、`game/engine.ts` 里连 `fragment` 都没出现过 ⇒ **渲染层一次都没接线**。
- **根因代码位置**：`apps/desktop/src/renderer/src/game/engine.ts`（缺兑命令）＋ `pages/ItemsPage.tsx`（碎片行只渲染禁用的「不在市场目录」）＋ `ui/itemView.tsx` 的 `kindExtraNote()`（碎片分组没有一句去处提示）。
- **玩家可见现象**：碎片在物品页「蓝图碎片」分组看得到（说明写着"集齐 25 片可在母港**逆向**解锁…"），但站内**任何地方都没有兑换按钮** ⇒ 集齐 25/250 片无处可用；MK3 三本书按设定只从碎片出，这条路一断 = **MK3 无法自制**。
- **影响面**：6 条逆向配方（`mod-miner-2` / `mod-cargo-2` / `mod-turret-kin-2` 各 25 片；`mod-miner-3` / `mod-cargo-3` / `mod-turret-kin-3` 各 250 片）。存档结构零改动（`learnedRecipes` 早就落档）。

## 二、改法（船长选甲案）

| 层 | 改动 |
|---|---|
| core | 新增读数单点 `fragmentRedeemRowsOf(state, ctx)`（逐条给「现有 / 门槛 / 已掌握 / 在空间站 / 可兑」，与 `redeemFragments` 同源）+ 类型 `FragmentRedeemRow`；碎片说明文案改成**点名真实入口**（旧文"可在母港逆向解锁"= 承诺了一个不存在的入口） |
| 引擎 | `engine.redeemFragmentsAt(moduleId)`（成功后落盘 + 通知）与 `engine.fragmentRedeemRows()` |
| 界面 | 新增共用组件 `ui/fragmentRedeem.tsx` 的 `RedeemFragmentButton`：**物品页（仓库）行**与**货仓页行 + 点选弹层**三处同款按钮——不够片禁用并写「逆向解锁 12/25」与差几片；够片且停靠空间站 ⇒ 主按钮可点；已掌握 ⇒ 「已解锁配方」；`ui/itemView.kindExtraNote('fragment')` 补一句去处指引 |
| 契约 | `content:check` 新增「**碎片兑现入口契约**」：① 每条配方都要有碎片物品（kind/名字/蓝图齐备）② 碎片说明必须含「逆向解锁」且**不得再写"母港逆向"** ③ 渲染层必须至少调用一次 `redeemFragmentsAt` 且存在「逆向解锁」按钮文案 —— 专挡"引擎有、界面没接"这类沉默漏接 |
| 用例 | core +2：「逆向解锁读数 6 条逐条一致（含货仓+仓库一本账、兑后转"已掌握"）」·「碎片说明点名真实入口、不再出现"母港逆向"」 |

## 三、同类排查（顺手做的一次体检）

按同一手法扫了一遍 core 导出的"命令类"函数在渲染层是否 0 处引用（`tools/_probe-unwired.ts`，临时探针已删）：
23 个命中里逐个核过——舰船出售（`sellShipAtMarket` / `placeStoredShipSellOrder`）、维修（`repairWithKits*`）等都**经引擎方法接线**（`engine.sellStoredShipAt` / `repairShipAt`），其余是纯内部助手；**只有碎片兑换是真漏接**（本次已修）。

## 四、验证

- `npm run typecheck` 四包全绿 · core **168 文件 1832 例**全绿 · `content:check` 通过（新增契约报「渲染层 `redeemFragmentsAt` 3 处调用」）· `ui:rot-check` 通过 · desktop build 通过。
- 已合入 main 并重建 `web/dist`；请 Ctrl+F5 后实测路径：**物品页 → 「蓝图碎片」分组 → 那一行点「逆向解锁」**（碎片不够时按钮会写"逆向解锁 12/25"并说明还差几片；在站外会提示需停靠空间站）。

## 五、待办

- 船长实测验收（观感与入口位置归船长判）；验收后按 §8 归档（结论并入 `docs/roadmap.md` / `docs/glossary.md` → 删本工作文档 → 重跑 `docs:index`）。
- 可选项：要不要为这次修复补一条玩家公告（若补，按 §7 先递待审稿）。
