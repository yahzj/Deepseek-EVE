# 燃料上限 · 实验室技能批（2026-09-30）

**状态：已实现（闸门全绿），待船长验收观感与手感**

## 船长原话（照抄）

- 「发现目前燃料生产并不受上限的影响，且估算约能跑多少趟没有实际意义，只需要显示上限多少
  （比如本地存档现在是5,200单位，那就显示5,200/6000单位），下方实验室按钮边上显示现在燃料大概的生产速度/h。
  打算添加2个增加燃料上限的技能，并添加1个燃料生产速度和1个燃料产量的技能。以及我忘记问了，
  新功能是否模块化？降低耦合」
- 「三、③，只算仓库。④乙。燃料合成节拍学叫燃料了，自然只对燃料生效。还有名字有些过于相似了。
  参考EVE让不同技能直接名称差异更大一些。速度和产量的技能放到RANK4。」
- 「只算仓库，就是只算仓库，不算任何舰船库存。还有，每单位燃料体积为1m³，但是普通舰船的货仓无法装入。
  ⑧，进工业的子标签：'实验室'。其他按你推荐来」

## 一、本批口径（全部已裁）

| 项 | 裁定 |
|---|---|
| 上限口径 | **只算物品仓库**；不算任何舰船库存（货仓）。基准 **6,000** |
| 上限达到 | **实验室自动停线**（与"料尽自停"同款，留日志）；起线时已满 ⇒ 直接拒绝并说明 |
| 已超上限的仓库存量 | **保留不动**，只禁止再增加 |
| 市场买入 | **不受上限管**（`market.ts` 不动） |
| 读数 | 主读数与罐子一律 `仓库量 / 上限`（单位），**删掉「≈N 趟」与"一趟长途"虚线** |
| 生产速度/h | 显示**当前在跑的实验线合计**（没跑＝0，另给"未开工 / 已满"状态）；位置 = 实验室按钮旁 |
| 燃料体积 | **1 m³ / 单位**；**普通舰船货仓无法装入**（老档货仓里的燃料读档时归仓，不销毁） |
| 产线节拍学说明 | 补上「实验室」（⟪文案调整⟫ 标记 + 本文件台账） |
| 技能书 | 新建一本 **b-lab「实验室」**（归工业大类） |
| 速度/产量技能作用域 | **只对燃料配方**（`recipes: ['jump-fuel']`） |
| 技能 rank | 上限① r2 · 上限② r4（←上限①）· 速度 r4 · 产量 r4（各自独立，无前置） |

## 二、四条技能（名称按 EVE 风格拉开差异 · 船长令）

| id | 名称 | group | rank | branch | prereq | 效果 | 数值 |
|---|---|---|---|---|---|---|---|
| `fuel-tank-structure` | 储罐结构学 | 工业 | 2 | b-lab | — | 燃料仓库上限每级 +10% | 满级 +50% |
| `orbital-fuel-depot` | 轨道储备库学 | 工业 | 4 | b-lab | `fuel-tank-structure` | 上限每级再 +10%（**与前者乘算**） | 双满 ×2.25 = **13,500** |
| `fuel-catalytic-cracking` | 催化裂解学 | 工业 | 4 | b-lab | — | 燃料配方周期每级 −4% | 满级 −20%（与产线节拍学乘算） |
| `fuel-yield-engineering` | 收率工艺学 | 工业 | 4 | b-lab | — | 每批燃料产出每级 +6%（向下取整） | 满级 600 → **780** |

读数（单线、全满级）：周期 5 分 → 3 分 ⇒ **15,600 单位/时**；上限 13,500 ⇒ 约 52 分钟跑满
（未点上限技能 6,000 ⇒ 约 23 分钟）。

## 三、模块化（船长问「新功能是否模块化？降低耦合」）

现场核对结论：**燃料侧干净、实验室侧三处硬编码、上限此前根本不存在**。

- 修法 ①：上限 / 余量 / 速率**各一个 core 单点函数**（`jumpFuelCapOf` / `jumpFuelHeadroomOf` /
  `jumpFuelSupplyOf`）⇒ 界面零算法、零自造常量（原先 `TRIP_UNITS × 5` 就是界面自造的 6,000）。
- 修法 ②：实验室技能改**声明式乘区表**（`LAB_CYCLE_SKILLS` / `LAB_YIELD_SKILLS`，
  每行 `{ 技能 id, 每级值, 作用域 recipes? }`）⇒ 以后加技能 = 表里加一行；"只对燃料 / 对全实验室"
  由 `recipes` 决定，**引擎不写死技能 id**。
- 修法 ③：「不可装货仓」= **物品数据的字段**（`ItemDef.holdForbidden`），装船入口统一判该字段
  ⇒ 判据单点在数据表，不在各处写 id 名单。

## 四、改动清单（逐条）

**新增**
- `packages/core/src/jumpFuel.ts`：`JUMP_FUEL_CAP_BASE` · `JUMP_FUEL_CAP_SKILLS` · `jumpFuelCapOf` ·
  `jumpFuelHeadroomOf` · `jumpFuelSupplyOf`（读数：仓库量 / 上限 / 速率 / 状态）。
- `packages/core/src/lab.ts`：`LAB_CYCLE_SKILLS` · `LAB_YIELD_SKILLS` · `labOutputPerHourOf`。
- `packages/data/src/skills.ts`：四条技能 ＋ `SKILL_BRANCHES` 增 `b-lab`「实验室」。
- `packages/data/src/l10n.ts`：`EN_SKILLS` 四条英文（⟦⟧ 与中文对齐）。
- `packages/data/src/l10n/table.ts`：读数与提示新 id（库存/上限 · 速度 · 未开工/已满 · 满仓自停日志 ·
  不可装船提示 · b-lab 技能书名）。
- `packages/core/tests/fuel-cap-lab-skills-20260930.test.ts`：上限夹紧 · 满仓自停 · 起线拒绝 ·
  速率读数 · 技能乘区 · 货仓禁装 · 老档归仓。
- 本文件（工作文档）。

**修改**
- `packages/data/src/items.ts`：`jump-fuel` 体积 0.01 → **1 m³**、加 `holdForbidden`、说明补规格。
- `packages/core/src/types.ts`：`ItemDef.holdForbidden` 字段。
- `packages/core/src/inventory.ts`：装船两个入口按 `holdForbidden` 拒绝。
- `packages/core/src/jumpFuel.ts`：库存与扣料**只走仓库**（船长令「不算任何舰船库存」）。
- `packages/core/src/lab.ts`：技能乘区表驱动（替换写死的 `industrial-automation`）+ 满仓停线。
- `packages/core/src/save.ts`：读档把货仓里的燃料归入仓库（幂等；不销毁）。
- `packages/core/src/index.ts`：导出新符号。
- `apps/desktop/src/renderer/src/game/engine.ts`：`jumpFuelSupply()` 包装。
- `apps/desktop/src/renderer/src/pages/ShipPage.tsx`：读数改「仓库 / 上限 单位」、删趟数与虚线说明、
  实验室按钮旁加速率读数。
- `tools/content-check.ts`：四条技能的每级值登记（INLINE）。

**删除**
- `ShipPage.tsx` 的 `TRIP_UNITS` 界面常量（界面不再自造"一趟"）。
- `ui.hud.210` / `ui.hud.211`（「≈N 趟」与刻度说明）——表里不留废弃 id。

## 五、⟪文案调整台账⟫

| 日期 | id | 改动 | 依据 |
|---|---|---|---|
| 2026-09-30 | `core.lab.*`（产线节拍学说明所在的技能说明） | 产线节拍学说明「精炼炉与组装机」→「精炼炉、组装机与实验室」 | 引擎里实验室已在吃它（`lab.ts`），说明漏写 |
| 2026-09-30 | `ui.hud.210` / `ui.hud.211` | 删除（"≈N 趟"与"一趟长途"刻度说明） | 船长令「估算约能跑多少趟没有实际意义」 |
| 2026-09-30 | 物品 `jump-fuel` 说明（中文表 + EN 覆盖） | 补「单件 1 m³，仅存于物品仓库」 | 船长令「每单位燃料体积为1m³，但是普通舰船的货仓无法装入」 |

## 六、待办 / 未做

- 工业页原「实验室」卡片（`IndustryPage`）本次**不动**，只做船长点名的跃迁燃料页读数与实验室按钮旁读数。
- 装配/物品页「装船」按钮的**禁用视觉**（现在只做拒绝 + 提示，不做置灰）——若船长要置灰另开一条。
- 调试页「工业 HUD」的实验室卡片未接满仓状态（同上，等船长点名）。
- 站点通讯里那段燃料介绍（`dlg-redring-done` / `dlg-cinder-done`）**未改**：现有文案没有说错的地方
  （只说"一秒一单位、十倍、在哪勾选/投料"），未提"只存仓库 + 有上限"——要不要补一段请船长定。
- 市场稀有池的 `poolTarget 28,800 / absorbQtyPerWindow 14,400`（单位）在"玩家最多只能存 6,000~13,500"之后
  显得有些大；市场侧本次按船长令（④乙：买入不受上限管）**未动**，是否重定池子参数另议。

## 七、实施结果与读数（2026-09-30）

**闸门**：`typecheck` 四工作区 ✅ · 核心用例 **273 文件 / 2,879 用例全绿**（新增本批 14 条）✅ ·
`content:check` ✅ · `l10n:check` ✅（重键体检 0）· `l10n:params` ✅（明确漏喂 0）· `ui:rot-check` ✅ ·
`arch:guard` F1–F7 全 0 ✅ · `skill:audit` ✅（112 条技能）· `skilltree:layout-check` ✅（24 本书 / 112 格）·
`econ:audit` / `price:audit` / `save:roundtrip-audit` ✅ · `electron-vite build` ✅。

**实测读数（新用例钉住）**：

| 读数 | 值 | 出处 |
|---|---|---|
| 上限基准 | 6,000 | `JUMP_FUEL_CAP_BASE` |
| 储罐结构学满级 | 9,000（+50%） | `jump-fuel…test` 用例 |
| 两条上限技能双满 | 13,500（乘算 ×2.25） | 同上 |
| 单线基准速率 | 7,200 单位/时（600 单位 / 5 分） | `labOutputPerHourOf` |
| 节拍+收率双满 | 周期 3 分 · 每批 780 · **15,600 单位/时** | 同上 |
| 上限约束 | 5,400 + 600 = 6,000 跑满即停（日志 `core.lab.017`），**绝不越过上限** | `advanceLab` |
| 起线拒绝 | 5,700 + 600 > 6,000 ⇒ `core.lab.018` | `startLabRun` |
| 老档迁移 | 货仓里的燃料读档归仓（幂等、不销毁） | `repairHoldForbiddenCargo` |

**技能表条目**（`packages/data/src/skills.ts`）：`fuel-tank-structure`（储罐结构学 · 工业 · r2 · b-lab）·
`orbital-fuel-depot`（轨道储备库学 · 工业 · r4 · ←储罐结构学）· `fuel-catalytic-cracking`（催化裂解学 · 工业 · r4）·
`fuel-yield-engineering`（收率工艺学 · 工业 · r4）；`SKILL_BRANCHES` 增 `b-lab`（「实验室」·工业）；
英文覆盖在 `packages/data/src/l10n.ts` 的 `EN_SKILLS`（⟦⟧ 与中文一一对齐，`l10n-overlay` 用例把关）。
