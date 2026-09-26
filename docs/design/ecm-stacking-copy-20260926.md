# 报障修正：墨潮电子舱卡面「全额叠加」＋ 缺最短射程 3,000 m（2026-09-26 · 二号 · d2）

状态：**已实现 · 待船长验收**（本地产物已重建，需重启游戏）。归档按 AGENTS.md §8。

## 船长原话（照抄）

> 「发现BUG，墨潮电子舱怎么写着全额叠加，并且没有写上最短射程3000m」

## 一、报障两条各自的真因（数据）

| 报障 | 真因 | 改法 |
| --- | --- | --- |
| 卡面写「**全额叠加**」 | `equipment.stackingOf` 把 `mod-lair-ecm-h`（`foeRangeDebuffPct`）**显式登记成 `flat`** ⇒ 卡面「叠加方式」行落进 `ui.shipInfo.077`「全额叠加」。那三个字只讲"同舰加算不打折"，读起来像"可以无限叠"，而真实机制是三层：**同舰多件加和（上限 90%）→ 跨舰乘法合成 → 整条效果还压着敌舰最短射程 3,000 m 的地板** | 该键**从 `flat` 兜底里单列一档 `sum`**；卡面改读新词条 `ui.shipInfo.201`「同舰多件加和（上限 90%）· 多舰乘法叠加」 |
| 没写「最短射程 3000m」 | 件说明只写了「压制敌方武器射程 15%，与电子舰的削弱乘法叠加」；装配页短行也只有「敌方武器射程 −15%」——引擎那两条地板口径（`FOE_RANGE_DEBUFF_FLOOR_M = 3000`：基础 < 3000 完全不削、削后下限 3000）**在界面上一字未提** | 件说明（中英）补上两条地板口径；装配页短行改「敌方武器射程 −{p1}，**最短 {p2} m**」，数字取 core 单点 `FOE_RANGE_DEBUFF_FLOOR_M`（界面不硬写 3000） |

**机制一字未动**：`meFoeRangeDebuffOf` 的同舰加和 ＋ `min(0.9, gear)` ＋ 跨舰 `1 − Π(1 − vᵢ)` ＋ 地板
全部照旧；本批只改"怎么写"。

## 二、涉及文件

- `packages/core/src/equipment.ts`：`StackGroup` 增 `'sum'`（释义见类型注释）；`foeRangeDebuffPct` 的登记
  由 `flat` 改 `sum`，并把三层真实机制写进注释。
- `apps/desktop/src/renderer/src/ui/shipInfo.tsx`：
  - 卡面「叠加方式」行增 `sum` 分支（读 `ui.shipInfo.201`）；
  - 短行 `ui.shipInfo.185` 补第二参（最短射程，取 `FOE_RANGE_DEBUFF_FLOOR_M`）；
  - 短行的「多装递减」尾注判定把 `sum` 一并排除（加和不衰减，不该挂"递减"）。
- `apps/desktop/src/renderer/src/pages/FitPage.tsx`：空位候选下拉的「第 N 件衰减」尾注同样排除 `sum`。
- `packages/data/src/modules.ts`（zh 说明）＋ `packages/data/src/l10n.ts`（en 说明）：补最短射程两条口径。
- `packages/data/src/l10n/table.ts`：`ui.shipInfo.185` 补 `{p2}`；新增 `ui.shipInfo.201`（中英）。
- `packages/core/src/index.ts`：导出 `FOE_RANGE_DEBUFF_FLOOR_M`（界面取数，不硬写数字）。
- `packages/core/tests/ink-gear-20260926.test.ts`：新增报障回归两例。

## 三、验证

- 新增两例：① `stackingOf(电子舱)` 必须是 `{ group: 'sum', kind: 'ecm' }`（并拿稳定器做对照，确认
  `flat` 兜底没被改坏）；件说明与英文说明都必须含 `3,000 m`；② 地板常量 = 3000。
- **反向验证**：把该键改回 `flat` ⇒ 新例**当场转红**，改回即绿。
- `npm run typecheck` 四包 0 错 · `npm run test -w @whale/core` **237 文件 / 2612 用例全绿** ·
  `content:check` ✅ · `l10n:check` ✅ · `ui:rot-check` ✅ · `build` ✅。

## 四、待船长裁决

1. **机制要不要一起改**：本次只改文案/标签。若船长要的是"**多装递减**"（即第二件起打折，而不是同舰加和
   到 90% 封顶），那是**数值改动**（引擎 `meFoeRangeDebuffOf` ＋ 用例），说一声即可改。
   参考读数：现制 4 件同舰 = 60%（+ 一艘电子舰 ⇒ 66%）；若改折权加算（第 2/3/4 件按 87%/57%/28%），
   4 件 ≈ 40.8%。
2. **英文两条**（`mod-lair-ecm-h` 的 description 与 `ui.shipInfo.185/201`）由二号先出，按惯例交三号复核。
