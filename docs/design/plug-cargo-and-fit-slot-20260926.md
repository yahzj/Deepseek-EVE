# 报障两条：插件装货仓再卸货「不见了」＋ 所有船的插件显示成同一套（2026-09-26 · 二号 · d2）

状态：**已实现 · 待船长验收**（本地产物已重建，需重启游戏）。归档按 AGENTS.md §8。

## 船长原话（照抄）

> 「玩家将插件放到货仓再卸进仓库后插件不见了」
> 「而且所有舰船的舰船插件都是同一个」

## 一、报障①：插件卸货后「不见了」

**真因 = 装卸分流的判据写的是 id 前缀**：`inventory.isModuleCargoId` 原先 `return id.startsWith('mod-')`，
而**舰船插件的 id 是 `plug-*`**（`plug-shield-plate` 一类，见 `data/plugs.ts` 的 `PLUG_IDS`）
⇒ 从货仓卸货时被当**物品**扔进 `state.warehouse.items`，而物品页只列**物品目录**（`ctx.items`）里的东西
⇒ 一个装备 id 躺在物品仓库里**任何界面都没有入口**（东西其实一直在存档里，不是真丢）。

**改法（三件）**：

1. **判据改成查装备目录**：`isModuleCargoId(ctx, id)` = `ctx.modules.has(id)`——**不看 id 命名**，
   日后任何新 id 空间的装备自动命中（前缀判据是这条 bug 的根，不再留）。
2. **两个卸货入口收 `ctx`**：`unloadCargoOfShipToWarehouse(state, ctx, shipId)` ·
   `unloadCargoToWarehouse(state, ctx, itemId?)`——全仓调用点同步（core 7 处 ＋ 引擎 3 处 ＋ 用例）。
3. **存量修复** `repairMisplacedWarehouseModules(state, ctx)`：把**已经落错**在 `warehouse.items` 里的
   装备搬回 `moduleBay`（判据同样查装备目录 ⇒ 物品一件不动）。挂在**每次读档的载入修复链**上
   （与 `repairDeprecatedModules` 同处，新档也跑），**幂等** ⇒ 那位玩家的插件下次进游戏就回到装备库。

## 二、报障②：所有舰船的插件都是同一个

**真因 = 装配页的插件槽区块读错了船**：`FitPage.PluginSlotsSection` 里写的是
`const shipId = state.shipId`（**主控船**），而调用点 `<PluginSlotsSection engine={engine} />` **根本没传**
本页的目标船 ⇒ 从舰船页点别的船进装配台时，插件槽整块显示的是**主控船那一套**（所有船看起来一样）。
同页的其它区块（弹药档位 / 无人机舱 / CPU 条 / 槽位组）都读 `effectiveTarget`，只有这一块漏了。

**改法**：调用点传 `target={effectiveTarget}`、组件签名收 `target`、体内改用 `plugInfoOf(state, ctx, target)`。
**只读区块、无数据损坏**（插件一直挂在各自船上，只是显示错）。

## 三、涉及文件

- `packages/core/src/inventory.ts`：判据改查目录 ＋ 两个卸货函数收 `ctx` ＋ 新增 `repairMisplacedWarehouseModules`。
- 调用点：`core/{expedition,hauling,location,mining,salvaging,sideTasks}.ts` ·
  `apps/desktop/src/renderer/src/game/engine.ts`（三处卸货 ＋ 载入修复链）。
- `packages/core/src/index.ts`：导出 `isModuleCargoId` / `repairMisplacedWarehouseModules`。
- `apps/desktop/src/renderer/src/pages/FitPage.tsx`：插件槽区块收 `target`。
- 用例：`tests/cargo-carry.test.ts`（判据 ＋ 真目录全量对照 ＋ 报障回归 ＋ 存量修复）·
  `tests/ship-plug.test.ts`（同两条报障回归，含装配页源码契约）· `tests/dock-unload.test.ts`（签名）。

## 四、验证

- **真目录全量对照**（新增护栏）：`buildSimContext()` 里**装备目录每一件**都必须判成模块、**物品目录每一件**
  都不许判成模块 ⇒ 将来再冒出"另一个 id 空间的装备"当场就红。
- **报障回归**：插件装船 → 整仓卸货 ⇒ 回 `moduleBay`、`warehouse.items` 里没有它；
  存量档（插件已在物品仓库）⇒ 修复函数搬回装备库且物品不动、再跑一次为 0（幂等）。
- **装配页源码契约**：调用点必须传 `target`、组件签名必须收 `target`、区块体内不得再出现 `state.shipId`。
- **反向验证两条**：① 把判据改回 `mod-` 前缀 ⇒ **6 例当场转红**；② 把调用点改回不传 `target` ⇒
  源码契约例**当场转红**；两条都还原即全绿。
- `npm run typecheck` 四包 0 错 · `npm run test -w @whale/core` **237 文件 / 2618 用例全绿** ·
  `content:check` ✅ · `l10n:check` ✅ · `ui:rot-check` ✅ · `build` ✅。

## 五、待船长裁决 / 备注

1. **那位玩家的插件不用手动补**：他的插件一直在存档里的 `warehouse.items`，下次读档会被搬回装备库
   （与"黑匣补发"不同，这不是发放、是**归位**，所以不做一次性标记、每次读档都跑）。
2. 同类 id 前缀判据全仓扫过一遍：只剩**有意为之的家族过滤**（`mod-lair-` 窝点专属、`mod-wh-` 虫洞族），
   装卸分流这一类"判物品还是装备"的前缀判据只此一处、已去掉。
