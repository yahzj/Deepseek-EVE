# 按功能模块拆分（重构蓝图与批次台账 · 工作文档 · 2026-10-02）

**状态：进行中（船长授权连续推进：「可以，你挨个做，除非遇到问题，否则不用等待我的继续指令」）**

## 船长原话（照抄）

- 「我打算重构代码，对代码按功能模块拆分，是否先做重构比较好？」
- 我答：小模块化（抽公共件）先做；大拆分后做（理由：与在途工作冲突、无玩家可见收益、回归风险集中、
  破环与护栏两个前置）。船长：「**可以，你挨个做，除非遇到问题，否则不用等待我的继续指令**」。

## 已批准的排序（按序推进，遇问题停下报告）

0. 补实验室卡循环目标**防丢草稿**（对齐组装机 09-17 那套；行为修复，与重构无关的小缺口）
1. **小模块化抽取**：`AiCoreSelect` ＋ core 单点 `usableAiCoresOf`（消 3 份顺序字面量/8 处 filter/6 份下拉）·
   `LoopRow`（循环行，含防丢草稿）· 运转名册行 · `kindLabelText`/`ownedWhereText` 搬 `ui/labelsText.ts` ·
   经典页手动位忙态改走 core 单点 `manualSlotOf`
2. **立护栏**：`noUnusedLocals`/`noUnusedParameters` 清理两批（core、renderer）＋ 写进 `tsconfig.base.json` ·
   arch:guard 加**相对导入环自检**（F8 已被并发协作者占用 ⇒ 本项 = F9）
3. **逐环破环**：core 的 36 处运行期模块环，先小环（market↔ai、station↔comms、state↔wormhole、
   inventory↔equipment、mining↔shipyard…），先倒转"类型中枢借内容"（types.ts↔wreckGroups 这类），
   每环一批：全量测试＋真档只读加载
4. **大文件按功能拆分**：与二号（d2）/三号（verify）**错峰**，一次一个文件；候选：combat.ts（10193 行，
   24 个分区注释即边界）· 两套工业页合流 · Expedition.tsx（4201 行/36 组件）· BattleScreen · Handbook。
   等二号/三号当前批交完再动重叠区。

## 红线（全部批次通用）

- **只搬家不改行为**：改动前后游戏行为逐字一致；行为修复（如批次 0）单独提交、单独说明。
- 不碰 `save.ts` 结构与白名单；不动 `balance.ts` 数值；不动 `docs/test-saves/`。
- 每批跑：typecheck 全仓 · core 全量测试 · content:check · l10n:check · ui:rot-check ·（涉悬停加 ui:tip-check）·
  桌面构建；涉 CSS 才跑 ui:layout-css:check。
- 全部**本地提交不推送**（推送闸门）；中文源码只走编辑器工具（§三）；临时探针 `_` 前缀、用完即删。
- 动工前核对 `git log --oneline -3` 与工作区，防与并发写者（二号/三号）撞车；撞车 ⇒ 停手报告。

## 大文件拆分预案（蓝图，动到哪批再细化哪批）

| 文件 | 现状 | 目标切法 | 错峰对象 |
|---|---|---|---|
| `core/combat.ts`（10193 行） | 敌群生成/伤害结算/特效/统计混居 | 按现有 24 个分区注释切：敌群与生成 → 特效演出 → 伤害与命中 → 统计与图鉴 | 二号（闪现演出批） |
| `core/engine.ts`（3828 行） | 大跨步主循环＋命令分发 | 命令分发按域拆（industry/manufacturing/lab…各自注册） | 三号（activity 护栏） |
| `core/save.ts`（4338 行） | 序列化/归一/迁移一家 | **只允许**把纯函数（归一器）拆出，序列化主体暂不动（存档兼容） | — |
| `renderer` 两套工业页（1476＋≈2300 行） | 同一域双写 | 先补 HUD 实验室对齐，再抽公共件合流 | 船长目视验收 |

## 批次台账

### 批次 0：实验室卡循环目标补防丢草稿（2026-10-02 · 行为修复）

- 现象：实验室两张卡（经典 `IndustryPage.tsx` LabCard · HUD `IndustryHudPage.tsx`）的循环目标输入只有
  `useState` 草稿，没有组装机卡 2026-09-17 那套「卸载补提交」（`goalDraftRef`/`goalTouchedRef`）⇒
  程序化跳页（通讯「前往」/教程/任务卡）不产生失焦，刚打的目标批数丢失、循环开关还开着 ⇒ 变"无限生产"。
- 改法（逐字照组装机卡 panels/Industry.tsx:785~810 的口径）：加 ref 对＋卸载 effect 补一次提交；
  `onChange` 置 touched 标记；`commitLoop`/`commitLabLoop` 提交即清标记；没打字不做任何动作。
- 文件：`apps/desktop/src/renderer/src/pages/IndustryPage.tsx` · `IndustryHudPage.tsx`（+`useRef` import）。
- 验证：typecheck 全仓 ✅ · core 全量 ✅ · content/l10n/ui:rot/ui:tip ✅ · 构建 ✅（批次落账时补齐读数）。
- 提交：`9a737602`。

### 批次 1a：AI 核心顺序/可用列表/下拉收敛（2026-10-02 · 模块化 · 零行为变化）

- 背景（审查报告 §5 表 #1~#3）：渲染层把核心顺序字面量抄了 3 份（＋HUD 内联 2 处）、
  `usableCores` 判据抄了 8 处、下拉 markup 抄了 4+ 份。
- 落地：
  - `core/ai.ts`：新增单点 `usableAiCoresOf(state)`；`index.ts` 导出。
  - 新增 `ui/aiCoreSelect.tsx`：精炼炉卡/实验室卡/组装机卡/舰船指派四处的核心下拉公共件
    （无核心置灰＋空档写明原因，口径与旧实现逐字一致；选项渲染 `aiCoreText＋效率%` 也只此一份）。
  - 替换调用点：panels/Industry.tsx · IndustryPage.tsx（炉/实验室）· ShipPage.tsx 四处走公共件；
    MapPage×2 · Expedition · IndustryHudPage 的 `usableCores` 改走单点。
  - 消掉的重复：`CORE_ORDER` 字面量 ×2（IndustryPage/panels/Industry）· HUD 内联顺序 ×2
    （含一处 `['alpha','beta','gamma','basic'].find` ⇒ 改走 core `bestAiCoreOf`，等价）· filter ×8。
- 行为核对：`bestAiCoreOf`（core 序、取最高持有）≡ 原 HUD 倒序 find；其余逐字等价。
- 文件：core/ai.ts · core/index.ts · ui/aiCoreSelect.tsx（新）· panels/Industry.tsx · pages/IndustryPage.tsx ·
  pages/IndustryHudPage.tsx · pages/MapPage.tsx · pages/ShipPage.tsx · panels/Expedition.tsx。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · ui:rot-check ✅ · 构建 ✅。

### 批次 1b：循环目标「防丢草稿」收成公共 hook（2026-10-02 · 模块化 · 零行为变化）

- 背景（审查报告 §5 #5 ＋ §3 缺口）：三处循环目标输入各有一份 ref 对 ＋ 卸载 effect
  （组装机卡 09-17 首创；实验室经典/HUD 两处是批 0 刚补的）⇒ 同一段逻辑三份。
- 落地：新增 `ui/useLoopGoalDraft.ts`（`draft`/`typeDraft`/`clearDraft`/`clearTouched` ＋ 卸载补提交，
  用 ref 转发最新 `submitOnUnmount` 闭包）；三处调用点全部换用（markup 各自保留——经典 `.app-belt-loop`、
  HUD `hud-sw-row` 是两套观感，不能硬并）。
- 文件：ui/useLoopGoalDraft.ts（新）· panels/Industry.tsx · pages/IndustryPage.tsx · pages/IndustryHudPage.tsx。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · ui:rot-check ✅ · 构建 ✅。

## 待办/待裁

- 大拆分的具体切分边界等动到批次 4 再逐文件出设计（§2 逐批确认）。
- 破环顺序表（36 环清单）见审查报告 `docs/design/code-review-20261002.md` §6。
