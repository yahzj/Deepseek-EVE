# 入侵战利品落点与「报告 vs 实物」一致性（2026-09-26 · 一号 · main）

> 状态：**进行中**（甲已落地并自测全绿；乙＝旗舰"未击杀"报障的收口点待船长裁决，见 §5）
> 船长原话（照抄）：
> 1. 「**有玩家反应，其没有拿到黑匣，但是报告中显示有获取黑匣。**」
> 2. 「**可以按甲修改，同时有个玩家反应，他用无人机成功近乎满血击杀了入侵母舰，但是报告中显示他未击杀。**」

## 1. 病根（探针实测，不靠推理）

### 1.1 黑匣/残骸落点走偏（报障一）

| 事实 | 出处 |
| --- | --- |
| 旗舰结算走 `addItem`（= **当前驾驶船的货舱**） | `packages/core/src/weekendBattle.ts` 原 L608/610 |
| 「物品」页**只列仓库**、不列任何船的货舱 | `apps/desktop/src/renderer/src/panels/ItemsPage.tsx` L69（`Object.entries(state.warehouse.items)`） |
| 货舱 → 仓库**只有一个自动出口**（远征返航进港那一刻） | `packages/core/src/expedition.ts` L1239 `unloadCargoOfShipToWarehouse(state, state.shipId)` |
| 船损 = **连货舱一并删除** | `packages/core/src/shipyard.ts` L364-365 |
| 同 id 的黑匣从打捞回收那条路**本来就在仓库** | `packages/core/src/salvaging.ts` L546 `addWare(PLUG_BLACKBOX_ITEM_ID …)`，`plugs.ts` L152 同 id = `blackbox-h` |
| 设计稿口径一直是「**黑匣入库**」 | `docs/design/weekend-invasion.md` L149（Q4）/ L177 / L215 |

⇒ 玩家视角：击沉旗舰 ⇒ 战报/结算面板/结算信都说「战利品已入账（旗舰黑匣 ×1）」，但**物品页永远看不到**；
返航途中换船或那一场之后损船，实物就再也回不到仓库。船长上次报障「**入侵获得的黑匣在仓库内查看不到**」
（`docs/glossary.md` L987）是**同一个 bug 的另一半**——当时只加了「黑匣」分类，没修落点。

### 1.2 账实可分离（报障一 · 第二层）

| 事实 | 出处 |
| --- | --- |
| `weekendGrantRewards` **无条件**返回"想发的数量" | `weekendBattle.ts` 原 L611（`blackBox: reward.blackBox ? 1 : 0`） |
| `addItem` 在"驾驶船不在舰队里"时**静默丢弃**（`cargoOfShip` 返回临时 `{}`） | `inventory.ts` 原 L64 + L78-85 |
| 台账却照记「已获得」 | `weekendBattle.ts` L837/859（原用 `r.flagshipKilled`，不用 `granted`） |
| 「见过黑匣」在丢弃后**照样置位** | `inventory.ts` 原 L84（写在写入之后、无条件执行） |

⇒ 「报告说拿到了、手里没有」是必然结果，不只是玩家没找对地方。

### 1.3 旗舰"报告显示未击杀"（报障二 · 探针已实证两条洞）

探针（真实引擎路径：`weekendStartFlagshipBattle` + 逐波清场 + `advanceEncounterWatch`）读数：

| 场景 | battle.ended | 台账 rawDmg | `ev.flagshipHpDone` | `ev.flagshipDown` | 黑匣 |
| --- | --- | --- | --- | --- | --- |
| S1 引擎推进那一拍分出胜负（正常） | `me` | 150,000 | 150,000 | `player` | **1 个** ✓ |
| S2 `battle.ended` 在引擎看到之前就已置位 | `me` | 150,000 | **0** | **undefined** | **0** ✗ |
| S3 活动窗口先关（报告已写）再打完 | `me` | 150,000 | **0** | **undefined** | **0** ✗ |

- **S2 = 真 bug**：`encounters.ts` L710-713 那条「战斗已结束」支路**只调 `settleFight` 就 return**，
  漏了 L744 那支里才有的 `weekendApplyBattleOutcome` ⇒ 击沉母舰的那一场**完全不结算**
  （伤害不记、进度不给、黑匣不发、报告里那艘母舰永远是「未击沉」）。
- **S3 = 船长 2026-09-25 已定的口径没落实**：`weekendFlagshipEncounterOf` 的注释写着
  「判据**不含**"活动是否已结束"：入侵结束那一刻若玩家正打得兴起，这一场照常打完」，
  但 `weekendResolveBattle` L231 与 `weekendNoteFlagshipKilled`（`weekendEvent.ts` L1256）
  都在 `endedAtWallMs` 已写时**直接拒收** ⇒ 窗口关在战斗中途 / 章鱼人先得手（池子下限 1 仍可开战）时，
  玩家真把母舰打爆也**一分不算**，报告停在「未击沉」。
- 另有一处无害但值得收口的写法：`flagshipRunId` 用 `battle.startedAtGameMs` 当幂等键，
  同一游戏毫秒内两次开战（撤退后立刻再进）会撞键 ⇒ 第二场伤害被吞。

## 2. 本批已改（船长批「甲」）

| 文件 | 改动 |
| --- | --- |
| `packages/core/src/weekendBattle.ts` | 黑匣与旗舰稀有残骸**改走 `addWare`（入物品仓库）**；返回值 = **实际入账量**；台账/日志/结算信一律按实发记账；无法解析残骸物品 id ⇒ 不发也不记账 ＋ 一条 `core.weekend.038` warn；击沉日志改说「**已存入物品仓库**」 |
| `packages/core/src/weekendSettleAndGrant` 同文件 | 章鱼人那一档的补发也取实际结果（`boxGranted`），台账跟实发走 |
| `packages/core/src/inventory.ts` | `addItem`/`addWare` **返回 boolean**；`addItem` 在"当前驾驶船不在舰队里/货舱冻结"时**兜底入仓库**（不再静默丢弃）；「见过黑匣」只在确实入库后置位 |
| `packages/core/src/weekendComms.ts` | 结算信正文补「（实物奖励已存入物品仓库）」 |
| `apps/desktop/src/renderer/src/panels/WeekendSummary.tsx` | 结算面板：黑匣格 sub = 「已存入物品仓库」；残骸格 sub = `<物品名> · 已存入物品仓库` |
| `packages/data/src/l10n/table.ts` | `core.weekend.003/.016` 改「已存入物品仓库」；`core.weekend.014` 补落点；新增 `core.weekend.038`、`ui.weekend.114` |
| 测试 | 新增 `packages/core/tests/weekend-spoils-warehouse-20260926.test.ts`（4 条：兜底入库 · 兜底不影响正常货舱路径 · 实发=记账 · 快照=仓库实数）；`weekend-battle.test.ts` 与 `weekend-wiring-20260925.test.ts` 的落点断言改成**仓库**（并加"货舱不动"） |

**不做**：普通悬赏/打捞战利品的「货舱 → 返航自动卸货」是既定设计，本批不动；
「物品」页依旧不显示任何船的货舱内容（既有设计，要改另起一批）。

## 3. 验证

- `npm run test -w @whale/core`：238 文件 / 2598 用例全绿（含新增 4 条）。
- `npm run typecheck`：core / data / ui / desktop 全绿。
- `npm run content:check` ✅ · `npm run l10n:check` ✅ · `npm run ui:rot-check` ✅。
- 探针（§1.3 的表）为临时文件，读数取完即删。

## 4. 待裁决点（报障二）

请船长裁两条（都是口径问题，不是纯 bug）：

1. **打完在窗口关之后的场次算不算？** 按 2026-09-25 那条注释的字面（「这一场照常打完」）应当**算**：
   伤害照记、击沉照判、黑匣与残骸照发，并**刷新结算快照**（面板从「未击沉」改成「已击沉」）。
   代价：结算信已经投递出去了（信里的「未击沉」不会自己变），要么补一封、要么接受"信是当时的记录"。
2. **章鱼人已经得手之后还能不能开战？** 现状：血条下限 1 ⇒ 入口照样放人进去打一艘 1 点血的母舰，
   打完什么都不给（报告「未击沉」）——这正是船长上次「0% 血进入旗舰战」那一例的形状。
   建议：**母舰已被摧毁（`flagshipDown` 已写）时关闭旗舰战入口**，并给一句说明。

另：`encounters.ts` L710-713 那条支路漏结算（S2）属纯 bug，**不需裁决即可修**（与 L744 合并成同一套收口）。

