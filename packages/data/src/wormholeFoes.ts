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
import type { AnomalyDef } from '@whale/core'
import {
  FOE_ALIEN_RIFT,
  FOE_ALIEN_SPORE_HIVE,
  FOE_ALIEN_STARCORE,
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
    ships: [{ ship: FOE_SHIP_PIRATE_CORVETTE, count: 2, speedMul: 0.9 }],
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
    name: '巢群游猎',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    // 异形捕食弱者 ⇒ 打**最小的**（按舰种档）——**族定选靶**（船长 2026-09-15「选靶按照族限定」）
    foeTargeting: 'smallest',
    // 倾向概率 0.4（同批：四成盯着最小的那艘，六成乱咬）
    foeTargetingChance: 0.4,
    // 混伤 8:2（主等离子 = C 族酸液签名 / 副爆炸）
    dmgMix: { plasma: 8, explosive: 2 },
    // 编成 = **星髓幼虫 ×4**（船长 2026-09-15：「**C族浅层为星髓虫×4**」，T1 快、等离子、贴脸撕咬）
    ships: [{ ship: FOE_ALIEN_STARCORE, count: 4 }],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 40,
    hidden: true,
    description: '虫洞内遭遇：异形巢群的游猎小队（隐藏卡，只由虫洞生成）。',
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
    ships: [{ ship: FOE_G_SWARM_SKIFF, count: 3 }],
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
    // 混伤 **50% 动能 + 50% 爆炸**（船长 2026-09-11「该系敌人伤害比例为 50% 爆炸 50% 动能」；E 族族格）
    dmgMix: { kinetic: 5, explosive: 5 },
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
    ships: [
      { ship: FOE_SHIP_PIRATE_CORVETTE, count: 2, speedMul: 0.9 },
      { ship: FOE_SHIP_PIRATE_SKIFF, count: 1, dmgMix: { kinetic: 8, explosive: 2 } },
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
    // 编成 = 海盗头目舰 ×1（brawl 精锐）+ 海盗快艇 ×3（brawl 贴脸）——A 族悬赏线的经典"头目 + 杂鱼 ×3"
    // ⚠ 快艇舰级自带「爆炸 8 : 动能 2」⇒ 同前，条目覆写回本卡签名构成
    ships: [
      { ship: FOE_SHIP_PIRATE_WARLORD, count: 1 },
      { ship: FOE_SHIP_PIRATE_SKIFF, count: 3, dmgMix: { kinetic: 8, explosive: 2 } },
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
    name: '巢群兵潮',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    foeTargeting: 'smallest',
    foeTargetingChance: 0.4,
    dmgMix: { plasma: 8, explosive: 2 },
    // 编成 = 星髓成虫 ×1（T2 唯一驱逐档，装甲型、单体硬）+ 畸变幼虫 ×2（T1 快虫包夹）
    // ⇒ 两条舰级的有效构成都是等离子 8:2 ⇒ **卡面与条目一致，无需覆写**
    ships: [
      { ship: FOE_ALIEN_STARCORE_ADULT, count: 1 },
      { ship: FOE_ALIEN_RIFT, count: 2 },
    ],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 50,
    hidden: true,
    description: '虫洞内遭遇：成虫带队压上的巢群兵潮（隐藏卡，只由虫洞生成）。',
  },
  {
    id: 'wh-alien-hive',
    foeFamily: 'C',
    name: '孢群巢穴',
    galaxyId: 'galaxy-hub',
    threat: ANCHOR_THREAT,
    foeTargeting: 'smallest',
    foeTargetingChance: 0.4,
    dmgMix: { plasma: 8, explosive: 2 },
    // 编成 = **孢群异虫 ×1**（T3 无人机舰：母舰炮台近战、孢群机 ×3 中距投送）+ 畸变幼虫 ×2
    // ⇒ C 族**唯一带机群**的洞内编成，也是"炮台让位给机群"（`droneFireShare 0.6`）的唯一落点
    ships: [
      { ship: FOE_ALIEN_SPORE_HIVE, count: 1 },
      { ship: FOE_ALIEN_RIFT, count: 2 },
    ],
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 60,
    hidden: true,
    description: '虫洞内遭遇：孢群异虫与其护卫虫群（隐藏卡，只由虫洞生成）。',
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
    ships: [{ ship: FOE_D_THRONE, count: 1 }],
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
    // 编成 = **导弹残段 ×1**（T3 静物导弹平台：100~15,000m · 无视近盲 · 命中不随距离衰减）
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
    // 卡面与主体一致（巨构残段 = 动能 5 : 爆炸 5，E 族全族口径）⇒ 无需覆写
    dmgMix: { kinetic: 5, explosive: 5 },
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
    ships: [{ ship: FOE_G_ECHO_REMNANT, count: 2 }],
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
    ships: [{ ship: FOE_G_EXILE_BATTLESHIP, count: 1 }],
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
 * 洞内四张卡**没有窝点核心**（它们不是窝点候选）⇒ 不白名单就**不存在 `wreck-rare-wh-*` 物品**，
 * 打捞出来的稀有残骸会解析不到定义、读档后显示成"未知物品"。
 * 注册出来的物品一律 `unreleased`（施工期对玩家不可见，与虫洞同批上线）。
 */
export const WORMHOLE_RARE_WRECK_CARD_IDS: readonly string[] = WORMHOLE_FOE_CARDS.map((c) => c.id)
