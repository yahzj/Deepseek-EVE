# 劫掠电子舰 + 劫掠捕获网 · 工作文档

> **状态：实现完成 · 五道闸门全绿 · 待船长验收**（2026-09-16）
> 船长原话：「**推送完成后继续制作劫掠电子舰相关工作，不用等我**」⇒ 本批自行跑闸门、合并、推送。
> 归档动作（并入 roadmap/词典 + 删本文件）**留到船长验收之后**再走 §8 三步。

## 一、船长原话（照抄，按时间序）

1. 「**新增A族敌人劫掠电子舰，添加挂载件冲锋，并额外加装一件新的挂载件，劫掠捕获网：降低目标90%移动速度，
   并关闭所有类型推进器。在自身第一次开火时发动。动画效果为一根蓝色的光速连着命中舰船。添加进深层的海盗战团里。**」
2. （闸门确认时）「**血量修正为0.7**」＋「**补充一点，劫掠捕获网还会让目标闪避强制为0，射程降低500米**」
3. 「**在玩家第一次遭遇劫掠电子舰之后。结束虫洞或回到主界面时，给玩家发送一封通讯，介绍劫掠电子舰的捕获网。**」
4. 「**暂停**」→「**先将劫掠电子舰之外的内容合并检查后推送**」→「**推送完成后继续制作劫掠电子舰相关工作，不用等我**」

## 二、最终口径（已落地，代码为准）

| 项 | 终值 |
|---|---|
| 新舰 | `foe-pirate-raider`「**劫掠电子舰**」· A 族 · **T1 护卫舰** · 血量 **182**（260 × 0.70）· **闪避 0.30**（舰级覆写 `evasion`，老卡仍 0.12）· 单发 30 · 速度 **374**（340 × 1.10）· 射程带 326~4275 · orbit |
| 挂载件 | 舰级挂两件：`foe-mount-charge-pirate`（冲锋 ×1.6 / 冷却 30 秒）＋ 新件 **`foe-mount-capture-web`「劫掠捕获网」** |
| 捕获网 · 触发 | **自身第一次开火那一刻**发动（**不看命中**），只钉**它这一发的目标**；每场只发一次 |
| 捕获网 · 效果 | ① 战斗机动 **×0.1**（−90%）② **关闭所有类型推进器**（点火期加速一并失效）③ **闪避强制为 0** ④ **武器射程 −500m**（远界与近界各减、近界下限 1m） |
| 捕获网 · 时长/解除 | **本场永久**；**击杀发动者即解除**；多艘**不叠加** |
| 编成 | 「海盗战团」（deep 卡）＝ **头目×1 + 电子舰×1 + 快艇×2**（单位数仍 4 ⇒ 总威胁预算不变，条目份额由威胁推导自动重算） |
| 动画 | **蓝色连线**：从发动者锚点连到被钉舰锚点（SVG 线稿，脉动发光；持续到效果解除） |
| 通讯 | `msg-pirate-capture-web`（深空工业协会 · 航线安全司 · 提示）· 触发 `{ kind:'foeShipSeen', shipId:'foe-pirate-raider' }` + 消息级 `holdWhenBusy` ⇒ **首次遭遇之后**、**结束虫洞或回到主界面**才送达 |

**A 族敌速契约**：新舰速度比 1.10 ⇒ 374，满足「每档实速 > 本档基准（340）」；`content:check` 的敌速守卫与
`foe-ship-path.test.ts` 的转速表都已把这条舰纳入（A 族由 4 条变 5 条）。

## 三、落地清单（改了哪些文件）

**core（引擎）**
1. `types.ts`：`FoeMountId` += `foe-mount-capture-web`；`FoeMountDef.web`（四层效果参数）；
   `FoeShipDef.evasion?`（舰级闪避覆写，缺省 0.12）；`CommsTrigger` += `{ kind:'foeShipSeen'; shipId }`；
   `CommsMessageDef.holdWhenBusy?`。
2. `foeMounts.ts`：新件 id 常量 + `FOE_MOUNTS` 条目（`slowMul 0.1 / noThruster / noEvasion / rangeDownM 500`）
   + `ResolvedFoeMounts.foeCaptureWeb`；头注补"四类效果"与"唯一舰级双挂件单位"。
3. `combat.ts`：
   - 建档 `createFoeSpecsFromShips`：`evasion: ship.evasion ?? 0.12`（**仅舰级路径**；老威胁路径保持 0.12）
     + 挂载件解析结果写进 `UnitSpec.foeCaptureWeb`；
   - `noteFoeShipsSeen(state, anomaly)`：两个开战入口（`startBattleFor` / `startFleetBattleFor`）各调一次，
     写 `state.foeShipSeen[id] = true`（通讯触发器只读这一处）；
   - `applyMeWebDebuff(spec, d)`：减速 / 清 `thrusterBoost` / `evasion=0` / 每条武器远近界 −500（近界下限 1）；
     用在 **每拍重建**（单体与编队两条 `buildMyUnitSpecs` 路径）＋ 视图 `battleArcsFor`；
   - `fireFoeCaptureWeb`（敌方开火循环里 `pickTarget()` 之后、`foeWebFired[tag] !== true` 时发动，落 `BattleFx.web`）
     / `expireFoeWebs`（每拍清掉"发动者已死"的条目 ⇒ 击杀发动者即解除）。
4. `state.ts`：`BattleWebDebuff` 接口；`BattleState.meWebDebuffs` / `foeWebFired`（运行态）；`BattleFx.web`；
   `GameState.foeShipSeen`（随档）+ 新档初始化 `{}`。
5. `save.ts`：`meWebDebuffs` / `foeWebFired` 登记为 `runtime`（不入档）；`foeShipSeen` 随档清洗并回写
   —— **空表也落键**（与 `commsDelivered` 同口径，否则存档往返少一个键、`save.test.ts` 的"内容完全一致"红）。
6. `comms.ts`：`case 'foeShipSeen'`；投递前的 `holdWhenBusy` 闸（`commsBusy` = 洞内进行中或交战中 ⇒ 押后）。

**data（内容）**
7. `foe-ships.ts`：新舰定义 + `FOE_SHIPS` 登记（mounts 两件）。
8. `wormholeFoes.ts`：「海盗战团」编成改 头目×1 + 电子舰×1 + 快艇×2。
9. `messages.ts`：`msg-pirate-capture-web`（四段正文，第三人称，无开发话语）。

**界面（apps/desktop）**
10. `BattleScreen.tsx`：蓝线几何（`foeAnchorByTag` / `meAnchorOfTag` / `webEls`，插在 `boltEls` 之前渲染）
    ＋ 敌方挂载件芯片（悬停看全部件名）＋ 战报行「敌方挂载件」。
11. `styles.css`：`.app-bts-web` / `.app-bts-web-bar` + `@keyframes app-bts-web-pulse`（蓝色发光）。

**契约与用例**
12. `tools/content-check.ts`：敌方挂载件契约 ①~⑤ ＋ **捕获网归属**（只允许「劫掠电子舰」带，深层战团必须带一条）；
    「洞外零冲锋」改按**有效挂载**（条目 ?? 舰级）判 —— 新舰把冲锋写在舰级上，只看条目会漏检；
    `TRIGGER_KINDS` += `'foeShipSeen'`；汇总行按目录实算（8 件：冲锋 5 / 机群增程 1 / 炮台增程 1 / 捕获网 1）。
13. `tests/foe-capture-web.test.ts`（新，**8 例**）：舰级数值 · 战团编成 · 单位级 web 参数 ·
    首次开火即发（不看命中）+ 特效 + 每场一次 · 击杀发动者解除 · 重建效果（编队面板均速 (0.1+1)/2）+ 视图射程带 −500 ·
    通讯台账 + 忙时押后 + 送达。
14. `tests/foe-ship-path.test.ts` / `tests/thruster-charge.test.ts`：转速表补新舰（374）；
    A 族条数 4 → 5；非 C 舰级"零冲锋"循环给新舰开**具名例外**，并补两条守卫
    （洞外卡不得使用该舰 · 深层战团必须带它一条）。

## 四、验证结果（本批）

- `npm run typecheck` ✅ ／ `npm run test -w @whale/core` ✅ **1743 例全绿（160 文件）**
- `npm run content:check` ✅ ／ `npm run ui:rot-check` ✅ ／ `npm run build -w @whale/desktop` ✅
- 读数（工具实算，非观感结论）：新舰单位级 `speedMps 374`、`evasion 0.30`、血 182、射程 326~4275；
  捕获网命中后我方该舰 `evasion 0 / 机动 ×0.1 / 推进器关 / 射程两端 −500`；编队面板均速按 (0.1+1)/2 折半。
- **观感（蓝色连线/悬停芯片）留给船长审**——按 §6 未起无头浏览器截图。

## 五、已知取舍与待办

1. 捕获网作用面 = **被钉的那一艘**（船长原话"目标"），不溅射、不叠加、不可解（除击杀发动者）。
2. 舰级挂冲锋 ⇒ 该舰**只进深层战团**；`content:check` 与用例各有一条守卫拦住"日后被放进洞外卡"。
3. **归档待办**（船长验收后做 §8 三步）：关键条目并入 roadmap + 词典（捕获网 / 劫掠电子舰 / 敌方挂载件 8 件口径），
   删本工作文档，重跑 `npm run docs:index`。
4. 本批**未做公告**（船长未要求；如需发布走 §7 审核）。
