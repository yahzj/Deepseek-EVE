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
| `core/combat.ts`（10193 行） | 敌群生成/伤害结算/特效/统计混居 | 按现有 24 个分区注释切：敌群与生成 → 特效演出 → 伤害与命中 → 统计与图鉴。**4a `combatMath.ts` · 4b `combatReport.ts` · 4c `combatFx.ts` · 4d `foeCard.ts` · 4e `foePower.ts` · 4f 火力构成并入 `wormholeFoes.ts`** | 二号（闪现演出批） |
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

### 批次 1d：`kindLabelText`/`ownedWhereText` 搬进 `ui/labelsText.ts`（2026-10-02 · 模块化 · 零行为变化）

- 这两个"内容层联合 key → 文案"映射原先住在 `panels/Industry.tsx`（造船厂等兄弟面板为借文案
  要去 import 工业面板）。搬进文案映射的家 `ui/labelsText.ts`（`aiCoreText` 已在那），两处调用点
  （BlueprintCard 内部）改 import。
- 文件：ui/labelsText.ts · panels/Industry.tsx。
- 验证：typecheck 全仓 ✅ · ui:rot-check ✅ · 构建 ✅。

### 批次 1e：手动位置灰统一走 core 单点 `manualSlotOf`（2026-10-02 · 模块化 ＋ 一处行为口径对齐）

- 核证（决定动工的依据）：`manualSlotOf`（activityGate.ts:224）= 逐族 `.some(active && pilot)`；名册条目
  **没有 inactive 残留**（全仓 0 处 `.active = false`，停线即 splice）⇒ 经典页原来漏写 `.active` 的那处
  与 core 单点**逐字等价**，可安全替换。
- 落地：
  - 经典精炼炉卡 `manualNote`（原 refineRuns/manufacturingRuns 各查一遍）改按 `manualSlotOf` 返回值分族措辞；
  - 组装机卡 `manualBuildNote` 同改，删掉手工枚举的 `.some`；
  - **行为口径对齐（小行为变化，单独说明）**：补 `slot === 'lab'` 分支——主控开实验室时，经典页三张卡
    的手动键现在也置灰（原只有 HUD 置灰；core 本来就拒绝，这是"少给一次无效点击"，与 HUD 一致，
    文案复用通用句 `ui.hud.212`）。
  - `manualBusyNote`（野外/返航途中）保留为本地 helper——那是"位置"，不是"手动位"，HUD 无此概念，
    不再并。
- 文件：pages/IndustryPage.tsx · panels/Industry.tsx。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · ui:rot-check ✅ · 构建 ✅。
- 注：审查报告 §5 #7 原描述为"手动位忙态重复"——实为"位置/家族/全局"三种口径；本台账为如实修正版，
  本批只收敛"家族/全局"这一层，"位置"层留待后续（如需也可进 core）。

### 批次 2b：arch:guard 新增 F9「相对导入环自检」（2026-10-02 · 护栏）

- 背景：审查报告 §6 实测 core 有 34 处运行期模块环（含一条 13 模块长环），`54cfc050` 已因模块环炸过
  启动崩溃。护栏口径：只认相对导入的**运行期**边（`import type` 不算；**副作用导入 `import './x'` 也算边**，
  反例实测抓到过漏判）；**新增环 = 红**，基线里已消失的环 = 提示收账。
- 存量 34 条进 `F9_CYCLE_BASELINE`（JSON 形态、\u2192 转义防漂移）；破一条删一条，直到清零。
- 反例实测：临时 `_f9a.ts`/`_f9b.ts` 互导 ⇒ F9 报红 1 处（已验证后删除）。
- 配套：`docs/development-conventions.md` §15之二 护栏清单 F1~F7 → **F1~F9**（补 F8/F9 两行）＋ changelog 记一条。
- 文件：tools/arch-guard.ts · docs/development-conventions.md · docs/development-conventions-changelog.md。
- 验证：arch:guard 全绿（F1~F9）✅。

### 批次 2a-①：core 未用导入清理（2026-10-02 · 护栏前置 · 零行为变化）

- 背景：`tsconfig.base` 没开 `noUnusedLocals` ⇒ core 累计 192 处未用局部/导入。目标 = 清干净后把
  `noUnusedLocals: true` 写进 `packages/core/tsconfig.json`。
- 做法：临时修器 `tools/_probe-unusedfix.mts`（**只删单行 import 里的未用名**；行内注释先切走再拼回；
  字节级替换。中途两次事故：① 行首偏移按 `len+1` 算 ⇒ CRLF 文件逐行漂 1 字节、把 `from` 砍成 `fom` ——
  已 `git checkout` 全量回滚重来，改为逐 `\n` 扫描行首 ② 多行 import 一律不碰，交人工）——**用完即删**。
- 本步：**61 个文件、86 处**单行未用导入已删（core/src 19 文件 + tests 41 + data 1）；typecheck ✅ ·
  core 全量 **3004 条** ✅。
- 剩余 **106 处**（多行 import 内的未用名 ＋ src/tests 里的未用局部）交后续人工步：src 59 · tests 105 · data 2
  的原始人工清单里已消掉一部分，见后续批次；**在全部清零前，闸门不开**。

### 批次 2a-②：core src/data 未用符号人工清理（2026-10-02 · 零行为变化）

- **src 全部清零**（多行 import 未用名 逐块手删 ＋ 未用局部逐处核副作用后删）：
  expedition / weekendBattle / wormhole / wormholeBattle / wormholeSalvage / wormholeAutoSim /
  wormholeAuto / market（`p`/`pClamped`/`mk`）/ mining（`tripNoteId`）/ save（`asNullableString`）/
  sideTasks（`taskGoodBasePool` 整函数）/ weekendEvent（`windowMs`）/ combat（**哨戒机开关
  `PD_TARGET_SENTRIES`**：机制代码早已不在，留着只会误导，裁定记录在 git 历史 09-11 提交）。
- **重复效果代码并一**：`packages/data/src/anomalies.ts` 的 `ALIEN_COMP`/`D_COMP`/`E_COMP` 三份逐字同式
  （`2N/(N+1)`），E 族那份无人使用 ⇒ 并成一份 `COMP_MUL`，全部调用点改用它（11 处）。
- 顺带修 wormholeAuto.ts 一处双空格 import。
- 剩余 **65 处全在 tests/**（未用导入名 ＋ 未用测试局部；测试局部要逐处核初始化副作用，
  如 `const run = advanceGame(s)` 这种**不能删声明**、只能改为裸调用）⇒ 下一批清完再开闸门。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅。

### 批次 2a-③：tests 未用符号清零 ＋ **noUnusedLocals 闸门开启**（2026-10-02）

- 65 处测试文件里的未用导入名/未用局部全部清完（逐处核：纯构造/纯读直接删；`enterRunWithLogi()`
  这类返回多值的只摘掉没用的解构名，调用本身保留）。
- **顺手修复一处既有损坏**：`v181.test.ts:172` 注释里嵌了字面 `\r\n`，把
  `expect(drone.shotDmg).toBe(6)` 那行**吞进注释**（断言已静默失效多年）⇒ 拆回两行、断言恢复，
  测试全绿（12 条）。
- **闸门开启**：`packages/core/tsconfig.json` 加 `"noUnusedLocals": true`（先清后开；以后死导入/死局部
  在 core 的 typecheck 里当场报红）。renderer 侧的清理后续另批（它的 tsconfig 未开）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅。

### 批次 3-①：破第一条环 `ai ↔ market` ＋ 环境兜底（2026-10-02）

- **环境事故（已定位、已兜底、未删现场）**：vitest 与 electron-vite 突然全挂——`postcss-load-config`
  从项目 root 向上找配置，命中 `H:\大鲸鱼\package.json`（**外部进程留下的 0 字节空文件**）⇒
  `JSON.parse('')` 炸。修法 = 仓库根加一份**空 postcss 配置**（`postcss.config.js`，零插件 = 与无配置等价），
  让查找器命中最近这份、不再走到坏文件；**那份空文件不是本仓产物，没动它**（已报船长）。
- **破环**：`ai.ts ↔ market.ts` —— ai→market 只有一条边（`buyBasicAiCore` 买核心借 market 五个交易函数）⇒
  把这个函数**原样搬到 market.ts**（它本质是市场交易；错误 id 与文案逐字不动），ai.ts 删掉对 market 的
  运行时依赖 ⇒ 环断。`index.ts` 导出源随之改、`tests/ai.test.ts` 导入路径改。
- F9 基线 **34 → 32**：删掉本条；另发现"未用导入清理"已顺手断掉
  `expedition→weekendBattle→weekendEvent→sideTasks`（sideTasks/weekendEvent 对 expedition 的导入已随清理
  消失）⇒ 也删（破环成功收账）。
- 验证：typecheck 全仓 ✅（含 noUnusedLocals 闸门）· core 全量 **3004 条** ✅ · arch:guard F1~F9 ✅ · 构建 ✅。

### 批次 3-②：破第二条环 `comms ↔ station`（2026-10-02）

- 手法 = **把纯 `state` 读数搬到 state 家**：`siteProgress` / `isSiteBuilt`（类型 `StationSiteProgress`
  本来就定义在 state.ts）从 station.ts 搬到 state.ts；comms / station / location / hauling / sideTasks /
  tests/t9 全部改从 state 读 ⇒ station→comms 的边只剩单向的 `deliverDialogueToComms`，环断。
- index.ts 导出随迁；F9 基线 **32 → 31**。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · arch:guard F1~F9 ✅ · 构建 ✅。

### 批次 3-③：破 `state ↔ wormhole`（一条边断掉 13 条环）＋ 基线改独立数据文件（2026-10-02）

- **手法**：state→wormhole 的运行期边只有一条（`EMPTY_WORMHOLE_STATE`，虫洞空初值）⇒ 搬到 state.ts
  （类型仍 `import type` 借 wormhole，不算运行期边）⇒ 该边断 ⇒ **13 条过它身的基线环一次性消失**；
  原图里另 7 条被大环包含的小环浮出（同一张图换了最短环分解，不是新增代码）。
- **基线机制升级**：内联在 arch-guard.ts 里的巨型 JSON 行 → 独立数据文件
  `tools/arch-guard-baseline-cycles.json`（`--f9-dump` 保留为**维护模式**：破环后重新 dump 覆盖即可）。
  基线 **31 → 26**（重打快照：−13 旧环 ＋7 浮出）。
- 约定 §15之二 与工具头注同步更新（F9 描述改"基线文件 + 递减"）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · arch:guard F1~F9 ✅ · 构建 ✅。

### 批次 3-④：破 `inventory ↔ equipment`（拆出 `fitted.ts`）（2026-10-02）

- 手法：`allFittedModules` / `familyModules`（已装件读出两件套，只依赖 labels 的 `allFittedIds`）从
  equipment.ts 拆到新文件 `fitted.ts`；inventory.ts 改从 fitted 读 ⇒ inventory→equipment 的运行期边断，
  equipment→inventory（仓库操作）保留为正确方向。equipment.ts **原样再导出**（先例：wormhole 再导出
  层曲线）⇒ 其余 7 个调用方零改动。
- F9 基线 **26 → 25**。
- 验证：typecheck 全仓 ✅（noUnusedLocals 闸门抓到并修掉一个多引入的再导出名）· core **3004 条** ✅ ·
  arch:guard F1~F9 ✅ · 构建 ✅。

### 批次 3-⑤：破 `mining ↔ shipyard`（`pilotUnavailableReason` 归位 activityGate）（2026-10-02）

- 手法：`pilotUnavailableReason`（主控"驾驶船不可用"判据，纯 state 读数）从 shipyard.ts 搬到
  activityGate.ts（主控活动判据的家）；mining / salvaging / expedition / location / tests/wormhole-battle
  全部改从 activityGate 读——**不留在 shipyard 再导出**（再导出会让运行期边原样保留）。
  ⇒ mining→shipyard 的运行期边清零（shipyard→mining 的 `retireMiningShip` 保留单向）。
- 连带：12 条过它身的基线环消失、10 条重分解浮出 ⇒ F9 基线 **25 → 23**（重打快照）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · arch:guard F1~F9 ✅ · 构建 ✅。

### 批次 3-⑥：破 `salvaging ↔ shipyard`（拆出 `fleetBook.ts`）（2026-10-02）

- 手法：`addShipToFleet` / `allocateShipUid` / `emptyShipState` / `restoreShipFromWreck` 四件**纯舰队账本
  操作**从 shipyard.ts 拆到新文件 `fleetBook.ts`（只依赖 labels 的 `emptyFitted` 与 shipWrecks 的回收比例
  常量）；salvaging 改从 fleetBook 读 ⇒ salvaging→shipyard 的运行期边清零，shipyard→salvaging 的
  `retireSalvageShip` 保留单向。shipyard 原样再导出四件（先例：fitted.ts）。
- 先试过"move restore 到 shipWrecks"（会造出 shipWrecks↔shipyard 新环）与"shipyard 改调 salvageHalt"
  （会丢返航账本、改行为）⇒ 都不行，最终走本手法。
- F9 基线 **23 → 22**。
- 验证：typecheck 全仓 ✅（闸门抓到 7 处搬家后未用 import，已清）· core **3004 条** ✅ · content/l10n ✅ ·
  arch:guard F1~F9 ✅ · 构建 ✅。

### 批次 3-⑦：破 `expedition ↔ weekendBattle`（拆出 `standing.ts` 声望账本）（2026-10-02）

- 手法：`DSI_FACTION_ID` ＋ 声望账本四件（`standingOf`/`spendableStandingOf`/`noteStandingEarned`/
  `spendStanding`，纯 state 读数）从 expedition.ts 拆到新文件 `standing.ts`；weekendBattle 改从 standing 读
  ⇒ expedition↔weekendBattle 的运行期边清零。expedition 原样再导出（其余 40 余处门槛的既有引用零改动；
  expedition 内部三处调用经本地 import 补齐）。
- F9 基线 **22 → 21**。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · arch:guard F1~F9 ✅ · 构建 ✅。

### 批次 3-⑧：破 `combat ↔ wormholeFoes`（火力构成两件归位）（2026-10-02）

- 手法：`compositionOfMix` / `foeDamageComposition`（纯构成计算）从 combat.ts 搬到 wormholeFoes.ts——
  那里是它们唯一的跨模块消费者；wormholeFoes 不再 import combat ⇒ 环断。combat 原样再导出
  （先例：fitted.ts）⇒ 战斗/胜率预估/界面/用例的既有引用零改动。
- F9 基线 **21 → 20**。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · arch:guard F1~F9 ✅ · 构建 ✅。

### 批次 3-⑨：weekendBattle 不再依赖 weekendBounty（活动态读数归位 weekendEvent）（2026-10-02）

- `WEEKEND_CARD_PREFIX` / `weekendOccupiedLiveAt`（只读 `state.weekendEvent` 的活动态读数）从
  weekendBounty.ts 搬到 weekendEvent.ts；weekendBattle 改从 weekendEvent 读 ⇒ 它不再 import
  weekendBounty。weekendBounty 原样再导出（encounters / expedition / index 引用不动）。
- 注：这条 2 节点环在批次 3-⑤ 的连带重分解中**已先行消失**；本批是把"battle→bounty"这条仍存在的
  跨件依赖也拆干净（环数不变，图更瘦）。基线仍 **20**。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅。

### 批次 3-⑩：F9 判据修正——剔除 6 条幻影环（2026-10-02）

- 起因：复查 `salvage → state → types` 环，三对互引全是 `import type`、环却存在 ⇒ 追到 F9 边收集两处误判：
  ① `[^'"]*?from` 惰性扫描跨语句偷梁换柱——`export const INITIAL_STANDING = 0`（state.ts:39）连到 41 行的
  `from './types'`、`export function residentWreckGroupsOf`（salvage.ts:407）连到 596 行的 `from './state'`，各造一条幻影边；
  ② 类型位动态导入 `import('./x').类型名` 被当运行期边（实测全库 135 处全是类型位）。
- 手法（只动工具与类型标注，零游戏行为变化）：F9 边收集收紧为三形态——花括号 from（含跨行）／裸副作用导入／
  **值位**动态导入（`.then(`、`await import` 等算，类型位 `.类型名` 不算）；已核全库无默认导入、`import * as`、
  `export * from` ⇒ 收紧不丢真边。另把 `types.ts` 唯一一处类型位动态导入改成顶层 `import type { RecycleTier }`。
- F9 基线 **20 → 14**：6 条幻影环剔除（equipment 族 4 条 · ironman 环 · salvage→state→types），无重分解。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：本批零渲染层文件改动）。

### 批次 3-⑪：拆出 `aiCores.ts` 核心账本——破 `ai ↔ shipyard` 与 `market → ai`（2026-10-02）

- 手法：`AI_CORE_ORDER` / `aiCoreName` / `countAiCore` / `gainAiCore` / `spendAiCore` / `spendAiCores` /
  `cancelAiTask` 七件核心账本操作从 ai.ts 拆到新文件 `aiCores.ts`（只依赖 firstTasks / instances / state /
  types，均不回引 ai）⇒ shipyard / encounters 改从 aiCores 读 `cancelAiTask`、market 改从 aiCores 读核心账本
  ⇒ `shipyard→ai` 与 `market→ai` 两条运行期边清零。ai.ts 原样再导出（先例：fitted.ts；`spendAiCore`
  保持模块私有不外漏），industry / wormholeAuto / wormholeBattle / index / 测试存量引用零改动。
- 途中教训：`cancelAiTask` 里调 `aiCoreName`、`gainAiCore` 里调 `AI_CORE_ORDER`/`peakFirst` ⇒ 新模块
  若回引 ai 会造新环，故这四件一并搬走；一次编辑误加重复 `countAiCore` 定义（当场读档修掉）。
- F9 基线 **14 → 10**：破 ai↔shipyard、ai→expedition→…→market、ai→mining→…→market 三条；
  一条此前被遮住的 9 节点环（comms→…→station）浮出（DFS 回边重排，环一直存在、非新增）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：本批零渲染层文件改动）。

### 批次 3-⑫：七刀连破——core 运行期环 10 → 3（2026-10-02）

- ① `recallExpedition` 从 expedition.ts 原样搬到 mining.ts（唯一跨模块调用方；index 改从 mining 导出，
  t1/t8 用例改 import）⇒ mining→expedition 边清零。
- ② `skillQueueStatus` 从 engine.ts 搬到 activity.ts（唯一调用方；类型 QueueView/HeadTrainingInfo 仍
  从 engine 借 `import type`）⇒ activity→engine 边清零（engine.test/queue-reorder 用例改 import）。
- ③ `wormholeAutoRunsOf` 搬到 state.ts（纯读数、类型 WormholeAutoRun 本就住 state；wormholeAuto
  借回 + 再导出）⇒ activity→wormholeAuto 边清零。
- ④ `PLUG_BLACKBOX_ITEM_ID` 从 plugs.ts 搬到 blackbox.ts（权威副本移居；salvaging/wormholeBattle/
  index/两用例改 import；shipWrecks 注释同步）⇒ blackbox→plugs 边清零。
- ⑤ salvaging 的 HOME_GALAXY_ID/shortestTravelMinutes 改从 state/travel 读 ⇒ salvaging→expedition 边清零。
- ⑥ market 的 DSI_FACTION_ID/standingOf 改从 standing 读 ⇒ market→expedition 边清零。
- ⑦ 新文件 `commsDelivery.ts`：`deliverDialogueToComms` + `resolveCommsSender` + `commsDialogueKey`
  + `deliver` + `CommsSenderView` 五件从 comms.ts 拆出；station 改从 commsDelivery 读（中途先只拆
  入口函数，环改经 commsDelivery→comms 借道闭合 ⇒ 再把帮手整簇搬走才真断）⇒ station→comms 边清零。
- 注：DFS 回边枚举随破环重排，多批隐藏环浮出（weekend 簇）；全部为存量环、无一新增。
- F9 基线 **10 → 3**（余：hauling 4 环、market→shipyard→salvaging→weekendBounty 簇 2 环）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：本批零渲染层文件改动）。

### 批次 3-⑬：最后两刀——F9 基线清零，破环工程收官（2026-10-02）

- ① 新文件 `securityZone.ts`：`SecurityZone` 类型 + `securityZoneOf`（纯 ctx 读数）从 sideTasks.ts
  拆出 ⇒ hauling / consumables / weekendEvent 改从 securityZone 读（hauling→sideTasks 边清零）。
  连带 5 处 import 改道（含 4 个用例）；index 的导出行同步。
- ② `isShipLocked` / `shipStoredCount`（纯 state 读数）从 shipyard.ts 搬到 fleetBook.ts（舰队账本的家）；
  market 的四件（含 `addShipToFleet`/`shipDisplayName` 改道 fleetBook/instances）全部离开 shipyard
  ⇒ market→shipyard 边清零。manufacturing / comms 用例改道；shipyard 借回 + 再导出（先例）。
- F9 基线 **3 → 0**：core 运行期模块环**全部清零**（初始 34 条 → 判据修正收 6 条幻影 → 破 28 条实测环）。
  此后 F9 = 纯"不许新增运行期环"闸门。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：本批零渲染层文件改动）。

### 批次 4a：combat.ts 首拆——`combatMath.ts` 命中与伤害数学（2026-10-02 · 零行为变化）

- 手法：`Hp3` / `clamp` / `RESIST_FLOOR` / `typeLayerMult` / `layerMultText` / `distFactor` /
  `inRange` / `hitChance` / `droneHitChance` / `applyDamage` 十件**纯数学层**（无 state/随机/日志，
  只依赖 types）从 combat.ts 拆到新文件 `combatMath.ts`；combat 借回使用并原样再导出
  ⇒ wormholeBattle / encounters / hullDamage / UI / 用例等 12~13 个外部文件的既有引用零改动。
- `applyDamage` 参数类型 `UnitSpec['resists']` 改为等价的结构类型（shield/armor/hull 各 DamageResists）
  ——避免 combatMath 反向借 combat 的类型，保证零回边（F9 实测仍为 0 环）。
- noUnusedLocals 闸门抓到 combat 不再内部使用的 `layerMultText`（只留再导出）——护栏生效实例。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4b：combat.ts 二拆——`combatReport.ts` 战报与四档判定（2026-10-02 · 零行为变化）

- 手法：`spreadWinChance` / `BattleVerdict` / `battleVerdictOf` / `captureBattleReport` /
  `sunkShipIdsOfBattle` 五件**统计与图鉴层**（纯 state 读数/写账，只依赖 combatMath.clamp 与
  state 类型）从 combat.ts 拆到新文件 `combatReport.ts`；combat 借回使用并原样再导出。
- 留下 `persistFleetHullDamage`（依赖 `createPlayerSpec` 内部件）与 `settleDroneLosses`（依赖
  `droneRecoveryRateWithBonus` 内部件）——搬走会造 combat↔combatReport 回边，留待后续整簇再动。
- 连带：`tools/content-check.ts` 的「结算口径契约」按源码扫描 `combat.ts` 找沉船判据单点
  ⇒ 搬移后当场报红（护栏抓到"单点搬家没改指路"）；契约改指 `combatReport.ts`，判据不变。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4c：combat.ts 三拆——`combatFx.ts` 战斗演出层（2026-10-02 · 零行为变化）

- 手法：`BATTLE_ARRIVAL_FLY_MS` / `BATTLE_ARRIVAL_STAGGER_MS` / `WORMHOLE_FOE_VOLLEY_STAGGER_MS`
  / `stampFoeArrivalFx` / `pushBattleFx` / `pushBattleNotice` 六件**特效演出层**（纯 BattleState
  写账，只依赖 state 类型）从 combat.ts 拆到新文件 `combatFx.ts`；combat 借回使用并原样再导出。
- `pushBattleNotice`（战斗内提示条）原为模块私有——从 combatFx 导出供 combat 值导入，不进入
  combat 的公开面。noUnusedLocals 闸门抓到 `stampFoeArrivalFx` 在 combat 内部无调用（grep 命中的
  是注释），值导入改只留再导出。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4d：combat.ts 四拆——`foeCard.ts` 敌卡档案（2026-10-02 · 零行为变化）

- 手法：敌舰显示名与舰级反查整块（`FOE_CLASS`/词缀常量/`foeClassName`/`foeMainTagOf`/
  `waveHpShareOf`/`shipWaveIndexOf`/`enumerateShipUnits`/`FOE_SUPPORT_TAG_RE`/`baseFoeTag`/
  `foeShipAtTag`/`foeShipIdOfTag`/`foeCardShipIdOf`/`foeUnitNameOf`/`foeShipTierOf`/
  `foeShipEliteOf` 十五件）从 combat.ts 拆到新文件 `foeCard.ts`（纯 AnomalyDef 读数，只依赖 types）。
- `enumerateShipUnits`/`shipWaveIndexOf`/`baseFoeTag`/`FOE_SUPPORT_TAG_RE`/`foeUnitNameOf`
  因 createFoeSpecs/seedUnit 仍要用而转公开；combat 借回使用并原样再导出（foeBrief 等引用零改动）。
- 维修/护盾簇探过：`layerAmpOf` 依赖 `createPlayerSpec`（1500 行规格大件）⇒ 搬走必造回边，
  留待敌群规格簇先拆。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4e：combat.ts 五拆——`foePower.ts` 敌力曲线（2026-10-02 · 零行为变化）

- 手法：`TACTIC_RANGE` / `foeRefSpeedMps` / `foeSpeedBase` / `foeHpOfThreat` / `foeThreatRatingOf` /
  `foeMultiShipCompMul` 六件**敌力平衡曲线**（纯 BattleBalance/AnomalyDef 读数，只依赖 types）
  从 combat.ts 拆到新文件 `foePower.ts`；combat 借回使用并原样再导出（winEstimate/内容体检引用零改动）。
- `TACTIC_RANGE`/`foeSpeedBase`/`foeMultiShipCompMul` 原模块私有，因 createFoeSpecs 仍要用而转公开
  （不进 combat 公开面）。`foeStrengthOf`/`foeThreatOfAnomaly` 依赖 `createFoeSpecs` ⇒ 留下，
  反解所需的 `foeHpOfThreat`/`foeThreatRatingOf` 从 foePower 借回。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4f：combat.ts 六拆——火力构成与血型层并入 `wormholeFoes.ts`（2026-10-02 · 零行为变化）

- 手法：`pickTopType` / `foeMainDamageType` / `splitShotByComposition` / `PROFILE_SPLIT` /
  `foeLayerSplit` 五件**纯构成计算**搬进 `wormholeFoes.ts`（3-⑧ 已有 `compositionOfMix`/
  `foeDamageComposition` 同族件，不建新文件）；combat 借回使用并原样再导出。
- `pickTopType`/`PROFILE_SPLIT` 原模块私有，因 createFoeSpecs 仍要用而转公开（不进 combat 公开面）。
- 探过但未动的两块（记台账）：① 玩家规格簇（createPlayerSpec 668 行）依赖面已探清为零内部调用、
  可整块外迁，但体量大留待 4g 专项；② 胜率预估簇依赖 `steadyPreview`（内连规格大件）⇒ 被规格簇卡住。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4g-1：combat.ts 七拆——`playerSpec.ts` 玩家规格乘数与抗性合成（2026-10-02 · 零行为变化）

- 手法：`applyAdds` / `mergeResist`（EVE 式抗性合成）/ R4/R5 上位技能乘数五件（`damageUpgradeMult`
  等）/ `playerAmmoType` 共九件从 combat.ts 拆到新文件 `playerSpec.ts`（纯读数/纯计算，只依赖
  state 类型/types/combatMath/equipment）；combat 借回使用并原样再导出。
- `applyAdds` 原模块私有，因 createPlayerSpec 仍要用而转公开（不进 combat 公开面）。
- noUnusedLocals 抓到 `familyUpgradeSkillIdOf` 在 combat 内部无直接调用（只被 familyUpgradeMult
  内部使用）——值导入改只留再导出。
- 分两步的原因：`createPlayerSpec` 主件 668 行体量大，4g-2 续搬（届时从本文件借回这些件）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4g-2：combat.ts 八拆——`createPlayerSpec` 主件搬入 playerSpec.ts（2026-10-02 · 零行为变化）

- 手法：`createPlayerSpec` 整块（含双注文，665 行）用 .NET 显式 UTF-8 行级切接搬入 playerSpec.ts
  （§三合规；搬后 BOM/行尾/乱码三自检全过）；连带搬入它独用的 `AMMO_IDS`/`ammoIdFor` 与两边共用的
  `DRONE_SKILL`/`droneSkillLv`/`MY_WEB_RANGE_M`/`WEB_BREAK_DIST_M`（后者留在 combat 会造
  combat↔playerSpec 回边）。
- 类型 `UnitSpec`/`WeaponSpec` 仍从 combat 借（`import type`，不构成运行期环，F9 实测 0 环）。
- combat 侧清理 8 个因搬家而闲置的 import（shipCategoryKeyOf/plugModulesOf/cpuBudgetOf/curveMult/
  familyModules/fittedCpuUsed/gapCombine/weightedSum/RESIST_FLOOR），noUnusedLocals 全数抓出。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4h：combat.ts 九拆——`combatRepair.ts` 维修与护盾脉冲整簇（2026-10-02 · 零行为变化）

- 手法：layerAmpOf ~ pulseRepairsFor **整簇 713 行**（维修装置/护盾场/充能脉冲全族＋私有助手）
  用 .NET 显式 UTF-8 行级切接搬入新文件 `combatRepair.ts`（§三合规，BOM/行尾自检过）；
  `REPAIR_PULSE_MS` 随之迁入。combat 借回使用并原样再导出（UI/用例引用零改动）。
- 连带三件小搬：`isAlive`（存活判据）→ combatMath（combat/combatRepair 共用）；`removeCargoOfShip`
  → inventory（货舱操作回货舱的家）；`pulseRepairsFor` 因 advanceBattleFor 仍要调用而转公开
  （不进 combat 公开面）。
- 解锁前提：4g-2 把 `createPlayerSpec` 搬走后，簇内 `layerAmpOf` 对它的依赖变跨模块单向
  ⇒ 不再有 combat↔新模块回边（F9 实测仍 0 环）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4i：combat.ts 十拆——`combatAmmo.ts` 战斗弹药装载（2026-10-02 · 零行为变化）

- 手法：`ammoLoadTotals`/`loadAmmo`/`loadAmmoOf`/`ammoTierFallbackLog`/`resolveAmmoTier`/
  `loadAmmoTier`/`refundAmmo`/`nextAmmoType`/`AmmoKey`/`ammoKeyOf` 十件**弹药装载簇**（196 行）
  切接搬入新文件 `combatAmmo.ts`（§三合规，BOM/行尾自检过）；combat 借回 + 原样再导出。
- `ammoTierFallbackLog` 原模块私有，因 startBattleFor 仍要调用而转公开（不进 combat 公开面）。
- 两处调用点 `n ?? 0` 纯类型微调：ammoLoadTotals 迁出后其 Partial 返回的 entries 值类型在模块边界
  解析为 `number | undefined`（运行期只写数字键 ⇒ 零行为变化）。
- 胜率预估簇探过：`steadyPreview` 依赖 `createFoeSpecs`/`battleOpenM`（仍留 combat）⇒ 继续被卡，
  待敌群建档簇再拆。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4j：combat.ts 十一拆——`combatDrones.ts` 机群池与近防炮 ＋ 时钟族归位（2026-10-02 · 零行为变化）

- 手法：`aliveDroneKeys`～`pickFoeDroneTarget` **机群池/近防炮整簇 456 行**切接搬入新文件
  `combatDrones.ts`（§三合规，BOM/行尾自检过）；`isFoeEngageable`（可选中判据）随之迁入
  （combat 选靶与机群簇共用）。`buildDronePoolsFor`/`resolvePointDefense`/`isFoeEngageable`
  因 startBattleFor/stepBattle 仍要调用而转公开（不进 combat 公开面）。
- **战斗时钟族四件**（`waveGapTotalMs`/`battleSpeedOf`/`battleShowWindowMs`/`battleClockNowMs`，
  纯 BattleState/平衡读数）归位 `combatMath.ts`——isFoeEngageable 依赖 `battleShowWindowMs`，
  不迁时钟族会造 combatDrones→combat 回边。
- combat 借回 + 原样再导出；combat 侧 5 个闲置 import 清理（noUnusedLocals 抓出）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4k：combat.ts 十二拆——`foeRange.ts` 敌武器射程与电子舰压制（2026-10-02 · 零行为变化）

- 手法：`foeDroneRangeOf`～`markFoeGunRangeBuff` **射程/压制整簇 404 行**（敌机有效射程单一真相源、
  受击增程、电子舰削减加法口径、干扰舰净削减、基准账）切接搬入新文件 `foeRange.ts`（§三合规，
  BOM/行尾自检过）；combat 借回 + 原样再导出。
- 四件原模块私有（`applyFoeRangeDebuff`/`foeRangeWithDebuff`/`markFoeDroneRangeBuff`/
  `markFoeGunRangeBuff`）因 combat 各结算点仍要调用而转公开（不进 combat 公开面）。
- 连带解锁：敌群建档簇对 `foeGunMaxRangeOf`/`foeDroneRangeOf` 的区外依赖已变跨模块单向 ⇒ 4l 可整簇搬。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4l：combat.ts 十三拆——`foeSpecs.ts` 敌群建档与增援整簇（2026-10-02 · 零行为变化）

- 手法：`敌方编队头注`～`seedUnit` **敌群建档/增援/距离机动整簇 1549 行**切接搬入新文件
  `foeSpecs.ts`（§三合规，BOM/行尾自检过）——combat.ts 至此 10485 → **5457 行（−48%）**。
- 连带小搬：`initFoeDronePools`/`initFoeRepairPulses`（combat 的 advanceBattleFor 与建档簇共用）、
  `FOE_REPAIR_THREAT_REF`（含编译期一致性校验）随之迁入；11 件原模块私有件因 combat 各结算点
  仍要调用而转公开（不进 combat 公开面）。
- combat 借回 + 原样再导出；14 个因搬家而闲置的 import/类型清理（noUnusedLocals 全数抓出）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4m：save.ts 首拆——`saveBattleClean.ts` 战斗档清洗器（2026-10-02 · 零行为变化）

- 手法：`asRaw`～`cleanFx` **战斗状态清洗整簇 930 行**（asRaw 安全转对象、BATTLE_FIELDS 持久化分类表
  ＋编译期键集完整契约、cleanBattle 与全部 clean* 字段清洗件）切接搬入新文件 `saveBattleClean.ts`
  （§三合规，BOM/行尾自检过）——save.ts 4433 → **3504 行**。序列化/归一/迁移主体按蓝图不动。
- `RawState` 类型随借出转导出；`asRaw`/`cleanBattle`/`cleanPlugIds`/`cleanAmmoIdMap`/`RACK_MAX`
  因 save 其余部分仍要调用而转公开；save 借回 + 原样再导出 `BATTLE_PERSIST_KEYS`。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4n：engine.ts 首拆——`skillQueue.ts` 技能训练队列域（2026-10-02 · 零行为变化）

- 手法：`advanceSkillQueue`～文件尾 **技能队列整簇 761 行**（队列推进含技能加速自动续用、前置/封锁
  判定、一键补齐计划、入队/移队/清队、队列视图类型）切接搬入新文件 `skillQueue.ts`（§三合规，
  BOM/行尾自检过）——engine.ts 蓝图时 3828 → **422 行（−89%）**，只剩主循环与里程碑对账。
- `HIDDEN_SKILL_IDS` 随迁（留在 engine 会造 engine↔skillQueue 回边）；`advanceSkillQueue` 因主循环
  仍要调用而转公开；engine 借回 + 原样再导出（含 QueueMovePlan/SkillPrereqGap 等类型）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ · 构建 ✅
  （ui:rot-check 不适用：零渲染层改动）。

### 批次 4o：渲染层试点——`ui/communicator.tsx` 通讯弹层（2026-10-02 · 零行为变化）

- 手法：`Communicator`（通讯剧本弹层，仅依赖 i18n 的 `tr`）从 panels/Expedition.tsx 拆到
  `ui/communicator.tsx`；Expedition 借回使用并原样再导出 ⇒ App.tsx 等既有引用零改动。
- 渲染层拆分的试点批：验证「抽出组件 → 原文件借回 + 再导出」在 JSX 侧同样零环（F9 扫渲染层，
  实测仍 0 环）。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ ·
  ui:rot-check ✅ · 构建 ✅。

### 批次 4p：Expedition.tsx 大拆——`panels/StarMap.tsx` 星图域（2026-10-02 · 零行为变化）

- 手法：**星图域整簇 2230 行**（MAP 常量/布局持久化/模拟退火避线/星系标签族徽章 `StarMap`＋
  敌舰影列 `FoeArt` 族＋`GalaxyActions` 星系操作卡＋`FieldKitRepair` 野外应急修理）从
  panels/Expedition.tsx 切接搬入新文件 `panels/StarMap.tsx`——Expedition **4299 → 2020 行（−53%）**。
- 连带小搬：`fmtSideClock`/`fmtDayClock` → `i18n/fmt`（StarMap 与 Expedition 共用，留原地会造回环）。
- 零环保证：`GalaxyActions`/`FieldKitRepair`/`FOE_TACTIC_HINTS` 等回环节点全部同迁；Expedition 借回
  + 再导出（F9 扫渲染层，实测仍 0 环）。途中一次多行块注释切点错位（首行落下）当场修掉。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ ·
  ui:rot-check ✅ · 构建 ✅。

### 批次 4q：Expedition.tsx 二拆——`panels/ExpeditionCards.tsx` 任务卡族（2026-10-02 · 零行为变化）

- 手法：`AnomalyCard`～`StationCard` **任务卡族整簇 1405 行**（常驻悬赏卡/时效任务区/赏金任务区/
  快递在途横幅/建站卡）切接搬入新文件 `panels/ExpeditionCards.tsx`——Expedition **4299 → 596 行
  （−86%）**，只剩三个面板壳（ExpeditionPanel/TaskPanel/BountyPanel）。
- `SideTaskSort`/`SIDE_TASK_SORT_KEY`（时效任务排序偏好）随迁；`Communicator` 再导出被 4q 切接
  顺走、当场搬回 Expedition（App 的既有引用恢复）。
- 零环保证：卡族对 StarMap 域（FoeArt/secText 等）的引用全部跨模块单向；F9 实测仍 0 环。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ ·
  ui:rot-check ✅ · 构建 ✅。

### 批次 4r：BattleScreen.tsx 首拆——`ui/battleBlink.ts` 闪现光柱演出件（2026-10-02 · 零行为变化）

- 手法：`ammoKey`～`syncBlinkPillarDom` **闪现光柱整簇 226 行**（弹种键、光柱排期
  `planBlinkPillars`、SVG 柱体构建 `buildBlinkPillarEl`、DOM 同步 `syncBlinkPillarDom`、
  `BlinkPillarFx` 类型；含簇前一行的分隔空行）切接搬入新文件 `ui/battleBlink.ts`（§三合规：
  LF 行尾、无 BOM，与旧 blob 字节级自检过）——BattleScreen.tsx **3399 → 3175 行**（−226 搬出、＋借回引用）。
- 零环保证：battleBlink 只依赖 @whale/core（`DamageType` 为纯类型边）；BattleScreen 借回使用；
  F9 扫渲染层实测仍 0 环。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ ·
  ui:rot-check ✅ · 构建 ✅。

### 批次 4s：Handbook.tsx 首拆——`panels/handbookDetail.tsx` 详情窗与卡片构造（2026-10-02 · 零行为变化）

- 手法：两段切接——① 宽类型标签助手整簇 12 行（`kindName`/`slotName`/`roleName` ＋ 头注）；
  ② 「详情窗」整簇 459 行（`marketKeyOf` · 六个卡片构造器 `moduleCellOf`/`shipCellOf`/`itemCellOf`/
  `blueprintCellOf`/`shipBlueprintCellOf` · `DetailBody` · `FoeBody` · `CellDetail` · `GroupSection`）——
  搬入新文件 `panels/handbookDetail.tsx`（§三合规：LF 行尾、无 BOM）——Handbook.tsx **2261 → 1790 行（−471）**。
- 零环保证：handbookDetail 只从 Handbook **纯类型**借入 `GridCell`/`RawData`（`import type` ⇒ F9 不记边）；
  Handbook 借回 11 个符号；F9 实测仍 0 环。孤儿 import（`DmgChip`/`itemCombatLines` 等 15 个）随迁清理。
- 护栏跟随：`tools/arch-guard.ts` SINGLE_SOURCE（`itemCellOf` → handbookDetail.tsx，exported: true）·
  `docs/single-source.md` 同条 · `tools/ui-attr-check.ts` 族徽契约扫描范围加 handbookDetail.tsx。
- 验证：typecheck 全仓 ✅ · core 全量 **3004 条** ✅ · content/l10n ✅ · arch:guard F1~F9 ✅ ·
  ui:rot-check ✅ · 构建 ✅。

## 待办/待裁

- **1c（运转名册行）评估后不做**（2026-10-02 记）：5 处 `.app-belt-workers` markup 分属经典/HUD 两族观感、
  各行文案与 worker 口径各不相同，抽公共件要么塞满 props 要么观感并轨（违 §6）；收益 < 风险 ⇒ 维持现状，
  等"两套工业页合流"（批次 4）时一并处理。

- 大拆分的具体切分边界等动到批次 4 再逐文件出设计（§2 逐批确认）。
- 破环顺序表（36 环清单）见审查报告 `docs/design/code-review-20261002.md` §6。
