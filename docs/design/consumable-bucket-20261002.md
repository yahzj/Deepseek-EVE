# 道具（`consumable`）归「消耗品」桶 ＋ 逐件一档（工作文档）

- **状态：进行中**（2026-10-02 开工；实现与闸门已完成，待船长验收）
- 经办：一号（主树 `main`）
- 归档时：关键结论并入 `docs/roadmap.md` 一条精简条目后删除本文件（§8 文档纪律）

## 1. 船长原话（照抄）

> 「这两天新加的这些消耗品，在手册中查看不到」

> 「信号发射器和技能加速剂应该归类到消耗品内。每个单独一个档位。」

（我集中提问「超空间折跃燃料同属道具、读数一模一样，要不要一并」⇒ 船长答**甲：三件一并**。）

## 2. 现场与根因（动手前量过，临时探针 `tools/_probe-consume-bucket.mts` 已按工具纪律删除）

| 道具 | `kind` | 改前落桶 | 消耗品桶原有三档（弹药/修理组件/无人机）能筛到吗 |
|---|---|---|---|
| `jump-fuel` 超空间折跃燃料 | `consumable` | **货物** | ❌ 一个都筛不到 |
| `invasion-beacon` 信号发射器 | `consumable` | **货物** | ❌ 一个都筛不到 |
| `synaptic-accelerant` 突触加速剂 | `consumable` | **货物** | ❌ 一个都筛不到 |

- **不是"彻底不见"**：它们被归在「货物」组里 —— 但一级选「消耗品」**永远筛不到**，而这正是玩家找消耗品的地方
  （市场 / 物品仓库 / 货仓 / 手册图鉴**四处共读同一张单点表** ⇒ 四处同病）。
- 根因 = 2026-10-01 那次分类收敛**照现状**把它们留在了货物桶，当日注释原话：「`consumable`（道具…）
  同样落「货物」桶……本批**照现状**（不擅自改口径），**已记回报待船长定**」——船长今回定案。

## 3. 逐条改动

| # | 文件 | 改动 |
|---|---|---|
| 1 | `apps/desktop/src/renderer/src/ui/itemSubs.ts` | ① `BUCKET_OF_ITEM_KIND`：`consumable` `'item'` → **`'consume'`**；② `itemBucketPasses`：货物桶新增剔除道具、消耗品桶收道具；③ 新增 `CONSUMABLE_SUB_PREFIX` / **`CONSUMABLE_ITEM_SUBS`**（三件道具逐件一档）与 **`CONSUME_BUCKET_SUBS`**（三个大类 ＋ 逐件档）；④ `SUBS_OF_KIND.consume` 改读 `CONSUME_BUCKET_SUBS`；⑤ `itemSubPasses` 新增 `consume-item-<物品 id>` 分支；⑥ `SubOption` 加 `itemId`、`subText` 加可选物品名解析器；⑦ 相关注释按新口径改写 |
| 2 | `apps/desktop/src/renderer/src/pages/MarketPage.tsx` | 二级下拉与"全部 X · 子档"标题传物品名解析器（道具档名取物品名） |
| 3 | `apps/desktop/src/renderer/src/pages/ItemsPage.tsx` | 仓库二级档行传解析器 |
| 4 | `apps/desktop/src/renderer/src/panels/Handbook.tsx` | 图鉴二级档行传解析器 |
| 5 | `tools/content-check.ts` | **新增「道具归档契约」**（见第 5 节） |
| 6 | `tools/filters-export.ts` | 筛选清单导出登记新表 `CONSUMABLE_ITEM_SUBS`；物品档的英文列标明"随物品名" |

**档位表形态**（键 = `consume-item-<物品 id>`，前缀判定 ⇒ 日后新增道具不必回头改判定分支）：

```
消耗品：弹药 · 修理组件 · 无人机 · 超空间折跃燃料 · 信号发射器 · 突触加速剂
        └── CONSUME_SUBS（按 kind）──┘  └── CONSUMABLE_ITEM_SUBS（按物品 id）──┘
```

⚠ **组装机/书架的「消耗品蓝图」二级筛选仍只读 `CONSUME_SUBS`**（按**产物大类**分；蓝图没有"哪一件道具"这一维）
⇒ 逐件档只进 `CONSUME_BUCKET_SUBS`，不并进 `CONSUME_SUBS`。

## 3.1 范围自报（§十八）与跨域批准

`scope:check` 读数：**6 个文件 · 3 个功能域** —— 「物品与货仓」（`ItemsPage.tsx` / `itemSubs.ts`）·
「市场与经济」（`MarketPage.tsx`）· 「存档与元系统」（`Handbook.tsx`）。

**船长批准：跨 物品与货仓↔市场与经济↔存档与元系统**（2026-10-02）：这四处**本来就是共读同一张单点表**的
（船长 2026-10-01 裁定「以市场为准，三处都改，**四处共读**」）⇒ 分类改动天然落在四处；集中提问时
我已在方案里逐条写明「市场 / 物品仓库 / 货仓 / 手册图鉴四处随单点同步生效」，船长答**甲**放行。
本处与提交说明各记一次。

## 4. 范围 / 不做

- **不新增玩家可见文案**：道具档的档名**取该物品自己的名字**（`ctx.items.get(id).name`，中英随物品表走）
  ⇒ 不在分类表里再抄一份名字（改物品名只改一处）。
- **不动**弹药/修理组件/无人机三档的判定；不动 `COMMODITY_TABS` 一级类型表本身；不动蓝图侧的分类。
- **不动**手册的分组顺序、卡片形态与详情窗。
- 活动栏/技能页的加速剂相关界面（上一批）不涉及。

## 5. 新增契约：**道具归档契约**（`npm run content:check`）

判据源 = 数据 `ITEMS` 的 `kind === 'consumable'` ↔ 单点表 `CONSUMABLE_ITEM_SUBS` 的 `itemId`，**两个方向都查**：

1. 数据里每件道具都必须登记（**漏登记即红** —— 本次报障的形态就是"新加了一件道具、没人登记 ⇒
   玩家在任何筛选里都找不到它"）；
2. 登记表里每一项都必须对应一件真道具（**id 打错即红**，否则那一档恒空）。

**负例验证**（临时删掉「信号发射器」那一档 ⇒ 契约报红并点名 `invasion-beacon`，随后还原）：
契约确实抓得住这个形态，不是纸面条款。

## 6. 文案台账

| 日期 | 位置 | 改动 | 依据 |
|---|---|---|---|
| 2026-10-02 | `ui/itemSubs.ts` 的 `CONSUMABLE_ITEM_SUBS` | 新增三个档位（**档名取物品名**，`label` 只作兜底） | 船长令「每个单独一个档位」 |

## 7. 验证

`typecheck`（四包）· `content:check`（新增契约 ＋ 原有契约全绿）· `l10n:check` · `l10n:params` ·
`ui:rot-check`（含 `ui-subs-check`：键/文案/id 唯一、无直读中文标签表）· 探针读数（改前 ❌ / 改后 ✅ 逐件命中自己的档）·
`tools/filters-export.ts` 单文件 `tsc` 净（tools 不在既有 typecheck 范围内，用临时 tsconfig 单独过了一遍）· 桌面构建 ✓。
观感与"档位顺序/要不要再合并"归船长。

## 8. 船长裁决（2026-10-02 · 一号四问汇报后的答复）

> 船长原话：「**1 没问题**」

- **本批观感与档位顺序：通过**（三件道具排在弹药/修理组件/无人机之后的顺序不变，不再合并）⇒
  `CONSUMABLE_ITEM_SUBS` 的顺序与档名**冻结**，无新指令不再动。
- 同批另三条答复（第 2/3/4 条）分别记在：推送闸门与 R 族发布 = `announcement-draft-20261002-corona.md` §六；
  ×3/×4 加速剂 = `skill-boost-panel-20261002.md` §八。**本会话据此不推送、不启新批。**
