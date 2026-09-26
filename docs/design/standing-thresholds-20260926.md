# 所有声望门槛改读「累计获得」那一本账（2026-09-26 · 二号 · d2）

状态：**已实现 · 待船长验收**（本地产物已重建，需重启游戏）。归档按 AGENTS.md §8。

## 船长原话（照抄）

> 「修改原先的所有声望门槛，改为根据玩家的累计声望」

前序裁定（本批是它的收口）：「**找章鱼人用声望兑换，玩家完成入侵后根据贡献获得一定量声望。旧的声望
门槛改为计算玩家获得的累计声望。**」＋「**声望真扣（就是意味着玩家一开始其实可以买5张），其他所有的
声望门槛都改为看获得了多少声望总数。**」

## 一、两条账的定义（不变）

| 账 | 字段 | 语义 | 谁读它 |
| --- | --- | --- | --- |
| **累计获得** | `state.standingsEarned` | 只增不减 | **一切门槛**（唯一入口 `expedition.standingOf`） |
| **可支配** | `state.standings` | 兑换会扣 | 只回答"还换得起几张图纸"（`spendableStandingOf`） |

声望只从两处进账，且**两条账同时加**（`noteStandingEarned`）：远征/悬赏卡 `anomaly.standingGain` ·
入侵结算按贡献占比（`weekendBattle`）。扣账只有一处：「章鱼人兑换」`spendStanding`。

## 二、本批改到的门槛（改前直读可支配那本 ⇒ 现全部走累计）

| # | 门槛 | 位置 | 改前后果 |
| --- | --- | --- | --- |
| ① | 虫洞扫描解锁（协会累计 ≥ 40） | `core/wormholeScan.ts` `wormholeScanStanding` | 换过图纸 ⇒ **已解锁的虫洞被锁回去**（扫描页、组装机虫洞图纸闸一起变） |
| ② | 商品购买门槛 `standingReq` | `core/market.ts` `goodLockedReason` | 界面按可支配判、命令按累计判 ⇒ "星图说锁着、点下去却能开工"的错位 |
| ③ | 暗市闸 `bmStanding` | `core/market.ts` `bmGateLocked` / `bmGateReason` | 同上 |
| ④ | 卖价声望加成（+1%/点，封顶 +15%） | `core/market.ts` `sellStandingMult` | 兑换会把卖出加成打回去（消费不该等于退步） |
| ⑤ | 周末入侵门槛（≥ 40） | `core/weekendEvent.ts` `weekendInvasionAllowedFor` | 换过图纸 ⇒ 入侵开不了新场 |
| ⑥ | 通讯 `standing` 触发器 | `core/comms.ts` | 已解锁的解锁信会被"重新锁上"（不再送达） |
| ⑦ | 矿带锁定（星图页卡片 / 舰船页 AI 执勤下拉） | `pages/MapPage.tsx` · `pages/ShipPage.tsx` | 与 `mining.ts` 命令侧闸不同源（命令侧改前就在读累计） |
| ⑧ | 组装机「去虫洞」图纸闸 | `panels/Industry.tsx` | 同 ① |

**改前就在读累计、本批未动的**：矿带命令侧闸（`mining.ts`）· 悬赏接取门槛与奖金系数（`expedition` / `ai.ts`）
· 精炼炉声望增益（`industry.ts`）· 首任务链的协会读数（`firstTasks.ts`）。
**只有兑换读可支配**（`plugs.ts` 的造价与扣账）——这是"真扣"的唯一落点，不动。

### 顺带两处一致性修补

- `pages/*` 三处改为调 **core 唯一入口** `standingOf` / `wormholeScanStanding`，页面不再直读账本字段
  （`ShipPage` 原来的本地小助手 `standingOfState` 改为转发入口）。
- `game/autoPerf.ts`（性能自动采集用的开发开关）原先只抬可支配那本 ⇒ 改为两条账一起抬，
  否则采集跑起来会因门槛读累计而看不到该看到的界面。

## 三、涉及文件

- core：`market.ts`（4 处 + 注释）· `wormholeScan.ts` · `weekendEvent.ts`（本地取数改累计，仍不 import
  `expedition`——那是既有的防环写法）· `comms.ts`（同款本地取数）。
- 界面：`pages/MapPage.tsx` · `pages/ShipPage.tsx` · `panels/Industry.tsx` · `game/autoPerf.ts`。
- 测试：新增 `packages/core/tests/standing-thresholds.test.ts`（**11 例**）。

## 四、验证

- `npm run typecheck` 四包 0 错 · `npm run test -w @whale/core` **236 文件 / 2588 用例全绿**（新增 11 例）。
- **新增用例逐条钉住上表七类门槛**：累计达标即可、可支配再高也不算；反面 = 累计不足即可支配 999 也照锁；
  卖价加成只认累计（只抬累计 ⇒ ×1.15，只抬可支配 ⇒ 一分不加）；老档缺 `standingsEarned` 时回退读旧值。
- **护栏反向验证**：把 `goodLockedReason` 改回读 `state.standings` ⇒ 2 例当场转红，改回即绿。
- `content:check` ✅ · `l10n:check` ✅ · `ui:rot-check` ✅ · `build` ✅。

## 五、待裁决 / 已知取舍

1. **卖价声望加成（④）算不算"门槛"**：它不是拦人的闸，是"声望练到多少"的收益。按"一切声望读数取累计"
   一并改了——若认为它该跟可支配走，说一声即可单独回退。
2. **界面文案里的"当前声望"现在一律是累计值**（商品/暗市/矿带三条锁的文案都直接报这个数）；
   兑换窗口照旧同时显示「可支配 X · 累计获得 Y」。若要改成"当前累计 X"之类更明确的措辞，另开文案批。
3. **老档迁移**：`save.normalizeState` 早已把 `standingsEarned` 回填为 `max(40, 旧可支配值)`
   ⇒ 存量档按"累计 = 可支配"起步，本批不改变任何老档的既有解锁状态。
4. 测试存档生成器（`tools/make-test-save.ts`）里那几行"声望升至 N"**改前已是空操作**
   （新档初始 40 已 ≥ N）⇒ 本批未动它们，也未改任何测试档。
