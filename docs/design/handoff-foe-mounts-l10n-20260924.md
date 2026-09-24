# 交接卡 · 存量八件敌方挂载件的英文名（本地化 · 2026-09-24 · 二号 → 三号）

> **一句话**：两件新挂载件（姿态陀螺仪 / 船体修理装置）已带英文名并在英文界面生效；
> **存量八件仍是中文照出**（`FoeMountDef.en` 缺省 ⇒ 显示层回退中文）。
> 船长 2026-09-24：「**存量八件挂载件的英文名是本地化吗？是的话本地化交给三号**」⇒ **本件归三号**。
> 二号只做交付：**清单 + 译名候选 + 落点 + 口径**，不动代码。

## 一、事实（先说清"它算不算本地化"）

**算**。挂载件名是**玩家可见文案**，两个展示面：

| 展示面 | 落点 | 现状 |
| --- | --- | --- |
| **战斗内徽标 + 悬停** | `apps/desktop/src/renderer/src/panels/BattleScreen.tsx`（`arcs.foeMounts` / `arcs.foeMountNamePairs` ＋ `mountNamesTextOf`） | 已按语言取；缺 `en` ⇒ 中文 |
| **战后战报那一行** | 同上（`br.foeMounts` / `br.foeMountNamePairs`） | 同上 |

链路（2026-09-24 已打通、**不用重做**）：`FOE_MOUNTS[].name / .en`
→ `resolveFoeMounts().namePairs` → `UnitSpec.foeMountNamePairs` → 渲染快照（`BattleState.foeMountNames` ＋ `battleArcsFor`）
→ `mountNamesTextOf(names, pairs)` 按当前语言挑一列。⇒ **本件只差给八件补 `en`（以及决定它放哪儿）**。

## 二、八件清单与译名候选（**口径一律走 `docs/glossary-en.md`，不即兴造词**）

术语表里现成的映射（三号直接用，别另造）：
`机群 = Drone Swarm` · `推进器 = Thruster` · `阵列 = Array` · `捕获网 → Snare`（现有 `劫掠捕获网 = Raid snare` 的 en 文案，见 `l10n/table.ts` 的 `ui.BattleScreen.034`）·
`守墓 → Gravekeeper` · `巨构 → Megastructure` / `Titan`（舰船用 Titan、装备用 Megastructure —— 本件属**敌方装置**，建议随 `foe-titan-hulk = Titan Hulk` 走 **Titan**）·
`支援呼叫 = Support Call`（术语表第 89 行现成条目）。

| # | id | 中文名 | **译名候选** | 依据 |
| --- | --- | --- | --- | --- |
| 1 | `foe-mount-charge-pirate` | 劫掠冲锋推进器 | `Raider Charge Thruster` | 劫掠 = Raider（`Raider Afterburner` 同族）· 冲锋 = Charge（`foeCanCharge` 字段名同源） |
| 2~5 | `foe-mount-charge-swarm-t1..t4` | 虫群冲锋器 T1~T4 | `Swarm Charger T1` ~ `T4` | 虫群 = Swarm（`Swarm Skiﬀ` 同族）· 四件**保持同一词根 + 档位后缀** |
| 6 | `foe-mount-drone-range-x4` | 机巢增程阵列 | `Drone Nest Range Array` | 机巢 = Drone Nest（`mod-drone-rack-*` 的 "Drone Deck" 是**我方件**，敌方巢用 Nest 更准） |
| 7 | `foe-mount-capture-web` | 劫掠捕获网 | `Raider Snare Net` | 与既有 en 文案 `Raid snare` 同词根（同族一致性优先于逐字直译） |
| 8 | `foe-mount-gun-range-x1-5` | 守墓远距观瞄 | `Gravekeeper Long-Range Optics` | 守墓 = Gravekeeper（权威）· 观瞄 = Optics（我方 `光学镜头阵列 = Optical Lens Array` 同根） |
| 9 | `foe-mount-titan-range-x1-5` | 巨构齐射观瞄 | `Titan Salvo Optics` | 巨构随 Titan（见上）· 齐射 = Salvo（`mt-battle-volley` 的 "Volley" 同源） |
| 10 | `foe-mount-support-call` | 支援呼叫装置 | `Support Call Mount` | Support Call 直接取术语表；加 Mount 以免与"动作"混淆 |

（已带 `en` 的两件作对照：`姿态陀螺仪 = Attitude Gyro` · `船体修理装置 = Hull Repair Unit`。）

## 三、落点（三号动手时逐处核）

- 源码：`packages/core/src/foeMounts.ts` 的 `FOE_MOUNTS` 八条定义各加一行 `en:`（**唯一改动点**）。
- 已就位、不用改：`resolveFoeMounts` 的 `namePairs`、`UnitSpec.foeMountNamePairs`、渲染快照两处、`mountNamesTextOf`。
- 术语登记：`docs/glossary-en.md` 的**敌方挂载件**段（该表是"已冻结译名"的唯一权威 ⇒ 新译名先登记再用）。
- 用例：`packages/core/tests/foe-mounts-20260924.test.ts` 里那条"双语名对与名字同序对齐"断言目前**明确写着**
  「缺英文名的件会退化成中文（既有八件现状）」——补完 `en` 后**这条注释与该断言要同步改**
  （否则它会把"已补全"钉成"应当回退"）。

## 四、⚠ 一个需要船长拍板的口径（**别默默选**）

`docs/development-conventions.md` **§十一之三「本地化 ＝ id 映射制」** 要求玩家可见文案走
**id → `l10n/table.ts` 的 `zh/en` 列**，且**不在源码里内联中文**；本件目前走的是**另一条**
（core 目录里的 `name`/`en` 双语字面量），原因是目录表在 core：

- `combat.createFoeSpecsFromShips` **拿不到 `ctx`**（拿不到 data 包的译名表）⇒ 建档时只能从 core 目录取显示名；
  这也是 `core/foeMounts.ts` 头注里写的"目录为什么在 core"。
- 现口径（两件新件用的）：**core 里成对写 `name` + `en`**（core 的未译读数**不在** `l10n:check` 的扫描面上，
  见该工具头注"core 还在按文件迁移中"）——**能用、不报红，但与"id 映射制"是两条路**。

**两条路，请船长选一条再让三号动手**：
- **甲（建议 · 小）**：维持现状口径 —— core 目录成对写 `name` + `en`（八件照抄这个模式），
  术语表登记译名，`l10n:check` 照旧不扫 core。**改动最小、与两件新件一致**；
  代价 = 多语言再扩时这批要手工再补一列。
- **乙（彻底 · 大）**：给挂载件立 **`l10n` 域 + id**（如 `foemount.chargePirate.001`），
  `table.ts` 补 `zh/en`，再让 `resolveFoeMounts` 的 `namePairs` 从表取 —— 需要**把表或查表函数送进 core**
  （新架构缝），属**系统级改动**，按 §2 要先走四步闸门。

> 二号倾向 **甲**：两件新件已按甲落地并被船长实测通过，八件补齐即可达成"英文界面无中文挂载件名"的目标；
> 乙留到"要加第三门语言 / 要清 core 里的中文字面量"时整批做，那时一次性收益更大。

## 五、验收口径（三号自测要跑的）

1. `npm run l10n:check` ✅（**注意**：core 不在它的未译扫描面上 ⇒"它绿"不等于本件做了，别当验收依据）；
2. `npm run typecheck` 四包 0 错 · `npm run test -w @whale/core` 全绿（含上面 §三 那条同步改写的断言）；
3. **实测**（这条才是真验收）：把语言切英文，打一场挂了件的战斗，看**战斗内徽标 + 悬停**与**战后战报**那一行
   是否全英文。八件**不在同一场里**（各自可见面不同），按下面几处覆盖：
   | 覆盖 | 打哪儿 | 能看到哪几件 |
   | --- | --- | --- |
   | 洞内 A 族 | 虫洞内战 `wh-pirate-warband`（海盗战团） | 劫掠冲锋推进器 · 劫掠捕获网（电子舰那条） |
   | 洞内 C 族 | 虫洞内战 `wh-alien-swarm` / `wh-alien-hive`（星髓游猎群 / 噬口深巢） | 虫群冲锋器 T1~T4 |
   | 洞内 E 族 | 虫洞内战 `wh-titan-echo`（巨构残响，奥罗残骸段） | 机巢增程阵列 |
   | 洞内 E 族（深层） | 虫洞内战 `wh-titan-missile`（导弹残响，导弹残段） | 巨构齐射观瞄 |
   | 洞内 D 族 | 虫洞内战 `wh-grave-throne`（陵墓王庭） | 支援呼叫装置 |
   | 星图侧（顺带看） | D 族悬赏卡（静滞卫舰在编成里的那张） | 守墓远距观瞄 |
   ⚠ **两件挂在舰级**（机巢增程阵列 = E 族三舰 · 守墓远距观瞄 = `foe-d-stasis`）⇒ 洞外卡也能看到，
   与"只挂洞内条目"的那几件不同（这是 2026-09-16「挂载化」时的归属差异，不是本件造成的）。
4. 观感交船长（按 §6「观感审查权在船长」，别自己截图当结论）。

## 六、边界

- **不动**：数值、机制、存档结构、挂载件的 `id`（id 是数据侧写死的引用，**改名会当场编译不过**）；
- **不动**：中文名（`name`）——中文界面与船长口径一字不改；
- 若走**乙**：`table.ts` 的 id 一经使用不复用不改名；域若新增（`foemount`）要与 `tools/l10n-check.ts` 的
  `DOMAINS`、`tools/l10n-wrap.ts` **两处一起加**（工具头注写明"加域两处一起加"）。

---
_维护：本卡是**交接件**（二号交付、三号执行）。三号动手前先请船长在 §四 选甲/乙；
完成后按 §8 归档：关键结论并入 `docs/glossary-en.md`（译名）与 `docs/roadmap.md`（一条精简条目），再删本卡。_
