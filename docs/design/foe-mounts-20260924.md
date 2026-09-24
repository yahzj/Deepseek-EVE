# 敌方挂载件：A 族「姿态陀螺仪」＋ G 族「船体修理装置」（2026-09-24）

状态：**设计已确认 · 未动工**（下一轮实现）。船长已逐条裁决，无待决点。

## 船长原话（照抄）

1. 「我调整了A族的闪避，并且希望在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避。给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，会吃威胁的加成。」
2. 「我的改动是A给A族除电子舰外的其他敌人加10%闪避。」
3. 三条追问的答复：**卡范围 = 虫洞内带**（乙：只挂虫洞卡条目）· **陀螺仪 = 加算 +10 个百分点**（甲）·
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
