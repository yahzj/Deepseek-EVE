# 舰船插件进 Excel ＋ 章鱼人商店卖通用黑匣（2026-09-27 · 二号 · d2）

状态：**进行中** —— A 部分（工作台两张新表）**已落码并验证**；B 部分（通用黑匣 ＋ 任意黑匣替代组）**设计已确认、待落码**。

## 船长原话（照抄）

> 「**你先将各种船插放入excel表，我打算微调和增加，同时在章鱼人声望商店加入购买通用黑匣的卡片，
> 玩家可以用30声望换一个通用黑匣。（现有的舰船插件蓝图都只要使用任意类型黑匣就可以制作）**」

三处追问的答复：

| 问 | 答 |
| --- | --- |
| 插件进 Excel 的形态 | **甲：做成工作台新表**（`content:export` → 你改 → `content:import` 回写，支持微调） |
| 「任意类型黑匣」怎么落 | **甲：料单加"替代组"**（配方仍写黑匣 ×1，旗舰黑匣与通用黑匣任一枚都能交） |
| 通用黑匣能不能卖 | **「按500万算价格，只收不卖」** ⇒ `baseSellPriceIsk = 5,000,000` ＋ 市场行 `playerBuyable: false` |

二号自定的默认（船长未反对）：30 点**只扣可支配声望**、门槛仍读累计 · 兑换**无次数上限** ·
通用黑匣体积 **5 m³**（与旗舰黑匣同）· 消耗时**先扣通用黑匣**（把能卖 8,000 万的旗舰黑匣留给市场）。

---

# A. 舰船插件进工作台（已落码 · 已验证）

## A1. 落码

| 文件 | 改动 |
| --- | --- |
| `tools/content-schema.ts` | 新增两张表：**`plugs`**（18 列：id/名称/slot/rack ＋ 13 个效果字段 ＋ 描述）与 **`plugBlueprints`**（8 列：id/名称/moduleId/材料 list/工时/制造费/书价/描述） |
| `tools/content-export.ts` | 两张表接进导出：插件取 `MODULES.filter(slot === 'plug')`、图纸取 `BLUEPRINTS.filter(id 以 bp-plug- 开头)`（判据与 core 的 `plugs.isPlugOf` 同源） |
| `tools/content-import.ts` | 两张表接进回写（`IDS` 主键校验）＋ **修一处工具缺陷**（见 A2） |

**导出读数**：`content-csv/` 现 **10 张表 / 1058 条** —— 新增 `plugs.csv`（12 行 × 18 列）与
`plugBlueprints.csv`（12 行 × 8 列）；主格式 `content-csv/content-workbench.xlsx` 同步变成 **10 张 sheet**
（底部标签「plugs」「plugBlueprints」）。

## A2. 顺带修掉的工具缺陷（否则这张表根本回写不了）

插件对象写的是 **`id: PLUG_IDS.shieldPlate`**（常量引用，为的是"写错当场编译不过"），而导入端收集对象块时
**只认字符串字面量** ⇒ 首次 dry-run 整张表报「源文件找不到 plug-shield-plate 的对象块」。

修法：`content-import` 新增**同文件字符串常量表**（`const X = 'lit'` 与 `const OBJ = { k: 'lit' }` ⇒ 键 `OBJ.k`），
并在主键解析处先查它；⚠ 还必须**剥掉 `as const` / 括号 / 类型断言**——`PLUG_IDS` 正是 `{…} as const`，
第一版漏了这一步、仍然匹配不上（第二轮实测才通过）。**只认同文件、只认字符串字面量，解析不出照旧跳过**。

## A3. 验证（实测）

| 项 | 读数 |
| --- | --- |
| 往返 dry-run | `content:import plugs content-csv/plugs.csv --dry-run` ⇒ **✅ 无差异**；`plugBlueprints` 同 |
| **真实回写**（本轮实测） | 把导出的 CSV 里 `plug-shield-plate` 的 `shieldHpAdd` 改成 **41** ⇒ 导入：**「计划改动 1 处」→「已回写 packages/data/src/plugs.ts」**，`git diff` 只有一行 `shieldHpAdd: 40 → 41`（最小 diff、注释与排版不动） |
| 还原 | `git restore packages/data/src/plugs.ts` ⇒ 工作区干净（改动是测试用的，未留） |

## A4. 两条须知（船长调表前看一眼）

1. **改数值要连带改描述**：插件描述里写着高亮数值（如「护盾上限 +40」）；实测把它改成 41 时，
   导入工具的**自动校验那一步会报红**（`content:check`），提示你描述与数值不一致 —— 请一起改。
2. **表里加一行不会自动变出插件**：`content:import` 的护栏是"主键只读 ⇒ 未知 id 一律拒绝"（防筛选视图
   误删/误加）。要**增加**新插件（连带图纸、英文名/英文描述、市场占位卡）说一声，我给这两张表开一条
   "允许新增行"的回灌通道 —— 或者你只给数值，我手工落码。

---

# B. 通用黑匣 ＋ 任意黑匣替代组（设计已确认 · 待落码）

现状（已核对）：插件图纸 12 张的料单**写死 `blackbox-h`**（墨潮旗舰黑匣，卖价 8,000 万、市场只收不卖）；
制造侧按 `itemId` **一对一**校验/扣除/退料（`missingMaterials` / `spentMaterials` / 退料），
全仓**没有"任意一种"这个概念**。兑换窗口在 `core/plugs.ts`（图纸 8 点、兑换即学会、已学会即隐藏）。

## B1. 落码清单（待做）

| 文件 | 改动 |
| --- | --- |
| `packages/data/src/items.ts` | 新物品 **通用黑匣** `blackbox-universal`（`kind: 'blackbox'` · 5 m³ · `baseSellPriceIsk: 5_000_000`） |
| `packages/data/src/marketCatalog.ts` | 市场行：`basePrice 5_000_000` · **`playerBuyable: false`**（只收不卖，守「专属内容只收不卖」契约） |
| `packages/data/src/l10n.ts` | 英文名与描述（`Black Box (Universal)` 一类，按 `docs/glossary-en.md` 口径） |
| `packages/core/src/manufacturing.ts` | **材料等价组**：`MATERIAL_GROUPS`（组序 = 优先扣除序）＋ `materialGroupIdsOf(itemId)`；`missingMaterials` 按**组内合计**判、扣料按组序取、`spentMaterials` 记**实际扣的那一种** ⇒ 退料天然按实际退 |
| `packages/core/src/plugs.ts` | `UNIVERSAL_BLACKBOX_ITEM_ID` · `UNIVERSAL_BLACKBOX_COST = 30` · `exchangeUniversalBlackBox(state, ctx)`（扣可支配声望 ⇒ `addWare` 入仓库 ＋ 日志 `core.plug.012`）；行模型扩成"图纸行 ＋ 黑匣行"两支 |
| `apps/desktop/.../panels/PlugExchange.tsx` | 新增那张卡（标题/说明/30 点/买按钮/声望不足禁用） |
| 12 张图纸的数据 | **不动料单**（仍写 `blackbox-h`）；只把描述里的「须先取得墨潮旗舰黑匣」改成**任意黑匣**（玩家可见文案改动 ⇒ 留 `⟪文案调整 2026-09-27⟫` 记号 ＋ 本文件台账） |
| 新用例 | 兑换（扣 30 可支配 · 入仓库 · 声望不足拒绝 · 可重复）· 替代组（只有通用黑匣能造 / 只有旗舰黑匣能造 / 两种都有时**优先扣通用**）· 退料退实际那一种 · 缺料提示按组合计 |

## B2. 设计取舍（为什么用"中心等价组"而不是给料单项加字段）

- 「任意黑匣」是**物品之间**的关系，不是某张图纸的私事 ⇒ 放在中心的 `MATERIAL_GROUPS` 一处，
  日后别的料（如各种零件档）要互通只加一行；**料单数据一个字不用改**、工作台列格式也不用扩。
- 组序 = **优先扣除序**（`['blackbox-universal', 'blackbox-h']`）⇒ 先花声望换来的那一种，
  把能卖 8,000 万的旗舰黑匣留给市场（船长 09-26 提价的那件）。
- 退料按 `spentMaterials` 里记的**实际 id** 退 ⇒ 造到一半取消不会把通用黑匣退成旗舰黑匣。

## B3. 文案调整台账（B 落码时填）

| 日期 | 位置 | 原 → 新 | 缘由 |
| --- | --- | --- | --- |
| （待落） | `blueprints.ts` 12 张插件图纸 `description` | 「须先取得墨潮旗舰黑匣」→「须先取得任意黑匣」 | 任意黑匣替代组（船长 2026-09-27 令） |

## A5. 🔴 事故记录：导出覆盖了船长手改的工作台（2026-09-27 · 二号自记）

**经过**：船长 13:09 改完 11 件插件（18 个字段）并存盘；经办人先跑了一次 `content:import plugs --dry-run`
（看到 18 处改动、**只记了字段名没记值**），随后**在导入之前**跑了 `npm run content:export` ——
该工具是**无条件覆盖**写 `content-csv/content-workbench.xlsx` ⇒ **船长那一版被"从 data 派生的干净版"整个盖掉**；
Excel 侧无锁文件 / 无未保存副本 / 无 autorecover ⇒ **改动永久丢失**。

**已补的护栏**（`tools/content-export.ts`）：导出前把上一次的产物整体复制到
`content-csv/_prev-<时间戳>/`（保留最近 3 份）并在控制台指明路径与回灌命令
⇒ 同类误操作最多丢一次编辑，可从备份目录捞回。

**正确流程（写进工具输出里了）**：**先导入、再导出** —— 表里改过的值没回写进 data 之前，别跑导出。

**教训**：工作台是"船长手改的第三份"（导出件头部早就写着这句），**它比 data 更权威**；
任何会写这份文件的动作（`content:export`）都必须在"确认没有未导入的改动"之后再做。

- **B 落码**（上表清单）＋ 闸门 ＋ 用例；
- 回来后按船长裁决决定要不要开"新增行"回灌通道（A4 第 2 条）。
