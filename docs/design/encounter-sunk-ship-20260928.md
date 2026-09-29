# 旗舰战沉船被撤退"复活"（2026-09-28 玩家报障）

- **状态：已修复（自测全绿，待船长验收）**
- **玩家报障原话（船长转述）**：「**玩家在入侵的旗舰战中沉船后撤退，沉船会被复活带出并且能够修理，
  这是BUG**」

## 一、根因：遭遇战这一"战斗宿主"漏了沉船判定

旗舰战是**编队战**、**承载在遭遇槽**（`state.encounter.battle`，见 `weekendLaunch` 的"战斗宿主"注），
撤退走 `retreatEncounterBattle` → `settleEscape`。而**遭遇战的收场路径只落盘承伤、从不判沉船**：

- `persistFleetHullDamage`（`combat.ts`）如实写出 `durability = 0` —— 这一步没错；
- 但**全仓没有任何一处把"0% 结构"当"已沉"**（只有 `< 0.5` 的自动修理/返港判据）
  ⇒ 那艘船以「活着但残血」被带回港，**花钱就能修好** ✓ 正是玩家看到的"复活 + 能修理"。

**判定它不是设计而是漏洞的依据**：设计稿 `docs/design/weekend-invasion.md` 第 243 行要求三个战斗宿主
（远征 / 虫洞 / **遭遇槽（旗舰战）**）在「**逐舰承伤与机群战损**」上**同口径**；虫洞那条路是
**判沉船并 `loseShip`**（`wormholeBattle.settleWormholeBattle` 的 `sunkShipIds`），**只有遭遇战漏了这一环**。

## 二、修法（三处改动，判据收口成一个单点）

1. **判据收口**：新增 `combat.sunkShipIdsOfBattle(battle, fallbackShipId?)`（我方单位三层血合计 ≤ 0；
   多舰走 `myFleet` 的 tag→shipId，**单船场次回落 `units['player']`**）。
   ⚠ 这条判据原先有**两份**（`wormholeBattle.sunkShipIds` 与 `captureBattleReport` 的推导），
   而战报注释早就写着"与 `wormholeBattle.sunkShipIds` 同一判据" ⇒ 现在**虫洞 / 遭遇战 / 战报三处共用**，
   虫洞那份私有实现删除。
2. **落点两处**（`encounters.ts`）：`settleEscape`（**撤退 / 自动脱离**）与 `settleFight`（**分胜负**）
   各调一次 `loseSunkShipsOfBattle(...)` → 逐舰 `loseShip(...)`：
   - **传 `enc.galaxyId`** ⇒ 按 **2026-09-26 船长令**「非虫洞的正常星系被摧毁 ⇒ 在该星系生成残骸」
     留下**可打捞**的残骸（装配/插件/机群随残骸快照；打捞能把插件捞回来）；
   - `cause: 'encounter-lost'`（**新增**沉船原因枚举，界面文案 `ui.WreckLog.021`「遭遇战中被击沉」）；
   - 主控船被打沉时由 `loseShip` 既有机制补驾驶船。
3. **存档与界面**：`state.WreckLogCause` 加一枚 · `save.ts` 的沉船记录白名单认它（不认 ⇒ 读档丢那几条）·
   `CommsPage` 的原因文案映射加一支 · l10n 新增 `ui.WreckLog.021`。

## 三、实证

新增用例 `packages/core/tests/encounter-sunk-ship-20260928.test.ts`（4 条，夹具 = 普通编队遭遇战，
与旗舰战**走同一条收场路径**）：
① **撤退时沉船真丢**（不在舰队里 ＋ 沉船记录 `encounter-lost` ＋ 残骸 `salvageable`）·
② 同场**没沉**的船照旧带伤回家（结构 40% / 装甲 25% 如实落盘）·
③ **只差一点没沉**（结构剩 5%）⇒ 不丢（判据是"≤ 0"，不是"很惨"）·
④ **分胜负那条路同样判**（不是只管撤退）。

**把撤退那一处的判定临时摘掉** ⇒ 用例 ①② 立刻红在「`打沉的僚舰已经不在舰队里:
expected { defId: 'sh-sentinel', … } to be undefined`」——**报障在用例里原样复现**（沉船确实被带回来了）。

## 四、已知取舍（请船长过目）

1. **分胜负那条路我一并修了**（您只报了撤退）：同一个漏洞在"打赢/打输结算"那支也成立，
   只修撤退等于 knowingly 留一半。若要只留撤退那一处，删一行即可。
2. **旗舰战没有"结构过半自动脱离"保险**（`startFleetBattleFor` 刻意不挂 `hullEscapeFrac`，与虫洞同款
   ⇒ 要玩家观战 + 手动撤退），所以旗舰战里船**真的会沉**。我没动这条；若要给旗舰战加保险，是另一件事。
3. **非虫洞沉船的插件随残骸走**（可打捞捞回），**不走**"洞内沉船折黑匣"那条规则 —— 请确认与您的口径一致。
4. 之前发现的另一处**不同**问题（`hullDamage.applyArmorFirstDamage` 的 5% 结构底线会把人从 0 抬到 5%）
   **本批没动**：它只在"远征撤退那一口"上生效，遭遇战这条路不经过它；要不要顺手改成
   "地板只防掉、不当治疗"（已在 0 的船不许被抬起来）另行请示。

## 五、闸门
`typecheck` ✅ · core **263 文件 / 2798 用例**全绿 · `content:check` ✅ · `l10n:check` ✅ ·
`l10n:params` ✅ · `ui:rot-check` ✅ · `save:migrate`（只读）**106/106** ✅。
