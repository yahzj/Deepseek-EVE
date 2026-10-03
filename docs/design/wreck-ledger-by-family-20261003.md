# 入侵残骸账改「按族分账」＋ 打捞界面每族一张独立卡（船长令）

- **状态**：**设计已确认 · 待落码**（分期做；树保持绿）
- **船长原话（照抄 · 按序）**：

  > 「**所以，现在不同入侵的残骸是会记忆并且分开算的吗**」
  >
  > 「**确认，并且我希望所有入侵的残骸，在残骸打捞界面都使用独立的卡片，现有的常驻卡片回滚成之前的样式（不会显示入侵残骸条）**」

- **前置读数（改前的现状）**：账本粒度 = **每星系一条 ＋ 一个族标签** ⇒ ① 换族注入会**覆盖**老族的
  型号归属（读数：H 600 ＋ R 200 ⇒ 族 = R、800 m³ 全出 `wreck-r-inv`，H 那 600 m³ 一件 H 型号都没有）；
  ② 没记族的老场在换族后回落"当前事件族"⇒ 同样出新族型号（玩家报障的两种形态）。
  箱子那部分（`rareBy[cardId]`）**本来就分得开**（读数：两件箱子分别出 `wreck-rare-h-hi` 与 `wreck-rare-r-inv`）。
- **船长两处追加裁定**：**甲**（每族卡只放"读数 ＋ 开工"，不做"只捞这一族"的手选）· **甲**（卡片顺序 =
  舰船残骸卡 → **各入侵族卡（存量降序）** → 常驻卡）。

## 一、数据结构

```ts
// 改前：每星系一条 + 一个族标签
state.weekendWrecks[星系] = { density, decayAccMs, family?, rare?, rareBy? }
// 改后：每星系按来源族分桶（`'?'` = 老档"没记过族"的桶）
state.weekendWrecks[星系] = { byFamily: Record<族码 | '?', { density, decayAccMs, rare?, rareBy? }> }
```

## 二、口径（逐条）

1. **注入**：按来源族进各自桶 —— 同族叠加、**跨族互不覆盖**；
2. **衰减**：**每桶各自** 48h 线性衰减、各自到点删桶（与现口径同尺）；
3. **出量**：本轮从哪一桶出 ⇒ 用**该桶**密度算 `mul`；**总获取量 = 该桶标称量**（2026-10-02「甲」不变）；
4. **多族并存**：按**各族存量的数量比**分摊（与 2026-09-26「按两种残骸的数量比同步打捞」同一把尺）；
5. **界面读数**：**每族一张独立卡**（卡名 = 残骸组名，如「墨潮帮残骸（入侵）」）＋ 该族存量 ＋（有箱子时
   「稀有 ×N」）＋ 「开始打捞」；**常驻卡回到旧样式 —— 不再有入侵残骸条**；
6. **老档迁移**（读档一次性）：旧记录折进 `byFamily[family ?? '?']`；`'?'` 桶打捞时**并入全部隐藏入侵卡**
   （真实族无从得知 ⇒ 宁可给"某一族的入侵残骸"，也不按新一场的族张冠李戴）；**一件不丢**（密度与箱子
   都折算到对应桶，迁移前后逐项对账）。

## 三、落点（逐条 · 实际改动时按此核对）

1. `packages/core/src/state.ts`：`WeekendWreckRecord` → 分桶结构（＋ `'?'` 桶说明）
2. `packages/core/src/salvage.ts`：`weekendWreckValueOf` · `weekendWreckDensityOf`（= Σ 各族）·
   **新增 `weekendWreckPoolsOf`（每族一条读数，界面与自动判定共用）** · `injectWeekendWreck` ·
   `injectWeekendRareWreck`（＋族参数）· `weekendRareWreckCountOf` · `weekendWreckFamilyOf`（兼容保留）·
   `writeWeekendWreck` · `advanceWeekendWreckDecay` · `chargeWeekendWreckByVolume`（＋族参数）·
   `pullRareWreck` · `rareStockForTargetOf` · `wreckPoolOf`（按桶并卡）· `roundMulFor`/`salvageRoundMulOf`
   （＋族参数：入侵轮按**该桶**算系数）· `autoTargetPickOf`（按族存量的数量比先抽族）
3. `packages/core/src/salvaging.ts`：`pullOneWreck` 把"抽到那张卡的族"传进池子结算
4. **`packages/core/src/save.ts`**：读写 ＋ **老档迁移**（⚠ **需裁决文件** ⇒ 已报备 → 船长已确认；
   提交用 `--no-verify` 并披露）
5. `apps/desktop/.../pages/MapPage.tsx`：常驻卡**去掉入侵条**；**每族一张独立卡**（顺序见上；AI 指派/名册
   沿用 `wreckAiHostOf`：挂"序列第一张"）
6. **用例**：涉及 `weekendWrecks` 的全部用例按新结构改写（实际清单在落码时逐条列出）＋ **新增回归**：
   「同星系跨族 ⇒ 两族各自分开算、各出自己型号」/「`'?'` 桶 ⇒ 并入全部隐藏卡」
7. 本工作文档 ＋ `docs/INDEX.md`（重跑）

## 四、分期与验收

- **一期（core ＋ save ＋ 用例）**：改完跑闸门；**出"迁移对账读数"**（迁移前后：各星系各族密度、箱子数、
  总数逐项对账，含真档只读试跑）。
- **二期（界面）**：常驻卡回滚 ＋ 每族独立卡；跑 `ui:rot-check` ＋ 构建，**交船长观感审查**（观感只有他能判）。
- 期间**不碰**已完成的口径（2026-10-02「甲」：出量按余额封顶、池子按实际出量扣、基础值 10）。
