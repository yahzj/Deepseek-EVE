/**
 * **终局玩法「虫洞」· 洞内敌卡**（F 批 · 2026-09-13）。
 *
 * 口径来源：`docs/design/wormhole-extraction-endgame-20260912.md`
 * §3（节点与层末 BOSS）· §8「层末 BOSS = 复用舰级表」· §10 F 批。
 *
 * **五张卡 = 五个族的洞内常驻编成**（A 海盗 / C 异形 / D 守墓 / E 巨构 / G 鱿烬），一卡一图层轮换
 * （`wormholeCardIdFor(depth, nodeIndex)`，确定性）。
 *
 * ⚠ **2026-09-13 补第五张（E 族）**：船长裁定「**虫洞专属掉落按种族库走，蓝图也是按种族库。
 * 你顺便补上空缺的种族。**」——五族掉落池要"每族都有来源"，而洞内原本只有四张卡（缺 E）⇒ 见下方
 * `wh-titan-echo`。E 族此前在 `wormhole-exclusive-20260913.md` §2 就标着"掉落池暂时无来源"。
 *
 * **威胁不是写死的本卡强度**：卡上 `threat` 只是**缩放锚点**（= 第 1 层基准威胁 45），
 * 实际用哪一层由 core 的 `wormholeAnomalyOf(base, depth, kind, waves)` **按层换算**：
 * 层末 BOSS ×1.2、撤离战 ×0.8、普通节点 ×1.0（见 `WORMHOLE_BOSS_THREAT_MUL` 等常量）。
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
  FOE_D_GHOST,
  FOE_D_LONGSHIP,
  FOE_G_SWARM_SKIFF,
  FOE_SHIP_AURO_HULK,
  FOE_SHIP_PIRATE_CORVETTE,
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
    // 异形捕食弱者 ⇒ 打**最小的**（按舰种档）
    foeTargeting: 'smallest',
    // 混伤 8:2（主等离子 = C 族酸液签名 / 副爆炸）
    dmgMix: { plasma: 8, explosive: 2 },
    // 编成 = 畸变幼虫 ×3（T1，快、等离子、贴脸撕咬）
    ships: [{ ship: FOE_ALIEN_RIFT, count: 3 }],
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
    // 混伤 8:2（主等离子 = D 族「以能量武器为主」/ 副动能）
    dmgMix: { plasma: 8, kinetic: 2 },
    // 编成 = 守墓长舰 ×1（T3 中程光束）+ 幽灵舰 ×1（T2 快船）
    // ⚠ **伤害系数 0.5**（F 批逐卡配平 · 2026-09-13）：本卡主炮是**光束（必中）**，同一血预算下
    // 实收远高于掷命中的卡（校准读数：第 2 层节点残血 93%→41%、层末守卫直接 0% 胜）
    // ⇒ 用 `dmgMul` 把"血/火力比"压回来；总血仍由 core 的按层预算（按卡归一）说了算。
    ships: [
      { ship: FOE_D_LONGSHIP, count: 1, dmgMul: 0.5 },
      { ship: FOE_D_GHOST, count: 1, dmgMul: 0.5 },
    ],
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
    // 混伤 8:2（主动能 / 副爆炸 = G 族蜂群炮台构成）
    dmgMix: { kinetic: 8, explosive: 2 },
    // 编成 = 围攻残兵舰 ×2（T1 蜂群压制）
    ships: [{ ship: FOE_G_SWARM_SKIFF, count: 2 }],
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
]

/** 轮换用的卡 id 表（顺序即轮换顺序；core 侧按 `(depth, nodeIndex)` 确定性取用） */
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
