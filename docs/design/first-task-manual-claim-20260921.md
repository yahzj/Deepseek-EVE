# 「第一次」任务改为「玩家点完成才推进」＋ 任务起手道具（2026-09-21）

> **状态：进行中**（已实现，闸门全绿，待船长实机验收）
>
> **船长原话（照抄）**：
> ① 「**能否加一个任务开始时给予道具的功能？（比如开始第一次打捞，给予一个打捞器）**」
> ② 「**为什么要每拍判断？以及第一次任务不要自动完成。要让玩家回到任务中心点击完成才开始下一步，
>    这样给予任务开始前道具的时间点就很明确**」
> ③ 五问五答：**1 按钮是「完成」** · **2 不要**（不另发"已达成"通讯）＋「**任务完成后出现的通讯的跳转
>    改为返回任务中心**」 · **3 老档直接完成** · **4 先做出起始道具功能，完成后更新到 excel 表内，我来修改**
>    · **5 每步都要完成**（守门脚本每步都走一次点击）

## 一、口径（现行）

| 面 | 口径 |
|---|---|
| **推进方式** | 任务**不再自动完成**。判据满足 ⇒ 任务中心那张卡上的「**完成**」按钮亮起；**点它**才写 `done`、发完成奖励、发情报信、点成就徽章、解锁里程碑、进下一条 |
| **判定仍是每拍** | `claimableFirstTasks(state, ctx)` **只判不写**（回答"现在能不能完成"）；达成那一刻引擎**播报一次**日志「◆ 任务已达成：…回「任务中心」点「完成」」（`state.firstTaskReadyId` 去重），导航徽标同时亮 |
| **起手道具** | 新字段 `FirstTaskDef.startReward`（与 `reward` 同一个六口袋形状）。**发放时机 = 这条"轮到"的那一刻**：① 第一条在序章收尾；② 其余条在**上一条被点「完成」的那一次点击里**；③ 末段并列批在它俩一起显示的那次点击里。**不做每拍扫描**；去重键 `importantTasks[id].started`（只在发放时写、**不回收**） |
| **初始挂了哪几条** | 「第一次维修舰船」→ 民用修理组件 ×5（维修本来要先有钱/件）·「第一次生产」→ 三钛合金 ×150 ＋ 类晶体胶矿 ×50（组装机要料）·「第一次虫洞」→ 采集器 MK1 ＋ 打捞器 MK1（洞内搜/打/撤的必备工具）。**「第一次打捞残骸」暂未挂**：打捞器现在由「第一次采集原矿」完成时给（船长 09-20 令「打捞器应该是挖矿任务给」），若改挂到打捞那条的**开始**，到手会晚 3 条任务 ⇒ 这一格留给船长在 Excel 里定（见 §四） |
| **通讯跳转** | 13 封情报信的「前往」**一律改为回「任务中心」**（船长令②）——读完情报正好顺手点「完成」；每封的提示文案各自独立（同一句话），便于逐条改 |
| **老档** | v30→v31 迁移给老档打 `firstTaskAutoClaim = true`；**读档后第一拍**把"判据已满足却没点过"的积压**按点击同款一次走完**（发奖/发信/进下一条，最多 13 条），随后删键。新档不带它 ⇒ 一律手动 |
| **存档结构** | `CURRENT_STATE_VERSION` 30 → **31**（两个可选字段 ＋ 一次性标记；都没写 ⇒ 与 v30 快照逐字一致） |

## 二、改了什么

**core**
- `firstTasks.ts`：抽出 `FirstReward` 形状 · 新增 `startReward?` 与新字段注释 · **删除 `advanceFirstTasks`**（自动判过那半）·
  新增 **`claimableFirstTasks`**（只判不写）与 **`isFirstTaskCurrent`**（"正轮到"的准入判据）·
  `firstTaskNotice` 返回值加 `ready`（签名加 `|ready` ⇒ **达成那一刻也亮徽标**）· 三条任务补 `startReward`。
- `firstRewards.ts`：`grantFirstPocket`（两口袋共用一段发放代码，日志前缀分开）· **`grantStartRewardsForCurrent`**
  （把"现在轮到的那批"的起手道具发掉）· **`claimFirstTask`**（点「完成的唯一入口」：四道校验 → 写 `done` →
  发完成奖励 → 发下一条起手道具 → 记一条「◆ 任务完成」）。
- `engine.ts`：每拍只做"播报 ＋ 老档收口"（原来的"判定即发奖"整段撤掉）。
- `onboarding.ts`：`finishPrologue` / `beginAfterAwaken` / `skipPrologue` 加**可选** `ctx`（收尾时把第一条的
  起手道具发掉；当前第一条没有 `startReward` ⇒ 现状零变化，日后给第一条补时已就位）。
- `state.ts` / `save.ts`：v31 类型 ＋ 两个可选字段（`firstTaskReadyId` / `firstTaskAutoClaim`）＋
  `ImportantTaskState.started` ＋ v30→v31 迁移 ＋ 归一化（都"缺省不写键"）。
- `index.ts`：导出 `claimableFirstTasks` / `isFirstTaskCurrent` / `claimFirstTask` / `grantFirstPocket` /
  `grantStartRewardsForCurrent` / 类型 `FirstReward`；移除 `advanceFirstTasks`。

**data**
- `firstTaskMessages.ts`：13 封的 `hint` 全部改成 `{ text: '回任务中心，点「完成」继续下一步', page: 'task' }`。
- `l10n/table.ts`：新增 12 条 id（`core.firstTasks.001` · `core.firstRewards.002~007` ·
  `ui.FirstTasks.037~040` · `ui.App.122`），中英齐全。

**UI**
- `panels/FirstTasks.tsx`：卡上新增「**完成**」按钮（可点判据 = `claimableFirstTasks`，未达成置灰 ＋ 说明）·
  奖励行拆两段（「开始即给 ◆」/「完成奖励 ◆」）。
- `App.tsx`：任务中心徽标的悬停文案在"已达成"时补一句 `ui.App.122`。
- `game/engine.ts`：新增 `claimFirstTaskAt(id)` 包装（写盘 ＋ 通知）。

**用例 / 工具**
- `first-tasks.test.ts`：新增 `advanceGame` 包装（走一拍 ＋ 模拟玩家点完成）；「未显示的不能提前完成」那例
  按新口径重写（**引擎连 `done` 都不写** ＋ 点一次只推进一条）；通知断言补 `ready`。
- `achievements.test.ts` / `comms.test.ts` / `wormhole-run.test.ts`：按点击制与新版本号同步。
- `flow:newgame`：`until()` 与每处单拍推进都补 `claimAll`（**每步都点一次完成**，船长令⑤）——**全绿**。
- `tasks:export`：`第一次任务` 表加「**开始即给**」列；另把 CSV 改成 best-effort（文件被 Excel 占用时只告警、
  不弄挂整次导出——本次实测就撞上了）。

## 三、验证

- `npm run typecheck` 四包 **0 错** · `npm run test -w @whale/core` **181 文件 / 2056 用例全绿**；
- `npm run content:check` ✅ · `npm run l10n:check` ✅（12 条新 id 无死引用）· `npm run ui:rot-check` ✅ · `npm run build` ✓；
- `npm run flow:newgame` **✅ 流程全部通过**（11 步全部"点完成"走完；末段两条仍同显 ＋「寻找人类」同拍发布）；
- `npm run save:migrate` **4/4 全绿**：真档 v25 / v28 / v29 / v30 → **v31**，资产不变、页面全开。

## 四、待你定（都在 Excel 里）

- **起手道具挂哪几条**：见 §一表格。`tasks-workbench.xlsx` 的「第一次任务」表已加「**开始即给**」列
  （读数列：改它不会直接生效，你圈定哪几条要什么，我照改）——**「第一次打捞残骸 → 打捞器」这一格**尤其等你：
  维持现状（挖矿完成给）还是改成"打捞开始时给"。
- 顺带：本次导出时 `tasks-第一次任务.csv` 正被占用（Excel/WPS 开着）⇒ 那一张没刷新（xlsx 已是最新）；
  关掉重跑 `npm run tasks:export` 即可。

## 五、归档待办（§8）

- `docs/glossary.md` §十：「「第一次」任务系列」条补**推进方式 = 玩家点「完成」**（判定每拍只读、播报一次、
  老档一次性收口）＋ 起手道具 `startReward` 的口径与发放时机；「情报信」条补"前往一律回任务中心"；
- roadmap 一条（并入 2026-09-21 新手链路批）。

---

_维护：本件是工作文档，验收后按 AGENTS §8 归档（关键内容并入 roadmap/词典 → 删文件 → 重跑 docs:index）。_
