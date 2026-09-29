# 入侵期悬赏照常 ＋ 取消遇袭抢信用点（2026-09-28）

- **状态：已实现（自测全绿，待船长验收）**
- **船长原话（照抄）**：
  1. 「**入侵期间，赏金任务照常发放（只有势力活跃关闭）。**」
  2. 「**取消遇袭事件中的抢劫信用点。**」

## 一、入侵期间：悬赏照常发放（只关"势力活跃"）

### 撤销的是哪一条
**船长 2026-09-25 令**（原话）：「**入侵期间，被占领星系的所有被收复的星系的常驻悬赏依旧处于隐藏状态，
要等到入侵活动结束。**」——当时为它加了单点判据 `weekendStandingBountyHeldAt`（界面侧据此整区藏卡），
并在 `docs/design/weekend-invasion.md` 的定稿 #3 / ⑨ 连带两处记了改判。

**2026-09-28 船长令**把这条**整条撤销**（`docs/design/weekend-invasion.md` 两处已改写为"作废"，
不让两套口径并存）。删除面：
- `packages/core/src/weekendBounty.ts`：删 `weekendStandingBountyHeldAt`（留下沿革注）；
- `packages/core/src/index.ts`：删导出（并注明别再复活）；
- `apps/desktop/.../panels/Expedition.tsx`：删**两处**调用 —— 板面那条过滤（`listed`）与星系详细页的
  `bountyHeldHere`（含它驱动的"悬赏（0）"计数分支、状态占位那一行）；
- `packages/data/src/l10n/table.ts`：删状态占位文案 `ui.weekend.100`（「已收复 · 常驻悬赏待入侵结束后恢复」）；
- `packages/core/tests/weekend-bounty.test.ts`：那条用例改成"收复后照常列悬赏 ＋ 押后判据已从导出面删除"的护栏。

### ⚠ 没动的两件事（船长只说了"赏金任务照常发放"，这两条是入侵设计的骨架）
1. **仍被占**的星系照旧由**入侵舰队卡**替换（`weekendBountyCardsOf`，2026-09-23 设计口径）：
   收复后才回到该星系的**原卡**；
2. 入侵舰队卡**照旧不给赏金**（2026-09-25「入侵舰队不应该有赏金」，收入在活动结束时按进度结算）。

### 「势力活跃」照旧关闭（船长点名保留）
`sideTasks.factionSuppressedByInvasion`（**船长 2026-09-25 令**「建议当出现入侵时，关闭敌方势力活跃。」）
**一字未改**：入侵进行中 ⇒ 派系活跃整体停摆（星图 ✦ 标记、任务中心那条置顶卡、悬赏卡 ×1.1、
稀有残骸掷骰与保底计数全部静默），活动结束自动恢复。被占星系从派系活跃候选让位那条也不变。

## 二、取消遇袭抢信用点

- **落点** = 低安遇袭的**文字结算**「被抢」档（`encounters.ts` 的 `resolveTextual`）。原口径：
  「至多抢 30% 船上货；**无货可抢就改抢钱包**（至多 5% 信用点）」。
- **删除面**：
  - `const takenIsk = …` 那一行与 `state.wallet.isk -= takenIsk`（**钱包不再被扣**）；
  - 文案「抢走 {X} 信用点」那一支：现在**空货仓遇袭 = 一无所获**（「一无所获的劫匪悻悻离去」照旧保留）；
  - 旋钮 `balance.encounter.iskTakenMaxPct` 与类型字段 `types.ts` 的 `iskTakenMaxPct`（**死配置一律清掉**，
    免得日后有人照着它"补回功能"）。
- **没动**：货物那一支照旧（`lootTakenMaxPct = 0.3`）；「受损」档照旧；迎战那条路本来就不抢信用点。
- ⚠ **技能说明跟着改**（`低安生存学` 原先写"货与现金同享"，现在只剩货）：
  - `packages/data/src/skills.ts`：中文说明 → 「危险星域的保命之道：低安被抢的**货物**损失上限每级
    −⟦12%⟧（满级 −⟦60%⟧）。」
  - `packages/data/src/l10n.ts`（`EN_SKILLS`）→ `−⟦12%⟧ cap on cargo seized in Low-sec per level
    (max −⟦60%⟧)`；**⟦⟧ 对数与中文保持一致**（各 2 对），数值一字未改。
- ⚠ **随机序列**：删掉的 `nextRandom(...)` 会使该档之后的随机消耗少一次 ⇒ 后续掷骰序列整体前移一位
  （行为变化，符合预期；全量 2789 条用例复跑无红）。

## 三、闸门
`npm run typecheck` ✅ · `npm run test -w @whale/core` **262 文件 / 2789 用例**全绿 ·
`content:check` ✅ · `l10n:check` ✅ · `ui:rot-check` ✅（动了 `Expedition.tsx`）· `skill:audit` ✅。

## 四、待确认（本批没做，等船长一句话）
1. **只清缴不碰 BOSS 的档位封顶**（上一批 60/40 权重的后果，封顶 C 档）——见
   `docs/design/weekend-blackbox-payout-20260928.md` §三；
2. 旗舰**稀有残骸 ×3** 的历史补发（同文件第一批 ②）。
