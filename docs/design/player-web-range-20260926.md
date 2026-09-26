# 我方捕获网：距离上限 4000 米 ＋ 减速降为 50%（2026-09-26）

状态：**已实现 · 待船长验收**

## 船长原话（照抄）

1. 「**玩家方的捕获网，有距离限制，距离超过4000米就会断开，且减速效果降低为50%。**」
2. 「**我方的捕获网是独立数据吗？应该不会和敌方捕获网联动吧？**」（同批提问）

## 口径（两条改动，逐字落码）

| # | 项 | 改前 | 改后 |
|---|---|---|---|
| ① | 减速效果 | 机动 **×0.1**（减速 90%） | 机动 **×0.5**（减速 **50%**） |
| ② | 距离 | 无上限 | **交战距离 > 4000 米即断开**；离得远时也不重新张网 |

- 单点常量：`packages/core/src/combat.ts` 的 **`MY_WEB_BREAK_DIST_M = 4_000`**（带船长原话注释）。
- 断开**不算"用掉"**：`cooldownUntilMs` 保持在过去（不空转 20 秒冷却），但同拍/后续拍只要距离仍 > 4000 米
  就拒绝重新张网（否则会"张开 → 立刻断"刷日志）；距离回到 **≤ 4000 米**（含边界值）立刻复网。
- 「目标被击沉 ⇒ 进冷却」那条**不变**（仍是 `now + 周期`）；两条断开原因各写各的日志。
- 判据用的是每拍更新的**交战距离 `b.distanceM`**（`stepBattle` 内既有标量，无新增状态字段）。
- 效果仍是**三层**（机动 ×0.5 · 推进器全关 · 闪避归零），**不含"武器射程下降"**（船长 2026-09-26 前令）。

## 敌我两套捕获网是否联动？（答船长第 2 问）

**不联动，是两套完全独立的数据与状态。** 证据：

| | 我方「墨潮捕获网」 | 敌方「劫掠捕获网」 |
|---|---|---|
| 数据来源 | `packages/data/src/modules.ts` 的 `ModuleDef.captureWebCycleMs`（`mod-lair-web-h`，周期 20 秒 / CPU 44 / 高槽） | `packages/core/src/foeMounts.ts` 的 `FoeMountDef.web`（`foe-mount-capture-web`，A 族劫掠电子舰件） |
| 效果参数 | 机动 ×0.5 · 关推进器 · 闪避归零（**无射程削减**） | 机动 ×0.1（减速 90%）· 关推进器 · 闪避归零 · **射程 −500 米** |
| 触发 | 我方周期装置开战即张网 | 敌方**自身第一次开火**时发动 |
| 运行时账本 | `BattleState.myWebs`（我方携带者周期账本）＋ `BattleState.foeWebDebuffs`（我钉在敌舰上的减益） | `BattleState.meWebDebuffs`（敌网钉在我方舰上的减益） |
| 施加器 | `applyFoeWebDebuff` | `applyMeWebDebuff`（多一层 `rangeDownM`） |

三个字段在存档里是**三个独立键**（`save.ts`）；两套各自有解除逻辑（`advanceMyCaptureWebs` / `expireFoeWebs`）；
本次新增的 `MY_WEB_BREAK_DIST_M` **只出现在我方那条路径**（`combat.ts` 四处 ＋ `types.ts` 注释 ＋ 测试）。
唯一"像"的地方是演出：两边都用 `web: true` 的蓝色连线（船长 2026-09-16 定的同一款光效）——**只是画面同款，数值与状态零耦合**。

## 改动文件

- `packages/core/src/combat.ts`：新增 `MY_WEB_BREAK_DIST_M`；`slowMul` 0.1 → 0.5；新增 ②b 超距断开段；
  ③ 张网闸门加距离条件；两处注释与日志文案更新（「机动骤降」→「机动减半」）。
- `packages/core/src/types.ts`：`ModuleDef.captureWebCycleMs` 与 `UnitSpec.myCaptureWeb` 的注释同步新口径。
- `packages/data/src/modules.ts` ＋ `packages/data/src/l10n.ts`：`mod-lair-web-h` 中英说明改为
  「机动 ×0.5 …；与目标距离超过 4000 米即断开」（英文 `speed ×0.5 … snaps if the range exceeds 4,000 m`）。
- `packages/core/tests/ink-gear-20260926.test.ts`：新增 3 条用例 ＋ 2 处旧断言更新（详见下）。

## 验证

- `packages/core/tests/ink-gear-20260926.test.ts` **17 用例全过**，新增：
  ① 「距离上限 4000 米」——范围内正常张网 → 拉到 4001 米断开（清目标＋清减益＋写日志＋**不进冷却**）
  → 仍在超距时**拒绝重张且不刷日志** → 回到 4000 米（边界含）立刻复网；
  ② 三层效果实测：`slowMul === 0.5` 且 `speedMps === max(20, 原速 × 0.5)`；
  ③ 文案契约：中英说明都写 ×0.5 / 4000 米，且不再出现旧值 ×0.1、90%。
- `npm run typecheck` ✅（core / data / ui / desktop） · `npm run test -w @whale/core` ✅ **233 文件 / 2550 用例** ·
  `content:check` ✅ · `l10n:check` ✅。

## 已知取舍（请船长过目）

1. **开战距离常常 > 4000 米** ⇒ 按本令直译，捕获网**不再是"开战即钉"**：开战距离 = 双方最远武器射程
   ×1.0 ＋ max(100 米, 射程×10%)（`balance.battle.openRangeFactor/openRangePadShare`）——近战卡约 3,850 米（照旧开战即钉），
   而**射程 5,000 米以上的卡开场 5,500 米外**、导弹卡可达 13,000 米 ⇒ 网要等距离压进 4000 米才张开。
   若你要的是"开战即钉、只在被打断后受距离限制"，把上限提到"开战距离"或改成"随开战距离走"即可，等你一句话。
2. 超距断开**不消耗冷却**（可立刻复网）；若你希望"断开也当作一次使用、断开即进 20 秒冷却"，也是一句话的事。
