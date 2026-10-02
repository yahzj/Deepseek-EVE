# 信号发射器：召唤的势力改为**随机**（2026-10-02 · 二号 · **待船长验收**）

> **本文件是本次工作的临时文档**（§八）：工作期间只改它 ＋ 代码/数据/测试；船长验收并合入后按归档三步办。
> **状态**：**船长 2026-10-02 令** ⇒ 已落码、闸门全绿，待验收。

## 一、船长原话（照抄）

> 「**信号发射器召唤的敌人是随机的（目前只有R和H）**」

## 二、改前 / 改后

| | 改前 | 改后 |
|---|---|---|
| 召唤出的势力 | **恒定 = 清单第一支**（`INVASION_BEACON_FAMILIES[0]`，当时表里只有 H ⇒ 永远是**墨潮帮**；R 族做完了却不在表里） | **随机**从「**做完了的族**」里抽一支：现 = **R 光环 / H 墨潮帮**（`WEEKEND_FINISHED_FAMILIES`） |
| 玩家指定势力 | `familyId` 参数（**界面没有选择器**，无任何调用点传它） | **保留**为显式覆盖（传了才用，且必须在清单内；界面仍不提供选择器） |
| 落点 | 不传星系 = 随机星系；传星系 = 玩家所选（**不动**，2026-09-30 船长裁定） | **不动** —— **星系**照旧（随机 / 指定），**族随机** |

⚠ **占位族不进随机池**：A/C/G 三族仍是"派生卡只换名字/威胁、敌人编成还是原来那批"的占位口径
（`WEEKEND_FAMILIES` 里保留它们只是为了**允许进池**），抽到它们玩家打不到真正的入侵舰队 ⇒
随机池单点收在**做完了的族**（与族循环队列同一份清单，**不新造第二张表**）。

## 三、逐条改动（✅ 已落码）

**消耗品域（信号发射器）**
1. `packages/core/src/consumables.ts` —— `useInvasionBeacon`：势力改为
   `显式 familyId ?? weekendRandomFamilyOf(state, seq)`；两条落点路（随机星系 / 指定星系）**都**用同一个势力；
   `INVASION_BEACON_FAMILIES` 改为**由做完了的族派生**（唯一出处 = `WEEKEND_FINISHED_FAMILIES`
   ＋ 既有族名 id 表 `weekendFamilyNameId`）⇒ 加族时不会再漏登记（H 那次漏 R 就是这类漏）。
2. `packages/core/src/weekendEvent.ts` —— 新增 **`WEEKEND_FINISHED_FAMILIES`**（`['R','H']`，"做完了的族"唯一登记处）；
   `WEEKEND_FAMILY_ROTATION` 改为**引用它**（不再各自写一份）；`weekendRollOccupation` 的**随机兜底池**
   由 `WEEKEND_FAMILIES`（含占位族）改为 `WEEKEND_FINISHED_FAMILIES`；新增导出 `weekendRandomFamilyOf(state, seq)`。
3. `packages/core/src/index.ts` —— 导出上述两个新符号。
4. `packages/core/tests/invasion-beacon-20260930.test.ts` —— 原「势力 = 列表第一支」改为"∈ 做完了的族、
   且**永不出占位族**"；新增：跨场次能同时抽到 R 与 H · 同 (种子, 场次) 可复现 · 显式 `familyId: 'R'` 仍生效 ·
   清单与"做完了的族"**逐字一致**（防两张表漂移）。

## 四、不做 / 边界

- **不动**落点的两条路（随机星系 / 玩家指定星系）、不动高安扣声望、不动"已有一场在进行 ⇒ 拒绝"；
- **不动**每周那场的族选择（仍走 `weekendFamilyForWindow`：特意设置 → 循环）；
- **不加**界面选择器（原本就没有；`familyId` 仍是引擎侧的可选覆盖）。

## 五、验证与读数

- 闸门：`typecheck` ✅ · core 全量 ✅ · `content:check` ✅ · `l10n:check` ✅ · `ui:rot-check` ✅ ·
  `arch:guard` ✅ · 构建 ✅
