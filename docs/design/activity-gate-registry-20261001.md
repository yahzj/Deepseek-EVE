# 主控活动登记表（实验室漏登记）· 2026-10-01

> **状态**：**已收口** —— stage 1（登记表 ＋ 活动栏接入）2026-10-01 落；**stage 2（契约护栏 ＋
> 接力入口收口）2026-10-02 落**，见 §八。（原写的"尚未动码"是 stage 1 开工前的旧状态，已作废。）
> **船长报障（原话）**：「**实验室的主控活动并不占用主控，是BUG。建议将这方面做一个规则，主控在做什么的时候
> 天然排查其他主控可以做的活。**」
> **船长裁定（原话）**：「**按你推荐来**」＝ ① 实验室被打断走**「先警告再切」**档（与"亲自开炉/亲自开线"同档）
> ② 范围取**乙案**（登记表派生 ＋ 两两互斥矩阵 ＋ 契约护栏）③ AI 核心驱动的实验室产线**不占主控**（维持不变）
> ④ 先普查、再动工。

## 一、普查结果（现有 10 项 ＋ 全部 `start*` 入口）

| 入口 | 文件:行 | 门禁 |
|---|---|---|
| `startMining` | `mining.ts:317` | ✅ 传 `'mining'` |
| `startSalvageOp` | `salvaging.ts:256` | ✅ 传 `'salvaging'` |
| `startHauling` | `hauling.ts:231` | ✅ 传 `'hauling'` |
| `startExpedition` | `expedition.ts:489` | ✅ 传 `'expedition'` |
| `startRefineRun` / `startUnboxRun` / `startRecycleRun` | `industry.ts:266/438/494` | ✅ 传 `'refine'` |
| `startManufacturing` | `manufacturing.ts:341` | ✅ 传 `'manufacturing'` |
| **`startLabRun`** | **`lab.ts:297`** | **⚠ 借用 `'refine'` 这一档**（见下） |
| `startSiteDeliverTrip` | `location.ts:314` | ✅ 传 `'siteDeliver'` |
| `startCourierDelivery` | `sideTasks.ts:1346` | ✅ 传 `'deliver'` |
| 前往星系（驻留） | `location.ts:657` | ✅ 传 `'standby'` |
| 扫描虫洞 | `wormholeScan.ts:214` | ✅ 传 `'wormholeScan'` |
| 进虫洞 | `wormhole.ts:1673/1715` | ✅ 走 `gateMainActivityHandoff` |
| `startScan`（星图扫描） | `explore.ts:190` | —— **有意不过**（2026-09-15 船长令：不占主控）✓ |
| `startTransitHome` | `location.ts:158` | —— 换港返航 = `LOCKED` 档（不占主控活动）✓ |
| `startMiningFromExpedition` / `startExpeditionFromMining` | `mining.ts:402` / `expedition.ts:596` | —— 接力入口，由主入口保证（**stage 2 契约收口**） |

**结论：全仓只发现实验室这一处漏登记**（其余 10 项、以及两个"有意不过"的都自洽）。

## 二、根因（精确到两句话）

1. `startLabRun` 把门禁判据写成 `applyActivityGate(state, 'refine')` ⇒ **起线侧是通的**（开实验室线时会按
   "亲自开炉"那一档处理当时占主控的活动）。
2. 但 `MainActivityKind` 里**没有 `'lab'`**、`mainActivityOf` 也不读 `state.labRuns` ⇒ **占用侧不通**：
   实验室产线在跑时门禁看到"主控空着"，于是采矿 / 打捞 / 远征 / 长途运输 / 建站交付都能同时开工
   = **主控双占**（船长报障的那条）。
3. 旁证：`state.ts:3246` 的 `haltActivityForSwitch` **有 `'lab'` 档**（停机机制知道它）、`activity.ts`
   **没有 lab 分支**（活动栏看不见它）⇒ 同一件事三处口径不一致；而 `MainActivityKind` ＋ `AUTO_HALT_KINDS`
   ＋ `WARN_KINDS` ＋ `INTERRUPTIBLE` 是**四张手抄表**，新活动落地要改四处 —— 这是漏洞的结构性来源。

## 三、分期（按船长裁定的乙案）

- **stage 1（下一步就做）**：
  1. `activityGate.ts` 立**登记表**：每行 = `kind` · **判据 `detect(state)`** · 显示名 id · 分档 ·
     停机函数；`MainActivityKind` · `mainActivityOf` · `AUTO_HALT_KINDS` / `WARN_KINDS` / `INTERRUPTIBLE`
     **全部从表派生**（四张手抄表消失）。
  2. `'lab'` 作为一行登记（判据 = `state.labRuns` 里有 `active && worker === 'pilot'`；档 = **先警告再切**）。
  3. `startLabRun` 改传 `'lab'`（不再借 `'refine'`）。
  4. **活动栏**补一条实验室产线条目；`pilotUnavailableReason` / 船忙文案跟上。
  5. 用例：实验室占用期间启动其它主控活动 ⇒ 按档警告/停；AI 驱动的实验室线**不占主控**（反例）。
- **stage 2**：
  1. **两两互斥矩阵用例**（登记表里每一对 (A,B) 自动断言：停 A / 警告 / 拒 / A 自行结束，四者取一）。
  2. **契约护栏**（新工具或并进 `arch:guard`）：core 导出里所有 `start*` 主控入口必须调用
     `applyActivityGate`；`state` 上任何"占主控"的新字段必须在登记表里出现（对不上报红）。
  3. 接力入口（`startMiningFromExpedition` / `startExpeditionFromMining`）纳入契约。

## 四、每阶段闸门

`typecheck` · core 全量用例 · `content:check`（新文案 id 的契约）· `l10n:check` / `l10n:params` ·
`ui:rot-check`（活动栏改动）· `save:roundtrip-audit`（本条不新增存档字段 ⇒ 应无差异）。

## 五、stage 1 落地记录（2026-10-01）

**已落**（提交见 git 历史 · 闸门全绿：typecheck ✅ · core 全量 **2946 条全绿** ✅ · l10n:check ✅）：

| 落点 | 内容 |
|---|---|
| `activityGate.ts` | `MainActivityKind` 加 **`'lab'`**（类型即登记表源头：加一项 ⇒ 五张 `Record<MainActivityKind, …>` ＋用例的 `SETUP`/`STOPPED` 全部**编译不过**，逼着补全 —— 这就是"天然纳入"的机器实现）· `WARN_KINDS` 加 `'lab'`（**先警告再切**）· `INTERRUPTIBLE.lab=true` · `HALT_COST.lab='停线——当前那一批的进度丢弃'` · `HALT_COST_ID.lab='core.activity.017'` · `KIND_LABEL.lab='实验室'` · `ACTIVITY_LABEL_ID.lab='core.activity.018'` · `mainActivityOf` 加 lab 分支（判据 = `labRuns` 里 `active && worker==='pilot'`） |
| `lab.ts` | 起线门禁由借用的 `'refine'` 改成 **`'lab'`**（两档同为警告档 ⇒ 行为不变，占位与文案从此对得上） |
| `table.ts` | 新增 `core.activity.017`（停线代价）· `core.activity.018`（活动名「实验室」）中英 |
| 用例 | 新增 `tests/activity-lab-20261001.test.ts`（3 条：亲自运转占主控 · AI 驱动不占 · 分档/名称/代价齐备）**＋既有矩阵自动扩到 11×11**（`SETUP`/`STOPPED` 各加一行 `lab`，四条矩阵用例自动覆盖新档） |

**stage 1 还没做的一格**：**活动栏**（`activity.ts`）仍不显示实验室产线 —— 门禁已认它、界面还看不见。
（⇒ **2026-10-01 第二批已补**，见 §七。）

⚠ **这一格的现场评估（2026-10-01 续做时的结论，供下一轮直接开工）**：它不是"core 加一行"就完事的，
`activity.ts` 的条目要带 `kind`（`ActivityKind` 联合类型，UI 按它取图标）＋ `stop`（`ActivityStopKind`
→ desktop engine 的方法映射）⇒ 完整接入 = **① `ActivityKind` 加 `'lab'` ② UI 图标映射加一档
③ `ActivityStopKind` 加"停实验室线"＋ desktop engine 落一个方法 ④ 活动名词条（已备 `core.activity.018`）
⑤ `labRunViews` 若缺视图函数则先补**。⇒ 这是一小批 UI 活（含 `ui:rot-check` 与桌面构建），
**不半途开工**；本轮先把门禁侧落定（已绿）。（⑤ = 视图函数早已存在，第二批直接复用。）

**stage 2 仍待做**：契约护栏（`start*` 主控入口必调 `applyActivityGate`；`state` 新增占主控字段必进登记表）
＋ 接力入口（`startMiningFromExpedition` / `startExpeditionFromMining`）收口。
⚠ 护栏要避免"吵闹的判据"（本仓既有教训）：先以**读数档**（列出漏调入口）上线、确认误报为 0 再进阻断，
白名单要写明理由（`startScan` 不占主控 · `startTransitHome` 属锁定态 · `startBattleFor` 等非主控入口）。

**stage 2 仍待做**：契约护栏（`start*` 主控入口必调 `applyActivityGate`；`state` 新增占主控字段必进登记表）
＋ 接力入口（`startMiningFromExpedition` / `startExpeditionFromMining`）收口。

## 六、顺带落地的同批项

- **玩家点火的入侵结算声望固定 5 点**（船长 2026-10-01 令）：`weekendEvent.weekendStandingGainOf` 单点 ＋
  `beaconLit` 留痕 ＋ `save.ts` 白名单一行（零迁移）；`weekendBattle` 两处（写快照 / 实发）同源。
- 船长令「**不发公告**」⇒ 本条不进公告（实验室那条已推送，按"历史公告不回改"处理）。

## 七、stage 1 收尾 · 活动栏接入实验室产线（2026-10-01 第二批）

- **状态：已落**（闸门全绿：`typecheck` ✅ · core 全量 **2949 条** ✅ · `content:check` ✅ ·
  `l10n:check` / `l10n:params` ✅ · `arch:guard`（含 F5 跳转目标）✅ · `ui:rot-check` ✅ ·
  `save:roundtrip-audit` ✅（**不新增存档字段 ⇒ 零迁移**）· 桌面构建 ✅）。
- **为什么五件事一起改**（§五 的现场评估）：条目要带 `kind`（界面按它取图标）＋ `stop`（界面按它调引擎方法），
  少一格就是"门禁认它、界面看不见"。

| 落点 | 内容 |
|---|---|
| `core/activity.ts` | `ActivityKind` ＋ `'lab'` · `ActivityStopKind` ＋ `'stop-lab'` · `activityOverview` 新增实验室行（取数走 `labRunViews` 单点，不自己读 `state.labRuns`）· `shipBusyLabel` 补 lab 分支 |
| `core/ai.ts` | `aiCoreIndustryUsed` 补数实验室线（见下方船长裁定） |
| `apps/desktop/src/renderer/src/ui/aiSlots.tsx` | 占用分解加 `labUsed`（悬停模板同步，见下方裁定） |
| `core/busyLabels.ts` | 忙态档 `lab`（「亲自运转实验室中」· id `core.busy.030`——序号排表尾：id 一经使用不复用、不改名） |
| `core/wormhole.ts` | `shipActivityBusy` 补 lab 分支（与 `shipBusyLabel`、`activityGate.mainActivityOf` **三处同源**）＋ `ENTRY_STOP_META.lab`（进洞那一刻自动停线、`warn:false`）。⚠ 原先两处都漏 ⇒ **实验线在跑时主控照样能进洞**（经另一扇门的双占） |
| `core/lab.ts` | 手动工作位"再开一条 = 换线"时的停机**按实际在跑的档位**分别记日志（原先固定写「已自动停止『亲自开炉』」，停的却是实验线） |
| `data/l10n/table.ts` | `core.busy.030` · `ui.ActivityBar.068`（停止回执）· `ui.ActivityBar.069`（按钮悬停）中英；「**停线**」二字**复用**工业页那颗停止键的 `ui.hud.084`（同一件事一种说法，不另写一份同义短词） |
| 两套活动栏 | `panels/ActivityBar.tsx` / `ActivityBarClassic.tsx`：图标与精炼炉/制造线同一枚 `nav-industry`（见下方裁定）· 停止分派 `stop-lab → engine.stopLabRunAt(stopParam)` · 按钮悬停提示 |
| `panels/activityStopLabel.ts` | `stop-lab → ui.hud.084`（**两套外壳共用的单点**，只改这一处） |
| `ui/activityGo.ts` | `lab → 工业页`（与精炼炉/制造线同落点） |
| `game/engine.ts` | `startLabRunAt` 的两段确认 `key` 由 `'refine'` 改成 `'lab'`——它是**另一颗按钮**；原先共用 key ⇒ 在"起炉"的警告窗口内点"起线"会被当成二击、直接执行 |
| 用例 | `tests/activity-lab-20261001.test.ts` ＋3 条（真命令建现场：活动行与停线入口 · AI 驱动走同一套机制 · 忙态文案 id）；`tests/wormhole-activity-lock.test.ts` 的 `ACTIVITIES` 表加「实验室（亲自运转）」⇒ ① 忙态两边一致、①″ 进洞自动停 两组矩阵自动覆盖该档 |

**读数**（`npm run test -w @whale/core`）：**2949 条 / 278 个文件全绿**（本批 +3 条）。

### 船长裁定：实验室走"工业其他页面"同一套机制（2026-10-01）

> **船长原话（照抄）**：「**实验室和工业的其他页面没有本质区别，所以AI和活动栏图标都使用一样的机制**」
> （针对上面两条待裁决：① AI 驱动的实验室线在活动栏里不出现 ② `aiCoreIndustryUsed` 不数实验室线）。

**口径（现行）**：实验室**只是工业的又一条产线**，不另立一套显示/计数规则 ⇒ 与精炼炉/制造线**逐项同款**：

| 面 | 落地 |
|---|---|
| 活动栏图标 | `lab` 与 `refine` / `manufacture` **同一枚 `nav-industry`**（两套外壳都是；原先那枚 `ico-lab` 撤回，工业页自己的页签图标不动） |
| AI 驱动那条 | 与 AI 开炉/开线同一套：`kind: 'ai'` ＋ `aiGroup: 'industry'`（进「副AI活动」组）＋ `aiWorkKind: 'craft'`（六档动画里没有专门给实验室画一档，取"投料→出产物"的产线那一档）；**不占玩家活动位** |
| AI 核心占用 | `core/ai.ts` 的 `aiCoreIndustryUsed` **补数实验室线**（`active && worker !== 'pilot'`）⇒ ① 「副AI活动」徽标不再少算 ② `startLabRun` 的 `aiCoreCapBlock(…, 'industry')` **上限守得住**（改前能超上限起线） |
| 占用读数 | `ui/aiSlots.tsx` 的分解加 `labUsed`，悬停模板 `ui.aiSlots.004` 补「＋ 实验室 N 条」中英——`used` 与括号里那三项从此永远对得上 |
| 用例 | `tests/activity-lab-20261001.test.ts` 的第 2 条改写为"同一套机制"三连：进副AI组（`aiGroup`/`aiWorkKind`）· 计入 `aiCoreIndustryUsed` · **上限已满时拒起线** |

⚠ **行为面变化（如实登记）**：AI 核心上限从此**把实验室线算进去**——玩家不能再超上限起 AI 实验线。
存量超限（读档/技能变化）**不中断运行**（`aiCoreCapBlock` 既有口径），只是起不了新的。

**闸门（本裁定落地后复跑）**：`typecheck` ✅ · core 全量 **2949 条** ✅ · `content:check` ✅ ·
`l10n:check` / `l10n:params`（新槽 `labUsed` 已喂）✅ · `arch:guard` ✅ · `ui:rot-check` ✅ · 桌面构建 ✅。

**至此 §五 的"stage 1 还没做的一格"与两条待裁决全部收口**；stage 2（契约护栏，先做读数档）仍待做。



---

## 八、stage 2 落地：契约护栏（`arch:guard` F8）＋ 接力入口收口（2026-10-02 · 二号）

> 起因：船长 2026-10-02 追问「**活动切换那个你是否还没做**」——指的就是本节。
> stage 1 与活动栏接入早已落（§五 / §七），**唯一没动的是 stage 2**。

### 8.1 `arch:guard` 新增 **F8 · 主控活动切换契约**（`tools/arch-guard.ts`）

三条判据（全部按**源码文本**判：零依赖、与 F1~F7 同构；抓的是"整条缺失"，不抓"调了但参数写错"）：

| # | 判据 | 抓什么 |
|---|---|---|
| ⑴ | core 导出的 `start*` 入口（＋登记在册的非 `start` 命名入口）必须**直接**调 `applyActivityGate` / `gateMainActivity*`，或**沿委托链 ≤4 层**走到一个调了的 | 新入口忘了过门禁（＝实验室那次的病根） |
| ⑵ | 登记在册的入口**改名/删除即报红** | 逼一次人工复核，防"改了名就悄悄脱离护栏" |
| ⑶ | `MainActivityKind` 每档必须：能被 `mainActivityOf` **探测到** · 在 `AUTO_HALT_KINDS`/`WARN_KINDS` 里**恰好占一档** · 可中断的必须有 `haltActivityForSwitch` 的 `case` | 登记表 ↔ 探测器 ↔ 停机器 **三处口径不一致**（实验室那次正是这三处对不上） |

**白名单逐条写明理由**（船长条文）：
`startScan`（星图扫描 · 船长 2026-09-15 令「不占主控」）· `startTransitHome`（换港返航 = LOCKED 档）·
`startBattleFor` / `startFleetBattleFor`（开战入口 · 非主控活动，战斗中由 `cannotInterruptReason` 挡）。

**⚠ 刻度说明（如实登记）**：F8 读的是**源码文本**（不引 AST 解析器）⇒ 它管"这一整条路有没有过门禁"，
**不管**"传的档位名对不对"。后者由类型系统（`MainActivityKind`）与既有用例钉。

### 8.2 F8 上线即抓到两处真问题

| # | 抓到什么 | 处置 |
|---|---|---|
| ① | **`WARN_KINDS` 少登记两档**：注释与船长 2026-09-27 令都写着「亲自开炉 · 亲自开线也添加警告」，但表里只有 `hauling/expedition/deliver/lab` 四条 | 补 `refine` / `manufacturing`（**本表全仓无消费点** ⇒ 补登记**零行为变化**；`verdictOf` 的判据是"不在 `AUTO_HALT_KINDS` 里 ⇒ confirm/reject"，与档位天然等价） |
| ② | 我自己写探针时的括号 bug（类型注解 `MainActivityKind[]` 里的方括号被当成数组字面量 ⇒ 11 个档位全报"没登记"） | 改成**从 `=` 之后**找 `[` / `{`；这条也说明"第一次跑就报 11 处"要先怀疑判据本身 |

### 8.3 接力入口收口（stage 2 的另一半）

`startMiningFromExpedition` / `startExpeditionFromMining` **自己不过门禁**，而是**委托**给
`startMining` / `startExpedition`（那两条才调 `applyActivityGate`）——这是设计，不是漏洞。
收口 = ① **F8 跟委托链**（反例实测：摘掉 `startMining` 的门禁调用 ⇒ **连它一起报红两条**）
② 用例侧补**行为**证据（`tests/activity-gate.test.ts` 新增 3 条）：

| 用例 | 钉什么 |
|---|---|
| 接力入口 ①（→ 开采） | 运输占主控 ⇒ 回执是 `core.activityGate.002`（**先警告**档）、**一格不动** ⇒ 证明接力拿到的是标准裁决、没有旁路 |
| 接力入口 ②（→ 远征） | 驻留占主控（**直接切**档）⇒ 先停它、再出击，并写统一停机日志 `core.activityGate.001` |
| 登记表两档 | `AUTO_HALT_KINDS` ∩ `WARN_KINDS` = ∅ 且并集 = `KIND_LABEL` 的全部档位 |

⚠ **探针纠正过一版**：我原以为"运输占主控"走**直接切**档（该被静默停掉），探针打出的真实回执是
`core.activityGate.002` —— 运输属**先警告**档。用例据此改成"拿到警告、一格不动"，
这反而**比原写法更能证明没有旁路**。

### 8.4 反例实测（本仓纪律：每条判据都要证明它真能报红）

| 反例 | 结果 |
|---|---|
| 摘掉 `startMining` 里的 `applyActivityGate` 调用 | ❌ 报红 **2 处**：`startMining` ＋ **`startMiningFromExpedition`**（委托链被跟到） |
| 把 `haltActivityForSwitch` 的 `case 'lab'` 改名 | ❌ 报红：`档位 lab 可中断，但没有 case` |
| 两处都还原 | ✅ F8 = 0 处 |

### 8.5 验证

`typecheck` 四包全绿 · core 全量 **3004 条 / 285 文件全绿**（本批 +3）· `arch:guard` **F1~F8 全 0 处** ·
`content:check` · `l10n:check` · `l10n:params` 全绿。