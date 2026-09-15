# 洞内战斗视图：敌卡口径修（敌族图形/动画 · 开局机位）（2026-09-14）

> **状态**：✅ **已修**（船长 2026-09-14 报障 · 本地提交，待验收）
> **船长原话（照抄）**：「**虫洞内的战斗，敌方舰船动画不对。**」＋「**战斗开始位置似乎不对。**」
> ＋（追问后）「**敌方的战斗动画图形和敌族对不上**」
> **落点**：`apps/desktop/.../panels/BattleScreen.tsx` · `packages/core/src/wormholeBattle.ts`（新增取值单点）·
> `packages/core/src/expedition.ts` · `ui/ShipStatusWin.tsx` · `panels/Announcements.tsx` ·
> `tools/content-check.ts`（新契约）· `packages/core/tests/wormhole-battle.test.ts`

## 一、根因：一类"洞内战读了远征口径"的漏接

洞内战斗的宿主是 **`state.wormhole.run.battle`**（**不占** `expedition.battle`），敌卡是**按层派生的卡**
（不落在 `expedition.anomalyId`）。**凡是"只认远征"的读法，在洞里都会静默取到 `null` / `undefined`，
而界面照样渲染** ⇒ 只能靠肉眼发现。本轮一次抓到 6 处（同一个病根）：

| # | 位置 | 旧行为 | 症状 |
|---|---|---|---|
| ① | `BattleScreen.foeAnomaly` | 只认 `expedition.anomalyId` ⇒ 洞内 `undefined` | `foeKey = foeFamilyOf(undefined)` ⇒ 兜底族 **A 海盗** ⇒ **洞里 C/D/E/G 族全画成海盗舰体与动画**（= 船长那句"图形和敌族对不上"）；`foeShipTierOf` 拿不到 ⇒ `sizeOfUnit(null)` 回落 170/90 ⇒ **舰种体积阶梯在洞内失效**；而体积又喂 `layout()`（锚点跟实际舰宽、机位/排布/米制跨度 `usable`）⇒ **开局机位整体偏**（= 船长那句"开始位置不对"） |
| ② | `BattleScreen` 死敌预登记 | 同上恒 null ⇒ 整段不跑 | 洞内**退出战斗界面再进来，血量 0 的敌人重新出现**（2026-09-10 修过的同款 BUG，当年只在洞外修好） |
| ③ | `BattleScreen` 星场基准船速 | 同上恒早退 | 洞内星空视差速度与船速脱钩（停在缺省 200） |
| ④ | `core.expedition.battleTacticDesire` | 默认卡只取远征 ⇒ 洞内返回 **0** | 战场里点「突击/中距/风筝」⇒ 期望距离被设成 0、钳到最近 = **整队贴脸** |
| ⑤ | `ui.ShipStatusWin.sceneOfShipwin` | 只认远征 | 洞里打起来时状态窗不切"交火"场景 |
| ⑥ | `panels.Announcements` 自动弹 | 只挡远征 | 洞里鏖战时公告照样弹出来挡战场 |

## 二、修法

1. **取值单点**（新）：`core.wormholeBattle.battleFoeAnomaly(state, ctx)` —— 洞内 = `run.battle` 的
   **按层派生卡**（与推进/射程弧/血条同一张，走 `wormholeDerivedAnomaly`）；洞外 = 远征卡（**逐字保持旧口径**）。
   `BattleScreen` 改为读它（**渲染层不再直读 `expedition.anomalyId`**）。
2. `BattleScreen` 的死敌预登记与星场基准船速改用**本场已解析的 `battle`**；锚船与 33ms 循环同口径
   （`battle.myFleet?.[0]?.shipId ?? state.shipId`）。
3. `battleTacticDesire` 与 `setBattleDesire` **同一口径**解析：洞内用本趟敌卡 + 编队首舰；洞外照旧。
4. `sceneOfShipwin` / `Announcements` 各补一条洞内分支。
5. **常驻护栏**：`content:check` 新增「**战斗宿主双口径契约**」（源码级扫描，与「装备卡片说明契约」同款跨层兜底）：
   - `BattleScreen.tsx` 非注释行里 `expedition.anomalyId` **必须 0 处**；
   - `expedition.battle` **恰好 1 处**且该行带 `whView`（双口径解析那一行）；
   - `ShipStatusWin.tsx` 必须含 `state.wormhole.run?.battle`、`Announcements.tsx` 必须含 `s.wormhole.run?.battle`。

## 三、验证

- 新增 core 用例（`wormhole-battle.test.ts`，+2）：
  ① **敌卡取值单点**——洞内给出派生卡（`id`/`foeFamily` 与开战记录同源、`foeShipTierOf` 查得到舰种档、
      `foeUnitNameOf` 查得到名）；**反证**：把洞内战摘掉（等价旧口径）⇒ 拿不到卡；洞外 = 远征卡照给；
  ② **洞内战术期望距离**——三档都**非零**且 = 洞内中段档推导值，并**小于**星图档（分档证据）；
      **反证**：退回旧口径 ⇒ 该用例红（`expected 0 to be greater than 0`）。
- **契约负向验证**：在 `BattleScreen` 里临时塞一处 `state.expedition.anomalyId` ⇒ 契约**点名 1 处**；
  还原即绿。
- 五道闸门全绿：typecheck 四包 0 错 · core **145 文件 / 1,551 例** · `content:check` ✅ ·
  `ui:rot-check` ✅ · 桌面构建 ✅。
- **观感与图形对不对，仍由船长实机判**（按约定 §九：本条不靠截图下结论）。

## 四、边界

- 只动"取哪张卡/哪个宿主"的解析，**不动**任何数值、布局几何、动画时长与 CSS。
- 洞外（悬赏/遭遇/窝点/教学）口径**逐字不变**（`battleFoeAnomaly` 的洞外分支就是原来那一行）。
- 洞内**开局距离**仍按船长 2026-09-13 的洞内规则（近战 = 玩家中段位置、远程 = 敌方目标距离），
  本批未动它——"开始位置不对"这一条修的是**敌方舰船体积/机位**（由敌卡决定的那部分）。
- ⚠ 若船长实机看下来"开局位置"仍偏，那要查的是另一层：**视觉米制标定**（2026-09-14 打开"舰种体积"
  时登记的已知代价：距离尺读数与视觉缺口不再严格对应）——那属另一件活，请在回报里说明。
