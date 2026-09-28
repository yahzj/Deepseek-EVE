# 旗舰黑匣 · 线上补发工具 ＋ 归属代码整理审计（2026-09-28）

- **状态：已收口（待推送）** —— 补发工具已实现并通过闸门；审计清单经船长 2026-09-28 裁「**按你推荐来**」
  ⇒ ①走甲案（台账落盘）**已实现** · D/E 只改注释**已实现** · ②旗舰残骸 **不补**（理由见下）。
- **船长原话（照抄）**：
  1. 「**不需要给本地存档补发，采用工具线上补发。**」
  2. 「**还有，整理下代码，查看是否有多余代码或者重复功能代码，因为这一段已经反复改过很多次了。**」
- **前情**：2026-09-28 玩家报障「打完入侵母舰没收到黑匣」（真档读数：旗舰输出 139,829 / 150,000 = **93.22%**、
  有 `flagshipPlayerKill` 留档、却 `flagshipBlackBox = false`）。根因 = `weekendClaimOctopus` 写死传
  `lastHitByPlayer = false` 先掷了一次并把结果固化 ⇒ 判据修在 `baec2cc8`（单一判据 `weekendLastHitByPlayer`）。
  本文件记的是**第二部分**：把"已经漏发的场次"补回来的工具，以及对这段代码的整理审计。

## 一、补发工具（本批实现）

- **落点**：`packages/core/src/weekendComms.ts` → `reconcileWeekendBlackBox(state)`，
  接在 `packages/core/src/engine.ts` 的逐 tick（与既有 `reconcile*` 系列同款，读档后第一拍即生效）；
  日志文案 `core.weekend.039`（zh ＋ en，`packages/data/src/l10n/table.ts`）。
- **判据**（船长记录在案的规则：「输出超过50%血量，完成最后击杀，就给黑匣」）——五条全过才补：
  1. **有留档**：`weekendLastHitByPlayer(ev)`（**唯一判据**，与掷骰、结算同源）；
  2. **占比 > 50%**：这一档 `weekendBlackBoxChanceOf` ＝ **1（必爆）**；
  3. **本场已结束**：进行中的走正常掷骰路径，不抢发；
  4. **本场没按这个口径结过账**：`flagshipBlackBoxByPlayer !== true`
     （章鱼人先掷的那次记的是 `false` 情境 ⇒ 不构成"已结账"）；
  5. **本场至今没有黑匣落地**：`flagshipBlackBox !== true` ∧ 台账 `rewardLedger.blackBox === 0`。
- **幂等**靠动作本身：补了就写死标记 ⇒ 第二次直接返回；落点 = 物品仓库 ＋ 系统日志（**不发信**，与 09-26 补偿同口径）。
- **与 09-26 那次一次性补偿（`compensateMissingWeekendBlackBox`）按时间划界**：以
  `WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS`（09-27 08:24）为界 —— **之前的归补偿、之后的归本工具**。
  理由：那次补偿判据更宽、且付钱时**不写场次记录**，本工具看不出它付过 ⇒ 不划界会**双发**。
  两边注释互相指名，用例 `weekend-blackbox-reconcile-20260928.test.ts` ⑥ 钉死这条边界。
- **战果快照只补 `blackBox` 那一栏**（不整张重建：重建会把贡献占比、进度收入按"现在的 state"重算，凭空改写历史读数）。

### 真档验证（只读，未写回）
- 现在的真档**已经是治好态**（`flagshipBlackBox = true` · `ByPlayer = true` · 仓库黑匣 ×1 · 快照 ×1），
  与 09-28 早些时候取证到的 `false` / 仓库无黑匣不同 ⇒ **是在这期间被治好的**；
  最可能是他本地那个构建里还带着已撤除的补发工具（撤除提交 `d7735868` 只在本地、未推送）⇒ 建议重建重启。
- 把该档**在内存里回拨到报障那一刻**（`false` / `false` / 删掉黑匣）再跑：**命中 ⇒ 补 1 枚**，
  快照 +1、日志带上输出占比 93%，再跑一次不补。
- 对照组：现档（已治好）跑本工具 ⇒ **不补**、幂等 ✅。

## 二、整理审计（**待裁决，未动**）

| # | 发现 | 证据 | 建议 |
|---|---|---|---|
| A | **两台"补发黑匣"入口** | `weekendComms.compensateMissingWeekendBlackBox`（09-26 一次性补偿）· 本批 `reconcileWeekendBlackBox` | 两条判据源自**两条船长令**，不合并；边界已写进两边注释 ＋ 用例钉死（本批已做） |
| B | **到手台账 `rewardLedger` 不落盘** | `save.ts` 内 `rewardLedger` **0 引用**；`weekendEvent` 清洗器返回体只有 `reclaimPaid` / `reclaimPending`；真档实测 `rewardLedger = undefined` 而快照 `blackBox = 1` | **已办（甲案 ⇒ 随档，见下①）** |
| C | **同一条事实三处各读一遍** | `weekendBattle.ts:400` `blackBoxToPlayer`（结算计划）· `:650` `boxAtSettle`（迟到发放）· `apps/desktop/.../engine.ts:1191`（结束文案） | 三处**语义不同**（掷骰结果 / 未发放标记 / 显示），不建议并；本次只核对，不动 |
| D | **两处注释与代码不符** | `weekendBattle.ts:523` 与 `weekendEvent.ts:555` 都写「`defeated` ＝ `flagshipDown === 'player'`」，而代码 `weekendBattle.ts:542` 读的是 `flagshipOutcome === 'player'`（**代码对、注释旧**） | **已办**：只改注释（零行为变化） |
| E | **一处注释与代码矛盾** | `save.ts:3315` 写 `flagshipBlackBoxByPlayer`「不随档」，而 `:3316-3318` **确实落盘** | **已办**：只改注释（零行为变化） |
| F | `weekendFlagshipRemainingOf` | `src` / `tests` / `apps` 全仓 **0 定义 0 引用** | **已不存在**，无需处理（roadmap 那条可结） |

### ① 已裁决「按你推荐来」⇒ **甲案：台账随档**（已实现）
- 实现 = `save.ts` 清洗器加 `rewardLedger`（三格走 `weekendKeep`、`byGalaxy` 逐项清洗、**缺键不写** ⇒ 老档零迁移）。
- **双发是实测复现过的，不是理论风险**：把落盘那一行临时摘掉 ⇒ 用例⑥ 立刻红在
  `结算不再补发第二枚: expected 2 to be 1`（＝结算照着"台账里没有黑匣 ∧ 掷骰掷中了"又补了一枚）。
- 回归用例 = `weekend-spoils-warehouse-20260926.test.ts` 的 ⑤（往返）与 ⑥（读档后结算不再双发）。
- **本批的补发工具不受这条影响**：它另有 `flagshipBlackBox` / `flagshipBlackBoxByPlayer` 两个**会落盘**的标记兜底。

### ② 已裁决「按你推荐来」⇒ **不补**旗舰稀有残骸 ×3
- **它确实没发（算得出来）**：报障那一场快照 `wreck = 240 m³` ＝ B 档贡献奖 8 件 × `RARE_WRECK_VOLUME_M3(30)`
  **正好**，旗舰那 `WEEKEND_FLAGSHIP_WRECK = 3` 件（90 m³）不在里面。
- **但"谁发过、谁没发"判不出来**（这才是不补的硬理由，不是图省事）：旗舰那 3 件只在
  `weekendResolveBattle` 的击沉分支里、与黑匣**同一次** `weekendGrantRewards` 发出，该分支同时把
  `flagshipBlackBoxByPlayer` 置 `true`；而**修复前**章鱼人那条路写死传 `false`
  （`git show baec2cc8` 里就是 `- weekendRollBlackBox(state, ev, false)`），配上"**同情境才幂等**"的判据
  （`weekendEvent.ts:104`）⇒ 玩家情境为 `true` 时会被**重掷、并把这一格改写回 `false`**。
  ⇒「`ByPlayer === false`」既可能是"当初根本没发"，也可能是"发过了、后来被章鱼人那次重掷改写"，
  **两种情形在现有随档字段里长得一模一样**；照它补就会给后者**多发 90 m³**。
- 要真做，得**在发放点写一个随档标记**（＝改掉落管线，不是加一个补发工具）——是否要做**另行请示**；
  本批按"**宁可少给一次，也不发错**"处理。

## 三、闸门（本批两次提交合并计）
`npm run typecheck` ✅ · `npm run test -w @whale/core` **262 文件 / 2786 用例**全绿（本批新增 11 例）·
`content:check` ✅ · `l10n:check` ✅ · `l10n:params` ✅ · `ui:rot-check` ✅ · `save:migrate`（只读）**105/105 通过** ✅。

## 四、不做（本批范围外）
- 不给本地存档补发（船长明示）；
- 不补旗舰**稀有残骸 ×3**（理由见 ②，要做需先改掉落管线 ⇒ 另行请示）；
- C 那三处"同一事实各读一遍"**不合并**（语义不同，见上表）。
