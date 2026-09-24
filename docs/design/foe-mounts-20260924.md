# 敌方挂载件：A 族「姿态陀螺仪」＋ G 族「船体修理装置」（2026-09-24）

状态：**已落码 · 四闸门全绿 · 待船长验收**（本件无待决点；改动**只在本地 commit、未推送**，见下）

> **推送口径（船长 2026-09-24：「不要立刻推送。」）**：本件开发期间**只做本地 commit，不推 origin**；
> 等两个挂载件**全部实现完**、四闸门全绿、报给船长之后，才连同收尾一起推送一次（§4 推送闸门）。
> ⇒ **2026-09-24 落码完成**，等船长点头后再推送。

## 船长原话（照抄）

1. 「我调整了A族的闪避，并且希望在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避。给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，会吃威胁的加成。」
2. 「我的改动是A给A族除电子舰外的其他敌人加10%闪避。」
3. 三条追问的答复：**卡范围 = 虫洞内带**（乙：只挂洞内卡条目）· **陀螺仪 = 加算 +10 个百分点**（甲）·
   **修理量 = 乘层威胁倍率**（甲，归一基准「不改动」）
4. 「你先提高A族闪避，提高后再挂载，电子舰也要挂。」

## 一、闪避提高（**已落码** `ce08b7bf`）

A 族 4 艘（海盗快艇 / 劫掠护卫舰 / 劫掠狙击舰 / 海盗头目舰）`evasion` 缺省 0.12 ⇒ **显式 0.22**；
**劫掠电子舰保持 0.30**（数据改动里刻意排除）。

## 二、两个挂载件（设计定稿）

| 项 | 定稿 |
| --- | --- |
| **作用面** | 只写**虫洞卡的编成条目**（`AnomalyDef.ships[].mounts`）⇒ 星图悬赏 / 低安遭遇零变化 |
| **姿态陀螺仪**（A 族 · 含电子舰） | 该舰战斗中 **闪避 +0.10 加算**（上限 0.9 夹紧）。**电子舰也要挂** ⇒ 洞内 A 族：电子舰 0.40、其余 0.22 |
| **船体修理装置**（G 族） | 每 **5 秒**回 **+5 装甲 +5 结构** × **k**，夹到 `hpMax`（满值不回超）；`k = 该层威胁 ÷ 45`（层 1 = 1.00 · 层 7 ≈ 1.97 · 层 10 ≈ 2.77） |
| **顺序** | 先提闪避（已完成），再挂载（下一轮） |
| **实现面** | `foeMounts.ts`（两个新 id ＋ 解析字段）· `combat.ts`（5 秒回血脉冲、闪避加成生效点）· `content:check` 挂载件契约 · 挂载件名/说明走 l10n 中英双语 · core 用例（「层越深回得越多」「满血不再回」「闪避 +10pp 真进命中判定」）· 敌舰明细表加两列读数 |
| **不做** | 不改我方舰船 · 不动星图侧数值 · 挂载件不进 excel 回写表（列表结构，要调由我改代码） |

## 三、边界与风险

- A 族洞内难度 = **数据 +10pp 与陀螺仪 +10pp 叠加**（电子舰只吃陀螺仪那 10pp）⇒ 我方面向 A 族的命中率在洞内下降约 10pp，验收时请特别看这一档手感。
- `k` 的基准 = 层 1 的 45（船长明示「不改动」）⇒ 层 1 也有 ×1.00（即层 1 就有 5/5 的修理）。

## 四、实现计划（已勘察，逐条照着做）
1. `packages/core/src/types.ts`：
   - `FoeMountId` 联合类型加两条：`'foe-mount-gyro-stabilizer'`（姿态陀螺仪）· `'foe-mount-hull-repair'`（船体修理装置）；
   - `FoeMountDef` 加两个可选效果字段：`evasionBonus?: { add: number }`（加算、上限 0.9 由消费方夹）·
     `repairPulse?: { everyMs: number; armor: number; hull: number }`（威胁倍率由消费方乘，字段只给基数）。
2. `packages/core/src/foeMounts.ts`：`FOE_MOUNT_IDS` 加两条键（`gyroStabilizer` / `hullRepair`）；
   `FOE_MOUNTS` 加两条定义（中文名 + `note` 摘船长原话）；`ResolvedFoeMounts` 加
   `foeEvasionBonusAdd?: number` 与 `foeRepairPulse?: { everyMs; armor; hull }`，在 `resolveFoeMounts` 里聚合
   （多件同时挂 = 取最大倍率/取第一件，按既有挂载件聚合风格）。
3. `packages/core/src/combat.ts`：
   - 敌舰规格建档处（`createFoeSpecsFromShips` 里 `speedMps`/`evasion` 那一段，约 2082 行）把
     `foeEvasionBonusAdd` 加到 `evasion` 上并夹 `min(0.9, …)`；
   - 战斗步进里按 `everyMs` 给挂了 `foeRepairPulse` 的敌舰回血：`hp.a/h` 各加
     `round(base × k)`（`k = 当前层威胁 ÷ 45`，层威胁取 `wormholeThreatOf` 那一支口径），夹 `hpMax`；
     计时用战斗时钟（`lastTickGameMs`），**运行态字段需登记进 `save.ts` 的清洗器**（逐字段重建 ⇒ 漏登记每读档重置）。
4. `packages/data/src/wormholeFoes.ts`：把两件挂到洞内卡条目上——A 族各卡（含电子舰）挂 `gyroStabilizer`、
   G 族各卡挂 `hullRepair`（只洞内卡；星图悬赏/低安遭遇不动）。
5. `tools/content-check.ts`：加挂载件契约（A 族洞内条目必有陀螺仪 · G 族必有修理装置 · 星图侧不得出现这两件）。
6. l10n：两件挂载件的**名与说明**加中英双语 id（挂载件名会出现在敌舰悬停/战报里），渲染层按既有映射接。
7. 用例：`packages/core/tests/` 新增（或并入既有挂载件用例）三条——闪避 +10pp 真进命中判定 ·
   每 5 秒回 5/5 且**层越深回得越多** · 满血不再回。
8. 收尾：`npm run foe:export`（敌舰明细加两列读数）· `npm run content:export` · 四闸门（typecheck / core 用例 /
   content:check / l10n:check / ui:rot-check / build）· 提交并推送 · 报告船长。

## 五、落码实录（2026-09-24 · 与 §四 逐条对账）

**两件都落完，逐条对账如下**（条目后括注与 §四 的差异）：

1. **`core/types.ts`**：`FoeMountId` 两条 ＋ `FoeMountDef.evasionBonus` / `.repairPulse`（✅ 同计划）。
   另加 **`FoeMountDef.en?: string`（英文名）**——l10n 覆盖要用（见第 6 条）。
   ⚠ 顺手更正旧注：`FoeMountDef` 上那句「一件只能带**一类**效果」**是错的**（那条只约束我方支援件
   `ModuleDef`；敌方挂载件早就多类并存——劫掠电子舰条目上同时挂冲锋件与捕获网）⇒ 已按实况改写。
2. **`core/foeMounts.ts`**：`FOE_MOUNT_IDS.gyroStabilizer` / `.hullRepair` ＋ 两条定义（名/英文名/`note` 摘原话）；
   `ResolvedFoeMounts` 加 `foeEvasionBonusAdd` 与 `foeRepairPulse`，聚合按既有"**后写覆盖先写**"风格
   （计划里写的"取最大倍率"没采用——既有 12 件全部是后写覆盖，新件随大流更不容易踩坑）。
   另加 **`namePairs`**（与 `names` 同序的 `[中文, 英文]` 对），供第 6 条的 l10n 覆盖取用。
3. **`core/combat.ts`**：`evasion = min(0.9, 舰级值 + 加数)`（建档处）＋ 逐单位修理脉冲
   `pulseFoeMountRepair` / `initFoeRepairPulses`（开战与换波建档各调一次，**幂等**：已有账本不重置计时）。
   - `k` 取 **`anomaly.threat` ÷ 45**（新常量 `FOE_REPAIR_THREAT_REF = 45`）——**洞内派生卡的 `threat`
     就是"本层本次实际威胁"**（节点 = 层威胁 · 守卫 ×1.2 · 遗迹 ×1.3 · 支援呼叫卡 ×1.1），
     与显示给玩家的同一个数 ⇒ 与船长那句「吃威胁的加成」严格同源；
   - ⚠ **踩到一个坑（留档）**：`FOE_REPAIR_THREAT_REF` 一开始写成 `WORMHOLE_THREAT_BASE`（从
     `wormholeFoes` import），而 `wormholeFoes` 反向 `import { foeDamageComposition } from './combat'`
     ⇒ **循环依赖在 `content:check`（CJS 转译）下顶层求值命中 TDZ**
     （`ReferenceError: Cannot access 'WORMHOLE_THREAT_BASE' before initialization`；typecheck 与 vitest 都发现不了）。
     现改为**字面量 45 ＋ 一行类型级一致性校验**（两处不等 ⇒ `typecheck` 当场红）。
   - `battle.foeRepairPulses`（键 = 战斗 tag）进 `save.ts` 登记表：**`persist`**（漏了＝战中重载白赚一跳）。
4. **`data/wormholeFoes.ts`**：A 族三卡的**每条编成**加 `gyroStabilizer`（含劫掠电子舰那条）；
   G 族三卡的每条编成加 `hullRepair`（✅ 同计划；共 10 条编成）。
5. **`tools/content-check.ts`**：敌方挂载件契约新增 ⑤——洞内 A 族每条编成必挂陀螺仪 · 洞内 G 族必挂修理装置 ·
   **一切舰级与洞外卡零这两件**（按**卡 id 前缀 `wh-`** 认"洞内"，不维护第二份清单）。
6. **l10n**：两件新件在 core 目录里带 **`en`**（`Attitude Gyro` / `Hull Repair Unit`，口径走
   `docs/glossary-en.md`：`姿态陀螺` = `Attitude Gyro`、`船体维修装置` = `Hull Repair Unit`）；
   **显示闭环**：`resolveFoeMounts` 产出 `namePairs`（与 `names` 同序）→ `UnitSpec.foeMountNamePairs`
   → 渲染快照（`BattleState.foeMountNames` 那条线 ＋ `battleArcsFor`）→ 战报与敌舰悬停都走
   `BattleScreen` 的 `mountNamesTextOf(names, pairs)` **按当前语言挑一列**。
   - ⚠ **过程中的一次自我纠错（留档）**：第一版把双语名对做在 `data/l10n.ts` 的 `overlayCardFoes`
     上（改卡条目的 `mounts` 为名字数组），写完才发现**界面没有任何地方读卡内编成** ⇒
     那份覆盖是**死代码**（界面拿的是 `battle.foeMounts` 那一份字符串数组，它由运行时快照产出）。
     现改为"**运行时带名对、显示层按语言取**"：`data/l10n.ts` 的 `cardFoeMountsOf` 改为
     **附 `foeMountNamePairs`、不动 `mounts` 的 id**（引擎读 id，语言只影响显示）⇒ 覆盖随
     `battle.foeMounts` 一路走到界面；`BattleState` 与 `BattleReportRecord` 各加一个**运行期**字段
     `foeMountNamePairs`（登记进 `save.ts` 的 `runtime` 一栏，写了不落档的理由）。
   - 边界（如实记）：**存量八件仍无英文名**（缺 `en` ⇒ 英文界面回落中文名，与改动前一致），
     待船长拍板译名后逐件补；本批只保证**两件新件**在英文界面显示正确。
7. **用例**：新增 `packages/core/tests/foe-mounts-20260924.test.ts`（**15 条**）：闪避 +10pp 真进命中判定
   （含近界差值 = 满额 0.10 的实测）· 层越深回得越多（层 1/2/4/7/10 逐值对账 k = 威胁 ÷ 45）·
   守卫比节点高 · 满血不回 · 层 7 一跳 > 层 1 一跳 · 端到端账本与首跳时刻 · 洞外零两件 ·
   **双语名对与名字同序对齐** · **摘掉挂件的同形卡 ⇒ 派生威胁/三层血/单发逐值不变**
   （钉住"挂件不参与派生血与火力"）。
   两条既有用例随口径同步更新（`foe-capture-web` 三件列表与电子舰 0.40 · `wh-foe-mounts-battle` 首波名册与 0.32）；
   `l10n-overlay.test.ts` +1（en 卡条目带双语名对、**`mounts` 的 id 一字不动**、zh 侧不写该派生字段）。
8. **收尾**：闸门读数见 §六；`foe:export` 的"两列读数"**有意未加**——敌舰明细表是**舰级粒度**，
   而这两件挂在**卡条目**上（表内既有的"挂载件"列只列舰级的 `ship.mounts`）⇒ 加列会写出**误导性的空值**；
   要读"哪张卡哪条编成挂了什么"请看 §四 第 4 条的两处落点或本卡契约的体检行。

## 六、验证与边界（报船长）

- **四闸门**：typecheck 四包 0 错 · core **201 文件 / 2267 用例全绿**（含新增 15 条与同步改写的既有 3 条）·
  `content:check` ✅（挂载件契约：12 件，含两条归属新判据）· `l10n:check` ✅ · `ui:tip-check` ✅ ·
  `ui:rot-check` ✅（本批 UI 改动只有两处取词，照规矩跑）· `save:roundtrip-audit` ✅ · `save:migrate` ✅ ·
  桌面 `build` ✅（1.82 秒）。
- **边界**：不动任何数值曲线与存档结构（新增的 `battle.foeRepairPulses` 是**可选字段＋零迁移**）·
  不改我方舰船 · 星图侧（悬赏 / 低安遭遇）**零变化**（两件只写在洞内卡条目上，体检判据守着）。
- **观感/手感权在船长**：洞内 A 族闪避 0.32（电子舰 0.40）意味着我方面向 A 族的命中率下降约 10pp，
  这一档手感请船长进洞实测；G 族的修理脉冲也请看"打不打得动"。
- **推送**：按页首口径**未推送**，等船长点头。

## 七、与一号「定义层」的合并（2026-09-24 · 同一件工作两头做）

落码期间主树也在做同一件（一号 `9f270688`「定义层」两文件 ＋ `1d77eeb7` 交接卡
`docs/design/handoff-foe-mounts-20260924.md`）⇒ 按 §4「开工先核对基线」合并（`b7ddefcb`）：

- **主树只动定义层**（`core/foeMounts.ts` ＋ `core/types.ts`：目录两条 ＋ 两个效果字段 ＋ 类型注释），
  本件的实现**覆盖式包含**它 —— 合并后**没有**出现"两套目录 / 两份字段"，也不需要回退任何一侧；
- **采纳主树一处口径**：`foeEvasionBonusAdd` 多件相撞取 **加和**（本件原为"后写覆盖"）——
  闪避是可叠加加数，取加和更稳；解析函数与注释已同步改写；
- **主树已归档并删掉两份工作文档**（`one-time-blueprint-loss-20260924.md` 与
  `side-tasks-courier-and-damage-popup-20260924.md`，关键内容进了 `roadmap.md` /
  `glossary.md`）⇒ 本件这边那份副本**按归档口径删除**，不再保留"挂账销档"的增量状态行；
- 合并后复跑：typecheck 0 错 · core **2271 用例全绿** · `content:check` / `l10n:check` /
  `ui:rot-check` / `ui:tip-check` / `save:roundtrip-audit` / 桌面 build 全绿。
