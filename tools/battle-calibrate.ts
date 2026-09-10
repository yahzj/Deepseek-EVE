/**
 * V18/C4 战斗校准工具（替代 V12 旧版）：真实模拟胜率矩阵。
 *
 * 用法：npx tsx tools/battle-calibrate.ts
 * - 对每条"船 × 装配 × 技能档"跑 SEEDS 场确定性实战（advanceBattleFor 推到分出胜负/
 *   时间上限），输出平均胜率 % + 平均交火秒数 + 我方平均残血% —— 校准依据 = 真实结算，
 *   不是稳态近似（接近期/射程错位/随机目标都如实计入）。
 * - 装配行：裸船 / 三族 MK1·MK2·MK3 / 三形态混装演示 / 支援件满 / 无人机流 D1-D3
 *   （2026-09-08 二号 C6：此前校准从未覆盖无人机——见 LOADOUTS 无人机段）。
 * - 技能档：无技能 / 中位技能（战斗系 Lv3）/ 全战斗技能 5。
 * - **可选开关 `--charge`**（2026-09-10 船长「这几个需要先跑通战斗再决策」）：**只把本工具的上下文**
 *   里 `foeChargeEnabled` 置 true，用来跑"高威胁近战敌突进若启用了会怎样"的对照矩阵。
 *   **不动引擎默认值**（balance 里仍是 false = 未实装）——纯测量，供决策，不改游戏。
 * - **可选开关 `--proposal`**（2026-09-10 船长「决定对速度进行重新调整」）：按提案的**敌速重标口径**
 *   替换全 26 卡敌速（`PROPOSED_FOE_SPEED`），并可叠加 `--dps=<值>`（foeDpsPerThreat）与
 *   `--hpmul=<倍率>`（逐卡总血同乘）做灵敏度扫描。**同样只改本工具上下文**：引擎默认值与
 *   `data/anomalies.ts` 一律不动 —— 纯预演，供船长审核后再落码。
 */
import { addShipToFleet, createInitialState, repairDeprecatedModules, type GameState, type SimContext } from '@whale/core'
import { ANOMALIES, SHIPS, buildSimContext } from '@whale/data'
import { advanceBattleFor, createFoeSpecs, createPlayerSpec, foeHpOfThreat, foeRefSpeedMps, startBattleFor, waveGapTotalMs } from '../packages/core/src/combat'

const BASE_CTX = buildSimContext()
/** 敌突进对照开关（只影响本工具；引擎默认仍是"未实装"） */
const CHARGE_ON = process.argv.includes('--charge')
/** 敌速重标提案预演开关（只影响本工具；引擎与 data 一律不动） */
const PROPOSAL = process.argv.includes('--proposal')

/**
 * 敌速重标提案（2026-09-10 船长口径：brawl 1.25→1.40×、orbit 0.95→1.05×、kite 维持现状）。
 *
 * 比率定义 = **敌战斗机动 ÷ 玩家战斗机动**，玩家取"该威胁段参考船（220/250/280/300/320 船速）、
 * 敏捷 0.5、无矢量机动学、不装推进器"。换算：敌速(存储值) = 比率 × 参考船速 ÷ 0.94
 * （敌方敏捷固定 0.3 → 战斗机动 = 存储值 ×0.6×0.94；玩家 = 参考船速 ×0.6）。
 * s = clamp((威胁−6)/90, 0, 1)：brawl 比率 = 1.25+0.15s，orbit 比率 = 0.95+0.10s。
 * kite 维持现状（落在船长给的口径带 0.65~0.80 内，且是"玩家可追上钻近盲"的设计支点）。
 */
const PROPOSED_FOE_SPEED: Record<string, number> = {
  // brawl（11 张）：1.25→1.40×
  'ano-training': 293,
  'ano-harbor-escort': 294,
  'ano-pirate-post': 335,
  'ano-shard-bandits': 339,
  'enc-pirate-3': 389,
  'ano-chasm-aberrations': 398,
  'ano-titan-wreck': 399,
  'ano-auro-raiders': 400,
  'enc-pirate-4': 433,
  'ano-starcore-boss': 434,
  'ano-gravekeeper': 443,
  // orbit（10 张）：0.95→1.05×
  'enc-pirate-1': 223,
  'ano-abandoned-platform': 256,
  'ano-lantern-saboteurs': 257,
  'enc-pirate-2': 257,
  'ano-cinder-siege': 295,
  'ano-echo-haunt': 298,
  'ano-nadir-static': 324,
  'ano-maw-hunt': 329,
  'ano-voidedge-warden': 332,
  'ano-vault-sentinel': 357,
  // kite（5 张）：维持现状
  'ano-haze-ambush': 201,
  'ano-redring-raiders': 204,
  'ano-abyss-guard': 234,
  'ano-ghost-signal': 234,
  'ano-mirage-hijackers': 235,
}

function argNum(name: string): number | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!hit) return undefined
  const v = Number(hit.slice(name.length + 3))
  return Number.isFinite(v) ? v : undefined
}
const PROPOSAL_DPS = argNum('dps')
const PROPOSAL_HP_MUL = argNum('hpmul')
/** 只对 brawl（近战）卡生效的总血乘数——用于"速度上调后近战卡血量该压多少"的灵敏度扫描 */
const PROPOSAL_BRAWL_HP_MUL = argNum('brawlmul')

/** 组装本工具上下文：只有被开关点名的部分会被覆盖，其余与出厂一致 */
function buildCtx(): SimContext {
  let c = BASE_CTX
  if (CHARGE_ON) {
    c = { ...c, balance: { ...c.balance, battle: { ...c.balance.battle, foeChargeEnabled: true } } }
  }
  if (PROPOSAL) {
    const battle = { ...c.balance.battle, foeSpeedCapMul: 1.55 }
    if (PROPOSAL_DPS !== undefined) battle.foeDpsPerThreat = PROPOSAL_DPS
    const anomalies = new Map(c.anomalies)
    for (const [id, a] of c.anomalies) {
      const next = { ...a }
      const spd = PROPOSED_FOE_SPEED[id]
      if (spd !== undefined) next.foeSpeedMps = spd
      const mul = (a.tactic ?? 'orbit') === 'brawl' ? PROPOSAL_BRAWL_HP_MUL : PROPOSAL_HP_MUL
      if (mul !== undefined) {
        next.foeHpOverride = Math.round((a.foeHpOverride ?? foeHpOfThreat(a.threat, battle)) * mul)
      }
      anomalies.set(id, next)
    }
    c = { ...c, anomalies, balance: { ...c.balance, battle } }
  }
  return c
}

const ctx: SimContext = buildCtx()
const SEEDS = [1, 7, 13, 29, 51]

type Loadout = {
  name: string
  ship: string
  high: string[]
  mid?: string[]
  low?: string[]
  drones?: Record<string, number>
  /** 弹药 MK2（2026-09-09）：本行开战预载弹档（装配档位 ammoPref；缺省 = 基础弹） */
  ammoTier?: Partial<Record<'kinetic' | 'explosive' | 'plasma', string>>
}
const LOADOUTS: Loadout[] = [
  { name: '裸船(基础舰炮)', ship: 'sh-falconet', high: [] },
  { name: '鲣鱼+动能MK1', ship: 'sh-falconet', high: ['mod-turret-kin-1'] },
  { name: '鲣鱼+动能MK3', ship: 'sh-falconet', high: ['mod-turret-kin-3'] },
  { name: '鲣鱼+导弹MK3', ship: 'sh-falconet', high: ['mod-missile-3'] },
  { name: '鲣鱼+激光MK3', ship: 'sh-falconet', high: ['mod-laser-3'] },
  { name: '虎鲨三族混装(2kin2+laser2+missile2)', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-laser-2', 'mod-missile-2'] },
  { name: '虎鲨2kin2+支援(索敌/陀螺/稳定)', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-rof-2'] },
  { name: '鲸王+动能MK3×3', ship: 'whale-king', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'] },
  /* ── P1 阶段锚行（2026-09-06 战力拉长设计稿：威胁重标按"阶段真实可及配装"标定）── */
  { name: 'S1 虎鲨4×MK2', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-prop-1'] }, // 2026-09-09 敌速口径（船长）：低技能参考行带矢量推进器 MK1（无技能玩家标配）
  { name: 'S2 灰鲭鲨4×MK2+支援', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] }, // 2026-09-09 敌速口径（船长）：中位参考行带 MK2（弃闪避陀螺保盾容+索敌——站桩对射卡不吃闪避）
  { name: 'S4 大白鲨5×MK3+支援', ship: 'sh-whiteshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  /* ── T3 巡洋舰线（2026-09-09 尺寸分级新增；MK3 满配 + 支援对照 S4 上层）── */
  { name: 'T3电鳐激光巡5×laser3+支援', ship: 'sh-electricray', high: ['mod-laser-3', 'mod-laser-3', 'mod-laser-3', 'mod-laser-3', 'mod-laser-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  { name: 'T3长尾鲨导弹巡5×msl3+支援', ship: 'sh-thresher', high: ['mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  { name: 'T3锤头鲨炮巡5×kin3+支援', ship: 'sh-hammerhead', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  { name: 'T3牛鲨突击巡5×kin3+重盾', ship: 'sh-bullshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2'] },
  /* ── 无人机流行（2026-09-08 无人机舱大改：装载只读 droneLoad 清单（不再仓库贪心）；
     各行清单 = 该船「装配后余 CPU × 舱容」内可装的合法满载组合（战斗只放飞已装入的，
     超额由 UI 预占互斥，不会出现）；同船炮流对照见 S1/S2/S4）
     ── 2026-09-10 船长：无人机专用舰高槽 −2（梭鱼 5→3、王鲭 6→4）——D1/D2 由四槽改三槽，
        新增 D2b 展示"槽位吃紧后把单件导控升到 MK3"的取舍；D3 四槽恰好占满 ── */
  { name: 'D1 梭鱼无人机轻装(rack1×2+tac1)', ship: 'sh-swarm', high: ['mod-drone-rack-1', 'mod-drone-rack-1', 'mod-drone-tac-1'], drones: { 'drone-scout': 12, 'drone-assault': 10, 'drone-heavy': 1 } }, // 舱 190m³（rack1×2）：12×5+10×10+1×20 = 180 满载（2026-09-09 体积档 5/10/20/40）；3 高槽
  { name: 'D2 梭鱼无人机中装(rack2×2+tac2)', ship: 'sh-swarm', high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2'], drones: { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 } }, // 舱 230m³：10×10+4×20+1×40 = 220；3 高槽
  { name: 'D2b 梭鱼(rack2×2+tac3·槽位吃紧后升级)', ship: 'sh-swarm', high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-3'], drones: { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 } }, // 同舱容，单件导控 MK2→MK3（+25%→+40%；CPU 30+45+130=205 ≤ 235）
  { name: 'D3 王鲭无人机重装(rack3×2+tac3×2)', ship: 'sh-sentinel', high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'], drones: { 'drone-heavy': 4, 'drone-sentry': 6 } }, // 舱 460m³：4×20+6×40 = 320；4 高槽恰好占满
  /* ── 2026-09-10 重大机制变更后的「预想装配」适配行（船长：预想装配最好也适配更新）──
     ①**混伤适配（常驻 8:2 = 主系 80% + 副系 20%）**：原锚行一律「盾抗动能 + 甲抗动能」只堆主系；
       但**动能对甲层本就 ×0.5 克制**（类型克制表：动能 盾 ×1.5 / 甲 ×0.5），在甲层再堆动能抗属低效，
       混伤后副系（能量）绕开主抗 → 适配版 = **盾抗主系、甲抗副系**（覆盖两系）。
     ②**推进器周期点火适配（点火 60 秒 / 冷却 60 秒、顶档 +100%）**：原装配表**没有任何 MK3 推进器行**
       （S1 用 MK1、S2 用 MK2）→ 补一行顶档高机动参照，与同船无推进器版对比。 */
  { name: 'S2 双抗(盾动能·甲能量)', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-pla-2'] }, // 混伤适配：甲层换副系能量抗（对照 S2 原行 = 甲抗动能）
  { name: 'S4 双抗(盾动能·甲能量)', ship: 'sh-whiteshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-pla-2'] }, // 同上，顶配锚行版
  { name: 'T3锤头鲨+推进器MK3(周期点火)', ship: 'sh-hammerhead', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-prop-3'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] }, // 换掉闪避陀螺（点火期 +100% 机动，闪避价值下降）
  /* ── 弹药 MK2 变体（2026-09-09：顶配参考行 + 动能弹 MK2——攻坚耗材定位，E 段失衡与否验证） ── */
  { name: 'S4+动能弹MK2(5×kin3+支援)', ship: 'sh-whiteshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'], ammoTier: { kinetic: 'ammo-kinetic-2' } },
  { name: 'T3牛鲨+动能弹MK2(重盾)', ship: 'sh-bullshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2'], ammoTier: { kinetic: 'ammo-kinetic-2' } },
]

const FULL_SKILLS: Record<string, number> = {
  gunnery: 5,
  'kinetic-gunnery': 5,
  'missile-launching': 5,
  'laser-cannon': 5,
  'fire-control': 5,
  'reload-drills': 5,
  'drone-warfare': 5,
  'drone-servicing': 5,
  'ammunition-condensing': 5,
  'shield-operation': 5,
  'energy-management': 5,
  'hull-upgrades': 5,
  'shield-tuning': 5,
  'armor-tuning': 5,
  'armed-ops': 5,
  'armored-ops': 5,
  'vector-maneuvering': 5,
  'evasion-maneuvering': 5,
  'targeting-integration': 5,
  'ship-systems-engineering': 5,
}

/** 中位技能档（船长 2026-09-06：技能=独立于装备的局外成长，敌人设计对其宽容——
 * 在 0/满 之间加中位参照：同一批技能统一 Lv3） */
const MID_SKILLS: Record<string, number> = Object.fromEntries(Object.keys(FULL_SKILLS).map((k) => [k, 3]))

function makeState(shipId: string, ld: Loadout, skills: Record<string, number>, seed: number): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 20_000_000
  addShipToFleet(state, shipId)
  state.shipId = shipId
  for (const [id, lv] of Object.entries(skills)) state.skills.trained[id] = lv
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  // 2026-09-08（无人机舱大改：装载只读清单——写入驾驶船 droneLoad，仓库库存不再参与装载）
  const entry = state.fleet[shipId]!
  if (ld.drones && Object.keys(ld.drones).length > 0) entry.droneLoad = { ...ld.drones }
  entry.fitted = { high: [...(ld.high ?? [])], mid: [...(ld.mid ?? [])], low: [...(ld.low ?? [])] }
  // 弹药 MK2（2026-09-09）：变体行带档位 + 仓库补足 MK2 弹（预载需求同基础弹量）
  if (ld.ammoTier) {
    entry.ammoPref = { ...ld.ammoTier }
    for (const id of Object.values(ld.ammoTier)) state.warehouse.items[id] = 5_000
  }
  repairDeprecatedModules(state, ctx as SimContext)
  return state
}

/** 真实模拟一局：返回 胜/时长ms/我方残血比 */
function simulate(state: GameState, anomalyId: string): { win: boolean; durMs: number; meRemain: number } {
  const battle = startBattleFor(state, ctx as SimContext, state.shipId, anomalyId, 0)
  if (!battle) return { win: false, durMs: 0, meRemain: 0 }
  state.gameMs = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(anomalyId), ctx.balance.battle)
  advanceBattleFor(state, ctx as SimContext, battle, state.shipId, anomalyId)
  const durMs = Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs))
  const u = battle.units['player']
  const meHp = u ? u.hp.s + u.hp.a + u.hp.h : 0
  const specInit = state.fleet[state.shipId]
  void specInit
  const meRemain = meHp
  return { win: battle.ended === 'me', durMs, meRemain }
}

/** 装配总初始血（残血比用；直接在 seed1 state 上算） */
function initHpOf(shipId: string): number {
  const def = SHIPS.find((s) => s.id === shipId) ?? SHIPS.find((s) => s.id === shipId.replace(/^sh-/, ''))
  if (!def) return 0
  return (def.shieldHp ?? 0) + (def.armorHp ?? 0) + (def.hullHp ?? 0)
}

async function main(): Promise<void> {
  const threats = [...ANOMALIES].sort((a, b) => a.threat - b.threat)
  console.log('══ C4 战斗校准（真实模拟胜率）══')
  console.log(
    CHARGE_ON
      ? '⚠ 对照模式：**高威胁近战敌突进已临时开启**（威胁≥60 且 brawl、够不着时机动 ×2、进射程维持 2s、冷却 20s）——仅本工具，引擎默认仍为未实装'
      : '（敌突进按出厂默认 = 未实装；要看启用后的对照加 `--charge`）',
  )
  console.log('威胁梯度：' + threats.map((a) => `${a.name}=${a.threat}`).join(' '))
  if (PROPOSAL) {
    console.log(
      '⚠ 预演模式：**敌速按重标提案替换**（brawl 1.25→1.40× / orbit 0.95→1.05× / kite 维持现状）' +
        '——仅本工具，引擎默认与 data/anomalies.ts 一律未改',
    )
    if (PROPOSAL_DPS !== undefined) console.log(`  ・foeDpsPerThreat → ${PROPOSAL_DPS}（出厂 0.8）`)
    if (PROPOSAL_HP_MUL !== undefined) console.log(`  ・全卡总血 ×${PROPOSAL_HP_MUL}`)
    if (PROPOSAL_BRAWL_HP_MUL !== undefined) console.log(`  ・近战(brawl)卡总血 ×${PROPOSAL_BRAWL_HP_MUL}`)
  }
  // 时长预期行（C4 血量曲线 D(T)，纯对射口径；模拟时长含接近期故应 ≥ D）
  const dExpect = (t: number): number =>
    Math.round((bal.foeHpCurveDMin + bal.foeHpCurveDSpan * Math.pow(Math.min(1, Math.max(0, (t - bal.foeHpCurveFloorThreat) / bal.foeHpCurveSpanThreat)), bal.foeHpCurveExp)) * 10) / 10
  console.log(
    '预期击杀D(T)：' +
      threats.map((a) => `${a.threat}:${dExpect(a.threat)}s`).join(' '),
  )
  console.log('敌血 foeHpOfThreat：' + threats.map((a) => `${a.threat}:${foeHpOfThreat(a.threat, bal)}`).join(' '))
  for (const skillName of ['无技能', '中位技能(战斗系Lv3)', '全战斗技能5']) {
    const skills = skillName === '无技能' ? {} : skillName.startsWith('中位') ? MID_SKILLS : FULL_SKILLS
    console.log(`\n—— 技能档：${skillName}（每格 = 胜率%｜平均秒数｜战后残血%，${SEEDS.length} 种子实战平均）——`)
    for (const ld of LOADOUTS) {
      const initHp = initHpOf(ld.ship)
      const cells: string[] = []
      for (const a of threats) {
        let wins = 0
        let durSum = 0
        let remainSum = 0
        let ends = 0
        for (const seed of SEEDS) {
          const state = makeState(ld.ship, ld, skills, seed)
          const r = simulate(state, a.id)
          if (r.win) wins++
          if (r.durMs > 0) {
            durSum += r.durMs
            ends++
          }
          remainSum += r.meRemain
        }
        const wp = Math.round((wins / SEEDS.length) * 100)
        const dur = ends > 0 ? Math.round(durSum / ends / 1000) : 0
        const rem = initHp > 0 ? Math.round((remainSum / SEEDS.length / initHp) * 100) : 0
        cells.push(`${wp}/${dur}s/${rem}%`)
      }
      console.log(`${ld.name.padEnd(34)} ${cells.join('  ')}`)
    }
  }

  /* C4-#3 校验段：敌方虚拟装配推导结果（射程/速度 vs 玩家参考） */
  console.log('\n—— 敌方虚拟装配校验（射程=封顶后最大值；速度 = **敌战斗机动 ÷ 同段参考船战斗机动**）——')
  console.log('（2026-09-10 更正读数：旧「近战贴脸系数」把敌速（船速池单位）除以玩家**战斗**速度，单位混算、虚高约 1.67 倍）')
  const foeAgilityMul = 0.6 * (1 + (0.3 - 0.5) * 2 * bal.agilitySpeedBonus)
  for (const a of threats) {
    const eff = ctx.anomalies.get(a.id) ?? a
    const foes = createFoeSpecs(eff, bal)
    const f0 = foes[0]!
    const fmax = f0.weapons[0]!.maxRangeM
    const capped = fmax >= bal.foeRangeCapM ? ' *封顶' : ''
    const ref = foeRefSpeedMps(eff.threat, bal)
    const foeCombat = f0.speedMps * foeAgilityMul
    const refCombat = ref * bal.speedFactor
    const ratio = foeCombat / Math.max(1, refCombat)
    console.log(
      `${String(eff.threat).padStart(3)} ${eff.name.padEnd(12)} ${String(eff.tactic ?? 'orbit').padEnd(6)} ` +
        `敌射程 ${(fmax / 1000).toFixed(1)}km${capped}  敌速 ${f0.speedMps}（参考船 ${ref}）  ` +
        `战斗机动 ${Math.round(foeCombat)} vs 参考船 ${Math.round(refCombat)} → **×${ratio.toFixed(2)}**`,
    )
  }
  /* 速度口径校验（提案预演用）：把"目标比率"与"玩家实际战斗机动"对上——
   * 段参考船只是口径基准；玩家在该段实际会开的船 + 该技能档才是真实分母。 */
  if (PROPOSAL) {
    const KEY_CARDS = [
      { id: 'ano-pirate-post', label: '边境12' },
      { id: 'enc-pirate-3', label: '狂徒40' },
      { id: 'ano-titan-wreck', label: '泰坦60' },
      { id: 'ano-starcore-boss', label: '星髓72' },
      { id: 'ano-gravekeeper', label: '坟场88' },
    ]
    const KEY_ROWS = [0, 8, 9, 10, 13, 18]
    console.log('\n—— 速度口径校验（敌战斗机动 ÷ 玩家实际战斗机动；冷却期口径、不含点火）——')
    for (const [ti, skillName] of ['无技能', '中位', '满技能'].entries()) {
      const skills = ti === 0 ? {} : ti === 1 ? MID_SKILLS : FULL_SKILLS
      for (const ri of KEY_ROWS) {
        const ld = LOADOUTS[ri]!
        const st = makeState(ld.ship, ld, skills, 1)
        const spec = createPlayerSpec(st, ctx as SimContext, ld.ship)
        const meV = spec.speedMps * bal.speedFactor * (1 + (spec.agility - 0.5) * 2 * bal.agilitySpeedBonus)
        const cells = KEY_CARDS.map(({ id }) => {
          const a = ctx.anomalies.get(id)!
          const f = createFoeSpecs(a, bal)[0]!
          const foeV = f.speedMps * foeAgilityMul
          return `${(foeV / Math.max(1, meV)).toFixed(2)}×`
        })
        console.log(
          `${skillName.padEnd(4)} ${ld.name.padEnd(30)} 我 ${String(Math.round(meV)).padStart(3)} m/s  ` +
            KEY_CARDS.map((c, i) => `${c.label} ${cells[i]}`).join('  '),
        )
      }
    }
  }
  void bal
}

const bal = ctx.balance.battle
void main()
