/**
 * **终局玩法「虫洞」· 洞内敌卡**（F 批 · 2026-09-13）。
 *
 * 口径来源：`docs/design/wormhole-extraction-endgame-20260912.md`
 * §3（节点与层末 BOSS）· §8「层末 BOSS = 复用舰级表」· §10 F 批。
 *
 * **五族各三档 = 15 张**（A 海盗 / C 异形 / D 守墓 / E 巨构 / G 鱿烬，每族浅/中/深各一）：
 * **一处虫洞锁一族、整趟同族**（船长 2026-09-14 定案 · 丁），
 * **用哪一档**由该层层档位池决定（船长 2026-09-15：层 1 只浅 / 层 2~3 中 2 : 浅 1 /
 * 层 4+ 深 2 : 中 1 : 浅 1），取值点 = core 的 `wormholeCardIdForRun`。
 * ⚠ **分批落码**：本表先出浅层五张（2026-09-13 的旧 id 与卡名一律不动），中/深随批次补齐；
 * 缺档由 `wormholeCardPoolAt` 自动跳过（详见 `docs/design/wormhole-foe-variety-20260915.md`）。
 *
 * ⚠ **2026-09-13 补第五张（E 族）**：船长裁定「**虫洞专属掉落按种族库走，蓝图也是按种族库。
 * 你顺便补上空缺的种族。**」——五族掉落池要"每族都有来源"，而洞内原本只有四张卡（缺 E）⇒ 见下方
 * `wh-titan-echo`。E 族此前在 `wormhole-exclusive-20260913.md` §2 就标着"掉落池暂时无来源"。
 *
 * **威胁不是写死的本卡强度**：卡上 `threat` 只是**缩放锚点**（= 第 1 层基准威胁 45），
 * 实际用哪一层由 core 的 `wormholeAnomalyOf(base, depth, kind, waves)` **按层换算**：
 * 层末 BOSS ×1.2、普通节点 ×1.0（见 `WORMHOLE_BOSS_THREAT_MUL` 等常量）。
 * ⚠ **2026-09-15 撤离战取消**（船长「虫洞的撤离战取消吧」）：原先还有一档「撤离战 ×0.8」，
 * 随撤离战线一并退役 ⇒ 洞内敌卡只服务 **节点 / 守卫 / 遗迹收尾** 三种用途。
 *
 * **选靶倾向概率**（船长 2026-09-14：「**虫洞敌人的攻击倾向，加一个概率**」→ 先定 60%，
 * 同日二次改判「**概率降为40%试一下**」）：
 * 本文件里**写了 `foeTargeting` 的三张卡**（A/C/D）各挂 `foeTargetingChance: 0.4`——每发开火前掷一次，
 * 没掷中 ⇒ 这一发退回等权随机；**G/E 两张本来就是 `random` 模式 ⇒ 不写该字段**
 * （`random` 下它无意义，写了也按 1 处理）。层末守卫的 0.4 在 core 侧
 * （`WORMHOLE_BOSS_TARGETING_CHANCE`，模式仍是"打最大的"）。
 *
 * ⚠ **施工期对玩家不可见**：五张卡一律 `hidden: true`（不进悬赏目录、不被派发、不参与族级设计契约），
 * 且洞内入口本身在调试开关后面 ⇒ 拍板前玩家遇不到它们。
 *
 * ⚠ **待 F 批收益校准**：编成取"舰级自然值"（不写 `hpMul`/`dmgMul`，即 1×），
 * 层内难度是否合适要看 `tools/wormhole-econ.ts` 的实测读数再定。
 */
import { FOE_MOUNT_IDS } from '@whale/core'
import type { AnomalyDef } from '@whale/core'
import {
  FOE_ALIEN_MAW,
  FOE_ALIEN_SPORE_HIVE,
  FOE_ALIEN_STARCORE_ADULT,
  FOE_D_GHOST,
  FOE_D_LONGSHIP,
  FOE_D_STASIS,
  FOE_D_THRONE,
  FOE_G_SWARM_SKIFF,
  FOE_G_ECHO_REMNANT,
  FOE_G_EXILE_BATTLESHIP,
  FOE_MISSILE_HULK,
  FOE_SHIP_AURO_HULK,
  FOE_SHIP_TITAN_HULK,
  FOE_SHIP_PIRATE_CORVETTE,
  FOE_SHIP_PIRATE_SKIFF,
  FOE_SHIP_PIRATE_WARLORD,
  FOE_SHIP_PIRATE_RAIDER, // 2026-09-16 船长：A 族新舰（深层战团）
  FOE_H_INK_FLAGSHIP, // 2026-09-24 船长：H 族（墨潮帮）旗舰（周末入侵旗舰战用）
  FOE_H_INK_CORVETTE,
  FOE_H_INK_SNIPER,
} from './foe-ships'

/** 洞内敌卡的缩放锚点威胁（= core `WORMHOLE_THREAT_BASE`，第 1 层基准） */
const ANCHOR_THREAT = 45

export const WORMHOLE_FOE_CARDS: readonly AnomalyDef[] = [
  {
    id: 'wh-pirate-scout',
    foeFamily: 'A',
    name: '劫掠支队',
    galaxyId: 'galaxy-hub', // 只作日志/展示的星系归属；本卡不进任何星系目录（hidden）
    threat: ANCHOR_THREAT,
    // **选靶模式**（船长 2026-09-13「虫洞内敌人的目标选择机制」）：海盗抢货船 ⇒ 专挑**非战斗船**
    foeTargeting: 'noncombat',
    // **选靶倾向概率**（船长 2026-09-14「虫洞敌人的攻击倾向，加一个概率」→ 先定 60%，同日改 40%）：
    // 每发开火前掷一次——四成按"抢货船"挑，六成这一发乱了（等权随机）。
    // ⚠ 这是**性格强度**、不是难度旋钮：要调难度请动 `dmgMul`/`hpMul` 或层威胁曲线（2026-09-13 口径）。
    foeTargetingChance: 0.4,
    // 混伤 8:2（主动能 / 副爆炸 = 劫掠护卫舰本体的构成；与编成条目的有效构成必须一致，
    // 见 `content:check`「舰级契约」的卡面/编成一致性断言）
    dmgMix: { kinetic: 8, explosive: 2 },
    // 编成 = 劫掠护卫舰 ×2（T1；`speedMul 0.9` 把实速 374 → **337**，落在 orbit 常规带 0.9~1.25× 内
    // ——隐藏模板也要过「敌速口径契约」，这条与 `enc-pirate-*` 用 `speedMul` 反算实速同款）
    // **冲锋挂载件只挂本卡条目**（2026-09-16 船长：「给A族虫洞内的海盗添加冲锋…冲锋倍率为1.6，冷却30秒」）：
    // 劫掠护卫舰这条舰级洞外（低安遭遇 / 悬赏）也在用 ⇒ 挂**条目**才能做到"只在洞内冲锋"。
    // ⚠ **不给护卫舰压 speedMul**（2026-09-16 船长「海盗的平均速度好像有些太慢」）：条目倍率会把它压到
    // 本档基准之下（340 × 1.10 × 0.9 = 337 < 340）——违反船长 2026-09-11「A 族速度都快…每档都必须高于基准」。
    // 旧值 0.9 的来历：当年体检把 hidden 卡**整类**豁免，而洞内三张卡恰好都是 hidden ⇒ 一直没被查到；
    // 现契约收窄成只豁免迁移守恒反算的 `enc-pirate-*` 旧模板，本卡按 **374 m/s（1.28×）** 过线。
    ships: [{ ship: FOE_SHIP_PIRATE_CORVETTE, count: 2, mounts: [FOE_MOUNT_IDS.chargePirate, FOE_MOUNT_IDS.gyroStabilizer] }],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [], // 洞内收益一律走背包拾取（§5.4），卡上不给战利品
    combatSeconds: 40,
    hidden: true,
    description: '虫洞内遭遇：小股劫掠支队（隐藏卡，只由虫洞生成）。',
  },
  {
    id: 'wh-alien-swarm',
    foeFamily: 'C',
    name: '星髓游猎群',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    // 异形捕食弱者 ⇒ 打**最小的**（按舰种档）——**族定选靶**（船长 2026-09-15「选靶按照族限定」）
    foeTargeting: 'smallest',
    // 倾向概率 0.4（同批：四成盯着最小的那艘，六成乱咬）
    foeTargetingChance: 0.4,
    // 混伤 8:2（主等离子 = C 族酸液签名 / 副爆炸）
    dmgMix: { plasma: 8, explosive: 2 },
    // 编成 = **星髓成虫 ×3**（船长 2026-09-16：「C族，浅层改为3只星髓成虫」——由 T1 星髓幼虫 ×4 换成 T2 成虫 ×3）
    // `dmgMul 1.40` = 船长 2026-09-16 裁「**C 族先折中，其他保持不变**」。**引擎真实口径**（普查后更正）：
    // `wormholeAnomalyOf` 的 `scaleDmg = 层血预算 ÷ 卡的自然总血` **同乘在单发上** ⇒ 卡的实际火力 ∝ 火力密度
    // （ΣDPS ÷ 自然血 × 多舰补偿）。本卡 ⇒ DPS 密度 **0.0472**，落族间中段
    //（改前浅层：A 0.0467 · C 0.0615 · D 0.0185 · G 0.0673 · E 0.0540）。
    // ⚠ 本卡早前那版注释里的"Σ单发守恒"算式**是错的**（漏了 `scaleDmg` 这一层），已作废；
    //   普查与口径见 `docs/design/wh-c-cards-20260916.md` §四。
    ships: [{ ship: FOE_ALIEN_STARCORE_ADULT, count: 3, dmgMul: 1.4 }],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 40,
    hidden: true,
    description: '虫洞内遭遇：成群的星髓成虫游猎队（隐藏卡，只由虫洞生成）。',
  },
  {
    id: 'wh-grave-watch',
    foeFamily: 'D',
    name: '守墓巡哨',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    // 守墓者按残余自动化程序压制火力 ⇒ 打**输出最高的**
    foeTargeting: 'top-output',
    // 倾向概率 0.4（同批：压制程序四成能锁对火力最高的那艘，六成判定失准 ⇒ 乱打）
    foeTargetingChance: 0.4,
    // 混伤 8:2（主等离子 = D 族「以能量武器为主」/ 副动能）
    dmgMix: { plasma: 8, kinetic: 2 },
    // 编成 = **幽灵舰 ×2**（船长 2026-09-15：「**D族浅层改为幽灵*2**」，T2 中程光束快船）
    // ⚠ **伤害系数 0.5**（F 批逐卡配平 · 2026-09-13）：本族主炮是**光束（必中）**，同一血预算下
    // 实收远高于掷命中的卡 ⇒ 用 `dmgMul` 把"血/火力比"压回来；总血仍由 core 的按层预算（按卡归一）说了算。
    ships: [{ ship: FOE_D_GHOST, count: 2, dmgMul: 0.5 }],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 50,
    hidden: true,
    description: '虫洞内遭遇：守墓者留下的巡哨编队（隐藏卡，只由虫洞生成）。',
  },
  {
    id: 'wh-exile-blockade',
    foeFamily: 'G',
    name: '亡军封锁',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    // 蜂群乱战 ⇒ **随机抽取**（缺省口径也在本卡显式写出，便于日后单独调整）
    foeTargeting: 'random',
    // ⚠ 本卡**刻意不写** `foeTargetingChance`：模式已随机，概率对它无意义（写了也按 1 处理、不掷骰）
    // 混伤 8:2（主动能 / 副爆炸 = G 族蜂群炮台构成）
    dmgMix: { kinetic: 8, explosive: 2 },
    // 编成 = **围攻残兵舰 ×3**（船长 2026-09-15：「**G浅层为围攻残兵舰*3**」，T1 蜂群压制）
    ships: [{ ship: FOE_G_SWARM_SKIFF, count: 3, mounts: [FOE_MOUNT_IDS.hullRepair] }],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 40,
    hidden: true,
    description: '虫洞内遭遇：鱿烬亡军的封锁小队（隐藏卡，只由虫洞生成）。',
  },
  {
    id: 'wh-titan-echo',
    foeFamily: 'E',
    name: '巨构残响',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    // E 族签名 = **平台（机库 + 无人机承载）**：不打人、靠机群投送火力 ⇒ 选靶模式 **随机**（族格）
    foeTargeting: 'random',
    // ⚠ 本卡**刻意不写** `foeTargetingChance`（同 G 卡：随机模式下该字段无意义）
    // 混伤 **爆炸 60% + 动能 40%**（船长 2026-09-19「所有E族的默认伤害比改为爆炸60%，动能40%」；E 族族格）
    dmgMix: { explosive: 6, kinetic: 4 },
    // 编成 = 奥罗残骸段 ×1（T3 静物残骸 + **警戒机群 5 架**；族内最"旧"最轻的一截）
    // ⚠ **`dmgMul = 0.9` 是逐卡读数配出来的，别照抄其它卡的 0.5**——本卡是洞内**唯一带机群**的卡：
    // 机群**发数多、单发轻**，同一条 `dmgMul` 下实收远低于其它卡。实测
    // （`npm run wormhole:econ -- --card=4 --depth=N`，5 播种）：
    // `0.25` ⇒ 层 3 节点残血 97% / 层 7 节点 100% 胜（**安全刷层卡**，明显偏软）；
    // `1.4`  ⇒ 层 1 节点 71%（比四张老卡都硬）/ 层 5 节点 0%（比 G 族还狠）⇒ 过强；
    // `0.9`  ⇒ 层 1 节点 82% · 层 3 节点 71% · 层 5 节点 39% · 层 5 守卫 0%。
    // 同深度对照（老卡：层 3 节点 A 86 / C 100 / D 72 / G 65；层 5 节点 A 70 / C 60 / D 15 / G 0）
    // ⇒ **0.9 落在四张老卡的正中间**，采用。E 族洞内只此一张 ⇒ 它同时是 E 族掉落池的唯一来源。
    ships: [{ ship: FOE_SHIP_AURO_HULK, count: 1, dmgMul: 0.9 }],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 60,
    hidden: true,
    description: '虫洞内遭遇：一截仍在放电的巨构残骸及其警戒机群（隐藏卡，只由虫洞生成）。',
  },
  /* ══════════ 2026-09-15 扩充：一族三档（浅/中/深）· A 族中/深两张 ══════════
   * 船长：「增加敌人的配置种类和敌族新舰船。」＋「选靶按照族限定。」＋
   * 「层 2~3出场抽取按照2:1抽。层4+出场抽取按照2:1：1抽。」＋「中层配置血量*1.1.深层配置血量*1.2」
   * 口径与分批见设计稿 `docs/design/wormhole-foe-variety-20260915.md`。 */
  {
    id: 'wh-pirate-hunt',
    foeFamily: 'A',
    name: '劫掠围猎',
    galaxyId: 'galaxy-hub', // 只作日志/展示的星系归属；本卡不进任何星系目录（hidden）
    threat: ANCHOR_THREAT,
    // **选靶按族限定**（船长 2026-09-15）：A 族一律「抢非战斗船」——同族三张卡同模式同概率
    foeTargeting: 'noncombat',
    foeTargetingChance: 0.4,
    // 卡面构成 = 主系动能 8 : 副系爆炸 2（A 族签名）
    dmgMix: { kinetic: 8, explosive: 2 },
    // 编成 = 劫掠护卫舰 ×2（orbit 环绕，speedMul 0.9 与浅层卡同口径）+ 海盗快艇 ×1（brawl 贴脸扑上来）
    // ⚠ **为什么不用劫掠狙击舰**：狙击舰是 `kite`（实速 325 ⇒ 比率 1.11×），而**隐藏卡**在体检里
    //   走的是**战术带**（kite 0.60~0.85）而不是 A 族全族提速带 ⇒ 必红；要留它就得给它压 `speedMul`
    //   （与船长「A 族速度都快（方便突袭）」的族格相冲突）⇒ 改用同族两条本就合法的舰级。
    //   狙击舰仍服务悬赏线（`ano-redring-raiders` 等），不是"没用上"。
    // ⚠ **条目覆写构成**：快艇舰级自带的是「爆炸 8 : 动能 2」（缴获弹药口径），
    //   本卡按 A 族签名统一成动能 8 : 2 ⇒ 契约「卡面 = 每条主体的有效构成」由这条覆写满足
    //   （这正是「想配异质编成时写条目覆写、不让卡面失真」的既有正解）。
    // **冲锋挂载件**（2026-09-16 船长：A 族洞内海盗 ×1.6 / 冷却 30 秒）——只挂本卡条目，洞外同一舰级不冲
    ships: [
      { ship: FOE_SHIP_PIRATE_CORVETTE, count: 2, mounts: [FOE_MOUNT_IDS.chargePirate, FOE_MOUNT_IDS.gyroStabilizer] }, // 同上：不给护卫舰压 speedMul
      /**
       * ⟪2026-09-24 船长令⟫「**你将这两张卡单独改为 orbit，其他不要调整**」——**条目级覆盖**（`tactic` 的层级
       * 是「条目 > 舰级」，卡面不参与，见 `combat.foeTactic` 解析）：本卡的快艇按 **orbit** 打，
       * **只动本卡**、不动快艇舰级（悬赏线照旧 brawl）、也不动其他卡。
       * 效果：`anyBrawl` 不再成立 ⇒ 洞内开局回到"**敌人自己的期望距离**"（此前整卡走近战口径 ⇒
       * 开局被绑到玩家的中距离，长射程配装下会落在海盗射程之外——船长 2026-09-24 报障现场）。
       * ⚠ **冲锋挂载件保留**（`chargePirate`）⇒「进去就得挨打」的张力不丢。
       */
      { ship: FOE_SHIP_PIRATE_SKIFF, count: 1, tactic: 'orbit', dmgMix: { kinetic: 8, explosive: 2 }, mounts: [FOE_MOUNT_IDS.chargePirate, FOE_MOUNT_IDS.gyroStabilizer] },
    ],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 50,
    hidden: true,
    description: '虫洞内遭遇：一近一远互相掩护的劫掠围猎队（隐藏卡，只由虫洞生成）。',
  },
  {
    id: 'wh-pirate-warband',
    foeFamily: 'A',
    name: '海盗战团',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    foeTargeting: 'noncombat',
    foeTargetingChance: 0.4,
    dmgMix: { kinetic: 8, explosive: 2 },
    // 编成 = 海盗头目舰 ×1（brawl 精锐）+ **劫掠电子舰 ×1** + 海盗快艇 ×2（brawl 贴脸）——
    // A 族悬赏线的经典"头目 + 杂鱼"，电子舰于 2026-09-16 换下一条快艇（单位数仍 4）
    // ⚠ 快艇舰级自带「爆炸 8 : 动能 2」⇒ 同前，条目覆写回本卡签名构成
    // **冲锋挂载件**（2026-09-16 船长：A 族洞内海盗 ×1.6 / 冷却 30 秒）——只挂本卡条目，洞外同一舰级不冲
    ships: [
      // ⟪2026-09-24 船长令⟫ 本卡同样**条目级**改为 orbit（头目与快艇两条），只动本卡；见上层卡同款注释
      { ship: FOE_SHIP_PIRATE_WARLORD, count: 1, tactic: 'orbit', mounts: [FOE_MOUNT_IDS.chargePirate, FOE_MOUNT_IDS.gyroStabilizer] },
      // **新舰「劫掠电子舰」×1**（船长 2026-09-16）——改编成 头目×1 + 电子舰×1 + 快艇×2：
      // 单位数仍 4 ⇒ 本层本档的**总威胁预算不变**，只是把一条快艇换成电子战支援舰。
      // ⚠ **两件挂载件都写在本条目上**（2026-09-19 船长：「海盗电子舰的冲锋也移除，只在洞内单独挂载」）：
      // 有效挂载是 `条目 ?? 舰级`（**替换**不是叠加）⇒ 舰级已清空，冲锋与捕获网必须**两件都写**，
      // 只写冲锋会顶掉捕获网。
      // ⚠ **三件都在这一条上**（2026-09-24 加姿态陀螺仪，船长「**电子舰也要挂**」）——同款理由：
      // 漏写任一件就等于把那件从这条编成里删掉（条目**替换**舰级，不是叠加）。洞内该舰 ⇒ 闪避 0.30 → **0.40**。
      { ship: FOE_SHIP_PIRATE_RAIDER, count: 1, mounts: [FOE_MOUNT_IDS.chargePirate, FOE_MOUNT_IDS.captureWeb, FOE_MOUNT_IDS.gyroStabilizer] },
      { ship: FOE_SHIP_PIRATE_SKIFF, count: 2, tactic: 'orbit', dmgMix: { kinetic: 8, explosive: 2 }, mounts: [FOE_MOUNT_IDS.chargePirate, FOE_MOUNT_IDS.gyroStabilizer] },
    ],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 60,
    hidden: true,
    description: '虫洞内遭遇：头目亲自压阵的海盗战团（隐藏卡，只由虫洞生成）。',
  },
  /* ══════════ 2026-09-15 扩充 · C 族中/深两张（批 2）══════════ */
  {
    id: 'wh-alien-brood',
    foeFamily: 'C',
    name: '孢群兵潮',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    foeTargeting: 'smallest',
    foeTargetingChance: 0.4,
    dmgMix: { plasma: 8, explosive: 2 },
    // 编成 = **孢群异虫 ×1**（T3：近战母舰炮台 + 孢群机 ×3、`droneFireShare 0.6` 炮台让位给机群）
    //      + **星髓成虫 ×2**（T2 中坚）——船长 2026-09-16：「中层为孢群异虫 ×1+星髓成虫 ×2」
    // ⚠ **机群自本批起在层 2~3 出现**（孢群异虫由深档挪来 ⇒ 这两层开始需要防空属性武器）；
    //    ⚠ **它没有受击增程**（`droneRangeMulOnHit` 只有 E 族三舰有；船长 2026-09-16 追问后核实）。
    // `dmgMul 1.15` = 船长裁「C 族先折中」⇒ DPS 密度 **0.0406**（改前中层：A 0.0551 · C 0.0465 ·
    // D 0.0161 · G 0.0370 · E 0.0325）⇒ 落族间中位偏上。
    ships: [
      { ship: FOE_ALIEN_SPORE_HIVE, count: 1, dmgMul: 1.15 },
      { ship: FOE_ALIEN_STARCORE_ADULT, count: 2, dmgMul: 1.15 },
    ],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 50,
    hidden: true,
    description: '虫洞内遭遇：孢群异虫领着星髓成虫压上（隐藏卡，只由虫洞生成）。',
  },
  {
    id: 'wh-alien-hive',
    foeFamily: 'C',
    name: '噬口深巢',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    foeTargeting: 'smallest',
    foeTargetingChance: 0.4,
    dmgMix: { plasma: 8, explosive: 2 },
    // 编成 = **噬口巨兽 ×1**（T4 巨兽档：血 1600 / 单发 240 / 近战；`ALIEN_BEAST_SHIP_IDS` 白名单内 ⇒ 敌速契约豁免）
    //      + **星髓成虫 ×2**（T2 中坚）——船长 2026-09-16：「深层为噬口巨兽+2星髓成虫」；
    //      **同波上场**（船长同日裁「不做变化」= 不拆压轴波；洞内卡本就不自带波表、波次由层派生）
    // `dmgMul 0.94` = 船长裁「C 族先折中」⇒ DPS 密度 **0.0436**（改前深层：A 0.0640 · C 0.0450 ·
    // D 0.0342 · G 0.0338 · E 0.0605）⇒ 落族间中位（巨兽单发 240 本就重）。
    ships: [
      { ship: FOE_ALIEN_MAW, count: 1, dmgMul: 0.94 },
      { ship: FOE_ALIEN_STARCORE_ADULT, count: 2, dmgMul: 0.94 },
    ],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 60,
    hidden: true,
    description: '虫洞内遭遇：噬口巨兽盘踞的深巢（隐藏卡，只由虫洞生成）。',
  },
  /* ══════════ 2026-09-15 扩充 · D 族中/深两张（批 3）══════════ */
  {
    id: 'wh-grave-sentry',
    foeFamily: 'D',
    name: '静滞哨链',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    foeTargeting: 'top-output',
    foeTargetingChance: 0.4,
    // 两条舰级的有效构成都是等离子 8:2（D 族签名）⇒ **卡面与条目一致，无需覆写**
    dmgMix: { plasma: 8, kinetic: 2 },
    // 编成 = 守墓长舰 ×1（T3 中程光束）+ 静滞卫舰 ×1（T3 远程 kite · 12,000m · 挨打后 ×1.5）
    // ⚠ 同为**必中光束**族 ⇒ 沿用 0.5 的配平系数（待逐卡读数复核）
    ships: [
      { ship: FOE_D_LONGSHIP, count: 1, dmgMul: 0.5 },
      { ship: FOE_D_STASIS, count: 1, dmgMul: 0.5 },
    ],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 50,
    hidden: true,
    description: '虫洞内遭遇：一近一远两段静滞哨链（隐藏卡，只由虫洞生成）。',
  },
  {
    id: 'wh-grave-throne',
    foeFamily: 'D',
    name: '陵墓王庭',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    foeTargeting: 'top-output',
    foeTargetingChance: 0.4,
    // **卡面构成 = 主体舰级的自有口径**（等离子 6 : 动能 4，船长「按乙调整为 6:4」）
    // ⇒ 已在 `FOE_SHIP_MIX_AUTHORITY_IDS` 登记（"舰级口径优先"白名单），体检不再套通用 8:2。
    dmgMix: { plasma: 6, kinetic: 4 },
    // 编成 = **守墓王座舰 ×1**（船长 2026-09-15：「**深层是守墓王座舰×1**」；单舰 ⇒ 无条目覆写需要）
    // ＋ **支援呼叫装置的两支**（船长 2026-09-19：「**战斗开始20秒后，增援2艘幽灵舰。如果对方在自己
    // 最远射程之外时，增援2艘静滞卫舰。**」）：
    // - 判定 = 开战满 20 秒时，玩家在王座舰**当时有效的炮台最远射程**内 ⇒ 幽灵舰那一支；射程外 ⇒ 静滞卫舰；
    //   判完锁死（另一支本场不出现）；**原地入场**、打死在场者即胜（未到场的不计）。
    // - **份额（甲案：两支各自守恒）**：王座舰 **68% 血 / 72% 火力**（开战即在）；任一支援军
    //   **32% 血 / 28% 火力**（20 秒后）。两支账面相等（血 588 / 585 · 火力 17.5 / 17.7 DPS）——
    //   体检有守恒契约。倍率按引擎惯例**含多舰补偿折算**（本卡 5 单位 ⇒ `2N/(N+1)` = ×5/3 ⇒
    //   卡上 `dmgMul` = 设计单发 ÷（舰级单发 × 补偿））：设计单发 王座 181 · 幽灵 35×2 · 静滞卫舰 39×2。
    //   ⚠ 静滞卫舰装填 4,400ms（比幽灵舰慢）⇒ 单发取 39 才是"火力相等"（草案写 36 = 按单发相等，偏弱 9%）。
    // - **派生记账**：互斥的两支**只记较重的一支**（`wormholeSkippedBranch`）——否则没到场的那支白占
    //   预算、本卡会比同层同档弱约 24%，破「同层同档血×火力恒等」红线。
    // - **延迟补偿**：本卡派生时**实际威胁 ×1.1**（由「支援呼叫装置」的 `threatMul` 带来；
    //   该链上血与火力各 ×约 1.16）——船长 2026-09-19：「因为延迟到场，所以需要一定补偿」。
    ships: [
      { ship: FOE_D_THRONE, count: 1, hpMul: 0.68, dmgMul: 0.43 },
      // 幽灵舰那一支（玩家在射程内 ⇒ 咬上来）：分支量记号见左
      {
        ship: FOE_D_GHOST,
        count: 2,
        hpMul: 0.68,
        dmgMul: 0.44,
        enterAt: { sec: 20 },
        enterBranch: 'inside',
      },
      // 静滞卫舰那一支（玩家在射程外放风筝 ⇒ 换远火压回去）
      {
        ship: FOE_D_STASIS,
        count: 2,
        hpMul: 0.25,
        dmgMul: 0.19,
        enterAt: { sec: 20 },
        enterBranch: 'outside',
      },
    ],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 60,
    hidden: true,
    description: '虫洞内遭遇：陵寝最深处的王座守卫（隐藏卡，只由虫洞生成）。',
  },
  /* ══════════ 2026-09-15 扩充 · E 族中/深两张（批 4）══════════ */
  {
    id: 'wh-titan-missile',
    foeFamily: 'E',
    name: '导弹残响',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    // E 族族格（平台随机投送）⇒ **不写** `foeTargetingChance`（随机模式对该字段无意义）
    foeTargeting: 'random',
    // **卡面构成 = 主体舰级的自有口径**（纯爆炸，船长「伤害为100%纯爆炸」）
    // ⇒ 已在 `FOE_SHIP_MIX_AUTHORITY_IDS` 登记（"舰级口径优先"白名单），体检不套 E 族 5:5。
    dmgMix: { explosive: 10 },
    // 编成 = **导弹残段 ×1**（T3 静物导弹平台：**3,000~11,000m** · 近盲带伤害 ×0.3 · 命中不随距离衰减；
    // 2026-09-19 船长：「将导弹残段的基础射程降低为 11000」＋「挂载类似静滞卫舰的挨打后对方在射程外
    // 就增加射程的挂载件」⇒ 该舰级带 `foe-mount-gun-range-x1-5`（挨打 ×1.5 ⇒ 16,500m））
    ships: [{ ship: FOE_MISSILE_HULK, count: 1 }],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 60,
    hidden: true,
    description: '虫洞内遭遇：一截仍在齐射的导弹残段（隐藏卡，只由虫洞生成）。',
  },
  {
    id: 'wh-titan-hulk',
    foeFamily: 'E',
    name: '巨构压境',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    foeTargeting: 'random',
    // 卡面与主体一致（巨构残段 = 爆炸 6 : 动能 4，E 族全族口径）⇒ 无需覆写
    dmgMix: { explosive: 6, kinetic: 4 },
    // 编成 = **巨构残段 ×1**（船长 2026-09-15：「**E族浅层为奥罗残骸段，深层为巨构残骸段。**」；
    // T4 · 机群 7 架 · 受击增程 ×4）——本卡把"悬赏专属"的巨构残段接进洞内深层。
    ships: [{ ship: FOE_SHIP_TITAN_HULK, count: 1 }],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 60,
    hidden: true,
    description: '虫洞内遭遇：一整段巨构残骸与其警戒机群（隐藏卡，只由虫洞生成）。',
  },
  /* ══════════ 2026-09-15 扩充 · G 族中/深两张（批 5 · 收口）══════════ */
  {
    id: 'wh-exile-swarm',
    foeFamily: 'G',
    name: '残响蜂群',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    // G 族族格 = 蜂群乱战 ⇒ random（不写概率字段）
    foeTargeting: 'random',
    dmgMix: { kinetic: 8, explosive: 2 },
    // 编成 = **残响残舰 ×2**（船长 2026-09-15：「**中层为残响残舰*2**」，T2 orbit 环绕）
    ships: [{ ship: FOE_G_ECHO_REMNANT, count: 2, mounts: [FOE_MOUNT_IDS.hullRepair] }],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 50,
    hidden: true,
    description: '虫洞内遭遇：两艘残响残舰结成的蜂群（隐藏卡，只由虫洞生成）。',
  },
  {
    id: 'wh-exile-line',
    foeFamily: 'G',
    name: '残军战列线',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    foeTargeting: 'random',
    dmgMix: { kinetic: 8, explosive: 2 },
    // 编成 = **亡军战列舰 ×1**（船长 2026-09-15：「**高层为亡军战列舰*1**」＋「G族战列可以添加机群」→「挂」）
    // 该舰级本批**由"空置壳体"转为启用**，并挂蜂群机 ×3（动能 + 等离子 + 爆炸，三系齐备、无后备）。
    ships: [{ ship: FOE_G_EXILE_BATTLESHIP, count: 1, mounts: [FOE_MOUNT_IDS.hullRepair] }],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 60,
    hidden: true,
    description: '虫洞内遭遇：亡军最后的战列线与其蜂群护航（隐藏卡，只由虫洞生成）。',
  },
]

/** 逐卡 id 表（顺序 = 本表数组顺序；**三处必须逐字同序**：本表 / core 的 `WORMHOLE_FOE_CARD_IDS` /
 *  `content:check` 的洞内清单 —— 体检有契约钉住）。
 *
 * 2026-09-15 扩充后：每族浅/中/深三档（浅层五张在最前，旧索引不变）。
 * **取哪一张**由 core 的 `wormholeCardIdForRun`（族锁 + 层档位池）决定，不再是全表轮换。 */
export const WORMHOLE_FOE_CARD_IDS: readonly string[] = WORMHOLE_FOE_CARDS.map((c) => c.id)

/**
 * **洞内敌卡也要有「稀有残骸」物品**（F3b · 船长 2026-09-13：「打捞需要玩家舰船至少有一个打捞器…
 * 优先打捞稀有残骸…每 3 堆普通，进行一次稀有残骸出现判断」）。
 *
 * 为什么需要这张白名单：`context.ts` 注册稀有残骸物品的条件是 `hasLairCore(卡)`（窝点核心）——
 * 洞内卡**没有窝点核心**（它们不是窝点候选）⇒ 不白名单就**不存在 `wreck-rare-wh-*` 物品**，
 * 打捞出来的稀有残骸会解析不到定义、读档后显示成"未知物品"。
 * ⚠ **2026-09-15 更正**（原写"注册出来的物品一律 `unreleased`（施工期，与虫洞同批上线）"）：那个闸门
 * 随虫洞上线（2026-09-14）**漏摘**，后果 = 精炼炉「残骸回收」看不到洞内稀有残骸（船长当日报障）；
 * 现已按上线动作删字段 ⇒ 与窝点稀有残骸同款：**可回收、图鉴可见**。
 */
export const WORMHOLE_RARE_WRECK_CARD_IDS: readonly string[] = WORMHOLE_FOE_CARDS.map((c) => c.id)

/* ═══════════ 周末入侵 · 独立敌卡（2026-09-24 起 · M2 逐族铺开）═══════════
 * 口径来源：`docs/design/weekend-invasion.md` §三②（船长 2026-09-23：「**入侵战斗采用独立设计的卡
 * （之后设计），我们暂时先试用虫洞的**」）＋ 本批船长令「**设计每个种族的T5旗舰**」。
 *
 * **为什么 H 族必须有独立卡**：`weekendFoeCardOf` 对 A/C/G 走"该族的虫洞卡"（暂用口径），
 * 而 **H 族（墨潮帮）没有虫洞卡**（它不是虫洞族）⇒ 入侵必须给它一张**自家卡**。
 * 三族（A/C/G）本轮仍走虫洞卡，等各自旗舰卡设计好再逐族迁到本段（M2 逐族落地）。
 *
 * ⚠ **本段的卡只服务周末入侵**：`hidden: true`（不进悬赏目录、不被派发）· 无窝点核心（`lairCore` 不写）
 * ⇒ 不参与窝点/稀有残骸链路；威胁与波数由入侵侧覆盖（外围 78 / 核心 120 · 旗舰 4 波 4 艘），
 * 卡上的 `threat` 只是**缩放锚点**。
 */

/**
 * **墨潮帮 · 旗舰战卡**（H 族旗舰 = 墨潮旗舰 ×1）。
 *
 * 编成只写**旗舰本体**：它是**旗舰卡**（`weekendFlagshipSpecOf` 的 4 波 × 4 艘由入侵侧覆写波表），
 * 外围的普通舰队用 `ink-assault`。两条都用 H 族壳体 ⇒ 玩家在入侵里打的每一个敌人都出自本族。
 */
export const WEEKEND_INK_FLAGSHIP_CARD: AnomalyDef = {
  id: 'ink-flagship',
  foeFamily: 'H',
  name: '墨潮旗舰',
  galaxyId: 'galaxy-hub', // 只作日志/展示归属；本卡不进任何星系目录（hidden）
  region: 'wh', // 卡级地区覆写：入侵卡与洞内卡同口径（否则会被按高安卡核）
  threat: ANCHOR_THREAT, // 缩放锚点（实际威胁由入侵覆盖 120）
  foeTargeting: 'random', // 帮派乱战（不做选靶性格；旗舰是单舰，写了也无意义）
  dmgMix: { kinetic: 8, explosive: 2 }, // 与 H 族壳体签名一致（契约要求卡面 = 编成主体）
  ships: [{ ship: FOE_H_INK_FLAGSHIP, count: 1 }],
  standingReq: 0,
  standingGain: 0,
  rewardIsk: 0,
  loot: [], // 奖励由入侵侧发（黑匣 ＋ 稀有残骸；卡上不给）
  combatSeconds: 90, // 旗舰战给足时间（4 波）
  hidden: true,
  description: '周末入侵：墨潮帮的旗舰（隐藏卡，只由入侵活动生成）。',
}

/**
 * **墨潮帮 · 普通舰队卡**（H 族外围/遇袭用：突击舰 ×2 ＋ 狙击舰 ×1）。
 *
 * 编成取"帮派混编"（近战主力 ＋ 远程压制）——威胁由入侵覆盖（外围主动 78 / 遇袭 39）。
 */
export const WEEKEND_INK_ASSAULT_CARD: AnomalyDef = {
  id: 'ink-assault',
  foeFamily: 'H',
  name: '墨潮帮舰队',
  galaxyId: 'galaxy-hub',
  region: 'wh', // 同上：卡级地区覆写（入侵卡）
  threat: ANCHOR_THREAT,
  foeTargeting: 'random',
  dmgMix: { kinetic: 8, explosive: 2 },
  ships: [
    { ship: FOE_H_INK_CORVETTE, count: 2 },
    // 狙击舰的舰级签名是爆炸 8:2，本卡按 H 族签名（动能 8:2）统一 ⇒ **条目级覆写**
    // （与 A 族洞内卡同款做法：卡面 = 每条主体的有效构成，契约要求两侧一致）
    { ship: FOE_H_INK_SNIPER, count: 1, dmgMix: { kinetic: 8, explosive: 2 } },
  ],
  standingReq: 0,
  standingGain: 0,
  rewardIsk: 0,
  loot: [],
  combatSeconds: 50,
  hidden: true,
  description: '周末入侵：墨潮帮的劫掠舰队（隐藏卡，只由入侵活动生成）。',
}

/** 周末入侵·独立卡的 id（core 的 `weekendFoeCardOf` 按族路由到它们；**本表是唯一登记处**） */
export const WEEKEND_FOE_CARD_IDS = {
  /** H 族（墨潮帮）：旗舰战卡 */
  H_flagship: WEEKEND_INK_FLAGSHIP_CARD.id,
  /** H 族（墨潮帮）：普通舰队卡 */
  H_assault: WEEKEND_INK_ASSAULT_CARD.id,
} as const

/** 周末入侵·独立卡清单（`data/context.ts` 把它们并进 `ANOMALIES_FLAVORED` ⇒ 引擎 `ctx.anomalies` 能取到） */
export const WEEKEND_FOE_CARDS: readonly AnomalyDef[] = [WEEKEND_INK_FLAGSHIP_CARD, WEEKEND_INK_ASSAULT_CARD]
