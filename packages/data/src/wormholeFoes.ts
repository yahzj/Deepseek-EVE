/**
 * **终局玩法「虫洞」· 洞内敌卡**（F 批 · 2026-09-13）。
 *
 * 口径来源：`docs/design/wormhole-extraction-endgame-20260912.md`
 * §3（节点与层末 BOSS）· §8「层末 BOSS = 复用舰级表」· §10 F 批。
 *
 * 四张卡 = **四个族的洞内常驻编成**（A 海盗 / C 异形 / D 守墓 / G 鱿烬），一卡一图层轮换
 * （`wormholeCardIdFor(depth, nodeIndex)`，确定性）。
 *
 * **威胁不是写死的本卡强度**：卡上 `threat` 只是**缩放锚点**（= 第 1 层基准威胁 45），
 * 实际用哪一层由 core 的 `wormholeAnomalyOf(base, depth, kind, waves)` **按层换算**：
 * 层末 BOSS ×1.2、撤离战 ×0.8、普通节点 ×1.0（见 `WORMHOLE_BOSS_THREAT_MUL` 等常量）。
 *
 * ⚠ **施工期对玩家不可见**：四张卡一律 `hidden: true`（不进悬赏目录、不被派发、不参与族级设计契约），
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
