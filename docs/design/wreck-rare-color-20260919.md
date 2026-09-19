# 稀有残骸 / 普通残骸按图标颜色区分 · 2026-09-19

- **状态：进行中（已实现 · 待船长实机验收）**
- **船长原话（照抄）**：「将稀有残骸和普通残骸进行下区分，建议用颜色区分」
  ＋ 审核通过：「**残骸配色没问题，可以执行**」
- 三答（集中提问后船长选定）：**只给图标上色** · 取**稀有金 `#f4c95d`** · 范围限**货仓页 ＋ 物品页仓库**
- 经办：一号 · 已落码 · 四道闸门全绿

## 1. 口径

| 项 | 取法 |
|---|---|
| 判据 | 物品 id 前缀 **`wreck-rare-`**（13 组的稀有残骸 = `wreck-rare-<组 key>`，见 core `rareWreckItemIdOfKey`）；普通残骸 = `wreck-<组 key>` |
| 稀有色 | **`#f4c95d`**——与 `.app-chip.is-rare`（残骸打捞卡 / 星图稀有残骸战果行 / 工业页「稀有」徽标）**同一支色阶** |
| 普通色 | 保持现状旧黄铜 `#b8a37a`（`TONES.wreck`） |
| 造型 | 两者继续共用同一枚 `wreck` 线稿（与 `box-bp-*` 按层档、`ai-core-*` 按稀有度分色**同一套做法**，见 §6 UI 纪律） |
| 覆盖范围 | **货仓页 ＋ 物品页仓库**：列表视图行首图标 · 图标网格卡片 · 详情弹层 40px 大图标（各 3 处） |

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/renderer/src/ui/Glyphs.tsx` | 新增导出 `RARE_WRECK_TONE = '#f4c95d'` 与 `inventoryItemTone(itemId, kind)`：`wreck-rare-` 前缀 ⇒ 稀有金，其余 ⇒ `toneOf(kind)`（逐字现状）。**不动** `TONES` 与 `itemToneOf`——虫洞散货、工业页回收炉、星图打捞、手册图鉴都在读那两条，改它们会越出船长圈定的范围 |
| `apps/desktop/src/renderer/src/ui/itemView.tsx` | `RowGlyph` 增加可选 `tone`（缺省仍 `toneOf(glyph)`）；`ItemGridCell` 增加可选 `tone`，`ItemGlyphGrid` 取 `c.tone ?? toneOf(c.glyph)` ⇒ 手册 / 装配 / 货仓装备卡等既有调用**零变化** |
| `apps/desktop/src/renderer/src/pages/ItemsPage.tsx` | 3 处接线：列表行首图标 · 图标网格 cells · 详情弹层大图标 |
| `apps/desktop/src/renderer/src/pages/CargoPage.tsx` | 同上 3 处接线 |

**行为变化（玩家可见）**：货仓页与物品页仓库里，**稀有残骸图标 = 稀有金**、**普通残骸 = 旧黄铜**（现状）。
名称文字、徽标、其它界面（手册图鉴 / 工业页回收炉 / 星图打捞页 / 虫洞散货清单）**一律不变**。
**零新增文案**（不涉双语规矩）· 零数值与存档改动 · 不需迁移。

## 3. 验证

- 判据核对：core `rareWreckItemIdOfKey()` 恒返回 `wreck-rare-<组 key>`（13 组全量），前缀判定不漏不误。
- `npm run typecheck` 4 包 0 错 · `npm run ui:rot-check` ✅（第五道闸门）· `npm run build` ✅ ·
  `npm run test -w @whale/core` **173 文件 / 1,882 测试全绿**。
- 观感（两种黄/金在列表里够不够分辨）按 §九由船长实机判；本次只做"图标色"这一条读数型改动。

## 4. 已知取舍 / 待船长

1. **手册图鉴与工业页回收炉仍是同色**（船长圈定范围之外）。日后想统一：把那两处的 `toneOf(...)` 换成同一个
   `inventoryItemTone(itemId, kind)` 即可（一行一处）。
2. 本批**不含公告**（属配色微调、非新系统）。要发的话我按 §7 出待审稿。
