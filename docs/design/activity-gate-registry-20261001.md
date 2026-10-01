# 主控活动登记表（实验室漏登记）· 2026-10-01

> **状态**：**进行中 —— 只做完普查与设计，尚未动码**
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

⚠ **这一格的现场评估（2026-10-01 续做时的结论，供下一轮直接开工）**：它不是"core 加一行"就完事的，
`activity.ts` 的条目要带 `kind`（`ActivityKind` 联合类型，UI 按它取图标）＋ `stop`（`ActivityStopKind`
→ desktop engine 的方法映射）⇒ 完整接入 = **① `ActivityKind` 加 `'lab'` ② UI 图标映射加一档
③ `ActivityStopKind` 加"停实验室线"＋ desktop engine 落一个方法 ④ 活动名词条（已备 `core.activity.018`）
⑤ `labRunViews` 若缺视图函数则先补**。⇒ 这是一小批 UI 活（含 `ui:rot-check` 与桌面构建），
**不半途开工**；本轮先把门禁侧落定（已绿）。

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
