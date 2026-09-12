/**
 * **近防炮 vs 敌方机群 · 标定工具**（正式入库；2026-09-12 机群批「丁案 + 对无人机伤害加成 ×2 + 警戒机削血 40%」配套）。
 *
 * 背景（船长 2026-09-12 实测追问「**我方近防炮不是 90 命中率吗**」「**近防炮对敌方无人机伤害依旧太低了**」）：
 * 近防炮打机群的真实瓶颈**不是单发**，而是**开火次数**——反应式 + 消费制下"一次敌机齐射只换一炮"，
 * 而 E 族机群**同步齐射**（同一步 7 发并成一个令牌）⇒ 实测一场只开 5~16 炮（自身装填 1.3 秒 ⇒ 本可 40+ 炮）。
 * 本工具把「配装 × 卡」的整场读数一次打出来，供**改数值前后对照**与日后标定（取代临时探针）。
 *
 * 读数来源**全部取自真实引擎**（不另算公式）：
 * - `BattleFx` 里我方近防炮打机群的那条（`pd:true`）＝**开火数**，`pd && hit` ＝**命中数**
 *   （见 `combat.stepBattle`：打机群只出炮口闪光、不画弹道，故带该标记）；
 * - 敌机开火条（`side:'foe' && src:'drone'`）＝**反应式令牌的来源**；
 * - 敌机池 `foeDronePools` 的 `alive` 翻转 ＝**击落数**，`inHangar` 翻转 ＝**备用机补位次数**。
 *
 * 用法：
 *   npx tsx tools/pd-vs-foe-drone.ts                  # 全部 9 行配装 × 4 张卡 × 5 播种
 *   npx tsx tools/pd-vs-foe-drone.ts P6,P3            # 只看指定行（PD_ROWS 同义，便于小范围复跑）
 *
 * 列义：胜率 / 中位秒 / 近防炮开火·命中·命中率 / 敌机开火 / 击落 · 补位 / 期末在空 · 备用剩 /
 *      机群血量（**起 = 在空 + 在库**，终 = 只在空 ⇒ 两列不可直接相减比） / 我方面板（发数·伤害）。
 */
import { buildSimContext, FOE_DRONE_E_ALERT } from '@whale/data'
import { FOE_DRONE_G_BEE_KIN } from '../packages/data/src/foe-drones'
import { addShipToFleet, createInitialState } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import {
  advanceBattleFor,
  droneHitChance,
  hitChance,
  startBattleFor,
  waveGapTotalMs,
} from '../packages/core/src/combat'

const ctx = buildSimContext() as SimContext

const FULL: Record<string, number> = Object.fromEntries(
  [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control', 'reload-drills',
    'drone-warfare', 'drone-servicing', 'ammunition-condensing', 'shield-operation', 'energy-management',
    'hull-upgrades', 'shield-tuning', 'armor-tuning', 'armed-ops', 'armored-ops', 'vector-maneuvering',
    'evasion-maneuvering', 'targeting-integration', 'ship-systems-engineering',
  ].map((k) => [k, 5]),
)
const MID: Record<string, number> = Object.fromEntries(Object.keys(FULL).map((k) => [k, 3]))

type Row = {
  id: string
  label: string
  ship: string
  high: string[]
  mid?: string[]
  low?: string[]
  skills: Record<string, number>
  desireM?: number
}

const PD = 'mod-pd-e'
const PD2 = 'mod-pd-e-2'
const PD3 = 'mod-pd-e-3'
const TANK = ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2']
const TANKL = ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2']

const SWEEP_ROWS = process.env.PD_ROWS
const ROWS: Row[] = [
  { id: 'P0', label: '锤头鲨 5×近防炮MK1（纯防空·中技能）', ship: 'sh-hammerhead', high: [PD, PD, PD, PD, PD], mid: TANK, low: TANKL, skills: MID, desireM: 1000 },
  { id: 'P1', label: '锤头鲨 5×近防炮MK1（纯防空·满技能）', ship: 'sh-hammerhead', high: [PD, PD, PD, PD, PD], mid: TANK, low: TANKL, skills: FULL, desireM: 1000 },
  { id: 'P2', label: '锤头鲨 5×近防炮MK3（纯防空·满技能）', ship: 'sh-hammerhead', high: [PD3, PD3, PD3, PD3, PD3], mid: TANK, low: TANKL, skills: FULL, desireM: 1000 },
  { id: 'P3', label: '锤头鲨 2×近防炮MK1 + 3×动能MK2（混装·中技能）', ship: 'sh-hammerhead', high: [PD, PD, 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: TANK, low: TANKL, skills: MID, desireM: 1000 },
  { id: 'P6', label: '锤头鲨 1×近防炮MK1 + 4×动能MK2（单门防空·中技能）', ship: 'sh-hammerhead', high: [PD, 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: TANK, low: TANKL, skills: MID, desireM: 1000 },
  { id: 'P8', label: '锤头鲨 1×近防炮MK3 + 4×动能MK2（单门顶档·满技能）', ship: 'sh-hammerhead', high: [PD3, 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: TANK, low: TANKL, skills: FULL, desireM: 1000 },
  { id: 'P9', label: '锤头鲨 4×近防炮MK1 + 1×动能MK2（重防空·中技能）', ship: 'sh-hammerhead', high: [PD, PD, PD, PD, 'mod-turret-kin-2'], mid: TANK, low: TANKL, skills: MID, desireM: 1000 },
  { id: 'P4', label: '锤头鲨 0×近防炮 5×动能MK2（对照·中技能）', ship: 'sh-hammerhead', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: TANK, low: TANKL, skills: MID, desireM: 1000 },
  { id: 'P5', label: '王鲭 4×近防炮MK1 + 机巢（无人机舰·中技能）', ship: 'sh-sentinel', high: [PD, PD, PD, PD], mid: TANK.slice(0, 2), low: TANKL.slice(0, 2), skills: MID, desireM: 1000 },
]

const CARDS = ['ano-titan-wreck', 'ano-auro-raiders', 'ano-core-section', 'ano-nadir-static']
const SEEDS = [1, 7, 13, 29, 51]

function makeState(r: Row, seed: number): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, r.ship)
  state.shipId = uid
  for (const [k, v] of Object.entries(r.skills)) state.skills.trained[k] = v
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 20_000
  const e = state.fleet[uid]!
  e.fitted = { high: [...r.high], mid: [...(r.mid ?? [])], low: [...(r.low ?? [])] }
  return state
}

type Reading = {
  win: boolean
  durMs: number
  pdShots: number
  pdHits: number
  foeDroneShots: number
  droneKills: number
  refills: number
  initAloft: number
  aloftEnd: number
  reserveLeft: number
  poolHpEnd: number
  poolHpStart: number
  meShots: number
  meDmg: number
  meRemainPct: number
  distEnd: number
  minDist: number
  endDist: number
  foeGunShots: number
}

function run(r: Row, card: string, seed: number): Reading | null {
  const state = makeState(r, seed)
  const b = startBattleFor(state, ctx, state.shipId, card, 0, r.desireM)
  if (!b) return null
  const budget = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(card), ctx.balance.battle)
  let lastSeq = 0
  let pdShots = 0
  let pdHits = 0
  let foeDroneShots = 0
  let foeGunShots = 0
  let minDist = Number.POSITIVE_INFINITY
  const startHp = poolHp(b)
  const poolsInitAloft = Object.values(b.foeDronePools ?? {})
    .flat()
    .filter((p) => p.alive && p.inHangar !== true).length
  const alive = new Set<string>()
  const parked = new Set<string>()
  for (const [tag, arr] of Object.entries(b.foeDronePools ?? {}))
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]!
      if (p.alive) alive.add(`${tag}#${i}`)
      if (p.inHangar === true) parked.add(`${tag}#${i}`)
    }
  let kills = 0
  let refills = 0
  const startAt = b.startedAtGameMs
  for (let t = 1000; t <= budget; t += 1000) {
    state.gameMs = startAt + t
    advanceBattleFor(state, ctx, b, state.shipId, card)
    minDist = Math.min(minDist, b.distanceM)
    for (const e of b.fx) {
      if (e.seq <= lastSeq) continue
      lastSeq = e.seq
      if (e.pd === true) {
        pdShots++
        if (e.hit) pdHits++
      } else if (e.side === 'foe' && e.src === 'drone') foeDroneShots++
      else if (e.side === 'foe') foeGunShots++
    }
    for (const [tag, arr] of Object.entries(b.foeDronePools ?? {}))
      for (let i = 0; i < arr.length; i++) {
        const key = `${tag}#${i}`
        const p = arr[i]!
        if (p.alive && !alive.has(key)) alive.add(key)
        if (!p.alive && alive.has(key)) {
          alive.delete(key)
          kills++
        }
        // 备用机库：在库 → 放飞 = 一次补位
        if (p.inHangar === true && !parked.has(key)) parked.add(key)
        if (p.inHangar !== true && parked.has(key)) {
          parked.delete(key)
          refills++
        }
      }
    if (b.ended) break
  }
  const u = b.units['player']
  const pools = Object.values(b.foeDronePools ?? {}).flat()
  return {
    win: b.ended === 'me',
    durMs: Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs)),
    pdShots,
    pdHits,
    foeDroneShots,
    droneKills: kills,
    refills,
    initAloft: poolsInitAloft,
    aloftEnd: pools.filter((p) => p.alive && p.inHangar !== true).length,
    reserveLeft: pools.filter((p) => p.inHangar === true).length,
    poolHpEnd: pools.filter((p) => p.alive && p.inHangar !== true).reduce((s, p) => s + p.s + p.a + p.h, 0),
    poolHpStart: startHp,
    meShots: b.stats.meShots,
    meDmg: Math.round(b.stats.meDmg),
    meRemainPct: 0,
    distEnd: 0,
    minDist: Number.isFinite(minDist) ? Math.round(minDist) : 0,
    endDist: Math.round(b.distanceM),
    foeGunShots,
  }
}

function poolHp(b: { foeDronePools?: Record<string, Array<{ alive: boolean; inHangar?: boolean; s: number; a: number; h: number }>> }): number {
  let n = 0
  for (const arr of Object.values(b.foeDronePools ?? {}))
    for (const p of arr) if (p.alive) n += p.s + p.a + p.h
  return Math.round(n)
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length
}

console.log('行\t卡\t胜率\t中位秒\t近防炮开火\t命中\t命中率\t敌机开火\t击落\t补位\t在空/初\t期末在空\t备用剩\t机群血量(初→末)\t我方面板')
for (const r of ROWS) {
  if (SWEEP_ROWS && !SWEEP_ROWS.split(',').includes(r.id)) continue
  for (const card of CARDS) {
    const rows: Reading[] = []
    for (const seed of SEEDS) {
      const x = run(r, card, seed)
      if (x) rows.push(x)
    }
    if (rows.length === 0) {
      console.log(`${r.id}\t${card}\t（无此卡）`)
      continue
    }
    const secs = rows.map((x) => x.durMs).sort((a, b) => a - b)
    const label = `${r.id} ${r.label}`
    console.log(
      `${label}\t${card}\t${Math.round((rows.filter((x) => x.win).length / rows.length) * 100)}%\t` +
        `${Math.round(secs[Math.floor(secs.length / 2)]! / 1000)}s\t` +
        `${avg(rows.map((x) => x.pdShots)).toFixed(1)}\t${avg(rows.map((x) => x.pdHits)).toFixed(1)}\t` +
        `${((avg(rows.map((x) => x.pdHits)) / Math.max(1, avg(rows.map((x) => x.pdShots)))) * 100).toFixed(0)}%\t` +
        `${avg(rows.map((x) => x.foeDroneShots)).toFixed(1)}\t${avg(rows.map((x) => x.droneKills)).toFixed(2)}\t` +
        `${avg(rows.map((x) => x.refills)).toFixed(2)}\t${rows[0]!.initAloft}架\t` +
        `${avg(rows.map((x) => x.aloftEnd)).toFixed(1)}\t${avg(rows.map((x) => x.reserveLeft)).toFixed(1)}\t` +
        `${rows[0]!.poolHpStart}→${avg(rows.map((x) => x.poolHpEnd)).toFixed(0)}\t` +
        `${avg(rows.map((x) => x.meShots)).toFixed(0)}发/${avg(rows.map((x) => x.meDmg)).toFixed(0)}伤`,
    )
  }
}

/* ── 公式面读数：两条命中公式的对照（打机群不吃衰减 / 打舰仍吃衰减） ── */
console.log('\n【公式面】同一门近防炮的命中率 —— 打机群（丁案：不吃距离衰减）vs 打舰（仍吃）')
const WF = {
  近防炮MK1: { hitRate: 0.9, minRangeM: 1, maxRangeM: 2500, falloff: 0.5 },
  近防炮MK3: { hitRate: 0.92, minRangeM: 1, maxRangeM: 2500, falloff: 0.5 },
}
for (const [name, W] of Object.entries(WF)) {
  const vsDrone = droneHitChance(W, { hitBonus: 0 }, 0.18, ctx.balance.battle)
  const vsShip = [1000, 2500, 3220, 5545]
    .map((d) => `${d}m:${(hitChance(W, { hitBonus: 0 }, { evasion: 0.18 }, d, ctx.balance.battle) * 100).toFixed(0)}%`)
    .join('  ')
  console.log(
    `  ${name}：打机群（E 警戒机 闪避 0.18）= ${(vsDrone * 100).toFixed(0)}%（**与两舰距离无关**）｜打舰 = ${vsShip}`,
  )
}

/* ── 装备面读数（打机群口径一眼可查） ── */
console.log('\n【装备面】近防炮三档')
for (const id of ['mod-pd-e', 'mod-pd-e-2', 'mod-pd-e-3']) {
  const m = ctx.modules.get(id)!
  console.log(
    `  ${m.name}：dmgMult=${m.dmgMult} · 命中 ${m.hitRate} · **对无人机伤害 ×${m.antiDroneDmgMul ?? 1}** · ` +
      `射程 ${m.maxRangeM}m · 装填 ${m.reloadMs}ms · CPU ${m.cpuUse}`,
  )
}
const pdTiers = ctx.balance.battle
console.log(
  `\n【对照】敌方近防炮（打**我方**无人机，抽象自动系统）：pdDmg=${pdTiers.pdDmg} × 舰种档 [${pdTiers.pdTierMul.join(' / ')}] · ` +
    `判定 ${pdTiers.pdJudgementMs}ms/舰 · 命中 clamp(${pdTiers.pdHitFloor}, 1, ${pdTiers.pdAcc} − 机型闪避) · 威胁门槛 ${pdTiers.pdThreatFloor}`,
)
console.log('【机型面】E 警戒机三层血：', JSON.stringify(FOE_DRONE_E_ALERT.defense))
console.log('【机型面】G 蜂群机三层血：', JSON.stringify(FOE_DRONE_G_BEE_KIN.defense))
