# 代码审查报告：多余代码 · 重复效果代码 · 重构与模块化 · 风险（工作文档 · 2026-10-02）

**状态：已交付报告（待船长验收与排期）**

## 船长原话（照抄）

「对大鲸鱼的代码进行一次审查，允许使用skill，重点检查多余代码，重复效果代码，以及是否需要重构，
能否降低代码耦合改为使用模块化，有什么风险」

## 0. 结论先行（一句话）

全仓最值得动手的是**三件事**：① 渲染层把「AI 核心顺序/可用核心/选核下拉」各抄了 3~8 份（core 早有单点，
顺手可消，零行为变化）；② 实验室两张卡的循环目标输入**缺了组装机卡 2026-09-17 那套防丢草稿**（程序化跳页
会把刚打的目标批数丢成"无限循环"，属行为缺口）；③ `packages/core` 有 **36 处运行期模块环**（最大一条 13 个
模块，已炸过一次 `54cfc050`）＋约 **420 处未用局部/参数/导入**——都要船长排期分批清，不宜一次性大搬迁。

## 1. 审查方法与范围（含如实声明）

- **基线**：main HEAD `e9fe0eec`（2026-10-02 08:03），审查期间只读（工作区除既有未跟踪文件外零改动）。
- **两部分**：
  - **甲 · 全库结构扫描（我直接做）**：行数统计 · `tsc --noUnusedLocals --noUnusedParameters` 探针 ·
    重复定义 grep 普查 · 自写**相对导入环探针**（tools/_probe-cycles.mts，226 节点，只算运行期边、
    排除 `import type`，**用完即删**）· 跨包方向核查。
  - **乙 · 最近这批 diff 的两轴审查（code-review 技能流程）**：范围 = 基点 `41f98c4c` 起的「工业/实验室对齐」
    10 个文件（约 +684/−200）。按技能要求起了 Standards/Spec 两个并行子代理；**两代理连跑 4 轮无交付，
    已中断，两轴由我按同一简报直接完成**（如实登记，不冒认子代理产出）。
- 规格来源 = 工作文档 `docs/design/industry-line-parity-20261001.md`；标准来源 = `AGENTS.md` +
  `docs/development-conventions.md`（权威）＋ `docs/single-source.md` ＋ 技能自带的坏味道基线（12 条）。

## 2. Standards 轴（最近这批 diff 对约定与坏味道基线）

- **硬违规：0**（本批全部通过 typecheck / content:check / l10n:check / ui:rot-check / ui:tip-check / arch:guard）。
- 判断性意见：
  1. **Duplicated Code（已收敛，正评）**：本批把"去弄料四支判定"收成 `ui/matSourceLink.tsx`、折叠开关收成
     `ui/matList.tsx`、卡面读数收成 core 单点 `labBatchUnitsOf`/`labCycleMsOf` —— 方向正确。
  2. **语义微混（轻）**：折叠开关复用了链接样式 `.app-bp-mat-act`（`role="button"` 无边框文字）——
     观感上是"链接"语义，实际是"开关"。零 CSS 是有意取舍；若船长看不顺眼，另立一条 `.app-bp-mats-toggle`。
  3. **无障碍（正评）**：开关带 `aria-expanded`/`aria-controls`＋Enter/Space，符合技能「ARIA Labels（High）：
     Interactive elements need accessible names」。
  4. §11 l10n：新文案 160~164 全部 id 映射、中英齐 ✓；§15之二 单一来源：本批**没有**新增旁路取数 ✓。

## 3. Spec 轴（最近这批 diff 对工作文档裁定）

- **(a) 规格要求了、diff 里缺失的：本批范围内 0**（五批裁定逐条落码：删去弄料按钮 · 删行情价 · 删假读数 ·
  ×N 读实际批产 · 工期读主控耗时 · 味数 >2 折叠成原材料列表）。
- **(b) 越权/范围蔓延**：折叠态红字「缺 N 味」与 5 条新文案是规格之外我自作的主张——已写进工作文档 §13.5
  的"形态判定"清单供船长否决，属**已声明的增项**，不构成隐性越权。
- **(c) 对不上：0**（门槛 `> 2`、两支工期文案、去声望商店支路等与裁定原文逐字一致）。
- **⚠ 范围外但同口径的缺口（我单独查到的，建议补）**：实验室两张卡（经典 `IndustryPage.tsx` 与
  HUD `IndustryHudPage.tsx`）的**循环目标输入没有**组装机卡 2026-09-17 那套「卸载补提交」
  （`goalDraftRef`/`goalTouchedRef`，panels/Industry.tsx:785~810）——程序化跳页（通讯「前往」/教程/任务卡）
  会把玩家刚打的目标批数丢掉 ⇒ 循环开关开着、目标为 null ⇒ **变成无限循环**（组装机当年的同款 BUG）。
  实验室卡注释写着"照组装机那套"，但只照了控件、漏了这层保护。

## 4. 全库 A：多余 / 死代码

- **探针读数**：`tsc --noUnusedLocals --noUnusedParameters`：core 报 **207** 处、desktop 报 **213** 处
  （TS6133/TS6192/TS6196，含未用导入），合计约 **420 处**。高发文件：game/engine.ts 20 · wormholeSalvage.ts 18 ·
  wormholeBattle.ts 15 · wormholeAutoSim.ts 14 · panels/Industry.tsx 12 · Expedition.tsx 12 · MapPage.tsx 10 ·
  App.tsx 8（例：未用导入 AnnouncementHub / DebugButton / ActivityBar / ShipStatusWin / MoneyFit…）。
- **根因**：`tsconfig.base.json` 开了 `strict` 但**没有** `noUnusedLocals/noUnusedParameters` ⇒ 死导入越积越多没人管。
- **建议**：分 core/renderer 两批清理，清完把两个开关写进 tsconfig.base 当长期闸门。**风险**：改动面大、
  且落在二号/三号正在写的 combat/wormhole 区，要船长排期、小步合入；纯删不改行为。
- 干净项：全仓 TODO/FIXME 残留 **0**；tools/ 下无 `_probe` 残留（本次审查用探针已删）。

## 5. 全库 B：重复效果代码

| # | 重复内容 | 份数 | 位置 | 建议 |
|---|---|---|---|---|
| 1 | **AI 核心顺序字面量** `['basic','gamma','beta','alpha']`（core 早有 `AI_CORE_ORDER` 单点且已导出） | 3 | IndustryPage.tsx:85 · panels/Industry.tsx:89 · IndustryHudPage.tsx:382（内联） | 全改 import `AI_CORE_ORDER`；风险=某天有人改本地顺序 ⇒ 下拉默认值与 `bestAiCoreOf` 漂移 |
| 2 | `usableCores = X.filter(countAiCore>0)` | 8 | 6 个文件（上表+MapPage×2、ShipPage、Expedition） | core 加单点 `usableAiCoresOf(state)` |
| 3 | **选核下拉**（`aiCoreText(t)}（{效率%}` 整块） | 6+ | IndustryPage×2 · MapPage×2（采矿/残骸两块几乎逐字）· ShipPage · panels/Industry 等 | 抽 `ui/AiCoreSelect.tsx`，省 150+ 行 |
| 4 | **运转名册** `.app-belt-workers` 结构 | 5 | IndustryPage（炉/实验室）· MapPage（采矿/残骸）· panels/Industry | 抽公共件（与 #3 同批） |
| 5 | **循环行** `.app-belt-loop` 整块 | 3 | 组装机卡 · 实验室卡（经典）· 实验室（HUD）——本批还新加了第三份 | 抽 `LoopRow` 组件（含 09-17 防丢草稿，见 §3） |
| 6 | **经典/HUD 两套工业页整份双写**（同一套炉子/组装机/实验室语义各写一遍） | 2 | IndustryPage.tsx（1476 行）· IndustryHudPage.tsx（≈2300 行） | 最大的一块重复；HUD 实验室对齐已挂账；合流建议单独立项（风险最高） |
| 7 | **手动位忙态**：HUD 直接用 core 单点 `manualSlotOf`（activityGate.ts:211），经典页另写 `manualBusyNote`（IndustryPage.tsx:119）再叠判定 | 2 口径 | 同上 | 经典页改走 core 单点 |
| 8 | `kindLabelText`/`ownedWhereText` 住在 panels/Industry.tsx，Shipyard.tsx 反向 import（panels 互借） | 1 | panels/Industry.tsx:533~548 | 挪进 ui/labelsText.ts（aiCoreText 已在那） |

已收敛样本（本批）：去弄料四支 → `MatSourceLink` · 材料行折叠 → `MatListToggle` · ×N/工期 → core 单点。
⇒ 说明"重复效果代码"的收敛手法全仓已有现成套路，可以按 #1~#5 铺开。

## 6. 全库 C：耦合与模块环（能否降低耦合改为模块化）

- **探针读数**（226 节点、只算运行期边）：**运行期模块环 36 处，全部在 packages/core/src；renderer 0 处**。
- 最大一条 **13 个模块**：`ai → location → station → comms → onboarding → firstRewards → wormholeScan →
  expedition → weekendBattle → weekendEvent → sideTasks → market → ai`（另有一条同长经 shipyard）。
- 典型小环：`state↔wormhole` · `inventory↔equipment` · `market↔ai` · `station↔comms` · `mining↔shipyard` ·
  `salvaging↔shipyard` · `expedition↔weekendBattle`。
- 已确认无运行期影响的：lab/manufacturing/industry ← engine 只借 `type { CommandResult }`（type-only 不算环）。
- **风险实证**：`54cfc050` 刚修过一次「模块环启动崩溃」（切活动返航两段式架构）——环是真的会炸。
- **建议**：不追求一次清零（游戏核心互借是常态），分步：① 倒转"类型中枢借内容"的方向
  （types.ts 反向借 wreckGroups.ts 这类），或一律降为 `import type`；② 每个小环找最小切入边，把被借函数
  挪到依赖更低的模块；③ **至少立规：新增模块不得再入环**——可在 `tools/arch-guard.ts` 加 **F8 相对导入环自检**。

## 7. 全库 D：重构机会清单（按性价比排）

1. **AiCoreSelect/usableAiCoresOf 抽取**（#B1~B3）：删 3 份顺序字面量＋8 处 filter＋6 份下拉，零行为变化。风险：低。
2. **实验室卡补 09-17 防丢草稿**（§3 缺口）：行为修复，小。风险：低。
3. **noUnused 清理分批 ＋ tsconfig 加闸门**（§4）。风险：中（合入冲突），行为零变化。
4. **arch:guard 加 F8 环自检**（防新增环）。风险：低。
5. **combat.ts（10193 行/252 个顶层函数/24 个分区注释）按域拆**（敌群/伤害/特效/统计…分区注释就是现成边界）。
   风险：高（二号正在写闪现演出）——建议"顺带拆、不专项拆"。
6. **工业页两外壳合流**（#B6）：最大头，单独立项。风险：高（观感船长审、一级页不滚、双主题壳）。
7. panels 互借收敛（#B8）＋ 经典页手动位改走 core 单点（#B7）。风险：低。
8. 已知非死代码（勿动）：`_baseline-main.css` 是冻结基准、styles-*.css 是 `ui:layout-css` 生成件。

## 8. 风险清单（逐项）

1. **并发写冲突**：二号（d2）与三号（verify）都在动 core/wormhole/combat——任何重构批次先追平 main、
   按文件分批小步合入，别做一次性大搬迁。
2. **模块环重构可能引入启动顺序回归**（前科 `54cfc050`）：每步全量测试＋真档只读加载。
3. **存档兼容**：本报告建议全部**不动 save.ts 结构**、不删任何被白名单引用的键；只删未用代码不改行为。
4. **UI 抽取后观感归船长**（§6/§9）：AI 下拉、名册、循环行抽取必须保持像素级一致，改完船长目视。
5. **一级页不滚红线**：抽取不得改变任何卡片的占用高度。
6. **大文件拆分收益 vs 合入冲突成本**：推荐"改到哪个文件就顺手把该部分拆出"，避免专项大搬迁。

## 9. 建议的落地顺序（请船长排期）

1. 实验室卡补防丢草稿（行为修复，小，可立即做）
2. AiCoreSelect / usableAiCoresOf 抽取（零行为变化，中）
3. noUnused 清理两批 ＋ tsconfig 加闸门
4. arch:guard F8 环自检（防新增环）
5. 工业页两外壳合流（大，单独立项，先补 HUD 实验室对齐）

## 10. 闸门与读数

审查全程只读：工作区零改动（探针用后即删）。arch:guard F1~F7 复跑全绿（现有护栏不含"环自检"与
"未用符号自检"，正是本报告 §4/§6 两条建议的由来）。
