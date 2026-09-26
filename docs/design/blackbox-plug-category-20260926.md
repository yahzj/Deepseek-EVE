# 黑匣独立成类 ＋ 装备归属档新增「舰船插件」（2026-09-26）

状态：**已实现 · 待船长验收**

## 船长原话（照抄）

1. 「**入侵获得的黑匣在仓库内查看不到，需要新增分类。并且在装备图鉴中，和高中低槽同级的位置，
   新增一个舰船插件的分类。修改的过程中要记住筛选统一化的规则**」
2. 「**按你推荐来，不过建议市场内黑匣单独一个分类，不要挪到「货物」。**」

## 根因（读数，不是猜）

| # | 现象 | 根因 |
|---|---|---|
| ① | 黑匣在仓库里「查看不到」 | `blackbox-h` 的 `kind` 是 **`'kit'`**（09-25「黑匣先做壳」那批借的"无配方消耗品豁免档"），而仓库/货仓/手册/市场**全按 kind 分类** ⇒ 它被塞进 **「修理组件」** 里。⚠ 真档里它**在**（`state.warehouse.items['blackbox-h'] = 3`），不是没入库 |
| ② | 插件在装备图鉴里没有自己的档 | 插件是 `slot: 'plug'` 的装备，但数据为满足体检契约声明了 `rack: 'low'` ⇒ `rackOf()` 判成**低槽**；装备图鉴的归属档行只有 高/中/低，分组键 `moduleSubKeyOf('plug')` 又无归属 ⇒ 掉进「其它」 |

## 甲案（船长已确认 · 含"市场单独一档"的修正）

### ① 黑匣独立成类（`ItemKind` 新增 `blackbox`）
- core `types.ts` 加 `| 'blackbox'`（带成因注释）；`ITEM_KIND_ORDER` 插在「蓝图碎片」之后、「修理组件」之前；
  `ITEM_KIND_LABELS` 加「黑匣」。
- `items.ts`：`blackbox-h` 的 `kind` 由 `kit` 改 `blackbox`。
- **仓库分类 / 货仓分组 / 手册物品图鉴**三处按 `ITEM_KIND_ORDER` 渲染 ⇒ **自动**多出「黑匣」一档（零页面改动）。
- **市场**：一级类型新增 `'blackbox'` 一档（船长令「单独一个分类，不要挪到「货物」」）⇒
  `BLACKBOX_KIND_KEYS` 单点（`ui/itemSubs.ts`）+ `itemBucketPasses` 的「货物」与「消耗品」两档**都剔除黑匣**。
- 配套登记：`ui/labelsText.ts` 的 `KIND_ID`、l10n 新词条 `ui.labelsText.069`（黑匣 / Black boxes）、
  `ui/tones.ts` 的 `TONES.blackbox`、`packages/ui/src/index.css` **7 个主题块**各加 `--wui-tone-blackbox`、
  `ui/Glyphs.tsx` 的 `SHAPES.blackbox`（记录匣线稿：匣体 ＋ 匣盖分缝 ＋ 指示灯）。
- 体检：无配方豁免改为「**必须是登记在册的黑匣 id**」（core `isBlackboxItem`）；蓝图材料放宽档由 `kit` 换成
  `blackbox`（插件图纸每件吃 1 个黑匣，原先正是靠 `kit` 那条放宽进来的）。

### ② 装备归属档新增「舰船插件」（与原「高/中/低槽装备」同级）
- **新单点 `rackDimKeyOf(def)`**（`ui/itemSubs.ts`）：`slot === 'plug'` ⇒ `'plug'`，其余照旧 `rackOf`。
  `RACK_SUBS` 变四档（高/中/低/**舰船插件**）；`RACK_LABELS.plug` 与物品种类名共用同一条 id。
- **判定收敛**：`rackPasses` 改读单点 ⇒ 高/中/低三档**不再收插件**；手册装备图鉴的分组与蓝图图鉴分组
  原先是各自直接读 `rackOf`（插件蓝图会归进低槽），现同样改读单点。
- 功能分组族：`MODULE_SUBS` 加 `plug` 一档、`MODULE_SUB_SLOTS.plug = ['plug']` ⇒ 插件不再掉进「其它」。

### ③ 筛选统一化（船长提醒的那条）逐条对照
| 基线 | 本次做法 |
|---|---|
| ① 二级「全部」文案 | 不动（胶囊行「全部」＋同行灰字前缀「槽类：」） |
| ② 键空间 | 一级仍 `'all'`／下级仍 `SUB_ALL`；新档键 `plug` / `blackbox` 与既有一致 |
| ③ 级联 vs 并列 | 不动（装备图鉴归属档是主筛选行；插件档与之同级） |
| ④ 重置规则 | 不动（换上级回「全部」） |
| ⑤ 选项表唯一来源 | 新档**只**加在 `ui/itemSubs.ts`（`RACK_SUBS` / `MODULE_SUBS` / `MODULE_SUB_SLOTS` / `BLACKBOX_KIND_KEYS`）；页面只渲染 |
| ⑥ 判定实现单点 | 只改 `rackPasses`（新单点 `rackDimKeyOf`）与 `itemBucketPasses`；页面不自写 |
| ⑦ 搜索与筛选 | 未动（取「与」） |
| ⑧ 视图切换 | 未动（浏览型清单照旧） |
| 空档隐藏（09-20） | 手册主筛选走 `presentSubs` ⇒「舰船插件」档只在真有卡片时出现（现有 12 件，恒出现） |

**边界**：不动机制 / 数值 / 存档结构（存档存的是物品 id，不是 kind）；市场黑匣价与档位一字未动。

## 改动文件

- core：`types.ts`（ItemKind）· `labels.ts`（ORDER + LABELS）。
- data：`items.ts`（kind 改档）· `l10n/table.ts`（新词条 `ui.labelsText.069`）。
- 界面：`ui/labelsText.ts` · `ui/tones.ts` · `ui/Glyphs.tsx` · `packages/ui/src/index.css`（7 主题块）·
  `ui/itemSubs.ts`（两条单点 ＋ 两张表）· `pages/MarketPage.tsx`（一级类型 ＋ 文案）·
  `panels/Handbook.tsx`（两处分组改读单点）。
- 工具：`tools/content-check.ts`（无配方豁免 ＋ 材料放宽档换档 ＋ **两条新契约**）。
- 测试：`packages/core/tests/blackbox-plug-category-20260926.test.ts`（9 用例）。

## 验证

- `packages/core/tests/blackbox-plug-category-20260926.test.ts` **9/9**：黑匣档位与登记 · 修理组件三件不受影响 ·
  市场行照旧（只收不卖 / 奇货 / 80 万，未动经济）· 中英词条 · 插件 12 件 raw `rack: 'low'` 的历史事实 ·
  单点与四档键序 · 手册两处旧写法已清 · 图标与 7 个主题色调齐备。
- `npm run content:check` ✅，新增两条契约当场读数：
  「**黑匣契约**：blackbox-h 独立成类（仓库/货仓/图鉴/市场四档一致）· 市场「货物」与「消耗品」都不再收它」
  「**归属档契约**：高/中/低/舰船插件 四档（插件 12 件自成一档，不再算低槽；普通低槽件 51 件照旧）」
- `npm run typecheck` 四包 0 错 · `npm run test -w @whale/core` **全绿**（234 文件 / 2575 用例）·
  `l10n:check` / `ui:rot-check` / `ui:tokens` / `ui:theme-check` / `ui:layout-css:check` ✅ ·
  `npm run filters:export` 复核筛选清单 · `npm run build` ✅。

## 已知取舍

- 黑匣在**市场**仍是「只收不卖 · 奇货档」：本次只动分类，不动经济（要提价/改档另说）。
- 插件与插件图纸**当前不上市场**（市场卡挂 `unreleased`）⇒ 市场一级类型**没有**「舰船插件」档；
  等插件上市那批再加（`RACK_KIND_KEYS` 是市场那三档的单点，届时一并扩）。
