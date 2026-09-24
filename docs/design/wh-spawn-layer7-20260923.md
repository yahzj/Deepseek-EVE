# 虫洞：强度增幅上调 ＋ 第 7 层起「逐回合刷怪」（2026-09-23）

状态：**进行中** —— ①数值回调**已确认并落码**；②刷怪机制**已按船长逐条裁决落码**（公告稿经船长定稿写入），**待船长验收**。

## 船长原话（照抄）

1. 「虫洞敌人的强度增幅速度，我打算上调一些」
2. 「WORMHOLE_THREAT_GROWTH回调到1.2，然后推出新机制，7层开始，玩家每行经过一回合，就在地图随机格子刷出一个敌人，采用类似星云的方式覆盖在原格子之上。敌人不会刷在下一层入口格，敌人有概率刷到玩家当前格，如果刷到玩家当前格就触发袭击事件。」
3. 「我说错了是回调到WORMHOLE_REWARD_GROWTH =0.12」
4. 四选裁决：**甲 = 威胁常量 0.10 → 0.12**（"名称笔误"经四选确认）
5. 「用敌族族徽做图标覆盖该格子」·「这个敌人会直接覆盖星云的效果」·
   「当玩家第一次进入七层是，给玩家发一则通讯讲清楚敌人开始围剿玩家了，并介绍机制」
6. 公告（**船长逐字定稿**并批准写入 `announcements.ts`，`ann-wh-siege-20260923`）：
   标题「虫洞深处敌人将会开始围剿玩家」＋ 4 条要点（每消耗 1 回合随机一格出现敌人 · 占格无法直接互动、
   玩家看得见 · 战胜后恢复正常交互 · 落在玩家所在格会直接攻击舰队 · 打赢有小概率掉货柜）。

## 一、数值回调（已确认 · 已落码）

- 改动：`packages/core/src/wormholeFoes.ts` 的 `WORMHOLE_THREAT_GROWTH` **0.10 → 0.12**。
  基准层 1 = 45 **不动**；收益曲线 `WORMHOLE_REWARD_GROWTH` = 0.20 **不动**。
- 新层曲线（引擎威胁）：**45 / 50 / 56 / 63 / 71 / 79 / 89 / 99**（层 1~8）。
  面板显示值 = 引擎值 × 2（`WORMHOLE_DISPLAY_THREAT_MUL`，界面三处读数自动跟随）⇒ 层 8 显示 **198**。
- **与旧裁决的关系（§5.2）**：2026-09-15 船长令「降低虫洞内，敌人的强度增长速度」（×1.16 → ×1.10）**被本次上调改写**；
  本档 0.12 仍低于当时被实测否掉的 0.16。
- **红线**：0.12 < 0.20 ⇒「深层收益比难度曲线更高」／「单位威胁收益逐层严格上升」（船长 2026-09-13）**仍然成立**，
  用例判据不改，只同步层威胁数值。
- 同步改动：`packages/core/tests/wormhole-run.test.ts`（层曲线断言 50/56/89/99）·
  `tools/wormhole-econ.ts`（口径注释与结论行）。
- **待复核（挂账）**：`tools/wormhole-econ.ts` 的参考编队（4×T3 长尾鲨巡 · 技能 Lv3 · MK2 弹 · **不带谜质装置/科技**）
  自 2026-09-13 起未再复核，而 2026-09-16「威胁预算 = 血 × 火力」（`d1ba834d`）与 09-19 谜质/支援批都在其后
  ⇒ 2026-09-23 实测读数（层 1 = 100%（残血 26%）· **层 2~8 = 0%**）**不能当本档验收**。
  **尺子（参考编队）重定需船长点头**——属工具口径改动。

## 二、刷怪机制「围剿者」（已落码）

船长口径要点：**层 7 起** · 玩家**每消耗一回合**在随机格刷 1 个敌人 · **星云式覆盖** ·
**不刷下一层入口格** · 有概率刷到玩家当前格 ⇒ **袭击事件**（**直接开战**，账号公告口径）。

### 落码清单

| 文件 | 改动 |
| ---- | ---- |
| `packages/core/src/wormholeSpawn.ts`（新） | `wormholeSpawnAfterTurns(state, turns)`：层 ≥7 每消耗 1 回合掷 1 次；独立盐值随机流；上限 = ⌈格数×50%⌉；排除入口格与已压敌/未清舰船信号的格；命中玩家格 ⇒ **直接置在途战斗**（`pendingNodeBattle` 不再使用）；日志 `core.wormholeSpawn.001` |
| `packages/core/src/wormholeGrid.ts` | `WormholeGridCell.foe?` / `WormholeGridState.spawnSeq?` · `WORMHOLE_SPAWN_MIN_DEPTH/CAP_SHARE` · `hasLiveFoe`/`spawnAliveCount`/`spawnCapOf`/`spawnTargetsOf` · `revealOf` 新增 `{kind:'foe'}`（**最高优先**，盖过星云与"没扫过"）· 拦截（挡路）把活着的围剿者算进去 |
| `packages/core/src/wormholeBattle.ts` | `WormholeFoeKind` 加 `'spawn'`；`wormholeStartBattle` 自动路由（站在压着围剿者的格上 ⇒ 打它）；战果形状分档（`spawn` = 1 堆普通、不给稀有件）；`advanceWormhole` 站在活围剿者上**自动开战**；新文案 id `core.wormholeBattle.032/033` |
| `packages/core/src/wormholeSalvage.ts` | 战利品分档表（普通节点 2+2 · 层末守卫 3+3 · 遗迹 2+2 · 围剿 1+0）＋每场一次货柜掷骰 |
| `packages/core/src/save.ts` | 登记格上 `foe`（`cleanWormholeFoe`）与 `spawnSeq`、一次性提示标记（**漏登记＝每读档丢一次**） |
| `packages/core/src/comms.ts` / `types.ts` / `messages.ts` | 新触发器 `{kind:'wormholeSiege'}` ＋ 通讯稿 `msg-wh-siege`（**第一次下到第 7 层**送达，跨趟只送一次） |
| `apps/desktop/src/renderer/src/panels/Wormhole.tsx` | 地图层：围剿者格画**敌族族徽**（族取格上那张卡，色取 `FOE_ACCENT`）＋ `FOE_FAMILY_LABEL` 悬停说明 `ui.Wormhole.378` |
| `packages/data/src/l10n/table.ts` | `ui.comms.067` · `core.wormholeSpawn.001` · `core.wormholeBattle.032/033` · `core.wormholeSalvage.041/042/043` · `ui.Wormhole.378` |
| 用例 | `packages/core/tests/wh-spawn.test.ts`（10 条：层 1~6 不刷 · 逐回合刷 · 上限与腾名额 · 不刷入口/已压敌格 · 袭击日志与揭示档 · 自动路由 · 战果形状 · 通讯只送一次 · 随档往返 · 端到端冒烟）· `wh-piles-once.test.ts` | 

### 与旧条款的关系

- 「星云式覆盖」按船长补定实现为：**围剿者直接覆盖星云效果**（揭示档优先），而星云本身被推进 `grid.dispersed`
  而不是删除 ⇒ 打掉围剿者后**原格内容照旧**（船长：「打掉后进入原内容」）。
- 围剿战**不写** `cell.activated`（否则会把该格的产出永久封死）——存废只看 `cell.foe`。

## 三、不做 / 边界

- 不改收益增幅（`WORMHOLE_REWARD_GROWTH` 保持 0.20）。
- 不在层 1~6 刷怪（船长定 7 层起）。
- 围剿战的战果形状（1 堆普通、不给稀有件）与货柜概率按**已确认的裁定与公告口径**取；若要改成与普通节点同档，属新裁决。
- §8 纪律：本批不修改旧设计稿；`docs/design/wormhole-extraction-endgame-20260912.md` 里
  「威胁每层 ×1.10」的条款**待归档时统一改写**（本次新裁定以本工作文档 + 代码注释为准）。
